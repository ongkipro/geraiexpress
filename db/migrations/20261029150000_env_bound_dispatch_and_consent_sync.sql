-- T-057: environment-bound dispatcher credential reads and server-synchronized Partner consent versions.
--
-- 1. dispatch_begin_reconcile, dispatch_begin_payment_check and dispatch_begin_batch_payment return a
--    sealed provider credential. They now take a mandatory p_env and refuse (rolling back every side
--    effect of the claim) when the operation belongs to another provider environment, so a sandbox
--    runtime can never receive a production credential or the reverse. The old bodies move to the
--    private schema unchanged (no drift) and lose every grant; the old public overloads are gone.
-- 2. The configured Partner Terms/Privacy versions are synchronized by the server (service_role only)
--    into private.settings per provider environment. A user-session begin must send exactly those
--    versions; unconfigured or mismatched versions are refused. Completion re-checks that a complete
--    consent record is stored. No authenticated setter exists.

create function private.require_provider_env(p_env text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
end $$;
revoke all on function private.require_provider_env(text) from public, anon, authenticated;

create function private.require_payload_env(p_payload jsonb, p_env text)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if p_payload->>'provider_env' is distinct from p_env then
    raise exception 'provider_env_mismatch' using errcode = '42501';
  end if;
  return p_payload;
end $$;
revoke all on function private.require_payload_env(jsonb, text) from public, anon, authenticated;

alter function public.dispatch_begin_reconcile(uuid) set schema private;
alter function private.dispatch_begin_reconcile(uuid) rename to dispatch_begin_reconcile_any_env;
revoke all on function private.dispatch_begin_reconcile_any_env(uuid) from public, anon, authenticated, service_role;
create function public.dispatch_begin_reconcile(p_operation uuid, p_env text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_env(p_env);
  return private.require_payload_env(private.dispatch_begin_reconcile_any_env(p_operation), p_env);
end $$;

alter function public.dispatch_begin_payment_check(uuid) set schema private;
alter function private.dispatch_begin_payment_check(uuid) rename to dispatch_begin_payment_check_any_env;
revoke all on function private.dispatch_begin_payment_check_any_env(uuid) from public, anon, authenticated, service_role;
create function public.dispatch_begin_payment_check(p_operation uuid, p_env text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_env(p_env);
  return private.require_payload_env(private.dispatch_begin_payment_check_any_env(p_operation), p_env);
end $$;

alter function public.dispatch_begin_batch_payment(uuid, uuid, text) set schema private;
alter function private.dispatch_begin_batch_payment(uuid, uuid, text) rename to dispatch_begin_batch_payment_any_env;
revoke all on function private.dispatch_begin_batch_payment_any_env(uuid, uuid, text) from public, anon, authenticated, service_role;
-- PostgreSQL requires defaults after the first defaulted argument; p_env is still mandatory (a call
-- without it is refused with invalid_environment before anything is locked).
create function public.dispatch_begin_batch_payment(p_tenant uuid default null, p_shipment uuid default null,
  p_batch_digest text default null, p_env text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_env(p_env);
  return private.require_payload_env(private.dispatch_begin_batch_payment_any_env(p_tenant, p_shipment, p_batch_digest), p_env);
end $$;

revoke all on function public.dispatch_begin_reconcile(uuid, text), public.dispatch_begin_payment_check(uuid, text),
  public.dispatch_begin_batch_payment(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.dispatch_begin_reconcile(uuid, text), public.dispatch_begin_payment_check(uuid, text),
  public.dispatch_begin_batch_payment(uuid, uuid, text, text) to service_role;

create function public.sync_partner_consent_versions(p_env text, p_terms_version text, p_privacy_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_terms text := btrim(coalesce(p_terms_version, '')); v_privacy text := btrim(coalesce(p_privacy_version, ''));
begin
  perform private.require_provider_env(p_env);
  if char_length(v_terms) not between 1 and 64 or char_length(v_privacy) not between 1 and 64 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  insert into private.settings (key, value, updated_at)
    values ('partner_consent_versions:' || p_env, jsonb_build_object('terms', v_terms, 'privacy', v_privacy), now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where private.settings.value is distinct from excluded.value;
end $$;
revoke all on function public.sync_partner_consent_versions(text, text, text) from public, anon, authenticated;
grant execute on function public.sync_partner_consent_versions(text, text, text) to service_role;

create function private.require_current_partner_consent(p_env text, p_terms_version text, p_privacy_version text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select s.value into v from private.settings s where s.key = 'partner_consent_versions:' || p_env;
  if v is null then raise exception 'consent_versions_unconfigured' using errcode = '55000'; end if;
  if v->>'terms' is distinct from p_terms_version or v->>'privacy' is distinct from p_privacy_version then
    raise exception 'consent_version_mismatch' using errcode = '22023';
  end if;
end $$;
revoke all on function private.require_current_partner_consent(text, text, text) from public, anon, authenticated;


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
  -- T-057: only the versions the server synchronized for this environment can be agreed to.
  perform private.require_current_partner_consent(coalesce(o.provider_env, 'sandbox'), v_terms, v_privacy);
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
  -- The consent agreed at begin must still be on record (direct Data API writers cannot skip it).
  if v_onb.consent_actor_id is null or v_onb.consent_recorded_at is null
     or nullif(btrim(v_onb.terms_version), '') is null or nullif(btrim(v_onb.privacy_version), '') is null then
    raise exception 'consent_required' using errcode = '22023';
  end if;
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
