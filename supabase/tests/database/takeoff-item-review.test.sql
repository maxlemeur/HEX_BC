-- Lot 4, B2 (…_takeoff_item_review_decisions.sql): the review of the table of items.
-- 1. Who may read and write: the readers of the affaire read the decisions, the entries and the journal; only the
--    affaire's takeoff operator reviews, through public.review_takeoff_items, in the member's own session; nobody
--    writes the relations directly.
-- 2. The state of an item from its readings (private.takeoff_item_state), on the vectors its TypeScript twin
--    (src/lib/takeoff/item-answer-aggregation.ts) runs: item-answer-aggregation.test.ts reads them here, keep one vector
--    per line in the form below. B1's states function gives the same states through it.
-- 3. The table's readers: the items in the scope, filtered, ordered with the decisions to take first, paged from the
--    item in focus, counted per facet; one item named alone.
-- 4. The command: an acceptance writes the decisions and verifies the measured answers' positive rows in the member's
--    name; a set aside excludes them with its reason, a reinstatement gives back what they were; an entry keeps the value
--    before; an hypothesis entered counts once included. A stale selection (an answer replaced, a decision or an entry
--    moved, a rule that no longer holds) writes nothing and names its items; the same command under its key answers the
--    same; another under the key is a conflict; a malformed command is refused.
-- Isolation justified: the rights under RLS, the compare-and-set and the effects on takeoff_items in one transaction are
-- the database's own guarantees, which a journey sees only in part. The two-session case is in
-- takeoff-item-review-race.test.sql. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5500000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.f(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(n))::text, true);
$$;
-- One tenant: the engineer who owns the affaires (1), an engineer who does not (2), a director (3), an admin (4); another
-- tenant's admin (5).
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'item-review-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 5) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5500000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Revue de postes (fictif)', 'item-review-test'),
  (pg_temp.f(11), 'Autre entreprise (fictive)', 'item-review-other-test');
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
-- One plan per affaire (100 + n), read on its pages 2 and 7.
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(100 + n), pg_temp.f(10), pg_temp.f(40 + n), 'plan-1.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(40 + n), pg_temp.f(100 + n), 'plan-1.pdf'), 'application/pdf', 8, 9
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
    'plans', (select jsonb_agg(jsonb_build_object('entry_key', f.id, 'plan_file_id', f.id, 'name', f.file_name, 'logical_id', f.id,
      'intake_document_id', null, 'generation', 'generation-fictive-1', 'content_sha256', pg_temp.digest(f.id),
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


-- 2. The state rule, on the vectors its TypeScript twin runs.
create temporary table item_state_vectors (
  position integer primary key, label text, expected integer, answered integer, in_flight integer, uncertain integer,
  measured integer, state text
);
insert into item_state_vectors values
  (1, 'no plan asked', 0, 0, 0, 0, 0, 'to_measure'),
  (2, 'one plan read, measured', 1, 1, 0, 0, 1, 'measured'),
  (3, 'two plans read, one uncertain', 2, 2, 0, 1, 1, 'uncertain'),
  (4, 'two plans read, nothing found', 2, 2, 0, 0, 0, 'not_found'),
  (5, 'one plan read, one still read', 2, 1, 1, 0, 1, 'reading'),
  (6, 'nothing found on one plan, the other queued', 2, 1, 1, 0, 0, 'reading'),
  (7, 'one plan read, the other ended without an answer', 2, 1, 0, 0, 1, 'incomplete'),
  (8, 'no plan answered, none still read', 2, 0, 0, 0, 0, 'failed'),
  (9, 'one plan ended without an answer, the other still read', 2, 0, 1, 0, 0, 'reading'),
  (10, 'three plans read, measured and not found', 3, 3, 0, 0, 2, 'measured');
select is(private.takeoff_item_state(v.expected, v.answered, v.in_flight, v.uncertain, v.measured), v.state,
  'vector ' || v.position || ': ' || v.label)
from item_state_vectors v order by v.position;

-- 1. The objects and what the API roles may do with them.
select table_privs_are('public', relation, 'authenticated', array['SELECT'], relation || ': members only read')
from unnest(array['takeoff_item_answer_decisions', 'takeoff_item_entries', 'takeoff_item_review_events']) as relation;
select table_privs_are('public', 'takeoff_item_review_commands', 'authenticated', array[]::text[],
  'members read no command receipt');
select table_privs_are('public', relation, 'anon', array[]::text[], relation || ': anonymous clients see nothing')
from unnest(array['takeoff_item_review_commands', 'takeoff_item_answer_decisions', 'takeoff_item_entries',
  'takeoff_item_review_events']) as relation;
select ok((select relrowsecurity from pg_class where oid = format('public.%I', relation)::regclass), relation || ': row level security')
from unnest(array['takeoff_item_review_commands', 'takeoff_item_answer_decisions', 'takeoff_item_entries',
  'takeoff_item_review_events']) as relation;
select is(has_function_privilege('authenticated', fn, 'EXECUTE'), true, fn || ': a member''s session calls it')
from unnest(array['public.review_takeoff_items(uuid, uuid, jsonb)', 'public.count_takeoff_item_table(uuid, uuid, uuid)',
  'public.read_takeoff_item_table(uuid, uuid, uuid, text[], text[], text[], text[], uuid[], uuid, integer, integer)']) as fn;
select is(has_function_privilege('anon', 'public.review_takeoff_items(uuid, uuid, jsonb)', 'EXECUTE'), false,
  'an anonymous client cannot review');
select is(has_function_privilege('authenticated', 'private.takeoff_item_state(integer, integer, integer, integer, integer)',
  'EXECUTE'), false, 'the private helpers are no member''s');

-- A reading against the list, published: the lavabo measured (rows 811, 812), the valve uncertain, the bathtub not found.
select results_eq($$select outcome from pg_temp.launch(20, 1)$$, $$values ('admitted'::text)$$, 'a reading against the list is admitted');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(20, 1), 'its plan is handed');
select is(pg_temp.claim(pg_temp.job(20, 1), 901), 1, 'and claimed');
select results_eq($$select replayed, answer_count from pg_temp.publish(pg_temp.job(20, 1), 901, pg_temp.valid(), pg_temp.rows_(1))$$,
  $$values (false, 3)$$, 'and published');
-- The server evaluated the rules of its rows (none fails), as it does after a reading.
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb
where job_id = pg_temp.job(20, 1);
-- A location set by an operator on the plan: building A, level RDC.
insert into public.takeoff_plan_locations (tenant_id, project_id, source_kind, source_id, content_hash, revision,
  building_choice, building, building_set_by, building_set_at, building_set_revision, level_choice, level, level_set_by,
  level_set_at, level_set_revision, plan_file_id, document_name, created_by, updated_by)
values (pg_temp.f(10), pg_temp.f(20), 'plan_file', pg_temp.f(100), pg_temp.digest(pg_temp.f(100)), 1, 'value', 'A', pg_temp.f(1), now(),
  1, 'value', 'RDC', pg_temp.f(1), now(), 1, pg_temp.f(100), 'plan-1.pdf', pg_temp.f(1), pg_temp.f(1));

create function pg_temp.answer(item integer) returns uuid language sql stable as $$
  select a.id from public.takeoff_item_answers a where a.item_id = pg_temp.f(item) order by a.reading_revision desc limit 1
$$;
-- A command on these items as they are now (every current answer with its decision's revision, the scope's entry's
-- revision), applied to those named, with the gesture's own fields.
create function pg_temp.target(item integer) returns jsonb language sql stable as $$
  select jsonb_build_object('item_id', pg_temp.f(item),
    'entry_revision', coalesce((select e.revision from public.takeoff_item_entries e where e.item_id = pg_temp.f(item)
      and e.plan_logical_id is null), 0),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('answer_id', a.id, 'decision_revision', coalesce(d.revision, 0),
        'entry_revision', coalesce(pe.revision, 0)))
      from public.takeoff_item_answers a left join public.takeoff_item_answer_decisions d on d.answer_id = a.id
      left join public.takeoff_item_entries pe on pe.item_id = a.item_id and pe.plan_logical_id = a.plan_logical_id
      where a.id = pg_temp.answer(item)), '[]'::jsonb))
