-- Lot 4, B1 (20261122080845_takeoff_item_answers.sql): the stored answer of each item of a sealed list on a plan.
-- 1. Who may read and write: the readers of the affaire read the answers; nobody writes them but the publication.
-- 2. The publication of a unit under its valid lease: an item missing, foreign or answered twice, a page outside the
--    unit, a coverage that is not exact, an outcome against its rule, an observation against its role, a row of the
--    result that is no contribution's, an invalid lease: each refused with its own code, nothing written.
-- 3. A publication writes the result, its rows (its contributions only), the answers with their observations and the
--    job's end in one transaction; « not found » stores a SQL NULL quantity; what was seen outside the list is a warning;
--    the same publication replayed answers the same and writes nothing; another content or another attempt is refused.
-- 4. The released end of a job (finalize_local_takeoff_result) is refused at its commit for a job whose request sealed a
--    list, and unchanged for every other job.
-- 5. A later reading of the same item on the same plan replaces the earlier one: the readings are numbered, the readers
--    tell the current one, and the earlier job's stamp (what a send compares of a peer) changes; a job without answers
--    keeps the stamp it had.
-- 6. The readers under the affaire's read rule: the items each job was asked about from its sealed order, before any
--    answer (being read), each item's state paged and counted in SQL, and every answer.
-- Isolation justified: rights under RLS, the publication's refusals and its single transaction are not observable from a
-- journey (no screen reads them yet). The two-session cases are in takeoff-item-answers-race.test.sql. All values are
-- fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5300000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.f(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(n))::text, true);
$$;

-- 1. The objects and what the API roles may do with them.
select table_privs_are('public', relation, 'authenticated', array['SELECT'], relation || ': members only read')
from unnest(array['takeoff_item_answers', 'takeoff_item_answer_observations']) as relation;
select table_privs_are('public', relation, 'anon', array[]::text[], relation || ': anonymous clients see nothing')
from unnest(array['takeoff_item_answer_publications', 'takeoff_item_answers', 'takeoff_item_answer_observations']) as relation;
select is(has_column_privilege('authenticated', 'public.takeoff_item_answer_publications', 'attempt_sha256', 'SELECT'), false,
  'members never read the digest of the attempt''s lease');
select is(has_column_privilege('authenticated', 'public.takeoff_item_answer_publications', 'content_sha256', 'SELECT'), true,
  'they read the rest of a publication');
select is(has_table_privilege('authenticated', 'public.takeoff_item_answer_publications', 'INSERT'), false,
  'members write no publication');
select ok((select relrowsecurity from pg_class where oid = format('public.%I', relation)::regclass), relation || ': row level security')
from unnest(array['takeoff_item_answer_publications', 'takeoff_item_answers', 'takeoff_item_answer_observations']) as relation;
select is(has_function_privilege('authenticated',
  'public.publish_takeoff_item_answers(uuid, uuid, timestamptz, text, text, jsonb, integer[], jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
  false, 'a member''s session cannot publish');
select is(has_function_privilege('service_role',
  'public.publish_takeoff_item_answers(uuid, uuid, timestamptz, text, text, jsonb, integer[], jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'),
  true, 'the worker publishes');
select is(has_function_privilege('authenticated', fn, 'EXECUTE'), true, fn || ': a member''s session reads through it')
from unnest(array['public.read_takeoff_item_answers(uuid, uuid, uuid, boolean, uuid, uuid, integer, integer, uuid, uuid)',
  'public.read_takeoff_item_readings(uuid, uuid, uuid, text[], integer, integer)',
  'public.count_takeoff_item_readings(uuid, uuid, uuid)']) as fn;

-- One tenant: the engineer who owns the affaires (1), an engineer who does not (2), a director (3), an admin (4); another
-- tenant's admin (5).
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'item-answers-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 5) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5300000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Réponses de postes (fictif)', 'item-answers-test'),
  (pg_temp.f(11), 'Autre entreprise (fictive)', 'item-answers-other-test');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(2), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(3), 'director', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(4), 'admin', true, '2020-01-01'),
  (pg_temp.f(11), pg_temp.f(5), 'admin', true, '2020-01-01');
-- Affaire 20 reads its plan against its list; 21 reads its plan freely (the first order); 22 has a list of its own.
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(20 + n), pg_temp.f(10), pg_temp.f(1), 'Affaire de postes ' || n || ' (fictive)' from generate_series(0, 2) as n;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select pg_temp.f(30 + n), pg_temp.f(20 + n), pg_temp.f(1), 'ready' from generate_series(0, 2) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select pg_temp.f(60 + n), pg_temp.f(20 + n), pg_temp.f(30 + n), 'confirme', 'Résumé fictif', 'Objet fictif', now(), pg_temp.f(1)
from generate_series(0, 2) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select pg_temp.f(40 + n), pg_temp.f(10), pg_temp.f(20 + n), 'Plans du dossier' from generate_series(0, 2) as n;
-- Affaire 22 uses a registered plan copy from its dossier.
insert into public.affaire_intake_documents (id, upload_id, file_name, upload_status, storage_path, classification_status,
  document_kind, size_bytes) values
  (pg_temp.f(70), pg_temp.f(32), 'plan-1.pdf', 'uploaded', 'fixture/plan-22.pdf', 'classified', 'plans', 8);
insert into storage.objects (bucket_id, name, metadata) values ('affaire-intake', 'fixture/plan-22.pdf', '{"size":8}');
-- One plan per affaire (100 + n), read on its pages 2 and 7.
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count, metadata)
select pg_temp.f(100 + n), pg_temp.f(10), pg_temp.f(40 + n), 'plan-1.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(40 + n), pg_temp.f(100 + n), 'plan-1.pdf'), 'application/pdf', 8, 9,
  case when n = 2 then jsonb_build_object('source', 'affaire-intake', 'intake_document_id', pg_temp.f(70),
    'intake_storage_path', 'fixture/plan-22.pdf') else '{}'::jsonb end
from generate_series(0, 2) as n;

-- The lists: affaire 20 has three items (lavabo 300, vanne 301, baignoire 302) in its revision 310; affaire 22 one item
-- (320) in its revision 330. Written as the list's function stores them (its digest is fictional: the seal compares it).
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by) values
  (pg_temp.f(300), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1)),
  (pg_temp.f(301), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1)),
  (pg_temp.f(302), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1)),
  (pg_temp.f(320), pg_temp.f(10), pg_temp.f(22), 'manual', 1, pg_temp.f(1));
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by) values
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), 1, 'item_added', '{}', 3, repeat('1', 64), repeat('a', 64), pg_temp.f(311), pg_temp.f(1)),
  (pg_temp.f(330), pg_temp.f(10), pg_temp.f(22), 1, 'item_added', '{}', 1, repeat('2', 64), repeat('b', 64), pg_temp.f(331), pg_temp.f(1));
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin) values
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(300), 0, 'manual:lavabo', 'Lavabo (fictif)', 'u', 'manual', '{"kind":"manual"}'),
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(301), 1, 'manual:vanne', 'Vanne DN32 (fictive)', 'u', 'manual', '{"kind":"manual"}'),
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(302), 2, 'manual:baignoire', 'Baignoire (fictive)', 'u', 'manual', '{"kind":"manual"}'),
  (pg_temp.f(330), pg_temp.f(10), pg_temp.f(22), pg_temp.f(320), 0, 'manual:wc', 'WC (fictif)', 'u', 'manual', '{"kind":"manual"}');
