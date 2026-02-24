-- TKF-017 follow-up: allow tenant-authorized storage cleanup when plan_files metadata is already deleted.

drop policy if exists "Tenant members can delete plan files storage" on storage.objects;

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
