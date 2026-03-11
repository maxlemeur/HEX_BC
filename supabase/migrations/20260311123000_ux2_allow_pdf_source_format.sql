alter table public.dpgf_imports
  drop constraint if exists dpgf_imports_source_format_check;

alter table public.dpgf_imports
  add constraint dpgf_imports_source_format_check
  check (source_format = any (array['json'::text, 'csv'::text, 'xlsx'::text, 'pdf'::text]));
