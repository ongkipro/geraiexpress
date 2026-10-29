-- T-056 / T-069 UI follow-ups (forward-only; earlier migrations are applied and immutable).
-- 1. review_unpaid_batch also returns payment_attempt_sent_at, so the page can hide the close
--    command while a 'sent' attempt is younger than the 30-minute window close_unknown_batch_payment
--    enforces. The database check stays authoritative; this is display only.
-- 2. my_invitations returns invited_by_email for /undangan. It is the inviter's sign-in email,
--    shown only to the verified address the invitation names, and only while the inviter is still
--    an active admin of that gerai (the same condition accept_invitation requires); otherwise null.

create or replace function public.review_unpaid_batch(p_tenant uuid default null, p_shipment uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_shipment uuid;
  v_res jsonb;
  v_attempt text;
  v_attempt_id uuid;
  v_sent_at timestamptz;
begin
  if p_shipment is null and p_tenant is not null then
    v_shipment := p_tenant;
    select tenant_id into v_tenant from public.shipments where id = v_shipment;
  elsif p_tenant is null and p_shipment is not null then
    v_shipment := p_shipment;
    select tenant_id into v_tenant from public.shipments where id = v_shipment;
  else
    v_tenant := p_tenant;
    v_shipment := p_shipment;
  end if;
  if v_tenant is null or v_shipment is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  perform 1 from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share;
  if private.require_member(v_tenant) <> 'tenant_admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  v_res := private.compute_unpaid_batch(v_tenant, v_shipment, false);
  -- The newest attempt for this batch, so the page can show an unresolved payment (never "payable").
  select a.state, a.id, a.sent_at into v_attempt, v_attempt_id, v_sent_at from private.batch_payment_attempts a
    where a.tenant_id = v_tenant and a.batch_code = v_res->>'batch'
    order by a.created_at desc limit 1;
  return jsonb_build_object(
    'batch', v_res->'batch',
    'courier', v_res->'courier',
    'batch_digest', v_res->'batch_digest',
    'member_count', v_res->'member_count',
    'total_charge_idr', v_res->'total_charge_idr',
    'total_customer_charge_idr', v_res->'total_customer_charge_idr',
    'members', v_res->'members',
    'payment_attempt_state', to_jsonb(v_attempt),
    'payment_attempt_id', to_jsonb(v_attempt_id),
    'payment_attempt_sent_at', to_jsonb(v_sent_at)
  );
end $$;

-- The result columns change, so the function is replaced rather than altered.
drop function public.my_invitations();
create function public.my_invitations()
returns table (id uuid, tenant_name text, role text, expires_at timestamptz, invited_by_email text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_email text := private.caller_verified_email();
begin
  return query
    select i.id, t.name, i.role, i.expires_at,
      (select lower(u.email) from auth.users u
        join public.memberships m on m.user_id = u.id
        where u.id = i.invited_by and u.deleted_at is null
          and m.tenant_id = i.tenant_id and m.status = 'active' and m.role = 'tenant_admin')
    from public.tenant_invitations i join public.tenants t on t.id = i.tenant_id
    where i.email = v_email and i.status = 'pending' and i.expires_at > now()
      and t.lifecycle = 'active' and not t.is_demo
    order by i.created_at;
end $$;
revoke all on function public.my_invitations() from public, anon;
grant execute on function public.my_invitations() to authenticated;

notify pgrst, 'reload schema';
