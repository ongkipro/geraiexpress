-- T-032 (review P0-1: SEC-01 / DIL-01 / BIZ-01): machine-attested Partner seller binding.
-- A tenant admin must not be able to choose which Mengantar seller their tenant is bound to, so:
--   * the seller id is written only by the Worker's machine identity (service_role) after it has
--     checked the tenant admin with the user's own session and verified the seller with Mengantar;
--   * the id is unique across tenants and write-once;
--   * only tenant admins can read the seller id and the owner's contact details.
-- begin_partner_seller_onboarding stays user-callable: it accepts no seller id and never writes one.

-- Fail loudly if two tenants already share a seller id: which tenant owns it is a provider-side
-- fact that cannot be decided here, and silently dropping or choosing a binding would hand one
-- tenant the other's seller account.
do $$
declare v_dupes integer;
begin
  select count(*) into v_dupes from (
    select partner_seller_id from private.tenant_mengantar_onboarding
    where partner_seller_id is not null
    group by partner_seller_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'T-032 blocked: % partner_seller_id value(s) are bound to more than one tenant in private.tenant_mengantar_onboarding. Resolve each duplicate against Mengantar (sellers/list with externalUserId = geraiexpress:tenant:<tenant id>), clear the wrong binding, then re-run this migration.', v_dupes
      using errcode = '23505';
  end if;
end $$;

create unique index tenant_mengantar_onboarding_partner_seller_uniq
  on private.tenant_mengantar_onboarding (partner_seller_id)
  where partner_seller_id is not null;

create function private.preserve_partner_seller_binding()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.partner_seller_id is not null and new.partner_seller_id is distinct from old.partner_seller_id then
    raise exception 'immutable_partner_seller_id' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger tenant_mengantar_onboarding_immutable_seller
  before update on private.tenant_mengantar_onboarding
  for each row execute function private.preserve_partner_seller_binding();

revoke all on function private.preserve_partner_seller_binding() from public, anon, authenticated;

-- Machine-only. The Worker has already verified the caller is an admin of p_tenant with the user's
-- own session (p_tenant is the server-verified workspace, never form input). The audit actor is the
-- admin who recorded consent for this attempt.
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
          then now() + make_interval(secs => least(p_retry_after_seconds, 86400))
          else null
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

-- Machine-only. Seals the Partner-provisioned seller key and marks onboarding connected. The Worker
-- calls it only after sellers/list proved p_seller_id belongs to geraiexpress:tenant:<p_tenant>.
create or replace function public.complete_partner_seller_onboarding(
  p_tenant uuid,
  p_seller_id text,
  p_ciphertext text,
  p_iv text,
  p_key_version text,
  p_hint text
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_demo boolean;
  v_latest integer;
  v_onb private.tenant_mengantar_onboarding;
begin
  select is_demo into v_demo from public.tenants where id = p_tenant for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_demo then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;

  if coalesce(p_seller_id, '') !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_onb from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found then
    raise exception 'consent_required' using errcode = '22023';
  end if;

  if v_onb.partner_seller_id is not null and v_onb.partner_seller_id <> p_seller_id then
    raise exception 'seller_binding_mismatch' using errcode = '42501';
  end if;

  select coalesce(max(c.version), 0) into v_latest
  from private.seller_credentials c where c.tenant_id = p_tenant;

  begin
    update private.tenant_mengantar_onboarding
    set partner_seller_id = p_seller_id
    where tenant_id = p_tenant and partner_seller_id is null;
  exception when unique_violation then
    raise exception 'seller_binding_conflict' using errcode = '23505';
  end;

  update private.seller_credentials c
  set superseded_at = now(), ciphertext = null, iv = null
  where c.tenant_id = p_tenant and c.superseded_at is null;

  insert into private.seller_credentials (
    tenant_id, mode, ciphertext, iv, key_version, hint, version, created_by
  )
  values (
    p_tenant, 'partner', p_ciphertext, p_iv, p_key_version, p_hint, v_latest + 1, v_onb.consent_actor_id
  );

  update public.outlets
  set mengantar_pickup_address_id = null, mengantar_area_id = null
  where tenant_id = p_tenant and mengantar_pickup_address_id is not null;

  update private.tenant_mengantar_onboarding
  set connection_mode = 'partner_managed',
      onboarding_state = 'connected',
      last_error_code = null,
      retry_after_at = null,
      updated_at = now()
  where tenant_id = p_tenant;

  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (v_onb.consent_actor_id, 'partner.onboarding_complete', p_tenant, null, null, 'connected',
    jsonb_build_object(
      'mode', 'partner',
      'seller_id', p_seller_id,
      'version', v_latest + 1,
      'hint', p_hint,
      'via', 'machine'
    ));

  return v_latest + 1;
end $$;

-- The seller id and the owner's contact details are for tenant admins only; operators see state.
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
    left join private.seller_credentials c on c.tenant_id = p_tenant and c.superseded_at is null;
end $$;

revoke all on function
  public.record_partner_seller_onboarding_outcome(uuid, text, text, text, integer),
  public.complete_partner_seller_onboarding(uuid, text, text, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.record_partner_seller_onboarding_outcome(uuid, text, text, text, integer),
  public.complete_partner_seller_onboarding(uuid, text, text, text, text, text)
to service_role;

revoke all on function public.partner_onboarding_status(uuid) from public, anon;
grant execute on function public.partner_onboarding_status(uuid) to authenticated;
