-- TKF-017 follow-up: qualify storage.objects.name in storage policy subqueries.

-- Without qualification, `name` can resolve to joined table columns (for example plan_sets.name),
-- making path checks and file_path/file_name guards evaluate against the wrong value.

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
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
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
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
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
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
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
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
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
          and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
      )
      or not exists (
        select 1
        from public.plan_files pf
        where pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      )
    )
  );
