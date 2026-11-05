-- Local fixture data (T-108, local gxdb only): realistic, clearly synthetic Indonesian data for the
-- review gerai "Gerai Demo Review (contoh)" created by db/review-fixture.sql, so every workspace screen
-- has something to show: contacts, shipments in every state, labels and print history, counter payments,
-- cash periods, the pilot report and cases. Apply with `pnpm db:fixture` (review fixture first, then this
-- file). Never part of seed.sql, tests, CI or any remote database.
--
-- Simulation boundary (owner-approved option B, 2026-11-05): most shipments are simulated (is_simulated).
-- Ten issued shipments are locally NON-simulated so the label snapshots, print history and pilot report
-- (which count only non-simulated shipments of a real gerai) have data. They are NOT real orders: AWBs
-- start with SIM, names end in "(contoh)", their provider operations are terminal ('succeeded') with no
-- provider environment, order id or dispatch time, payment_state is 'paid', the tenant has no seller
-- credential and no tracking link is created. The final block asserts all of that and raises (rolling
-- the whole transaction back) if anything a dispatch/reconcile/payment sweep could select exists.
--
-- Idempotent: if the first fixture contact exists, every section is skipped. All-or-nothing: one
-- explicit transaction (do not run it under psql -1); psql must use ON_ERROR_STOP (scripts/db-fixture.sh does).
-- Stable ids: 00000000-0000-4000-c0de-00000000KNNN (pg_temp.fx_id), K = kind: 1 contact, 2 address,
-- 3 shipment, 4 quote, 5 operation, 6 label snapshot, 7 payment, 8 cash period, 9 case,
-- a cash-period/case event, b discount terms, c label job. Times are relative to now (WIB days ago).

begin;

-- ============================================================ guard and skip marker

do $guard$
begin
  if current_database() !~ '^gx' or current_setting('app.gx_local', true) is distinct from 'on' then
    raise exception 'local_fixture_local_only: expected a gx-prefixed local Compose database (app.gx_local=on)'
      using errcode = '55000';
  end if;
  if not exists (select 1 from auth.users where email = 'owner-a@geraiexpress.test') then
    raise exception 'local_fixture_local_only: the local seed is not present; refusing to run';
  end if;
  if not exists (select 1 from public.tenants where id = '00000000-0000-4000-b000-0000000000d1')
     or not exists (select 1 from public.outlets where id = '00000000-0000-4000-c000-0000000000d1')
     or not exists (select 1 from auth.users where id = '00000000-0000-4000-a000-0000000000a3')
     or not exists (select 1 from auth.users where id = '00000000-0000-4000-a000-0000000000a4') then
    raise exception 'local_fixture_requires_review_fixture: run db/review-fixture.sql first';
  end if;
  -- Transaction-local marker read by every later section.
  if exists (select 1 from public.contacts where id = '00000000-0000-4000-c0de-000000001001') then
    raise notice 'local fixture already present; nothing to do';
    perform set_config('gx.local_fixture', 'skip', true);
  else
    perform set_config('gx.local_fixture', 'run', true);
  end if;
end $guard$;

-- Helpers for this session only (pg_temp): fixture ids and WIB clock times N days ago.
create or replace function pg_temp.fx_id(p_kind text, p_n integer)
returns uuid language sql immutable
as $$ select ('00000000-0000-4000-c0de-' || lpad(p_kind || lpad(p_n::text, 3, '0'), 12, '0'))::uuid $$;

create or replace function pg_temp.fx_at(p_days integer, p_time time)
returns timestamptz language sql stable
as $$ select ((((now() at time zone 'Asia/Jakarta')::date - p_days) + p_time) at time zone 'Asia/Jakarta') $$;

-- ============================================================ contacts and addresses

do $contacts$
declare
  v_tenant constant uuid := '00000000-0000-4000-b000-0000000000d1';
