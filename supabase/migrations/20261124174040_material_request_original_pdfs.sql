-- TI-690: allow PDF originals on a material request, matching quote attachments.
-- The private bucket « material-requests » already accepts application/pdf (20261112173255_material_request_quotes);
-- only the table's CHECK constraint kept PDF to quote files. Existing rows and the version in production keep working
-- unchanged (images and quote PDFs remain valid).
-- Regression: supabase/tests/database/material-requests.test.sql and material-request-quotes.test.sql.

begin;

do $preflight$
begin
  if to_regclass('public.material_request_files') is null
    or not exists (
      select 1 from pg_constraint
      where conrelid = 'public.material_request_files'::regclass
        and conname = 'material_request_files_mime_type_check'
    )
    or not exists (
      select 1 from storage.buckets
      where id = 'material-requests'
        and 'application/pdf' = any(allowed_mime_types)
    ) then
    raise exception '20261124174040_material_request_original_pdfs requires 20261112173255_material_request_quotes';
  end if;
end $preflight$;

alter table public.material_request_files
  drop constraint material_request_files_mime_type_check,
  add constraint material_request_files_mime_type_check check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  );

comment on column public.material_request_files.quote_id is
  'TI-690/TI-691: null for an original of the request (image or PDF); the quote this file answers otherwise (PDF or image), listed with the quote.';

commit;
