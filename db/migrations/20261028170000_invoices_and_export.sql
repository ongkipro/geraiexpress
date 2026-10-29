-- T-047 (PR-16, PR-6, PR-22, DATA-10, DEC-014, DEC-017): immutable invoice snapshots and the audit of
-- operational exports.
--
-- 1. invoice_snapshots: one append-only charge document per real issued shipment. It carries the
--    sender-facing shipping charge (shipments.customer_charge_idr, the normal tariff and, for COD, the
--    COD fee the sender was quoted) and nothing private: no net cost, no discount, no platform share.
--    It is a charge document, never proof of payment.
-- 2. record_export: the audit row of a CSV export. Tenant administrators only.
-- Nothing here calls Mengantar.

-- ============================================================ per-tenant, per-day invoice counter

create table private.invoice_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  last_seq integer not null check (last_seq > 0),
  primary key (tenant_id, day)
);
alter table private.invoice_counters enable row level security;

-- <PREFIX>-INV-<yymmdd>-<seq>: the WIB calendar day and a sequence of at least three digits. The upsert
-- takes the counter row's lock, so concurrent invoices of one tenant on one day queue and receive
-- distinct numbers. A rolled-back issuance rolls its increment back too: no gaps from failures.
create function private.next_invoice_number(p_tenant uuid)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Jakarta';
  v_prefix text;
  v_seq integer;
begin
  select shipment_prefix into v_prefix from public.tenants where id = p_tenant;
  if v_prefix is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into private.invoice_counters as c (tenant_id, day, last_seq)
  values (p_tenant, v_now::date, 1)
  on conflict (tenant_id, day) do update set last_seq = c.last_seq + 1
  returning c.last_seq into v_seq;
  return v_prefix || '-INV-' || to_char(v_now, 'YYMMDD') || '-'
    || case when v_seq < 1000 then lpad(v_seq::text, 3, '0') else v_seq::text end;
end $$;

-- ============================================================ invoice snapshots

create table public.invoice_snapshots (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  shipment_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  invoice_number text not null check (invoice_number ~ '^[A-Z]{3,5}-INV-[0-9]{6}-[0-9]{3,}$'),
  issued_at timestamptz not null default now(),
  -- The gerai as the invoice prints it: tenant name, tenant-level WhatsApp and the outlet address from
  -- the shipment's frozen pickup snapshot. Always the gerai identity: the invoice is the gerai's own
  -- charge document, independent of the sender masking choice on the label.
  gerai_name text not null check (char_length(gerai_name) between 1 and 160),
  gerai_whatsapp text not null check (gerai_whatsapp ~ '^0[2-9][0-9]{7,11}$'),
  gerai_address text check (char_length(gerai_address) <= 700),
  -- Summary of the parties: names and the recipient area only (no phone, no street address).
  sender_name text check (char_length(sender_name) <= 120),
  recipient_name text check (char_length(recipient_name) <= 120),
  recipient_area text check (char_length(recipient_area) <= 160),
  item_description text check (char_length(item_description) <= 200),
  weight_grams integer check (weight_grams > 0),
  courier text,
  service text,
  -- Sender-facing shipping charge only. Never the private net cost, a discount or a platform remainder.
  shipping_charge_idr bigint not null check (shipping_charge_idr >= 0),
  is_cod boolean not null,
  cod_amount_idr bigint check (cod_amount_idr >= 0),
  awb text not null check (awb ~ '^[A-Za-z0-9-]{6,40}$'),
  shipment_reference text not null,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, shipment_id),
  unique (tenant_id, invoice_number),
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade
);

-- No UPDATE, no direct DELETE and no TRUNCATE for any role. A DELETE that runs inside another trigger
-- (the foreign-key cascade of a purged shipment or tenant) is the one allowed removal: a direct
-- statement fires this trigger at depth 1, a cascade at depth 2 or more (same rule as label snapshots).
create function private.invoice_history_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'invoice_is_append_only' using errcode = '42501';
end $$;
create trigger invoice_snapshots_append_only before update or delete on public.invoice_snapshots
  for each row execute function private.invoice_history_guard();
create trigger invoice_snapshots_no_truncate before truncate on public.invoice_snapshots
  for each statement execute function private.invoice_history_guard();

alter table public.invoice_snapshots enable row level security;
grant select on public.invoice_snapshots to authenticated;
create policy invoice_snapshots_member_read on public.invoice_snapshots for select to authenticated
  using ((select private.is_member(tenant_id)));

-- ============================================================ invoice command

