begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(4);

select ok(
  (select allowed_mime_types @> array['application/pdf'] from storage.buckets where id = 'takeoff-files'),
  'takeoff uploads accept PDF plans for levels B and C'
);
select ok(
  (select allowed_mime_types @> array['text/csv', 'application/csv', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    from storage.buckets where id = 'takeoff-files'),
  'structured takeoff upload formats remain supported'
);
select is((select public from storage.buckets where id = 'takeoff-files'), false,
  'takeoff uploads remain private');
select is((select file_size_limit from storage.buckets where id = 'takeoff-files'), 10485760::bigint,
  'takeoff upload size remains capped at ten MiB');

select * from finish();
rollback;
