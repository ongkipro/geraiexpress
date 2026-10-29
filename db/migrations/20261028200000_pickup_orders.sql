-- T-043 / PR-5, TD-3, TD-12, UX-10 (CTX-39 launch scope): per-shipment drop-off or pickup, frozen at
-- confirmation, with a durable provider time reservation before the order is created.
--
-- A reservation (POST /time) and the order (POST /order) are DIFFERENT provider commands. The
-- operation row records a write-ahead phase before each: 'reserving' before POST /time, 'reserved'
-- once its answer is stored, 'creating' before POST /order. A reservation or create answer that is
-- lost is only ever reconciled (a read-back), never sent again; the phase is the proof of what may
-- already have reached Mengantar. Contract evidence is documentation only (operations contract
-- section 2): the response shapes and the time id's lifetime are unverified until a supervised
-- sandbox capture (T-048).

-- ============================================================ draft: handover choice
-- Draft content like the recipient fields: editable only while draft/estimated, a change drops the
-- current quote (private.guard_shipment), copied into pickup_snapshot at confirmation.
alter table public.shipments
  add column handover text not null default 'dropoff' check (handover in ('dropoff', 'pickup')),
  add column pickup_date date,
  -- Start hour, WIB. The documentation lists POST /time `time` values 9:00 to 18:00.
  add column pickup_slot_hour smallint check (pickup_slot_hour between 9 and 18),
  add column pickup_volume text check (pickup_volume in ('volumeMotor', 'volumeMobil', 'volumeTruck')),
  -- Local note for the counter; the Create Order documentation has no field for it, so it is never sent.
  add column pickup_note text check (char_length(pickup_note) <= 200),
  add constraint shipments_handover_shape check (
    (handover = 'dropoff' and pickup_date is null and pickup_slot_hour is null
      and pickup_volume is null and pickup_note is null)
    or (handover = 'pickup' and pickup_date is not null and pickup_slot_hour is not null
      and pickup_volume is not null));

grant update (handover, pickup_date, pickup_slot_hour, pickup_volume, pickup_note) on public.shipments to authenticated;

-- A slot is reservable only when it starts at least 90 minutes from now (documented: "invalid pickup
-- time" below that). WIB is assumed for the date, the hour and the clock (the documentation names no
-- time zone: Unknown). The Worker re-checks with its own clock before it calls the provider.
create function private.pickup_slot_ok(p_date date, p_hour integer)
returns boolean language sql stable set search_path = ''
as $$
  select p_date is not null and p_hour between 9 and 18
    and ((p_date + make_interval(hours => p_hour)) at time zone 'Asia/Jakarta') >= now() + interval '90 minutes';
$$;
revoke all on function private.pickup_slot_ok(date, integer) from public, anon, authenticated;

create or replace function private.guard_shipment()
-- SECURITY DEFINER: the trigger runs for the signed-in member, who may not execute the private
-- clock check it calls; it reads only NEW and OLD and touches no table.
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  content_changed boolean :=
    (new.sender_contact_id, new.sender_name, new.sender_phone, new.recipient_contact_id,
     new.recipient_name, new.recipient_phone, new.recipient_address, new.recipient_area,
     new.recipient_area_id, new.recipient_postal_code, new.item_description, new.weight_grams,
     new.length_cm, new.width_cm, new.height_cm, new.goods_value_idr, new.is_cod,
     new.handover, new.pickup_date, new.pickup_slot_hour, new.pickup_volume, new.pickup_note)
    is distinct from
    (old.sender_contact_id, old.sender_name, old.sender_phone, old.recipient_contact_id,
     old.recipient_name, old.recipient_phone, old.recipient_address, old.recipient_area,
     old.recipient_area_id, old.recipient_postal_code, old.item_description, old.weight_grams,
     old.length_cm, old.width_cm, old.height_cm, old.goods_value_idr, old.is_cod,
     old.handover, old.pickup_date, old.pickup_slot_hour, old.pickup_volume, old.pickup_note);
  pickup_changed boolean :=
    (new.handover, new.pickup_date, new.pickup_slot_hour) is distinct from
    (old.handover, old.pickup_date, old.pickup_slot_hour);
