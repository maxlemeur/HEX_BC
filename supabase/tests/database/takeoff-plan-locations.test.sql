-- Lot 3, migration B: the building and the level of a plan revision, corrected once by an operator.
-- Isolation justified: the rights of the command, its revision check under the row lock and two operators saving at
-- once are only reproducible in SQL; the journey e2e/army/takeoff/affaire-plan-location.e2e.ts covers the screens.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.fixture(n integer) returns uuid language sql immutable as $$
  select ('b3100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.digest(label text) returns text language sql immutable as $$
  select encode(pg_catalog.sha256(convert_to(label, 'UTF8')), 'hex')
$$;
create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.fixture(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.fixture(n))::text, true);
$$;

-- The objects and what the API roles may do with them.
select has_table('public', 'takeoff_plan_locations', 'the annotations of plan revisions exist');
select has_table('public', 'takeoff_plan_location_events', 'the history of their changes exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.takeoff_plan_locations'::regclass),
  'annotations have row level security');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.takeoff_plan_location_events'::regclass),
  'their history has row level security');
select table_privs_are('public', 'takeoff_plan_locations', 'authenticated', array['SELECT'],
  'members only read annotations: no direct insert, update or delete');
select table_privs_are('public', 'takeoff_plan_location_events', 'authenticated', array['SELECT'],
  'members only read the history');
select table_privs_are('public', 'takeoff_plan_locations', 'anon', array[]::text[], 'anonymous clients see nothing');
select table_privs_are('public', 'takeoff_plan_location_events', 'anon', array[]::text[], 'anonymous clients see no history');
select is(has_function_privilege('anon', 'public.set_takeoff_plan_location(uuid, uuid, text, integer, text, text, text, uuid)', 'EXECUTE'),
  false, 'anonymous clients cannot call the command');
select is(has_function_privilege('authenticated', 'public.set_takeoff_plan_location(uuid, uuid, text, integer, text, text, text, uuid)', 'EXECUTE'),
  true, 'members call the command, which checks their rights');
select is(has_function_privilege('authenticated', 'private.resolve_takeoff_plan_location_source(uuid, uuid, uuid)', 'EXECUTE'),
  false, 'the source resolution is internal');
select has_table('public', 'takeoff_plan_location_sources', 'the source of each plan file is recorded');
select table_privs_are('public', 'takeoff_plan_location_sources', 'authenticated', array['SELECT'],
  'members only read the recorded sources');
select table_privs_are('public', 'takeoff_plan_location_sources', 'anon', array[]::text[], 'anonymous clients see no source');

-- One tenant: an engineer who owns the affaire (1), an engineer who does not (2), a director (3), an admin (5); another
-- tenant's admin (4). Affaire 20 belongs to 1, affaire 21 to 2.
insert into auth.users(id, email, raw_user_meta_data)
select pg_temp.fixture(n), 'plan-location-' || n || '@example.test', '{}'::jsonb from generate_series(1, 5) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'b3100000-%';
insert into public.tenants(id, name, slug) values
  (pg_temp.fixture(10), 'Plan location', 'plan-location-test'),
  (pg_temp.fixture(11), 'Other tenant', 'plan-location-other-test');
insert into public.tenant_memberships(tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.fixture(10), pg_temp.fixture(1), 'engineer', true, '2020-01-01'),
  (pg_temp.fixture(10), pg_temp.fixture(2), 'engineer', true, '2020-01-01'),
  (pg_temp.fixture(10), pg_temp.fixture(3), 'director', true, '2020-01-01'),
  (pg_temp.fixture(10), pg_temp.fixture(5), 'admin', true, '2020-01-01'),
  (pg_temp.fixture(11), pg_temp.fixture(4), 'admin', true, '2020-01-01');
insert into public.estimate_projects(id, tenant_id, user_id, name) values
  (pg_temp.fixture(20), pg_temp.fixture(10), pg_temp.fixture(1), 'Plans localisés (fictif)'),
  (pg_temp.fixture(21), pg_temp.fixture(10), pg_temp.fixture(2), 'Autre affaire (fictif)');
insert into public.plan_sets(id, tenant_id, project_id, name) values
  (pg_temp.fixture(40), pg_temp.fixture(10), pg_temp.fixture(20), 'Plans du dossier'),
  (pg_temp.fixture(41), pg_temp.fixture(10), pg_temp.fixture(21), 'Plans de l''autre affaire');