begin
  if current_setting('gx.local_fixture') = 'skip' then return; end if;

  -- The gerai WhatsApp prints on unmasked labels and receipts; set only when the gerai has none.
  update public.tenants set contact_whatsapp = '081255500777', contact_whatsapp_revision = contact_whatsapp_revision + 1
    where id = v_tenant and contact_whatsapp is null;

  insert into public.contacts (tenant_id, id, name, phone, is_sender, is_recipient, created_at, updated_at)
  select v_tenant, pg_temp.fx_id('1', c.n), c.name, c.phone, c.is_sender, c.is_recipient,
    pg_temp.fx_at(20 - c.n, '09:00'), pg_temp.fx_at(20 - c.n, '09:00')
  from (values
    (1, 'Toko Batik Sekar (contoh)', '081255501010', true, true),
    (2, 'Andi Pratama (contoh)', '081355502020', true, false),
    (3, 'Kedai Kopi Lereng (contoh)', '081955503030', true, true),
    (4, 'Rumah Kue Melati (contoh)', '085755504040', true, false),
    (5, 'Dewi Lestari (contoh)', '081555505050', false, true),
    (6, 'Bagus Setiawan (contoh)', '087755506060', false, true),
    (7, 'Siti Rahmawati (contoh)', '082155507070', false, true),
    (8, 'Hendra Gunawan (contoh)', '081755508080', false, true),
    (9, 'Putri Ayu Maharani (contoh)', '085655509090', false, true),
    (10, 'Yusuf Hidayat (contoh)', '089655510101', false, true),
    (11, 'Made Wirawan (contoh)', '081855511111', false, true),
    (12, 'Rizky Nasution (contoh)', '082255512121', false, true)
  ) as c(n, name, phone, is_sender, is_recipient)
  on conflict do nothing;

  -- Areas and Mengantar area ids from data/mengantar/areas-2026-10-30.json.gz (kelurahan, kecamatan, kota).
  insert into public.contact_addresses (tenant_id, contact_id, id, label, address_line, area, area_id, postal_code,
    is_primary, created_at)
  select v_tenant, pg_temp.fx_id('1', a.contact), pg_temp.fx_id('2', a.n), a.label, a.line, a.area, a.area_id, a.postal,
    a.is_primary, pg_temp.fx_at(20 - a.contact, '09:05')
  from (values
    (1, 1, 'Toko', 'Jl. Ir. H. Juanda No. 112 (contoh)', 'DAGO, COBLONG, BANDUNG', '5fc62de9f8f44b34aa4bdc7e', '40135', true),
    (2, 2, 'Rumah', 'Jl. Dr. Djunjunan No. 45 (contoh)', 'PASTEUR, SUKAJADI, BANDUNG', '5fc62de9f8f44b34aa4bdc99', '40161', true),
    (3, 3, 'Kedai', 'Jl. Sukajadi No. 210 (contoh)', 'PASTEUR, SUKAJADI, BANDUNG', '5fc62de9f8f44b34aa4bdc99', '40161', true),
    (4, 4, 'Dapur', 'Jl. Dago Pojok No. 8 (contoh)', 'DAGO, COBLONG, BANDUNG', '5fc62de9f8f44b34aa4bdc7e', '40135', true),
    (5, 5, 'Rumah', 'Jl. Tebet Barat Dalam IV No. 17 (contoh)', 'TEBET BARAT, TEBET, JAKARTA SELATAN', '5fc62f62f8f44b34aa4c0dfd', '12810', true),
    (6, 5, 'Kantor', 'Gedung Contoh Senayan Lt. 9 (contoh)', 'SENAYAN, KEBAYORAN BARU, JAKARTA SELATAN', '5fc62f60f8f44b34aa4c0dd2', '12190', false),
    (7, 6, 'Rumah', 'Jl. Gelora No. 3 (contoh)', 'SENAYAN, KEBAYORAN BARU, JAKARTA SELATAN', '5fc62f60f8f44b34aa4c0dd2', '12190', true),
    (8, 7, 'Kos', 'Jl. Bendungan Hilir Raya No. 60 (contoh)', 'BENDUNGAN HILIR, TANAH ABANG, JAKARTA PUSAT', '5fc62f64f8f44b34aa4c0e2a', '10210', true),
    (9, 8, 'Rumah', 'Perumahan Keputih Permai Blok C-12 (contoh)', 'KEPUTIH, SUKOLILO, SURABAYA', '5fc6461ef8f44b34aa4cd807', '60111', true),
    (10, 9, 'Kantor', 'Jl. Embong Malang No. 21 (contoh)', 'EMBONG KALIASIN, GENTENG, SURABAYA', '5fc64610f8f44b34aa4cd7b7', '60271', true),
    (11, 10, 'Rumah', 'Jl. Magelang Km 7 Gg. Contoh No. 4', 'SENDANGADI, MLATI, SLEMAN', '5fc63314f8f44b34aa4c44b7', '55285', true),
    (12, 10, 'Kampus', 'Jl. Kusumanegara No. 99 (contoh)', 'MUJA MUJU, UMBULHARJO, YOGYAKARTA', '5fc63306f8f44b34aa4c4412', '55165', false),
    (13, 11, 'Rumah', 'Jl. Gunung Agung Gg. Contoh No. 2', 'DAUH PURI, DENPASAR BARAT, DENPASAR', '5fc6316af8f44b34aa4c2ef4', '80113', true),
    (14, 12, 'Rumah', 'Jl. Gatot Subroto No. 150 (contoh)', 'DARAT, MEDAN BARU, MEDAN', '5fc6368cf8f44b34aa4c69a3', '20153', true),
    (15, 3, 'Cabang', 'Jl. Soekarno Hatta No. 9 (contoh)', 'TUNGGULWULUNG, LOWOKWARU, MALANG', '5fc63910f8f44b34aa4c7fef', '65143', false)
  ) as a(n, contact, label, line, area, area_id, postal, is_primary)
  on conflict do nothing;
end $contacts$;

