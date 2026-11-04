-- T-093 / DEC-024 (owner selection a): Super Admin may see shipment customer data and a customer's
-- cross-gerai history (shipment count and the gerai/cabang used), for a future scoring model.
-- Assistant-proposed safeguards (DEC-024, not owner-selected): a separate capability
-- `customer_data_review` that no grant holds by default, a required reason and one audit row per read.
-- Read-only; demo gerai and simulated shipments are excluded. Counsel gate T-048 applies before
-- production use (controller status under UU PDP unconfirmed).

alter table public.platform_grants drop constraint platform_grants_capabilities_check;
alter table public.platform_grants add constraint platform_grants_capabilities_check check (
  cardinality(capabilities) > 0
  and capabilities <@ array['tenant_governance', 'platform_monitoring', 'integration_operations',
                            'access_governance', 'audit_review', 'customer_data_review']::text[]);

-- The cross-gerai key: digits only, the Indonesian country code folded to the local 0 prefix (the same
-- rule as the provider phone in src/lib/mengantar/public-api.ts). NULL when the result is not a phone.
create function private.customer_phone_key(p_phone text)
returns text language sql immutable set search_path = '' as $$
  select case when k ~ '^0[0-9]{7,14}$' then k end
  from (select case when d like '62%' then '0' || substr(d, 3) else d end as k
        from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) x) y;
$$;
revoke all on function private.customer_phone_key(text) from public, anon, authenticated;
-- The expression indexes below evaluate it with the writer's rights on every shipment insert/update, so
-- signed-in gerai users need execute. It is pure string arithmetic on its argument and reads no table.
grant execute on function private.customer_phone_key(text) to authenticated;

-- Expression indexes so a lookup does not scan every shipment.
create index shipments_recipient_phone_key_idx on public.shipments (private.customer_phone_key(recipient_phone));
create index shipments_sender_phone_key_idx on public.shipments (private.customer_phone_key(sender_phone));

-- The audit keeps who looked up which customer without storing the number in readable form: a masked
-- hint for people and the SHA-256 of the key so an investigation can confirm a specific number.
create function private.customer_phone_audit(p_key text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'phone_hint', left(p_key, 4) || repeat('•', greatest(char_length(p_key) - 7, 0)) || right(p_key, 3),
    'phone_sha256', encode(extensions.digest(convert_to(p_key, 'utf8'), 'sha256'), 'hex'));
$$;
revoke all on function private.customer_phone_audit(text) from public, anon, authenticated;

-- Cross-gerai profile of one phone: counts as recipient and as sender per gerai and cabang (outlet).
create function public.platform_customer_lookup(p_phone text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_reason text; v_key text := private.customer_phone_key(p_phone); v_result jsonb;
begin
  perform private.require_platform('customer_data_review');
  v_reason := private.require_reason(p_reason);
  if v_key is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  with hits as (
    select s.tenant_id, s.outlet_id, s.created_at, s.issued_at,
      private.customer_phone_key(s.recipient_phone) = v_key as as_recipient,
      private.customer_phone_key(s.sender_phone) = v_key as as_sender
    from public.shipments s join public.tenants t on t.id = s.tenant_id
    where not t.is_demo and not s.is_simulated
      and (private.customer_phone_key(s.recipient_phone) = v_key or private.customer_phone_key(s.sender_phone) = v_key)
  ), per as (
    select h.tenant_id, h.outlet_id, count(*) as shipments,
      count(*) filter (where h.as_recipient) as as_recipient, count(*) filter (where h.as_sender) as as_sender,
      count(*) filter (where h.issued_at is not null) as issued, min(h.created_at) as first_at, max(h.created_at) as last_at
    from hits h group by h.tenant_id, h.outlet_id
  )
  select jsonb_build_object(
    'phone', v_key,
    'shipments', coalesce(sum(p.shipments), 0), 'issued', coalesce(sum(p.issued), 0),
    'as_recipient', coalesce(sum(p.as_recipient), 0), 'as_sender', coalesce(sum(p.as_sender), 0),
    'gerai_count', count(distinct p.tenant_id),
    'gerai', coalesce(jsonb_agg(jsonb_build_object(
        'tenant_id', p.tenant_id, 'tenant_name', t.name, 'outlet_name', o.name,
        'shipments', p.shipments, 'issued', p.issued, 'as_recipient', p.as_recipient, 'as_sender', p.as_sender,
        'first_at', p.first_at, 'last_at', p.last_at) order by p.last_at desc, t.name) filter (where p.tenant_id is not null), '[]'::jsonb))
  into v_result
  from per p join public.tenants t on t.id = p.tenant_id join public.outlets o on o.tenant_id = p.tenant_id and o.id = p.outlet_id;
  perform private.audit('customer_data.lookup', null, null, v_reason,
    case when (v_result ->> 'shipments')::bigint > 0 then 'found' else 'none' end,
    private.customer_phone_audit(v_key) || jsonb_build_object('shipments', (v_result ->> 'shipments')::bigint,
      'gerai_count', (v_result ->> 'gerai_count')::bigint));
  return v_result;
end $$;
revoke all on function public.platform_customer_lookup(text, text) from public, anon;
grant execute on function public.platform_customer_lookup(text, text) to authenticated;

-- One gerai's shipments with their customer fields, newest first, one page per call (each page is a
-- read and is audited). Only what was entered for the shipment; no provider cost or credential.
create function public.platform_tenant_customers(p_tenant uuid, p_reason text, p_limit integer, p_offset integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_reason text; t public.tenants; v_total bigint; v_rows jsonb;
begin
  perform private.require_platform('customer_data_review');
  v_reason := private.require_reason(p_reason);
  if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset < 0 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into t from public.tenants where id = p_tenant and not is_demo;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select count(*) into v_total from public.shipments s where s.tenant_id = t.id and not s.is_simulated;
  select coalesce(jsonb_agg(r order by r.created_at desc, r.id), '[]'::jsonb) into v_rows from (
    select s.id, s.reference, s.created_at, s.issued_at, s.submission_state, s.awb, o.name as outlet_name,
      s.sender_name, s.sender_phone, s.recipient_name, s.recipient_phone, s.recipient_address, s.recipient_area,
      s.recipient_postal_code
    from public.shipments s join public.outlets o on o.tenant_id = s.tenant_id and o.id = s.outlet_id
    where s.tenant_id = t.id and not s.is_simulated
    order by s.created_at desc, s.id limit p_limit offset p_offset) r;
  perform private.audit('customer_data.tenant_view', t.id, null, v_reason, 'viewed',
    jsonb_build_object('offset', p_offset, 'rows', jsonb_array_length(v_rows), 'total', v_total));
  return jsonb_build_object('tenant_id', t.id, 'tenant_name', t.name, 'total', v_total, 'rows', v_rows);
end $$;
revoke all on function public.platform_tenant_customers(uuid, text, integer, integer) from public, anon;
grant execute on function public.platform_tenant_customers(uuid, text, integer, integer) to authenticated;