-- A dossier piece and its current working copy (51), a plan uploaded outside the dossier (50), another affaire's plan (52).
insert into public.affaire_intake_uploads(id, project_id, created_by, status)
values (pg_temp.fixture(30), pg_temp.fixture(20), pg_temp.fixture(1), 'ready');
insert into public.affaire_intake_documents(id, upload_id, file_name, upload_status, storage_path, classification_status,
  document_kind, size_bytes, mime_type, classified_at)
values (pg_temp.fixture(31), pg_temp.fixture(30), 'p-101-plomberie.pdf', 'uploaded', 'fixture/p-101-plomberie.pdf', 'classified',
  'plans', 8, 'application/pdf', '2026-11-01T00:00:00Z');
insert into storage.objects(bucket_id, name, metadata) values ('affaire-intake', 'fixture/p-101-plomberie.pdf', '{"size":8}');
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count, metadata, updated_at)
select pg_temp.fixture(n), pg_temp.fixture(10), pg_temp.fixture(s), name,
  concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(s), pg_temp.fixture(n), name), 'application/pdf', 8, 1, metadata,
  '2026-11-02T00:00:00Z'
from (values
  (50, 40, 'plan-hors-dossier.pdf', '{}'::jsonb),
  (51, 40, 'p-101-plomberie.pdf', (select jsonb_build_object('source', 'affaire-intake', 'intake_document_id', id,
    'intake_storage_path', storage_path, 'intake_classified_at', classified_at, 'intake_generation', plan_copy_generation)
    from public.affaire_intake_documents where id = pg_temp.fixture(31))),
  (52, 41, 'plan-autre-affaire.pdf', '{}'::jsonb)
) as copy(n, s, name, metadata);

create function pg_temp.save(file integer, hash text, expected integer, building text, level text,
  carried uuid default null, project integer default 20) returns public.takeoff_plan_locations language sql as $$
  select * from public.set_takeoff_plan_location(pg_temp.fixture(project), pg_temp.fixture(file), hash, expected,
    building, level, 'plan.pdf', carried)
$$;

-- Each plan file records its source when it is created, the dossier copy included.
select results_eq($$select plan_file_id, source_kind, source_id, project_id from public.takeoff_plan_location_sources
  where tenant_id = pg_temp.fixture(10) order by plan_file_id$$,
  $$values (pg_temp.fixture(50), 'plan_file'::text, pg_temp.fixture(50), pg_temp.fixture(20)),
    (pg_temp.fixture(51), 'intake_document'::text, pg_temp.fixture(31), pg_temp.fixture(20)),
    (pg_temp.fixture(52), 'plan_file'::text, pg_temp.fixture(52), pg_temp.fixture(21))$$,
  'the source of every plan file is recorded at its creation');

-- What the server reads before a lookup: the source of each copy and the caller's rights.
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select source_kind, source_id, current_copy, can_write
  from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(51))$$,
  $$values ('intake_document'::text, pg_temp.fixture(31), true, true)$$,
  'a working copy of the dossier names its dossier piece');
select results_eq($$select source_kind, source_id, current_copy, can_write
  from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(50))$$,
  $$values ('plan_file'::text, pg_temp.fixture(50), true, true)$$,
  'a plan uploaded outside the dossier names itself');
select is_empty($$select * from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(52))$$,
  'a plan of another affaire is not a source of this one');

-- The owner corrects: one row at revision 1, authored by the session's member, and its creation in the history.
select is((pg_temp.save(50, pg_temp.digest('plan-a'), 0, 'A', 'L00')).revision, 1, 'the first correction creates revision 1');
select results_eq($$select source_kind, source_id, content_hash, building, level, created_by, updated_by
  from public.takeoff_plan_locations where source_id = pg_temp.fixture(50)$$,
  $$values ('plan_file'::text, pg_temp.fixture(50), pg_temp.digest('plan-a'), 'A'::text, 'L00'::text, pg_temp.fixture(1), pg_temp.fixture(1))$$,
  'the values are kept as typed (L00 is no RDC) and the author is the session member');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-a'), 0, 'B', 'L00')$$, '40001', 'TAKEOFF_PLAN_LOCATION_CONFLICT',
  'a save that did not see revision 1 is refused');
