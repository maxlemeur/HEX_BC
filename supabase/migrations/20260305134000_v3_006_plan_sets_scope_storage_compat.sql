-- V3-006: fix dual-scope compat after V3 migrations already applied.
-- - Allow legacy plan_sets inserts (estimate_version_id-only) with project_id NOT NULL.
-- - Align storage.objects plan-files policies with project-or-estimate authorization.

create or replace function public.assign_plan_sets_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
  version_project_id uuid;
begin
  if new.estimate_version_id is not null then
    select ev.tenant_id, ev.project_id
      into parent_tenant_id, version_project_id
    from public.estimate_versions ev
    where ev.id = new.estimate_version_id;
  end if;

  if new.project_id is null and version_project_id is not null then
    new.project_id := version_project_id;
  end if;

  if new.project_id is not null
    and version_project_id is not null
    and new.project_id is distinct from version_project_id then
    raise exception
      using
        errcode = '23514',
        message = 'PLAN_SETS_SCOPE_MISMATCH',
        detail = format(
          'estimate_version_id=%s belongs to project_id=%s, got project_id=%s',
          new.estimate_version_id,
          version_project_id,
          new.project_id
        );
  end if;

  if parent_tenant_id is null and new.project_id is not null then
    select ep.tenant_id
      into parent_tenant_id
    from public.estimate_projects ep
    where ep.id = new.project_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop policy if exists "Tenant members can view plan files storage" on storage.objects;
drop policy if exists "Tenant members can insert plan files storage" on storage.objects;
drop policy if exists "Tenant members can update plan files storage" on storage.objects;
drop policy if exists "Tenant members can delete plan files storage" on storage.objects;

create policy "Tenant members can view plan files storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = objects.name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
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

create policy "Tenant members can insert plan files storage"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = objects.name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
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

create policy "Tenant members can update plan files storage"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = objects.name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
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
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = objects.name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
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

create policy "Tenant members can delete plan files storage"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
    )
    and (
      exists (
        select 1
        from public.plan_sets ps
        join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
        where ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
          and ps.tenant_id = pf.tenant_id
          and pf.plan_set_id = ps.id
          and coalesce(pf.file_path, '') = objects.name
          and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
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
      or not exists (
        select 1
        from public.plan_files pf
        where pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      )
    )
  );
