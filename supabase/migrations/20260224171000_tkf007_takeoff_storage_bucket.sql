-- TKF-007: provision takeoff storage bucket and tenant-scoped object policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'takeoff-files',
  'takeoff-files',
  false,
  10485760,
  array[
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

drop policy if exists "Tenant members can view takeoff files storage" on storage.objects;
drop policy if exists "Tenant members can insert takeoff files storage" on storage.objects;
drop policy if exists "Tenant members can update takeoff files storage" on storage.objects;
drop policy if exists "Tenant members can delete takeoff files storage" on storage.objects;

create policy "Tenant members can view takeoff files storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'takeoff-files'
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
    )
  );

create policy "Tenant members can insert takeoff files storage"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'takeoff-files'
    and coalesce((storage.foldername(name))[1], '') <> ''
    and coalesce((storage.foldername(name))[2], '') <> ''
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
    )
  );

create policy "Tenant members can update takeoff files storage"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'takeoff-files'
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
    )
  )
  with check (
    bucket_id = 'takeoff-files'
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
    )
  );

create policy "Tenant members can delete takeoff files storage"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'takeoff-files'
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
    )
  );
