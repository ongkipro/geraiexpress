-- T-086 / PR-44 / DATA-15 / UX-20: return and claim cases, manual flow before T-045.
-- A case is tenant-owned on one shipment. Claim filing windows are provider configuration with
-- source and date (help 8140017, updated 2026-09-18). The deadline is computed here, from the rule
-- and an anchor instant, and stored; it is NULL (unknown, never a default) when no rule applies,
-- the source states no anchor event, or no anchor instant is known. Before T-045 the anchor
-- instant can only be entered by staff (recorded with who and when). Writes go through RPCs only.

create table private.claim_window_rules (
  id uuid primary key default gen_random_uuid(),
  courier text not null check (courier ~ '^[A-Za-z]{2,20}$'),
  -- NULL = every case type; a value narrows the rule (the 3x24 h lost-claim window).
  case_type text check (case_type in ('lost', 'damaged', 'late', 'return', 'other')),
  -- NULL = every destination; JNE states two windows by destination region.
  region text check (region in ('java_sumatra_bali_ntb', 'other')),
  window_value integer not null check (window_value > 0),
  window_unit text not null check (window_unit in ('working_days', 'days', 'hours')),
  -- NULL = the source does not state the event the window counts from: no deadline is computed.
  anchor text check (anchor in ('last_status', 'delivered', 'rts')),
  region_note text check (char_length(region_note) <= 200),
  source_url text not null check (source_url ~ '^https://[^[:space:]]+$'),
  source_updated_at date not null check (isfinite(source_updated_at)),
  effective_at timestamptz not null check (isfinite(effective_at)),
  created_by uuid references auth.users(id),
  unique (courier, case_type, region, effective_at)
);
alter table private.claim_window_rules enable row level security;
revoke all on private.claim_window_rules from public, anon, authenticated, service_role;

-- Seeded from help 8140017 exactly as recorded in docs/research/geraiexpress-mengantar-operations-contract.md
-- section 14. An anchor is seeded only where the source states one; the dispute window after Delivered
-- (7-15 days, a range) is not seeded.
insert into private.claim_window_rules (courier, case_type, region, window_value, window_unit, anchor, region_note,
  source_url, source_updated_at, effective_at)
select courier, case_type, region, window_value, window_unit, anchor, region_note,
  'https://help.mengantar.com/id/articles/8140017-ketentuan-batas-waktu-pengajuan-klaim',
  date '2026-09-18', timestamptz '2026-09-18 00:00:00+00'
from (values
  ('JNE', null::text, 'java_sumatra_bali_ntb', 45, 'working_days', null::text, 'Jawa, Sumatra, Bali, NTB'),
  ('JNE', null, 'other', 60, 'working_days', null, 'Wilayah lain'),
  ('SiCepat', null, null, 14, 'days', 'last_status', null),
  ('iDexpress', null, null, 14, 'days', 'last_status', null),
  ('anteraja', null, null, 14, 'days', 'last_status', null),
  ('pos', null, null, 14, 'days', 'last_status', null),
  ('spx', null, null, 14, 'days', 'rts', null),
  ('Sap', null, null, 60, 'days', null, null),
  ('JT', null, null, 30, 'days', null, null),
  ('lion', null, null, 30, 'days', null, null),
  ('iDexpress', 'lost', null, 72, 'hours', null, null),
  ('JT', 'lost', null, 72, 'hours', null, null)
) as r(courier, case_type, region, window_value, window_unit, anchor, region_note);

