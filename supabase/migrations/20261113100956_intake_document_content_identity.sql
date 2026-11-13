-- Fingerprints are server-computed from original uploaded bytes, never the filename.
-- Existing pieces remain unchanged and are checked against Storage on demand.
alter table public.affaire_intake_documents
  add column content_sha256 text,
  add constraint affaire_intake_documents_content_sha256_check
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

-- Reserve at pending, before Storage transfer, so concurrent requests cannot
-- create two copies. Failed transfers and verified deletions release the key.
create unique index affaire_intake_documents_active_content_idx
  on public.affaire_intake_documents (tenant_id, project_id, content_sha256)
  where content_sha256 is not null and deleted_at is null
    and upload_status in ('pending', 'uploaded');

create index affaire_intake_documents_legacy_content_size_idx
  on public.affaire_intake_documents (tenant_id, project_id, size_bytes)
  where content_sha256 is null and source_provider is null and deleted_at is null
    and upload_status = 'uploaded';

comment on column public.affaire_intake_documents.content_sha256 is
  'SHA-256 of original uploaded bytes; null for legacy copies and externally linked Drive files.';
