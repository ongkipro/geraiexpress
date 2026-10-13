-- DEC-008 / IAM-1: resolving an unknown provider outcome is a tenant-admin action; an operator
-- sees the state and escalates. The role is checked before any row lock. A demo visitor is the
-- only member of their own sample gerai, so they act as its admin and the recovery path stays
-- demonstrable (PR-21).
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

create or replace function public.start_demo()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_tenant uuid;
  v_outlet uuid;
begin
  if v_user is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false then
    raise exception 'demo_requires_anonymous_session' using errcode = '42501';
  end if;
  select m.tenant_id into v_tenant from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = v_user and t.is_demo limit 1;
  if v_tenant is not null then return v_tenant; end if;

  insert into public.tenants (name, lifecycle, is_demo)
    values ('Gerai Contoh Sentosa', 'active', true) returning id into v_tenant;
  insert into public.outlets (tenant_id, name, pickup_address, pickup_area)
    values (v_tenant, 'Outlet Contoh Dago', 'Jl. Contoh Dago No. 10', 'Kec. Coblong, Kota Bandung')
    returning id into v_outlet;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant, v_user, 'tenant_admin');
  perform private.seed_demo(v_tenant, v_outlet, v_user);
  return v_tenant;
end $$;

update public.memberships m set role = 'tenant_admin'
  from public.tenants t where t.id = m.tenant_id and t.is_demo and m.role = 'operator';