create table public.shipment_cases (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  shipment_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  case_type text not null check (case_type in ('lost', 'damaged', 'late', 'return', 'other')),
  -- The one provider claim type of help 5207011: return, full value (COD or insured value), other.
  claim_type text not null check (claim_type in ('return', 'full_value', 'other')),
  state text not null default 'open' check (state in ('open', 'submitted', 'closed')),
  description text not null check (char_length(description) between 5 and 1000),
  evidence_refs text[] not null default '{}' check (cardinality(evidence_refs) <= 10),
  provider_ticket text check (provider_ticket ~ '^[^[:cntrl:]]{1,80}$'),
  region text check (region in ('java_sumatra_bali_ntb', 'other')),
  anchor_at timestamptz check (isfinite(anchor_at)),
  anchor_entered_by uuid references auth.users(id),
  anchor_entered_at timestamptz,
  rule_id uuid references private.claim_window_rules(id),
  deadline_at timestamptz,
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  outcome text check (outcome in ('compensated', 'rejected', 'return_received', 'other')),
  decided_amount_idr bigint,
  decided_by_party text check (decided_by_party in ('courier', 'mengantar')),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  primary key (tenant_id, id),
  foreign key (tenant_id, shipment_id) references public.shipments(tenant_id, id) on delete cascade,
  constraint shipment_cases_anchor_entry check ((anchor_at is null) = (anchor_entered_by is null)
    and (anchor_at is null) = (anchor_entered_at is null)),
  constraint shipment_cases_deadline_basis check (deadline_at is null or (rule_id is not null and anchor_at is not null)),
  constraint shipment_cases_close check (
    (state = 'closed') = (closed_at is not null)
    and (state = 'closed') = (closed_by is not null)
    and (state = 'closed') = (outcome is not null)),
  -- An amount exists only as a recorded compensation decision, with the party that decided it.
  constraint shipment_cases_outcome check (
    (outcome = 'compensated' and decided_amount_idr is not null and decided_amount_idr > 0 and decided_by_party is not null)
    or (outcome is distinct from 'compensated' and decided_amount_idr is null))
);
-- One non-closed case per shipment (stricter than per type): one counter conversation per parcel.
create unique index shipment_cases_one_open on public.shipment_cases (tenant_id, shipment_id) where state <> 'closed';
create index shipment_cases_by_state on public.shipment_cases (tenant_id, state, opened_at desc);
create index shipments_returned_idx on public.shipments (tenant_id) where delivery_state = 'returned';
alter table public.shipment_cases enable row level security;
revoke all on public.shipment_cases from public, anon, authenticated, service_role;
grant select on public.shipment_cases to authenticated;
create policy shipment_cases_member_read on public.shipment_cases for select to authenticated
  using ((select private.is_member(tenant_id)));

create table public.shipment_case_events (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid() unique,
  case_id uuid not null,
  kind text not null check (kind in ('opened', 'updated', 'closed')),
  state text not null check (state in ('open', 'submitted', 'closed')),
  changed text[] not null default '{}',
  note text check (char_length(note) between 1 and 500),
  actor uuid not null references auth.users(id),
  at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, case_id) references public.shipment_cases(tenant_id, id) on delete cascade
);
create index shipment_case_events_by_case on public.shipment_case_events (tenant_id, case_id, at);
-- Reuse the immutable-history guard: direct UPDATE/DELETE/TRUNCATE refused; owner cascades allowed.
create trigger shipment_case_events_append_only before update or delete on public.shipment_case_events
  for each row execute function private.label_history_guard();
create trigger shipment_case_events_no_truncate before truncate on public.shipment_case_events
  for each statement execute function private.label_history_guard();
alter table public.shipment_case_events enable row level security;
revoke all on public.shipment_case_events from public, anon, authenticated, service_role;
grant select on public.shipment_case_events to authenticated;
create policy shipment_case_events_member_read on public.shipment_case_events for select to authenticated
  using ((select private.is_member(tenant_id)));

-- Mirrors src/modules/cases/deadline.ts (claimDeadline). Hours and calendar days are exact
-- (24 h per day; WIB has no DST). Working days are counted on the WIB calendar, skipping Saturday
-- and Sunday only: no holiday calendar is configured, so public holidays are not excluded.
create function private.claim_deadline(p_anchor timestamptz, p_value integer, p_unit text)
returns timestamptz language plpgsql stable set search_path = ''
as $$
declare
  v_local timestamp;
  v_left integer := p_value;
begin
  if p_anchor is null or p_value is null or p_value <= 0 or p_unit is null then return null; end if;
  if p_unit = 'hours' then return p_anchor + make_interval(hours => p_value); end if;
  if p_unit = 'days' then return p_anchor + make_interval(hours => 24 * p_value); end if;
  if p_unit <> 'working_days' then return null; end if;
  v_local := p_anchor at time zone 'Asia/Jakarta';
  while v_left > 0 loop
    v_local := v_local + interval '1 day';
    if extract(isodow from v_local) < 6 then v_left := v_left - 1; end if;
  end loop;
  return v_local at time zone 'Asia/Jakarta';
end $$;

-- The current rule for a courier, case type and region: a case-type rule beats a general one; the
-- newest effective version wins. No row = no rule.
create function private.claim_rule_for(p_courier text, p_case_type text, p_region text)
returns private.claim_window_rules language sql stable set search_path = ''
as $$
  select r.* from private.claim_window_rules r
  where r.courier = p_courier and r.effective_at <= now()
    and (r.case_type is null or r.case_type = p_case_type)
    and (r.region is null or r.region = p_region)
  order by (r.case_type is not null) desc, r.effective_at desc
  limit 1
$$;

create function private.case_deadline(p_courier text, p_case_type text, p_region text, p_anchor timestamptz,
  out rule_id uuid, out deadline_at timestamptz)
