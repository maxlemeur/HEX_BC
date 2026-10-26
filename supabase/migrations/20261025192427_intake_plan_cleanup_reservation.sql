-- Keep plan metadata until Storage deletion is verified: Storage RLS authorizes
-- removal through this row. A retry always rediscovers pending cleanup paths.
create or replace function public.delete_stale_intake_plan_file(p_file_id uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare plan_row public.plan_files; source_row public.affaire_intake_documents;
begin
  select * into plan_row from public.plan_files where id = p_file_id for update;
  if not found or plan_row.metadata ->> 'source' is distinct from 'affaire-intake' then return null; end if;
  if plan_row.metadata ->> 'intake_cleanup_pending' = 'true' then return plan_row.file_path; end if;
  select * into source_row from public.affaire_intake_documents
    where id = (plan_row.metadata ->> 'intake_document_id')::uuid and tenant_id = plan_row.tenant_id for share;
  if not found or source_row.deletion_token is not null or source_row.deleted_at is not null then return null; end if;
  if source_row.upload_status = 'uploaded' and source_row.classification_status = 'classified'
     and source_row.document_kind = 'plans' and source_row.storage_path is not null
     and (lower(source_row.mime_type) = 'application/pdf' or lower(source_row.file_name) like '%.pdf') then return null; end if;
  update public.plan_files set metadata = metadata || '{"intake_cleanup_pending":true}'::jsonb where id = plan_row.id;
  if not found then return null; end if;
  return plan_row.file_path;
end;
$$;
