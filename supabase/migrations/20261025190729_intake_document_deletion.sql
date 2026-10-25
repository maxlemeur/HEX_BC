-- Keep immutable audit/source references while removing the private file and
-- excluding the document from the active dossier. No audit event is rewritten.
alter table public.affaire_intake_documents
  add column deleted_at timestamptz;

alter table public.affaire_intake_documents
  add constraint affaire_intake_documents_deleted_copy_check
  check (deleted_at is null or (storage_path is null and upload_status = 'rejected' and document_priority = 'secondary'));

comment on column public.affaire_intake_documents.deleted_at is
  'Copy removed from intake and synced plan storage; metadata retained for immutable audit and existing source references.';
