-- Mengantar credential storage: PR-18 (BYOK storage), PR-26 (readiness), IAM-3, SEC-3, DATA-4,
-- DEC-006. The Worker encrypts a seller API key (AES-GCM, key held only as a Worker secret, AAD
-- binding tenant and version) before it reaches the database; the database stores ciphertext
-- in the private schema, which no API role can read. No RPC returns ciphertext or key material:
-- humans see only "configured", a 4-character hint, version and time. Storing a key is not a
-- verified connection; verification against Mengantar is a separate, gated capability.
-- The Partner Secret is never stored here: it is a Worker secret binding (research doc §2).

create table private.seller_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  mode text not null check (mode in ('byok', 'partner')),
  -- Cleared when the key is replaced or removed: only metadata outlives an active key.
  ciphertext text check (char_length(ciphertext) between 16 and 4096),
  iv text check (char_length(iv) between 12 and 64),
  key_version text not null check (key_version ~ '^v[0-9]{1,4}$'),
  hint text not null check (hint ~ '^[!-~]{2,4}$'),
  version integer not null check (version > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (tenant_id, version),
  check ((superseded_at is null) = (ciphertext is not null and iv is not null))
);
create unique index seller_credentials_one_active on private.seller_credentials (tenant_id)
  where superseded_at is null;
alter table private.seller_credentials enable row level security;
revoke all on private.seller_credentials from public, anon, authenticated;

insert into private.settings (key, value) values ('mengantar_partner_id', 'null');

-- Store (or replace) the tenant's BYOK key. p_expected_version is the latest version the admin
-- saw (0 when none ever existed); the new row gets p_expected_version + 1, which is also bound
-- into the Worker's AES-GCM associated data, so ciphertext cannot be replayed into another
-- tenant or version. The membership lock in require_tenant_admin_locked serializes writers.
create function public.store_seller_credential(p_tenant uuid, p_expected_version integer,
  p_ciphertext text, p_iv text, p_key_version text, p_hint text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_latest integer;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  select coalesce(max(c.version), 0) into v_latest from private.seller_credentials c where c.tenant_id = p_tenant;
  if v_latest <> coalesce(p_expected_version, -1) then
    raise exception 'stale_state' using errcode = '40001';
  end if;
  update private.seller_credentials c set superseded_at = now(), ciphertext = null, iv = null
    where c.tenant_id = p_tenant and c.superseded_at is null;
  insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, created_by)
    values (p_tenant, 'byok', p_ciphertext, p_iv, p_key_version, p_hint, v_latest + 1, (select auth.uid()));
  perform private.audit('credential.store', p_tenant, null, null, 'stored',
    jsonb_build_object('mode', 'byok', 'version', v_latest + 1, 'hint', p_hint));
  return v_latest + 1;
end $$;

create function public.remove_seller_credential(p_tenant uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_current integer;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  select c.version into v_current from private.seller_credentials c
    where c.tenant_id = p_tenant and c.superseded_at is null for update;
  if v_current is null or v_current <> p_expected_version then
    raise exception 'stale_state' using errcode = '40001';
  end if;
  update private.seller_credentials c set superseded_at = now(), ciphertext = null, iv = null
    where c.tenant_id = p_tenant and c.superseded_at is null;
  perform private.audit('credential.remove', p_tenant, null, null, 'removed',
    jsonb_build_object('version', v_current));
end $$;

-- Any member may see whether a key is configured (operators need to know why issuing is blocked);
-- the next version is needed by the admin's Worker request to bind the ciphertext.
create function public.seller_credential_status(p_tenant uuid)
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
    left join private.seller_credentials c on c.tenant_id = p_tenant and c.superseded_at is null;
end $$;

-- ============================================================ platform integration readiness

create function public.platform_integrations()
returns table (tenant_id uuid, tenant_name text, lifecycle text, configured boolean, mode text,
  hint text, version integer, stored_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('integration_operations');
  return query
    select t.id, t.name, t.lifecycle, c.id is not null, c.mode, c.hint, c.version, c.created_at
    from public.tenants t
    left join private.seller_credentials c on c.tenant_id = t.id and c.superseded_at is null
    where not t.is_demo
    order by t.name;
end $$;

create function public.platform_partner_config()
returns table (partner_id text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('integration_operations');
  return query select s.value #>> '{}' from private.settings s where s.key = 'mengantar_partner_id';
end $$;

-- The Partner ID is an assigned identifier, not a secret (research doc §2).
create function public.platform_set_partner_id(p_partner_id text, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_id text := nullif(btrim(coalesce(p_partner_id, '')), '');
begin
  perform private.require_platform('integration_operations');
  perform 1 from public.platform_grants where user_id = (select auth.uid()) for share;
  perform private.require_platform('integration_operations');
  v_reason := private.require_reason(p_reason);
  if v_id is not null and v_id !~ '^[A-Za-z0-9_.-]{1,128}$' then
    raise exception 'invalid_partner_id' using errcode = '22023';
  end if;
  update private.settings set value = coalesce(to_jsonb(v_id), 'null'::jsonb), updated_at = now() where key = 'mengantar_partner_id';
  perform private.audit('integration.partner_id', null, null, v_reason, case when v_id is null then 'cleared' else 'set' end,
    jsonb_build_object('partner_id', v_id));
end $$;

revoke all on function public.store_seller_credential(uuid, integer, text, text, text, text),
  public.remove_seller_credential(uuid, integer), public.seller_credential_status(uuid),
  public.platform_integrations(), public.platform_partner_config(),
  public.platform_set_partner_id(text, text) from public, anon;
grant execute on function public.store_seller_credential(uuid, integer, text, text, text, text),
  public.remove_seller_credential(uuid, integer), public.seller_credential_status(uuid),
  public.platform_integrations(), public.platform_partner_config(),
  public.platform_set_partner_id(text, text) to authenticated;
