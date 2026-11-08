-- Pickup/reconcile audit fixes (forward only; no earlier migration is edited).
--
-- F1: one Mengantar pickup time id could be adopted by two shipments. dispatch_pickup_known_time_ids is a
-- separate unlocked read, and neither dispatch_pickup_record_reservation nor dispatch_pickup_requeue rechecked
-- ownership, so two reconciliations reading the same single /time row both stored it. Ownership is now enforced
-- by the database: a time id is held by at most one operation per tenant and provider environment (open or
-- closed, like dispatch_pickup_known_time_ids). The partial unique index is the atomic guard; the two commands
-- turn its violation into 'time_id_held' (errcode 55000) before any write, so the losing operation stays exactly
-- as it was (in flight/reserving or unknown/reserving) and the shipment is untouched. If existing rows already
-- share an id this migration fails and nothing is applied; resolve those operations first.
create unique index provider_operations_pickup_time_id_owner
  on public.provider_operations (tenant_id, (coalesce(provider_env, '')), pickup_time_id)
  where pickup_time_id is not null;

create or replace function public.dispatch_pickup_record_reservation(p_operation uuid, p_attempt integer, p_time_id text)
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
  begin
    update public.provider_operations set pickup_phase = 'reserved', pickup_time_id = p_time_id,
      pickup_reserved_at = now(), updated_at = now() where id = op.id;
  exception when unique_violation then
    raise exception 'time_id_held' using errcode = '55000';
  end;
  perform private.add_event(op.tenant_id, op.shipment_id, 'pickup_reserved', 'Slot jemput dipesan di Mengantar; pesanan menyusul');
end $$;

-- F2 recovery: a reservation read-back that concluded "not created" (failed/NOT_CREATED, phase 'reserving')
-- is only a "not seen yet" conclusion (reconciliation may check it again, see dispatch_begin_reconcile). When a
-- later complete GET /time read shows the reservation, the operation may be requeued like an unknown one: the
-- create never began (phase 'reserving'), no POST /time is ever repeated, and the id is the one read back.
-- A closed one (CLOSED_NOT_CREATED, an admin decision) and every other failure stay refused.
create or replace function public.dispatch_pickup_requeue(p_operation uuid, p_attempt integer, p_time_id text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations; v_id text;
begin
  op := private.lock_real_operation(p_operation);
  if op.attempts <> p_attempt or op.pickup_phase is null or op.pickup_phase = 'creating'
     or not (op.state = 'unknown'
       or (op.state = 'failed' and op.result_code = 'NOT_CREATED' and op.pickup_phase = 'reserving')) then
    raise exception 'stale_attempt' using errcode = '55000';
  end if;
  v_id := case op.pickup_phase when 'reserved' then op.pickup_time_id else p_time_id end;
  if v_id is null or v_id !~ '^[A-Za-z0-9_-]{6,64}$' then
    raise exception 'invalid_time_id' using errcode = '22023';
  end if;
  begin
    update public.provider_operations set state = 'queued', result_code = 'PICKUP_RESERVED', pickup_phase = 'reserved',
      pickup_time_id = v_id, pickup_reserved_at = coalesce(pickup_reserved_at, now()),
      dispatched_at = null, last_checked_at = null, updated_at = now() where id = op.id;
  exception when unique_violation then
    raise exception 'time_id_held' using errcode = '55000';
  end;
  update public.shipments set submission_state = 'queued', updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
  perform private.add_event(op.tenant_id, op.shipment_id, 'pickup_reserved', 'Slot jemput terkonfirmasi; pesanan akan dikirim');
end $$;

-- F4: reconcile_shipment looked up the shipment's create operation without an order, so with a historical
-- (definitely-not-created) attempt next to a newer one the plan decided which row was reconciled. It now takes
-- the latest operation (created_at, then id) and still locks operation -> shipment -> memberships (T-115).
-- Everything else is the 20261106110000 body unchanged.
create or replace function public.reconcile_shipment(p_shipment uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.shipments;
  op public.provider_operations;
  v_awb text;
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  -- 1. The latest operation first (same order as the admin closes).
  select * into op from public.provider_operations
    where tenant_id = v_tenant and shipment_id = p_shipment and kind = 'create_order'
    order by created_at desc, id desc limit 1 for update;
  -- 2. The shipment (member recheck after the lock wait), 3. the memberships, then the authoritative check.
  s := private.lock_member_shipment(p_shipment);
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if op.id is null or op.state not in ('unknown', 'in_flight', 'queued') then
    raise exception 'nothing_to_reconcile' using errcode = '55000';
  end if;
  if not op.is_simulated then
    raise exception 'provider_not_connected' using errcode = '55000';
  end if;
  v_awb := coalesce(s.awb, 'SIM' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')
    || lpad((floor(random() * 1000000))::int::text, 6, '0'));
  update public.provider_operations set state = 'succeeded', attempts = attempts + 1,
    result_code = 'SIMULATED_RECONCILED', updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = v_awb,
    issued_at = coalesce(issued_at, now()), updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'reconciled', 'Operasi asli ditemukan: ' || v_awb);
  return jsonb_build_object('operation_id', op.id, 'awb', v_awb);
end $$;

notify pgrst, 'reload schema';
