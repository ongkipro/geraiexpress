-- T-110 / NFR-5 / RATE-1 / DR-1 / TD-3: durable Partner-wide quota and the post-restore provider
-- mutation fence. Function bodies that change are recreated from their latest definition (named per
-- function); only the noted lines change. Signatures, SECURITY DEFINER, `set search_path = ''` and ACLs
-- are retained.
--
-- A. Partner-wide quota (every Partner API request, all tenants, all app replicas):
--    private.partner_quota_limits     configured limits per provider environment. The seeded values are
--                                     conservative PLACEHOLDERS (entitlement_verified = false), below the
--                                     reviewed-contract baseline (60 requests/minute, 1,000 new sellers per
--                                     WIB day). The real entitlement is unknown until Mengantar confirms it
--                                     for our Partner account; set it with superuser SQL (RELEASE.md).
--    private.partner_request_windows  requests counted per fixed UTC minute.
--    private.partner_new_sellers      distinct externalUserIds per WIB calendar day (a repeated
--                                     registration of one seller and every key recovery do not count).
--    private.partner_retry_windows    a provider Retry-After (scope request) or daily-limit stop (scope
--                                     new_seller) that every tenant honours.
--    reserve_partner_quota / note_partner_retry_after are machine-only (service_role).
--    The partner is keyed by the SHA-256 of its Partner ID, never by a tenant.

-- ============================================================ A. Partner-wide quota

create table private.partner_quota_limits (
  provider_env text primary key check (provider_env in ('sandbox', 'production')),
  requests_per_minute integer not null check (requests_per_minute between 1 and 10000),
  new_sellers_per_day integer not null check (new_sellers_per_day between 0 and 1000000),
  -- false = a placeholder; true only after the entitlement was confirmed by Mengantar (evidence in note).
  entitlement_verified boolean not null default false,
  note text not null check (char_length(note) between 3 and 500),
  updated_at timestamptz not null default now()
);
insert into private.partner_quota_limits (provider_env, requests_per_minute, new_sellers_per_day, entitlement_verified, note)
values
  ('sandbox', 30, 100, false, 'Placeholder: the Partner entitlement is unverified; set from Mengantar''s confirmation.'),
  ('production', 30, 100, false, 'Placeholder: the Partner entitlement is unverified; set from Mengantar''s confirmation.');

