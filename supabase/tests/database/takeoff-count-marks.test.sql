-- Lot 5, A (20261122114433_takeoff_count_marks.sql): the counted marks of an item on a page, stored, and their commands.
-- 1. Who may read and write: the readers of the affaire read the marks; the worker publishes; an operator of the affaire
--    edits through the command; nobody writes a mark, an attribution, a derived value or the journal directly.
-- 2. The worker's publication of a machine generation, by the attempt that published the job's answers: an attempt that
--    did not, an item without an answer in the job, a page outside its answer, a page without or against its geometry,
--    an observation of another answer, a malformed mark: each refused with its own code, nothing written. A replay
--    answers the same; another content for the same generation is refused.
-- 3. The derivation (server-side count): machine marks alone give no quantity; a verified scope gives the marks
--    retained, never added to lot 4's page total; a correction (a move at the same count) reopens the verification; the
--    last mark removed gives a SQL NULL, never 0; the three numbers (proposed, reread, quantity) stay apart.
-- 4. An operator's edit of N gestures under the expected revision of every answer it changes: add, move (same identity,
--    earlier coordinates in the journal), remove with a reason, restore, retain, reattribute (both answers change),
--    verify; each refusal with its own code and nothing written; a replay of the intention answers the same.
-- 5. A later machine generation on an answer already reviewed waits unattributed; a member retains it.
-- 6. A replaced reading's marks are history: no edit; the journal outlives the job's deletion; the affaire's deletion
--    takes everything.
-- Isolation justified: rights under RLS, every refusal of the commands and their single transaction are not observable
-- from a journey (no screen reads them yet). The two-session cases are in takeoff-count-marks-race.test.sql. All values
-- are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5e00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5e00000-0000-4000-8000-000000000099' $$;
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
from unnest(array['takeoff_count_pages', 'takeoff_count_marks', 'takeoff_count_answer_states', 'takeoff_count_answer_pages',
  'takeoff_count_mark_attributions', 'takeoff_count_mark_proposals', 'takeoff_count_mark_events']) as relation;
select table_privs_are('public', 'takeoff_count_mark_commands', 'authenticated', array[]::text[],
  'members never read the commands (intention keys, the attempt''s digest)');
select table_privs_are('public', relation, 'anon', array[]::text[], relation || ': anonymous clients see nothing')
from unnest(array['takeoff_count_pages', 'takeoff_count_marks', 'takeoff_count_answer_states', 'takeoff_count_answer_pages',
  'takeoff_count_mark_attributions', 'takeoff_count_mark_proposals', 'takeoff_count_mark_commands',
  'takeoff_count_mark_events']) as relation;
select ok((select relrowsecurity from pg_class where oid = format('public.%I', relation)::regclass), relation || ': row level security')
from unnest(array['takeoff_count_pages', 'takeoff_count_marks', 'takeoff_count_answer_states', 'takeoff_count_answer_pages',
  'takeoff_count_mark_attributions', 'takeoff_count_mark_proposals', 'takeoff_count_mark_commands',
  'takeoff_count_mark_events']) as relation;
select is(has_function_privilege('authenticated', 'public.publish_takeoff_count_marks(uuid, uuid, integer, jsonb, jsonb)', 'EXECUTE'),
  false, 'a member''s session cannot publish marks');
select is(has_function_privilege('service_role', 'public.publish_takeoff_count_marks(uuid, uuid, integer, jsonb, jsonb)', 'EXECUTE'),
  true, 'the worker publishes');
select is(has_function_privilege('service_role', 'public.edit_takeoff_count_marks(uuid, uuid, uuid, jsonb, jsonb)', 'EXECUTE'),
  false, 'the service role edits nothing: an edit is a member''s');
select is(has_function_privilege('authenticated', fn, 'EXECUTE'), true, fn || ': a member''s session calls it')
from unnest(array['public.edit_takeoff_count_marks(uuid, uuid, uuid, jsonb, jsonb)',
  'public.read_takeoff_count_marks(uuid, uuid, uuid, integer, text[], uuid, integer)',
  'public.read_takeoff_count_mark_summaries(uuid, uuid, uuid[])',
  'public.read_takeoff_count_mark_events(uuid, uuid, uuid, integer, integer, integer)',
  'public.takeoff_count_marks_changed_since(uuid, uuid, uuid, integer)']) as fn;
select is(has_function_privilege(role_name, fn, 'EXECUTE'), false, fn || ': ' || role_name || ' cannot call it')
from unnest(array['private.takeoff_count_mark_summary(uuid)', 'private.lock_takeoff_count_marks_revision(uuid)',
  'private.takeoff_count_marks_revision(uuid)']) as fn
cross join unnest(array['authenticated', 'service_role', 'anon']) as role_name;
select is((select count(*)::integer from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where c.relname in ('estimate_projects', 'takeoff_jobs', 'takeoff_item_answers', 'takeoff_item_answer_observations')
    and t.tgname ~ 'count_mark'), 0, 'no trigger on an existing table: a released writer pays nothing');

-- One tenant: the engineer who owns the affaires (1), an engineer who does not (2), a director (3), an admin (4); another
-- tenant's admin (5).
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'count-marks-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 5) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5e00000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Repères comptés (fictif)', 'count-marks-test'),
  (pg_temp.f(11), 'Autre entreprise (fictive)', 'count-marks-other-test');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(2), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(3), 'director', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(4), 'admin', true, '2020-01-01'),
  (pg_temp.f(11), pg_temp.f(5), 'admin', true, '2020-01-01');
-- Affaire 20 reads its plan against its list; affaire 22 is another affaire of the same owner.
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(20 + n), pg_temp.f(10), pg_temp.f(1), 'Affaire de repères ' || n || ' (fictive)' from generate_series(0, 2) as n;
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

-- The list of affaire 20: lavabo 300 (u), vanne 301 (u), baignoire 302 (ens: another unit) in its revision 310.
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by) values
  (pg_temp.f(300), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1)),
  (pg_temp.f(301), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1)),
  (pg_temp.f(302), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1));
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by) values
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), 1, 'item_added', '{}', 3, repeat('1', 64), repeat('a', 64), pg_temp.f(311), pg_temp.f(1));
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin) values
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(300), 0, 'manual:lavabo', 'Lavabo (fictif)', 'u', 'manual', '{"kind":"manual"}'),
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(301), 1, 'manual:vanne', 'Vanne DN32 (fictive)', 'u', 'manual', '{"kind":"manual"}'),
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(302), 2, 'manual:baignoire', 'Baignoire (fictive)', 'ens', 'manual', '{"kind":"manual"}');
set local session_replication_role = origin;

-- The confirmed preparation of the plan, the manifest of its unit, the launch and claim of a reading (as B1's test).
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
create function pg_temp.manifest(project integer) returns jsonb language sql stable as $$
  select jsonb_build_object('format_version', 2, 'intent', 'initial',
    'order', (select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', r.id,
      'revision', r.revision, 'content_sha256', r.content_sha256, 'item_count', r.item_count))
      from public.takeoff_list_revisions r where r.id = pg_temp.f(310)),
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
create function pg_temp.job(round integer) returns uuid language sql immutable as $$ select pg_temp.f(1000 + 10 * round) $$;
create function pg_temp.latest_job() returns uuid language sql as $$
  select j.id from public.takeoff_jobs j where j.project_id = pg_temp.f(20) order by j.created_at desc, j.id desc limit 1
