-- T-025 (COD shipments, two-pass COD fee pricing, provider refusal text) and
-- T-026 (batch pay-unpaid recovery with full batch review).
-- Contracts: TD-2, TD-3, TD-9, PR-4, PR-5, PR-6, PR-22, PR-23, DATA-2, DATA-5, IAM-1, DEC-008, DEC-010.

-- ============================================================ schema extensions

alter table public.shipments
  add column is_cod boolean not null default false,
  add column cod_amount_idr bigint check (cod_amount_idr is null or cod_amount_idr >= 0);

grant update (is_cod) on public.shipments to authenticated;

alter table public.shipment_quotes
  add column cod_supported boolean not null default false,
  add column cod_fee_idr bigint not null default 0 check (cod_fee_idr >= 0),
  add column customer_charge_idr bigint not null default 0 check (customer_charge_idr >= 0);

update public.shipment_quotes
  set customer_charge_idr = normal_tariff_idr + cod_fee_idr;

create function private.sync_quote_charge()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.cod_fee_idr := coalesce(new.cod_fee_idr, 0);
  new.customer_charge_idr := new.normal_tariff_idr + new.cod_fee_idr;
  return new;
end $$;

create trigger shipment_quotes_sync_charge before insert or update on public.shipment_quotes
  for each row execute function private.sync_quote_charge();

alter table public.shipment_quotes
  add constraint shipment_quotes_charge_check check (customer_charge_idr = normal_tariff_idr + cod_fee_idr);

alter table public.provider_operations
  add column provider_error_detail text check (provider_error_detail is null or char_length(provider_error_detail) <= 500),
  add column payment_in_flight_at timestamptz;

-- ============================================================ draft immutability & quote invalidation

create or replace function private.guard_shipment()
returns trigger language plpgsql set search_path = ''
as $$
declare
  content_changed boolean :=
    (new.sender_contact_id, new.sender_name, new.sender_phone, new.recipient_contact_id,
     new.recipient_name, new.recipient_phone, new.recipient_address, new.recipient_area,
     new.recipient_area_id, new.recipient_postal_code, new.item_description, new.weight_grams,
     new.length_cm, new.width_cm, new.height_cm, new.goods_value_idr, new.is_cod)
    is distinct from
    (old.sender_contact_id, old.sender_name, old.sender_phone, old.recipient_contact_id,
     old.recipient_name, old.recipient_phone, old.recipient_address, old.recipient_area,
     old.recipient_area_id, old.recipient_postal_code, old.item_description, old.weight_grams,
     old.length_cm, old.width_cm, old.height_cm, old.goods_value_idr, old.is_cod);
begin
  if new.tenant_id <> old.tenant_id or new.outlet_id <> old.outlet_id or new.reference <> old.reference then
    raise exception 'ownership_immutable' using errcode = '42501';
  end if;
  if content_changed then
    if old.submission_state not in ('draft', 'estimated') then
      raise exception 'shipment_locked' using errcode = '42501';
    end if;
    new.revision := old.revision + 1;
    new.submission_state := 'draft';
    new.selected_quote_id := null;
    new.customer_charge_idr := null;
    new.cod_amount_idr := null;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ============================================================ quotes (simulated & live)

