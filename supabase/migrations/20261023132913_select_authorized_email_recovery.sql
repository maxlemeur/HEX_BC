-- Read-only cron selection. Invalid actors remain visible as blocked; they
-- must never consume the entire batch or be replaced by a synthetic sender.
create function public.list_due_estimate_email_dispatches(
  p_now timestamptz default now(),
  p_limit integer default 25
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare result jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_SELECTION_INVALID';
  end if;

  with due as materialized (
    select dispatch.id, dispatch.created_at,
      exists (
        select 1
        from public.estimate_versions version
        join public.estimate_projects project
          on project.id = version.project_id and project.tenant_id = version.tenant_id
        join public.tenants tenant on tenant.id = version.tenant_id and tenant.is_active
        join public.tenant_memberships membership
          on membership.tenant_id = version.tenant_id and membership.user_id = dispatch.created_by
        where version.id = dispatch.version_id and version.tenant_id = dispatch.tenant_id
          and membership.role in ('admin'::public.tenant_role, 'engineer'::public.tenant_role)
          and (project.user_id = dispatch.created_by or membership.role = 'admin'::public.tenant_role)
      ) as authorized
    from public.estimate_emails dispatch
    where dispatch.request_id is not null
      and dispatch.status in ('queued', 'processing')
      and (dispatch.next_attempt_at is null or dispatch.next_attempt_at <= p_now)
      and (dispatch.lease_expires_at is null or dispatch.lease_expires_at <= p_now)
  ), selected as (
    select id from due where authorized order by created_at, id limit p_limit
  )
  select jsonb_build_object(
    'dispatches', coalesce((
      select jsonb_agg(to_jsonb(dispatch) order by dispatch.created_at, dispatch.id)
      from selected join public.estimate_emails dispatch on dispatch.id = selected.id
    ), '[]'::jsonb),
    'blocked', (select count(*) from due where not authorized)
  ) into result;
  return result;
end;
$$;

revoke all on function public.list_due_estimate_email_dispatches(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_due_estimate_email_dispatches(timestamptz, integer)
  to service_role;

comment on function public.list_due_estimate_email_dispatches(timestamptz, integer) is
  'Service-only, read-only outbox selection. Actor eligibility precedes LIMIT; claim rechecks authorization and leases.';
