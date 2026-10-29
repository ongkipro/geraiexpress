-- T-044 (PR-6, PR-34, DATA-10, TD-13, UX-9; DEC-017, DEC-018 item 3): the masked local label.
--
-- 1. Tenant-level gerai WhatsApp `contact_whatsapp` (canonical `0` + national number), initialized
--    at approval from the application's business contact phone, backfilled for existing tenants,
--    changed only by a tenant administrator through an audited command (never by a column write).
-- 2. The tenant flag `masking_allowed` (default true), changed only by the platform.
-- 3. Immutable label snapshots and an append-only print history, written only by reviewed commands.
--    Nothing here calls Mengantar: no provider dropshipper and no provider label request (DEC-017).

-- ============================================================ tenant columns

alter table public.tenants
  add column contact_whatsapp text,
  add column contact_whatsapp_revision integer not null default 0,
  add column masking_allowed boolean not null default true,
  add constraint tenants_contact_whatsapp_format
    check (contact_whatsapp is null or contact_whatsapp ~ '^0[2-9][0-9]{7,11}$');
-- tenants carries only a table-level SELECT grant (foundation): neither column can be written
-- through the Data API; contact_whatsapp changes through set_tenant_contact_whatsapp and
-- masking_allowed through platform_set_masking_allowed below.