create or replace function public.request_quotes(p_shipment uuid, p_expected_revision integer)
returns setof public.shipment_quotes language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  t public.tenants;
  q record;
  v_quote uuid;
  v_cod_fee bigint;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state not in ('draft', 'estimated') then
    raise exception 'shipment_locked' using errcode = '42501';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '55000';
  end if;
  if s.sender_name is null or s.sender_phone is null or s.recipient_name is null
     or s.recipient_phone is null or s.recipient_address is null or s.recipient_area is null
     or s.weight_grams is null or s.item_description is null then
    raise exception 'incomplete_draft' using errcode = '22023';
  end if;
  if s.is_cod and coalesce(s.goods_value_idr, 0) < 1000 then
    raise exception 'cod_goods_value_required' using errcode = '22023';
  end if;
  select * into t from public.tenants where id = s.tenant_id;
  if not t.is_demo then
    raise exception 'provider_not_connected' using errcode = '55000';
  end if;

  if s.submission_state = 'estimated' and exists (
    select 1 from public.shipment_quotes
    where tenant_id = s.tenant_id and shipment_id = s.id and shipment_revision = s.revision and expires_at > now()
  ) then
    return query select * from public.shipment_quotes
      where tenant_id = s.tenant_id and shipment_id = s.id and shipment_revision = s.revision and expires_at > now()
      order by customer_charge_idr, normal_tariff_idr;
    return;
  end if;

  for q in select * from private.simulated_tariffs(s.weight_grams, s.length_cm, s.width_cm, s.height_cm) loop
    -- Hemat does not support simulated COD; Reguler and Kilat support COD with a 3% fee rounded up to 100 IDR.
    if s.is_cod and q.service = 'Hemat' then
      continue;
    end if;
    v_cod_fee := case
      when s.is_cod then ceil(((s.goods_value_idr + q.normal_tariff_idr) * 0.03) / 100.0)::bigint * 100
      else 0
    end;
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, expires_at)
    values (s.tenant_id, s.id, s.revision, q.courier, q.service, q.normal_tariff_idr,
      q.service in ('Reguler', 'Kilat'), v_cod_fee, q.normal_tariff_idr + v_cod_fee,
      q.eta_days, true, now() + interval '30 minutes')
    returning id into v_quote;
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr)
    values (s.tenant_id, v_quote, q.net_shipping_idr);
  end loop;

  update public.shipments set submission_state = 'estimated', updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'quoted',
    case when s.is_cod then 'Estimasi simulasi (COD)' else 'Estimasi simulasi' end);
  return query select * from public.shipment_quotes
    where tenant_id = s.tenant_id and shipment_id = s.id and shipment_revision = s.revision
      and expires_at > now()
    order by customer_charge_idr, normal_tariff_idr;
end $$;

create or replace function public.record_live_quotes(p_tenant uuid, p_shipment uuid, p_expected_revision integer, p_rows jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  r jsonb;
  v_quote uuid;
  v_count integer := 0;
  v_cod_supported boolean;
  v_fee_raw text;
  v_cod_fee bigint;
  v_tariff bigint;
  v_net bigint;
begin
  select * into s from public.shipments where tenant_id = p_tenant and id = p_shipment for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  if s.submission_state not in ('draft', 'estimated') then
    raise exception 'shipment_locked' using errcode = '42501';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '55000';
  end if;
  if s.is_cod and coalesce(s.goods_value_idr, 0) < 1000 then
    raise exception 'cod_goods_value_required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  -- A fresh live estimate replaces any unexpired quotes of this revision.
  update public.shipment_quotes set expires_at = now()
    where tenant_id = s.tenant_id and shipment_id = s.id and expires_at > now();
  for r in select * from jsonb_array_elements(p_rows) loop
    -- Format checks first (OR evaluation order is not guaranteed), then the casts.
    if coalesce(r->>'courier', '') !~ '^[A-Za-z]{2,20}$' or coalesce(r->>'tariff', '') !~ '^[0-9]{1,9}$'
       or coalesce(r->>'net', '') !~ '^[0-9]{1,9}$' or char_length(coalesce(r->>'eta', '')) > 40 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_tariff := (r->>'tariff')::bigint;
    v_net := (r->>'net')::bigint;
    if v_tariff <= 0 or v_net > v_tariff then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if r ? 'cod_supported' then
      if jsonb_typeof(r->'cod_supported') <> 'boolean' then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_cod_supported := (r->>'cod_supported')::boolean;
    else
      v_cod_supported := s.is_cod;
    end if;
    if s.is_cod and not v_cod_supported then
      continue;
    end if;
    if s.is_cod then
      v_fee_raw := coalesce(r->>'cod_fee', r->>'codFee', '0');
      if v_fee_raw !~ '^[0-9]{1,9}$' then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_cod_fee := v_fee_raw::bigint;
    else
      v_cod_fee := 0;
    end if;
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, expires_at)
    values (s.tenant_id, s.id, s.revision, r->>'courier', 'Reguler', v_tariff,
      v_cod_supported, v_cod_fee, v_tariff + v_cod_fee,
      coalesce(nullif(r->>'eta', ''), '—'), false, now() + interval '30 minutes')
    returning id into v_quote;
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values (s.tenant_id, v_quote, v_net);
    v_count := v_count + 1;
  end loop;
  update public.shipments set submission_state = case when v_count > 0 then 'estimated' else 'draft' end,
    updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'quoted',
    case when v_count > 0 then 'Estimasi Mengantar' else 'Tidak ada layanan Mengantar untuk rute ini' end);
  return v_count;
