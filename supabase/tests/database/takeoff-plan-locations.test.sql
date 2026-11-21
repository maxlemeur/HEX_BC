-- Lot 3, migration B: the building and the level of a plan revision, corrected once by an operator.
-- Isolation justified: the server's attestation, the rights of the command, its revision check under the row lock, its
-- lock order against an affaire's deletion and two operators saving at once are only reproducible in SQL; the journey
-- e2e/army/takeoff/affaire-plan-location.e2e.ts covers the screens.
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
select is(has_function_privilege('anon', 'public.set_takeoff_plan_location(uuid, integer, text, text, text, text, text[])', 'EXECUTE'),
  false, 'anonymous clients cannot call the command');
select is(has_function_privilege('authenticated', 'public.set_takeoff_plan_location(uuid, integer, text, text, text, text, text[])', 'EXECUTE'),
  true, 'members call the command, which checks their rights');
select is(has_function_privilege('authenticated', 'public.attest_takeoff_plan_revision(uuid, uuid, uuid, uuid, text, text, uuid, integer)', 'EXECUTE'),
  false, 'a member''s session cannot attest a revision');
select is(has_function_privilege('service_role', 'public.attest_takeoff_plan_revision(uuid, uuid, uuid, uuid, text, text, uuid, integer)', 'EXECUTE'),
  true, 'the application server attests the revisions it read');
select is(has_table_privilege('authenticated', 'private.takeoff_plan_location_attestations', 'SELECT')
  or has_table_privilege('authenticated', 'private.takeoff_plan_location_attestations', 'INSERT'), false,
  'members neither read nor write the attestations');
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

-- The server's attestation, made as its service role does (a security-definer helper of this test): the digest of the
-- bytes it read for a plan file, for the signed-in member, with the earlier revision it proposes to carry over.
create function pg_temp.attest(file integer, hash text, project integer default 20, carry uuid default null)
returns uuid language sql security definer as $$
  select public.attest_takeoff_plan_revision(pg_temp.fixture(10), (select auth.uid()), pg_temp.fixture(project),
    pg_temp.fixture(file), hash, 'plan.pdf', carry,
    case when carry is not null then coalesce((select revision from public.takeoff_plan_locations where id = carry), 1) end)
$$;
-- A save through the route: attested by the server, then written under the member's session.
create function pg_temp.save(file integer, hash text, expected integer, building_choice text, building text,
  level_choice text, level text, carried text[] default '{}', project integer default 20, carry uuid default null)
returns public.takeoff_plan_locations language sql as $$
  select * from public.set_takeoff_plan_location(pg_temp.attest(file, hash, project, carry), expected,
    building_choice, building, level_choice, level, carried)
$$;
create function pg_temp.location(hash text) returns public.takeoff_plan_locations language sql as $$
  select * from public.takeoff_plan_locations where content_hash = hash
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

-- Written before the fix: an owner calling the command with the digest of bytes the server never read
-- (a revision still to come) was accepted; any later upload of those bytes then showed it as confirmed or corrected.
select throws_ok($$select public.attest_takeoff_plan_revision(pg_temp.fixture(10), pg_temp.fixture(1), pg_temp.fixture(20),
  pg_temp.fixture(50), pg_temp.digest('forthcoming'), 'plan.pdf')$$, '42501', null, 'a member''s session cannot attest a digest');
select throws_ok($$select * from public.set_takeoff_plan_location('b3100000-0000-4000-8000-0000000009ff', 0, 'value', 'A', 'reading', null)$$,
  '42501', 'TAKEOFF_PLAN_LOCATION_NOT_ATTESTED', 'a correction of bytes the server did not attest is refused');
select is((select count(*) from public.takeoff_plan_locations), 0::bigint, 'and nothing is written');

-- The owner corrects: one row at revision 1, authored by the session's member, and its creation in the history.
select is((pg_temp.save(50, pg_temp.digest('plan-a'), 0, 'value', 'A', 'value', 'L00')).revision, 1,
  'the first correction of an attested revision creates revision 1');
