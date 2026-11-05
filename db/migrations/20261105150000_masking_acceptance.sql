-- T-084 / PR-46 / DATA-10 amendment / UX-9 acceptance gate; DEC-017, DEC-018, DEC-023.
--
-- 1. private.masking_acceptance: one row per courier (create-order code) with the recorded scan
--    acceptance of the locally printed masked label. A missing row, or a snapshot without a courier,
--    counts as `unverified`. Only the integration_operations platform capability (aal2, reason, audit)
--    writes it; members read one courier through masking_acceptance_for(courier).
-- 2. label_print_events gains nullable acceptance_state and acknowledged. A masked label print stores
--    the courier's state at print time and the operator's acknowledgement; unmasked label prints and
--    receipts leave both NULL. The append-only guard and the kind constraint are unchanged.
-- 3. record_label_print(uuid) is replaced by record_label_print(uuid, boolean) with no default, so no
--    caller can skip the acknowledgement decision. Latest body: 20261028150000_masked_label.sql.
-- 4. label_return_routes(uuid[]): origin and destination provinces of the member's shipments from the
--    Mengantar area catalogue, for the return-destination note (help 14715369). Provinces only.
-- Nothing here calls Mengantar and no label content or layout changes.

-- ============================================================ acceptance per courier

create table private.masking_acceptance (
  courier text primary key check (courier ~ '^[A-Za-z]{2,20}$'),
  state text not null check (state in ('unverified', 'verified', 'refused')),
  evidence_ref text check (evidence_ref is null or (char_length(evidence_ref) between 3 and 500 and evidence_ref = btrim(evidence_ref))),
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default now(),
  -- A recorded verdict names its evidence (courier scan, Mengantar sync); unverified may carry none.
  check (state = 'unverified' or evidence_ref is not null)
);
alter table private.masking_acceptance enable row level security;
revoke all on private.masking_acceptance from public, anon, authenticated, service_role;

-- The state the gate uses: a missing row and a NULL courier are `unverified`.
create function private.masking_acceptance_state(p_courier text)
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce((select a.state from private.masking_acceptance a where a.courier = p_courier), 'unverified')
$$;