select is((pg_temp.save(50, pg_temp.digest('plan-a'), 1, 'B', null)).revision, 2,
  'a save that saw revision 1 makes revision 2, and may remove the level correction (the reading applies again)');
select is((pg_temp.save(50, pg_temp.digest('plan-a'), 2, 'B', null)).revision, 2, 'the same values again change nothing');
select results_eq($$select revision, action, building_before, level_before, building, level, actor_id
  from public.takeoff_plan_location_events e
  where location_id = (select id from public.takeoff_plan_locations where source_id = pg_temp.fixture(50)) order by revision$$,
  $$values (1, 'created'::text, null::text, null::text, 'A'::text, 'L00'::text, pg_temp.fixture(1)),
    (2, 'updated'::text, 'A'::text, 'L00'::text, 'B'::text, null::text, pg_temp.fixture(1))$$,
  'each change is recorded once, with the values it replaced');

-- Values and revisions the command refuses.
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-v'), 0, ' A', null)$$, '22023', 'TAKEOFF_PLAN_LOCATION_VALUE_INVALID',
  'a value with surrounding spaces is refused');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-v'), 0, repeat('A', 41), null)$$, '22023',
  'TAKEOFF_PLAN_LOCATION_VALUE_INVALID', 'a value longer than 40 characters is refused');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-v'), 0, null, E'R+1\n')$$, '22023',
  'TAKEOFF_PLAN_LOCATION_VALUE_INVALID', 'a value with a control character is refused');
select throws_ok($$select pg_temp.save(50, 'not-a-digest', 0, 'A', null)$$, '22023', 'TAKEOFF_PLAN_LOCATION_REVISION_INVALID',
  'a revision is a SHA-256 digest');
select throws_ok($$select pg_temp.save(52, pg_temp.digest('plan-x'), 0, 'A', null)$$, 'P0002', 'TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND',
  'a plan of another affaire cannot be annotated through this one');
select throws_ok($$select * from public.set_takeoff_plan_location(pg_temp.fixture(20), pg_temp.fixture(51), pg_temp.digest('p-101-a'), 0,
  'A', 'R+1', 'p-101-plomberie.pdf', pg_temp.fixture(99))$$,
  '22023', 'TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID', 'nothing is validated « from » an annotation that does not exist here');

-- Direct writes are refused to the API roles, whatever they hold.
select throws_ok($$insert into public.takeoff_plan_locations(tenant_id, project_id, source_kind, source_id, content_hash, revision,
  plan_file_id, document_name, created_by, updated_by) values (pg_temp.fixture(10), pg_temp.fixture(20), 'plan_file', pg_temp.fixture(50),
  pg_temp.digest('forged'), 1, pg_temp.fixture(50), 'x.pdf', pg_temp.fixture(5), pg_temp.fixture(5))$$, '42501', null,
  'an operator cannot insert an annotation in another member''s name');
select throws_ok($$update public.takeoff_plan_locations set updated_by = pg_temp.fixture(5)$$, '42501', null,
  'an operator cannot rewrite the author');
select throws_ok($$delete from public.takeoff_plan_location_events$$, '42501', null, 'an operator cannot erase the history');

-- A dossier copy: the correction belongs to the piece at these bytes, and survives a new copy of the same bytes.
select is((select (pg_temp.save(51, pg_temp.digest('p-101-a'), 0, 'A', 'R+1')).source_kind), 'intake_document',
  'a correction through a dossier copy is the dossier piece''s');
reset role;
-- A reclassification gives the piece a new generation: the old copy is no longer current, a new copy is made.
update public.affaire_intake_documents set classified_at = '2026-11-03T00:00:00Z' where id = pg_temp.fixture(31);
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count, metadata)
select pg_temp.fixture(53), pg_temp.fixture(10), pg_temp.fixture(40), 'p-101-plomberie.pdf',
  concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(53), 'p-101-plomberie.pdf'), 'application/pdf', 8, 1,
  jsonb_build_object('source', 'affaire-intake', 'intake_document_id', id, 'intake_storage_path', storage_path,
    'intake_classified_at', classified_at, 'intake_generation', plan_copy_generation)
from public.affaire_intake_documents where id = pg_temp.fixture(31);
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select pg_temp.save(51, pg_temp.digest('p-101-a'), 1, 'A', 'R+2')$$, '40001', 'TAKEOFF_PLAN_LOCATION_SOURCE_STALE',
  'nothing is written through a copy its piece has replaced');