set local session_replication_role = origin;

-- The confirmed preparation of an affaire's plan, and the manifest of one unit the server seals for it (dispatcher test).
create function pg_temp.digest(plan uuid) returns text language sql immutable as $$
  select encode(sha256(convert_to(plan::text, 'UTF8')), 'hex')
$$;
create function pg_temp.snapshot(project integer) returns jsonb language sql as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-22T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', f.id, 'document_name', f.file_name, 'kind', 'plan',
          'active', true, 'confirmed', true, 'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count,
          'source_updated_at', f.updated_at, 'content_hash', pg_temp.digest(f.id), 'pages', '[2, 7]'::jsonb))
        from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20))))
$$;
create function pg_temp.list_order(p_revision integer) returns jsonb language sql stable as $$
  select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', r.id, 'revision', r.revision,
    'content_sha256', r.content_sha256, 'item_count', r.item_count)) from public.takeoff_list_revisions r
  where r.id = pg_temp.f(p_revision)
$$;
create function pg_temp.manifest(project integer, order_ jsonb) returns jsonb language sql as $$
  select jsonb_build_object('format_version', 2, 'intent', 'initial', 'order', order_,
    'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
    'units', (select jsonb_agg(jsonb_build_object('key', 'plan:' || f.id, 'ordinal', 1, 'plans', jsonb_build_array(f.id),
      'pages', '[2, 7]'::jsonb, 'page_count', 9, 'vector_pages', 0, 'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)))
      from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)),
    'plans', (select jsonb_agg(jsonb_build_object('entry_key', f.id, 'plan_file_id', f.id, 'name', f.file_name,
      'logical_id', coalesce(f.metadata ->> 'intake_document_id', f.id::text), 'intake_document_id', f.metadata ->> 'intake_document_id', 'generation', 'generation-fictive-1', 'content_sha256', pg_temp.digest(f.id),
      'pages', '[2, 7]'::jsonb, 'page_count', 9)) from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)),
    'coverage', jsonb_build_object('plans_retained', 1, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
    'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))
$$;
create function pg_temp.order_of(project integer) returns jsonb language sql stable as $$
  select case project when 20 then pg_temp.list_order(310) when 22 then pg_temp.list_order(330)
    else '{"kind":"free_extraction","version":1,"list":null}'::jsonb end
$$;
-- The job of an affaire's round: 1000 + 10 * round + n.
create function pg_temp.job(project integer, round integer) returns uuid language sql immutable as $$
  select pg_temp.f(1000 + 10 * round + project - 20)
$$;
create function pg_temp.latest_job(project integer) returns uuid language sql as $$
  select j.id from public.takeoff_jobs j where j.project_id = pg_temp.f(project) order by j.created_at desc, j.id desc limit 1
$$;
create function pg_temp.launch(project integer, round integer) returns table (outcome text, request_id uuid, job_id uuid)
language sql as $$
  select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(project), pg_temp.f(1),
    pg_temp.f(500 + 10 * round + project - 20), case when round = 1 then 'initial' else 'reread_plans' end,
    case when round = 1 then null else pg_temp.latest_job(project) end, pg_temp.host(), pg_temp.selection(),
    pg_temp.manifest(project, pg_temp.order_of(project)), pg_temp.snapshot(project),
    jsonb_build_array(jsonb_build_object('id', pg_temp.job(project, round), 'plan_set_id', pg_temp.f(project + 20),
      'launch_unit_key', 'plan:' || pg_temp.f(100 + project - 20), 'source_file_name', 'plan-1.pdf',
      'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture',
      'execution_host_id', pg_temp.host())),
    pg_temp.f(project + 20), 1, array[pg_temp.f(100 + project - 20)])
$$;
create function pg_temp.claim(job uuid, token integer) returns integer language sql as $$
  select count(*)::integer from public.claim_observed_local_takeoff_job(job, pg_temp.f(10), pg_temp.host(), clock_timestamp(),
    pg_temp.f(token), clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)
$$;
create function pg_temp.confirm(project integer) returns void language sql as $$
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by)
  values (pg_temp.f(10), pg_temp.f(project), 1, pg_temp.snapshot(project) -> 'preparation', pg_temp.snapshot(project), now(),
    pg_temp.f(1), pg_temp.f(1))
$$;
set local session_replication_role = replica;
select pg_temp.confirm(20 + n) from generate_series(0, 2) as n;
set local session_replication_role = origin;

-- The worker's publication: its rows (each a contribution's), its answers, what it saw outside the list, its result.
create function pg_temp.row_(n integer, quantity numeric, page integer, unit text default 'u') returns jsonb language sql immutable as $$
  select jsonb_build_object('id', pg_temp.f(n), 'designation', 'Lavabo (fictif)', 'quantity', quantity, 'unit', unit,
    'confidence', 0.9, 'evidence', 'Symboles LAV fictifs', 'source_file_name', 'plan-1.pdf', 'source_page', page,
    'metadata', '{}'::jsonb)
$$;
create function pg_temp.rows_(round integer) returns jsonb language sql immutable as $$
  select jsonb_build_array(pg_temp.row_(800 + 10 * round + 1, 2, 2), pg_temp.row_(800 + 10 * round + 2, 1, 7))
$$;
create function pg_temp.observation(role text, page integer, quantity numeric, unit text, item integer default null,
  chunk text default 'f1-b1') returns jsonb language sql immutable as $$
  select jsonb_build_object('page', page, 'evidence', 'Symboles LAV fictifs', 'method', 'symbol_count', 'confidence', 0.9,
    'quantity', quantity, 'unit', unit, 'measurement_basis', null, 'role', role, 'source', 'model', 'chunk_id', chunk,
    'vector_key', null, 'takeoff_item_id', case when item is null then null else pg_temp.f(item) end)
$$;
-- The lavabo measured (2 on page 2 and 1 on page 7, each a row of the result; page 7 read again by the second fragment,
-- an alternative); the valve uncertain (its page 7 unreadable, a candidate value, a vector reading of its page 2); the
-- bathtub not found.
create function pg_temp.answers(round integer) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.f(300), 'outcome', 'measured', 'reasons', '[]'::jsonb,
      'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'quantity', jsonb_build_object('value', 3, 'unit', 'u'),
      'candidate', null, 'observations', jsonb_build_array(
        pg_temp.observation('contribution', 2, 2, 'u', 800 + 10 * round + 1),
        pg_temp.observation('contribution', 7, 1, 'u', 800 + 10 * round + 2),
        pg_temp.observation('alternative', 7, 1, 'u', null, 'f2-b1'))),
    jsonb_build_object('item_id', pg_temp.f(301), 'outcome', 'uncertain',
      'reasons', jsonb_build_array(
        jsonb_build_object('code', 'QUALIFIER_UNREADABLE', 'by', 'model', 'text', 'Le diamètre est illisible (fictif).',
          'chunk_id', 'f1-b1'),
        jsonb_build_object('code', 'PAGES_UNREADABLE', 'by', 'worker', 'text', null, 'chunk_id', null)),
      'searched_pages', '[2]'::jsonb, 'unreadable_pages', '[7]'::jsonb, 'quantity', null,
      'candidate', jsonb_build_object('value', 1, 'unit', 'u'), 'observations', jsonb_build_array(
        pg_temp.observation('candidate', 2, 1, 'u'),
        jsonb_build_object('page', 2, 'evidence', 'Réseau EF fictif', 'method', 'vector_reading', 'confidence', 0.7,
          'quantity', 4.5, 'unit', 'm', 'role', 'candidate', 'source', 'vector', 'vector_key', pg_temp.f(861 + 10 * round)))),
    jsonb_build_object('item_id', pg_temp.f(302), 'outcome', 'not_found',
      'reasons', jsonb_build_array(jsonb_build_object('code', 'NO_INDICATION', 'by', 'model', 'text', 'Aucun indice (fictif).',
        'chunk_id', 'f1-b1')),
      'searched_pages', '[7, 2]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'observations', '[]'::jsonb))
$$;
create function pg_temp.valid(round integer default 1) returns jsonb language sql immutable as $$
  select pg_temp.answers(round)
$$;
create function pg_temp.findings() returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('page', 2, 'designation', 'Chauffe-eau (fictif)', 'evidence', 'Symbole CE fictif',
    'chunk_id', 'f1-b1'))
