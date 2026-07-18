-- Restore the private estimate PDF bucket and its latest tenant-scoped policies.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'estimate-documents',
  'estimate-documents',
  false,
  20971520,
  array['application/pdf']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Tenant users can view estimate documents storage"
  on storage.objects;
drop policy if exists "Tenant users can insert estimate documents storage"
  on storage.objects;
drop policy if exists "Tenant users can update estimate documents storage"
  on storage.objects;
drop policy if exists "Tenant admins can delete estimate documents storage"
  on storage.objects;

create policy "Tenant users can view estimate documents storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'estimate-documents'
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.tenant_id::text = coalesce((storage.foldername(storage.objects.name))[1], '')
        and p.id::text = coalesce((storage.foldername(storage.objects.name))[2], '')
        and storage.filename(storage.objects.name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              v.tenant_id,
              array['admin'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Tenant users can insert estimate documents storage"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'estimate-documents'
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.tenant_id::text = coalesce((storage.foldername(storage.objects.name))[1], '')
        and p.id::text = coalesce((storage.foldername(storage.objects.name))[2], '')
        and storage.filename(storage.objects.name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              v.tenant_id,
              array['admin'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Tenant users can update estimate documents storage"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'estimate-documents'
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.tenant_id::text = coalesce((storage.foldername(storage.objects.name))[1], '')
        and p.id::text = coalesce((storage.foldername(storage.objects.name))[2], '')
        and storage.filename(storage.objects.name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              v.tenant_id,
              array['admin'::public.tenant_role]
            )
          )
        )
    )
  )
  with check (
    bucket_id = 'estimate-documents'
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.tenant_id::text = coalesce((storage.foldername(storage.objects.name))[1], '')
        and p.id::text = coalesce((storage.foldername(storage.objects.name))[2], '')
        and storage.filename(storage.objects.name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              v.tenant_id,
              array['admin'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Tenant admins can delete estimate documents storage"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'estimate-documents'
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.tenant_id::text = coalesce((storage.foldername(storage.objects.name))[1], '')
        and p.id::text = coalesce((storage.foldername(storage.objects.name))[2], '')
        and storage.filename(storage.objects.name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (
          select public.has_tenant_role(
            v.tenant_id,
            array['admin'::public.tenant_role]
          )
        )
    )
  );
