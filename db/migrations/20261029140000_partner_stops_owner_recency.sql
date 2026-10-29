-- T-054: durable Partner stops, owner TOTP recency, consistent batch locks.


create function private.require_partner_available(o private.tenant_mengantar_onboarding)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if o.onboarding_state = 'provider_restricted' then
    raise exception 'provider_restricted' using errcode = '55000';
  end if;
  if o.retry_after_at > now() then
    raise exception 'partner_retry_after' using errcode = '55000';
  end if;
end $$;
revoke all on function private.require_partner_available(private.tenant_mengantar_onboarding) from public, anon, authenticated;


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
  perform private.require_partner_available(o);
  -- A key regeneration is in flight (the old key is fenced, the new one not stored yet): a
  -- registration now could fetch and store the PRE-rotation key (security review L1).
  if o.onboarding_state = 'rotation_unknown' then raise exception 'rotation_unknown' using errcode = '55000'; end if;
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
  perform private.require_partner_available(o);
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
  perform private.require_partner_available(o);
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

create or replace function public.fence_partner_key_rotation(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer, p_env text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; c private.seller_credentials; v_latest integer;
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  o := private.lock_partner_rotation(p_tenant, p_actor, p_seller_id);
  perform private.require_partner_available(o);
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

create or replace function private.platform_capable(p_capability text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
     and exists (
       select 1 from jsonb_array_elements(case when jsonb_typeof((select auth.jwt())->'amr') = 'array'
         then (select auth.jwt())->'amr' else '[]'::jsonb end) m
       where m->>'method' = 'totp' and case when m->>'timestamp' ~ '^[0-9]{1,12}$'
         then (m->>'timestamp')::bigint between extract(epoch from now() - interval '12 hours') and extract(epoch from now())
         else false end)
     and exists (
       select 1 from public.platform_grants g
       where g.user_id = (select auth.uid()) and g.revoked_at is null
         and p_capability = any (g.capabilities));
$$;

create or replace function public.authorize_batch_payment(p_shipment uuid, p_batch_digest text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_res jsonb;
  v_batch text;
  v_id uuid;
  v_expires timestamptz := now() + interval '5 minutes';
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  -- Share-lock the caller's membership so a concurrent demotion serializes with this check.
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  v_res := private.compute_unpaid_batch(v_tenant, p_shipment, true);
  if coalesce(p_batch_digest, '') <> (v_res->>'batch_digest') then
    raise exception 'batch_digest_mismatch' using errcode = '55000';
  end if;
  v_batch := v_res->>'batch';

  -- An earlier request may already be on the wire or unresolved: no new spend is authorized, the
  -- Worker reconciles the original attempt instead.
  if exists (select 1 from private.batch_payment_attempts a
      where a.tenant_id = v_tenant and a.batch_code = v_batch and a.state in ('sent', 'unknown')) then
    perform private.audit('shipment.batch_pay', v_tenant, null, null, 'authorization_withheld',
      jsonb_build_object('shipment', p_shipment, 'batch', v_batch, 'batch_digest', p_batch_digest, 'reason', 'payment_unresolved'));
    return jsonb_build_object('authorized', false, 'reason', 'payment_unresolved', 'batch', v_batch);
  end if;

  update private.batch_payment_authorizations
    set superseded_at = now()
    where tenant_id = v_tenant and shipment_id = p_shipment and batch_digest = p_batch_digest
      and consumed_at is null and superseded_at is null;
  insert into private.batch_payment_authorizations (tenant_id, shipment_id, batch_code, batch_digest, actor, expires_at)
    values (v_tenant, p_shipment, v_batch, p_batch_digest, (select auth.uid()), v_expires)
    returning id into v_id;
  perform private.audit('shipment.batch_pay', v_tenant, null, null, 'authorized',
    jsonb_build_object('authorization', v_id, 'shipment', p_shipment, 'batch', v_batch, 'batch_digest', p_batch_digest,
      'expires_at', v_expires, 'member_count', v_res->'member_count', 'total_charge_idr', v_res->'total_charge_idr'));
  return jsonb_build_object('authorized', true, 'authorization_id', v_id, 'expires_at', v_expires,
    'batch', v_batch, 'batch_digest', p_batch_digest);
end $$;

-- The pre-fence list request may be throttled/restricted while a credential is still active.
create function public.record_partner_preflight_failure(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer, p_env text, p_error_code text, p_retry_after_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
declare o private.tenant_mengantar_onboarding; v_latest integer;
begin
  o := private.lock_partner_rotation(p_tenant, p_actor, p_seller_id);
  if o.provider_env is distinct from p_env then raise exception 'provider_env_mismatch' using errcode = '42501'; end if;
  select coalesce(max(version), 0) into v_latest from private.seller_credentials where tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version or o.onboarding_state <> 'connected' then
    raise exception 'stale_state' using errcode = '55000'; end if;
  if p_error_code is null or p_error_code not in ('RATE_LIMITED', 'PARTNER_DEACTIVATED', 'IP_NOT_ALLOWED', 'SELLER_DEACTIVATED', 'API_KEY_DISABLED') then
    raise exception 'invalid_input' using errcode = '22023'; end if;
  update private.tenant_mengantar_onboarding set
    onboarding_state = case when p_error_code = 'RATE_LIMITED' then onboarding_state else 'provider_restricted' end,
    last_error_code = p_error_code,
    retry_after_at = case when p_error_code = 'RATE_LIMITED'
      then greatest(retry_after_at, now() + make_interval(secs => greatest(1, least(coalesce(p_retry_after_seconds, 60), 86400))))
      else retry_after_at end, updated_at = now()
    where tenant_id = p_tenant;
  insert into public.audit_events(actor, action, target_tenant, outcome, detail)
    values (p_actor, 'partner.preflight_refused', p_tenant, p_error_code, jsonb_build_object('provider_env', p_env));
end $$;
revoke all on function public.record_partner_preflight_failure(uuid, uuid, text, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_partner_preflight_failure(uuid, uuid, text, integer, text, text, integer) to service_role;


create or replace function public.record_partner_seller_onboarding_outcome(
  p_tenant uuid,
  p_state text,
  p_seller_id text default null,
  p_error_code text default null,
  p_retry_after_seconds integer default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_demo boolean;
  v_onb private.tenant_mengantar_onboarding;
begin
  select is_demo into v_demo from public.tenants where id = p_tenant for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_demo then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;

  if coalesce(p_state, '') not in (
    'not_connected',
    'consent_recorded',
    'registered_key_pending',
    'existing_account_required',
    'quota_wait',
    'provider_restricted',
    'configuration_blocked'
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_seller_id is not null and p_seller_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_onb from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found then
    raise exception 'consent_required' using errcode = '22023';
  end if;

  -- A delayed onboarding result may not undo a provider stop or a rotation fence.
  if v_onb.onboarding_state = 'rotation_unknown' then raise exception 'rotation_unknown' using errcode = '55000'; end if;
  if p_state <> 'provider_restricted' then perform private.require_partner_available(v_onb); end if;
  if p_seller_id is not null and v_onb.partner_seller_id is not null
     and p_seller_id <> v_onb.partner_seller_id then
    raise exception 'seller_binding_mismatch' using errcode = '42501';
  end if;

  begin
    update private.tenant_mengantar_onboarding
    set onboarding_state = p_state,
        partner_seller_id = coalesce(p_seller_id, partner_seller_id),
        last_error_code = p_error_code,
        retry_after_at = case
          when p_retry_after_seconds is not null and p_retry_after_seconds >= 0
          then greatest(retry_after_at, now() + make_interval(secs => least(p_retry_after_seconds, 86400)))
          else retry_after_at
        end,
        updated_at = now()
    where tenant_id = p_tenant;
  exception when unique_violation then
    raise exception 'seller_binding_conflict' using errcode = '23505';
  end;

  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (v_onb.consent_actor_id, 'partner.onboarding_outcome', p_tenant, null, null, p_state,
    jsonb_build_object(
      'seller_id', p_seller_id,
      'error_code', p_error_code,
      'retry_after_seconds', p_retry_after_seconds,
      'via', 'machine'
    ));
end $$;
create or replace function public.complete_partner_seller_onboarding(p_tenant uuid, p_seller_id text,
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
  perform private.require_partner_available(v_onb);
  if v_onb.provider_env <> p_env then raise exception 'provider_env_mismatch' using errcode = '42501'; end if;
  -- Same guard as the begin: never store a key while a regeneration is in flight (L1). The way out
  -- of rotation_unknown is store_partner_seller_key, not an onboarding completion.
  if v_onb.onboarding_state = 'rotation_unknown' then raise exception 'rotation_unknown' using errcode = '55000'; end if;
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
notify pgrst, 'reload schema';