-- ============================================================ shipments (simulated and local non-simulated)
-- One row per shipment. sim = is_simulated. Couriers are Mengantar create-order codes (src/lib/format.ts).
-- days = WIB days ago with a WIB clock time; rows of today use ago_min (minutes before now) instead, so a
-- run in the morning never creates a future row. cod_fee follows the simulated 3% rounded up to 100 IDR.
create temp table fx_ship (
  n integer primary key, sim boolean not null, state text not null, delivery text not null,
  snd integer not null, rcp integer, addr integer, item text not null, weight integer not null,
  goods bigint, cod boolean not null, courier text, service text, eta text, tariff bigint, cod_fee bigint not null,
  days integer not null, at_time time, ago_min integer
) on commit drop;
insert into fx_ship values
  -- simulated: draft, estimated, queued, in flight, unknown outcome, refused
  (1, true, 'draft', 'unobserved', 2, null, null, 'Dokumen kontrak (contoh)', 300, null, false, null, null, null, null, 0, 0, null, 25),
  (2, true, 'draft', 'unobserved', 4, 7, 8, 'Kue kering 2 toples (contoh)', 1500, 120000, false, null, null, null, null, 0, 0, null, 70),
  (3, true, 'draft', 'unobserved', 1, 9, 10, 'Kain batik tulis 3 lembar (contoh)', 1200, 750000, true, null, null, null, null, 0, 1, '16:20', null),
  (4, true, 'estimated', 'unobserved', 3, 5, 5, 'Kopi arabika 1 kg (contoh)', 1100, 185000, false, 'SiCepat', 'REG', '2-3 hari', 22000, 0, 0, null, 40),
  (5, true, 'queued', 'unobserved', 4, 6, 7, 'Bolu pandan 2 kotak (contoh)', 900, 90000, false, 'JNE', 'REG', '2-3 hari', 18000, 0, 0, null, 95),
  (6, true, 'in_flight', 'unobserved', 1, 8, 9, 'Batik cap 5 lembar (contoh)', 2000, 600000, false, 'JT', 'EZ', '2-4 hari', 31000, 0, 0, null, 130),
  (7, true, 'unknown', 'unobserved', 2, 10, 11, 'Buku kuliah 4 eksemplar (contoh)', 2500, 300000, false, 'iDexpress', 'STD', '3-5 hari', 27000, 0, 1, '15:45', null),
  (8, true, 'failed', 'unobserved', 3, 12, 14, 'Biji kopi sangrai 2 kg (contoh)', 2100, 340000, false, 'anteraja', 'REG', '3-5 hari', 52000, 0, 2, '10:20', null),
  -- simulated issued
  (9, true, 'issued', 'delivered', 1, 5, 6, 'Kemeja batik (contoh)', 800, 250000, false, 'JNE', 'REG', '2-3 hari', 19000, 0, 13, '10:05', null),
  (10, true, 'issued', 'delivered', 4, 7, 8, 'Nastar 3 toples (contoh)', 2400, 210000, true, 'SiCepat', 'REG', '2-3 hari', 21000, 7000, 12, '14:30', null),
  (11, true, 'issued', 'in_transit', 3, 11, 13, 'Kopi bubuk 500 g (contoh)', 600, 95000, false, 'lion', 'REGPACK', '3-6 hari', 46000, 0, 10, '09:50', null),
  (12, true, 'issued', 'delivered', 2, 9, 10, 'Laptop bekas (contoh)', 3000, 4500000, false, 'JNE', 'YES', '1 hari', 58000, 0, 9, '13:15', null),
  (13, true, 'issued', 'in_transit', 1, 12, 14, 'Selendang batik (contoh)', 500, 175000, true, 'JT', 'EZ', '4-6 hari', 52000, 6900, 6, '11:00', null),
  (14, true, 'issued', 'unobserved', 4, 6, 7, 'Brownies 2 kotak (contoh)', 1300, 140000, false, 'anteraja', 'REG', '1-2 hari', 17000, 0, 3, '15:10', null),
  (15, true, 'issued', 'delivered', 3, 5, 6, 'Kopi susu literan (contoh)', 2000, 160000, false, 'SiCepat', 'BEST', '1 hari', 29000, 0, 2, '09:40', null),
  -- local NON-simulated issued (labels, pilot report); never real orders, see the header
  (16, false, 'issued', 'delivered', 1, 5, 5, 'Batik tulis Pekalongan 2 lembar (contoh)', 1000, 650000, false, 'JNE', 'REG', '2-3 hari', 20000, 0, 13, '11:10', null),
  (17, false, 'issued', 'delivered', 1, 8, 9, 'Kain songket (contoh)', 1400, 900000, false, 'SiCepat', 'REG', '2-3 hari', 23000, 0, 11, '10:25', null),
  (18, false, 'issued', 'delivered', 3, 10, 11, 'Kopi arabika Malabar 1 kg (contoh)', 1100, 210000, false, 'JT', 'EZ', '2-4 hari', 21000, 0, 9, '14:05', null),
  (19, false, 'issued', 'in_transit', 4, 7, 8, 'Kue lapis legit (contoh)', 1800, 275000, false, 'anteraja', 'REG', '1-2 hari', 16000, 0, 8, '16:40', null),
  (20, false, 'issued', 'delivered', 2, 11, 13, 'Sepatu kulit (contoh)', 1600, 480000, false, 'lion', 'REGPACK', '3-5 hari', 61000, 0, 7, '09:15', null),
  (21, false, 'issued', 'in_transit', 1, 12, 14, 'Kemeja batik 3 pcs (contoh)', 1300, 420000, true, 'JNE', 'REG', '4-5 hari', 48000, 14100, 5, '13:35', null),
  (22, false, 'issued', 'in_transit', 3, 6, 7, 'Kopi literan 4 botol (contoh)', 4200, 240000, false, 'SiCepat', 'REG', '1-2 hari', 18000, 0, 4, '10:50', null),
  (23, false, 'issued', 'returned', 4, 9, 10, 'Paket hampers (contoh)', 2600, 350000, false, 'SiCepat', 'REG', '2-3 hari', 25000, 0, 12, '15:20', null),
  (24, false, 'issued', 'problem', 1, 10, 12, 'Kain tenun ikat (contoh)', 900, 800000, false, 'JNE', 'YES', '1 hari', 39000, 0, 10, '11:45', null),
  (25, false, 'issued', 'unobserved', 2, 5, 6, 'Jam tangan (contoh)', 400, 1200000, false, 'iDexpress', 'STD', '2-3 hari', 22000, 0, 1, '14:55', null);

do $shipments$
declare
  v_tenant constant uuid := '00000000-0000-4000-b000-0000000000d1';
  v_outlet constant uuid := '00000000-0000-4000-c000-0000000000d1';
  v_admin constant uuid := '00000000-0000-4000-a000-0000000000a3';
  v_oper constant uuid := '00000000-0000-4000-a000-0000000000a4';
  f record;
  v_created timestamptz;
  v_confirmed boolean;
  v_issued boolean;
  v_actor uuid;
  v_charge bigint;
  v_awb text;
  v_billable integer;
