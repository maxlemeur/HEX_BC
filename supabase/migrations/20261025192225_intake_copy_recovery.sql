-- Reservations are leased and replaced using updated_at + a fresh token. Restored
-- documents use a new storage generation, fencing delayed storage requests.
alter table public.affaire_intake_documents add column deletion_started_at timestamptz;
update public.affaire_intake_documents set deletion_started_at = now() where deletion_token is not null;

-- Decide stale-plan removal from the current source under lock, rather than a
-- classifier snapshot that may precede another import's completion.
create function public.delete_stale_intake_plan_file(p_file_id uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare plan_row public.plan_files; source_row public.affaire_intake_documents;
begin
  select * into plan_row from public.plan_files where id = p_file_id for update;
  if not found or plan_row.metadata ->> 'source' is distinct from 'affaire-intake' then return null; end if;
  select * into source_row from public.affaire_intake_documents
    where id = (plan_row.metadata ->> 'intake_document_id')::uuid and tenant_id = plan_row.tenant_id for share;
  -- A deletion worker owns its own copies and storage verification.
  if found and (source_row.deletion_token is not null or
      (source_row.deleted_at is null and source_row.upload_status = 'uploaded'
       and source_row.classification_status = 'classified' and source_row.document_kind = 'plans'
       and source_row.storage_path is not null and (lower(source_row.mime_type) = 'application/pdf'
         or lower(source_row.file_name) like '%.pdf'))) then return null; end if;
  delete from public.plan_files where id = plan_row.id;
  if not found then return null; end if;
  return plan_row.file_path;
end;
$$;
revoke all on function public.delete_stale_intake_plan_file(uuid) from public, anon;
grant execute on function public.delete_stale_intake_plan_file(uuid) to authenticated, service_role;
