-- Second independent review of 20261029150000 / 160000 / 170000 (those files stay immutable).
--
-- Medium: dispatch_due had no environment filter. Since the environment refusal of the begin RPCs now
-- rolls back last_checked_at, 20 or more operations of the other environment kept the oldest place in
-- every sweep and starved this runtime's reconciles, payment checks and dispatches. dispatch_due now
-- takes a mandatory p_env and returns only this environment's work (a queued operation that was never
-- claimed has no environment yet and is returned to every runtime, as before; its claim is scoped).
-- Low: the batch payment close is bound to the attempt the admin reviewed (p_attempt); a stale or
-- repeated form can no longer close a newer attempt nobody checked. review_unpaid_batch returns the
-- newest attempt's id for the page.


drop function public.dispatch_due(integer);
create function public.dispatch_due(p_limit integer default 20, p_env text default null)
returns table (operation_id uuid, action text) language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_provider_env(p_env);
  return query select due.id, due.action from (
    select o.id, 'dispatch' as action, o.updated_at as at from public.provider_operations o
      join public.tenants t on t.id = o.tenant_id
      where not o.is_simulated and o.state = 'queued' and o.updated_at < now() - interval '1 minute'
        and (o.provider_env is null or o.provider_env = p_env)
        and coalesce(o.last_checked_at, '-infinity') < now() - interval '10 minutes'
        and t.lifecycle = 'active' and not t.is_demo
        and exists (select 1 from private.seller_credentials c where c.tenant_id = o.tenant_id and c.superseded_at is null
          and c.provider_env = p_env)
    union all
    select o.id, 'reconcile', coalesce(o.last_checked_at, o.dispatched_at) from public.provider_operations o
      where not o.is_simulated and o.provider_env = p_env and coalesce(o.last_checked_at, '-infinity') < now() - interval '10 minutes'
        and o.dispatched_at > now() - interval '7 days'
        and ((o.state = 'in_flight' and o.dispatched_at < now() - interval '2 minutes') or o.state = 'unknown')
    union all
    select o.id, 'reconcile', coalesce(o.last_checked_at, o.dispatched_at) from public.provider_operations o
      where not o.is_simulated and o.provider_env = p_env and o.state = 'failed' and o.result_code in ('NOT_CREATED', 'PROVIDER_ERROR_ITEM')
        and coalesce(o.last_checked_at, '-infinity') < now() - interval '60 minutes'
        and o.dispatched_at > now() - interval '24 hours'
    union all
    select o.id, 'payment', coalesce(o.last_checked_at, o.updated_at) from public.provider_operations o
      join public.shipments s on s.tenant_id = o.tenant_id and s.id = o.shipment_id
      where not o.is_simulated and o.provider_env = p_env and o.state = 'succeeded' and s.payment_state = 'unpaid' and o.provider_order_id is not null
        and coalesce(o.last_checked_at, '-infinity') < now() - interval '30 minutes'
        and o.updated_at > now() - interval '7 days'
  ) due order by due.at limit least(greatest(p_limit, 1), 50);
end $$;
revoke all on function public.dispatch_due(integer, text) from public, anon, authenticated;
grant execute on function public.dispatch_due(integer, text) to service_role;

create or replace function public.review_unpaid_batch(p_tenant uuid default null, p_shipment uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  v_res jsonb;
  v_attempt text;
  v_attempt_id uuid;
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
  -- The newest attempt for this batch, so the page can show an unresolved payment (never "payable").
  select a.state, a.id into v_attempt, v_attempt_id from private.batch_payment_attempts a
    where a.tenant_id = v_tenant and a.batch_code = v_res->>'batch'
    order by a.created_at desc limit 1;
  return jsonb_build_object(
    'batch', v_res->'batch',
    'courier', v_res->'courier',
    'batch_digest', v_res->'batch_digest',
    'member_count', v_res->'member_count',
    'total_charge_idr', v_res->'total_charge_idr',
    'total_customer_charge_idr', v_res->'total_customer_charge_idr',
    'members', v_res->'members',
    'payment_attempt_state', to_jsonb(v_attempt),
    'payment_attempt_id', to_jsonb(v_attempt_id)
  );
end $$;

drop function public.close_unknown_batch_payment(uuid, text);
create function public.close_unknown_batch_payment(p_shipment uuid, p_attempt uuid, p_reason text)
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
revoke all on function public.close_unknown_batch_payment(uuid, uuid, text) from public, anon;
grant execute on function public.close_unknown_batch_payment(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