$$;
-- The vector reading of page 2 as today's vector reading writes it (its page, one excluded row and its geometry, no
-- choice of source): the row the valve's vector observation names.
create function pg_temp.vector(round integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('pages', jsonb_build_array(jsonb_build_object('id', pg_temp.f(860 + 10 * round),
      'plan_file_id', pg_temp.f(100), 'source_file_name', 'plan-1.pdf', 'source_page', 2, 'reading', '{}'::jsonb,
      'schema_version', 1, 'rule_anchors', null)),
    'items', jsonb_build_array(jsonb_build_object('id', pg_temp.f(861 + 10 * round), 'designation', 'Réseau EF (fictif)',
      'quantity', 4.5, 'unit', 'm', 'confidence', 0.7, 'evidence', 'Réseau EF fictif', 'source_file_name', 'plan-1.pdf',
      'source_page', 2, 'is_excluded', true, 'exclusion_reason', 'Lecture vectorielle (fictive).', 'metadata', '{}'::jsonb,
      'rules_stale', false)),
    'geometries', jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.f(861 + 10 * round),
      'vector_page_id', pg_temp.f(860 + 10 * round), 'geometry', '{"kind":"network"}'::jsonb, 'schema_version', 1)),
    'choices', '[]'::jsonb)
$$;
-- The result, with a POSTE_HORS_LISTE warning for each finding, as the reading writes it.
create function pg_temp.result_(findings jsonb default '[]'::jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', coalesce((select jsonb_agg(jsonb_build_object(
      'code', 'POSTE_HORS_LISTE', 'severity', 'info', 'message', 'Page ' || (f ->> 'page') || ' : ' || (f ->> 'designation')))
      from jsonb_array_elements(findings) f), '[]'::jsonb), 'tables', '[]'::jsonb,
    'provider_meta', '{}'::jsonb, 'confidence', null, 'token_count', 10, 'cost_cents', 0, 'duration_ms', 5,
    'job_duration_ms', 6, 'run_metrics', '[]'::jsonb)
$$;
create function pg_temp.publish(job uuid, token integer, answers jsonb, items jsonb, vector jsonb default pg_temp.vector(1),
  pages integer[] default array[2, 7], findings jsonb default pg_temp.findings(), result jsonb default null)
returns table (result_id uuid, replayed boolean, answer_count integer) language sql as $$
  select * from public.publish_takeoff_item_answers(job, pg_temp.f(token), '2026-11-22T09:00:00Z', 'modele-fictif',
    'takeoff-c-postes-v1', '{"schema_version": "v2", "prompt_version": "takeoff-c-postes-v1"}'::jsonb, pages, answers, findings,
    coalesce(result, pg_temp.result_(findings)), items, vector)
$$;
-- The released end of a job, then the commit's check of this transaction, as a commit runs it.
create function pg_temp.finalize_and_commit_check(job uuid, token integer, items jsonb) returns uuid language plpgsql as $$
declare
  result uuid;
begin
  result := public.finalize_local_takeoff_result(job, pg_temp.f(10), pg_temp.f(token), '2026-11-22T09:00:00Z', 'modele-fictif',
    'fixture', pg_temp.result_(), items, null);
  set constraints zz_require_takeoff_item_answers immediate;
  set constraints zz_require_takeoff_item_answers deferred;
  return result;
end;
$$;
create function pg_temp.states(project integer) returns setof text language sql as $$
  select r.state from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(project)) r order by r.item_position
$$;

-- Every activation, the second measuring order's included.
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 minute');

-- 4 (first half). A job of the free extraction (affaire 21) ends through the released path, as before.
select results_eq($$select outcome from pg_temp.launch(21, 1)$$, $$values ('admitted'::text)$$, 'a free extraction is admitted');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(21, 1), 'its plan is handed');
select is(pg_temp.claim(pg_temp.job(21, 1), 921), 1, 'and claimed');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(21, 1), 921, pg_temp.valid(), pg_temp.rows_(1))$$, '22023',
  'TAKEOFF_ANSWERS_ORDER_INVALID', 'a job of the free extraction has no answers to publish');
-- What takeoff_rule_job_stamp gave before this migration (20261120204437_takeoff_jobs_by_affaire.sql), for comparison.
create function pg_temp.former_stamp(p_job_id uuid) returns text language sql stable as $$
  select md5(jsonb_build_array(j.id, j.status, j.preparation_snapshot,
    (select jsonb_agg(jsonb_build_array(i.id, i.updated_at, i.rules_stale_at, i.designation, i.quantity, i.unit,
        i.metadata, i.source_file_name, i.source_page, i.is_excluded, i.is_verified, i.quantity_entry_category) order by i.id)
      from public.takeoff_items i where i.job_id = j.id and i.tenant_id = j.tenant_id),
    (select jsonb_agg(jsonb_build_array(p.id, p.plan_file_id, p.source_file_name, p.source_page, p.reading, p.rule_anchors) order by p.id)
      from public.takeoff_vector_pages p where p.job_id = j.id and p.tenant_id = j.tenant_id),
    (select jsonb_agg(jsonb_build_array(g.takeoff_item_id, g.vector_page_id, g.geometry - 'transform') order by g.takeoff_item_id)
      from public.takeoff_item_geometries g where g.job_id = j.id and g.tenant_id = j.tenant_id)
  )::text)
  from public.takeoff_jobs j where j.id = p_job_id
$$;
select isnt(pg_temp.finalize_and_commit_check(pg_temp.job(21, 1), 921, jsonb_build_array(pg_temp.row_(890, 4, 2))), null::uuid,
  'the released end of a free extraction is written and passes its commit''s check');
select results_eq($$select status::text, analysis_outcome::text from public.takeoff_jobs where id = pg_temp.job(21, 1)$$,
  $$values ('completed'::text, 'success'::text)$$, 'it ended as a success');
select is(public.takeoff_rule_job_stamp(pg_temp.f(10), pg_temp.f(21), pg_temp.job(21, 1)), pg_temp.former_stamp(pg_temp.job(21, 1)),
  'a job without answers keeps the stamp it had');
select is((select count(*)::integer from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(21))), 0,
  'an affaire without a list has no item to read (as the owner reads it below, so does the service role: none)');

-- 6 (first part). Before any request, every item of affaire 20 is to measure; once its plan is asked and read, it is being
-- read, though no answer exists yet.
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select * from pg_temp.states(20)$$, $$values ('to_measure'::text), ('to_measure'), ('to_measure')$$,
  'before any request, every item is to measure');
