-- EST-201 follow-up: harden PDF document/storage RLS against cross-user tampering.

drop policy if exists "Users can view estimate documents" on public.estimate_documents;
drop policy if exists "Users can insert estimate documents" on public.estimate_documents;
drop policy if exists "Users can update estimate documents" on public.estimate_documents;
drop policy if exists "Admins can delete estimate documents" on public.estimate_documents;

create policy "Users can view estimate documents"
  on public.estimate_documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_documents.version_id
        and v.tenant_id = estimate_documents.tenant_id
        and p.tenant_id = estimate_documents.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can insert estimate documents"
  on public.estimate_documents
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_documents.version_id
        and v.tenant_id = estimate_documents.tenant_id
        and p.tenant_id = estimate_documents.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can update estimate documents"
  on public.estimate_documents
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_documents.version_id
        and v.tenant_id = estimate_documents.tenant_id
        and p.tenant_id = estimate_documents.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_documents.version_id
        and v.tenant_id = estimate_documents.tenant_id
        and p.tenant_id = estimate_documents.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Admins can delete estimate documents"
  on public.estimate_documents
  for delete
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

drop policy if exists "Tenant users can view estimate documents storage" on storage.objects;
drop policy if exists "Tenant users can insert estimate documents storage" on storage.objects;
drop policy if exists "Tenant users can update estimate documents storage" on storage.objects;
drop policy if exists "Tenant admins can delete estimate documents storage" on storage.objects;

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
      where v.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and p.id::text = coalesce((storage.foldername(name))[2], '')
        and storage.filename(name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
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
      where v.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and p.id::text = coalesce((storage.foldername(name))[2], '')
        and storage.filename(name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
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
      where v.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and p.id::text = coalesce((storage.foldername(name))[2], '')
        and storage.filename(name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    bucket_id = 'estimate-documents'
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and p.id::text = coalesce((storage.foldername(name))[2], '')
        and storage.filename(name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
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
      where v.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and p.id::text = coalesce((storage.foldername(name))[2], '')
        and storage.filename(name) = (v.id::text || '.pdf')
        and p.tenant_id = v.tenant_id
        and (
          select public.has_tenant_role(
            v.tenant_id,
            array['admin'::public.tenant_role]
          )
        )
    )
  );