language plpgsql stable set search_path = ''
as $$
declare r private.claim_window_rules;
begin
  r := private.claim_rule_for(p_courier, p_case_type, p_region);
  rule_id := r.id;
  deadline_at := null;
  if r.id is not null and r.anchor is not null and p_anchor is not null then
    deadline_at := private.claim_deadline(p_anchor, r.window_value, r.window_unit);
  end if;
end $$;

-- Input normalization shared by open and update. Every refusal is 22023 with a stable code.
create function private.case_inputs(p_claim_type text, p_description text, p_evidence_refs text[],
  p_provider_ticket text, p_region text, p_anchor_at timestamptz,
  out claim_type text, out description text, out evidence_refs text[], out provider_ticket text,
  out region text, out anchor_at timestamptz)
language plpgsql stable set search_path = ''
as $$
begin
  if p_claim_type is null or p_claim_type not in ('return', 'full_value', 'other') then
    raise exception 'claim_type_invalid' using errcode = '22023';
  end if;
  claim_type := p_claim_type;
  description := btrim(coalesce(p_description, ''));
  if char_length(description) not between 5 and 1000 then
    raise exception 'description_required' using errcode = '22023';
  end if;
  evidence_refs := coalesce(array(select btrim(e) from unnest(coalesce(p_evidence_refs, '{}'::text[])) e
    where btrim(coalesce(e, '')) <> ''), '{}'::text[]);
  if cardinality(evidence_refs) > 10
    or exists (select 1 from unnest(evidence_refs) e where char_length(e) > 300 or e ~ '[[:cntrl:]]') then
    raise exception 'evidence_invalid' using errcode = '22023';
  end if;
  provider_ticket := nullif(btrim(coalesce(p_provider_ticket, '')), '');
  if provider_ticket is not null and provider_ticket !~ '^[^[:cntrl:]]{1,80}$' then
    raise exception 'ticket_invalid' using errcode = '22023';
  end if;
  if p_region is not null and p_region not in ('java_sumatra_bali_ntb', 'other') then
    raise exception 'region_invalid' using errcode = '22023';
  end if;
  region := p_region;
  if p_anchor_at is not null and (not isfinite(p_anchor_at) or p_anchor_at > now() + interval '5 minutes'
      or p_anchor_at < timestamptz '2020-01-01 00:00:00+00') then
    raise exception 'anchor_invalid' using errcode = '22023';
  end if;
  anchor_at := p_anchor_at;
end $$;

create function private.shipment_courier(p_tenant uuid, p_quote uuid)
returns text language sql stable set search_path = ''
as $$ select q.courier from public.shipment_quotes q where q.tenant_id = p_tenant and q.id = p_quote $$;