create table private.partner_request_windows (
  provider_env text not null check (provider_env in ('sandbox', 'production')),
  partner_key text not null check (partner_key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  used integer not null check (used >= 0),
  primary key (provider_env, partner_key, window_start)
);

create table private.partner_new_sellers (
  provider_env text not null check (provider_env in ('sandbox', 'production')),
  partner_key text not null check (partner_key ~ '^[a-f0-9]{64}$'),
  wib_day date not null,
  external_ref text not null check (external_ref ~ '^[A-Za-z0-9:_-]{1,128}$'),
  reserved_at timestamptz not null default now(),
  primary key (provider_env, partner_key, wib_day, external_ref)
);

create table private.partner_retry_windows (
  provider_env text not null check (provider_env in ('sandbox', 'production')),
  partner_key text not null check (partner_key ~ '^[a-f0-9]{64}$'),
  scope text not null check (scope in ('request', 'new_seller')),
  retry_until timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (provider_env, partner_key, scope)
);

alter table private.partner_quota_limits enable row level security;
alter table private.partner_request_windows enable row level security;
alter table private.partner_new_sellers enable row level security;
alter table private.partner_retry_windows enable row level security;
revoke all on private.partner_quota_limits, private.partner_request_windows, private.partner_new_sellers,
  private.partner_retry_windows from public, anon, authenticated, service_role;

create function private.partner_key(p_partner text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(p_partner, '') !~ '^[A-Za-z0-9_.-]{1,64}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return encode(sha256(convert_to(p_partner, 'UTF8')), 'hex');
end $$;
revoke all on function private.partner_key(text) from public, anon, authenticated, service_role;

-- The start of the next WIB calendar day (Asia/Jakarta has no daylight saving time).
create function private.next_wib_midnight(p_at timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select (((p_at at time zone 'Asia/Jakarta')::date + 1)::timestamp) at time zone 'Asia/Jakarta'
$$;
revoke all on function private.next_wib_midnight(timestamptz) from public, anon, authenticated, service_role;

-- Reserves p_cost requests of the current minute (and, for a seller registration, one new seller of the
-- current WIB day) BEFORE a Partner request is signed. All-or-nothing: a denial consumes nothing.
-- Returns {allowed, reason, next_eligible_at}; a denial is an answer, not an error. Concurrent callers of
-- one partner serialize on a transaction advisory lock, so no interleaving can exceed a limit.
-- p_new_seller_ref: the externalUserId of a registration (null for every other call); one seller is
-- counted once per WIB day however often its registration is retried.
-- p_mutating: the call may change provider state (registration, key read that may create a key, key
-- regeneration); refused while the provider mutation fence is engaged (part B).
create function public.reserve_partner_quota(p_env text, p_partner text, p_cost integer default 1,
  p_new_seller_ref text default null, p_mutating boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text := private.partner_key(p_partner);
  -- Taken AFTER the advisory lock below: a caller that waited across a minute or WIB-day boundary is
  -- charged to the window it actually runs in, never to the one it started waiting in.
  v_now timestamptz;
  v_minute timestamptz;
  v_day date;
  l private.partner_quota_limits;
  v_until timestamptz;
  v_used integer;
  v_new boolean := false;
begin
  perform private.require_provider_env(p_env);
  if p_cost is null or p_cost not between 1 and 10 or p_mutating is null
     or (p_new_seller_ref is not null and p_new_seller_ref !~ '^[A-Za-z0-9:_-]{1,128}$') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_mutating then perform private.require_provider_fence_clear(); end if;
  perform pg_advisory_xact_lock(hashtextextended('partner_quota:' || p_env || ':' || v_key, 0));
  v_now := clock_timestamp();
  v_minute := date_trunc('minute', v_now);
  v_day := (v_now at time zone 'Asia/Jakarta')::date;
  select * into l from private.partner_quota_limits where provider_env = p_env;
  if not found then raise exception 'partner_quota_unconfigured' using errcode = '55000'; end if;

  select max(w.retry_until) into v_until from private.partner_retry_windows w
    where w.provider_env = p_env and w.partner_key = v_key and w.retry_until > v_now
      and (w.scope = 'request' or (w.scope = 'new_seller' and p_new_seller_ref is not null));
  if v_until is not null then
    return jsonb_build_object('allowed', false, 'reason', 'retry_after', 'next_eligible_at', v_until);
  end if;

  select coalesce(sum(w.used), 0) into v_used from private.partner_request_windows w
    where w.provider_env = p_env and w.partner_key = v_key and w.window_start = v_minute;
  if v_used + p_cost > l.requests_per_minute then
    return jsonb_build_object('allowed', false, 'reason', 'minute_limit', 'next_eligible_at', v_minute + interval '1 minute');
  end if;

  if p_new_seller_ref is not null and not exists (select 1 from private.partner_new_sellers n
      where n.provider_env = p_env and n.partner_key = v_key and n.wib_day = v_day and n.external_ref = p_new_seller_ref) then
    if (select count(*) from private.partner_new_sellers n
        where n.provider_env = p_env and n.partner_key = v_key and n.wib_day = v_day) >= l.new_sellers_per_day then
      return jsonb_build_object('allowed', false, 'reason', 'daily_new_seller_limit',
        'next_eligible_at', private.next_wib_midnight(v_now));
    end if;
    v_new := true;
  end if;

  insert into private.partner_request_windows (provider_env, partner_key, window_start, used)
    values (p_env, v_key, v_minute, p_cost)
  on conflict (provider_env, partner_key, window_start) do update set used = partner_request_windows.used + excluded.used;
  if v_new then
    insert into private.partner_new_sellers (provider_env, partner_key, wib_day, external_ref)
      values (p_env, v_key, v_day, p_new_seller_ref);
  end if;
  -- Bounded housekeeping of this partner's own history (at most one row per minute).
  delete from private.partner_request_windows
    where provider_env = p_env and partner_key = v_key and window_start < v_minute - interval '1 day';
  delete from private.partner_new_sellers
    where provider_env = p_env and partner_key = v_key and wib_day < v_day - 7;
  return jsonb_build_object('allowed', true, 'reason', null, 'next_eligible_at', null);
end $$;

-- Persists a provider back-off for the whole Partner account, so every tenant and replica waits. Never
-- shortens a stored window. p_until null = the provider gave no Retry-After: 60 seconds for scope
-- request (a missing Retry-After is unknown, never "retry now"), the next WIB midnight for new_seller
-- (DAILY_REGISTRATION_LIMIT). Capped at 24 hours. Returns the stored retry time.
create function public.note_partner_retry_after(p_env text, p_partner text, p_until timestamptz default null,
  p_scope text default 'request')
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_key text := private.partner_key(p_partner);
  v_now timestamptz := clock_timestamp();
  v_until timestamptz;
begin
  perform private.require_provider_env(p_env);
  if coalesce(p_scope, '') not in ('request', 'new_seller') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_until := least(coalesce(p_until, case when p_scope = 'new_seller' then private.next_wib_midnight(v_now)
    else v_now + interval '60 seconds' end), v_now + interval '24 hours');
  insert into private.partner_retry_windows (provider_env, partner_key, scope, retry_until, updated_at)
    values (p_env, v_key, p_scope, v_until, v_now)
  on conflict (provider_env, partner_key, scope) do update
    set retry_until = greatest(partner_retry_windows.retry_until, excluded.retry_until), updated_at = excluded.updated_at
  returning retry_until into v_until;
  return v_until;
end $$;

revoke all on function public.reserve_partner_quota(text, text, integer, text, boolean),
  public.note_partner_retry_after(text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reserve_partner_quota(text, text, integer, text, boolean),
  public.note_partner_retry_after(text, text, timestamptz, text) to service_role;

-- ============================================================ B. Post-restore provider mutation fence
--
-- A database restore rolls local state back; it does not roll Mengantar back. An order, payment, seller
-- registration or key rotation sent after the backup point is invisible in the restored rows (a create
-- operation may even look `queued` again). Until an operator has reconciled, no new provider mutation
-- may start (DR-1, TD-3).
--
-- private.provider_mutation_fence is a singleton. The fence is EFFECTIVELY engaged when
--   (a) `engaged` is true (private.engage_provider_fence, run by the restore procedure, RELEASE.md), or
--   (b) the stored cluster identity differs from the live one. The identity is
--       system_identifier (pg_control_system: a new cluster/initdb or pg_upgrade) : database oid (a dump
--       restored into a new database) : this table's oid (a dump restored in place with --clean recreates
--       the table) : WAL timeline (pg_control_checkpoint: PITR or a promoted replica). The restored row
--       carries the OLD identity, so any of these engages the fence with no operator step. A data-only
--       restore into the same tables keeps every part, which is why the runbook engages explicitly.
-- Refused while engaged (55000 provider_fence_engaged): dispatch_claim, both pickup write-aheads, the
-- batch payment authorization and its write-ahead, the key-rotation fence and every mutating Partner
-- request (reserve_partner_quota p_mutating). Allowed: reconciliation, payment checks, reads, recording
-- results that already happened (dispatch_record, store/complete of a received key).
-- Clearing is an explicit platform action (integration_operations at aal2, reason, audit):
-- platform_clear_provider_fence re-records the live identity and marks every real queued create
-- operation restore_check_required in the same transaction. The dispatcher looks such an operation up at
-- Mengantar by its reference BEFORE any create (src/lib/mengantar/dispatcher.ts).

create table private.provider_mutation_fence (
  singleton boolean primary key default true check (singleton),
  engaged boolean not null,
  reason text check (reason is null or char_length(reason) between 5 and 500),
  engaged_at timestamptz,
  cluster_identity text not null,
  cleared_by uuid references auth.users (id),
  cleared_at timestamptz,
  clear_reason text check (clear_reason is null or char_length(clear_reason) between 5 and 500)
);
alter table private.provider_mutation_fence enable row level security;
revoke all on private.provider_mutation_fence from public, anon, authenticated, service_role;

-- pg_control_system() / pg_control_checkpoint() are restricted to superusers and pg_monitor: this
-- SECURITY DEFINER function is owned by the migration owner (postgres), which may read them.
create function private.provider_cluster_identity()
returns text language sql stable security definer set search_path = '' as $$
  select (select s.system_identifier::text from pg_catalog.pg_control_system() s)
    || ':' || (select d.oid::text from pg_catalog.pg_database d where d.datname = pg_catalog.current_database())
    || ':' || 'private.provider_mutation_fence'::pg_catalog.regclass::pg_catalog.oid::text
    || ':' || (select c.timeline_id::text from pg_catalog.pg_control_checkpoint() c)
$$;
revoke all on function private.provider_cluster_identity() from public, anon, authenticated, service_role;

insert into private.provider_mutation_fence (singleton, engaged, cluster_identity)
values (true, false, private.provider_cluster_identity());

-- Engaged when explicitly engaged, when the identity changed, or when the row is missing (fail closed).
create function private.provider_fence_engaged()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.engaged or f.cluster_identity is distinct from private.provider_cluster_identity()
    from private.provider_mutation_fence f where f.singleton), true)
$$;
revoke all on function private.provider_fence_engaged() from public, anon, authenticated, service_role;

create function private.require_provider_fence_clear()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if private.provider_fence_engaged() then
    raise exception 'provider_fence_engaged' using errcode = '55000';
  end if;
end $$;
revoke all on function private.require_provider_fence_clear() from public, anon, authenticated, service_role;

-- The restore procedure's first step after pg_restore (RELEASE.md), as the postgres owner. Idempotent;
-- the first engagement time is kept. Executable by no API role.
create function private.engage_provider_fence(p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_reason text := private.require_reason(p_reason);
begin
  insert into private.provider_mutation_fence (singleton, engaged, reason, engaged_at, cluster_identity)
    values (true, true, v_reason, now(), private.provider_cluster_identity())
  on conflict (singleton) do update set engaged = true, reason = excluded.reason,
    engaged_at = coalesce(case when provider_mutation_fence.engaged then provider_mutation_fence.engaged_at end, excluded.engaged_at);
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
    values (null, 'provider_fence.engaged', null, null, v_reason, 'engaged', jsonb_build_object('via', 'sql'));
end $$;
revoke all on function private.engage_provider_fence(text) from public, anon, authenticated, service_role;

-- Restore check marker: set only by platform_clear_provider_fence on real queued create operations.
-- It is cleared only by dispatch_restore_check_passed, when no order was found and the create may be sent.
-- An operation that left the queue through the check (recorded as found or unknown, or moved to unknown by
-- platform_mark_restore_check_unknown) KEEPS it: its pre-restore attempt may predate every
-- later dispatched_at, so reconciliation scans Mengantar from the operation's created_at instead.
alter table public.provider_operations add column restore_check_required boolean not null default false,
  add constraint provider_operations_restore_check_real check (not (restore_check_required and is_simulated));

-- Latest body: 20261103100000_cargo_noncod.sql. Change: the payload of every claim and reconciliation
-- carries restore_check_required and created_at (src/lib/mengantar/dispatcher.ts reads both).
create or replace function private.dispatch_payload(op public.provider_operations)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s public.shipments; q public.shipment_quotes; c private.seller_credentials;
begin
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;
  c := private.operation_credential(s.tenant_id, op.provider_env, op.credential_version);
  return jsonb_build_object(
    'operation_id', op.id, 'tenant_id', op.tenant_id, 'attempt', op.attempts,
    'operation_state', op.state,
    'provider_env', op.provider_env, 'dispatched_at', op.dispatched_at,
    'reference', s.reference, 'courier', q.courier, 'cargo', q.service_class = 'cargo',
    'pickup_address_id', s.pickup_snapshot->>'mengantar_pickup_address_id',
    'pickup_area_id', s.pickup_snapshot->>'mengantar_area_id',
    'handover', coalesce(s.pickup_snapshot->>'handover', 'dropoff'),
    'pickup_date', s.pickup_snapshot->>'pickup_date',
    'pickup_slot_hour', (s.pickup_snapshot->>'pickup_slot_hour')::integer,
    'pickup_volume', s.pickup_snapshot->>'pickup_volume',
    'pickup_phase', op.pickup_phase,
    'pickup_time_id', op.pickup_time_id,
    'recipient', jsonb_build_object('area_id', s.recipient_area_id, 'address', s.recipient_address,
      'name', s.recipient_name, 'phone', s.recipient_phone),
    'billable_weight_grams', (s.weight_snapshot->>'billable_weight_grams')::integer,
    'weight_grams', s.weight_grams, 'item_description', s.item_description, 'goods_value_idr', s.goods_value_idr,
    'is_cod', s.is_cod, 'cod_amount_idr', s.cod_amount_idr,
    'restore_check_required', op.restore_check_required, 'created_at', op.created_at,
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;

revoke all on function private.dispatch_payload(public.provider_operations) from public, anon, authenticated;

-- Super Admin read for the runbook and /admin/integrasi. Counts only.
create function public.platform_provider_fence()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f private.provider_mutation_fence; v_email text;
begin
  perform private.require_platform('integration_operations');
  select * into f from private.provider_mutation_fence where singleton;
  select u.email into v_email from auth.users u where u.id = f.cleared_by;
  return jsonb_build_object(
    'engaged', private.provider_fence_engaged(),
    'engaged_explicitly', coalesce(f.engaged, true),
    'identity_changed', f.cluster_identity is distinct from private.provider_cluster_identity(),
    'reason', f.reason, 'engaged_at', f.engaged_at,
    'cleared_at', f.cleared_at, 'cleared_by_email', v_email, 'clear_reason', f.clear_reason,
    'queued_real_operations', (select count(*) from public.provider_operations o
      where o.state = 'queued' and not o.is_simulated and o.kind = 'create_order'),
    'unresolved_real_operations', (select count(*) from public.provider_operations o
      where o.state in ('in_flight', 'unknown') and not o.is_simulated),
    'unresolved_batch_payments', (select count(*) from private.batch_payment_attempts a where a.state in ('sent', 'unknown')),
    'restore_checks_pending', (select count(*) from public.provider_operations o
      where o.state = 'queued' and o.restore_check_required));
end $$;

-- Clears the fence. p_expected_queued is the queued count the operator reviewed
-- (platform_provider_fence.queued_real_operations); a different count is stale_state. Every real queued
-- create operation is marked restore_check_required in the same transaction; returns the marked count.
create function public.platform_clear_provider_fence(p_reason text, p_expected_queued integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_reason text; f private.provider_mutation_fence; v_marked integer;
begin
  perform private.require_platform('integration_operations');
  v_reason := private.require_reason(p_reason);
  select * into f from private.provider_mutation_fence where singleton for update;
  if not found then
    insert into private.provider_mutation_fence (singleton, engaged, cluster_identity)
      values (true, true, 'missing') returning * into f;
  end if;
  if not private.provider_fence_engaged() then
    raise exception 'provider_fence_not_engaged' using errcode = '55000';
  end if;
  if p_expected_queued is null or p_expected_queued <> (select count(*) from public.provider_operations o
      where o.state = 'queued' and not o.is_simulated and o.kind = 'create_order') then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  update public.provider_operations set restore_check_required = true
    where state = 'queued' and not is_simulated and kind = 'create_order';
  get diagnostics v_marked = row_count;
  update private.provider_mutation_fence set engaged = false, cluster_identity = private.provider_cluster_identity(),
    cleared_by = (select auth.uid()), cleared_at = now(), clear_reason = v_reason
    where singleton;
  perform private.audit('provider_fence.cleared', null, null, v_reason, 'cleared',
    jsonb_build_object('restore_checks_marked', v_marked, 'identity_changed', f.cluster_identity is distinct from private.provider_cluster_identity(),
      'engaged_at', f.engaged_at));
  return v_marked;
end $$;

revoke all on function public.platform_provider_fence(), public.platform_clear_provider_fence(text, integer) from public, anon;
grant execute on function public.platform_provider_fence(), public.platform_clear_provider_fence(text, integer) to authenticated;

-- ------------------------------------------------------------ fenced provider mutations
-- Latest body: 20261029200000_close_window_and_claim_env.sql. Changes: the fence check first; a
-- restore-check operation is never failed as QUOTE_STALE here (a stale-but-maybe-created order is checked
-- first; dispatch_restore_check_passed applies the staleness rule after the check); the payload carries
-- restore_check_required and created_at (private.dispatch_payload above).
create or replace function public.dispatch_claim(p_operation uuid, p_env text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  t public.tenants;
  s public.shipments;
  v_version integer;
begin
  if p_env not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  perform private.require_provider_fence_clear();
  op := private.lock_real_operation(p_operation);
  -- Only a reserved pickup slot is bound to the environment it was reserved in; a plain released
  -- order holds nothing at the provider and may be claimed by the current environment.
  if op.pickup_time_id is not null and op.provider_env is not null and op.provider_env <> p_env then
    raise exception 'provider_env_mismatch' using errcode = '42501';
  end if;
  if op.state <> 'queued' then
    raise exception 'not_queued' using errcode = '55000';
  end if;
  select * into t from public.tenants where id = op.tenant_id for update;
  if t.is_demo or t.lifecycle <> 'active' then
    raise exception 'tenant_not_active' using errcode = '55000';
  end if;
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  if s.submission_state <> 'queued' or s.is_simulated or not exists (
    select 1 from public.shipment_quotes q where q.tenant_id = s.tenant_id and q.id = s.selected_quote_id
      and q.shipment_revision = s.revision and not q.is_simulated
      and (not s.is_cod or q.cod_supported)) then
    raise exception 'shipment_not_ready' using errcode = '55000';
  end if;
  if exists (select 1 from public.provider_operations o where o.tenant_id = op.tenant_id and not o.is_simulated
      and (o.state = 'in_flight' or (o.state = 'unknown' and o.dispatched_at > now() - interval '5 minutes')))
     or private.payment_busy(op.tenant_id) then
    raise exception 'account_busy' using errcode = '55P03';
  end if;
  -- Staleness is decided BEFORE the credential lookup (security review L6): an operation queued
  -- before an environment switch has no credential in the new environment, and used to be re-picked
  -- by every sweep without ever expiring.
  if op.created_at < now() - interval '6 hours' and not op.restore_check_required then
    update public.provider_operations set state = 'failed', result_code = 'QUOTE_STALE', updated_at = now() where id = op.id;
    update public.shipments set submission_state = 'failed', updated_at = now() where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'rejected', 'Ongkir kedaluwarsa sebelum dikirim; cek ongkir lagi');
    return jsonb_build_object('stale', true);
  end if;
  select version into v_version from private.seller_credentials
    where tenant_id = op.tenant_id and superseded_at is null and provider_env = p_env;
  if v_version is null then
    raise exception 'credential_missing' using errcode = '55000';
  end if;
  begin
    update public.provider_operations set state = 'in_flight', attempts = attempts + 1,
      provider_env = p_env, credential_version = v_version, dispatched_at = now(), updated_at = now()
    where id = op.id returning * into op;
  exception when unique_violation then
    raise exception 'account_busy' using errcode = '55P03';
  end;
  update public.shipments set submission_state = 'in_flight', updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
  perform private.add_event(op.tenant_id, op.shipment_id, 'dispatched', null);
  return private.dispatch_payload(op);
end $$;

-- The dispatcher found no order with this reference at Mengantar for a restore-check operation: the flag
-- is cleared and the create may be sent once. An operation that has waited past the quote's six hours is
-- failed as QUOTE_STALE instead (nothing was created, so it is reopenable), exactly as the claim would.
create function public.dispatch_restore_check_passed(p_operation uuid, p_attempt integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op public.provider_operations;
begin
  perform private.require_provider_fence_clear();
  op := private.lock_real_operation(p_operation);
  if op.state <> 'in_flight' or op.attempts <> p_attempt or not op.restore_check_required then
    raise exception 'stale_attempt' using errcode = '55000';
  end if;
  -- A recorded reservation ('reserved', released back to the queue) sent no order yet; any later phase did.
  if op.pickup_phase is not null and op.pickup_phase <> 'reserved' then
    raise exception 'provider_call_started' using errcode = '55000';
  end if;
  if op.created_at < now() - interval '6 hours' then
    update public.provider_operations set state = 'failed', result_code = 'QUOTE_STALE', restore_check_required = false,
      updated_at = now() where id = op.id;
    update public.shipments set submission_state = 'failed', updated_at = now() where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'rejected', 'Ongkir kedaluwarsa sebelum dikirim; cek ongkir lagi');
    return jsonb_build_object('stale', true);
  end if;
  update public.provider_operations set restore_check_required = false, updated_at = now() where id = op.id;
  return jsonb_build_object('stale', false);
end $$;
revoke all on function public.dispatch_restore_check_passed(uuid, integer) from public, anon, authenticated;
grant execute on function public.dispatch_restore_check_passed(uuid, integer) to service_role;

-- Operator exit for a restore check that cannot complete (the lookup keeps failing: a Mengantar outage,
-- a key that no longer opens, a reference list longer than the scan bound). integration_operations at aal2,
-- reason, audit. The queued operation becomes `unknown` (RESTORE_CHECK_MANUAL) in the given environment
-- with the active credential, so ordinary reconciliation takes over (the sweep and "Cek hasil"; scanned from
-- created_at because the flag stays). It never sends anything and never makes the shipment reopenable by
-- itself: only a later reconciliation proving "not created" (then close_failed_operation and reopen_shipment
-- by the gerai admin) leads to a new order. Returns the shipment's reference for the operator's record.
create function public.platform_mark_restore_check_unknown(p_operation uuid, p_env text, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_reason text; op public.provider_operations; v_version integer; v_reference text;
begin
  perform private.require_platform('integration_operations');
  v_reason := private.require_reason(p_reason);
  perform private.require_provider_env(p_env);
  op := private.lock_real_operation(p_operation);
  if op.state <> 'queued' or not op.restore_check_required then
    raise exception 'not_restore_check' using errcode = '55000';
  end if;
  if op.pickup_time_id is not null and op.provider_env is distinct from p_env then
    raise exception 'provider_env_mismatch' using errcode = '42501';
  end if;
  select version into v_version from private.seller_credentials
    where tenant_id = op.tenant_id and superseded_at is null and provider_env = p_env;
  if v_version is null then raise exception 'credential_missing' using errcode = '55000'; end if;
  update public.provider_operations set state = 'unknown', result_code = 'RESTORE_CHECK_MANUAL',
    provider_env = p_env, credential_version = v_version, dispatched_at = now(), last_checked_at = null, updated_at = now()
    where id = op.id;
  update public.shipments set submission_state = 'unknown', updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id returning reference into v_reference;
  perform private.add_event(op.tenant_id, op.shipment_id, 'outcome_unknown',
    'Diperiksa manual setelah pemulihan data: hasil di Mengantar belum diketahui');
  perform private.audit('provider_fence.restore_check_manual', op.tenant_id, null, v_reason, 'unknown',
    jsonb_build_object('operation', op.id, 'shipment', op.shipment_id, 'provider_env', p_env));
  return v_reference;
end $$;
revoke all on function public.platform_mark_restore_check_unknown(uuid, text, text) from public, anon;
grant execute on function public.platform_mark_restore_check_unknown(uuid, text, text) to authenticated;

-- The other write-aheads keep their latest bodies unchanged and gain the fence check in front, through
-- the wrapper pattern of 20261029150000: the unchanged body moves to private (no grants), and the public
-- signature, return type and ACL stay. Latest bodies: dispatch_pickup_begin_reservation and
-- dispatch_pickup_begin_create 20261028200000_pickup_orders.sql; dispatch_mark_batch_payment_sent
-- 20261028130000_batch_payment_attempts.sql; authorize_batch_payment
-- 20261029160000_partner_stop_review_fixes.sql; fence_partner_key_rotation
-- 20261029140000_partner_stops_owner_recency.sql.
alter function public.dispatch_pickup_begin_reservation(uuid, integer) set schema private;
alter function private.dispatch_pickup_begin_reservation(uuid, integer) rename to dispatch_pickup_begin_reservation_unfenced;
alter function public.dispatch_pickup_begin_create(uuid, integer) set schema private;
alter function private.dispatch_pickup_begin_create(uuid, integer) rename to dispatch_pickup_begin_create_unfenced;
alter function public.dispatch_mark_batch_payment_sent(uuid, text) set schema private;
alter function private.dispatch_mark_batch_payment_sent(uuid, text) rename to dispatch_mark_batch_payment_sent_unfenced;
alter function public.authorize_batch_payment(uuid, text) set schema private;
alter function private.authorize_batch_payment(uuid, text) rename to authorize_batch_payment_unfenced;
alter function public.fence_partner_key_rotation(uuid, uuid, text, integer, text) set schema private;
alter function private.fence_partner_key_rotation(uuid, uuid, text, integer, text) rename to fence_partner_key_rotation_unfenced;
revoke all on function private.dispatch_pickup_begin_reservation_unfenced(uuid, integer),
  private.dispatch_pickup_begin_create_unfenced(uuid, integer),
  private.dispatch_mark_batch_payment_sent_unfenced(uuid, text),
  private.authorize_batch_payment_unfenced(uuid, text),
  private.fence_partner_key_rotation_unfenced(uuid, uuid, text, integer, text)
  from public, anon, authenticated, service_role;

create function public.dispatch_pickup_begin_reservation(p_operation uuid, p_attempt integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_fence_clear();
  perform private.dispatch_pickup_begin_reservation_unfenced(p_operation, p_attempt);
end $$;

create function public.dispatch_pickup_begin_create(p_operation uuid, p_attempt integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_fence_clear();
  perform private.dispatch_pickup_begin_create_unfenced(p_operation, p_attempt);
end $$;

create function public.dispatch_mark_batch_payment_sent(p_attempt uuid, p_batch_object_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_fence_clear();
  return private.dispatch_mark_batch_payment_sent_unfenced(p_attempt, p_batch_object_id);
end $$;

create function public.authorize_batch_payment(p_shipment uuid, p_batch_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_fence_clear();
  return private.authorize_batch_payment_unfenced(p_shipment, p_batch_digest);
end $$;

create function public.fence_partner_key_rotation(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer, p_env text)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_fence_clear();
  return private.fence_partner_key_rotation_unfenced(p_tenant, p_actor, p_seller_id, p_expected_version, p_env);
end $$;

revoke all on function public.dispatch_pickup_begin_reservation(uuid, integer), public.dispatch_pickup_begin_create(uuid, integer),
  public.dispatch_mark_batch_payment_sent(uuid, text), public.fence_partner_key_rotation(uuid, uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.dispatch_pickup_begin_reservation(uuid, integer), public.dispatch_pickup_begin_create(uuid, integer),
  public.dispatch_mark_batch_payment_sent(uuid, text), public.fence_partner_key_rotation(uuid, uuid, text, integer, text)
  to service_role;
revoke all on function public.authorize_batch_payment(uuid, text) from public, anon;
grant execute on function public.authorize_batch_payment(uuid, text) to authenticated;

notify pgrst, 'reload schema';
