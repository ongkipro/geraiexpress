-- Findings of the independent review of the owned auth core (T-067, F-02, F-03, F-06). The first auth
-- migration (20261029100000) is not edited; these definitions replace its functions.

-- F-02: every retired refresh hash stays recognisable, so presenting ANY earlier generation of a
-- session's refresh token (not only the immediately preceding one) revokes the session. Two quick
-- rotations can no longer erase the stolen token's trace.
alter table auth.sessions add column retired_refresh_hashes text[] not null default '{}';
create index sessions_retired_refresh_idx on auth.sessions using gin (retired_refresh_hashes);

create or replace function public.auth_refresh_session(p_refresh_hash text, p_new_refresh_hash text, p_idle_seconds integer default 604800)
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
    if not found then
      -- An older generation than the previous one: a stolen or replayed token. Kill the session.
      update auth.sessions set revoked_at = now()
        where p_refresh_hash = any (retired_refresh_hashes) and revoked_at is null;
      if found then return jsonb_build_object('status', 'reuse_detected'); end if;
      return jsonb_build_object('status', 'invalid');
    end if;
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
        retired_refresh_hashes = (retired_refresh_hashes || refresh_hash)[greatest(1, cardinality(retired_refresh_hashes) + 2 - 50):],
        previous_refresh_hash = refresh_hash, refresh_hash = p_new_refresh_hash, refresh_rotated_at = now(),
        idle_expires_at = least(absolute_expires_at, now() + make_interval(secs => least(greatest(coalesce(p_idle_seconds, 604800), 60), 604800)))
      where id = v_session.id;
  end if;
  return jsonb_build_object('status', case when v_recent then 'recent_reuse' else 'ok' end)
    || private.auth_identity(v_user, v_session.id);
end $$;

-- F-03: the session that is told to survive must itself be live and belong to the user; otherwise a
-- racing, already-revoked caller could overwrite a newer password and lock the real owner out.
create or replace function public.auth_set_password(p_user uuid, p_hash text, p_keep_session uuid default null)
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
  if p_keep_session is not null and not exists (
       select 1 from auth.sessions s
       where s.id = p_keep_session and s.user_id = p_user and s.revoked_at is null
         and s.absolute_expires_at > now() and s.idle_expires_at > now()) then
    return jsonb_build_object('status', 'invalid');
  end if;
  update auth.users set encrypted_password = p_hash, updated_at = now() where id = p_user;
  update auth.sessions set revoked_at = now()
    where user_id = p_user and revoked_at is null and id is distinct from p_keep_session;
  return jsonb_build_object('status', 'ok');
end $$;

-- F-06: one factor per user (the enrol function already replaces a stale unverified one), and an
-- upgrade to aal2 never outlives the 12-hour Super Admin bound, even for a session opened before the
-- grant existed.
create unique index mfa_factors_one_per_user on auth.mfa_factors (user_id);

create or replace function public.auth_mfa_verify(
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
      retired_refresh_hashes = (retired_refresh_hashes || refresh_hash)[greatest(1, cardinality(retired_refresh_hashes) + 2 - 50):],
      previous_refresh_hash = null, refresh_hash = p_new_refresh_hash, refresh_rotated_at = now(),
      absolute_expires_at = least(absolute_expires_at, now() + interval '12 hours'),
      idle_expires_at = least(idle_expires_at, now() + interval '12 hours')
    where id = p_session;
  return jsonb_build_object('status', 'ok') || private.auth_identity(
    (select u from auth.users u where u.id = p_user), p_session);
end $$;