$$;
create function pg_temp.cmd(gesture text, key integer, items integer[], apply integer[], extra jsonb default '{}'::jsonb)
returns jsonb language sql stable as $$
  select jsonb_build_object('command_version', 1, 'intent_key', pg_temp.f(key), 'gesture', gesture,
    'scope', '{"kind":"affaire"}'::jsonb,
    'targets', (select jsonb_agg(pg_temp.target(i) order by i) from unnest(items) i),
    'apply', coalesce((select jsonb_agg(pg_temp.f(i) order by i) from unnest(apply) i), '[]'::jsonb),
    'skipped', '[]'::jsonb) || extra
$$;
create function pg_temp.review(command jsonb) returns jsonb language sql as $$
  select public.review_takeoff_items(pg_temp.f(10), pg_temp.f(20), command)
$$;
create function pg_temp.table_(plan uuid default null, states text[] default null, families text[] default null,
  locations text[] default null, decisions text[] default null, focus uuid default null, size integer default 50)
returns table (item uuid, state text, decision text, matching integer, start integer, focused boolean, family text)
language sql as $$
  select t.item_id, t.state, t.decision, t.matching_items, t.page_offset, t.focus_found, t.family
  from public.read_takeoff_item_table(pg_temp.f(10), pg_temp.f(20), plan, states, families, locations, decisions, null, focus, 0, size) t
$$;

-- 2 (end). B1's states function gives the same states through the rule.
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select state from public.read_takeoff_item_readings(pg_temp.f(10), pg_temp.f(20)) order by item_position$$,
  $$values ('measured'::text), ('uncertain'), ('not_found')$$, 'B1''s reader, through the rule: measured, uncertain, not found');

-- 3. The readers.
select results_eq($$select item, state, decision, matching from pg_temp.table_()$$,
  $$values (pg_temp.f(300), 'measured'::text, 'pending'::text, 3), (pg_temp.f(301), 'uncertain', 'pending', 3),
    (pg_temp.f(302), 'not_found', 'pending', 3)$$, 'every item of the list, in its order, each waiting for a decision');
select results_eq($$select t.label, t.expected_unit, t.origin_kind, t.dpgf_reference, t.expected, t.answered,
    t.readings #>> '{0,plan_name}', t.readings #>> '{0,location_label}', t.readings #>> '{0,location_key}',
    t.readings #>> '{0,answer,outcome}', t.readings #>> '{0,decision_revision}', t.readings -> 0 -> 'decision', t.entry
  from public.read_takeoff_item_table(pg_temp.f(10), pg_temp.f(20)) t where t.item_id = pg_temp.f(300)$$,
  $$values ('Lavabo (fictif)'::text, 'u'::text, 'manual'::text, null::text, 1, 1, 'plan-1.pdf'::text, 'A · RDC'::text, 'A|RDC'::text,
    'measured'::text, '0'::text, 'null'::jsonb, null::jsonb)$$,
  'a line carries its facts, its plan with its location, the answer and no decision yet');
select results_eq($$select item from pg_temp.table_(states => array['uncertain', 'not_found'])$$,
  $$values (pg_temp.f(301)), (pg_temp.f(302))$$, 'filtered by state');
select results_eq($$select item from pg_temp.table_(locations => array['A|RDC'])$$,
  $$values (pg_temp.f(300)), (pg_temp.f(301)), (pg_temp.f(302))$$, 'filtered by the location of a plan they were read on');
select is((select count(*)::integer from pg_temp.table_(locations => array['B|R+1'])), 0, 'another location holds none');
select is((select count(*)::integer from pg_temp.table_(families => array['Robinetterie'])), 0,
  'an unknown family holds none (these items have no section)');
select results_eq($$select item, start, focused from pg_temp.table_(focus => pg_temp.f(302), size => 2)$$,
  $$values (pg_temp.f(302), 2, true)$$, 'the item in focus brings its page');
select results_eq($$select item from pg_temp.table_(plan => pg_temp.f(100), states => array['measured'])$$,
  $$values (pg_temp.f(300))$$, 'in a plan''s scope, the item''s answer on it');
select results_eq($$select t.item_id from public.read_takeoff_item_table(pg_temp.f(10), pg_temp.f(20),
    p_item_ids => array[pg_temp.f(301)]) t$$, $$values (pg_temp.f(301))$$, 'one item named alone');
select results_eq($$select facet, value, label, items from public.count_takeoff_item_table(pg_temp.f(10), pg_temp.f(20))
  order by facet, value$$,
  $$values ('decision'::text, 'pending'::text, null::text, 3), ('location', 'A|RDC', 'A · RDC', 3),
    ('plan', pg_temp.f(100)::text, 'plan-1.pdf', 3), ('state', 'measured', null, 1), ('state', 'not_found', null, 1),
    ('state', 'uncertain', null, 1)$$, 'the facets, counted before any filter');
select pg_temp.sign_in(3);
select is((select count(*)::integer from pg_temp.table_()), 3, 'a director reads the table');
select pg_temp.sign_in(5);
select is((select count(*)::integer from pg_temp.table_()), 0, 'another tenant''s admin reads nothing');
select is((select count(*)::integer from public.count_takeoff_item_table(pg_temp.f(10), pg_temp.f(20))), 0, 'nor its facets');

