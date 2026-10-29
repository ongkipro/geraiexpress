-- T-043 / TD-12 review fix (M2): the pickup reservation read-back (GET /time) must not adopt a time
-- record that another shipment of the same tenant already holds. This machine-only read returns the
-- time ids stored on the tenant's OTHER create-order operations, open or closed. Pure read, no lock;
-- the caller (the dispatcher) excludes these ids from the rows it matches against the lost slot.
create function public.dispatch_pickup_known_time_ids(p_operation uuid)
returns text[] language plpgsql stable security definer set search_path = ''
as $$
declare op public.provider_operations;
begin
  select * into op from public.provider_operations where id = p_operation;
  if not found or op.is_simulated or op.kind <> 'create_order' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return coalesce((
    select array_agg(distinct o.pickup_time_id order by o.pickup_time_id)
    from public.provider_operations o
    where o.tenant_id = op.tenant_id and o.id <> op.id and o.pickup_time_id is not null
  ), array[]::text[]);
end $$;

revoke all on function public.dispatch_pickup_known_time_ids(uuid) from public, anon, authenticated;
grant execute on function public.dispatch_pickup_known_time_ids(uuid) to service_role;

-- Audit review fix (L3): the unfiltered platform audit view hides invoice snapshots (one row per
-- issued shipment, like label snapshots); filtering by that action still returns them. Everything
-- else is the final definition (20261028220000) unchanged; CREATE OR REPLACE keeps its grants.
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
    where case when p_action is null then e.action not in ('label.snapshot', 'invoice.snapshot') else e.action = p_action end
    order by e.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;