select results_eq($$select source_kind, source_id, content_hash, building_choice, building, level_choice, level, created_by,
  building_set_by, level_set_by, building_set_revision, level_set_revision from public.takeoff_plan_locations where source_id = pg_temp.fixture(50)$$,
  $$values ('plan_file'::text, pg_temp.fixture(50), pg_temp.digest('plan-a'), 'value'::text, 'A'::text, 'value'::text, 'L00'::text,
    pg_temp.fixture(1), pg_temp.fixture(1), pg_temp.fixture(1), 1, 1)$$,
  'the values are kept as typed (L00 is no RDC), each field with its author and generation');
-- An attestation is for one member and one save, for fifteen minutes at most.
create temp table location_attestations(label text primary key, id uuid);
grant all on location_attestations to authenticated;
insert into location_attestations values ('once', pg_temp.attest(50, pg_temp.digest('plan-once')));
select lives_ok($$select * from public.set_takeoff_plan_location((select id from location_attestations where label = 'once'), 0,
  'value', 'A', 'reading', null)$$, 'an attestation serves its save');
select throws_ok($$select * from public.set_takeoff_plan_location((select id from location_attestations where label = 'once'), 1,
  'value', 'B', 'reading', null)$$, '42501', 'TAKEOFF_PLAN_LOCATION_NOT_ATTESTED', 'and only that one');
insert into location_attestations values ('member', pg_temp.attest(50, pg_temp.digest('plan-member')));
select pg_temp.sign_in(5);
select throws_ok($$select * from public.set_takeoff_plan_location((select id from location_attestations where label = 'member'), 0,
  'value', 'A', 'reading', null)$$, '42501', 'TAKEOFF_PLAN_LOCATION_NOT_ATTESTED', 'another member cannot use it');
select pg_temp.sign_in(1);
insert into location_attestations values ('old', pg_temp.attest(50, pg_temp.digest('plan-old')));
reset role;
update private.takeoff_plan_location_attestations set created_at = now() - interval '16 minutes'
where id = (select id from location_attestations where label = 'old');
set local role authenticated;
select throws_ok($$select * from public.set_takeoff_plan_location((select id from location_attestations where label = 'old'), 0,
  'value', 'A', 'reading', null)$$, '42501', 'TAKEOFF_PLAN_LOCATION_NOT_ATTESTED', 'an attestation older than fifteen minutes is refused');

select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-a'), 0, 'value', 'B', 'value', 'L00')$$, '40001', 'TAKEOFF_PLAN_LOCATION_CONFLICT',
  'a save that did not see revision 1 is refused');
-- Written before the fix: clearing « Niveau » used to restore the plan's wrong reading. Per field the
-- operator follows the reading, sets a value, or marks it to be specified, and that choice is stored.
select is((pg_temp.save(50, pg_temp.digest('plan-a'), 1, 'value', 'B', 'unknown', null)).revision, 2,
  'a save that saw revision 1 makes revision 2, and marks the level to be specified');
select results_eq($$select level_choice, level, level_set_by, level_set_revision, building_set_revision from pg_temp.location(pg_temp.digest('plan-a'))$$,
  $$values ('unknown'::text, null::text, pg_temp.fixture(1), 2, 2)$$, 'the explicit « À préciser » is stored with its author and generation');
select is((pg_temp.save(50, pg_temp.digest('plan-a'), 2, 'value', 'B', 'unknown', null)).revision, 2, 'the same choices again change nothing');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-v'), 0, 'reading', 'A', 'reading', null)$$, '22023',
  'TAKEOFF_PLAN_LOCATION_VALUE_INVALID', 'following the reading carries no value');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-v'), 0, 'value', null, 'reading', null)$$, '22023',
  'TAKEOFF_PLAN_LOCATION_VALUE_INVALID', 'a set value has one');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-v'), 0, 'guess', null, 'reading', null)$$, '22023',
  'TAKEOFF_PLAN_LOCATION_VALUE_INVALID', 'a choice is one of the three');
