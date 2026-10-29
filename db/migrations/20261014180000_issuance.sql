-- T-024 (TD-3, DEC-010, PR-5/PR-6): real issuance for connected gerai. confirm_shipment now
-- creates a real queued operation (the Worker dispatches it with the machine identity); a
-- definitely refused attempt can be reopened and confirmed again; the machine finds due work
-- for a periodic sweep; unpaid orders are re-checked. Demo/simulated flows are unchanged.

-- ============================================================ retry only after a definite refusal
-- These results mean nothing was created at Mengantar (a 400/403 refusal, or a local refusal
-- before sending). Every other failure (provider error item, "not created" concluded by
-- reconciliation) may still turn into a real order, so it keeps blocking a second operation.
create function private.definitely_not_created(p_state text, p_code text)
returns boolean language sql immutable set search_path = ''
as $$
  select p_state = 'failed' and p_code in ('PROVIDER_REJECTED', 'NOT_ALLOWED', 'INPUT_INVALID', 'INPUT_INCOMPLETE',
    'PICKUP_NOT_FOUND', 'QUOTE_STALE', 'CLOSED_NOT_CREATED');
$$;
-- The partial unique index below depends on this function: changing the list requires dropping
-- and recreating provider_operations_one_create. The UI mirrors the list in
-- src/app/(workspace)/pengiriman/[id]/page.tsx (REOPENABLE).

drop index public.provider_operations_one_create;
create unique index provider_operations_one_create on public.provider_operations (tenant_id, shipment_id)
  where kind = 'create_order' and not private.definitely_not_created(state, result_code);

-- Throttles sweep re-checks of unknown and unpaid operations; the price Mengantar charged.
alter table public.provider_operations add column last_checked_at timestamptz,
  add column provider_price_idr bigint check (provider_price_idr >= 0);
-- dispatch_due reads only real, non-final operations.
create index provider_operations_due on public.provider_operations (state, last_checked_at)
  where not is_simulated and state in ('queued', 'in_flight', 'unknown', 'succeeded', 'failed');

-- Saved recipient addresses keep the Mengantar area, so repeat recipients need no new search.
alter table public.contact_addresses
  add column area_id text check (area_id ~ '^[a-f0-9]{24}$');
grant insert (area_id), update (area_id) on public.contact_addresses to authenticated;

-- Editing the area text without choosing a Mengantar area again drops the stale area id.
create function private.clear_stale_address_area()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.area is distinct from old.area and new.area_id is not distinct from old.area_id then
    new.area_id := null;
  end if;
  return new;
end $$;
create trigger contact_addresses_clear_area before update on public.contact_addresses
  for each row execute function private.clear_stale_address_area();

-- ============================================================ confirmation
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
    s.width_cm, s.height_cm, s.goods_value_idr, p_quote)::text);

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
    raise exception 'stale_revision' using errcode = '40001';
  end if;
  select * into q from public.shipment_quotes
    where id = p_quote and tenant_id = s.tenant_id and shipment_id = s.id;
  if not found or q.shipment_revision <> s.revision then
    raise exception 'stale_quote' using errcode = '40001';
  end if;
  if q.expires_at <= now() then
    raise exception 'quote_expired' using errcode = '40001';
  end if;
  if s.is_simulated <> q.is_simulated then
    raise exception 'stale_quote' using errcode = '40001';
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
    customer_charge_idr = q.normal_tariff_idr,
    pickup_snapshot = jsonb_build_object('outlet', o.name, 'address', o.pickup_address, 'area', o.pickup_area),
    submitted_at = now(),
    updated_at = now()
  where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'submitted', q.courier || ' ' || q.service);

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

-- ============================================================ reopen after a definite refusal
-- Nothing was created at Mengantar, so the counter may fix the draft and confirm again. The old
-- operation stays as history; a new confirmation creates a new one.
create function public.reopen_shipment(p_shipment uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.shipments;
  op public.provider_operations;
begin
  -- Same lock order as the dispatcher (operation, then shipment), after the membership check.
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
    pickup_snapshot = null, submitted_at = null, updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'reopened', 'Draf dibuka lagi setelah ditolak');
end $$;
revoke all on function public.reopen_shipment(uuid) from public, anon;
grant execute on function public.reopen_shipment(uuid) to authenticated;

