-- T-045 slice 2: DELETE /order cancel with an unknown outcome and a read-back, batch-delete refund as
-- provider-private money, and the structured provider weight / hub city seam in status ingestion.
-- Forward-only. Nothing here is shown to operators except the cancel state: refund amounts live in a
-- private table that no application role can read, and the refund of DELETE /order is structurally unknown
-- (no column for it exists), so absent is never stored as 0.
--
-- shipments.provider_weight_grams already exists (20261102100000_billable_weight): it is written only by
-- ingestion below and never touches the measured weight_grams / weight_snapshot.

-- ============================================================ cancel state (operator-visible) and private detail

alter table public.shipments
  -- requested: DELETE /order was sent and its answer is not yet recorded (a crash here is an unknown outcome);
  -- unknown: the answer was unreadable or contradicted by the read-back; refused: the courier kept the order
  -- (read back and still active, so it is NOT cancelled); cancelled: the read-back proved the cancellation.
  add column cancel_state text check (cancel_state in ('requested', 'unknown', 'refused', 'cancelled')),
  add column cancel_requested_at timestamptz;

create table private.shipment_cancellations (
  tenant_id uuid not null,
  shipment_id uuid not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_requested_at timestamptz,
  last_checked_at timestamptz,
  primary key (tenant_id, shipment_id),
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade
);
alter table private.shipment_cancellations enable row level security;
revoke all on private.shipment_cancellations from public, anon, authenticated, service_role;

-- ============================================================ batch delete: counts and provider-private refund

create table private.provider_batch_deletions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider_env text not null check (provider_env in ('sandbox', 'production')),
  batch_id text not null check (batch_id ~ '^[a-f0-9]{24}$'),
  courier text not null check (courier in ('JNE', 'SiCepat', 'Sap', 'iDexpress', 'JT', 'lion', 'anteraja', 'pos', 'spx')),
  deleted_count integer not null check (deleted_count >= 0),
  undeleted_count integer not null check (undeleted_count >= 0),
  total_count integer not null check (total_count >= 0),
  is_batch_draft boolean not null,
  -- Only lion, anteraja, pos and spx report these; null = unknown (never 0 for "not reported").
  orders_count integer check (orders_count >= 0),
  refund_idr bigint check (refund_idr >= 0),
  refused_count integer check (refused_count >= 0),
  recorded_at timestamptz not null default now(),
  check (courier in ('lion', 'anteraja', 'pos', 'spx') or (orders_count is null and refund_idr is null and refused_count is null))
);
create index provider_batch_deletions_by_tenant on private.provider_batch_deletions (tenant_id, recorded_at);
alter table private.provider_batch_deletions enable row level security;
revoke all on private.provider_batch_deletions from public, anon, authenticated, service_role;

-- ============================================================ structured hub city on provider events

alter table public.shipment_events
  -- Never public (track_shipment returns kind and time only). Printable text, at most 60 characters.
  add column hub_city text check (char_length(hub_city) between 1 and 60 and hub_city !~ '[[:cntrl:]]');

-- ============================================================ ingestion: optional provider weight and hub city