begin
  if current_setting('gx.local_fixture') = 'skip' then return; end if;

  -- Gerai discount terms in force before every fixture quote (created_at <= quoted_at), so the pilot
  -- report and the admin gerai cost have known earnings for the non-simulated rows. Owner-stated 10%;
  -- inserted before any non-simulated quote cost exists, so the observed-discount ceiling does not apply.
  -- Skipped when the gerai already has terms (a backdated version would be refused as effective_before_previous).
  insert into public.gerai_discount_terms (id, tenant_id, gerai_discount_bps, effective_from, source_reference,
    status, created_by, created_at)
  select pg_temp.fx_id('b', 1), v_tenant, 1000, pg_temp.fx_at(20, '08:00'),
    'Kesepakatan contoh lokal (fixture T-108)', 'owner_stated', v_admin, pg_temp.fx_at(20, '08:00')
  where not exists (select 1 from public.gerai_discount_terms where tenant_id = v_tenant)
  on conflict do nothing;

  for f in select * from fx_ship order by n loop
    v_created := case when f.days = 0 then now() - make_interval(mins => f.ago_min) else pg_temp.fx_at(f.days, f.at_time) end;
    v_confirmed := f.state not in ('draft', 'estimated');
    v_issued := f.state = 'issued';
    v_actor := case when f.n % 2 = 0 then v_oper else v_admin end;
    v_charge := case when v_confirmed then f.tariff + f.cod_fee end;
    v_awb := case when v_issued then 'SIM' || to_char(v_created at time zone 'Asia/Jakarta', 'YYMMDD') || '9' || lpad(f.n::text, 5, '0') end;
    v_billable := greatest(1000, (ceil(f.weight / 1000.0) * 1000)::integer);

    insert into public.shipments (tenant_id, outlet_id, id, reference, created_by, is_simulated,
      submission_state, payment_state, delivery_state,
      sender_contact_id, sender_name, sender_phone, sender_address, sender_area, sender_postal_code,
      recipient_contact_id, recipient_name, recipient_phone, recipient_address, recipient_area, recipient_area_id,
      recipient_postal_code, item_description, weight_grams, goods_value_idr, is_cod, cod_amount_idr,
      customer_charge_idr, awb, pickup_snapshot, weight_snapshot,
      content_declaration_version, content_declared_by, content_declared_at, content_declared_by_email,
      created_at, updated_at, submitted_at, issued_at)
    select v_tenant, v_outlet, pg_temp.fx_id('3', f.n), private.next_reference(v_tenant), v_actor, f.sim,
      f.state, case when v_issued then 'paid' else 'not_applicable' end, f.delivery,
      sc.id, sc.name, sc.phone, sa.address_line, sa.area, sa.postal_code,
      rc.id, rc.name, rc.phone, ra.address_line, ra.area, ra.area_id,
      ra.postal_code, f.item, f.weight, f.goods, f.cod,
      case when v_confirmed and f.cod then f.goods + v_charge end,
      v_charge, v_awb,
      case when v_confirmed then jsonb_build_object('outlet', o.name, 'address', o.pickup_address, 'area', o.pickup_area,
        'mengantar_pickup_address_id', null, 'mengantar_area_id', null, 'handover', 'dropoff') end,
      case when v_confirmed then jsonb_build_object('actual_weight_grams', f.weight, 'volumetric_weight_grams', null,
        'billable_weight_grams', v_billable, 'weight_rule_id', null, 'service_class', 'regular',
        'length_cm', null, 'width_cm', null, 'height_cm', null) end,
      case when v_confirmed then 1 end,
      case when v_confirmed then v_actor end,
      case when v_confirmed then v_created + interval '6 minutes' end,
      case when v_confirmed then (select u.email::text from auth.users u where u.id = v_actor) end,
      v_created,
      case when v_issued then v_created + make_interval(mins => 8 + f.n) when v_confirmed then v_created + interval '6 minutes'
        else v_created end,
      case when v_confirmed then v_created + interval '6 minutes' end,
      case when v_issued then v_created + make_interval(mins => 8 + f.n) end
    from public.contacts sc
    cross join public.outlets o
    left join public.contact_addresses sa on sa.tenant_id = v_tenant and sa.contact_id = sc.id and sa.is_primary
    left join public.contacts rc on rc.tenant_id = v_tenant and rc.id = pg_temp.fx_id('1', f.rcp)
    left join public.contact_addresses ra on ra.tenant_id = v_tenant and ra.id = pg_temp.fx_id('2', f.addr)
    where sc.tenant_id = v_tenant and sc.id = pg_temp.fx_id('1', f.snd)
      and o.tenant_id = v_tenant and o.id = v_outlet
    on conflict do nothing;

    insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at)
      values (v_tenant, pg_temp.fx_id('3', f.n), 'draft_created', null, v_actor, v_created);
    if f.state <> 'draft' then
      insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at)
        values (v_tenant, pg_temp.fx_id('3', f.n), 'quoted',
          case when f.sim then 'Estimasi simulasi' else 'Estimasi contoh lokal' end, v_actor, v_created + interval '3 minutes');
    end if;

    -- Quotes: one per courier/service; the estimated draft has two to choose from. eta_days is NOT NULL.
    if f.state <> 'draft' then
      insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service,
        normal_tariff_idr, eta_days, is_simulated, quoted_at, expires_at, cod_supported, cod_fee_idr,
        customer_charge_idr, origin_area_id, actual_weight_grams, billable_weight_grams, service_class)
      values (v_tenant, pg_temp.fx_id('3', f.n), pg_temp.fx_id('4', f.n), 1, f.courier, f.service,
        f.tariff, f.eta, f.sim, v_created + interval '3 minutes',
        case when f.state = 'estimated' then now() + interval '2 hours' else v_created + interval '33 minutes' end,
        f.cod, f.cod_fee, f.tariff + f.cod_fee,
        case when not f.sim then '5fc62de9f8f44b34aa4bdc7e' end, f.weight, v_billable, 'regular')
      on conflict do nothing;
      -- Private net cost: simulated 90% of tariff (as the demo); local non-simulated 75% (25% provider discount).
      insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr)
        values (v_tenant, pg_temp.fx_id('4', f.n), case when f.sim then (f.tariff * 9) / 10 else (f.tariff * 3) / 4 end)
      on conflict do nothing;
      if f.state = 'estimated' then
        insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service,
          normal_tariff_idr, eta_days, is_simulated, quoted_at, expires_at, cod_supported, cod_fee_idr,
          customer_charge_idr, actual_weight_grams, billable_weight_grams, service_class)
        values (v_tenant, pg_temp.fx_id('3', f.n), pg_temp.fx_id('4', 100 + f.n), 1, 'JNE', 'REG',
          24000, '2-3 hari', f.sim, v_created + interval '3 minutes', now() + interval '2 hours', false, 0, 24000,
          f.weight, v_billable, 'regular')
        on conflict do nothing;
        insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr)
          values (v_tenant, pg_temp.fx_id('4', 100 + f.n), 21600)
        on conflict do nothing;
      end if;
    end if;

    if v_confirmed then
      -- selected_quote_id is not draft content: guard_shipment leaves revision and state untouched.
      update public.shipments set selected_quote_id = pg_temp.fx_id('4', f.n)
        where tenant_id = v_tenant and id = pg_temp.fx_id('3', f.n);

      insert into public.provider_operations (tenant_id, shipment_id, id, kind, idempotency_key, input_digest, state,
        attempts, result_code, provider_error_detail, is_simulated, actor, created_at, updated_at)
      values (v_tenant, pg_temp.fx_id('3', f.n), pg_temp.fx_id('5', f.n), 'create_order',
        'fixture-' || pg_temp.fx_id('3', f.n)::text, 'fixture',
        case f.state when 'issued' then 'succeeded' when 'failed' then 'failed' else f.state end,
        case when f.state = 'queued' then 0 else 1 end,
        case f.state when 'issued' then case when f.sim then 'SIMULATED_OK' else 'ISSUED' end
          when 'failed' then 'PROVIDER_REJECTED' when 'unknown' then 'SIMULATED_TIMEOUT' else null end,
        case when f.state = 'failed' then 'Alamat penerima tidak dikenali kurir (contoh)' end,
        f.sim, v_actor, v_created + interval '6 minutes',
        case when v_issued then v_created + make_interval(mins => 8 + f.n) else v_created + interval '7 minutes' end)
      on conflict do nothing;

      insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at)
        values (v_tenant, pg_temp.fx_id('3', f.n), 'submitted', f.courier || ' ' || f.service
          || case when f.cod then ' (COD)' else '' end, v_actor, v_created + interval '6 minutes');
      insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at)
      select v_tenant, pg_temp.fx_id('3', f.n), e.kind, e.detail, v_actor, e.at
      from (values
        (f.state = 'issued', 'issued', case when f.sim then 'Resi simulasi ' else 'Resi contoh lokal ' end || coalesce(v_awb, ''),
          v_created + make_interval(mins => 8 + f.n)),
        (f.state = 'unknown', 'outcome_unknown', 'Batas waktu simulasi; jangan buat ulang, lakukan rekonsiliasi',
          v_created + interval '7 minutes'),
        (f.state = 'failed', 'rejected', 'Alamat penerima tidak dikenali kurir (contoh)', v_created + interval '7 minutes')
      ) as e(applies, kind, detail, at)
      where e.applies;
    end if;
  end loop;