-- 3b. What keeps a measured answer's positive row out of the bulk acceptance (private.takeoff_item_row_anomalies) and
--     when the total of its parts needs a look against its DPGF reference (private.takeoff_item_total, then
--     private.takeoff_quantity_requires_review). The planner (itemAnswerAnomalies, itemPartsTotal and
--     compareQuantityPairs, src/lib/takeoff/) runs these same vectors, read in this file: the gaps give the parts, never
--     their sum.
reset role;
create temp table acceptance_vectors as select * from jsonb_to_recordset($vectors$[
  {"position": 1, "label": "a clean row", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": []},
  {"position": 2, "label": "an estimated quantity", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {"quantity_nature": "estimated"}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": ["hypothesis"]},
  {"position": 3, "label": "an entry by hypothesis", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": "hypothesis", "unit": "u", "expected_unit": "u", "anomalies": ["hypothesis"]},
  {"position": 4, "label": "a confidence below the threshold", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.4, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": ["low_confidence"]},
  {"position": 5, "label": "a confidence at the threshold", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.5, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": []},
  {"position": 6, "label": "no confidence", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": null, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": []},
  {"position": 7, "label": "a blank proof", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": " \n\t ", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": ["missing_evidence"]},
  {"position": 8, "label": "no page", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": null, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": ["missing_evidence"]},
  {"position": 9, "label": "a page 0", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 0, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": ["missing_evidence"]},
  {"position": 10, "label": "a row the reader cannot read", "outcome": "measured", "reason_code": null, "row_found": false, "is_excluded": null, "rules_stale": null, "rule_results": null, "confidence": null, "threshold": 0.5, "evidence": null, "source_page": null, "metadata": null, "entry_category": null, "unit": null, "expected_unit": "u", "anomalies": ["missing_evidence"]},
  {"position": 11, "label": "a failing rule", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [{"rule": "scale", "status": "pass"}, {"rule": "dn_network", "status": "fail"}], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": ["rule_failed"]},
  {"position": 12, "label": "rules that pass", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [{"rule": "scale", "status": "pass"}], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": []},
  {"position": 13, "label": "rules waiting for the server", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": true, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": ["rules_stale"]},
  {"position": 14, "label": "an excluded row", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": true, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": ["alert"]},
  {"position": 15, "label": "a remark of the reading", "outcome": "measured", "reason_code": "DUPLICATE_READING", "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "u", "expected_unit": "u", "anomalies": ["alert"]},
  {"position": 16, "label": "another unit than the item's", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "ml", "expected_unit": "u", "anomalies": ["unit_mismatch"]},
  {"position": 17, "label": "the same unit written otherwise", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "M2", "expected_unit": "m²", "anomalies": []},
  {"position": 18, "label": "an accented unit", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "Unité", "expected_unit": "unite", "anomalies": []},
  {"position": 19, "label": "an item without a unit", "outcome": "measured", "reason_code": null, "row_found": true, "is_excluded": false, "rules_stale": false, "rule_results": [], "confidence": 0.9, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "ml", "expected_unit": null, "anomalies": []},
  {"position": 20, "label": "several at once, in order", "outcome": "measured", "reason_code": "VECTOR_ONLY", "row_found": true, "is_excluded": true, "rules_stale": true, "rule_results": [], "confidence": 0.2, "threshold": 0.5, "evidence": "Symboles relevés", "source_page": 2, "metadata": {}, "entry_category": null, "unit": "ml", "expected_unit": "u", "anomalies": ["low_confidence", "rules_stale", "alert", "unit_mismatch"]}
]$vectors$::jsonb) as v(position integer, label text, outcome text, reason_code text, row_found boolean, is_excluded boolean,
  rules_stale boolean, rule_results jsonb, confidence numeric, threshold numeric, evidence text, source_page integer,
  metadata jsonb, entry_category text, unit text, expected_unit text, anomalies text[]);
select is(private.takeoff_item_row_anomalies(v.outcome, v.reason_code, v.row_found, v.is_excluded, v.rules_stale,
    v.rule_results, v.confidence, v.threshold, v.evidence, v.source_page, v.metadata, v.entry_category, v.unit, v.expected_unit),
  v.anomalies, format('acceptance vector %s: %s', v.position, v.label))
from acceptance_vectors v order by v.position;
create temp table gap_vectors as select * from jsonb_to_recordset($gaps$[
  {"position": 1, "reference": 10, "parts": [12], "review": true},
  {"position": 2, "reference": 10, "parts": [10.1], "review": false},
  {"position": 3, "reference": 100, "parts": [101.01], "review": true},
  {"position": 4, "reference": 10, "parts": [9], "review": true},
  {"position": 5, "reference": 3, "parts": [2, 1], "review": false},
  {"position": 6, "reference": 0, "parts": [1], "review": true},
  {"position": 7, "reference": 0, "parts": [0], "review": false},
  {"position": 8, "reference": 10, "parts": [10, 0.0333336, 0.0333336, 0.0333326], "review": true},
  {"position": 9, "reference": 2.9702995, "parts": [2, 1.0000025], "review": true},
  {"position": 10, "reference": 2.9702995, "parts": [2, 1.0000024], "review": false},
  {"position": 11, "reference": 10, "parts": [5.0000004, 5.0000004, 0.1], "review": false}
]$gaps$::jsonb) as v(position integer, reference numeric, parts jsonb, review boolean);
select is(private.takeoff_quantity_requires_review(v.reference,
    private.takeoff_item_total(array(select part::numeric from jsonb_array_elements_text(v.parts) as parts(part)))), v.review,
  format('gap vector %s: %s against %s', v.position, v.parts, v.reference))
from gap_vectors v order by v.position;
select pg_temp.sign_in(5);
set local role authenticated;

-- 4. The command. Who may review: the affaire's takeoff operator only, in an active tenant: a member whose tenants are
-- all suspended has no current tenant (current_tenant_id() is null, so is the scope's predicate), and is refused.
reset role;
update public.tenants set is_active = false
where id in (select m.tenant_id from public.tenant_memberships m where m.user_id = pg_temp.f(1));
select pg_temp.sign_in(1);
set local role authenticated;
select is(public.current_tenant_id(), null::uuid, 'the owner of the affaire has no active tenant');
select throws_ok($$select pg_temp.review(pg_temp.cmd('accept_measured', 632, array[300], array[300]))$$, '42501',
  'TAKEOFF_ITEM_REVIEW_FORBIDDEN', 'a member of a suspended tenant is refused');
select is((select count(*)::integer from pg_temp.table_()), 0, 'and reads nothing');
select is((select count(*)::integer from public.count_takeoff_item_table(pg_temp.f(10), pg_temp.f(20))), 0, 'nor its facets');
reset role;
update public.tenants set is_active = true
where id in (select m.tenant_id from public.tenant_memberships m where m.user_id = pg_temp.f(1));
select is((select count(*)::integer from public.takeoff_item_review_commands) + (select count(*)::integer
  from public.takeoff_item_answer_decisions), 0, 'nothing written');
set local role authenticated;
select pg_temp.sign_in(3);
select throws_ok($$select pg_temp.review(pg_temp.cmd('accept_measured', 600, array[300], array[300]))$$, '42501',
  'TAKEOFF_ITEM_REVIEW_FORBIDDEN', 'a director reads but does not review');
select pg_temp.sign_in(2);
select throws_ok($$select pg_temp.review(pg_temp.cmd('accept_measured', 600, array[300], array[300]))$$, '42501',
  'TAKEOFF_ITEM_REVIEW_FORBIDDEN', 'nor does an engineer who does not own the affaire');
select pg_temp.sign_in(5);
select throws_ok($$select pg_temp.review(pg_temp.cmd('accept_measured', 600, array[300], array[300]))$$, '42501',
  'TAKEOFF_ITEM_REVIEW_FORBIDDEN', 'nor another tenant''s admin');
select throws_ok($$insert into public.takeoff_item_answer_decisions (answer_id, tenant_id, project_id, item_id, plan_logical_id,
    kind, revision, actor_id, decided_at, command_id)
  values (pg_temp.answer(300), pg_temp.f(10), pg_temp.f(20), pg_temp.f(300), pg_temp.f(100), 'accepted', 1, pg_temp.f(1), now(),
    pg_temp.f(1))$$, '42501', null, 'a member writes no decision directly');
reset role;
set local role service_role;
select throws_ok($$insert into public.takeoff_item_entries (tenant_id, project_id, item_id, quantity, unit, category, included,
    revision, actor_id, entered_at, command_id)
  values (pg_temp.f(10), pg_temp.f(20), pg_temp.f(302), 1, 'u', 'site_survey', true, 1, pg_temp.f(1), now(), pg_temp.f(1))$$,
  '42501', 'TAKEOFF_ITEM_REVIEW_WRITER_REQUIRED', 'nor does the service role');
reset role;

select pg_temp.sign_in(1);
set local role authenticated;
-- A malformed command.
select throws_ok($$select pg_temp.review(pg_temp.cmd('force', 601, array[300], array[300]))$$, '22023',
  'TAKEOFF_ITEM_REVIEW_INVALID', 'no gesture forces');
select throws_ok($$select pg_temp.review(pg_temp.cmd('set_aside', 601, array[302], array[302], '{"reason":"other"}'))$$, '22023',
  'TAKEOFF_ITEM_REVIEW_INVALID', '« Autre » needs its note');
select throws_ok($$select pg_temp.review(pg_temp.cmd('accept_measured', 601, array[300], array[301]))$$, '22023',
  'TAKEOFF_ITEM_REVIEW_INVALID', 'an item applied must be one of the targets');
select throws_ok($$select pg_temp.review(pg_temp.cmd('enter_quantity', 601, array[302], array[302],
    '{"values":[], "entry":{"category":"site_survey"}}'))$$, '22023', 'TAKEOFF_ITEM_REVIEW_INVALID',
  'an entry has a value for each item applied');

-- A stale selection writes nothing and names its items: a decision revision that moved, an answer not current.
select is(pg_temp.review(jsonb_set(pg_temp.cmd('accept_measured', 602, array[300, 302], array[300]),
    '{targets,0,answers,0,decision_revision}', '4')),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(300))), 'a decision revision that moved is stale');
select is(pg_temp.review(jsonb_set(pg_temp.cmd('accept_measured', 602, array[300], array[300]),
    '{targets,0,answers}', '[]')),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(300))), 'an answer the selection did not see is stale');
-- An item the server claims eligible that is not: an uncertain valve accepted.
select is(pg_temp.review(pg_temp.cmd('accept_measured', 602, array[301], array[301])),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(301))), 'an uncertain item is never accepted');
select is((select count(*)::integer from public.takeoff_item_answer_decisions), 0, 'none of them wrote a decision');
reset role;
select is((select count(*)::integer from public.takeoff_item_review_commands), 0, 'nor a receipt');
-- A positive row whose rules wait for the server cannot be verified: the selection is stale.
update public.takeoff_items set rules_stale = true where id = pg_temp.f(812);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('accept_measured', 603, array[300], array[300])),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(300))), 'a row with stale rules is not verified in bulk');
reset role;
update public.takeoff_items set rules_stale = false where id = pg_temp.f(812);