select results_eq($$select source_kind, source_id, current_copy from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(53))$$,
  $$values ('intake_document'::text, pg_temp.fixture(31), true)$$, 'the new copy names the same piece');
select results_eq($$select (pg_temp.save(53, pg_temp.digest('p-101-a'), 1, 'A', 'R+2')).revision,
  (select count(*)::integer from public.takeoff_plan_locations where source_id = pg_temp.fixture(31))$$,
  $$values (2, 1)$$, 'the same bytes through the new copy correct the same annotation, which saw revision 1');
-- Other bytes of the piece are another revision: its own row, the earlier one kept as it was.
select is((pg_temp.save(53, pg_temp.digest('p-101-b'), 0, 'A', 'R+2',
  (select id from public.takeoff_plan_locations where content_hash = pg_temp.digest('p-101-a')))).carried_from_id,
  (select id from public.takeoff_plan_locations where content_hash = pg_temp.digest('p-101-a')),
  'a correction of new bytes records the earlier one the operator validated');
select results_eq($$select content_hash, revision, level from public.takeoff_plan_locations where source_id = pg_temp.fixture(31) order by revision desc$$,
  $$values (pg_temp.digest('p-101-a'), 2, 'R+2'::text), (pg_temp.digest('p-101-b'), 1, 'R+2'::text)$$,
  'two revisions of one piece, two annotations');
select throws_ok($$select pg_temp.save(53, pg_temp.digest('p-101-b'), 1, 'A', 'R+1',
  (select id from public.takeoff_plan_locations where content_hash = pg_temp.digest('p-101-b')))$$,
  '22023', 'TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID', 'a revision is not carried over from itself');
select is((pg_temp.save(53, pg_temp.digest('p-101-b'), 1, 'A', 'R+3')).carried_from_id,
  (select id from public.takeoff_plan_locations where content_hash = pg_temp.digest('p-101-a')),
  'a later correction of a carried-over revision keeps where it came from');
-- An operator's upload outside the dossier, as the previous application version makes it, still works and is recorded.
select lives_ok($$insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
  values (pg_temp.fixture(55), pg_temp.fixture(10), pg_temp.fixture(40), 'televerse.pdf',
    concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(55), 'televerse.pdf'), 'application/pdf', 8, 1)$$,
  'an operator still uploads a plan file');
select results_eq($$select source_kind, source_id from public.takeoff_plan_location_sources where plan_file_id = pg_temp.fixture(55)$$,
  $$values ('plan_file'::text, pg_temp.fixture(55))$$, 'and its source is recorded under the operator''s session');

-- A reader reads and changes nothing; a non-owner engineer neither reads nor writes; another tenant sees nothing.
select pg_temp.sign_in(3);
select is((select count(*) from public.takeoff_plan_locations where project_id = pg_temp.fixture(20)), 3::bigint,
  'a director reads the affaire''s annotations');
select is((select count(*) from public.takeoff_plan_location_events where project_id = pg_temp.fixture(20)), 6::bigint,
  'and their history');
select results_eq($$select can_write from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(50))$$,
  $$values (false)$$, 'a director is told he may not correct');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-a'), 2, 'C', null)$$, '42501', 'TAKEOFF_PLAN_LOCATION_FORBIDDEN',
  'a director cannot correct');
select pg_temp.sign_in(2);
select is((select count(*) from public.takeoff_plan_locations where project_id = pg_temp.fixture(20)), 0::bigint,
  'an engineer who cannot read the affaire reads none of its annotations');
select is_empty($$select * from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(50))$$,
  'nor the source of its plans');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-a'), 2, 'C', null)$$, '42501', 'TAKEOFF_PLAN_LOCATION_FORBIDDEN',
  'nor corrects them');
select pg_temp.sign_in(4);
select is((select count(*) from public.takeoff_plan_locations), 0::bigint, 'another tenant sees no annotation');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-a'), 2, 'C', null)$$, '42501', 'TAKEOFF_PLAN_LOCATION_FORBIDDEN',
  'another tenant cannot correct');
select pg_temp.sign_in(5);
select is((pg_temp.save(50, pg_temp.digest('plan-a'), 2, 'C', null)).updated_by, pg_temp.fixture(5),
  'an admin corrects later, and is the new author');
reset role;

