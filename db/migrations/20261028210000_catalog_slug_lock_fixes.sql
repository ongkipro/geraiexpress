-- Review fixes for waves A and B.
--
--  * B1 (DIL-14): the batch payment claim locked the tenant row and then the authorizing admin's
--    membership row, while the tenant-admin commands lock memberships first and the tenant second: a
--    lock order inversion that PostgreSQL resolves with 40P01. The claim now locks the membership
--    BEFORE the tenant row.
--  * B2: a payment the Worker marked unknown seconds after the POST no longer frees the seller:
--    sent AND unknown attempts keep the seller busy for two minutes after the request was sent.
--  * B3: dispatch_finish_batch_payment receives the provider's paid count and audits a mismatch with
--    the number of orders that were unpaid when the attempt was claimed.
--  * A3 (T-049, review M1): make_slug takes the global advisory lock only for real tenants; the
--    shipment prefix is derived from letters only, never contains the blocked keyword or the demo
--    prefix, and is UNIQUE across real tenants (demo tenants share DEMO).

-- ============================================================ B2: busy window

create or replace function private.payment_busy(p_tenant uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.batch_payment_attempts a
    where a.tenant_id = p_tenant
      and ((a.state = 'claimed' and a.lease_expires_at > now())
        or (a.state in ('sent', 'unknown') and a.sent_at > now() - interval '2 minutes')));
$$;

-- ============================================================ B1 + B3: claim and finish

-- The number of orders that were unpaid when the attempt was claimed; the provider's paid count is
-- compared with it when the attempt is finished. Older attempts have no count (null: not compared).
alter table private.batch_payment_attempts
  add column unpaid_count integer check (unpaid_count >= 0);

