-- Staff invitations and member management: PR-31, PR-32, IAM-2, IAM-8, TEN-5, DATA-7, DEC-007,
-- DEC-008. An invitation is bound to one email, one tenant and one role, single-use, 7 days,
-- revocable, and grants nothing until that verified identity explicitly accepts it while the
-- inviter is still an admin there. Role changes and deactivation keep at least one active
-- tenant_admin. Demo tenants cannot invite.

create table public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    and char_length(email) <= 254),
  role text not null check (role in ('tenant_admin', 'operator')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revision integer not null default 1
);
create unique index tenant_invitations_one_pending on public.tenant_invitations (tenant_id, email)
  where status = 'pending';
create index tenant_invitations_email_idx on public.tenant_invitations (email) where status = 'pending';

alter table public.tenant_invitations enable row level security;
-- Reads go through RPCs (admins: their tenant; invitees: their own email) so no direct grant.

-- An invited email may create its account even while public registration is closed.
create function private.has_pending_invitation(p_email text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.tenant_invitations i
    join public.tenants t on t.id = i.tenant_id
    where i.email = lower(btrim(p_email)) and i.status = 'pending' and i.expires_at > now()
      and t.lifecycle = 'active' and not t.is_demo);
$$;
grant execute on function private.has_pending_invitation(text) to supabase_auth_admin;
revoke execute on function private.has_pending_invitation(text) from public, anon, authenticated;

create or replace function private.before_user_created(event jsonb)
returns jsonb
language plpgsql stable set search_path = ''
as $$
begin
  if coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false) then
    return '{}'::jsonb;
  end if;
  if coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb) = '{}'::jsonb
     and (public.registration_open() or private.has_pending_invitation(event -> 'user' ->> 'email')) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Pendaftaran akun belum dibuka. Gunakan akun yang diundang atau coba demo.'));
end $$;

