-- T-115: provider operation -> shipment -> membership lock order for reconcile_shipment.
-- Latest body: 20261105180000_db_hardening.sql. It locked the shipment (lock_member_shipment), then the
-- memberships, then the create_order operation. close_ambiguous_pickup_reservation (20261029170000) and
-- close_unknown_batch_payment (20261029200000) lock the operation(s) first, then the shipment(s), then the
-- memberships. Two admins working the same unknown operation could therefore wait on each other (40P01).
-- Now reconcile takes the operation row first, then the shipment and memberships, matching the closes.
-- Behaviour, authorization (cheap admin check, member recheck after the shipment lock wait, authoritative
-- membership-locked admin check), refusal codes and writes are unchanged. Forward-only; no data change.
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
  -- 1. The operation first (same order as the admin closes).
  select * into op from public.provider_operations
    where tenant_id = v_tenant and shipment_id = p_shipment and kind = 'create_order' for update;
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
