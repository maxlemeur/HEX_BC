begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(4);
select is((select public from storage.buckets where id = 'affaire-intake'), false,
  'CAD/BIM originals remain private');
select is((select file_size_limit from storage.buckets where id = 'affaire-intake'), 52428800::bigint,
  'CAD/BIM acceptance preserves the 50 MiB limit');
select ok((select allowed_mime_types is null or 'application/octet-stream' = any(allowed_mime_types)
  from storage.buckets where id = 'affaire-intake'), 'private bucket accepts binary originals');
select ok((select allowed_mime_types is null or 'application/pdf' = any(allowed_mime_types)
  from storage.buckets where id = 'affaire-intake'), 'existing PDF uploads remain supported');
select * from finish();
rollback;