$$;
create function pg_temp.launch(round integer) returns table (outcome text, request_id uuid, job_id uuid) language sql as $$
  select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
    pg_temp.f(500 + 10 * round), case when round = 1 then 'initial' else 'reread_plans' end,
    case when round = 1 then null else pg_temp.latest_job() end, pg_temp.host(), pg_temp.selection(),
    pg_temp.manifest(20), pg_temp.snapshot(20),
    jsonb_build_array(jsonb_build_object('id', pg_temp.job(round), 'plan_set_id', pg_temp.f(40),
      'launch_unit_key', 'plan:' || pg_temp.f(100), 'source_file_name', 'plan-1.pdf',
      'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture',
      'execution_host_id', pg_temp.host())),
    pg_temp.f(40), 1, array[pg_temp.f(100)])
$$;
create function pg_temp.claim(job uuid, token integer) returns integer language sql as $$
  select count(*)::integer from public.claim_observed_local_takeoff_job(job, pg_temp.f(10), pg_temp.host(), clock_timestamp(),
    pg_temp.f(token), clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)
$$;
set local session_replication_role = replica;
insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
  updated_by)
values (pg_temp.f(10), pg_temp.f(20), 1, pg_temp.snapshot(20) -> 'preparation', pg_temp.snapshot(20), now(), pg_temp.f(1), pg_temp.f(1));
set local session_replication_role = origin;

-- The answers of a reading (B1's publication): the lavabo measured (2 on page 2, 1 on page 7, each a row of the result;
-- page 7 read again, an alternative: observations 1 to 3); the valve uncertain (page 7 unreadable, a candidate: one
-- observation); the bathtub not found.
create function pg_temp.answers(round integer) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.f(300), 'outcome', 'measured', 'reasons', '[]'::jsonb,
      'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'quantity', jsonb_build_object('value', 3, 'unit', 'u'),
      'observations', jsonb_build_array(
        jsonb_build_object('page', 2, 'evidence', 'Symboles LAV fictifs', 'method', 'symbol_count', 'confidence', 0.9,
          'quantity', 2, 'unit', 'u', 'role', 'contribution', 'source', 'model', 'chunk_id', 'f1-b1',
          'takeoff_item_id', pg_temp.f(800 + 10 * round + 1)),
        jsonb_build_object('page', 7, 'evidence', 'Symboles LAV fictifs', 'method', 'symbol_count', 'confidence', 0.9,
          'quantity', 1, 'unit', 'u', 'role', 'contribution', 'source', 'model', 'chunk_id', 'f1-b1',
          'takeoff_item_id', pg_temp.f(800 + 10 * round + 2)),
        jsonb_build_object('page', 7, 'evidence', 'Symboles LAV fictifs', 'method', 'symbol_count', 'confidence', 0.9,
          'quantity', 1, 'unit', 'u', 'role', 'alternative', 'source', 'model', 'chunk_id', 'f2-b1'))),
    jsonb_build_object('item_id', pg_temp.f(301), 'outcome', 'uncertain',
      'reasons', jsonb_build_array(jsonb_build_object('code', 'QUALIFIER_UNREADABLE', 'by', 'model',
        'text', 'Le diamètre est illisible (fictif).', 'chunk_id', 'f1-b1')),
      'searched_pages', '[2]'::jsonb, 'unreadable_pages', '[7]'::jsonb,
      'candidate', jsonb_build_object('value', 1, 'unit', 'u'), 'observations', jsonb_build_array(
        jsonb_build_object('page', 2, 'evidence', 'Vanne fictive', 'method', 'symbol_count', 'confidence', 0.6,
          'quantity', 1, 'unit', 'u', 'role', 'candidate', 'source', 'model', 'chunk_id', 'f1-b1'))),
    jsonb_build_object('item_id', pg_temp.f(302), 'outcome', 'not_found',
      'reasons', jsonb_build_array(jsonb_build_object('code', 'NO_INDICATION', 'by', 'model', 'text', 'Aucun indice (fictif).',
        'chunk_id', 'f1-b1')),
      'searched_pages', '[7, 2]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'observations', '[]'::jsonb))
$$;
create function pg_temp.rows_(round integer) returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('id', pg_temp.f(800 + 10 * round + 1), 'designation', 'Lavabo (fictif)', 'quantity', 2, 'unit', 'u',
      'confidence', 0.9, 'evidence', 'Symboles LAV fictifs', 'source_file_name', 'plan-1.pdf', 'source_page', 2, 'metadata', '{}'::jsonb),
    jsonb_build_object('id', pg_temp.f(800 + 10 * round + 2), 'designation', 'Lavabo (fictif)', 'quantity', 1, 'unit', 'u',
      'confidence', 0.9, 'evidence', 'Symboles LAV fictifs', 'source_file_name', 'plan-1.pdf', 'source_page', 7, 'metadata', '{}'::jsonb))
$$;
-- The publication, then its commit's checks (B1's deferred check of the job's end), as its commit runs them.
create function pg_temp.publish_answers(round integer, token integer) returns integer language plpgsql as $$
declare
  written integer;
begin
  select answer_count into written from public.publish_takeoff_item_answers(pg_temp.job(round), pg_temp.f(token),
    '2026-11-22T09:00:00Z', 'modele-fictif', 'takeoff-c-postes-v1',
    '{"schema_version": "v2", "prompt_version": "takeoff-c-postes-v1"}'::jsonb, array[2, 7], pg_temp.answers(round), '[]'::jsonb,
    jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb, 'provider_meta', '{}'::jsonb,
      'confidence', null, 'token_count', 10, 'cost_cents', 0, 'duration_ms', 5, 'job_duration_ms', 6, 'run_metrics', '[]'::jsonb),
    pg_temp.rows_(round), null);
  set constraints all immediate;
  set constraints all deferred;
  return written;
end;
$$;

insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 minute');

select results_eq($$select outcome from pg_temp.launch(1)$$, $$values ('admitted'::text)$$, 'a reading against the list is admitted');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(1), 'its plan is handed');
select is(pg_temp.claim(pg_temp.job(1), 901), 1, 'and claimed under lease 901');
select is(pg_temp.publish_answers(1, 901), 3, 'its three answers are published by that attempt');

-- The answers, the marks by their source key and the intention keys, for the members' sessions below.
create temp table answer_ids (item integer, round integer, id uuid, primary key (item, round));
insert into answer_ids select n, 1, a.id from generate_series(300, 302) as n
join public.takeoff_item_answers a on a.item_id = pg_temp.f(n) and a.job_id = pg_temp.job(1);
grant select on answer_ids to authenticated, service_role;
create function pg_temp.answer(item integer, round integer default 1) returns uuid language sql stable as $$
  select id from answer_ids where answer_ids.item = $1 and answer_ids.round = $2
$$;
select is((select count(*)::integer from answer_ids), 3, 'the lavabo, the valve and the bathtub have an answer');
create function pg_temp.lavabo() returns uuid language sql stable as $$ select pg_temp.answer(300) $$;
create function pg_temp.vanne() returns uuid language sql stable as $$ select pg_temp.answer(301) $$;
create function pg_temp.baignoire() returns uuid language sql stable as $$ select pg_temp.answer(302) $$;

