alter table if exists public.affaire_intake_documents
  add column if not exists document_priority text not null default 'secondary';

alter table if exists public.affaire_intake_documents
  drop constraint if exists affaire_intake_documents_document_priority_check;

alter table if exists public.affaire_intake_documents
  add constraint affaire_intake_documents_document_priority_check
  check (document_priority in ('primary', 'secondary'));

alter table if exists public.affaire_intake_documents
  drop constraint if exists affaire_intake_documents_primary_kind_check;

alter table if exists public.affaire_intake_documents
  add constraint affaire_intake_documents_primary_kind_check
  check (
    document_priority = 'secondary'
    or document_kind in ('dpgf', 'cctp')
  );

with ranked_documents as (
  select
    id,
    case
      when document_kind in ('dpgf', 'cctp')
        and row_number() over (
          partition by project_id, document_kind
          order by created_at asc, id asc
        ) = 1
      then 'primary'
      else 'secondary'
    end as next_priority
  from public.affaire_intake_documents
)
update public.affaire_intake_documents documents
set document_priority = ranked_documents.next_priority
from ranked_documents
where ranked_documents.id = documents.id;

create unique index if not exists affaire_intake_documents_project_primary_dpgf_idx
  on public.affaire_intake_documents (project_id)
  where document_kind = 'dpgf' and document_priority = 'primary';

create unique index if not exists affaire_intake_documents_project_primary_cctp_idx
  on public.affaire_intake_documents (project_id)
  where document_kind = 'cctp' and document_priority = 'primary';

alter table if exists public.affaire_intake_events
  drop constraint if exists affaire_intake_events_event_type_check;

alter table if exists public.affaire_intake_events
  add constraint affaire_intake_events_event_type_check
  check (
    event_type in (
      'upload.created',
      'document.uploaded',
      'document.rejected',
      'document.classified',
      'document.classification_failed',
      'document.reclassified',
      'document.priority_changed',
      'upload.completed',
      'brief.generated',
      'brief.updated',
      'brief.confirmed'
    )
  );