end $$;

-- ============================================================ confirmation & reopen

create or replace function public.confirm_shipment(p_shipment uuid, p_quote uuid, p_expected_revision integer,
  p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  q public.shipment_quotes;
  o public.outlets;
  t public.tenants;
  op public.provider_operations;
  v_awb text;
  v_digest text;
begin
  s := private.lock_member_shipment(p_shipment);
  v_digest := md5(row(s.sender_name, s.sender_phone, s.recipient_name, s.recipient_phone, s.recipient_address,
    s.recipient_area, s.recipient_area_id, s.recipient_postal_code, s.item_description, s.weight_grams, s.length_cm,
    s.width_cm, s.height_cm, s.goods_value_idr, s.is_cod, p_quote)::text);

  -- Replay: the same key, or a still-live create operation for this shipment.
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

  if s.submission_state <> 'estimated' then
    raise exception 'not_estimated' using errcode = '55000';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '55000';
  end if;
  select * into q from public.shipment_quotes
    where id = p_quote and tenant_id = s.tenant_id and shipment_id = s.id;
  if not found or q.shipment_revision <> s.revision then
    raise exception 'stale_quote' using errcode = '55000';
  end if;
  if q.expires_at <= now() then
    raise exception 'quote_expired' using errcode = '55000';
  end if;
  if s.is_simulated <> q.is_simulated then
    raise exception 'stale_quote' using errcode = '55000';
  end if;
  if s.is_cod then
    if coalesce(s.goods_value_idr, 0) < 1000 then
      raise exception 'cod_goods_value_required' using errcode = '22023';
    end if;
    if not q.cod_supported then
      raise exception 'cod_not_supported' using errcode = '22023';
    end if;
  end if;
  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id;
  select * into t from public.tenants where id = s.tenant_id;

  if not s.is_simulated then
    -- A real order: everything the dispatcher needs must already be in place.
    if t.is_demo or t.lifecycle <> 'active' then
      raise exception 'tenant_not_active' using errcode = '55000';
    end if;
    if o.mengantar_pickup_address_id is null then
      raise exception 'pickup_not_set' using errcode = '55000';
    end if;
    if s.recipient_area_id is null then
      raise exception 'area_required' using errcode = '22023';
    end if;
    if coalesce(s.goods_value_idr, 0) < 1 then
      raise exception 'goods_value_required' using errcode = '22023';
    end if;
    if not exists (select 1 from private.seller_credentials c where c.tenant_id = s.tenant_id and c.superseded_at is null) then
      raise exception 'provider_not_connected' using errcode = '55000';
    end if;
  end if;

  begin
    insert into public.provider_operations (tenant_id, shipment_id, kind, idempotency_key, input_digest,
      state, is_simulated, actor)
    values (s.tenant_id, s.id, 'create_order', p_idempotency_key, v_digest, 'queued', s.is_simulated, (select auth.uid()))
    returning * into op;
  exception when unique_violation then
    raise exception 'idempotency_conflict' using errcode = '23505';
  end;

  update public.shipments set
    submission_state = 'queued',
    selected_quote_id = q.id,
    customer_charge_idr = q.customer_charge_idr,
    cod_amount_idr = case when s.is_cod then s.goods_value_idr + q.customer_charge_idr else null end,
    pickup_snapshot = jsonb_build_object('outlet', o.name, 'address', o.pickup_address, 'area', o.pickup_area),
    submitted_at = now(),
    updated_at = now()
  where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'submitted',
    q.courier || ' ' || q.service || case when s.is_cod then ' (COD)' else '' end);

  if not s.is_simulated then
    -- The Worker dispatches it now (and the sweep picks it up if that does not happen).
    return jsonb_build_object('operation_id', op.id, 'state', 'queued', 'awb', null, 'replayed', false, 'simulated', false);
  end if;

  -- Simulated dispatch: the demo "provider" accepts immediately.
  v_awb := 'SIM' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')
    || lpad((floor(random() * 1000000))::int::text, 6, '0');
  update public.provider_operations set state = 'succeeded', attempts = 1, result_code = 'SIMULATED_OK',
    updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = v_awb,
    issued_at = now(), updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'issued', 'Resi simulasi ' || v_awb);
  return jsonb_build_object('operation_id', op.id, 'state', 'succeeded', 'awb', v_awb, 'replayed', false, 'simulated', true);