-- Written before the fix: the building was attributed to whoever last edited the row. Each field keeps
-- who set it, in the same transaction as its value.
select pg_temp.sign_in(5);
select is((pg_temp.save(50, pg_temp.digest('plan-a'), 2, 'value', 'B', 'value', 'L09')).revision, 3, 'an admin sets only the level');
select results_eq($$select building_set_by, building_set_revision, level_set_by, level_set_revision, updated_by
  from pg_temp.location(pg_temp.digest('plan-a'))$$,
  $$values (pg_temp.fixture(1), 2, pg_temp.fixture(5), 3, pg_temp.fixture(5))$$,
  'the building stays the owner''s, the level is the admin''s');
select pg_temp.sign_in(1);
select results_eq($$select revision, action, building_choice_before, building_before, building_choice, building,
  level_choice_before, level_before, level_choice, level, actor_id
  from public.takeoff_plan_location_events e
  where location_id = (select id from pg_temp.location(pg_temp.digest('plan-a'))) order by revision$$,
  $$values (1, 'created'::text, null::text, null::text, 'value'::text, 'A'::text, null::text, null::text, 'value'::text, 'L00'::text, pg_temp.fixture(1)),
    (2, 'updated'::text, 'value'::text, 'A'::text, 'value'::text, 'B'::text, 'value'::text, 'L00'::text, 'unknown'::text, null::text, pg_temp.fixture(1)),
    (3, 'updated'::text, 'value'::text, 'B'::text, 'value'::text, 'B'::text, 'unknown'::text, null::text, 'value'::text, 'L09'::text, pg_temp.fixture(5))$$,
  'each change is recorded once, with the choices it replaced');
select is((select count(distinct attestation_id) from public.takeoff_plan_location_events
  where location_id = (select id from pg_temp.location(pg_temp.digest('plan-a')))), 3::bigint, 'each on its own attestation');

-- Values the command refuses, and revisions the server does not attest.
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-v'), 0, 'value', ' A', 'reading', null)$$, '22023',
  'TAKEOFF_PLAN_LOCATION_VALUE_INVALID', 'a value with surrounding spaces is refused');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-v'), 0, 'value', repeat('A', 41), 'reading', null)$$, '22023',
  'TAKEOFF_PLAN_LOCATION_VALUE_INVALID', 'a value longer than 40 characters is refused');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-v'), 0, 'reading', null, 'value', E'R+1\n')$$, '22023',
  'TAKEOFF_PLAN_LOCATION_VALUE_INVALID', 'a value with a control character is refused');
select throws_ok($$select pg_temp.save(50, 'not-a-digest', 0, 'value', 'A', 'reading', null)$$, '22023',
  'TAKEOFF_PLAN_LOCATION_ATTESTATION_INVALID', 'a revision is a SHA-256 digest');
select throws_ok($$select pg_temp.save(52, pg_temp.digest('plan-x'), 0, 'value', 'A', 'reading', null)$$, 'P0002',
  'TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND', 'a plan of another affaire cannot be attested for this one');

-- Direct writes are refused to the API roles, whatever they hold.
select throws_ok($$insert into public.takeoff_plan_locations(tenant_id, project_id, source_kind, source_id, content_hash, revision,
  building_choice, building_set_by, building_set_at, building_set_revision, level_choice, level_set_by, level_set_at, level_set_revision,
  plan_file_id, document_name, created_by, updated_by) values (pg_temp.fixture(10), pg_temp.fixture(20), 'plan_file', pg_temp.fixture(50),
  pg_temp.digest('forged'), 1, 'reading', pg_temp.fixture(5), now(), 1, 'reading', pg_temp.fixture(5), now(), 1,
  pg_temp.fixture(50), 'x.pdf', pg_temp.fixture(5), pg_temp.fixture(5))$$, '42501', null,
  'an operator cannot insert an annotation in another member''s name');
select throws_ok($$update public.takeoff_plan_locations set updated_by = pg_temp.fixture(5)$$, '42501', null,
  'an operator cannot rewrite the author');
select throws_ok($$delete from public.takeoff_plan_location_events$$, '42501', null, 'an operator cannot erase the history');

