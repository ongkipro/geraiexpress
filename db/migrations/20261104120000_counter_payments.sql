-- T-082 (PR-38, DATA-11, UX-17 items 1-4, 7, 8): counter payment records and outlet cash periods.
--
-- 1. public.cash_periods: one open period per outlet (partial unique index on closed_at is null).
--    The first payment of an outlet without an open period opens one inside record_counter_payment.
--    Closing and reopening belong to T-083; the close columns exist so that a closed period can
--    already refuse new or changed records here.
-- 2. public.counter_payments: tenant-owned, append-only payment records bound to one shipment and
--    one outlet cash period. At most one active (non-voided) record per shipment. Voiding keeps the
--    row with actor, time and reason. Outlet and period are derived from the shipment, never supplied
--    by the caller.
-- 3. RLS on, member-safe column SELECT plus admin-only detail RPC, no INSERT/UPDATE/DELETE grant:
--    writes only through the security-definer RPCs record_counter_payment and void_counter_payment.
-- 4. reopen_shipment is refused while an active payment exists (void first).
--
-- Error codes: charge_unknown, cod_collected_by_courier, payment_recorded, payment_invalid,
-- difference_reason_required, cash_received_invalid, period_closed, payment_voided, admin_required,
-- reason_required, not_found.

-- ============================================================ tables

create table public.cash_periods (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  outlet_id uuid not null,
  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users (id),
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  counted_cash_idr bigint check (counted_cash_idr is null or counted_cash_idr >= 0),
  expected_cash_idr bigint check (expected_cash_idr is null or expected_cash_idr >= 0),
  variance_idr bigint,
  primary key (tenant_id, id),
  foreign key (tenant_id, outlet_id) references public.outlets (tenant_id, id) on delete cascade,
  constraint cash_periods_close_complete check (
    (closed_at is null and closed_by is null and counted_cash_idr is null and expected_cash_idr is null and variance_idr is null)
    or (closed_at is not null and counted_cash_idr is not null and expected_cash_idr is not null
        and variance_idr is not null and variance_idr = counted_cash_idr - expected_cash_idr))
);
-- DATA-11: at most one open period per outlet.
create unique index cash_periods_one_open_per_outlet on public.cash_periods (tenant_id, outlet_id)
  where closed_at is null;

create table public.counter_payments (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  shipment_id uuid not null,
  outlet_id uuid not null,
  period_id uuid not null,
  -- DATA-11 method values.
  method text not null check (method in ('cash', 'qris', 'transfer', 'other')),
  amount_idr bigint not null check (amount_idr > 0),
  expected_idr bigint not null check (expected_idr >= 0),
  difference_reason text check (difference_reason is null or char_length(difference_reason) between 5 and 500),
  cash_received_idr bigint,
  recorded_by uuid not null references auth.users (id),
  -- Owner decision 2026-11-05: gerai identity frozen at PAYMENT time, not confirmation time.
  receipt_gerai_name text not null,
  receipt_gerai_whatsapp text,
  -- No accepted staff display-name field exists. Do not infer a person's name from their email.
  recorded_by_label text not null default 'Petugas' check (recorded_by_label = 'Petugas'),
  recorded_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  void_reason text check (void_reason is null or char_length(void_reason) between 5 and 500),
  primary key (tenant_id, id),
  unique (tenant_id, shipment_id, id),
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, outlet_id) references public.outlets (tenant_id, id) on delete cascade,
  foreign key (tenant_id, period_id) references public.cash_periods (tenant_id, id) on delete cascade,
  constraint counter_payments_difference_reason check (amount_idr = expected_idr or difference_reason is not null),
  constraint counter_payments_cash_received check (
    (method = 'cash' and (cash_received_idr is null or cash_received_idr >= amount_idr))
    or (method <> 'cash' and cash_received_idr is null)),
  constraint counter_payments_void_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null))
);
-- DATA-11: one active (non-voided) record per shipment.
create unique index counter_payments_one_active_per_shipment on public.counter_payments (tenant_id, shipment_id)
  where voided_at is null;
create index counter_payments_by_period on public.counter_payments (tenant_id, period_id);

