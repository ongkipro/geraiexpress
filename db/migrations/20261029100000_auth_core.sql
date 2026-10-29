-- Application-owned authentication core (ADR-0002 section 3.2, T-065, DEC-021): sessions, emailed
-- one-time codes and TOTP state live in schema auth; every operation is a machine-only security
-- definer function in public (service_role only, the DEC-010 machine RPC pattern). Hashing, token
-- signing, TOTP arithmetic, Turnstile and mail stay in the application: this file never sees a
-- password, an OTP, a refresh token or a TOTP secret in plaintext, only hashes and sealed text.

create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  aal text not null default 'aal1' check (aal in ('aal1', 'aal2')),
  aal2_at timestamptz,
  refresh_hash text not null unique check (refresh_hash ~ '^[a-f0-9]{64}$'),
  previous_refresh_hash text check (previous_refresh_hash ~ '^[a-f0-9]{64}$'),
  refresh_rotated_at timestamptz,
  absolute_expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  user_agent_hash text check (user_agent_hash ~ '^[a-f0-9]{64}$'),
  check (idle_expires_at <= absolute_expires_at),
  check ((aal = 'aal2') = (aal2_at is not null))
);
create index sessions_user_idx on auth.sessions (user_id);
create index sessions_previous_refresh_idx on auth.sessions (previous_refresh_hash) where previous_refresh_hash is not null;

create table auth.otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  purpose text not null check (purpose in ('login')),
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
-- One live code per (email, purpose); a newer code supersedes the old one by consuming it.
create unique index otp_codes_one_live on auth.otp_codes (email, purpose) where consumed_at is null;
create index otp_codes_email_idx on auth.otp_codes (email, created_at);

alter table auth.sessions enable row level security;
alter table auth.otp_codes enable row level security;
revoke all on auth.sessions, auth.otp_codes from public, anon, authenticated, service_role;

-- A deactivated or banned identity loses every session at once (ADR-0002 obligation 3).
create function private.revoke_sessions_on_deactivation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  update auth.sessions set revoked_at = now() where user_id = new.id and revoked_at is null;
  return new;
end $$;
revoke execute on function private.revoke_sessions_on_deactivation() from public, anon, authenticated;
create trigger revoke_sessions_on_deactivation
  after update of deleted_at, banned_until on auth.users
  for each row
  when ((new.deleted_at is not null and old.deleted_at is null)
     or (new.banned_until is not null and new.banned_until > now()
         and new.banned_until is distinct from old.banned_until))
  execute function private.revoke_sessions_on_deactivation();

-- The account is usable: not deleted and not banned.
create function private.auth_user_active(p_user auth.users)
returns boolean language sql stable set search_path = ''
as $$ select p_user.deleted_at is null and (p_user.banned_until is null or p_user.banned_until <= now()); $$;
revoke execute on function private.auth_user_active(auth.users) from public, anon, authenticated;

-- Creates a session. Lifetimes are clamped here: 7 days for everyone, 12 hours for an identity
-- holding an active platform grant, so the bound is server-enforced and not a cookie attribute.
create function private.auth_open_session(
  p_user uuid, p_refresh_hash text, p_user_agent_hash text, p_absolute_seconds integer, p_idle_seconds integer)
returns uuid language plpgsql set search_path = ''
as $$
declare
  v_abs integer := least(greatest(coalesce(p_absolute_seconds, 604800), 60), 604800);
  v_idle integer;
  v_id uuid;
begin
  if exists (select 1 from public.platform_grants g where g.user_id = p_user and g.revoked_at is null) then
    v_abs := least(v_abs, 43200);
  end if;
  v_idle := least(greatest(coalesce(p_idle_seconds, v_abs), 60), v_abs);
  insert into auth.sessions (user_id, refresh_hash, user_agent_hash, absolute_expires_at, idle_expires_at)
    values (p_user, p_refresh_hash, p_user_agent_hash, now() + make_interval(secs => v_abs), now() + make_interval(secs => v_idle))
    returning id into v_id;
  return v_id;
end $$;
revoke execute on function private.auth_open_session(uuid, text, text, integer, integer) from public, anon, authenticated;

