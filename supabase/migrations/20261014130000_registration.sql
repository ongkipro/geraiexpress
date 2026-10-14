-- Registration and gerai application: PR-29, PR-30, PR-15 (review), DEC-007, TEN-5, DATA-7.
-- Public account creation stays closed until a platform governor opens it (after the mail path,
-- PR-33, is proved). A verified, non-anonymous identity may keep one open application; a
-- Super Admin decision (aal2) approves it into exactly one active tenant, outlet and
-- tenant_admin membership. No Mengantar seller is created by approval.

create table private.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into private.settings (key, value) values ('registration_open', 'false');

create function public.registration_open()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::boolean from private.settings s where s.key = 'registration_open'), false);
$$;

-- Auth hook: anonymous demo sessions always; real accounts only while registration is open and
-- without self-asserted profile metadata (PR-29: an owner must never inherit attacker-chosen
-- data planted on their email before they verified it; the app sends none).
create or replace function private.before_user_created(event jsonb)
returns jsonb
language plpgsql stable set search_path = ''
as $$
begin
  if coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false) then
    return '{}'::jsonb;
  end if;
  if public.registration_open() and coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb) = '{}'::jsonb then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Pendaftaran akun belum dibuka. Gunakan akun yang diundang atau coba demo.'));
end $$;

-- SEC-5 / PR-29: no pre-registration takeover. Anyone can call signUp with someone else's email
-- and a password of their choosing (the hook cannot tell it from an OTP signup, and Auth gives
-- OTP-created users a random hash too). So the first time an email is confirmed, any password
-- set before that proof is discarded: only the inbox owner, after verifying, sets a password.
-- Note: this also drops a password an operator set on an unconfirmed user before confirming it;
-- confirm first, then set (recorded for invitations and the bootstrap runbook).
create function private.discard_pre_verification_password()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and not coalesce(new.is_anonymous, false) then
    new.encrypted_password := '';
  end if;
  return new;
end $$;
revoke execute on function private.discard_pre_verification_password() from public, anon, authenticated;
create trigger discard_pre_verification_password
  before update on auth.users
  for each row execute function private.discard_pre_verification_password();

create table public.tenant_applications (
  id uuid primary key default gen_random_uuid(),
  applicant uuid not null references auth.users (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'withdrawn')),
  revision integer not null default 1,
  business_name text check (char_length(business_name) between 2 and 120),
  outlet_name text check (char_length(outlet_name) between 2 and 120),
  pickup_address text check (char_length(pickup_address) between 5 and 500),
  pickup_area text check (char_length(pickup_area) between 3 and 160),
  contact_phone text check (contact_phone ~ '^\+?[0-9]{8,15}$'),
  review_reason text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  tenant_id uuid references public.tenants (id) on delete set null,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);
-- One open application per identity; another business needs its own, after this one closes.
create unique index tenant_applications_one_open on public.tenant_applications (applicant)
  where status in ('draft', 'submitted', 'changes_requested');

alter table public.tenant_applications enable row level security;
-- Applicants see their own application but not which administrator reviewed it.
grant select (id, applicant, status, revision, business_name, outlet_name, pickup_address,
  pickup_area, contact_phone, review_reason, reviewed_at, tenant_id, created_at, submitted_at,
  updated_at) on public.tenant_applications to authenticated;
