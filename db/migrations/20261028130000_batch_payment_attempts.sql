-- T-033 (review P0-2, P0-3, DIL-06, DIL-14): batch payment correctness and unknown-payment
-- reconciliation. Contracts: PR-5, PR-22, TD-3, TD-9, DEC-010 (no blind replay), IAM-2, TEN-4.
--
--  * The provider batch OBJECT id (`batch_id`, 24 lowercase hex) is stored next to the batch CODE
--    (`provider_batch`); POST /order/pay-unpaid takes the object id, GET /order keeps the code.
--  * Every payment attempt is a durable row. A request that may have reached the provider is
--    "sent" (write-ahead, before the POST) and, once its outcome is unclear, "unknown": both block
--    a second pay-unpaid for the batch until per-order reads prove the batch paid. A lease expiry
--    never makes a sent/unknown attempt payable again; it only frees a claim that sent nothing.
--  * Claims, the write-ahead mark and the release/finish are fenced to one attempt id.
--  * A tenant admin authorizes a batch digest (audited, single use, short expiry) and the machine
--    claim consumes exactly one matching unexpired authorization.
--  * Lock order (DIL-14), everywhere: operations (by id) -> shipments (by id) -> tenant ->
--    attempts/authorizations. The attempt functions touch the attempt row only.

-- ============================================================ schema

alter table public.provider_operations
  add column provider_batch_id text check (provider_batch_id ~ '^[a-f0-9]{24}$');

-- Superseded by the attempt table: busy state is derived from attempts, never from a timestamp on
-- the member operations (which a stray write or an unpaid read could clear).
alter table public.provider_operations drop column payment_in_flight_at;

create table private.batch_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  claim_operation_id uuid not null references public.provider_operations (id) on delete cascade,
  batch_code text not null,
  batch_object_id text check (batch_object_id ~ '^[a-f0-9]{24}$'),
  courier text not null,
  batch_digest text not null,
  authorization_id uuid not null,
  authorized_by uuid not null,
  -- claimed: the machine holds the claim, nothing was sent. sent: written before the POST; the
  -- request may have reached the provider. unknown: the answer was unclear. paid, rejected
  -- (provider refused, nothing paid) and released (claim ended before anything was sent) are final.
  state text not null default 'claimed' check (state in ('claimed', 'sent', 'unknown', 'paid', 'rejected', 'released')),
  lease_expires_at timestamptz not null,
  sent_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.batch_payment_attempts enable row level security;

-- At most one unresolved attempt per batch: a second pay-unpaid cannot be claimed while one is open.
create unique index batch_payment_attempts_one_open on private.batch_payment_attempts (tenant_id, batch_code)
  where state in ('claimed', 'sent', 'unknown');
create index batch_payment_attempts_by_tenant on private.batch_payment_attempts (tenant_id, state);

create table private.batch_payment_authorizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  shipment_id uuid not null,
  batch_code text not null,
  batch_digest text not null check (batch_digest ~ '^[a-f0-9]{64}$'),
  actor uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_attempt uuid,
  superseded_at timestamptz,
  foreign key (tenant_id, shipment_id) references public.shipments (tenant_id, id) on delete cascade
);
alter table private.batch_payment_authorizations enable row level security;
create index batch_payment_authorizations_open on private.batch_payment_authorizations (tenant_id, shipment_id, batch_digest)
  where consumed_at is null and superseded_at is null;

-- ============================================================ helpers

-- A payment is on the wire for this seller: a live claim, or a request sent in the last two minutes.
create function private.payment_busy(p_tenant uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.batch_payment_attempts a
    where a.tenant_id = p_tenant
      and ((a.state = 'claimed' and a.lease_expires_at > now())
        or (a.state = 'sent' and a.sent_at > now() - interval '2 minutes')));
$$;

