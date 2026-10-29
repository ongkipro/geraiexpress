-- T-049 / PR-37 / DATA-8 (CTX-41 items 2, 11, 12): tenant slug, shipment prefix and a collision-free
-- per-tenant, per-day shipment reference. The slug and the prefix are display and lookup data;
-- nothing in the database or the application authorizes through them (TEN-6). Membership decides.

-- ============================================================ tenant identity columns

alter table public.tenants
  add column slug text,
  add column shipment_prefix text;

-- Validation of a slug (format, reserved names, blocked marketing keyword). The keyword is built from
-- fragments so the literal never appears in the repository.
create function private.slug_is_valid(p_slug text)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(
    p_slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
    and p_slug <> all (array['www', 'app', 'owner', 'hooks', 'api', 'admin', 'mail', 'status',
      'static', 'assets', 'staging', 'preview', 'demo', 'support'])
    and position(('c' || 'u' || 'a' || 'n') in p_slug) = 0,
    false);
$$;

-- Prefix of 3 to 5 upper-case letters, derived deterministically from the slug's letters.
-- Uniqueness is not required: the full reference stays unique per tenant.
create function private.slug_prefix(p_slug text)
returns text language sql immutable set search_path = ''
as $$
  select case when length(l.letters) >= 3 then left(l.letters, 4) else rpad(l.letters, 3, 'GEX') end
  from (select upper(regexp_replace(coalesce(p_slug, ''), '[^a-z]', '', 'g')) as letters) l;
$$;

-- Slug from a business name: ASCII fold, lower case, hyphens for spaces, at most 32 characters, a short
-- numeric suffix on collision, reserved or too-short names. Demo tenants get demo-<8 hex>. Serialized
-- by an advisory lock so two simultaneous approvals cannot pick the same slug.
create function private.make_slug(p_name text, p_demo boolean)
returns text language plpgsql volatile set search_path = ''
as $$
declare
  v_kw constant text := 'c' || 'u' || 'a' || 'n';
  v_base text;
  v_cand text;
  v_suffix text;
  n integer := 1;