-- A dossier copy: the correction belongs to the piece at these bytes, and survives a new copy of the same bytes.
select is((select (pg_temp.save(51, pg_temp.digest('p-101-a'), 0, 'value', 'A', 'value', 'R+1')).source_kind), 'intake_document',
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
select throws_ok($$select pg_temp.save(51, pg_temp.digest('p-101-a'), 1, 'value', 'A', 'value', 'R+2')$$, '40001',
  'TAKEOFF_PLAN_LOCATION_SOURCE_STALE', 'nothing is written through a copy its piece has replaced');
select results_eq($$select source_kind, source_id, current_copy from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(53))$$,
  $$values ('intake_document'::text, pg_temp.fixture(31), true)$$, 'the new copy names the same piece');
select results_eq($$select (pg_temp.save(53, pg_temp.digest('p-101-a'), 1, 'value', 'A', 'value', 'R+2')).revision,
  (select count(*)::integer from public.takeoff_plan_locations where source_id = pg_temp.fixture(31))$$,
  $$values (2, 1)$$, 'the same bytes through the new copy correct the same annotation, which saw revision 1');

-- Written before the fix: a carried correction was not pinned. The server proposes an origin at its
-- generation; a carried field must hold its value then, and an origin that moved since is a conflict.
insert into location_attestations values ('carried', pg_temp.attest(53, pg_temp.digest('p-101-b'), 20, (select id from pg_temp.location(pg_temp.digest('p-101-a')))));
select is((pg_temp.save(53, pg_temp.digest('p-101-a'), 2, 'value', 'A', 'value', 'R+3')).revision, 3,
  'meanwhile someone changes the origin''s level');
select throws_ok($$select * from public.set_takeoff_plan_location((select id from location_attestations where label = 'carried'), 0,
  'value', 'A', 'value', 'R+2', array['building', 'level'])$$, '40001', 'TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED',
  'the earlier value is not carried from an origin that moved');
select throws_ok($$select pg_temp.save(53, pg_temp.digest('p-101-b'), 0, 'value', 'A', 'value', 'R+9', array['level'], 20,
  (select id from pg_temp.location(pg_temp.digest('p-101-a'))))$$, '22023', 'TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID',
  'a carried field holds the origin''s value');
select throws_ok($$select pg_temp.save(53, pg_temp.digest('p-101-b'), 0, 'value', 'A', 'reading', null, array['building'])$$, '22023',
  'TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID', 'nothing is carried without an origin the server proposed');
select throws_ok($$select pg_temp.attest(53, pg_temp.digest('p-101-b'), 20, pg_temp.fixture(99))$$, '40001',
  'TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED', 'nor from an annotation that does not exist here');
select results_eq($$select building, building_carried, level, level_carried, carried_from_id, carried_from_revision
  from pg_temp.save(53, pg_temp.digest('p-101-b'), 0, 'value', 'A', 'value', 'R+4', array['building'], 20,
    (select id from pg_temp.location(pg_temp.digest('p-101-a'))))$$,
  $$values ('A'::text, true, 'R+4'::text, false, (select id from pg_temp.location(pg_temp.digest('p-101-a'))), 3)$$,
  'carrying one field keeps its origin at the generation proposed, the other typed');
select throws_ok($$select pg_temp.attest(53, pg_temp.digest('p-101-b'), 20, (select id from pg_temp.location(pg_temp.digest('p-101-b'))))$$,
  '22023', 'TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID', 'a revision is not carried over from itself');
select results_eq($$select building_carried, level_carried, carried_from_revision
  from pg_temp.save(53, pg_temp.digest('p-101-b'), 1, 'value', 'A', 'value', 'R+6')$$,
  $$values (true, false, 3)$$, 'a later correction of the other field keeps where the carried one came from');
-- An operator's upload outside the dossier, as the previous application version makes it, still works and is recorded.
select lives_ok($$insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
  values (pg_temp.fixture(55), pg_temp.fixture(10), pg_temp.fixture(40), 'televerse.pdf',
    concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(55), 'televerse.pdf'), 'application/pdf', 8, 1)$$,
  'an operator still uploads a plan file');
