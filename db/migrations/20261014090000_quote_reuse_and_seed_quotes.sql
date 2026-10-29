-- Follow-ups from T-005/T-006 review (DATA-2, PR-4, UX-3).
-- 1. request_quotes reuses the unexpired quote set of the current revision instead of adding a
--    second set, so a repeated call (UI or direct RPC) never shows duplicate services.
-- 2. Seeded submitted demo examples reference the quote they were "confirmed" with, so their
--    detail and sample label show a service like every newly issued shipment.

create or replace function public.request_quotes(p_shipment uuid, p_expected_revision integer)
returns setof public.shipment_quotes language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  t public.tenants;
  q record;
  v_quote uuid;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state not in ('draft', 'estimated') then
    raise exception 'shipment_locked' using errcode = '42501';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;
  if s.sender_name is null or s.sender_phone is null or s.recipient_name is null
     or s.recipient_phone is null or s.recipient_address is null or s.recipient_area is null
     or s.weight_grams is null or s.item_description is null then
    raise exception 'incomplete_draft' using errcode = '22023';
  end if;
  select * into t from public.tenants where id = s.tenant_id;
  if not t.is_demo then
    raise exception 'provider_not_connected' using errcode = '55000';
  end if;

  if s.submission_state = 'estimated' and exists (
    select 1 from public.shipment_quotes
    where tenant_id = s.tenant_id and shipment_id = s.id and shipment_revision = s.revision and expires_at > now()
  ) then
    return query select * from public.shipment_quotes
      where tenant_id = s.tenant_id and shipment_id = s.id and shipment_revision = s.revision and expires_at > now()
      order by normal_tariff_idr;
    return;
  end if;

  for q in select * from private.simulated_tariffs(s.weight_grams, s.length_cm, s.width_cm, s.height_cm) loop
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, eta_days, is_simulated, expires_at)
    values (s.tenant_id, s.id, s.revision, q.courier, q.service, q.normal_tariff_idr, q.eta_days, true,
      now() + interval '30 minutes')
    returning id into v_quote;
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr)
    values (s.tenant_id, v_quote, q.net_shipping_idr);
  end loop;

  update public.shipments set submission_state = 'estimated', updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'quoted', 'Estimasi simulasi');
  return query select * from public.shipment_quotes
    where tenant_id = s.tenant_id and shipment_id = s.id and shipment_revision = s.revision
      and expires_at > now()
    order by normal_tariff_idr;
end $$;

alter function private.seed_demo(uuid, uuid, uuid) rename to seed_demo_base;

create function private.seed_demo(p_tenant uuid, p_outlet uuid, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  v_quote uuid;
begin
  perform private.seed_demo_base(p_tenant, p_outlet, p_user);
  for s in select id, revision, customer_charge_idr, submitted_at from public.shipments
    where tenant_id = p_tenant and submission_state <> 'draft' and selected_quote_id is null
      and customer_charge_idr is not null
  loop
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, eta_days, is_simulated, quoted_at, expires_at)
    values (p_tenant, s.id, s.revision, 'Kurir Simulasi', 'Reguler', s.customer_charge_idr, '2–3 hari', true,
      s.submitted_at - interval '5 minutes', s.submitted_at + interval '25 minutes')
    returning id into v_quote;
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr)
    values (p_tenant, v_quote, (s.customer_charge_idr * 9) / 10);
    update public.shipments set selected_quote_id = v_quote where id = s.id;
  end loop;
end $$;

revoke all on function private.seed_demo(uuid, uuid, uuid), private.seed_demo_base(uuid, uuid, uuid)
  from public, anon, authenticated;
