-- T-035 (review P1-2, DIL-02): make "a new function is not executable by anon" true by default.
--
-- PostgreSQL grants EXECUTE on every new function to PUBLIC globally, and anon, authenticated and
-- service_role are members of PUBLIC. The per-schema `alter default privileges in schema public
-- revoke execute on functions from public, anon, authenticated` in the foundation migration cannot
-- remove a global grant ("you cannot revoke privileges per-schema if they are granted globally"),
-- so until now only the per-function `revoke ... from public` discipline kept SECURITY DEFINER
-- RPCs away from anon. The global form below removes that dependency: a function created by this
-- migration role without an explicit grant is executable by its owner only.
--
-- postgres is the role that owns every function in `public` and `private` and runs these
-- migrations (supabase db reset / db push). Vendor-managed schemas are created by supabase_admin
-- and supabase_auth_admin; postgres is not a member of either role, so their defaults cannot and
-- need not be changed here.
alter default privileges for role postgres revoke execute on functions from public;

-- The foundation migration's per-schema revoke (in schema public, from public, anon, authenticated)
-- stays: it also strips the explicit anon/authenticated entries the Supabase platform adds to
-- functions postgres creates in public.

-- Existing gaps the catalog test (tests/db/privileges.test.ts) found: private helpers created
-- after the foundation migration kept the PUBLIC EXECUTE grant. Four are trigger functions
-- (trigger permission is checked when the trigger is created, never when it fires) and
-- definitely_not_created only backs the provider_operations_one_create index predicate
-- (index expressions are not permission-checked at write time). None needs an API role.
revoke all on function private.audit_append_only() from public, anon, authenticated;
revoke all on function private.clear_outlet_mengantar_pickup() from public, anon, authenticated;
revoke all on function private.clear_stale_address_area() from public, anon, authenticated;
revoke all on function private.preserve_immutable_onboarding_identity() from public, anon, authenticated;
revoke all on function private.definitely_not_created(text, text) from public, anon, authenticated;
