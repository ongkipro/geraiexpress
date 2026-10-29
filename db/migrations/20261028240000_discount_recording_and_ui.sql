-- T-053: provider discount recorded per quote (DATA-9 provider_discount_bps) and the platform
-- masking control read model.
--
-- 1. private.quote_costs.provider_discount_bps. The estimate's documented `discountPercent`
--    converted by the Worker to integer basis points (22.5 -> 2250). NULL means unknown (absent,
--    unreadable, negative, above 100 or not a multiple of 0.01 percent): never 0. A present 0 is a
--    real 0% discount.
-- 2. private.quote_observed_discount.observed_bps = provider_discount_bps when present, otherwise
--    the amount-derived ceil value of T-041 (old rows and rows without a provider percent keep
--    their derived value). Everything downstream (latest_observed_batch, the assignment ceiling,
--    the overview, the guard) already reads this view, so the per-courier batch maximum and the
--    ceil/least semantics of 20261028220000 are unchanged.
-- 3. record_live_quotes keeps its signature and every behavior; each row may carry an optional
--    `discount_bps` (integer 0..10000 or JSON null). A malformed value is invalid_input.
-- 4. public.platform_tenant_masking: the read side of platform_set_masking_allowed (tenants has a
--    member-only read policy, so the platform cannot read masking_allowed directly).

alter table private.quote_costs
  add column provider_discount_bps integer check (provider_discount_bps between 0 and 10000);

-- Same columns and types as before; only the source of observed_bps changes.
create or replace view private.quote_observed_discount as
  select q.tenant_id, q.id as quote_id, q.courier, q.quoted_at, q.is_simulated, q.normal_tariff_idr,
         coalesce(c.provider_discount_bps, private.observed_discount_bps(q.normal_tariff_idr, c.net_shipping_idr)) as observed_bps
  from public.shipment_quotes q
  join private.quote_costs c on c.tenant_id = q.tenant_id and c.quote_id = q.id;
revoke all on private.quote_observed_discount from public, anon, authenticated;

-- Final definition: 20261028160000 plus the optional per-row discount_bps.
create or replace function public.record_live_quotes(p_tenant uuid, p_shipment uuid, p_expected_revision integer,
  p_rows jsonb, p_origin_area_id text, p_origin_address_id text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments; o public.outlets; r jsonb; v_quote uuid; v_count integer := 0;
  v_cod_supported boolean; v_fee_raw text; v_cod_fee bigint; v_tariff bigint; v_net bigint;
  v_discount_bps integer;
begin
  select * into s from public.shipments where tenant_id = p_tenant and id = p_shipment for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  if s.submission_state not in ('draft', 'estimated') then
    raise exception 'shipment_locked' using errcode = '42501';
  end if;
  if s.revision is distinct from p_expected_revision then raise exception 'stale_revision' using errcode = '55000'; end if;
  if s.is_cod and coalesce(s.goods_value_idr, 0) < 1000 then
    raise exception 'cod_goods_value_required' using errcode = '22023';
  end if;
  perform private.require_live_recipient(s);
  -- Shared outlet lock serializes with set_outlet_mengantar_pickup through the quote write.
  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id for share;
  if o.mengantar_area_id is null or o.mengantar_pickup_address_id is null then
    raise exception 'pickup_not_set' using errcode = '55000';
  end if;
  if p_origin_area_id is distinct from o.mengantar_area_id
     or p_origin_address_id is distinct from o.mengantar_pickup_address_id then
    raise exception 'stale_quote' using errcode = '55000';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 20 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update public.shipment_quotes set expires_at = now()
    where tenant_id = s.tenant_id and shipment_id = s.id and expires_at > now();
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'courier', '') !~ '^[A-Za-z]{2,20}$' or coalesce(r->>'tariff', '') !~ '^[0-9]{1,9}$'
       or coalesce(r->>'net', '') !~ '^[0-9]{1,9}$' or char_length(coalesce(r->>'eta', '')) > 40 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    v_tariff := (r->>'tariff')::bigint;
    v_net := (r->>'net')::bigint;
    if v_tariff <= 0 or v_net > v_tariff then raise exception 'invalid_input' using errcode = '22023'; end if;
    -- Provider discount in basis points: absent or JSON null is unknown (NULL), never 0.
    v_discount_bps := null;
    if r ? 'discount_bps' and jsonb_typeof(r->'discount_bps') <> 'null' then
      if jsonb_typeof(r->'discount_bps') <> 'number' or r->>'discount_bps' !~ '^[0-9]{1,5}$'
         or (r->>'discount_bps')::integer > 10000 then
        raise exception 'invalid_input' using errcode = '22023';
      end if;
      v_discount_bps := (r->>'discount_bps')::integer;
    end if;
    if r ? 'cod_supported' then
      if jsonb_typeof(r->'cod_supported') <> 'boolean' then raise exception 'invalid_input' using errcode = '22023'; end if;
      v_cod_supported := (r->>'cod_supported')::boolean;
    else
      v_cod_supported := s.is_cod;
    end if;
    if s.is_cod and not v_cod_supported then continue; end if;
    if s.is_cod then
      v_fee_raw := coalesce(r->>'cod_fee', r->>'codFee', '0');
      if v_fee_raw !~ '^[0-9]{1,9}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
      v_cod_fee := v_fee_raw::bigint;
    else
      v_cod_fee := 0;
    end if;
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, expires_at,
      origin_area_id, origin_pickup_address_id)
    values (s.tenant_id, s.id, s.revision, r->>'courier', 'Reguler', v_tariff,
      v_cod_supported, v_cod_fee, v_tariff + v_cod_fee, coalesce(nullif(r->>'eta', ''), '—'), false,
      now() + interval '30 minutes', p_origin_area_id, p_origin_address_id)
    returning id into v_quote;
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr, provider_discount_bps)
      values (s.tenant_id, v_quote, v_net, v_discount_bps);
    v_count := v_count + 1;
  end loop;
  update public.shipments set submission_state = case when v_count > 0 then 'estimated' else 'draft' end,
    updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'quoted',
    case when v_count > 0 then 'Estimasi Mengantar' else 'Tidak ada layanan Mengantar untuk rute ini' end);
  return v_count;
end $$;
revoke all on function public.record_live_quotes(uuid, uuid, integer, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.record_live_quotes(uuid, uuid, integer, jsonb, text, text) to service_role;

-- ============================================================ platform masking read model

-- Current masking flag of one real tenant for the platform control (tenant_governance), with the
-- time and outcome of the last audited change. The reason and the actor stay in the audit page.
create function public.platform_tenant_masking(p_tenant uuid)
returns table (tenant_name text, lifecycle text, masking_allowed boolean,
  last_changed_at timestamptz, last_outcome text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('tenant_governance');
  return query
    select t.name, t.lifecycle, t.masking_allowed,
      (select e.at from public.audit_events e where e.action = 'tenant.masking' and e.target_tenant = t.id
         order by e.id desc limit 1),
      (select e.outcome from public.audit_events e where e.action = 'tenant.masking' and e.target_tenant = t.id
         order by e.id desc limit 1)
    from public.tenants t
    where t.id = p_tenant and not t.is_demo;
end $$;
revoke all on function public.platform_tenant_masking(uuid) from public, anon;
grant execute on function public.platform_tenant_masking(uuid) to authenticated;