-- Canonical form of an Indonesian number: separators removed, a leading +62 or 62 becomes 0, and the
-- result must match ^0[2-9][0-9]{7,11}$. NULL when it does not validate (the caller decides what a
-- refusal means), so an invalid value can never be stored in place of the canonical one.
create function private.normalize_whatsapp(p text)
returns text language sql immutable set search_path = ''
as $$
  select case when y.c ~ '^0[2-9][0-9]{7,11}$' then y.c end
  from (
    select case
        when x.s like '+62%' then '0' || substr(x.s, 4)
        when x.s like '62%' then '0' || substr(x.s, 3)
        else x.s end as c
    from (select regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g') as s) x
  ) y
$$;

-- A phone typed by the operator for the masked sender: separators removed, digits with an optional
-- leading +, the same shape the contact and shipment phones use. NULL when it does not validate.
create function private.clean_sender_phone(p text)
returns text language sql immutable set search_path = ''
as $$
  select case when x.s ~ '^\+?[0-9]{8,15}$' then x.s end
  from (select regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g') as s) x
$$;

-- ============================================================ approval and backfill

-- Identical to the registration migration's function except that the tenant starts with the
-- normalized application phone as its gerai WhatsApp (left empty when it does not validate). The
-- slug and shipment prefix come from the tenants_identity trigger (T-049), untouched here.
create or replace function public.platform_review_application(p_id uuid, p_expected_revision integer,
  p_decision text, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  a public.tenant_applications;
  v_tenant uuid;
begin
  perform private.require_platform('tenant_governance');
  perform 1 from public.platform_grants where user_id = (select auth.uid()) for share;
  perform private.require_platform('tenant_governance');
  v_reason := private.require_reason(p_reason);
  if p_decision not in ('approve', 'reject', 'request_changes') then
    raise exception 'transition_not_allowed' using errcode = '55000';
  end if;
  select * into a from public.tenant_applications t where t.id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status <> 'submitted' then raise exception 'stale_state' using errcode = '55000'; end if;
  if a.revision <> p_expected_revision then raise exception 'stale_state' using errcode = '55000'; end if;
  -- Separation of duties: nobody decides their own application.
  if a.applicant = (select auth.uid()) then raise exception 'own_application' using errcode = '42501'; end if;

  if p_decision = 'approve' then
    insert into public.tenants (name, lifecycle, contact_whatsapp)
      values (a.business_name, 'active', private.normalize_whatsapp(a.contact_phone)) returning id into v_tenant;
    insert into public.outlets (tenant_id, name, pickup_address, pickup_area)
      values (v_tenant, a.outlet_name, a.pickup_address, a.pickup_area);
    insert into public.memberships (tenant_id, user_id, role) values (v_tenant, a.applicant, 'tenant_admin');
  end if;
  update public.tenant_applications t set
    status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end,
    review_reason = v_reason, reviewed_by = (select auth.uid()), reviewed_at = now(),
    tenant_id = v_tenant, revision = t.revision + 1, updated_at = now()
  where t.id = a.id;
  perform private.audit('application.review', v_tenant, a.applicant, v_reason, p_decision,
    jsonb_build_object('application', a.id, 'revision', a.revision));
  return v_tenant;
end $$;

-- Existing approved tenants take the value from their latest approved application, only where it
-- validates; otherwise they stay empty until a tenant administrator fills the field.
update public.tenants t set contact_whatsapp = n.value
from (
  select distinct on (a.tenant_id) a.tenant_id, private.normalize_whatsapp(a.contact_phone) as value
  from public.tenant_applications a
  where a.tenant_id is not null and a.status = 'approved'
  order by a.tenant_id, a.reviewed_at desc nulls last, a.created_at desc
) n
where t.id = n.tenant_id and n.value is not null and t.contact_whatsapp is null;

-- ============================================================ tenant commands

-- Tenant administrator only (operators, outsiders and demo tenants are refused). p_expected_revision
-- is the revision the administrator saw (the stale guard the other tenant settings use); NULL skips
-- it. Returns the canonical stored value. The audit row carries no full number.
create function public.set_tenant_contact_whatsapp(p_tenant uuid, p_value text,
  p_expected_revision integer default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  t public.tenants;
  v_new text;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  v_new := private.normalize_whatsapp(p_value);
  if v_new is null then raise exception 'invalid_whatsapp' using errcode = '22023'; end if;
  select * into t from public.tenants where id = p_tenant for update;
  if p_expected_revision is not null and p_expected_revision <> t.contact_whatsapp_revision then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  if t.contact_whatsapp is distinct from v_new then
    update public.tenants set contact_whatsapp = v_new,
      contact_whatsapp_revision = t.contact_whatsapp_revision + 1 where id = p_tenant;
    perform private.audit('tenant.contact_whatsapp', p_tenant, null, null,
      case when t.contact_whatsapp is null then 'set' else 'changed' end,
      jsonb_build_object('revision', t.contact_whatsapp_revision + 1, 'hint', right(v_new, 3)));
  end if;
  return v_new;
end $$;

-- Platform control (DEC-018 item 3): allow or disable masking for one real tenant. Same capability,
-- reason and audit pattern as the lifecycle command. Existing snapshots are never rewritten.
create function public.platform_set_masking_allowed(p_tenant uuid, p_allowed boolean, p_reason text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_current boolean;
begin
  perform private.require_platform('tenant_governance');
  perform 1 from public.platform_grants where user_id = (select auth.uid()) for share;
  perform private.require_platform('tenant_governance');
  v_reason := private.require_reason(p_reason);
  if p_allowed is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  select masking_allowed into v_current from public.tenants where id = p_tenant and not is_demo for update;
  if v_current is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_current <> p_allowed then
    update public.tenants set masking_allowed = p_allowed where id = p_tenant;
    perform private.audit('tenant.masking', p_tenant, null, v_reason,
      case when p_allowed then 'allowed' else 'disabled' end,
      jsonb_build_object('from', v_current, 'to', p_allowed));
  end if;
  return p_allowed;
end $$;

-- ============================================================ label snapshots and print history (DATA-10)

create table public.label_snapshots (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  shipment_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  version integer not null check (version > 0),
  size text not null check (size in ('10x15', '10x10')),
  template_version integer not null default 1,
  mask_sender boolean not null,
  -- What the label shows as the sender. Masking off: the gerai name, its WhatsApp and the pickup
  -- address and area. Masking on: the operator-entered name, phone and city (no address).
  printed_sender_name text not null check (char_length(printed_sender_name) between 2 and 120),
  printed_sender_phone text not null check (printed_sender_phone ~ '^\+?[0-9]{8,15}$'),
  printed_sender_address text check (char_length(printed_sender_address) <= 500),
  printed_sender_city text check (char_length(printed_sender_city) <= 160),
  -- The true tenant and pickup identity, stored next to the printed sender whether or not masking is
  -- on (DEC-018 item 3). The pickup comes from the shipment's frozen pickup snapshot.
  true_tenant_name text not null,
  true_tenant_slug text not null,
  true_pickup_name text,
  true_pickup_address text,
  true_pickup_area text,
  awb text not null check (awb ~ '^[A-Za-z0-9-]{6,40}$'),
  shipment_reference text not null,
  courier text,
  service text,
  weight_grams integer check (weight_grams > 0),
  is_cod boolean not null,
  cod_amount_idr bigint check (cod_amount_idr >= 0),
  item_description text,
  recipient_name text,
  recipient_phone text,
  recipient_address text,
  recipient_area text,
  recipient_postal_code text,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, shipment_id, version),
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade,
  check (not mask_sender or printed_sender_address is null)
);

create table public.label_print_events (
  tenant_id uuid not null,
  id bigint generated always as identity,
  shipment_id uuid not null,
  snapshot_id uuid not null,
  size text not null check (size in ('10x15', '10x10')),
  actor uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, snapshot_id) references public.label_snapshots (tenant_id, id) on delete cascade
);
create index label_print_events_by_shipment on public.label_print_events (tenant_id, shipment_id, id desc);

-- No UPDATE, no direct DELETE and no TRUNCATE for any role. A DELETE that runs inside another trigger
-- (the foreign-key cascade of a purged shipment or tenant) is the one allowed removal: a direct
-- statement fires this trigger at depth 1, a cascade at depth 2 or more.
create function private.label_history_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'label_history_is_append_only' using errcode = '42501';
end $$;
create trigger label_snapshots_append_only before update or delete on public.label_snapshots
  for each row execute function private.label_history_guard();
create trigger label_snapshots_no_truncate before truncate on public.label_snapshots
  for each statement execute function private.label_history_guard();
create trigger label_print_events_append_only before update or delete on public.label_print_events
  for each row execute function private.label_history_guard();
create trigger label_print_events_no_truncate before truncate on public.label_print_events
  for each statement execute function private.label_history_guard();

alter table public.label_snapshots enable row level security;
alter table public.label_print_events enable row level security;
grant select on public.label_snapshots, public.label_print_events to authenticated;
create policy label_snapshots_member_read on public.label_snapshots for select to authenticated
  using ((select private.is_member(tenant_id)));
create policy label_print_events_member_read on public.label_print_events for select to authenticated
  using ((select private.is_member(tenant_id)));

-- ============================================================ label commands (TD-13)

-- Creates the snapshot a label is printed from, or returns the latest one when the operator's choice
-- is unchanged (same switch, size and, when masked, the same three sender fields): a reprint is a
-- print event on the same snapshot. Any member (operators print, DEC-008) of the shipment's tenant.
-- Real shipments with an authoritative AWB only; simulated shipments keep the watermarked sample.
create function public.create_label_snapshot(p_shipment uuid, p_mask boolean, p_size text default '10x15',
  p_sender_name text default null, p_sender_phone text default null, p_sender_city text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  t public.tenants;
  o public.outlets;
  q public.shipment_quotes;
  prev public.label_snapshots;
  v_name text;
  v_phone text;
  v_city text;
  v_pickup_name text;
  v_pickup_address text;
  v_pickup_area text;
  v_printed_name text;
  v_printed_phone text;
  v_printed_address text;
  v_printed_city text;
  v_content jsonb;
  v_id uuid;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.is_simulated then raise exception 'simulated_shipment' using errcode = '55000'; end if;
  if s.submission_state <> 'issued' or s.awb is null or s.awb !~ '^[A-Za-z0-9-]{6,40}$' then
    raise exception 'no_awb' using errcode = '55000';
  end if;
  if p_mask is null or p_size is null or p_size not in ('10x15', '10x10') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into t from public.tenants where id = s.tenant_id;

  if p_mask then
    if not t.masking_allowed then raise exception 'masking_disabled' using errcode = '42501'; end if;
    v_name := nullif(btrim(coalesce(p_sender_name, '')), '');
    v_city := nullif(btrim(coalesce(p_sender_city, '')), '');
    v_phone := private.clean_sender_phone(p_sender_phone);
    if v_name is null or v_city is null or nullif(btrim(coalesce(p_sender_phone, '')), '') is null then
      raise exception 'sender_fields_required' using errcode = '22023';
    end if;
    if char_length(v_name) not between 2 and 60 or char_length(v_city) not between 2 and 40
       or v_phone is null or v_name ~ '[[:cntrl:]]' or v_city ~ '[[:cntrl:]]' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  elsif t.contact_whatsapp is null then
    raise exception 'whatsapp_missing' using errcode = '55000';
  end if;

  select * into prev from public.label_snapshots
    where tenant_id = s.tenant_id and shipment_id = s.id order by version desc limit 1;
  if found and prev.mask_sender = p_mask and prev.size = p_size
     and (not p_mask or (prev.printed_sender_name = v_name and prev.printed_sender_phone = v_phone
                         and prev.printed_sender_city = v_city)) then
    return prev.id;
  end if;

  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id;
  v_pickup_name := coalesce(s.pickup_snapshot ->> 'outlet', o.name);
  v_pickup_address := coalesce(s.pickup_snapshot ->> 'address', o.pickup_address);
  v_pickup_area := coalesce(s.pickup_snapshot ->> 'area', o.pickup_area);
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;

  v_printed_name := case when p_mask then v_name else t.name end;
  v_printed_phone := case when p_mask then v_phone else t.contact_whatsapp end;
  v_printed_address := case when p_mask then null else v_pickup_address end;
  v_printed_city := case when p_mask then v_city else v_pickup_area end;

  v_content := jsonb_build_object(
    'template', 1, 'size', p_size, 'mask', p_mask,
    'sender', jsonb_build_array(v_printed_name, v_printed_phone, v_printed_address, v_printed_city),
    'true_identity', jsonb_build_array(t.name, t.slug, v_pickup_name, v_pickup_address, v_pickup_area),
    'awb', s.awb, 'reference', s.reference, 'courier', q.courier, 'service', q.service,
    'weight', s.weight_grams, 'cod', jsonb_build_array(s.is_cod, s.cod_amount_idr),
    'item', s.item_description,
    'recipient', jsonb_build_array(s.recipient_name, s.recipient_phone, s.recipient_address,
      s.recipient_area, s.recipient_postal_code));

  insert into public.label_snapshots (tenant_id, shipment_id, version, size, mask_sender,
    printed_sender_name, printed_sender_phone, printed_sender_address, printed_sender_city,
    true_tenant_name, true_tenant_slug, true_pickup_name, true_pickup_address, true_pickup_area,
    awb, shipment_reference, courier, service, weight_grams, is_cod, cod_amount_idr, item_description,
    recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code,
    content_digest, created_by)
  values (s.tenant_id, s.id, coalesce(prev.version, 0) + 1, p_size, p_mask,
    v_printed_name, v_printed_phone, v_printed_address, v_printed_city,
    t.name, t.slug, v_pickup_name, v_pickup_address, v_pickup_area,
    s.awb, s.reference, q.courier, q.service, s.weight_grams, s.is_cod, s.cod_amount_idr, s.item_description,
    s.recipient_name, s.recipient_phone, s.recipient_address, s.recipient_area, s.recipient_postal_code,
    encode(extensions.digest(convert_to(v_content::text, 'utf8'), 'sha256'), 'hex'), (select auth.uid()))
  returning id into v_id;
  -- No sender or recipient data in the audit detail; the snapshot row holds it.
  perform private.audit('label.snapshot', s.tenant_id, null, null,
    case when p_mask then 'masked' else 'gerai_identity' end,
    jsonb_build_object('shipment', s.id, 'snapshot', v_id, 'version', coalesce(prev.version, 0) + 1, 'size', p_size));
  return v_id;
end $$;

-- Appends one print request to the history of a snapshot. It records that a print was requested, not
-- that paper came out. A masked snapshot cannot be printed again once masking is disabled for the tenant.
create function public.record_label_print(p_snapshot uuid)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v public.label_snapshots;
  v_id bigint;
begin
  select * into v from public.label_snapshots where id = p_snapshot;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v.tenant_id);
  if v.mask_sender and not (select t.masking_allowed from public.tenants t where t.id = v.tenant_id) then
    raise exception 'masking_disabled' using errcode = '42501';
  end if;
  insert into public.label_print_events (tenant_id, shipment_id, snapshot_id, size, actor)
  values (v.tenant_id, v.shipment_id, v.id, v.size, (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

-- ============================================================ privileges

revoke all on function private.normalize_whatsapp(text), private.clean_sender_phone(text),
  private.label_history_guard() from public, anon, authenticated;
revoke all on function public.set_tenant_contact_whatsapp(uuid, text, integer),
  public.platform_set_masking_allowed(uuid, boolean, text),
  public.create_label_snapshot(uuid, boolean, text, text, text, text),
  public.record_label_print(uuid) from public, anon;
grant execute on function public.set_tenant_contact_whatsapp(uuid, text, integer),
  public.platform_set_masking_allowed(uuid, boolean, text),
  public.create_label_snapshot(uuid, boolean, text, text, text, text),
  public.record_label_print(uuid) to authenticated;