-- What an acceptance certifies is judged again by the database, from the stored facts, as the planner judges it: each of
-- these makes the selection stale, nothing written.
create function pg_temp.stale_300(key integer, label text) returns setof text language sql as $$
  select is(pg_temp.review(pg_temp.cmd('accept_measured', key, array[300], array[300])),
    jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(300))), label)
$$;
-- A complete measure of 3 against a DPGF reference of 2.
set local session_replication_role = replica;
update public.takeoff_list_revision_entries set reference_quantity = 2 where item_id = pg_temp.f(300);
set local session_replication_role = origin;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.stale_300(620, 'a measure beyond its DPGF reference is not accepted in bulk');
reset role;
set local session_replication_role = replica;
update public.takeoff_list_revision_entries set reference_quantity = null where item_id = pg_temp.f(300);
set local session_replication_role = origin;
-- A confidence of 0.9 below the tenant's threshold of 0.95.
insert into public.feature_flags (tenant_id, flag_key, enabled, value)
values (pg_temp.f(10), 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD', true, '0.95')
on conflict (tenant_id, flag_key) do update set enabled = true, value = excluded.value;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.stale_300(621, 'a confidence below the tenant''s threshold is not accepted in bulk');
reset role;
delete from public.feature_flags where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_LOW_CONFIDENCE_THRESHOLD';
-- A positive row in another unit than the item's.
update public.takeoff_items set unit = 'ml' where id = pg_temp.f(811);
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.stale_300(622, 'a row in another unit than the item''s is not accepted in bulk');
reset role;
update public.takeoff_items set unit = 'u', rules_stale = false where id = pg_temp.f(811);
-- A remark of the reading on the measured answer.
set local session_replication_role = replica;
update public.takeoff_item_answers set reason_code = 'DUPLICATE_READING',
  reasons = '[{"code": "DUPLICATE_READING", "by": "worker", "text": null, "chunk_id": null}]' where id = pg_temp.answer(300);
set local session_replication_role = origin;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.stale_300(623, 'a measured answer with a remark is not accepted in bulk');
reset role;
set local session_replication_role = replica;
update public.takeoff_item_answers set reason_code = null, reasons = '[]' where id = pg_temp.answer(300);
-- The plan already sent to an estimate (its job applied): its rows are never verified nor excluded by a bulk command.
update public.takeoff_jobs set status = 'applied' where id = pg_temp.job(20, 1);
set local session_replication_role = origin;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.stale_300(624, 'a plan already sent is not accepted in bulk');
select is(pg_temp.review(pg_temp.cmd('set_aside', 625, array[300], array[300], '{"reason":"duplicate"}')),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(300))), 'nor set aside');
reset role;
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'completed' where id = pg_temp.job(20, 1);
set local session_replication_role = origin;
select results_eq($$select count(*)::integer from public.takeoff_items where id in (pg_temp.f(811), pg_temp.f(812))
  and (is_verified or is_excluded)$$, $$values (0)$$, 'its rows untouched');