-- A page of the plan, A3 landscape: its visible box, turned or not.
create function pg_temp.geometry(rotation integer default 0) returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'view_box', jsonb_build_array(0, 0, 1190.55, 841.89), 'rotation', rotation,
    'user_unit', 1, 'width', case when rotation in (0, 180) then 1190.55 else 841.89 end,
    'height', case when rotation in (0, 180) then 841.89 else 1190.55 end)
$$;
create function pg_temp.pages() returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('page', 2, 'geometry', pg_temp.geometry()),
    jsonb_build_object('page', 7, 'geometry', pg_temp.geometry()))
$$;
create function pg_temp.proposal(item integer, source_key text, state text default 'proposed', extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('item_id', pg_temp.f(item), 'state', state, 'method', 'symbol_count', 'method_version', 'banc-1',
    'source_key', source_key) || extra
$$;
create function pg_temp.mark(page integer, x numeric, y numeric, proposals jsonb, box jsonb default null) returns jsonb
language sql immutable as $$
  select jsonb_build_object('page', page, 'x', x, 'y', y, 'proposals', proposals)
    || case when box is null then '{}'::jsonb else jsonb_build_object('box', box) end
$$;
-- Generation 1: on page 2, three lavabos (the third also proposed for the valve, a competing item); on page 7, one mark
-- whose item the reader could not tell (to attribute).
create function pg_temp.generation_1() returns jsonb language sql immutable as $$
  select jsonb_build_array(
    pg_temp.mark(2, 0.10, 0.20, jsonb_build_array(pg_temp.proposal(300, 'lav-1', 'proposed', jsonb_build_object(
      'observation_ordinal', 1, 'raw_centre', jsonb_build_array(120, 340), 'raw_frame', 'tile:1', 'subtype', 'Vasque (fictive)',
      'confidence', 0.8)))),
    pg_temp.mark(2, 0.30, 0.20, jsonb_build_array(pg_temp.proposal(300, 'lav-2'))),
    pg_temp.mark(2, 0.50, 0.25, jsonb_build_array(pg_temp.proposal(300, 'lav-3'),
      pg_temp.proposal(301, 'van-1', 'proposed', jsonb_build_object('diameter_mm', 32, 'diameter_source', 'label')))),
    pg_temp.mark(7, 0.40, 0.60, jsonb_build_array(pg_temp.proposal(300, 'lav-4', 'to_attribute')),
      jsonb_build_array(0.38, 0.58, 0.42, 0.62)))
$$;
create function pg_temp.publish_marks(token integer, generation integer, pages jsonb, marks jsonb, round integer default 1)
returns jsonb language sql as $$
  select public.publish_takeoff_count_marks(pg_temp.job(round), pg_temp.f(token), generation, pages, marks)
$$;
create function pg_temp.counts() returns integer[] language sql stable as $$
  select array[(select count(*)::integer from public.takeoff_count_pages where project_id = pg_temp.f(20)),
    (select count(*)::integer from public.takeoff_count_marks where project_id = pg_temp.f(20)),
    (select count(*)::integer from public.takeoff_count_mark_proposals where project_id = pg_temp.f(20)),
    (select count(*)::integer from public.takeoff_count_mark_attributions where project_id = pg_temp.f(20)),
    (select count(*)::integer from public.takeoff_count_mark_events where project_id = pg_temp.f(20)),
    (select count(*)::integer from public.takeoff_count_mark_commands where project_id = pg_temp.f(20))]
$$;

-- 2. The publication's refusals, each with nothing written.
select throws_ok($$select pg_temp.publish_marks(999, 1, pg_temp.pages(), pg_temp.generation_1())$$, '55000',
  'TAKEOFF_MARKS_LEASE_INVALID', 'another attempt than the one that published the answers is refused');
select throws_ok($$select public.publish_takeoff_count_marks(pg_temp.f(9999), pg_temp.f(901), 1, pg_temp.pages(),
  pg_temp.generation_1())$$, '55000', 'TAKEOFF_MARKS_LEASE_INVALID', 'so is an unknown job');
select throws_ok($$select pg_temp.publish_marks(901, 0, pg_temp.pages(), pg_temp.generation_1())$$, '22023',
  'TAKEOFF_MARKS_INVALID', 'a generation is numbered from 1');
select throws_ok($$select pg_temp.publish_marks(901, 1, pg_temp.pages(), jsonb_build_array(pg_temp.mark(2, 1.5, 0.2,
  jsonb_build_array(pg_temp.proposal(300, 'lav-1')))))$$, '22023', 'TAKEOFF_MARKS_INVALID', 'a centre outside the page is refused');
select throws_ok($$select pg_temp.publish_marks(901, 1, pg_temp.pages(), jsonb_build_array(pg_temp.mark(2, 0.1, 0.2,
  jsonb_build_array(pg_temp.proposal(300, 'lav-1')), jsonb_build_array(0.2, 0.1, 0.2, 0.3))))$$, '22023', 'TAKEOFF_MARKS_INVALID',
  'a degenerate box is refused');
select throws_ok($$select pg_temp.publish_marks(901, 1, pg_temp.pages(), jsonb_build_array(pg_temp.mark(2, 0.1, 0.2,
  jsonb_build_array(pg_temp.proposal(300, 'lav-1', 'proposed', '{"source_ref": "https://exemple.test/signe"}'::jsonb)))))$$,
  '22023', 'TAKEOFF_MARKS_INVALID', 'an address is never stored in a proposal');
select throws_ok($$select pg_temp.publish_marks(901, 1, pg_temp.pages(), jsonb_build_array(pg_temp.mark(2, 0.1, 0.2,
  jsonb_build_array(pg_temp.proposal(300, 'lav-1'), pg_temp.proposal(300, 'lav-1')))))$$, '22023', 'TAKEOFF_MARKS_INVALID',
  'one source key per item in a generation');
select throws_ok($$select pg_temp.publish_marks(901, 1, jsonb_build_array(jsonb_build_object('page', 2, 'geometry',
  jsonb_build_object('version', 1, 'view_box', jsonb_build_array(0, 0, 1190.55, 841.89), 'rotation', 90, 'user_unit', 1,
    'width', 1190.55, 'height', 841.89))), pg_temp.generation_1())$$, '22023', 'TAKEOFF_MARKS_INVALID',
  'a page turned a quarter must have the box''s proportions turned');
select throws_ok($$select pg_temp.publish_marks(901, 1, pg_temp.pages(), jsonb_build_array(pg_temp.mark(2, 0.1, 0.2,
  jsonb_build_array(pg_temp.proposal(399, 'x-1')))))$$, '22023', 'TAKEOFF_MARKS_ITEM_FOREIGN',
  'an item without an answer in the job is refused');
select throws_ok($$select pg_temp.publish_marks(901, 1, pg_temp.pages(), jsonb_build_array(pg_temp.mark(5, 0.1, 0.2,
  jsonb_build_array(pg_temp.proposal(300, 'lav-1')))))$$, '22023', 'TAKEOFF_MARKS_PAGE_OUTSIDE',
  'a page the answer did not read is refused');
select throws_ok($$select pg_temp.publish_marks(901, 1, jsonb_build_array(jsonb_build_object('page', 7, 'geometry', pg_temp.geometry())),
  pg_temp.generation_1())$$, '22023', 'TAKEOFF_MARKS_PAGE_GEOMETRY_REQUIRED', 'a first mark on a page needs the page''s geometry');
select throws_ok($$select pg_temp.publish_marks(901, 1, pg_temp.pages(), jsonb_build_array(pg_temp.mark(2, 0.1, 0.2,
  jsonb_build_array(pg_temp.proposal(301, 'van-1', 'proposed', '{"observation_ordinal": 2}'::jsonb)))))$$, '22023',
  'TAKEOFF_MARKS_OBSERVATION_FOREIGN', 'an observation the answer does not have is refused');
select is(pg_temp.counts(), array[0, 0, 0, 0, 0, 0], 'nothing was written by any refusal');

-- The generation is published: four marks, five proposals; the lavabo and the valve take it (revision 1), the bathtub
-- (no proposal) has no marks state.
create temp table published as select pg_temp.publish_marks(901, 1, pg_temp.pages(), pg_temp.generation_1()) as answer;
select results_eq($$select (answer ->> 'replayed')::boolean, (answer ->> 'marks')::integer, (answer ->> 'proposals')::integer,
  jsonb_array_length(answer -> 'answers') from published$$, $$values (false, 4, 5, 2)$$, 'the generation is published');
select is(pg_temp.counts(), array[2, 4, 5, 5, 3, 1], 'two pages, four marks, five proposals and attributions, three events, one command');
select results_eq($$select private.takeoff_count_marks_revision(pg_temp.lavabo()), private.takeoff_count_marks_revision(pg_temp.vanne()),
  private.takeoff_count_marks_revision(pg_temp.baignoire())$$, $$values (1, 1, 0)$$,
  'the answers that took it are at revision 1, the other one at 0');
create temp table marks_by_key as
  select p.source_key as key, p.mark_id as id from public.takeoff_count_mark_proposals p where p.answer_id = pg_temp.lavabo();
grant select on marks_by_key to authenticated, service_role;
create function pg_temp.m(key text) returns uuid language sql stable as $$ select id from marks_by_key where marks_by_key.key = $1 $$;
select results_eq($$select origin, x, y, position_revision, created_job_id, created_by from public.takeoff_count_marks
  where id = pg_temp.m('lav-1')$$, $$values ('machine'::text, 0.10::numeric, 0.20::numeric, 1, pg_temp.job(1), null::uuid)$$,
  'a machine mark names its job, its centre normalised in the visible page');
select results_eq($$select p.raw_centre, p.raw_frame, p.subtype, p.confidence, p.observation_id = o.id
  from public.takeoff_count_mark_proposals p join public.takeoff_item_answer_observations o on o.answer_id = pg_temp.lavabo()
    and o.ordinal = 1 where p.source_key = 'lav-1'$$,
  $$values (array[120, 340]::numeric[], 'tile:1'::text, 'Vasque (fictive)'::text, 0.8::numeric, true)$$,
  'its proposal keeps the reader''s raw centre, frame, subtype, confidence and observation');
select results_eq($$select g.page, g.rotation, g.width, g.height, g.plan_content_sha256 = pg_temp.digest(pg_temp.f(100)),
  g.plan_generation from public.takeoff_count_pages g where g.project_id = pg_temp.f(20) order by g.page$$,
  $$values (2, 0, 1190.55::numeric, 841.89::numeric, true, 'generation-fictive-1'::text),
    (7, 0, 1190.55::numeric, 841.89::numeric, true, 'generation-fictive-1'::text)$$,
  'each page of evidence names the plan''s bytes and generation as sealed, and its geometry');
select results_eq($$select t.state from public.takeoff_count_mark_attributions t where t.answer_id = pg_temp.lavabo()
  order by (select p.source_key from public.takeoff_count_mark_proposals p where p.mark_id = t.mark_id and p.answer_id = t.answer_id)$$,
  $$values ('proposed'::text), ('proposed'), ('proposed'), ('to_attribute')$$, 'the lavabo''s marks: three proposed, one to attribute');
select results_eq($$select t.state from public.takeoff_count_mark_attributions t where t.answer_id = pg_temp.vanne()$$,
  $$values ('proposed'::text)$$, 'the competing mark is also proposed for the valve');

-- The same publication again: the same answer, nothing more written; another content for that generation: refused.
select results_eq($$select (pg_temp.publish_marks(901, 1, pg_temp.pages(), pg_temp.generation_1()) - 'replayed')
  = (select answer - 'replayed' from published), (pg_temp.publish_marks(901, 1, pg_temp.pages(), pg_temp.generation_1()) ->> 'replayed')::boolean$$,
  $$values (true, true)$$, 'a replay answers the same, replayed');
select is(pg_temp.counts(), array[2, 4, 5, 5, 3, 1], 'and writes nothing');
select throws_ok($$select pg_temp.publish_marks(901, 1, pg_temp.pages(), jsonb_build_array(pg_temp.mark(2, 0.11, 0.20,
  jsonb_build_array(pg_temp.proposal(300, 'lav-1')))))$$, '23505', 'TAKEOFF_MARKS_ALREADY_PUBLISHED',
  'another content for the same generation is refused');

-- 3. Machine marks alone: proposed, to check, no quantity.
select results_eq($$select s ->> 'state', (s ->> 'proposed')::integer, (s ->> 'to_attribute')::integer, (s ->> 'retained')::integer,
  (s ->> 'reread')::integer, s -> 'quantity', (s ->> 'scope_pages')::integer, (s ->> 'revision')::integer
  from (select private.takeoff_count_mark_summary(pg_temp.lavabo()) s) x$$,
  $$values ('to_check'::text, 3, 1, 0, 0, 'null'::jsonb, 2, 1)$$, 'machine marks alone are to check, with no quantity');
select results_eq($$select s ->> 'state', (s ->> 'revision')::integer, (s ->> 'scope_pages')::integer
  from (select private.takeoff_count_mark_summary(pg_temp.baignoire()) s) x$$, $$values ('none'::text, 0, 2)$$,
  'an answer without marks has none');

-- 1 (reading). The readers of the affaire read the marks, paged with the server's total; nobody else does.
select pg_temp.sign_in(3);
set local role authenticated;
select results_eq($$select (r ->> 'total')::integer, (r ->> 'loaded')::integer, (r ->> 'revision')::integer, r #>> '{geometry,rotation}',
  r -> 'next_after' from (select public.read_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2) r) x$$,
  $$values (3, 3, 1, '0'::text, 'null'::jsonb)$$, 'a director reads the lavabo''s three marks of page 2 and its revision');