-- An unresolved sent/unknown attempt whose members are all paid at the provider is reconciled
-- (TD-3: "reconciliation of the original attempt when its paid result appears"). Touches the
-- attempt rows only (lock order).
create function private.settle_batch_attempts(p_tenant uuid, p_batch text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a record;
begin
  if p_batch is null then return; end if;
  for a in
    update private.batch_payment_attempts t set state = 'paid', resolved_at = now(), updated_at = now()
    where t.tenant_id = p_tenant and t.batch_code = p_batch and t.state in ('sent', 'unknown')
      and not exists (
        select 1 from public.provider_operations o
        join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
        where o.tenant_id = p_tenant and o.provider_batch = p_batch and sh.payment_state = 'unpaid')
    returning t.id, t.batch_digest, t.authorized_by
  loop
    perform private.audit('shipment.batch_pay', p_tenant, a.authorized_by, null, 'reconciled_paid',
      jsonb_build_object('attempt', a.id, 'batch_digest', a.batch_digest, 'batch', p_batch));
  end loop;
end $$;

-- Everything the Worker needs to pay or reconcile one attempt's batch: members are the batch's
-- succeeded operations, the sealed key is the one the batch was created with.
create function private.batch_attempt_payload(a private.batch_payment_attempts, p_mode text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  c private.seller_credentials;
  v_members jsonb;
begin
  select * into op from public.provider_operations where id = a.claim_operation_id;
  select * into c from private.seller_credentials
    where tenant_id = a.tenant_id and superseded_at is null
      and (op.credential_version is null or version = op.credential_version);
  select jsonb_agg(jsonb_build_object(
      'shipment_id', o.shipment_id,
      'operation_id', o.id,
      'reference', sh.reference,
      'provider_order_id', o.provider_order_id,
      'customer_charge_idr', coalesce(sh.customer_charge_idr, sq.customer_charge_idr, sq.normal_tariff_idr, 0),
      'payment_state', sh.payment_state
    ) order by o.id)
    into v_members
    from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    left join public.shipment_quotes sq on sq.tenant_id = sh.tenant_id and sq.id = sh.selected_quote_id
    where o.tenant_id = a.tenant_id and o.provider_batch = a.batch_code
      and not o.is_simulated and o.state = 'succeeded' and o.provider_order_id is not null;
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

-- ============================================================ batch review (DIL-14 lock order)

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
  into v_digest_parts, v_total, v_members
  from (
    select sh.id as shipment_id, o.id as operation_id, sh.reference, o.provider_order_id,
      sh.recipient_name, coalesce(sh.customer_charge_idr, sq.customer_charge_idr, sq.normal_tariff_idr, 0) as charge_idr,
      sh.is_cod, sh.cod_amount_idr, sh.payment_state, sh.submission_state, sh.created_at
    from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    left join public.shipment_quotes sq on sq.tenant_id = sh.tenant_id and sq.id = sh.selected_quote_id
    where o.tenant_id = p_tenant and o.provider_batch = v_batch
  ) m;

  if v_digest_parts is null or coalesce(v_total, 0) <= 0 then
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

create or replace function public.review_unpaid_batch(p_tenant uuid default null, p_shipment uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  v_res jsonb;
  v_attempt text;
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
  select a.state into v_attempt from private.batch_payment_attempts a
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
    'payment_attempt_state', to_jsonb(v_attempt)
  );
end $$;

-- ============================================================ authorization (DIL-06)

create function public.authorize_batch_payment(p_shipment uuid, p_batch_digest text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_res jsonb;
  v_batch text;
  v_id uuid;
  v_expires timestamptz := now() + interval '5 minutes';
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  -- Share-lock the caller's membership so a concurrent demotion serializes with this check.
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  v_res := private.compute_unpaid_batch(v_tenant, p_shipment, false);
  if coalesce(p_batch_digest, '') <> (v_res->>'batch_digest') then
    raise exception 'batch_digest_mismatch' using errcode = '55000';
  end if;
  v_batch := v_res->>'batch';

  -- An earlier request may already be on the wire or unresolved: no new spend is authorized, the
  -- Worker reconciles the original attempt instead.
  if exists (select 1 from private.batch_payment_attempts a
      where a.tenant_id = v_tenant and a.batch_code = v_batch and a.state in ('sent', 'unknown')) then
    perform private.audit('shipment.batch_pay', v_tenant, null, null, 'authorization_withheld',
      jsonb_build_object('shipment', p_shipment, 'batch', v_batch, 'batch_digest', p_batch_digest, 'reason', 'payment_unresolved'));
    return jsonb_build_object('authorized', false, 'reason', 'payment_unresolved', 'batch', v_batch);
  end if;

  update private.batch_payment_authorizations
    set superseded_at = now()
    where tenant_id = v_tenant and shipment_id = p_shipment and batch_digest = p_batch_digest
      and consumed_at is null and superseded_at is null;
  insert into private.batch_payment_authorizations (tenant_id, shipment_id, batch_code, batch_digest, actor, expires_at)
    values (v_tenant, p_shipment, v_batch, p_batch_digest, (select auth.uid()), v_expires)
    returning id into v_id;
  perform private.audit('shipment.batch_pay', v_tenant, null, null, 'authorized',
    jsonb_build_object('authorization', v_id, 'shipment', p_shipment, 'batch', v_batch, 'batch_digest', p_batch_digest,
      'expires_at', v_expires, 'member_count', v_res->'member_count', 'total_charge_idr', v_res->'total_charge_idr'));
  return jsonb_build_object('authorized', true, 'authorization_id', v_id, 'expires_at', v_expires,
    'batch', v_batch, 'batch_digest', p_batch_digest);
end $$;

-- ============================================================ machine claim, mark, finish, release

drop function public.dispatch_release_batch_payment(uuid, uuid);

create or replace function public.dispatch_begin_batch_payment(p_tenant uuid default null, p_shipment uuid default null, p_batch_digest text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  v_batch text;
  t public.tenants;
  a private.batch_payment_attempts;
  v_auth private.batch_payment_authorizations;
  v_res jsonb;
  v_attempt uuid := gen_random_uuid();
begin
  if p_tenant is null and p_shipment is not null then
    v_shipment := p_shipment;
    select tenant_id into v_tenant from public.shipments where id = v_shipment;
  else
    v_tenant := p_tenant;
    v_shipment := p_shipment;
  end if;
  if v_tenant is null or v_shipment is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select o.provider_batch into v_batch from public.provider_operations o
    where o.tenant_id = v_tenant and o.shipment_id = v_shipment and o.kind = 'create_order' and not o.is_simulated
    order by o.created_at desc limit 1;
  if not exists (select 1 from public.shipments where tenant_id = v_tenant and id = v_shipment) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- An unresolved sent/unknown attempt is reconciled, never paid again: no authorization is
  -- consumed and nothing is spent. (Read only: this runs before the member locks, and the attempt
  -- row is locked after them.)
  if v_batch is not null then
    select * into a from private.batch_payment_attempts
      where tenant_id = v_tenant and batch_code = v_batch and state in ('sent', 'unknown');
    if found then
      return private.batch_attempt_payload(a, 'reconcile');
    end if;
  end if;

  -- Lock order: member operations -> member shipments (inside compute) -> tenant -> attempts.
  v_res := private.compute_unpaid_batch(v_tenant, v_shipment, true);
  select * into t from public.tenants where id = v_tenant for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if t.is_demo or t.lifecycle <> 'active' then
    raise exception 'tenant_not_active' using errcode = '55000';
  end if;
  if exists (select 1 from public.provider_operations o where o.tenant_id = v_tenant and not o.is_simulated
      and (o.state = 'in_flight' or (o.state = 'unknown' and o.dispatched_at > now() - interval '5 minutes')))
     or private.payment_busy(v_tenant) then
    raise exception 'account_busy' using errcode = '55P03';
  end if;
  if coalesce(p_batch_digest, '') <> (v_res->>'batch_digest') then
    raise exception 'batch_digest_mismatch' using errcode = '55000';
  end if;
  v_batch := v_res->>'batch';

  -- Under the tenant lock: a claim that sent nothing and whose lease ran out is freed; a sent or
  -- unknown one (a racing claim got there first) is reconciled, not replaced.
  update private.batch_payment_attempts set state = 'released', resolved_at = now(), updated_at = now()
    where tenant_id = v_tenant and batch_code = v_batch and state = 'claimed' and lease_expires_at <= now();
  select * into a from private.batch_payment_attempts
    where tenant_id = v_tenant and batch_code = v_batch and state in ('claimed', 'sent', 'unknown');
  if found then
    if a.state = 'claimed' then
      raise exception 'account_busy' using errcode = '55P03';
    end if;
    return private.batch_attempt_payload(a, 'reconcile');
  end if;

  -- Exactly one matching, unexpired, unused authorization is consumed (single use), and the
  -- authorizing admin must still be an active tenant admin (a demotion in between voids it).
  select * into v_auth from private.batch_payment_authorizations
    where tenant_id = v_tenant and shipment_id = v_shipment and batch_digest = p_batch_digest
      and consumed_at is null and superseded_at is null and expires_at > now()
    order by created_at desc limit 1 for update;
  if not found then
    raise exception 'authorization_required' using errcode = '42501';
  end if;
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = v_auth.actor for share;
  if not exists (select 1 from public.memberships m
      where m.tenant_id = v_tenant and m.user_id = v_auth.actor and m.role = 'tenant_admin' and m.status = 'active') then
    raise exception 'authorization_required' using errcode = '42501';
  end if;

  begin
    insert into private.batch_payment_attempts (id, tenant_id, claim_operation_id, batch_code, batch_object_id, courier,
        batch_digest, authorization_id, authorized_by, state, lease_expires_at)
      values (v_attempt, v_tenant, (v_res->>'claim_operation_id')::uuid, v_batch, v_res->>'batch_id', v_res->>'courier',
        p_batch_digest, v_auth.id, v_auth.actor, 'claimed', now() + interval '2 minutes')
      returning * into a;
  exception when unique_violation then
    raise exception 'account_busy' using errcode = '55P03';
  end;
  update private.batch_payment_authorizations set consumed_at = now(), consumed_by_attempt = a.id where id = v_auth.id;
  perform private.audit('shipment.batch_pay', v_tenant, v_auth.actor, null, 'claimed',
    jsonb_build_object('attempt', a.id, 'authorization', v_auth.id, 'authorized_by', v_auth.actor, 'shipment', v_shipment,
      'batch', v_batch, 'batch_digest', p_batch_digest, 'member_count', v_res->'member_count',
      'total_charge_idr', v_res->'total_charge_idr'));

  return v_res || private.batch_attempt_payload(a, 'pay');
end $$;

-- Write-ahead record, fenced to the attempt: the Worker may send POST /order/pay-unpaid only after
-- this succeeds. It fixes the object id the request carries on the attempt (a stored id must match;
-- a missing one, from an operation recorded before ids were kept, comes from the provider read) and
-- moves the attempt to "sent".
create function public.dispatch_mark_batch_payment_sent(p_attempt uuid, p_batch_object_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  a private.batch_payment_attempts;
begin
  if p_batch_object_id is null or p_batch_object_id !~ '^[a-f0-9]{24}$' then
    raise exception 'invalid_batch_id' using errcode = '22023';
  end if;
  select * into a from private.batch_payment_attempts where id = p_attempt for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- A claim that is no longer current (released, lease ran out, already sent) must not send.
  if a.state <> 'claimed' or a.lease_expires_at <= now() then
    raise exception 'stale_attempt' using errcode = '55000';
  end if;
  if a.batch_object_id is not null and a.batch_object_id <> p_batch_object_id then
    raise exception 'batch_scope_mismatch' using errcode = '55000';
  end if;
  if exists (select 1 from public.provider_operations o
      where o.tenant_id = a.tenant_id and o.provider_batch = a.batch_code
        and o.provider_batch_id is not null and o.provider_batch_id <> p_batch_object_id) then
    raise exception 'batch_scope_mismatch' using errcode = '55000';
  end if;
  update private.batch_payment_attempts
    set state = 'sent', sent_at = now(), batch_object_id = p_batch_object_id, updated_at = now()
    where id = a.id;
  perform private.audit('shipment.batch_pay', a.tenant_id, a.authorized_by, null, 'sent',
    jsonb_build_object('attempt', a.id, 'batch', a.batch_code, 'batch_digest', a.batch_digest));
  return jsonb_build_object('state', 'sent', 'batch_id', p_batch_object_id);
end $$;

-- Ends a sent/unknown attempt. paid is only accepted when no member of the batch is still unpaid
-- (the database re-checks; the Worker's word is not enough). unknown keeps blocking. rejected is
-- the provider's definite refusal (or a local refusal before any request): nothing was paid.
create function public.dispatch_finish_batch_payment(p_attempt uuid, p_outcome text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  a private.batch_payment_attempts;
begin
  if p_outcome not in ('paid', 'unknown', 'rejected') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  select * into a from private.batch_payment_attempts where id = p_attempt for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if a.state = p_outcome and a.state in ('paid', 'unknown', 'rejected') then
    return jsonb_build_object('state', a.state, 'replayed', true);
  end if;
  if a.state not in ('sent', 'unknown') then
    raise exception 'stale_attempt' using errcode = '55000';
  end if;
  if p_outcome = 'rejected' and a.state = 'unknown' then
    -- An attempt whose answer was lost can never be concluded "refused" afterwards.
    raise exception 'invalid_transition' using errcode = '55000';
  end if;
  if p_outcome = 'paid' and exists (
      select 1 from public.provider_operations o
      join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
      where o.tenant_id = a.tenant_id and o.provider_batch = a.batch_code and sh.payment_state = 'unpaid') then
    raise exception 'members_not_paid' using errcode = '55000';
  end if;
  update private.batch_payment_attempts
    set state = p_outcome, updated_at = now(), resolved_at = case when p_outcome = 'unknown' then null else now() end
    where id = a.id;
  perform private.audit('shipment.batch_pay', a.tenant_id, a.authorized_by, null, p_outcome,
    jsonb_build_object('attempt', a.id, 'batch', a.batch_code, 'batch_digest', a.batch_digest));
  return jsonb_build_object('state', p_outcome, 'replayed', false);
end $$;

-- Releases a claim that sent nothing. Fenced: a sent/unknown/final attempt is left untouched (the
-- call reports its state), so a late or repeated release can never reopen a batch for payment.
create function public.dispatch_release_batch_payment(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  a private.batch_payment_attempts;
begin
  select * into a from private.batch_payment_attempts where id = p_attempt for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if a.state = 'claimed' then
    update private.batch_payment_attempts set state = 'released', resolved_at = now(), updated_at = now() where id = a.id;
    perform private.audit('shipment.batch_pay', a.tenant_id, a.authorized_by, null, 'released',
      jsonb_build_object('attempt', a.id, 'batch', a.batch_code, 'batch_digest', a.batch_digest));
    return jsonb_build_object('state', 'released', 'released', true);
  end if;
  return jsonb_build_object('state', a.state, 'released', a.state = 'released');
end $$;

-- ============================================================ per-order record

create or replace function public.dispatch_record_payment(p_operation uuid, p_order_id text, p_paid boolean,
  p_tracking text default null, p_price bigint default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  op public.provider_operations;
begin
  op := private.lock_real_operation(p_operation);
  if op.state <> 'succeeded' or op.provider_order_id is distinct from p_order_id then
    raise exception 'already_recorded' using errcode = '55000';
  end if;
  if p_paid then
    if p_tracking is null or p_tracking !~ '^[A-Za-z0-9-]{6,40}$' then
      raise exception 'missing_identity' using errcode = '22023';
    end if;
    return public.dispatch_record(p_operation, op.attempts, 'issued', p_order_id, p_tracking, op.provider_batch, null, 'ISSUED', p_price, null);
  end if;
  -- An unpaid read proves nothing about an earlier payment request: only the time of the check is
  -- recorded; the attempt row keeps blocking a second payment.
  update public.provider_operations
    set last_checked_at = now(), updated_at = now()
    where id = op.id;
  return jsonb_build_object('state', op.state, 'paid', false, 'replayed', false,
    'price_mismatch', private.record_provider_price(op, p_price));
end $$;

-- ============================================================ claim busy check, record with object id

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
  select version into v_version from private.seller_credentials
    where tenant_id = op.tenant_id and superseded_at is null;
  if v_version is null then
    raise exception 'credential_missing' using errcode = '55000';
  end if;
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

-- dispatch_record gains p_batch_id (the provider batch object id, stored next to the batch code),
-- and a paid outcome settles the batch's open payment attempts. The previous 10-argument version
-- is replaced.
drop function public.dispatch_record(uuid, integer, text, text, text, text, text, text, bigint, text);
create function public.dispatch_record(p_operation uuid, p_attempt integer, p_outcome text,
  p_order_id text default null, p_tracking text default null, p_batch text default null,
  p_record_id text default null, p_code text default null, p_price bigint default null,
  p_detail text default null, p_batch_id text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  v_op_state text;
  v_ship_state text;
  v_payment text;
  v_detail text;
  v_provider_detail text := left(nullif(btrim(coalesce(p_detail, '')), ''), 500);
begin
  if p_outcome not in ('issued', 'unpaid', 'failed', 'rejected', 'unknown', 'not_created') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  if p_batch_id is not null and p_batch_id !~ '^[a-f0-9]{24}$' then
    raise exception 'invalid_batch_id' using errcode = '22023';
  end if;
  op := private.lock_real_operation(p_operation);

  -- An unpaid order (created unpaid, reconciled or corrected) that has since been paid gets its
  -- resi (same provider order only).
  if op.state = 'succeeded' and p_outcome = 'issued' and op.provider_order_id = p_order_id
     and p_tracking ~ '^[A-Za-z0-9-]{6,40}$' and exists (select 1 from public.shipments s
       where s.tenant_id = op.tenant_id and s.id = op.shipment_id and s.payment_state = 'unpaid') then
    update public.provider_operations set result_code = 'ISSUED',
      provider_batch_id = coalesce(p_batch_id, provider_batch_id), updated_at = now() where id = op.id;
    update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = p_tracking,
      issued_at = coalesce(issued_at, now()), updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'issued', 'Resi ' || p_tracking);
    perform private.settle_batch_attempts(op.tenant_id, op.provider_batch);
    return jsonb_build_object('state', 'succeeded', 'replayed', false, 'price_mismatch', private.record_provider_price(op, p_price));
  end if;
  -- A conclusion drawn by reconciliation ("not created", or a provider error item) is corrected
  -- when the order turns up after all (a late original answer or a later lookup): the money was
  -- spent, so the shipment must show it (TD-3: an expired lease is not proof the provider stopped).
  if op.state = 'failed' and op.result_code in ('NOT_CREATED', 'PROVIDER_ERROR_ITEM')
     and p_outcome in ('issued', 'unpaid') and p_order_id is not null and p_batch is not null
     and (p_outcome = 'unpaid' or p_tracking ~ '^[A-Za-z0-9-]{6,40}$') then
    update public.provider_operations set state = 'succeeded', result_code = 'CORRECTED',
      provider_order_id = p_order_id, provider_batch = p_batch,
      provider_batch_id = coalesce(p_batch_id, provider_batch_id), provider_error_detail = null,
      updated_at = now() where id = op.id;
    update public.shipments set
      submission_state = case when p_outcome = 'issued' then 'issued' else 'awaiting_payment' end,
      payment_state = case when p_outcome = 'issued' then 'paid' else 'unpaid' end,
      awb = case when p_outcome = 'issued' then p_tracking else null end,
      issued_at = case when p_outcome = 'issued' then now() else null end, updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'outcome_corrected',
      case when p_outcome = 'issued' then 'Order Mengantar ditemukan: resi ' || p_tracking
        else 'Order Mengantar ditemukan, menunggu pembayaran saldo' end);
    if p_outcome = 'issued' then
      perform private.settle_batch_attempts(op.tenant_id, p_batch);
    end if;
    return jsonb_build_object('state', 'succeeded', 'replayed', false, 'price_mismatch', private.record_provider_price(op, p_price));
  end if;
  if op.state in ('succeeded', 'failed') then
    if (op.state = 'succeeded' and p_outcome in ('issued', 'unpaid') and op.provider_order_id = p_order_id)
       or (op.state = 'failed' and p_outcome in ('failed', 'rejected', 'not_created')) then
      return jsonb_build_object('state', op.state, 'replayed', true);
    end if;
    raise exception 'already_recorded' using errcode = '55000';
  end if;
  if op.state = 'in_flight' then
    if op.attempts <> p_attempt then
      raise exception 'stale_attempt' using errcode = '55000';
    end if;
    if p_outcome = 'not_created' then
      raise exception 'invalid_outcome' using errcode = '22023';
    end if;
  elsif op.state = 'unknown' then
    if p_outcome = 'unknown' then
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
    provider_batch_id = coalesce(p_batch_id, provider_batch_id),
    provider_record_id = coalesce(p_record_id, provider_record_id),
    provider_error_detail = case when p_outcome in ('rejected', 'failed') then coalesce(v_provider_detail, provider_error_detail) else null end,
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
    when 'rejected' then case when v_provider_detail is not null then 'Ditolak Mengantar: ' || left(v_provider_detail, 250) else 'Ditolak Mengantar' end
    when 'not_created' then 'Order tidak dibuat di Mengantar'
    else 'Hasil pengiriman ke Mengantar belum diketahui' end;
  perform private.add_event(op.tenant_id, op.shipment_id,
    case p_outcome when 'issued' then 'issued' when 'unknown' then 'outcome_unknown' else p_outcome end, v_detail);
  if p_outcome = 'issued' then
    perform private.settle_batch_attempts(op.tenant_id, coalesce(p_batch, op.provider_batch));
  end if;
  return jsonb_build_object('state', v_op_state, 'replayed', false,
    'price_mismatch', p_outcome in ('issued', 'unpaid') and private.record_provider_price(op, p_price));
end $$;

-- ============================================================ grants

revoke all on function private.payment_busy(uuid), private.settle_batch_attempts(uuid, text),
  private.batch_attempt_payload(private.batch_payment_attempts, text)
  from public, anon, authenticated;

revoke all on function public.authorize_batch_payment(uuid, text) from public, anon;
grant execute on function public.authorize_batch_payment(uuid, text) to authenticated;

revoke all on function
  public.dispatch_record(uuid, integer, text, text, text, text, text, text, bigint, text, text),
  public.dispatch_mark_batch_payment_sent(uuid, text),
  public.dispatch_finish_batch_payment(uuid, text),
  public.dispatch_release_batch_payment(uuid)
  from public, anon, authenticated;

grant execute on function
  public.dispatch_record(uuid, integer, text, text, text, text, text, text, bigint, text, text),
  public.dispatch_mark_batch_payment_sent(uuid, text),
  public.dispatch_finish_batch_payment(uuid, text),
  public.dispatch_release_batch_payment(uuid)
  to service_role;
