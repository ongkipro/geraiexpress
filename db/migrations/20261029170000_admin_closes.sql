-- T-056: audited tenant-admin closes for two outcomes the dispatcher can never resolve on its own.
-- Neither command sends a provider request; both are for after the admin checked the Mengantar app.
--
-- 1. close_unknown_batch_payment: a batch payment attempt that stays 'unknown' (or a 'sent' attempt
--    older than 30 minutes) becomes 'closed'. That frees the batch for a new authorization; the
--    per-order payment reads stored at close time are kept in the audit event. A later per-order
--    payment check still records a paid order independently.
-- 2. close_ambiguous_pickup_reservation: a pickup operation still in phase 'reserving' (the POST /time
--    answer was lost and the read-back could not tie one record to it) with no order ever attempted
--    becomes failed / CLOSED_NOT_CREATED, so the shipment can be reopened. The read-back evidence
--    (last check, result code, attempts) is kept in the audit event.
--
-- Lock order, as the machine claim: member operations -> member shipments (id order) -> the admin's
-- membership (share) -> the attempt. Concurrent transitions are serialized by these row locks and
-- re-checked under them.

alter table private.batch_payment_attempts drop constraint batch_payment_attempts_state_check;
alter table private.batch_payment_attempts add constraint batch_payment_attempts_state_check
  check (state in ('claimed', 'sent', 'unknown', 'paid', 'rejected', 'released', 'closed'));
alter table private.batch_payment_attempts
  add column closed_by uuid,
  add column close_reason text,
  add constraint batch_payment_attempts_closed_shape check ((state = 'closed') = (closed_by is not null and close_reason is not null));

create function public.close_unknown_batch_payment(p_shipment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_reason text;
  v_batch text;
  a private.batch_payment_attempts;
  v_members jsonb;
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  select o.provider_batch into v_batch from public.provider_operations o
    where o.tenant_id = v_tenant and o.shipment_id = p_shipment and o.kind = 'create_order' and not o.is_simulated
    order by o.created_at desc limit 1;
  if v_batch is null then raise exception 'not_closable' using errcode = '55000'; end if;

  perform 1 from public.provider_operations o
    where o.tenant_id = v_tenant and o.provider_batch = v_batch order by o.id for update;
  perform 1 from public.shipments sh
    where sh.tenant_id = v_tenant
      and sh.id in (select o.shipment_id from public.provider_operations o where o.tenant_id = v_tenant and o.provider_batch = v_batch)
    order by sh.id for update;
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select * into a from private.batch_payment_attempts
    where tenant_id = v_tenant and batch_code = v_batch and state in ('claimed', 'sent', 'unknown')
    for update;
  if not found then
    -- A replayed close (the attempt is already closed and nothing new is open) changes nothing.
    if exists (select 1 from private.batch_payment_attempts x where x.tenant_id = v_tenant and x.batch_code = v_batch
        and x.state = 'closed') then
      return jsonb_build_object('closed', false, 'reason', 'already_closed', 'batch', v_batch);
    end if;
    raise exception 'not_closable' using errcode = '55000';
  end if;
  -- A claim nothing was sent for is the dispatcher's to release; a fresh 'sent' may still be answered.
  if a.state = 'claimed' or (a.state = 'sent' and a.sent_at > now() - interval '30 minutes') then
    raise exception 'not_closable' using errcode = '55000';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'shipment_id', o.shipment_id, 'reference', sh.reference, 'provider_order_id', o.provider_order_id,
      'payment_state', sh.payment_state, 'submission_state', sh.submission_state, 'last_checked_at', o.last_checked_at)
      order by o.id), '[]'::jsonb)
    into v_members
    from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    where o.tenant_id = v_tenant and o.provider_batch = v_batch and not o.is_simulated;

  update private.batch_payment_attempts set state = 'closed', closed_by = (select auth.uid()), close_reason = v_reason,
    resolved_at = now(), updated_at = now() where id = a.id;
  perform private.add_event(v_tenant, p_shipment, 'payment_closed',
    'Ditutup admin: pembayaran batch diperiksa di aplikasi Mengantar');
  perform private.audit('shipment.batch_pay', v_tenant, null, v_reason, 'closed_by_admin',
    jsonb_build_object('attempt', a.id, 'previous', a.state, 'batch', v_batch, 'shipment', p_shipment,
      'sent_at', a.sent_at, 'members', v_members));
  return jsonb_build_object('closed', true, 'attempt_id', a.id, 'previous', a.state, 'batch', v_batch, 'members', v_members);
end $$;

create function public.close_ambiguous_pickup_reservation(p_shipment uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_reason text;
  op public.provider_operations;
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);
  select * into op from public.provider_operations
    where tenant_id = v_tenant and shipment_id = p_shipment and kind = 'create_order'
    order by created_at desc limit 1 for update;
  perform 1 from public.shipments where tenant_id = v_tenant and id = p_shipment for update;
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if op.id is not null and op.state = 'failed' and op.result_code = 'CLOSED_NOT_CREATED' and op.pickup_phase = 'reserving' then
    return jsonb_build_object('closed', false, 'reason', 'already_closed', 'operation', op.id);
  end if;
  -- Only a reservation whose answer was lost and that was read back at least once; no order may have
  -- been started ('creating' can mean an order exists), and the operation must have rested 30 minutes.
  if op.id is null or op.is_simulated or op.state <> 'unknown' or op.pickup_phase is distinct from 'reserving'
     or op.last_checked_at is null or op.dispatched_at > now() - interval '30 minutes' then
    raise exception 'not_closable' using errcode = '55000';
  end if;
  update public.provider_operations set state = 'failed', result_code = 'CLOSED_NOT_CREATED', updated_at = now()
    where id = op.id;
  update public.shipments set submission_state = 'failed', updated_at = now() where tenant_id = v_tenant and id = p_shipment;
  perform private.add_event(v_tenant, p_shipment, 'closed',
    'Ditutup admin: slot jemput diperiksa di aplikasi Mengantar, tidak ada pesanan yang dibuat');
  perform private.audit('shipment.close_reservation', v_tenant, null, v_reason, 'closed',
    jsonb_build_object('shipment', p_shipment, 'operation', op.id, 'previous', op.result_code, 'attempts', op.attempts,
      'dispatched_at', op.dispatched_at, 'last_checked_at', op.last_checked_at, 'provider_env', op.provider_env));
  return jsonb_build_object('closed', true, 'operation', op.id, 'previous', op.result_code);
end $$;

revoke all on function public.close_unknown_batch_payment(uuid, text), public.close_ambiguous_pickup_reservation(uuid, text)
  from public, anon;
grant execute on function public.close_unknown_batch_payment(uuid, text), public.close_ambiguous_pickup_reservation(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
