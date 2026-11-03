-- T-080 / PR-43 / DATA-14: non-COD cargo through the live quote, confirmation and dispatch path.
-- Forward-only: the applied 20261102100000 migration is never rewritten. Its cargo ranges were
-- evidence; help 5502313 (updated 2026-09-24) states JTR 10-30 kg, Gokil 10-50 kg and IDX Kargo
-- 10-70 kg as minimum/maximum pairs. SAP Kargo minimums vary by region and it is non-COD only:
-- no SAP version is appended, so SAP cargo stays excluded (cargo_minimum_unverified).
alter table public.shipment_quotes
  add column service_class text not null default 'regular' check (service_class in ('regular', 'cargo'));
-- Cargo is never a COD quote, whatever a caller sends (defense in depth below the RPC).
alter table public.shipment_quotes add constraint shipment_quotes_cargo_noncod
  check (service_class = 'regular' or (cod_fee_idr = 0 and not cod_supported));

insert into private.billable_weight_rules (courier, service_class, divisor, tolerance_grams,
  max_weight_grams, min_weight_grams, source_url, source_updated_at, effective_at)
select prior.courier, 'cargo', prior.divisor, prior.tolerance_grams, v.maximum, v.minimum,
  'https://help.mengantar.com/id/articles/5502313-jne-sicepat-sap-idexpress-jandt-lion-parcel-anteraja-pos-ind-dan-spx',
  date '2026-09-24', timestamptz '2026-11-03 00:00:00+00'
from (values ('JNE', 10000, 30000), ('SiCepat', 10000, 50000), ('iDexpress', 10000, 70000)) as v(courier, minimum, maximum)
cross join lateral (select * from private.billable_weight_rules r where r.courier = v.courier
  and r.service_class = 'cargo' order by r.effective_at desc limit 1) prior;

create or replace function public.record_live_quotes(p_tenant uuid, p_shipment uuid, p_expected_revision integer,
  p_rows jsonb, p_origin_area_id text, p_origin_address_id text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments; o public.outlets; r jsonb; v_quote uuid; v_count integer := 0;
  v_cod_supported boolean; v_fee_raw text; v_cod_fee bigint; v_tariff bigint; v_net bigint;
  v_discount_bps integer; v_rule private.billable_weight_rules; v_weight record; v_class text;
begin
  select * into s from public.shipments where tenant_id = p_tenant and id = p_shipment for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  if s.submission_state not in ('draft', 'estimated') then
    raise exception 'shipment_locked' using errcode = '42501';
  end if;
  if s.revision is distinct from p_expected_revision then raise exception 'stale_revision' using errcode = '55000'; end if;
  if s.is_cod and coalesce(s.goods_value_idr, 0) < 1000 then
    raise exception 'cod_goods_value_required' using errcode = '22023';
  end if;
  perform private.require_live_recipient(s);
  -- Shared outlet lock serializes with set_outlet_mengantar_pickup through the quote write.
  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id for share;
  if o.mengantar_area_id is null or o.mengantar_pickup_address_id is null then
    raise exception 'pickup_not_set' using errcode = '55000';
  end if;
  if p_origin_area_id is distinct from o.mengantar_area_id
     or p_origin_address_id is distinct from o.mengantar_pickup_address_id then
    raise exception 'stale_quote' using errcode = '55000';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 20 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update public.shipment_quotes set expires_at = now()
    where tenant_id = s.tenant_id and shipment_id = s.id and expires_at > now();
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'courier', '') !~ '^[A-Za-z]{2,20}$' or coalesce(r->>'tariff', '') !~ '^[0-9]{1,9}$'
       or coalesce(r->>'net', '') !~ '^[0-9]{1,9}$' or char_length(coalesce(r->>'eta', '')) > 40 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    -- Absent class is the legacy regular row. Cargo is non-COD only and must carry the sourced rule
    -- plus the provider's route minimum, which must equal that rule (no billing floor is inferred).
    v_class := coalesce(r->>'service_class', 'regular');
    if v_class not in ('regular', 'cargo') then raise exception 'invalid_input' using errcode = '22023'; end if;
    if v_class = 'cargo' and (s.is_cod or r->>'courier' not in ('JNE', 'SiCepat', 'Sap', 'iDexpress')
       or r->>'weight_rule_id' is null or coalesce(r->>'minimum_weight_grams', '') !~ '^[0-9]{1,7}$') then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_tariff := (r->>'tariff')::bigint;
    v_net := (r->>'net')::bigint;
    if v_tariff <= 0 or v_net > v_tariff then raise exception 'invalid_input' using errcode = '22023'; end if;
    -- Provider discount in basis points: absent or JSON null is unknown (NULL), never 0.
    v_discount_bps := null;
    if r ? 'discount_bps' and jsonb_typeof(r->'discount_bps') <> 'null' then
      if jsonb_typeof(r->'discount_bps') <> 'number' or r->>'discount_bps' !~ '^[0-9]{1,5}$'
         or (r->>'discount_bps')::integer > 10000 then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_discount_bps := (r->>'discount_bps')::integer;
    end if;
    if r ? 'cod_supported' then
      if jsonb_typeof(r->'cod_supported') <> 'boolean' then raise exception 'invalid_input' using errcode = '22023'; end if;
      v_cod_supported := (r->>'cod_supported')::boolean;
    else
      v_cod_supported := s.is_cod;
    end if;
    if v_class = 'cargo' then v_cod_supported := false; end if;
    if s.is_cod and not v_cod_supported then continue; end if;
    if s.is_cod then
      v_fee_raw := coalesce(r->>'cod_fee', r->>'codFee', '0');
      if v_fee_raw !~ '^[0-9]{1,9}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
      v_cod_fee := v_fee_raw::bigint;
    else
      v_cod_fee := 0;
    end if;
    v_rule := null;
    if r->>'weight_rule_id' is not null then
      select * into v_rule from private.billable_weight_rules where id = (r->>'weight_rule_id')::uuid
        and courier = r->>'courier' and service_class = v_class and effective_at <= now();
      if not found then raise exception 'invalid_weight_rule' using errcode = '22023'; end if;
    else
      select * into v_rule from private.billable_weight_rules where courier = r->>'courier'
        and service_class = 'regular' and effective_at <= now() order by effective_at desc limit 1;
    end if;
    if v_class = 'cargo' and (v_rule.min_weight_grams is null
       or (r->>'minimum_weight_grams')::integer is distinct from v_rule.min_weight_grams) then
      raise exception 'invalid_weight_rule' using errcode = '22023';
    end if;
    select * into v_weight from private.billable_weight(s.weight_grams, s.length_cm, s.width_cm, s.height_cm, v_rule);
    -- Legacy machine callers without dimensions sent actual weight. Complete dimensions require
    -- the explicit weight actually sent; never silently attach a different computed quote weight.
    if (r ? 'billable_weight_grams' and (r->>'billable_weight_grams')::integer is distinct from v_weight.billable_weight_grams)
      or (s.length_cm is not null and s.width_cm is not null and s.height_cm is not null
        and not (r ? 'billable_weight_grams')) then
      raise exception 'quote_weight_mismatch' using errcode = '22023';
    end if;
    if v_weight.exclusion is not null then
      perform private.add_event(s.tenant_id, s.id, 'quote_weight_excluded', (r->>'courier') || case when v_class = 'cargo' then ' Kargo' else '' end || ': ' || v_weight.exclusion);
      continue;
    end if;
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, expires_at,
      origin_area_id, origin_pickup_address_id, actual_weight_grams, volumetric_weight_grams, billable_weight_grams, weight_rule_id, service_class)
    values (s.tenant_id, s.id, s.revision, r->>'courier', case when v_class = 'cargo' then 'Kargo' else 'Reguler' end, v_tariff,
      v_cod_supported, v_cod_fee, v_tariff + v_cod_fee, coalesce(nullif(r->>'eta', ''), '—'), false,
      now() + interval '30 minutes', p_origin_area_id, p_origin_address_id, v_weight.actual_weight_grams,
      v_weight.volumetric_weight_grams, v_weight.billable_weight_grams, v_weight.weight_rule_id, v_class)
    returning id into v_quote;
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr, provider_discount_bps)
      values (s.tenant_id, v_quote, v_net, v_discount_bps);
    v_count := v_count + 1;
  end loop;
  update public.shipments set submission_state = case when v_count > 0 then 'estimated' else 'draft' end,
    updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'quoted',
    case when v_count > 0 then 'Estimasi Mengantar' else 'Tidak ada layanan Mengantar untuk rute ini' end);
  return v_count;
