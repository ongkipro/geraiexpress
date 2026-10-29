-- T-039 / PR-19 / DEC-013: Partner-managed seller key regeneration and recovery.
-- Mengantar's regenerate endpoint ends the old key immediately and returns the new one once, so
-- the database fences new work BEFORE the Worker calls it:
--   * fence_partner_key_rotation records the rotation intent: the active Partner credential is
--     superseded (its ciphertext is cleared) and the onboarding row moves to 'rotation_unknown'.
--     From that moment no code path can open a key for the tenant (machine_seller_key, claim,
--     quoting and issuing all read the single active credential), so nothing is sent with a key
--     the provider may already have retired. A Worker that dies mid-call leaves exactly this state.
--   * store_partner_seller_key stores the new key (regenerated, or fetched again by recovery) with
--     the expected-version fence, and only from 'rotation_unknown'; the state returns to 'connected'.
--   * record_partner_key_rotation_outcome keeps 'rotation_unknown' (lost or refused response, with
--     the Retry-After hint) or ends the flow in a stop state (provider_restricted,
--     configuration_blocked).
-- A BYOK credential is never touched: every writer refuses when the active credential is BYOK, and
-- a BYOK key stored since the Worker's begin changes the version, so the fence fails (55000).
-- The Worker is the only caller of the three machine functions, after verifying the actor with the
-- user's own session; callbackSecret never reaches the database.

alter table private.tenant_mengantar_onboarding drop constraint tenant_mengantar_onboarding_onboarding_state_check;
alter table private.tenant_mengantar_onboarding add constraint tenant_mengantar_onboarding_onboarding_state_check
  check (onboarding_state in (
    'not_connected', 'consent_recorded', 'registration_pending', 'registered_key_pending', 'connected',
    'existing_account_required', 'quota_wait', 'provider_restricted', 'configuration_blocked',
    'rotation_unknown'
  ));

-- A replaced or removed key normally means another seller account, so outlet pickup addresses are
-- cleared. A rotation of the SAME verified Partner seller keeps its pickup addresses valid: the
-- rotation functions below set this transaction-local flag around their own credential writes.
create or replace function private.clear_outlet_mengantar_pickup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('gx.partner_key_rotation', true), '') = 'on' then return null; end if;
  update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null
    where tenant_id = new.tenant_id and mengantar_pickup_address_id is not null;
  return null;
end $$;

-- Shared preamble of the machine functions: locks in the order every credential writer uses
-- (memberships, tenant, onboarding row) and proves actor, tenant and seller binding.
create function private.lock_partner_rotation(p_tenant uuid, p_actor uuid, p_seller_id text)
returns private.tenant_mengantar_onboarding language plpgsql security definer set search_path = ''
as $$
declare v_demo boolean; v_lifecycle text; o private.tenant_mengantar_onboarding;
begin
  perform 1 from public.memberships where tenant_id = p_tenant for update;
  select is_demo, lifecycle into v_demo, v_lifecycle from public.tenants where id = p_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_demo then raise exception 'demo_restricted' using errcode = '42501'; end if;
  if v_lifecycle <> 'active' then raise exception 'tenant_not_active' using errcode = '55000'; end if;
  if p_actor is null or not exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = p_actor and m.role = 'tenant_admin' and m.status = 'active'
  ) then raise exception 'admin_required' using errcode = '42501'; end if;
  if coalesce(p_seller_id, '') !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
  select * into o from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found or o.connection_mode <> 'partner_managed' or o.partner_seller_id is null then
    raise exception 'not_partner_managed' using errcode = '55000';
  end if;
  if o.partner_seller_id <> p_seller_id then raise exception 'seller_binding_mismatch' using errcode = '42501'; end if;
  return o;
end $$;
revoke all on function private.lock_partner_rotation(uuid, uuid, text) from public, anon, authenticated;

