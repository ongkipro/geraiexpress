-- T-023 (DEL-1 stage 3, PR-3/PR-4, UX line 187, DEC-010): outlet Mengantar pickup setup and live
-- quotes for connected real tenants. Demo tenants keep the SQL simulation (request_quotes).

-- ============================================================ outlet pickup (tenant admin)
-- The Worker reads the seller's saved Mengantar pickup addresses with the tenant's own key and
-- passes the chosen one here. Called directly, an admin could store ids that are not theirs at
-- Mengantar; that only misquotes their own gerai, and dispatch re-checks the pickup (T-024).
create function public.set_outlet_mengantar_pickup(p_outlet uuid, p_address_id text, p_area_id text,
  p_address text, p_area text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.outlets where id = p_outlet;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_tenant_admin_locked(v_tenant);
  if p_address_id !~ '^[a-f0-9]{24}$' or p_area_id !~ '^[a-f0-9]{24}$'
     or char_length(btrim(coalesce(p_address, ''))) not between 5 and 500
     or char_length(btrim(coalesce(p_area, ''))) not between 3 and 160 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  update public.outlets set mengantar_pickup_address_id = p_address_id, mengantar_area_id = p_area_id,
    pickup_address = btrim(p_address), pickup_area = btrim(p_area)
  where tenant_id = v_tenant and id = p_outlet;
  perform private.audit('outlet.mengantar_pickup', v_tenant, null, null, 'set',
    jsonb_build_object('outlet', p_outlet, 'address_id', p_address_id, 'area_id', p_area_id));
end $$;
revoke all on function public.set_outlet_mengantar_pickup(uuid, text, text, text, text) from public, anon;
grant execute on function public.set_outlet_mengantar_pickup(uuid, text, text, text, text) to authenticated;

-- ============================================================ machine-only reads and writes
-- The tenant's active sealed seller key, for a Worker request that has already verified the
-- caller's membership. Opened only inside the Worker (CREDENTIAL_KEY, AAD = tenant + version).
create function public.machine_seller_key(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare c private.seller_credentials;
begin
  if (select is_demo from public.tenants where id = p_tenant) is distinct from false then
    return null;
  end if;
  select * into c from private.seller_credentials where tenant_id = p_tenant and superseded_at is null;
  if c.id is null then return null; end if;
  return jsonb_build_object('ciphertext', c.ciphertext, 'iv', c.iv, 'key_version', c.key_version, 'version', c.version);
end $$;

-- Live quotes from Mengantar for one shipment revision. Written by the machine identity only, so
-- nobody can plant a cheaper tariff that the counter would charge (customer charge = normal
-- tariff of the selected quote). Net cost goes to private.quote_costs, never to the Data API.
-- p_rows: [{courier, tariff, net, eta}] as judged by the Public API client.
create function public.record_live_quotes(p_tenant uuid, p_shipment uuid, p_expected_revision integer, p_rows jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  r jsonb;
  v_quote uuid;
  v_count integer := 0;
begin
  select * into s from public.shipments where tenant_id = p_tenant and id = p_shipment for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  if s.submission_state not in ('draft', 'estimated') then
    raise exception 'shipment_locked' using errcode = '42501';
  end if;
  if s.revision <> p_expected_revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  -- A fresh live estimate replaces any unexpired quotes of this revision.
  update public.shipment_quotes set expires_at = now()
    where tenant_id = s.tenant_id and shipment_id = s.id and expires_at > now();
  for r in select * from jsonb_array_elements(p_rows) loop
    -- Format checks first (OR evaluation order is not guaranteed), then the casts.
    if coalesce(r->>'courier', '') !~ '^[A-Za-z]{2,20}$' or coalesce(r->>'tariff', '') !~ '^[0-9]{1,9}$'
       or coalesce(r->>'net', '') !~ '^[0-9]{1,9}$' or char_length(coalesce(r->>'eta', '')) > 40 then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    if (r->>'tariff')::bigint <= 0 or (r->>'net')::bigint > (r->>'tariff')::bigint then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
      normal_tariff_idr, eta_days, is_simulated, expires_at)
    values (s.tenant_id, s.id, s.revision, r->>'courier', 'Reguler', (r->>'tariff')::bigint,
      coalesce(nullif(r->>'eta', ''), '—'), false, now() + interval '30 minutes')
    returning id into v_quote;
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values (s.tenant_id, v_quote, (r->>'net')::bigint);
    v_count := v_count + 1;
  end loop;
  update public.shipments set submission_state = case when v_count > 0 then 'estimated' else 'draft' end,
    updated_at = now() where id = s.id;
  perform private.add_event(s.tenant_id, s.id, 'quoted',
    case when v_count > 0 then 'Estimasi Mengantar' else 'Tidak ada layanan Mengantar untuk rute ini' end);
  return v_count;
end $$;

-- A replaced or removed seller key means another (or no) Mengantar account: the outlet's pickup
-- address belongs to the old account, so it is cleared and must be chosen again.
create function private.clear_outlet_mengantar_pickup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null
    where tenant_id = new.tenant_id and mengantar_pickup_address_id is not null;
  return null;
end $$;
create trigger seller_credentials_clear_pickup
  after insert or update of superseded_at on private.seller_credentials
  for each row execute function private.clear_outlet_mengantar_pickup();

revoke all on function public.machine_seller_key(uuid), public.record_live_quotes(uuid, uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.machine_seller_key(uuid), public.record_live_quotes(uuid, uuid, integer, jsonb)
  to service_role;