select is((select count(*)::integer from public.takeoff_item_answer_decisions), 0, 'and no decision written');

-- The acceptance: the lavabo's answer accepted, its two positive rows verified in the member's name, journaled.
select pg_temp.sign_in(1);
set local role authenticated;
create temp table command_604 as select pg_temp.cmd('accept_measured', 604, array[300, 301], array[300],
  jsonb_build_object('skipped', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(301), 'label', 'Vanne DN32 (fictive)',
    'reason', 'not_measured')))) as command;
create temp table answer_604 as select pg_temp.review((select command from command_604)) as answer;
select is((select answer from answer_604), jsonb_build_object('outcome', 'applied', 'applied',
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'answers', 1)), 'skipped',
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(301), 'label', 'Vanne DN32 (fictive)', 'reason', 'not_measured')),
    'rules_jobs', '[]'::jsonb, 'replayed', false), 'the measured item is accepted, the other left with its reason');
select results_eq($$select kind, revision, actor_id from public.takeoff_item_answer_decisions where answer_id = pg_temp.answer(300)$$,
  $$values ('accepted'::text, 1, pg_temp.f(1))$$, 'its decision, revision 1, in the member''s name');
reset role;
select results_eq($$select id, is_verified, verified_by from public.takeoff_items where id in (pg_temp.f(811), pg_temp.f(812)) order by id$$,
  $$values (pg_temp.f(811), true, pg_temp.f(1)), (pg_temp.f(812), true, pg_temp.f(1))$$,
  'its positive rows are verified in the member''s name');
select is((select count(*)::integer from public.audit_logs where table_name = 'takeoff_items'
    and after_data #>> '{metadata,field}' = 'is_verified' and user_id = pg_temp.f(1)
    and after_data #>> '{metadata,item_id}' in (pg_temp.f(811)::text, pg_temp.f(812)::text)), 2,
  'and the journal of the rows tells it as the member''s, as a review''s save does');
-- One statement journals the rows an acceptance verifies: their order among themselves is the plan's (a hash join or a
-- nested loop gives either), never promised. The decision is journaled after them, by the next statement.
select results_eq($$select event, takeoff_item_id from public.takeoff_item_review_events
  order by event <> 'row_verified', takeoff_item_id$$,
  $$values ('row_verified'::text, pg_temp.f(811)), ('row_verified', pg_temp.f(812)), ('accepted', null::uuid)$$,
  'every effect is journaled');
select is((select max(id) filter (where event = 'row_verified') < min(id) filter (where event = 'accepted')
  from public.takeoff_item_review_events), true, 'the decision after its rows');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select item, decision from pg_temp.table_()$$,
  $$values (pg_temp.f(301), 'pending'::text), (pg_temp.f(302), 'pending'), (pg_temp.f(300), 'accepted')$$,
  'the decisions to take come first');
-- The same command under its key answers the same and writes nothing; another under the key is a conflict.
select is(pg_temp.review((select command from command_604)) - 'replayed', (select answer from answer_604) - 'replayed',
  'the same command answers what it answered the first time');
select is(pg_temp.review((select command from command_604)) ->> 'replayed', 'true', 'replayed');
select is(pg_temp.review(jsonb_set((select command from command_604), '{apply}', '[]')) ->> 'replayed', 'true',
  'what the server found eligible is decided again, never compared: the same command still replays');
select throws_ok($$select pg_temp.review(jsonb_set((select command from command_604), '{targets}',
    jsonb_build_array((select command from command_604) #> '{targets,0}')))$$, '23505',
  'TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT', 'another command under the key is a conflict');
-- A second acceptance with what was read before the first: stale.
select is(pg_temp.review(jsonb_set((select command from command_604), '{intent_key}', to_jsonb(pg_temp.f(605)))),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(300))), 'a selection read before is stale');
reset role;
select is((select count(*)::integer from public.takeoff_item_review_commands), 1, 'one receipt');
select is((select count(*)::integer from public.takeoff_item_review_events), 3, 'nothing journaled twice');

-- A targeted correction after the acceptance (a member's save: the row's quantity 2 corrected to 7, its verification
-- withdrawn): the line is a decision to take again, its earlier acceptance shown as none, and it is accepted again as
-- the row now is.
update public.takeoff_items set quantity = 7, is_verified = false, verified_at = null, verified_by = null,
  updated_at = clock_timestamp() where id = pg_temp.f(811);
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select decision from pg_temp.table_() where item = pg_temp.f(300)$$, $$values ('pending'::text)$$,
  'an acceptance a targeted edit withdrew is a decision to take again');
select is((select t.readings -> 0 -> 'decision' from public.read_takeoff_item_table(pg_temp.f(10), pg_temp.f(20), null, null,
    null, null, null, array[pg_temp.f(300)], null, 0, 1) t), 'null'::jsonb, 'its reading shows no decision');
select is(pg_temp.review(pg_temp.cmd('accept_measured', 626, array[300], array[300])) ->> 'outcome', 'applied', 'accepted again');
reset role;
select results_eq($$select id, quantity, is_verified, verified_by from public.takeoff_items
  where id in (pg_temp.f(811), pg_temp.f(812)) order by id$$,
  $$values (pg_temp.f(811), 7::numeric, true, pg_temp.f(1)), (pg_temp.f(812), 1::numeric, true, pg_temp.f(1))$$,
  'the corrected row verified as it now is');
select results_eq($$select kind, revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.answer(300)$$,
  $$values ('accepted'::text, 2)$$, 'its decision, revision 2');

-- Set aside and reinstated with nothing in between: each row comes back as it was (verified, by whom, when, why), and the
-- answer's acceptance with it. The set aside names the job whose rules the server computes again, its replay too.
-- Row 811 holds the justification of a targeted verification: the reinstatement must give it back too.
update public.takeoff_items set verification_justification =
  '{"reason_code": "system_documented", "system_reference": "Fabricant fictif, gamme G, certificat C"}'::jsonb
where id = pg_temp.f(811);
create temp table verified_before as select id, is_verified, verified_at, verified_by, verification_justification
  from public.takeoff_items where id in (pg_temp.f(811), pg_temp.f(812));
select is((select count(*)::integer from verified_before where is_verified and verification_justification is not null), 1,
  'one row verified with a justification before the set aside');
select pg_temp.sign_in(1);
set local role authenticated;
create temp table command_627 as select pg_temp.cmd('set_aside', 627, array[300], array[300], '{"reason":"duplicate"}') as command;
create temp table answer_627 as select pg_temp.review((select command from command_627)) as answer;
select is((select answer -> 'rules_jobs' from answer_627), jsonb_build_array(pg_temp.job(20, 1)),
  'the set aside names the job whose rules the server computes again');
