-- Make tenant suspension authoritative for every policy that delegates to the
-- shared membership helpers, and remove project-wide profile visibility.

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.tenant_id
  from public.tenant_memberships tm
  join public.tenants t on t.id = tm.tenant_id
  where tm.user_id = (select auth.uid())
    and t.is_active
  order by tm.is_default desc, tm.created_at asc
  limit 1;
$$;

create or replace function public.is_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_tenant_id is not null
    and exists (
      select 1
      from public.tenants t
      where t.id = target_tenant_id
        and t.is_active
    )
    and (
      exists (
        select 1
        from public.tenant_memberships tm
        where tm.tenant_id = target_tenant_id
          and tm.user_id = (select auth.uid())
      )
      or (select public.is_admin_user())
    );
$$;

create or replace function public.has_tenant_role(
  target_tenant_id uuid,
  allowed_roles public.tenant_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_tenant_id is not null
    and coalesce(array_length(allowed_roles, 1), 0) > 0
    and exists (
      select 1
      from public.tenants t
      where t.id = target_tenant_id
        and t.is_active
    )
    and (
      exists (
        select 1
        from public.tenant_memberships tm
        where tm.tenant_id = target_tenant_id
          and tm.user_id = (select auth.uid())
          and tm.role = any(allowed_roles)
      )
      or (select public.is_admin_user())
    );
$$;

create or replace function public.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_user_id is not null
    and (
      target_user_id = (select auth.uid())
      or (select public.is_admin_user())
      or exists (
        select 1
        from public.tenant_memberships actor
        join public.tenant_memberships subject
          on subject.tenant_id = actor.tenant_id
        join public.tenants t
          on t.id = actor.tenant_id
        where actor.user_id = (select auth.uid())
          and subject.user_id = target_user_id
          and t.is_active
      )
    );
$$;

revoke execute on function public.can_view_profile(uuid) from public, anon;
grant execute on function public.can_view_profile(uuid) to authenticated;

drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "Profiles are viewable in active tenant scope" on public.profiles;

create policy "Profiles are viewable in active tenant scope"
  on public.profiles
  for select
  to authenticated
  using ((select public.can_view_profile(id)));
