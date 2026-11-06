-- T-045 slice 1 / ADR-0003: provider status ingestion (signed Mengantar webhook + status pull).
-- Forward-only. The webhook secret is stored like seller keys (ciphertext + iv + key_version, sealed by the app
-- with the CREDENTIAL key ring, bound to tenant + environment + version through the AAD). The database never sees
-- plaintext. Ingestion is idempotent and order-safe, and resolves shipments only inside the endpoint's tenant.

-- ============================================================ status mapping (fixed whitelist, ADR-0003 §2.7)

create function private.provider_status_kind(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case upper(btrim(coalesce(p_status, '')))
    when 'DELIVERED' then 'delivered'
    when 'RTS' then 'returned'
    when 'CANCELED' then 'cancelled'
    when 'CANCELLED' then 'cancelled'
    when 'UNDELIVERED' then 'problem'
    when 'PICKUP FAILED' then 'problem'
    when 'ERROR' then 'problem'
    when 'PENDING PICKUP' then 'awaiting_pickup'
    when 'ACTIVE/WAITING NEXT PROCESS' then 'awaiting_pickup'
    when 'PICKED UP' then 'in_transit'
    when 'ON DELIVERY' then 'in_transit'
    when 'DELIVERY COURIER' then 'in_transit'
    else 'unknown'  -- open-ended list (incl. a possible LOST): stored verbatim, never final
  end
$$;
revoke all on function private.provider_status_kind(text) from public, anon, authenticated, service_role;

-- ============================================================ per-tenant webhook endpoint and secret

create table private.webhook_endpoints (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider_env text not null check (provider_env in ('sandbox', 'production')),
  -- 32 random bytes, base64url without padding (43 chars). Selects the secret; never authenticates.
  endpoint_id text not null unique check (endpoint_id ~ '^[A-Za-z0-9_-]{43}$'),
  -- Sealed Webhook Secret (null until the tenant admin pastes it from Mengantar).
  ciphertext text check (char_length(ciphertext) between 16 and 4096),
  iv text check (char_length(iv) between 12 and 64),
  key_version text check (key_version ~ '^v[0-9]{1,4}$'),
  hint text check (hint ~ '^[!-~]{2,4}$'),
  secret_version integer not null default 0 check (secret_version >= 0),
  secret_set_at timestamptz,
  last_delivery_at timestamptz,
  last_mismatch_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, provider_env),
  -- All sealed fields together, and a version > 0 exactly when a secret is stored.
  check ((ciphertext is null) = (iv is null) and (ciphertext is null) = (key_version is null)
         and (ciphertext is null) = (hint is null) and (ciphertext is null) = (secret_set_at is null)
         and (ciphertext is null) = (secret_version = 0))
);
alter table private.webhook_endpoints enable row level security;
revoke all on private.webhook_endpoints from public, anon, authenticated, service_role;

-- ============================================================ structured provider events and shipment status

alter table public.shipment_events
  add column provider_status text check (char_length(provider_status) <= 60),
  add column provider_ts timestamptz,
  add column source text check (source in ('webhook', 'pull'));
-- Idempotency: one row per (shipment, provider timestamp, raw status) whichever channel reported it.
create unique index shipment_events_provider_dedupe on public.shipment_events (tenant_id, shipment_id, provider_ts, provider_status)
  where provider_ts is not null;

alter table public.shipments
  add column provider_status_kind text check (provider_status_kind in
    ('awaiting_pickup', 'in_transit', 'problem', 'delivered', 'returned', 'cancelled', 'unknown')),
  add column provider_status_at timestamptz,
  add column delivered_at timestamptz,
  add column returned_at timestamptz,
  -- When the status pull last read this shipment (whatever it found): candidates rotate by it, so an order
  -- that stays unchanged or keeps failing moves to the back instead of starving the rest (review P1).
  add column status_pulled_at timestamptz;

-- ============================================================ tenant admin: endpoint + secret (write-only)