-- Same contract as before (see 20261106100000), plus two optional structured fields that no provider payload
-- is yet known to carry (T-048 captures the real shape). They are written only for a trusted event of this
-- tenant's own shipment: the provider weight goes to provider_weight_grams only (the measured weight_grams
-- and weight_snapshot are never touched; a null never erases a stored value; an older or final-state event
-- fills an empty value but never replaces one), and the hub city is stored on the event row.
drop function public.ingest_provider_status(uuid, text, text, timestamptz, text, text, text, boolean);
create function public.ingest_provider_status(p_tenant uuid, p_env text, p_source text, p_provider_ts timestamptz,
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
      returned_at = case when v_kind = 'returned' then coalesce(returned_at, p_provider_ts) else returned_at end
    where tenant_id = s.tenant_id and id = s.id;
  if p_source = 'webhook' then
    update private.webhook_endpoints w set last_delivery_at = now()
      where w.tenant_id = p_tenant and w.provider_env = p_env;
  end if;
  return 'applied';
end $$;
revoke all on function public.ingest_provider_status(uuid, text, text, timestamptz, text, text, text, boolean, integer, text)
  from public, anon, authenticated;
grant execute on function public.ingest_provider_status(uuid, text, text, timestamptz, text, text, text, boolean, integer, text)
  to service_role;

-- ============================================================ cancel: begin (one DELETE per decision) and record

-- Decides what the machine may do for one shipment of this tenant and environment, under the shipment lock:
--   'send'      no outcome is pending: the state moves to 'requested' and the caller may send ONE DELETE /order;
--   'readback'  a DELETE was already sent (state requested or unknown): the caller must only read the order back,
--               never send the DELETE again (a replay could cancel twice or race a courier decision);
--   'done'      already cancelled.
-- A refused order (read back and still active) may be retried by an explicit new decision. Delivered, returned
-- or otherwise final shipments, simulated shipments and shipments without a succeeded real order are refused.
create function public.cancel_begin(p_tenant uuid, p_env text, p_shipment uuid)
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
  update public.shipments set cancel_state = 'requested', cancel_requested_at = now()
    where tenant_id = s.tenant_id and id = s.id;
  insert into private.shipment_cancellations (tenant_id, shipment_id, attempts, last_requested_at)
    values (s.tenant_id, s.id, 1, now())
    on conflict (tenant_id, shipment_id) do update
      set attempts = private.shipment_cancellations.attempts + 1, last_requested_at = now();
  return query select 'send'::text, v_order, v_courier, v_cred;
end $$;

-- Records the outcome of a DELETE /order decision, always after a read-back (or its failure):
--   'cancelled'  the read-back proved it (deleted or a cancelled category): the shipment becomes cancelled;
--   'refused'    the read-back found the order still active: it stays NOT cancelled;
--   'unknown'    the answer or the read-back was unreadable or contradictory: nothing is concluded.
-- Only from state requested or unknown. A cancellation read back on a shipment that already ended another way
-- (delivered, returned) is a conflict: the shipment is left as it is and marked unknown for a person to review.
-- The refund of DELETE /order is not recorded anywhere: it is unknown (batch deletion has its own table).
create function public.cancel_record(p_tenant uuid, p_env text, p_shipment uuid, p_outcome text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.shipments;
begin
  perform private.require_provider_env(p_env);
  -- A NULL outcome must not pass (NULL NOT IN (...) is unknown, not true): it would clear the no-replay fence.
  if p_outcome is null or p_outcome not in ('cancelled', 'refused', 'unknown') then raise exception 'invalid_input' using errcode = '22023'; end if;
  select sh.* into s from public.shipments sh where sh.tenant_id = p_tenant and sh.id = p_shipment for update;
  if not found then raise exception 'not_found' using errcode = '22023'; end if;
  if s.cancel_state is null or s.cancel_state not in ('requested', 'unknown') then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  update private.shipment_cancellations set last_checked_at = now() where tenant_id = s.tenant_id and shipment_id = s.id;
  if p_outcome = 'cancelled' and s.provider_status_kind in ('delivered', 'returned') then
    update public.shipments set cancel_state = 'unknown' where tenant_id = s.tenant_id and id = s.id;
    return 'conflict';
  end if;
  if p_outcome = 'cancelled' then
    update public.shipments set cancel_state = 'cancelled', provider_status_kind = 'cancelled'
      where tenant_id = s.tenant_id and id = s.id;
    insert into public.shipment_events (tenant_id, shipment_id, kind, detail) values (s.tenant_id, s.id, 'cancelled', null);
  else
    update public.shipments set cancel_state = p_outcome where tenant_id = s.tenant_id and id = s.id;
  end if;
  return p_outcome;
end $$;

-- ============================================================ cancel: the original operation's sealed credential

-- The sealed key the cancellation must use: the credential of the ORIGINAL create_order operation (the
-- version cancel_begin returned), resolved by private.operation_credential, never the tenant's current key.
-- A BYOK replacement may identify another seller account, so it never crosses versions; a verified Partner
-- regeneration (same write-once seller binding, same environment) does. null when no such credential exists.
create function public.machine_operation_key(p_tenant uuid, p_env text, p_version integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c private.seller_credentials;
begin
  perform private.require_provider_env(p_env);
  if (select is_demo from public.tenants where id = p_tenant) is distinct from false then return null; end if;
  c := private.operation_credential(p_tenant, p_env, p_version);
  if c.id is null then return null; end if;
  return jsonb_build_object('ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version);
end $$;
revoke all on function public.machine_operation_key(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.machine_operation_key(uuid, text, integer) to service_role;

-- ============================================================ batch delete: record counts and the private refund

-- p_orders_count / p_refund_idr / p_refused_count are null unless the courier reports them (lion, anteraja,
-- pos, spx); a reported 0 stays 0. The table check refuses a value for any other courier.
create function public.record_batch_delete(p_tenant uuid, p_env text, p_batch_id text, p_courier text,
  p_deleted integer, p_undeleted integer, p_total integer, p_is_draft boolean,
  p_orders_count integer, p_refund_idr bigint, p_refused_count integer)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform private.require_provider_env(p_env);
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then raise exception 'not_found' using errcode = '22023'; end if;
  insert into private.provider_batch_deletions (tenant_id, provider_env, batch_id, courier, deleted_count, undeleted_count,
      total_count, is_batch_draft, orders_count, refund_idr, refused_count)
    values (p_tenant, p_env, p_batch_id, p_courier, p_deleted, p_undeleted, p_total, p_is_draft,
      p_orders_count, p_refund_idr, p_refused_count)
    returning id into v_id;
  return v_id;
exception when check_violation or not_null_violation then
  raise exception 'invalid_input' using errcode = '22023';
end $$;

revoke all on function public.cancel_begin(uuid, text, uuid), public.cancel_record(uuid, text, uuid, text),
  public.record_batch_delete(uuid, text, text, text, integer, integer, integer, boolean, integer, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.cancel_begin(uuid, text, uuid), public.cancel_record(uuid, text, uuid, text),
  public.record_batch_delete(uuid, text, text, text, integer, integer, integer, boolean, integer, bigint, integer)
  to service_role;

notify pgrst, 'reload schema';