-- Creates the invoice snapshot of a shipment, or returns the existing one: one invoice per shipment,
-- so a repeated or concurrent call is idempotent (the shipment row lock serializes them). Any member
-- of the shipment's tenant (operators print, DEC-008). Real shipments with an authoritative AWB only.
-- The charge must be known: an unknown charge is refused, never printed as zero.
create function public.create_invoice_snapshot(p_shipment uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  t public.tenants;
  o public.outlets;
  q public.shipment_quotes;
  prev public.invoice_snapshots;
  v_number text;
  v_address text;
  v_content jsonb;
  v_id uuid;
begin
  s := private.lock_member_shipment(p_shipment);
  select * into prev from public.invoice_snapshots where tenant_id = s.tenant_id and shipment_id = s.id;
  if found then return prev.id; end if;
  if s.is_simulated then raise exception 'simulated_shipment' using errcode = '55000'; end if;
  if s.submission_state <> 'issued' or s.awb is null or s.awb !~ '^[A-Za-z0-9-]{6,40}$' then
    raise exception 'no_awb' using errcode = '55000';
  end if;
  if s.customer_charge_idr is null then raise exception 'charge_unknown' using errcode = '55000'; end if;
  select * into t from public.tenants where id = s.tenant_id;
  if t.contact_whatsapp is null then raise exception 'whatsapp_missing' using errcode = '55000'; end if;

  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id;
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;
  v_address := nullif(concat_ws(', ',
    nullif(btrim(coalesce(s.pickup_snapshot ->> 'address', o.pickup_address, '')), ''),
    nullif(btrim(coalesce(s.pickup_snapshot ->> 'area', o.pickup_area, '')), '')), '');
  v_number := private.next_invoice_number(s.tenant_id);

  v_content := jsonb_build_object(
    'template', 1, 'number', v_number,
    'gerai', jsonb_build_array(t.name, t.contact_whatsapp, v_address),
    'parties', jsonb_build_array(s.sender_name, s.recipient_name, s.recipient_area),
    'item', s.item_description, 'weight', s.weight_grams, 'courier', q.courier, 'service', q.service,
    'charge', s.customer_charge_idr, 'cod', jsonb_build_array(s.is_cod, s.cod_amount_idr),
    'awb', s.awb, 'reference', s.reference);

  insert into public.invoice_snapshots (tenant_id, shipment_id, invoice_number, gerai_name, gerai_whatsapp,
    gerai_address, sender_name, recipient_name, recipient_area, item_description, weight_grams, courier, service,
    shipping_charge_idr, is_cod, cod_amount_idr, awb, shipment_reference, content_digest, created_by)
  values (s.tenant_id, s.id, v_number, t.name, t.contact_whatsapp,
    v_address, s.sender_name, s.recipient_name, s.recipient_area, s.item_description, s.weight_grams, q.courier, q.service,
    s.customer_charge_idr, s.is_cod, s.cod_amount_idr, s.awb, s.reference,
    encode(extensions.digest(convert_to(v_content::text, 'utf8'), 'sha256'), 'hex'), (select auth.uid()))
  returning id into v_id;
  -- No party or contact data in the audit detail; the snapshot row holds it.
  perform private.audit('invoice.snapshot', s.tenant_id, null, null, 'issued',
    jsonb_build_object('shipment', s.id, 'snapshot', v_id, 'number', v_number));
  return v_id;
end $$;

-- ============================================================ export audit

-- Records that a tenant administrator exported shipments: who (the audit actor), which filters and how
-- many rows. The text search is recorded only as present or absent, never its content, because a search
-- term can be a person's name. Tenant administrators of real (non-demo) tenants only; the Worker calls
-- it before it releases any byte and refuses the download when it fails.
create function public.record_export(p_tenant uuid, p_kind text, p_filters jsonb, p_row_count integer,
  p_truncated boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_key text;
begin
  perform private.require_member(p_tenant);
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  if p_kind is distinct from 'shipments' or p_row_count is null or p_row_count not between 0 and 10000
     or p_truncated is null or p_filters is null or jsonb_typeof(p_filters) <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_filters) loop
    if v_key not in ('status', 'from', 'to', 'has_query') then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end loop;
  perform private.audit('export.' || p_kind, p_tenant, null, null,
    case when p_truncated then 'truncated' else 'ok' end,
    jsonb_build_object('filters', p_filters, 'rows', p_row_count, 'truncated', p_truncated));
end $$;

-- ============================================================ privileges

revoke all on function private.next_invoice_number(uuid), private.invoice_history_guard()
  from public, anon, authenticated;
revoke all on function public.create_invoice_snapshot(uuid),
  public.record_export(uuid, text, jsonb, integer, boolean) from public, anon;
grant execute on function public.create_invoice_snapshot(uuid),
  public.record_export(uuid, text, jsonb, integer, boolean) to authenticated;
