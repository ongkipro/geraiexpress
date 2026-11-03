-- T-081 / PR-41 / DATA-13 / UX-19 item 4: content declaration recorded only inside confirm_shipment.
-- Prohibited categories quote Permenkomdigi 8/2025 Pasal 22 ayat (3) verbatim (JDIH Komdigi, page 10).
-- The acknowledgement wording is PROVISIONAL until the Mengantar sync (DEC-023); a new version is a
-- new row (platform capability), never an edit, and the version accepted is frozen per shipment.
create table public.declaration_texts (
  version integer primary key check (version > 0),
  body text not null check (char_length(body) between 20 and 2000),
  prohibited_categories text[] not null check (cardinality(prohibited_categories) between 1 and 30),
  source_url text not null check (source_url ~ '^https://[^[:space:]]+$'),
  provisional boolean not null,
  effective_at timestamptz not null check (isfinite(effective_at)),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.declaration_texts enable row level security;
revoke all on public.declaration_texts from public, anon, authenticated, service_role;
grant select on public.declaration_texts to authenticated;
create policy declaration_texts_read on public.declaration_texts for select to authenticated using (true);

create function private.declaration_texts_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'declaration_text_immutable' using errcode = '42501';
end $$;
create trigger declaration_texts_append_only before update or delete on public.declaration_texts
  for each row execute function private.declaration_texts_append_only();

insert into public.declaration_texts (version, body, prohibited_categories, source_url, provisional, effective_at)
values (1,
  'Pengirim menyatakan isi paket sesuai keterangan dan bukan barang terlarang. Pengirim bertanggung jawab atas kebenaran keterangan isi paket.',
  array[
    'narkotika, psikotropika, dan obat-obatan terlarang lainnya',
    'barang yang mudah meledak',
    'barang yang mudah terbakar',
    'barang yang mudah rusak dan dapat mencemari lingkungan',
    'barang yang melanggar kesusilaan',
    'barang lainnya yang menurut peraturan perundang-undangan dinyatakan terlarang'],
  'https://jdih.komdigi.go.id/index.php/produk_hukum/unduh/id/967/t/peraturan+menteri+komunikasi+dan+digital+nomor+8+tahun+2025',
  true, timestamptz '2026-11-03 00:00:00+00');

create function public.platform_add_declaration_text(p_body text, p_categories text[], p_source_url text,
  p_provisional boolean, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version integer; v_reason text;
begin
  perform private.require_platform('tenant_governance');
  v_reason := private.require_reason(p_reason);
  lock table public.declaration_texts in exclusive mode;
  select coalesce(max(version), 0) + 1 into v_version from public.declaration_texts;
  insert into public.declaration_texts (version, body, prohibited_categories, source_url, provisional, effective_at, created_by)
  values (v_version, p_body, p_categories, p_source_url, coalesce(p_provisional, true), now(), (select auth.uid()));
  perform private.audit('declaration_text.append', null, null, v_reason, 'success', jsonb_build_object('version', v_version));
  return v_version;
end $$;
revoke all on function public.platform_add_declaration_text(text, text[], text, boolean, text) from public, anon;
grant execute on function public.platform_add_declaration_text(text, text[], text, boolean, text) to authenticated;

-- Frozen per shipment; no column grant: only confirm_shipment writes these.
alter table public.shipments
  add column content_declaration_version integer references public.declaration_texts(version),
  add column content_declared_by uuid references auth.users(id),
  add column content_declared_at timestamptz,
  -- PR-41 shows WHO confirmed: the confirmer's sign-in email frozen at confirmation, so another member
  -- of the same gerai can tell staff apart without a directory read (members already see shipments).
  add column content_declared_by_email text check (char_length(content_declared_by_email) <= 320),
  add constraint shipments_declaration_complete check (
    (content_declaration_version is null) = (content_declared_by is null)
    and (content_declaration_version is null) = (content_declared_at is null));

-- The old four-argument confirmation would bypass the declaration: removed, not kept as an alias.
drop function public.confirm_shipment(uuid, uuid, integer, text);

create function public.confirm_shipment(p_shipment uuid, p_quote uuid, p_expected_revision integer,
  p_idempotency_key text, p_declaration_version integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments; q public.shipment_quotes; o public.outlets; t public.tenants;
  op public.provider_operations; v_awb text; v_digest text; v_decl public.declaration_texts;
begin
  s := private.lock_member_shipment(p_shipment);
  v_digest := md5(row(s.sender_name, s.sender_phone, s.recipient_name, s.recipient_phone, s.recipient_address,
    s.recipient_area, s.recipient_area_id, s.recipient_postal_code, s.item_description, s.weight_grams, s.length_cm,
    s.width_cm, s.height_cm, s.goods_value_idr, s.is_cod, p_quote)::text);
  -- A drop-off digest is unchanged; a pickup digest also binds the chosen date, hour and volume.
  if s.handover = 'pickup' then
    v_digest := md5(v_digest || '|pickup|' || s.pickup_date::text || '|' || s.pickup_slot_hour::text
      || '|' || coalesce(s.pickup_volume, ''));
  end if;
  select * into op from public.provider_operations
    where tenant_id = s.tenant_id and (idempotency_key = p_idempotency_key
      or (shipment_id = s.id and kind = 'create_order' and not private.definitely_not_created(state, result_code)))
    order by (idempotency_key = p_idempotency_key) desc limit 1;
  if found then
    if op.shipment_id <> s.id
       or (op.idempotency_key = p_idempotency_key and op.input_digest <> v_digest) then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('operation_id', op.id, 'state', op.state, 'awb', s.awb, 'replayed', true,
      'simulated', op.is_simulated);
  end if;
  if s.submission_state <> 'estimated' then raise exception 'not_estimated' using errcode = '55000'; end if;
  -- PR-41 / DATA-13: content description and the sender's declaration against the CURRENT text.
  if nullif(btrim(coalesce(s.item_description, '')), '') is null then
    raise exception 'content_description_required' using errcode = '22023';
  end if;
  select * into v_decl from public.declaration_texts where effective_at <= now() order by effective_at desc limit 1;
  if p_declaration_version is null or v_decl.version is distinct from p_declaration_version then
    raise exception 'content_declaration_required' using errcode = '22023';
  end if;
  if s.revision is distinct from p_expected_revision then raise exception 'stale_revision' using errcode = '55000'; end if;
  select * into q from public.shipment_quotes where id = p_quote and tenant_id = s.tenant_id and shipment_id = s.id;
  if not found or q.shipment_revision <> s.revision then raise exception 'stale_quote' using errcode = '55000'; end if;
  if q.expires_at <= now() then raise exception 'quote_expired' using errcode = '55000'; end if;
  if s.is_simulated <> q.is_simulated then raise exception 'stale_quote' using errcode = '55000'; end if;
  if s.handover = 'pickup' and not private.pickup_slot_ok(s.pickup_date, s.pickup_slot_hour) then
    raise exception 'pickup_time_invalid' using errcode = '22023';
  end if;
  if s.is_cod then
    if coalesce(s.goods_value_idr, 0) < 1000 then raise exception 'cod_goods_value_required' using errcode = '22023'; end if;
    if not q.cod_supported or q.service_class = 'cargo' then raise exception 'cod_not_supported' using errcode = '22023'; end if;
  end if;
  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id for share;
  select * into t from public.tenants where id = s.tenant_id;
  if not s.is_simulated then
    if t.is_demo or t.lifecycle <> 'active' then raise exception 'tenant_not_active' using errcode = '55000'; end if;
    if o.mengantar_pickup_address_id is null or o.mengantar_area_id is null then
      raise exception 'pickup_not_set' using errcode = '55000';
    end if;
    if q.origin_area_id is distinct from o.mengantar_area_id
       or q.origin_pickup_address_id is distinct from o.mengantar_pickup_address_id then
      raise exception 'stale_quote' using errcode = '55000';
    end if;
    perform private.require_live_recipient(s);
    if s.recipient_area_id is null then raise exception 'area_required' using errcode = '22023'; end if;
    if coalesce(s.goods_value_idr, 0) < 1 then raise exception 'goods_value_required' using errcode = '22023'; end if;
    if not exists (select 1 from private.seller_credentials c where c.tenant_id = s.tenant_id and c.superseded_at is null) then
      raise exception 'provider_not_connected' using errcode = '55000';
    end if;
  end if;
  begin
    insert into public.provider_operations (tenant_id, shipment_id, kind, idempotency_key, input_digest,
      state, is_simulated, actor)
    values (s.tenant_id, s.id, 'create_order', p_idempotency_key, v_digest, 'queued', s.is_simulated, (select auth.uid()))
    returning * into op;
  exception when unique_violation then raise exception 'idempotency_conflict' using errcode = '23505';
  end;
  update public.shipments set submission_state = 'queued', selected_quote_id = q.id,
    customer_charge_idr = q.customer_charge_idr,
    weight_snapshot = jsonb_build_object('actual_weight_grams', q.actual_weight_grams,
      'volumetric_weight_grams', q.volumetric_weight_grams, 'billable_weight_grams', q.billable_weight_grams,
      'weight_rule_id', q.weight_rule_id, 'service_class', q.service_class, 'length_cm', s.length_cm, 'width_cm', s.width_cm, 'height_cm', s.height_cm),
    cod_amount_idr = case when s.is_cod then s.goods_value_idr + q.customer_charge_idr else null end,
    pickup_snapshot = jsonb_build_object('outlet', o.name, 'address', o.pickup_address, 'area', o.pickup_area,
      'mengantar_pickup_address_id', o.mengantar_pickup_address_id, 'mengantar_area_id', o.mengantar_area_id,
      'handover', s.handover)
      || case when s.handover = 'pickup' then jsonb_build_object('pickup_date', s.pickup_date,
        'pickup_slot_hour', s.pickup_slot_hour, 'pickup_volume', s.pickup_volume, 'pickup_note', s.pickup_note)
        else '{}'::jsonb end,
    content_declaration_version = v_decl.version, content_declared_by = (select auth.uid()),
    content_declared_at = now(),
    content_declared_by_email = (select u.email::text from auth.users u where u.id = (select auth.uid())),
    submitted_at = now(), updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'submitted',
    q.courier || ' ' || q.service || case when s.is_cod then ' (COD)' else '' end
      || case when s.handover = 'pickup' then ' · jemput' else '' end);
  if not s.is_simulated then
    return jsonb_build_object('operation_id', op.id, 'state', 'queued', 'awb', null, 'replayed', false, 'simulated', false);
  end if;
  v_awb := 'SIM' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')
    || lpad((floor(random() * 1000000))::int::text, 6, '0');
  update public.provider_operations set state = 'succeeded', attempts = 1, result_code = 'SIMULATED_OK',
    updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = v_awb,
    issued_at = now(), updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'issued', 'Resi simulasi ' || v_awb);
  return jsonb_build_object('operation_id', op.id, 'state', 'succeeded', 'awb', v_awb, 'replayed', false, 'simulated', true);
end $$;
revoke all on function public.confirm_shipment(uuid, uuid, integer, text, integer) from public, anon;
grant execute on function public.confirm_shipment(uuid, uuid, integer, text, integer) to authenticated;

notify pgrst, 'reload schema';
