-- Lot 5, PR 3b stage 2 (…_takeoff_item_acceptance_marks_revision.sql): an acceptance of the table of items taken on
-- counted marks that changed since is a decision to take again.
-- 1. The rule, private.takeoff_item_decision_effective, on its vectors: an acceptance stands while its positive rows are
--    verified and its marks revision is the answer's current one; an acceptance recorded without one counts as revision
--    0; any other decision is what it says.
-- 2. The command records, with an acceptance, the answer's marks revision; a correction of the marks (one retained mark,
--    the count unchanged elsewhere) makes the acceptance « none » for the table's readers, its facets and the command,
--    the line « pending », and the item can be accepted again, on the new revision; a set aside clears it and journals
--    it; a reinstatement gives back the acceptance bound to the marks it was taken on, so that a correction made while
--    it was set aside still asks a new decision.
-- 3. An answer without marks keeps its acceptance (revision 0 on both sides), as before this migration.
-- 4. What the table retains and what the send reads do not move: the rows, their verification, the answers' quantities.
-- Isolation justified: the rule and its readers are the database's; a journey cannot reach an acceptance on marks yet
-- (no screen accepts from the detail). All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5d00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5d00000-0000-4000-8000-000000000099' $$;
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
select pg_temp.f(n), 'acceptance-marks-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 5) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5d00000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Repères comptés (fictif)', 'acceptance-marks-test'),
  (pg_temp.f(11), 'Autre entreprise (fictive)', 'acceptance-marks-other-test');
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

