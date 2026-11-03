-- T-092 / DEC-024 (G3/G4): read-only platform monitoring. Aggregates only: counts and readiness, never a
-- recipient/sender name, phone or address (customer detail is T-093). One gerai = one cabang (DEC-024).
-- Either platform_monitoring or tenant_governance may read; no write path is added.

create function private.require_platform_any(p_capabilities text[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from unnest(p_capabilities) c where private.platform_capable(c)) then
    raise exception 'platform_access_required' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_platform_any(text[]) from public, anon, authenticated;

-- WIB calendar day boundaries for "today" and the 7/30-day windows.
create function public.platform_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Jakarta')) at time zone 'Asia/Jakarta';
begin
  perform private.require_platform_any(array['platform_monitoring', 'tenant_governance']);
  return jsonb_build_object(
    'generated_at', now(),
    'tenants', (select jsonb_build_object(
        'active', count(*) filter (where lifecycle = 'active'),
        'suspended', count(*) filter (where lifecycle = 'suspended'),
        'provisioning', count(*) filter (where lifecycle = 'provisioning'),
        'total', count(*))
      from public.tenants where not is_demo),
    'applications_submitted', (select count(*) from public.tenant_applications where status = 'submitted'),
    'shipments_today', (select jsonb_build_object(
        'created', count(*) filter (where s.created_at >= v_today),
        'issued', count(*) filter (where s.issued_at >= v_today))
      from public.shipments s join public.tenants t on t.id = s.tenant_id
      where not t.is_demo and not s.is_simulated and (s.created_at >= v_today or s.issued_at >= v_today)),
    'attention', (select jsonb_build_object(
        'queued', count(*) filter (where s.submission_state = 'queued'),
        'in_flight', count(*) filter (where s.submission_state = 'in_flight'),
        'unknown', count(*) filter (where s.submission_state = 'unknown'),
        'awaiting_payment', count(*) filter (where s.submission_state = 'awaiting_payment'),
        'failed', count(*) filter (where s.submission_state = 'failed'))
      from public.shipments s join public.tenants t on t.id = s.tenant_id
      where not t.is_demo and not s.is_simulated));
end $$;
revoke all on function public.platform_overview() from public, anon;
grant execute on function public.platform_overview() to authenticated;

-- The directory: one row per real gerai with readiness and activity counts; search/filter/paging run in
-- SQL so a large platform does not ship every row to the page.
-- p_attention (optional) narrows to gerai with at least one real shipment in that condition, so every
-- overview signal drills down to the gerai concerned without exposing a shipment.
create function public.platform_tenant_directory(p_query text, p_lifecycle text, p_limit integer, p_offset integer,
  p_attention text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Jakarta')) at time zone 'Asia/Jakarta';
begin
  perform private.require_platform_any(array['platform_monitoring', 'tenant_governance']);
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0
     or (p_lifecycle is not null and p_lifecycle not in ('active', 'suspended', 'provisioning', 'archived'))
     or char_length(coalesce(v_q, '')) > 80
     or (p_attention is not null and p_attention not in ('today', 'unknown', 'awaiting_payment', 'queue', 'failed')) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return (select x.result from (
    with base as (
      select t.id, t.name, t.lifecycle, t.created_at, t.slug, t.shipment_prefix
      from public.tenants t
      where not t.is_demo
        and (p_lifecycle is null or t.lifecycle = p_lifecycle)
        and (v_q is null or t.name ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or t.slug ilike '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
        and (p_attention is null or exists (select 1 from public.shipments s where s.tenant_id = t.id and not s.is_simulated
          and case p_attention
            when 'today' then s.created_at >= v_today
            when 'unknown' then s.submission_state = 'unknown'
            when 'awaiting_payment' then s.submission_state = 'awaiting_payment'
            when 'queue' then s.submission_state in ('queued', 'in_flight')
            when 'failed' then s.submission_state = 'failed' end))
    )
    select jsonb_build_object(
      'total', (select count(*) from base),
      'rows', coalesce((select jsonb_agg(r order by r.name, r.id) from (
        select b.id, b.name, b.lifecycle, b.created_at, b.slug, b.shipment_prefix,
          (select count(*) from public.memberships m where m.tenant_id = b.id and m.status = 'active') as member_count,
          exists (select 1 from private.seller_credentials c where c.tenant_id = b.id and c.superseded_at is null) as connected,
          exists (select 1 from public.outlets o where o.tenant_id = b.id and o.mengantar_pickup_address_id is not null) as pickup_ready,
          (select count(*) from public.shipments s where s.tenant_id = b.id and not s.is_simulated
            and s.created_at >= now() - interval '30 days') as shipments_30d,
          (select count(*) from public.shipments s where s.tenant_id = b.id and not s.is_simulated
            and s.submission_state in ('unknown', 'awaiting_payment', 'failed')) as open_problems,
          (select max(s.created_at) from public.shipments s where s.tenant_id = b.id and not s.is_simulated) as last_shipment_at
        from base b order by b.name, b.id limit p_limit offset p_offset) r), '[]'::jsonb)) as result) x);
end $$;
revoke all on function public.platform_tenant_directory(text, text, integer, integer, text) from public, anon;
grant execute on function public.platform_tenant_directory(text, text, integer, integer, text) to authenticated;

-- One gerai (= one cabang): identity, readiness and activity aggregates. No customer fields.
create function public.platform_tenant_summary(p_tenant uuid)
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
        'charge_30_days_idr', coalesce(sum(s.customer_charge_idr) filter (where s.issued_at >= now() - interval '30 days'), 0),
        'last_shipment_at', max(s.created_at))
      from public.shipments s where s.tenant_id = t.id and not s.is_simulated),
    'last_activity_at', (select max(a.at) from public.audit_events a where a.target_tenant = t.id));
end $$;
revoke all on function public.platform_tenant_summary(uuid) from public, anon;
grant execute on function public.platform_tenant_summary(uuid) to authenticated;

-- Monitoring view of submitted applications: business and outlet names, area and wait time only.
-- No applicant email, phone or street address and no review action (those stay tenant_governance).
create function public.platform_pending_applications()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform_any(array['platform_monitoring', 'tenant_governance']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'business_name', a.business_name, 'outlet_name', a.outlet_name,
      'pickup_area', a.pickup_area, 'submitted_at', a.submitted_at, 'revision', a.revision) order by a.submitted_at, a.id)
    from public.tenant_applications a where a.status = 'submitted'), '[]'::jsonb);
end $$;
revoke all on function public.platform_pending_applications() from public, anon;
grant execute on function public.platform_pending_applications() to authenticated;

notify pgrst, 'reload schema';
