-- T-051 (review DIL-07, DIL-15, DIL-19): per-tenant caps for demo workspaces, a race-safe start_demo,
-- a bounded demo cleanup and a database-side schedule for it that needs no Worker secret.

-- ============================================================ demo quotas (DIL-07)

-- Any anonymous session can reach the Data API with the publishable key and loop draft creation,
-- contact and address inserts, and quote requests. Caps live in BEFORE INSERT triggers so every
-- write path (RPC, direct insert, future functions) is covered, and only for tenants with
-- is_demo = true: a real gerai is never limited here. The caps are above what the sample data and
-- a full review session need (seed: 3 shipments, 4 contacts, 5 addresses, 2 quotes). Shipments
-- allow 100 rather than the review's suggested 50 because tests/db/tenant-slug-reference.test.ts
-- creates 60 parallel drafts on one demo tenant.
--
-- Error contract: message `demo_limit`, SQLSTATE 55000. PostgREST retries only 40001/40P01 and
-- returns the message to the client, so the app maps the stable code (src/lib/errors.ts);
-- 55000 is the code already used for deterministic "state does not allow this" refusals.
-- A per-tenant, per-table advisory lock serializes concurrent inserts so parallel requests
-- cannot overshoot the cap; the lock is transaction-scoped.
create function private.enforce_demo_quota()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_cap integer;
  v_count integer;
begin
  if not exists (select 1 from public.tenants where id = new.tenant_id and is_demo) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('demo_quota:' || tg_table_name || ':' || new.tenant_id::text, 0));

  -- Counts are bounded by the cap itself, so the scan never reads more than cap rows.
  if tg_table_name = 'shipments' then
    v_cap := 100;
    select count(*) into v_count from (select 1 from public.shipments where tenant_id = new.tenant_id limit 100) c;
  elsif tg_table_name = 'contacts' then
    v_cap := 100;
    select count(*) into v_count from (select 1 from public.contacts where tenant_id = new.tenant_id limit 100) c;
  elsif tg_table_name = 'contact_addresses' then
    v_cap := 300;
    select count(*) into v_count from (select 1 from public.contact_addresses where tenant_id = new.tenant_id limit 300) c;
  elsif tg_table_name = 'shipment_quotes' then
    v_cap := 300;
    select count(*) into v_count from (select 1 from public.shipment_quotes where tenant_id = new.tenant_id limit 300) c;
  else
    raise exception 'enforce_demo_quota is not defined for table %', tg_table_name;
  end if;

  if v_count >= v_cap then
    raise exception 'demo_limit' using errcode = '55000', detail = tg_table_name, hint = v_cap::text;
  end if;
  return new;
end $$;

revoke all on function private.enforce_demo_quota() from public, anon, authenticated;

create trigger demo_quota before insert on public.shipments
  for each row execute function private.enforce_demo_quota();
create trigger demo_quota before insert on public.contacts
  for each row execute function private.enforce_demo_quota();
create trigger demo_quota before insert on public.contact_addresses
  for each row execute function private.enforce_demo_quota();
create trigger demo_quota before insert on public.shipment_quotes
  for each row execute function private.enforce_demo_quota();

-- ============================================================ start_demo race (DIL-15)

-- Same body as 20261014110000_reconcile_admin_only.sql plus a per-user advisory lock before the
-- lookup, so two parallel calls from one anonymous user serialize and the second sees the
-- first one's membership instead of creating a second sample gerai.
create or replace function public.start_demo()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_tenant uuid;
  v_outlet uuid;
