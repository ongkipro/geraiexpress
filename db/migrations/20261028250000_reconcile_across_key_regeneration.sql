-- Wave F1 (security review M2, L1, L4, L6): reconcile across a key regeneration, and three
-- guards around the credential writers. Every function below is the FINAL definition from
-- 20261028230000 (no later migration redefines any of them) plus the one change named here.
--
-- M2. A Partner key regeneration supersedes the credential version that unknown, in-flight and paid
--     orders were created with. The readers (private.dispatch_payload, private.batch_attempt_payload)
--     opened only the credential whose version equals the operation's, so after the regeneration
--     those operations could never be reconciled or payment-checked (DEC-010: unknown outcomes
--     reconcile their original operation, never a blind replay). private.operation_credential now
--     also accepts the tenant's ACTIVE credential of the SAME provider environment when the
--     operation's own credential was superseded AND both are Partner-mode: the Partner seller
--     binding is write-once per (tenant, environment), so both keys open the same seller account.
--     A BYOK key on either side never crosses versions (it may be another seller account), and a
--     credential of the other environment is never returned. The payload carries the substituted
--     credential's own version, which the Worker binds into the AES-GCM associated data.
-- L1. begin_partner_seller_onboarding and complete_partner_seller_onboarding refuse while a
--     regeneration is in flight (onboarding_state = rotation_unknown): a registration could fetch
--     and store the pre-rotation key.
-- L4. rewrap_seller_credential refuses a new key version that is not higher than the stored one.
-- L6. dispatch_claim decides staleness before the credential lookup, so an operation queued before
--     an environment switch expires instead of failing with credential_missing forever.
--
-- NOT changed (L2): the consent versions stay Worker configuration; see the finding report.

-- ============================================================ M2

create function private.operation_credential(p_tenant uuid, p_env text, p_version integer)
returns private.seller_credentials language plpgsql stable security definer set search_path = ''
as $$
declare c private.seller_credentials; own private.seller_credentials;
begin
  if p_version is null then return null; end if;
  select * into c from private.seller_credentials
    where tenant_id = p_tenant and provider_env = p_env and superseded_at is null;
  if c.id is null then return null; end if;
  if c.version = p_version then return c; end if;
  select * into own from private.seller_credentials
    where tenant_id = p_tenant and provider_env = p_env and version = p_version;
  if own.id is not null and own.superseded_at is not null and own.mode = 'partner'
     and c.mode = 'partner' and c.version > own.version then
    return c;
  end if;
  return null;
end $$;
revoke all on function private.operation_credential(uuid, text, integer) from public, anon, authenticated, service_role;