end $shipments$;

-- ============================================================ label snapshots and print history
-- Non-simulated issued shipments only (create_label_snapshot refuses simulated ones). Rows mirror what
-- create_label_snapshot stores; the first snapshot's size is the shipment's locked format, so a later
-- version keeps it. No masking_acceptance row exists, so every courier is 'unverified' and a masked
-- print records the operator's acknowledgement (as record_label_print requires).
create temp table fx_label (
  n integer primary key, ship integer not null, version integer not null, size text not null, mask boolean not null,
  s_name text, s_phone text, s_address text, s_city text, prints integer not null
) on commit drop;
insert into fx_label values
  (1, 16, 1, '10x15', false, null, null, null, null, 1),
  (2, 16, 2, '10x15', true, 'Batik Sekar (contoh)', '081255501010', 'Jl. Ir. H. Juanda No. 112', 'Bandung', 1),
  (3, 17, 1, '10x10', true, 'Toko Batik Sekar (contoh)', '081255501010', null, 'Kota Bandung', 2),
  (4, 18, 1, '10x10', false, null, null, null, null, 1),
  (5, 19, 1, '10x15', true, 'Rumah Kue Melati (contoh)', '085755504040', 'Jl. Dago Pojok No. 8', 'Bandung', 1),
  (6, 21, 1, '10x15', false, null, null, null, null, 2);

do $labels$
declare
  v_tenant constant uuid := '00000000-0000-4000-b000-0000000000d1';
  v_admin constant uuid := '00000000-0000-4000-a000-0000000000a3';
  v_oper constant uuid := '00000000-0000-4000-a000-0000000000a4';
  l record;
  t public.tenants;
  s public.shipments;
  q public.shipment_quotes;
  v_at timestamptz;
  i integer;