select is(pg_temp.review((select command from command_627)),
  (select answer - 'replayed' || '{"replayed": true}'::jsonb from answer_627),
  'its replay answers the same, the job included: a refresh interrupted is finished on a replay');
select is(pg_temp.review(pg_temp.cmd('reinstate', 628, array[300], array[300])) ->> 'outcome', 'applied', 'reinstated');
reset role;
select results_eq($$select id, is_excluded, is_verified, verified_at, verified_by, verification_justification
  from public.takeoff_items where id in (pg_temp.f(811), pg_temp.f(812)) order by id$$,
  $$select id, false, is_verified, verified_at, verified_by, verification_justification from verified_before order by id$$,
  'each row back as it was, its verification included');
select results_eq($$select kind, revision, actor_id from public.takeoff_item_answer_decisions where answer_id = pg_temp.answer(300)$$,
  $$values ('accepted'::text, 4, pg_temp.f(1))$$, 'and the answer accepted again, as it was');
select results_eq($$select after ->> 'kind', after ->> 'restored' from public.takeoff_item_review_events where event = 'reinstated'
  order by id desc limit 1$$, $$values ('accepted'::text, 'whole'::text)$$, 'the journal says it came back whole');

-- The set aside: the bathtub (no positive row) and the lavabo (its rows excluded with the reason, their verification
-- withdrawn, their rules waiting for the server, what they were journaled). Row 812 was excluded by a member before.
update public.takeoff_items set is_excluded = true, exclusion_reason = 'Exclue par un membre (fictif)', is_verified = false,
  verified_at = null, verified_by = null where id = pg_temp.f(812);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('set_aside', 606, array[300, 302], array[300, 302],
    '{"reason":"other","note":"Prévu au lot chauffage (fictif)"}')) -> 'applied',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'answers', 1), jsonb_build_object('item_id', pg_temp.f(302),
    'answers', 1)), 'two items set aside, one without any positive row');
select results_eq($$select kind, reason, note, revision from public.takeoff_item_answer_decisions
  where answer_id in (pg_temp.answer(300), pg_temp.answer(302)) order by item_id$$,
  $$values ('set_aside'::text, 'other'::text, 'Prévu au lot chauffage (fictif)'::text, 5),
    ('set_aside', 'other', 'Prévu au lot chauffage (fictif)', 1)$$, 'the reason written on each answer, chosen once');
reset role;
select results_eq($$select id, is_excluded, exclusion_reason, is_verified, rules_stale from public.takeoff_items
  where id in (pg_temp.f(811), pg_temp.f(812)) order by id$$,
  $$values (pg_temp.f(811), true, 'Écarté dans le tableau des postes : autre — Prévu au lot chauffage (fictif)'::text, false, true),
    (pg_temp.f(812), true, 'Écarté dans le tableau des postes : autre — Prévu au lot chauffage (fictif)'::text, false, true)$$,
  'the rows are excluded with the reason, their verification withdrawn and their rules waiting for the server');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select item, decision from pg_temp.table_() where item <> pg_temp.f(301)$$,
  $$values (pg_temp.f(300), 'set_aside'::text), (pg_temp.f(302), 'set_aside')$$, 'their lines say so');

-- A member changed row 811 meanwhile. The reinstatement gives each row back its exclusion (811 included again, 812
-- excluded with its member's reason) but no verification over the change: the lavabo comes back to be decided, and the
-- journal says so.
reset role;
update public.takeoff_items set quantity = 8, updated_at = clock_timestamp() where id = pg_temp.f(811);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('reinstate', 607, array[300, 302], array[300, 302])) -> 'applied',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'answers', 1), jsonb_build_object('item_id', pg_temp.f(302),
    'answers', 1)), 'the lavabo and the bathtub reinstated');
reset role;
select results_eq($$select id, is_excluded, exclusion_reason from public.takeoff_items where id in (pg_temp.f(811), pg_temp.f(812))
  order by id$$,
  $$values (pg_temp.f(811), false, null::text), (pg_temp.f(812), true, 'Exclue par un membre (fictif)'::text)$$,
  'each row gets back its exclusion');
select is((select is_verified from public.takeoff_items where id = pg_temp.f(811)), false, 'the changed row is not verified again');
select results_eq($$select kind, revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.answer(300)$$,
  $$values ('none'::text, 6)$$, 'its answer waits for a decision again, the revision going on');
select results_eq($$select after ->> 'kind', after ->> 'restored' from public.takeoff_item_review_events where event = 'reinstated'
  and item_id = pg_temp.f(300) order by id desc limit 1$$, $$values ('none'::text, 'changed'::text)$$,
  'the journal says a row changed in between');
select is((select count(*)::integer from public.takeoff_item_review_events where event in ('set_aside', 'reinstated')), 6,
  'every set aside stays in the journal beside its reinstatement');

-- A set aside leaves a row already excluded with its reason as it is, and still keeps what that row holds: a member who
-- changes it afterwards is seen by the reinstatement, which journals the change.
update public.takeoff_items set is_excluded = true, exclusion_reason = 'Écarté dans le tableau des postes : doublon',
  is_verified = false, verified_at = null, verified_by = null where id = pg_temp.f(811);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('set_aside', 638, array[300], array[300], '{"reason":"duplicate"}')) ->> 'outcome',
  'applied', 'the lavabo set aside again, one of its rows already excluded with that reason');
reset role;
select results_eq($$select e.takeoff_item_id from public.takeoff_item_review_events e
  join public.takeoff_item_review_commands c on c.id = e.command_id
  where c.intent_key = pg_temp.f(638) and e.event = 'row_excluded'$$, $$values (pg_temp.f(812))$$,
  'it excludes only the row it changes');
update public.takeoff_items set quantity = 9, updated_at = clock_timestamp() where id = pg_temp.f(811);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('reinstate', 639, array[300], array[300])) ->> 'outcome', 'applied',
  'the lavabo reinstated after a member changed the row it left as it was');
reset role;
select results_eq($$select after ->> 'kind', after ->> 'restored' from public.takeoff_item_review_events where event = 'reinstated'
  and item_id = pg_temp.f(300) order by id desc limit 1$$, $$values ('none'::text, 'changed'::text)$$,
  'the journal says a row changed in between, the one the set aside did not change included');
select results_eq($$select id, is_excluded, exclusion_reason from public.takeoff_items where id in (pg_temp.f(811), pg_temp.f(812))
  order by id$$,
  $$values (pg_temp.f(811), true, 'Écarté dans le tableau des postes : doublon'::text),
    (pg_temp.f(812), true, 'Exclue par un membre (fictif)'::text)$$,
  'each row as it was before the set aside');