select results_eq($$select source_kind, source_id from public.takeoff_plan_location_sources where plan_file_id = pg_temp.fixture(55)$$,
  $$values ('plan_file'::text, pg_temp.fixture(55))$$, 'and its source is recorded under the operator''s session');

-- A reader reads and changes nothing; a non-owner engineer neither reads nor writes; another tenant sees nothing.
select pg_temp.sign_in(3);
select is((select count(*) from public.takeoff_plan_locations where project_id = pg_temp.fixture(20)), 4::bigint,
  'a director reads the affaire''s annotations');
select results_eq($$select can_write from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(50))$$,
  $$values (false)$$, 'a director is told he may not correct');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-a'), 3, 'value', 'C', 'reading', null)$$, '42501',
  'TAKEOFF_PLAN_LOCATION_FORBIDDEN', 'a director cannot correct, even with an attestation');
select pg_temp.sign_in(2);
select is((select count(*) from public.takeoff_plan_locations where project_id = pg_temp.fixture(20)), 0::bigint,
  'an engineer who cannot read the affaire reads none of its annotations');
select is_empty($$select * from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(50))$$,
  'nor the source of its plans');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-a'), 3, 'value', 'C', 'reading', null)$$, '42501',
  'TAKEOFF_PLAN_LOCATION_FORBIDDEN', 'nor corrects them');
select pg_temp.sign_in(4);
select is((select count(*) from public.takeoff_plan_locations), 0::bigint, 'another tenant sees no annotation');
select throws_ok($$select pg_temp.save(50, pg_temp.digest('plan-a'), 3, 'value', 'C', 'reading', null)$$, '42501',
  'TAKEOFF_PLAN_LOCATION_NOT_ATTESTED', 'another tenant holds no attestation of this tenant');
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
  where l.source_id = pg_temp.fixture(31)), 5::bigint, 'and their history');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select source_kind, source_id, current_copy from public.read_takeoff_plan_location_source(pg_temp.fixture(20), pg_temp.fixture(51))$$,
  $$values ('intake_document'::text, pg_temp.fixture(31), false)$$,
  'an analysis that read the removed copy still finds its piece, never as a copy to correct through');
select throws_ok($$select pg_temp.save(51, pg_temp.digest('p-101-a'), 3, 'value', 'A', 'value', 'R+9')$$, '40001',
  'TAKEOFF_PLAN_LOCATION_SOURCE_STALE', 'nothing is written through a removed copy');
reset role;
-- Deleting an affaire takes its annotations, including one carried over from another, and the server's attestations.
select pg_temp.sign_in(1);
insert into public.estimate_projects(id, tenant_id, user_id, name)
values (pg_temp.fixture(22), pg_temp.fixture(10), pg_temp.fixture(1), 'Affaire supprimée (fictif)');
insert into public.plan_sets(id, tenant_id, project_id, name) values (pg_temp.fixture(42), pg_temp.fixture(10), pg_temp.fixture(22), 'Plans');
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.fixture(54), pg_temp.fixture(10), pg_temp.fixture(42), 'plan.pdf',
  concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(42), pg_temp.fixture(54), 'plan.pdf'), 'application/pdf', 8, 1);
set local role authenticated;
select pg_temp.save(54, pg_temp.digest('deleted-a'), 0, 'value', 'A', 'reading', null, '{}', 22);
select pg_temp.save(54, pg_temp.digest('deleted-b'), 0, 'value', 'A', 'reading', null, array['building'], 22,
  (select id from pg_temp.location(pg_temp.digest('deleted-a'))));
reset role;
delete from public.estimate_projects where id = pg_temp.fixture(22);
select is((select count(*) from public.takeoff_plan_locations where project_id = pg_temp.fixture(22)), 0::bigint,
  'deleting the affaire deletes its annotations');
select is((select count(*) from public.takeoff_plan_location_events where project_id = pg_temp.fixture(22)), 0::bigint,
  'and their history');
select is((select count(*) from private.takeoff_plan_location_attestations where project_id = pg_temp.fixture(22)), 0::bigint,
  'and its attestations');