end $$;

create or replace function public.reopen_shipment(p_shipment uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.shipments;
  op public.provider_operations;
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  select * into op from public.provider_operations
    where tenant_id = v_tenant and shipment_id = p_shipment and kind = 'create_order'
    order by created_at desc limit 1 for update;
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state <> 'failed' or op.id is null or not private.definitely_not_created(op.state, op.result_code) then
    raise exception 'not_reopenable' using errcode = '55000';
  end if;
  update public.shipments set submission_state = 'draft', selected_quote_id = null, customer_charge_idr = null,
    cod_amount_idr = null, pickup_snapshot = null, submitted_at = null, updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'reopened', 'Draf dibuka lagi setelah ditolak');
end $$;

-- ============================================================ dispatcher payload, claim & record

create or replace function private.dispatch_payload(op public.provider_operations)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.shipments;
  o public.outlets;
  q public.shipment_quotes;
  c private.seller_credentials;
begin
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id;
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;
  select * into c from private.seller_credentials
    where tenant_id = s.tenant_id and superseded_at is null and version = op.credential_version;
  return jsonb_build_object(
    'operation_id', op.id, 'tenant_id', op.tenant_id, 'attempt', op.attempts,
    'provider_env', op.provider_env, 'dispatched_at', op.dispatched_at,
    'reference', s.reference, 'courier', q.courier,
    'pickup_address_id', o.mengantar_pickup_address_id,
    'recipient', jsonb_build_object('area_id', s.recipient_area_id, 'address', s.recipient_address,
      'name', s.recipient_name, 'phone', s.recipient_phone),
    'weight_grams', s.weight_grams, 'item_description', s.item_description, 'goods_value_idr', s.goods_value_idr,
    'is_cod', s.is_cod, 'cod_amount_idr', s.cod_amount_idr,
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;

create or replace function public.dispatch_claim(p_operation uuid, p_env text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  t public.tenants;
  s public.shipments;
  v_version integer;
begin
  if p_env not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  op := private.lock_real_operation(p_operation);
  if op.state <> 'queued' then
    raise exception 'not_queued' using errcode = '55000';
  end if;
  select * into t from public.tenants where id = op.tenant_id for update;
  if t.is_demo or t.lifecycle <> 'active' then
    raise exception 'tenant_not_active' using errcode = '55000';
  end if;
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  if s.submission_state <> 'queued' or s.is_simulated or not exists (
    select 1 from public.shipment_quotes q where q.tenant_id = s.tenant_id and q.id = s.selected_quote_id
      and q.shipment_revision = s.revision and not q.is_simulated
      and (not s.is_cod or q.cod_supported)) then
    raise exception 'shipment_not_ready' using errcode = '55000';
  end if;
  if exists (select 1 from public.provider_operations o where o.tenant_id = op.tenant_id and not o.is_simulated
      and (o.state = 'in_flight'
        or (o.state = 'unknown' and o.dispatched_at > now() - interval '5 minutes')
        or (o.payment_in_flight_at is not null and o.payment_in_flight_at > now() - interval '2 minutes'))) then
    raise exception 'account_busy' using errcode = '55P03';
  end if;
  select version into v_version from private.seller_credentials
    where tenant_id = op.tenant_id and superseded_at is null;
  if v_version is null then
    raise exception 'credential_missing' using errcode = '55000';
  end if;
  if op.created_at < now() - interval '6 hours' then
    update public.provider_operations set state = 'failed', result_code = 'QUOTE_STALE', updated_at = now() where id = op.id;
    update public.shipments set submission_state = 'failed', updated_at = now() where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'rejected', 'Ongkir kedaluwarsa sebelum dikirim; cek ongkir lagi');
    return jsonb_build_object('stale', true);
  end if;
  begin
    update public.provider_operations set state = 'in_flight', attempts = attempts + 1,
      provider_env = p_env, credential_version = v_version, dispatched_at = now(), updated_at = now()
    where id = op.id returning * into op;
  exception when unique_violation then
    raise exception 'account_busy' using errcode = '55P03';
  end;
  update public.shipments set submission_state = 'in_flight', updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
  perform private.add_event(op.tenant_id, op.shipment_id, 'dispatched', null);
  return private.dispatch_payload(op);
end $$;

drop function public.dispatch_record(uuid, integer, text, text, text, text, text, text, bigint);
create function public.dispatch_record(p_operation uuid, p_attempt integer, p_outcome text,
  p_order_id text default null, p_tracking text default null, p_batch text default null,
  p_record_id text default null, p_code text default null, p_price bigint default null,
  p_detail text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  v_op_state text;
  v_ship_state text;
  v_payment text;
  v_detail text;
  v_provider_detail text := left(nullif(btrim(coalesce(p_detail, '')), ''), 500);
begin
  if p_outcome not in ('issued', 'unpaid', 'failed', 'rejected', 'unknown', 'not_created') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  op := private.lock_real_operation(p_operation);

  -- An unpaid order (created unpaid, reconciled or corrected) that has since been paid gets its
  -- resi (same provider order only).
  if op.state = 'succeeded' and p_outcome = 'issued' and op.provider_order_id = p_order_id
     and p_tracking ~ '^[A-Za-z0-9-]{6,40}$' and exists (select 1 from public.shipments s
       where s.tenant_id = op.tenant_id and s.id = op.shipment_id and s.payment_state = 'unpaid') then
    update public.provider_operations set result_code = 'ISSUED', payment_in_flight_at = null, updated_at = now() where id = op.id;
    update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = p_tracking,
      issued_at = coalesce(issued_at, now()), updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'issued', 'Resi ' || p_tracking);
    return jsonb_build_object('state', 'succeeded', 'replayed', false, 'price_mismatch', private.record_provider_price(op, p_price));
  end if;
  -- A conclusion drawn by reconciliation ("not created", or a provider error item) is corrected
  -- when the order turns up after all (a late original answer or a later lookup): the money was
  -- spent, so the shipment must show it (TD-3: an expired lease is not proof the provider stopped).
  if op.state = 'failed' and op.result_code in ('NOT_CREATED', 'PROVIDER_ERROR_ITEM')
     and p_outcome in ('issued', 'unpaid') and p_order_id is not null and p_batch is not null
     and (p_outcome = 'unpaid' or p_tracking ~ '^[A-Za-z0-9-]{6,40}$') then
    update public.provider_operations set state = 'succeeded', result_code = 'CORRECTED',
      provider_order_id = p_order_id, provider_batch = p_batch, provider_error_detail = null,
      payment_in_flight_at = null, updated_at = now() where id = op.id;
    update public.shipments set
      submission_state = case when p_outcome = 'issued' then 'issued' else 'awaiting_payment' end,
      payment_state = case when p_outcome = 'issued' then 'paid' else 'unpaid' end,
      awb = case when p_outcome = 'issued' then p_tracking else null end,
      issued_at = case when p_outcome = 'issued' then now() else null end, updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'outcome_corrected',
      case when p_outcome = 'issued' then 'Order Mengantar ditemukan: resi ' || p_tracking
        else 'Order Mengantar ditemukan, menunggu pembayaran saldo' end);
    return jsonb_build_object('state', 'succeeded', 'replayed', false, 'price_mismatch', private.record_provider_price(op, p_price));
  end if;
  if op.state in ('succeeded', 'failed') then
    if (op.state = 'succeeded' and p_outcome in ('issued', 'unpaid') and op.provider_order_id = p_order_id)
       or (op.state = 'failed' and p_outcome in ('failed', 'rejected', 'not_created')) then
      return jsonb_build_object('state', op.state, 'replayed', true);
    end if;
    raise exception 'already_recorded' using errcode = '55000';
  end if;
  if op.state = 'in_flight' then
    if op.attempts <> p_attempt then
      raise exception 'stale_attempt' using errcode = '55000';
    end if;
    if p_outcome = 'not_created' then
      raise exception 'invalid_outcome' using errcode = '22023';
    end if;
  elsif op.state = 'unknown' then
    if p_outcome = 'unknown' then
      if p_code is not null and p_code ~ '^[A-Z_]{2,40}$' then
        update public.provider_operations set result_code = p_code, updated_at = now() where id = op.id;
      end if;
      return jsonb_build_object('state', 'unknown', 'replayed', true);
    end if;
    if p_outcome = 'not_created' and op.dispatched_at > now() - interval '5 minutes' then
      raise exception 'too_early' using errcode = '55000';
    end if;
  else
    raise exception 'not_dispatched' using errcode = '55000';
  end if;

  if p_outcome in ('issued', 'unpaid') and (p_order_id is null or p_batch is null) then
    raise exception 'missing_identity' using errcode = '22023';
  end if;
  if p_outcome = 'issued' and (p_tracking is null or p_tracking !~ '^[A-Za-z0-9-]{6,40}$') then
    raise exception 'missing_identity' using errcode = '22023';
  end if;
  if p_code is not null and p_code !~ '^[A-Z_]{2,40}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;

  v_op_state := case p_outcome when 'issued' then 'succeeded' when 'unpaid' then 'succeeded'
    when 'unknown' then 'unknown' else 'failed' end;
  v_ship_state := case p_outcome when 'issued' then 'issued' when 'unpaid' then 'awaiting_payment'
    when 'unknown' then 'unknown' else 'failed' end;
  v_payment := case p_outcome when 'issued' then 'paid' when 'unpaid' then 'unpaid' else null end;

  update public.provider_operations set state = v_op_state,
    result_code = coalesce(p_code, upper(p_outcome)),
    provider_order_id = coalesce(p_order_id, provider_order_id),
    provider_batch = coalesce(p_batch, provider_batch),
    provider_record_id = coalesce(p_record_id, provider_record_id),
    provider_error_detail = case when p_outcome in ('rejected', 'failed') then coalesce(v_provider_detail, provider_error_detail) else null end,
    payment_in_flight_at = null,
    updated_at = now()
  where id = op.id;
  update public.shipments set submission_state = v_ship_state,
    payment_state = coalesce(v_payment, payment_state),
    awb = case when p_outcome = 'issued' then p_tracking else awb end,
    issued_at = case when p_outcome = 'issued' then coalesce(issued_at, now()) else issued_at end,
    updated_at = now()
  where tenant_id = op.tenant_id and id = op.shipment_id;

  v_detail := case p_outcome
    when 'issued' then 'Resi ' || p_tracking
    when 'unpaid' then 'Order Mengantar dibuat, menunggu pembayaran saldo'
    when 'failed' then 'Mengantar mencatat percobaan sebagai gagal'
    when 'rejected' then case when v_provider_detail is not null then 'Ditolak Mengantar: ' || left(v_provider_detail, 250) else 'Ditolak Mengantar' end
    when 'not_created' then 'Order tidak dibuat di Mengantar'
    else 'Hasil pengiriman ke Mengantar belum diketahui' end;
  perform private.add_event(op.tenant_id, op.shipment_id,
    case p_outcome when 'issued' then 'issued' when 'unknown' then 'outcome_unknown' else p_outcome end, v_detail);
  return jsonb_build_object('state', v_op_state, 'replayed', false,
    'price_mismatch', p_outcome in ('issued', 'unpaid') and private.record_provider_price(op, p_price));