-- The entries: a value per item on the bathtub (not found) with what it rests on; on the lavabo (measured): stale.
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('enter_quantity', 608, array[300], array[300],
    jsonb_build_object('values', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'quantity', 4, 'unit', 'u')),
      'entry', jsonb_build_object('category', 'site_survey')))),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(300))), 'a measured item takes no entry');
select is(pg_temp.review(pg_temp.cmd('enter_quantity', 609, array[302], array[302],
    jsonb_build_object('values', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(302), 'quantity', 1, 'unit', 'u')),
      'entry', jsonb_build_object('category', 'site_survey', 'note', 'Relevé du 12 (fictif)')))) ->> 'outcome', 'applied',
  'the bathtub entered');
select results_eq($$select plan_logical_id, quantity, unit, category, note, included, revision, previous_quantity, actor_id
  from public.takeoff_item_entries where item_id = pg_temp.f(302)$$,
  $$values (null::uuid, 1::numeric, 'u'::text, 'site_survey'::text, 'Relevé du 12 (fictif)'::text, true, 1, null::numeric, pg_temp.f(1))$$,
  'for the whole item, in the member''s name, counted at once');
select throws_ok($$select pg_temp.review(pg_temp.cmd('enter_quantity', 610, array[302], array[302],
    jsonb_build_object('values', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(302), 'quantity', 2, 'unit', 'u')),
      'entry', jsonb_build_object('category', 'hypothesis', 'note', 'court'))))$$, '22023', 'TAKEOFF_ITEM_REVIEW_INVALID',
  'an hypothesis says what is supposed');
select is(pg_temp.review(pg_temp.cmd('enter_quantity', 611, array[302], array[302],
    jsonb_build_object('values', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(302), 'quantity', 2, 'unit', 'u')),
      'entry', jsonb_build_object('category', 'hypothesis', 'note', 'Une baignoire supposée au R+1 (fictif).')))) ->> 'outcome',
  'applied', 'an hypothesis entered');
select results_eq($$select quantity, category, included, revision, previous_quantity, previous_unit from public.takeoff_item_entries
  where item_id = pg_temp.f(302)$$, $$values (2::numeric, 'hypothesis'::text, false, 2, 1::numeric, 'u'::text)$$,
  'it replaces the entry, keeps the value before, and does not count until included');
-- A plan already sent to an estimate is closed to every gesture, its entries included: nothing entered nor included.
reset role;
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'applied' where id = pg_temp.job(20, 1);
set local session_replication_role = origin;
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('include_entry', 637, array[302], array[302])),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(302))),
  'an item of a plan already sent does not include its hypothesis');
select is(pg_temp.review(pg_temp.cmd('enter_quantity', 636, array[302], array[302],
    jsonb_build_object('values', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(302), 'quantity', 3, 'unit', 'u')),
      'entry', jsonb_build_object('category', 'site_survey')))),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(302))), 'nor takes an entry');
reset role;
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'completed' where id = pg_temp.job(20, 1);
set local session_replication_role = origin;
select results_eq($$select quantity, included, revision from public.takeoff_item_entries where item_id = pg_temp.f(302)$$,
  $$values (2::numeric, false, 2)$$, 'its entry untouched');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select decision from pg_temp.table_() where item = pg_temp.f(302)$$, $$values ('entered'::text)$$,
  'its line is entered');
select is(pg_temp.review(pg_temp.cmd('include_entry', 612, array[302], array[302])) ->> 'outcome', 'applied', 'included');
select results_eq($$select included, revision, actor_id from public.takeoff_item_entries where item_id = pg_temp.f(302)$$,
  $$values (true, 3, pg_temp.f(1))$$, 'the hypothesis now counts; the entry keeps its author');
select is(pg_temp.review(pg_temp.cmd('include_entry', 613, array[302], array[302])),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(302))), 'nothing more to include');
reset role;
select results_eq($$select event from public.takeoff_item_review_events where item_id = pg_temp.f(302) and event in ('entered',
  'entry_included') order by id$$, $$values ('entered'::text), ('entered'), ('entry_included')$$, 'each entry is journaled');

-- An entered item set aside: its entry is kept for the history and a reinstatement, and counts for nothing meanwhile.
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('set_aside', 629, array[302], array[302], '{"reason":"out_of_scope"}')) ->> 'outcome',
  'applied', 'the entered bathtub set aside');
select results_eq($$select decision from pg_temp.table_() where item = pg_temp.f(302)$$, $$values ('set_aside'::text)$$,
  'its line is set aside, not entered');
select is((select count(*)::integer from public.takeoff_item_entries where item_id = pg_temp.f(302)), 1, 'its entry kept');
-- A plan's entry on the valve (uncertain), then the valve set aside in the affaire: the plan's entry counts for nothing.
select is(pg_temp.review(pg_temp.cmd('enter_quantity', 630, array[301], array[301],
    jsonb_build_object('scope', jsonb_build_object('kind', 'plan', 'plan_logical_id', pg_temp.f(100)),
      'values', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(301), 'quantity', 5, 'unit', 'u')),
      'entry', jsonb_build_object('category', 'site_survey')))) ->> 'outcome', 'applied', 'the valve entered on its plan');
select results_eq($$select decision from pg_temp.table_() where item = pg_temp.f(301)$$, $$values ('entered'::text)$$,
  'its line is entered');
-- A selection in the affaire freezes every entry that enters its total, each plan's included: the valve's plan entry
-- changed from 5 to 7 after the selection, a command on what was selected is stale and writes nothing.
create temp table command_635 as select pg_temp.cmd('set_aside', 635, array[301], array[301], '{"reason":"duplicate"}') as command;
select is((select command #> '{targets,0,answers,0,entry_revision}' from command_635), '1'::jsonb,
  'the selection holds the plan entry''s revision');
select is(pg_temp.review(jsonb_set(jsonb_set(pg_temp.cmd('enter_quantity', 634, array[301], array[301],
    jsonb_build_object('scope', jsonb_build_object('kind', 'plan', 'plan_logical_id', pg_temp.f(100)),
      'values', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(301), 'quantity', 7, 'unit', 'u')),
      'entry', jsonb_build_object('category', 'site_survey'))),
    '{targets,0,entry_revision}', '1'), '{targets,0,answers,0,entry_revision}', '0')) ->> 'outcome', 'applied',
  'the valve''s plan entry changed from 5 to 7 in the plan''s scope');
select is(pg_temp.review((select command from command_635)),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(301))),
  'a selection made before a plan''s entry changed is stale');
select results_eq($$select kind from public.takeoff_item_answer_decisions where answer_id = pg_temp.answer(301)$$,
  $$select null::text where false$$, 'and writes nothing');
select is(pg_temp.review(pg_temp.cmd('set_aside', 631, array[301], array[301], '{"reason":"duplicate"}')) ->> 'outcome',
  'applied', 'the valve set aside');
select results_eq($$select decision from pg_temp.table_() where item = pg_temp.f(301)$$, $$values ('set_aside'::text)$$,
  'its line is set aside: the plan''s entry no longer counts');