reset role;
select results_eq($$select outcome from pg_temp.launch(20, 1)$$, $$values ('admitted'::text)$$, 'a reading against the list is admitted');
select is((select item_list_revision_id from public.takeoff_launch_requests where id = (select launch_request_id
  from public.takeoff_jobs where id = pg_temp.job(20, 1))), pg_temp.f(310), 'its request sealed the list');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select * from pg_temp.states(20)$$, $$values ('reading'::text), ('reading'), ('reading')$$,
  'once asked, each item of the sealed list is being read, before any answer');
select results_eq($$select r.expected, r.in_flight, r.readings #>> '{0,unit_state}', r.readings #>> '{0,job_id}',
    r.readings -> 0 -> 'answer', r.readings #>> '{0,plan_name}', r.readings #>> '{0,plan_generation}'
  from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20)) r where r.item_id = pg_temp.f(300)$$,
  $$values (1, 1, 'queued'::text, pg_temp.job(20, 1)::text, 'null'::jsonb, 'plan-1.pdf'::text, 'generation-fictive-1'::text)$$,
  'its reading names the plan, its generation, the job asked and its unit''s state, without an answer');
reset role;
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(20, 1), 'its plan is handed');
select is(pg_temp.claim(pg_temp.job(20, 1), 901), 1, 'and claimed under lease 901');

-- 4 (second half). The released end of that job, at its commit: refused, nothing kept.
select throws_ok($$select pg_temp.finalize_and_commit_check(pg_temp.job(20, 1), 901, pg_temp.rows_(1))$$, '22023',
  'TAKEOFF_ANSWERS_REQUIRED', 'the released end of a job reading against a list is refused at its commit');
select results_eq($$select status::text, processing_lease_token from public.takeoff_jobs where id = pg_temp.job(20, 1)$$,
  $$values ('processing'::text, pg_temp.f(901))$$, 'the job is still read under its lease');

-- 2. Refusals: each has its code and writes nothing.
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, jsonb_set(pg_temp.valid(), '{0,observations,0,method}',
  '"Symboles"'), pg_temp.rows_(1))$$, '22023', 'TAKEOFF_ANSWERS_INVALID', 'an answer out of shape is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1), pages => array[2])$$,
  '22023', 'TAKEOFF_ANSWERS_UNIT_PAGES_MISMATCH', 'pages other than the unit''s sealed pages are refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid() - 2, pg_temp.rows_(1))$$, '22023',
  'TAKEOFF_ANSWERS_ITEM_MISSING', 'an item of the list without its answer is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  pg_temp.valid() || jsonb_build_array(jsonb_set(pg_temp.valid() -> 2, '{item_id}', to_jsonb(pg_temp.f(320)))), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_ITEM_FOREIGN', 'an answer for an item of another affaire''s list is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, jsonb_set(pg_temp.valid(), '{1}', pg_temp.valid() -> 2),
  pg_temp.rows_(1))$$, '22023', 'TAKEOFF_ANSWERS_ITEM_DUPLICATE', 'two answers for one item are refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{2,searched_pages}', '[2, 3, 7]'), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_PAGE_OUTSIDE', 'a page outside the unit''s pages is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{1,observations,0,page}', '4'), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_PAGE_OUTSIDE', 'an observation outside the unit''s pages is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1),
  findings => jsonb_set(pg_temp.findings(), '{0,page}', '5'))$$,
  '22023', 'TAKEOFF_ANSWERS_PAGE_OUTSIDE', 'a finding outside the unit''s pages is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{2,searched_pages}', '[2]'), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_COVERAGE_INCOMPLETE', 'an answer that did not account for every page is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{0,quantity,value}', '4'), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_MEASURED_INVALID', 'a measured quantity that is not the sum of its contributions is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(jsonb_set(pg_temp.valid(), '{0,observations,0,role}', '"candidate"'), '{0,observations,1,role}',
    '"candidate"') #- '{0,observations,0,takeoff_item_id}' #- '{0,observations,1,takeoff_item_id}',
  '[]'::jsonb)$$, '22023', 'TAKEOFF_ANSWERS_MEASURED_INVALID', 'a measured answer without a contribution is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(jsonb_set(pg_temp.valid(), '{0,unreadable_pages}', '[7]'), '{0,searched_pages}', '[2, 7]'), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_MEASURED_INVALID', 'a measure on a plan with an unreadable page is refused (it is uncertain)');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{2,quantity}', '{"value": 1, "unit": "u"}'), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_NOT_FOUND_INVALID', 'an absence with a quantity is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{2,observations}', jsonb_build_array(pg_temp.observation('candidate', 2, null, null))),
  pg_temp.rows_(1))$$, '22023', 'TAKEOFF_ANSWERS_NOT_FOUND_INVALID', 'an absence with an observation is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, jsonb_set(pg_temp.valid(), '{2,reasons}', '[]'),
  pg_temp.rows_(1))$$, '22023', 'TAKEOFF_ANSWERS_NOT_FOUND_INVALID', 'an absence without its reason is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, jsonb_set(pg_temp.valid(), '{1,reasons}', '[]'),
  pg_temp.rows_(1))$$, '22023', 'TAKEOFF_ANSWERS_UNCERTAIN_INVALID', 'an uncertain answer without a reason is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{1,quantity}', '{"value": 1, "unit": "u"}'), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_UNCERTAIN_INVALID', 'an uncertain answer with a measured quantity is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1),
  jsonb_set(pg_temp.vector(1), '{items,0,is_excluded}', 'false'))$$,
  '22023', 'TAKEOFF_ANSWERS_VECTOR_ROWS_INVALID', 'a vector reading written as a countable row is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1),
  jsonb_set(pg_temp.vector(1), '{choices}', jsonb_build_array(jsonb_build_object('id', pg_temp.f(871)))))$$,
  '22023', 'TAKEOFF_ANSWERS_VECTOR_ROWS_INVALID', 'a vector reading selected as a source is refused');
-- Today's end keeps a failed vector reading to itself (here a geometry of a row it does not write): the publication does
-- not, and writes nothing.
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1),
  jsonb_set(pg_temp.vector(1), '{geometries,0,takeoff_item_id}', to_jsonb(pg_temp.f(869))))$$,
  '22023', 'TAKEOFF_ANSWERS_VECTOR_ROWS_INVALID', 'an observation never names a vector row that was not written');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{1,observations,1,page}', '7'), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'a vector observation on another page than its row is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{0,observations,2,takeoff_item_id}', to_jsonb(pg_temp.f(813))),
  pg_temp.rows_(1) || jsonb_build_array(pg_temp.row_(813, 1, 7)))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'an alternative written as a row of the result is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{1,observations,1,role}', '"contribution"'), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'a vector reading is never a contribution');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(pg_temp.valid(), '{1,observations,1,vector_key}', to_jsonb(pg_temp.f(869))), pg_temp.rows_(1))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'a vector observation naming no vector row of the publication is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  jsonb_set(jsonb_set(pg_temp.valid(), '{1,observations,0,role}', '"contribution"'), '{1,observations,0,takeoff_item_id}',
    to_jsonb(pg_temp.f(813))), pg_temp.rows_(1) || jsonb_build_array(pg_temp.row_(813, 1, 2)))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'an answer that is not measured counts nothing: no contribution');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901,
  pg_temp.valid() #- '{0,observations,0,takeoff_item_id}' #- '{0,observations,1,takeoff_item_id}', '[]'::jsonb)$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'a contribution without its row of the result is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(),
  pg_temp.rows_(1) || jsonb_build_array(pg_temp.row_(899, 1, 2)))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'a row of the result that is no contribution''s is refused');
