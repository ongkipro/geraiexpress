-- T-083 / PR-39: outlet periods span midnight. Operators and tenant administrators may close;
-- only tenant administrators may reopen. Commands lock only the period, never shipment/payment
-- rows or memberships (record/void acquire those before the period). No client-supplied totals.
create table public.cash_period_events (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  period_id uuid not null,
  kind text not null check (kind in ('close', 'reopen')),
  counted_cash_idr bigint,
  expected_cash_idr bigint,
  variance_idr bigint,
  reason text,
  actor uuid not null references auth.users(id),
  at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, period_id) references public.cash_periods(tenant_id, id) on delete cascade,
  constraint cash_period_events_content check (
    (kind = 'close' and counted_cash_idr is not null and counted_cash_idr >= 0
      and expected_cash_idr is not null and expected_cash_idr >= 0 and variance_idr is not null
      and variance_idr = counted_cash_idr - expected_cash_idr and reason is null)
    or (kind = 'reopen' and counted_cash_idr is null and expected_cash_idr is null
      and variance_idr is null and reason is not null and char_length(btrim(reason)) between 5 and 500))
);
create index cash_period_events_by_period on public.cash_period_events(tenant_id, period_id, at);
-- Reuse the immutable-history guard: direct UPDATE/DELETE/TRUNCATE refused; owner cascades allowed.
create trigger cash_period_events_append_only before update or delete on public.cash_period_events
  for each row execute function private.label_history_guard();
create trigger cash_period_events_no_truncate before truncate on public.cash_period_events
  for each statement execute function private.label_history_guard();
alter table public.cash_period_events enable row level security;
revoke all on public.cash_period_events from public, anon, authenticated, service_role;
grant select on public.cash_period_events to authenticated;
create policy cash_period_events_member_read on public.cash_period_events for select to authenticated
  using ((select private.is_member(tenant_id)));

create function public.close_cash_period(p_period uuid, p_counted_idr bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.cash_periods;
  v_expected bigint;
begin
  select * into c from public.cash_periods where id = p_period;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(c.tenant_id);
  select * into c from public.cash_periods where tenant_id = c.tenant_id and id = p_period for update;
  perform private.require_member(c.tenant_id);
  if c.closed_at is not null then raise exception 'period_closed' using errcode = '55000'; end if;
  if p_counted_idr is null or p_counted_idr < 0 then
    raise exception 'counted_cash_invalid' using errcode = '22023';
  end if;
  -- Payment insert/void both hold this period lock. A plain aggregate sees committed active rows
  -- after any preceding writer completes, without reversing the shipment -> payment -> period order.
  select coalesce(sum(p.amount_idr), 0) into v_expected from public.counter_payments p
    where p.tenant_id = c.tenant_id and p.period_id = c.id and p.method = 'cash' and p.voided_at is null;
  update public.cash_periods set closed_at = now(), closed_by = (select auth.uid()),
    counted_cash_idr = p_counted_idr, expected_cash_idr = v_expected, variance_idr = p_counted_idr - v_expected
    where tenant_id = c.tenant_id and id = c.id;
  insert into public.cash_period_events(tenant_id, period_id, kind, counted_cash_idr, expected_cash_idr, variance_idr, actor)
    values (c.tenant_id, c.id, 'close', p_counted_idr, v_expected, p_counted_idr - v_expected, (select auth.uid()));
  perform private.audit('cash_period.close', c.tenant_id, null, null, 'succeeded',
    jsonb_build_object('period', c.id, 'counted_cash_idr', p_counted_idr, 'expected_cash_idr', v_expected));
end $$;

create function public.reopen_cash_period(p_period uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.cash_periods;
  v_reason text;
begin
  select * into c from public.cash_periods where id = p_period;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(c.tenant_id);
  if private.member_role(c.tenant_id) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  select * into c from public.cash_periods where tenant_id = c.tenant_id and id = p_period for update;
  perform private.require_member(c.tenant_id);
  if private.member_role(c.tenant_id) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  if c.closed_at is null then raise exception 'period_open' using errcode = '55000'; end if;
  if exists (select 1 from public.cash_periods where tenant_id = c.tenant_id
      and outlet_id = c.outlet_id and closed_at is null) then
    raise exception 'period_open_exists' using errcode = '55000';
  end if;
  begin
    update public.cash_periods set closed_at = null, closed_by = null, counted_cash_idr = null,
      expected_cash_idr = null, variance_idr = null where tenant_id = c.tenant_id and id = c.id;
  exception when unique_violation then
    -- A concurrent payment may have opened the next period since the check above. Never merge.
    raise exception 'period_open_exists' using errcode = '55000';
  end;
  insert into public.cash_period_events(tenant_id, period_id, kind, reason, actor)
    values (c.tenant_id, c.id, 'reopen', v_reason, (select auth.uid()));
  perform private.audit('cash_period.reopen', c.tenant_id, null, v_reason, 'succeeded',
    jsonb_build_object('period', c.id));
end $$;

revoke all on function public.close_cash_period(uuid, bigint), public.reopen_cash_period(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.close_cash_period(uuid, bigint), public.reopen_cash_period(uuid, text) to authenticated;

-- Latest record body: 20261104120000; only the open-period lookup changes. ACL unchanged.
create or replace function public.record_counter_payment(p_shipment uuid, p_method text, p_amount_idr bigint,
  p_received_idr bigint, p_difference_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  v_period uuid;
  v_closed timestamptz;
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

  -- Still-open periods span midnight. Closing never makes the next payment join a closed row.
  -- Bounded retry handles a close while waiting for FOR UPDATE, and competing first openers.
  for attempt in 1..3 loop
    v_period := null;
    select id, closed_at into v_period, v_closed from public.cash_periods
      where tenant_id = s.tenant_id and outlet_id = s.outlet_id and closed_at is null for update;
    if v_period is not null and v_closed is null then exit; end if;
    v_period := null;
    begin
      insert into public.cash_periods (tenant_id, outlet_id, opened_by)
        values (s.tenant_id, s.outlet_id, (select auth.uid())) returning id into v_period;
      exit;
    exception when unique_violation then
      -- Retry the locked lookup, not the payment operation.
      null;
    end;
  end loop;
  if v_period is null then raise exception 'period_closed' using errcode = '55000'; end if;

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

notify pgrst, 'reload schema';
