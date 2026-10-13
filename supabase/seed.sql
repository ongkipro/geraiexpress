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
    ('00000000-0000-4000-a000-0000000000d1'::uuid, 'multi@geraiexpress.test')
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
