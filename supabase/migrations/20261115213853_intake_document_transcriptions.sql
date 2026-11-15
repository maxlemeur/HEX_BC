-- Automatic transcription of a dossier piece: the text a vision model read in an
-- image or in the scanned pages of a PDF, when the piece arrived. It is a reading
-- aid, never verified: the piece stays the source. One transcription per piece,
-- for the content it was read from (source_sha256); a new content replaces it.
-- Only the server's intake worker writes it; whoever reads the piece reads it.

-- The transcription names its piece and the piece's tenant together.
alter table public.affaire_intake_documents
  add constraint affaire_intake_documents_id_tenant_key unique (id, tenant_id);

create table public.affaire_intake_document_transcriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_id uuid not null,
  source_sha256 text not null,
  status text not null,
  -- [{ page, text, illegible }]: the pages read, in order; `illegible` counts the
  -- passages the model marked « [illisible] » instead of guessing them.
  pages jsonb not null default '[]'::jsonb,
  -- Pages of the piece that needed a reading (an image has one; a PDF its pages
  -- without text), and how many of them the per-piece bound left out.
  pages_needed integer not null,
  pages_skipped integer not null default 0,
  model text,
  reasoning_effort text,
  prompt_version text not null,
  error_code text,
  constraint affaire_intake_document_transcriptions_document_fkey foreign key (document_id, tenant_id)
    references public.affaire_intake_documents(id, tenant_id) on delete cascade,
  constraint affaire_intake_document_transcriptions_document_key unique (document_id),
  constraint affaire_intake_document_transcriptions_source_check check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint affaire_intake_document_transcriptions_status_check check (status in ('completed', 'partial', 'failed')),
  constraint affaire_intake_document_transcriptions_pages_check
    check (jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) <= 50 and octet_length(pages::text) <= 1000000),
  constraint affaire_intake_document_transcriptions_counts_check
    check (pages_needed between 1 and 10000 and pages_skipped between 0 and pages_needed),
  -- A failed reading keeps no text; a completed one read every page it needed.
  constraint affaire_intake_document_transcriptions_outcome_check check (
    (status = 'failed' and jsonb_array_length(pages) = 0 and error_code is not null)
    or (status = 'completed' and jsonb_array_length(pages) = pages_needed and pages_skipped = 0 and error_code is null)
    or (status = 'partial' and jsonb_array_length(pages) between 1 and pages_needed - 1)
  ),
  constraint affaire_intake_document_transcriptions_model_check check (model is null or char_length(model) between 1 and 120),
  constraint affaire_intake_document_transcriptions_effort_check check (reasoning_effort is null or reasoning_effort ~ '^[a-z]{1,16}$'),
  constraint affaire_intake_document_transcriptions_prompt_check check (char_length(prompt_version) between 1 and 64),
  constraint affaire_intake_document_transcriptions_error_check check (error_code is null or error_code ~ '^[A-Z0-9_]{1,64}$')
);
create index affaire_intake_document_transcriptions_tenant_idx
  on public.affaire_intake_document_transcriptions (tenant_id);

create function private.touch_affaire_intake_document_transcription()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.document_id is distinct from old.document_id then
    raise exception using errcode = '23514', message = 'INTAKE_TRANSCRIPTION_SCOPE_IMMUTABLE';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.touch_affaire_intake_document_transcription() from public, anon, authenticated;
create trigger touch_affaire_intake_document_transcription
  before update on public.affaire_intake_document_transcriptions
  for each row execute function private.touch_affaire_intake_document_transcription();

alter table public.affaire_intake_document_transcriptions enable row level security;
alter table public.affaire_intake_document_transcriptions force row level security;

revoke all on public.affaire_intake_document_transcriptions from public, anon, authenticated;
grant select on public.affaire_intake_document_transcriptions to authenticated;
grant select, insert, update, delete on public.affaire_intake_document_transcriptions to service_role;

-- Readable with its piece: the subquery reads affaire_intake_documents under its
-- own policies (tenant and affaire access), and only an active piece.
create policy "Piece readers read its transcription"
  on public.affaire_intake_document_transcriptions for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.affaire_intake_documents document
      where document.id = affaire_intake_document_transcriptions.document_id
        and document.tenant_id = affaire_intake_document_transcriptions.tenant_id
        and document.deleted_at is null and document.deletion_token is null
    )
  );

comment on table public.affaire_intake_document_transcriptions is
  'Automatic, unverified transcription of an image or of the scanned pages of a PDF of the dossier, read when the piece arrived.';
