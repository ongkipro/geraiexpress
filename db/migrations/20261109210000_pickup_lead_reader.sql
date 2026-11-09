-- T-043 review fix: the application reads the pickup lead-time setting, so it has one source of truth.
--
-- private.pickup_lead_minutes() (20261109200000) is never granted to a browser. The draft validation, the
-- confirmation pre-check, the Worker's re-check and the intake hint all need the same number the database
-- enforces, so this public wrapper returns exactly that value. The minutes are not sensitive (the intake
-- form prints them); the wrapper takes no argument and reads no tenant data.
create function public.pickup_lead_minutes()
returns integer language sql stable security definer set search_path = ''
as $$ select private.pickup_lead_minutes(); $$;
revoke all on function public.pickup_lead_minutes() from public, anon;
grant execute on function public.pickup_lead_minutes() to authenticated, service_role;
