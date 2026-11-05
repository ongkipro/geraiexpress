-- T-087 / PR-45 / UX-17 item 6 / DATA-11 read model: the pilot report per outlet and WIB day.
--
-- 1. private.quote_gerai_cost(tenant, quote): the per-quote gerai cost body of
--    public.gerai_cost_for_quote (latest body: 20261028220000_discount_ceiling_fix.sql), moved
--    unchanged behind the admin check so the report and the RPC share one derivation (DEC-018).
--    public.gerai_cost_for_quote keeps its signature, ACL, admin check and result.
-- 2. public.pilot_report(tenant, from, to): tenant administrators only. Returns only derived
--    measures; the provider net cost and any observed/assigned percentage never leave the database.
-- 3. public.record_export: same signature/ACL; additionally accepts p_kind 'pilot_report' with the
--    filter keys from/to (audit action export.pilot_report). The 'shipments' kind is unchanged.
--
-- Metric definitions (one row per outlet and WIB day, plus per-outlet and grand totals through
-- GROUPING SETS so medians of totals are exact, never a median of medians):
--   shipments_issued      shipments with submission_state 'issued' and issued_at inside the WIB day.
--                         Real gerai: non-simulated shipments only. Demo gerai: its simulated sample
--                         shipments only (a demo has no real shipment). Never mixed.
--   median_draft_to_resi_minutes  median (percentile_cont 0.5, one decimal) of
--                         issued_at - created_at in minutes over those shipments (draft creation to
--                         resi issuance). NULL when no shipment.
--   payment mix           active (voided_at is null) counter payments by method, counted on the WIB
--                         day of recorded_at and the payment's outlet; only payments of shipments of
--                         the same real/simulated class as above.
--   labelled_shipments / masked_shipments  among the issued shipments, those with at least one label
--                         snapshot / whose LATEST snapshot (highest version) has mask_sender. The
--                         masked-label share is masked / labelled (computed by the caller).
--   earnings_idr          sum over the issued shipments of normal_tariff_idr of the selected quote minus
--                         private.quote_gerai_cost of that quote (terms at quoted_at). COD fee and
--                         insurance are not part of normal_tariff_idr and are excluded. A shipment whose
--                         selected quote or gerai cost is unknown counts in earnings_unknown_count; a
--                         group with any unknown shipment, or with no issued shipment, has NULL
--                         earnings, never 0. Demo earnings are always NULL.
-- Errors: not_found (P0002, not a member), admin_required (42501), report_range_invalid (22023).

-- ============================================================ shared per-quote gerai cost

create function private.quote_gerai_cost(p_tenant uuid, p_quote uuid)
returns bigint language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tariff bigint;
  v_net bigint;
  v_quoted_at timestamptz;
  v_bps integer;
begin
  select q.normal_tariff_idr, c.net_shipping_idr, q.quoted_at into v_tariff, v_net, v_quoted_at
    from public.shipment_quotes q
    left join private.quote_costs c on c.tenant_id = q.tenant_id and c.quote_id = q.id
    where q.tenant_id = p_tenant and q.id = p_quote;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select t.gerai_discount_bps into v_bps from private.gerai_terms_at(p_tenant, v_quoted_at) t;
  return private.gerai_cost_idr(v_tariff, v_bps, v_net);
end $$;
revoke all on function private.quote_gerai_cost(uuid, uuid) from public, anon, authenticated, service_role;

-- Same signature, ACL and behavior as 20261028220000: admin check, then the shared derivation.
create or replace function public.gerai_cost_for_quote(p_tenant uuid, p_quote uuid)
returns bigint language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  return private.quote_gerai_cost(p_tenant, p_quote);
end $$;

-- ============================================================ pilot report

create function public.pilot_report(p_tenant uuid, p_from date, p_to date)
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
  with scoped as (
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

revoke all on function public.pilot_report(uuid, date, date) from public, anon, authenticated, service_role;
grant execute on function public.pilot_report(uuid, date, date) to authenticated;

-- ============================================================ export audit

-- Latest body: 20261028170000_invoices_and_export.sql. Same signature and ACL; 'shipments' keeps its
-- exact rules; 'pilot_report' accepts only the from/to filter keys.
create or replace function public.record_export(p_tenant uuid, p_kind text, p_filters jsonb, p_row_count integer,
  p_truncated boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_key text;
begin
  perform private.require_member(p_tenant);
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('shipments', 'pilot_report') or p_row_count is null
     or p_row_count not between 0 and 10000
     or p_truncated is null or p_filters is null or jsonb_typeof(p_filters) <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_filters) loop
    if (p_kind = 'shipments' and v_key not in ('status', 'from', 'to', 'has_query'))
       or (p_kind = 'pilot_report' and v_key not in ('from', 'to')) then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  end loop;
  perform private.audit('export.' || p_kind, p_tenant, null, null,
    case when p_truncated then 'truncated' else 'ok' end,
    jsonb_build_object('filters', p_filters, 'rows', p_row_count, 'truncated', p_truncated));
end $$;

notify pgrst, 'reload schema';
