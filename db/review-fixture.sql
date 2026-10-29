-- Review fixture (local gxdb only): one synthetic gerai for development and data review.
-- Not part of `seed.sql` and never applied by `pnpm db:verify` or any remote command. Apply with
--   docker exec -i gxdb-postgres-1 psql -U postgres -d gxdb -v ON_ERROR_STOP=1 < db/review-fixture.sql
-- Idempotent: running it twice changes nothing. Every row is synthetic and marked "(contoh)";
-- shipments are simulated, so no provider call can ever be made for them.
--
-- Guard: the same local-only marker as seed.sql (gx-prefixed database and app.gx_local=on, set only by
-- compose.db.yaml) AND the local seed user, because only a locally seeded database has it.

do $guard$
begin
  if current_database() !~ '^gx' or current_setting('app.gx_local', true) is distinct from 'on' then
    raise exception 'review_fixture_local_only: expected a gx-prefixed local Compose database (app.gx_local=on)'
      using errcode = '55000';
  end if;
  if not exists (select 1 from auth.users where email = 'owner-a@geraiexpress.test') then
    raise exception 'review_fixture_local_only: the local seed is not present; refusing to run';
  end if;
end $guard$;

do $$
declare
  -- The synthetic fixture password of seed.sql (geraiexpress-local-dev): copy the seeded user's hash.
  pw text := (select encrypted_password from auth.users where email = 'owner-a@geraiexpress.test');
  v_tenant constant uuid := '00000000-0000-4000-b000-0000000000d1';
  v_outlet constant uuid := '00000000-0000-4000-c000-0000000000d1';
  v_admin  constant uuid := '00000000-0000-4000-a000-0000000000a3';
  v_oper   constant uuid := '00000000-0000-4000-a000-0000000000a4';
  u record;
begin
  if exists (select 1 from public.tenants where id = v_tenant) then
    raise notice 'review fixture already present; nothing to do';
    return;
  end if;

  for u in select * from (values
    (v_admin, 'admin-review@geraiexpress.test'),
    (v_oper,  'operator-review@geraiexpress.test')
  ) as t(id, email) loop
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data)
    values (u.id, u.email, pw, now(), '{"provider":"email","providers":["email"]}');
  end loop;

  -- A real (non-demo) active gerai, so the product behaves as it would for a registered tenant.
  insert into public.tenants (id, name, lifecycle) values (v_tenant, 'Gerai Demo Review (contoh)', 'active');
  insert into public.outlets (tenant_id, id, name, pickup_address, pickup_area) values
    (v_tenant, v_outlet, 'Outlet Review Dago (contoh)', 'Jl. Contoh Review No. 7', 'Kec. Coblong, Kota Bandung');
  insert into public.memberships (tenant_id, user_id, role) values
    (v_tenant, v_admin, 'tenant_admin'),
    (v_tenant, v_oper, 'operator');

  -- Contacts, addresses and shipments in the three recovery-relevant states (issued, unknown, draft).
  perform private.seed_demo(v_tenant, v_outlet, v_admin);
end $$;