-- Same behavior as the definition in 20261028130000, with two changes: the authorizing admin's
-- membership row is share-locked BEFORE the tenant row (lock order: operations -> shipments ->
-- membership -> tenant -> attempts/authorizations, matching the tenant-admin commands that lock
-- memberships and then the tenant), and the attempt records how many orders were unpaid.
create or replace function public.dispatch_begin_batch_payment(p_tenant uuid default null, p_shipment uuid default null, p_batch_digest text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  v_batch text;
  v_actor uuid;
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

  -- Lock order: member operations -> member shipments (inside compute) -> the authorizing admin's
  -- membership -> tenant -> attempts/authorizations.
  v_res := private.compute_unpaid_batch(v_tenant, v_shipment, true);
  -- The authorization is read without a lock only to learn whose membership to lock; the row itself
  -- is locked below, after the tenant, and must still name the same admin.
  select actor into v_actor from private.batch_payment_authorizations
    where tenant_id = v_tenant and shipment_id = v_shipment and batch_digest = p_batch_digest
      and consumed_at is null and superseded_at is null and expires_at > now()
    order by created_at desc limit 1;
  if v_actor is not null then
    perform 1 from public.memberships where tenant_id = v_tenant and user_id = v_actor for share;
  end if;
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
  -- A different admin authorized between the unlocked read and the lock: that membership was not
  -- locked in order, so the claim is retried instead of locking it out of order.
  if v_auth.actor is distinct from v_actor then
    raise exception 'account_busy' using errcode = '55P03';
  end if;
  if not exists (select 1 from public.memberships m
      where m.tenant_id = v_tenant and m.user_id = v_auth.actor and m.role = 'tenant_admin' and m.status = 'active') then
    raise exception 'authorization_required' using errcode = '42501';
  end if;

  begin
    insert into private.batch_payment_attempts (id, tenant_id, claim_operation_id, batch_code, batch_object_id, courier,
        batch_digest, authorization_id, authorized_by, state, lease_expires_at, unpaid_count)
      values (v_attempt, v_tenant, (v_res->>'claim_operation_id')::uuid, v_batch, v_res->>'batch_id', v_res->>'courier',
        p_batch_digest, v_auth.id, v_auth.actor, 'claimed', now() + interval '2 minutes',
        (select count(*)::integer from jsonb_array_elements(v_res->'members') m where m->>'payment_state' = 'unpaid'))
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

-- Replaces the 2-argument version so exactly one overload exists. p_paid_count is the number of
-- orders the provider reported paid for the request; when it differs from the number of orders that
-- were unpaid at the claim, a count_mismatch audit row and a shipment event record it. The outcome
-- itself is still decided by the per-order state the database holds, never by the count.
drop function public.dispatch_finish_batch_payment(uuid, text);
create function public.dispatch_finish_batch_payment(p_attempt uuid, p_outcome text, p_paid_count integer default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  a private.batch_payment_attempts;
  v_shipment uuid;
  v_mismatch boolean;
begin
  if p_outcome not in ('paid', 'unknown', 'rejected') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  if p_paid_count is not null and p_paid_count < 0 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;
  -- The mismatch event touches the claim shipment, which sits before the attempt in the lock order
  -- (operations -> shipments -> tenant -> attempts): take its share lock first.
  if p_paid_count is not null then
    select o.shipment_id into v_shipment from private.batch_payment_attempts t
      join public.provider_operations o on o.id = t.claim_operation_id where t.id = p_attempt;
    if v_shipment is not null then
      perform 1 from public.shipments sh where sh.id = v_shipment for share;
    end if;
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
  v_mismatch := p_paid_count is not null and a.unpaid_count is not null and p_outcome in ('paid', 'unknown')
    and p_paid_count <> a.unpaid_count;
  if v_mismatch then
    perform private.audit('shipment.batch_pay', a.tenant_id, a.authorized_by, null, 'count_mismatch',
      jsonb_build_object('attempt', a.id, 'batch', a.batch_code, 'batch_digest', a.batch_digest,
        'outcome', p_outcome, 'unpaid_count', a.unpaid_count, 'provider_paid_count', p_paid_count));
    if v_shipment is not null then
      perform private.add_event(a.tenant_id, v_shipment, 'payment_count_mismatch',
        'Mengantar melaporkan ' || p_paid_count || ' pesanan terbayar, diharapkan ' || a.unpaid_count);
    end if;
  end if;
  return jsonb_build_object('state', p_outcome, 'replayed', false, 'count_mismatch', v_mismatch);
end $$;

revoke all on function private.payment_busy(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_begin_batch_payment(uuid, uuid, text),
  public.dispatch_finish_batch_payment(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.dispatch_begin_batch_payment(uuid, uuid, text),
  public.dispatch_finish_batch_payment(uuid, text, integer) to service_role;

-- ============================================================ A3: slug lock, prefix rules

-- The advisory lock exists to keep two simultaneous approvals from choosing the same slug. Demo
-- slugs are random (demo-<8 hex>) and rely on the unique key, so demo creation never queues behind
-- real approvals.
create or replace function private.make_slug(p_name text, p_demo boolean)
returns text language plpgsql volatile set search_path = ''
as $$
declare
  v_kw constant text := 'c' || 'u' || 'a' || 'n';
  v_base text;
  v_cand text;
  v_suffix text;
  n integer := 1;
begin
  if p_demo then
    loop
      v_cand := 'demo-' || substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 8);
      exit when not exists (select 1 from public.tenants where slug = v_cand);
    end loop;
    return v_cand;
  end if;
  perform pg_advisory_xact_lock(hashtext('gx.tenant_slug'));
  v_base := lower(translate(coalesce(p_name, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  while position(v_kw in v_base) > 0 loop
    v_base := replace(v_base, v_kw, '');
  end loop;
  v_base := trim(both '-' from regexp_replace(v_base, '-+', '-', 'g'));
  v_base := trim(both '-' from left(v_base, 32));
  if v_base = '' then v_base := 'gerai'; end if;
  loop
    if n = 1 then
      v_cand := v_base;
    else
      v_suffix := '-' || n::text;
      v_cand := trim(trailing '-' from left(v_base, 32 - length(v_suffix))) || v_suffix;
    end if;
    if private.slug_is_valid(v_cand) and not exists (select 1 from public.tenants where slug = v_cand) then
      return v_cand;
    end if;
    n := n + 1;
    if n > 9999 then raise exception 'slug_unavailable' using errcode = '55000'; end if;
  end loop;
end $$;

-- Prefix of a real tenant: 3 to 5 upper-case letters from the slug's letters, unique among real
-- tenants, never the demo prefix and never containing the blocked keyword (the keyword can appear
-- across words, "cu-an-...", because the letters of the slug are joined). Candidates in order: the
-- first 4 letters, the first 5, other 4 and 5 letter windows of the slug's letters, then a
-- letter-only suffix scheme (3 letters + 1, 4 letters + 1, 3 letters + 2). The caller holds the
-- advisory lock, so the check and the insert do not race; the partial unique index is the backstop.
create function private.derive_shipment_prefix(p_slug text, p_tenant uuid)
returns text language plpgsql volatile set search_path = ''
as $$
declare
  v_kw constant text := 'c' || 'u' || 'a' || 'n';
  v_letters text := upper(regexp_replace(coalesce(p_slug, ''), '[^a-z]', '', 'g'));
  v_prefix text;
begin
  if length(v_letters) < 3 then v_letters := rpad(v_letters, 3, 'GEX'); end if;
  select c.cand into v_prefix from (
    select left(v_letters, 4) as cand, 1 as ord
    union all select left(v_letters, 5), 2 where length(v_letters) >= 5
    union all select substr(v_letters, o, 4), 10 + o from generate_series(2, length(v_letters) - 3) o
    union all select substr(v_letters, o, 5), 100 + o from generate_series(2, length(v_letters) - 4) o
    union all select left(v_letters, 3) || chr(64 + x), 1000 + x from generate_series(1, 26) x
    union all select left(v_letters, 4) || chr(64 + x), 2000 + x from generate_series(1, 26) x where length(v_letters) >= 4
    union all select left(v_letters, 3) || chr(64 + x) || chr(64 + y), 3000 + x * 26 + y
      from generate_series(1, 26) x, generate_series(1, 26) y
  ) c
  where c.cand ~ '^[A-Z]{3,5}$' and position(v_kw in lower(c.cand)) = 0 and c.cand <> 'DEMO'
    and not exists (select 1 from public.tenants t
      where t.shipment_prefix = c.cand and not t.is_demo and t.id is distinct from p_tenant)
  order by c.ord limit 1;
  if v_prefix is null then
    raise exception 'prefix_unavailable' using errcode = '55000';
  end if;
  return v_prefix;
end $$;

create or replace function private.tenants_identity_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.slug is not null and new.slug is distinct from old.slug then
      raise exception 'slug_immutable' using errcode = '55000';
    end if;
    if old.shipment_prefix is not null and new.shipment_prefix is distinct from old.shipment_prefix then
      raise exception 'prefix_immutable' using errcode = '55000';
    end if;
  end if;
  if new.slug is null then
    new.slug := private.make_slug(new.name, new.is_demo);
  elsif (tg_op = 'INSERT' or old.slug is null) and not private.slug_is_valid(new.slug) then
    raise exception 'slug_invalid' using errcode = '23514';
  end if;
  if new.shipment_prefix is null then
    if new.is_demo then
      new.shipment_prefix := 'DEMO';
    else
      perform pg_advisory_xact_lock(hashtext('gx.tenant_slug'));
      new.shipment_prefix := private.derive_shipment_prefix(new.slug, new.id);
    end if;
  end if;
  return new;
end $$;

drop function private.slug_prefix(text);

-- One-time re-derivation of real tenants whose prefix is shared with an earlier tenant (created_at,
-- id order: the earliest keeps it), is the demo prefix or contains the blocked keyword.
--
-- The prefix is immutable (tenants_identity), so the identity trigger is disabled for this block
-- only and enabled again before it ends; the migration runs in one transaction, so no other session
-- ever sees it disabled. This is safe because no reference in the PREFIX-yymmdd-seq shape has been
-- issued in any shared environment: the block RAISES if a tenant whose prefix would change already
-- has a shipment reference of that shape, instead of changing the prefix silently. Old-shape
-- references (GX<yymmdd>-<6 chars>) and other values are not touched and never carry a prefix.
do $backfill$
declare
  t record;
  v_kw constant text := 'c' || 'u' || 'a' || 'n';
  v_new text;
begin
  alter table public.tenants disable trigger tenants_identity;
  for t in select id, slug, shipment_prefix, created_at from public.tenants where not is_demo order by created_at, id loop
    if position(v_kw in lower(t.shipment_prefix)) > 0 or t.shipment_prefix = 'DEMO' or exists (
        select 1 from public.tenants o
        where o.id <> t.id and not o.is_demo and o.shipment_prefix = t.shipment_prefix
          and (o.created_at, o.id) < (t.created_at, t.id)) then
      if exists (select 1 from public.shipments s
          where s.tenant_id = t.id and s.reference ~ ('^' || t.shipment_prefix || '-[0-9]{6}-[0-9]{3,}$')) then
        raise exception 'prefix_rederivation_blocked: tenant % has issued references with prefix %', t.id, t.shipment_prefix
          using errcode = '55000';
      end if;
      v_new := private.derive_shipment_prefix(t.slug, t.id);
      update public.tenants set shipment_prefix = v_new where id = t.id;
    end if;
  end loop;
  alter table public.tenants enable trigger tenants_identity;
end $backfill$;

alter table public.tenants
  add constraint tenants_shipment_prefix_safe check (
    position(('c' || 'u' || 'a' || 'n') in lower(shipment_prefix)) = 0
    and (is_demo or shipment_prefix <> 'DEMO'));

create unique index tenants_shipment_prefix_real_key on public.tenants (shipment_prefix) where not is_demo;

revoke all on function private.make_slug(text, boolean), private.derive_shipment_prefix(text, uuid),
  private.tenants_identity_guard() from public, anon, authenticated;