-- ============================================================ machine: due work and payment checks
-- Work the sweep should do now, oldest first, real operations only:
--  * queued operations nobody dispatched (a released one waits 10 minutes; claims that would
--    certainly be refused — inactive or demo gerai, no seller key — are left out);
--  * stale in-flight and unknown outcomes, every 10 minutes for 7 days;
--  * "not created" and provider-error conclusions, re-checked hourly for 24 hours (an order that
--    turns up is recorded);
--  * unpaid orders, every 30 minutes for 7 days.
create function public.dispatch_due(p_limit integer default 20)
returns table (operation_id uuid, action text) language sql stable security definer set search_path = ''
as $$
  select id, action from (
    select o.id, 'dispatch' as action, o.updated_at as at from public.provider_operations o
      join public.tenants t on t.id = o.tenant_id
      where not o.is_simulated and o.state = 'queued' and o.updated_at < now() - interval '1 minute'
        and coalesce(o.last_checked_at, '-infinity') < now() - interval '10 minutes'
        and t.lifecycle = 'active' and not t.is_demo
        and exists (select 1 from private.seller_credentials c where c.tenant_id = o.tenant_id and c.superseded_at is null)
    union all
    select o.id, 'reconcile', coalesce(o.last_checked_at, o.dispatched_at) from public.provider_operations o
      where not o.is_simulated and coalesce(o.last_checked_at, '-infinity') < now() - interval '10 minutes'
        and o.dispatched_at > now() - interval '7 days'
        and ((o.state = 'in_flight' and o.dispatched_at < now() - interval '2 minutes') or o.state = 'unknown')
    union all
    select o.id, 'reconcile', coalesce(o.last_checked_at, o.dispatched_at) from public.provider_operations o
      where not o.is_simulated and o.state = 'failed' and o.result_code in ('NOT_CREATED', 'PROVIDER_ERROR_ITEM')
        and coalesce(o.last_checked_at, '-infinity') < now() - interval '60 minutes'
        and o.dispatched_at > now() - interval '24 hours'
    union all
    select o.id, 'payment', coalesce(o.last_checked_at, o.updated_at) from public.provider_operations o
      join public.shipments s on s.tenant_id = o.tenant_id and s.id = o.shipment_id
      where not o.is_simulated and o.state = 'succeeded' and s.payment_state = 'unpaid' and o.provider_order_id is not null
        and coalesce(o.last_checked_at, '-infinity') < now() - interval '30 minutes'
        and o.updated_at > now() - interval '7 days'
  ) due order by at limit least(greatest(p_limit, 1), 50);
$$;

