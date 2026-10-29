-- T-050 (review P1-12 to P1-14: SEC-07, SEC-08, DIL-05, DIL-23): provider-environment scope for the
-- seller binding and sealed credentials, and the machine-only re-wrap used by the key ring.
--
-- A Mengantar sandbox key must never be handed to a Worker that talks to production (and the other
-- way round), and a seller id is only unique inside one provider environment. So:
--   * private.seller_credentials and private.tenant_mengantar_onboarding carry provider_env;
--   * at most one active credential per (tenant, provider_env);
--   * a seller id is bound to one tenant per provider environment;
--   * every machine read takes (or derives from the operation) the environment and returns only the
--     credential of that environment: machine_seller_key, dispatch_claim, dispatch_payload and the
--     batch payment payload;
--   * the machine writers (Partner completion, key rotation) assert the Worker's MENGANTAR_ENV
--     against the onboarding row's environment, which is immutable.
-- ASSUMPTION (backfill): no production credential or production seller binding has ever existed,
-- because production Partner access is not enabled (ARCH-2 gate) and the Worker refuses production
-- onboarding. Every existing row is therefore a sandbox row, which is exactly the column default.
-- If that assumption were false for a database, those rows would have to be corrected by hand
-- before this migration.
--
-- Not changed on purpose: the readiness checks that ask "does the tenant have an active credential"
-- (confirm_shipment, dispatch_due and the pickup/issuance guards) stay environment-agnostic; they only
-- decide whether work may be queued. The credential that is actually opened is always environment
-- scoped, and a claim without a credential of its environment fails closed (credential_missing).

-- ============================================================ columns and uniqueness

alter table private.seller_credentials
  add column provider_env text not null default 'sandbox' check (provider_env in ('sandbox', 'production'));
alter table private.tenant_mengantar_onboarding
  add column provider_env text not null default 'sandbox' check (provider_env in ('sandbox', 'production'));

drop index private.seller_credentials_one_active;
create unique index seller_credentials_one_active on private.seller_credentials (tenant_id, provider_env)
  where superseded_at is null;

drop index private.tenant_mengantar_onboarding_partner_seller_uniq;
create unique index tenant_mengantar_onboarding_partner_seller_uniq
  on private.tenant_mengantar_onboarding (provider_env, partner_seller_id)
  where partner_seller_id is not null;

-- The environment a binding belongs to never changes after the row exists.
create or replace function private.preserve_immutable_onboarding_identity()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.external_user_id is distinct from old.external_user_id then
    raise exception 'immutable_external_user_id' using errcode = '42501';
  end if;
  if new.provider_env is distinct from old.provider_env then
    raise exception 'immutable_provider_env' using errcode = '42501';
  end if;
  return new;
end $$;

-- ============================================================ BYOK store and remove

-- p_env is the environment of the Worker that sealed the key (its MENGANTAR_ENV). Only the active
-- credential of THAT environment is superseded; the version counter stays per tenant because the
-- Worker binds tenant + version into the AES-GCM associated data. The stale checks raise SQLSTATE 55000:
-- 20261027220000 rewrote the original 40001 of this function at run time, and PostgREST retries 40001.
drop function public.store_seller_credential(uuid, integer, text, text, text, text);
create function public.store_seller_credential(p_tenant uuid, p_expected_version integer,
  p_ciphertext text, p_iv text, p_key_version text, p_hint text, p_env text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_latest integer;
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  perform private.require_tenant_admin_locked(p_tenant);
  select coalesce(max(c.version), 0) into v_latest from private.seller_credentials c where c.tenant_id = p_tenant;
  if v_latest <> coalesce(p_expected_version, -1) then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  update private.seller_credentials c set superseded_at = now(), ciphertext = null, iv = null
    where c.tenant_id = p_tenant and c.provider_env = p_env and c.superseded_at is null;
  insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, created_by, provider_env)
    values (p_tenant, 'byok', p_ciphertext, p_iv, p_key_version, p_hint, v_latest + 1, (select auth.uid()), p_env);
  perform private.audit('credential.store', p_tenant, null, null, 'stored',
    jsonb_build_object('mode', 'byok', 'version', v_latest + 1, 'hint', p_hint, 'provider_env', p_env));
  return v_latest + 1;
