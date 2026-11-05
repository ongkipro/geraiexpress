-- T-085 / DATA-12 / SEC-8. Only the opaque token's SHA-256 is stored. link_id is the
-- stable HMAC input for one sharing generation; revocation + share allocates a new link_id.
create table public.tracking_links (
  tenant_id uuid not null,
  shipment_id uuid not null,
  link_id uuid not null default gen_random_uuid() unique,
  token_hash text unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  shared_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  -- T-045 will set this from authoritative delivery/return timestamps. No invented expiry.
  expires_at timestamptz,
  primary key (tenant_id, shipment_id),
  foreign key (tenant_id, shipment_id) references public.shipments(tenant_id, id) on delete cascade
);
alter table public.tracking_links enable row level security;
revoke all on public.tracking_links from public, anon, authenticated, service_role;
grant select on public.tracking_links to authenticated;
create policy tracking_links_member_read on public.tracking_links for select to authenticated
  using ((select private.is_member(tenant_id)));

-- Every token hash ever published, kept after revocation/renewal so a direct RPC caller can never
-- republish a revoked token under a later generation (the server derives the hash, but the RPC is
-- also reachable directly by members). Private: no API role reads or writes it.
create table private.tracking_token_hashes (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid not null,
  shipment_id uuid not null,
  retired_at timestamptz,
  foreign key (tenant_id, shipment_id) references public.shipments(tenant_id, id) on delete cascade
);
alter table private.tracking_token_hashes enable row level security;
revoke all on private.tracking_token_hashes from public, anon, authenticated, service_role;

