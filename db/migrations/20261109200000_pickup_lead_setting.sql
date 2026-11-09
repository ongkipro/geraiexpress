-- T-043 amendment: the minimum pickup lead time is a setting, default 120 minutes.
--
-- The provider documentation says a slot must be at least 90 minutes ahead; the Mengantar web UI asks
-- for 2 hours, which is the stricter value used here. The number now lives in private.settings under
-- 'pickup_min_lead_minutes' (a JSON number of whole minutes) and falls back to 120 when the row is
-- absent or not a positive whole number. The application default is PICKUP_LEAD_MINUTES in
-- src/lib/mengantar/pickup.ts; tests/db/pickup-orders.test.ts keeps the two defaults equal.
-- There is no editor for the setting (Super Admin tooling is out of scope).
create function private.pickup_lead_minutes()
returns integer language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select (s.value #>> '{}')::integer from private.settings s
      where s.key = 'pickup_min_lead_minutes'
        and jsonb_typeof(s.value) = 'number' and (s.value #>> '{}') ~ '^[0-9]{1,6}$' and (s.value #>> '{}')::integer > 0),
    120);
$$;
revoke all on function private.pickup_lead_minutes() from public, anon, authenticated;

-- Same signature, volatility, search_path and (never-granted) EXECUTE as the 20261028200000 original;
-- CREATE OR REPLACE keeps the revoked grants. Callers (guard_shipment, confirm_shipment, the dispatch
-- reservation checks) are SECURITY DEFINER, so reading private.settings needs no new grant for them.
create or replace function private.pickup_slot_ok(p_date date, p_hour integer)
returns boolean language sql stable set search_path = ''
as $$
  select p_date is not null and p_hour between 9 and 18
    and ((p_date + make_interval(hours => p_hour)) at time zone 'Asia/Jakarta')
      >= now() + make_interval(mins => private.pickup_lead_minutes());
$$;
