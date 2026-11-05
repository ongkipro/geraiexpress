-- T-104 / NFR-1: forward-only database hardening from the independent DB review (lock order, stale
-- membership, machine table writes, pilot-report range scans) and the ops review (OTP housekeeping).
-- Function bodies are recreated from their latest definition; only the noted lines change.
-- Signatures, SECURITY DEFINER, `set search_path = ''` and ACLs are retained, except
-- auth_purge_expired, which gains a batch-size parameter (dropped and recreated, machine-only).
--
-- Lock order for every RPC that locks a shipment and memberships: operations -> shipments ->
-- memberships -> tenant -> the rest. A cheap unlocked authorization check comes first (outsiders
-- never lock another tenant's rows); the authoritative check runs after the locks.

-- ============================================================ stale membership after a lock wait

-- Latest body: 20261013170000_foundation.sql. The FOR UPDATE can wait behind another transaction;
-- a membership revoked (or the row deleted) meanwhile is seen here (READ COMMITTED: each statement
-- takes a new snapshot), so a revoked member never writes after the wait. Both refusals are P0002.
create or replace function private.lock_member_shipment(p_shipment uuid)
returns public.shipments language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.shipments;
begin
  select tenant_id into v_tenant from public.shipments where id = p_shipment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  select * into s from public.shipments where tenant_id = v_tenant and id = p_shipment for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  return s;
end $$;

-- ============================================================ shipment -> membership lock order

-- Latest body: 20261105140000_tracking_links.sql. Previously the tenant memberships were locked
-- (require_tenant_admin_locked) before the shipment, the reverse of void_counter_payment and the
-- batch-payment paths: a concurrent void could deadlock (40P01). Now: cheap admin check, shipment
-- lock, then the authoritative membership-locked admin check.
create or replace function public.revoke_tracking_link(p_shipment uuid, p_link uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare s public.shipments;
begin
  select * into s from public.shipments where id = p_shipment;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if private.member_role(s.tenant_id) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  perform 1 from public.shipments where tenant_id = s.tenant_id and id = s.id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_tenant_admin_locked(s.tenant_id);
  update public.tracking_links set revoked_at = now(), revoked_by = (select auth.uid())
    where tenant_id = s.tenant_id and shipment_id = s.id and link_id = p_link and revoked_at is null;
  if found then
    update private.tracking_token_hashes h set retired_at = coalesce(h.retired_at, now())
      from public.tracking_links t where t.tenant_id = s.tenant_id and t.shipment_id = s.id and h.token_hash = t.token_hash;
    perform private.audit('tracking.revoke', s.tenant_id, null, null, 'revoked', jsonb_build_object('shipment', s.id));
  elsif not exists (select 1 from public.tracking_links where tenant_id = s.tenant_id
      and shipment_id = s.id and link_id = p_link and revoked_at is not null) then
    -- Idempotent for the same revoked generation, never falsely report a newer one as revoked.
    raise exception 'stale_state' using errcode = '55000';
  end if;
end $$;

-- Latest body: 20261014140000_invitations.sql. The caller's membership share lock moves after the
-- shipment lock (it was taken before it, the reverse of void_counter_payment's shipment -> memberships).
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
  s := private.lock_member_shipment(p_shipment);
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  select * into op from public.provider_operations
    where tenant_id = s.tenant_id and shipment_id = s.id and kind = 'create_order' for update;
  if not found or op.state not in ('unknown', 'in_flight', 'queued') then
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

-- ============================================================ machine table privileges

-- The foundation default ACL grants ALL on every new public table to service_role (BYPASSRLS). The
-- machine identity writes only through SECURITY DEFINER RPCs; its one direct table access is the
-- credential rewrap's tenant list (src/lib/credential-keyring.ts listTenantIds: SELECT id FROM
-- public.tenants). Everything else is revoked, so for example label history cannot be inserted
-- around record_label_print's membership, masking and acknowledgement checks.
revoke all on public.audit_events, public.contact_addresses, public.contacts, public.gerai_discount_terms,
  public.invoice_snapshots, public.label_jobs, public.label_print_events, public.label_snapshots,
  public.memberships, public.outlets, public.platform_grants, public.provider_operations,
  public.shipment_events, public.shipment_quotes, public.shipments, public.tenant_applications,
  public.tenant_invitations, public.tenants
  from service_role;
grant select on public.tenants to service_role;

-- ============================================================ pilot report range

create index shipments_issued_at_idx on public.shipments (tenant_id, issued_at) where issued_at is not null;
create index counter_payments_active_recorded_idx on public.counter_payments (tenant_id, recorded_at)
  where voided_at is null;

-- Latest body: 20261105160000_pilot_report.sql. Only `scoped` changes to NOT MATERIALIZED: it is
-- referenced twice, so PostgreSQL materialized the tenant's lifetime shipments before any date
-- filter. Inlined, the issued-date and payment-date predicates reach the indexes above.
create or replace function public.pilot_report(p_tenant uuid, p_from date, p_to date)
returns table (
  row_level text,
  outlet_id uuid,
  outlet_name text,
  day date,
  shipments_issued integer,
  median_draft_to_resi_minutes numeric,
  cash_count integer, cash_idr bigint,
  qris_count integer, qris_idr bigint,
  transfer_count integer, transfer_idr bigint,
  other_count integer, other_idr bigint,
  labelled_shipments integer,
  masked_shipments integer,
  earnings_idr bigint,
  earnings_unknown_count integer,
  data_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_demo boolean;
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.require_member(p_tenant);
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  -- Inclusive WIB days, at most 92 of them.
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 91 then
    raise exception 'report_range_invalid' using errcode = '22023';
  end if;
  select t.is_demo into v_demo from public.tenants t where t.id = p_tenant;
  v_start := p_from::timestamp at time zone 'Asia/Jakarta';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Jakarta';

  return query
  with scoped as not materialized (
    -- Demo split, explicit: a demo gerai reports only its simulated sample shipments, a real gerai only
    -- its non-simulated shipments. The two classes are never mixed in one report.
    select s.tenant_id, s.id, s.outlet_id, s.submission_state, s.created_at, s.issued_at, s.selected_quote_id
    from public.shipments s
    where s.tenant_id = p_tenant
      and ((v_demo and s.is_simulated) or (not v_demo and not s.is_simulated))
  ), issued as (
    select sc.*, q.normal_tariff_idr,
      case when v_demo or q.id is null then null
        else q.normal_tariff_idr - private.quote_gerai_cost(sc.tenant_id, q.id) end as earning,
      ls.mask_sender as latest_mask
    from scoped sc
    left join public.shipment_quotes q on q.tenant_id = sc.tenant_id and q.id = sc.selected_quote_id
    left join lateral (
      select l.mask_sender from public.label_snapshots l
      where l.tenant_id = sc.tenant_id and l.shipment_id = sc.id
      order by l.version desc limit 1
    ) ls on true
    where sc.submission_state = 'issued' and sc.issued_at >= v_start and sc.issued_at < v_end
  ), facts as (
    select i.outlet_id as f_outlet, (i.issued_at at time zone 'Asia/Jakarta')::date as f_day,
      true as is_shipment,
      extract(epoch from (i.issued_at - i.created_at)) / 60.0 as minutes,
      null::text as method, null::bigint as amount,
      i.latest_mask is not null as labelled, coalesce(i.latest_mask, false) as masked,
      i.earning
    from issued i
    union all
    select p.outlet_id, (p.recorded_at at time zone 'Asia/Jakarta')::date, false, null, p.method, p.amount_idr,
      false, false, null
    from public.counter_payments p
    join scoped sc on sc.tenant_id = p.tenant_id and sc.id = p.shipment_id
    where p.tenant_id = p_tenant and p.voided_at is null and p.recorded_at >= v_start and p.recorded_at < v_end
  ), grouped as (
    select f.f_outlet, f.f_day, grouping(f.f_outlet, f.f_day) as g,
      count(*) filter (where f.is_shipment)::integer as n_issued,
      round((percentile_cont(0.5) within group (order by f.minutes::double precision))::numeric, 1) as median_minutes,
      count(*) filter (where f.method = 'cash')::integer as n_cash,
      coalesce(sum(f.amount) filter (where f.method = 'cash'), 0)::bigint as s_cash,
      count(*) filter (where f.method = 'qris')::integer as n_qris,
      coalesce(sum(f.amount) filter (where f.method = 'qris'), 0)::bigint as s_qris,
      count(*) filter (where f.method = 'transfer')::integer as n_transfer,
      coalesce(sum(f.amount) filter (where f.method = 'transfer'), 0)::bigint as s_transfer,
      count(*) filter (where f.method = 'other')::integer as n_other,
      coalesce(sum(f.amount) filter (where f.method = 'other'), 0)::bigint as s_other,
      count(*) filter (where f.labelled)::integer as n_labelled,
      count(*) filter (where f.masked)::integer as n_masked,
      count(*) filter (where f.is_shipment and f.earning is null)::integer as n_unknown,
      sum(f.earning) filter (where f.is_shipment)::bigint as s_earning
    from facts f
    group by grouping sets ((f.f_outlet, f.f_day), (f.f_outlet), ())
  )
  select
    case gr.g when 0 then 'day' when 1 then 'outlet' else 'total' end,
    gr.f_outlet, o.name, gr.f_day, gr.n_issued, gr.median_minutes,
    gr.n_cash, gr.s_cash, gr.n_qris, gr.s_qris, gr.n_transfer, gr.s_transfer, gr.n_other, gr.s_other,
    gr.n_labelled, gr.n_masked,
    case when gr.n_issued > 0 and gr.n_unknown = 0 then gr.s_earning end,
    gr.n_unknown, now()
  from grouped gr
  left join public.outlets o on o.tenant_id = p_tenant and o.id = gr.f_outlet
  -- Per outlet: its days in order, then the outlet total; the grand total last.
  order by case gr.g when 3 then 1 else 0 end, o.name nulls last, gr.f_outlet nulls last,
    gr.g, gr.f_day;
end $$;

-- ============================================================ OTP and session housekeeping

create index otp_codes_created_idx on auth.otp_codes (created_at);
create index sessions_purge_idx on auth.sessions ((least(absolute_expires_at, coalesce(revoked_at, absolute_expires_at))));

-- Latest body: 20261029100000_auth_core.sql. Only the global expired-code delete is removed: a code
-- request no longer inherits the purge backlog or contends over other addresses' rows. Retention is
-- unchanged and owned by auth_purge_expired; the address-local throttles read only recent rows.
create or replace function public.auth_issue_otp(
  p_email text, p_code_hash text, p_requester uuid default null, p_ttl_seconds integer default 600)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user auth.users;
  v_gate jsonb;
  v_ttl integer := least(greatest(coalesce(p_ttl_seconds, 600), 60), 900);
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 254
     or coalesce(p_code_hash, '') !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- An anonymous demo identity can never request mail (PR-31, IAM-8).
  if p_requester is not null and exists (select 1 from auth.users u where u.id = p_requester and u.is_anonymous) then
    return jsonb_build_object('status', 'refused');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('auth_otp:' || v_email, 0));
  select * into v_user from auth.users u where lower(u.email) = v_email and u.deleted_at is null;
  if found then
    if not private.auth_user_active(v_user) then return jsonb_build_object('status', 'refused'); end if;
  else
    v_gate := private.before_user_created(jsonb_build_object('user',
      jsonb_build_object('email', v_email, 'is_anonymous', false, 'user_metadata', '{}'::jsonb)));
    if v_gate ? 'error' then
      return jsonb_build_object('status', 'blocked', 'message', v_gate #>> '{error,message}');
    end if;
  end if;
  -- A cumulative guess budget across codes, so asking for a fresh code does not reset the attempts.
  if (select coalesce(sum(c.attempts), 0) from auth.otp_codes c
        where c.email = v_email and c.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('status', 'throttled');
  end if;
  if exists (select 1 from auth.otp_codes c where c.email = v_email and c.purpose = 'login'
               and c.created_at > now() - interval '30 seconds') then
    return jsonb_build_object('status', 'too_soon');
  end if;
  update auth.otp_codes set consumed_at = now()
    where email = v_email and purpose = 'login' and consumed_at is null;
  insert into auth.otp_codes (email, purpose, code_hash, expires_at)
    values (v_email, 'login', p_code_hash, now() + make_interval(secs => v_ttl));
  return jsonb_build_object('status', 'sent', 'email', v_email);
end $$;

-- Latest body: 20261029100000_auth_core.sql. Same retention (sessions dead for > 7 days, codes older
-- than 1 day), now in bounded batches of at most p_limit rows per table (1..10000, default 1000; a
-- session's retired refresh hashes cascade with it). Rows locked by a live refresh or verification
-- are skipped, never waited for. `remaining` is true when a batch was full: the caller may run
-- another batch; skipped locked rows are left for the next scheduled run.
drop function public.auth_purge_expired();
create function public.auth_purge_expired(p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 10000);
  v_sessions integer;
  v_codes integer;
begin
  with doomed as (
    select s.id from auth.sessions s
    where least(s.absolute_expires_at, coalesce(s.revoked_at, s.absolute_expires_at)) < now() - interval '7 days'
    limit v_limit for update skip locked
  )
  delete from auth.sessions s using doomed d where s.id = d.id;
  get diagnostics v_sessions = row_count;
  with doomed as (
    select c.id from auth.otp_codes c
    where c.created_at < now() - interval '1 day'
    limit v_limit for update skip locked
  )
  delete from auth.otp_codes c using doomed d where c.id = d.id;
  get diagnostics v_codes = row_count;
  return jsonb_build_object('sessions', v_sessions, 'otp_codes', v_codes,
    'remaining', v_sessions >= v_limit or v_codes >= v_limit);
end $$;
revoke all on function public.auth_purge_expired(integer) from public, anon, authenticated;
grant execute on function public.auth_purge_expired(integer) to service_role;

notify pgrst, 'reload schema';