select results_eq($$select (r ->> 'total')::integer, (r ->> 'loaded')::integer, r ->> 'next_after' is not null
  from (select public.read_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2, null, null, 2) r) x$$,
  $$values (3, 2, true)$$, 'a page of two tells the total apart from the number loaded, and where to go on');
select results_eq($$select (r ->> 'total')::integer, (r ->> 'loaded')::integer, r -> 'next_after'
  from (select public.read_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2, null,
    (public.read_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2, null, null, 2) ->> 'next_after')::uuid, 2) r) x$$,
  $$values (3, 1, 'null'::jsonb)$$, 'the next page holds the last one');
select results_eq($$select m ->> 'state', jsonb_array_length(m -> 'proposals'), m #>> '{others,0,state}', m #>> '{others,0,answer_id}'
  from jsonb_array_elements(public.read_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2) -> 'marks') m
  where (m ->> 'mark_id')::uuid = pg_temp.m('lav-3')$$,
  $$values ('proposed'::text, 2, 'proposed'::text, pg_temp.vanne()::text)$$,
  'a competing mark tells its other item''s attribution and both proposals');
select is((select count(*)::integer from public.takeoff_count_marks), 4, 'a director reads the marks through the table too');
select is(public.read_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 5), null,
  'a page outside the answer''s scope has nothing');
