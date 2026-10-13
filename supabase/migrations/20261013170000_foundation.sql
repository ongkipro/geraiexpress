-- GeraiExpress foundation schema: tenancy, contacts, shipments, simulated provider operations.
-- Contracts: TEN-1, DATA-1, DATA-2, DATA-5, IAM-1, IAM-4, PR-1, PR-2, PR-5, PR-7, PR-21, NFR-1, NFR-2.
-- Every tenant-owned table carries tenant_id, composite same-tenant foreign keys and RLS.
-- Ownership/state columns are never writable through the Data API; state moves through RPCs.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ============================================================ tenancy

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  lifecycle text not null default 'provisioning'
    check (lifecycle in ('provisioning', 'active', 'suspended', 'archived')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.memberships (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('tenant_admin', 'operator')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where status = 'active';

create table public.outlets (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  name text not null check (char_length(name) between 2 and 120),
  pickup_address text check (char_length(pickup_address) <= 500),
  pickup_area text check (char_length(pickup_area) <= 160),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

-- ============================================================ authority helpers
-- security definer so policies can read memberships without recursive RLS.
-- An anonymous identity only ever counts as a member of a demo tenant (IAM-4).

create function private.member_role(p_tenant uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select m.role
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and t.lifecycle = 'active'
    and (t.is_demo or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
$$;

create function private.is_member(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.member_role(p_tenant) is not null $$;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.member_role(uuid), private.is_member(uuid) to authenticated;

-- ============================================================ contacts (PR-2, DATA-1)

create table public.contacts (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  phone text not null check (phone ~ '^\+?[0-9]{8,15}$'),
  is_sender boolean not null default false,
  is_recipient boolean not null default false,
  archived_at timestamptz,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  check (is_sender or is_recipient)
);
create index contacts_search_idx on public.contacts (tenant_id, lower(name)) where archived_at is null;

create table public.contact_addresses (
  tenant_id uuid not null,
  contact_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  label text check (char_length(label) <= 60),
  address_line text not null check (char_length(btrim(address_line)) between 5 and 500),
  area text not null check (char_length(btrim(area)) between 3 and 160),
  postal_code text check (postal_code ~ '^[0-9]{5}$'),
  is_primary boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade
);
create unique index contact_addresses_one_primary on public.contact_addresses (contact_id)
  where is_primary and archived_at is null;

-- ============================================================ shipments (PR-5, PR-7, DATA-2)
-- Party/pickup/parcel values are copied into the shipment (not joined from contacts) and become
-- immutable once submitted, so contact edits never rewrite history (PR-7).

create table public.shipments (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  outlet_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  reference text not null,
  revision integer not null default 1,
  submission_state text not null default 'draft'
    check (submission_state in ('draft', 'estimated', 'queued', 'in_flight', 'unknown', 'issued', 'failed')),
  payment_state text not null default 'not_applicable'
    check (payment_state in ('not_applicable', 'unpaid', 'paid')),
  delivery_state text not null default 'unobserved'
    check (delivery_state in ('unobserved', 'picked_up', 'in_transit', 'delivered', 'problem', 'returned')),
  -- draft content (editable only while draft/estimated)
  sender_contact_id uuid,
  sender_name text check (char_length(sender_name) <= 120),
  sender_phone text check (sender_phone ~ '^\+?[0-9]{8,15}$'),
  recipient_contact_id uuid,
  recipient_name text check (char_length(recipient_name) <= 120),
  recipient_phone text check (recipient_phone ~ '^\+?[0-9]{8,15}$'),
  recipient_address text check (char_length(recipient_address) <= 500),
  recipient_area text check (char_length(recipient_area) <= 160),
  recipient_postal_code text check (recipient_postal_code ~ '^[0-9]{5}$'),
  item_description text check (char_length(item_description) <= 200),
  weight_grams integer check (weight_grams between 1 and 50000),
  length_cm integer check (length_cm between 1 and 200),
  width_cm integer check (width_cm between 1 and 200),
  height_cm integer check (height_cm between 1 and 200),
  goods_value_idr bigint check (goods_value_idr between 0 and 100000000),
  -- frozen at confirmation
  pickup_snapshot jsonb,
  selected_quote_id uuid,
  customer_charge_idr bigint check (customer_charge_idr >= 0),
  awb text,
  is_simulated boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  issued_at timestamptz,
  primary key (tenant_id, id),
  unique (tenant_id, reference),
  foreign key (tenant_id, outlet_id) references public.outlets (tenant_id, id),
  foreign key (tenant_id, sender_contact_id) references public.contacts (tenant_id, id) on delete set null (sender_contact_id),
  foreign key (tenant_id, recipient_contact_id) references public.contacts (tenant_id, id) on delete set null (recipient_contact_id)
);
create index shipments_queue_idx on public.shipments (tenant_id, created_at desc);
create index shipments_state_idx on public.shipments (tenant_id, submission_state);

-- Customer-facing quote projection: normal tariff only (PR-22, DATA-5).
create table public.shipment_quotes (
  tenant_id uuid not null,
  shipment_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  shipment_revision integer not null,
  courier text not null,
  service text not null,
  normal_tariff_idr bigint not null check (normal_tariff_idr > 0),
  eta_days text not null,
  is_simulated boolean not null,
  quoted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade
);
create index shipment_quotes_lookup on public.shipment_quotes (tenant_id, shipment_id, shipment_revision);

alter table public.shipments
  add foreign key (tenant_id, selected_quote_id) references public.shipment_quotes (tenant_id, id);

-- Private seller net cost: never exposed to the Data API (DATA-5). Synthetic for demo.
-- No grants and RLS without policies: unreadable to every API role (defense in depth).
create table private.quote_costs (
  tenant_id uuid not null,
  quote_id uuid not null,
  net_shipping_idr bigint,          -- null = unknown, never assumed zero
  primary key (tenant_id, quote_id),
  foreign key (tenant_id, quote_id) references public.shipment_quotes (tenant_id, id) on delete cascade
);
alter table private.quote_costs enable row level security;

-- Durable provider operation; one per (tenant, idempotency key) (NFR-2, TD-3).
create table public.provider_operations (
  tenant_id uuid not null,
  shipment_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  kind text not null check (kind in ('create_order')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  input_digest text not null,
  state text not null check (state in ('queued', 'in_flight', 'unknown', 'succeeded', 'failed')),
  attempts integer not null default 0,
  result_code text,
  is_simulated boolean not null,
  actor uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade
);
create unique index provider_operations_one_create on public.provider_operations (tenant_id, shipment_id)
  where kind = 'create_order';

create table public.label_jobs (
  tenant_id uuid not null,
  shipment_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  state text not null check (state in ('pending', 'processing', 'completed', 'failed')),
  format text not null default 'a6',
  is_simulated boolean not null,
  requested_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade
);

create table public.shipment_events (
  tenant_id uuid not null,
  shipment_id uuid not null,
  id bigint generated always as identity,
  kind text not null,
  detail text check (char_length(detail) <= 300),
  actor uuid references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade
);
create index shipment_events_by_shipment on public.shipment_events (tenant_id, shipment_id, id);

-- ============================================================ revision / immutability triggers

create function private.touch_contact()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end $$;
create trigger contacts_touch before update on public.contacts
  for each row execute function private.touch_contact();

-- Any change to draft content invalidates quotes: back to draft, new revision (DATA-2 stale guard).
-- Content is immutable once submitted (PR-7); state columns move only through RPCs.
create function private.guard_shipment()
returns trigger language plpgsql set search_path = ''
as $$
declare
  content_changed boolean :=
    (new.sender_contact_id, new.sender_name, new.sender_phone, new.recipient_contact_id,
     new.recipient_name, new.recipient_phone, new.recipient_address, new.recipient_area,
     new.recipient_postal_code, new.item_description, new.weight_grams, new.length_cm,
     new.width_cm, new.height_cm, new.goods_value_idr)
    is distinct from
    (old.sender_contact_id, old.sender_name, old.sender_phone, old.recipient_contact_id,
     old.recipient_name, old.recipient_phone, old.recipient_address, old.recipient_area,
     old.recipient_postal_code, old.item_description, old.weight_grams, old.length_cm,
     old.width_cm, old.height_cm, old.goods_value_idr);
begin
  if new.tenant_id <> old.tenant_id or new.outlet_id <> old.outlet_id or new.reference <> old.reference then
    raise exception 'ownership_immutable' using errcode = '42501';
  end if;
  if content_changed then
    if old.submission_state not in ('draft', 'estimated') then
      raise exception 'shipment_locked' using errcode = '42501';
    end if;
    new.revision := old.revision + 1;
    new.submission_state := 'draft';
    new.selected_quote_id := null;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger shipments_guard before update on public.shipments
  for each row execute function private.guard_shipment();

-- ============================================================ grants and RLS
-- Supabase grants broad table privileges by default; replace them with explicit ones.

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.outlets enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_addresses enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_quotes enable row level security;
alter table public.provider_operations enable row level security;
alter table public.label_jobs enable row level security;
alter table public.shipment_events enable row level security;

grant select on public.tenants, public.outlets, public.shipment_quotes, public.provider_operations,
  public.label_jobs, public.shipment_events to authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update on public.contacts, public.contact_addresses to authenticated;
revoke insert, update on public.contacts, public.contact_addresses from authenticated;
grant insert (tenant_id, name, phone, is_sender, is_recipient),
  update (name, phone, is_sender, is_recipient) on public.contacts to authenticated;
grant insert (tenant_id, contact_id, label, address_line, area, postal_code, is_primary),
  update (label, address_line, area, postal_code, is_primary, archived_at) on public.contact_addresses to authenticated;
grant select on public.shipments to authenticated;
grant update (sender_contact_id, sender_name, sender_phone, recipient_contact_id, recipient_name,
  recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description,
  weight_grams, length_cm, width_cm, height_cm, goods_value_idr) on public.shipments to authenticated;

create policy tenants_member_read on public.tenants for select to authenticated
  using ((select private.is_member(id)));
create policy memberships_read on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or (select private.member_role(tenant_id)) = 'tenant_admin');
create policy outlets_member_read on public.outlets for select to authenticated
  using ((select private.is_member(tenant_id)));

create policy contacts_member_read on public.contacts for select to authenticated
  using ((select private.is_member(tenant_id)));
create policy contacts_member_insert on public.contacts for insert to authenticated
  with check ((select private.is_member(tenant_id)));
create policy contacts_member_update on public.contacts for update to authenticated
  using ((select private.is_member(tenant_id))) with check ((select private.is_member(tenant_id)));

create policy addresses_member_read on public.contact_addresses for select to authenticated
  using ((select private.is_member(tenant_id)));
create policy addresses_member_insert on public.contact_addresses for insert to authenticated
  with check ((select private.is_member(tenant_id)));
create policy addresses_member_update on public.contact_addresses for update to authenticated
  using ((select private.is_member(tenant_id))) with check ((select private.is_member(tenant_id)));

create policy shipments_member_read on public.shipments for select to authenticated
  using ((select private.is_member(tenant_id)));
create policy shipments_member_edit_draft on public.shipments for update to authenticated
  using ((select private.is_member(tenant_id)) and submission_state in ('draft', 'estimated'))
  with check ((select private.is_member(tenant_id)));

create policy quotes_member_read on public.shipment_quotes for select to authenticated
  using ((select private.is_member(tenant_id)));
create policy operations_member_read on public.provider_operations for select to authenticated
  using ((select private.is_member(tenant_id)));
create policy labels_member_read on public.label_jobs for select to authenticated
  using ((select private.is_member(tenant_id)));
create policy events_member_read on public.shipment_events for select to authenticated
  using ((select private.is_member(tenant_id)));

-- ============================================================ commands (RPC)
-- All commands: security definer, empty search_path, explicit membership check, row locks.
-- Errors use stable codes the Worker maps to Bahasa Indonesia messages.

create function private.require_member(p_tenant uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare r text := private.member_role(p_tenant);
begin
  if r is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return r;
end $$;

-- Resolve a shipment's tenant and check membership before taking any row lock, so outsiders
-- cannot lock another tenant's rows.
create function private.lock_member_shipment(p_shipment uuid)
returns public.shipments language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.shipments;
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  select * into s from public.shipments where tenant_id = v_tenant and id = p_shipment for update;
  return s;
end $$;

create function private.add_event(p_tenant uuid, p_shipment uuid, p_kind text, p_detail text)
returns void language sql security definer set search_path = ''
as $$
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor)
  values (p_tenant, p_shipment, p_kind, p_detail, (select auth.uid()));
$$;

create function private.new_reference()
returns text language sql volatile set search_path = ''
as $$
  select 'GX' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-'
    || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
$$;

create function public.create_shipment_draft(p_outlet uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.outlets where id = p_outlet;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  insert into public.shipments (tenant_id, outlet_id, reference, is_simulated)
  values (v_tenant, p_outlet, private.new_reference(),
          (select is_demo from public.tenants where id = v_tenant))
  returning id into v_id;
  perform private.add_event(v_tenant, v_id, 'draft_created', null);
  return v_id;
end $$;

-- Simulated tariff for demo tenants only (IAM-4). Real tenants have no connected provider yet,
-- so quoting fails closed rather than inventing prices (PR-4, PR-22).
create function private.simulated_tariffs(p_weight_grams integer, p_l integer, p_w integer, p_h integer)
returns table (courier text, service text, normal_tariff_idr bigint, net_shipping_idr bigint, eta_days text)
language sql immutable set search_path = ''
as $$
  with kg as (
    select greatest(1, ceil(greatest(p_weight_grams, coalesce(p_l * p_w * p_h, 0) / 6) / 1000.0))::bigint as v
  )
  select * from (values
    ('Kurir Simulasi', 'Hemat',   6000 + 7000 * (select v from kg), 5400 + 6300 * (select v from kg), '3–5 hari'),
    ('Kurir Simulasi', 'Reguler', 9000 + 9000 * (select v from kg), 8100 + 8100 * (select v from kg), '2–3 hari'),
    ('Kurir Simulasi', 'Kilat',  15000 + 14000 * (select v from kg), 13500 + 12600 * (select v from kg), '1 hari')
  ) as t(courier, service, normal_tariff_idr, net_shipping_idr, eta_days)
$$;

create function public.request_quotes(p_shipment uuid, p_expected_revision integer)
returns setof public.shipment_quotes language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  t public.tenants;
  q record;
  v_quote uuid;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state not in ('draft', 'estimated') then
    raise exception 'shipment_locked' using errcode = '42501';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;
  if s.sender_name is null or s.sender_phone is null or s.recipient_name is null
     or s.recipient_phone is null or s.recipient_address is null or s.recipient_area is null
     or s.weight_grams is null or s.item_description is null then
    raise exception 'incomplete_draft' using errcode = '22023';
  end if;
  select * into t from public.tenants where id = s.tenant_id;
  if not t.is_demo then
    raise exception 'provider_not_connected' using errcode = '55000';
  end if;

  for q in select * from private.simulated_tariffs(s.weight_grams, s.length_cm, s.width_cm, s.height_cm) loop
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, eta_days, is_simulated, expires_at)
    values (s.tenant_id, s.id, s.revision, q.courier, q.service, q.normal_tariff_idr, q.eta_days, true,
      now() + interval '30 minutes')
    returning id into v_quote;
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr)
    values (s.tenant_id, v_quote, q.net_shipping_idr);
  end loop;

  update public.shipments set submission_state = 'estimated', updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'quoted', 'Estimasi simulasi');
  return query select * from public.shipment_quotes
    where tenant_id = s.tenant_id and shipment_id = s.id and shipment_revision = s.revision
    order by normal_tariff_idr;
end $$;

-- Explicit confirmation: one durable create_order operation per idempotency key and per shipment.
-- A replay returns the original operation; it never creates a second order (NFR-2).
create function public.confirm_shipment(p_shipment uuid, p_quote uuid, p_expected_revision integer,
  p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  q public.shipment_quotes;
  o public.outlets;
  op public.provider_operations;
  v_awb text;
  v_digest text;
begin
  s := private.lock_member_shipment(p_shipment);
  v_digest := md5(row(s.sender_name, s.sender_phone, s.recipient_name, s.recipient_phone, s.recipient_address,
    s.recipient_area, s.recipient_postal_code, s.item_description, s.weight_grams, s.length_cm, s.width_cm,
    s.height_cm, s.goods_value_idr, p_quote)::text);

  select * into op from public.provider_operations
    where tenant_id = s.tenant_id and (idempotency_key = p_idempotency_key
      or (shipment_id = s.id and kind = 'create_order'))
    order by (idempotency_key = p_idempotency_key) desc limit 1;
  if found then
    if op.shipment_id <> s.id
       or (op.idempotency_key = p_idempotency_key and op.input_digest <> v_digest) then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('operation_id', op.id, 'state', op.state, 'awb', s.awb, 'replayed', true);
  end if;

  if s.submission_state <> 'estimated' then
    raise exception 'not_estimated' using errcode = '55000';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;
  select * into q from public.shipment_quotes
    where id = p_quote and tenant_id = s.tenant_id and shipment_id = s.id;
  if not found or q.shipment_revision <> s.revision then
    raise exception 'stale_quote' using errcode = '40001';
  end if;
  if q.expires_at <= now() then
    raise exception 'quote_expired' using errcode = '40001';
  end if;
  if not s.is_simulated or not q.is_simulated then
    raise exception 'provider_not_connected' using errcode = '55000';
  end if;
  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id;

  begin
    insert into public.provider_operations (tenant_id, shipment_id, kind, idempotency_key, input_digest,
      state, is_simulated, actor)
    values (s.tenant_id, s.id, 'create_order', p_idempotency_key, v_digest, 'queued', true, (select auth.uid()))
    returning * into op;
  exception when unique_violation then
    raise exception 'idempotency_conflict' using errcode = '23505';
  end;

  update public.shipments set
    submission_state = 'queued',
    selected_quote_id = q.id,
    customer_charge_idr = q.normal_tariff_idr,
    pickup_snapshot = jsonb_build_object('outlet', o.name, 'address', o.pickup_address, 'area', o.pickup_area),
    submitted_at = now(),
    updated_at = now()
  where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'submitted', q.courier || ' ' || q.service);

  -- Simulated dispatch: the demo "provider" accepts immediately. Real dispatch is a separate
  -- durable executor (TD-3) and is not implemented in this slice.
  v_awb := 'SIM' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')
    || lpad((floor(random() * 1000000))::int::text, 6, '0');
  update public.provider_operations set state = 'succeeded', attempts = 1, result_code = 'SIMULATED_OK',
    updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = v_awb,
    issued_at = now(), updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'issued', 'Resi simulasi ' || v_awb);

  return jsonb_build_object('operation_id', op.id, 'state', 'succeeded', 'awb', v_awb, 'replayed', false);
end $$;

-- Recovery of an unknown outcome reconciles the original operation; it never creates another.
create function public.reconcile_shipment(p_shipment uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  op public.provider_operations;
  v_awb text;
begin
  s := private.lock_member_shipment(p_shipment);
  select * into op from public.provider_operations
    where tenant_id = s.tenant_id and shipment_id = s.id and kind = 'create_order' for update;
  if not found or op.state not in ('unknown', 'in_flight', 'queued') then
    raise exception 'nothing_to_reconcile' using errcode = '55000';
  end if;
  if not op.is_simulated then
    raise exception 'provider_not_connected' using errcode = '55000';
  end if;
  v_awb := coalesce(s.awb, 'SIM' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')
    || lpad((floor(random() * 1000000))::int::text, 6, '0'));
  update public.provider_operations set state = 'succeeded', attempts = attempts + 1,
    result_code = 'SIMULATED_RECONCILED', updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = v_awb,
    issued_at = coalesce(issued_at, now()), updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'reconciled', 'Operasi asli ditemukan: ' || v_awb);
  return jsonb_build_object('operation_id', op.id, 'awb', v_awb);
end $$;

-- Label request reuses an existing completed job instead of generating again (TD-4 pattern).
create function public.request_label(p_shipment uuid)
returns public.label_jobs language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  j public.label_jobs;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state <> 'issued' or s.awb is null then
    raise exception 'no_awb' using errcode = '55000';
  end if;
  select * into j from public.label_jobs
    where tenant_id = s.tenant_id and shipment_id = s.id and state = 'completed'
    order by created_at desc limit 1;
  if found then return j; end if;
  insert into public.label_jobs (tenant_id, shipment_id, state, is_simulated, requested_by)
  values (s.tenant_id, s.id, 'completed', s.is_simulated, (select auth.uid()))
  returning * into j;
  perform private.add_event(s.tenant_id, s.id, 'label_ready',
    case when s.is_simulated then 'Label contoh (bukan label kurir)' else null end);
  return j;
end $$;

-- ============================================================ demo workspace (PR-21, IAM-4, UX-3)
-- Each anonymous visitor gets an isolated demo tenant, so one visitor never sees another's input.

create function private.seed_demo(p_tenant uuid, p_outlet uuid, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c_budi uuid; c_sari uuid; c_toko uuid; c_rina uuid;
  sh uuid;
begin
  insert into public.contacts (tenant_id, name, phone, is_sender, is_recipient)
    values (p_tenant, 'Budi Santoso (contoh)', '081200000001', true, false) returning id into c_budi;
  insert into public.contacts (tenant_id, name, phone, is_sender, is_recipient)
    values (p_tenant, 'Toko Kain Melati (contoh)', '081200000002', true, true) returning id into c_toko;
  insert into public.contacts (tenant_id, name, phone, is_sender, is_recipient)
    values (p_tenant, 'Sari Wulandari (contoh)', '081200000003', false, true) returning id into c_sari;
  insert into public.contacts (tenant_id, name, phone, is_sender, is_recipient)
    values (p_tenant, 'Rina Kartikasari Purnamasari Wijayakusuma (contoh)', '081200000004', false, true)
    returning id into c_rina;

  insert into public.contact_addresses (tenant_id, contact_id, label, address_line, area, postal_code, is_primary) values
    (p_tenant, c_budi, 'Rumah', 'Jl. Contoh Melati No. 1', 'Kec. Coblong, Kota Bandung', '40132', true),
    (p_tenant, c_toko, 'Toko', 'Ruko Contoh Blok B-7', 'Kec. Tanah Abang, Jakarta Pusat', '10250', true),
    (p_tenant, c_sari, 'Rumah', 'Perumahan Contoh Asri Blok C2 No. 14', 'Kec. Sukolilo, Kota Surabaya', '60111', true),
    (p_tenant, c_sari, 'Kantor', 'Gedung Contoh Lt. 3', 'Kec. Genteng, Kota Surabaya', '60275', false),
    (p_tenant, c_rina, 'Rumah', 'Jl. Contoh Panjang Sekali Untuk Menguji Tampilan Alamat No. 123 RT 004 RW 009',
      'Kec. Mlati, Kab. Sleman, DI Yogyakarta', '55284', true);

  -- Issued example
  insert into public.shipments (tenant_id, outlet_id, reference, created_by, is_simulated, sender_contact_id,
    sender_name, sender_phone, recipient_contact_id, recipient_name, recipient_phone, recipient_address,
    recipient_area, recipient_postal_code, item_description, weight_grams, goods_value_idr,
    submission_state, payment_state, customer_charge_idr, awb, submitted_at, issued_at, pickup_snapshot)
  values (p_tenant, p_outlet, private.new_reference(), p_user, true, c_budi, 'Budi Santoso (contoh)', '081200000001',
    c_sari, 'Sari Wulandari (contoh)', '081200000003', 'Perumahan Contoh Asri Blok C2 No. 14',
    'Kec. Sukolilo, Kota Surabaya', '60111', 'Pakaian (contoh)', 1200, 150000,
    'issued', 'paid', 27000, 'SIM000000000001', now() - interval '3 hours', now() - interval '3 hours',
    (select jsonb_build_object('outlet', name, 'address', pickup_address, 'area', pickup_area) from public.outlets where id = p_outlet))
  returning id into sh;
  insert into public.provider_operations (tenant_id, shipment_id, kind, idempotency_key, input_digest, state,
    attempts, result_code, is_simulated, actor)
  values (p_tenant, sh, 'create_order', 'seed-' || sh, 'seed', 'succeeded', 1, 'SIMULATED_OK', true, p_user);
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor) values
    (p_tenant, sh, 'submitted', 'Kurir Simulasi Reguler', p_user),
    (p_tenant, sh, 'issued', 'Resi simulasi SIM000000000001', p_user);

  -- Unknown-outcome example (recovery path)
  insert into public.shipments (tenant_id, outlet_id, reference, created_by, is_simulated, sender_contact_id,
    sender_name, sender_phone, recipient_contact_id, recipient_name, recipient_phone, recipient_address,
    recipient_area, recipient_postal_code, item_description, weight_grams, goods_value_idr,
    submission_state, customer_charge_idr, submitted_at, pickup_snapshot)
  values (p_tenant, p_outlet, private.new_reference(), p_user, true, c_toko, 'Toko Kain Melati (contoh)', '081200000002',
    c_rina, 'Rina Kartikasari Purnamasari Wijayakusuma (contoh)', '081200000004',
    'Jl. Contoh Panjang Sekali Untuk Menguji Tampilan Alamat No. 123 RT 004 RW 009',
    'Kec. Mlati, Kab. Sleman, DI Yogyakarta', '55284', 'Kain batik (contoh)', 2500, 450000,
    'unknown', 36000, now() - interval '40 minutes',
    (select jsonb_build_object('outlet', name, 'address', pickup_address, 'area', pickup_area) from public.outlets where id = p_outlet))
  returning id into sh;
  insert into public.provider_operations (tenant_id, shipment_id, kind, idempotency_key, input_digest, state,
    attempts, result_code, is_simulated, actor)
  values (p_tenant, sh, 'create_order', 'seed-' || sh, 'seed', 'unknown', 1, 'SIMULATED_TIMEOUT', true, p_user);
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor) values
    (p_tenant, sh, 'submitted', 'Kurir Simulasi Reguler', p_user),
    (p_tenant, sh, 'outcome_unknown', 'Batas waktu simulasi; jangan buat ulang, lakukan rekonsiliasi', p_user);

  -- Draft example
  insert into public.shipments (tenant_id, outlet_id, reference, created_by, is_simulated, sender_contact_id,
    sender_name, sender_phone, item_description, weight_grams)
  values (p_tenant, p_outlet, private.new_reference(), p_user, true, c_budi, 'Budi Santoso (contoh)',
    '081200000001', 'Dokumen (contoh)', 300)
  returning id into sh;
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor)
    values (p_tenant, sh, 'draft_created', null, p_user);
end $$;

create function public.start_demo()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_tenant uuid;
  v_outlet uuid;
begin
  if v_user is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false then
    raise exception 'demo_requires_anonymous_session' using errcode = '42501';
  end if;
  select m.tenant_id into v_tenant from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = v_user and t.is_demo limit 1;
  if v_tenant is not null then return v_tenant; end if;

  insert into public.tenants (name, lifecycle, is_demo)
    values ('Gerai Contoh Sentosa', 'active', true) returning id into v_tenant;
  insert into public.outlets (tenant_id, name, pickup_address, pickup_area)
    values (v_tenant, 'Outlet Contoh Dago', 'Jl. Contoh Dago No. 10', 'Kec. Coblong, Kota Bandung')
    returning id into v_outlet;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant, v_user, 'operator');
  perform private.seed_demo(v_tenant, v_outlet, v_user);
  return v_tenant;
