-- TD-3 / DEC-010: account dispatcher core for real Mengantar create-order operations.
-- Provider results are written only by the machine identity (service_role, the Supabase secret
-- key held as a Worker secret); no user role can execute the dispatch_* functions, so nobody can
-- forge a resi from a browser. Per-seller serialization is a database rule: at most one real
-- operation in flight per tenant (one tenant = one Mengantar seller, DEC-006). No SQL transaction
-- is held across the provider call: claim and record are separate short transactions.
-- Wiring confirm_shipment to create real operations is T-024; demo/simulated flows are unchanged.

-- ============================================================ provider identities on outlets/shipments
-- Mengantar identifies places by its own ids (24 hex): the outlet's saved pickup address and its
-- area, and the recipient's area. Free-text fields stay for display.
alter table public.outlets
  add column mengantar_pickup_address_id text check (mengantar_pickup_address_id ~ '^[a-f0-9]{24}$'),
  add column mengantar_area_id text check (mengantar_area_id ~ '^[a-f0-9]{24}$');

alter table public.shipments
  add column recipient_area_id text check (recipient_area_id ~ '^[a-f0-9]{24}$');
grant update (recipient_area_id) on public.shipments to authenticated;

-- A provider order exists but has no resi until it is paid (insufficient balance).
alter table public.shipments drop constraint shipments_submission_state_check;
alter table public.shipments add constraint shipments_submission_state_check
  check (submission_state in ('draft', 'estimated', 'queued', 'in_flight', 'unknown', 'awaiting_payment', 'issued', 'failed'));

-- recipient_area_id is draft content like the other recipient fields (PR-7).
create or replace function private.guard_shipment()
returns trigger language plpgsql set search_path = ''
as $$
declare
  content_changed boolean :=
    (new.sender_contact_id, new.sender_name, new.sender_phone, new.recipient_contact_id,
     new.recipient_name, new.recipient_phone, new.recipient_address, new.recipient_area,
     new.recipient_area_id, new.recipient_postal_code, new.item_description, new.weight_grams,
     new.length_cm, new.width_cm, new.height_cm, new.goods_value_idr)
    is distinct from
    (old.sender_contact_id, old.sender_name, old.sender_phone, old.recipient_contact_id,
     old.recipient_name, old.recipient_phone, old.recipient_address, old.recipient_area,
     old.recipient_area_id, old.recipient_postal_code, old.item_description, old.weight_grams,
     old.length_cm, old.width_cm, old.height_cm, old.goods_value_idr);
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
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ============================================================ operation result fields
alter table public.provider_operations
  add column provider_env text check (provider_env in ('sandbox', 'production')),
  add column provider_order_id text check (provider_order_id ~ '^[A-Z0-9]{6,20}$'),
  add column provider_batch text check (provider_batch ~ '^[A-Z0-9]{6,24}$'),
  add column provider_record_id text check (provider_record_id ~ '^[a-f0-9]{24}$'),
  -- The seller key version the order was sent with: reconciliation must look in that account.
  add column credential_version integer,
  add column dispatched_at timestamptz;

-- One real operation in flight per tenant (= per seller account, DEC-006). dispatch_claim also
-- waits out recently unknown operations under a tenant row lock.
-- lazy: serializes per tenant, not per real Mengantar account; two tenants bound to the same
-- seller (shared BYOK key) are not serialized. Needs an account identity when that can happen.
create unique index provider_operations_one_in_flight on public.provider_operations (tenant_id)
  where state = 'in_flight' and not is_simulated;

-- ============================================================ machine-only commands
-- Shared lock: the operation row, then its shipment. Only real (non-simulated) operations.
create function private.lock_real_operation(p_operation uuid)
returns public.provider_operations language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  select * into op from public.provider_operations where id = p_operation for update;
  if not found or op.is_simulated or op.kind <> 'create_order' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id for update;
  return op;
end $$;

-- Everything the dispatcher needs to build one create-order request, including the sealed seller
-- key (opened only inside the Worker with CREDENTIAL_KEY; AAD = tenant + version).
create function private.dispatch_payload(op public.provider_operations)
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
  -- Only the key version the operation was sent with, and only while it is still active: after a
  -- rotation the dispatcher gets no key and stays inconclusive rather than searching the wrong
  -- account and concluding "not created".
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
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;

-- Claim a queued operation: in flight now, attempt + 1, bound to the active key version.
-- Refuses demo/inactive tenants, a missing key (the operation stays queued), and a seller that is
-- busy: another operation in flight, or one whose outcome became unknown less than 5 minutes ago
-- (Mengantar may still be processing it; TD-3 step 5).
create function public.dispatch_claim(p_operation uuid, p_env text)
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

-- Give a claimed operation back when nothing was sent (the Worker could not open the key). The
-- attempt counter keeps rising, so a late writer of the released attempt is fenced.
create function public.dispatch_release(p_operation uuid, p_attempt integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  op := private.lock_real_operation(p_operation);
  if op.state <> 'in_flight' or op.attempts <> p_attempt then
    raise exception 'stale_attempt' using errcode = '40001';
  end if;
  update public.provider_operations set state = 'queued', result_code = 'RELEASED', dispatched_at = null,
    updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'queued', updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
end $$;

-- Start reconciling an operation whose outcome is unknown, or that has been in flight longer
-- than any request can last (the Worker died mid-call). Never resends; returns what the
-- dispatcher needs to look the order up by reference.
create function public.dispatch_begin_reconcile(p_operation uuid)
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
  if op.state <> 'unknown' and not (op.state = 'failed' and op.result_code = 'NOT_CREATED') then
    raise exception 'nothing_to_reconcile' using errcode = '55000';
  end if;
  return private.dispatch_payload(op);
end $$;

-- Record a provider result. From in_flight the attempt must match (fencing); from unknown any
-- truthful result may be recorded, except "not_created", which needs the attempt to be old
-- enough that no request can still be running (TD-3 step 5).
-- Outcomes: issued | unpaid | failed (error item) | rejected (refused, nothing created) |
-- unknown | not_created (reconciliation scanned past the attempt and found nothing).
create function public.dispatch_record(p_operation uuid, p_attempt integer, p_outcome text,
  p_order_id text default null, p_tracking text default null, p_batch text default null,
  p_record_id text default null, p_code text default null)
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

  -- An unpaid order that has since been paid gets its resi (same provider order only).
  if op.state = 'succeeded' and op.result_code = 'UNPAID' and p_outcome = 'issued'
     and op.provider_order_id = p_order_id and p_tracking ~ '^[A-Za-z0-9-]{6,40}$' then
    update public.provider_operations set result_code = 'ISSUED', updated_at = now() where id = op.id;
    update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = p_tracking,
      issued_at = coalesce(issued_at, now()), updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'issued', 'Resi ' || p_tracking);
    return jsonb_build_object('state', 'succeeded', 'replayed', false);
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
    return jsonb_build_object('state', 'succeeded', 'replayed', false);
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
  return jsonb_build_object('state', v_op_state, 'replayed', false);
end $$;

revoke all on function private.lock_real_operation(uuid), private.dispatch_payload(public.provider_operations)
  from public, anon, authenticated;
revoke all on function public.dispatch_claim(uuid, text), public.dispatch_release(uuid, integer),
  public.dispatch_begin_reconcile(uuid),
  public.dispatch_record(uuid, integer, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.dispatch_claim(uuid, text), public.dispatch_release(uuid, integer),
  public.dispatch_begin_reconcile(uuid),
  public.dispatch_record(uuid, integer, text, text, text, text, text, text) to service_role;