begin
  if v_user is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false then
    raise exception 'demo_requires_anonymous_session' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('start_demo:' || v_user::text, 0));
  select m.tenant_id into v_tenant from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = v_user and t.is_demo limit 1;
  if v_tenant is not null then return v_tenant; end if;

  insert into public.tenants (name, lifecycle, is_demo)
    values ('Gerai Contoh Sentosa', 'active', true) returning id into v_tenant;
  insert into public.outlets (tenant_id, name, pickup_address, pickup_area)
    values (v_tenant, 'Outlet Contoh Dago', 'Jl. Contoh Dago No. 10', 'Kec. Coblong, Kota Bandung')
    returning id into v_outlet;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant, v_user, 'tenant_admin');
  perform private.seed_demo(v_tenant, v_outlet, v_user);
  return v_tenant;
end $$;

-- ============================================================ bounded cleanup (DIL-19)

-- Indexes for the history anti-join used when deciding whether an anonymous identity can go.
create index if not exists shipments_created_by_idx on public.shipments (created_by) where created_by is not null;
create index if not exists provider_operations_actor_idx on public.provider_operations (actor) where actor is not null;
create index if not exists label_jobs_requested_by_idx on public.label_jobs (requested_by) where requested_by is not null;
create index if not exists shipment_events_actor_idx on public.shipment_events (actor) where actor is not null;

-- A new overload would make a one-argument call ambiguous, so the old signature is replaced.
-- Each call removes at most p_batch expired demo tenants and at most p_batch orphaned anonymous
-- identities (oldest first) and reports has_more so a caller can run again; the schedule and the
-- Worker both call it periodically.
drop function public.cleanup_expired_demos(integer);

create function public.cleanup_expired_demos(p_max_age_hours integer default 24, p_batch integer default 200)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_ids uuid[];
  v_tenants integer := 0;
  v_users integer := 0;
  v_more boolean;
begin
  if p_max_age_hours is null or p_max_age_hours < 1 or p_max_age_hours > 8760
     or p_batch is null or p_batch < 1 or p_batch > 5000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(hours => p_max_age_hours);

  select coalesce(array_agg(b.id), '{}') into v_ids from (
    select t.id from public.tenants t
    where t.is_demo is true and t.created_at < v_cutoff
    order by t.created_at, t.id
    limit p_batch
  ) b;

  delete from public.shipments where tenant_id = any (v_ids);
  with deleted_t as (
    delete from public.tenants where id = any (v_ids) returning id
  )
  select count(*)::integer into v_tenants from deleted_t;

  -- Cheap anonymous filter first (indexed), history checks only for those candidates.
  with deleted_u as (
    delete from auth.users where id in (
      select u.id from auth.users u
      where u.is_anonymous is true
        and u.created_at < v_cutoff
        and not exists (select 1 from public.memberships m where m.user_id = u.id)
        and not exists (select 1 from public.shipments s where s.created_by = u.id)
        and not exists (select 1 from public.provider_operations o where o.actor = u.id)
        and not exists (select 1 from public.label_jobs j where j.requested_by = u.id)
        and not exists (select 1 from public.shipment_events e where e.actor = u.id)
      order by u.created_at, u.id
      limit p_batch
    )
    returning id
  )
  select count(*)::integer into v_users from deleted_u;

  select exists (select 1 from public.tenants where is_demo is true and created_at < v_cutoff)
      or v_users >= p_batch
    into v_more;

  return jsonb_build_object('deleted_tenants', v_tenants, 'deleted_users', v_users, 'has_more', v_more);
end $$;

revoke all on function public.cleanup_expired_demos(integer, integer) from public, anon, authenticated;
grant execute on function public.cleanup_expired_demos(integer, integer) to service_role;

-- ============================================================ database-side schedule

-- Preview and staging bind no machine secret to the Worker, so the sweep there cannot be the only
-- scheduler. pg_cron runs inside the database. Guarded: where the extension is not available
-- (or cannot be created by this role) the migration still succeeds and the Worker cron remains
-- the scheduler. Idempotent: cron.schedule with an existing job name updates that job.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron could not be created (%): demo cleanup stays with the Worker cron', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('demo-cleanup', '0 * * * *', 'select public.cleanup_expired_demos(24, 200)');
  end if;
end $$;