begin
  if current_setting('gx.local_fixture') = 'skip' then return; end if;
  select * into t from public.tenants where id = v_tenant;

  for l in select * from fx_label order by n loop
    select * into s from public.shipments where tenant_id = v_tenant and id = pg_temp.fx_id('3', l.ship);
    select * into q from public.shipment_quotes where tenant_id = v_tenant and id = s.selected_quote_id;
    v_at := s.issued_at + make_interval(mins => 5 + 10 * l.version);

    insert into public.label_snapshots (tenant_id, shipment_id, id, version, size, mask_sender,
      printed_sender_name, printed_sender_phone, printed_sender_address, printed_sender_city,
      true_tenant_name, true_tenant_slug, true_pickup_name, true_pickup_address, true_pickup_area,
      awb, shipment_reference, courier, service, weight_grams, is_cod, cod_amount_idr, item_description,
      recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code,
      content_digest, created_by, created_at)
    values (v_tenant, s.id, pg_temp.fx_id('6', l.n), l.version, l.size, l.mask,
      case when l.mask then l.s_name else t.name end,
      case when l.mask then l.s_phone else t.contact_whatsapp end,
      case when l.mask then l.s_address else s.pickup_snapshot ->> 'address' end,
      case when l.mask then l.s_city else s.pickup_snapshot ->> 'area' end,
      t.name, t.slug, s.pickup_snapshot ->> 'outlet', s.pickup_snapshot ->> 'address', s.pickup_snapshot ->> 'area',
      s.awb, s.reference, q.courier, q.service, s.weight_grams, s.is_cod, s.cod_amount_idr, s.item_description,
      s.recipient_name, s.recipient_phone, s.recipient_address, s.recipient_area, s.recipient_postal_code,
      encode(extensions.digest(convert_to('local-fixture:' || s.id::text || ':' || l.version::text, 'utf8'), 'sha256'), 'hex'),
      case when l.n % 2 = 0 then v_oper else v_admin end, v_at)
    on conflict do nothing;

    for i in 1..l.prints loop
      insert into public.label_print_events (tenant_id, shipment_id, snapshot_id, size, actor, created_at,
        acceptance_state, acknowledged)
      values (v_tenant, s.id, pg_temp.fx_id('6', l.n), l.size, case when i % 2 = 0 then v_oper else v_admin end,
        v_at + make_interval(mins => i),
        case when l.mask then 'unverified' end, case when l.mask then true end);
    end loop;

    if l.version = 1 then
      insert into public.label_jobs (tenant_id, shipment_id, id, state, is_simulated, requested_by, created_at)
        values (v_tenant, s.id, pg_temp.fx_id('c', l.ship), 'completed', false, v_admin, v_at)
      on conflict do nothing;
      insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at)
        values (v_tenant, s.id, 'label_ready', null, v_admin, v_at);
    end if;
  end loop;
end $labels$;

-- ============================================================ counter payments, receipts and cash periods
-- Period 1 (closed): 14 WIB days ago to 6 days ago. Period 2 (open): since 5 days ago. Payments only on
-- confirmed non-COD shipments (record_counter_payment's rule); expected_idr = the shipment's charge.
-- The closed period's expected cash is the sum of its active cash payments (close_cash_period's rule).
create temp table fx_pay (
  n integer primary key, ship integer not null, period integer not null, method text not null,
  amount bigint, received bigint, reason text, voided boolean not null, receipt text
) on commit drop;
insert into fx_pay values
  (1, 16, 1, 'cash', null, 50000, null, false, '58'),
  (2, 9, 1, 'cash', null, null, null, false, null),
  (3, 17, 1, 'qris', null, null, null, false, '80'),
  (4, 18, 1, 'transfer', null, null, null, false, null),
  (5, 12, 1, 'transfer', null, null, null, false, null),
  (6, 24, 1, 'other', null, null, null, false, null),
  (7, 20, 1, 'cash', 60000, 100000, 'Pembulatan untuk pelanggan tetap (contoh)', false, '58'),
  (8, 22, 2, 'cash', null, 20000, null, true, null),
  (9, 22, 2, 'qris', null, null, null, false, '58'),
  (10, 25, 2, 'cash', null, 25000, null, false, null),
  (11, 15, 2, 'qris', null, null, null, false, null),
  (12, 7, 2, 'cash', null, null, null, false, null);

do $payments$
declare
  v_tenant constant uuid := '00000000-0000-4000-b000-0000000000d1';
  v_outlet constant uuid := '00000000-0000-4000-c000-0000000000d1';
  v_admin constant uuid := '00000000-0000-4000-a000-0000000000a3';
  v_oper constant uuid := '00000000-0000-4000-a000-0000000000a4';
  p record;
  s public.shipments;
  t public.tenants;
  v_at timestamptz;
  v_expected bigint;
  v_counted bigint;