-- A contribution is counted by today's readers only if its row is: an excluded row (given so, or excluded on insert as
-- an estimate by the hypothesis rule) would be a measure nobody counts.
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(),
  jsonb_set(jsonb_set(pg_temp.rows_(1), '{0,is_excluded}', 'true'), '{0,exclusion_reason}', '"Écartée (fictif)."'))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'a contribution whose row is excluded is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(),
  jsonb_set(pg_temp.rows_(1), '{0,metadata}', '{"quantity_nature": "estimated"}'))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'a contribution whose row the hypothesis rule would exclude is refused');
-- The row as the writer stores it decides, not the JSON as given: a boolean written as a string is still excluded, and
-- a category the writer does not store does not save an estimate from the hypothesis rule.
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(),
  jsonb_set(jsonb_set(pg_temp.rows_(1), '{0,is_excluded}', '"true"'), '{0,exclusion_reason}', '"Écartée (fictif)."'))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'a contribution whose row is excluded by a string flag is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(),
  jsonb_set(jsonb_set(pg_temp.rows_(1), '{0,metadata}', '{"quantity_nature": "estimated"}'), '{0,quantity_entry_category}',
    '"site_survey"'))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'an estimate with a category the writer does not store is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(),
  jsonb_set(pg_temp.rows_(1), '{1,quantity}', '2'))$$,
  '22023', 'TAKEOFF_ANSWERS_OBSERVATION_INVALID', 'a row with another quantity than its contribution is refused');
select is((select count(*)::integer from public.takeoff_results where job_id = pg_temp.job(20, 1)), 0,
  'no refusal left a result');
select is((select count(*)::integer from public.takeoff_item_answers where job_id = pg_temp.job(20, 1)), 0, 'nor an answer');
-- A process that does not hold the lease, or whose lease lapsed, is refused and writes nothing.
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 999, pg_temp.valid(), pg_temp.rows_(1))$$, '55000',
  'TAKEOFF_ANSWERS_LEASE_INVALID', 'another lease is refused');
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second' where id = pg_temp.job(20, 1);
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1))$$, '55000',
  'TAKEOFF_ANSWERS_LEASE_INVALID', 'a lapsed lease is refused');
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() + interval '30 minutes' where id = pg_temp.job(20, 1);

-- 3. The publication.
create temp table published as select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1));
select results_eq($$select replayed, answer_count from published$$, $$values (false, 3)$$, 'the unit is published: three answers');
select results_eq($$select status::text, analysis_outcome::text, processing_lease_token from public.takeoff_jobs
  where id = pg_temp.job(20, 1)$$, $$values ('completed'::text, 'success'::text, null::uuid)$$,
  'and the job ended with it, its lease given back');
select lives_ok($$set constraints zz_require_takeoff_item_answers immediate$$, 'its end passes the commit''s check');
set constraints zz_require_takeoff_item_answers deferred;
select is((select result_id from published), (select id from public.takeoff_results where job_id = pg_temp.job(20, 1)),
  'the answer names the result written');
select results_eq($$select a.item_id, a.outcome, a.quantity, a.unit, a.candidate_quantity, a.candidate_unit, a.searched_pages,
    a.unreadable_pages, a.reason_code, a.observation_count, a.contribution_count, a.reading_revision, a.replaces_answer_id
  from public.takeoff_item_answers a where a.job_id = pg_temp.job(20, 1) order by a.item_id$$,
  $$values (pg_temp.f(300), 'measured'::text, 3::numeric, 'u'::text, null::numeric, null::text, array[2, 7], array[]::integer[],
      null::text, 3, 2, 1, null::uuid),
    (pg_temp.f(301), 'uncertain'::text, null::numeric, null::text, 1::numeric, 'u'::text, array[2], array[7],
      'QUALIFIER_UNREADABLE'::text, 2, 0, 1, null::uuid),
    (pg_temp.f(302), 'not_found'::text, null::numeric, null::text, null::numeric, null::text, array[2, 7], array[]::integer[],
      'NO_INDICATION'::text, 0, 0, 1, null::uuid)$$,
  'one answer per item: measured with its total, uncertain with a candidate value, not found without any quantity (null, never 0)');
select results_eq($$select jsonb_array_length(reasons), reasons #>> '{1,code}', reasons #>> '{1,by}' from public.takeoff_item_answers
  where job_id = pg_temp.job(20, 1) and item_id = pg_temp.f(301)$$, $$values (2, 'PAGES_UNREADABLE'::text, 'worker'::text)$$,
  'the reasons keep their order, the model''s then the worker''s');
select results_eq($$select a.list_revision_id, a.plan_file_id, a.plan_logical_id, a.plan_generation, a.plan_content_sha256
  from public.takeoff_item_answers a where a.job_id = pg_temp.job(20, 1) and a.item_id = pg_temp.f(302)$$,
  $$values (pg_temp.f(310), pg_temp.f(100), pg_temp.f(100), 'generation-fictive-1'::text, pg_temp.digest(pg_temp.f(100)))$$,
  'an answer names the sealed list and the plan as the request sealed them');
select results_eq($$select o.role, o.source, o.ordinal, o.takeoff_item_id, o.page, o.quantity, o.unit, o.vector_item_id, o.chunk_id
  from public.takeoff_item_answer_observations o join public.takeoff_item_answers a on a.id = o.answer_id
  where a.job_id = pg_temp.job(20, 1) order by a.item_id, o.ordinal$$,
  $$values ('contribution'::text, 'model'::text, 1, pg_temp.f(811), 2, 2::numeric, 'u'::text, null::uuid, 'f1-b1'::text),
    ('contribution'::text, 'model'::text, 2, pg_temp.f(812), 7, 1::numeric, 'u'::text, null::uuid, 'f1-b1'::text),
    ('alternative'::text, 'model'::text, 3, null::uuid, 7, 1::numeric, 'u'::text, null::uuid, 'f2-b1'::text),
    ('candidate'::text, 'model'::text, 1, null::uuid, 2, 1::numeric, 'u'::text, null::uuid, 'f1-b1'::text),
    ('candidate'::text, 'vector'::text, 2, null::uuid, 2, 4.5::numeric, 'm'::text, pg_temp.f(871), null::text)$$,
  'each observation with its role; the vector one names the vector reading''s row written with it');
select results_eq($$select id, quantity, source_page from public.takeoff_items where job_id = pg_temp.job(20, 1)
  and not is_excluded order by id$$, $$values (pg_temp.f(811), 2::numeric, 2), (pg_temp.f(812), 1::numeric, 7)$$,
  'the job''s countable rows are its contributions only: no reader of takeoff_items counts an alternative or a candidate');
select results_eq($$select i.id, i.is_excluded, g.vector_page_id from public.takeoff_items i
  join public.takeoff_item_geometries g on g.takeoff_item_id = i.id where i.job_id = pg_temp.job(20, 1)$$,
  $$values (pg_temp.f(871), true, pg_temp.f(870))$$, 'the vector reading''s row is written excluded, with its geometry and page');
select results_eq($$select w ->> 'code', w ->> 'severity', w ->> 'message'
  from public.takeoff_results r cross join jsonb_array_elements(r.warnings) w where r.job_id = pg_temp.job(20, 1)$$,
  $$values ('POSTE_HORS_LISTE'::text, 'info'::text, 'Page 2 : Chauffe-eau (fictif)'::text)$$,
  'what the reading saw outside the list is a warning of the result, never an item');
