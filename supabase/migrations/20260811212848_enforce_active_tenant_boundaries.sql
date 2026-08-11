-- Keep membership discovery and public portal capabilities aligned with the
-- active-tenant boundary enforced by current_tenant_id().

-- The legacy multitenant tables were created without relation grants on a
-- fresh reset. RLS policies cannot authorize requests until PostgreSQL first
-- grants the requested table operation to the Data API role.
revoke all privileges
  on table public.tenants, public.tenant_memberships
  from anon, authenticated, PUBLIC;

grant select
  on table public.tenants
  to authenticated;

grant select, insert, update, delete
  on table public.tenant_memberships
  to authenticated;

drop policy if exists "Users can view own tenants"
  on public.tenants;

create policy "Users can view own tenants"
  on public.tenants
  for select
  to authenticated
  using (
    is_active
    and (
      (select public.is_tenant_member(id))
      or created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view memberships in own tenants"
  on public.tenant_memberships;

create policy "Users can view memberships in own tenants"
  on public.tenant_memberships
  for select
  to authenticated
  using (
    (
      user_id = (select auth.uid())
      and (select public.is_tenant_member(tenant_id))
    )
    or (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role]
    ))
  );

create or replace function public.set_active_tenant_membership_default(
  p_membership_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  target_membership public.tenant_memberships%rowtype;
  blocked_by_non_admin_default boolean;
begin
  if actor_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'TENANT_DEFAULT_AUTH_REQUIRED';
  end if;

  -- Serialize every default switch for this user, including memberships whose
  -- tenant is currently inactive and therefore intentionally hidden by RLS.
  perform 1
  from public.tenant_memberships membership
  where membership.user_id = actor_user_id
  for update;

  select membership.*
    into target_membership
  from public.tenant_memberships membership
  join public.tenants tenant on tenant.id = membership.tenant_id
  where membership.id = p_membership_id
    and membership.user_id = actor_user_id
    and tenant.is_active
  for update of membership, tenant;

  if target_membership.id is null then
    raise exception using
      errcode = '42501',
      message = 'TENANT_DEFAULT_TARGET_FORBIDDEN';
  end if;

  if target_membership.role <> 'admin'::public.tenant_role then
    raise exception using
      errcode = '42501',
      message = 'TENANT_DEFAULT_ADMIN_REQUIRED';
  end if;

  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = actor_user_id
      and membership.id <> target_membership.id
      and membership.is_default
      and membership.role <> 'admin'::public.tenant_role
  )
    into blocked_by_non_admin_default;

  if blocked_by_non_admin_default then
    raise exception using
      errcode = '42501',
      message = 'TENANT_DEFAULT_SWITCH_FORBIDDEN';
  end if;

  update public.tenant_memberships
  set is_default = false
  where user_id = actor_user_id
    and is_default;

  update public.tenant_memberships
  set is_default = true
  where id = target_membership.id
    and user_id = actor_user_id;

  return target_membership.id;
end;
$$;

revoke all on function public.set_active_tenant_membership_default(uuid)
  from public, anon, authenticated;
grant execute on function public.set_active_tenant_membership_default(uuid)
  to authenticated;

create or replace function public.claim_portal_estimate_decision(
  p_portal_token_id uuid,
  p_decision text,
  p_client_ip inet default null,
  p_reject_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  portal_row public.portal_tokens%rowtype;
  version_status public.estimate_status;
  decided_at timestamptz := clock_timestamp();
  event_metadata jsonb;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_decision not in ('accepted', 'rejected') then
    raise exception using
      errcode = '22023',
      message = 'invalid portal decision';
  end if;

  select pt.*
    into portal_row
  from public.portal_tokens pt
  where pt.id = p_portal_token_id;

  if portal_row.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'portal capability is no longer claimable';
  end if;

  select ev.status
    into version_status
  from public.estimate_versions ev
  join public.tenants t on t.id = ev.tenant_id
  where ev.id = portal_row.version_id
    and ev.tenant_id = portal_row.tenant_id
    and t.is_active
  for update of ev, t;

  if version_status is null or version_status <> 'sent' then
    raise exception using
      errcode = 'P0001',
      message = 'estimate version is no longer claimable';
  end if;

  select pt.*
    into portal_row
  from public.portal_tokens pt
  where pt.id = p_portal_token_id
    and pt.version_id = portal_row.version_id
    and pt.tenant_id = portal_row.tenant_id
  for update;

  if portal_row.id is null
    or portal_row.status <> 'pending'
    or portal_row.expires_at <= decided_at then
    raise exception using
      errcode = 'P0001',
      message = 'portal capability is no longer claimable';
  end if;

  update public.portal_tokens
  set status = p_decision,
      accepted_at = case
        when p_decision = 'accepted' then decided_at
        else null
      end,
      accepted_ip = case
        when p_decision = 'accepted' then p_client_ip
        else null
      end,
      reject_reason = case
        when p_decision = 'rejected'
          then nullif(left(btrim(p_reject_reason), 1000), '')
        else null
      end
  where id = portal_row.id;

  update public.estimate_versions
  set status = case
    when p_decision = 'accepted' then 'accepted'::public.estimate_status
    else 'archived'::public.estimate_status
  end
  where id = portal_row.version_id
    and tenant_id = portal_row.tenant_id
    and status = 'sent';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'estimate version decision lost its concurrency claim';
  end if;

  update public.portal_tokens
  set status = 'expired'
  where version_id = portal_row.version_id
    and tenant_id = portal_row.tenant_id
    and id <> portal_row.id
    and status = 'pending';

  event_metadata := jsonb_build_object(
    'portal_token_id', portal_row.id,
    case when p_decision = 'accepted' then 'accepted_via' else 'rejected_via' end,
    'portal'
  );

  if p_decision = 'accepted' then
    event_metadata := event_metadata || jsonb_build_object(
      'client_ip', p_client_ip
    );
  elsif nullif(left(btrim(p_reject_reason), 1000), '') is not null then
    event_metadata := event_metadata || jsonb_build_object(
      'reason', left(btrim(p_reject_reason), 1000)
    );
  end if;

  perform public.log_estimate_version_event(
    portal_row.version_id,
    p_decision,
    null,
    event_metadata,
    decided_at
  );
end;
$$;

revoke all on function public.claim_portal_estimate_decision(uuid, text, inet, text)
  from public, anon, authenticated;
grant execute on function public.claim_portal_estimate_decision(uuid, text, inet, text)
  to service_role;