-- An unpaid order's identity for a payment re-check. Marks the check time.
create function public.dispatch_begin_payment_check(p_operation uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  op := private.lock_real_operation(p_operation);
  -- Any succeeded operation whose order is still unpaid (created unpaid, reconciled or corrected).
  if op.state <> 'succeeded' or op.provider_order_id is null or not exists (select 1 from public.shipments s
      where s.tenant_id = op.tenant_id and s.id = op.shipment_id and s.payment_state = 'unpaid') then
    raise exception 'nothing_to_check' using errcode = '55000';
  end if;
  update public.provider_operations set last_checked_at = now() where id = op.id returning * into op;
  return private.dispatch_payload(op) || jsonb_build_object('provider_order_id', op.provider_order_id, 'provider_batch', op.provider_batch);
end $$;

-- Releasing a claimed operation (nothing sent) marks the time, for sweep throttling.
create or replace function public.dispatch_release(p_operation uuid, p_attempt integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  op := private.lock_real_operation(p_operation);
  if op.state <> 'in_flight' or op.attempts <> p_attempt then
    raise exception 'stale_attempt' using errcode = '40001';
  end if;
  update public.provider_operations set state = 'queued', result_code = 'RELEASED', dispatched_at = null,
    last_checked_at = now(), updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'queued', updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
end $$;

-- Reconciliation marks its check time too (sweep throttling).
create or replace function public.dispatch_begin_reconcile(p_operation uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  op := private.lock_real_operation(p_operation);
  if op.state = 'in_flight' and op.dispatched_at < now() - interval '2 minutes' then
    update public.provider_operations set state = 'unknown', result_code = 'STALE_IN_FLIGHT', updated_at = now()
      where id = op.id returning * into op;
    update public.shipments set submission_state = 'unknown', updated_at = now()
      where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'outcome_unknown', 'Hasil pengiriman ke Mengantar belum diketahui');
  end if;
  -- A "not created" conclusion can be checked again: an order that appears later is recorded.
  if op.state <> 'unknown' and not (op.state = 'failed' and op.result_code in ('NOT_CREATED', 'PROVIDER_ERROR_ITEM')) then
    raise exception 'nothing_to_reconcile' using errcode = '55000';
  end if;
  update public.provider_operations set last_checked_at = now() where id = op.id returning * into op;
  return private.dispatch_payload(op);
end $$;

revoke all on function public.dispatch_due(integer), public.dispatch_begin_payment_check(uuid)
  from public, anon, authenticated;
grant execute on function public.dispatch_due(integer), public.dispatch_begin_payment_check(uuid) to service_role;

-- ============================================================ review and audit follow-ups
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
  -- Serializes claims per seller; held only for this short transaction.
  select * into t from public.tenants where id = op.tenant_id for update;
  if t.is_demo or t.lifecycle <> 'active' then
    raise exception 'tenant_not_active' using errcode = '55000';
  end if;
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  if s.submission_state <> 'queued' or s.is_simulated or not exists (
    select 1 from public.shipment_quotes q where q.tenant_id = s.tenant_id and q.id = s.selected_quote_id
      and q.shipment_revision = s.revision and not q.is_simulated) then
    raise exception 'shipment_not_ready' using errcode = '55000';
  end if;
  if exists (select 1 from public.provider_operations o where o.tenant_id = op.tenant_id and not o.is_simulated
      and (o.state = 'in_flight' or (o.state = 'unknown' and o.dispatched_at > now() - interval '5 minutes'))) then
    raise exception 'account_busy' using errcode = '55P03';
  end if;
  select version into v_version from private.seller_credentials
    where tenant_id = op.tenant_id and superseded_at is null;
  if v_version is null then
    raise exception 'credential_missing' using errcode = '55000';
  end if;
  -- An operation that waited hours would be sent at a price the customer never saw: nothing is
  -- sent, the shipment fails as reopenable, and the counter quotes again.
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


-- The price Mengantar charges for the order, stored on the operation; a difference from the
-- customer charge becomes a shipment event, once per price (an unpaid order reports its price
-- again when paid). Returns whether they differ, or null when the price was not readable.
create function private.record_provider_price(op public.provider_operations, p_price bigint)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_charge bigint;
begin
  if p_price is null or p_price < 0 then return null; end if;
  if p_price is not distinct from op.provider_price_idr then return false; end if;
  update public.provider_operations set provider_price_idr = p_price where id = op.id;
  select customer_charge_idr into v_charge from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  if p_price is distinct from v_charge then
    perform private.add_event(op.tenant_id, op.shipment_id, 'price_mismatch',
      'Mengantar menagih Rp' || p_price || ', ongkir pelanggan Rp' || coalesce(v_charge::text, '-'));
    return true;
  end if;
  return false;
end $$;
revoke all on function private.record_provider_price(public.provider_operations, bigint) from public, anon, authenticated;

-- dispatch_record gains the charged price (p_price) and payment upgrades keyed on the shipment's
-- payment state; the previous 8-argument version is replaced. The result says whether the
-- charged price differed from the customer charge (`price_mismatch`).
drop function public.dispatch_record(uuid, integer, text, text, text, text, text, text);
create function public.dispatch_record(p_operation uuid, p_attempt integer, p_outcome text,
  p_order_id text default null, p_tracking text default null, p_batch text default null,
  p_record_id text default null, p_code text default null, p_price bigint default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  v_op_state text;
  v_ship_state text;
  v_payment text;
  v_detail text;
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
    update public.provider_operations set result_code = 'ISSUED', updated_at = now() where id = op.id;
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
      provider_order_id = p_order_id, provider_batch = p_batch, updated_at = now() where id = op.id;
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
    -- Replaying the same final result is harmless; anything else is a conflict.
    if (op.state = 'succeeded' and p_outcome in ('issued', 'unpaid') and op.provider_order_id = p_order_id)
       or (op.state = 'failed' and p_outcome in ('failed', 'rejected', 'not_created')) then
      return jsonb_build_object('state', op.state, 'replayed', true);
    end if;
    raise exception 'already_recorded' using errcode = '55000';
  end if;
  if op.state = 'in_flight' then
    if op.attempts <> p_attempt then
      raise exception 'stale_attempt' using errcode = '40001';
    end if;
    if p_outcome = 'not_created' then
      raise exception 'invalid_outcome' using errcode = '22023';
    end if;
  elsif op.state = 'unknown' then
    if p_outcome = 'unknown' then
      -- Still unknown; keep a more specific reason (e.g. DUPLICATE_ORDERS) when one is given.
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
    when 'rejected' then 'Ditolak Mengantar'
    when 'not_created' then 'Order tidak dibuat di Mengantar'
    else 'Hasil pengiriman ke Mengantar belum diketahui' end;
  perform private.add_event(op.tenant_id, op.shipment_id,
    case p_outcome when 'issued' then 'issued' when 'unknown' then 'outcome_unknown' else p_outcome end, v_detail);
  return jsonb_build_object('state', v_op_state, 'replayed', false,
    'price_mismatch', p_outcome in ('issued', 'unpaid') and private.record_provider_price(op, p_price));
end $$;

revoke all on function public.dispatch_record(uuid, integer, text, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.dispatch_record(uuid, integer, text, text, text, text, text, text, bigint) to service_role;

-- A tenant admin closes a failure that reconciliation could not resolve, attesting (with a
-- reason, audited) that no Mengantar order exists, after checking the Mengantar app. Only after
-- the attempt is old enough and was re-checked at least once; the shipment can then be reopened.
-- A later truthful result for a closed operation is refused (already_recorded), by design.
create function public.close_failed_operation(p_shipment uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  op public.provider_operations;
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  perform private.require_reason(p_reason);
  select * into op from public.provider_operations
    where tenant_id = v_tenant and shipment_id = p_shipment and kind = 'create_order'
    order by created_at desc limit 1 for update;
  perform 1 from public.shipments where tenant_id = v_tenant and id = p_shipment for update;
  if op.id is null or op.is_simulated or op.state <> 'failed' or op.result_code not in ('NOT_CREATED', 'PROVIDER_ERROR_ITEM')
     or op.last_checked_at is null or op.dispatched_at > now() - interval '30 minutes' then
    raise exception 'not_closable' using errcode = '55000';
  end if;
  update public.provider_operations set result_code = 'CLOSED_NOT_CREATED', updated_at = now() where id = op.id;
  perform private.add_event(v_tenant, p_shipment, 'closed', 'Ditutup admin: tidak ada pesanan di Mengantar');
  perform private.audit('shipment.close_failed', v_tenant, null, p_reason, 'closed',
    jsonb_build_object('shipment', p_shipment, 'operation', op.id, 'previous', op.result_code));
end $$;
revoke all on function public.close_failed_operation(uuid, text) from public, anon;
grant execute on function public.close_failed_operation(uuid, text) to authenticated;

-- Real shipments print the Mengantar label (from the Mengantar app until label generation is
-- whitelisted); the sample label is for simulated shipments only.
create or replace function public.request_label(p_shipment uuid)
returns public.label_jobs language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  j public.label_jobs;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state <> 'issued' or s.awb is null then
    raise exception 'no_awb' using errcode = '55000';
  end if;
  if not s.is_simulated then
    raise exception 'provider_label_required' using errcode = '55000';
  end if;
  select * into j from public.label_jobs
    where tenant_id = s.tenant_id and shipment_id = s.id and state = 'completed'
    order by created_at desc limit 1;
  if found then return j; end if;
  insert into public.label_jobs (tenant_id, shipment_id, state, is_simulated, requested_by)
  values (s.tenant_id, s.id, 'completed', true, (select auth.uid()))
  returning * into j;
  perform private.add_event(s.tenant_id, s.id, 'label_ready', 'Label contoh (bukan label kurir)');
  return j;
end $$;

-- Operations the sweep no longer checks (unknown or stale for over 7 days, "not created" or
-- provider-error failures past 24 hours, unpaid for over 7 days) or cannot send (queued for over
-- 6 hours: the gerai lost its key or is no longer active): counts for the cron log, so they are
-- visible to monitoring and not only on each shipment page.
create function public.dispatch_stuck_counts()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'unknown', (select count(*) from public.provider_operations o where not o.is_simulated
      and o.state in ('unknown', 'in_flight') and o.dispatched_at <= now() - interval '7 days'),
    'failed_unresolved', (select count(*) from public.provider_operations o where not o.is_simulated
      and o.state = 'failed' and o.result_code in ('NOT_CREATED', 'PROVIDER_ERROR_ITEM') and o.dispatched_at <= now() - interval '24 hours'),
    'unpaid', (select count(*) from public.provider_operations o join public.shipments s on s.tenant_id = o.tenant_id and s.id = o.shipment_id
      where not o.is_simulated and o.state = 'succeeded' and s.payment_state = 'unpaid' and o.updated_at <= now() - interval '7 days'),
    'queued', (select count(*) from public.provider_operations o where not o.is_simulated
      and o.state = 'queued' and o.created_at <= now() - interval '6 hours'));
$$;
revoke all on function public.dispatch_stuck_counts() from public, anon, authenticated;
grant execute on function public.dispatch_stuck_counts() to service_role;