begin
  if new.tenant_id <> old.tenant_id or new.outlet_id <> old.outlet_id or new.reference <> old.reference then
    raise exception 'ownership_immutable' using errcode = '42501';
  end if;
  if content_changed then
    if old.submission_state not in ('draft', 'estimated') then
      raise exception 'shipment_locked' using errcode = '42501';
    end if;
    if pickup_changed and new.handover = 'pickup' and not private.pickup_slot_ok(new.pickup_date, new.pickup_slot_hour) then
      raise exception 'pickup_time_invalid' using errcode = '22023';
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

-- ============================================================ operation: reservation phase
alter table public.provider_operations
  add column pickup_phase text check (pickup_phase in ('reserving', 'reserved', 'creating')),
  add column pickup_time_id text check (pickup_time_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  add column pickup_reserved_at timestamptz,
  add constraint provider_operations_pickup_phase_shape
    check (coalesce(pickup_phase in ('reserved', 'creating'), false) = (pickup_time_id is not null));

-- A pickup refused before anything was reserved or created is a definite refusal like the others:
-- the draft can be reopened. (CREATE OR REPLACE keeps provider_operations_one_create bound to this
-- function; no existing row carries the two new codes.)
create or replace function private.definitely_not_created(p_state text, p_code text)
returns boolean language sql immutable set search_path = ''
as $$
  select p_state = 'failed' and p_code in ('PROVIDER_REJECTED', 'NOT_ALLOWED', 'INPUT_INVALID', 'INPUT_INCOMPLETE',
    'PICKUP_NOT_FOUND', 'QUOTE_STALE', 'CLOSED_NOT_CREATED', 'PICKUP_TIME_INVALID', 'PICKUP_SLOT_UNAVAILABLE');
$$;

-- ============================================================ confirmation freezes the handover
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
    if not q.cod_supported then raise exception 'cod_not_supported' using errcode = '22023'; end if;
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

-- ============================================================ dispatch payload: the frozen handover
-- Reads the frozen snapshot, never the live draft: a draft edited after confirmation cannot change
-- what is dispatched. A snapshot without `handover` (confirmed before this migration) is drop-off.
create or replace function private.dispatch_payload(op public.provider_operations)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s public.shipments; q public.shipment_quotes; c private.seller_credentials;
begin
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;
  select * into c from private.seller_credentials
    where tenant_id = s.tenant_id and superseded_at is null and version = op.credential_version;
  return jsonb_build_object(
    'operation_id', op.id, 'tenant_id', op.tenant_id, 'attempt', op.attempts,
    'operation_state', op.state,
    'provider_env', op.provider_env, 'dispatched_at', op.dispatched_at,
    'reference', s.reference, 'courier', q.courier,
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
    'weight_grams', s.weight_grams, 'item_description', s.item_description, 'goods_value_idr', s.goods_value_idr,
    'is_cod', s.is_cod, 'cod_amount_idr', s.cod_amount_idr,
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;
revoke all on function private.dispatch_payload(public.provider_operations) from public, anon, authenticated;

-- ============================================================ machine commands: reservation fences
-- Releasing a claim is for an attempt that sent nothing. Once the reservation was started or the
-- create began, the provider may have acted: the claim is never given back to the queue (it can only
-- be reconciled). A recorded reservation ('reserved') sent no order, so it may be released with it.
create or replace function public.dispatch_release(p_operation uuid, p_attempt integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  op := private.lock_real_operation(p_operation);
  if op.state <> 'in_flight' or op.attempts <> p_attempt then
    raise exception 'stale_attempt' using errcode = '55000';
  end if;
  if op.pickup_phase in ('reserving', 'creating') then
    raise exception 'provider_call_started' using errcode = '55000';
  end if;
  update public.provider_operations set state = 'queued', result_code = 'RELEASED', dispatched_at = null,
    last_checked_at = now(), updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'queued', updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
end $$;

-- Write-ahead for POST /time. Refused unless this exact attempt is in flight for a pickup shipment
-- that has no reservation phase yet, so a second reservation request cannot be recorded as allowed.
create function public.dispatch_pickup_begin_reservation(p_operation uuid, p_attempt integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations; v_handover text;
begin
  op := private.lock_real_operation(p_operation);
  if op.state <> 'in_flight' or op.attempts <> p_attempt then
    raise exception 'stale_attempt' using errcode = '55000';
  end if;
  select coalesce(s.pickup_snapshot->>'handover', 'dropoff') into v_handover
    from public.shipments s where s.tenant_id = op.tenant_id and s.id = op.shipment_id;
  if v_handover is distinct from 'pickup' then
    raise exception 'not_pickup' using errcode = '55000';
  end if;
  if op.pickup_phase is not null then
    raise exception 'reservation_already_started' using errcode = '55000';
  end if;
  update public.provider_operations set pickup_phase = 'reserving', updated_at = now() where id = op.id;
  perform private.add_event(op.tenant_id, op.shipment_id, 'pickup_reserving', 'Memesan slot jemput di Mengantar');
end $$;

-- The answer to POST /time: stores the provider's time id. Repeating the same id is a no-op.
create function public.dispatch_pickup_record_reservation(p_operation uuid, p_attempt integer, p_time_id text)
returns void language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  if p_time_id is null or p_time_id !~ '^[A-Za-z0-9_-]{6,64}$' then
    raise exception 'invalid_time_id' using errcode = '22023';
  end if;
  op := private.lock_real_operation(p_operation);
  if op.state <> 'in_flight' or op.attempts <> p_attempt then
    raise exception 'stale_attempt' using errcode = '55000';
  end if;
  if op.pickup_phase = 'reserved' and op.pickup_time_id = p_time_id then return; end if;
  if op.pickup_phase is distinct from 'reserving' then
    raise exception 'reservation_not_started' using errcode = '55000';
  end if;
  update public.provider_operations set pickup_phase = 'reserved', pickup_time_id = p_time_id,
    pickup_reserved_at = now(), updated_at = now() where id = op.id;
  perform private.add_event(op.tenant_id, op.shipment_id, 'pickup_reserved', 'Slot jemput dipesan di Mengantar; pesanan menyusul');
end $$;

-- Write-ahead for POST /order of a pickup shipment: allowed once, only from a recorded reservation.
create function public.dispatch_pickup_begin_create(p_operation uuid, p_attempt integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  op := private.lock_real_operation(p_operation);
  if op.state <> 'in_flight' or op.attempts <> p_attempt then
    raise exception 'stale_attempt' using errcode = '55000';
  end if;
  if op.pickup_phase = 'creating' then
    raise exception 'create_already_started' using errcode = '55000';
  end if;
  if op.pickup_phase is distinct from 'reserved' then
    raise exception 'reservation_required' using errcode = '55000';
  end if;
  update public.provider_operations set pickup_phase = 'creating', updated_at = now() where id = op.id;
end $$;

-- An unknown operation whose reservation is established but whose create never began goes back to
-- the queue, keeping the time id. With phase 'reserved' the stored id is used; with 'reserving' the
-- id read back from GET /time is required. Never from 'creating' (the order may exist) and never
-- from a final state: a create request has not been sent, so the next claim sends it for the first time.
create function public.dispatch_pickup_requeue(p_operation uuid, p_attempt integer, p_time_id text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations; v_id text;
begin
  op := private.lock_real_operation(p_operation);
  if op.state <> 'unknown' or op.attempts <> p_attempt or op.pickup_phase is null or op.pickup_phase = 'creating' then
    raise exception 'stale_attempt' using errcode = '55000';
  end if;
  v_id := case op.pickup_phase when 'reserved' then op.pickup_time_id else p_time_id end;
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{6,64}$' then
    raise exception 'invalid_time_id' using errcode = '22023';
  end if;
  update public.provider_operations set state = 'queued', result_code = 'PICKUP_RESERVED', pickup_phase = 'reserved',
    pickup_time_id = v_id, pickup_reserved_at = coalesce(pickup_reserved_at, now()),
    dispatched_at = null, last_checked_at = null, updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'queued', updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
  perform private.add_event(op.tenant_id, op.shipment_id, 'pickup_reserved', 'Slot jemput terkonfirmasi; pesanan akan dikirim');
end $$;

revoke all on function
  public.dispatch_release(uuid, integer),
  public.dispatch_pickup_begin_reservation(uuid, integer),
  public.dispatch_pickup_record_reservation(uuid, integer, text),
  public.dispatch_pickup_begin_create(uuid, integer),
  public.dispatch_pickup_requeue(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function
  public.dispatch_release(uuid, integer),
  public.dispatch_pickup_begin_reservation(uuid, integer),
  public.dispatch_pickup_record_reservation(uuid, integer, text),
  public.dispatch_pickup_begin_create(uuid, integer),
  public.dispatch_pickup_requeue(uuid, integer, text)
  to service_role;
