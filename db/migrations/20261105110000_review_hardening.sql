-- T-101: forward-only review remediation. Existing function signatures and ACLs are retained.
-- Machine writes use SECURITY DEFINER RPCs, never these payment tables directly.
revoke all on public.counter_payments, public.cash_periods from service_role;

-- NO ACTION checks the final statement state: deleting a period alone cannot erase history,
-- while shipment/outlet/tenant cascades still remove the payment with its owner, in any order.
alter table public.counter_payments
  drop constraint counter_payments_tenant_id_period_id_fkey,
  add constraint counter_payments_tenant_id_period_id_fkey
    foreign key (tenant_id, period_id) references public.cash_periods (tenant_id, id) on delete no action;

-- NULL array comparisons do not fail a CHECK. Require a one-based pair of known endpoints.
alter table private.billable_weight_rules
  add constraint billable_weight_rules_cargo_range_endpoints check (
    cargo_minimum_range_grams is null or (
      array_lower(cargo_minimum_range_grams, 1) = 1
      and cargo_minimum_range_grams[1] is not null
      and cargo_minimum_range_grams[2] is not null));

-- Latest body: 20261104120000_counter_payments.sql.
create or replace function public.void_counter_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  p public.counter_payments;
  v_reason text;
  v_closed timestamptz;
