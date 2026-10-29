-- Serialize a kept session with revocation during password writes.
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
         and s.absolute_expires_at > now() and s.idle_expires_at > now() for update) then
    return jsonb_build_object('status', 'invalid');
  end if;
  update auth.users set encrypted_password = p_hash, updated_at = now() where id = p_user;
  update auth.sessions set revoked_at = now()
    where user_id = p_user and revoked_at is null and id is distinct from p_keep_session;
  return jsonb_build_object('status', 'ok');
end $$;

-- T-068: the registration password is initialized once, under the same row lock as
-- the existing password writer. Concurrent submissions may not replace the winner.
create function public.auth_initialize_password(p_user uuid, p_hash text, p_keep_session uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_password text;
begin
  select encrypted_password into v_password from auth.users where id = p_user for update;
  if not found or coalesce(v_password, '') <> '' or p_keep_session is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  return public.auth_set_password(p_user, p_hash, p_keep_session);
end $$;
revoke all on function public.auth_initialize_password(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.auth_initialize_password(uuid, text, uuid) to service_role;

-- The signup gate is still called by application-owned auth; the retired GoTrue
-- role no longer needs privileges. Keep the NOLOGIN role so historic migrations
-- remain reproducible and do not alter cluster-wide roles used by another database.
revoke execute on function public.registration_open() from supabase_auth_admin;
revoke all on schema private from supabase_auth_admin;
revoke all on all functions in schema private from supabase_auth_admin;
revoke all on all tables in schema private from supabase_auth_admin;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

notify pgrst, 'reload schema';
