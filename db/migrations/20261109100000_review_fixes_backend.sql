-- Review fixes (backend wave X). Forward-only; every function below is recreated from its latest
-- definition with only the noted change. Signatures, SECURITY DEFINER, `set search_path = ''` and ACLs retained.
--   P1-1  ingest_provider_status keeps shipments.delivery_state in step with provider_status_kind.
--   P1-2  cancel_begin fences a restored database and cancel_release/cancel_mark_sent keep a pre-send
--         key failure from wedging the shipment in read-back-only mode.
--   P1-3  machine_partner_id lets the server read the Partner ID the Super Admin stored.
--   P2-2  close_failed_operation and record_label_print recheck the role after the row locks.
--   P2-5  batch payment refuses an unknown member charge; platform_tenant_summary reports unknown.
--   P2-6  dispatch_pickup_known_time_ids is scoped to the operation's environment.
--   P3-2  webhook_endpoint_status takes no membership lock when the endpoint already exists.

-- ============================================================ P1-1

create or replace function public.ingest_provider_status(p_tenant uuid, p_env text, p_source text, p_provider_ts timestamptz,
  p_order_id text, p_awb text, p_status text, p_ts_trusted boolean default true,
  p_provider_weight_grams integer default null, p_hub_city text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.shipments;
  v_kind text;
  v_raw text := upper(btrim(coalesce(p_status, '')));
  v_hub text := nullif(btrim(coalesce(p_hub_city, '')), '');
  v_inserted integer;
  v_older boolean;
begin
  perform private.require_provider_env(p_env);
  if p_source not in ('webhook', 'pull') or p_provider_ts is null or p_ts_trusted is null
     or (p_source = 'webhook' and not p_ts_trusted)
     or coalesce(p_order_id, '') !~ '^[A-Z0-9]{6,20}$'
     or (p_awb is not null and p_awb !~ '^[A-Za-z0-9-]{6,40}$')
     or v_raw = '' or char_length(v_raw) > 60
     or (p_provider_weight_grams is not null and p_provider_weight_grams not between 1 and 1000000)
     or (v_hub is not null and (char_length(v_hub) > 60 or v_hub ~ '[[:cntrl:]]'))
     or p_provider_ts > now() + interval '5 minutes' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select sh.* into s from public.shipments sh
    join public.provider_operations op on op.tenant_id = sh.tenant_id and op.shipment_id = sh.id
    where sh.tenant_id = p_tenant and op.kind = 'create_order' and op.state = 'succeeded'
      and op.provider_env = p_env and op.provider_order_id = p_order_id and not sh.is_simulated
    for update of sh;
  if not found then return 'unmatched'; end if;
  if s.awb is not null and p_awb is not null and s.awb <> p_awb then return 'unmatched'; end if;

  v_kind := private.provider_status_kind(v_raw);
  insert into public.shipment_events (tenant_id, shipment_id, kind, detail, provider_status, provider_ts, source, hub_city)
    values (s.tenant_id, s.id, 'provider_status', null, v_raw, p_provider_ts, p_source, v_hub)
    on conflict (tenant_id, shipment_id, provider_ts, provider_status) where provider_ts is not null do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  if not p_ts_trusted then return 'history_only'; end if;

  v_older := s.provider_status_kind in ('delivered', 'returned', 'cancelled')
    or (s.provider_status_at is not null and p_provider_ts <= s.provider_status_at);
  if p_provider_weight_grams is not null then
    update public.shipments set provider_weight_grams =
        case when v_older then coalesce(provider_weight_grams, p_provider_weight_grams) else p_provider_weight_grams end
      where tenant_id = s.tenant_id and id = s.id;
  end if;

  if s.provider_status_kind in ('delivered', 'returned', 'cancelled') then return 'final'; end if;
  if s.provider_status_at is not null and p_provider_ts <= s.provider_status_at then return 'stale'; end if;

  update public.shipments set provider_status_kind = v_kind, provider_status_at = p_provider_ts,
      delivered_at = case when v_kind = 'delivered' then coalesce(delivered_at, p_provider_ts) else delivered_at end,
      returned_at = case when v_kind = 'returned' then coalesce(returned_at, p_provider_ts) else returned_at end,
      -- Keeps the older delivery_state column (read by return/attention detection) in step. Forward-only: a
      -- delivered or returned state is final and never replaced; kinds without a delivery meaning leave it.
      delivery_state = case
        when delivery_state in ('delivered', 'returned') then delivery_state
        when v_kind in ('delivered', 'returned', 'in_transit', 'problem') then v_kind
        else delivery_state end
    where tenant_id = s.tenant_id and id = s.id;
  if p_source = 'webhook' then
    update private.webhook_endpoints w set last_delivery_at = now()
      where w.tenant_id = p_tenant and w.provider_env = p_env;
  end if;
  return 'applied';
end $$;

-- Shipments already ingested before this migration: bring delivery_state in step with their stored kind.
update public.shipments set delivery_state = provider_status_kind
  where provider_status_kind in ('delivered', 'returned') and delivery_state not in ('delivered', 'returned');
update public.shipments set delivery_state = provider_status_kind
  where provider_status_kind in ('in_transit', 'problem') and delivery_state in ('unobserved', 'picked_up');

-- ============================================================ P1-2

alter table private.shipment_cancellations add column delete_sent_at timestamptz;
-- Decisions made before this column existed: a DELETE may have left, so none of them can be released.
update private.shipment_cancellations set delete_sent_at = coalesce(last_requested_at, now());

create or replace function public.cancel_begin(p_tenant uuid, p_env text, p_shipment uuid)
returns table (action text, order_id text, courier text, credential_version integer)
language plpgsql security definer set search_path = '' as $$
declare
  s public.shipments;
  v_order text;
  v_courier text;
  v_cred integer;
begin
  perform private.require_provider_env(p_env);
  select sh.* into s from public.shipments sh where sh.tenant_id = p_tenant and sh.id = p_shipment for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  select op.provider_order_id, op.credential_version into v_order, v_cred
    from public.provider_operations op
    where op.tenant_id = s.tenant_id and op.shipment_id = s.id and op.kind = 'create_order'
      and op.state = 'succeeded' and op.provider_env = p_env and op.provider_order_id is not null and not op.is_simulated;
  if v_order is null or s.is_simulated or s.submission_state <> 'issued' then
    raise exception 'not_cancellable' using errcode = '55000';
  end if;
  select q.courier into v_courier from public.shipment_quotes q where q.tenant_id = s.tenant_id and q.id = s.selected_quote_id;
  if s.cancel_state = 'cancelled' then
    return query select 'done'::text, v_order, v_courier, v_cred;
    return;
  end if;
  if s.provider_status_kind in ('delivered', 'returned', 'cancelled') then
    raise exception 'not_cancellable' using errcode = '55000';
  end if;
  if s.cancel_state in ('requested', 'unknown') then
    return query select 'readback'::text, v_order, v_courier, v_cred;
    return;
  end if;
  -- A DELETE /order is a provider mutation: refused after a restore until the fence is cleared.
  perform private.require_provider_fence_clear();
  update public.shipments set cancel_state = 'requested', cancel_requested_at = now()
    where tenant_id = s.tenant_id and id = s.id;
  insert into private.shipment_cancellations (tenant_id, shipment_id, attempts, last_requested_at, delete_sent_at)
    values (s.tenant_id, s.id, 1, now(), null)
    on conflict (tenant_id, shipment_id) do update
      set attempts = private.shipment_cancellations.attempts + 1, last_requested_at = now(), delete_sent_at = null;
  return query select 'send'::text, v_order, v_courier, v_cred;
end $$;

-- The caller records, right before it sends the DELETE, that the request is about to leave. From then on the
-- decision can no longer be released. Only while the decision is pending ('requested').
create function public.cancel_mark_sent(p_tenant uuid, p_env text, p_shipment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.shipments;
begin
  perform private.require_provider_env(p_env);
  select sh.* into s from public.shipments sh where sh.tenant_id = p_tenant and sh.id = p_shipment for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if s.cancel_state is distinct from 'requested' then raise exception 'stale_state' using errcode = '55000'; end if;
  perform private.require_provider_fence_clear();
  update private.shipment_cancellations set delete_sent_at = now() where tenant_id = s.tenant_id and shipment_id = s.id;
end $$;

-- Releases a pending decision when PROVABLY nothing was sent (the DELETE was never marked as sent): the state
-- goes back to NULL and the attempt is not counted, so a key that was unavailable does not leave the shipment
-- stuck in read-back-only mode. Returns false (nothing changed) once a DELETE may have left.
create function public.cancel_release(p_tenant uuid, p_env text, p_shipment uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.shipments; v_rows integer;
begin
  perform private.require_provider_env(p_env);
  select sh.* into s from public.shipments sh where sh.tenant_id = p_tenant and sh.id = p_shipment for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if s.cancel_state is null or s.cancel_state not in ('requested', 'unknown') then return false; end if;
  update private.shipment_cancellations set attempts = greatest(attempts - 1, 0)
    where tenant_id = s.tenant_id and shipment_id = s.id and delete_sent_at is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  update public.shipments set cancel_state = null, cancel_requested_at = null where tenant_id = s.tenant_id and id = s.id;
  return true;
end $$;
revoke all on function public.cancel_mark_sent(uuid, text, uuid), public.cancel_release(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_mark_sent(uuid, text, uuid), public.cancel_release(uuid, text, uuid) to service_role;

-- ============================================================ P1-3

-- The Partner ID the Super Admin stored (null when none), readable by the server only.
create function public.machine_partner_id()
returns text language sql stable security definer set search_path = '' as $$
  select nullif(btrim(s.value #>> '{}'), '') from private.settings s where s.key = 'mengantar_partner_id'
$$;
revoke all on function public.machine_partner_id() from public, anon, authenticated;
grant execute on function public.machine_partner_id() to service_role;

-- ============================================================ P2-2

create or replace function public.close_failed_operation(p_shipment uuid, p_reason text)
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
  -- Lock order operations -> shipments -> memberships; the role is rechecked under the locks, so an admin
  -- demoted or deactivated while waiting writes nothing.
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if op.id is null or op.is_simulated or op.state <> 'failed' or op.result_code not in ('NOT_CREATED', 'PROVIDER_ERROR_ITEM')
     or op.last_checked_at is null or op.dispatched_at > now() - interval '30 minutes' then
    raise exception 'not_closable' using errcode = '55000';
  end if;
  update public.provider_operations set result_code = 'CLOSED_NOT_CREATED', updated_at = now() where id = op.id;
  perform private.add_event(v_tenant, p_shipment, 'closed', 'Ditutup admin: tidak ada pesanan di Mengantar');
  perform private.audit('shipment.close_failed', v_tenant, null, p_reason, 'closed',
    jsonb_build_object('shipment', p_shipment, 'operation', op.id, 'previous', op.result_code));
end $$;

create or replace function public.record_label_print(p_snapshot uuid, p_acknowledged boolean)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v public.label_snapshots;
  v_state text;
  v_id bigint;
begin
  select * into v from public.label_snapshots where id = p_snapshot;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v.tenant_id);
  -- Lock order shipments -> memberships; the membership is rechecked under the locks.
  perform private.lock_member_shipment(v.shipment_id);
  perform 1 from public.memberships where tenant_id = v.tenant_id and user_id = (select auth.uid()) for share;
  perform private.require_member(v.tenant_id);
  if p_acknowledged is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  if v.mask_sender and not (select t.masking_allowed from public.tenants t where t.id = v.tenant_id) then
    raise exception 'masking_disabled' using errcode = '42501';
  end if;
  if v.mask_sender then
    v_state := private.masking_acceptance_state(v.courier);
    if v_state <> 'verified' and not p_acknowledged then
      raise exception 'masking_acknowledgement_required' using errcode = '55000';
    end if;
  end if;
  insert into public.label_print_events (tenant_id, shipment_id, snapshot_id, size, actor, acceptance_state, acknowledged)
  values (v.tenant_id, v.shipment_id, v.id, v.size, (select auth.uid()),
    v_state, case when v.mask_sender then p_acknowledged end)
  returning id into v_id;
  return v_id;
end $$;

-- ============================================================ P2-5

create or replace function private.compute_unpaid_batch(p_tenant uuid, p_shipment uuid, p_lock boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  op public.provider_operations;
  q public.shipment_quotes;
  v_batch text;
  v_batch_id text;
  v_digest_parts text;
  v_digest text;
  v_total bigint;
  v_members jsonb;
  v_unknown boolean;
begin
  select * into s from public.shipments where tenant_id = p_tenant and id = p_shipment;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into op from public.provider_operations
    where tenant_id = p_tenant and shipment_id = p_shipment and kind = 'create_order'
    order by created_at desc limit 1;
  if op.id is null or op.provider_batch is null then
    raise exception 'batch_not_payable' using errcode = '55000';
  end if;
  v_batch := op.provider_batch;

  if p_lock then
    -- DIL-14: the dispatcher locks operation -> shipment, so the batch is locked in that order too:
    -- every member operation by id, then every member shipment by id. The rows are then re-read
    -- under the locks, because a member may have changed between the discovery read and the lock.
    perform 1 from public.provider_operations o
      where o.tenant_id = p_tenant and o.provider_batch = v_batch
      order by o.id for update;
    perform 1 from public.shipments sh
      where sh.tenant_id = p_tenant
        and sh.id in (select o.shipment_id from public.provider_operations o where o.tenant_id = p_tenant and o.provider_batch = v_batch)
      order by sh.id for update;
    select * into s from public.shipments where tenant_id = p_tenant and id = p_shipment;
    select * into op from public.provider_operations
      where tenant_id = p_tenant and shipment_id = p_shipment and kind = 'create_order'
      order by created_at desc limit 1;
    if op.id is null or op.provider_batch is distinct from v_batch then
      raise exception 'batch_not_payable' using errcode = '55000';
    end if;
  end if;

  if s.is_simulated or s.submission_state <> 'awaiting_payment' or s.payment_state <> 'unpaid' then
    raise exception 'batch_not_payable' using errcode = '55000';
  end if;
  if op.is_simulated or op.state <> 'succeeded' or op.provider_order_id is null then
    raise exception 'batch_not_payable' using errcode = '55000';
  end if;

  select * into q from public.shipment_quotes where tenant_id = p_tenant and id = s.selected_quote_id;
  if q.id is null then
    raise exception 'batch_not_payable' using errcode = '55000';
  end if;
  if lower(q.courier) = 'ninja' then
    raise exception 'courier_discontinued' using errcode = '55000';
  end if;

  if exists (select 1 from public.provider_operations o where o.provider_batch = v_batch and o.tenant_id <> p_tenant) then
    raise exception 'batch_scope_mismatch' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    left join public.shipment_quotes sq on sq.tenant_id = sh.tenant_id and sq.id = sh.selected_quote_id
    where o.tenant_id = p_tenant and o.provider_batch = v_batch
      and (o.is_simulated or o.state <> 'succeeded' or o.provider_order_id is null or sq.courier is distinct from q.courier)
  ) then
    raise exception 'batch_scope_mismatch' using errcode = '55000';
  end if;

  -- The members of one batch share one provider object id; two different ones mean the data cannot
  -- be trusted for a payment.
  select max(o.provider_batch_id) into v_batch_id
    from public.provider_operations o where o.tenant_id = p_tenant and o.provider_batch = v_batch;
  if (select count(distinct o.provider_batch_id) from public.provider_operations o
        where o.tenant_id = p_tenant and o.provider_batch = v_batch) > 1 then
    raise exception 'batch_scope_mismatch' using errcode = '55000';
  end if;

  select
    string_agg(m.shipment_id::text || ':' || m.provider_order_id || ':' || m.charge_idr::text, ',' order by m.shipment_id),
    sum(case when m.payment_state = 'unpaid' then m.charge_idr else 0 end),
    bool_or(m.charge_idr is null),
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
  into v_digest_parts, v_total, v_unknown, v_members
  from (
    select sh.id as shipment_id, o.id as operation_id, sh.reference, o.provider_order_id,
      sh.recipient_name, coalesce(sh.customer_charge_idr, sq.customer_charge_idr) as charge_idr,
      sh.is_cod, sh.cod_amount_idr, sh.payment_state, sh.submission_state, sh.created_at
    from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    left join public.shipment_quotes sq on sq.tenant_id = sh.tenant_id and sq.id = sh.selected_quote_id
    where o.tenant_id = p_tenant and o.provider_batch = v_batch
  ) m;

  -- An unknown member charge is never read as 0 (nor as a tariff without its COD fee): the batch is refused.
  if v_digest_parts is null or v_unknown or coalesce(v_total, 0) <= 0 then
    raise exception 'batch_not_payable' using errcode = '55000';
  end if;

  -- The digest keeps its original inputs (tenant, batch code, courier, members): the object id is a
  -- provider alias of the same batch and does not change what the admin reviewed.
  v_digest := encode(extensions.digest(
    p_tenant::text || '|' || v_batch || '|' || q.courier || '|' || v_digest_parts,
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
    'batch', v_batch,
    'batch_id', v_batch_id,
    'courier', q.courier,
    'batch_digest', v_digest,
    'member_count', jsonb_array_length(coalesce(v_members, '[]'::jsonb)),
    'total_charge_idr', coalesce(v_total, 0),
    'total_customer_charge_idr', coalesce(v_total, 0),
    'members', coalesce(v_members, '[]'::jsonb)
  );
end $$;

create or replace function private.batch_attempt_payload(a private.batch_payment_attempts, p_mode text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  c private.seller_credentials;
  v_members jsonb;
  v_unknown boolean;
begin
  select * into op from public.provider_operations where id = a.claim_operation_id;
  if op.credential_version is null then
    select * into c from private.seller_credentials
      where tenant_id = a.tenant_id and superseded_at is null and provider_env = op.provider_env;
  else
    c := private.operation_credential(a.tenant_id, op.provider_env, op.credential_version);
  end if;
  select jsonb_agg(jsonb_build_object(
      'shipment_id', o.shipment_id,
      'operation_id', o.id,
      'reference', sh.reference,
      'provider_order_id', o.provider_order_id,
      'customer_charge_idr', coalesce(sh.customer_charge_idr, sq.customer_charge_idr),
      'payment_state', sh.payment_state
    ) order by o.id), bool_or(coalesce(sh.customer_charge_idr, sq.customer_charge_idr) is null)
    into v_members, v_unknown
    from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    left join public.shipment_quotes sq on sq.tenant_id = sh.tenant_id and sq.id = sh.selected_quote_id
    where o.tenant_id = a.tenant_id and o.provider_batch = a.batch_code
      and not o.is_simulated and o.state = 'succeeded' and o.provider_order_id is not null;
  if v_unknown then raise exception 'batch_not_payable' using errcode = '55000'; end if;
  return jsonb_build_object(
    'mode', p_mode,
    'attempt_id', a.id,
    'attempt_state', a.state,
    'claim_operation_id', a.claim_operation_id,
    'tenant_id', a.tenant_id,
    'provider_env', op.provider_env,
    'batch', a.batch_code,
    'batch_id', coalesce(a.batch_object_id, (select max(o.provider_batch_id) from public.provider_operations o
      where o.tenant_id = a.tenant_id and o.provider_batch = a.batch_code)),
    'courier', a.courier,
    'batch_digest', a.batch_digest,
    'members', coalesce(v_members, '[]'::jsonb),
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;

create or replace function public.platform_tenant_summary(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants; v_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Jakarta')) at time zone 'Asia/Jakarta';
begin
  perform private.require_platform_any(array['platform_monitoring', 'tenant_governance']);
  select * into t from public.tenants where id = p_tenant and not is_demo;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', t.id, 'name', t.name, 'lifecycle', t.lifecycle, 'created_at', t.created_at, 'slug', t.slug,
    'shipment_prefix', t.shipment_prefix, 'masking_allowed', t.masking_allowed,
    'member_count', (select count(*) from public.memberships m where m.tenant_id = t.id and m.status = 'active'),
    'admin_count', (select count(*) from public.memberships m where m.tenant_id = t.id and m.status = 'active' and m.role = 'tenant_admin'),
    'outlets', coalesce((select jsonb_agg(jsonb_build_object('name', o.name, 'pickup_area', o.pickup_area,
        'pickup_ready', o.mengantar_pickup_address_id is not null) order by o.name) from public.outlets o where o.tenant_id = t.id), '[]'::jsonb),
    'seller', (select jsonb_build_object('connected', c.id is not null, 'mode', c.mode, 'provider_env', c.provider_env, 'since', c.created_at)
      from (select 1) x left join lateral (select * from private.seller_credentials c where c.tenant_id = t.id and c.superseded_at is null
        order by c.version desc limit 1) c on true),
    'discount', (select jsonb_build_object('gerai_discount_bps', c.gerai_discount_bps, 'status', c.status, 'effective_from', c.effective_from)
      from (select 1) x left join lateral private.current_gerai_terms(t.id) c on true),
    'by_state', coalesce((select jsonb_object_agg(submission_state, n) from (select s.submission_state, count(*) n
      from public.shipments s where s.tenant_id = t.id and not s.is_simulated group by s.submission_state) x), '{}'::jsonb),
    'activity', (select jsonb_build_object(
        'today', count(*) filter (where s.created_at >= v_today),
        'last_7_days', count(*) filter (where s.created_at >= now() - interval '7 days'),
        'last_30_days', count(*) filter (where s.created_at >= now() - interval '30 days'),
        'issued_30_days', count(*) filter (where s.issued_at >= now() - interval '30 days'),
        'cod_30_days', count(*) filter (where s.is_cod and s.created_at >= now() - interval '30 days'),
        -- Unknown stays unknown: null when any issued shipment of the window has no known customer charge.
        'charge_30_days_idr', case when count(*) filter (where s.issued_at >= now() - interval '30 days' and s.customer_charge_idr is null) > 0
          then null else coalesce(sum(s.customer_charge_idr) filter (where s.issued_at >= now() - interval '30 days'), 0) end,
        'charge_unknown_30_days', count(*) filter (where s.issued_at >= now() - interval '30 days' and s.customer_charge_idr is null),
        'last_shipment_at', max(s.created_at))
      from public.shipments s where s.tenant_id = t.id and not s.is_simulated),
    'last_activity_at', (select max(a.at) from public.audit_events a where a.target_tenant = t.id));
end $$;

-- ============================================================ P2-6

create or replace function public.dispatch_pickup_known_time_ids(p_operation uuid)
returns text[] language plpgsql stable security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  select * into op from public.provider_operations where id = p_operation;
  if not found or op.is_simulated or op.kind <> 'create_order' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return coalesce((
    select array_agg(distinct o.pickup_time_id order by o.pickup_time_id)
    from public.provider_operations o
    where o.tenant_id = op.tenant_id and o.id <> op.id and o.pickup_time_id is not null
      -- A claimed operation always has its environment; one without (not yet claimed) stays conservative.
      and (op.provider_env is null or o.provider_env is not distinct from op.provider_env)
  ), array[]::text[]);
end $$;

-- ============================================================ P3-2

create or replace function public.webhook_endpoint_status(p_tenant uuid, p_env text)
returns table (endpoint_id text, secret_configured boolean, hint text, secret_version integer,
  secret_set_at timestamptz, last_delivery_at timestamptz, last_mismatch_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_provider_env(p_env);
  -- A page view takes no membership lock: only the first creation of the endpoint does (it writes).
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  if not exists (select 1 from private.webhook_endpoints e where e.tenant_id = p_tenant and e.provider_env = p_env) then
    perform private.require_tenant_admin_locked(p_tenant);
    insert into private.webhook_endpoints (tenant_id, provider_env, endpoint_id)
      values (p_tenant, p_env, rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '='))
      on conflict (tenant_id, provider_env) do nothing;
  end if;
  return query select w.endpoint_id, w.ciphertext is not null, w.hint, w.secret_version, w.secret_set_at,
      w.last_delivery_at, w.last_mismatch_at
    from private.webhook_endpoints w where w.tenant_id = p_tenant and w.provider_env = p_env;
end $$;

notify pgrst, 'reload schema';