select is((select count(*)::integer from public.read_takeoff_count_mark_summaries(pg_temp.f(10), pg_temp.f(20),
  array[pg_temp.lavabo(), pg_temp.vanne(), pg_temp.baignoire()])), 3, 'and the server''s count of each answer');
reset role;
select pg_temp.sign_in(2);
set local role authenticated;
select is(public.read_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2), null,
  'an engineer who does not own the affaire reads nothing');
select is((select count(*)::integer from public.takeoff_count_mark_attributions), 0, 'not even through the table');
reset role;
select pg_temp.sign_in(5);
set local role authenticated;
select is(public.read_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2), null, 'another tenant reads nothing');
select is((select count(*)::integer from public.read_takeoff_count_mark_summaries(pg_temp.f(10), pg_temp.f(20),
  array[pg_temp.lavabo()])), 0, 'nor its count');
reset role;

-- 4. The edit. Its callers: an operator of the affaire only.
create function pg_temp.edit(intent integer, revisions jsonb, gestures jsonb, project integer default 20) returns jsonb
language sql as $$
  select public.edit_takeoff_count_marks(pg_temp.f(10), pg_temp.f(project), pg_temp.f(intent), revisions, gestures)
$$;
create function pg_temp.at(answer uuid, revision integer) returns jsonb language sql immutable as $$
  select jsonb_build_object(answer::text, revision)
$$;
create function pg_temp.g(op text, fields jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('op', op) || fields
$$;
create function pg_temp.retain(answer uuid, mark uuid) returns jsonb language sql immutable as $$
  select pg_temp.g('retain', jsonb_build_object('answer_id', answer, 'mark_id', mark))
$$;
select pg_temp.sign_in(2);
set local role authenticated;
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.retain(pg_temp.lavabo(),
  pg_temp.m('lav-1'))))$$, '42501', 'TAKEOFF_MARKS_FORBIDDEN', 'an engineer who does not own the affaire edits nothing');
reset role;
select pg_temp.sign_in(3);
set local role authenticated;
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.retain(pg_temp.lavabo(),
  pg_temp.m('lav-1'))))$$, '42501', 'TAKEOFF_MARKS_FORBIDDEN', 'nor does a director, who reads');
reset role;
select pg_temp.sign_in(5);
set local role authenticated;
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.retain(pg_temp.lavabo(),
  pg_temp.m('lav-1'))))$$, '42501', 'TAKEOFF_MARKS_FORBIDDEN', 'nor another tenant''s admin');
reset role;

-- Each refusal of the owner's edit, with its code, nothing written.
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), '[]'::jsonb)$$, '22023', 'TAKEOFF_MARKS_INVALID',
  'an edit has one gesture at least');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(
  pg_temp.g('verify', jsonb_build_object('answer_id', pg_temp.lavabo(), 'pages', '[2]'::jsonb)), pg_temp.retain(pg_temp.lavabo(),
  pg_temp.m('lav-1'))))$$, '22023', 'TAKEOFF_MARKS_INVALID', 'a verification comes after every change of its command');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.g('remove',
  jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-1'), 'reason', 'other')))) $$, '22023',
  'TAKEOFF_MARKS_INVALID', 'removing for another reason asks for its note');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.retain(pg_temp.vanne(),
  pg_temp.m('lav-3'))))$$, '22023', 'TAKEOFF_MARKS_INVALID', 'a gesture on an answer the edit does not name is refused');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.retain(pg_temp.lavabo(),
  pg_temp.m('lav-1'))), 22)$$, 'P0002', 'TAKEOFF_MARKS_ANSWER_NOT_FOUND', 'an answer of another affaire is not found');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 0), jsonb_build_array(pg_temp.retain(pg_temp.lavabo(),
  pg_temp.m('lav-1'))))$$, '40001', 'TAKEOFF_MARKS_REVISION_CONFLICT', 'a stale expected revision is a conflict');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.g('move',
  jsonb_build_object('mark_id', pg_temp.m('lav-3'), 'x', 0.51, 'y', 0.25))))$$, '40001', 'TAKEOFF_MARKS_REVISION_CONFLICT',
  'moving a mark the valve holds too changes the valve: the edit must name it');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.g('verify',
  jsonb_build_object('answer_id', pg_temp.lavabo(), 'pages', '[2]'::jsonb))))$$, '22023', 'TAKEOFF_MARKS_UNDECIDED',
  'a page with marks still proposed cannot be verified');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.g('restore',
  jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-1')))))$$, '22023', 'TAKEOFF_MARKS_STATE_INVALID',
  'a mark not removed cannot be restored');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.baignoire(), 0), jsonb_build_array(pg_temp.retain(pg_temp.baignoire(),
  pg_temp.m('lav-1'))))$$, 'P0002', 'TAKEOFF_MARKS_MARK_NOT_FOUND', 'a mark the bathtub has no proposal for is not its to retain');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.g('add',
  jsonb_build_object('answer_id', pg_temp.lavabo(), 'key', pg_temp.f(700), 'page', 5, 'x', 0.5, 'y', 0.5))))$$, '22023',
  'TAKEOFF_MARKS_PAGE_OUTSIDE', 'a mark on a page the answer did not read is refused');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.g('add',
  jsonb_build_object('answer_id', pg_temp.lavabo(), 'key', pg_temp.f(700), 'page', 2, 'x', 0.5, 'y', 0.5,
    'geometry', pg_temp.geometry(90)))))$$, '22023', 'TAKEOFF_MARKS_PAGE_GEOMETRY_CONFLICT',
  'a page''s geometry is the one it was first given');
select throws_ok($$select pg_temp.edit(600, pg_temp.at(pg_temp.lavabo(), 1) || pg_temp.at(pg_temp.baignoire(), 0),
  jsonb_build_array(pg_temp.g('reattribute', jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-1'),
    'to_answer_id', pg_temp.baignoire()))))$$, '22023', 'TAKEOFF_MARKS_TARGET_INCOMPATIBLE',
  'a mark counted in units cannot go to an item of another unit');
reset role;
select is(pg_temp.counts(), array[2, 4, 5, 5, 3, 1], 'no refused edit wrote anything');

