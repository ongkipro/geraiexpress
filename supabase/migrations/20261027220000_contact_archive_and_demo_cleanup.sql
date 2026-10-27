-- T-028 (DEC-008, IAM-1, PR-2): contact archiving is a tenant-admin command with a row-lock role
-- re-check and revision check; direct column updates on archived_at remain denied to API roles.
-- T-030 (DEL-1, IAM-4): service_role-only cleanup RPC for expired demo tenants and anonymous users.

revoke update on public.contacts from authenticated;
grant update (name, phone, is_sender, is_recipient) on public.contacts to authenticated;

create function public.archive_contact(p_tenant uuid, p_contact uuid, p_expected_version integer)
returns public.contacts
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.contacts;
begin
  perform private.require_member(p_tenant);
  select * into v_row from public.contacts
    where tenant_id = p_tenant and id = p_contact for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.memberships
    where tenant_id = p_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(p_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if v_row.archived_at is not null then
    raise exception 'contact_already_archived' using errcode = '55000';
  end if;
  if v_row.revision <> p_expected_version then
    raise exception 'stale_revision' using errcode = '55000';
  end if;
  update public.contacts
    set archived_at = now()
    where tenant_id = p_tenant and id = p_contact
    returning * into v_row;
  return v_row;
end $$;

revoke all on function public.archive_contact(uuid, uuid, integer) from public, anon;
grant execute on function public.archive_contact(uuid, uuid, integer) to authenticated;

-- T-030: remove expired demo workspaces and orphaned expired anonymous identities.
create function public.cleanup_expired_demos(p_max_age_hours integer default 24)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_tenants integer := 0;
  v_users integer := 0;
begin
  if p_max_age_hours is null or p_max_age_hours < 1 or p_max_age_hours > 8760 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(hours => p_max_age_hours);

  delete from public.shipments s
  using public.tenants t
  where s.tenant_id = t.id
    and t.is_demo is true
    and t.created_at < v_cutoff;

  with deleted_t as (
    delete from public.tenants t
    where t.is_demo is true
      and t.created_at < v_cutoff
    returning t.id
  )
  select count(*)::integer into v_tenants from deleted_t;

  with deleted_u as (
    delete from auth.users u
    where u.is_anonymous is true
      and u.created_at < v_cutoff
      and not exists (select 1 from public.memberships m where m.user_id = u.id)
      and not exists (select 1 from public.shipments s where s.created_by = u.id)
      and not exists (select 1 from public.provider_operations o where o.actor = u.id)
      and not exists (select 1 from public.label_jobs j where j.requested_by = u.id)
      and not exists (select 1 from public.shipment_events e where e.actor = u.id)
    returning u.id
  )
  select count(*)::integer into v_users from deleted_u;

  return jsonb_build_object('deleted_tenants', v_tenants, 'deleted_users', v_users);
end $$;

revoke all on function public.cleanup_expired_demos(integer) from public, anon, authenticated;
grant execute on function public.cleanup_expired_demos(integer) to service_role;

-- PostgREST v14.18 (hasql-transaction) automatically retries SQLSTATE 40001 (serialization_failure)
-- in an infinite loop inside the PostgREST process. Application-level optimistic concurrency guards
-- (stale_revision, stale_state, stale_quote, quote_expired, stale_attempt) must use SQLSTATE 55000
-- (object_not_in_prerequisite_state) so deterministic stale checks return HTTP 400 immediately.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc like '%40001%'
  loop
    execute replace(pg_get_functiondef(fn.oid), '''40001''', '''55000''');
  end loop;
end $$;