end $$;
revoke all on function public.store_seller_credential(uuid, integer, text, text, text, text, text) from public, anon;
grant execute on function public.store_seller_credential(uuid, integer, text, text, text, text, text) to authenticated;

-- The expected version names the active row the admin saw, so removal stays unambiguous when a
-- tenant has an active credential in more than one environment.
create or replace function public.remove_seller_credential(p_tenant uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_current integer; v_env text;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  select c.version, c.provider_env into v_current, v_env from private.seller_credentials c
    where c.tenant_id = p_tenant and c.superseded_at is null and c.version = p_expected_version for update;
  if v_current is null then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  update private.seller_credentials c set superseded_at = now(), ciphertext = null, iv = null
    where c.tenant_id = p_tenant and c.version = v_current and c.superseded_at is null;
  perform private.audit('credential.remove', p_tenant, null, null, 'removed',
    jsonb_build_object('version', v_current, 'provider_env', v_env));
end $$;

-- ============================================================ status reads (one row per tenant)

create or replace function public.seller_credential_status(p_tenant uuid)
returns table (configured boolean, mode text, hint text, version integer, created_at timestamptz,
  latest_version integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.member_role(p_tenant) is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  return query
    select c.id is not null, c.mode, c.hint, c.version, c.created_at,
      (select coalesce(max(x.version), 0) from private.seller_credentials x where x.tenant_id = p_tenant)
    from (select 1) one
    left join lateral (select y.* from private.seller_credentials y
      where y.tenant_id = p_tenant and y.superseded_at is null
      order by y.created_at desc, y.version desc limit 1) c on true;
end $$;

create or replace function public.platform_integrations()
returns table (tenant_id uuid, tenant_name text, lifecycle text, configured boolean, mode text,
  hint text, version integer, stored_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('integration_operations');
  return query
    select t.id, t.name, t.lifecycle, c.id is not null, c.mode, c.hint, c.version, c.created_at
    from public.tenants t
    left join lateral (select y.* from private.seller_credentials y
      where y.tenant_id = t.id and y.superseded_at is null
      order by y.created_at desc, y.version desc limit 1) c on true
    where not t.is_demo
    order by t.name;
end $$;

create or replace function public.partner_onboarding_status(p_tenant uuid)
returns table (
  connection_mode text,
  onboarding_state text,
  partner_seller_id text,
  owner_name text,
  owner_email text,
  owner_phone text,
  consent_recorded_at timestamptz,
  last_error_code text,
  retry_after_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role text := private.member_role(p_tenant);
begin
  if v_role is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return query
    select
      case
        when o.connection_mode = 'partner_managed' and c.id is not null then 'partner_managed'
        when c.id is not null and (
          o.tenant_id is null
          or o.onboarding_state = 'not_connected'
          or (o.connection_mode <> 'partner_managed' and c.created_at >= o.updated_at)
        ) then 'byok'
        when o.onboarding_state = 'connected' and c.id is null then 'none'
        else coalesce(o.connection_mode, 'none')
      end as connection_mode,
      case
        when o.connection_mode = 'partner_managed' and c.id is not null then 'connected'
        when c.id is not null and (
          o.tenant_id is null
          or o.onboarding_state = 'not_connected'
          or (o.connection_mode <> 'partner_managed' and c.created_at >= o.updated_at)
        ) then 'connected'
        when o.onboarding_state = 'connected' and c.id is null then 'not_connected'
        else coalesce(o.onboarding_state, 'not_connected')
      end as onboarding_state,
      case when v_role = 'tenant_admin' then o.partner_seller_id end,
      case when v_role = 'tenant_admin' then o.owner_name end,
      case when v_role = 'tenant_admin' then o.owner_email end,
      case when v_role = 'tenant_admin' then o.owner_phone end,
      o.consent_recorded_at,
      o.last_error_code,
      o.retry_after_at
    from (select 1) one
    left join private.tenant_mengantar_onboarding o on o.tenant_id = p_tenant
    left join lateral (select y.* from private.seller_credentials y
      where y.tenant_id = p_tenant and y.superseded_at is null
      order by (y.provider_env = o.provider_env) desc nulls last, y.created_at desc, y.version desc limit 1) c on true;
end $$;

-- ============================================================ machine reads

-- The tenant's active sealed seller key of ONE provider environment, for a Worker request that has
-- already verified the caller's membership. A credential of the other environment is never returned.
drop function public.machine_seller_key(uuid);
create function public.machine_seller_key(p_tenant uuid, p_env text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare c private.seller_credentials;
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  if (select is_demo from public.tenants where id = p_tenant) is distinct from false then
    return null;
  end if;
  select * into c from private.seller_credentials
    where tenant_id = p_tenant and superseded_at is null and provider_env = p_env;
  if c.id is null then return null; end if;
  return jsonb_build_object('ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version);
end $$;
revoke all on function public.machine_seller_key(uuid, text) from public, anon, authenticated;
grant execute on function public.machine_seller_key(uuid, text) to service_role;

-- Claim: the credential version recorded on the operation is the active one of the caller's
-- environment. Everything else is the final definition (20261028130000) unchanged.
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
  op := private.lock_real_operation(p_operation);
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
  select version into v_version from private.seller_credentials
    where tenant_id = op.tenant_id and superseded_at is null and provider_env = p_env;
  if v_version is null then
    raise exception 'credential_missing' using errcode = '55000';
  end if;
  if op.created_at < now() - interval '6 hours' then
    update public.provider_operations set state = 'failed', result_code = 'QUOTE_STALE', updated_at = now() where id = op.id;
    update public.shipments set submission_state = 'failed', updated_at = now() where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'rejected', 'Ongkir kedaluwarsa sebelum dikirim; cek ongkir lagi');
    return jsonb_build_object('stale', true);
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

-- The payload's credential is the one of the operation's own environment (set at claim), so a
-- payment re-check or reconcile can never open a credential of another environment. Everything else
-- is the final definition (20261028200000) unchanged.
create or replace function private.dispatch_payload(op public.provider_operations)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s public.shipments; q public.shipment_quotes; c private.seller_credentials;
begin
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;
  select * into c from private.seller_credentials
    where tenant_id = s.tenant_id and superseded_at is null and version = op.credential_version
      and provider_env = op.provider_env;
  return jsonb_build_object(
    'operation_id', op.id, 'tenant_id', op.tenant_id, 'attempt', op.attempts,
    'operation_state', op.state,
    'provider_env', op.provider_env, 'dispatched_at', op.dispatched_at,
    'reference', s.reference, 'courier', q.courier,
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
    'weight_grams', s.weight_grams, 'item_description', s.item_description, 'goods_value_idr', s.goods_value_idr,
    'is_cod', s.is_cod, 'cod_amount_idr', s.cod_amount_idr,
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;

-- Batch payment payload: the credential of the claim operation's environment. Unchanged otherwise
-- (20261028130000).
create or replace function private.batch_attempt_payload(a private.batch_payment_attempts, p_mode text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  c private.seller_credentials;
  v_members jsonb;
begin
  select * into op from public.provider_operations where id = a.claim_operation_id;
  select * into c from private.seller_credentials
    where tenant_id = a.tenant_id and superseded_at is null
      and provider_env = op.provider_env
      and (op.credential_version is null or version = op.credential_version);
  select jsonb_agg(jsonb_build_object(
      'shipment_id', o.shipment_id,
      'operation_id', o.id,
      'reference', sh.reference,
      'provider_order_id', o.provider_order_id,
      'customer_charge_idr', coalesce(sh.customer_charge_idr, sq.customer_charge_idr, sq.normal_tariff_idr, 0),
      'payment_state', sh.payment_state
    ) order by o.id)
    into v_members
    from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    left join public.shipment_quotes sq on sq.tenant_id = sh.tenant_id and sq.id = sh.selected_quote_id
    where o.tenant_id = a.tenant_id and o.provider_batch = a.batch_code
      and not o.is_simulated and o.state = 'succeeded' and o.provider_order_id is not null;
  return jsonb_build_object(
    'mode', p_mode,
    'attempt_id', a.id,
    'attempt_state', a.state,
    'claim_operation_id', a.claim_operation_id,
    'tenant_id', a.tenant_id,
    'provider_env', op.provider_env,
    'batch', a.batch_code,
    'batch_id', coalesce(a.batch_object_id, (select max(o.provider_batch_id) from public.provider_operations o
      where o.tenant_id = a.tenant_id and o.provider_batch = a.batch_code)),
    'courier', a.courier,
    'batch_digest', a.batch_digest,
    'members', coalesce(v_members, '[]'::jsonb),
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;

-- ============================================================ Partner onboarding

-- begin writes no environment: a new onboarding row takes the column default ('sandbox'), because
-- production Partner onboarding is refused by the Worker; the row's environment is immutable. The
-- "already connected" check looks at the active credential of the row's own environment.
create or replace function public.begin_partner_seller_onboarding(p_tenant uuid, p_owner_name text,
  p_owner_email text, p_owner_phone text, p_terms_version text, p_privacy_version text, p_agreed boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_owner_name, ''));
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
  v_phone text := regexp_replace(btrim(coalesce(p_owner_phone, '')), '[\s()-]+', '', 'g');
  v_terms text := btrim(coalesce(p_terms_version, ''));
  v_privacy text := btrim(coalesce(p_privacy_version, ''));
  o private.tenant_mengantar_onboarding; v_latest integer;
begin
  if private.member_role(p_tenant) is not null and (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  perform private.require_tenant_admin_locked(p_tenant);
  perform 1 from public.tenants where id = p_tenant for update;
  if coalesce(p_agreed, false) is not true or char_length(v_terms) not between 1 and 64
     or char_length(v_privacy) not between 1 and 64 then raise exception 'consent_required' using errcode = '22023'; end if;
  if v_name !~ '^[A-Za-z0-9 ._''@-]{1,100}$' or char_length(v_email) > 254
     or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or v_email like '%@geraiexpress.local'
     or v_email like '%@example.com' or v_phone !~ '^(?:\+?62|0)8[0-9]{8,13}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into o from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if o.onboarding_state = 'connected' and exists (
    select 1 from private.seller_credentials c
    where c.tenant_id = p_tenant and c.superseded_at is null and c.provider_env = o.provider_env
  ) then raise exception 'already_partner_connected' using errcode = '23505'; end if;
  -- A repeat registration is not an owner/profile update or a new agreement.
  if o.partner_seller_id is null then
    insert into private.tenant_mengantar_onboarding (tenant_id, external_user_id, connection_mode, onboarding_state,
      owner_name, owner_email, owner_phone, terms_version, privacy_version, consent_actor_id, consent_recorded_at,
      last_error_code, retry_after_at, updated_at)
    values (p_tenant, 'geraiexpress:tenant:' || p_tenant::text, 'none', 'registration_pending',
      v_name, v_email, v_phone, v_terms, v_privacy, (select auth.uid()), now(), null, null, now())
    on conflict (tenant_id) do update set onboarding_state = 'registration_pending',
      owner_name = excluded.owner_name, owner_email = excluded.owner_email, owner_phone = excluded.owner_phone,
      terms_version = excluded.terms_version, privacy_version = excluded.privacy_version,
      consent_actor_id = excluded.consent_actor_id, consent_recorded_at = excluded.consent_recorded_at,
      last_error_code = null, retry_after_at = null, updated_at = now()
    returning * into o;
    perform private.audit('partner.onboarding_begin', p_tenant, null, null, 'registration_pending',
      jsonb_build_object('external_user_id', o.external_user_id, 'partner_seller_id', o.partner_seller_id,
        'terms_version', o.terms_version, 'privacy_version', o.privacy_version));
  end if;
  select coalesce(max(c.version), 0) into v_latest from private.seller_credentials c where c.tenant_id = p_tenant;
  return jsonb_build_object('external_user_id', o.external_user_id, 'partner_seller_id', o.partner_seller_id,
    'latest_credential_version', v_latest);
end $$;

create or replace function public.begin_partner_seller_key_recovery(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; v_latest integer;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  perform 1 from public.tenants where id = p_tenant for update;
  select * into o from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found or o.consent_actor_id is null or o.consent_recorded_at is null
     or nullif(btrim(o.terms_version), '') is null or nullif(btrim(o.privacy_version), '') is null then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if o.onboarding_state <> 'registered_key_pending' or o.partner_seller_id is null or exists (
    select 1 from private.seller_credentials c
    where c.tenant_id = p_tenant and c.superseded_at is null and c.provider_env = o.provider_env
  ) then raise exception 'not_recoverable' using errcode = '55000'; end if;
  select coalesce(max(c.version), 0) into v_latest from private.seller_credentials c where c.tenant_id = p_tenant;
  return to_jsonb(o) || jsonb_build_object('latest_credential_version', v_latest);
end $$;

-- Machine-only. p_env is the Worker's MENGANTAR_ENV and must equal the onboarding row's (immutable)
-- environment; the credential is written, and the previous one superseded, in that environment only.
drop function public.complete_partner_seller_onboarding(uuid, text, text, text, text, text, integer);
create function public.complete_partner_seller_onboarding(p_tenant uuid, p_seller_id text,
  p_ciphertext text, p_iv text, p_key_version text, p_hint text, p_expected_version integer, p_env text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_demo boolean; v_latest integer; v_onb private.tenant_mengantar_onboarding;
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  -- BYOK writers lock these same membership rows. The tenant lock alone would not serialize
  -- Partner completion against store_seller_credential's earlier read/clear/insert interval.
  perform 1 from public.memberships where tenant_id = p_tenant for update;
  select is_demo into v_demo from public.tenants where id = p_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_demo then raise exception 'demo_restricted' using errcode = '42501'; end if;
  if coalesce(p_seller_id, '') !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
  select * into v_onb from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found then raise exception 'consent_required' using errcode = '22023'; end if;
  if v_onb.provider_env <> p_env then raise exception 'provider_env_mismatch' using errcode = '42501'; end if;
  if v_onb.partner_seller_id is not null and v_onb.partner_seller_id <> p_seller_id then
    raise exception 'seller_binding_mismatch' using errcode = '42501';
  end if;
  select coalesce(max(c.version), 0) into v_latest from private.seller_credentials c where c.tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version then raise exception 'stale_state' using errcode = '55000'; end if;
  begin
    update private.tenant_mengantar_onboarding set partner_seller_id = p_seller_id
    where tenant_id = p_tenant and partner_seller_id is null;
  exception when unique_violation then raise exception 'seller_binding_conflict' using errcode = '23505';
  end;
  update private.seller_credentials c set superseded_at = now(), ciphertext = null, iv = null
    where c.tenant_id = p_tenant and c.provider_env = v_onb.provider_env and c.superseded_at is null;
  insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, created_by, provider_env)
  values (p_tenant, 'partner', p_ciphertext, p_iv, p_key_version, p_hint, v_latest + 1, v_onb.consent_actor_id, v_onb.provider_env);
  update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null
    where tenant_id = p_tenant and mengantar_pickup_address_id is not null;
  update private.tenant_mengantar_onboarding set connection_mode = 'partner_managed', onboarding_state = 'connected',
    last_error_code = null, retry_after_at = null, updated_at = now() where tenant_id = p_tenant;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (v_onb.consent_actor_id, 'partner.onboarding_complete', p_tenant, null, null, 'connected',
    jsonb_build_object('mode', 'partner', 'seller_id', p_seller_id, 'version', v_latest + 1, 'hint', p_hint,
      'provider_env', v_onb.provider_env, 'via', 'machine'));
  return v_latest + 1;
end $$;
revoke all on function public.complete_partner_seller_onboarding(uuid, text, text, text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.complete_partner_seller_onboarding(uuid, text, text, text, text, text, integer, text)
  to service_role;

-- ============================================================ Partner key rotation

-- User session facts: the active credential shown is the one of the onboarding row's environment.
create or replace function public.begin_partner_key_rotation(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; c private.seller_credentials; v_latest integer;
begin
  if private.member_role(p_tenant) is not null and (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  perform private.require_tenant_admin_locked(p_tenant);
  select * into o from private.tenant_mengantar_onboarding where tenant_id = p_tenant;
  select * into c from private.seller_credentials
    where tenant_id = p_tenant and superseded_at is null
    order by (provider_env = o.provider_env) desc nulls last, created_at desc, version desc limit 1;
  select coalesce(max(x.version), 0) into v_latest from private.seller_credentials x where x.tenant_id = p_tenant;
  return jsonb_build_object(
    'connection_mode', o.connection_mode, 'onboarding_state', o.onboarding_state,
    'external_user_id', o.external_user_id, 'partner_seller_id', o.partner_seller_id,
    'last_error_code', o.last_error_code, 'retry_after_at', o.retry_after_at,
    'active_credential_mode', c.mode, 'active_credential_version', c.version,
    'latest_credential_version', v_latest);
end $$;

drop function public.fence_partner_key_rotation(uuid, uuid, text, integer);
create function public.fence_partner_key_rotation(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer, p_env text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; c private.seller_credentials; v_latest integer;
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  o := private.lock_partner_rotation(p_tenant, p_actor, p_seller_id);
  if o.provider_env <> p_env then raise exception 'provider_env_mismatch' using errcode = '42501'; end if;
  select coalesce(max(x.version), 0) into v_latest from private.seller_credentials x where x.tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version then raise exception 'stale_state' using errcode = '55000'; end if;
  select * into c from private.seller_credentials
    where tenant_id = p_tenant and superseded_at is null and provider_env = o.provider_env for update;
  if not found then raise exception 'stale_state' using errcode = '55000'; end if;
  if c.mode <> 'partner' then raise exception 'byok_active' using errcode = '55000'; end if;
  if o.onboarding_state <> 'connected' then raise exception 'rotation_not_available' using errcode = '55000'; end if;
  perform set_config('gx.partner_key_rotation', 'on', true);
  update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where id = c.id;
  update private.tenant_mengantar_onboarding set onboarding_state = 'rotation_unknown',
    last_error_code = 'ROTATION_STARTED', retry_after_at = null, updated_at = now() where tenant_id = p_tenant;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (p_actor, 'credential.partner_rotation_unknown', p_tenant, null, null, 'fenced',
    jsonb_build_object('seller_id', p_seller_id, 'version', c.version, 'provider_env', o.provider_env, 'via', 'machine'));
  return v_latest;
end $$;

-- The outcome records state on the onboarding row only; its credential reads follow the row's
-- environment, which must equal the Worker's.
drop function public.record_partner_key_rotation_outcome(uuid, uuid, text, integer, text, text, integer);
create function public.record_partner_key_rotation_outcome(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer, p_state text, p_error_code text, p_retry_after_seconds integer, p_env text)
returns void language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; c private.seller_credentials; v_latest integer;
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  o := private.lock_partner_rotation(p_tenant, p_actor, p_seller_id);
  if o.provider_env <> p_env then raise exception 'provider_env_mismatch' using errcode = '42501'; end if;
  if coalesce(p_state, '') not in ('rotation_unknown', 'provider_restricted', 'configuration_blocked')
     or char_length(coalesce(p_error_code, '')) > 64 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select coalesce(max(x.version), 0) into v_latest from private.seller_credentials x where x.tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version then raise exception 'stale_state' using errcode = '55000'; end if;
  select * into c from private.seller_credentials
    where tenant_id = p_tenant and superseded_at is null and provider_env = o.provider_env;
  if found then
    if c.mode <> 'partner' then raise exception 'byok_active' using errcode = '55000'; end if;
    raise exception 'stale_state' using errcode = '55000';
  end if;
  if o.onboarding_state <> 'rotation_unknown' then raise exception 'rotation_not_available' using errcode = '55000'; end if;
  update private.tenant_mengantar_onboarding set onboarding_state = p_state, last_error_code = p_error_code,
    retry_after_at = case when p_retry_after_seconds is not null and p_retry_after_seconds >= 0
      then now() + make_interval(secs => least(p_retry_after_seconds, 86400)) else null end,
    updated_at = now() where tenant_id = p_tenant;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (p_actor,
    case when p_state = 'rotation_unknown' then 'credential.partner_rotation_unknown' else 'credential.partner_rotation_refused' end,
    p_tenant, null, null, p_state,
    jsonb_build_object('seller_id', p_seller_id, 'error_code', p_error_code,
      'retry_after_seconds', p_retry_after_seconds, 'version', v_latest, 'via', 'machine'));
end $$;

drop function public.store_partner_seller_key(uuid, uuid, text, integer, text, text, text, text, text);
create function public.store_partner_seller_key(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer, p_ciphertext text, p_iv text, p_key_version text, p_hint text, p_source text,
  p_env text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; c private.seller_credentials; v_latest integer;
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  o := private.lock_partner_rotation(p_tenant, p_actor, p_seller_id);
  if o.provider_env <> p_env then raise exception 'provider_env_mismatch' using errcode = '42501'; end if;
  if coalesce(p_source, '') not in ('regenerated', 'recovered') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select coalesce(max(x.version), 0) into v_latest from private.seller_credentials x where x.tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version then raise exception 'stale_state' using errcode = '55000'; end if;
  select * into c from private.seller_credentials
    where tenant_id = p_tenant and superseded_at is null and provider_env = o.provider_env;
  if found then
    if c.mode <> 'partner' then raise exception 'byok_active' using errcode = '55000'; end if;
    raise exception 'stale_state' using errcode = '55000';
  end if;
  if o.onboarding_state <> 'rotation_unknown' then raise exception 'rotation_not_available' using errcode = '55000'; end if;
  perform set_config('gx.partner_key_rotation', 'on', true);
  insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, created_by, provider_env)
  values (p_tenant, 'partner', p_ciphertext, p_iv, p_key_version, p_hint, v_latest + 1, p_actor, o.provider_env);
  update private.tenant_mengantar_onboarding set onboarding_state = 'connected', last_error_code = null,
    retry_after_at = null, updated_at = now() where tenant_id = p_tenant;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (p_actor, 'credential.partner_' || p_source, p_tenant, null, null, 'stored',
    jsonb_build_object('mode', 'partner', 'seller_id', p_seller_id, 'version', v_latest + 1, 'hint', p_hint,
      'provider_env', o.provider_env, 'via', 'machine'));
  return v_latest + 1;
end $$;

revoke all on function public.fence_partner_key_rotation(uuid, uuid, text, integer, text),
  public.record_partner_key_rotation_outcome(uuid, uuid, text, integer, text, text, integer, text),
  public.store_partner_seller_key(uuid, uuid, text, integer, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.fence_partner_key_rotation(uuid, uuid, text, integer, text),
  public.record_partner_key_rotation_outcome(uuid, uuid, text, integer, text, text, integer, text),
  public.store_partner_seller_key(uuid, uuid, text, integer, text, text, text, text, text, text)
  to service_role;

-- ============================================================ key ring re-wrap

-- Machine only (service_role). The Worker re-seals an ACTIVE credential under the current key of its
-- key ring (open with the stored key version, seal with the current one, same credential version and
-- same associated data) and stores it here. Only ciphertext, iv and key_version change: the
-- credential stays active, its version and environment are untouched, and no superseded row can be
-- written (their ciphertext is null). p_expected_key_version is the fence: a row that was re-wrapped,
-- replaced or removed meanwhile fails with stale_state (55000) and the Worker re-reads.
create function public.rewrap_seller_credential(p_tenant uuid, p_version integer,
  p_expected_key_version text, p_ciphertext text, p_iv text, p_new_key_version text)
returns void language plpgsql security definer set search_path = ''
as $$
declare c private.seller_credentials;
begin
  if coalesce(p_expected_key_version, '') !~ '^v[0-9]{1,4}$' or coalesce(p_new_key_version, '') !~ '^v[0-9]{1,4}$'
     or p_expected_key_version = p_new_key_version or p_version is null or p_version < 1 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into c from private.seller_credentials
    where tenant_id = p_tenant and version = p_version and superseded_at is null for update;
  if not found or c.key_version <> p_expected_key_version then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  update private.seller_credentials set ciphertext = p_ciphertext, iv = p_iv, key_version = p_new_key_version
    where id = c.id;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (null, 'credential.rewrapped', p_tenant, null, null, 'rewrapped',
    jsonb_build_object('version', c.version, 'provider_env', c.provider_env, 'mode', c.mode,
      'from_key_version', p_expected_key_version, 'to_key_version', p_new_key_version, 'via', 'machine'));
end $$;
revoke all on function public.rewrap_seller_credential(uuid, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.rewrap_seller_credential(uuid, integer, text, text, text, text) to service_role;