begin
  select tenant_id, shipment_id into v_tenant, v_shipment from public.counter_payments where id = p_payment;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  -- assistant-recommended: unlike require_tenant_admin_locked, a demo tenant administrator may void
  -- (the demo records simulated payments and must be able to show the void flow).
  if private.member_role(v_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  -- Acquire the shipment before membership, like batch authorization/unknown-payment closure.
  -- Keep the authoritative administrator recheck after the membership lock.
  perform private.lock_member_shipment(v_shipment);
  perform 1 from public.memberships where tenant_id = v_tenant for update;
  if private.member_role(v_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  v_reason := private.require_reason(p_reason);

  -- Match record/receipt lock order (shipment -> payment -> period), including the shipment FK lock
  -- taken by add_event. A payment-first void can deadlock with a concurrent receipt print.
  select * into p from public.counter_payments where tenant_id = v_tenant and id = p_payment for update;
  if p.voided_at is not null then raise exception 'payment_voided' using errcode = '55000'; end if;
  select closed_at into v_closed from public.cash_periods
    where tenant_id = v_tenant and id = p.period_id for update;
  if v_closed is not null then raise exception 'period_closed' using errcode = '55000'; end if;

  update public.counter_payments set voided_at = now(), voided_by = (select auth.uid()), void_reason = v_reason
    where tenant_id = v_tenant and id = p.id;
  perform private.add_event(v_tenant, p.shipment_id, 'counter_payment_voided', 'Catatan pembayaran dibatalkan');
  perform private.audit('counter_payment.void', v_tenant, null, v_reason, 'succeeded',
    jsonb_build_object('payment', p.id, 'shipment', p.shipment_id, 'period', p.period_id, 'amount_idr', p.amount_idr));
end $$;

-- Latest body: 20261103100000_cargo_noncod.sql.
create or replace function public.record_live_quotes(p_tenant uuid, p_shipment uuid, p_expected_revision integer,
  p_rows jsonb, p_origin_area_id text, p_origin_address_id text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments; o public.outlets; r jsonb; v_quote uuid; v_count integer := 0;
  v_cod_supported boolean; v_fee_raw text; v_cod_fee bigint; v_tariff bigint; v_net bigint;
  v_discount_bps integer; v_rule private.billable_weight_rules; v_weight record; v_class text;
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
    -- Absent class is the legacy regular row. Cargo is non-COD only and must carry the sourced rule
    -- plus the provider's route minimum, which must equal that rule (no billing floor is inferred).
    v_class := coalesce(r->>'service_class', 'regular');
    if v_class not in ('regular', 'cargo') then raise exception 'invalid_input' using errcode = '22023'; end if;
    if v_class = 'cargo' and (s.is_cod or r->>'courier' not in ('JNE', 'SiCepat', 'Sap', 'iDexpress')
       or r->>'weight_rule_id' is null or coalesce(r->>'minimum_weight_grams', '') !~ '^[0-9]{1,7}$') then
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
    if v_class = 'cargo' then v_cod_supported := false; end if;
    if s.is_cod and not v_cod_supported then continue; end if;
    if s.is_cod then
      v_fee_raw := coalesce(r->>'cod_fee', r->>'codFee');
      if v_fee_raw is null then continue; end if;
      if v_fee_raw !~ '^[0-9]{1,9}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
      v_cod_fee := v_fee_raw::bigint;
    else
      v_cod_fee := 0;
    end if;
    v_rule := null;
    if r->>'weight_rule_id' is not null then
      select * into v_rule from private.billable_weight_rules where id = (r->>'weight_rule_id')::uuid
        and courier = r->>'courier' and service_class = v_class and effective_at <= now();
      if not found then raise exception 'invalid_weight_rule' using errcode = '22023'; end if;
    else
      select * into v_rule from private.billable_weight_rules where courier = r->>'courier'
        and service_class = 'regular' and effective_at <= now() order by effective_at desc limit 1;
    end if;
    if v_class = 'cargo' and (v_rule.min_weight_grams is null
       or (r->>'minimum_weight_grams')::integer is distinct from v_rule.min_weight_grams) then
      raise exception 'invalid_weight_rule' using errcode = '22023';
    end if;
    select * into v_weight from private.billable_weight(s.weight_grams, s.length_cm, s.width_cm, s.height_cm, v_rule);
    -- Legacy machine callers without dimensions sent actual weight. Complete dimensions require
    -- the explicit weight actually sent; never silently attach a different computed quote weight.
    if (r ? 'billable_weight_grams' and (r->>'billable_weight_grams')::integer is distinct from v_weight.billable_weight_grams)
      or (s.length_cm is not null and s.width_cm is not null and s.height_cm is not null
        and not (r ? 'billable_weight_grams')) then
      raise exception 'quote_weight_mismatch' using errcode = '22023';
    end if;
    if v_weight.exclusion is not null then
      perform private.add_event(s.tenant_id, s.id, 'quote_weight_excluded', (r->>'courier') || case when v_class = 'cargo' then ' Kargo' else '' end || ': ' || v_weight.exclusion);
      continue;
    end if;
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, expires_at,
      origin_area_id, origin_pickup_address_id, actual_weight_grams, volumetric_weight_grams, billable_weight_grams, weight_rule_id, service_class)
    values (s.tenant_id, s.id, s.revision, r->>'courier', case when v_class = 'cargo' then 'Kargo' else 'Reguler' end, v_tariff,
      v_cod_supported, v_cod_fee, v_tariff + v_cod_fee, coalesce(nullif(r->>'eta', ''), '—'), false,
      now() + interval '30 minutes', p_origin_area_id, p_origin_address_id, v_weight.actual_weight_grams,
      v_weight.volumetric_weight_grams, v_weight.billable_weight_grams, v_weight.weight_rule_id, v_class)
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

-- Required revisions must refuse SQL NULL as well as stale values. Optional-revision guards are unchanged.

-- Latest body: 20261014140000_invitations.sql.
create or replace function public.revoke_invitation(p_id uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare i public.tenant_invitations;
begin
  select * into i from public.tenant_invitations where id = p_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_tenant_admin_locked(i.tenant_id);
  select * into i from public.tenant_invitations where id = p_id for update;
  if i.status <> 'pending' or i.revision is distinct from p_expected_revision then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  update public.tenant_invitations t set status = 'revoked', revoked_at = now(), revision = t.revision + 1
    where t.id = p_id;
  perform private.audit('member.invite_revoke', i.tenant_id, null, null, 'revoked',
    jsonb_build_object('invitation', p_id));
end $$;

-- Latest body: 20261014140000_invitations.sql.
create or replace function public.set_member_role(p_tenant uuid, p_user uuid, p_role text, p_expected_revision integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare m public.memberships;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  if p_role is null or p_role not in ('tenant_admin', 'operator') then raise exception 'transition_not_allowed' using errcode = '22023'; end if;
  select * into m from public.memberships where tenant_id = p_tenant and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status <> 'active' or m.revision is distinct from p_expected_revision then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  update public.memberships t set role = p_role, revision = t.revision + 1
    where t.tenant_id = p_tenant and t.user_id = p_user;
  perform private.assert_tenant_admin_remains(p_tenant);
  perform private.audit('member.role', p_tenant, p_user, null, p_role,
    jsonb_build_object('from', m.role, 'to', p_role));
end $$;

-- Latest body: 20261014140000_invitations.sql.
create or replace function public.deactivate_member(p_tenant uuid, p_user uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare m public.memberships;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  select * into m from public.memberships where tenant_id = p_tenant and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if m.status <> 'active' or m.revision is distinct from p_expected_revision then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  update public.memberships t set status = 'revoked', revision = t.revision + 1
    where t.tenant_id = p_tenant and t.user_id = p_user;
  perform private.assert_tenant_admin_remains(p_tenant);
  perform private.audit('member.deactivate', p_tenant, p_user, null, 'revoked',
    jsonb_build_object('role', m.role));
end $$;

-- Latest body: 20261014120000_platform_admin.sql.
create or replace function public.platform_revoke_grant(p_user uuid, p_expected_revision integer, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  g public.platform_grants;
begin
  perform private.require_platform('access_governance'); -- cheap refusal before contending for locks
  perform 1 from public.platform_grants for update;
  perform private.require_platform('access_governance');
  v_reason := private.require_reason(p_reason);
  select * into g from public.platform_grants where user_id = p_user;
  if not found or g.revoked_at is not null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if g.revision is distinct from p_expected_revision then raise exception 'stale_state' using errcode = '55000'; end if;
  update public.platform_grants set revoked_at = now(), revision = revision + 1 where user_id = p_user;
  perform private.assert_access_governor_remains();
  perform private.audit('platform.revoke', null, p_user, v_reason, 'revoked',
    jsonb_build_object('capabilities', g.capabilities));
end $$;

-- Latest body: 20261014130000_registration.sql.
create or replace function public.save_application(p_expected_revision integer, p_business_name text,
  p_outlet_name text, p_pickup_address text, p_pickup_area text, p_contact_phone text)
returns table (id uuid, revision integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_verified_identity();
  a public.tenant_applications;
begin
  if not public.registration_open() then raise exception 'registration_closed' using errcode = '55000'; end if;
  select * into a from public.tenant_applications t
    where t.applicant = v_user and t.status in ('draft', 'submitted', 'changes_requested') for update;
  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then raise exception 'stale_state' using errcode = '55000'; end if;
    insert into public.tenant_applications (applicant, business_name, outlet_name, pickup_address,
      pickup_area, contact_phone)
    values (v_user, private.clean(p_business_name), private.clean(p_outlet_name),
      private.clean(p_pickup_address), private.clean(p_pickup_area), private.clean(p_contact_phone))
    returning * into a;
    return query select a.id, a.revision;
    return;
  end if;
  if a.status = 'submitted' then raise exception 'application_locked' using errcode = '55000'; end if;
  if a.revision is distinct from p_expected_revision then raise exception 'stale_state' using errcode = '55000'; end if;
  update public.tenant_applications t set business_name = private.clean(p_business_name),
    outlet_name = private.clean(p_outlet_name), pickup_address = private.clean(p_pickup_address),
    pickup_area = private.clean(p_pickup_area), contact_phone = private.clean(p_contact_phone),
    revision = t.revision + 1, updated_at = now()
  where t.id = a.id returning * into a;
  return query select a.id, a.revision;
end $$;

-- Latest body: 20261014130000_registration.sql.
create or replace function public.submit_application(p_id uuid, p_expected_revision integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_verified_identity();
  a public.tenant_applications;
begin
  if not public.registration_open() then raise exception 'registration_closed' using errcode = '55000'; end if;
  select * into a from public.tenant_applications t where t.id = p_id and t.applicant = v_user for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status not in ('draft', 'changes_requested') then raise exception 'application_locked' using errcode = '55000'; end if;
  if a.revision is distinct from p_expected_revision then raise exception 'stale_state' using errcode = '55000'; end if;
  if a.business_name is null or a.outlet_name is null or a.pickup_address is null
     or a.pickup_area is null or a.contact_phone is null then
    raise exception 'incomplete_application' using errcode = '23514';
  end if;
  update public.tenant_applications t set status = 'submitted', submitted_at = now(),
    revision = t.revision + 1, updated_at = now() where t.id = a.id;
  return a.revision + 1;
end $$;

-- Latest body: 20261014130000_registration.sql.
create or replace function public.withdraw_application(p_id uuid, p_expected_revision integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := private.require_verified_identity();
  a public.tenant_applications;
begin
  select * into a from public.tenant_applications t where t.id = p_id and t.applicant = v_user for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status not in ('draft', 'submitted', 'changes_requested') then
    raise exception 'application_locked' using errcode = '55000';
  end if;
  if a.revision is distinct from p_expected_revision then raise exception 'stale_state' using errcode = '55000'; end if;
  update public.tenant_applications t set status = 'withdrawn', revision = t.revision + 1,
    updated_at = now() where t.id = a.id;
end $$;

-- Latest body: 20261028150000_masked_label.sql.
create or replace function public.platform_review_application(p_id uuid, p_expected_revision integer,
  p_decision text, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  a public.tenant_applications;
  v_tenant uuid;
begin
  perform private.require_platform('tenant_governance');
  perform 1 from public.platform_grants where user_id = (select auth.uid()) for share;
  perform private.require_platform('tenant_governance');
  v_reason := private.require_reason(p_reason);
  if p_decision not in ('approve', 'reject', 'request_changes') then
    raise exception 'transition_not_allowed' using errcode = '55000';
  end if;
  select * into a from public.tenant_applications t where t.id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if a.status <> 'submitted' then raise exception 'stale_state' using errcode = '55000'; end if;
  if a.revision is distinct from p_expected_revision then raise exception 'stale_state' using errcode = '55000'; end if;
  -- Separation of duties: nobody decides their own application.
  if a.applicant = (select auth.uid()) then raise exception 'own_application' using errcode = '42501'; end if;

  if p_decision = 'approve' then
    insert into public.tenants (name, lifecycle, contact_whatsapp)
      values (a.business_name, 'active', private.normalize_whatsapp(a.contact_phone)) returning id into v_tenant;
    insert into public.outlets (tenant_id, name, pickup_address, pickup_area)
      values (v_tenant, a.outlet_name, a.pickup_address, a.pickup_area);
    insert into public.memberships (tenant_id, user_id, role) values (v_tenant, a.applicant, 'tenant_admin');
  end if;
  update public.tenant_applications t set
    status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'changes_requested' end,
    review_reason = v_reason, reviewed_by = (select auth.uid()), reviewed_at = now(),
    tenant_id = v_tenant, revision = t.revision + 1, updated_at = now()
  where t.id = a.id;
  perform private.audit('application.review', v_tenant, a.applicant, v_reason, p_decision,
    jsonb_build_object('application', a.id, 'revision', a.revision));
  return v_tenant;
end $$;

-- Latest body: 20261102100000_billable_weight.sql.
create or replace function public.request_quotes(p_shipment uuid, p_expected_revision integer)
returns setof public.shipment_quotes language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  t public.tenants;
  q record;
  v_quote uuid;
  v_cod_fee bigint; v_rule private.billable_weight_rules; v_weight record;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.submission_state not in ('draft', 'estimated') then
    raise exception 'shipment_locked' using errcode = '42501';
  end if;
  if s.revision is distinct from p_expected_revision then
    raise exception 'stale_revision' using errcode = '55000';
  end if;
  if s.sender_name is null or s.sender_phone is null or s.recipient_name is null
     or s.recipient_phone is null or s.recipient_address is null or s.recipient_area is null
     or s.weight_grams is null or s.item_description is null then
    raise exception 'incomplete_draft' using errcode = '22023';
  end if;
  if s.is_cod and coalesce(s.goods_value_idr, 0) < 1000 then
    raise exception 'cod_goods_value_required' using errcode = '22023';
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
      order by customer_charge_idr, normal_tariff_idr;
    return;
  end if;

  -- The fictional services share the sourced SiCepat regular rule, not a code constant.
  select * into v_rule from private.billable_weight_rules where courier = 'SiCepat' and service_class = 'regular'
    and effective_at <= now() order by effective_at desc limit 1;
  select * into v_weight from private.billable_weight(s.weight_grams, s.length_cm, s.width_cm, s.height_cm, v_rule);
  if v_weight.exclusion is not null then
    perform private.add_event(s.tenant_id, s.id, 'quote_weight_excluded', 'Kurir Simulasi: ' || v_weight.exclusion);
  end if;
  for q in select * from private.simulated_tariffs(s.weight_grams, s.length_cm, s.width_cm, s.height_cm) loop
    -- Hemat does not support simulated COD; Reguler and Kilat support COD with a 3% fee rounded up to 100 IDR.
    if s.is_cod and q.service = 'Hemat' then
      continue;
    end if;
    v_cod_fee := case
      when s.is_cod then ceil(((s.goods_value_idr + q.normal_tariff_idr) * 0.03) / 100.0)::bigint * 100
      else 0
    end;
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, expires_at, actual_weight_grams, volumetric_weight_grams, billable_weight_grams, weight_rule_id)
    values (s.tenant_id, s.id, s.revision, q.courier, q.service, q.normal_tariff_idr,
      q.service in ('Reguler', 'Kilat'), v_cod_fee, q.normal_tariff_idr + v_cod_fee,
      q.eta_days, true, now() + interval '30 minutes', v_weight.actual_weight_grams, v_weight.volumetric_weight_grams,
      v_weight.billable_weight_grams, v_weight.weight_rule_id)
    returning id into v_quote;
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr)
    values (s.tenant_id, v_quote, q.net_shipping_idr);
  end loop;

  update public.shipments set submission_state = case when v_weight.exclusion is null then 'estimated' else 'draft' end, updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'quoted',
    case when s.is_cod then 'Estimasi simulasi (COD)' else 'Estimasi simulasi' end);
  return query select * from public.shipment_quotes
    where tenant_id = s.tenant_id and shipment_id = s.id and shipment_revision = s.revision
      and expires_at > now()
    order by customer_charge_idr, normal_tariff_idr;
end $$;

create extension if not exists pg_trgm with schema extensions;
create index mengantar_areas_search_trgm_idx on public.mengantar_areas using gin (search extensions.gin_trgm_ops);

-- Latest body: 20261105100000_mengantar_area_catalogue.sql.
create or replace function public.search_mengantar_areas(p_query text, p_limit integer default 20)
returns table (id text, province text, city text, district text, subdistrict text, postal_code text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  -- Separators an operator types between names ("Sukatani, Tapos - Depok") are spaces; catalogue
  -- names also contain "-" and brackets, so tokens never need them.
  q text := lower(btrim(regexp_replace(regexp_replace(p_query, '[,./()-]+', ' ', 'g'), '\s+', ' ', 'g')));
  pattern text;
  tokens text[];
  longest_token text;
begin
  if not exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and private.is_member(m.tenant_id)
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if q is null or char_length(q) not between 3 and 60
     or p_limit is null or p_limit not between 1 and 30 then
    raise exception 'invalid_area_search' using errcode = '22023';
  end if;
  -- Search input is literal, not a user-supplied LIKE pattern.
  pattern := replace(replace(replace(q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
  -- Every word must appear somewhere ("sukatani depok" matches kelurahan + kota); ranking uses the
  -- whole query as typed.
  tokens := string_to_array(pattern, ' ');
  -- A positive contains predicate exposes GIN candidates; short-only queries still match literally.
  select t into longest_token from unnest(string_to_array(q, ' ')) t
    order by char_length(t) desc, t limit 1;
  longest_token := replace(replace(replace(longest_token, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
  return query
    select a.id, a.province, a.city, a.district, a.subdistrict, a.postal_code
    from public.mengantar_areas a
    where a.postal_code = q
      or (a.search like '%' || longest_token || '%'
        and not exists (select 1 from unnest(tokens) t where a.search not like '%' || t || '%'))
    order by case
      when a.postal_code = q then 0
      when lower(a.subdistrict) like pattern || '%' then 1
      when lower(a.district) like pattern || '%' then 2
      when lower(a.city) like pattern || '%' then 3
      else 4 end,
      a.subdistrict, a.district, a.city, a.province, a.id
    limit p_limit;
end $$;

revoke all on function public.search_mengantar_areas(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.search_mengantar_areas(text, integer) to authenticated;

notify pgrst, 'reload schema';
