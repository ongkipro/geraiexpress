-- Local-only guard (T-064 / DIL-18). This seed creates known-password administrators and opens
-- registration. Require BOTH the gx-prefixed database and the marker set only by compose.db.yaml.
-- Unlike the old demo-JWT-secret guard, no vendor default or reusable signing secret is trusted.
do $guard$
begin
  if current_database() !~ '^gx' or current_setting('app.gx_local', true) is distinct from 'on' then
    raise exception 'seed.sql refused: expected a gx-prefixed local Compose database (app.gx_local=on)'
      using errcode = '55000';
  end if;
end $guard$;

-- Synthetic fixture password: geraiexpress-local-dev. Each constant has its own 16-byte salt.
-- Generated once with Node's crypto.scrypt (N=32768, r=8, p=1, 64-byte key); generator command:
-- node --input-type=module -e 'import {randomBytes,scryptSync} from "node:crypto"; const s=randomBytes(16); console.log(["scrypt",32768,8,1,s.toString("base64url"),scryptSync("geraiexpress-local-dev",s,64,{N:32768,r:8,p:1,maxmem:67108864}).toString("base64url")].join("$"))'
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data) values
  ('00000000-0000-4000-a000-0000000000a1', 'owner-a@geraiexpress.test', 'scrypt$32768$8$1$kSBXiBfuScl0AYdC012hPg$6Z7QHuGKQ5-U0S9yZCHXHxRGWKfjY0bfvHJ7Hp2ydbLz3Wp6wLddY04MJYOrj33dIeeQ3cTd-70qH0_AvnxJIQ', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-a000-0000000000a2', 'operator-a@geraiexpress.test', 'scrypt$32768$8$1$Dd1nFN8OREa54EPwDsX8XQ$JmV1J-HwRyj4DAapN7Vb_6wTCx7-yQXezvjpmTDnxJgspFozssx_OVthInYqGG_WAFibINRFed-4HgoDRE403Q', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-a000-0000000000b1', 'owner-b@geraiexpress.test', 'scrypt$32768$8$1$Ujn8mJywjrlACjf_PjXVsA$CigpwJz48jyoRedoPHJaZWA1ZZaooAcBNHydRML9Pw5oeRVK3hu7lQl_K0kiZJWKDDoHA5olX0Bpgd6RTOqTaw', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-a000-0000000000c1', 'no-access@geraiexpress.test', 'scrypt$32768$8$1$Ubm6-dY3BLsIYLFJ6xgc9Q$83D2H2uJOW4xQugVeyr1wRZiYjkLPbIegr5AAVYrxYs9FSgBGiIfhyUcU6hnNL11g-UaagAmDhAVTPwWPVCj0A', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-a000-0000000000d1', 'multi@geraiexpress.test', 'scrypt$32768$8$1$5sWLtqL62y_5e6toINfoiQ$WlGcvjPNzF-PZnut_L8mf1sw6k5KvdkDZIl9cttx4eDyAFgyrfjwoJRiuZPg9c1JePrhtCAAdK7Z7k68_fmTVw', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-a000-0000000000e1', 'owner-c@geraiexpress.test', 'scrypt$32768$8$1$kAC37xTTcTLa3y0d0AMC2A$EXmMDqBMujOmRGqymiLrWGVgBCHLEUJHF9wpBqMud7srDo1pE2J-G41fBrHInwQEI3ODGo7hYoB0u-Kf6SyZYA', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-a000-0000000000f1', 'admin@geraiexpress.test', 'scrypt$32768$8$1$YJY24qBSlXQc6BE6rQoNBQ$63t1xOdmn987r9GR5fLoo3cJMOoc5cVFUVYZFLgbriSt8U6L6KlkoYeYK8m8oxEAfJPBRXmHdOg3UcIy8C5ZdQ', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-a000-0000000000f2', 'admin-2@geraiexpress.test', 'scrypt$32768$8$1$PZU1YvLuSFXc-3ZB77fqFQ$6b8-o70IB9ERQJZIf4JnhUjKcCXfWRHo51uqYJJFawN_IVX9toPLgSXeqEWunUaSXAeMhZvqfyqbegaiyyu4Yg', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-a000-0000000000f3', 'admin-new@geraiexpress.test', 'scrypt$32768$8$1$YGDHAfKp4TUh7SsqvlE2Bw$26sSr28JZNfRBebu25HTQgAMX7pWwPbY85vbe-Nl7G9ViCgnBiqK_3lqUMAIIrSJNj-GxJcl-EzP_mHILkVgdw', now(), '{"provider":"email","providers":["email"]}');

