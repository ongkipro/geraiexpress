-- T-041 review fixes (B-H1): the provider-observed discount is per courier within the tenant's
-- latest estimate batch, the assignment ceiling is deterministic, and old quotes never reprice.
--
-- Batch. One estimate writes one shipment_quotes row per courier/service with the same quoted_at
-- (now() of the writing transaction). The tenant's LATEST BATCH is every real (non-simulated)
-- quote row with a known observed discount whose quoted_at equals the newest such quoted_at.
-- Couriers differ genuinely (one answers 30%, another 7.14%), so there is no single provider
-- discount and no "last row wins":
--   * observed value per courier   = the highest observed value among that courier's rows in the batch
--   * assignment ceiling           = the MAXIMUM observed value over the batch (typo guard: the
--                                    assigned value may not exceed what the provider gives for any
--                                    courier); independent of row order and of UUID order
--   * effective discount per quote = least(assigned, that quote's own observed value): the gerai
--                                    never gets more than the provider gave on that very quote
--   * provider_observed status     = assigned must equal the ceiling exactly (tolerance 0 bps)
-- A batch whose rows have no known net cost has no observation and is skipped: unknown stays
-- NULL, never 0.
--
-- Rounding. The provider answers whole-rupiah net prices, so a provider percent of exactly 22.5%
-- on 12345 can come back as net 9568 whose exact ratio is 22.4949...%. The observed value is
-- therefore derived with CEIL (never understates the provider rounding), which makes 22.5% (2250)
-- assignable and equal to its observation. To keep the no-subsidy rule exact in rupiah the derived
-- gerai discount amount is additionally capped at the provider's discount amount (tariff - net).
--
-- Terms in force. gerai_cost_for_quote uses the newest version applicable at the quote's quoted_at:
-- effective_from <= quoted_at AND created_at <= quoted_at (a version cannot reprice a quote that was
-- answered before the version existed, even when its effective date is earlier the same day).

-- ============================================================ derivation helpers

-- Observed provider discount of one quote in basis points: ceil((tariff - net) * 10000 / tariff).
-- NULL when either amount is unknown, the tariff is not positive, or the net cost exceeds the tariff.
create or replace function private.observed_discount_bps(p_tariff bigint, p_net bigint)
returns integer language sql immutable parallel safe set search_path = ''
as $$
  select case
    when p_tariff is not null and p_net is not null and p_tariff > 0 and p_net >= 0 and p_net <= p_tariff
      then ((((p_tariff - p_net) * 10000) + p_tariff - 1) / p_tariff)::integer
  end
$$;

-- Derived gerai cost = normal tariff - discount amount, where the amount is
-- floor(tariff * least(assigned, observed) / 10000) capped at the provider's own amount
-- (tariff - net). NULL when the tariff, the assigned terms or the net cost is unknown.
drop function private.gerai_cost_idr(bigint, integer, integer);
create function private.gerai_cost_idr(p_tariff bigint, p_assigned_bps integer, p_net bigint)
returns bigint language sql immutable parallel safe set search_path = ''
as $$
  select case
    when p_tariff is not null and p_net is not null and p_assigned_bps is not null
         and p_tariff > 0 and p_net between 0 and p_tariff and p_assigned_bps between 0 and 10000
      then p_tariff - least(
        private.gerai_discount_idr(p_tariff, least(p_assigned_bps, private.observed_discount_bps(p_tariff, p_net))),
        p_tariff - p_net)
  end
$$;

-- The latest estimate batch of one tenant, one row per courier (see the header). Deterministic:
-- grouping and a fixed order, no dependence on insertion or UUID order.
create function private.latest_observed_batch(p_tenant uuid)
returns table (courier text, observed_bps integer, observed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  with real as (
    select v.courier, v.quoted_at, v.observed_bps
    from private.quote_observed_discount v
    where v.tenant_id = p_tenant and not v.is_simulated and v.observed_bps is not null
  ), latest as (select max(r.quoted_at) as at from real r)
  select r.courier, max(r.observed_bps), r.quoted_at
  from real r join latest l on r.quoted_at = l.at
  group by r.courier, r.quoted_at
  order by r.courier
$$;

-- The assignment ceiling: the maximum observed value over the latest batch. No row = no observation.
create or replace function private.latest_observed_discount(p_tenant uuid)
returns table (observed_bps integer, observed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select b.observed_bps, b.observed_at
  from private.latest_observed_batch(p_tenant) b
  order by b.observed_bps desc, b.courier
  limit 1
$$;

-- The version applicable at a moment: newest version whose effective date and creation both precede it.
create function private.gerai_terms_at(p_tenant uuid, p_at timestamptz)
returns setof public.gerai_discount_terms
language sql stable security definer set search_path = ''
as $$
  select t.* from public.gerai_discount_terms t
  where t.tenant_id is not distinct from p_tenant and t.effective_from <= p_at and t.created_at <= p_at
  order by t.version desc limit 1
$$;

-- ============================================================ terms guard

-- Same behavior as before (version assignment, backwards-date refusal, template pass-through,
-- above-observed refusal) with the ceiling now the batch maximum, plus: provider_observed must
-- equal that ceiling exactly.
create or replace function private.gerai_terms_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_observed integer;
  v_prev_version integer;
  v_prev_effective timestamptz;
begin
  select t.version, t.effective_from into v_prev_version, v_prev_effective
    from public.gerai_discount_terms t
    where t.tenant_id is not distinct from new.tenant_id
    order by t.version desc limit 1;
  new.version := coalesce(v_prev_version, 0) + 1;
  if v_prev_effective is not null and new.effective_from < v_prev_effective then
    raise exception 'effective_before_previous' using errcode = '22023';
  end if;
  if new.tenant_id is null then
    new.observed_bps_at_creation := null;
    return new;
  end if;
  select o.observed_bps into v_observed from private.latest_observed_discount(new.tenant_id) o;
  new.observed_bps_at_creation := v_observed;
  if v_observed is not null and new.gerai_discount_bps > v_observed then
    raise exception 'discount_above_observed' using errcode = '23514',
      detail = format('observed_bps=%s', v_observed);
  end if;
  if new.status = 'provider_observed' then
    if v_observed is null then
      raise exception 'observation_required' using errcode = '23514';
    end if;
    if new.gerai_discount_bps <> v_observed then
      raise exception 'provider_observed_mismatch' using errcode = '23514',
        detail = format('observed_bps=%s', v_observed);
    end if;
  end if;
  return new;
end $$;

-- ============================================================ Super Admin reads

-- Overview: one row per tenant. observed_bps is the batch maximum (the ceiling); observed_by_courier
-- lists every courier of the batch. remainder_bps is the derived estimate maximum observed minus
-- the assigned value in force (never typed, NULL when either is unknown), flagged
-- remainder_is_estimate until the terms are provider_verified.
drop function public.platform_discount_overview();
create function public.platform_discount_overview()
returns table (tenant_id uuid, tenant_name text, lifecycle text, version integer,
  gerai_discount_bps integer, status text, effective_from timestamptz, source_reference text,
  set_at timestamptz, set_by_email text, unverified boolean, has_pending boolean,
  observed_bps integer, observed_at timestamptz, remainder_bps integer,
  observed_by_courier jsonb, remainder_is_estimate boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('integration_operations');
  return query
    select t.id, t.name, t.lifecycle, c.version, c.gerai_discount_bps, c.status, c.effective_from,
      c.source_reference, c.created_at, u.email::text,
      case when c.id is null then null else c.observed_bps_at_creation is null end,
      exists (select 1 from public.gerai_discount_terms p
              where p.tenant_id = t.id and p.effective_from > now()),
      o.observed_bps, o.observed_at,
      case when o.observed_bps is not null and c.gerai_discount_bps is not null
        then o.observed_bps - c.gerai_discount_bps end,
      (select jsonb_agg(jsonb_build_object('courier', b.courier, 'observed_bps', b.observed_bps) order by b.courier)
         from private.latest_observed_batch(t.id) b),
      (o.observed_bps is not null and c.gerai_discount_bps is not null
        and c.status is distinct from 'provider_verified')
    from public.tenants t
    left join lateral private.current_gerai_terms(t.id) c on true
    left join auth.users u on u.id = c.created_by
    left join lateral private.latest_observed_discount(t.id) o on true
    where not t.is_demo
    order by t.name, t.id;
end $$;

-- Observed discount per courier within the latest batch (drift is visible per courier).
create or replace function public.platform_discount_observations(p_tenant uuid)
returns table (courier text, observed_bps integer, observed_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('integration_operations');
  if not exists (select 1 from public.tenants x where x.id = p_tenant and not x.is_demo) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return query select b.courier, b.observed_bps, b.observed_at from private.latest_observed_batch(p_tenant) b;
end $$;

-- ============================================================ tenant read

-- Derived gerai cost of one quote: the terms in force at the quote's own quoted_at, the discount
-- capped by that quote's own observed value, integer rupiah. Returns only the amount. NULL when the
-- tariff, the net cost or any applicable terms are unknown. Tenant administrators only.
create or replace function public.gerai_cost_for_quote(p_tenant uuid, p_quote uuid)
returns bigint language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tariff bigint;
  v_net bigint;
  v_quoted_at timestamptz;
  v_bps integer;
begin
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  select q.normal_tariff_idr, c.net_shipping_idr, q.quoted_at into v_tariff, v_net, v_quoted_at
    from public.shipment_quotes q
    left join private.quote_costs c on c.tenant_id = q.tenant_id and c.quote_id = q.id
    where q.tenant_id = p_tenant and q.id = p_quote;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select t.gerai_discount_bps into v_bps from private.gerai_terms_at(p_tenant, v_quoted_at) t;
  return private.gerai_cost_idr(v_tariff, v_bps, v_net);
end $$;

-- ============================================================ privileges

revoke all on function public.platform_discount_overview(), public.platform_discount_observations(uuid),
  public.gerai_cost_for_quote(uuid, uuid) from public, anon;
grant execute on function public.platform_discount_overview(), public.platform_discount_observations(uuid),
  public.gerai_cost_for_quote(uuid, uuid) to authenticated;
revoke all on function private.observed_discount_bps(bigint, bigint), private.gerai_cost_idr(bigint, integer, bigint),
  private.latest_observed_batch(uuid), private.latest_observed_discount(uuid),
  private.gerai_terms_at(uuid, timestamptz), private.gerai_terms_guard()
  from public, anon, authenticated;

-- ============================================================ platform audit default view

-- Same signature and grants as before. The default view (no action filter) leaves out
-- label.snapshot rows: every label creation is audited, so they would flood the list. They stay
-- fully queryable with p_action = 'label.snapshot'.
create or replace function public.platform_audit(p_action text default null, p_limit integer default 100)
returns table (id bigint, at timestamptz, action text, outcome text, reason text,
  actor_email text, target_tenant_name text, target_user_email text, detail jsonb)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('audit_review');
  return query
    select e.id, e.at, e.action, e.outcome, e.reason, a.email::text, t.name, u.email::text, e.detail
    from public.audit_events e
    left join auth.users a on a.id = e.actor
    left join public.tenants t on t.id = e.target_tenant
    left join auth.users u on u.id = e.target_user
    where case when p_action is null then e.action <> 'label.snapshot' else e.action = p_action end
    order by e.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;