create function private.auth_identity(p_user auth.users, p_session uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p_user.id, 'email', p_user.email, 'is_anonymous', p_user.is_anonymous,
    'has_password', p_user.encrypted_password <> '',
    'session_id', s.id, 'aal', s.aal, 'aal2_at', s.aal2_at, 'absolute_expires_at', s.absolute_expires_at)
  from auth.sessions s where s.id = p_session;
$$;
revoke execute on function private.auth_identity(auth.users, uuid) from public, anon, authenticated;

-- ============================================================ emailed one-time codes

-- Stage 1 of the code flow. The signup gate runs here, before any user row or code exists. Statuses
-- other than `sent` let the caller send no mail; the application answers all of them alike.
create function public.auth_issue_otp(
  p_email text, p_code_hash text, p_requester uuid default null, p_ttl_seconds integer default 600)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user auth.users;
  v_gate jsonb;
  v_ttl integer := least(greatest(coalesce(p_ttl_seconds, 600), 60), 900);
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254
     or coalesce(p_code_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- An anonymous demo identity can never request mail (PR-31, IAM-8).
  if p_requester is not null and exists (select 1 from auth.users u where u.id = p_requester and u.is_anonymous) then
    return jsonb_build_object('status', 'refused');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('auth_otp:' || v_email, 0));
  select * into v_user from auth.users u where lower(u.email) = v_email and u.deleted_at is null;
  if found then
    if not private.auth_user_active(v_user) then return jsonb_build_object('status', 'refused'); end if;
  else
    v_gate := private.before_user_created(jsonb_build_object('user',
      jsonb_build_object('email', v_email, 'is_anonymous', false, 'user_metadata', '{}'::jsonb)));
    if v_gate ? 'error' then
      return jsonb_build_object('status', 'blocked', 'message', v_gate #>> '{error,message}');
    end if;
  end if;
  delete from auth.otp_codes where created_at < now() - interval '1 day';
  -- A cumulative guess budget across codes, so asking for a fresh code does not reset the attempts.
  if (select coalesce(sum(c.attempts), 0) from auth.otp_codes c
        where c.email = v_email and c.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('status', 'throttled');
  end if;
  if exists (select 1 from auth.otp_codes c where c.email = v_email and c.purpose = 'login'
               and c.created_at > now() - interval '30 seconds') then
    return jsonb_build_object('status', 'too_soon');
  end if;
  update auth.otp_codes set consumed_at = now()
    where email = v_email and purpose = 'login' and consumed_at is null;
  insert into auth.otp_codes (email, purpose, code_hash, expires_at)
    values (v_email, 'login', p_code_hash, now() + make_interval(secs => v_ttl));
  return jsonb_build_object('status', 'sent', 'email', v_email);
end $$;

-- Stage 2: the right code (single use, at most 5 wrong guesses per code) signs the owner in,
-- creating the account when the gate still allows it. Wrong, expired, used and unknown all answer
-- `invalid`.
create function public.auth_verify_otp(
  p_email text, p_code_hash text, p_refresh_hash text, p_user_agent_hash text default null,
  p_absolute_seconds integer default 604800, p_idle_seconds integer default 604800)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code auth.otp_codes;
  v_user auth.users;
  v_gate jsonb;
  v_session uuid;
begin
  if coalesce(p_code_hash, '') !~ '^[a-f0-9]{64}$' or coalesce(p_refresh_hash, '') !~ '^[a-f0-9]{64}$'
     or char_length(v_email) > 254 then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('auth_otp:' || v_email, 0));
  select * into v_code from auth.otp_codes c
    where c.email = v_email and c.purpose = 'login' and c.consumed_at is null for update;
  if not found or v_code.expires_at <= now() then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_code.code_hash <> p_code_hash then
    update auth.otp_codes set attempts = attempts + 1,
      consumed_at = case when attempts + 1 >= 5 then now() end
      where id = v_code.id;
    return jsonb_build_object('status', 'invalid');
  end if;
  update auth.otp_codes set consumed_at = now() where id = v_code.id;
  select * into v_user from auth.users u where lower(u.email) = v_email and u.deleted_at is null;
  if found then
    if not private.auth_user_active(v_user) then return jsonb_build_object('status', 'invalid'); end if;
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), last_sign_in_at = now()
      where id = v_user.id returning * into v_user;
  else
    -- The gate is checked again: registration may have closed while the code was in the inbox.
    v_gate := private.before_user_created(jsonb_build_object('user',
      jsonb_build_object('email', v_email, 'is_anonymous', false, 'user_metadata', '{}'::jsonb)));
    if v_gate ? 'error' then return jsonb_build_object('status', 'invalid'); end if;
    insert into auth.users (email, email_confirmed_at, last_sign_in_at, raw_app_meta_data)
      values (v_email, now(), now(), '{"provider":"email","providers":["email"]}'::jsonb)
      returning * into v_user;
  end if;
  v_session := private.auth_open_session(v_user.id, p_refresh_hash, p_user_agent_hash, p_absolute_seconds, p_idle_seconds);
  return jsonb_build_object('status', 'ok') || private.auth_identity(v_user, v_session);