select results_eq($$select unlisted_findings #>> '{0,designation}', pages, exchange_version, prompt_version
  from public.takeoff_item_answer_publications where job_id = pg_temp.job(20, 1)$$,
  $$values ('Chauffe-eau (fictif)'::text, array[2, 7], 'v2'::text, 'takeoff-c-postes-v1'::text)$$,
  'and is kept with the publication, with the pages read and the versions of the exchange');
-- A replay of the same publication by the same attempt answers the same, writing nothing.
select results_eq($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1))$$,
  $$select result_id, true, answer_count from published$$, 'the same publication again answers the same, replayed');
select is((select count(*)::integer from public.takeoff_item_answers where job_id = pg_temp.job(20, 1)), 3, 'and writes nothing');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1), findings => '[]')$$,
  '23505', 'TAKEOFF_ANSWERS_ALREADY_PUBLISHED', 'another content from the same attempt (here without its finding) is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(20, 1), 902, pg_temp.valid(), pg_temp.rows_(1))$$,
  '55000', 'TAKEOFF_ANSWERS_LEASE_INVALID', 'another attempt is refused');

-- Nobody writes a fact directly.
set local role service_role;
select throws_ok($$update public.takeoff_item_answers set reasons = '[]' where job_id = pg_temp.job(20, 1)$$,
  '42501', 'TAKEOFF_ANSWERS_IMMUTABLE', 'an answer is never changed');
select throws_ok($$update public.takeoff_item_answers set replaces_answer_id = null where job_id = pg_temp.job(20, 1)$$,
  '42501', 'TAKEOFF_ANSWERS_IMMUTABLE', 'nor its link to the reading it replaces, unless that reading is deleted');
select throws_ok($$delete from public.takeoff_item_answers where job_id = pg_temp.job(20, 1)$$, '42501',
  'TAKEOFF_ANSWERS_WRITER_REQUIRED', 'the server deletes no answer directly');
select throws_ok($$insert into public.takeoff_item_answer_observations (answer_id, tenant_id, project_id, job_id, ordinal, role,
  source, page, evidence, confidence, method, occurrence_coverage) select a.id, a.tenant_id, a.project_id, a.job_id, 9,
  'candidate', 'model', 2, 'Ajout (fictif)', 0.5, 'other', 'page_total' from public.takeoff_item_answers a
  where a.job_id = pg_temp.job(20, 1) limit 1$$, '42501', 'TAKEOFF_ANSWERS_WRITER_REQUIRED', 'nor adds an observation');
select throws_ok($$update public.takeoff_item_answer_publications set answer_count = 4 where job_id = pg_temp.job(20, 1)$$,
  '42501', 'TAKEOFF_ANSWERS_IMMUTABLE', 'nor changes a publication');
reset role;

-- 6. Readers, under the affaire's own rule.
select pg_temp.sign_in(1);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_item_answers), 3, 'the affaire''s owner reads its answers');
select is((select count(*)::integer from public.takeoff_item_answer_observations), 5, 'and their observations');
select results_eq($$select * from pg_temp.states(20)$$, $$values ('measured'::text), ('uncertain'), ('not_found')$$,
  'each item''s state from its answers');
select results_eq($$select state, items from public.count_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20))$$,
  $$values ('measured'::text, 1), ('not_found'::text, 1), ('uncertain'::text, 1)$$, 'the counts the filters need');
select results_eq($$select item_id, matching_items from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20), null,
  array['uncertain', 'not_found'])$$, $$values (pg_temp.f(301), 2), (pg_temp.f(302), 2)$$, 'a filter of states, in SQL');
select results_eq($$select item_id, matching_items from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20), null, null,
  1, 1)$$, $$values (pg_temp.f(301), 3)$$, 'a page of one item from an offset, with the number of items that match');
select results_eq($$select r.readings #>> '{0,unit_state}', r.readings #>> '{0,reading}', r.readings #>> '{0,answer,outcome}',
    r.readings #>> '{0,answer,reason_text}', (r.readings #>> '{0,answer,candidate_quantity}')::numeric,
    jsonb_array_length(r.readings #> '{0,answer,observations}'), r.readings #>> '{0,answer,revision}'
  from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20)) r where r.item_id = pg_temp.f(301)$$,
  $$select 'succeeded'::text, 'answered'::text, 'uncertain'::text, 'Le diamètre est illisible (fictif).'::text, 1::numeric, 2,
    content_sha256 from public.takeoff_item_answers where job_id = pg_temp.job(20, 1) and item_id = pg_temp.f(301)$$,
  'the reading gives the answer with its primary reason, its candidate value, its observations and its revision');
select results_eq($$select r.readings #>> '{0,answer,observations,0,takeoff_item_id}', r.readings #>> '{0,answer,observations,2,role}'
  from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20)) r where r.item_id = pg_temp.f(300)$$,
  $$values (pg_temp.f(811)::text, 'alternative'::text)$$, 'a contribution names its row of the result');
select results_eq($$select * from pg_temp.states(20) limit 1$$, $$select state from public.read_takeoff_item_readings(pg_temp.f(10),
  pg_temp.f(20), pg_temp.f(100)) limit 1$$, 'the same on the scope of its one plan');
select is((select count(*)::integer from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20), pg_temp.f(101))
  where expected > 0), 0, 'on a plan never asked, nothing was read');
select throws_ok($$insert into public.takeoff_item_answers (tenant_id, project_id, job_id, list_revision_id, item_id, plan_file_id,
  plan_logical_id, plan_content_sha256, outcome, searched_pages, unreadable_pages, reasons, reason_code, observation_count,
  contribution_count, reading_revision, content_sha256) values (pg_temp.f(10), pg_temp.f(20), pg_temp.job(20, 1), pg_temp.f(310),
  pg_temp.f(300), pg_temp.f(100), pg_temp.f(100), repeat('0', 64), 'not_found', '{2}', '{}', '[{"code":"X","by":"model"}]', 'X',
  0, 0, 9, repeat('0', 64))$$, '42501', null, 'no member writes an answer');
reset role;
select pg_temp.sign_in(3);
set local role authenticated;
select is((select count(*)::integer from public.read_takeoff_item_answers(pg_temp.f(10), pg_temp.f(20))), 3, 'a director reads them');
reset role;
select pg_temp.sign_in(4);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_item_answers), 3, 'an administrator reads them');
reset role;
select pg_temp.sign_in(2);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_item_answers), 0, 'an engineer who does not own the affaire reads none');
select is((select count(*)::integer from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20))), 0,
  'nor through the readers');
select is((select count(*)::integer from public.count_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20))), 0, 'nor their counts');
reset role;
select pg_temp.sign_in(5);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_item_answer_observations), 0, 'another tenant reads nothing');
select is((select count(*)::integer from public.read_takeoff_item_answers(pg_temp.f(10), pg_temp.f(20))), 0,
  'nor through a reader, naming the affaire');
reset role;
-- A member who left the tenant reads nothing any more.
delete from public.tenant_memberships where tenant_id = pg_temp.f(10) and user_id = pg_temp.f(3);
select pg_temp.sign_in(3);
set local role authenticated;
select is((select count(*)::integer from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20))), 0,
  'a former member reads nothing');
reset role;