create or replace function private.dispatch_payload(op public.provider_operations)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare s public.shipments; q public.shipment_quotes; c private.seller_credentials;
begin
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;
  c := private.operation_credential(s.tenant_id, op.provider_env, op.credential_version);
  return jsonb_build_object(
    'operation_id', op.id, 'tenant_id', op.tenant_id, 'attempt', op.attempts,
    'operation_state', op.state,
    'provider_env', op.provider_env, 'dispatched_at', op.dispatched_at,
    'reference', s.reference, 'courier', q.courier,
    'pickup_address_id', s.pickup_snapshot->>'mengantar_pickup_address_id',
    'pickup_area_id', s.pickup_snapshot->>'mengantar_area_id',
    'handover', coalesce(s.pickup_snapshot->>'handover', 'dropoff'),
    'pickup_date', s.pickup_snapshot->>'pickup_date',
    'pickup_slot_hour', (s.pickup_snapshot->>'pickup_slot_hour')::integer,
    'pickup_volume', s.pickup_snapshot->>'pickup_volume',
    'pickup_phase', op.pickup_phase,
    'pickup_time_id', op.pickup_time_id,
    'recipient', jsonb_build_object('area_id', s.recipient_area_id, 'address', s.recipient_address,
      'name', s.recipient_name, 'phone', s.recipient_phone),
    'weight_grams', s.weight_grams, 'item_description', s.item_description, 'goods_value_idr', s.goods_value_idr,
    'is_cod', s.is_cod, 'cod_amount_idr', s.cod_amount_idr,
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;

create or replace function private.batch_attempt_payload(a private.batch_payment_attempts, p_mode text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  c private.seller_credentials;
  v_members jsonb;
begin
  select * into op from public.provider_operations where id = a.claim_operation_id;
  if op.credential_version is null then
    select * into c from private.seller_credentials
      where tenant_id = a.tenant_id and superseded_at is null and provider_env = op.provider_env;
  else
    c := private.operation_credential(a.tenant_id, op.provider_env, op.credential_version);
  end if;
  select jsonb_agg(jsonb_build_object(
      'shipment_id', o.shipment_id,
      'operation_id', o.id,
      'reference', sh.reference,
      'provider_order_id', o.provider_order_id,
      'customer_charge_idr', coalesce(sh.customer_charge_idr, sq.customer_charge_idr, sq.normal_tariff_idr, 0),
      'payment_state', sh.payment_state
    ) order by o.id)
    into v_members
    from public.provider_operations o
    join public.shipments sh on sh.tenant_id = o.tenant_id and sh.id = o.shipment_id
    left join public.shipment_quotes sq on sq.tenant_id = sh.tenant_id and sq.id = sh.selected_quote_id
    where o.tenant_id = a.tenant_id and o.provider_batch = a.batch_code
      and not o.is_simulated and o.state = 'succeeded' and o.provider_order_id is not null;
  return jsonb_build_object(
    'mode', p_mode,
    'attempt_id', a.id,
    'attempt_state', a.state,
    'claim_operation_id', a.claim_operation_id,
    'tenant_id', a.tenant_id,
    'provider_env', op.provider_env,
    'batch', a.batch_code,
    'batch_id', coalesce(a.batch_object_id, (select max(o.provider_batch_id) from public.provider_operations o
      where o.tenant_id = a.tenant_id and o.provider_batch = a.batch_code)),
    'courier', a.courier,
    'batch_digest', a.batch_digest,
    'members', coalesce(v_members, '[]'::jsonb),
    'credential', case when c.id is null then null else jsonb_build_object(
      'ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version) end);
end $$;

-- ============================================================ L6

create or replace function public.dispatch_claim(p_operation uuid, p_env text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  op public.provider_operations;
  t public.tenants;
  s public.shipments;
  v_version integer;
begin
  if p_env not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  op := private.lock_real_operation(p_operation);
  if op.state <> 'queued' then
    raise exception 'not_queued' using errcode = '55000';
  end if;
  select * into t from public.tenants where id = op.tenant_id for update;
  if t.is_demo or t.lifecycle <> 'active' then
    raise exception 'tenant_not_active' using errcode = '55000';
  end if;
  select * into s from public.shipments where tenant_id = op.tenant_id and id = op.shipment_id;
  if s.submission_state <> 'queued' or s.is_simulated or not exists (
    select 1 from public.shipment_quotes q where q.tenant_id = s.tenant_id and q.id = s.selected_quote_id
      and q.shipment_revision = s.revision and not q.is_simulated
      and (not s.is_cod or q.cod_supported)) then
    raise exception 'shipment_not_ready' using errcode = '55000';
  end if;
  if exists (select 1 from public.provider_operations o where o.tenant_id = op.tenant_id and not o.is_simulated
      and (o.state = 'in_flight' or (o.state = 'unknown' and o.dispatched_at > now() - interval '5 minutes')))
     or private.payment_busy(op.tenant_id) then
    raise exception 'account_busy' using errcode = '55P03';
  end if;
  -- Staleness is decided BEFORE the credential lookup (security review L6): an operation queued
  -- before an environment switch has no credential in the new environment, and used to be re-picked
  -- by every sweep without ever expiring.
  if op.created_at < now() - interval '6 hours' then
    update public.provider_operations set state = 'failed', result_code = 'QUOTE_STALE', updated_at = now() where id = op.id;
    update public.shipments set submission_state = 'failed', updated_at = now() where tenant_id = op.tenant_id and id = op.shipment_id;
    perform private.add_event(op.tenant_id, op.shipment_id, 'rejected', 'Ongkir kedaluwarsa sebelum dikirim; cek ongkir lagi');
    return jsonb_build_object('stale', true);
  end if;
  select version into v_version from private.seller_credentials
    where tenant_id = op.tenant_id and superseded_at is null and provider_env = p_env;
  if v_version is null then
    raise exception 'credential_missing' using errcode = '55000';
  end if;
  begin
    update public.provider_operations set state = 'in_flight', attempts = attempts + 1,
      provider_env = p_env, credential_version = v_version, dispatched_at = now(), updated_at = now()
    where id = op.id returning * into op;
  exception when unique_violation then
    raise exception 'account_busy' using errcode = '55P03';
  end;
  update public.shipments set submission_state = 'in_flight', updated_at = now()
    where tenant_id = op.tenant_id and id = op.shipment_id;
  perform private.add_event(op.tenant_id, op.shipment_id, 'dispatched', null);
  return private.dispatch_payload(op);
end $$;

-- ============================================================ L1

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
  -- A key regeneration is in flight (the old key is fenced, the new one not stored yet): a
  -- registration now could fetch and store the PRE-rotation key (security review L1).
  if o.onboarding_state = 'rotation_unknown' then raise exception 'rotation_unknown' using errcode = '55000'; end if;
  if o.onboarding_state = 'connected' and exists (
    select 1 from private.seller_credentials c
    where c.tenant_id = p_tenant and c.superseded_at is null and c.provider_env = o.provider_env
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

create or replace function public.complete_partner_seller_onboarding(p_tenant uuid, p_seller_id text,
  p_ciphertext text, p_iv text, p_key_version text, p_hint text, p_expected_version integer, p_env text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_demo boolean; v_latest integer; v_onb private.tenant_mengantar_onboarding;
begin
  if coalesce(p_env, '') not in ('sandbox', 'production') then
    raise exception 'invalid_environment' using errcode = '22023';
  end if;
  -- BYOK writers lock these same membership rows. The tenant lock alone would not serialize
  -- Partner completion against store_seller_credential's earlier read/clear/insert interval.
  perform 1 from public.memberships where tenant_id = p_tenant for update;
  select is_demo into v_demo from public.tenants where id = p_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_demo then raise exception 'demo_restricted' using errcode = '42501'; end if;
  if coalesce(p_seller_id, '') !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'invalid_input' using errcode = '22023'; end if;
  select * into v_onb from private.tenant_mengantar_onboarding where tenant_id = p_tenant for update;
  if not found then raise exception 'consent_required' using errcode = '22023'; end if;
  if v_onb.provider_env <> p_env then raise exception 'provider_env_mismatch' using errcode = '42501'; end if;
  -- Same guard as the begin: never store a key while a regeneration is in flight (L1). The way out
  -- of rotation_unknown is store_partner_seller_key, not an onboarding completion.
  if v_onb.onboarding_state = 'rotation_unknown' then raise exception 'rotation_unknown' using errcode = '55000'; end if;
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
    where c.tenant_id = p_tenant and c.provider_env = v_onb.provider_env and c.superseded_at is null;
  insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, created_by, provider_env)
  values (p_tenant, 'partner', p_ciphertext, p_iv, p_key_version, p_hint, v_latest + 1, v_onb.consent_actor_id, v_onb.provider_env);
  update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null
    where tenant_id = p_tenant and mengantar_pickup_address_id is not null;
  update private.tenant_mengantar_onboarding set connection_mode = 'partner_managed', onboarding_state = 'connected',
    last_error_code = null, retry_after_at = null, updated_at = now() where tenant_id = p_tenant;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (v_onb.consent_actor_id, 'partner.onboarding_complete', p_tenant, null, null, 'connected',
    jsonb_build_object('mode', 'partner', 'seller_id', p_seller_id, 'version', v_latest + 1, 'hint', p_hint,
      'provider_env', v_onb.provider_env, 'via', 'machine'));
  return v_latest + 1;
end $$;
revoke all on function public.complete_partner_seller_onboarding(uuid, text, text, text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.complete_partner_seller_onboarding(uuid, text, text, text, text, text, integer, text)
  to service_role;

-- ============================================================ L4

create or replace function public.rewrap_seller_credential(p_tenant uuid, p_version integer,
  p_expected_key_version text, p_ciphertext text, p_iv text, p_new_key_version text)
returns void language plpgsql security definer set search_path = ''
as $$
declare c private.seller_credentials;
begin
  if coalesce(p_expected_key_version, '') !~ '^v[0-9]{1,4}$' or coalesce(p_new_key_version, '') !~ '^v[0-9]{1,4}$'
     or p_expected_key_version = p_new_key_version or p_version is null or p_version < 1 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into c from private.seller_credentials
    where tenant_id = p_tenant and version = p_version and superseded_at is null for update;
  if not found or c.key_version <> p_expected_key_version then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  -- A rewrap only moves a credential to a HIGHER key version (security review L4): a rollback of
  -- the Worker's key-ring configuration must never downgrade stored rows. Checked against the
  -- stored version (after the stale fence, so a lost race still reads as stale_state). Key
  -- versions are 'v' + 1 to 4 digits, so the numeric cast is safe.
  if substr(p_new_key_version, 2)::integer <= substr(c.key_version, 2)::integer then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update private.seller_credentials set ciphertext = p_ciphertext, iv = p_iv, key_version = p_new_key_version
    where id = c.id;
  insert into public.audit_events (actor, action, target_tenant, target_user, reason, outcome, detail)
  values (null, 'credential.rewrapped', p_tenant, null, null, 'rewrapped',
    jsonb_build_object('version', c.version, 'provider_env', c.provider_env, 'mode', c.mode,
      'from_key_version', p_expected_key_version, 'to_key_version', p_new_key_version, 'via', 'machine'));
end $$;
revoke all on function public.rewrap_seller_credential(uuid, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.rewrap_seller_credential(uuid, integer, text, text, text, text) to service_role;