begin
  if current_setting('gx.local_fixture') = 'skip' then return; end if;
  select * into t from public.tenants where id = v_tenant;
  -- One open period per outlet (cash_periods_one_open_per_outlet): refuse rather than mix with live work.
  if exists (select 1 from public.cash_periods where tenant_id = v_tenant and outlet_id = v_outlet and closed_at is null) then
    raise exception 'local_fixture_open_period_exists: the review outlet already has an open cash period; close it in /kas first';
  end if;

  insert into public.cash_periods (tenant_id, id, outlet_id, opened_at, opened_by)
    values (v_tenant, pg_temp.fx_id('8', 1), v_outlet, pg_temp.fx_at(14, '08:00'), v_oper)
  on conflict do nothing;

  for p in select * from fx_pay where period = 1 order by n loop
    select * into s from public.shipments where tenant_id = v_tenant and id = pg_temp.fx_id('3', p.ship);
    v_at := coalesce(s.issued_at, s.submitted_at) + make_interval(mins => 12);
    insert into public.counter_payments (tenant_id, id, shipment_id, outlet_id, period_id, method, amount_idr,
      expected_idr, difference_reason, cash_received_idr, recorded_by, receipt_gerai_name, receipt_gerai_whatsapp,
      recorded_at)
    values (v_tenant, pg_temp.fx_id('7', p.n), s.id, v_outlet, pg_temp.fx_id('8', 1), p.method,
      coalesce(p.amount, s.customer_charge_idr), s.customer_charge_idr, p.reason, p.received,
      case when p.n % 2 = 0 then v_oper else v_admin end, t.name, t.contact_whatsapp, v_at)
    on conflict do nothing;
    insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at)
      values (v_tenant, s.id, 'counter_payment', 'Pembayaran pelanggan dicatat',
        case when p.n % 2 = 0 then v_oper else v_admin end, v_at);
  end loop;

  -- Close period 1 the way close_cash_period does: expected = active cash payments, variance = counted - expected.
  select coalesce(sum(amount_idr), 0) into v_expected from public.counter_payments
    where tenant_id = v_tenant and period_id = pg_temp.fx_id('8', 1) and method = 'cash' and voided_at is null;
  v_counted := v_expected + 1000;
  update public.cash_periods set closed_at = pg_temp.fx_at(6, '20:15'), closed_by = v_oper,
      counted_cash_idr = v_counted, expected_cash_idr = v_expected, variance_idr = v_counted - v_expected
    where tenant_id = v_tenant and id = pg_temp.fx_id('8', 1) and closed_at is null;
  insert into public.cash_period_events (tenant_id, id, period_id, kind, counted_cash_idr, expected_cash_idr,
    variance_idr, actor, at)
  values (v_tenant, pg_temp.fx_id('a', 1), pg_temp.fx_id('8', 1), 'close', v_counted, v_expected,
    v_counted - v_expected, v_oper, pg_temp.fx_at(6, '20:15'))
  on conflict do nothing;

  insert into public.cash_periods (tenant_id, id, outlet_id, opened_at, opened_by)
    values (v_tenant, pg_temp.fx_id('8', 2), v_outlet, pg_temp.fx_at(5, '08:00'), v_oper)
  on conflict do nothing;

  for p in select * from fx_pay where period = 2 order by n loop
    select * into s from public.shipments where tenant_id = v_tenant and id = pg_temp.fx_id('3', p.ship);
    v_at := coalesce(s.issued_at, s.submitted_at) + make_interval(mins => 12 + 20 * (p.n - 8));
    insert into public.counter_payments (tenant_id, id, shipment_id, outlet_id, period_id, method, amount_idr,
      expected_idr, difference_reason, cash_received_idr, recorded_by, receipt_gerai_name, receipt_gerai_whatsapp,
      recorded_at)
    values (v_tenant, pg_temp.fx_id('7', p.n), s.id, v_outlet, pg_temp.fx_id('8', 2), p.method,
      coalesce(p.amount, s.customer_charge_idr), s.customer_charge_idr, p.reason, p.received,
      case when p.n % 2 = 0 then v_oper else v_admin end, t.name, t.contact_whatsapp, v_at)
    on conflict do nothing;
    insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at)
      values (v_tenant, s.id, 'counter_payment', 'Pembayaran pelanggan dicatat',
        case when p.n % 2 = 0 then v_oper else v_admin end, v_at);
    if p.voided then
      -- The one allowed change (counter_payment_guard): the void columns, set once from NULL, while the
      -- period is open. Done before the replacement record so one active payment per shipment holds.
      update public.counter_payments set voided_at = v_at + interval '10 minutes', voided_by = v_admin,
          void_reason = 'Salah pilih metode; pelanggan bayar dengan QRIS (contoh)'
        where tenant_id = v_tenant and id = pg_temp.fx_id('7', p.n) and voided_at is null;
      insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at)
        values (v_tenant, s.id, 'counter_payment_voided', 'Catatan pembayaran dibatalkan', v_admin, v_at + interval '10 minutes');
    end if;
  end loop;

  -- Receipt print requests (kind 'receipt', bound to an active payment, no frozen identity columns).
  for p in select * from fx_pay where receipt is not null order by n loop
    insert into public.label_print_events (tenant_id, shipment_id, kind, snapshot_id, receipt_payment_id, size, actor,
      created_at)
    select c.tenant_id, c.shipment_id, 'receipt', null, c.id, p.receipt, c.recorded_by, c.recorded_at + interval '1 minute'
    from public.counter_payments c
    where c.tenant_id = v_tenant and c.id = pg_temp.fx_id('7', p.n) and c.voided_at is null;
  end loop;
end $payments$;

-- ============================================================ return and claim cases
-- Open return case (SiCepat, returned parcel) with a staff-entered anchor; closed compensated damage case
-- (JNE: the source states no anchor event, so no deadline). Rule and deadline come from
-- private.case_deadline, the same derivation open_shipment_case uses; nothing is invented here.
do $cases$
declare
  v_tenant constant uuid := '00000000-0000-4000-b000-0000000000d1';
  v_admin constant uuid := '00000000-0000-4000-a000-0000000000a3';
  v_oper constant uuid := '00000000-0000-4000-a000-0000000000a4';
  s public.shipments;
  d record;
  v_anchor timestamptz;
  v_opened timestamptz;
  v_closed timestamptz;
