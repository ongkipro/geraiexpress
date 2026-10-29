-- PR-29 / IAM-4: public real-account registration stays closed until email verification and the
-- in-stack mail path (ARCH-3) are accepted. Only anonymous demo sessions may create Auth users.
create function private.before_user_created(event jsonb)
returns jsonb
language plpgsql stable set search_path = ''
as $$
begin
  if coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Pendaftaran akun belum dibuka. Gunakan akun yang diundang atau coba demo.'));
end $$;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function private.before_user_created(jsonb) from public, anon, authenticated;
