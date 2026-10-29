-- T-041: gerai discount assignment (PR-23, DATA-9, BILL-3, DEC-012, DEC-016, DEC-018, CTX-42).
--
-- Model. The sender always pays the normal tariff. A Super Admin assigns each tenant a gerai
-- discount as versioned configuration (integer basis points, effective date, source reference,
-- status). The provider-observed discount is never typed: it is derived in SQL from the quotes
-- the provider answered (normal tariff versus private net cost). The platform remainder
-- (observed minus assigned) is computed in read models only; no column, argument or writer exists
-- for it. The database refuses terms above the latest observed discount (no local subsidy).
-- Unknown stays NULL everywhere; it is never coerced to 0. No percentage constant lives in code
-- or in this file: the platform default template is a prefill row typed by a Super Admin.

-- ============================================================ derivation helpers (pure SQL)

-- Observed provider discount in basis points for one quote: floor((tariff - net) * 10000 / tariff).
-- NULL when either amount is unknown, the tariff is not positive, or the net cost exceeds the
-- tariff (inconsistent facts are unknown, not a negative discount). Integer arithmetic only.
create function private.observed_discount_bps(p_tariff bigint, p_net bigint)
returns integer language sql immutable parallel safe set search_path = ''
as $$
  select case
    when p_tariff is not null and p_net is not null and p_tariff > 0 and p_net >= 0 and p_net <= p_tariff
      then (((p_tariff - p_net) * 10000) / p_tariff)::integer
  end
$$;

-- DATA-9 rounding: the discount amount is rounded DOWN to whole rupiah so the derived gerai cost
-- never understates the provider cost. NULL when any input is unknown.
create function private.gerai_discount_idr(p_tariff bigint, p_bps integer)
returns bigint language sql immutable parallel safe set search_path = ''
as $$
  select case
    when p_tariff is not null and p_bps is not null and p_tariff > 0 and p_bps between 0 and 10000
      then (p_tariff * p_bps) / 10000
  end
$$;

-- Derived gerai cost = normal tariff - floor(tariff * assigned_bps / 10000). Unknown when any
-- input (tariff, assigned terms, observed discount of that quote) is unknown, and refused (NULL)
-- when the assigned value is above the quote's observed discount: no amount is derived then.
create function private.gerai_cost_idr(p_tariff bigint, p_assigned_bps integer, p_observed_bps integer)
returns bigint language sql immutable parallel safe set search_path = ''
as $$
  select case
    when p_observed_bps is not null and p_assigned_bps is not null and p_assigned_bps <= p_observed_bps
      then p_tariff - private.gerai_discount_idr(p_tariff, p_assigned_bps)
  end
$$;

-- Per-quote observed discount. Private: never granted to an API role. Synthetic (demo) quotes are
-- listed with their flag so callers can exclude them; their net cost is not a provider fact.
create view private.quote_observed_discount as
  select q.tenant_id, q.id as quote_id, q.courier, q.quoted_at, q.is_simulated, q.normal_tariff_idr,
         private.observed_discount_bps(q.normal_tariff_idr, c.net_shipping_idr) as observed_bps
  from public.shipment_quotes q
  join private.quote_costs c on c.tenant_id = q.tenant_id and c.quote_id = q.id;
revoke all on private.quote_observed_discount from public, anon, authenticated;

create index shipment_quotes_observed_idx on public.shipment_quotes (tenant_id, quoted_at desc)
  where not is_simulated;