-- The owner's first session: retain two lavabos and the competing mark, remove a duplicate and the mark to attribute,
-- add one lavabo on each page, verify both pages: all in one command.
select pg_temp.sign_in(1);
set local role authenticated;
create temp table first_edit as select pg_temp.edit(601, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(
  pg_temp.retain(pg_temp.lavabo(), pg_temp.m('lav-1')),
  pg_temp.g('remove', jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-2'), 'reason', 'duplicate')),
  pg_temp.retain(pg_temp.lavabo(), pg_temp.m('lav-3')),
  pg_temp.g('add', jsonb_build_object('answer_id', pg_temp.lavabo(), 'key', pg_temp.f(701), 'page', 2, 'x', 0.70, 'y', 0.70,
    'box', jsonb_build_array(0.69, 0.69, 0.71, 0.71))),
  pg_temp.g('remove', jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-4'), 'reason', 'legend_or_detail')),
  pg_temp.g('add', jsonb_build_object('answer_id', pg_temp.lavabo(), 'key', pg_temp.f(702), 'page', 7, 'x', 0.20, 'y', 0.80)),
  pg_temp.g('verify', jsonb_build_object('answer_id', pg_temp.lavabo(), 'pages', '[2, 7]'::jsonb)))) as answer;
reset role;
grant select on first_edit to authenticated;
select results_eq($$select (answer ->> 'replayed')::boolean, answer -> 'revisions', jsonb_array_length(answer -> 'added')
  from first_edit$$, $$values (false, pg_temp.at(pg_temp.lavabo(), 2), 2)$$,
  'the edit is accepted: the lavabo at revision 2, two marks added');
insert into marks_by_key select 'added-' || (a ->> 'key'), (a ->> 'mark_id')::uuid
from first_edit, jsonb_array_elements(answer -> 'added') a;
select results_eq($$select s ->> 'state', (s ->> 'proposed')::integer, (s ->> 'to_attribute')::integer, (s ->> 'retained')::integer,
  (s ->> 'removed')::integer, (s ->> 'reread')::integer, (s ->> 'quantity')::integer, (s ->> 'verified_pages')::integer
  from (select first_edit.answer #> array['summaries', pg_temp.lavabo()::text] s from first_edit) x$$,
  $$values ('verified'::text, 0, 0, 4, 2, 4, 4, 2)$$,
  'four marks retained on a verified scope: a verified count of 4');
select is((select quantity from public.takeoff_item_answers where id = pg_temp.lavabo()), 3::numeric,
  'lot 4''s grouped total of the same scope stays 3, never added to the marks (which would give 7)');
select results_eq($$select (p ->> 'page')::integer, (p ->> 'retained')::integer, p ->> 'state'
  from jsonb_array_elements(private.takeoff_count_mark_summary(pg_temp.lavabo()) -> 'pages') p$$,
  $$values (2, 3, 'verified'::text), (7, 1, 'verified')$$, 'by page: three on page 2, one on page 7');
select results_eq($$select origin, created_by, x from public.takeoff_count_marks where id = pg_temp.m('added-' || pg_temp.f(701))$$,
  $$values ('manual'::text, pg_temp.f(1), 0.70::numeric)$$, 'a mark added by hand names its author');
select results_eq($$select t.state, t.prior_state, t.reason_code, t.decided_by from public.takeoff_count_mark_attributions t
  where t.answer_id = pg_temp.lavabo() and t.mark_id = pg_temp.m('lav-2')$$,
  $$values ('removed'::text, 'proposed'::text, 'duplicate'::text, pg_temp.f(1))$$, 'a removal keeps its reason, author and prior state');
select results_eq($$select private.takeoff_count_mark_summary(pg_temp.vanne()) ->> 'state',
  (private.takeoff_count_mark_summary(pg_temp.vanne()) ->> 'proposed')::integer, private.takeoff_count_marks_revision(pg_temp.vanne())$$,
  $$values ('to_check'::text, 1, 1)$$, 'the valve is untouched: its competing mark is still proposed for it');
select results_eq($$select gesture, ordinal, actor_kind, actor_id, revision from public.takeoff_count_mark_events
  where answer_id = pg_temp.lavabo() order by revision, ordinal$$,
  $$values ('proposed'::text, 1, 'worker'::text, null::uuid, 1), ('proposed', 2, 'worker', null, 1),
    ('retain', 1, 'member', pg_temp.f(1), 2), ('remove', 2, 'member', pg_temp.f(1), 2), ('retain', 3, 'member', pg_temp.f(1), 2),
    ('add', 4, 'member', pg_temp.f(1), 2), ('remove', 5, 'member', pg_temp.f(1), 2), ('add', 6, 'member', pg_temp.f(1), 2),
    ('verify', 7, 'member', pg_temp.f(1), 2), ('verify', 8, 'member', pg_temp.f(1), 2)$$,
  'the journal: the worker''s generation, then each gesture of the member in order');
select is((select count(*)::integer from public.takeoff_count_mark_events e where e.answer_id = pg_temp.lavabo()
  and (e.previous_event_id is null) <> (e.revision = 1 and e.ordinal = 1)), 0, 'each event names the answer''s previous one');
select is((select count(*)::integer from public.takeoff_count_mark_events e where e.answer_id = pg_temp.lavabo()
  and e.previous_event_id is not null and not exists (select 1 from public.takeoff_count_mark_events p
    where p.id = e.previous_event_id and (p.revision, p.ordinal) < (e.revision, e.ordinal))), 0,
  'and that one came before it');
select results_eq($$select kind, actor_id, revisions from public.takeoff_count_mark_commands where intent_key = pg_temp.f(601)$$,
  $$values ('edit'::text, pg_temp.f(1), jsonb_build_object(pg_temp.lavabo()::text, jsonb_build_object('expected', 1, 'new', 2)))$$,
  'the command names its member and the revisions before and after');

-- The same intention again: the same answer, nothing written; another content or another member under it: refused.
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select (r ->> 'replayed')::boolean, r -> 'revisions', r -> 'added' from (select pg_temp.edit(601,
  pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(
  pg_temp.retain(pg_temp.lavabo(), pg_temp.m('lav-1')),
  pg_temp.g('remove', jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-2'), 'reason', 'duplicate')),
  pg_temp.retain(pg_temp.lavabo(), pg_temp.m('lav-3')),
  pg_temp.g('add', jsonb_build_object('answer_id', pg_temp.lavabo(), 'key', pg_temp.f(701), 'page', 2, 'x', 0.70, 'y', 0.70,
    'box', jsonb_build_array(0.69, 0.69, 0.71, 0.71))),
  pg_temp.g('remove', jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-4'), 'reason', 'legend_or_detail')),
  pg_temp.g('add', jsonb_build_object('answer_id', pg_temp.lavabo(), 'key', pg_temp.f(702), 'page', 7, 'x', 0.20, 'y', 0.80)),
  pg_temp.g('verify', jsonb_build_object('answer_id', pg_temp.lavabo(), 'pages', '[2, 7]'::jsonb)))) r) x$$,
  $$select true, answer -> 'revisions', answer -> 'added' from first_edit$$, 'the same intention replays its answer');
select throws_ok($$select pg_temp.edit(601, pg_temp.at(pg_temp.lavabo(), 1), jsonb_build_array(pg_temp.retain(pg_temp.lavabo(),
  pg_temp.m('lav-1'))))$$, '23505', 'TAKEOFF_MARKS_INTENT_CONFLICT', 'another content under the same intention is refused');
reset role;
select pg_temp.sign_in(4);
set local role authenticated;
select throws_ok($$select pg_temp.edit(601, pg_temp.at(pg_temp.lavabo(), 2), jsonb_build_array(pg_temp.retain(pg_temp.lavabo(),
  pg_temp.m('lav-1'))))$$, '23505', 'TAKEOFF_MARKS_INTENT_CONFLICT', 'as is another member reusing it');
reset role;
select is(pg_temp.counts(), array[2, 6, 5, 7, 11, 2], 'the replay and the refusals wrote nothing');

-- What a review decision compares (lot 4, B2): whether the marks changed since the revision its acceptance recorded.
select pg_temp.sign_in(3);
set local role authenticated;
select results_eq($$select public.takeoff_count_marks_changed_since(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2),
  public.takeoff_count_marks_changed_since(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 1)$$, $$values (false, true)$$,
  'a reader learns whether the marks changed since a revision');
reset role;
select pg_temp.sign_in(5);
set local role authenticated;
select is(public.takeoff_count_marks_changed_since(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2), null,
  'another tenant learns nothing');
reset role;
select is(private.lock_takeoff_count_marks_revision(pg_temp.baignoire()), 0,
  'the locking form gives 0 for an answer without marks, and ensures its row');

-- A correction at the same count: one mark moved keeps its identity, its earlier coordinates are in the journal, and the
-- verification of its page is to do again; the quantity is withheld until then.
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select (r -> 'revisions') = pg_temp.at(pg_temp.lavabo(), 3), r #>> array['summaries', pg_temp.lavabo()::text, 'state'],
  r #> array['summaries', pg_temp.lavabo()::text, 'quantity'], (r #>> array['summaries', pg_temp.lavabo()::text, 'retained'])::integer
  from (select pg_temp.edit(602, pg_temp.at(pg_temp.lavabo(), 2), jsonb_build_array(pg_temp.g('move',
    jsonb_build_object('mark_id', pg_temp.m('lav-1'), 'x', 0.12, 'y', 0.21)))) r) x$$,
  $$values (true, 'to_verify_again'::text, 'null'::jsonb, 4)$$,
  'a move at the same count reopens the verification: to verify again, no quantity');
reset role;
select results_eq($$select id = pg_temp.m('lav-1'), x, y, position_revision, moved_by from public.takeoff_count_marks
  where id = pg_temp.m('lav-1')$$, $$values (true, 0.12::numeric, 0.21::numeric, 2, pg_temp.f(1))$$,
  'the mark keeps its identity, at its new place');
select results_eq($$select before, after from public.takeoff_count_mark_events where answer_id = pg_temp.lavabo() and gesture = 'move'$$,
  $$values ('{"x": 0.10, "y": 0.20, "box": null}'::jsonb, '{"x": 0.12, "y": 0.21, "box": null}'::jsonb)$$,
  'the journal keeps its earlier coordinates');
select results_eq($$select x, y from public.takeoff_count_mark_proposals where source_key = 'lav-1'$$,
  $$values (0.10::numeric, 0.20::numeric)$$, 'and its proposal keeps the reader''s');
select results_eq($$select (p ->> 'page')::integer, p ->> 'state' from jsonb_array_elements(private.takeoff_count_mark_summary(
  pg_temp.lavabo()) -> 'pages') p$$, $$values (2, 'to_verify_again'::text), (7, 'verified')$$,
  'only the page it changed is to verify again');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select r #>> array['summaries', pg_temp.lavabo()::text, 'state'],
  (r #>> array['summaries', pg_temp.lavabo()::text, 'quantity'])::integer
  from (select pg_temp.edit(603, pg_temp.at(pg_temp.lavabo(), 3), jsonb_build_array(pg_temp.g('verify',
    jsonb_build_object('answer_id', pg_temp.lavabo(), 'pages', '[2]'::jsonb)))) r) x$$,
  $$values ('verified'::text, 4)$$, 'once page 2 is verified again, the count is back');

-- The last marks removed: no retained quantity (a SQL NULL), never a written zero.
select results_eq($$select r #>> array['summaries', pg_temp.lavabo()::text, 'state'],
  r #> array['summaries', pg_temp.lavabo()::text, 'quantity'], (r #>> array['summaries', pg_temp.lavabo()::text, 'retained'])::integer
  from (select pg_temp.edit(604, pg_temp.at(pg_temp.lavabo(), 4), jsonb_build_array(
    pg_temp.g('remove', jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-1'), 'reason', 'duplicate')),
    pg_temp.g('remove', jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-3'), 'reason', 'not_this_item')),
    pg_temp.g('remove', jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('added-' || pg_temp.f(701)),
      'reason', 'outside_scope')),
    pg_temp.g('remove', jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('added-' || pg_temp.f(702)),
      'reason', 'other', 'note', 'Repère posé par erreur (fictif).')),
    pg_temp.g('verify', jsonb_build_object('answer_id', pg_temp.lavabo(), 'pages', '[2, 7]'::jsonb)))) r) x$$,
  $$values ('no_mark_retained'::text, 'null'::jsonb, 0)$$, 'the last marks removed leave no retained quantity: null, never 0');
-- Undoing is the inverse gesture under the revision check: the mark comes back to the state it had.
select results_eq($$select r #>> array['summaries', pg_temp.lavabo()::text, 'state'],
  (r #>> array['summaries', pg_temp.lavabo()::text, 'retained'])::integer
  from (select pg_temp.edit(605, pg_temp.at(pg_temp.lavabo(), 5), jsonb_build_array(pg_temp.g('restore',
    jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-1'))))) r) x$$,
  $$values ('to_verify_again'::text, 1)$$, 'restoring a mark brings it back retained, and its page is to verify again');
reset role;
select results_eq($$select state, prior_state, reason_code from public.takeoff_count_mark_attributions
  where answer_id = pg_temp.lavabo() and mark_id = pg_temp.m('lav-1')$$, $$values ('retained'::text, null::text, null::text)$$,
  'its removal is undone');

-- Reattributing locks and changes both answers: removed from the lavabo (reattributed), retained for the valve.
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select r -> 'revisions' from (select pg_temp.edit(606, pg_temp.at(pg_temp.lavabo(), 6)
  || pg_temp.at(pg_temp.vanne(), 1), jsonb_build_array(pg_temp.g('reattribute', jsonb_build_object('answer_id', pg_temp.lavabo(),
  'mark_id', pg_temp.m('lav-1'), 'to_answer_id', pg_temp.vanne())))) r) x$$,
  $$values (pg_temp.at(pg_temp.lavabo(), 7) || pg_temp.at(pg_temp.vanne(), 2))$$, 'both answers change');
reset role;
select results_eq($$select answer_id = pg_temp.lavabo(), state, reason_code from public.takeoff_count_mark_attributions
  where mark_id = pg_temp.m('lav-1') order by answer_id = pg_temp.lavabo() desc$$,
  $$values (true, 'removed'::text, 'reattributed'::text), (false, 'retained', null)$$,
  'the object counts for the valve only');
select results_eq($$select gesture, before ->> 'from_answer_id' from public.takeoff_count_mark_events
  where answer_id = pg_temp.vanne() and revision = 2$$, $$values ('reattribute_in'::text, pg_temp.lavabo()::text)$$,
  'the valve''s journal tells where it came from');
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select pg_temp.edit(607, pg_temp.at(pg_temp.lavabo(), 7), jsonb_build_array(pg_temp.g('restore',
  jsonb_build_object('answer_id', pg_temp.lavabo(), 'mark_id', pg_temp.m('lav-1')))))$$, '23505', 'TAKEOFF_MARKS_ATTRIBUTION_TAKEN',
  'restoring it for the lavabo while the valve holds it is refused: one effective item per object');
-- Moving a mark two answers hold changes both.
select results_eq($$select r -> 'revisions' from (select pg_temp.edit(608, pg_temp.at(pg_temp.lavabo(), 7)
  || pg_temp.at(pg_temp.vanne(), 2), jsonb_build_array(pg_temp.g('move', jsonb_build_object('mark_id', pg_temp.m('lav-3'),
  'x', 0.52, 'y', 0.26)))) r) x$$, $$values (pg_temp.at(pg_temp.lavabo(), 8) || pg_temp.at(pg_temp.vanne(), 3))$$,
  'a mark the lavabo (removed) and the valve (proposed) hold is moved for both');
reset role;

-- 5. A later machine generation: the lavabo, already reviewed, keeps its marks (the generation waits there, pending);
-- the bathtub, untouched, takes it.
create temp table second_generation as select pg_temp.publish_marks(901, 2, '[]'::jsonb, jsonb_build_array(
  pg_temp.mark(2, 0.90, 0.90, jsonb_build_array(pg_temp.proposal(300, 'lav-g2-1'))),
  pg_temp.mark(7, 0.25, 0.35, jsonb_build_array(pg_temp.proposal(302, 'bai-g2-1'))))) as answer;
select results_eq($$select (a ->> 'answer_id')::uuid, (a ->> 'effective')::boolean, (a ->> 'revision')::integer
  from second_generation, jsonb_array_elements(answer -> 'answers') a order by (a ->> 'effective')::boolean$$,
  $$values (pg_temp.lavabo(), false, 8), (pg_temp.baignoire(), true, 1)$$,
  'the reviewed lavabo keeps its revision; the bathtub takes the generation');
insert into marks_by_key select p.source_key, p.mark_id from public.takeoff_count_mark_proposals p where p.generation = 2;
select results_eq($$select s ->> 'state', (s ->> 'pending')::integer, (s ->> 'retained')::integer
  from (select private.takeoff_count_mark_summary(pg_temp.lavabo()) s) x$$, $$values ('to_verify_again'::text, 1, 0)$$,
  'the lavabo''s count is unchanged, one mark pending');
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select (r ->> 'total')::integer, r #>> '{marks,0,state}' from (select public.read_takeoff_count_marks(pg_temp.f(10),
  pg_temp.f(20), pg_temp.lavabo(), 2, array['pending']) r) x$$, $$values (1, 'pending'::text)$$, 'a reader finds it pending');
select throws_ok($$select pg_temp.edit(609, pg_temp.at(pg_temp.lavabo(), 8), jsonb_build_array(pg_temp.g('move',
  jsonb_build_object('mark_id', pg_temp.m('lav-g2-1'), 'x', 0.91, 'y', 0.9))))$$, '22023', 'TAKEOFF_MARKS_STATE_INVALID',
  'a pending mark is retained before it is moved');
select results_eq($$select r #>> array['summaries', pg_temp.lavabo()::text, 'pending'],
  r #>> array['summaries', pg_temp.lavabo()::text, 'retained']
  from (select pg_temp.edit(609, pg_temp.at(pg_temp.lavabo(), 8), jsonb_build_array(pg_temp.retain(pg_temp.lavabo(),
    pg_temp.m('lav-g2-1')))) r) x$$, $$values ('0'::text, '1'::text)$$, 'retained one by one, it counts');
reset role;

-- 6. A replaced reading's marks are history. A second reading of the plan replaces the first answers.
select results_eq($$select outcome from pg_temp.launch(2)$$, $$values ('admitted'::text)$$, 'a second reading is admitted');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(2), 'its plan is handed');
select is(pg_temp.claim(pg_temp.job(2), 903), 1, 'and claimed');
select is(pg_temp.publish_answers(2, 903), 3, 'it is published');
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select pg_temp.edit(610, pg_temp.at(pg_temp.lavabo(), 9), jsonb_build_array(pg_temp.g('add',
  jsonb_build_object('answer_id', pg_temp.lavabo(), 'key', pg_temp.f(703), 'page', 2, 'x', 0.5, 'y', 0.5))))$$, '22023',
  'TAKEOFF_MARKS_ANSWER_REPLACED', 'a replaced reading''s marks are not edited');
select is((public.read_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo(), 2) ->> 'total')::integer, 1,
  'they stay readable');