-- Editing a label never touches the plan file: its updated_at enters the source version of a running analysis.
select results_eq($$select count(*) from public.plan_files where id in (pg_temp.fixture(50), pg_temp.fixture(51))
  and updated_at = '2026-11-02T00:00:00Z'$$, $$values (2::bigint)$$, 'the plan files are untouched');
-- The key of a revision and its history are fixed, even for the database owner.
select throws_ok($$update public.takeoff_plan_locations set content_hash = pg_temp.digest('other') where source_id = pg_temp.fixture(50)$$,
  '42501', 'TAKEOFF_PLAN_LOCATION_IDENTITY_IMMUTABLE', 'an annotation never moves to other bytes');
select throws_ok($$update public.takeoff_plan_locations set revision = revision + 2 where source_id = pg_temp.fixture(50)$$,
  '42501', 'TAKEOFF_PLAN_LOCATION_IDENTITY_IMMUTABLE', 'a revision only goes up by one');
select throws_ok($$update public.takeoff_plan_location_events set building = 'Z'$$, '42501', 'TAKEOFF_PLAN_LOCATION_EVENT_IMMUTABLE',
  'the history is not rewritten');
-- The copy rotation reserves, then deletes the stale copy: the annotations and their history stay.
update public.plan_files set metadata = metadata || '{"intake_cleanup_pending":true}'::jsonb where id = pg_temp.fixture(51);
delete from public.plan_files where id = pg_temp.fixture(51);
select is((select count(*) from public.takeoff_plan_locations where source_id = pg_temp.fixture(31)), 2::bigint,
  'removing a working copy keeps the piece''s annotations');
select is((select count(*) from public.takeoff_plan_location_events e join public.takeoff_plan_locations l on l.id = e.location_id
  where l.source_id = pg_temp.fixture(31)), 4::bigint, 'and their history');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select source_kind, source_id, current_copy from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(51))$$,
  $$values ('intake_document'::text, pg_temp.fixture(31), false)$$,
  'an analysis that read the removed copy still finds its piece, never as a copy to correct through');
select throws_ok($$select pg_temp.save(51, pg_temp.digest('p-101-a'), 2, 'A', 'R+9')$$, '40001', 'TAKEOFF_PLAN_LOCATION_SOURCE_STALE',
  'nothing is written through a removed copy');
reset role;
-- Deleting an affaire takes its annotations, including one carried over from another.
select pg_temp.sign_in(1);
insert into public.estimate_projects(id, tenant_id, user_id, name)
values (pg_temp.fixture(22), pg_temp.fixture(10), pg_temp.fixture(1), 'Affaire supprimée (fictif)');
insert into public.plan_sets(id, tenant_id, project_id, name) values (pg_temp.fixture(42), pg_temp.fixture(10), pg_temp.fixture(22), 'Plans');
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.fixture(54), pg_temp.fixture(10), pg_temp.fixture(42), 'plan.pdf',
  concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(42), pg_temp.fixture(54), 'plan.pdf'), 'application/pdf', 8, 1);
set local role authenticated;
select pg_temp.save(54, pg_temp.digest('deleted-a'), 0, 'A', null, null, 22);
select pg_temp.save(54, pg_temp.digest('deleted-b'), 0, 'A', null,
  (select id from public.takeoff_plan_locations where content_hash = pg_temp.digest('deleted-a')), 22);
reset role;
delete from public.estimate_projects where id = pg_temp.fixture(22);
select is((select count(*) from public.takeoff_plan_locations where project_id = pg_temp.fixture(22)), 0::bigint,
  'deleting the affaire deletes its annotations');
select is((select count(*) from public.takeoff_plan_location_events where project_id = pg_temp.fixture(22)), 0::bigint,
  'and their history');