-- Latest provider-observed discount for one tenant (a real, non-simulated quote with a known
-- net cost). No row means no observation.
create function private.latest_observed_discount(p_tenant uuid)
returns table (observed_bps integer, observed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select v.observed_bps, v.quoted_at
  from private.quote_observed_discount v
  where v.tenant_id = p_tenant and not v.is_simulated and v.observed_bps is not null
  order by v.quoted_at desc, v.quote_id desc
  limit 1
$$;

-- ============================================================ versioned terms

-- One row per version. tenant_id NULL is the platform default template, used only as a prefill.
-- Append-only: a new row supersedes the previous one for the same scope; no API role holds any
-- privilege on this table, every read and write goes through the functions below.
create table public.gerai_discount_terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  version integer not null check (version > 0),
  gerai_discount_bps integer not null check (gerai_discount_bps between 0 and 10000),
  effective_from timestamptz not null,
  source_reference text not null check (char_length(btrim(source_reference)) between 3 and 500),
  status text not null check (status in ('owner_stated', 'provider_observed', 'provider_verified')),
  -- The written Mengantar confirmation, typed by the Super Admin; required for, and only for,
  -- provider_verified (DEC-012).
  verification_reference text check (char_length(btrim(verification_reference)) between 3 and 500),
  -- The latest observed provider discount at the moment of assignment (set by the trigger, never
  -- by the caller). NULL means there was no observation: the row is read as unverified.
  observed_bps_at_creation integer check (observed_bps_at_creation between 0 and 10000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint gerai_terms_verified_needs_reference check (
    (status = 'provider_verified') = (verification_reference is not null)),
  constraint gerai_terms_template_owner_stated check (tenant_id is not null or status = 'owner_stated')
);
create unique index gerai_terms_tenant_version on public.gerai_discount_terms (tenant_id, version)
  where tenant_id is not null;
create unique index gerai_terms_template_version on public.gerai_discount_terms (version)
  where tenant_id is null;
alter table public.gerai_discount_terms enable row level security;
revoke all on public.gerai_discount_terms from public, anon, authenticated;

create function private.gerai_terms_append_only()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'terms_are_append_only' using errcode = '42501';
end $$;
create trigger gerai_terms_append_only before update or delete on public.gerai_discount_terms
  for each row execute function private.gerai_terms_append_only();
create trigger gerai_terms_no_truncate before truncate on public.gerai_discount_terms
  for each statement execute function private.gerai_terms_append_only();

-- The database rule (PR-23, DATA-9): a gerai discount above the latest provider-observed discount
-- is refused whoever the writer is. It also assigns the version, records the observation used and
-- keeps the effective date from moving backwards across versions of one scope.
create function private.gerai_terms_guard()
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
  if new.status = 'provider_observed' and v_observed is null then
    raise exception 'observation_required' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger gerai_terms_guard before insert on public.gerai_discount_terms
  for each row execute function private.gerai_terms_guard();

-- The version in force now: the highest version whose effective date has arrived. A later-dated
-- version stays pending and changes nothing until then.
create function private.current_gerai_terms(p_tenant uuid)
returns setof public.gerai_discount_terms
language sql stable security definer set search_path = ''
as $$
  select t.* from public.gerai_discount_terms t
  where t.tenant_id is not distinct from p_tenant and t.effective_from <= now()
  order by t.version desc limit 1
$$;

-- ============================================================ Super Admin reads

-- Capability: integration_operations. IAM-6/UX-12 call for a pricing capability but none exists
-- and platform_grants.capabilities is a closed list; the discount is a provider-terms setting and
-- this is the closest existing scope (it already guards the Mengantar integration screen).
-- Observed values and the remainder are visible here only (platform authority, aal2).
create function public.platform_discount_overview()
returns table (tenant_id uuid, tenant_name text, lifecycle text, version integer,
  gerai_discount_bps integer, status text, effective_from timestamptz, source_reference text,
  set_at timestamptz, set_by_email text, unverified boolean, has_pending boolean,
  observed_bps integer, observed_at timestamptz, remainder_bps integer)
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
      -- Derived only: unknown when either side is unknown; never stored, never typed.
      case when o.observed_bps is not null and c.gerai_discount_bps is not null
        then o.observed_bps - c.gerai_discount_bps end
    from public.tenants t
    left join lateral private.current_gerai_terms(t.id) c on true
    left join auth.users u on u.id = c.created_by
    left join lateral private.latest_observed_discount(t.id) o on true
    where not t.is_demo
    order by t.name, t.id;
end $$;

-- Version history of one tenant (newest first); a NULL tenant reads the platform default template.
create function public.platform_discount_history(p_tenant uuid)
returns table (version integer, gerai_discount_bps integer, status text, effective_from timestamptz,
  source_reference text, verification_reference text, unverified boolean, created_at timestamptz,
  created_by_email text, is_current boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('integration_operations');
  if p_tenant is not null and not exists (select 1 from public.tenants x where x.id = p_tenant and not x.is_demo) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return query
    select h.version, h.gerai_discount_bps, h.status, h.effective_from, h.source_reference,
      h.verification_reference,
      case when h.tenant_id is null then null else h.observed_bps_at_creation is null end,
      h.created_at, u.email::text,
      coalesce(h.id = (select c.id from private.current_gerai_terms(p_tenant) c), false)
    from public.gerai_discount_terms h
    left join auth.users u on u.id = h.created_by
    where h.tenant_id is not distinct from p_tenant
    order by h.version desc
    limit 100;
end $$;

-- Latest observed provider discount per courier for one tenant (drift is visible per courier).
create function public.platform_discount_observations(p_tenant uuid)
returns table (courier text, observed_bps integer, observed_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('integration_operations');
  if not exists (select 1 from public.tenants x where x.id = p_tenant and not x.is_demo) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return query
    select d.courier, d.observed_bps, d.quoted_at
    from (select distinct on (v.courier) v.courier, v.observed_bps, v.quoted_at
          from private.quote_observed_discount v
          where v.tenant_id = p_tenant and not v.is_simulated and v.observed_bps is not null
          order by v.courier, v.quoted_at desc, v.quote_id desc) d
    order by d.courier;
end $$;

-- ============================================================ Super Admin write

-- Create the next version for a tenant (or the platform default template when p_tenant is NULL).
-- p_expected_version is the highest version the caller saw (0 for none); a mismatch is a stale
-- screen. The write takes the caller's grant lock, re-checks authority, serializes per scope, and
-- audits the actor with old and new values. Above-observed values are refused by the table trigger.
create function public.platform_set_gerai_discount(p_tenant uuid, p_expected_version integer,
  p_bps integer, p_effective date, p_status text, p_source text, p_verification text, p_reason text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_source text := btrim(coalesce(p_source, ''));
  v_verification text := nullif(btrim(coalesce(p_verification, '')), '');
  v_latest integer;
  v_effective timestamptz;
  v_old public.gerai_discount_terms;
  v_new public.gerai_discount_terms;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  perform private.require_platform('integration_operations'); -- cheap refusal before locks
  perform 1 from public.platform_grants where user_id = (select auth.uid()) for share;
  perform private.require_platform('integration_operations');
  v_reason := private.require_reason(p_reason);
  if p_bps is null or p_bps not between 0 and 10000 or p_effective is null
     or p_status is null or p_status not in ('owner_stated', 'provider_observed', 'provider_verified') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if char_length(v_source) not between 3 and 500 then
    raise exception 'source_reference_required' using errcode = '22023';
  end if;
  if p_status = 'provider_verified' and (v_verification is null or char_length(v_verification) not between 3 and 500) then
    raise exception 'verification_reference_required' using errcode = '22023';
  end if;
  if p_status <> 'provider_verified' and v_verification is not null then
    raise exception 'verification_reference_unexpected' using errcode = '22023';
  end if;
  -- Today or later (Asia/Jakarta calendar day): a past date would reprice quotes retroactively.
  if p_effective < v_today or p_effective > v_today + 365 then
    raise exception 'invalid_effective_date' using errcode = '22023';
  end if;
  v_effective := p_effective::timestamp at time zone 'Asia/Jakarta';
  if p_tenant is not null and not exists (select 1 from public.tenants x where x.id = p_tenant and not x.is_demo) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gerai_discount:' || coalesce(p_tenant::text, 'template'), 0));
  select max(t.version) into v_latest from public.gerai_discount_terms t where t.tenant_id is not distinct from p_tenant;
  if coalesce(v_latest, 0) <> coalesce(p_expected_version, 0) then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  select t.* into v_old from public.gerai_discount_terms t
    where t.tenant_id is not distinct from p_tenant and t.version = v_latest;

  insert into public.gerai_discount_terms (tenant_id, version, gerai_discount_bps, effective_from,
    source_reference, status, verification_reference, created_by)
  values (p_tenant, 0, p_bps, v_effective, v_source, p_status, v_verification, (select auth.uid()))
  returning * into v_new;

  perform private.audit(case when p_tenant is null then 'discount.template' else 'discount.terms' end,
    p_tenant, null, v_reason, p_status,
    jsonb_build_object('old_version', v_old.version, 'new_version', v_new.version,
      'old_bps', v_old.gerai_discount_bps, 'new_bps', v_new.gerai_discount_bps,
      'old_status', v_old.status, 'new_status', v_new.status,
      'effective_from', v_new.effective_from, 'observed_bps', v_new.observed_bps_at_creation));
  return v_new.version;
end $$;

-- ============================================================ tenant reads (gerai side)

-- A tenant administrator reads only its own current assigned discount, status and effective date.
-- No observed value, no remainder, no variance, no unverified flag. Operators and outsiders are
-- refused. No row means no assigned terms (unknown, not zero).
create function public.tenant_gerai_discount(p_tenant uuid)
returns table (gerai_discount_bps integer, status text, effective_from timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  return query
    select c.gerai_discount_bps, c.status, c.effective_from from private.current_gerai_terms(p_tenant) c;
end $$;

-- Derived gerai cost of one quote for the shipment UI (a later task renders it): normal tariff
-- minus floor(tariff * assigned_bps / 10000). Returns only that amount; never the net cost, the
-- observed discount or the remainder. NULL when the tariff, the assigned terms or the quote's
-- observed discount is unknown, or when the assigned value exceeds that observed discount.
-- Tenant administrators only: operators get the normal tariff, and a cost below it would reveal
-- the assigned discount (IAM-5).
create function public.gerai_cost_for_quote(p_tenant uuid, p_quote uuid)
returns bigint language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tariff bigint;
  v_net bigint;
  v_bps integer;
begin
  if private.member_role(p_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  select q.normal_tariff_idr, c.net_shipping_idr into v_tariff, v_net
    from public.shipment_quotes q
    left join private.quote_costs c on c.tenant_id = q.tenant_id and c.quote_id = q.id
    where q.tenant_id = p_tenant and q.id = p_quote;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select c.gerai_discount_bps into v_bps from private.current_gerai_terms(p_tenant) c;
  return private.gerai_cost_idr(v_tariff, v_bps, private.observed_discount_bps(v_tariff, v_net));
end $$;

-- ============================================================ privileges

revoke all on function public.platform_discount_overview(), public.platform_discount_history(uuid),
  public.platform_discount_observations(uuid),
  public.platform_set_gerai_discount(uuid, integer, integer, date, text, text, text, text),
  public.tenant_gerai_discount(uuid), public.gerai_cost_for_quote(uuid, uuid) from public, anon;
grant execute on function public.platform_discount_overview(), public.platform_discount_history(uuid),
  public.platform_discount_observations(uuid),
  public.platform_set_gerai_discount(uuid, integer, integer, date, text, text, text, text),
  public.tenant_gerai_discount(uuid), public.gerai_cost_for_quote(uuid, uuid) to authenticated;
revoke all on function private.observed_discount_bps(bigint, bigint), private.gerai_discount_idr(bigint, integer),
  private.gerai_cost_idr(bigint, integer, integer), private.latest_observed_discount(uuid),
  private.gerai_terms_append_only(), private.gerai_terms_guard(),
  private.current_gerai_terms(uuid) from public, anon, authenticated;
