-- T-100 / PR-3, owner request 2026-11-05: provider reference data, never tenant data.
create table public.mengantar_areas (
  id text primary key check (id ~ '^[0-9a-f]{24}$'),
  province text not null check (char_length(province) between 1 and 160 and province = btrim(province)),
  city text not null check (char_length(city) between 1 and 160 and city = btrim(city)),
  district text not null check (char_length(district) between 1 and 160 and district = btrim(district)),
  subdistrict text not null check (char_length(subdistrict) between 1 and 160 and subdistrict = btrim(subdistrict)),
  postal_code text not null check (postal_code = '' or postal_code ~ '^[0-9]{5}$'),
  dataset_version text not null check (dataset_version ~ '^mengantar-[0-9]{4}-[0-9]{2}-[0-9]{2}-[1-9][0-9]*$'),
  search text generated always as (
    lower(subdistrict || ' ' || district || ' ' || city || ' ' || province || ' ' || postal_code)
  ) stored
);
alter table public.mengantar_areas enable row level security;
-- Owner-loaded only, including no machine-role write path. SECURITY DEFINER owns the read.
revoke all on public.mengantar_areas from public, anon, authenticated, service_role;
create index mengantar_areas_postal_idx on public.mengantar_areas (postal_code);
create index mengantar_areas_subdistrict_idx on public.mengantar_areas (lower(subdistrict) text_pattern_ops);
create index mengantar_areas_district_idx on public.mengantar_areas (lower(district) text_pattern_ops);
create index mengantar_areas_city_idx on public.mengantar_areas (lower(city) text_pattern_ops);
-- lazy ceiling: a contains search scans the ~79k-row catalogue (no index serves '%x%'). Keep
-- extension-free until pg_trgm availability on the pinned image and query latency are proved.

create function public.search_mengantar_areas(p_query text, p_limit integer default 20)
returns table (id text, province text, city text, district text, subdistrict text, postal_code text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  -- Separators an operator types between names ("Sukatani, Tapos - Depok") are spaces; catalogue
  -- names also contain "-" and brackets, so tokens never need them.
  q text := lower(btrim(regexp_replace(regexp_replace(p_query, '[,./()-]+', ' ', 'g'), '\s+', ' ', 'g')));
  pattern text;
  tokens text[];
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
  return query
    select a.id, a.province, a.city, a.district, a.subdistrict, a.postal_code
    from public.mengantar_areas a
    where a.postal_code = q
      or not exists (select 1 from unnest(tokens) t where a.search not like '%' || t || '%')
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