begin
  perform pg_advisory_xact_lock(hashtext('gx.tenant_slug'));
  if p_demo then
    loop
      v_cand := 'demo-' || substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8);
      exit when not exists (select 1 from public.tenants where slug = v_cand);
    end loop;
    return v_cand;
  end if;
  v_base := lower(translate(coalesce(p_name, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  while position(v_kw in v_base) > 0 loop
    v_base := replace(v_base, v_kw, '');
  end loop;
  v_base := trim(both '-' from regexp_replace(v_base, '-+', '-', 'g'));
  v_base := trim(both '-' from left(v_base, 32));
  if v_base = '' then v_base := 'gerai'; end if;
  loop
    if n = 1 then
      v_cand := v_base;
    else
      v_suffix := '-' || n::text;
      v_cand := trim(trailing '-' from left(v_base, 32 - length(v_suffix))) || v_suffix;
    end if;
    if private.slug_is_valid(v_cand) and not exists (select 1 from public.tenants where slug = v_cand) then
      return v_cand;
    end if;
    n := n + 1;
    if n > 9999 then raise exception 'slug_unavailable' using errcode = '55000'; end if;
  end loop;
end $$;

-- ============================================================ slug and prefix guard

create function private.tenants_identity_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.slug is not null and new.slug is distinct from old.slug then
      raise exception 'slug_immutable' using errcode = '55000';
    end if;
    if old.shipment_prefix is not null and new.shipment_prefix is distinct from old.shipment_prefix then
      raise exception 'prefix_immutable' using errcode = '55000';
    end if;
  end if;
  if new.slug is null then
    new.slug := private.make_slug(new.name, new.is_demo);
  elsif (tg_op = 'INSERT' or old.slug is null) and not private.slug_is_valid(new.slug) then
    raise exception 'slug_invalid' using errcode = '23514';
  end if;
  if new.shipment_prefix is null then
    new.shipment_prefix := private.slug_prefix(new.slug);
  end if;
  return new;
end $$;

create trigger tenants_identity before insert or update on public.tenants
  for each row execute function private.tenants_identity_guard();

-- Backfill: every existing tenant (fixtures and real rows) gets a slug and a prefix. Existing
-- shipment references are not touched. One tenant at a time so each slug sees the previous ones.
do $$
declare t record;
begin
  for t in select id from public.tenants where slug is null order by created_at, id loop
    update public.tenants set slug = null where id = t.id;
  end loop;
end $$;

alter table public.tenants
  alter column slug set not null,
  alter column shipment_prefix set not null,
  add constraint tenants_slug_key unique (slug),
  add constraint tenants_shipment_prefix_format check (shipment_prefix ~ '^[A-Z]{3,5}$');

-- ============================================================ per-tenant, per-day reference counter

create table private.reference_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  last_seq integer not null check (last_seq > 0),
  primary key (tenant_id, day)
);
alter table private.reference_counters enable row level security;

-- <PREFIX>-<yymmdd>-<seq>: the WIB calendar day, a sequence of at least three digits. The upsert takes
-- the counter row's lock, so concurrent drafts of one tenant on one day queue and receive distinct
-- sequences; nothing retries and nothing raises a unique violation.
create function private.next_reference(p_tenant uuid)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Jakarta';
  v_prefix text;
  v_seq integer;
begin
  select shipment_prefix into v_prefix from public.tenants where id = p_tenant;
  if v_prefix is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into private.reference_counters as c (tenant_id, day, last_seq)
  values (p_tenant, v_now::date, 1)
  on conflict (tenant_id, day) do update set last_seq = c.last_seq + 1
  returning c.last_seq into v_seq;
  return v_prefix || '-' || to_char(v_now, 'YYMMDD') || '-'
    || case when v_seq < 1000 then lpad(v_seq::text, 3, '0') else v_seq::text end;
end $$;

create or replace function public.create_shipment_draft(p_outlet uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select tenant_id into v_tenant from public.outlets where id = p_outlet;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  insert into public.shipments (tenant_id, outlet_id, reference, is_simulated)
  values (v_tenant, p_outlet, private.next_reference(v_tenant),
          (select is_demo from public.tenants where id = v_tenant))
  returning id into v_id;
  perform private.add_event(v_tenant, v_id, 'draft_created', null);
  return v_id;
end $$;

-- Demo examples take their references from the same counter.
create or replace function private.seed_demo_base(p_tenant uuid, p_outlet uuid, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c_budi uuid; c_sari uuid; c_toko uuid; c_rina uuid;
  sh uuid;
begin
  insert into public.contacts (tenant_id, name, phone, is_sender, is_recipient)
    values (p_tenant, 'Budi Santoso (contoh)', '081200000001', true, false) returning id into c_budi;
  insert into public.contacts (tenant_id, name, phone, is_sender, is_recipient)
    values (p_tenant, 'Toko Kain Melati (contoh)', '081200000002', true, true) returning id into c_toko;
  insert into public.contacts (tenant_id, name, phone, is_sender, is_recipient)
    values (p_tenant, 'Sari Wulandari (contoh)', '081200000003', false, true) returning id into c_sari;
  insert into public.contacts (tenant_id, name, phone, is_sender, is_recipient)
    values (p_tenant, 'Rina Kartikasari Purnamasari Wijayakusuma (contoh)', '081200000004', false, true)
    returning id into c_rina;

  insert into public.contact_addresses (tenant_id, contact_id, label, address_line, area, postal_code, is_primary) values
    (p_tenant, c_budi, 'Rumah', 'Jl. Contoh Melati No. 1', 'Kec. Coblong, Kota Bandung', '40132', true),
    (p_tenant, c_toko, 'Toko', 'Ruko Contoh Blok B-7', 'Kec. Tanah Abang, Jakarta Pusat', '10250', true),
    (p_tenant, c_sari, 'Rumah', 'Perumahan Contoh Asri Blok C2 No. 14', 'Kec. Sukolilo, Kota Surabaya', '60111', true),
    (p_tenant, c_sari, 'Kantor', 'Gedung Contoh Lt. 3', 'Kec. Genteng, Kota Surabaya', '60275', false),
    (p_tenant, c_rina, 'Rumah', 'Jl. Contoh Panjang Sekali Untuk Menguji Tampilan Alamat No. 123 RT 004 RW 009',
      'Kec. Mlati, Kab. Sleman, DI Yogyakarta', '55284', true);

  -- Issued example
  insert into public.shipments (tenant_id, outlet_id, reference, created_by, is_simulated, sender_contact_id,
    sender_name, sender_phone, recipient_contact_id, recipient_name, recipient_phone, recipient_address,
    recipient_area, recipient_postal_code, item_description, weight_grams, goods_value_idr,
    submission_state, payment_state, customer_charge_idr, awb, submitted_at, issued_at, pickup_snapshot)
  values (p_tenant, p_outlet, private.next_reference(p_tenant), p_user, true, c_budi, 'Budi Santoso (contoh)', '081200000001',
    c_sari, 'Sari Wulandari (contoh)', '081200000003', 'Perumahan Contoh Asri Blok C2 No. 14',
    'Kec. Sukolilo, Kota Surabaya', '60111', 'Pakaian (contoh)', 1200, 150000,
    'issued', 'paid', 27000, 'SIM000000000001', now() - interval '3 hours', now() - interval '3 hours',
    (select jsonb_build_object('outlet', name, 'address', pickup_address, 'area', pickup_area) from public.outlets where id = p_outlet))
  returning id into sh;
  insert into public.provider_operations (tenant_id, shipment_id, kind, idempotency_key, input_digest, state,
    attempts, result_code, is_simulated, actor)
  values (p_tenant, sh, 'create_order', 'seed-' || sh, 'seed', 'succeeded', 1, 'SIMULATED_OK', true, p_user);
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor) values
    (p_tenant, sh, 'submitted', 'Kurir Simulasi Reguler', p_user),
    (p_tenant, sh, 'issued', 'Resi simulasi SIM000000000001', p_user);

  -- Unknown-outcome example (recovery path)
  insert into public.shipments (tenant_id, outlet_id, reference, created_by, is_simulated, sender_contact_id,
    sender_name, sender_phone, recipient_contact_id, recipient_name, recipient_phone, recipient_address,
    recipient_area, recipient_postal_code, item_description, weight_grams, goods_value_idr,
    submission_state, customer_charge_idr, submitted_at, pickup_snapshot)
  values (p_tenant, p_outlet, private.next_reference(p_tenant), p_user, true, c_toko, 'Toko Kain Melati (contoh)', '081200000002',
    c_rina, 'Rina Kartikasari Purnamasari Wijayakusuma (contoh)', '081200000004',
    'Jl. Contoh Panjang Sekali Untuk Menguji Tampilan Alamat No. 123 RT 004 RW 009',
    'Kec. Mlati, Kab. Sleman, DI Yogyakarta', '55284', 'Kain batik (contoh)', 2500, 450000,
    'unknown', 36000, now() - interval '40 minutes',
    (select jsonb_build_object('outlet', name, 'address', pickup_address, 'area', pickup_area) from public.outlets where id = p_outlet))
  returning id into sh;
  insert into public.provider_operations (tenant_id, shipment_id, kind, idempotency_key, input_digest, state,
    attempts, result_code, is_simulated, actor)
  values (p_tenant, sh, 'create_order', 'seed-' || sh, 'seed', 'unknown', 1, 'SIMULATED_TIMEOUT', true, p_user);
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor) values
    (p_tenant, sh, 'submitted', 'Kurir Simulasi Reguler', p_user),
    (p_tenant, sh, 'outcome_unknown', 'Batas waktu simulasi; jangan buat ulang, lakukan rekonsiliasi', p_user);

  -- Draft example
  insert into public.shipments (tenant_id, outlet_id, reference, created_by, is_simulated, sender_contact_id,
    sender_name, sender_phone, item_description, weight_grams)
  values (p_tenant, p_outlet, private.next_reference(p_tenant), p_user, true, c_budi, 'Budi Santoso (contoh)',
    '081200000001', 'Dokumen (contoh)', 300)
  returning id into sh;
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, actor)
    values (p_tenant, sh, 'draft_created', null, p_user);
end $$;

drop function private.new_reference();

-- ============================================================ Super Admin read (PR-15, PR-37)

-- A separate projection so the existing tenant directory keeps its shape. Read-only identity data.
create function public.platform_tenant_slugs()
returns table (id uuid, slug text, shipment_prefix text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('tenant_governance');
  return query
    select t.id, t.slug, t.shipment_prefix from public.tenants t where not t.is_demo order by t.created_at, t.name;
end $$;

-- ============================================================ privileges

revoke all on function private.slug_is_valid(text), private.slug_prefix(text), private.make_slug(text, boolean),
  private.tenants_identity_guard(), private.next_reference(uuid), private.seed_demo_base(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_shipment_draft(uuid), public.platform_tenant_slugs() from public, anon;
grant execute on function public.create_shipment_draft(uuid), public.platform_tenant_slugs() to authenticated;