-- 5. A second reading of the plan (the next request of the affaire) replaces the first one, item by item.
create temp table stamp_before as select public.takeoff_rule_job_stamp(pg_temp.f(10), pg_temp.f(20), pg_temp.job(20, 1)) as stamp;
select results_eq($$select outcome from pg_temp.launch(20, 2)$$, $$values ('admitted'::text)$$, 'a second reading is admitted');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(20, 2), 'its plan is handed');
select is(pg_temp.claim(pg_temp.job(20, 2), 903), 1, 'and claimed');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select r.state, r.readings #>> '{0,unit_state}', r.readings #>> '{0,job_id}', r.readings #>> '{0,answer,job_id}'
  from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20)) r where r.item_id = pg_temp.f(300)$$,
  $$values ('reading'::text, 'running'::text, pg_temp.job(20, 2)::text, pg_temp.job(20, 1)::text)$$,
  'while it is read, the item is being read again, its earlier answer still given');
reset role;
select results_eq($$select replayed, answer_count from pg_temp.publish(pg_temp.job(20, 2), 903, pg_temp.valid(2), pg_temp.rows_(2),
  pg_temp.vector(2), findings => jsonb_set(pg_temp.findings(), '{0,designation}', '"  CHAUFFE-EAU (fictif)"')
    || '[{"page":7,"designation":"Chauffe-eau (fictif)","evidence":"Second repère CE fictif","chunk_id":"f1-b1"}]'::jsonb)$$,
  $$values (false, 3)$$, 'it is published');
select results_eq($$select n.item_id, n.reading_revision, n.replaces_answer_id = o.id
  from public.takeoff_item_answers n join public.takeoff_item_answers o on o.item_id = n.item_id and o.job_id = pg_temp.job(20, 1)
  where n.job_id = pg_temp.job(20, 2) order by n.item_id$$,
  $$values (pg_temp.f(300), 2, true), (pg_temp.f(301), 2, true), (pg_temp.f(302), 2, true)$$,
  'each answer replaces the first reading of its item on that plan');
select isnt(public.takeoff_rule_job_stamp(pg_temp.f(10), pg_temp.f(20), pg_temp.job(20, 1)), (select stamp from stamp_before),
  'the first job''s stamp changed: its readings were replaced');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select answer ->> 'job_id', count(*)::integer from public.read_takeoff_item_answers(pg_temp.f(10), pg_temp.f(20),
  null, true) group by 1$$, $$values (pg_temp.job(20, 2)::text, 3)$$, 'the current readings are the second job''s');
select results_eq($$select answer ->> 'job_id', bool_or(is_current) from public.read_takeoff_item_answers(pg_temp.f(10), pg_temp.f(20))
  group by 1 order by 1$$, $$values (pg_temp.job(20, 1)::text, false), (pg_temp.job(20, 2)::text, true)$$,
  'the first job''s readings stay readable, no longer current');
select results_eq($$select answer_id from public.read_takeoff_item_answers(pg_temp.f(10), pg_temp.f(20), null, false, null, null, null, 2)$$,
  $$select id from public.takeoff_item_answers where item_id = pg_temp.f(300) order by reading_revision$$,
  'a page of two answers, in item, plan and reading order');
select results_eq($$select answer_id from public.read_takeoff_item_answers(pg_temp.f(10), pg_temp.f(20), null, false, pg_temp.f(300),
  pg_temp.f(100), 2, 1)$$, $$select id from public.takeoff_item_answers where item_id = pg_temp.f(301) and reading_revision = 1$$,
  'the next page starts after the last answer read');
select results_eq($$select * from pg_temp.states(20)$$, $$values ('measured'::text), ('uncertain'), ('not_found')$$,
  'the items take the second reading''s state');
select results_eq($$select answer_id, is_current, jsonb_array_length(answer -> 'observations')
  from public.read_takeoff_item_answers(pg_temp.f(10), pg_temp.f(20), p_answer_id => (select id from public.takeoff_item_answers
    where job_id = pg_temp.job(20, 1) and item_id = pg_temp.f(300)))$$,
  $$select id, false, 3 from public.takeoff_item_answers where job_id = pg_temp.job(20, 1) and item_id = pg_temp.f(300)$$,
  'a replaced answer is read by its id, with its own evidence');
select results_eq($$select item_id, answer ->> 'job_id' from public.read_takeoff_item_answers(pg_temp.f(10), pg_temp.f(20),
  p_takeoff_item_id => pg_temp.f(812))$$, $$values (pg_temp.f(300), pg_temp.job(20, 1)::text)$$,
  'a takeoff_items row leads to the item and the answer it contributes to');
select is((select count(*)::integer from public.read_takeoff_item_answers(pg_temp.f(10), pg_temp.f(20),
  p_takeoff_item_id => pg_temp.f(871))), 0, 'a vector row is no contribution: it leads to no answer through this link');
reset role;

-- TI-734: two publications of the same plan and the member's decision about its finding.
select is(public.takeoff_find_designation_key(U&'  R\00C9seau\0009  d''eau  '), 'reseau d''eau',
  'accents, case and runs of whitespace compare equal');
select isnt(public.takeoff_find_designation_key('CE-01'), public.takeoff_find_designation_key('CE 01'),
  'punctuation and digits keep distinct designations distinct');
select ok(not has_function_privilege('authenticated', 'public.takeoff_find_designation_key(text)', 'execute')
  and has_function_privilege('service_role', 'public.takeoff_find_designation_key(text)', 'execute'),
  'members read the stored key and only the service can call the normalizer among API roles');
select table_privs_are('public', 'takeoff_find_decisions', 'authenticated', array['SELECT'],
  'members only read decisions directly');
create function pg_temp.dismiss(actor integer, job_round integer, reason text, decision integer) returns uuid
language sql as $$
  select public.dismiss_takeoff_find(pg_temp.f(10), pg_temp.f(20), pg_temp.f(actor), pg_temp.job(20, job_round),
    0, pg_temp.f(decision), reason, null)
$$;
select throws_ok($$select pg_temp.dismiss(2, 1, 'outside_scope', 951)$$, '42501', 'TAKEOFF_ITEM_LIST_FORBIDDEN',
  'a member who cannot edit the list cannot dismiss');
select throws_ok($$select pg_temp.dismiss(1, 1, 'other', 951)$$, '22023', 'TAKEOFF_FIND_REASON_INVALID',
  'Other requires the member’s explanation');
select is(pg_temp.dismiss(1, 1, 'retained_existing', 951), pg_temp.f(951), 'the owner dismisses');
select is(pg_temp.dismiss(1, 1, 'retained_existing', 951), pg_temp.f(951), 'the same click replays');
set local role service_role;
select throws_ok($$update public.takeoff_find_decisions set reason = 'outside_scope'$$, '42501',
  'TAKEOFF_ITEM_LIST_WRITER_REQUIRED', 'the service role also needs the decision command');
reset role;
select throws_ok($$select pg_temp.dismiss(1, 2, 'outside_scope', 952)$$, '23505', 'TAKEOFF_FIND_ALREADY_DECIDED',
  'a second publication of the same find cannot acquire another active decision');
select pg_temp.sign_in(4);
set local role authenticated;
select results_eq($$select page, evidence, decided_by, reason from public.takeoff_find_decisions$$,
  $$values (2, 'Symbole CE fictif'::text, pg_temp.f(1), 'retained_existing'::text)$$,
  'another member with access reads the evidence and the decision');
reset role;
-- Restore the director who left earlier. The plan is readable only while a job attests its file.
insert into public.tenant_memberships (tenant_id,user_id,role,is_default,created_at) values
  (pg_temp.f(10),pg_temp.f(3),'director',true,'2020-01-01');
