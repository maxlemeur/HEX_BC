-- TI-652: allow the existing project writers to verify their pending Drive copy
-- after a lost Storage/DB acknowledgement. Readers keep the uploaded-only policy.
-- This migration is prepared for review; apply only to an explicitly approved environment.
drop policy if exists "Project writers can verify pending Drive copies" on storage.objects;
create policy "Project writers can verify pending Drive copies"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'affaire-intake'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 4
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1 from public.affaire_intake_documents d
      join public.affaire_intake_uploads u on u.id = d.upload_id
      where d.tenant_id = (select public.current_tenant_id())
        and d.project_id::text = coalesce((storage.foldername(objects.name))[2], '')
        and u.id::text = coalesce((storage.foldername(objects.name))[3], '')
        and d.id::text = coalesce((storage.foldername(objects.name))[4], '')
        and d.storage_path = objects.name and d.upload_status = 'pending'
        and (select public.can_access_affaire_intake_project(d.project_id, d.tenant_id))
        and exists (
          select 1 from public.affaire_intake_events e
          where e.document_id = d.id and e.upload_id = u.id
            and e.tenant_id = d.tenant_id and e.project_id = d.project_id
            and e.event_type = 'upload.created'
            and e.after_payload -> 'drive' ->> 'provider' = 'google_drive'
        )
    )
  );