end $$;

-- ============================================================ passwords and sessions

-- The stored credential for the application's constant-time scrypt comparison. Nothing here proves
-- anything: opening a session still needs auth_create_session after a successful comparison.
create function public.auth_password_credential(p_email text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('user_id', u.id, 'encrypted_password', u.encrypted_password)
  from auth.users u
  where lower(u.email) = lower(btrim(coalesce(p_email, ''))) and u.deleted_at is null
    and not u.is_anonymous and u.email_confirmed_at is not null and u.encrypted_password <> ''
    and private.auth_user_active(u);
$$;

create function public.auth_create_session(
  p_user uuid, p_refresh_hash text, p_user_agent_hash text default null,
  p_absolute_seconds integer default 604800, p_idle_seconds integer default 604800)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user auth.users;
  v_session uuid;
begin
  if coalesce(p_refresh_hash, '') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status', 'invalid'); end if;
  select * into v_user from auth.users u where u.id = p_user;
  if not found or not private.auth_user_active(v_user) or v_user.is_anonymous
     or v_user.email_confirmed_at is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  update auth.users set last_sign_in_at = now() where id = v_user.id returning * into v_user;
  v_session := private.auth_open_session(v_user.id, p_refresh_hash, p_user_agent_hash, p_absolute_seconds, p_idle_seconds);
  return jsonb_build_object('status', 'ok') || private.auth_identity(v_user, v_session);
end $$;

create function public.auth_sign_in_anonymous(
  p_refresh_hash text, p_user_agent_hash text default null,
  p_absolute_seconds integer default 604800, p_idle_seconds integer default 604800)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user auth.users;
  v_session uuid;
begin
  if coalesce(p_refresh_hash, '') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status', 'invalid'); end if;
  insert into auth.users (is_anonymous, last_sign_in_at, raw_app_meta_data)
    values (true, now(), '{"provider":"anonymous","providers":["anonymous"]}'::jsonb)
    returning * into v_user;
  v_session := private.auth_open_session(v_user.id, p_refresh_hash, p_user_agent_hash, p_absolute_seconds, p_idle_seconds);
  return jsonb_build_object('status', 'ok') || private.auth_identity(v_user, v_session);
end $$;

-- Rotates the refresh token. The immediately preceding token is honoured for 10 seconds (parallel
-- requests from one browser): that answer carries `recent_reuse` and no new token, because only
-- hashes are stored; the caller mints an access token and leaves the cookie to the winning request.
-- Any older reuse revokes the whole session.
create function public.auth_refresh_session(p_refresh_hash text, p_new_refresh_hash text, p_idle_seconds integer default 604800)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_session auth.sessions;
  v_user auth.users;
  v_recent boolean := false;
begin
  if coalesce(p_refresh_hash, '') !~ '^[a-f0-9]{64}$' or coalesce(p_new_refresh_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_session from auth.sessions s where s.refresh_hash = p_refresh_hash for update;
  if not found then
    select * into v_session from auth.sessions s where s.previous_refresh_hash = p_refresh_hash for update;
    if not found then return jsonb_build_object('status', 'invalid'); end if;
    if v_session.revoked_at is not null then return jsonb_build_object('status', 'invalid'); end if;
    if v_session.refresh_rotated_at is null or v_session.refresh_rotated_at <= now() - interval '10 seconds' then
      update auth.sessions set revoked_at = now() where id = v_session.id;
      return jsonb_build_object('status', 'reuse_detected');
    end if;
    v_recent := true;
  end if;
  if v_session.revoked_at is not null or v_session.absolute_expires_at <= now() or v_session.idle_expires_at <= now() then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_user from auth.users u where u.id = v_session.user_id;
  if not private.auth_user_active(v_user) then return jsonb_build_object('status', 'invalid'); end if;
  if not v_recent then
    update auth.sessions set
        previous_refresh_hash = refresh_hash, refresh_hash = p_new_refresh_hash, refresh_rotated_at = now(),
        idle_expires_at = least(absolute_expires_at, now() + make_interval(secs => least(greatest(coalesce(p_idle_seconds, 604800), 60), 604800)))
      where id = v_session.id;
  end if;
  return jsonb_build_object('status', case when v_recent then 'recent_reuse' else 'ok' end)
    || private.auth_identity(v_user, v_session.id);
end $$;

-- The equivalent of getUser() revocation checking: is this session still alive right now?
create function public.auth_session_live(p_session uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('live', true) || private.auth_identity(u, s.id)
    from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = p_session and s.revoked_at is null and s.absolute_expires_at > now()
      and s.idle_expires_at > now() and private.auth_user_active(u)
  ), jsonb_build_object('live', false));
$$;

create function public.auth_revoke_session(p_session uuid)
returns void language sql security definer set search_path = ''
as $$ update auth.sessions set revoked_at = now() where id = p_session and revoked_at is null; $$;

-- Sets the password of an inbox-verified, non-anonymous identity and ends every other session
-- (a password change is a credential event). The length rule is the caller's: only a hash arrives.
create function public.auth_set_password(p_user uuid, p_hash text, p_keep_session uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_user auth.users;
begin
  if coalesce(p_hash, '') !~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_user from auth.users u where u.id = p_user for update;
  if not found or v_user.is_anonymous or v_user.email_confirmed_at is null or not private.auth_user_active(v_user) then
    return jsonb_build_object('status', 'invalid');
  end if;
  update auth.users set encrypted_password = p_hash, updated_at = now() where id = p_user;
  update auth.sessions set revoked_at = now()
    where user_id = p_user and revoked_at is null and id is distinct from p_keep_session;
  return jsonb_build_object('status', 'ok');
end $$;

create function public.auth_revoke_user_sessions(p_user uuid, p_except uuid default null)
returns void language sql security definer set search_path = ''
as $$
  update auth.sessions set revoked_at = now()
  where user_id = p_user and revoked_at is null and id is distinct from p_except;
$$;

-- ============================================================ TOTP (Super Admin second factor)

-- The application generates the secret and passes only the sealed (AES-GCM) text. An unverified
-- factor from an earlier attempt is replaced; a verified factor is never replaced here.
create function public.auth_mfa_enroll(p_user uuid, p_secret_sealed text, p_friendly_name text default 'GeraiExpress')
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user auth.users;
  v_factor uuid;
begin
  if coalesce(p_secret_sealed, '') = '' then return jsonb_build_object('status', 'invalid'); end if;
  select * into v_user from auth.users u where u.id = p_user for update;
  if not found or v_user.is_anonymous or v_user.email_confirmed_at is null or not private.auth_user_active(v_user) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified') then
    return jsonb_build_object('status', 'already_verified');
  end if;
  delete from auth.mfa_factors where user_id = p_user and status = 'unverified';
  insert into auth.mfa_factors (user_id, friendly_name, secret_sealed)
    values (p_user, left(coalesce(p_friendly_name, 'GeraiExpress'), 60), p_secret_sealed)
    returning id into v_factor;
  return jsonb_build_object('status', 'ok', 'factor_id', v_factor);
end $$;

-- The factor to check a code against: the verified one when it exists, otherwise the named
-- unverified one (enrollment in progress). The sealed secret goes to the server only.
create function public.auth_mfa_factor(p_user uuid, p_factor uuid default null)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('factor_id', f.id, 'status', f.status, 'secret_sealed', f.secret_sealed,
    'last_used_step', f.last_used_step)
  from auth.mfa_factors f
  where f.user_id = p_user and f.factor_type = 'totp'
    and (f.status = 'verified' or (f.status = 'unverified' and f.id = p_factor))
  order by (f.status = 'verified') desc, f.created_at desc
  limit 1;
$$;

-- Called only after the application verified the code for time step `p_step`. A step that is not
-- strictly newer than the last accepted one is a replay. The session moves to aal2 and its refresh
-- token is replaced (a privilege change rotates the credential; the old token dies at once).
create function public.auth_mfa_verify(
  p_user uuid, p_factor uuid, p_session uuid, p_step bigint, p_new_refresh_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_factor_id uuid;
  v_session auth.sessions;
begin
  if p_step is null or p_step < 0 or coalesce(p_new_refresh_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_session from auth.sessions s
    where s.id = p_session and s.user_id = p_user and s.revoked_at is null
      and s.absolute_expires_at > now() and s.idle_expires_at > now() for update;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  update auth.mfa_factors set last_used_step = p_step, status = 'verified',
      verified_at = coalesce(verified_at, now()), updated_at = now()
    where id = p_factor and user_id = p_user and factor_type = 'totp'
      and (last_used_step is null or last_used_step < p_step)
    returning id into v_factor_id;
  if v_factor_id is null then return jsonb_build_object('status', 'replay'); end if;
  update auth.sessions set aal = 'aal2', aal2_at = now(),
      previous_refresh_hash = null, refresh_hash = p_new_refresh_hash, refresh_rotated_at = now()
    where id = p_session;
  return jsonb_build_object('status', 'ok') || private.auth_identity(
    (select u from auth.users u where u.id = p_user), p_session);
end $$;

-- ============================================================ housekeeping

-- Rows that can no longer matter. The scheduler wires this in T-066.
create function public.auth_purge_expired()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_sessions integer; v_codes integer;
begin
  delete from auth.sessions where least(absolute_expires_at, coalesce(revoked_at, absolute_expires_at)) < now() - interval '7 days';
  get diagnostics v_sessions = row_count;
  delete from auth.otp_codes where created_at < now() - interval '1 day';
  get diagnostics v_codes = row_count;
  return jsonb_build_object('sessions', v_sessions, 'otp_codes', v_codes);
end $$;

revoke execute on function
  public.auth_issue_otp(text, text, uuid, integer),
  public.auth_verify_otp(text, text, text, text, integer, integer),
  public.auth_password_credential(text),
  public.auth_create_session(uuid, text, text, integer, integer),
  public.auth_sign_in_anonymous(text, text, integer, integer),
  public.auth_refresh_session(text, text, integer),
  public.auth_session_live(uuid),
  public.auth_revoke_session(uuid),
  public.auth_set_password(uuid, text, uuid),
  public.auth_revoke_user_sessions(uuid, uuid),
  public.auth_mfa_enroll(uuid, text, text),
  public.auth_mfa_factor(uuid, uuid),
  public.auth_mfa_verify(uuid, uuid, uuid, bigint, text),
  public.auth_purge_expired()
  from public, anon, authenticated;
grant execute on function
  public.auth_issue_otp(text, text, uuid, integer),
  public.auth_verify_otp(text, text, text, text, integer, integer),
  public.auth_password_credential(text),
  public.auth_create_session(uuid, text, text, integer, integer),
  public.auth_sign_in_anonymous(text, text, integer, integer),
  public.auth_refresh_session(text, text, integer),
  public.auth_session_live(uuid),
  public.auth_revoke_session(uuid),
  public.auth_set_password(uuid, text, uuid),
  public.auth_revoke_user_sessions(uuid, uuid),
  public.auth_mfa_enroll(uuid, text, text),
  public.auth_mfa_factor(uuid, uuid),
  public.auth_mfa_verify(uuid, uuid, uuid, bigint, text),
  public.auth_purge_expired()
  to service_role;
