-- T-096 / PR-34 / DEC-017. Private, append-only PostgreSQL logo versions. A null payload is a
-- removal version; selecting the latest version gives exactly one current logo (or no logo).
create function private.gerai_logo_mime(p_bytes bytea)
returns text language sql immutable set search_path = ''
as $$
  select case
    when octet_length(p_bytes) between 8 and 204800
      and substring(p_bytes from 1 for 8) = decode('89504e470d0a1a0a', 'hex') then 'image/png'
    when octet_length(p_bytes) between 3 and 204800
      and substring(p_bytes from 1 for 3) = decode('ffd8ff', 'hex') then 'image/jpeg'
    when octet_length(p_bytes) between 16 and 204800
      and substring(p_bytes from 1 for 4) = convert_to('RIFF', 'utf8')
      and substring(p_bytes from 9 for 4) = convert_to('WEBP', 'utf8')
      and substring(p_bytes from 13 for 4) in (convert_to('VP8 ', 'utf8'), convert_to('VP8L', 'utf8'), convert_to('VP8X', 'utf8')) then 'image/webp'
    else null end
$$;
revoke all on function private.gerai_logo_mime(bytea) from public, anon, authenticated;

create table private.gerai_logo_versions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null check (version > 0),
  mime text,
  bytes bytea,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, version),
  constraint gerai_logo_valid check (
    (bytes is null and mime is null) or
    (bytes is not null and mime is not null and octet_length(bytes) between 1 and 204800
      and private.gerai_logo_mime(bytes) is not null and mime = private.gerai_logo_mime(bytes)))
);
alter table private.gerai_logo_versions enable row level security;
revoke all on private.gerai_logo_versions from public, anon, authenticated, service_role;
create trigger gerai_logos_append_only before update or delete on private.gerai_logo_versions
  for each row execute function private.label_history_guard();
create trigger gerai_logos_no_truncate before truncate on private.gerai_logo_versions
  for each statement execute function private.label_history_guard();

-- Members may read the current identity for preview; operators cannot mutate it. No public byte URL.
create function public.tenant_logo(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v private.gerai_logo_versions;
begin
  perform private.require_member(p_tenant);
  select * into v from private.gerai_logo_versions where tenant_id = p_tenant order by version desc limit 1;
  return jsonb_build_object('revision', coalesce(v.version, 0), 'logo', case when v.bytes is null then null else
    jsonb_build_object('version', v.version, 'mime', v.mime, 'base64', replace(encode(v.bytes, 'base64'), E'\n', '')) end);
end $$;

-- Mandatory optimistic revision, including removals: a stale tab never overwrites a newer logo.
-- Both null parameters mean remove. SVG and MIME spoofing are refused at this direct RPC boundary too.
create function public.set_tenant_logo(p_tenant uuid, p_mime text, p_base64 text, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v private.gerai_logo_versions;
  v_bytes bytea;
  v_mime text;
  v_version integer;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  -- Tenant row lock serializes all logo writers, independent of shipment/print history work.
  perform 1 from public.tenants where id = p_tenant for update;
  select * into v from private.gerai_logo_versions where tenant_id = p_tenant order by version desc limit 1;
  if p_expected_revision is null or p_expected_revision <> coalesce(v.version, 0) then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  if p_mime is not null or p_base64 is not null then
    if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp') or p_base64 is null then
      raise exception 'logo_type_invalid' using errcode = '22023';
    end if;
    if char_length(p_base64) > 273068 then raise exception 'logo_too_large' using errcode = '22023'; end if;
    if p_base64 = '' or p_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' then
      raise exception 'logo_type_invalid' using errcode = '22023';
    end if;
    begin
      v_bytes := decode(p_base64, 'base64');
    exception when others then
      raise exception 'logo_type_invalid' using errcode = '22023';
    end;
    if octet_length(v_bytes) > 204800 then raise exception 'logo_too_large' using errcode = '22023'; end if;
    v_mime := private.gerai_logo_mime(v_bytes);
    if v_mime is null or v_mime <> p_mime then raise exception 'logo_type_invalid' using errcode = '22023'; end if;
  end if;
  if v.bytes is not distinct from v_bytes and v.mime is not distinct from v_mime then
    return public.tenant_logo(p_tenant);
  end if;
  v_version := coalesce(v.version, 0) + 1;
  insert into private.gerai_logo_versions(tenant_id, version, mime, bytes, created_by)
    values (p_tenant, v_version, v_mime, v_bytes, (select auth.uid()));
  perform private.audit('tenant.logo', p_tenant, null, null,
    case when v_bytes is null then 'removed' when v.bytes is null then 'uploaded' else 'replaced' end,
    jsonb_build_object('version', v_version, 'previous_version', coalesce(v.version, 0), 'mime', v_mime, 'bytes', octet_length(v_bytes)));
  return public.tenant_logo(p_tenant);
end $$;
revoke all on function public.tenant_logo(uuid), public.set_tenant_logo(uuid, text, text, integer) from public, anon;
grant execute on function public.tenant_logo(uuid), public.set_tenant_logo(uuid, text, text, integer) to authenticated;

-- Capture only on INSERT. The existing snapshot reuse contract stays intact: replacing/removing a
-- logo does not rewrite or create a new version of an already printed, unchanged label. Old rows
-- keep a null logo and use their frozen true_tenant_name. No T-082 receipt/history fields are needed.
alter table public.label_snapshots
  add column gerai_logo jsonb,
  add column gerai_logo_revision integer not null default 0 check (gerai_logo_revision >= 0);
create function private.capture_label_logo()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v private.gerai_logo_versions;
begin
  -- The shared tenant lock makes the captured version coherent with concurrent replacement/removal.
  perform 1 from public.tenants where id = new.tenant_id for share;
  select * into v from private.gerai_logo_versions where tenant_id = new.tenant_id order by version desc limit 1;
  new.gerai_logo_revision := coalesce(v.version, 0);
  new.gerai_logo := case when v.bytes is null then null else
    jsonb_build_object('version', v.version, 'mime', v.mime, 'base64', replace(encode(v.bytes, 'base64'), E'\n', '')) end;
  new.content_digest := encode(extensions.digest(convert_to(jsonb_build_array(new.content_digest,
    new.true_tenant_name, coalesce(v.version, 0), new.gerai_logo)::text, 'utf8'), 'sha256'), 'hex');
  return new;
end $$;
revoke all on function private.capture_label_logo() from public, anon, authenticated;
create trigger label_snapshot_capture_logo before insert on public.label_snapshots
  for each row execute function private.capture_label_logo();
notify pgrst, 'reload schema';
