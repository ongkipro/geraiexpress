-- T-109 / NFR-1: database follow-ups proposed by T-104, T-105 and T-106. Forward-only; no applied
-- migration is edited. Function bodies are new or recreated from their latest definition with
-- SECURITY DEFINER, `set search_path = ''` and an explicit ACL; refusals use 55000/22023, never 40001.

-- ============================================================ dead objects (T-106 proposal)

-- Callerless since T-091/T-092 moved the platform tenant directory to platform_tenant_directory
-- (20261103130000): no reference in src/, scripts or another SQL body.
drop function public.platform_tenants();
drop function public.platform_tenant_slugs();

-- GoTrue-shaped columns kept by the foundation for the old SQL. Never read or written by src/, scripts,
-- a migration body, a trigger (lock_anonymous_identity reads email/email_change/phone/phone_change/
-- encrypted_password only), a view, an index or the seed/fixtures. Not dropped: aud (pinned shape of the
-- identity row), raw_app_meta_data (written by the auth RPCs), mfa_factors.friendly_name (written by
-- auth_mfa_enroll), and the supabase_auth_admin role (registration_open and before_user_created are
-- still granted to it).
alter table auth.users
  drop column if exists instance_id,
  drop column if exists confirmation_token,
  drop column if exists recovery_token,
  drop column if exists email_change_token_new,
  drop column if exists raw_user_meta_data;

-- ============================================================ per-role timeouts (T-105 follow-up)

-- PostgREST (v14) connects as `authenticator` and switches to anon, authenticated or service_role per
-- request. Plain SET ROLE does not apply a role's ALTER ROLE settings; PostgREST's impersonated-role
-- settings do: it reads these settings at startup and on `notify pgrst, 'reload config'` and applies them
-- with set_config(.., true) inside every request transaction of that role. Values follow the application
-- deadlines (src/lib/db/client.ts): the database gives up at or before the moment the caller stops waiting,
-- so no statement keeps running for an answer nobody reads.
--   authenticated: 15 s = DB_TIMEOUT_MS (interactive; pilot_report over 92 days is a range scan on the
--     T-104 indexes, far below it); lock waits 5 s (a waiting request still leaves time to answer).
--   anon: 5 s (registration_open, track_shipment: single indexed reads; /healthz waits 2 s).
--   service_role: 60 s = SCHEDULED_DB_TIMEOUT_MS (dispatch sweep, demo cleanup batch of 200, auth purge
--     batches of 1000, rewrap batch; interactive machine calls are bounded by the app's 15 s first).
-- idle_in_transaction_session_timeout: PostgREST never leaves a request transaction idle; this only
-- bounds a stuck connection. authenticator's statement_timeout is the upper bound for anything that is
-- not run under an impersonated role (schema cache queries). The `postgres` role (migration runner,
-- backups, maintenance) has none of these settings; the runner sets its own.
alter role authenticated set statement_timeout = '15s';
alter role authenticated set lock_timeout = '5s';
alter role authenticated set idle_in_transaction_session_timeout = '30s';
alter role anon set statement_timeout = '5s';
alter role anon set lock_timeout = '3s';
alter role anon set idle_in_transaction_session_timeout = '15s';
alter role service_role set statement_timeout = '60s';
alter role service_role set lock_timeout = '10s';
alter role service_role set idle_in_transaction_session_timeout = '60s';
alter role authenticator set statement_timeout = '65s';
notify pgrst, 'reload config';

-- ============================================================ schema version (readiness)

-- The newest applied migration version (14 digits), for the readiness probe: /healthz is not ready while
-- the database is older than the image expects (src/lib/schema-version.ts). Machine-only: the version
-- reveals nothing else, but anonymous callers need none of it. Reads the runner's ledger only.
create function public.schema_version()
returns text language sql stable security definer set search_path = ''
as $$ select max(version) from private.schema_migrations; $$;
revoke all on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;

-- ============================================================ credential rewrap selection (T-105 follow-up)

-- One keyset page of the non-demo tenants whose ACTIVE credential of this provider environment is sealed
-- under a key version below p_current_version, in tenant id order after p_after. Already-current,
-- higher (never downgraded) and credential-less tenants are never listed, so the hourly rewrap reads only
-- work. Returns a JSON array of tenant ids; ids only, never ciphertext. Machine-only. The caller keeps the
-- cursor; a rewrapped tenant leaves the set by itself, so a restarted pass repeats nothing.
create function public.machine_rewrap_candidates(p_env text, p_current_version text, p_after uuid, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') or coalesce(p_current_version, '') !~ '^v[0-9]{1,4}$'
     or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(x.tenant_id order by x.tenant_id) from (
    select c.tenant_id from private.seller_credentials c
      join public.tenants t on t.id = c.tenant_id and t.is_demo = false
    where c.superseded_at is null and c.provider_env = p_env
      and substr(c.key_version, 2)::integer < substr(p_current_version, 2)::integer
      and (p_after is null or c.tenant_id > p_after)
    order by c.tenant_id
    limit p_limit) x), '[]'::jsonb);
end $$;
revoke all on function public.machine_rewrap_candidates(text, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.machine_rewrap_candidates(text, text, uuid, integer) to service_role;

-- The tenant list read (credential-keyring listTenantIds) was service_role's last direct table privilege
-- (kept by T-104); the rewrap now selects through the RPC above, so the machine identity holds no table
-- privilege in public at all.
revoke select on public.tenants from service_role;

notify pgrst, 'reload schema';
