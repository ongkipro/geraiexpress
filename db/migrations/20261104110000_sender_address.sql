-- T-094 / PR-34 / DEC-017. Owner decisions (2026-11-04): the masked label may print the full sender
-- address; sender fields are structured with text limits so the print stays tidy. Assistant-recommended
-- within that direction: the sender address mirrors the recipient structure (street, area, postal code)
-- and is optional on the shipment; it is never sent to Mengantar (the pickup stays the outlet's, PR-3),
-- so dispatch_payload is unchanged.

-- ============================================================ shipment sender address (draft content)
alter table public.shipments
  add column sender_address text check (char_length(sender_address) between 5 and 120),
  add column sender_area text check (char_length(sender_area) between 3 and 40),
  add column sender_postal_code text check (sender_postal_code ~ '^[0-9]{5}$');
grant update (sender_address, sender_area, sender_postal_code) on public.shipments to authenticated;

-- The new fields are draft content: changing them bumps the revision, drops the quote, and is refused
-- after submission. Same definition as 20261028200000_pickup_orders.sql plus the three columns.
create or replace function private.guard_shipment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  content_changed boolean :=
    (new.sender_contact_id, new.sender_name, new.sender_phone, new.sender_address, new.sender_area,
     new.sender_postal_code, new.recipient_contact_id,
     new.recipient_name, new.recipient_phone, new.recipient_address, new.recipient_area,
     new.recipient_area_id, new.recipient_postal_code, new.item_description, new.weight_grams,
     new.length_cm, new.width_cm, new.height_cm, new.goods_value_idr, new.is_cod,
     new.handover, new.pickup_date, new.pickup_slot_hour, new.pickup_volume, new.pickup_note)
    is distinct from
    (old.sender_contact_id, old.sender_name, old.sender_phone, old.sender_address, old.sender_area,
     old.sender_postal_code, old.recipient_contact_id,
     old.recipient_name, old.recipient_phone, old.recipient_address, old.recipient_area,
     old.recipient_area_id, old.recipient_postal_code, old.item_description, old.weight_grams,
     old.length_cm, old.width_cm, old.height_cm, old.goods_value_idr, old.is_cod,
     old.handover, old.pickup_date, old.pickup_slot_hour, old.pickup_volume, old.pickup_note);
  pickup_changed boolean :=
    (new.handover, new.pickup_date, new.pickup_slot_hour) is distinct from
    (old.handover, old.pickup_date, old.pickup_slot_hour);
begin
  if new.tenant_id <> old.tenant_id or new.outlet_id <> old.outlet_id or new.reference <> old.reference then
    raise exception 'ownership_immutable' using errcode = '42501';
  end if;
  if content_changed then
    if old.submission_state not in ('draft', 'estimated') then
      raise exception 'shipment_locked' using errcode = '42501';
    end if;
    if pickup_changed and new.handover = 'pickup' and not private.pickup_slot_ok(new.pickup_date, new.pickup_slot_hour) then
      raise exception 'pickup_time_invalid' using errcode = '22023';
    end if;
    new.revision := old.revision + 1;
    new.submission_state := 'draft';
    new.selected_quote_id := null;
    new.customer_charge_idr := null;
    new.cod_amount_idr := null;
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ============================================================ masked label prints the sender address
-- The old rule "no address when masked" is replaced by tidy limits on what a masked label prints:
-- name 2-60, street 5-120, area 2-40 unchanged (the area keeps the printed_sender_city column, which the unmasked
-- label already uses for the pickup area). Existing rows satisfy the new check (their address is null).
alter table public.label_snapshots drop constraint label_snapshots_check;
alter table public.label_snapshots add constraint label_snapshots_masked_sender_tidy check (
  not mask_sender or (
    char_length(printed_sender_name) between 2 and 60
    and (printed_sender_address is null or char_length(printed_sender_address) between 5 and 120)
    and char_length(printed_sender_city) between 2 and 40));

-- One signature: the old one is dropped, so no caller keeps a path that ignores the address.
drop function public.create_label_snapshot(uuid, boolean, text, text, text, text);
create function public.create_label_snapshot(p_shipment uuid, p_mask boolean, p_size text default '10x15',
  p_sender_name text default null, p_sender_phone text default null, p_sender_city text default null,
  p_sender_address text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  t public.tenants;
  o public.outlets;
  q public.shipment_quotes;
  prev public.label_snapshots;
  v_name text;
  v_phone text;
  v_city text;
  v_address text;
  v_pickup_name text;
  v_pickup_address text;
  v_pickup_area text;
  v_printed_name text;
  v_printed_phone text;
  v_printed_address text;
  v_printed_city text;
  v_content jsonb;
  v_id uuid;
begin
  s := private.lock_member_shipment(p_shipment);
  if s.is_simulated then raise exception 'simulated_shipment' using errcode = '55000'; end if;
  if s.submission_state <> 'issued' or s.awb is null or s.awb !~ '^[A-Za-z0-9-]{6,40}$' then
    raise exception 'no_awb' using errcode = '55000';
  end if;
  if p_mask is null or p_size is null or p_size not in ('10x15', '10x10') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into t from public.tenants where id = s.tenant_id;

  if p_mask then
    if not t.masking_allowed then raise exception 'masking_disabled' using errcode = '42501'; end if;
    v_name := nullif(btrim(coalesce(p_sender_name, '')), '');
    v_city := nullif(btrim(coalesce(p_sender_city, '')), '');
    -- Whitespace runs collapse to one space so a pasted multi-line address prints on tidy lines.
    v_address := nullif(btrim(regexp_replace(coalesce(p_sender_address, ''), '\s+', ' ', 'g')), '');
    v_phone := private.clean_sender_phone(p_sender_phone);
    if v_name is null or v_city is null or nullif(btrim(coalesce(p_sender_phone, '')), '') is null then
      raise exception 'sender_fields_required' using errcode = '22023';
    end if;
    if char_length(v_name) not between 2 and 60 or char_length(v_city) not between 2 and 40
       or (v_address is not null and char_length(v_address) not between 5 and 120)
       or v_phone is null or v_name ~ '[[:cntrl:]]' or v_city ~ '[[:cntrl:]]' or v_address ~ '[[:cntrl:]]' then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
  elsif t.contact_whatsapp is null then
    raise exception 'whatsapp_missing' using errcode = '55000';
  end if;

  select * into prev from public.label_snapshots
    where tenant_id = s.tenant_id and shipment_id = s.id order by version desc limit 1;
  if found and prev.mask_sender = p_mask and prev.size = p_size
     and (not p_mask or (prev.printed_sender_name = v_name and prev.printed_sender_phone = v_phone
                         and prev.printed_sender_city = v_city
                         and prev.printed_sender_address is not distinct from v_address)) then
    return prev.id;
  end if;

  select * into o from public.outlets where tenant_id = s.tenant_id and id = s.outlet_id;
  v_pickup_name := coalesce(s.pickup_snapshot ->> 'outlet', o.name);
  v_pickup_address := coalesce(s.pickup_snapshot ->> 'address', o.pickup_address);
  v_pickup_area := coalesce(s.pickup_snapshot ->> 'area', o.pickup_area);
  select * into q from public.shipment_quotes where tenant_id = s.tenant_id and id = s.selected_quote_id;

  v_printed_name := case when p_mask then v_name else t.name end;
  v_printed_phone := case when p_mask then v_phone else t.contact_whatsapp end;
  v_printed_address := case when p_mask then v_address else v_pickup_address end;
  v_printed_city := case when p_mask then v_city else v_pickup_area end;

  v_content := jsonb_build_object(
    'template', 1, 'size', p_size, 'mask', p_mask,
    'sender', jsonb_build_array(v_printed_name, v_printed_phone, v_printed_address, v_printed_city),
    'true_identity', jsonb_build_array(t.name, t.slug, v_pickup_name, v_pickup_address, v_pickup_area),
    'awb', s.awb, 'reference', s.reference, 'courier', q.courier, 'service', q.service,
    'weight', s.weight_grams, 'cod', jsonb_build_array(s.is_cod, s.cod_amount_idr),
    'item', s.item_description,
    'recipient', jsonb_build_array(s.recipient_name, s.recipient_phone, s.recipient_address,
      s.recipient_area, s.recipient_postal_code));

  insert into public.label_snapshots (tenant_id, shipment_id, version, size, mask_sender,
    printed_sender_name, printed_sender_phone, printed_sender_address, printed_sender_city,
    true_tenant_name, true_tenant_slug, true_pickup_name, true_pickup_address, true_pickup_area,
    awb, shipment_reference, courier, service, weight_grams, is_cod, cod_amount_idr, item_description,
    recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code,
    content_digest, created_by)
  values (s.tenant_id, s.id, coalesce(prev.version, 0) + 1, p_size, p_mask,
    v_printed_name, v_printed_phone, v_printed_address, v_printed_city,
    t.name, t.slug, v_pickup_name, v_pickup_address, v_pickup_area,
    s.awb, s.reference, q.courier, q.service, s.weight_grams, s.is_cod, s.cod_amount_idr, s.item_description,
    s.recipient_name, s.recipient_phone, s.recipient_address, s.recipient_area, s.recipient_postal_code,
    encode(extensions.digest(convert_to(v_content::text, 'utf8'), 'sha256'), 'hex'), (select auth.uid()))
  returning id into v_id;
  -- No sender or recipient data in the audit detail; the snapshot row holds it.
  perform private.audit('label.snapshot', s.tenant_id, null, null,
    case when p_mask then 'masked' else 'gerai_identity' end,
    jsonb_build_object('shipment', s.id, 'snapshot', v_id, 'version', coalesce(prev.version, 0) + 1, 'size', p_size));
  return v_id;
end $$;
revoke all on function public.create_label_snapshot(uuid, boolean, text, text, text, text, text) from public, anon;
grant execute on function public.create_label_snapshot(uuid, boolean, text, text, text, text, text) to authenticated;

-- New columns and a replaced RPC signature: the running Data API must reload its schema cache.
notify pgrst, 'reload schema';
