-- T-054 independent review fixes (security review of 20261029140000; that file stays immutable).
--
-- M1: a tenant stop (provider_restricted) is reserved for the tenant-level provider codes
--     SELLER_DEACTIVATED and API_KEY_DISABLED. Partner-wide codes (IP_NOT_ALLOWED,
--     PARTNER_DEACTIVATED) describe our own Partner setup: they are no longer stored as a tenant stop
--     by the pre-fence path (the onboarding path records configuration_blocked instead, in TypeScript).
--     A platform operator (integration_operations) can clear a stop after review, with a reason and
--     an audit event, without any provider request; the retry window is kept.
-- L1: authorize_batch_payment takes the batch locks before the admin's membership share lock, the
--     documented order operations -> shipments -> membership -> tenant.
-- L2: a key-rotation outcome never shortens or clears a stored retry window.


create or replace function public.record_partner_preflight_failure(p_tenant uuid, p_actor uuid, p_seller_id text,
  p_expected_version integer, p_env text, p_error_code text, p_retry_after_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
declare o private.tenant_mengantar_onboarding; v_latest integer;
begin
  o := private.lock_partner_rotation(p_tenant, p_actor, p_seller_id);
  if o.provider_env is distinct from p_env then raise exception 'provider_env_mismatch' using errcode = '42501'; end if;
  select coalesce(max(version), 0) into v_latest from private.seller_credentials where tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version or o.onboarding_state <> 'connected' then
    raise exception 'stale_state' using errcode = '55000'; end if;
  if p_error_code is null or p_error_code not in ('RATE_LIMITED', 'SELLER_DEACTIVATED', 'API_KEY_DISABLED') then
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

create or replace function public.record_partner_key_rotation_outcome(p_tenant uuid, p_actor uuid, p_seller_id text,
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
      then greatest(retry_after_at, now() + make_interval(secs => least(p_retry_after_seconds, 86400))) else retry_after_at end,
    updated_at = now() where tenant_id = p_tenant;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (p_actor,
    case when p_state = 'rotation_unknown' then 'credential.partner_rotation_unknown' else 'credential.partner_rotation_refused' end,
    p_tenant, null, null, p_state,
    jsonb_build_object('seller_id', p_seller_id, 'error_code', p_error_code,
      'retry_after_seconds', p_retry_after_seconds, 'version', v_latest, 'via', 'machine'));
end $$;

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
  -- Lock order (as the machine claim): member operations -> member shipments (inside compute) -> the
  -- caller's membership (share, so a concurrent demotion serializes with the re-check) -> the rest.
  v_res := private.compute_unpaid_batch(v_tenant, p_shipment, true);
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
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

create function public.platform_clear_partner_stop(p_tenant uuid, p_reason text)
returns text language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; v_reason text; v_next text;
begin
  perform private.require_platform('integration_operations');
  perform 1 from public.platform_grants where user_id = (select auth.uid()) for share;
  perform private.require_platform('integration_operations');
  v_reason := private.require_reason(p_reason);
  perform 1 from public.tenants where id = p_tenant and not is_demo for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into o from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- A replayed or stale clear changes nothing.
  if o.onboarding_state <> 'provider_restricted' then return o.onboarding_state; end if;
  v_next := case
    when exists (select 1 from private.seller_credentials c where c.tenant_id = p_tenant
      and c.provider_env = o.provider_env and c.superseded_at is null) then 'connected'
    -- A Partner key that was fenced or never stored: recovery fetches the current key (no regenerate).
    when o.connection_mode = 'partner_managed' and o.partner_seller_id is not null then 'rotation_unknown'
    when o.partner_seller_id is not null then 'registered_key_pending'
    else 'not_connected' end;
  update private.tenant_mengantar_onboarding set onboarding_state = v_next, last_error_code = null, updated_at = now()
    where tenant_id = p_tenant;
  perform private.audit('partner.stop_cleared', p_tenant, null, v_reason, v_next,
    jsonb_build_object('from', o.onboarding_state, 'error_code', o.last_error_code, 'provider_env', o.provider_env,
      'retry_after_at', o.retry_after_at));
  return v_next;
end $$;
revoke all on function public.platform_clear_partner_stop(uuid, text) from public, anon;
grant execute on function public.platform_clear_partner_stop(uuid, text) to authenticated;

notify pgrst, 'reload schema';
