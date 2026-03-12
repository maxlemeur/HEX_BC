alter table if exists public.affaire_intake_documents
  drop constraint if exists affaire_intake_documents_classification_source_check;

alter table if exists public.affaire_intake_documents
  add constraint affaire_intake_documents_classification_source_check
  check (
    classification_source is null
    or classification_source in ('ai', 'heuristic', 'manual')
  );