-- Two connections. Their fixtures must be committed to be seen.
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
insert into public.estimate_projects(id, tenant_id, user_id, name) values
  ('b3100000-0000-4000-8000-000000000120', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000101', 'Course (fictif)'),
  ('b3100000-0000-4000-8000-000000000121', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000101', 'Suppression (fictif)');
insert into public.plan_sets(id, tenant_id, project_id, name) values
  ('b3100000-0000-4000-8000-000000000140', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000120', 'Plans'),
  ('b3100000-0000-4000-8000-000000000141', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000121', 'Plans');
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count) values
  ('b3100000-0000-4000-8000-000000000150', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000140', 'course.pdf',
    'b3100000-0000-4000-8000-000000000110/b3100000-0000-4000-8000-000000000140/b3100000-0000-4000-8000-000000000150/course.pdf',
    'application/pdf', 8, 1),
  ('b3100000-0000-4000-8000-000000000152', 'b3100000-0000-4000-8000-000000000110', 'b3100000-0000-4000-8000-000000000141', 'gone.pdf',
    'b3100000-0000-4000-8000-000000000110/b3100000-0000-4000-8000-000000000141/b3100000-0000-4000-8000-000000000152/gone.pdf',
    'application/pdf', 8, 1);
commit;
$setup$), 'COMMIT', 'race fixtures committed');

-- The server's attestation for one member, committed so that their session sees it.
create function pg_temp.race_attest(member text, project text, file text, label text) returns uuid language sql as $$
  select id from extensions.dblink('location_setup', format($sql$select public.attest_takeoff_plan_revision(
    'b3100000-0000-4000-8000-000000000110', %L, %L, %L, %L, 'course.pdf')$sql$, member, project, file, pg_temp.digest(label)))
    as remote(id uuid)
$$;
create function pg_temp.as_operator(session text, member text) returns text language sql as $$
  select extensions.dblink_exec(session, format($sql$begin;
    set local role authenticated;
    set local request.jwt.claim.sub = %1$L;
    set local request.jwt.claims = %2$L;$sql$, member, jsonb_build_object('role', 'authenticated', 'sub', member)::text))
$$;
create function pg_temp.save_call(attestation uuid, expected integer, building text) returns text language sql as $$
  select format($sql$select revision::text || ':' || coalesce(building, '') from public.set_takeoff_plan_location(
    %L, %s, 'value', %L, 'value', 'R+1')$sql$, attestation, expected, building)
$$;
create temp table location_race_pids(label text primary key, pid integer);
-- Whether the session is blocked on a lock another session holds (when a relation is named: waiting for a row of it,
-- whose tuple lock it holds): polled until seen, at most 10 s, never a fixed pause.
create function pg_temp.waits_for_lock(session text, target text default null) returns boolean language plpgsql as $$
declare
  waiter integer := (select pid from location_race_pids where label = session);
begin
  for attempt in 1..1000 loop
    if exists (select 1 from pg_catalog.pg_locks l where l.pid = waiter and not l.granted)
      and (target is null or exists (select 1 from pg_catalog.pg_locks t
        where t.pid = waiter and t.locktype = 'tuple' and t.relation = target::regclass)) then
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

-- Written before the fix: the first correction locked the plan file, then needed the affaire for its
-- foreign key, while a deletion locks the affaire, then cascades to the file: the two deadlocked. The command now takes
-- the affaire first and waits there; the deletion goes through and the correction is told the plan is gone.
create temp table location_race_attestations(label text primary key, id uuid);
insert into location_race_attestations values
  ('gone', pg_temp.race_attest('b3100000-0000-4000-8000-000000000101', 'b3100000-0000-4000-8000-000000000121',
    'b3100000-0000-4000-8000-000000000152', 'gone'));
select is(extensions.dblink_exec('location_setup', $hold$begin;
do $do$ begin perform 1 from public.estimate_projects where id = 'b3100000-0000-4000-8000-000000000121' for update; end $do$;$hold$),
  'DO', 'a deletion holds the affaire');
select is(pg_temp.as_operator('location_b', 'b3100000-0000-4000-8000-000000000101'), 'SET', 'the owner opens a first correction');
select is(extensions.dblink_send_query('location_b', pg_temp.save_call((select id from location_race_attestations where label = 'gone'), 0, 'A')),
  1, 'the owner saves');
select ok(pg_temp.waits_for_lock('location_b', 'public.estimate_projects'), 'the correction waits for the affaire''s row');
select is((select count(*)::integer from pg_catalog.pg_locks where pid = (select pid from location_race_pids where label = 'location_b')
  and relation = 'public.plan_files'::regclass), 0, 'holding nothing on the plan files');
select is(extensions.dblink_exec('location_setup', $delete$delete from public.estimate_projects where id = 'b3100000-0000-4000-8000-000000000121';
commit;$delete$), 'COMMIT', 'the deletion cascades to the plan file and commits: no deadlock');
select throws_ok($$select * from extensions.dblink_get_result('location_b') as remote(value text)$$, 'P0002',
  'TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND', 'the correction is told the plan is gone');
select is((select count(*)::integer from extensions.dblink_get_result('location_b', false) as remote(value text)), 0, 'its save is over');
select is(extensions.dblink_exec('location_b', 'rollback'), 'ROLLBACK', 'and rolled back');

-- Both create the first annotation of the revision: B waits on A's uncommitted row, then gets the conflict.
insert into location_race_attestations
select label, pg_temp.race_attest(member, 'b3100000-0000-4000-8000-000000000120', 'b3100000-0000-4000-8000-000000000150', 'course')
from (values ('a1', 'b3100000-0000-4000-8000-000000000101'), ('b1', 'b3100000-0000-4000-8000-000000000102'),
  ('a2', 'b3100000-0000-4000-8000-000000000101'), ('b2', 'b3100000-0000-4000-8000-000000000102')) as attested(label, member);
select is(pg_temp.as_operator('location_a', 'b3100000-0000-4000-8000-000000000101'), 'SET', 'A opens its save');
select is((select value from extensions.dblink('location_a', pg_temp.save_call((select id from location_race_attestations where label = 'a1'), 0, 'A'))
  as remote(value text)), '1:A', 'A creates revision 1, not yet committed');
select is(pg_temp.as_operator('location_b', 'b3100000-0000-4000-8000-000000000102'), 'SET', 'B opens its save');
select is(extensions.dblink_send_query('location_b', pg_temp.save_call((select id from location_race_attestations where label = 'b1'), 0, 'B')),
  1, 'B saves the same revision');
select ok(pg_temp.waits_for_lock('location_b'), 'B waits for A''s row instead of writing beside it');
select is(extensions.dblink_exec('location_a', 'commit'), 'COMMIT', 'A commits');
select throws_ok($$select * from extensions.dblink_get_result('location_b') as remote(value text)$$, '40001',
  'TAKEOFF_PLAN_LOCATION_CONFLICT', 'B gets a conflict, not a second annotation');
select is((select count(*)::integer from extensions.dblink_get_result('location_b', false) as remote(value text)), 0, 'B''s save is over');
select is(extensions.dblink_exec('location_b', 'rollback'), 'ROLLBACK', 'B''s save is rolled back');

-- Both correct revision 1: the second one waits, then sees revision 2 and is refused. The wait alone would also be seen
-- without the row lock (B's UPDATE would wait for A's row and then overwrite it): what tells a lost update apart is
-- B's 40001 below, the winner A's value and the history holding A's two saves only.
select is(pg_temp.as_operator('location_a', 'b3100000-0000-4000-8000-000000000101'), 'SET', 'A opens a correction');
select is((select value from extensions.dblink('location_a', pg_temp.save_call((select id from location_race_attestations where label = 'a2'), 1, 'C'))
  as remote(value text)), '2:C', 'A makes revision 2, not yet committed');
select is(pg_temp.as_operator('location_b', 'b3100000-0000-4000-8000-000000000102'), 'SET', 'B opens a correction');
select is(extensions.dblink_send_query('location_b', pg_temp.save_call((select id from location_race_attestations where label = 'b2'), 1, 'D')),
  1, 'B corrects the revision it saw');
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