end $$;

create function public.reset_demo()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_tenant uuid;
  v_outlet uuid;
begin
  if v_user is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false then
    raise exception 'demo_requires_anonymous_session' using errcode = '42501';
  end if;
  select m.tenant_id into v_tenant from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = v_user and t.is_demo and m.status = 'active' and t.lifecycle = 'active' limit 1;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  delete from public.shipments where tenant_id = v_tenant;
  delete from public.contacts where tenant_id = v_tenant;
  select id into v_outlet from public.outlets where tenant_id = v_tenant order by created_at limit 1;
  perform private.seed_demo(v_tenant, v_outlet, v_user);
  return v_tenant;
end $$;

revoke all on function public.create_shipment_draft(uuid), public.request_quotes(uuid, integer),
  public.confirm_shipment(uuid, uuid, integer, text), public.reconcile_shipment(uuid),
  public.request_label(uuid), public.start_demo(), public.reset_demo() from public, anon;
grant execute on function public.create_shipment_draft(uuid), public.request_quotes(uuid, integer),
  public.confirm_shipment(uuid, uuid, integer, text), public.reconcile_shipment(uuid),
  public.request_label(uuid), public.start_demo(), public.reset_demo() to authenticated;

-- ============================================================ final privilege sweep
-- Private schema: no direct table access for API roles; only the two policy helpers are executable.
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.member_role(uuid), private.is_member(uuid) to authenticated;