-- Members of any active gerai read one courier's state and evidence reference (never who recorded it).
create function public.masking_acceptance_for(p_courier text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare a private.masking_acceptance;
begin
  if not exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and private.is_member(m.tenant_id)
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  select * into a from private.masking_acceptance where courier = p_courier;
  return jsonb_build_object('courier', p_courier, 'state', private.masking_acceptance_state(p_courier),
    'evidence_ref', a.evidence_ref, 'recorded_at', a.recorded_at);
end $$;

-- Super Admin read of every recorded row (with the recorder's email) for /admin/integrasi.
create function public.platform_masking_acceptance()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_platform('integration_operations');
  return (select coalesce(jsonb_agg(jsonb_build_object('courier', a.courier, 'state', a.state,
      'evidence_ref', a.evidence_ref, 'recorded_at', a.recorded_at, 'recorded_by_email', u.email) order by a.courier), '[]'::jsonb)
    from private.masking_acceptance a left join auth.users u on u.id = a.recorded_by);
end $$;

-- The only write path. p_expected_recorded_at is the recorded_at the admin saw (NULL = no row yet);
-- anything else is stale_state (55000). The audit row keeps the previous state, so the audit log is the
-- history of every change.
create function public.platform_set_masking_acceptance(p_courier text, p_state text, p_evidence_ref text,
  p_expected_recorded_at timestamptz, p_reason text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_reason text;
  v_evidence text := nullif(btrim(coalesce(p_evidence_ref, '')), '');
  prev private.masking_acceptance;
begin
  perform private.require_platform('integration_operations');
  v_reason := private.require_reason(p_reason);
  if coalesce(p_courier, '') !~ '^[A-Za-z]{2,20}$' or p_state is null
     or p_state not in ('unverified', 'verified', 'refused')
     or (v_evidence is not null and (char_length(v_evidence) not between 3 and 500 or v_evidence ~ '[[:cntrl:]]')) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_state <> 'unverified' and v_evidence is null then
    raise exception 'evidence_required' using errcode = '22023';
  end if;
  -- Serializes writers of one courier, including the first insert (no row to lock yet).
  perform pg_advisory_xact_lock(hashtextextended('masking_acceptance:' || p_courier, 0));
  select * into prev from private.masking_acceptance where courier = p_courier for update;
  if prev.recorded_at is distinct from p_expected_recorded_at then
    raise exception 'stale_state' using errcode = '55000';
  end if;
  insert into private.masking_acceptance (courier, state, evidence_ref, recorded_by, recorded_at)
    values (p_courier, p_state, v_evidence, (select auth.uid()), clock_timestamp())
  on conflict (courier) do update set state = excluded.state, evidence_ref = excluded.evidence_ref,
    recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;
  perform private.audit('masking_acceptance.set', null, null, v_reason, p_state,
    jsonb_build_object('courier', p_courier, 'from', coalesce(prev.state, 'unverified'), 'to', p_state,
      'evidence_ref', v_evidence));
  return p_state;
end $$;

-- ============================================================ print history

alter table public.label_print_events
  add column acceptance_state text,
  add column acknowledged boolean,
  add constraint label_print_events_acceptance check (
    (acceptance_state is null) = (acknowledged is null)
    and (acceptance_state is null or (kind = 'label' and acceptance_state in ('unverified', 'verified', 'refused')))
    and (acceptance_state is null or acceptance_state = 'verified' or acknowledged));

drop function public.record_label_print(uuid);

-- Appends one print request to the history of a snapshot. It records that a print was requested, not
-- that paper came out. A masked snapshot cannot be printed again once masking is disabled for the tenant.
-- A masked snapshot of a courier that is not `verified` needs p_acknowledged = true; the state at print
-- time and the acknowledgement are stored on the event. Unmasked prints store neither.
create function public.record_label_print(p_snapshot uuid, p_acknowledged boolean)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v public.label_snapshots;
  v_state text;
  v_id bigint;
begin
  select * into v from public.label_snapshots where id = p_snapshot;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v.tenant_id);
  if p_acknowledged is null then raise exception 'invalid_input' using errcode = '22023'; end if;
  if v.mask_sender and not (select t.masking_allowed from public.tenants t where t.id = v.tenant_id) then
    raise exception 'masking_disabled' using errcode = '42501';
  end if;
  if v.mask_sender then
    v_state := private.masking_acceptance_state(v.courier);
    if v_state <> 'verified' and not p_acknowledged then
      raise exception 'masking_acknowledgement_required' using errcode = '55000';
    end if;
  end if;
  insert into public.label_print_events (tenant_id, shipment_id, snapshot_id, size, actor, acceptance_state, acknowledged)
  values (v.tenant_id, v.shipment_id, v.id, v.size, (select auth.uid()),
    v_state, case when v.mask_sender then p_acknowledged end)
  returning id into v_id;
  return v_id;
end $$;

-- ============================================================ return route provinces

-- Origin = the selected quote's Mengantar origin area (else the frozen pickup area id), destination = the
-- recipient area. Shipments outside the caller's memberships, and unknown ids, return no row; an area
-- missing from the catalogue returns NULL (route unknown). At most 50 ids (one batch print).
create function public.label_return_routes(p_shipments uuid[])
returns table (shipment_id uuid, origin_province text, destination_province text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_shipments is null or cardinality(p_shipments) > 50 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return query
    select s.id, o.province, d.province
    from public.shipments s
    left join public.shipment_quotes q on q.tenant_id = s.tenant_id and q.id = s.selected_quote_id
    left join public.mengantar_areas o on o.id = coalesce(q.origin_area_id, s.pickup_snapshot ->> 'mengantar_area_id')
    left join public.mengantar_areas d on d.id = s.recipient_area_id
    where s.id = any (p_shipments) and private.is_member(s.tenant_id);
end $$;

-- ============================================================ privileges

revoke all on function private.masking_acceptance_state(text) from public, anon, authenticated;
revoke all on function public.masking_acceptance_for(text), public.platform_masking_acceptance(),
  public.platform_set_masking_acceptance(text, text, text, timestamptz, text),
  public.record_label_print(uuid, boolean), public.label_return_routes(uuid[]) from public, anon;
grant execute on function public.masking_acceptance_for(text), public.platform_masking_acceptance(),
  public.platform_set_masking_acceptance(text, text, text, timestamptz, text),
  public.record_label_print(uuid, boolean), public.label_return_routes(uuid[]) to authenticated;

notify pgrst, 'reload schema';