-- The shipment lock serializes prepare/publish/revoke, including the initially absent link.
-- Preparing does not activate a link: publication must name this exact generation.
create function public.prepare_tracking_link(p_shipment uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare s public.shipments; v public.tracking_links;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.is_simulated or s.submission_state <> 'issued' or s.awb is null then
    raise exception 'no_awb' using errcode = '55000';
  end if;
  select * into v from public.tracking_links where tenant_id = s.tenant_id and shipment_id = s.id;
  if not found then
    insert into public.tracking_links(tenant_id, shipment_id, created_by)
      values (s.tenant_id, s.id, (select auth.uid())) returning * into v;
    perform private.audit('tracking.create', s.tenant_id, null, null, 'prepared', jsonb_build_object('shipment', s.id));
  elsif v.revoked_at is not null or v.expires_at <= now() then
    update private.tracking_token_hashes set retired_at = coalesce(retired_at, now())
      where token_hash = v.token_hash;
    update public.tracking_links set link_id = gen_random_uuid(), token_hash = null,
      created_by = (select auth.uid()), created_at = now(), shared_at = null,
      revoked_at = null, revoked_by = null, expires_at = null
      where tenant_id = s.tenant_id and shipment_id = s.id returning * into v;
    perform private.audit('tracking.create', s.tenant_id, null, null, 'renewed', jsonb_build_object('shipment', s.id));
  end if;
  return v.link_id;
end $$;

create function public.publish_tracking_link(p_shipment uuid, p_link uuid, p_hash text)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.shipments; v public.tracking_links;
begin
  s := private.lock_member_shipment(p_shipment);
  select * into v from public.tracking_links where tenant_id = s.tenant_id and shipment_id = s.id;
  if not found or v.link_id <> p_link or v.revoked_at is not null or v.expires_at <= now() then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  if s.is_simulated or s.submission_state <> 'issued' or s.awb is null then
    raise exception 'no_awb' using errcode = '55000';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
  -- A changed derivation secret must not silently replace an existing link. Revoke first.
  if v.token_hash is not null and v.token_hash <> p_hash then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  if v.shared_at is null then
    -- Reserve the hash atomically BEFORE activating the link: the primary key serializes every
    -- publisher of the same hash, and the committed owner row is locked and validated, so a hash
    -- retired (or owned by another shipment) at any time can never be activated here.
    insert into private.tracking_token_hashes(token_hash, tenant_id, shipment_id)
      values (p_hash, s.tenant_id, s.id) on conflict (token_hash) do nothing;
    perform 1 from private.tracking_token_hashes h where h.token_hash = p_hash
      and h.retired_at is null and h.shipment_id = s.id and h.tenant_id = s.tenant_id for update;
    if not found then raise exception 'stale_state' using errcode = '55000'; end if;
    update public.tracking_links set token_hash = p_hash, shared_at = now()
      where tenant_id = s.tenant_id and shipment_id = s.id;
    perform private.audit('tracking.share', s.tenant_id, null, null, 'ready', jsonb_build_object('shipment', s.id));
  end if;
end $$;

create function public.revoke_tracking_link(p_shipment uuid, p_link uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.shipments;
begin
  select * into s from public.shipments where id = p_shipment;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_tenant_admin_locked(s.tenant_id);
  perform 1 from public.shipments where id = s.id for update;
  update public.tracking_links set revoked_at = now(), revoked_by = (select auth.uid())
    where tenant_id = s.tenant_id and shipment_id = s.id and link_id = p_link and revoked_at is null;
  if found then
    update private.tracking_token_hashes h set retired_at = coalesce(h.retired_at, now())
      from public.tracking_links t where t.tenant_id = s.tenant_id and t.shipment_id = s.id and h.token_hash = t.token_hash;
    perform private.audit('tracking.revoke', s.tenant_id, null, null, 'revoked', jsonb_build_object('shipment', s.id));
  elsif not exists (select 1 from public.tracking_links where tenant_id = s.tenant_id
      and shipment_id = s.id and link_id = p_link and revoked_at is not null) then
    -- Idempotent for the same revoked generation, never falsely report a newer one as revoked.
    raise exception 'stale_state' using errcode = '55000';
  end if;
end $$;

-- Initials always end in a dot, even for a single-character name. No full word is returned.
create function private.tracking_initials(value text)
returns text language sql immutable set search_path = ''
as $$
  select string_agg(upper(left(word, 1)) || '.', ' ' order by n)
    from regexp_split_to_table(btrim(value), '\s+') with ordinality as parts(word, n)
    where word <> '' and n <= 3
$$;

-- The ONLY anonymous shipment read. A fixed JSON object, never row_to_json(s), event detail,
-- free-text address/area, pickup identity, money, provider payload or logo bytes.
-- All invalid inputs take the same indexed hash lookup; no shipment identifier is accepted.
create function public.track_shipment(token text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'gerai_label', case when l.mask_sender = false then l.true_tenant_name end,
    'courier', q.courier, 'service', q.service, 'awb', s.awb,
    'status_label', 'Status belum tersedia', 'timeline', '[]'::jsonb,
    'destination_city', a.city,
    'sender_initials', private.tracking_initials(l.printed_sender_name),
    'recipient_initials', private.tracking_initials(s.recipient_name),
    'created_at', s.created_at, 'issued_at', s.issued_at)
  from public.tracking_links t
  join public.shipments s on s.tenant_id = t.tenant_id and s.id = t.shipment_id
  left join public.shipment_quotes q on q.tenant_id = s.tenant_id and q.id = s.selected_quote_id
  left join public.mengantar_areas a on a.id = s.recipient_area_id
  left join lateral (
    select x.mask_sender, x.printed_sender_name, x.true_tenant_name
      from public.label_snapshots x where x.tenant_id = s.tenant_id and x.shipment_id = s.id
      order by x.version desc limit 1
  ) l on true
  where t.token_hash = encode(extensions.digest(convert_to(
      case when token ~ '^[A-Za-z0-9_-]{43}$' then token else '' end, 'utf8'), 'sha256'), 'hex')
    -- The '' stand-in keeps one indexed lookup for every input; this predicate makes it unmatchable.
    and coalesce(token, '') ~ '^[A-Za-z0-9_-]{43}$'
    and t.shared_at is not null and t.revoked_at is null and (t.expires_at is null or t.expires_at > now())
    and not s.is_simulated and s.submission_state = 'issued' and s.awb is not null
$$;

revoke all on function private.tracking_initials(text),
  public.prepare_tracking_link(uuid), public.publish_tracking_link(uuid, uuid, text),
  public.revoke_tracking_link(uuid, uuid), public.track_shipment(text) from public, anon, authenticated, service_role;
grant execute on function public.prepare_tracking_link(uuid), public.publish_tracking_link(uuid, uuid, text),
  public.revoke_tracking_link(uuid, uuid) to authenticated;
grant execute on function public.track_shipment(text) to anon;
notify pgrst, 'reload schema';
