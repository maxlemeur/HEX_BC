-- TI-690: Excel workbooks are downloadable originals of a material request.
begin;

alter table public.material_request_files
  drop constraint material_request_files_mime_type_check,
  add constraint material_request_files_mime_type_check check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    or (
      mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      and quote_id is null
      and rotation = 0
    )
  );

update storage.buckets
set allowed_mime_types = array_append(
  allowed_mime_types,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
)
where id = 'material-requests'
  and not ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' = any(allowed_mime_types));

comment on column public.material_request_files.quote_id is
  'TI-690/TI-691: null for an original of the request (image, PDF or XLSX); otherwise the quote this PDF or image answers.';

commit;
