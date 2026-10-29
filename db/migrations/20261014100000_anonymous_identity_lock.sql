-- PR-31 / IAM-4 / IAM-8: an anonymous demo identity stays demo-only. Supabase Auth lets an
-- anonymous user link an email, phone or OAuth identity and become permanent with the same id;
-- the before_user_created hook does not run for that update. Refuse the conversion at its source
-- (the pending email/phone change request) and at its outcome (identity attached, flag cleared),
-- so an inbox owner cannot turn a demo session into a real account that could match an invitation.
-- Auth writes '' rather than NULL for some of these columns, hence the coalesce.
create function private.lock_anonymous_identity()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.is_anonymous and (
       new.is_anonymous is distinct from true
    or coalesce(new.email, '') <> coalesce(old.email, '')
    or coalesce(new.email_change, '') <> coalesce(old.email_change, '')
    or coalesce(new.phone, '') <> coalesce(old.phone, '')
    or coalesce(new.phone_change, '') <> coalesce(old.phone_change, '')
    or coalesce(new.encrypted_password, '') <> coalesce(old.encrypted_password, '')) then
    raise exception 'anonymous_identity_is_demo_only' using errcode = '42501';
  end if;
  return new;
end $$;

revoke execute on function private.lock_anonymous_identity() from public, anon, authenticated;

create trigger lock_anonymous_identity
  before update on auth.users
  for each row execute function private.lock_anonymous_identity();