-- User session: the facts the Worker needs before it touches the provider. Mutates nothing, never
-- returns key material. Tenant administrators only; demo tenants refused.
create function public.begin_partner_key_rotation(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; c private.seller_credentials; v_latest integer;
begin
  if private.member_role(p_tenant) is not null and (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  perform private.require_tenant_admin_locked(p_tenant);
  select * into o from private.tenant_mengantar_onboarding where tenant_id = p_tenant;
  select * into c from private.seller_credentials where tenant_id = p_tenant and superseded_at is null;
  select coalesce(max(x.version), 0) into v_latest from private.seller_credentials x where x.tenant_id = p_tenant;
  return jsonb_build_object(
    'connection_mode', o.connection_mode, 'onboarding_state', o.onboarding_state,
    'external_user_id', o.external_user_id, 'partner_seller_id', o.partner_seller_id,
    'last_error_code', o.last_error_code, 'retry_after_at', o.retry_after_at,
    'active_credential_mode', c.mode, 'active_credential_version', c.version,
    'latest_credential_version', v_latest);
end $$;
revoke all on function public.begin_partner_key_rotation(uuid) from public, anon;
grant execute on function public.begin_partner_key_rotation(uuid) to authenticated;

-- Machine only. Records the rotation intent and removes the active Partner key from every reader.
create function public.fence_partner_key_rotation(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; c private.seller_credentials; v_latest integer;
begin
  o := private.lock_partner_rotation(p_tenant, p_actor, p_seller_id);
  select coalesce(max(x.version), 0) into v_latest from private.seller_credentials x where x.tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version then raise exception 'stale_state' using errcode = '55000'; end if;
  select * into c from private.seller_credentials where tenant_id = p_tenant and superseded_at is null for update;
  if not found then raise exception 'stale_state' using errcode = '55000'; end if;
  if c.mode <> 'partner' then raise exception 'byok_active' using errcode = '55000'; end if;
  if o.onboarding_state <> 'connected' then raise exception 'rotation_not_available' using errcode = '55000'; end if;
  perform set_config('gx.partner_key_rotation', 'on', true);
  update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where id = c.id;
  update private.tenant_mengantar_onboarding set onboarding_state = 'rotation_unknown',
    last_error_code = 'ROTATION_STARTED', retry_after_at = null, updated_at = now() where tenant_id = p_tenant;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (p_actor, 'credential.partner_rotation_unknown', p_tenant, null, null, 'fenced',
    jsonb_build_object('seller_id', p_seller_id, 'version', c.version, 'via', 'machine'));
  return v_latest;
end $$;

-- Machine only. After the fence: keep 'rotation_unknown' (response lost or refused for a reason that
-- does not end the flow; Retry-After is only recorded) or end the flow in a stop state.
create function public.record_partner_key_rotation_outcome(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer, p_state text, p_error_code text, p_retry_after_seconds integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; c private.seller_credentials; v_latest integer;
begin
  o := private.lock_partner_rotation(p_tenant, p_actor, p_seller_id);
  if coalesce(p_state, '') not in ('rotation_unknown', 'provider_restricted', 'configuration_blocked')
     or char_length(coalesce(p_error_code, '')) > 64 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select coalesce(max(x.version), 0) into v_latest from private.seller_credentials x where x.tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version then raise exception 'stale_state' using errcode = '55000'; end if;
  select * into c from private.seller_credentials where tenant_id = p_tenant and superseded_at is null;
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

-- Machine only. Stores the sealed key the provider reported (p_source 'regenerated' from the
-- regenerate response, 'recovered' from sellers/api-key). The Worker bound the ciphertext to version
-- p_expected_version + 1. Only valid while the rotation marker is set and no credential is active.
create function public.store_partner_seller_key(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer, p_ciphertext text, p_iv text, p_key_version text, p_hint text, p_source text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; c private.seller_credentials; v_latest integer;
begin
  o := private.lock_partner_rotation(p_tenant, p_actor, p_seller_id);
  if coalesce(p_source, '') not in ('regenerated', 'recovered') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select coalesce(max(x.version), 0) into v_latest from private.seller_credentials x where x.tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version then raise exception 'stale_state' using errcode = '55000'; end if;
  select * into c from private.seller_credentials where tenant_id = p_tenant and superseded_at is null;
  if found then
    if c.mode <> 'partner' then raise exception 'byok_active' using errcode = '55000'; end if;
    raise exception 'stale_state' using errcode = '55000';
  end if;
  if o.onboarding_state <> 'rotation_unknown' then raise exception 'rotation_not_available' using errcode = '55000'; end if;
  perform set_config('gx.partner_key_rotation', 'on', true);
  insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, created_by)
  values (p_tenant, 'partner', p_ciphertext, p_iv, p_key_version, p_hint, v_latest + 1, p_actor);
  update private.tenant_mengantar_onboarding set onboarding_state = 'connected', last_error_code = null,
    retry_after_at = null, updated_at = now() where tenant_id = p_tenant;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (p_actor, 'credential.partner_' || p_source, p_tenant, null, null, 'stored',
    jsonb_build_object('mode', 'partner', 'seller_id', p_seller_id, 'version', v_latest + 1, 'hint', p_hint,
      'via', 'machine'));
  return v_latest + 1;
end $$;

revoke all on function public.fence_partner_key_rotation(uuid, uuid, text, integer),
  public.record_partner_key_rotation_outcome(uuid, uuid, text, integer, text, text, integer),
  public.store_partner_seller_key(uuid, uuid, text, integer, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.fence_partner_key_rotation(uuid, uuid, text, integer),
  public.record_partner_key_rotation_outcome(uuid, uuid, text, integer, text, text, integer),
  public.store_partner_seller_key(uuid, uuid, text, integer, text, text, text, text, text)
  to service_role;