insert into public.tenants (id, name, lifecycle) values
  ('00000000-0000-4000-b000-00000000000a', 'Gerai Uji A', 'active'),
  ('00000000-0000-4000-b000-00000000000b', 'Gerai Uji B', 'active');
insert into public.memberships (tenant_id, user_id, role) values
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-a000-0000000000a1', 'tenant_admin'),
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-a000-0000000000a2', 'operator'),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-a000-0000000000b1', 'tenant_admin'),
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-a000-0000000000d1', 'operator'),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-a000-0000000000d1', 'operator');
insert into public.outlets (tenant_id, id, name, pickup_address, pickup_area) values
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-c000-00000000000a', 'Outlet Uji A', 'Jl. Uji A No. 1', 'Kec. Uji, Kota A'),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-c000-00000000000b', 'Outlet Uji B', 'Jl. Uji B No. 2', 'Kec. Uji, Kota B');
insert into public.contacts (tenant_id, id, name, phone, is_sender, is_recipient) values
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-d000-00000000000a', 'Kontak Rahasia A', '081211110000', true, true),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-d000-00000000000b', 'Kontak Rahasia B', '081222220000', true, true);
insert into public.shipments (tenant_id, outlet_id, id, reference, created_by, sender_name, sender_phone, item_description, weight_grams) values
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-c000-00000000000a', '00000000-0000-4000-e000-00000000000a',
    'GXTEST-A1', '00000000-0000-4000-a000-0000000000a1', 'Pengirim A', '081211110001', 'Barang A', 500),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-c000-00000000000b', '00000000-0000-4000-e000-00000000000b',
    'GXTEST-B1', '00000000-0000-4000-a000-0000000000b1', 'Pengirim B', '081222220001', 'Barang B', 500);

-- Lifecycle fixture C does not disturb A/B.
insert into public.tenants (id, name, lifecycle) values
  ('00000000-0000-4000-b000-00000000000c', 'Gerai Uji C', 'active');
insert into public.outlets (tenant_id, id, name, pickup_address, pickup_area) values
  ('00000000-0000-4000-b000-00000000000c', '00000000-0000-4000-c000-00000000000c', 'Outlet Uji C', 'Jl. Uji C No. 3', 'Kec. Uji, Kota C');
insert into public.memberships (tenant_id, user_id, role) values
  ('00000000-0000-4000-b000-00000000000c', '00000000-0000-4000-a000-0000000000e1', 'tenant_admin');
insert into public.platform_grants (user_id, capabilities) values
  ('00000000-0000-4000-a000-0000000000f1', array['tenant_governance', 'platform_monitoring', 'integration_operations', 'access_governance', 'audit_review']),
  ('00000000-0000-4000-a000-0000000000f2', array['tenant_governance', 'platform_monitoring', 'integration_operations', 'access_governance', 'audit_review']),
  ('00000000-0000-4000-a000-0000000000f3', array['platform_monitoring', 'audit_review']);
-- Placeholder sealed text: scripts/db-seed-totp.mjs replaces it with the fixture secrets sealed under this
-- stack's AUTH_SECRET right after this file runs (gx_seed in scripts/db-common.sh).
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret_sealed, verified_at) values
  ('00000000-0000-4000-f000-0000000000f1', '00000000-0000-4000-a000-0000000000f1', 'fixture', 'totp', 'verified', 'pending-auth-core-sealing', now()),
  ('00000000-0000-4000-f000-0000000000f2', '00000000-0000-4000-a000-0000000000f2', 'fixture', 'totp', 'verified', 'pending-auth-core-sealing', now());
update private.settings set value = 'true' where key = 'registration_open';