-- The list of affaire 20: lavabo 300 (u), vanne 301 (u), a wall covering 302 (m2: a surface) in its revision 310; a
-- skirting 303 (m2) comes with the second order (revision 312, below), which drops 302.
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by) values
  (pg_temp.f(300), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1)),
  (pg_temp.f(301), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1)),
  (pg_temp.f(302), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1)),
  (pg_temp.f(303), pg_temp.f(10), pg_temp.f(20), 'manual', 2, pg_temp.f(1));
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by) values
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), 1, 'item_added', '{}', 3, repeat('1', 64), repeat('a', 64), pg_temp.f(311), pg_temp.f(1));
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin) values
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(300), 0, 'manual:lavabo', 'Lavabo (fictif)', 'u', 'manual', '{"kind":"manual"}'),
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(301), 1, 'manual:vanne', 'Vanne DN32 (fictive)', 'u', 'manual', '{"kind":"manual"}'),
  (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(302), 2, 'manual:revetement', 'Revêtement mural (fictif)', 'm2', 'manual', '{"kind":"manual"}');
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
create function pg_temp.manifest(project integer, list_revision integer default 310) returns jsonb language sql stable as $$
  select jsonb_build_object('format_version', 2, 'intent', 'initial',
    'order', (select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', r.id,
      'revision', r.revision, 'content_sha256', r.content_sha256, 'item_count', r.item_count))
      from public.takeoff_list_revisions r where r.id = pg_temp.f(list_revision)),
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
    pg_temp.manifest(20, case when round = 1 then 310 else 312 end), pg_temp.snapshot(20),
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
    jsonb_build_object('item_id', pg_temp.f(case when round = 1 then 302 else 303 end), 'outcome', 'not_found',
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

-- 1. The rule, on its vectors: (kind, a positive row unverified, the acceptance's marks revision, the answer's current
--    one) → the effective decision.
select results_eq($$select v.position, private.takeoff_item_decision_effective(v.kind, v.unverified, v.taken, v.current)
  from (values
    (1, 'accepted', false, 1, 1),
    (2, 'accepted', false, 1, 2),
    (3, 'accepted', true, 1, 1),
    (4, 'accepted', false, null, 0),
    (5, 'accepted', false, null, 1),
    (6, 'accepted', false, 0, 0),
    (7, 'accepted', false, 3, null),
    (8, 'set_aside', false, 1, 2),
    (9, 'set_aside', true, null, 0),
    (10, 'none', false, 1, 1),
    (11, null, false, null, 0)
  ) v(position, kind, unverified, taken, current) order by v.position$$,
  $$values (1, 'accepted'), (2, 'none'), (3, 'none'), (4, 'accepted'), (5, 'none'), (6, 'accepted'), (7, 'none'),
    (8, 'set_aside'), (9, 'set_aside'), (10, 'none'), (11, 'none')$$,
  'an acceptance stands while its rows are verified and its marks are those it was taken on; other decisions are kept');
select is(has_function_privilege(role_name, 'private.takeoff_item_decision_effective(text, boolean, integer, integer)', 'EXECUTE'),
  false, 'the rule: ' || role_name || ' cannot call it')
from unnest(array['authenticated', 'service_role', 'anon']) as role_name;
select col_is_null('public', 'takeoff_item_answer_decisions', 'marks_revision', 'the marks revision of a decision is nullable');
select table_privs_are('public', 'takeoff_item_answer_decisions', 'authenticated', array['SELECT'], 'members still only read the decisions');

-- The reading is published (the lavabo measured on pages 2 and 7, its rows' rules evaluated without a failure), then
-- its machine marks (generation 1: the lavabo and the valve take it, revision 1).
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb
where job_id = pg_temp.job(1);
create function pg_temp.answer(item integer) returns uuid language sql stable as $$
  select a.id from public.takeoff_item_answers a where a.item_id = pg_temp.f(item) and a.job_id = pg_temp.job(1)
$$;
create function pg_temp.lavabo() returns uuid language sql stable as $$ select pg_temp.answer(300) $$;
select is((pg_temp.publish_marks(901, 1, pg_temp.pages(), pg_temp.generation_1()) ->> 'marks')::integer, 4,
  'the generation is published: four marks');
select is(private.takeoff_count_marks_revision(pg_temp.lavabo()), 1, 'the lavabo''s marks are at revision 1');
create temp table marks_by_key as
  select p.source_key as key, p.mark_id as id from public.takeoff_count_mark_proposals p where p.answer_id = pg_temp.lavabo();
grant select on marks_by_key to authenticated;
create function pg_temp.m(key text) returns uuid language sql stable as $$ select id from marks_by_key where marks_by_key.key = $1 $$;

-- The review command and the table, in the owner's session (an engineer who owns the affaire: the writer of its list).
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
create function pg_temp.review(gesture text, key integer, extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select public.review_takeoff_items(pg_temp.f(10), pg_temp.f(20), jsonb_build_object('command_version', 1,
    'intent_key', pg_temp.f(key), 'gesture', gesture, 'scope', '{"kind":"affaire"}'::jsonb,
    'targets', jsonb_build_array(pg_temp.target(300)), 'apply', jsonb_build_array(pg_temp.f(300)), 'skipped', '[]'::jsonb) || extra)
$$;
-- The lavabo as the table reads it: the line's decision, its reading's decision document, the facet of pending items.
create function pg_temp.lavabo_line() returns table (line text, reading_decision text, pending integer) language sql as $$
  select t.decision, t.readings -> 0 -> 'decision' ->> 'kind',
    (select c.items from public.count_takeoff_item_table(pg_temp.f(10), pg_temp.f(20)) c
      where c.facet = 'decision' and c.value = 'pending')
  from public.read_takeoff_item_table(pg_temp.f(10), pg_temp.f(20), null, null, null, null, null, array[pg_temp.f(300)]) t
$$;
create function pg_temp.edit(intent integer, revision integer, gestures jsonb) returns jsonb language sql as $$
  select public.edit_takeoff_count_marks(pg_temp.f(10), pg_temp.f(20), pg_temp.f(intent),
    jsonb_build_object(pg_temp.lavabo()::text, revision), gestures)
$$;

select pg_temp.sign_in(1);
set local role authenticated;

-- 2. An acceptance records the marks revision it was taken on.
select is(pg_temp.review('accept_measured', 600) ->> 'outcome', 'applied', 'the lavabo is accepted');
select results_eq($$select kind, marks_revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.lavabo()$$,
  $$values ('accepted'::text, 1)$$, 'on the marks of revision 1');
-- The valve (uncertain) and the bathtub (not found) wait for a decision: two pending lines besides.
select results_eq($$select * from pg_temp.lavabo_line()$$, $$values ('accepted'::text, 'accepted'::text, 2)$$,
  'the table reads the acceptance');
-- What the table retains and the send reads once accepted: the lavabo's rows, verified.
reset role;
create temp table sent_inputs as select i.id, i.quantity, i.is_verified, i.is_excluded from public.takeoff_items i
  where i.job_id = pg_temp.job(1);
grant select on sent_inputs to authenticated;
set local role authenticated;

-- A correction of the marks (one mark retained): the acceptance is a decision to take again.
select is((pg_temp.edit(610, 1, jsonb_build_array(jsonb_build_object('op', 'retain', 'answer_id', pg_temp.lavabo(),
  'mark_id', pg_temp.m('lav-1')))) -> 'revisions' ->> pg_temp.lavabo()::text)::integer, 2, 'a mark is retained: revision 2');
select results_eq($$select * from pg_temp.lavabo_line()$$, $$values ('pending'::text, null::text, 3)$$,
  'the table reads no decision for the answer: the line is to decide, and counted so in its facet');
select results_eq($$select kind, marks_revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.lavabo()$$,
  $$values ('accepted'::text, 1)$$, 'the stored acceptance is not rewritten: it is read against the marks');
select results_eq($$select id, quantity, is_verified, is_excluded from public.takeoff_items where job_id = pg_temp.job(1) order by id$$,
  $$select id, quantity, is_verified, is_excluded from sent_inputs order by id$$,
  'the rows the table retains and the send reads are untouched by the marks');

-- The command reads the same rule: the lavabo can be accepted again, on the new revision.
select is(pg_temp.review('accept_measured', 611) ->> 'outcome', 'applied', 'the lavabo is accepted again');
select results_eq($$select kind, marks_revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.lavabo()$$,
  $$values ('accepted'::text, 2)$$, 'on the marks of revision 2');
select results_eq($$select line from pg_temp.lavabo_line()$$, $$values ('accepted'::text)$$, 'and the table reads it again');

-- A set aside clears it and journals it; a reinstatement gives the acceptance back with the revision it was taken on.
select is(pg_temp.review('set_aside', 612, '{"reason":"duplicate"}'::jsonb) ->> 'outcome', 'applied', 'the lavabo is set aside');
select results_eq($$select kind, marks_revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.lavabo()$$,
  $$values ('set_aside'::text, null::integer)$$, 'a set aside carries no marks revision');
select is((select e.before ->> 'marks_revision' from public.takeoff_item_review_events e where e.answer_id = pg_temp.lavabo()
  and e.event = 'set_aside' order by e.id desc limit 1), '2', 'its journal keeps the revision of the acceptance it replaced');
select is(pg_temp.review('reinstate', 613) ->> 'outcome', 'applied', 'the lavabo is reinstated');
select results_eq($$select kind, marks_revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.lavabo()$$,
  $$values ('accepted'::text, 2)$$, 'whole: its acceptance comes back on the marks it was taken on');
select results_eq($$select line from pg_temp.lavabo_line()$$, $$values ('accepted'::text)$$, 'which have not changed: it stands');
-- Set aside again, the marks corrected meanwhile, reinstated: the acceptance given back asks a new decision.
select is(pg_temp.review('set_aside', 614, '{"reason":"duplicate"}'::jsonb) ->> 'outcome', 'applied', 'set aside again');
select is((pg_temp.edit(615, 2, jsonb_build_array(jsonb_build_object('op', 'retain', 'answer_id', pg_temp.lavabo(),
  'mark_id', pg_temp.m('lav-2')))) -> 'revisions' ->> pg_temp.lavabo()::text)::integer, 3, 'a mark retained meanwhile: revision 3');
select is(pg_temp.review('reinstate', 616) ->> 'outcome', 'applied', 'reinstated');
select results_eq($$select kind, marks_revision from public.takeoff_item_answer_decisions where answer_id = pg_temp.lavabo()$$,
  $$values ('accepted'::text, 2)$$, 'its acceptance comes back on revision 2');
select results_eq($$select * from pg_temp.lavabo_line()$$, $$values ('pending'::text, null::text, 3)$$,
  'and the marks have changed since: a decision to take again');
reset role;

-- 3. An answer without marks: an acceptance on revision 0 (its state row created by the lock), as before.
select is(private.takeoff_count_marks_revision(pg_temp.answer(302)), 0, 'the bathtub has no marks');
select results_eq($$select private.takeoff_item_decision_effective('accepted', false, 0, private.takeoff_count_marks_revision(pg_temp.answer(302))),
  private.takeoff_item_decision_effective('accepted', false, null, private.takeoff_count_marks_revision(pg_temp.answer(302)))$$,
  $$values ('accepted'::text, 'accepted'::text)$$, 'an acceptance of an answer without marks stands, recorded or not');

select * from finish();
rollback;