reset role;

-- Nobody writes these relations directly.
set local role service_role;
select throws_ok($$insert into public.takeoff_count_marks (tenant_id, project_id, page_id, origin, x, y, position_revision, created_job_id)
  select tenant_id, project_id, id, 'machine', 0.5, 0.5, 1, pg_temp.job(1) from public.takeoff_count_pages limit 1$$, '42501',
  'TAKEOFF_MARKS_WRITER_REQUIRED', 'the service role writes no mark directly');
select throws_ok($$update public.takeoff_count_mark_attributions set state = 'retained' where answer_id = pg_temp.vanne()$$, '42501',
  'TAKEOFF_MARKS_WRITER_REQUIRED', 'nor an attribution');
select throws_ok($$update public.takeoff_count_answer_states set revision = 0$$, '42501', 'TAKEOFF_MARKS_WRITER_REQUIRED',
  'nor a revision');
reset role;
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$update public.takeoff_count_mark_attributions set state = 'retained'$$, '42501', null,
  'a member updates no attribution directly');
select throws_ok($$delete from public.takeoff_count_mark_events$$, '42501', null, 'nor deletes the journal');
reset role;
select throws_ok($$update public.takeoff_count_mark_events set reason_text = 'Réécrit (fictif).'$$, '42501',
  'TAKEOFF_MARKS_IMMUTABLE', 'the journal is never rewritten');