select pg_temp.sign_in(3);
set local role authenticated;
select is((select count(*)::int from public.takeoff_find_decisions), 1, 'a read-only member sees the decision on the attested plan');
reset role;
select pg_temp.sign_in(5);
set local role authenticated;
select is((select count(*)::int from public.takeoff_find_decisions), 0, 'another tenant sees no decisions');
reset role;
select lives_ok($$select public.undo_takeoff_find_dismissal(pg_temp.f(10), pg_temp.f(20), pg_temp.f(4), pg_temp.f(951))$$,
  'another list writer can undo that particular dismissal');

-- Complete the existing publication fixture's registry as a production list revision would.
insert into public.takeoff_list_item_sources(tenant_id, project_id, source_key, item_id, kind, accepted_in_revision, accepted_by)
select tenant_id, project_id, source_key, item_id, 'origin', 1, pg_temp.f(1)
from public.takeoff_list_revision_entries where revision_id = pg_temp.f(310);

-- The revision and its find links form one transaction, using the ordinary manual origin.
create function pg_temp.add_finds(refs jsonb, intent integer) returns table (revision integer, replayed boolean)
language sql as $$
  select r.revision, r.replayed from public.add_takeoff_finds_to_list(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
    1, pg_temp.f(intent), repeat('d', 64),
    (select jsonb_agg(to_jsonb(e) - array['revision_id','tenant_id','project_id','position','origin_kind'] order by position)
      from public.takeoff_list_revision_entries e where revision_id = pg_temp.f(310))
      || jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(950), 'source_key', 'manual:ce', 'label',
        'Chauffe-eau (fictif)', 'expected_unit', 'u', 'origin', jsonb_build_object('kind','manual',
        'addedBy',pg_temp.f(1),'addedInRevision',2)), jsonb_build_object('item_id', pg_temp.f(954),
        'source_key','manual:ce-2','label','Chauffe-eau (fictif)','expected_unit','u','origin',
        jsonb_build_object('kind','manual','addedBy',pg_temp.f(1),'addedInRevision',2))), refs) r
$$;
create function pg_temp.ref(finding integer) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('job_id',pg_temp.job(20, 2),'finding_index',0,'item_id',pg_temp.f(950)),
    jsonb_build_object('job_id',pg_temp.job(20, 2),'finding_index',finding,'item_id',pg_temp.f(954)))
$$;
select throws_ok($$select * from pg_temp.add_finds(pg_temp.ref(2), 955)$$,'22023','TAKEOFF_FIND_INVALID',
  'an index outside the actual publication cannot supply a finding');
select is((select max(revision) from public.takeoff_list_revisions where project_id = pg_temp.f(20)), 1,
  'the invalid source rolls back the list revision too');
select results_eq($$select * from pg_temp.add_finds(pg_temp.ref(1), 955)$$,$$values (2,false)$$,
  'two finds with the same designation on different pages of one reading enter one revision');
select results_eq($$select * from pg_temp.add_finds(pg_temp.ref(1), 955)$$,$$values (2,true)$$,
  'a repeated addition returns its revision');
select results_eq($$select item_id, page from public.takeoff_find_decisions where undone_at is null order by page$$,
  $$values (pg_temp.f(950),2), (pg_temp.f(954),7)$$, 'each new item keeps its own source');
select throws_ok($$select pg_temp.dismiss(1, 1, 'outside_scope', 953)$$,'23505','TAKEOFF_FIND_ALREADY_DECIDED',
  'an addition also consumes the same find in another reading');
select is((select count(*)::int from public.takeoff_items where job_id = pg_temp.job(20, 2) and not is_excluded), 2,
  'adding a find creates no quantity');
-- 7. Deleting what the answers hang on: a job whose readings a later one replaced (its rows, its vector row and its
-- observations go with it), then the whole affaire. Every foreign key is checked, as a commit checks them.
create function pg_temp.delete_and_check(statement text) returns void language plpgsql as $$
begin
  execute statement;
  set constraints all immediate;
  set constraints all deferred;
end;
$$;
select lives_ok($$select pg_temp.delete_and_check(format('delete from public.takeoff_jobs where id = %L', pg_temp.job(20, 1)))$$,
  'a job with published answers is deleted with them');
select results_eq($$select count(*)::integer, count(replaces_answer_id)::integer from public.takeoff_item_answers
  where project_id = pg_temp.f(20)$$, $$values (3, 0)$$, 'the later readings stay, without their link to the deleted ones');
-- Remove the remaining attestation, observe the director's real RLS, then restore the publication
-- for the existing project-deletion test.
savepoint without_plan_jobs;
delete from public.takeoff_jobs where id = pg_temp.job(20, 2);
select pg_temp.sign_in(3);
set local role authenticated;
select exists(select 1 from public.takeoff_list_revisions where project_id = pg_temp.f(20)) as still_reads_affaire,
  (select count(*)::int from public.plan_files where id = pg_temp.f(100)) as readable_files,
  (select count(*)::int from public.takeoff_find_decisions) as readable_decisions \gset
rollback to without_plan_jobs;
select ok(:'still_reads_affaire'::boolean and :readable_files = 0 and :readable_decisions = 0,
  'after the last attesting job disappears, the director still reads the affaire but no decision about the plan');
select lives_ok($$select pg_temp.delete_and_check(format('delete from public.estimate_projects where id = %L', pg_temp.f(20)))$$,
  'an affaire with published answers is deleted with them');
select is((select count(*)::integer from public.takeoff_item_answer_observations where project_id = pg_temp.f(20)), 0,
  'nothing of its answers is left');

-- A dossier plan stays readable through its original piece after its only attesting job disappears.
select results_eq($$select outcome from pg_temp.launch(22, 1)$$, $$values ('admitted'::text)$$, 'a dossier plan is admitted');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(22, 1), 'its copy is dispatched');
select is(pg_temp.claim(pg_temp.job(22, 1), 981), 1, 'its copy is claimed');
select is((select answer_count from pg_temp.publish(pg_temp.job(22, 1), 981,
  jsonb_build_array(jsonb_set(pg_temp.valid() -> 2, '{item_id}', to_jsonb(pg_temp.f(320)))), '[]', null)), 1,
  'the publication records a finding on the dossier plan');
set local role service_role;
select is(public.dismiss_takeoff_find(pg_temp.f(10), pg_temp.f(22), pg_temp.f(1), pg_temp.job(22, 1), 0,
  pg_temp.f(982), 'outside_scope'), pg_temp.f(982), 'the owner dismisses the dossier finding');
reset role;
select pg_temp.sign_in(3);
set local role authenticated;
select decided_at as original_decision_time from public.takeoff_find_decisions where id = pg_temp.f(982) \gset
reset role;
delete from public.takeoff_jobs where id = pg_temp.job(22, 1);
set local role authenticated;
select ok(exists(select 1 from public.affaire_intake_documents where project_id = pg_temp.f(22) and id = pg_temp.f(70))
  and not exists(select 1 from public.plan_files where id = pg_temp.f(102)),
  'the director still reads the original dossier piece after losing access to the copy');
select results_eq($$select decided_by, decided_at, reason, evidence from public.takeoff_find_decisions
  where id = pg_temp.f(982)$$, format('values (%L::uuid, %L::timestamptz, %L::text, %L::text)',
    pg_temp.f(1), :'original_decision_time', 'outside_scope', 'Symbole CE fictif'),
  'the director retains the original author, date, reason and evidence through the dossier piece');
reset role;

select * from finish();
rollback;