-- Creates (once) the endpoint for this environment and returns its id plus whether a secret is stored.
-- The id is generated in SQL from the database's CSPRNG.
create function public.webhook_endpoint_status(p_tenant uuid, p_env text)
returns table (endpoint_id text, secret_configured boolean, hint text, secret_version integer,
  secret_set_at timestamptz, last_delivery_at timestamptz, last_mismatch_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_env(p_env);
  perform private.require_tenant_admin_locked(p_tenant);
  insert into private.webhook_endpoints (tenant_id, provider_env, endpoint_id)
    values (p_tenant, p_env, rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '='))
    on conflict (tenant_id, provider_env) do nothing;
  return query select w.endpoint_id, w.ciphertext is not null, w.hint, w.secret_version, w.secret_set_at,
      w.last_delivery_at, w.last_mismatch_at
    from private.webhook_endpoints w where w.tenant_id = p_tenant and w.provider_env = p_env;
end $$;

-- Stores a new sealed secret version (the app seals with AAD bound to tenant, environment and version).
create function public.store_webhook_secret(p_tenant uuid, p_env text, p_expected_version integer,
  p_ciphertext text, p_iv text, p_key_version text, p_hint text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_current integer;
begin
  perform private.require_provider_env(p_env);
  perform private.require_tenant_admin_locked(p_tenant);
  select w.secret_version into v_current from private.webhook_endpoints w
    where w.tenant_id = p_tenant and w.provider_env = p_env for update;
  if v_current is null then raise exception 'not_found' using errcode = '22023'; end if;
  if v_current <> coalesce(p_expected_version, -1) then raise exception 'stale_state' using errcode = '55000'; end if;
  if p_ciphertext is null or p_iv is null or p_key_version is null or p_hint is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update private.webhook_endpoints w set ciphertext = p_ciphertext, iv = p_iv, key_version = p_key_version,
      hint = p_hint, secret_version = v_current + 1, secret_set_at = now(), last_mismatch_at = null
    where w.tenant_id = p_tenant and w.provider_env = p_env;
  perform private.audit('webhook_secret.store', p_tenant, null, null, 'stored',
    jsonb_build_object('provider_env', p_env, 'version', v_current + 1, 'hint', p_hint));
  return v_current + 1;
end $$;

revoke all on function public.webhook_endpoint_status(uuid, text),
  public.store_webhook_secret(uuid, text, integer, text, text, text, text) from public, anon, service_role;
grant execute on function public.webhook_endpoint_status(uuid, text),
  public.store_webhook_secret(uuid, text, integer, text, text, text, text) to authenticated;

-- ============================================================ machine: webhook verification material

-- The sealed secret for an endpoint id (machine only). Returns nothing for an unknown id or no secret.
create function public.machine_webhook_secret(p_endpoint text)
returns table (tenant_id uuid, provider_env text, ciphertext text, iv text, key_version text, secret_version integer)
language sql stable security definer set search_path = '' as $$
  select w.tenant_id, w.provider_env, w.ciphertext, w.iv, w.key_version, w.secret_version
    from private.webhook_endpoints w
    where p_endpoint ~ '^[A-Za-z0-9_-]{43}$' and w.endpoint_id = p_endpoint and w.ciphertext is not null
$$;

-- A signature failure on a known endpoint (no body, no headers): makes a stale secret visible to the admin.
create function public.machine_webhook_mismatch(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  update private.webhook_endpoints w set last_mismatch_at = now()
    where p_endpoint ~ '^[A-Za-z0-9_-]{43}$' and w.endpoint_id = p_endpoint
$$;

-- ============================================================ machine: webhook secret rewrap (key ring rotation)

-- Endpoints of an environment whose secret is sealed under a key version below p_current_version (keyset).
create function public.machine_webhook_rewrap_candidates(p_env text, p_current_version text, p_after uuid, p_limit integer)
returns table (tenant_id uuid, ciphertext text, iv text, key_version text, secret_version integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_provider_env(p_env);
  if coalesce(p_current_version, '') !~ '^v[0-9]{1,4}$' or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return query select w.tenant_id, w.ciphertext, w.iv, w.key_version, w.secret_version
    from private.webhook_endpoints w
    where w.provider_env = p_env and w.ciphertext is not null
      and substr(w.key_version, 2)::integer < substr(p_current_version, 2)::integer
      and (p_after is null or w.tenant_id > p_after)
    order by w.tenant_id limit p_limit;
end $$;

-- Replaces the sealing of the SAME secret version (same AAD), fenced by the expected key version; never
-- downgrades. Returns false when the row moved on (concurrent store or rewrap): the caller counts a conflict.
create function public.rewrap_webhook_secret(p_tenant uuid, p_env text, p_secret_version integer,
  p_expected_key_version text, p_ciphertext text, p_iv text, p_new_key_version text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  perform private.require_provider_env(p_env);
  if coalesce(p_new_key_version, '') !~ '^v[0-9]{1,4}$' or coalesce(p_expected_key_version, '') !~ '^v[0-9]{1,4}$'
     or substr(p_new_key_version, 2)::integer <= substr(p_expected_key_version, 2)::integer
     or p_ciphertext is null or p_iv is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update private.webhook_endpoints w set ciphertext = p_ciphertext, iv = p_iv, key_version = p_new_key_version
    where w.tenant_id = p_tenant and w.provider_env = p_env and w.secret_version = p_secret_version
      and w.key_version = p_expected_key_version and w.ciphertext is not null;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end $$;

-- ============================================================ machine: ingestion (webhook and pull)

-- Applies one provider status for one tenant + environment. The shipment is found ONLY among this tenant's
-- succeeded create_order operations of this environment, by the provider order id; when the shipment
-- already has an AWB, the reported AWB must equal it. Returns 'applied', 'duplicate', 'stale' (older than
-- the current status: kept as history, state unchanged), 'final' (state already final: kept as history) or
-- 'unmatched' (no such order for this tenant: nothing written).
-- p_ts_trusted = false (a pull whose provider row had no readable, non-future time): the event is kept as
-- HISTORY ONLY at p_provider_ts (the pull time). It never changes the shipment's kind, its ordering watermark
-- (provider_status_at) or delivered_at/returned_at, because local time cannot be ordered against provider time
-- (review round 2). Only provider-timed updates (webhook or a readable pull) move the state.
create function public.ingest_provider_status(p_tenant uuid, p_env text, p_source text, p_provider_ts timestamptz,
  p_order_id text, p_awb text, p_status text, p_ts_trusted boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.shipments;
  v_kind text;
  v_raw text := upper(btrim(coalesce(p_status, '')));
  v_inserted integer;
begin
  perform private.require_provider_env(p_env);
  if p_source not in ('webhook', 'pull') or p_provider_ts is null or p_ts_trusted is null
     or (p_source = 'webhook' and not p_ts_trusted)
     or coalesce(p_order_id, '') !~ '^[A-Z0-9]{6,20}$'
     or (p_awb is not null and p_awb !~ '^[A-Za-z0-9-]{6,40}$')
     or v_raw = '' or char_length(v_raw) > 60
     or p_provider_ts > now() + interval '5 minutes' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select sh.* into s from public.shipments sh
    join public.provider_operations op on op.tenant_id = sh.tenant_id and op.shipment_id = sh.id
    where sh.tenant_id = p_tenant and op.kind = 'create_order' and op.state = 'succeeded'
      and op.provider_env = p_env and op.provider_order_id = p_order_id and not sh.is_simulated
    for update of sh;
  if not found then return 'unmatched'; end if;
  if s.awb is not null and p_awb is not null and s.awb <> p_awb then return 'unmatched'; end if;

  v_kind := private.provider_status_kind(v_raw);
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, provider_status, provider_ts, source)
    values (s.tenant_id, s.id, 'provider_status', null, v_raw, p_provider_ts, p_source)
    on conflict (tenant_id, shipment_id, provider_ts, provider_status) where provider_ts is not null do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  if not p_ts_trusted then return 'history_only'; end if;
  if s.provider_status_kind in ('delivered', 'returned', 'cancelled') then return 'final'; end if;
  if s.provider_status_at is not null and p_provider_ts <= s.provider_status_at then return 'stale'; end if;

  update public.shipments set provider_status_kind = v_kind, provider_status_at = p_provider_ts,
      delivered_at = case when v_kind = 'delivered' then coalesce(delivered_at, p_provider_ts) else delivered_at end,
      returned_at = case when v_kind = 'returned' then coalesce(returned_at, p_provider_ts) else returned_at end
    where tenant_id = s.tenant_id and id = s.id;
  if p_source = 'webhook' then
    update private.webhook_endpoints w set last_delivery_at = now()
      where w.tenant_id = p_tenant and w.provider_env = p_env;
  end if;
  return 'applied';
end $$;

-- Marks shipments as pulled now (whatever was found), so the next runs rotate to others (machine only).
create function public.mark_status_pulled(p_env text, p_shipments uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_env(p_env);
  if p_shipments is null or cardinality(p_shipments) > 200 then raise exception 'invalid_input' using errcode = '22023'; end if;
  update public.shipments sh set status_pulled_at = now()
    where sh.id = any(p_shipments) and exists (select 1 from public.provider_operations op
      where op.tenant_id = sh.tenant_id and op.shipment_id = sh.id and op.kind = 'create_order' and op.provider_env = p_env);
end $$;

-- Issued real shipments of an environment whose provider status is not final and older than p_stale (or never
-- reported), least recently pulled first (never-pulled first), so a bounded run never starves the tail.
create function public.machine_status_pull_candidates(p_env text, p_stale interval, p_limit integer)
returns table (tenant_id uuid, shipment_id uuid, order_id text, courier text, credential_version integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_provider_env(p_env);
  if p_limit is null or p_limit not between 1 and 200 or p_stale is null or p_stale < interval '5 minutes' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return query
    select sh.tenant_id, sh.id, op.provider_order_id, q.courier, op.credential_version
      from public.shipments sh
      join public.tenants t on t.id = sh.tenant_id and not t.is_demo
      join public.provider_operations op on op.tenant_id = sh.tenant_id and op.shipment_id = sh.id
        and op.kind = 'create_order' and op.state = 'succeeded' and op.provider_env = p_env
      left join public.shipment_quotes q on q.tenant_id = sh.tenant_id and q.id = sh.selected_quote_id
      where sh.submission_state = 'issued' and not sh.is_simulated and op.provider_order_id is not null
        and coalesce(sh.provider_status_kind, 'awaiting_pickup') not in ('delivered', 'returned', 'cancelled')
        and coalesce(sh.provider_status_at, sh.issued_at, sh.created_at) < now() - p_stale
        and (sh.status_pulled_at is null or sh.status_pulled_at < now() - p_stale)
      order by sh.status_pulled_at nulls first, sh.id limit p_limit;
end $$;

revoke all on function public.machine_webhook_secret(text), public.machine_webhook_mismatch(text),
  public.ingest_provider_status(uuid, text, text, timestamptz, text, text, text, boolean),
  public.machine_status_pull_candidates(text, interval, integer), public.mark_status_pulled(text, uuid[]),
  public.machine_webhook_rewrap_candidates(text, text, uuid, integer),
  public.rewrap_webhook_secret(uuid, text, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.machine_webhook_secret(text), public.machine_webhook_mismatch(text),
  public.ingest_provider_status(uuid, text, text, timestamptz, text, text, text, boolean),
  public.machine_status_pull_candidates(text, interval, integer), public.mark_status_pulled(text, uuid[]),
  public.machine_webhook_rewrap_candidates(text, text, uuid, integer),
  public.rewrap_webhook_secret(uuid, text, integer, text, text, text, text) to service_role;

-- ============================================================ public tracking: real status, kind label only

create or replace function public.track_shipment(token text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'gerai_label', case when l.mask_sender = false then l.true_tenant_name end,
    'courier', q.courier, 'service', q.service, 'awb', s.awb,
    'status_label', case s.provider_status_kind
        when 'awaiting_pickup' then 'Menunggu dijemput kurir'
        when 'in_transit' then 'Dalam perjalanan'
        when 'problem' then 'Ada kendala pengiriman'
        when 'delivered' then 'Terkirim'
        when 'returned' then 'Dikembalikan ke pengirim'
        when 'cancelled' then 'Dibatalkan'
        when 'unknown' then 'Status tidak dikenal'
        else 'Status belum tersedia' end,
    -- Kind and time only: never the raw provider value, detail or hub.
    -- The latest 50 provider events, shown oldest first (the app projection refuses more than 50).
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('kind', private.provider_status_kind(x.provider_status), 'at', x.provider_ts)
                       order by x.provider_ts, x.id)
        from (select e.provider_status, e.provider_ts, e.id from public.shipment_events e
                where e.tenant_id = s.tenant_id and e.shipment_id = s.id and e.provider_ts is not null
                order by e.provider_ts desc, e.id desc limit 50) x), '[]'::jsonb),
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
    and coalesce(token, '') ~ '^[A-Za-z0-9_-]{43}$'
    and t.shared_at is not null and t.revoked_at is null and (t.expires_at is null or t.expires_at > now())
    and not s.is_simulated and s.submission_state = 'issued' and s.awb is not null
$$;
revoke all on function public.track_shipment(text) from public, authenticated, service_role;
grant execute on function public.track_shipment(text) to anon;

notify pgrst, 'reload schema';