begin
  if current_setting('gx.local_fixture') = 'skip' then return; end if;

  -- Case 1: open, return of shipment 23.
  select * into s from public.shipments where tenant_id = v_tenant and id = pg_temp.fx_id('3', 23);
  v_anchor := s.issued_at + interval '4 days';
  v_opened := s.issued_at + interval '5 days';
  select * into d from private.case_deadline(private.shipment_courier(v_tenant, s.selected_quote_id), 'return', null, v_anchor);
  insert into public.shipment_cases (tenant_id, id, shipment_id, case_type, claim_type, state, description, evidence_refs,
    region, anchor_at, anchor_entered_by, anchor_entered_at, rule_id, deadline_at, opened_by, opened_at, updated_at)
  values (v_tenant, pg_temp.fx_id('9', 1), s.id, 'return', 'return', 'open',
    'Paket diretur kurir karena penerima tidak ada di alamat (contoh). Pelanggan minta kirim ulang.',
    array['Foto status retur di aplikasi Mengantar (contoh)'], null, v_anchor, v_oper, v_opened,
    d.rule_id, d.deadline_at, v_oper, v_opened, v_opened)
  on conflict do nothing;
  insert into public.shipment_case_events (tenant_id, id, case_id, kind, state, actor, at)
  select v_tenant, pg_temp.fx_id('a', 101), pg_temp.fx_id('9', 1), 'opened', 'open', v_oper, v_opened
  where not exists (select 1 from public.shipment_case_events where tenant_id = v_tenant and id = pg_temp.fx_id('a', 101));
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at)
    values (v_tenant, s.id, 'case_opened', null, v_oper, v_opened);

  -- Case 2: closed with a compensation decided by the courier, shipment 24.
  select * into s from public.shipments where tenant_id = v_tenant and id = pg_temp.fx_id('3', 24);
  v_opened := s.issued_at + interval '2 days';
  v_closed := s.issued_at + interval '7 days';
  select * into d from private.case_deadline(private.shipment_courier(v_tenant, s.selected_quote_id), 'damaged',
    'java_sumatra_bali_ntb', null);
  insert into public.shipment_cases (tenant_id, id, shipment_id, revision, case_type, claim_type, state, description,
    evidence_refs, provider_ticket, region, rule_id, deadline_at, opened_by, opened_at, updated_at,
    outcome, decided_amount_idr, decided_by_party, closed_by, closed_at)
  values (v_tenant, pg_temp.fx_id('9', 2), s.id, 2, 'damaged', 'full_value', 'closed',
    'Kain tenun diterima sobek dan basah (contoh). Foto unboxing dari penerima terlampir.',
    array['Foto unboxing penerima (contoh)', 'Tiket klaim kurir (contoh)'], 'TIKET-CONTOH-0424',
    'java_sumatra_bali_ntb', d.rule_id, d.deadline_at, v_admin, v_opened, v_closed,
    'compensated', 400000, 'courier', v_admin, v_closed)
  on conflict do nothing;
  insert into public.shipment_case_events (tenant_id, id, case_id, kind, state, note, actor, at)
  select v_tenant, e.id, pg_temp.fx_id('9', 2), e.kind, e.state, e.note, v_admin, e.at
  from (values
    (pg_temp.fx_id('a', 201), 'opened', 'open', null::text, v_opened),
    (pg_temp.fx_id('a', 202), 'closed', 'closed', 'Kurir menyetujui ganti rugi sebagian (contoh).', v_closed)
  ) as e(id, kind, state, note, at)
  where not exists (select 1 from public.shipment_case_events x where x.tenant_id = v_tenant and x.id = e.id);
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor, created_at) values
    (v_tenant, s.id, 'case_opened', null, v_admin, v_opened),
    (v_tenant, s.id, 'case_closed', null, v_admin, v_closed);
end $cases$;

-- ============================================================ safety assertions (raise = whole fixture rolls back)
-- Mirrors what can reach Mengantar for this gerai: dispatch_due (20261029180000) selects non-simulated
-- operations that are queued (with a current seller credential), in_flight/unknown or failed with a
-- dispatch time and provider environment, or succeeded on an unpaid shipment; confirm/dispatch and the
-- reconcile/check-payment actions need a seller credential; tracking needs a published link.
do $assert$
declare
  v_tenant constant uuid := '00000000-0000-4000-b000-0000000000d1';
  v_bad integer;
begin
  if exists (select 1 from private.seller_credentials where tenant_id = v_tenant) then
    raise exception 'local_fixture_unsafe: the review gerai has a seller credential';
  end if;
  if exists (select 1 from private.tenant_mengantar_onboarding where tenant_id = v_tenant and connection_mode <> 'none') then
    raise exception 'local_fixture_unsafe: the review gerai has a Mengantar connection';
  end if;
  select count(*) into v_bad from public.provider_operations o
    where o.tenant_id = v_tenant and not o.is_simulated
      and (o.state <> 'succeeded' or o.provider_env is not null or o.provider_order_id is not null
        or o.provider_batch is not null or o.dispatched_at is not null or o.pickup_phase is not null);
  if v_bad > 0 then
    raise exception 'local_fixture_unsafe: % non-simulated provider operation(s) are not terminal-and-undispatched', v_bad;
  end if;
  select count(*) into v_bad from public.shipments s
    where s.tenant_id = v_tenant and not s.is_simulated
      and (s.submission_state <> 'issued' or s.payment_state <> 'paid' or s.awb is null or s.awb !~ '^SIM'
        or s.recipient_name !~ '\(contoh\)$' or s.sender_name !~ '\(contoh\)$'
        or not exists (select 1 from public.provider_operations o where o.tenant_id = s.tenant_id
          and o.shipment_id = s.id and o.state = 'succeeded'));
  if v_bad > 0 then
    raise exception 'local_fixture_unsafe: % non-simulated shipment(s) are not issued, paid and marked as contoh', v_bad;
  end if;
  if exists (select 1 from private.batch_payment_attempts where tenant_id = v_tenant) then
    raise exception 'local_fixture_unsafe: the review gerai has a batch payment attempt';
  end if;
  if exists (select 1 from public.tracking_links where tenant_id = v_tenant)
     or exists (select 1 from private.tracking_token_hashes where tenant_id = v_tenant) then
    raise exception 'local_fixture_unsafe: the review gerai has a tracking link';
  end if;
  if (select is_demo from public.tenants where id = v_tenant) then
    raise exception 'local_fixture_unsafe: the review gerai unexpectedly became a demo gerai (demo cleanup would purge it)';
  end if;
end $assert$;

commit;