-- The caller must currently be an active tenant_admin of a real (non-demo) tenant. Locks the
-- tenant's membership rows first so role changes in that tenant serialize, then checks.
create function private.require_tenant_admin_locked(p_tenant uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  perform 1 from public.memberships where tenant_id = p_tenant for update;
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
end $$;

create function private.assert_tenant_admin_remains(p_tenant uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.memberships
                 where tenant_id = p_tenant and status = 'active' and role = 'tenant_admin') then
    raise exception 'last_tenant_admin' using errcode = '55000';
  end if;
end $$;

-- ============================================================ admin commands

create function public.tenant_members(p_tenant uuid)
returns table (user_id uuid, email text, role text, status text, revision integer, is_self boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text, m.role, m.status, m.revision, m.user_id = (select auth.uid())
    from public.memberships m join auth.users u on u.id = m.user_id
    where m.tenant_id = p_tenant
    order by m.status, m.role desc, u.email;
end $$;

create function public.tenant_invitations_list(p_tenant uuid)
returns table (id uuid, email text, role text, status text, created_at timestamptz,
  expires_at timestamptz, revision integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  return query
    select i.id, i.email, i.role, i.status, i.created_at, i.expires_at, i.revision
    from public.tenant_invitations i
    where i.tenant_id = p_tenant and i.status = 'pending' and i.expires_at > now()
    order by i.created_at desc;
end $$;

create function public.invite_member(p_tenant uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  if p_role is null or p_role not in ('tenant_admin', 'operator') then raise exception 'transition_not_allowed' using errcode = '22023'; end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
             where m.tenant_id = p_tenant and m.status = 'active' and lower(u.email) = v_email) then
    raise exception 'already_member' using errcode = '23505';
  end if;
  if exists (select 1 from public.tenant_invitations i where i.tenant_id = p_tenant and i.email = v_email
             and i.status = 'pending' and i.expires_at > now()) then
    raise exception 'already_invited' using errcode = '23505';
  end if;
  -- Bound mail/account-creation exposure per gerai (each pending invite admits one signup).
  if (select count(*) from public.tenant_invitations i where i.tenant_id = p_tenant
      and i.status = 'pending' and i.expires_at > now()) >= 20 then
    raise exception 'too_many_invitations' using errcode = '54000';
  end if;
  -- An expired pending invitation is closed (and audited) before a fresh one is issued.
  with closed as (
    update public.tenant_invitations i set status = 'revoked', revoked_at = now(), revision = i.revision + 1
      where i.tenant_id = p_tenant and i.email = v_email and i.status = 'pending'
      returning i.id)
  select id into v_id from closed;
  if v_id is not null then
    perform private.audit('member.invite_revoke', p_tenant, null, null, 'expired_replaced',
      jsonb_build_object('invitation', v_id, 'email', v_email));
  end if;
  insert into public.tenant_invitations (tenant_id, email, role, invited_by)
    values (p_tenant, v_email, p_role, (select auth.uid())) returning id into v_id;
  perform private.audit('member.invite', p_tenant, null, null, 'invited',
    jsonb_build_object('invitation', v_id, 'role', p_role, 'email', v_email));
  return v_id;
end $$;

create function public.revoke_invitation(p_id uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare i public.tenant_invitations;
begin
  select * into i from public.tenant_invitations where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_tenant_admin_locked(i.tenant_id);
  select * into i from public.tenant_invitations where id = p_id for update;
  if i.status <> 'pending' or i.revision <> p_expected_revision then
    raise exception 'stale_state' using errcode = '40001';
  end if;
  update public.tenant_invitations t set status = 'revoked', revoked_at = now(), revision = t.revision + 1
    where t.id = p_id;
  perform private.audit('member.invite_revoke', i.tenant_id, null, null, 'revoked',
    jsonb_build_object('invitation', p_id));
end $$;

create function public.set_member_role(p_tenant uuid, p_user uuid, p_role text, p_expected_revision integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare m public.memberships;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  if p_role is null or p_role not in ('tenant_admin', 'operator') then raise exception 'transition_not_allowed' using errcode = '22023'; end if;
  select * into m from public.memberships where tenant_id = p_tenant and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status <> 'active' or m.revision <> p_expected_revision then
    raise exception 'stale_state' using errcode = '40001';
  end if;
  update public.memberships t set role = p_role, revision = t.revision + 1
    where t.tenant_id = p_tenant and t.user_id = p_user;
  perform private.assert_tenant_admin_remains(p_tenant);
  perform private.audit('member.role', p_tenant, p_user, null, p_role,
    jsonb_build_object('from', m.role, 'to', p_role));
end $$;

create function public.deactivate_member(p_tenant uuid, p_user uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare m public.memberships;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  select * into m from public.memberships where tenant_id = p_tenant and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status <> 'active' or m.revision <> p_expected_revision then
    raise exception 'stale_state' using errcode = '40001';
  end if;
  update public.memberships t set status = 'revoked', revision = t.revision + 1
    where t.tenant_id = p_tenant and t.user_id = p_user;
  perform private.assert_tenant_admin_remains(p_tenant);
  perform private.audit('member.deactivate', p_tenant, p_user, null, 'revoked',
    jsonb_build_object('role', m.role));
end $$;

-- ============================================================ invitee commands

create function private.caller_verified_email()
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v_email text;
begin
  select lower(u.email) into v_email from auth.users u
    where u.id = (select auth.uid()) and not u.is_anonymous and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'verified_identity_required' using errcode = '42501'; end if;
  return v_email;
end $$;

create function public.my_invitations()
returns table (id uuid, tenant_name text, role text, expires_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_email text := private.caller_verified_email();
begin
  return query
    select i.id, t.name, i.role, i.expires_at
    from public.tenant_invitations i join public.tenants t on t.id = i.tenant_id
    where i.email = v_email and i.status = 'pending' and i.expires_at > now()
      and t.lifecycle = 'active' and not t.is_demo
    order by i.created_at;
end $$;

-- PR-31: only the intended verified identity, only a current invitation, only while the issuer
-- is still an active admin there; grants exactly the invited scope once.
create function public.accept_invitation(p_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := private.caller_verified_email();
  i public.tenant_invitations;
begin
  select * into i from public.tenant_invitations where id = p_id;
  -- Wrong email and unknown id look the same, so nothing about another business leaks.
  if not found or i.email <> v_email then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform 1 from public.memberships where tenant_id = i.tenant_id for update;
  select * into i from public.tenant_invitations where id = p_id for update;
  if i.status <> 'pending' or i.expires_at <= now() then
    raise exception 'invitation_unavailable' using errcode = '55000';
  end if;
  if not exists (select 1 from public.tenants t where t.id = i.tenant_id and t.lifecycle = 'active' and not t.is_demo)
     or not exists (select 1 from public.memberships m where m.tenant_id = i.tenant_id
                    and m.user_id = i.invited_by and m.status = 'active' and m.role = 'tenant_admin') then
    raise exception 'invitation_unavailable' using errcode = '55000';
  end if;
  if exists (select 1 from public.memberships m where m.tenant_id = i.tenant_id
             and m.user_id = (select auth.uid()) and m.status = 'active') then
    raise exception 'already_member' using errcode = '23505';
  end if;
  insert into public.memberships (tenant_id, user_id, role)
    values (i.tenant_id, (select auth.uid()), i.role)
  on conflict (tenant_id, user_id) do update
    set role = excluded.role, status = 'active', revision = public.memberships.revision + 1;
  update public.tenant_invitations t set status = 'accepted', accepted_by = (select auth.uid()),
    accepted_at = now(), revision = t.revision + 1 where t.id = p_id;
  perform private.audit('member.accept', i.tenant_id, (select auth.uid()), null, 'accepted',
    jsonb_build_object('invitation', p_id, 'role', i.role));
  return i.tenant_id;
end $$;

-- T-010 follow-up: roles are editable now, so the admin-only recovery re-checks the caller's
-- role after taking a share lock on their membership (a concurrent demotion waits or wins).
create or replace function public.reconcile_shipment(p_shipment uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.shipments;
  op public.provider_operations;
  v_awb text;
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  s := private.lock_member_shipment(p_shipment);
  select * into op from public.provider_operations
    where tenant_id = s.tenant_id and shipment_id = s.id and kind = 'create_order' for update;
  if not found or op.state not in ('unknown', 'in_flight', 'queued') then
    raise exception 'nothing_to_reconcile' using errcode = '55000';
  end if;
  if not op.is_simulated then
    raise exception 'provider_not_connected' using errcode = '55000';
  end if;
  v_awb := coalesce(s.awb, 'SIM' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')
    || lpad((floor(random() * 1000000))::int::text, 6, '0'));
  update public.provider_operations set state = 'succeeded', attempts = attempts + 1,
    result_code = 'SIMULATED_RECONCILED', updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = v_awb,
    issued_at = coalesce(issued_at, now()), updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'reconciled', 'Operasi asli ditemukan: ' || v_awb);
  return jsonb_build_object('operation_id', op.id, 'awb', v_awb);
end $$;

revoke all on function public.tenant_members(uuid), public.tenant_invitations_list(uuid),
  public.invite_member(uuid, text, text), public.revoke_invitation(uuid, integer),
  public.set_member_role(uuid, uuid, text, integer), public.deactivate_member(uuid, uuid, integer),
  public.my_invitations(), public.accept_invitation(uuid) from public, anon;
grant execute on function public.tenant_members(uuid), public.tenant_invitations_list(uuid),
  public.invite_member(uuid, text, text), public.revoke_invitation(uuid, integer),
  public.set_member_role(uuid, uuid, text, integer), public.deactivate_member(uuid, uuid, integer),
  public.my_invitations(), public.accept_invitation(uuid) to authenticated;
revoke all on function private.require_tenant_admin_locked(uuid), private.assert_tenant_admin_remains(uuid),
  private.caller_verified_email() from public, anon, authenticated;