-- Append-only: the only allowed change is the one-time void (voided_at/voided_by/void_reason set
-- from NULL); every other column is frozen and rows are never deleted except by tenant cascade.
create function private.counter_payment_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'payment_append_only' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    -- Tenant/shipment cascades remove rows only together with their owner (pg_trigger_depth > 1).
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'payment_append_only' using errcode = '42501';
  end if;
  if old.voided_at is not null
     or new.voided_at is null
     or (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'])
        is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'payment_append_only' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger counter_payments_append_only before update or delete on public.counter_payments
  for each row execute function private.counter_payment_guard();
create trigger counter_payments_no_truncate before truncate on public.counter_payments
  for each statement execute function private.counter_payment_guard();

alter table public.cash_periods enable row level security;
alter table public.counter_payments enable row level security;
grant select on public.cash_periods to authenticated;
-- IAM-1 is stricter than broad member SELECT: the stored charge-difference and void reasons are
-- admin-only. Actual payment/receipt facts remain member-readable; inference from the shipment's
-- known tariff does not authorize reading the stored administrative payload.
revoke select on public.counter_payments from public, anon, authenticated;
grant select (tenant_id, id, shipment_id, outlet_id, period_id, method, amount_idr, cash_received_idr,
  recorded_by, recorded_by_label, recorded_at, voided_at, voided_by, receipt_gerai_name, receipt_gerai_whatsapp)
  on public.counter_payments to authenticated;
create policy cash_periods_member_read on public.cash_periods for select to authenticated
  using ((select private.is_member(tenant_id)));
create policy counter_payments_member_read on public.counter_payments for select to authenticated
  using ((select private.is_member(tenant_id)));

-- Per-record administrative details never receive column SELECT grants, even for authenticated
-- tenant admins. This RPC is their sole read path and rechecks the shipment's current tenant role.
create function public.counter_payment_admin_details(p_shipment uuid)
returns table (payment_id uuid, expected_idr bigint, difference_reason text, void_reason text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select s.tenant_id into v_tenant from public.shipments s where s.id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  if private.member_role(v_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  return query select p.id, p.expected_idr, p.difference_reason, p.void_reason
    from public.counter_payments p where p.tenant_id = v_tenant and p.shipment_id = p_shipment;
end $$;

-- ============================================================ commands

-- Records how the customer paid at the counter for one confirmed shipment.
create function public.record_counter_payment(p_shipment uuid, p_method text, p_amount_idr bigint,
  p_received_idr bigint, p_difference_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  v_period uuid;
  v_expected bigint;
  v_reason text;
  v_gerai_name text;
  v_gerai_whatsapp text;
  v_id uuid;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state not in ('queued', 'in_flight', 'unknown', 'issued') or s.customer_charge_idr is null then
    raise exception 'charge_unknown' using errcode = '55000';
  end if;
  -- DATA-11 / DEC-003: the shipping charge of a COD shipment is collected by the courier inside the
  -- COD amount; the counter expected amount is 0 and an extra counter charge is not part of this
  -- contract, so any counter record is refused.
  if s.is_cod then
    raise exception 'cod_collected_by_courier' using errcode = '55000';
  end if;
  if exists (select 1 from public.counter_payments
             where tenant_id = s.tenant_id and shipment_id = s.id and voided_at is null) then
    raise exception 'payment_recorded' using errcode = '23505';
  end if;
  if p_method is null or p_method not in ('cash', 'qris', 'transfer', 'other')
     or p_amount_idr is null or p_amount_idr <= 0 then
    raise exception 'payment_invalid' using errcode = '22023';
  end if;
  if p_method = 'cash' then
    if p_received_idr is not null and p_received_idr < p_amount_idr then
      raise exception 'cash_received_invalid' using errcode = '22023';
    end if;
  elsif p_received_idr is not null then
    raise exception 'cash_received_invalid' using errcode = '22023';
  end if;

  v_expected := s.customer_charge_idr;
  if p_amount_idr <> v_expected then
    if char_length(btrim(coalesce(p_difference_reason, ''))) not between 5 and 500 then
      raise exception 'difference_reason_required' using errcode = '22023';
    end if;
    v_reason := btrim(p_difference_reason);
  end if;

  -- The outlet's open period, whatever its WIB day; the first payment opens one. The partial unique
  -- index serializes concurrent openers: the loser retries the lookup.
  select id into v_period from public.cash_periods
    where tenant_id = s.tenant_id and outlet_id = s.outlet_id and closed_at is null for update;
  if v_period is null then
    begin
      insert into public.cash_periods (tenant_id, outlet_id, opened_by)
        values (s.tenant_id, s.outlet_id, (select auth.uid())) returning id into v_period;
    exception when unique_violation then
      select id into v_period from public.cash_periods
        where tenant_id = s.tenant_id and outlet_id = s.outlet_id and closed_at is null for update;
      if v_period is null then raise exception 'period_closed' using errcode = '55000'; end if;
    end;
  end if;

  select name, contact_whatsapp into v_gerai_name, v_gerai_whatsapp
    from public.tenants where id = s.tenant_id;

  insert into public.counter_payments (tenant_id, shipment_id, outlet_id, period_id, method, amount_idr,
    expected_idr, difference_reason, cash_received_idr, recorded_by, receipt_gerai_name, receipt_gerai_whatsapp)
  values (s.tenant_id, s.id, s.outlet_id, v_period, p_method, p_amount_idr, v_expected, v_reason,
    case when p_method = 'cash' then p_received_idr end, (select auth.uid()), v_gerai_name, v_gerai_whatsapp)
  returning id into v_id;

  perform private.add_event(s.tenant_id, s.id, 'counter_payment', 'Pembayaran pelanggan dicatat');
  perform private.audit('counter_payment.record', s.tenant_id, null, v_reason, 'succeeded',
    jsonb_build_object('payment', v_id, 'shipment', s.id, 'period', v_period, 'method', p_method,
      'amount_idr', p_amount_idr, 'expected_idr', v_expected));
  return v_id;
end $$;

-- Voids the active record of a shipment: tenant administrator only, reason required, row kept.
create function public.void_counter_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  p public.counter_payments;
  v_reason text;
  v_closed timestamptz;
begin
  select tenant_id, shipment_id into v_tenant, v_shipment from public.counter_payments where id = p_payment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  -- assistant-recommended: unlike require_tenant_admin_locked, a demo tenant administrator may void
  -- (the demo records simulated payments and must be able to show the void flow).
  if private.member_role(v_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  perform 1 from public.memberships where tenant_id = v_tenant for update;
  if private.member_role(v_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);

  -- Match record/receipt lock order (shipment -> payment -> period), including the shipment FK lock
  -- taken by add_event. A payment-first void can deadlock with a concurrent receipt print.
  perform private.lock_member_shipment(v_shipment);
  select * into p from public.counter_payments where tenant_id = v_tenant and id = p_payment for update;
  if p.voided_at is not null then raise exception 'payment_voided' using errcode = '55000'; end if;
  select closed_at into v_closed from public.cash_periods
    where tenant_id = v_tenant and id = p.period_id for update;
  if v_closed is not null then raise exception 'period_closed' using errcode = '55000'; end if;

  update public.counter_payments set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
    where tenant_id = v_tenant and id = p.id;
  perform private.add_event(v_tenant, p.shipment_id, 'counter_payment_voided', 'Catatan pembayaran dibatalkan');
  perform private.audit('counter_payment.void', v_tenant, null, v_reason, 'succeeded',
    jsonb_build_object('payment', p.id, 'shipment', p.shipment_id, 'period', p.period_id, 'amount_idr', p.amount_idr));
end $$;

-- Latest definition (20261027190000_cod_and_batch_payment.sql) plus the active-payment refusal.
create or replace function public.reopen_shipment(p_shipment uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.shipments;
  op public.provider_operations;
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  select * into op from public.provider_operations
    where tenant_id = v_tenant and shipment_id = p_shipment and kind = 'create_order'
    order by created_at desc limit 1 for update;
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state <> 'failed' or op.id is null or not private.definitely_not_created(op.state, op.result_code) then
    raise exception 'not_reopenable' using errcode = '55000';
  end if;
  -- T-082: a shipment with an active counter payment is not reopened (void the record first).
  if exists (select 1 from public.counter_payments
             where tenant_id = s.tenant_id and shipment_id = s.id and voided_at is null) then
    raise exception 'payment_recorded' using errcode = '55000';
  end if;
  update public.shipments set submission_state = 'draft', selected_quote_id = null, customer_charge_idr = null,
    cod_amount_idr = null, pickup_snapshot = null, submitted_at = null, updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'reopened', 'Draf dibuka lagi setelah ditolak');
end $$;

-- ============================================================ receipt print requests

-- Extend the existing append-only print history without changing the label RPC or its signature.
-- All original label constraints remain mandatory for kind='label'. Receipt documents are rendered
-- from confirmation + payment; COD has no payment, so its first print event freezes gerai identity
-- (owner decision 2026-11-05). A print event means request, not paper.
alter table public.label_print_events
  add column kind text not null default 'label',
  add column receipt_payment_id uuid,
  add column receipt_gerai_name text check (receipt_gerai_name is null or char_length(receipt_gerai_name) between 2 and 120),
  add column receipt_gerai_whatsapp text check (receipt_gerai_whatsapp is null or receipt_gerai_whatsapp ~ '^0[2-9][0-9]{7,11}$'),
  alter column snapshot_id drop not null,
  drop constraint label_print_events_size_check,
  add constraint label_print_events_kind_content check (
    (kind = 'label' and snapshot_id is not null and size in ('10x15', '10x10') and receipt_payment_id is null
      and receipt_gerai_name is null and receipt_gerai_whatsapp is null)
    or (kind = 'receipt' and snapshot_id is null and size in ('58', '80') and (
      (receipt_payment_id is not null and receipt_gerai_name is null and receipt_gerai_whatsapp is null)
      or (receipt_payment_id is null and receipt_gerai_name is not null)))),
  add constraint label_print_events_receipt_payment_fk foreign key (tenant_id, shipment_id, receipt_payment_id)
    references public.counter_payments (tenant_id, shipment_id, id) on delete cascade;

drop function if exists public.record_receipt_print(uuid, uuid, text);
create function public.record_receipt_print(p_shipment uuid, p_payment uuid, p_width text,
  p_preview_gerai_name text default null, p_preview_gerai_whatsapp text default null)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  v_id bigint;
  v_gerai_name text;
  v_gerai_whatsapp text;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state not in ('queued', 'in_flight', 'unknown', 'issued') or s.customer_charge_idr is null then
    raise exception 'charge_unknown' using errcode = '55000';
  end if;
  if p_width is null or p_width not in ('58', '80') then
    raise exception 'receipt_width_invalid' using errcode = '22023';
  end if;
  if s.is_cod then
    if p_payment is not null then raise exception 'cod_collected_by_courier' using errcode = '55000'; end if;
    -- The shipment lock serializes first printers. A tenant SHARE lock prevents settings changing
    -- between first-preview validation and the event insert. Reprints never consult live identity.
    select e.receipt_gerai_name, e.receipt_gerai_whatsapp into v_gerai_name, v_gerai_whatsapp
      from public.label_print_events e where e.tenant_id = s.tenant_id and e.shipment_id = s.id
        and e.kind = 'receipt' and e.receipt_payment_id is null order by e.id limit 1;
    if not found then
      select t.name, t.contact_whatsapp into v_gerai_name, v_gerai_whatsapp
        from public.tenants t where t.id = s.tenant_id for share;
    end if;
    if p_preview_gerai_name is distinct from v_gerai_name or p_preview_gerai_whatsapp is distinct from v_gerai_whatsapp then
      raise exception 'receipt_identity_changed' using errcode = '55000';
    end if;
  else
    perform 1 from public.counter_payments
      where tenant_id = s.tenant_id and shipment_id = s.id and id = p_payment and voided_at is null for update;
    if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  insert into public.label_print_events (tenant_id, shipment_id, kind, snapshot_id, receipt_payment_id, size, actor,
    receipt_gerai_name, receipt_gerai_whatsapp)
    values (s.tenant_id, s.id, 'receipt', null, p_payment, p_width, (select auth.uid()),
      v_gerai_name, v_gerai_whatsapp) returning id into v_id;
  return v_id;
end $$;

-- ============================================================ privileges

revoke all on function private.counter_payment_guard() from public, anon, authenticated;
revoke all on function public.record_counter_payment(uuid, text, bigint, bigint, text),
  public.void_counter_payment(uuid, text), public.record_receipt_print(uuid, uuid, text, text, text),
  public.counter_payment_admin_details(uuid) from public, anon;
grant execute on function public.record_counter_payment(uuid, text, bigint, bigint, text),
  public.void_counter_payment(uuid, text), public.record_receipt_print(uuid, uuid, text, text, text),
  public.counter_payment_admin_details(uuid) to authenticated;

notify pgrst, 'reload schema';
