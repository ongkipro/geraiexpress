-- Super Admin foundation: PR-24, PR-15 (directory + lifecycle), PR-28, IAM-7, TEN-4, SEC-4, DATA-6,
-- DEC-008. A platform grant is server-owned (no Data API writes), capability-scoped, and usable
-- only from a verified second-factor session (aal2). It is not tenant membership and bypasses no
-- tenant RLS: platform reads go through narrow security-definer projections that omit customer
-- data. Every decision writes one append-only audit event.

create table public.platform_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  capabilities text[] not null check (
    cardinality(capabilities) > 0
    and capabilities <@ array['tenant_governance', 'platform_monitoring', 'integration_operations',
                              'access_governance', 'audit_review']::text[]),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revision integer not null default 1
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  target_tenant uuid,
  target_user uuid,
  reason text,
  outcome text not null,
  detail jsonb not null default '{}'::jsonb
);
create index audit_events_at_idx on public.audit_events (at desc);

-- Current authority is read from the table on every call, so a revoked grant stops working even
-- while an old access token is still valid (IAM-7).
create function private.platform_capable(p_capability text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
     and exists (
       select 1 from public.platform_grants g
       where g.user_id = (select auth.uid()) and g.revoked_at is null
         and p_capability = any (g.capabilities));
$$;

create function private.require_platform(p_capability text)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.platform_capable(p_capability) then
    raise exception 'platform_access_required' using errcode = '42501';
  end if;
end $$;

create function private.audit(p_action text, p_tenant uuid, p_user uuid, p_reason text,
  p_outcome text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values ((select auth.uid()), p_action, p_tenant, p_user, p_reason, p_outcome, p_detail);
$$;

create function private.audit_append_only()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_is_append_only' using errcode = '42501';
end $$;
create trigger audit_append_only before update or delete on public.audit_events
  for each row execute function private.audit_append_only();
create trigger audit_no_truncate before truncate on public.audit_events
  for each statement execute function private.audit_append_only();

create function private.require_reason(p_reason text)
returns text language plpgsql immutable set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  return btrim(p_reason);
end $$;

alter table public.platform_grants enable row level security;
alter table public.audit_events enable row level security;
grant select on public.platform_grants, public.audit_events to authenticated;

-- A person may see their own grant (to route them); access governors see all grants.
create policy platform_grants_read on public.platform_grants for select to authenticated
  using (user_id = (select auth.uid()) or (select private.platform_capable('access_governance')));
create policy audit_events_read on public.audit_events for select to authenticated
  using ((select private.platform_capable('audit_review')));

-- ============================================================ tenant directory and lifecycle

create function public.platform_tenants()
returns table (id uuid, name text, lifecycle text, created_at timestamptz,
  member_count bigint, shipment_count bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('tenant_governance');
  return query
    select t.id, t.name, t.lifecycle, t.created_at,
      (select count(*) from public.memberships m where m.tenant_id = t.id and m.status = 'active'),
      (select count(*) from public.shipments s where s.tenant_id = t.id)
    from public.tenants t
    where not t.is_demo
    order by t.created_at, t.name;
end $$;

-- PR-15: suspend/reactivate an already-activated business. Activation of a new application is
-- the review decision (PR-30), not a lifecycle shortcut. Suspension blocks member access through
-- private.member_role; recorded shipment outcomes are untouched.
create function public.platform_set_tenant_lifecycle(p_tenant uuid, p_expected text,
  p_lifecycle text, p_reason text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_current text;
begin
  -- Lock the caller's grant before checking it, so a concurrent revocation either lands first
  -- (and this call is refused) or waits until this decision commits.
  perform private.require_platform('tenant_governance');
  perform 1 from public.platform_grants where user_id = (select auth.uid()) for share;
  perform private.require_platform('tenant_governance');
  v_reason := private.require_reason(p_reason);
  select lifecycle into v_current from public.tenants where id = p_tenant and not is_demo for update;
  if v_current is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_current <> p_expected then raise exception 'stale_state' using errcode = '40001'; end if;
  if not ((v_current = 'active' and p_lifecycle = 'suspended')
       or (v_current = 'suspended' and p_lifecycle = 'active')) then
    raise exception 'transition_not_allowed' using errcode = '55000';
  end if;
  update public.tenants set lifecycle = p_lifecycle where id = p_tenant;
  perform private.audit('tenant.lifecycle', p_tenant, null, v_reason, p_lifecycle,
    jsonb_build_object('from', v_current, 'to', p_lifecycle));
  return p_lifecycle;
end $$;

-- ============================================================ access governance

create function public.platform_admins()
returns table (user_id uuid, email text, capabilities text[], granted_at timestamptz,
  revoked_at timestamptz, revision integer, has_totp boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('access_governance');
  return query
    select g.user_id, u.email::text, g.capabilities, g.granted_at, g.revoked_at, g.revision,
      exists (select 1 from auth.mfa_factors f
              where f.user_id = g.user_id and f.factor_type = 'totp' and f.status = 'verified')
    from public.platform_grants g join auth.users u on u.id = g.user_id
    order by g.revoked_at nulls first, u.email;
end $$;

-- The platform must always keep at least one active access governor who can actually sign in
-- with a verified second factor (DEC-008 final-admin guard, IAM-7).
create function private.assert_access_governor_remains()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.platform_grants g
    where g.revoked_at is null and 'access_governance' = any (g.capabilities)
      and exists (select 1 from auth.mfa_factors f
                  where f.user_id = g.user_id and f.factor_type = 'totp' and f.status = 'verified')) then
    raise exception 'last_access_governor' using errcode = '55000';
  end if;
end $$;

-- Grant or change capabilities for an existing, verified, non-anonymous identity. Writes lock the
-- grant set so concurrent removals serialize and the guard sees the final state.
create function public.platform_set_grant(p_email text, p_capabilities text[], p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_user uuid;
  v_caps text[];
begin
  -- Lock the whole grant set first, then check the caller's authority against committed state:
  -- a governor revoked while this call waited is refused (no self-restoration race).
  perform private.require_platform('access_governance'); -- cheap refusal before contending for locks
  perform 1 from public.platform_grants for update;
  perform private.require_platform('access_governance');
  v_reason := private.require_reason(p_reason);
  select array_agg(distinct c order by c) into v_caps from unnest(p_capabilities) c;
  select u.id into v_user from auth.users u
    where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null
      and not u.is_anonymous and u.deleted_at is null;
  if v_user is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;
  insert into public.platform_grants (user_id, capabilities, granted_by)
    values (v_user, v_caps, (select auth.uid()))
  on conflict (user_id) do update
    set capabilities = excluded.capabilities, granted_by = excluded.granted_by,
        granted_at = now(), revoked_at = null, revision = public.platform_grants.revision + 1;
  perform private.assert_access_governor_remains();
  perform private.audit('platform.grant', null, v_user, v_reason, 'granted',
    jsonb_build_object('capabilities', v_caps));
  return v_user;
end $$;

create function public.platform_revoke_grant(p_user uuid, p_expected_revision integer, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  g public.platform_grants;
begin
  perform private.require_platform('access_governance'); -- cheap refusal before contending for locks
  perform 1 from public.platform_grants for update;
  perform private.require_platform('access_governance');
  v_reason := private.require_reason(p_reason);
  select * into g from public.platform_grants where user_id = p_user;
  if not found or g.revoked_at is not null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if g.revision <> p_expected_revision then raise exception 'stale_state' using errcode = '40001'; end if;
  update public.platform_grants set revoked_at = now(), revision = revision + 1 where user_id = p_user;
  perform private.assert_access_governor_remains();
  perform private.audit('platform.revoke', null, p_user, v_reason, 'revoked',
    jsonb_build_object('capabilities', g.capabilities));
end $$;

-- PR-28: filtered history with actor and target names; detail carries states/capabilities only.
create function public.platform_audit(p_action text default null, p_limit integer default 100)
returns table (id bigint, at timestamptz, action text, outcome text, reason text,
  actor_email text, target_tenant_name text, target_user_email text, detail jsonb)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('audit_review');
  return query
    select e.id, e.at, e.action, e.outcome, e.reason, a.email::text, t.name, u.email::text, e.detail
    from public.audit_events e
    left join auth.users a on a.id = e.actor
    left join public.tenants t on t.id = e.target_tenant
    left join auth.users u on u.id = e.target_user
    where p_action is null or e.action = p_action
    order by e.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

revoke all on function public.platform_audit(text, integer) from public, anon;
grant execute on function public.platform_audit(text, integer) to authenticated;

revoke all on function public.platform_tenants(), public.platform_set_tenant_lifecycle(uuid, text, text, text),
  public.platform_admins(), public.platform_set_grant(text, text[], text),
  public.platform_revoke_grant(uuid, integer, text) from public, anon;
grant execute on function public.platform_tenants(), public.platform_set_tenant_lifecycle(uuid, text, text, text),
  public.platform_admins(), public.platform_set_grant(text, text[], text),
  public.platform_revoke_grant(uuid, integer, text) to authenticated;
revoke all on function private.platform_capable(text), private.require_platform(text),
  private.audit(text, uuid, uuid, text, text, jsonb), private.require_reason(text),
  private.assert_access_governor_remains() from public, anon;
grant execute on function private.platform_capable(text) to authenticated;
