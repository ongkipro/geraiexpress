-- Local development / test fixtures only. Synthetic identities and data; never used for a
-- shared, preview or production environment (DEL-1). Password is a local-only fixture value.

do $$
declare
  pw text := extensions.crypt('geraiexpress-local-dev', extensions.gen_salt('bf'));
  u record;
begin
  for u in select * from (values
    ('00000000-0000-4000-a000-0000000000a1'::uuid, 'owner-a@geraiexpress.test'),
    ('00000000-0000-4000-a000-0000000000a2'::uuid, 'operator-a@geraiexpress.test'),
    ('00000000-0000-4000-a000-0000000000b1'::uuid, 'owner-b@geraiexpress.test'),
    ('00000000-0000-4000-a000-0000000000c1'::uuid, 'no-access@geraiexpress.test'),
    ('00000000-0000-4000-a000-0000000000d1'::uuid, 'multi@geraiexpress.test'),
    ('00000000-0000-4000-a000-0000000000e1'::uuid, 'owner-c@geraiexpress.test'),
    ('00000000-0000-4000-a000-0000000000f1'::uuid, 'admin@geraiexpress.test'),
    ('00000000-0000-4000-a000-0000000000f2'::uuid, 'admin-2@geraiexpress.test'),
    ('00000000-0000-4000-a000-0000000000f3'::uuid, 'admin-new@geraiexpress.test')
  ) as t(id, email) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, pw, now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      'email', now(), now(), now());
  end loop;
end $$;

insert into public.tenants (id, name, lifecycle) values
  ('00000000-0000-4000-b000-00000000000a', 'Gerai Uji A', 'active'),
  ('00000000-0000-4000-b000-00000000000b', 'Gerai Uji B', 'active');

insert into public.memberships (tenant_id, user_id, role) values
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-a000-0000000000a1', 'tenant_admin'),
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-a000-0000000000a2', 'operator'),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-a000-0000000000b1', 'tenant_admin'),
  -- PR-1: a person with explicit memberships in two businesses must choose; no arbitrary default.
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-a000-0000000000d1', 'operator'),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-a000-0000000000d1', 'operator');

insert into public.outlets (tenant_id, id, name, pickup_address, pickup_area) values
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-c000-00000000000a', 'Outlet Uji A',
    'Jl. Uji A No. 1', 'Kec. Uji, Kota A'),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-c000-00000000000b', 'Outlet Uji B',
    'Jl. Uji B No. 2', 'Kec. Uji, Kota B');

insert into public.contacts (tenant_id, id, name, phone, is_sender, is_recipient) values
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-d000-00000000000a', 'Kontak Rahasia A', '081211110000', true, true),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-d000-00000000000b', 'Kontak Rahasia B', '081222220000', true, true);

insert into public.shipments (tenant_id, outlet_id, id, reference, created_by, sender_name, sender_phone, item_description, weight_grams) values
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-c000-00000000000a', '00000000-0000-4000-e000-00000000000a',
    'GXTEST-A1', '00000000-0000-4000-a000-0000000000a1', 'Pengirim A', '081211110001', 'Barang A', 500),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-c000-00000000000b', '00000000-0000-4000-e000-00000000000b',
    'GXTEST-B1', '00000000-0000-4000-a000-0000000000b1', 'Pengirim B', '081222220001', 'Barang B', 500);

-- Gerai C exists for platform lifecycle tests (suspend/reactivate) without disturbing A and B.
insert into public.tenants (id, name, lifecycle) values
  ('00000000-0000-4000-b000-00000000000c', 'Gerai Uji C', 'active');
insert into public.outlets (tenant_id, id, name, pickup_address, pickup_area) values
  ('00000000-0000-4000-b000-00000000000c', '00000000-0000-4000-c000-00000000000c', 'Outlet Uji C',
    'Jl. Uji C No. 3', 'Kec. Uji, Kota C');
insert into public.memberships (tenant_id, user_id, role) values
  ('00000000-0000-4000-b000-00000000000c', '00000000-0000-4000-a000-0000000000e1', 'tenant_admin');

-- Platform fixtures (PR-24, DEC-008): two full administrators with a verified TOTP factor using a
-- local-only fixture secret (tests derive codes from it), and one monitoring-only administrator
-- without a factor for the enrolment path. Production bootstrap is a separate owner runbook.
insert into public.platform_grants (user_id, capabilities) values
  ('00000000-0000-4000-a000-0000000000f1', array['tenant_governance', 'platform_monitoring',
    'integration_operations', 'access_governance', 'audit_review']),
  ('00000000-0000-4000-a000-0000000000f2', array['tenant_governance', 'platform_monitoring',
    'integration_operations', 'access_governance', 'audit_review']),
  ('00000000-0000-4000-a000-0000000000f3', array['platform_monitoring', 'audit_review']);
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('00000000-0000-4000-f000-0000000000f1', '00000000-0000-4000-a000-0000000000f1', 'fixture', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'),
  ('00000000-0000-4000-f000-0000000000f2', '00000000-0000-4000-a000-0000000000f2', 'fixture', 'totp', 'verified', now(), now(), 'KRSXG5DTMVZXIZLSKRSXG5DTMVZXIZLS');

-- Local development keeps public registration open so the OTP signup journey can be exercised
-- against local mail capture; the migration default (and any remote project) is closed.
update private.settings set value = 'true' where key = 'registration_open';
