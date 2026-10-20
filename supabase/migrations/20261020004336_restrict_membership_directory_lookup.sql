-- A tenant admin may add a known account, but must not browse a global profile
-- directory. Auth email is authoritative; profiles.work_email is user editable.
create function public.find_membership_candidate_by_email(
  p_actor_user_id uuid,
  p_email text
)
returns table(id uuid, email text)
language plpgsql
stable
-- Auth deliberately does not grant service_role SELECT on auth.users. Only
-- this bounded projection crosses that boundary; never grant table access.
security definer
set search_path = ''
as $$
declare
  actor_tenant_id uuid;
  actor_role public.tenant_role;
begin
  -- current_user is the definer here; role retains the actual SET ROLE caller.
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception using errcode='42501', message='SERVICE_ROLE_REQUIRED';
  end if;

  select membership.tenant_id, membership.role into actor_tenant_id, actor_role
  from public.tenant_memberships membership
  join public.tenants tenant on tenant.id=membership.tenant_id and tenant.is_active
  where membership.user_id=p_actor_user_id
  order by membership.is_default desc, membership.created_at asc
  limit 1;

  if actor_tenant_id is null or actor_role <> 'admin'::public.tenant_role then
    raise exception using errcode='42501', message='MEMBERSHIP_CANDIDATE_ADMIN_REQUIRED';
  end if;

  return query
  select account.id, account.email::text
  from auth.users account
  where pg_catalog.lower(account.email)=pg_catalog.lower(pg_catalog.btrim(p_email))
    and not exists (
      select 1 from public.tenant_memberships membership
      where membership.tenant_id=actor_tenant_id and membership.user_id=account.id
    )
  limit 1;
end;
$$;

revoke all on function public.find_membership_candidate_by_email(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.find_membership_candidate_by_email(uuid,text) to service_role;
