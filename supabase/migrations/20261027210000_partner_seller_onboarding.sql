-- T-027: Mengantar Partner API sandbox seller onboarding in /pengaturan (PR-17, PR-20, DEC-006).
-- Tracks per-tenant Partner seller onboarding state, immutable external_user_id, owner disclosure
-- and Terms/Privacy consent, partial-provisioning recovery (503 KEY_PROVISIONING_FAILED), and
-- existing-account BYOK routing (409 EMAIL_ALREADY_REGISTERED) without ever exposing key material.

create table private.tenant_mengantar_onboarding (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  external_user_id text not null unique
    check (external_user_id = 'geraiexpress:tenant:' || tenant_id::text),
  connection_mode text not null default 'none'
    check (connection_mode in ('none', 'byok', 'partner_managed')),
  onboarding_state text not null default 'not_connected'
    check (onboarding_state in (
      'not_connected',
      'consent_recorded',
      'registration_pending',
      'registered_key_pending',
      'connected',
      'existing_account_required',
      'quota_wait',
      'provider_restricted',
      'configuration_blocked'
    )),
  partner_seller_id text null
    check (partner_seller_id is null or partner_seller_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  owner_name text not null
    check (owner_name ~ '^[A-Za-z0-9 ._''@-]{1,100}$'),
  owner_email text not null
    check (char_length(owner_email) <= 254 and owner_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  owner_phone text not null
    check (owner_phone ~ '^(?:\+?62|0)8[0-9]{8,13}$'),
  terms_version text not null
    check (char_length(btrim(terms_version)) between 1 and 64),
  privacy_version text not null
    check (char_length(btrim(privacy_version)) between 1 and 64),
  consent_actor_id uuid not null references auth.users (id),
  consent_recorded_at timestamptz not null default now(),
  last_error_code text null
    check (last_error_code is null or char_length(last_error_code) <= 64),
  retry_after_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table private.tenant_mengantar_onboarding enable row level security;
revoke all on private.tenant_mengantar_onboarding from public, anon, authenticated;

create function private.preserve_immutable_onboarding_identity()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.external_user_id is distinct from old.external_user_id then
    raise exception 'immutable_external_user_id' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger tenant_mengantar_onboarding_immutable_id
  before update on private.tenant_mengantar_onboarding
  for each row execute function private.preserve_immutable_onboarding_identity();

-- PR-17 / PR-20 / DEC-006: record owner identity + affirmative agreement and transition to
-- registration_pending before the Worker calls Mengantar Partner API.
create function public.begin_partner_seller_onboarding(
  p_tenant uuid,
  p_owner_name text,
  p_owner_email text,
  p_owner_phone text,
  p_terms_version text,
  p_privacy_version text,
  p_agreed boolean
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_owner_name, ''));
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
  v_phone text := regexp_replace(btrim(coalesce(p_owner_phone, '')), '[\s()-]+', '', 'g');
  v_terms text := btrim(coalesce(p_terms_version, ''));
  v_privacy text := btrim(coalesce(p_privacy_version, ''));
  v_ext_id text;
  v_seller_id text;
  v_latest_ver integer;
begin
  if private.member_role(p_tenant) is not null and (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  perform private.require_tenant_admin_locked(p_tenant);
  perform 1 from public.tenants where id = p_tenant for update;

  if coalesce(p_agreed, false) is not true
     or char_length(v_terms) not between 1 and 64
     or char_length(v_privacy) not between 1 and 64 then
    raise exception 'consent_required' using errcode = '22023';
  end if;

  if v_name !~ '^[A-Za-z0-9 ._''@-]{1,100}$'
     or char_length(v_email) > 254
     or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or v_email like '%@geraiexpress.local'
     or v_email like '%@example.com'
     or v_phone !~ '^(?:\+?62|0)8[0-9]{8,13}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if exists (select 1 from private.seller_credentials c where c.tenant_id = p_tenant and c.superseded_at is null)
     and exists (select 1 from private.tenant_mengantar_onboarding o where o.tenant_id = p_tenant and o.onboarding_state = 'connected') then
    raise exception 'already_partner_connected' using errcode = '23505';
  end if;

  v_ext_id := 'geraiexpress:tenant:' || p_tenant::text;

  insert into private.tenant_mengantar_onboarding (
    tenant_id, external_user_id, connection_mode, onboarding_state,
    owner_name, owner_email, owner_phone,
    terms_version, privacy_version, consent_actor_id, consent_recorded_at,
    last_error_code, retry_after_at, updated_at
  )
  values (
    p_tenant, v_ext_id, 'none', 'registration_pending',
    v_name, v_email, v_phone,
    v_terms, v_privacy, (select auth.uid()), now(),
    null, null, now()
  )
  on conflict (tenant_id) do update set
    onboarding_state = 'registration_pending',
    owner_name = excluded.owner_name,
    owner_email = excluded.owner_email,
    owner_phone = excluded.owner_phone,
    terms_version = excluded.terms_version,
    privacy_version = excluded.privacy_version,
    consent_actor_id = excluded.consent_actor_id,
    consent_recorded_at = now(),
    last_error_code = null,
    retry_after_at = null,
    updated_at = now()
  returning external_user_id, partner_seller_id into v_ext_id, v_seller_id;

  select coalesce(max(c.version), 0) into v_latest_ver
  from private.seller_credentials c where c.tenant_id = p_tenant;

  perform private.audit('partner.onboarding_begin', p_tenant, null, null, 'registration_pending',
    jsonb_build_object(
      'external_user_id', v_ext_id,
      'partner_seller_id', v_seller_id,
      'terms_version', v_terms,
      'privacy_version', v_privacy
    ));

  return jsonb_build_object(
    'external_user_id', v_ext_id,
    'partner_seller_id', v_seller_id,
    'latest_credential_version', v_latest_ver
  );
end $$;

-- Seal the Partner-provisioned seller API key and mark onboarding connected.
create function public.complete_partner_seller_onboarding(
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
  v_latest integer;
  v_onb private.tenant_mengantar_onboarding;
begin
  if private.member_role(p_tenant) is not null and (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  perform private.require_tenant_admin_locked(p_tenant);
  perform 1 from public.tenants where id = p_tenant for update;

  if coalesce(p_seller_id, '') !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_onb from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found then
    raise exception 'consent_required' using errcode = '22023';
  end if;

  select coalesce(max(c.version), 0) into v_latest
  from private.seller_credentials c where c.tenant_id = p_tenant;

  update private.seller_credentials c
  set superseded_at = now(), ciphertext = null, iv = null
  where c.tenant_id = p_tenant and c.superseded_at is null;

  insert into private.seller_credentials (
    tenant_id, mode, ciphertext, iv, key_version, hint, version, created_by
  )
  values (
    p_tenant, 'partner', p_ciphertext, p_iv, p_key_version, p_hint, v_latest + 1, (select auth.uid())
  );

  update public.outlets
  set mengantar_pickup_address_id = null, mengantar_area_id = null
  where tenant_id = p_tenant and mengantar_pickup_address_id is not null;

  update private.tenant_mengantar_onboarding
  set connection_mode = 'partner_managed',
      onboarding_state = 'connected',
      partner_seller_id = p_seller_id,
      last_error_code = null,
      retry_after_at = null,
      updated_at = now()
  where tenant_id = p_tenant;

  perform private.audit('partner.onboarding_complete', p_tenant, null, null, 'connected',
    jsonb_build_object(
      'mode', 'partner',
      'seller_id', p_seller_id,
      'version', v_latest + 1,
      'hint', p_hint
    ));

  return v_latest + 1;
end $$;

-- Record non-connected outcomes (503 registered_key_pending, 409 existing_account_required,
-- 429 quota_wait, 403 provider_restricted, or configuration_blocked).
create function public.record_partner_seller_onboarding_outcome(
  p_tenant uuid,
  p_state text,
  p_seller_id text default null,
  p_error_code text default null,
  p_retry_after_seconds integer default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if private.member_role(p_tenant) is not null and (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  perform private.require_tenant_admin_locked(p_tenant);
  perform 1 from public.tenants where id = p_tenant for update;

  if coalesce(p_state, '') not in (
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

  perform private.audit('partner.onboarding_outcome', p_tenant, null, null, p_state,
    jsonb_build_object(
      'seller_id', p_seller_id,
      'error_code', p_error_code,
      'retry_after_seconds', p_retry_after_seconds
    ));
end $$;

-- Read-only onboarding projection for any active member of the tenant. Never returns keys/secrets.
create function public.partner_onboarding_status(p_tenant uuid)
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
begin
  if private.member_role(p_tenant) is null then
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
      o.partner_seller_id,
      o.owner_name,
      o.owner_email,
      o.owner_phone,
      o.consent_recorded_at,
      o.last_error_code,
      o.retry_after_at
    from (select 1) one
    left join private.tenant_mengantar_onboarding o on o.tenant_id = p_tenant
    left join private.seller_credentials c on c.tenant_id = p_tenant and c.superseded_at is null;
end $$;

revoke all on function
  public.begin_partner_seller_onboarding(uuid, text, text, text, text, text, boolean),
  public.complete_partner_seller_onboarding(uuid, text, text, text, text, text),
  public.record_partner_seller_onboarding_outcome(uuid, text, text, text, integer),
  public.partner_onboarding_status(uuid)
from public, anon;

grant execute on function
  public.begin_partner_seller_onboarding(uuid, text, text, text, text, text, boolean),
  public.complete_partner_seller_onboarding(uuid, text, text, text, text, text),
  public.record_partner_seller_onboarding_outcome(uuid, text, text, text, integer),
  public.partner_onboarding_status(uuid)
to authenticated;