end $$;
revoke all on function public.record_live_quotes(uuid, uuid, integer, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.record_live_quotes(uuid, uuid, integer, jsonb, text, text) to service_role;

create or replace function public.confirm_shipment(p_shipment uuid, p_quote uuid, p_expected_revision integer,
  p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments; q public.shipment_quotes; o public.outlets; t public.tenants;
  op public.provider_operations; v_awb text; v_digest text;
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
revoke all on function public.confirm_shipment(uuid, uuid, integer, text) from public, anon;
grant execute on function public.confirm_shipment(uuid, uuid, integer, text) to authenticated;

create or replace function private.dispatch_payload(op public.provider_operations)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s public.shipments; q public.shipment_quotes; c private.seller_credentials;
begin
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;
  c := private.operation_credential(s.tenant_id, op.provider_env, op.credential_version);
  return jsonb_build_object(
    'operation_id', op.id, 'tenant_id', op.tenant_id, 'attempt', op.attempts,
    'operation_state', op.state,
    'provider_env', op.provider_env, 'dispatched_at', op.dispatched_at,
    'reference', s.reference, 'courier', q.courier, 'cargo', q.service_class = 'cargo',
    'pickup_address_id', s.pickup_snapshot->>'mengantar_pickup_address_id',
    'pickup_area_id', s.pickup_snapshot->>'mengantar_area_id',
    'handover', coalesce(s.pickup_snapshot->>'handover', 'dropoff'),
    'pickup_date', s.pickup_snapshot->>'pickup_date',
    'pickup_slot_hour', (s.pickup_snapshot->>'pickup_slot_hour')::integer,
    'pickup_volume', s.pickup_snapshot->>'pickup_volume',
    'pickup_phase', op.pickup_phase,
    'pickup_time_id', op.pickup_time_id,
    'recipient', jsonb_build_object('area_id', s.recipient_area_id, 'address', s.recipient_address,
      'name', s.recipient_name, 'phone', s.recipient_phone),
    'billable_weight_grams', (s.weight_snapshot->>'billable_weight_grams')::integer,
    'weight_grams', s.weight_grams, 'item_description', s.item_description, 'goods_value_idr', s.goods_value_idr,
    'is_cod', s.is_cod, 'cod_amount_idr', s.cod_amount_idr,
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;

notify pgrst, 'reload schema';