-- IAM-1 counter rows: any member may open a case on an issued shipment of their tenant.
create function public.open_shipment_case(p_shipment uuid, p_case_type text, p_claim_type text, p_description text,
  p_evidence_refs text[], p_provider_ticket text, p_region text, p_anchor_at timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.shipments;
  v record;
  d record;
  v_id uuid;
begin
  s := private.lock_member_shipment(p_shipment);
  if p_case_type is null or p_case_type not in ('lost', 'damaged', 'late', 'return', 'other') then
    raise exception 'case_type_invalid' using errcode = '22023';
  end if;
  select * into v from private.case_inputs(p_claim_type, p_description, p_evidence_refs, p_provider_ticket, p_region, p_anchor_at);
  if s.submission_state <> 'issued' then
    raise exception 'case_not_allowed' using errcode = '55000';
  end if;
  if exists (select 1 from public.shipment_cases where tenant_id = s.tenant_id and shipment_id = s.id and state <> 'closed') then
    raise exception 'case_open_exists' using errcode = '55000';
  end if;
  select * into d from private.case_deadline(private.shipment_courier(s.tenant_id, s.selected_quote_id), p_case_type, v.region, v.anchor_at);
  begin
    insert into public.shipment_cases (tenant_id, shipment_id, case_type, claim_type, description, evidence_refs,
      provider_ticket, region, anchor_at, anchor_entered_by, anchor_entered_at, rule_id, deadline_at, opened_by)
    values (s.tenant_id, s.id, p_case_type, v.claim_type, v.description, v.evidence_refs, v.provider_ticket, v.region,
      v.anchor_at, case when v.anchor_at is not null then (select auth.uid()) end,
      case when v.anchor_at is not null then now() end, d.rule_id, d.deadline_at, (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'case_open_exists' using errcode = '55000';
  end;
  insert into public.shipment_case_events (tenant_id, case_id, kind, state, actor)
    values (s.tenant_id, v_id, 'opened', 'open', (select auth.uid()));
  perform private.add_event(s.tenant_id, s.id, 'case_opened', null);
  perform private.audit('shipment_case.open', s.tenant_id, null, null, 'succeeded',
    jsonb_build_object('case', v_id, 'shipment', s.id, 'case_type', p_case_type, 'claim_type', v.claim_type,
      'rule', d.rule_id, 'deadline_at', d.deadline_at));
  return v_id;
end $$;

-- Lock order shipment -> case (same as open). Membership is checked before any lock.
create function private.lock_member_case(p_case uuid)
returns public.shipment_cases language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  c public.shipment_cases;
begin
  select tenant_id, shipment_id into v_tenant, v_shipment from public.shipment_cases where id = p_case;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  perform private.lock_member_shipment(v_shipment);
  select * into c from public.shipment_cases where tenant_id = v_tenant and id = p_case for update;
  return c;
end $$;

-- Operators and administrators update a non-closed case. The deadline is always recomputed here from
-- the stored rule inputs; a client never supplies it. A changed anchor records who entered it.
create function public.update_shipment_case(p_case uuid, p_expected_revision integer, p_state text, p_claim_type text,
  p_description text, p_evidence_refs text[], p_provider_ticket text, p_region text, p_anchor_at timestamptz)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.shipment_cases;
  s public.shipments;
  v record;
  d record;
  v_changed text[] := '{}';
  v_anchor_changed boolean;
begin
  c := private.lock_member_case(p_case);
  if c.state = 'closed' then raise exception 'case_closed' using errcode = '55000'; end if;
  if p_expected_revision is null or p_expected_revision <> c.revision then
    raise exception 'case_changed' using errcode = '55000';
  end if;
  if p_state is null or p_state not in ('open', 'submitted') then
    raise exception 'state_invalid' using errcode = '22023';
  end if;
  select * into v from private.case_inputs(p_claim_type, p_description, p_evidence_refs, p_provider_ticket, p_region, p_anchor_at);
  select * into s from public.shipments where tenant_id = c.tenant_id and id = c.shipment_id;
  select * into d from private.case_deadline(private.shipment_courier(s.tenant_id, s.selected_quote_id), c.case_type, v.region, v.anchor_at);
  v_anchor_changed := v.anchor_at is distinct from c.anchor_at;
  if p_state is distinct from c.state then v_changed := array_append(v_changed, 'state'); end if;
  if v.claim_type is distinct from c.claim_type then v_changed := array_append(v_changed, 'claim_type'); end if;
  if v.description is distinct from c.description then v_changed := array_append(v_changed, 'description'); end if;
  if v.evidence_refs is distinct from c.evidence_refs then v_changed := array_append(v_changed, 'evidence_refs'); end if;
  if v.provider_ticket is distinct from c.provider_ticket then v_changed := array_append(v_changed, 'provider_ticket'); end if;
  if v.region is distinct from c.region then v_changed := array_append(v_changed, 'region'); end if;
  if v_anchor_changed then v_changed := array_append(v_changed, 'anchor_at'); end if;
  update public.shipment_cases set revision = revision + 1, state = p_state, claim_type = v.claim_type,
    description = v.description, evidence_refs = v.evidence_refs, provider_ticket = v.provider_ticket, region = v.region,
    anchor_at = v.anchor_at,
    anchor_entered_by = case when v.anchor_at is null then null when v_anchor_changed then (select auth.uid()) else anchor_entered_by end,
    anchor_entered_at = case when v.anchor_at is null then null when v_anchor_changed then now() else anchor_entered_at end,
    rule_id = d.rule_id, deadline_at = d.deadline_at, updated_at = now()
    where tenant_id = c.tenant_id and id = c.id;
  insert into public.shipment_case_events (tenant_id, case_id, kind, state, changed, actor)
    values (c.tenant_id, c.id, 'updated', p_state, v_changed, (select auth.uid()));
  perform private.audit('shipment_case.update', c.tenant_id, null, null, 'succeeded',
    jsonb_build_object('case', c.id, 'shipment', c.shipment_id, 'changed', to_jsonb(v_changed),
      'rule', d.rule_id, 'deadline_at', d.deadline_at));
end $$;

-- Only a tenant administrator closes. The outcome is recorded as decided by the courier or Mengantar;
-- an amount exists only for a compensation.
create function public.close_shipment_case(p_case uuid, p_outcome text, p_decided_amount_idr bigint,
  p_decided_by_party text, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.shipment_cases;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.shipment_cases where id = p_case;
  if v_tenant is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  perform private.require_member(v_tenant);
  if private.member_role(v_tenant) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  c := private.lock_member_case(p_case);
  if private.member_role(c.tenant_id) is distinct from 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if c.state = 'closed' then raise exception 'case_closed' using errcode = '55000'; end if;
  if p_outcome is null or p_outcome not in ('compensated', 'rejected', 'return_received', 'other') then
    raise exception 'outcome_required' using errcode = '22023';
  end if;
  if p_decided_by_party is not null and p_decided_by_party not in ('courier', 'mengantar') then
    raise exception 'decided_by_invalid' using errcode = '22023';
  end if;
  if p_outcome = 'compensated' then
    if p_decided_amount_idr is null or p_decided_amount_idr <= 0 then
      raise exception 'decided_amount_required' using errcode = '22023';
    end if;
    if p_decided_by_party is null then raise exception 'decided_by_required' using errcode = '22023'; end if;
  elsif p_decided_amount_idr is not null then
    raise exception 'decided_amount_invalid' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note_invalid' using errcode = '22023';
  end if;
  update public.shipment_cases set state = 'closed', revision = revision + 1, outcome = p_outcome,
    decided_amount_idr = p_decided_amount_idr, decided_by_party = p_decided_by_party,
    closed_by = (select auth.uid()), closed_at = now(), updated_at = now()
    where tenant_id = c.tenant_id and id = c.id;
  insert into public.shipment_case_events (tenant_id, case_id, kind, state, note, actor)
    values (c.tenant_id, c.id, 'closed', 'closed', v_note, (select auth.uid()));
  perform private.add_event(c.tenant_id, c.shipment_id, 'case_closed', null);
  perform private.audit('shipment_case.close', c.tenant_id, null, v_note, 'succeeded',
    jsonb_build_object('case', c.id, 'shipment', c.shipment_id, 'outcome', p_outcome,
      'decided_amount_idr', p_decided_amount_idr, 'decided_by_party', p_decided_by_party));
end $$;

-- Member read of the sourced rules (no actor id), for showing a case's window with source and date.
create function public.claim_window_rules(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_member(p_tenant);
  return (select coalesce(jsonb_agg(to_jsonb(r) - 'created_by' order by r.courier, r.case_type nulls first, r.region, r.effective_at desc), '[]'::jsonb)
    from private.claim_window_rules r where r.effective_at <= now());
end $$;

-- Dashboard/shell attention for returns and cases: shipments with a provider return state
-- (delivery_state 'returned', set once T-045 ingests it) or a non-closed case. Cases only open on
-- issued shipments, so these never overlap the submission-state attention tier.
create function public.case_attention(p_tenant uuid, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_member(p_tenant);
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  return (with items as (
      select s.id, s.reference, s.recipient_name, s.delivery_state = 'returned' as returned,
        c.id as case_id, c.case_type, c.state as case_state, c.deadline_at, c.opened_at as since
      from public.shipment_cases c
      join public.shipments s on s.tenant_id = c.tenant_id and s.id = c.shipment_id
      where c.tenant_id = p_tenant and c.state <> 'closed'
      union all
      select s.id, s.reference, s.recipient_name, true, null, null, null, null, s.updated_at
      from public.shipments s
      where s.tenant_id = p_tenant and s.delivery_state = 'returned'
        and not exists (select 1 from public.shipment_cases c
          where c.tenant_id = s.tenant_id and c.shipment_id = s.id and c.state <> 'closed'))
    select jsonb_build_object('count', (select count(*) from items),
      'rows', coalesce((select jsonb_agg(to_jsonb(i) order by i.deadline_at nulls last, i.since)
        from (select * from items order by deadline_at nulls last, since limit p_limit) i), '[]'::jsonb)));
end $$;

revoke all on function private.claim_deadline(timestamptz, integer, text), private.claim_rule_for(text, text, text),
  private.case_deadline(text, text, text, timestamptz), private.case_inputs(text, text, text[], text, text, timestamptz),
  private.shipment_courier(uuid, uuid), private.lock_member_case(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.open_shipment_case(uuid, text, text, text, text[], text, text, timestamptz),
  public.update_shipment_case(uuid, integer, text, text, text, text[], text, text, timestamptz),
  public.close_shipment_case(uuid, text, bigint, text, text), public.claim_window_rules(uuid),
  public.case_attention(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.open_shipment_case(uuid, text, text, text, text[], text, text, timestamptz),
  public.update_shipment_case(uuid, integer, text, text, text, text[], text, text, timestamptz),
  public.close_shipment_case(uuid, text, bigint, text, text), public.claim_window_rules(uuid),
  public.case_attention(uuid, integer)
  to authenticated;

notify pgrst, 'reload schema';