-- Two operators save the same revision at once, through two connections. Their fixtures must be committed to be seen.
create temp table location_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect('location_setup', (select connection from location_race_connection)), 'OK', 'fixture session connected');
select is(extensions.dblink_connect('location_a', (select connection from location_race_connection)), 'OK', 'first operator connected');
select is(extensions.dblink_connect('location_b', (select connection from location_race_connection)), 'OK', 'second operator connected');
select is(extensions.dblink_exec('location_setup', $setup$
begin;
insert into auth.users(id, email, raw_user_meta_data) values
  ('b3100000-0000-4000-8000-000000000101', 'plan-location-race-1@example.test', '{}'),
  ('b3100000-0000-4000-8000-000000000102', 'plan-location-race-2@example.test', '{}');
update public.tenant_memberships set is_default = false where user_id::text like 'b3100000-0000-4000-8000-0000000001%';
insert into public.tenants(id, name, slug) values ('b3100000-0000-4000-8000-000000000110', 'Plan location race', 'plan-location-race-test');
insert into public.tenant_memberships(tenant_id, user_id, role, is_default, created_at) values
  ('b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000101', 'engineer', true, '2020-01-01'),
  ('b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000102', 'admin', true, '2020-01-01');
insert into public.estimate_projects(id, tenant_id, user_id, name)
values ('b3100000-0000-4000-8000-000000000120', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000101', 'Course (fictif)');
insert into public.plan_sets(id, tenant_id, project_id, name)
values ('b3100000-0000-4000-8000-000000000140', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000120', 'Plans');
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values ('b3100000-0000-4000-8000-000000000150', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000140', 'course.pdf',
  'b3100000-0000-4000-8000-000000000110/b3100000-0000-4000-8000-000000000140/b3100000-0000-4000-8000-000000000150/course.pdf',
  'application/pdf', 8, 1);
commit;
$setup$), 'COMMIT', 'race fixtures committed');

create function pg_temp.as_operator(session text, member text) returns text language sql as $$
  select extensions.dblink_exec(session, format($sql$begin;
    set local role authenticated;
    set local request.jwt.claim.sub = %1$L;
    set local request.jwt.claims = %2$L;$sql$, member, jsonb_build_object('role', 'authenticated', 'sub', member)::text))
$$;
create function pg_temp.save_call(expected integer, building text) returns text language sql as $$
  select format($sql$select revision::text || ':' || coalesce(building, '') from public.set_takeoff_plan_location(
    'b3100000-0000-4000-8000-000000000120', 'b3100000-0000-4000-8000-000000000150', %L, %s, %L, 'R+1', 'course.pdf')$sql$,
    pg_temp.digest('course'), expected, building)
$$;
create temp table location_race_pids(label text primary key, pid integer);
-- Whether the session is blocked on a lock another session holds: polled until seen (at most 10 s), never a fixed pause.
create function pg_temp.waits_for_lock(session text) returns boolean language plpgsql as $$
begin
  for attempt in 1..1000 loop
    if exists (select 1 from pg_catalog.pg_locks
      where pid = (select pid from location_race_pids where label = session) and not granted) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  return false;
end;
$$;
insert into location_race_pids select 'location_b', pid
from extensions.dblink('location_b', 'select pg_backend_pid()') as remote(pid integer);

-- A plan file insert in flight records its source without locking the affaire: a previous-version writer that takes
-- the affaire's row at once (FOR UPDATE NOWAIT, as the source coverage command and the legacy retirement do) still can.
select is(extensions.dblink_exec('location_a', $insert$begin;
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values ('b3100000-0000-4000-8000-000000000151', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000140', 'second.pdf',
  'b3100000-0000-4000-8000-000000000110/b3100000-0000-4000-8000-000000000140/b3100000-0000-4000-8000-000000000151/second.pdf',
  'application/pdf', 8, 1);$insert$), 'INSERT 0 1', 'a plan file is being inserted, not yet committed');
select is((select count(*)::integer from extensions.dblink('location_b', $lock$select id from public.estimate_projects
  where id = 'b3100000-0000-4000-8000-000000000120' for update nowait$lock$) as remote(id uuid)), 1,
  'the affaire''s row is not locked by the insert''s recorded source');
select is(extensions.dblink_exec('location_a', 'rollback'), 'ROLLBACK', 'the insert is rolled back');

-- Both create the first annotation of the revision: B waits on A's uncommitted row, then gets the conflict.
select is(pg_temp.as_operator('location_a', 'b3100000-0000-4000-8000-000000000101'), 'SET', 'A opens its save');
select is((select value from extensions.dblink('location_a', pg_temp.save_call(0, 'A')) as remote(value text)), '1:A',
  'A creates revision 1, not yet committed');
select is(pg_temp.as_operator('location_b', 'b3100000-0000-4000-8000-000000000102'), 'SET', 'B opens its save');
select is(extensions.dblink_send_query('location_b', pg_temp.save_call(0, 'B')), 1, 'B saves the same revision');
select ok(pg_temp.waits_for_lock('location_b'), 'B waits for A''s row instead of writing beside it');
select is(extensions.dblink_exec('location_a', 'commit'), 'COMMIT', 'A commits');
select throws_ok($$select * from extensions.dblink_get_result('location_b') as remote(value text)$$, '40001',
  'TAKEOFF_PLAN_LOCATION_CONFLICT', 'B gets a conflict, not a second annotation');
select is((select count(*)::integer from extensions.dblink_get_result('location_b', false) as remote(value text)), 0, 'B''s save is over');
select is(extensions.dblink_exec('location_b', 'rollback'), 'ROLLBACK', 'B''s save is rolled back');

-- Both correct revision 1: the second one waits on the row lock, then sees revision 2 and is refused.
select is(pg_temp.as_operator('location_a', 'b3100000-0000-4000-8000-000000000101'), 'SET', 'A opens a correction');
select is((select value from extensions.dblink('location_a', pg_temp.save_call(1, 'C')) as remote(value text)), '2:C',
  'A makes revision 2, not yet committed');
select is(pg_temp.as_operator('location_b', 'b3100000-0000-4000-8000-000000000102'), 'SET', 'B opens a correction');
select is(extensions.dblink_send_query('location_b', pg_temp.save_call(1, 'D')), 1, 'B corrects the revision it saw');
select ok(pg_temp.waits_for_lock('location_b'), 'B waits for A''s correction');
select is(extensions.dblink_exec('location_a', 'commit'), 'COMMIT', 'A commits');
select throws_ok($$select * from extensions.dblink_get_result('location_b') as remote(value text)$$, '40001',
  'TAKEOFF_PLAN_LOCATION_CONFLICT', 'B is told the revision moved');
select is((select count(*)::integer from extensions.dblink_get_result('location_b', false) as remote(value text)), 0, 'B''s correction is over');
select is(extensions.dblink_exec('location_b', 'rollback'), 'ROLLBACK', 'B''s correction is rolled back');
select results_eq($$select value from extensions.dblink('location_setup', $q$select revision::text || ':' || building || ':' || updated_by::text
  from public.takeoff_plan_locations where project_id = 'b3100000-0000-4000-8000-000000000120'$q$) as remote(value text)$$,
  $$values ('2:C:b3100000-0000-4000-8000-000000000101'::text)$$, 'one annotation, A''s value: B sees the winner when it reloads');
select results_eq($$select value from extensions.dblink('location_setup', $q$select count(*)::text
  from public.takeoff_plan_location_events where project_id = 'b3100000-0000-4000-8000-000000000120'$q$) as remote(value text)$$,
  $$values ('2'::text)$$, 'the history holds A''s two saves only');

select is(extensions.dblink_exec('location_setup', $cleanup$
begin;
delete from public.estimate_projects where id = 'b3100000-0000-4000-8000-000000000120';
do $clean$
declare
  target uuid := 'b3100000-0000-4000-8000-000000000110';
  entry record;
begin
  for entry in
    select columns.table_schema, columns.table_name
    from information_schema.columns as columns
    join information_schema.tables as tables
      on tables.table_schema = columns.table_schema and tables.table_name = columns.table_name
    where columns.table_schema in ('public', 'private') and columns.column_name = 'tenant_id'
      and tables.table_type = 'BASE TABLE' and not (columns.table_schema = 'public' and columns.table_name = 'tenants')
  loop
    execute format('delete from %I.%I where tenant_id = $1', entry.table_schema, entry.table_name) using target;
  end loop;
  delete from public.tenants where id = target;
end
$clean$;
delete from public.profiles where id in ('b3100000-0000-4000-8000-000000000101', 'b3100000-0000-4000-8000-000000000102');
delete from auth.users where id in ('b3100000-0000-4000-8000-000000000101', 'b3100000-0000-4000-8000-000000000102');
commit;
$cleanup$), 'COMMIT', 'race fixtures removed');
select is((select count(*)::integer from public.takeoff_plan_locations where tenant_id = 'b3100000-0000-4000-8000-000000000110'),
  0, 'no race annotation is left');
select extensions.dblink_disconnect('location_a');
select extensions.dblink_disconnect('location_b');
select extensions.dblink_disconnect('location_setup');

select * from finish();
rollback;
