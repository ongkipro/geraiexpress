-- T-091 / DEC-024 (G1): the Super Admin reads every billable-weight/cargo rule version (history and
-- scheduled versions included) to review and append through platform_set_billable_weight_rule. The
-- member-facing billable_weight_rules(tenant) RPC shows effective versions only and needs a membership.
create function public.platform_billable_weight_rules()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_platform('integration_operations');
  return (select coalesce(jsonb_agg(to_jsonb(r) - 'created_by'
      || jsonb_build_object('is_current', r.id = (select c.id from private.billable_weight_rules c
        where c.courier = r.courier and c.service_class = r.service_class and c.effective_at <= now()
        order by c.effective_at desc limit 1),
        'scheduled', r.effective_at > now())
      order by r.courier, r.service_class, r.effective_at desc), '[]'::jsonb)
    from private.billable_weight_rules r);
end $$;
revoke all on function public.platform_billable_weight_rules() from public, anon;
grant execute on function public.platform_billable_weight_rules() to authenticated;

notify pgrst, 'reload schema';
