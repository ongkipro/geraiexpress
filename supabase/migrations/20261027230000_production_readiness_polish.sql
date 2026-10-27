-- Production readiness polish: partial index on provider_operations.provider_batch for batch
-- payment claim/reconciliation lookups, and allow not_connected / consent_recorded in
-- record_partner_seller_onboarding_outcome so rejected/unavailable onboarding attempts never leave
-- the tenant stuck in registration_pending.

create index if not exists provider_operations_batch_idx
  on public.provider_operations (provider_batch)
  where provider_batch is not null;

create or replace function public.record_partner_seller_onboarding_outcome(
  p_tenant uuid,
  p_state text,
  p_seller_id text default null,
  p_error_code text default null,
  p_retry_after_seconds integer default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if private.member_role(p_tenant) is not null and (select is_demo from public.tenants where id = p_tenant) then
    raise exception 'demo_restricted' using errcode = '42501';
  end if;
  perform private.require_tenant_admin_locked(p_tenant);
  perform 1 from public.tenants where id = p_tenant for update;

  if coalesce(p_state, '') not in (
    'not_connected',
    'consent_recorded',
    'registered_key_pending',
    'existing_account_required',
    'quota_wait',
    'provider_restricted',
    'configuration_blocked'
  ) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if p_seller_id is not null and p_seller_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update private.tenant_mengantar_onboarding
  set onboarding_state = p_state,
      partner_seller_id = coalesce(p_seller_id, partner_seller_id),
      last_error_code = p_error_code,
      retry_after_at = case
        when p_retry_after_seconds is not null and p_retry_after_seconds >= 0
        then now() + make_interval(secs => least(p_retry_after_seconds, 86400))
        else null
      end,
      updated_at = now()
  where tenant_id = p_tenant;

  perform private.audit('partner.onboarding_outcome', p_tenant, null, null, p_state,
    jsonb_build_object(
      'seller_id', p_seller_id,
      'error_code', p_error_code,
      'retry_after_seconds', p_retry_after_seconds
    ));
end $$;
