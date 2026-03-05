-- V3-002: RLS plan_sets/plan_files en mode dual-scope (project_id OU estimate_version_id).

create or replace function public.can_access_takeoff_project(
  p_project_id uuid,
  p_tenant_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_project_id is not null
    and p_tenant_id is not null
    and exists (
      select 1
      from public.estimate_projects p
      where p.id = p_project_id
        and p.tenant_id = p_tenant_id
        and (select public.is_tenant_member(p.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
        )
    );
$$;

grant execute on function public.can_access_takeoff_project(uuid, uuid) to authenticated;

drop policy if exists "Current tenant can select plan sets" on public.plan_sets;
drop policy if exists "Current tenant can insert plan sets" on public.plan_sets;
drop policy if exists "Current tenant can update plan sets" on public.plan_sets;
drop policy if exists "Current tenant can delete plan sets" on public.plan_sets;

create policy "Current tenant can select plan sets"
  on public.plan_sets
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (
        project_id is not null
        and (select public.can_access_takeoff_project(project_id, tenant_id))
      )
      or (
        estimate_version_id is not null
        and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
      )
    )
  );

create policy "Current tenant can insert plan sets"
  on public.plan_sets
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (
        project_id is not null
        and (select public.can_access_takeoff_project(project_id, tenant_id))
      )
      or (
        estimate_version_id is not null
        and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
      )
    )
  );

create policy "Current tenant can update plan sets"
  on public.plan_sets
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (
        project_id is not null
        and (select public.can_access_takeoff_project(project_id, tenant_id))
      )
      or (
        estimate_version_id is not null
        and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (
      (
        project_id is not null
        and (select public.can_access_takeoff_project(project_id, tenant_id))
      )
      or (
        estimate_version_id is not null
        and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
      )
    )
  );

create policy "Current tenant can delete plan sets"
  on public.plan_sets
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (
        project_id is not null
        and (select public.can_access_takeoff_project(project_id, tenant_id))
      )
      or (
        estimate_version_id is not null
        and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
      )
    )
  );

drop policy if exists "Current tenant can select plan files" on public.plan_files;
drop policy if exists "Current tenant can insert plan files" on public.plan_files;
drop policy if exists "Current tenant can update plan files" on public.plan_files;
drop policy if exists "Current tenant can delete plan files" on public.plan_files;

create policy "Current tenant can select plan files"
  on public.plan_files
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (
          (
            ps.project_id is not null
            and (select public.can_access_takeoff_project(ps.project_id, ps.tenant_id))
          )
          or (
            ps.estimate_version_id is not null
            and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
          )
        )
    )
  );

create policy "Current tenant can insert plan files"
  on public.plan_files
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (
          (
            ps.project_id is not null
            and (select public.can_access_takeoff_project(ps.project_id, ps.tenant_id))
          )
          or (
            ps.estimate_version_id is not null
            and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
          )
        )
    )
  );

create policy "Current tenant can update plan files"
  on public.plan_files
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (
          (
            ps.project_id is not null
            and (select public.can_access_takeoff_project(ps.project_id, ps.tenant_id))
          )
          or (
            ps.estimate_version_id is not null
            and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
          )
        )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (
          (
            ps.project_id is not null
            and (select public.can_access_takeoff_project(ps.project_id, ps.tenant_id))
          )
          or (
            ps.estimate_version_id is not null
            and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
          )
        )
    )
  );

create policy "Current tenant can delete plan files"
  on public.plan_files
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (
          (
            ps.project_id is not null
            and (select public.can_access_takeoff_project(ps.project_id, ps.tenant_id))
          )
          or (
            ps.estimate_version_id is not null
            and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
          )
        )
    )
  );
