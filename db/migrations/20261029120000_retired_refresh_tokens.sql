-- Second review of the owned auth (T-067): the retired-refresh-hash list in 20261029110000 was capped at 50
-- entries, so a stolen token that was rotated more than 50 times later left the history and its reuse
-- stopped revoking the session. A legitimate session rotates about every 10 minutes for up to 7 days
-- (roughly a thousand times), so a count cap cannot be both safe and usable. Retired hashes now live in a
-- child table that is kept as long as the session exists (deleted with it), looked up by primary key.
-- The runner applies this file in one transaction; the lock keeps a concurrent refresh from appending a hash
-- to the old column between the backfill and the column drop (review: history could be lost). The lock is held
-- until commit, so no auth writer runs against a half-migrated table.
lock table auth.sessions in access exclusive mode;

create table auth.retired_refresh_tokens (
  hash text primary key check (hash ~ '^[a-f0-9]{64}$'),
  session_id uuid not null references auth.sessions (id) on delete cascade,
  retired_at timestamptz not null default now()
);
create index retired_refresh_tokens_session_idx on auth.retired_refresh_tokens (session_id);
alter table auth.retired_refresh_tokens enable row level security;
revoke all on auth.retired_refresh_tokens from public, anon, authenticated, service_role;

insert into auth.retired_refresh_tokens (hash, session_id)
  select h, s.id from auth.sessions s, unnest(s.retired_refresh_hashes) h on conflict do nothing;
drop index auth.sessions_retired_refresh_idx;
alter table auth.sessions drop column retired_refresh_hashes;

create or replace function public.auth_refresh_session(p_refresh_hash text, p_new_refresh_hash text, p_idle_seconds integer default 604800)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_session auth.sessions;
  v_user auth.users;
  v_recent boolean := false;
  v_retired uuid;
begin
  if coalesce(p_refresh_hash, '') !~ '^[a-f0-9]{64}$' or coalesce(p_new_refresh_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_session from auth.sessions s where s.refresh_hash = p_refresh_hash for update;
  if not found then
    select * into v_session from auth.sessions s where s.previous_refresh_hash = p_refresh_hash for update;
    if not found then
      -- Any older generation than the previous one is a stolen or replayed token: kill its session.
      select r.session_id into v_retired from auth.retired_refresh_tokens r where r.hash = p_refresh_hash;
      if v_retired is not null then
        update auth.sessions set revoked_at = now() where id = v_retired and revoked_at is null;
        return jsonb_build_object('status', 'reuse_detected');
      end if;
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
    insert into auth.retired_refresh_tokens (hash, session_id) values (v_session.refresh_hash, v_session.id)
      on conflict do nothing;
    update auth.sessions set
        previous_refresh_hash = refresh_hash, refresh_hash = p_new_refresh_hash, refresh_rotated_at = now(),
        idle_expires_at = least(absolute_expires_at, now() + make_interval(secs => least(greatest(coalesce(p_idle_seconds, 604800), 60), 604800)))
      where id = v_session.id;
  end if;
  return jsonb_build_object('status', case when v_recent then 'recent_reuse' else 'ok' end)
    || private.auth_identity(v_user, v_session.id);
end $$;

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
  insert into auth.retired_refresh_tokens (hash, session_id) values (v_session.refresh_hash, v_session.id)
    on conflict do nothing;
  update auth.sessions set aal = 'aal2', aal2_at = now(),
      previous_refresh_hash = null, refresh_hash = p_new_refresh_hash, refresh_rotated_at = now(),
      absolute_expires_at = least(absolute_expires_at, now() + interval '12 hours'),
      idle_expires_at = least(idle_expires_at, now() + interval '12 hours')
    where id = p_session;
  return jsonb_build_object('status', 'ok') || private.auth_identity(
    (select u from auth.users u where u.id = p_user), p_session);
end $$;