select throws_ok($$update public.takeoff_count_mark_proposals set confidence = 1$$, '42501', 'TAKEOFF_MARKS_IMMUTABLE',
  'nor a proposal');

-- Deleting the first job: its answers go with it, and so do their attributions, proposals and states; the journal stays,
-- readable; then the affaire takes everything. Every foreign key is checked, as a commit checks them.
create function pg_temp.delete_and_check(statement text) returns void language plpgsql as $$
begin
  execute statement;
  set constraints all immediate;
  set constraints all deferred;
end;
$$;
select lives_ok($$select pg_temp.delete_and_check(format('delete from public.takeoff_jobs where id = %L', pg_temp.job(1)))$$,
  'a job whose answers have marks is deleted with them');
select results_eq($$select (select count(*)::integer from public.takeoff_count_mark_attributions where project_id = pg_temp.f(20)),
  (select count(*)::integer from public.takeoff_count_mark_proposals where project_id = pg_temp.f(20)),
  (select count(*)::integer from public.takeoff_count_answer_states where project_id = pg_temp.f(20)),
  (select count(*)::integer from public.takeoff_count_mark_events where answer_id = pg_temp.lavabo()) > 0$$,
  $$values (0, 0, 0, true)$$, 'their attributions, proposals and states are gone; their journal stays');
select pg_temp.sign_in(3);
set local role authenticated;
select ok((select count(*) from public.read_takeoff_count_mark_events(pg_temp.f(10), pg_temp.f(20), pg_temp.lavabo())) > 0,
  'a reader still reads who did what');
reset role;
select lives_ok($$select pg_temp.delete_and_check(format('delete from public.estimate_projects where id = %L', pg_temp.f(20)))$$,
  'the affaire is deleted with every mark');
select is(pg_temp.counts(), array[0, 0, 0, 0, 0, 0], 'nothing of its marks is left');
select lives_ok($$select pg_temp.delete_and_check(format('delete from public.estimate_projects where id = %L', pg_temp.f(22)))$$,
  'an affaire without marks is deleted as before');

select * from finish();
rollback;
