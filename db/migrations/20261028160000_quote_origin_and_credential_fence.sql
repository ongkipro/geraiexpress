-- T-034 / PR-4, PR-5, PR-17, PR-20: immutable dispatch origin, quote-origin CAS,
-- credential AAD/version fencing, and recovery without manufacturing new consent.

alter table public.shipment_quotes
  add column origin_area_id text check (origin_area_id ~ '^[a-f0-9]{24}$'),
  add column origin_pickup_address_id text check (origin_pickup_address_id ~ '^[a-f0-9]{24}$');

-- Historical unconfirmed quotes have no reliable origin evidence. Never infer it from today's
-- outlet. Historical confirmed shipments without provider ids stop before sending for review.
update public.shipment_quotes q set expires_at = least(q.expires_at, now())
where not q.is_simulated and exists (
  select 1 from public.shipments s where s.tenant_id = q.tenant_id and s.id = q.shipment_id
    and s.submission_state in ('draft', 'estimated')
);

create or replace function public.set_outlet_mengantar_pickup(p_outlet uuid, p_address_id text, p_area_id text,
  p_address text, p_area text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid; o public.outlets;
begin
  select tenant_id into v_tenant from public.outlets where id = p_outlet;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_tenant_admin_locked(v_tenant);
  if coalesce(p_address_id, '') !~ '^[a-f0-9]{24}$' or coalesce(p_area_id, '') !~ '^[a-f0-9]{24}$'
     or char_length(btrim(coalesce(p_address, ''))) not between 5 and 500
     or char_length(btrim(coalesce(p_area, ''))) not between 3 and 160 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into o from public.outlets where tenant_id = v_tenant and id = p_outlet for update;
  update public.outlets set mengantar_pickup_address_id = p_address_id, mengantar_area_id = p_area_id,
    pickup_address = btrim(p_address), pickup_area = btrim(p_area)
  where tenant_id = v_tenant and id = p_outlet;
  if o.mengantar_pickup_address_id is distinct from p_address_id or o.mengantar_area_id is distinct from p_area_id
     or o.pickup_address is distinct from btrim(p_address) or o.pickup_area is distinct from btrim(p_area) then
    update public.shipment_quotes q set expires_at = least(q.expires_at, now())
    where q.tenant_id = v_tenant and q.expires_at > now() and exists (
      select 1 from public.shipments s where s.tenant_id = v_tenant and s.id = q.shipment_id
        and s.outlet_id = p_outlet and s.submission_state in ('draft', 'estimated')
    );
  end if;
  perform private.audit('outlet.mengantar_pickup', v_tenant, null, null, 'set',
    jsonb_build_object('outlet', p_outlet, 'address_id', p_address_id, 'area_id', p_area_id));
end $$;
revoke all on function public.set_outlet_mengantar_pickup(uuid, text, text, text, text) from public, anon;
grant execute on function public.set_outlet_mengantar_pickup(uuid, text, text, text, text) to authenticated;

-- The draft remains broader; these limits apply only at the real quote/confirmation boundary.
create function private.require_live_recipient(s public.shipments)
returns void language plpgsql immutable set search_path = ''
as $$
declare v_phone text;
begin
  if s.recipient_name is null or char_length(s.recipient_name) not between 1 and 100 then
    raise exception 'live_recipient_name_invalid' using errcode = '22023';
  end if;
  if s.recipient_address is null or char_length(s.recipient_address) not between 5 and 300 then
    raise exception 'live_recipient_address_invalid' using errcode = '22023';
  end if;
  v_phone := regexp_replace(coalesce(s.recipient_phone, ''), '^\+', '');
  if left(v_phone, 2) = '62' then v_phone := '0' || substr(v_phone, 3); end if;
  if v_phone !~ '^0[0-9]{9,14}$' then
    raise exception 'live_recipient_phone_invalid' using errcode = '22023';
  end if;
end $$;
revoke all on function private.require_live_recipient(public.shipments) from public, anon, authenticated;

-- Mandatory origin supplied by the Worker from BEFORE its remote estimate. No unbound overload.
drop function public.record_live_quotes(uuid, uuid, integer, jsonb);
create or replace function public.record_live_quotes(p_tenant uuid, p_shipment uuid, p_expected_revision integer,
  p_rows jsonb, p_origin_area_id text, p_origin_address_id text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments; o public.outlets; r jsonb; v_quote uuid; v_count integer := 0;
  v_cod_supported boolean; v_fee_raw text; v_cod_fee bigint; v_tariff bigint; v_net bigint;
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
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values (s.tenant_id, v_quote, v_net);
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

create or replace function public.confirm_shipment(p_shipment uuid, p_quote uuid, p_expected_revision integer,
  p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments; q public.shipment_quotes; o public.outlets; t public.tenants;
  op public.provider_operations; v_awb text; v_digest text;
begin
  s := private.lock_member_shipment(p_shipment);
  v_digest := md5(row(s.sender_name, s.sender_phone, s.recipient_name, s.recipient_phone, s.recipient_address,
    s.recipient_area, s.recipient_area_id, s.recipient_postal_code, s.item_description, s.weight_grams, s.length_cm,
    s.width_cm, s.height_cm, s.goods_value_idr, s.is_cod, p_quote)::text);
  select * into op from public.provider_operations
    where tenant_id = s.tenant_id and (idempotency_key = p_idempotency_key
      or (shipment_id = s.id and kind = 'create_order' and not private.definitely_not_created(state, result_code)))
    order by (idempotency_key = p_idempotency_key) desc limit 1;
  if found then
    if op.shipment_id <> s.id
       or (op.idempotency_key = p_idempotency_key and op.input_digest <> v_digest) then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object('operation_id', op.id, 'state', op.state, 'awb', s.awb, 'replayed', true,
      'simulated', op.is_simulated);
  end if;
  if s.submission_state <> 'estimated' then raise exception 'not_estimated' using errcode = '55000'; end if;
  if s.revision is distinct from p_expected_revision then raise exception 'stale_revision' using errcode = '55000'; end if;
  select * into q from public.shipment_quotes where id = p_quote and tenant_id = s.tenant_id and shipment_id = s.id;
  if not found or q.shipment_revision <> s.revision then raise exception 'stale_quote' using errcode = '55000'; end if;
  if q.expires_at <= now() then raise exception 'quote_expired' using errcode = '55000'; end if;
  if s.is_simulated <> q.is_simulated then raise exception 'stale_quote' using errcode = '55000'; end if;
  if s.is_cod then
    if coalesce(s.goods_value_idr, 0) < 1000 then raise exception 'cod_goods_value_required' using errcode = '22023'; end if;
    if not q.cod_supported then raise exception 'cod_not_supported' using errcode = '22023'; end if;
  end if;
  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id for share;
  select * into t from public.tenants where id = s.tenant_id;
  if not s.is_simulated then
    if t.is_demo or t.lifecycle <> 'active' then raise exception 'tenant_not_active' using errcode = '55000'; end if;
    if o.mengantar_pickup_address_id is null or o.mengantar_area_id is null then
      raise exception 'pickup_not_set' using errcode = '55000';
    end if;
    if q.origin_area_id is distinct from o.mengantar_area_id
       or q.origin_pickup_address_id is distinct from o.mengantar_pickup_address_id then
      raise exception 'stale_quote' using errcode = '55000';
    end if;
    perform private.require_live_recipient(s);
    if s.recipient_area_id is null then raise exception 'area_required' using errcode = '22023'; end if;
    if coalesce(s.goods_value_idr, 0) < 1 then raise exception 'goods_value_required' using errcode = '22023'; end if;
    if not exists (select 1 from private.seller_credentials c where c.tenant_id = s.tenant_id and c.superseded_at is null) then
      raise exception 'provider_not_connected' using errcode = '55000';
    end if;
  end if;
  begin
    insert into public.provider_operations (tenant_id, shipment_id, kind, idempotency_key, input_digest,
      state, is_simulated, actor)
    values (s.tenant_id, s.id, 'create_order', p_idempotency_key, v_digest, 'queued', s.is_simulated, (select auth.uid()))
    returning * into op;
  exception when unique_violation then raise exception 'idempotency_conflict' using errcode = '23505';
  end;
  update public.shipments set submission_state = 'queued', selected_quote_id = q.id,
    customer_charge_idr = q.customer_charge_idr,
    cod_amount_idr = case when s.is_cod then s.goods_value_idr + q.customer_charge_idr else null end,
    pickup_snapshot = jsonb_build_object('outlet', o.name, 'address', o.pickup_address, 'area', o.pickup_area,
      'mengantar_pickup_address_id', o.mengantar_pickup_address_id, 'mengantar_area_id', o.mengantar_area_id),
    submitted_at = now(), updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'submitted',
    q.courier || ' ' || q.service || case when s.is_cod then ' (COD)' else '' end);
  if not s.is_simulated then
    return jsonb_build_object('operation_id', op.id, 'state', 'queued', 'awb', null, 'replayed', false, 'simulated', false);
  end if;
  v_awb := 'SIM' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')
    || lpad((floor(random() * 1000000))::int::text, 6, '0');
  update public.provider_operations set state = 'succeeded', attempts = 1, result_code = 'SIMULATED_OK',
    updated_at = now() where id = op.id;
  update public.shipments set submission_state = 'issued', payment_state = 'paid', awb = v_awb,
    issued_at = now(), updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'issued', 'Resi simulasi ' || v_awb);
  return jsonb_build_object('operation_id', op.id, 'state', 'succeeded', 'awb', v_awb, 'replayed', false, 'simulated', true);
end $$;
revoke all on function public.confirm_shipment(uuid, uuid, integer, text) from public, anon;
grant execute on function public.confirm_shipment(uuid, uuid, integer, text) to authenticated;

create or replace function private.dispatch_payload(op public.provider_operations)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s public.shipments; q public.shipment_quotes; c private.seller_credentials;
begin
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;
  select * into c from private.seller_credentials
    where tenant_id = s.tenant_id and superseded_at is null and version = op.credential_version;
  return jsonb_build_object(
    'operation_id', op.id, 'tenant_id', op.tenant_id, 'attempt', op.attempts,
    'provider_env', op.provider_env, 'dispatched_at', op.dispatched_at,
    'reference', s.reference, 'courier', q.courier,
    'pickup_address_id', s.pickup_snapshot->>'mengantar_pickup_address_id',
    'pickup_area_id', s.pickup_snapshot->>'mengantar_area_id',
    'recipient', jsonb_build_object('area_id', s.recipient_area_id, 'address', s.recipient_address,
      'name', s.recipient_name, 'phone', s.recipient_phone),
    'weight_grams', s.weight_grams, 'item_description', s.item_description, 'goods_value_idr', s.goods_value_idr,
    'is_cod', s.is_cod, 'cod_amount_idr', s.cod_amount_idr,
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;
revoke all on function private.dispatch_payload(public.provider_operations) from public, anon, authenticated;

-- Freeze owner and consent facts once the provider has created a seller, including direct writes.
create or replace function private.preserve_partner_seller_binding()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.partner_seller_id is not null then
    if new.partner_seller_id is distinct from old.partner_seller_id then
      raise exception 'immutable_partner_seller_id' using errcode = '42501';
    end if;
    if row(new.owner_name, new.owner_email, new.owner_phone, new.terms_version, new.privacy_version,
      new.consent_actor_id, new.consent_recorded_at) is distinct from
      row(old.owner_name, old.owner_email, old.owner_phone, old.terms_version, old.privacy_version,
      old.consent_actor_id, old.consent_recorded_at) then
      raise exception 'immutable_partner_owner_consent' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.preserve_partner_seller_binding() from public, anon, authenticated;

create or replace function public.begin_partner_seller_onboarding(p_tenant uuid, p_owner_name text,
  p_owner_email text, p_owner_phone text, p_terms_version text, p_privacy_version text, p_agreed boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_owner_name, ''));
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
  v_phone text := regexp_replace(btrim(coalesce(p_owner_phone, '')), '[\s()-]+', '', 'g');
  v_terms text := btrim(coalesce(p_terms_version, ''));
  v_privacy text := btrim(coalesce(p_privacy_version, ''));
  o private.tenant_mengantar_onboarding; v_latest integer;
begin
  if private.member_role(p_tenant) is not null and (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  perform private.require_tenant_admin_locked(p_tenant);
  perform 1 from public.tenants where id = p_tenant for update;
  if coalesce(p_agreed, false) is not true or char_length(v_terms) not between 1 and 64
     or char_length(v_privacy) not between 1 and 64 then raise exception 'consent_required' using errcode = '22023'; end if;
  if v_name !~ '^[A-Za-z0-9 ._''@-]{1,100}$' or char_length(v_email) > 254
     or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or v_email like '%@geraiexpress.local'
     or v_email like '%@example.com' or v_phone !~ '^(?:\+?62|0)8[0-9]{8,13}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into o from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if o.onboarding_state = 'connected' and exists (
    select 1 from private.seller_credentials c where c.tenant_id = p_tenant and c.superseded_at is null
  ) then raise exception 'already_partner_connected' using errcode = '23505'; end if;
  -- A repeat registration is not an owner/profile update or a new agreement.
  if o.partner_seller_id is null then
    insert into private.tenant_mengantar_onboarding (tenant_id, external_user_id, connection_mode, onboarding_state,
      owner_name, owner_email, owner_phone, terms_version, privacy_version, consent_actor_id, consent_recorded_at,
      last_error_code, retry_after_at, updated_at)
    values (p_tenant, 'geraiexpress:tenant:' || p_tenant::text, 'none', 'registration_pending',
      v_name, v_email, v_phone, v_terms, v_privacy, (select auth.uid()), now(), null, null, now())
    on conflict (tenant_id) do update set onboarding_state = 'registration_pending',
      owner_name = excluded.owner_name, owner_email = excluded.owner_email, owner_phone = excluded.owner_phone,
      terms_version = excluded.terms_version, privacy_version = excluded.privacy_version,
      consent_actor_id = excluded.consent_actor_id, consent_recorded_at = excluded.consent_recorded_at,
      last_error_code = null, retry_after_at = null, updated_at = now()
    returning * into o;
    perform private.audit('partner.onboarding_begin', p_tenant, null, null, 'registration_pending',
      jsonb_build_object('external_user_id', o.external_user_id, 'partner_seller_id', o.partner_seller_id,
        'terms_version', o.terms_version, 'privacy_version', o.privacy_version));
  end if;
  select coalesce(max(c.version), 0) into v_latest from private.seller_credentials c where c.tenant_id = p_tenant;
  return jsonb_build_object('external_user_id', o.external_user_id, 'partner_seller_id', o.partner_seller_id,
    'latest_credential_version', v_latest);
end $$;
revoke all on function public.begin_partner_seller_onboarding(uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.begin_partner_seller_onboarding(uuid, text, text, text, text, text, boolean) to authenticated;

-- Recovery is a distinct authorized read of persisted facts, never synthetic affirmative consent.
create function public.begin_partner_seller_key_recovery(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare o private.tenant_mengantar_onboarding; v_latest integer;
begin
  perform private.require_tenant_admin_locked(p_tenant);
  perform 1 from public.tenants where id = p_tenant for update;
  select * into o from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found or o.consent_actor_id is null or o.consent_recorded_at is null
     or nullif(btrim(o.terms_version), '') is null or nullif(btrim(o.privacy_version), '') is null then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if o.onboarding_state <> 'registered_key_pending' or o.partner_seller_id is null or exists (
    select 1 from private.seller_credentials c where c.tenant_id = p_tenant and c.superseded_at is null
  ) then raise exception 'not_recoverable' using errcode = '55000'; end if;
  select coalesce(max(c.version), 0) into v_latest from private.seller_credentials c where c.tenant_id = p_tenant;
  return to_jsonb(o) || jsonb_build_object('latest_credential_version', v_latest);
end $$;
revoke all on function public.begin_partner_seller_key_recovery(uuid) from public, anon;
grant execute on function public.begin_partner_seller_key_recovery(uuid) to authenticated;

-- No old unfenced overload remains reachable, even by the machine identity.
drop function public.complete_partner_seller_onboarding(uuid, text, text, text, text, text);
create or replace function public.complete_partner_seller_onboarding(p_tenant uuid, p_seller_id text,
  p_ciphertext text, p_iv text, p_key_version text, p_hint text, p_expected_version integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_demo boolean; v_latest integer; v_onb private.tenant_mengantar_onboarding;
begin
  -- BYOK writers lock these same membership rows. The tenant lock alone would not serialize
  -- Partner completion against store_seller_credential's earlier read/clear/insert interval.
  perform 1 from public.memberships where tenant_id = p_tenant for update;
  select is_demo into v_demo from public.tenants where id = p_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_demo then raise exception 'demo_restricted' using errcode = '42501'; end if;
  if coalesce(p_seller_id, '') !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
  select * into v_onb from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found then raise exception 'consent_required' using errcode = '22023'; end if;
  if v_onb.partner_seller_id is not null and v_onb.partner_seller_id <> p_seller_id then
    raise exception 'seller_binding_mismatch' using errcode = '42501';
  end if;
  select coalesce(max(c.version), 0) into v_latest from private.seller_credentials c where c.tenant_id = p_tenant;
  if v_latest is distinct from p_expected_version then raise exception 'stale_state' using errcode = '55000'; end if;
  begin
    update private.tenant_mengantar_onboarding set partner_seller_id = p_seller_id
    where tenant_id = p_tenant and partner_seller_id is null;
  exception when unique_violation then raise exception 'seller_binding_conflict' using errcode = '23505';
  end;
  update private.seller_credentials c set superseded_at = now(), ciphertext = null, iv = null
    where c.tenant_id = p_tenant and c.superseded_at is null;
  insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, created_by)
  values (p_tenant, 'partner', p_ciphertext, p_iv, p_key_version, p_hint, v_latest + 1, v_onb.consent_actor_id);
  update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null
    where tenant_id = p_tenant and mengantar_pickup_address_id is not null;
  update private.tenant_mengantar_onboarding set connection_mode = 'partner_managed', onboarding_state = 'connected',
    last_error_code = null, retry_after_at = null, updated_at = now() where tenant_id = p_tenant;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (v_onb.consent_actor_id, 'partner.onboarding_complete', p_tenant, null, null, 'connected',
    jsonb_build_object('mode', 'partner', 'seller_id', p_seller_id, 'version', v_latest + 1, 'hint', p_hint, 'via', 'machine'));
  return v_latest + 1;
end $$;
revoke all on function public.complete_partner_seller_onboarding(uuid, text, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.complete_partner_seller_onboarding(uuid, text, text, text, text, text, integer) to service_role;