reset role;

-- 5. The command's work tables are its own. A session that holds, before it calls the command, a temporary relation
--    under one of their names (its own table, with a trigger, other columns, or a view) never has it read, written or
--    fired with the owner's rights: the command drops it and makes its own, or refuses with nothing written.
--    Each case starts as a session that has not called the command yet: the work tables of earlier calls are dropped.
drop table if exists pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs, pg_temp.takeoff_review_rules_jobs,
  pg_temp.takeoff_review_written, pg_temp.takeoff_review_restored;
select pg_temp.sign_in(1);
set local role authenticated;
-- What the member's trigger does when it fires: it records who it runs as, and renames the tenant, which the member may not.
create temporary table zz_seen (who text, relation text);
create function pg_temp.zz_spy() returns trigger language plpgsql as $spy$
begin
  insert into pg_temp.zz_seen values (current_user, tg_table_name);
  update public.tenants set name = 'Écrit par un déclencheur (fictif)' where id = pg_temp.f(10);
  return null;
end;
$spy$;
-- The member's table under one of the command's names, with B2's columns, a trigger on each statement that writes it.
create function pg_temp.zz_hostile(relation text, columns text) returns void language plpgsql as $hostile$
begin
  execute format('create temporary table pg_temp.%I (%s)', relation, columns);
  execute format('create trigger zz_spy after insert or update or delete or truncate on pg_temp.%I for each statement '
    || 'execute function pg_temp.zz_spy()', relation);
end;
$hostile$;
create function pg_temp.zz_case(relation text, columns text, command jsonb, label text) returns setof text
language plpgsql as $case$
begin
  perform pg_temp.zz_hostile(relation, columns);
  return next lives_ok(format('select pg_temp.review(%L::jsonb)', command), label || ': the command runs');
  return next is((select count(*)::integer from pg_temp.zz_seen), 0, label || ': the session''s trigger never ran');
  return next is((select t.name from public.tenants t where t.id = pg_temp.f(10)), 'Revue de postes (fictif)',
    label || ': nothing the member may not write is written');
  return next is((select count(*)::integer from pg_catalog.pg_trigger t where t.tgname = 'zz_spy'), 0,
    label || ': the session''s table is gone');
end;
$case$;
select pg_temp.zz_case('takeoff_review_pairs', 'item_id uuid, plan_logical_id uuid, answer_id uuid, outcome text, '
  || 'decision_kind text, decision_effective text, decision_revision integer, plan_entry_id uuid, plan_entry_revision integer, '
  || 'job_id uuid, sent boolean, reason_code text', pg_temp.cmd('reinstate', 640, array[302], array[302]), 'the pairs');
reset role;
drop table if exists pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs, pg_temp.takeoff_review_rules_jobs,
  pg_temp.takeoff_review_written, pg_temp.takeoff_review_restored;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.zz_case('takeoff_review_lines', 'item_id uuid primary key, state text, scope_entry_id uuid, expected_unit text, '
  || 'reference_quantity numeric', pg_temp.cmd('set_aside', 641, array[302], array[302], '{"reason":"duplicate"}'), 'the lines');
reset role;
drop table if exists pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs, pg_temp.takeoff_review_rules_jobs,
  pg_temp.takeoff_review_written, pg_temp.takeoff_review_restored;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.zz_case('takeoff_review_rules_jobs', 'job_id uuid primary key',
  pg_temp.cmd('reinstate', 642, array[302], array[302]), 'the jobs whose rules wait');
reset role;
drop table if exists pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs, pg_temp.takeoff_review_rules_jobs,
  pg_temp.takeoff_review_written, pg_temp.takeoff_review_restored;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.zz_case('takeoff_review_written', 'item_id uuid, answer_id uuid',
  pg_temp.cmd('set_aside', 643, array[302], array[302], '{"reason":"duplicate"}'), 'the answers written');
reset role;
drop table if exists pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs, pg_temp.takeoff_review_rules_jobs,
  pg_temp.takeoff_review_written, pg_temp.takeoff_review_restored;
select pg_temp.sign_in(1);
set local role authenticated;
select pg_temp.zz_case('takeoff_review_restored', 'answer_id uuid primary key, item_id uuid, plan_logical_id uuid, '
  || 'whole boolean, previous jsonb', pg_temp.cmd('reinstate', 644, array[302], array[302]), 'the answers restored');
select results_eq($$select kind, revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.answer(302)$$,
  $$values ('none'::text, 8)$$, 'each of those commands decided, one after the other, in one transaction');
reset role;
drop table if exists pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs, pg_temp.takeoff_review_rules_jobs,
  pg_temp.takeoff_review_written, pg_temp.takeoff_review_restored;
select pg_temp.sign_in(1);
set local role authenticated;
-- A table of one of those names with other columns: the command makes its own and applies.
create temporary table takeoff_review_pairs (note text);
select lives_ok($$select pg_temp.review(pg_temp.cmd('set_aside', 645, array[302], array[302], '{"reason":"duplicate"}'))$$,
  'a session''s table of the same name with other columns does not stop the command');
select results_eq($$select kind, revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.answer(302)$$,
  $$values ('set_aside'::text, 9)$$, 'which applied on its own table');
reset role;
drop table if exists pg_temp.takeoff_review_lines, pg_temp.takeoff_review_pairs, pg_temp.takeoff_review_rules_jobs,
  pg_temp.takeoff_review_written, pg_temp.takeoff_review_restored;
select pg_temp.sign_in(1);
set local role authenticated;
-- A view of one of those names: the command refuses, nothing written.
create temporary view takeoff_review_lines as select 1 as x;
select throws_ok($$select pg_temp.review(pg_temp.cmd('reinstate', 646, array[302], array[302]))$$, '42809', null,
  'a session''s view of the same name refuses the command');
select results_eq($$select kind, revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.answer(302)$$,
  $$values ('set_aside'::text, 9)$$, 'and nothing is written');
drop view takeoff_review_lines;
reset role;
select is((select count(*)::integer from public.takeoff_item_review_commands where intent_key = pg_temp.f(646)), 0,
  'not even its receipt');

-- The affaire deleted with its review, by the service role (whose direct writes the relations refuse): the cascade
-- runs as the relations' owner, nothing is left, nothing refuses.
set local role service_role;
select lives_ok($$delete from public.estimate_projects where id = pg_temp.f(20)$$, 'the affaire is deleted with its review');
select lives_ok($$set constraints all immediate$$, 'its deferred keys hold');
reset role;
select is((select count(*)::integer from public.takeoff_item_review_commands) + (select count(*)::integer
  from public.takeoff_item_answer_decisions) + (select count(*)::integer from public.takeoff_item_entries)
  + (select count(*)::integer from public.takeoff_item_review_events), 0, 'nothing of its review is left');

select * from finish();
rollback;
