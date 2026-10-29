-- Third independent review of 20261029180000 (forward-only).
-- M1: an 'unknown' batch payment attempt was closable at once. The dispatcher turns 'sent' into
--     'unknown' within the same request on a timeout or 5xx, while the pay-unpaid request may still be
--     applied at Mengantar; closing and re-authorizing seconds later could pay the batch twice (DEC-010).
--     Every open attempt now waits 30 minutes from sent_at (or its last update when nothing was sent).
-- L1: dispatch_claim refuses another environment for an operation holding a reserved pickup slot:
--     a time id reserved in one environment is never sent under the other environment's key.

create or replace function public.close_unknown_batch_payment(p_shipment uuid, p_attempt uuid, p_reason text)
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
  -- A replayed close of the reviewed attempt changes nothing.
  if exists (select 1 from private.batch_payment_attempts x where x.id = p_attempt and x.tenant_id = v_tenant
      and x.batch_code = v_batch and x.state = 'closed') then
    return jsonb_build_object('closed', false, 'reason', 'already_closed', 'attempt_id', p_attempt, 'batch', v_batch);
  end if;
  if not found then raise exception 'not_closable' using errcode = '55000'; end if;
  -- Only the attempt the admin reviewed: a newer attempt nobody checked is never closed by an old form.
  if p_attempt is distinct from a.id then raise exception 'stale_attempt' using errcode = '55000'; end if;
  -- A claim nothing was sent for is the dispatcher's to release; a recent 'sent' or 'unknown' may still
  -- be applied at Mengantar, so it waits 30 minutes from the send (review M1).
  if a.state = 'claimed' or coalesce(a.sent_at, a.updated_at) > now() - interval '30 minutes' then
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
  -- Only a reserved pickup slot is bound to the environment it was reserved in; a plain released
  -- order holds nothing at the provider and may be claimed by the current environment.
  if op.pickup_time_id is not null and op.provider_env is not null and op.provider_env <> p_env then
    raise exception 'provider_env_mismatch' using errcode = '42501';
  end if;
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
      and (o.state = 'in_flight' or (o.state = 'unknown' and o.dispatched_at > now() - interval '5 minutes')))
     or private.payment_busy(op.tenant_id) then
    raise exception 'account_busy' using errcode = '55P03';
  end if;
  -- Staleness is decided BEFORE the credential lookup (security review L6): an operation queued
  -- before an environment switch has no credential in the new environment, and used to be re-picked
  -- by every sweep without ever expiring.
  if op.created_at < now() - interval '6 hours' then
    update public.provider_operations set state = 'failed', result_code = 'QUOTE_STALE', updated_at = now() where id = op.id;
    update public.shipments set submission_state = 'failed', updated_at = now() where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'rejected', 'Ongkir kedaluwarsa sebelum dikirim; cek ongkir lagi');
    return jsonb_build_object('stale', true);
  end if;
  select version into v_version from private.seller_credentials
    where tenant_id = op.tenant_id and superseded_at is null and provider_env = p_env;
  if v_version is null then
    raise exception 'credential_missing' using errcode = '55000';
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

notify pgrst, 'reload schema';