end $$;

-- ============================================================ T-026 batch review & payment recovery

create function private.compute_unpaid_batch(p_tenant uuid, p_shipment uuid, p_lock boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  op public.provider_operations;
  q public.shipment_quotes;
  v_digest_parts text;
  v_digest text;
  v_total bigint;
  v_members jsonb;
begin
  if p_lock then
    select * into s from public.shipments where tenant_id = p_tenant and id = p_shipment for update;
  else
    select * into s from public.shipments where tenant_id = p_tenant and id = p_shipment;
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if s.is_simulated or s.submission_state <> 'awaiting_payment' or s.payment_state <> 'unpaid' then
    raise exception 'batch_not_payable' using errcode = '55000';
  end if;

  if p_lock then
    select * into op from public.provider_operations
      where tenant_id = p_tenant and shipment_id = p_shipment and kind = 'create_order'
      order by created_at desc limit 1 for update;
  else
    select * into op from public.provider_operations
      where tenant_id = p_tenant and shipment_id = p_shipment and kind = 'create_order'
      order by created_at desc limit 1;
  end if;
  if op.id is null or op.is_simulated or op.state <> 'succeeded' or op.provider_batch is null or op.provider_order_id is null then
    raise exception 'batch_not_payable' using errcode = '55000';
  end if;

  select * into q from public.shipment_quotes where tenant_id = p_tenant and id = s.selected_quote_id;
  if q.id is null then
    raise exception 'batch_not_payable' using errcode = '55000';
  end if;
  if lower(q.courier) = 'ninja' then
    raise exception 'courier_discontinued' using errcode = '55000';
  end if;

  if exists (select 1 from public.provider_operations o where o.provider_batch = op.provider_batch and o.tenant_id <> p_tenant) then
    raise exception 'batch_scope_mismatch' using errcode = '55000';
  end if;

  if p_lock then
    perform 1 from public.provider_operations o
      join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
      where o.tenant_id = p_tenant and o.provider_batch = op.provider_batch
      for update of o, sh;
  end if;

  if exists (
    select 1 from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    left join public.shipment_quotes sq on sq.tenant_id = sh.tenant_id and sq.id = sh.selected_quote_id
    where o.tenant_id = p_tenant and o.provider_batch = op.provider_batch
      and (o.is_simulated or o.state <> 'succeeded' or o.provider_order_id is null or sq.courier is distinct from q.courier)
  ) then
    raise exception 'batch_scope_mismatch' using errcode = '55000';
  end if;

  select
    string_agg(m.shipment_id::text || ':' || m.provider_order_id || ':' || m.charge_idr::text, ',' order by m.shipment_id),
    sum(case when m.payment_state = 'unpaid' then m.charge_idr else 0 end),
    jsonb_agg(jsonb_build_object(
      'shipment_id', m.shipment_id,
      'operation_id', m.operation_id,
      'reference', m.reference,
      'provider_order_id', m.provider_order_id,
      'recipient_name', m.recipient_name,
      'customer_charge_idr', m.charge_idr,
      'is_cod', m.is_cod,
      'cod_amount_idr', m.cod_amount_idr,
      'payment_state', m.payment_state,
      'submission_state', m.submission_state
    ) order by m.created_at, m.shipment_id)
  into v_digest_parts, v_total, v_members
  from (
    select sh.id as shipment_id, o.id as operation_id, sh.reference, o.provider_order_id,
      sh.recipient_name, coalesce(sh.customer_charge_idr, sq.customer_charge_idr, sq.normal_tariff_idr, 0) as charge_idr,
      sh.is_cod, sh.cod_amount_idr, sh.payment_state, sh.submission_state, sh.created_at
    from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    left join public.shipment_quotes sq on sq.tenant_id = sh.tenant_id and sq.id = sh.selected_quote_id
    where o.tenant_id = p_tenant and o.provider_batch = op.provider_batch
  ) m;

  if v_digest_parts is null or coalesce(v_total, 0) <= 0 then
    raise exception 'batch_not_payable' using errcode = '55000';
  end if;

  v_digest := encode(extensions.digest(
    p_tenant::text || '|' || op.provider_batch || '|' || q.courier || '|' || v_digest_parts,
    'sha256'
  ), 'hex');

  return jsonb_build_object(
    'operation_id', op.id,
    'claim_operation_id', op.id,
    'shipment_id', s.id,
    'tenant_id', p_tenant,
    'attempt', op.attempts,
    'provider_env', op.provider_env,
    'credential_version', op.credential_version,
    'batch', op.provider_batch,
    'courier', q.courier,
    'batch_digest', v_digest,
    'member_count', jsonb_array_length(coalesce(v_members, '[]'::jsonb)),
    'total_charge_idr', coalesce(v_total, 0),
    'total_customer_charge_idr', coalesce(v_total, 0),
    'members', coalesce(v_members, '[]'::jsonb)
  );
end $$;

create function public.review_unpaid_batch(p_tenant uuid default null, p_shipment uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  v_res jsonb;
begin
  if p_shipment is null and p_tenant is not null then
    v_shipment := p_tenant;
    select tenant_id into v_tenant from public.shipments where id = v_shipment;
  elsif p_tenant is null and p_shipment is not null then
    v_shipment := p_shipment;
    select tenant_id into v_tenant from public.shipments where id = v_shipment;
  else
    v_tenant := p_tenant;
    v_shipment := p_shipment;
  end if;
  if v_tenant is null or v_shipment is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  v_res := private.compute_unpaid_batch(v_tenant, v_shipment, false);
  return jsonb_build_object(
    'batch', v_res->'batch',
    'courier', v_res->'courier',
    'batch_digest', v_res->'batch_digest',
    'member_count', v_res->'member_count',
    'total_charge_idr', v_res->'total_charge_idr',
    'total_customer_charge_idr', v_res->'total_customer_charge_idr',
    'members', v_res->'members'
  );
end $$;

create function public.dispatch_begin_batch_payment(p_tenant uuid default null, p_shipment uuid default null, p_batch_digest text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  t public.tenants;
  v_res jsonb;
  c private.seller_credentials;
  v_cred_version integer;
begin
  if p_tenant is null and p_shipment is not null then
    v_shipment := p_shipment;
    select tenant_id into v_tenant from public.shipments where id = v_shipment;
  else
    v_tenant := p_tenant;
    v_shipment := p_shipment;
  end if;
  if v_tenant is null or v_shipment is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into t from public.tenants where id = v_tenant for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if t.is_demo or t.lifecycle <> 'active' then
    raise exception 'tenant_not_active' using errcode = '55000';
  end if;
  if exists (select 1 from public.provider_operations o where o.tenant_id = v_tenant and not o.is_simulated
      and (o.state = 'in_flight'
        or (o.state = 'unknown' and o.dispatched_at > now() - interval '5 minutes')
        or (o.payment_in_flight_at is not null and o.payment_in_flight_at > now() - interval '2 minutes'))) then
    raise exception 'account_busy' using errcode = '55P03';
  end if;

  v_res := private.compute_unpaid_batch(v_tenant, v_shipment, true);
  if coalesce(p_batch_digest, '') <> (v_res->>'batch_digest') then
    raise exception 'batch_digest_mismatch' using errcode = '55000';
  end if;

  update public.provider_operations
    set payment_in_flight_at = now(), last_checked_at = now(), updated_at = now()
    where tenant_id = v_tenant and provider_batch = (v_res->>'batch') and not is_simulated;

  v_cred_version := (v_res->>'credential_version')::integer;
  select * into c from private.seller_credentials
    where tenant_id = v_tenant and superseded_at is null
      and (v_cred_version is null or version = v_cred_version);

  return v_res || jsonb_build_object(
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version
    ) end
  );
end $$;

create function public.dispatch_release_batch_payment(p_operation uuid default null, p_claim_operation uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  op public.provider_operations;
begin
  op := private.lock_real_operation(coalesce(p_operation, p_claim_operation));
  update public.provider_operations
    set payment_in_flight_at = null, updated_at = now()
    where tenant_id = op.tenant_id
      and (id = op.id or (op.provider_batch is not null and provider_batch = op.provider_batch));
end $$;

create function public.dispatch_record_payment(p_operation uuid, p_order_id text, p_paid boolean,
  p_tracking text default null, p_price bigint default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  op public.provider_operations;
begin
  op := private.lock_real_operation(p_operation);
  if op.state <> 'succeeded' or op.provider_order_id is distinct from p_order_id then
    raise exception 'already_recorded' using errcode = '55000';
  end if;
  if p_paid then
    if p_tracking is null or p_tracking !~ '^[A-Za-z0-9-]{6,40}$' then
      raise exception 'missing_identity' using errcode = '22023';
    end if;
    return public.dispatch_record(p_operation, op.attempts, 'issued', p_order_id, p_tracking, op.provider_batch, null, 'ISSUED', p_price, null);
  end if;
  update public.provider_operations
    set payment_in_flight_at = null, last_checked_at = now(), updated_at = now()
    where id = op.id;
  return jsonb_build_object('state', op.state, 'paid', false, 'replayed', false,
    'price_mismatch', private.record_provider_price(op, p_price));
end $$;

-- ============================================================ grants

revoke all on function private.sync_quote_charge(), private.compute_unpaid_batch(uuid, uuid, boolean)
  from public, anon, authenticated;

revoke all on function public.review_unpaid_batch(uuid, uuid) from public, anon;
grant execute on function public.review_unpaid_batch(uuid, uuid) to authenticated;

revoke all on function
  public.dispatch_record(uuid, integer, text, text, text, text, text, text, bigint, text),
  public.dispatch_begin_batch_payment(uuid, uuid, text),
  public.dispatch_release_batch_payment(uuid, uuid),
  public.dispatch_record_payment(uuid, text, boolean, text, bigint)
  from public, anon, authenticated;

grant execute on function
  public.dispatch_record(uuid, integer, text, text, text, text, text, text, bigint, text),
  public.dispatch_begin_batch_payment(uuid, uuid, text),
  public.dispatch_release_batch_payment(uuid, uuid),
  public.dispatch_record_payment(uuid, text, boolean, text, bigint)
  to service_role;