create policy applications_own_read on public.tenant_applications for select to authenticated
  using (applicant = (select auth.uid())
         and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

-- The caller must be a verified, non-anonymous identity (inbox control proved by Auth).
create function private.require_verified_identity()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid;
begin
  select u.id into v_user from auth.users u
    where u.id = (select auth.uid()) and not u.is_anonymous and u.email_confirmed_at is not null;
  if v_user is null then raise exception 'verified_identity_required' using errcode = '42501'; end if;
  return v_user;
end $$;

create function private.clean(p text)
returns text language sql immutable set search_path = ''
as $$ select nullif(btrim(p), '') $$;

-- Save the caller's open application (partial drafts allowed); creates it on first save.
create function public.save_application(p_expected_revision integer, p_business_name text,
  p_outlet_name text, p_pickup_address text, p_pickup_area text, p_contact_phone text)
returns table (id uuid, revision integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_verified_identity();
  a public.tenant_applications;
begin
  if not public.registration_open() then raise exception 'registration_closed' using errcode = '55000'; end if;
  select * into a from public.tenant_applications t
    where t.applicant = v_user and t.status in ('draft', 'submitted', 'changes_requested') for update;
  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then raise exception 'stale_state' using errcode = '40001'; end if;
    insert into public.tenant_applications (applicant, business_name, outlet_name, pickup_address,
      pickup_area, contact_phone)
    values (v_user, private.clean(p_business_name), private.clean(p_outlet_name),
      private.clean(p_pickup_address), private.clean(p_pickup_area), private.clean(p_contact_phone))
    returning * into a;
    return query select a.id, a.revision;
    return;
  end if;
  if a.status = 'submitted' then raise exception 'application_locked' using errcode = '55000'; end if;
  if a.revision <> p_expected_revision then raise exception 'stale_state' using errcode = '40001'; end if;
  update public.tenant_applications t set business_name = private.clean(p_business_name),
    outlet_name = private.clean(p_outlet_name), pickup_address = private.clean(p_pickup_address),
    pickup_area = private.clean(p_pickup_area), contact_phone = private.clean(p_contact_phone),
    revision = t.revision + 1, updated_at = now()
  where t.id = a.id returning * into a;
  return query select a.id, a.revision;
end $$;

create function public.submit_application(p_id uuid, p_expected_revision integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_verified_identity();
  a public.tenant_applications;
begin
  if not public.registration_open() then raise exception 'registration_closed' using errcode = '55000'; end if;
  select * into a from public.tenant_applications t where t.id = p_id and t.applicant = v_user for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status not in ('draft', 'changes_requested') then raise exception 'application_locked' using errcode = '55000'; end if;
  if a.revision <> p_expected_revision then raise exception 'stale_state' using errcode = '40001'; end if;
  if a.business_name is null or a.outlet_name is null or a.pickup_address is null
     or a.pickup_area is null or a.contact_phone is null then
    raise exception 'incomplete_application' using errcode = '23514';
  end if;
  update public.tenant_applications t set status = 'submitted', submitted_at = now(),
    revision = t.revision + 1, updated_at = now() where t.id = a.id;
  return a.revision + 1;
end $$;

create function public.withdraw_application(p_id uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_verified_identity();
  a public.tenant_applications;
begin
  select * into a from public.tenant_applications t where t.id = p_id and t.applicant = v_user for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status not in ('draft', 'submitted', 'changes_requested') then
    raise exception 'application_locked' using errcode = '55000';
  end if;
  if a.revision <> p_expected_revision then raise exception 'stale_state' using errcode = '40001'; end if;
  update public.tenant_applications t set status = 'withdrawn', revision = t.revision + 1,
    updated_at = now() where t.id = a.id;
end $$;

-- Routing facts for the signed-in identity (PR-32): password set, open/latest application.
create function public.my_account_state()
returns table (has_password boolean, registration_open boolean, application_status text)
language sql stable security definer set search_path = ''
as $$
  select coalesce(u.encrypted_password, '') <> '', public.registration_open(),
    (select a.status from public.tenant_applications a where a.applicant = u.id
      order by a.created_at desc limit 1)
  from auth.users u
  where u.id = (select auth.uid()) and not u.is_anonymous;
$$;

-- ============================================================ platform review (PR-15, PR-30)

create function public.platform_applications(p_status text default 'submitted')
returns table (id uuid, status text, revision integer, applicant_email text, business_name text,
  outlet_name text, pickup_address text, pickup_area text, contact_phone text, review_reason text,
  submitted_at timestamptz, reviewed_at timestamptz, tenant_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('tenant_governance');
  return query
    select a.id, a.status, a.revision, u.email::text, a.business_name, a.outlet_name,
      a.pickup_address, a.pickup_area, a.contact_phone, a.review_reason, a.submitted_at,
      a.reviewed_at, a.tenant_id
    from public.tenant_applications a join auth.users u on u.id = a.applicant
    where p_status is null or a.status = p_status
    order by coalesce(a.submitted_at, a.created_at)
    limit 200;
end $$;

create function public.platform_review_application(p_id uuid, p_expected_revision integer,
  p_decision text, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  a public.tenant_applications;
  v_tenant uuid;
begin
  perform private.require_platform('tenant_governance');
  perform 1 from public.platform_grants where user_id = (select auth.uid()) for share;
  perform private.require_platform('tenant_governance');
  v_reason := private.require_reason(p_reason);
  if p_decision not in ('approve', 'reject', 'request_changes') then
    raise exception 'transition_not_allowed' using errcode = '55000';
  end if;
  select * into a from public.tenant_applications t where t.id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status <> 'submitted' then raise exception 'stale_state' using errcode = '40001'; end if;
  if a.revision <> p_expected_revision then raise exception 'stale_state' using errcode = '40001'; end if;
  -- Separation of duties: nobody decides their own application.
  if a.applicant = (select auth.uid()) then raise exception 'own_application' using errcode = '42501'; end if;

  if p_decision = 'approve' then
    insert into public.tenants (name, lifecycle) values (a.business_name, 'active') returning id into v_tenant;
    insert into public.outlets (tenant_id, name, pickup_address, pickup_area)
      values (v_tenant, a.outlet_name, a.pickup_address, a.pickup_area);
    insert into public.memberships (tenant_id, user_id, role) values (v_tenant, a.applicant, 'tenant_admin');
  end if;
  update public.tenant_applications t set
    status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end,
    review_reason = v_reason, reviewed_by = (select auth.uid()), reviewed_at = now(),
    tenant_id = v_tenant, revision = t.revision + 1, updated_at = now()
  where t.id = a.id;
  perform private.audit('application.review', v_tenant, a.applicant, v_reason, p_decision,
    jsonb_build_object('application', a.id, 'revision', a.revision));
  return v_tenant;
end $$;

create function public.platform_set_registration(p_open boolean, p_reason text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_reason text;
begin
  perform private.require_platform('tenant_governance');
  perform 1 from public.platform_grants where user_id = (select auth.uid()) for share;
  perform private.require_platform('tenant_governance');
  v_reason := private.require_reason(p_reason);
  update private.settings set value = to_jsonb(p_open), updated_at = now() where key = 'registration_open';
  perform private.audit('registration.toggle', null, null, v_reason, case when p_open then 'opened' else 'closed' end);
  return p_open;
end $$;

revoke all on function public.registration_open(), public.save_application(integer, text, text, text, text, text),
  public.submit_application(uuid, integer), public.withdraw_application(uuid, integer),
  public.my_account_state(), public.platform_applications(text),
  public.platform_review_application(uuid, integer, text, text),
  public.platform_set_registration(boolean, text) from public;
grant execute on function public.registration_open() to anon, authenticated, supabase_auth_admin;
grant execute on function public.save_application(integer, text, text, text, text, text),
  public.submit_application(uuid, integer), public.withdraw_application(uuid, integer),
  public.my_account_state(), public.platform_applications(text),
  public.platform_review_application(uuid, integer, text, text),
  public.platform_set_registration(boolean, text) to authenticated;
revoke all on function private.require_verified_identity(), private.clean(text) from public, anon, authenticated;
