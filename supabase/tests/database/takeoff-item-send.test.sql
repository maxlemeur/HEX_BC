-- Lot 4, migration C (…_takeoff_item_send_writer.sql): the send of a plan by item, its storage and its writer.
-- Isolation justified: rights under RLS, the comparisons under the writer's locks, the quantities it computes and the
-- refusals before any write are the database's own guarantees, which a journey sees only in part. The two-session cases
-- are in takeoff-item-send-race.test.sql. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();


create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5700000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5700000-0000-4000-8000-000000000099' $$;
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
select pg_temp.f(n), 'item-send-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 5) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5700000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Envoi par poste (fictif)', 'item-send-test'),
  (pg_temp.f(11), 'Autre entreprise (fictive)', 'item-send-other-test');
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
  (pg_temp.f(330), pg_temp.f(10), pg_temp.f(22), pg_temp.f(320), 0, 'dpgf:wc', 'WC (fictif)', 'u', 'dpgf',
    jsonb_build_object('kind', 'dpgf', 'importId', pg_temp.f(340), 'rawRowId', pg_temp.f(341)));
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

-- The write plan the server builds (src/lib/takeoff/item-send-plan.ts), read here from what is stored, as the service
-- reads it before the member confirms: built as the owner (the private readers are no member's), kept in a table the
-- member's session reads.
create temp table plans (name text primary key, body jsonb not null, payload jsonb);
grant select on plans to authenticated, service_role;
create function pg_temp.document(p_project integer default 20) returns jsonb language sql immutable as $$
  select jsonb_build_object('plan_file_id', pg_temp.f(100 + p_project - 20), 'content_hash', pg_temp.digest(pg_temp.f(100 + p_project - 20)),
    'logical_document_id', null, 'file_name', 'plan-1.pdf')
$$;
create function pg_temp.answers_of(p_job uuid, p_project integer default 20) returns jsonb language sql stable as $$
  with pairs as (select p.* from private.takeoff_item_table_pairs(pg_temp.f(10), pg_temp.f(p_project), pg_temp.f(100 + p_project - 20)) as p)
  select coalesce(jsonb_agg(jsonb_build_object('item_id', a.item_id, 'answer_id', a.id, 'revision', a.content_sha256,
      'decision_revision', case when pair.decision_effective in ('accepted', 'set_aside') then pair.decision_revision end,
      'entry_revision', e.revision) order by a.item_id), '[]'::jsonb)
  from public.takeoff_item_answers as a left join pairs as pair on pair.answer_id = a.id
  left join public.takeoff_item_entries as e on e.item_id = a.item_id and e.plan_logical_id = a.plan_logical_id
  where a.job_id = p_job
$$;
-- The parts of an item, as the planner gives them (each with its quantitative identity).
create function pg_temp.parts(p_job uuid, p_item integer, p_project integer default 20) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('answer_id', s.answer_id, 'answer_revision', s.answer_revision, 'kind', s.kind,
      'observation_ids', case when s.observation_id is null then '[]'::jsonb else jsonb_build_array(s.observation_id) end,
      'quantity', s.quantity, 'unit', s.unit, 'pages', to_jsonb(s.pages),
      'identity', jsonb_build_object('unit', (private.normalize_unit(s.unit)).unit_code, 'basis', null, 'network', null,
        'material', null, 'diameter', null)) order by s.observation_id), '[]'::jsonb)
  from private.takeoff_item_send_job_parts(pg_temp.f(10), pg_temp.f(p_project), p_job, array[2, 7]) as s where s.item_id = pg_temp.f(p_item)
$$;
create function pg_temp.new_line(p_job uuid, p_item integer, p_quantity numeric, p_section text default 'list:',
  p_section_id uuid default null, p_project integer default 20) returns jsonb language sql stable as $$
  select jsonb_build_object('key', pg_temp.f(p_item) || '|together', 'item_id', pg_temp.f(p_item), 'compartment_key', 'together',
    'line', jsonb_build_object('kind', 'new_line', 'section_key', p_section, 'section_id', p_section_id,
      'title', (select e.label from public.takeoff_list_revision_entries e where e.item_id = pg_temp.f(p_item) limit 1),
      'unit_code', 'u', 'order', 1),
    'unit_code', 'u', 'quantity_after', p_quantity, 'quantity', jsonb_build_object('kept_entry', false), 'rule', null,
    'contributions', pg_temp.parts(p_job, p_item, p_project), 'replaces', '[]'::jsonb)
$$;
create function pg_temp.earlier_line(p_job uuid, p_item integer, p_line uuid, p_quantity numeric, p_kind text default 'earlier_line',
  p_compartment text default 'together', p_kept boolean default false, p_project integer default 20)
returns jsonb language sql stable as $$
  select jsonb_build_object('key', pg_temp.f(p_item) || '|' || p_compartment, 'item_id', pg_temp.f(p_item),
    'compartment_key', p_compartment,
    'line', jsonb_build_object('kind', p_kind, 'estimate_item_id', i.id, 'expected_updated_at', i.updated_at,
      'expected_quantity', i.quantity),
    'unit_code', 'u', 'quantity_after', p_quantity, 'quantity', jsonb_build_object('kept_entry', p_kept), 'rule', null,
    'contributions', pg_temp.parts(p_job, p_item, p_project),
    'replaces', coalesce((select jsonb_agg(jsonb_build_object('job_id', p.job_id, 'answer_id', p.answer_id,
        'observation_ids', to_jsonb(p.observation_ids), 'quantity', p.quantity) order by p.id)
      from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id = p.target_id
      where t.estimate_item_id = p_line and p.state = 'live' and p.plan_logical_id = pg_temp.f(100 + p_project - 20)), '[]'::jsonb))
  from public.estimate_items i where i.id = p_line
$$;
create function pg_temp.page_contributions(p_targets jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('page', g.page, 'item_ids', g.items, 'target_keys', g.keys,
      'observation_ids', g.observations) order by g.page), '[]'::jsonb)
  from (select (page.value #>> '{}')::integer as page, jsonb_agg(distinct t.value -> 'item_id') as items,
      jsonb_agg(distinct t.value -> 'key') as keys,
      coalesce(jsonb_agg(o.value) filter (where o.value is not null), '[]'::jsonb) as observations
    from jsonb_array_elements(p_targets) t(value)
    cross join lateral jsonb_array_elements(t.value -> 'contributions') c(value)
    cross join lateral jsonb_array_elements(c.value -> 'pages') page(value)
    left join lateral jsonb_array_elements(c.value -> 'observation_ids') o(value) on true
    group by 1) g
$$;
-- The settings a first draft would be created with, read by creating it in a block rolled back.
create function pg_temp.first_draft_settings(p_payload jsonb) returns jsonb language plpgsql as $$
declare
  settings jsonb;
begin
  begin
    perform public.persist_estimate_creation_atomic(pg_temp.f(10), pg_temp.f(1), pg_temp.f(20), null, p_payload, '[]'::jsonb, null);
    select jsonb_build_object('title', v.title, 'validite_jours', v.validite_jours, 'margin_multiplier', v.margin_multiplier,
      'margin_mode', v.margin_mode, 'currency', v.currency, 'margin_bp', v.margin_bp, 'discount_bp', v.discount_bp,
      'discount_amount_cents', v.discount_amount_cents, 'discount_mode', v.discount_mode, 'discount_steps', v.discount_steps,
      'global_coefficient', v.global_coefficient, 'tax_rate_bp', v.tax_rate_bp, 'rounding_mode', v.rounding_mode,
      'rounding_step_cents', v.rounding_step_cents, 'max_section_depth', v.max_section_depth,
      'calc_engine_version', v.calc_engine_version, 'contractor_role', v.contractor_role,
      'sale_coefficient_fo', v.sale_coefficient_fo, 'sale_coefficient_mo', v.sale_coefficient_mo)
      into settings from public.estimate_versions v where v.project_id = pg_temp.f(20);
    raise exception 'ITEM_SEND_TEST_PROBE';
  exception when others then
    if sqlerrm <> 'ITEM_SEND_TEST_PROBE' then
      raise;
    end if;
  end;
  return settings;
end;
$$;
create function pg_temp.payload(p_version integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', pg_temp.f(p_version), 'title', null, 'date_devis', '2026-11-22', 'validite_jours', 30,
    'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
    'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
    'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
    'contractor_role', 'principal', 'calc_engine_version', 3, 'gross_ht_cents', 0, 'discount_applied_cents', 0,
    'commercial_rounding_cents', 0, 'total_ht_cents', 0, 'total_tax_cents', 0, 'total_ttc_cents', 0)
$$;
-- The whole plan: its destination (a first draft from a payload, or an existing draft), its targets and sections, and
-- what it was computed from, read now.
create function pg_temp.plan(p_job uuid, p_version uuid, p_targets jsonb, p_sections jsonb default '[]'::jsonb,
  p_payload jsonb default null, p_project integer default 20) returns jsonb language sql as $$
  select jsonb_build_object('format', 'takeoff_item_send', 'version', 1, 'job_id', p_job, 'plan_key', pg_temp.f(100 + p_project - 20),
    'list', jsonb_build_object('revision_id', pg_temp.f(case when p_project = 22 then 330 else 310 end), 'revision', 1),
    'destination', case when p_version is null then jsonb_build_object('kind', 'first_draft')
      else jsonb_build_object('kind', 'existing_draft', 'version_id', p_version) end,
    'engine', 3, 'breakdown', 'together', 'sections', p_sections, 'targets', p_targets,
    'page_contributions', pg_temp.page_contributions(p_targets), 'page_decisions', '[]'::jsonb, 'left_out', '[]'::jsonb,
    'parts_not_sent', '[]'::jsonb,
    'dependencies', jsonb_build_object('answers', pg_temp.answers_of(p_job, p_project),
      'affaire_entries', coalesce((select jsonb_agg(jsonb_build_object('item_id', e.item_id, 'revision', e.revision))
        from public.takeoff_item_entries e where e.project_id = pg_temp.f(p_project) and e.plan_logical_id is null), '[]'::jsonb),
      'rules', '[]'::jsonb, 'location_generation', null, 'plan_pages', '[2, 7]'::jsonb,
      'earlier_targets', case when p_version is null then '[]'::jsonb
        else private.takeoff_item_send_earlier_targets(pg_temp.f(10), p_version) end,
      'lines', case when p_version is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('estimate_item_id', i.id,
          'updated_at', i.updated_at, 'quantity', i.quantity,
          'dpgf', case when i.source_provider = 'dpgf' then jsonb_build_object('import_id', null, 'raw_row_id', null,
            'reference', private.takeoff_item_send_dpgf_reference(pg_temp.f(10), i.source_metadata)) end) order by i.id)
        from public.estimate_items i where i.version_id = p_version and i.item_type = 'line'
          and (i.id in (select (t.value #>> '{line,estimate_item_id}')::uuid from jsonb_array_elements(p_targets) t(value))
            or i.id in (select t.estimate_item_id from public.takeoff_item_send_targets t where t.version_id = p_version))),
        '[]'::jsonb) end,
      'pages_in_estimate', case when p_version is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
          'page', h.value -> 'page', 'earlier_job_ids', h.value -> 'earlier_job_ids', 'estimate_item_ids', h.value -> 'estimate_item_ids')),
          '[]'::jsonb)
        from jsonb_array_elements(private.takeoff_item_send_held_pages(pg_temp.f(10), p_version, p_job, pg_temp.document(p_project),
          array[2, 7])) h(value)) end,
      'stamps', jsonb_build_object('job', public.takeoff_rule_job_stamp(pg_temp.f(10), pg_temp.f(p_project), p_job),
        'peers', case when p_version is not null then public.takeoff_send_peers_stamp(pg_temp.f(10), p_version) end,
        'context', (select jsonb_build_object('peers', s.stamps ->> 'peers', 'locations', s.stamps ->> 'locations')
          from (select private.takeoff_send_context_stamps(private.takeoff_send_context(pg_temp.f(10), pg_temp.f(p_project), p_job,
            p_version)) as stamps) s),
        'dpgf', case when p_version is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('import_id', i.id,
            'mapping_id', st.mapping_id, 'rows_sha256', st.rows_sha256, 'updated_at', i.updated_at, 'status', i.status,
            'row_count', i.row_count) order by i.id), '[]'::jsonb)
          from public.dpgf_imports i cross join lateral public.dpgf_import_review_state(pg_temp.f(10), i.id) st
          where i.tenant_id = pg_temp.f(10) and i.id in (select l.import_id from public.read_estimate_dpgf_raw_rows(pg_temp.f(10), p_version) l)) end,
        'first_draft_settings', case when p_version is null then pg_temp.first_draft_settings(p_payload) end,
        'destination', (select jsonb_build_object('version_id', v.id, 'status', v.status, 'updated_at', v.updated_at)
          from public.estimate_versions v where v.id = p_version),
        'mapping', public.takeoff_mapping_rules_stamp(pg_temp.f(10))),
      'resolutions', '[]'::jsonb))
$$;
-- The server's call: the service role, the member it authenticated (the signed-in test user) and its tenant, the plan
-- it rebuilt and, for a first draft, the payload « Créer un devis » prepares. A security definer stand-in for the route.
create function pg_temp.send(p_request integer, p_plan text, p_tenant uuid default null) returns jsonb
language sql security definer as $$
  select public.send_takeoff_item_plan(coalesce(p_tenant, pg_temp.f(10)),
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, false,
    jsonb_build_object('request_id', pg_temp.f(p_request), 'plan', p.body)
      || case when p.payload is null then '{}'::jsonb else jsonb_build_object('version_payload', p.payload) end)
  from plans p where p.name = p_plan
$$;
grant execute on function pg_temp.send(integer, text, uuid) to authenticated;
-- A refusal as the member reads it: its code, its name and the reason its detail gives; « none » when nothing refused.
-- Always run in its own block, rolled back: what it wrote is undone, whether it refused or not.
create function pg_temp.refusal(p_sql text) returns text language plpgsql as $$
declare
  state text;
  message text;
  detail text;
begin
  execute p_sql;
  raise exception 'ITEM_SEND_TEST_NO_REFUSAL';
exception when others then
  get stacked diagnostics state = returned_sqlstate, message = message_text, detail = pg_exception_detail;
  if message = 'ITEM_SEND_TEST_NO_REFUSAL' then
    return 'none';
  end if;
  return state || ' ' || message || coalesce(' ' || case when detail ~ '^\{' then detail::jsonb ->> 'reason' end, '');
end;
$$;
grant execute on function pg_temp.refusal(text) to authenticated;
-- What the writer leaves: every row of migration C and every line of the affaire's drafts.
create function pg_temp.footprint() returns text language sql stable as $$
  select concat_ws('/', (select count(*) from public.takeoff_item_send_receipts), (select count(*) from public.takeoff_item_send_targets),
    (select count(*) from public.takeoff_item_send_parts), (select count(*) from public.takeoff_item_send_parts where state = 'live'),
    (select count(*) from public.takeoff_item_send_sections), (select count(*) from public.takeoff_item_send_pages),
    (select count(*) from public.estimate_items i join public.estimate_versions v on v.id = i.version_id
      where v.project_id = pg_temp.f(20)),
    (select string_agg(i.id || ':' || i.quantity, ',' order by i.id) from public.estimate_items i
      join public.estimate_versions v on v.id = i.version_id where v.project_id = pg_temp.f(20) and i.item_type = 'line'))
$$;
-- A send that succeeds, rolled back at once: « sent », else its refusal.
create function pg_temp.tried(p_sql text) returns text language sql as $$
  select case when answer = 'none' then 'sent' else answer end from (select pg_temp.refusal(p_sql) as answer) as tried
$$;
grant execute on function pg_temp.tried(text) to authenticated;

-- 2. The first send of a plan: a first draft created, its section by its identity, one line for the lavabo (2 on page 2
--    and 1 on page 7: 3 u), the target, its parts, its pages, the receipt; the job linked and applied.
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('accept_measured', 600, array[300], array[300])) ->> 'outcome', 'applied',
  'the lavabo accepted in the table of items');
reset role;
insert into plans values ('first', pg_temp.plan(pg_temp.job(20, 1), null,
  jsonb_build_array(pg_temp.new_line(pg_temp.job(20, 1), 300, 3)),
  '[{"key": "list:", "title": "Métré", "parent_key": null, "parent_id": null}]'::jsonb, pg_temp.payload(700)), pg_temp.payload(700));
-- The writer is the server's: a member's session never calls it, nor submits a plan of its own.
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select public.send_takeoff_item_plan(pg_temp.f(10), pg_temp.f(1), false,
    jsonb_build_object('request_id', pg_temp.f(710), 'plan', (select body from plans where name = 'first'),
      'version_payload', pg_temp.payload(700)))$$), '42501 permission denied for function send_takeoff_item_plan',
  'a member''s session cannot call the writer');
reset role;
-- The first draft's settings: those « Créer un devis » gives under the tenant's policy, compared with the ones the plan
-- showed; the tenant's engine is read under its policy lock (point 12).
insert into plans select 'first_shown_otherwise', jsonb_set(body, '{dependencies,stamps,first_draft_settings,validite_jours}', '31'),
  payload from plans where name = 'first';
create function pg_temp.first_under_engine_2() returns jsonb language plpgsql security definer as $$
begin
  insert into public.tenant_calc_policies (tenant_id, new_estimate_calc_engine, change_reason)
  values (pg_temp.f(10), 2, 'Politique fictive')
  on conflict (tenant_id) do update set new_estimate_calc_engine = 2, change_reason = 'Politique fictive';
  return pg_temp.send(710, 'first');
end;
$$;
grant execute on function pg_temp.first_under_engine_2() to authenticated;
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(710, 'first_shown_otherwise')$$),
  '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE creation_policy_changed', 'a first draft other than the one the plan showed is refused');
select is(pg_temp.refusal($$select pg_temp.first_under_engine_2()$$), '40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED',
  'the tenant''s engine, read under its policy lock, decides the first draft as « Créer un devis » does');
reset role;
select pg_temp.sign_in(1);
set local role authenticated;
create temp table sent_first as select pg_temp.send(710, 'first') as answer;
reset role;
select is((select answer ->> 'replayed' from sent_first), 'false', 'the send answers its receipt');
select results_eq($$select v.calc_engine_version::integer, v.status::text from public.estimate_versions v where v.project_id = pg_temp.f(20)$$,
  $$values (3, 'draft'::text)$$, 'one first draft, engine 3');
select results_eq($$select i.item_type::text, i.title, i.quantity, i.unit_code, i.unit_price_ht_cents, i.source_provider
  from public.estimate_items i join public.estimate_versions v on v.id = i.version_id where v.project_id = pg_temp.f(20)
  order by i.item_type::text desc$$,
  $$values ('section'::text, 'Métré'::text, null::numeric, null::text, null::integer, 'manual'::text),
    ('line', 'Lavabo (fictif)', 3::numeric, 'u', 0, 'takeoff')$$, 'its section and its line of 3 u, without a price');
select results_eq($$select t.item_id, t.breakdown, t.compartment_key, t.line_kind, t.unit_code from public.takeoff_item_send_targets t$$,
  $$values (pg_temp.f(300), 'together'::text, 'together'::text, 'new_line'::text, 'u'::text)$$, 'the live target');
select results_eq($$select p.kind, p.quantity, p.pages, p.state from public.takeoff_item_send_parts p order by p.pages$$,
  $$values ('measured'::text, 2::numeric, array[2], 'live'::text), ('measured', 1, array[7], 'live')$$, 'its two parts');
select results_eq($$select g.page, g.item_ids, cardinality(g.part_ids) from public.takeoff_item_send_pages g order by g.page$$,
  $$values (2, array[pg_temp.f(300)], 1), (7, array[pg_temp.f(300)], 1)$$, 'one page contribution per page');
select results_eq($$select j.status::text, j.estimate_version_id is not null from public.takeoff_jobs j where j.id = pg_temp.job(20, 1)$$,
  $$values ('applied'::text, true)$$, 'the job is sent: linked and applied');
select results_eq($$select r.request_id, r.job_id, r.version_created, r.command_kind, r.actor_id, r.result ->> 'lines_written',
    r.result ->> 'parts_written', (r.result ->> 'focus_item_id')::uuid = (select t.estimate_item_id from public.takeoff_item_send_targets t)
  from public.takeoff_item_send_receipts r$$,
  $$values (pg_temp.f(710), pg_temp.job(20, 1), true, 'send'::text, pg_temp.f(1), '1'::text, '2'::text, true)$$,
  'one receipt: its request, its job, the version it created, its author, what it wrote, the line to open');
select is((select count(*)::integer from public.draft_locks l join public.estimate_versions v on v.id = l.version_id
  where v.project_id = pg_temp.f(20)), 0, 'the lease of the version it created lives only in its transaction');
create temp table footprint_first as select pg_temp.footprint() as value;

-- 3. The same request: the same plan answers the same receipt, nothing written twice; another plan, another member or
--    another job under it is a conflict; another request for the job finds it sent.
select pg_temp.sign_in(1);
set local role authenticated;
select is((select pg_temp.send(710, 'first') ->> 'replayed'), 'true', 'the same request and plan replay');
select is((select pg_temp.send(710, 'first') ->> 'receipt_id'), (select answer ->> 'receipt_id' from sent_first),
  'with the same receipt');
reset role;
insert into plans select 'first_other', jsonb_set(body, '{breakdown}', '"by_level"'), payload from plans where name = 'first';
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(710, 'first_other')$$), '40001 TAKEOFF_ITEM_SEND_REQUEST_CONFLICT',
  'the same request with another plan is a conflict');
select is(pg_temp.refusal($$select pg_temp.send(711, 'first')$$), '40001 TAKEOFF_ITEM_SEND_ALREADY_SENT',
  'another request finds the job sent, before anything else');
select pg_temp.sign_in(4);
select is(pg_temp.refusal($$select pg_temp.send(710, 'first')$$), '40001 TAKEOFF_ITEM_SEND_REQUEST_CONFLICT',
  'another member under the same request is a conflict');
reset role;
select is(pg_temp.footprint(), (select value from footprint_first), 'and nothing was written by them');

-- 4. Who may send: the affaire's takeoff operator of the active tenant. A NULL predicate refuses.
select pg_temp.sign_in(3);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(712, 'first')$$), '42501 TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE',
  'a director reads, never sends');
select pg_temp.sign_in(2);
select is(pg_temp.refusal($$select pg_temp.send(712, 'first')$$), '42501 TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE',
  'an engineer who does not own the affaire cannot send its plan');
select pg_temp.sign_in(5);
select is(pg_temp.refusal($$select pg_temp.send(712, 'first', pg_temp.f(11))$$), 'P0002 TAKEOFF_JOB_NOT_FOUND',
  'another tenant''s administrator does not find the job');
select is(pg_temp.refusal($$select pg_temp.send(712, 'first')$$), '42501 TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE',
  'nor sends in a tenant it is no member of');
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is(pg_temp.refusal($$select pg_temp.send(712, 'first')$$), '42501 TAKEOFF_ITEM_SEND_AUTH_REQUIRED',
  'no session, no send');
reset role;
select is(has_function_privilege('anon', 'public.send_takeoff_item_plan(uuid, uuid, boolean, jsonb)', 'EXECUTE'), false,
  'an anonymous client cannot send');
select is(has_function_privilege('authenticated', 'public.send_takeoff_item_plan(uuid, uuid, boolean, jsonb)', 'EXECUTE'), false,
  'nor a member''s session: the server calls it');
select is(has_function_privilege('service_role', 'public.send_takeoff_item_plan(uuid, uuid, boolean, jsonb)', 'EXECUTE'), true,
  'the server calls it, with the acting member');
select is(has_function_privilege('authenticated', fn, 'EXECUTE'), false, fn || ': no member''s')
from unnest(array['private.takeoff_item_send_job_parts(uuid, uuid, uuid, integer[])',
  'private.takeoff_item_send_held_pages(uuid, uuid, uuid, jsonb, integer[])',
  'private.takeoff_item_send_earlier_targets(uuid, uuid)', 'private.takeoff_item_send_plan_valid(jsonb)']) as fn;
select table_privs_are('public', relation, 'authenticated', array['SELECT'], relation || ': members only read')
from unnest(array['takeoff_item_send_receipts', 'takeoff_item_send_targets', 'takeoff_item_send_parts',
  'takeoff_item_send_sections', 'takeoff_item_send_pages']) as relation;
select table_privs_are('public', relation, 'anon', array[]::text[], relation || ': anonymous clients see nothing')
from unnest(array['takeoff_item_send_receipts', 'takeoff_item_send_targets', 'takeoff_item_send_parts',
  'takeoff_item_send_sections', 'takeoff_item_send_pages']) as relation;
select ok((select relrowsecurity from pg_class where oid = format('public.%I', relation)::regclass), relation || ': row level security')
from unnest(array['takeoff_item_send_receipts', 'takeoff_item_send_targets', 'takeoff_item_send_parts',
  'takeoff_item_send_sections', 'takeoff_item_send_pages']) as relation;
-- Read like the affaire: its director reads the targets and the parts, another tenant reads nothing.
select pg_temp.sign_in(3);
set local role authenticated;
select results_eq($$select (select count(*)::integer from public.takeoff_item_send_targets),
  (select count(*)::integer from public.takeoff_item_send_parts), (select count(*)::integer from public.takeoff_item_send_receipts)$$,
  $$values (1, 2, 1)$$, 'the affaire''s director reads the send');
select pg_temp.sign_in(5);
select results_eq($$select (select count(*)::integer from public.takeoff_item_send_targets),
  (select count(*)::integer from public.takeoff_item_send_parts)$$, $$values (0, 0)$$, 'another tenant reads nothing of it');
-- Nobody writes them directly: a member has no right, the service role none either, the owner outside the command
-- neither (the journal and the receipts never change, a row goes only with its version, its job or its affaire).
select pg_temp.sign_in(1);
select is(pg_temp.refusal($$update public.takeoff_item_send_parts set state = 'replaced'$$), '42501 permission denied for table takeoff_item_send_parts',
  'a member does not write a part');
reset role;
set local role service_role;
select is(pg_temp.refusal($$insert into public.takeoff_item_send_receipts default values$$), '42501 TAKEOFF_ITEM_SEND_WRITER_REQUIRED',
  'nor the service role, which keeps its table rights');
select is(pg_temp.refusal($$delete from public.takeoff_item_send_receipts$$), '42501 TAKEOFF_ITEM_SEND_IMMUTABLE',
  'and never removes a receipt');
reset role;
select is(pg_temp.refusal($$update public.takeoff_item_send_parts set quantity = 9$$), '42501 TAKEOFF_ITEM_SEND_WRITER_REQUIRED',
  'outside the command, a part never changes');
select is(pg_temp.refusal($$delete from public.takeoff_item_send_targets$$), '42501 TAKEOFF_ITEM_SEND_IMMUTABLE',
  'nor goes on its own');

-- 5. What is refused before any lock: a malformed request (a plan without targets, for another engine, a first draft
--    without its payload, a page decision without its decision), an override (no block of this send admits one).
insert into plans select 'no_targets', body - 'targets', payload from plans where name = 'first';
insert into plans select 'engine_2', jsonb_set(body, '{engine}', '2'), payload from plans where name = 'first';
insert into plans select 'no_payload', body, null from plans where name = 'first';
insert into plans select 'decision_without_decision', jsonb_set(body, '{page_decisions}', '[{"page": 2}]'), payload
from plans where name = 'first';
insert into plans select 'contribution_without_sources', jsonb_set(body, '{targets,0,contributions,0}',
  (body #> '{targets,0,contributions,0}') - 'observation_ids'), payload from plans where name = 'first';
create function pg_temp.send_with_override(p_request integer) returns jsonb language sql security definer as $$
  select public.send_takeoff_item_plan(pg_temp.f(10), pg_temp.f(1), false, jsonb_build_object('request_id', pg_temp.f(p_request),
    'plan', p.body, 'version_payload', p.payload, 'override', jsonb_build_object('reason_code', 'other',
      'justification', 'Forçage fictif demandé'))) from plans p where p.name = 'first'
$$;
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(713, 'no_targets')$$), '22023 TAKEOFF_ITEM_SEND_INVALID', 'a plan without targets');
select is(pg_temp.refusal($$select pg_temp.send(713, 'engine_2')$$), '22023 TAKEOFF_ITEM_SEND_INVALID', 'a plan for another engine');
select is(pg_temp.refusal($$select pg_temp.send(713, 'no_payload')$$), '22023 TAKEOFF_ITEM_SEND_INVALID',
  'a first draft without the server''s payload');
select is(pg_temp.refusal($$select pg_temp.send(713, 'decision_without_decision')$$), '22023 TAKEOFF_ITEM_SEND_INVALID',
  'point 3: a page decision without its decision is no decision');
select is(pg_temp.refusal($$select pg_temp.send(713, 'contribution_without_sources')$$), '22023 TAKEOFF_ITEM_SEND_INVALID',
  'point 3, the same NULL shape: a contribution without its sources is malformed, never judged further');
select is(pg_temp.refusal($$select pg_temp.send_with_override(713)$$), '22023 TAKEOFF_ITEM_SEND_OVERRIDE_NOT_ADMITTED',
  'an override is refused: no block of this send admits one');
reset role;

-- 6. The send by item refuses every job not read against a list: a job of the first order (no list), completed.
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, preparation_snapshot,
  source_file_name)
values (pg_temp.f(1900), pg_temp.f(10), pg_temp.f(21), pg_temp.f(41), 'C', 'completed', pg_temp.f(1), pg_temp.snapshot(21),
  'plan-1.pdf');
set local session_replication_role = origin;
insert into plans select 'free', jsonb_set(body, '{job_id}', to_jsonb(pg_temp.f(1900))), payload from plans where name = 'first';
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(714, 'free')$$), '22023 TAKEOFF_ITEM_SEND_NOT_ITEM_LIST',
  'a job of the first order is never sent by item');
reset role;

-- 7. A second reading of the same plan, sent to the draft the first created. Its rows: the lavabo 4 on page 2 (a
--    correction) and 1 on page 7; the bathtub, not found, entered on this plan (6 u, on the plan's pages 2 and 7).
select results_eq($$select outcome from pg_temp.launch(20, 2)$$, $$values ('admitted'::text)$$, 'a second reading of the plan is admitted');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(20, 2), 'its plan is handed');
select is(pg_temp.claim(pg_temp.job(20, 2), 902), 1, 'and claimed');
select results_eq($$select replayed, answer_count from pg_temp.publish(pg_temp.job(20, 2), 902, pg_temp.valid(2), pg_temp.rows_(2),
    pg_temp.vector(2))$$, $$values (false, 3)$$, 'and published');
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb
where job_id = pg_temp.job(20, 2);
update public.takeoff_items set quantity = 4 where id = pg_temp.f(821);

-- Today's send never links a job read against a list, whatever context it checked: the door of lot 3 is not enough.
create function pg_temp.link_as_today(p_job uuid) returns void language plpgsql as $$
begin
  insert into private.takeoff_plan_send_checks (job_id, stamps) values (p_job, '{}'::jsonb);
  insert into private.takeoff_job_attachment_permits (job_id, tenant_id, project_id, version_id)
  select p_job, pg_temp.f(10), pg_temp.f(20), v.id from public.estimate_versions v where v.project_id = pg_temp.f(20);
  update public.takeoff_jobs set estimate_version_id = (select v.id from public.estimate_versions v
    where v.project_id = pg_temp.f(20)) where id = p_job;
end;
$$;
select is(pg_temp.refusal($$select pg_temp.link_as_today(pg_temp.job(20, 2))$$), '40001 TAKEOFF_SEND_JOB_NOT_READY item_list_job',
  'today''s send refuses a job read against a list');

select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('accept_measured', 601, array[300], array[300])) ->> 'outcome', 'applied',
  'the lavabo of the second reading accepted');
select is(pg_temp.review(pg_temp.cmd('enter_quantity', 602, array[302], array[302],
    jsonb_build_object('scope', jsonb_build_object('kind', 'plan', 'plan_logical_id', pg_temp.f(100)),
      'values', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(302), 'quantity', 6, 'unit', 'pièces')),
      'entry', jsonb_build_object('category', 'site_survey')))) ->> 'outcome', 'applied', 'the bathtub entered on this plan');
reset role;

-- The draft as it is now: the lavabo's line (3 u) priced by hand, a DPGF line of the bathtub (its DPGF quantity 4), a
-- line today's send wrote from page 2 of the same plan (its provenance names the file and the page).
create temp table draft as select v.id as version_id, t.estimate_item_id as line_id,
  (select i.parent_id from public.estimate_items i where i.id = t.estimate_item_id) as section_id
from public.estimate_versions v join public.takeoff_item_send_targets t on t.version_id = v.id where v.project_id = pg_temp.f(20);
grant select on draft to authenticated;
select set_config('miaouffrage.estimate_v3_writer', (select version_id::text from draft), true);
update public.estimate_items set unit_price_ht_cents = 4250, h_mo_per_unit = 1.5, k_fo = 1.1, tax_rate_bp = 1000
where id = (select line_id from draft);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity, unit_code,
  pricing_status, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents, line_total_ht_cents,
  line_tax_cents, line_total_ttc_cents, source_provider, source_job_id, source_file_name, source_page, source_metadata)
select pg_temp.f(950), pg_temp.f(10), d.version_id, d.section_id, 'line'::public.estimate_item_type, 2, 'Baignoire (DPGF fictif)', 'u', 4, 'u',
  'priced'::public.estimate_line_pricing_status, 0, 2000,
  1, 0, 1, 1, 0, 0, 0, 0, 'dpgf', null, null, null, '{"dpgf_source_quantity": 4}'::jsonb from draft d
union all
select pg_temp.f(951), pg_temp.f(10), d.version_id, d.section_id, 'line'::public.estimate_item_type, 3, 'Lavabo du métré (fictif)', 'u', 1, 'u',
  'priced'::public.estimate_line_pricing_status, 0, 2000,
  1, 0, 1, 1, 0, 0, 0, 0, 'takeoff', pg_temp.job(20, 1), 'plan-1.pdf', 2, '{}'::jsonb from draft d;
select public.estimate_v3_complete_entry_for_writer((select version_id from draft), array[pg_temp.f(950), pg_temp.f(951)]);
select set_config('miaouffrage.estimate_v3_writer', '', true);
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version_id, pg_temp.f(1), pg_temp.f(10), now() + interval '10 minutes', gen_random_uuid() from draft;
create temp table prices_before as select id, unit_price_ht_cents, h_mo_per_unit, h_mo_atelier_per_unit, h_mo_chantier_per_unit,
  k_fo, k_fo_manual, k_mo, k_mo_atelier, k_mo_chantier, h_mo_majoration, tax_rate_bp, pricing_status, status_reason, offer_choice,
  fo_price_origin, selected_supplier_price_id, supply_type_id, product_id, labor_role_id, line_nature, title, unit_code, description,
  parent_id, position, category_id
from public.estimate_items where id in ((select line_id from draft), pg_temp.f(950), pg_temp.f(951));

-- The pages held: page 2 by today's line and the first send's part; page 7 by the first send's part (this same plan's,
-- of the lavabo only: it holds the bathtub, not the lavabo, whose part on it this plan replaces by its key).
select results_eq($$select (h.value ->> 'page')::integer, (h.value ->> 'today')::boolean, jsonb_array_length(h.value -> 'parts'),
    h.value -> 'earlier_job_ids'
  from jsonb_array_elements(private.takeoff_item_send_held_pages(pg_temp.f(10), (select version_id from draft), pg_temp.job(20, 2),
    pg_temp.document(), array[2, 7])) h(value)$$,
  $$values (2, true, 1, jsonb_build_array(pg_temp.job(20, 1))), (7, false, 1, jsonb_build_array(pg_temp.job(20, 1)))$$,
  'the page guard reads today''s provenance and the parts of the first send, each page once');

create function pg_temp.second(p_decisions jsonb, p_resolutions jsonb, p_with_bathtub boolean default false) returns jsonb
language sql as $$
  select jsonb_set(jsonb_set(pg_temp.plan(pg_temp.job(20, 2), (select version_id from draft), jsonb_build_array(
      pg_temp.earlier_line(pg_temp.job(20, 2), 300, (select line_id from draft), 5))
      || case when p_with_bathtub then jsonb_build_array(pg_temp.earlier_line(pg_temp.job(20, 2), 302, pg_temp.f(950), 6, 'dpgf_line',
        'dpgf')) else '[]'::jsonb end),
    '{page_decisions}', p_decisions), '{dependencies,resolutions}', p_resolutions)
$$;
create function pg_temp.decisions() returns jsonb language sql immutable as $$
  select '[{"page": 2, "decision": "keep_both", "reason_code": "other_zone", "note": null}, {"page": 7, "decision": "replace", "reason_code": null}]'::jsonb
$$;
create function pg_temp.chosen() returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('key', 'target:' || pg_temp.f(302) || '|dpgf',
    'choice', jsonb_build_object('kind', 'line', 'estimate_item_id', pg_temp.f(950))))
$$;
insert into plans values ('second', pg_temp.second(pg_temp.decisions(), pg_temp.chosen()));
insert into plans values ('no_decision', pg_temp.second('[]'::jsonb, pg_temp.chosen()));
insert into plans values ('replace_today', pg_temp.second(jsonb_set(pg_temp.decisions(), '{0}',
  '{"page": 2, "decision": "replace", "reason_code": null}'), pg_temp.chosen()));
insert into plans values ('keep_both_bare', pg_temp.second(jsonb_set(pg_temp.decisions(), '{0}',
  '{"page": 2, "decision": "keep_both", "reason_code": "complementary_scope", "note": "court"}'), pg_temp.chosen()));
insert into plans values ('manual_into_dpgf', pg_temp.second(pg_temp.decisions(), pg_temp.chosen(), true));
insert into plans select 'forged_after', jsonb_set(body, '{targets,0,quantity_after}', '6') from plans where name = 'second';
insert into plans select 'forged_part', jsonb_set(body, '{targets,0,contributions,0,quantity}', '40') from plans where name = 'second';
insert into plans select 'forged_replaces', jsonb_set(body, '{targets,0,replaces}', '[]') from plans where name = 'second';
insert into plans select 'forged_answer', jsonb_set(body, '{dependencies,answers,0,decision_revision}', '9') from plans where name = 'second';
insert into plans select 'forged_job_stamp', jsonb_set(body, '{dependencies,stamps,job}', '"0"') from plans where name = 'second';
insert into plans select 'forged_destination', jsonb_set(body, '{dependencies,stamps,destination,updated_at}',
  to_jsonb(now() - interval '1 day')) from plans where name = 'second';
insert into plans select 'forged_line', jsonb_set(body, '{dependencies,lines,0,quantity}', '2') from plans where name = 'second';
insert into plans select 'forged_earlier', jsonb_set(body, '{dependencies,earlier_targets,0,parts,0,quantity}', '20') from plans
where name = 'second';
insert into plans select 'forged_pages', jsonb_set(body, '{dependencies,pages_in_estimate}', '[]') from plans where name = 'second';
create temp table footprint_before as select pg_temp.footprint() as value;

-- 8. Whatever moved since the plan, or was never shown, refuses before anything is written.
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(720, 'no_decision')$$), '22023 TAKEOFF_ITEM_SEND_PAGE_DECISION_REQUIRED page_held',
  'a part on a page held is written only with that page''s decision');
select is(pg_temp.refusal($$select pg_temp.send(720, 'replace_today')$$), '22023 TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID replace_not_cuttable',
  'a page of today''s send is never replaced part by part: its reading has no part per item');
select is(pg_temp.refusal($$select pg_temp.send(720, 'keep_both_bare')$$), '22023 TAKEOFF_ITEM_SEND_INVALID',
  '« garder les deux » for a complementary scope needs its note');
select is(pg_temp.refusal($$select pg_temp.send(720, 'manual_into_dpgf')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE target_unproven',
  'point 5: an item of the list made by hand never feeds a DPGF line, even chosen');
select is(pg_temp.refusal($$select pg_temp.send(720, 'forged_after')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE quantity_changed',
  'a quantity given by the caller is compared, never applied');
select is(pg_temp.refusal($$select pg_temp.send(720, 'forged_part')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE item_changed',
  'a part is read again from the stored row');
select is(pg_temp.refusal($$select pg_temp.send(720, 'forged_replaces')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE earlier_send_changed',
  'what the plan replaces is what it replaces');
select is(pg_temp.refusal($$select pg_temp.send(720, 'forged_answer')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE answers_changed',
  'a decision''s revision is compared');
select is(pg_temp.refusal($$select pg_temp.send(720, 'forged_job_stamp')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE takeoff_changed',
  'the job''s stamp is compared');
select is(pg_temp.refusal($$select pg_temp.send(720, 'forged_destination')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE destination_changed',
  'the draft as the plan read it');
select is(pg_temp.refusal($$select pg_temp.send(720, 'forged_line')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE estimate_changed',
  'each line the plan read, as it read it');
select is(pg_temp.refusal($$select pg_temp.send(720, 'forged_earlier')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE earlier_send_changed',
  'the earlier sends by item as the plan read them');
select is(pg_temp.refusal($$select pg_temp.send(720, 'forged_pages')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE pages_changed',
  'the pages already in the draft as the plan read them');
reset role;
-- A member editing the draft, and none: the lease is the member's.
delete from public.draft_locks where version_id = (select version_id from draft);
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version_id, pg_temp.f(4), pg_temp.f(10), now() + interval '10 minutes', gen_random_uuid() from draft;
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(720, 'second')$$), '55P03 TAKEOFF_ITEM_SEND_DRAFT_LOCKED',
  'another member editing the draft: their saves are not refused by the send');
reset role;
delete from public.draft_locks where version_id = (select version_id from draft);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(720, 'second')$$), '55P03 TAKEOFF_ITEM_SEND_DRAFT_LOCK_REQUIRED',
  'without the editor''s lease, nothing is sent');
reset role;
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version_id, pg_temp.f(1), pg_temp.f(10), now() + interval '10 minutes', gen_random_uuid() from draft;
select is(pg_temp.footprint(), (select value from footprint_before), 'every refusal wrote nothing');

-- 9. The send: a temporary relation a session holds under the name of the writer's tables is never used (its trigger
--    never fires); the lavabo's part of this plan replaces the first send's (3 → 5, by the plan's key, page 7 replaced
--    too), page 2 is kept both. The DPGF line and today's line are untouched.
create temp table takeoff_item_send_parts (id uuid);
create function pg_temp.trap() returns trigger language plpgsql as $$ begin raise exception 'ITEM_SEND_TEST_TRAP'; end; $$;
create trigger trap before insert or update or delete on pg_temp.takeoff_item_send_parts for each row execute function pg_temp.trap();
grant all on pg_temp.takeoff_item_send_parts to authenticated;
select pg_temp.sign_in(1);
set local role authenticated;
create temp table sent_second as select pg_temp.send(720, 'second') as answer;
reset role;
select is((select count(*)::integer from pg_temp.takeoff_item_send_parts), 0, 'the session''s own relation of the same name is untouched');
select is((select pg_get_functiondef('public.send_takeoff_item_plan(uuid, uuid, boolean, jsonb)'::regprocedure) ~* '(temporary|pg_temp)'), false,
  'the writer names no temporary relation');
select results_eq($$select i.id, i.quantity from public.estimate_items i where i.id in ((select line_id from draft), pg_temp.f(950), pg_temp.f(951))
  order by i.position$$,
  $$values ((select line_id from draft), 5::numeric), (pg_temp.f(950), 4::numeric), (pg_temp.f(951), 1::numeric)$$,
  'the lavabo 5; the DPGF line and today''s line untouched');
select results_eq($$select b.id from prices_before b join public.estimate_items i on i.id = b.id
  where (b.unit_price_ht_cents, b.h_mo_per_unit, b.h_mo_atelier_per_unit, b.h_mo_chantier_per_unit, b.k_fo, b.k_fo_manual, b.k_mo,
    b.k_mo_atelier, b.k_mo_chantier, b.h_mo_majoration, b.tax_rate_bp, b.pricing_status, b.status_reason, b.offer_choice,
    b.fo_price_origin, b.selected_supplier_price_id, b.supply_type_id, b.product_id, b.labor_role_id, b.line_nature, b.title,
    b.unit_code, b.description, b.parent_id, b.position, b.category_id)
    is distinct from (i.unit_price_ht_cents, i.h_mo_per_unit, i.h_mo_atelier_per_unit, i.h_mo_chantier_per_unit, i.k_fo, i.k_fo_manual,
      i.k_mo, i.k_mo_atelier, i.k_mo_chantier, i.h_mo_majoration, i.tax_rate_bp, i.pricing_status, i.status_reason, i.offer_choice,
      i.fo_price_origin, i.selected_supplier_price_id, i.supply_type_id, i.product_id, i.labor_role_id, i.line_nature, i.title,
      i.unit_code, i.description, i.parent_id, i.position, i.category_id)$$,
  $$select null::uuid where false$$, 'only quantities move: no price, hours per unit, coefficient, VAT, status, origin or place');
select results_eq($$select p.job_id, p.kind, p.quantity, p.pages, p.state, p.replaced_by_receipt_id is not null
  from public.takeoff_item_send_parts p order by p.job_id, p.item_id, p.pages$$,
  $$values (pg_temp.job(20, 1), 'measured'::text, 2::numeric, array[2], 'replaced'::text, true),
    (pg_temp.job(20, 1), 'measured', 1::numeric, array[7], 'replaced', true),
    (pg_temp.job(20, 2), 'measured', 4::numeric, array[2], 'live', false),
    (pg_temp.job(20, 2), 'measured', 1::numeric, array[7], 'live', false)$$,
  'the journal: the first send''s parts replaced, never added to; the new parts live');
select results_eq($$select t.item_id, t.breakdown, t.line_kind from public.takeoff_item_send_targets t order by t.created_at, t.line_kind desc$$,
  $$values (pg_temp.f(300), 'together'::text, 'new_line'::text)$$, 'the lavabo keeps its target');
select results_eq($$select r.result -> 'page_decisions' from public.takeoff_item_send_receipts r where r.request_id = pg_temp.f(720)$$,
  $$values (pg_temp.decisions())$$, 'the receipt keeps the page decisions');
select is((select count(*)::integer from public.draft_locks where version_id = (select version_id from draft)), 1,
  'the member''s lease is left as it was');

-- 10. A quantity typed by hand on the line is kept apart: a third reading of the plan finds the lavabo's line at 7 (the
--     policy would write 5); it is written only with the member's choice, here « conserver la saisie ».
select results_eq($$select outcome from pg_temp.launch(20, 3)$$, $$values ('admitted'::text)$$, 'a third reading of the plan');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(20, 3), 'handed');
select is(pg_temp.claim(pg_temp.job(20, 3), 903), 1, 'claimed');
select results_eq($$select replayed from pg_temp.publish(pg_temp.job(20, 3), 903, pg_temp.valid(3), pg_temp.rows_(3),
    pg_temp.vector(3))$$, $$values (false)$$, 'published');
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb
where job_id = pg_temp.job(20, 3);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('accept_measured', 603, array[300], array[300])) ->> 'outcome', 'applied', 'accepted');
reset role;
select set_config('miaouffrage.estimate_v3_writer', (select version_id::text from draft), true);
update public.estimate_items set quantity = 7 where id = (select line_id from draft);
select public.estimate_v3_complete_entry_for_writer((select version_id from draft), array[(select line_id from draft)]);
select set_config('miaouffrage.estimate_v3_writer', '', true);
create function pg_temp.third(p_after numeric, p_kept boolean, p_resolutions jsonb) returns jsonb language sql as $$
  select jsonb_set(jsonb_set(pg_temp.plan(pg_temp.job(20, 3), (select version_id from draft), jsonb_build_array(
      pg_temp.earlier_line(pg_temp.job(20, 3), 300, (select line_id from draft), p_after, p_kept => p_kept))),
    '{page_decisions}', '[{"page": 2, "decision": "keep_both", "reason_code": "other_trade"}, {"page": 7, "decision": "keep_both", "reason_code": "other_zone"}]'::jsonb),
    '{dependencies,resolutions}', p_resolutions)
$$;
insert into plans values ('typed_unchosen', pg_temp.third(5, false, '[]'::jsonb)),
  ('typed_retained', pg_temp.third(3, false, jsonb_build_array(jsonb_build_object('key', 'entry:' || pg_temp.f(300) || '|together',
    'choice', '{"kind": "use_retained"}'::jsonb)))),
  ('typed_kept', pg_temp.third(7, true, jsonb_build_array(jsonb_build_object('key', 'entry:' || pg_temp.f(300) || '|together',
    'choice', '{"kind": "keep_entry"}'::jsonb)))),
  ('typed_kept_unsaid', pg_temp.third(7, false, jsonb_build_array(jsonb_build_object('key', 'entry:' || pg_temp.f(300) || '|together',
    'choice', '{"kind": "keep_entry"}'::jsonb))));
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(730, 'typed_unchosen')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE line_changed',
  'a quantity typed by hand is never replaced without the member''s choice');
select is(pg_temp.refusal($$select pg_temp.send(730, 'typed_kept_unsaid')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE quantity_changed',
  'keeping the entry is said in the plan');
select is(pg_temp.tried($$select pg_temp.send(730, 'typed_retained')$$), 'sent', 'the retained quantity, by choice, is written (rolled back)');
select is((pg_temp.send(731, 'typed_kept') -> 'lines' -> 0 ->> 'quantity_after'), '7', 'the entry kept, by choice');
reset role;
select results_eq($$select p.job_id, p.quantity, p.state from public.takeoff_item_send_parts p
  where p.target_id = (select t.id from public.takeoff_item_send_targets t where t.estimate_item_id = (select line_id from draft))
    and p.state = 'live' order by p.pages$$,
  $$values (pg_temp.job(20, 3), 2::numeric, 'live'::text), (pg_temp.job(20, 3), 1::numeric, 'live')$$,
  'the line keeps the member''s 7; its live parts are this reading''s, the measure kept apart');

-- 11. A draft of another engine, a version no longer a draft, a copy whose lines came from a send by item without its
--     contributions, a part of this plan left on another target: refused, nothing written.
set local session_replication_role = replica;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
select pg_temp.f(v.id), pg_temp.f(10), pg_temp.f(20), v.number, v.engine, 3, 'EUR', v.status::public.estimate_status, 'fixed', 1, 0, 1, 0,
  'simple', 2000, 'none', 1, case when v.engine = 3 then 1.3 end, case when v.engine = 3 then 1.2 end,
  case when v.engine = 3 then 0 end, case when v.engine = 3 then 0 end, case when v.engine = 3 then 0 end, 0, 0, 0
from (values (960, 2, 2, 'draft'), (961, 3, 3, 'sent'), (962, 4, 3, 'draft')) as v(id, number, engine, status);
set local session_replication_role = origin;
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select v, pg_temp.f(1), pg_temp.f(10), now() + interval '10 minutes', gen_random_uuid() from unnest(array[pg_temp.f(960), pg_temp.f(962)]) v;
select set_config('miaouffrage.estimate_v3_writer', pg_temp.f(962)::text, true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
values (pg_temp.f(964), pg_temp.f(10), pg_temp.f(962), null, 'section', 1, 'Métré');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity, unit_code,
  pricing_status, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents, line_total_ht_cents,
  line_tax_cents, line_total_ttc_cents, source_provider, source_job_id, source_metadata)
values (pg_temp.f(963), pg_temp.f(10), pg_temp.f(962), pg_temp.f(964), 'line', 1, 'Lavabo copié (fictif)', 'u', 5, 'u', 'priced', 0, 2000, 1, 0, 1,
  1, 0, 0, 0, 0, 'takeoff', pg_temp.job(20, 2), '{"takeoff_item_send": {"version": 1}}'::jsonb);
select public.estimate_v3_complete_entry_for_writer(pg_temp.f(962), array[pg_temp.f(963)]);
select set_config('miaouffrage.estimate_v3_writer', '', true);
select results_eq($$select outcome from pg_temp.launch(20, 4)$$, $$values ('admitted'::text)$$, 'a fourth reading of the plan');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(20, 4), 'handed');
select is(pg_temp.claim(pg_temp.job(20, 4), 904), 1, 'claimed');
select results_eq($$select replayed from pg_temp.publish(pg_temp.job(20, 4), 904, pg_temp.valid(4), pg_temp.rows_(4),
    pg_temp.vector(4))$$, $$values (false)$$, 'published');
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb
where job_id = pg_temp.job(20, 4);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review(pg_temp.cmd('accept_measured', 604, array[300], array[300])) ->> 'outcome', 'applied', 'accepted');
reset role;
insert into plans values
  ('engine_v2', pg_temp.plan(pg_temp.job(20, 4), pg_temp.f(960), jsonb_build_array(pg_temp.new_line(pg_temp.job(20, 4), 300, 3)),
    '[{"key": "list:", "title": "Métré", "parent_key": null, "parent_id": null}]'::jsonb)),
  ('issued', pg_temp.plan(pg_temp.job(20, 4), pg_temp.f(961), jsonb_build_array(pg_temp.new_line(pg_temp.job(20, 4), 300, 3)),
    '[{"key": "list:", "title": "Métré", "parent_key": null, "parent_id": null}]'::jsonb)),
  ('copy', pg_temp.plan(pg_temp.job(20, 4), pg_temp.f(962), jsonb_build_array(pg_temp.new_line(pg_temp.job(20, 4), 300, 3)),
    '[{"key": "list:", "title": "Métré", "parent_key": null, "parent_id": null}]'::jsonb));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table footprint_engines as select 1;
select is(pg_temp.refusal($$select pg_temp.send(740, 'engine_v2')$$), '22023 TAKEOFF_ITEM_SEND_ENGINE_NOT_V3',
  'a draft of engine 2 never receives the send by item');
select is(pg_temp.refusal($$select pg_temp.send(740, 'issued')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE destination_changed',
  'an issued version is never written');
select is(pg_temp.refusal($$select pg_temp.send(740, 'copy')$$), '22023 TAKEOFF_ITEM_SEND_COPY_UNREAD',
  'a copy whose lines a send by item fed, without their contributions, is never counted a second time');
reset role;
-- A part of this plan on another target of the item (a compartment changed since): it would stay counted beside the new.
create function pg_temp.elsewhere() returns jsonb language plpgsql as $$
begin
  perform set_config('mergeone.takeoff_item_send', 'test', true);
  insert into public.takeoff_item_send_receipts (id, tenant_id, project_id, job_id, version_id, request_id, format_version, actor_id,
    plan_sha256, version_created, write_plan, result)
  values (pg_temp.f(970), pg_temp.f(10), pg_temp.f(20), pg_temp.f(1900), (select version_id from draft), pg_temp.f(971), 1,
    pg_temp.f(1), repeat('0', 64), false, '{}', '{}');
  insert into public.takeoff_item_send_targets (id, tenant_id, project_id, version_id, item_id, breakdown, compartment_key,
    estimate_item_id, line_kind, unit_code, created_by_receipt_id)
  values (pg_temp.f(972), pg_temp.f(10), pg_temp.f(20), (select version_id from draft), pg_temp.f(300), 'together', 'other',
    pg_temp.f(951), 'new_line', 'u', pg_temp.f(970));
  update public.takeoff_item_send_parts set state = 'replaced', replaced_by_receipt_id = pg_temp.f(970), replaced_at = now()
  where job_id = pg_temp.job(20, 3) and pages = array[7];
  insert into public.takeoff_item_send_parts (tenant_id, project_id, version_id, target_id, receipt_id, job_id, item_id,
    plan_logical_id, kind, answer_id, answer_revision, decision_revision, observation_ids, takeoff_item_ids, quantity, unit,
    unit_code, pages)
  select tenant_id, project_id, version_id, pg_temp.f(972), pg_temp.f(970), job_id, item_id, plan_logical_id, kind, answer_id,
    answer_revision, decision_revision, observation_ids, takeoff_item_ids, quantity, unit, unit_code, pages
  from public.takeoff_item_send_parts where job_id = pg_temp.job(20, 3) and pages = array[7];
  insert into public.takeoff_item_send_pages (tenant_id, project_id, version_id, receipt_id, job_id, document, page, item_ids,
    part_ids)
  select pg_temp.f(10), pg_temp.f(20), (select version_id from draft), pg_temp.f(970), pg_temp.job(20, 3), pg_temp.document(), 7,
    array[pg_temp.f(300)], array_agg(p.id) from public.takeoff_item_send_parts p where p.receipt_id = pg_temp.f(970);
  perform set_config('mergeone.takeoff_item_send', '', true);
  insert into plans values ('elsewhere', jsonb_set(jsonb_set(pg_temp.plan(pg_temp.job(20, 4), (select version_id from draft),
      jsonb_build_array(pg_temp.earlier_line(pg_temp.job(20, 4), 300, (select line_id from draft), 7, p_kept => true))),
    '{page_decisions}', '[{"page": 2, "decision": "keep_both", "reason_code": "other_trade"}, {"page": 7, "decision": "keep_both", "reason_code": "other_zone"}]'::jsonb),
    '{dependencies,resolutions}', jsonb_build_array(jsonb_build_object('key', 'entry:' || pg_temp.f(300) || '|together',
      'choice', '{"kind": "keep_entry"}'::jsonb))));
  perform set_config('role', 'authenticated', true);
  perform pg_temp.sign_in(1);
  return pg_temp.send(750, 'elsewhere');
end;
$$;
select is(pg_temp.refusal($$select pg_temp.elsewhere()$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE earlier_part_elsewhere',
  'a part of this same plan left on another target of the item refuses the send: never counted twice');

-- 12. The arithmetic, on the vectors its TypeScript twin runs (item-send-plan.test.ts reads them here; keep one vector per
--     line in this form): a length rounded up once, on the sum; the protective maximum with the DPGF reference.
create temp table item_send_vectors as select * from jsonb_to_recordset($vectors$[
  {"position": 1, "label": "units are never rounded", "unit": "u", "reference": null, "measured": 2.5, "protective": 0, "written": 2.5},
  {"position": 2, "label": "a length rounded up once, on the sum (1.2 + 1.3 m)", "unit": "m", "reference": null, "measured": 2.5, "protective": 0, "written": 3},
  {"position": 3, "label": "a whole length stays", "unit": "ml", "reference": null, "measured": 3, "protective": 0, "written": 3},
  {"position": 4, "label": "centimetres rounded up to the whole metre, as finalize_takeoff_lengths does", "unit": "cm", "reference": null, "measured": 12.34, "protective": 0, "written": 100},
  {"position": 5, "label": "the DPGF reference above the measure", "unit": "u", "reference": 4, "measured": 2, "protective": 0, "written": 4},
  {"position": 6, "label": "the measure above the DPGF reference", "unit": "u", "reference": 4, "measured": 6, "protective": 0, "written": 6},
  {"position": 7, "label": "a protective part above the measure", "unit": "m2", "reference": 10, "measured": 9.5, "protective": 1, "written": 10.5},
  {"position": 8, "label": "a length with its reference, rounded after the maximum", "unit": "m", "reference": 2.2, "measured": 2.3, "protective": 0, "written": 3},
  {"position": 9, "label": "four decimals at most before the rounding", "unit": "u", "reference": null, "measured": 1.00004, "protective": 0, "written": 1},
  {"position": 10, "label": "a surface is not a length", "unit": "m2", "reference": null, "measured": 2.25, "protective": 0, "written": 2.25}
]$vectors$::jsonb) as v(position integer, label text, unit text, reference numeric, measured numeric, protective numeric,
  written numeric);
select is(private.takeoff_item_send_composed(v.reference, v.measured, v.protective, private.takeoff_item_send_length_factor(v.unit)),
  v.written, format('arithmetic vector %s: %s', v.position, v.label))
from item_send_vectors v order by v.position;

-- 12b. Review findings of the first reading, each seen red before its fix.
-- A unit spelled otherwise in the plan than in the stored row (U for u) is the same unit (B2's unit token).
-- A later reading of the same plan replaces its earlier part whatever its identity (only what remains is compared).
create function pg_temp.reidentified() returns jsonb language sql as $$
  select jsonb_set(jsonb_set(pg_temp.plan(pg_temp.job(20, 4), (select version_id from draft),
      jsonb_build_array(pg_temp.earlier_line(pg_temp.job(20, 4), 300, (select line_id from draft), 7, p_kept => true))),
    '{page_decisions}', '[{"page": 2, "decision": "keep_both", "reason_code": "other_trade"}, {"page": 7, "decision": "keep_both", "reason_code": "other_zone"}]'::jsonb),
    '{dependencies,resolutions}', jsonb_build_array(jsonb_build_object('key', 'entry:' || pg_temp.f(300) || '|together',
      'choice', '{"kind": "keep_entry"}'::jsonb)))
$$;
insert into plans values ('reidentified', pg_temp.reidentified());
-- The earlier parts of the lavabo stored under another basis (« surface au sol ») than this reading derives (none): they
-- are the ones replaced, so they are never compared.
create function pg_temp.earlier_reidentified() returns jsonb language plpgsql as $$
begin
  perform set_config('mergeone.takeoff_item_send', 'test', true);
  insert into public.takeoff_item_send_receipts (id, tenant_id, project_id, job_id, version_id, request_id, format_version, actor_id,
    plan_sha256, version_created, write_plan, result)
  values (pg_temp.f(976), pg_temp.f(10), pg_temp.f(20), pg_temp.f(1900), (select version_id from draft), pg_temp.f(977), 1,
    pg_temp.f(1), repeat('0', 64), false, '{}', '{}');
  create temp table moved on commit drop as select p.* from public.takeoff_item_send_parts p
  where p.job_id = pg_temp.job(20, 3) and p.item_id = pg_temp.f(300) and p.state = 'live';
  update public.takeoff_item_send_parts set state = 'replaced', replaced_by_receipt_id = pg_temp.f(976), replaced_at = now()
  where id in (select id from moved);
  insert into public.takeoff_item_send_parts (tenant_id, project_id, version_id, target_id, receipt_id, job_id, item_id,
    plan_logical_id, kind, answer_id, answer_revision, decision_revision, observation_ids, takeoff_item_ids, quantity, unit,
    unit_code, basis, pages)
  select tenant_id, project_id, version_id, target_id, pg_temp.f(976), job_id, item_id, plan_logical_id, kind, answer_id,
    answer_revision, decision_revision, observation_ids, takeoff_item_ids, quantity, unit, unit_code, 'surface au sol', pages
  from moved;
  insert into public.takeoff_item_send_pages (tenant_id, project_id, version_id, receipt_id, job_id, document, page, item_ids,
    part_ids)
  select pg_temp.f(10), pg_temp.f(20), (select version_id from draft), pg_temp.f(976), pg_temp.job(20, 3), pg_temp.document(), x.page,
    array[pg_temp.f(300)], array_agg(p.id) from public.takeoff_item_send_parts p cross join lateral unnest(p.pages) x(page)
  where p.receipt_id = pg_temp.f(976) and p.state = 'live' group by x.page;
  perform set_config('mergeone.takeoff_item_send', '', true);
  insert into plans values ('earlier_reidentified', pg_temp.reidentified());
  perform set_config('role', 'authenticated', true);
  perform pg_temp.sign_in(1);
  return pg_temp.send(761, 'earlier_reidentified');
end;
$$;
insert into plans select 'other_spelling', jsonb_set(jsonb_set(jsonb_set(body, '{targets,0,contributions}', pg_temp.parts(pg_temp.job(20, 4), 300)),
  '{targets,0,contributions,0,unit}', '"U"'), '{targets,0,contributions,1,unit}', '"U"') from plans where name = 'reidentified';
-- A plan that names none of its pages: the pages are the parts', never the caller's.
insert into plans select 'no_pages', jsonb_set(body, '{page_contributions}', '[]') from plans where name = 'reidentified';
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.tried($$select pg_temp.send(760, 'other_spelling')$$), 'sent',
  'finding 3: a unit is compared by its token, not its spelling');
select is(pg_temp.refusal($$select pg_temp.send(762, 'no_pages')$$),
  '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE page_contributions_changed',
  'finding 1: page contributions that do not cover the parts written refuse the send');
reset role;
select is(pg_temp.tried($$select pg_temp.earlier_reidentified()$$), 'sent',
  'finding 4: the identity is compared with what remains after the replacement, not with the parts replaced');

-- 13. Today's writers refuse a version fed item by item. Every path that applies a takeoff job to a version (today's
--     send of a grouped analysis, of one plan or outside a request, the application of a job launched on a version and
--     its DPGF composition) flips the job to applied in its transaction, where the guard refuses: nothing written. A
--     version without a live target is judged as before. Two jobs of the first order, each launched on a draft: the
--     draft the sends by item fed, and the copy (no live target).
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, plan_set_id, level, status, created_by,
  preparation_snapshot, source_file_name)
values (pg_temp.f(1910), pg_temp.f(10), pg_temp.f(20), (select version_id from draft), pg_temp.f(40), 'C', 'completed', pg_temp.f(1),
    pg_temp.snapshot(20), 'plan-1.pdf'),
  (pg_temp.f(1911), pg_temp.f(10), pg_temp.f(20), pg_temp.f(962), pg_temp.f(40), 'C', 'completed', pg_temp.f(1),
    pg_temp.snapshot(20), 'plan-1.pdf');
set local session_replication_role = origin;
select pg_temp.sign_in(1);
select is(pg_temp.refusal($$update public.takeoff_jobs set status = 'applied' where id = pg_temp.f(1910)$$),
  'P0001 TAKEOFF_APPLY_ITEM_SEND_VERSION item_send_version',
  'a takeoff of an earlier format is never applied to a draft fed item by item');
select is(pg_temp.refusal($$update public.takeoff_jobs set status = 'applied' where id = pg_temp.f(1911)$$), 'none',
  'on a draft no send by item fed, the guard judges it as before');
select is((select status::text from public.takeoff_jobs where id = pg_temp.f(1910)), 'completed', 'nothing applied');

-- 14. The readers of the preview: what the writer reads, for the affaire's readers.
select pg_temp.sign_in(3);
set local role authenticated;
select results_eq($$select (r ->> 'state'), jsonb_array_length(r -> 'answers'), r -> 'unit_pages',
    (select a ->> 'current' from jsonb_array_elements(r -> 'answers') a where a ->> 'item_id' = pg_temp.f(300)::text),
    (select a #>> '{decision,kind}' from jsonb_array_elements(r -> 'answers') a where a ->> 'item_id' = pg_temp.f(300)::text),
    (select jsonb_agg(o -> 'quantity' order by o ->> 'page') from jsonb_array_elements(r -> 'answers') a
      cross join lateral jsonb_array_elements(a -> 'observations') o
      where a ->> 'item_id' = pg_temp.f(300)::text and o ->> 'role' = 'contribution')
  from (select public.read_takeoff_item_send_facts(pg_temp.f(10), pg_temp.f(20), pg_temp.job(20, 4)) as r) x$$,
  $$values ('stored'::text, 3, '[2, 7]'::jsonb, 'true'::text, 'accepted'::text, '[2, 1]'::jsonb)$$,
  'the director reads a job''s answers: current, accepted, its reviewed rows');
select results_eq($$select (select a ->> 'current' from jsonb_array_elements(r -> 'answers') a
    where a ->> 'item_id' = pg_temp.f(300)::text)
  from (select public.read_takeoff_item_send_facts(pg_temp.f(10), pg_temp.f(20), pg_temp.job(20, 1)) as r) x$$,
  $$values ('false'::text)$$, 'a reading replaced since is no longer current');
select is((public.read_takeoff_item_send_facts(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1900)) ->> 'state'), 'not_stored',
  'a job of the first order has no answers by item');
select results_eq($$select jsonb_array_length(r -> 'earlier_targets'), jsonb_array_length(r -> 'sections'),
    (select jsonb_agg((h ->> 'page')::integer order by (h ->> 'page')::integer) from jsonb_array_elements(r -> 'pages_in_estimate') h)
  from (select public.read_takeoff_item_send_draft(pg_temp.f(10), pg_temp.f(20), (select version_id from draft), pg_temp.job(20, 4)) as r) x$$,
  $$values (1, 1, '[2, 7]'::jsonb)$$, 'and the draft as the writer reads it: its target, a section, the pages held');
create temp table draft_read as select public.read_takeoff_item_send_draft(pg_temp.f(10), pg_temp.f(20),
  (select version_id from draft), pg_temp.job(20, 4)) as answer;
select pg_temp.sign_in(5);
select is(pg_temp.refusal($$select public.read_takeoff_item_send_facts(pg_temp.f(10), pg_temp.f(20), pg_temp.job(20, 4))$$),
  'P0002 TAKEOFF_JOB_NOT_FOUND', 'another tenant reads nothing');
select is(pg_temp.refusal($$select public.read_takeoff_item_send_draft(pg_temp.f(10), pg_temp.f(20), (select version_id from draft),
  pg_temp.job(20, 4))$$), 'P0002 TAKEOFF_JOB_NOT_FOUND', 'nor the draft');
reset role;
select is((select answer -> 'earlier_targets' from draft_read), private.takeoff_item_send_earlier_targets(pg_temp.f(10),
  (select version_id from draft)), 'the draft''s targets in the writer''s own form');
select is(has_function_privilege('anon', 'public.read_takeoff_item_send_facts(uuid, uuid, uuid)', 'EXECUTE'), false,
  'an anonymous client reads nothing');

-- 15. Fix round 1 of the independent review (points 1, 4, 6, 7, 8, 9, 10, 12 and the door of the applied job), each seen
--     red on the first push's writer.
-- The fourth reading (job 4) again, its lavabo accepted, the line at 7 (kept by hand): its plans, as the server builds them.
create function pg_temp.fourth(p_contributions jsonb, p_replaces jsonb, p_after numeric, p_choice text, p_decisions jsonb,
  p_parts_not_sent jsonb default '[]'::jsonb, p_rules jsonb default '[]'::jsonb) returns jsonb language sql as $$
  select jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
    pg_temp.plan(pg_temp.job(20, 4), (select version_id from draft),
      jsonb_build_array(pg_temp.earlier_line(pg_temp.job(20, 4), 300, (select line_id from draft), p_after, p_kept => p_choice = 'keep_entry')))
    , '{targets,0,contributions}', p_contributions), '{targets,0,replaces}', p_replaces),
    '{page_decisions}', p_decisions), '{parts_not_sent}', p_parts_not_sent),
    '{page_contributions}', pg_temp.page_contributions(jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300),
      'key', pg_temp.f(300) || '|together', 'contributions', p_contributions)))),
    '{dependencies,resolutions}', jsonb_build_array(jsonb_build_object('key', 'entry:' || pg_temp.f(300) || '|together',
      'choice', jsonb_build_object('kind', p_choice)))),
    '{dependencies,rules}', p_rules)
$$;
create function pg_temp.parts_on(p_job uuid, p_item integer, p_page integer) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(c.value), '[]'::jsonb) from jsonb_array_elements(pg_temp.parts(p_job, p_item)) c(value)
  where c.value -> 'pages' @> to_jsonb(p_page)
$$;
create function pg_temp.replaced_on(p_page integer) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('job_id', p.job_id, 'answer_id', p.answer_id, 'observation_ids', to_jsonb(p.observation_ids),
      'quantity', p.quantity) order by p.id), '[]'::jsonb)
  from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id = p.target_id
  where t.estimate_item_id = (select line_id from draft) and p.state = 'live' and p_page = any(p.pages)
$$;
-- Point 1: page 2 is held by today's line and left undecided, so its part is not sent; page 7 is read again. The earlier
-- part of page 7 is replaced, the one of page 2 stays live: 2 + 1 = 3, never 1.
insert into plans values ('covered', pg_temp.fourth(pg_temp.parts_on(pg_temp.job(20, 4), 300, 7), pg_temp.replaced_on(7), 3,
    'use_retained', '[]'::jsonb, (select jsonb_agg(jsonb_build_object('item_id', pg_temp.f(300), 'kind', 'measured',
      'observation_ids', c.value -> 'observation_ids', 'pages', c.value -> 'pages', 'quantity', c.value -> 'quantity', 'unit', 'u',
      'reason', 'page_held')) from jsonb_array_elements(pg_temp.parts_on(pg_temp.job(20, 4), 300, 2)) c(value)))),
  ('covered_by_key', pg_temp.fourth(pg_temp.parts_on(pg_temp.job(20, 4), 300, 7),
    pg_temp.replaced_on(2) || pg_temp.replaced_on(7), 1, 'use_retained', '[]'::jsonb,
    (select jsonb_agg(jsonb_build_object('item_id', pg_temp.f(300), 'kind', 'measured',
      'observation_ids', c.value -> 'observation_ids', 'pages', c.value -> 'pages', 'quantity', c.value -> 'quantity', 'unit', 'u',
      'reason', 'page_held')) from jsonb_array_elements(pg_temp.parts_on(pg_temp.job(20, 4), 300, 2)) c(value))));
-- Closing 1 and 2 of #484's last check: an omitted part's pages are its stored ones (page 2 only, never the plan's 2 and
-- 7), and the page journal the plan shows is compared whole (its targets and observations too).
insert into plans select 'omission_page_mismatch', jsonb_set(jsonb_set(jsonb_set(body, '{parts_not_sent,0,pages}', '[2, 7]'),
    '{targets,0,replaces}', '[]'), '{targets,0,quantity_after}', '4'), payload from plans where name = 'covered';
insert into plans select 'edited_summary', jsonb_set(jsonb_set(body, '{page_contributions,0,observation_ids}', '[]'),
    '{page_contributions,0,target_keys}', '[]'), payload from plans where name = 'covered';
-- The quantity added is the stored parts', each sent once: page 7's part listed twice, page 2's left out unsaid, would
-- add page 7 twice (4 where 3 is due).
insert into plans values ('doubled', pg_temp.fourth(pg_temp.parts_on(pg_temp.job(20, 4), 300, 7)
  || pg_temp.parts_on(pg_temp.job(20, 4), 300, 7), pg_temp.replaced_on(7), 4, 'use_retained', '[]'::jsonb));
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(770, 'doubled')$$),
  '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE item_changed',
  'a part the plan lists twice is never added twice: each stored part is sent once, its quantity read from the stored row');
select is(pg_temp.refusal($$select pg_temp.send(770, 'omission_page_mismatch')$$),
  '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE item_changed',
  'closing 1: a part left out is read with its stored pages, never the plan''s: 4 is never written where 3 is due');
select is(pg_temp.refusal($$select pg_temp.send(770, 'edited_summary')$$),
  '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE page_contributions_changed',
  'closing 2: a page summary without the targets and observations written refuses the send');
select is(pg_temp.tried($$select pg_temp.send(770, 'covered')$$), 'sent',
  'point 1: a confirmation replaces the earlier parts on the pages it covers only (3, never 1)');
select is(pg_temp.refusal($$select pg_temp.send(770, 'covered_by_key')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE earlier_send_changed',
  'a plan that would retire the uncovered page is refused');
reset role;
-- Lot 5 (20261122193622): an acceptance taken on counted marks that changed since is undecided
-- (private.takeoff_item_decision_effective, read through the pairs). The lavabo's marks move on to revision 1 after its
-- acceptance (one more than the revision its acceptance recorded): the readers give it no decision, the job brings none
-- of its measured parts, and the plan the preview showed is stale. Nothing is sent until the item is accepted again.
set local session_replication_role = replica;
update public.takeoff_count_answer_states s set revision = s.revision + 1
from public.takeoff_item_answers a where s.answer_id = a.id and a.job_id = pg_temp.job(20, 4) and a.item_id = pg_temp.f(300);
set local session_replication_role = origin;
select is((select (s.revision - coalesce(d.marks_revision, 0)) from public.takeoff_count_answer_states s
    join public.takeoff_item_answers a on a.id = s.answer_id join public.takeoff_item_answer_decisions d on d.answer_id = a.id
    where a.job_id = pg_temp.job(20, 4) and a.item_id = pg_temp.f(300) and d.kind = 'accepted'), 1,
  'the lavabo''s acceptance stands one marks revision behind');
select pg_temp.sign_in(1);
set local role authenticated;
select is((select a -> 'decision' from jsonb_array_elements(public.read_takeoff_item_send_facts(pg_temp.f(10), pg_temp.f(20),
    pg_temp.job(20, 4)) -> 'answers') a where a ->> 'item_id' = pg_temp.f(300)::text), 'null'::jsonb,
  'an acceptance taken on marks changed since: the reader gives the item no decision');
select is(pg_temp.refusal($$select pg_temp.send(770, 'covered')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE answers_changed',
  'and the plan the preview showed, the acceptance standing, is stale: nothing is sent');
reset role;
select is((select count(*)::integer from private.takeoff_item_send_job_parts(pg_temp.f(10), pg_temp.f(20), pg_temp.job(20, 4),
    array[2, 7]) p where p.item_id = pg_temp.f(300)), 0, 'the job brings none of the undecided item''s parts');
set local session_replication_role = replica;
update public.takeoff_count_answer_states s set revision = s.revision - 1
from public.takeoff_item_answers a where s.answer_id = a.id and a.job_id = pg_temp.job(20, 4) and a.item_id = pg_temp.f(300);
set local session_replication_role = origin;
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.tried($$select pg_temp.send(770, 'covered')$$), 'sent', 'its marks back at the accepted revision: the same plan is sent');
reset role;
-- Point 6: a « skip » rule of the tenant applies to the lavabo.
insert into public.takeoff_mapping_rules (id, tenant_id, name, match_pattern, match_type, action, action_params, priority, is_active)
values (pg_temp.f(980), pg_temp.f(10), 'Ignorer les lavabos (fictif)', 'lavabo', 'contains', 'skip', '{}'::jsonb, 1, true);
insert into plans values ('skipped', pg_temp.fourth(pg_temp.parts(pg_temp.job(20, 4), 300), pg_temp.replaced_on(2) || pg_temp.replaced_on(7),
  7, 'keep_entry', '[{"page": 2, "decision": "keep_both", "reason_code": "other_trade"}, {"page": 7, "decision": "keep_both", "reason_code": "other_zone"}]'::jsonb,
  '[]'::jsonb, (select jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'rule_id', r.id, 'rule_version', r.updated_at,
    'action', 'skip', 'effect', 'skipped')) from public.takeoff_mapping_rules r where r.id = pg_temp.f(980))));
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(771, 'skipped')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE mapping_changed',
  'point 6: an item under a « skip » rule is never written');
reset role;
delete from public.takeoff_mapping_rules where id = pg_temp.f(980);
-- Point 4: two stored observations of different measurement bases under one identity.
set local session_replication_role = replica;
update public.takeoff_item_answer_observations set measurement_basis = case ordinal when 1 then 'surface au sol' else 'linéaire' end
where answer_id = (select a.id from public.takeoff_item_answers a where a.job_id = pg_temp.job(20, 4) and a.item_id = pg_temp.f(300))
  and role = 'contribution';
set local session_replication_role = origin;
insert into plans values ('two_bases', pg_temp.reidentified());
insert into plans values ('module_off', pg_temp.reidentified());
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(772, 'two_bases')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE item_changed',
  'point 4: two bases among the parts are never stored under one identity');
reset role;
set local session_replication_role = replica;
update public.takeoff_item_answer_observations set measurement_basis = null
where answer_id = (select a.id from public.takeoff_item_answers a where a.job_id = pg_temp.job(20, 4) and a.item_id = pg_temp.f(300));
set local session_replication_role = origin;
-- Point 10: the module withdrawn for the tenant refuses the send (after the waits, before any answer).
update public.feature_flags set enabled = false where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(773, 'module_off')$$), '55000 TAKEOFF_ITEM_SEND_MODULE_DISABLED',
  'point 10: the module off, nothing is sent');
reset role;
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
-- The door of the applied job: a service-role caller without the send's door is refused as before.
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(pg_temp.refusal($$update public.takeoff_jobs set status = 'applied' where id = pg_temp.f(1911)$$),
  'P0001 TAKEOFF_APPLY_AUTH_REQUIRED', 'the guard of the applied job refuses a caller without a member as before');
reset role;

-- Point 7: the bathtub entered on this plan as 6 « pièces » (section 7); the planner writes its unit as « u ». Sent for good
-- into the draft (a new line), so that point 8 can delete it.
select is((select e.unit from public.takeoff_item_entries e where e.item_id = pg_temp.f(302) and e.plan_logical_id = pg_temp.f(100)),
  'pièces', 'the bathtub''s entry on this plan keeps the member''s spelling');
select is((private.normalize_unit('pièces')).unit_code, 'u', 'the referential reads « pièces » as u');
create function pg_temp.bathtub(p_job uuid, p_replaces jsonb default '[]'::jsonb, p_resolutions jsonb default '[]'::jsonb)
returns jsonb language sql as $$
  select jsonb_set(jsonb_set(jsonb_set(pg_temp.plan(p_job, (select version_id from draft), jsonb_build_array(
      jsonb_set(jsonb_set(pg_temp.new_line(p_job, 302, 6, 'list:', (select s.estimate_item_id from public.takeoff_item_send_sections s
        where s.section_key = 'list:' and s.version_id = (select version_id from draft))),
        '{contributions}', (select jsonb_agg(jsonb_set(c.value, '{unit}', '"u"')) from jsonb_array_elements(pg_temp.parts(p_job, 302)) c(value))),
        '{replaces}', p_replaces))),
    '{page_decisions}', '[{"page": 2, "decision": "keep_both", "reason_code": "other_trade"}, {"page": 7, "decision": "keep_both", "reason_code": "other_zone"}]'::jsonb),
    '{dependencies,resolutions}', p_resolutions),
    '{page_contributions}', pg_temp.page_contributions(jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(302),
      'key', pg_temp.f(302) || '|together', 'contributions', pg_temp.parts(p_job, 302)))))
$$;
insert into plans values ('alias', pg_temp.bathtub(pg_temp.job(20, 4)));
select pg_temp.sign_in(1);
set local role authenticated;
select is((pg_temp.send(774, 'alias') ->> 'lines_written'), '1', 'point 7: a unit alias is compared by its canonical code');
reset role;
select results_eq($$select p.unit, p.unit_code, p.quantity from public.takeoff_item_send_parts p
  where p.item_id = pg_temp.f(302) and p.state = 'live'$$, $$values ('pièces'::text, 'u'::text, 6::numeric)$$,
  'the journal keeps the spelling, the target its code');
-- Point 9: every job of the plan's set is now sent by item; the affaire's director still opens the plan they read.
select pg_temp.sign_in(3);
select is(private.can_read_takeoff_plan_evidence(pg_temp.f(10), pg_temp.f(40), pg_temp.f(100),
    concat_ws('/', pg_temp.f(10), pg_temp.f(40), pg_temp.f(100), 'plan-1.pdf')), true,
  'point 9: the affaire''s director still opens the plan the jobs sent by item read');

-- Point 8: the editor deletes the bathtub's line; a fifth reading re-sends it as a new line by the member's choice, and
-- the displaced live part is retired in the same transaction, its history kept.
select set_config('miaouffrage.estimate_v3_writer', (select version_id::text from draft), true);
delete from public.estimate_items where id = (select t.estimate_item_id from public.takeoff_item_send_targets t
  where t.item_id = pg_temp.f(302) and t.version_id = (select version_id from draft));
select public.estimate_v3_complete_entry_for_writer((select version_id from draft), '{}'::uuid[]);
select set_config('miaouffrage.estimate_v3_writer', '', true);
select is((select count(*)::integer from public.takeoff_item_send_targets t where t.item_id = pg_temp.f(302)
  and t.estimate_item_id is null), 1, 'the target lost its line; its part is still live');
select results_eq($$select outcome from pg_temp.launch(20, 5)$$, $$values ('admitted'::text)$$, 'a fifth reading of the plan');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(20, 5), 'handed');
select is(pg_temp.claim(pg_temp.job(20, 5), 905), 1, 'claimed');
select results_eq($$select replayed from pg_temp.publish(pg_temp.job(20, 5), 905, pg_temp.valid(5), pg_temp.rows_(5),
    pg_temp.vector(5))$$, $$values (false)$$, 'published');
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb
where job_id = pg_temp.job(20, 5);
-- The readers give the planner what the writer reads: the target whose line was deleted, its part still live, and the
-- pages each answer searched.
select pg_temp.sign_in(1);
set local role authenticated;
select results_eq($$select t.value ->> 'item_id', jsonb_array_length(t.value -> 'parts')
  from jsonb_array_elements(public.read_takeoff_item_send_draft(pg_temp.f(10), pg_temp.f(20), (select version_id from draft),
    pg_temp.job(20, 5)) -> 'displaced_targets') t(value)$$, $$values (pg_temp.f(302)::text, 1)$$,
  'the draft reader names the target whose line the editor deleted, with its live part');
select is((select a.value -> 'searched_pages' from jsonb_array_elements(public.read_takeoff_item_send_facts(pg_temp.f(10), pg_temp.f(20),
    pg_temp.job(20, 5)) -> 'answers') a(value) where a.value ->> 'item_id' = pg_temp.f(300)::text), '[2, 7]'::jsonb,
  'the facts reader gives the pages each answer searched');
reset role;
insert into plans values ('recreated', pg_temp.bathtub(pg_temp.job(20, 5),
  (select jsonb_agg(jsonb_build_object('job_id', p.job_id, 'answer_id', p.answer_id, 'observation_ids', to_jsonb(p.observation_ids),
    'quantity', p.quantity)) from public.takeoff_item_send_parts p where p.item_id = pg_temp.f(302) and p.state = 'live'),
  jsonb_build_array(jsonb_build_object('key', 'target:' || pg_temp.f(302) || '|together', 'choice', '{"kind": "new_line"}'::jsonb))));
select pg_temp.sign_in(1);
set local role authenticated;
select is((pg_temp.send(775, 'recreated') ->> 'parts_replaced'), '1',
  'point 8: the recreated line retires the displaced part, never refused for ever');
reset role;
select results_eq($$select p.job_id, p.state from public.takeoff_item_send_parts p where p.item_id = pg_temp.f(302) order by p.created_at, p.state$$,
  $$values (pg_temp.job(20, 4), 'replaced'::text), (pg_temp.job(20, 5), 'live')$$, 'its history kept');

-- 16. Affaire 22: its list holds an item of a DPGF import (the WC, import ...340). Points 3, 5 and 11.
create function pg_temp.wc_answers() returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(320), 'outcome', 'measured', 'reasons', '[]'::jsonb,
    'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'quantity', jsonb_build_object('value', 7, 'unit', 'u'),
    'candidate', null, 'observations', jsonb_build_array(
      pg_temp.observation('contribution', 2, 2, 'u', 1930), pg_temp.observation('contribution', 7, 5, 'u', 1931))))
$$;
select results_eq($$select outcome from pg_temp.launch(22, 1)$$, $$values ('admitted'::text)$$, 'affaire 22 reads its plan against its list');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(22, 1), 'handed');
select is(pg_temp.claim(pg_temp.job(22, 1), 922), 1, 'claimed');
select results_eq($$select replayed from pg_temp.publish(pg_temp.job(22, 1), 922, pg_temp.wc_answers(),
    jsonb_build_array(pg_temp.row_(1930, 2, 2), pg_temp.row_(1931, 5, 7)), null, array[2, 7], '[]'::jsonb)$$,
  $$values (false)$$, 'and published: the WC measured 2 on page 2 and 5 on page 7');
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb
where job_id = pg_temp.job(22, 1);
select pg_temp.sign_in(1);
set local role authenticated;
select is(public.review_takeoff_items(pg_temp.f(10), pg_temp.f(22), pg_temp.cmd('accept_measured', 650, array[320], array[320])) ->> 'outcome',
  'applied', 'the WC accepted');
reset role;
-- The whole list: a first draft holds no line of the import.
insert into plans values ('wc_first', pg_temp.plan(pg_temp.job(22, 1), null, jsonb_build_array(pg_temp.new_line(pg_temp.job(22, 1), 320, 7,
  p_project => 22)), '[{"key": "list:", "title": "Métré", "parent_key": null, "parent_id": null}]'::jsonb, pg_temp.payload(990), 22),
  pg_temp.payload(990));
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(780, 'wc_first')$$), '22023 TAKEOFF_ITEM_SEND_DPGF_IMPORT_REQUIRED',
  'point 5: a list of a DPGF import is sent only into a draft holding that import''s lines');
reset role;
-- A draft of the affaire holding the import's DPGF line of the WC: its DPGF quantity stated as null, its mapped row's
-- « 4,0 » the fallback (point 11), and today's provenance of an earlier analysis of page 2 on it (a legacy part of 1).
set local session_replication_role = replica;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values (pg_temp.f(991), pg_temp.f(10), pg_temp.f(22), 1, 3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 1.3, 1.2,
  0, 0, 0, 0, 0, 0);
insert into public.dpgf_imports (id, tenant_id, project_id, user_id, filename, source_format, status, row_count, parse_mode)
values (pg_temp.f(340), pg_temp.f(10), pg_temp.f(22), pg_temp.f(1), 'dpgf-fictif.xlsx', 'xlsx', 'completed', 1, 'server');
insert into public.dpgf_rows_mapped (id, tenant_id, import_id, payload, raw_row_id, status)
values (pg_temp.f(342), pg_temp.f(10), pg_temp.f(340), '{"designation": "WC (fictif)", "quantity": "4,0", "unit": "u"}'::jsonb,
  pg_temp.f(343), 'mapped');
insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, plan_set_id, level, status, created_by,
  preparation_snapshot, source_file_name)
values (pg_temp.f(1920), pg_temp.f(10), pg_temp.f(22), pg_temp.f(991), pg_temp.f(42), 'C', 'applied', pg_temp.f(1), pg_temp.snapshot(22),
  'plan-1.pdf');
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
  source_page, metadata, rule_results)
values (pg_temp.f(1921), pg_temp.f(10), pg_temp.f(1920), 'WC (fictif)', 1, 'u', 0.9, 'Repère fictif', 'plan-1.pdf', 2,
  jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.f(102))), '[]'::jsonb);
set local session_replication_role = origin;
select set_config('miaouffrage.estimate_v3_writer', pg_temp.f(991)::text, true);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
values (pg_temp.f(992), pg_temp.f(10), pg_temp.f(991), 'section', 1, 'Lot fictif');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity, unit_code,
  pricing_status, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents, line_total_ht_cents,
  line_tax_cents, line_total_ttc_cents, source_provider, source_job_id, source_metadata)
values (pg_temp.f(993), pg_temp.f(10), pg_temp.f(991), pg_temp.f(992), 'line', 1, 'WC (DPGF fictif)', 'u', 4, 'u', 'priced', 0, 2000,
  1, 0, 1, 1, 0, 0, 0, 0, 'dpgf', pg_temp.f(1920), jsonb_build_object('import_id', pg_temp.f(340), 'mapped_row_id', pg_temp.f(342),
    'dpgf_source_quantity', null, 'takeoff_quantity_policy', jsonb_build_object('version', 2, 'job_id', pg_temp.f(1920),
      'item_ids', jsonb_build_array(pg_temp.f(1921)), 'contributions', jsonb_build_array(jsonb_build_object('job_id', pg_temp.f(1920),
        'item_ids', jsonb_build_array(pg_temp.f(1921)), 'quantity', 1, 'protective', 0, 'printed_gap', 0)))));
select public.estimate_v3_complete_entry_for_writer(pg_temp.f(991), array[pg_temp.f(993)]);
select set_config('miaouffrage.estimate_v3_writer', '', true);
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.f(991), pg_temp.f(1), pg_temp.f(10), now() + interval '10 minutes', gen_random_uuid());
select is(private.takeoff_item_send_dpgf_reference(pg_temp.f(10), (select source_metadata from public.estimate_items where id = pg_temp.f(993))),
  4::numeric, 'point 11: an explicit null DPGF quantity falls back to the mapped row''s « 4,0 », as the preview reads it');
create function pg_temp.wc(p_parts jsonb, p_decisions jsonb, p_not_sent jsonb, p_after numeric, p_kind text default 'dpgf_line')
returns jsonb language sql as $$
  select jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.plan(pg_temp.job(22, 1), pg_temp.f(991), jsonb_build_array(
      case when p_kind = 'dpgf_line' then jsonb_set(pg_temp.earlier_line(pg_temp.job(22, 1), 320, pg_temp.f(993), p_after, 'dpgf_line', 'dpgf',
        p_project => 22), '{contributions}', p_parts)
      else jsonb_set(pg_temp.new_line(pg_temp.job(22, 1), 320, p_after, p_project => 22), '{contributions}', p_parts) end),
      case when p_kind = 'dpgf_line' then '[]'::jsonb else '[{"key": "list:", "title": "Métré", "parent_key": null, "parent_id": null}]'::jsonb end,
      null, 22),
    '{page_decisions}', p_decisions), '{parts_not_sent}', p_not_sent),
    '{page_contributions}', pg_temp.page_contributions(jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(320),
      'key', pg_temp.f(320) || '|dpgf', 'contributions', p_parts)))),
    '{dependencies,resolutions}', jsonb_build_array(jsonb_build_object('key', 'target:' || pg_temp.f(320) || '|dpgf',
      'choice', jsonb_build_object('kind', 'line', 'estimate_item_id', pg_temp.f(993))))),
    '{dependencies,lines}', (select jsonb_agg(jsonb_build_object('estimate_item_id', i.id, 'updated_at', i.updated_at, 'quantity', i.quantity,
      'dpgf', jsonb_build_object('import_id', pg_temp.f(340), 'raw_row_id', null,
        'reference', private.takeoff_item_send_dpgf_reference(pg_temp.f(10), i.source_metadata))))
      from public.estimate_items i where i.id = pg_temp.f(993)))
$$;
create function pg_temp.wc_on(p_page integer) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(c.value), '[]'::jsonb) from jsonb_array_elements(pg_temp.parts(pg_temp.job(22, 1), 320, 22)) c(value)
  where c.value -> 'pages' @> to_jsonb(p_page)
$$;
create function pg_temp.wc_held(p_page integer) returns jsonb language sql stable as $$
  select (select jsonb_agg(jsonb_build_object('item_id', pg_temp.f(320), 'kind', 'measured', 'observation_ids', c.value -> 'observation_ids',
    'pages', c.value -> 'pages', 'quantity', c.value -> 'quantity', 'unit', 'u', 'reason', 'page_held'))
    from jsonb_array_elements(pg_temp.wc_on(p_page)) c(value))
$$;
insert into plans values
  ('wc_keep_both', pg_temp.wc(pg_temp.parts(pg_temp.job(22, 1), 320, 22), '[{"page": 2, "decision": "keep_both", "reason_code": "other_zone"}]'::jsonb,
    '[]'::jsonb, 8)),
  ('wc_replace', pg_temp.wc(pg_temp.parts(pg_temp.job(22, 1), 320, 22), '[{"page": 2, "decision": "replace"}]'::jsonb, '[]'::jsonb, 8)),
  ('wc_new_line', jsonb_set(pg_temp.wc(pg_temp.wc_on(7), '[]'::jsonb, pg_temp.wc_held(2), 5, 'new_line'),
    '{dependencies,resolutions}', '[]'::jsonb)),
  ('wc_page_7', pg_temp.wc(pg_temp.wc_on(7), '[]'::jsonb, pg_temp.wc_held(2), 6));
create function pg_temp.wc_import_moved() returns jsonb language plpgsql security definer as $$
begin
  update public.dpgf_imports set row_count = 2 where id = pg_temp.f(340);
  return pg_temp.send(781, 'wc_page_7');
end;
$$;
grant execute on function pg_temp.wc_import_moved() to authenticated;
select pg_temp.sign_in(1);
select is(pg_temp.refusal($$select pg_temp.wc_import_moved()$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE dpgf_changed',
  'the DPGF import of the draft''s lines read again since the plan (its rows counted otherwise): asked again');
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(781, 'wc_keep_both')$$),
  '22023 TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID keep_both_same_line',
  'point 3: « garder les deux » never onto the line an earlier analysis wrote from that page');
select is(pg_temp.refusal($$select pg_temp.send(781, 'wc_replace')$$),
  '22023 TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID replace_not_cuttable', 'nor « remplacer » a reading without parts per item');
select is(pg_temp.refusal($$select pg_temp.send(781, 'wc_new_line')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE target_changed',
  'point 5: an item of the import never goes to a new line while the draft holds the import''s lines');
select is(pg_temp.refusal($$select pg_temp.send(710, 'wc_page_7')$$), '40001 TAKEOFF_ITEM_SEND_REQUEST_CONFLICT',
  'an intention key of another affaire of the tenant is a request conflict');
reset role;
-- Closing 5: the line of the import the member chose (its raw row differs from the item's), in the planner's former
-- spelling (estimateItemId): a key the writer does not read is a refused plan, never a choice read as missing.
insert into plans select 'wc_planner_choice', jsonb_set(body, '{dependencies,resolutions,0,choice}',
  jsonb_build_object('kind', 'line', 'estimateItemId', pg_temp.f(993))), payload from plans where name = 'wc_page_7';
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(781, 'wc_planner_choice')$$), '22023 TAKEOFF_ITEM_SEND_INVALID',
  'closing 5: a choice of line spelled otherwise than the writer reads it is a malformed plan');
-- The same choice as the planner writes it now (estimate_item_id): confirmed.
select is((pg_temp.send(781, 'wc_page_7') -> 'lines' -> 0 ->> 'quantity_after'), '6',
  'page 2 left out, page 7 sent: the DPGF line holds max(4, 1 + 5) = 6, its legacy part kept');
reset role;
select results_eq($$select t.item_id, t.breakdown, t.line_kind from public.takeoff_item_send_targets t where t.version_id = pg_temp.f(991)$$,
  $$values (pg_temp.f(320), 'dpgf'::text, 'dpgf_line'::text)$$, 'the DPGF line is claimed by the WC, once');

-- 17. Point 11's number rule, on the vectors the planner's parseQuantity runs (item-send-plan.test.ts reads them here):
--     a JSON number or a text of the French entry grammar, three decimals at most.
create temp table quantity_vectors as select * from jsonb_to_recordset($quantities$[
  {"position": 1, "label": "a JSON number", "value": 4, "read": 4},
  {"position": 2, "label": "a JSON number rounded to three decimals", "value": 1.23456, "read": 1.235},
  {"position": 3, "label": "a decimal comma", "value": "4,0", "read": 4},
  {"position": 4, "label": "grouped French decimal", "value": "1 234,5", "read": 1234.5},
  {"position": 5, "label": "a narrow no-break space", "value": "1 234,5", "read": 1234.5},
  {"position": 6, "label": "dots as thousands", "value": "1.234,5", "read": 1234.5},
  {"position": 7, "label": "commas as thousands", "value": "1,234.5", "read": 1234.5},
  {"position": 8, "label": "a lone dot and three digits is not guessed", "value": "1.234", "read": null},
  {"position": 9, "label": "a decimal dot", "value": "12.5", "read": 12.5},
  {"position": 10, "label": "an apostrophe as thousands", "value": "1'234", "read": 1234},
  {"position": 11, "label": "four decimals are refused, never rounded", "value": "0,0004", "read": null},
  {"position": 12, "label": "a trailing separator", "value": "12,", "read": null},
  {"position": 13, "label": "text", "value": "environ 4", "read": null},
  {"position": 14, "label": "a badly grouped number", "value": "12 34", "read": null},
  {"position": 15, "label": "an empty text", "value": "", "read": null},
  {"position": 16, "label": "a JSON null", "value": null, "read": null},
  {"position": 17, "label": "trimmed as the planner trims (a leading no-break space)", "value": "\u00a01 234,5", "read": 1234.5},
  {"position": 18, "label": "a sign", "value": "-2,5", "read": -2.5},
  {"position": 19, "label": "two decimal separators", "value": "1,2,3", "read": null}
]$quantities$::jsonb) as v(position integer, label text, value jsonb, read numeric);
select is(private.takeoff_item_send_parse_quantity(v.value), v.read, format('quantity vector %s: %s', v.position, v.label))
from quantity_vectors v order by v.position;
-- The identity's comparison forms, on the vectors the planner's fold runs (item-send-fold.ts, item-send-twin.test.ts reads
-- them here): marks of several scripts, a ligature, full widths, case, white space, and every combining mark range.
create temp table identity_vectors as select * from jsonb_to_recordset($identities$[
  {"position": 1, "label": "case and accents", "value": "Surface au Sol", "folded": "surface au sol", "diameter": "surface au sol"},
  {"position": 2, "label": "punctuation", "value": "EF/EC \u2014 cuivre", "folded": "ef ec cuivre", "diameter": "ef/ec \u2014 cuivre"},
  {"position": 3, "label": "an accented letter", "value": "Lin\u00e9aire", "folded": "lineaire", "diameter": "lin\u00e9aire"},
  {"position": 4, "label": "a diameter as written", "value": " 1/2\" ", "folded": "1 2", "diameter": "1/2\""},
  {"position": 5, "label": "spaces", "value": "DN  32", "folded": "dn 32", "diameter": "dn 32"},
  {"position": 6, "label": "nothing", "value": "  ", "folded": null, "diameter": null},
  {"position": 7, "label": "an Arabic vowel mark (copper)", "value": "\u0646\u064f\u062d\u0627\u0633", "folded": "\u0646\u062d\u0627\u0633", "diameter": "\u0646\u064f\u062d\u0627\u0633"},
  {"position": 8, "label": "Hebrew points (copper)", "value": "\u05e0\u05b0\u05d7\u05b9\u05e9\u05b6\u05c1\u05ea", "folded": "\u05e0\u05d7\u05e9\u05ea", "diameter": "\u05e0\u05b0\u05d7\u05b9\u05e9\u05b6\u05c1\u05ea"},
  {"position": 9, "label": "Devanagari signs (copper)", "value": "\u0924\u093e\u0901\u092c\u093e", "folded": "\u0924\u092c", "diameter": "\u0924\u093e\u0901\u092c\u093e"},
  {"position": 10, "label": "Vietnamese stacked marks", "value": "\u0110\u1ed3ng", "folded": "\u0111ong", "diameter": "\u0111\u1ed3ng"},
  {"position": 11, "label": "a ligature and full widths", "value": "\ufb01bre \uff23\uff55", "folded": "fibre cu", "diameter": "\ufb01bre \uff43\uff55"},
  {"position": 12, "label": "Greek capitals and the final sigma", "value": "\u039f\u0394\u039f\u03a3", "folded": "\u03bf\u03b4\u03bf\u03c2", "diameter": "\u03bf\u03b4\u03bf\u03c2"},
  {"position": 13, "label": "a dotted capital I", "value": "\u0130nox", "folded": "inox", "diameter": "i\u0307nox"},
  {"position": 14, "label": "a Japanese voiced mark", "value": "\u30ac\u30b9", "folded": "\u30ab\u30b9", "diameter": "\u30ac\u30b9"},
  {"position": 15, "label": "a narrow no-break space", "value": "DN\u202f32", "folded": "dn 32", "diameter": "dn 32"},
  {"position": 16, "label": "a no-break space", "value": "DN\u00a032", "folded": "dn 32", "diameter": "dn 32"},
  {"position": 17, "label": "a diameter sign", "value": "\u00d832", "folded": "\u00f832", "diameter": "\u00f832"},
  {"position": 18, "label": "every combining mark range, first and last", "value": "a\u0300a\u036fa\u0483a\u0489a\u0591a\u05bda\u05bfa\u05c1a\u05c2a\u05c4a\u05c5a\u05c7a\u0610a\u061aa\u064ba\u065fa\u0670a\u06d6a\u06dca\u06dfa\u06e4a\u06e7a\u06e8a\u06eaa\u06eda\u0711a\u0730a\u074aa\u07a6a\u07b0a\u07eba\u07f3a\u07fda\u0816a\u0819a\u081ba\u0823a\u0825a\u0827a\u0829a\u082da\u0859a\u085ba\u0897a\u089fa\u08caa\u08e1a\u08e3a\u0903a\u093aa\u093ca\u093ea\u094fa\u0951a\u0957a\u0962a\u0963a\u0981a\u0983a\u09bca\u09bea\u09c4a\u09c7a\u09c8a\u09cba\u09cda\u09d7a\u09e2a\u09e3a\u09fea\u0a01a\u0a03a\u0a3ca\u0a3ea\u0a42a\u0a47a\u0a48a\u0a4ba\u0a4da\u0a51a\u0a70a\u0a71a\u0a75a\u0a81a\u0a83a\u0abca\u0abea\u0ac5a\u0ac7a\u0ac9a\u0acba\u0acda\u0ae2a\u0ae3a\u0afaa\u0affa\u0b01a\u0b03a\u0b3ca\u0b3ea\u0b44a\u0b47a\u0b48a\u0b4ba\u0b4da\u0b55a\u0b57a\u0b62a\u0b63a\u0b82a\u0bbea\u0bc2a\u0bc6a\u0bc8a\u0bcaa\u0bcda\u0bd7a\u0c00a\u0c04a\u0c3ca\u0c3ea\u0c44a\u0c46a\u0c48a\u0c4aa\u0c4da\u0c55a\u0c56a\u0c62a\u0c63a\u0c81a\u0c83a\u0cbca\u0cbea\u0cc4a\u0cc6a\u0cc8a\u0ccaa\u0ccda\u0cd5a\u0cd6a\u0ce2a\u0ce3a\u0cf3a\u0d00a\u0d03a\u0d3ba\u0d3ca\u0d3ea\u0d44a\u0d46a\u0d48a\u0d4aa\u0d4da\u0d57a\u0d62a\u0d63a\u0d81a\u0d83a\u0dcaa\u0dcfa\u0dd4a\u0dd6a\u0dd8a\u0ddfa\u0df2a\u0df3a\u0e31a\u0e34a\u0e3aa\u0e47a\u0e4ea\u0eb1a\u0eb4a\u0ebca\u0ec8a\u0ecea\u0f18a\u0f19a\u0f35a\u0f37a\u0f39a\u0f3ea\u0f3fa\u0f71a\u0f84a\u0f86a\u0f87a\u0f8da\u0f97a\u0f99a\u0fbca\u0fc6a\u102ba\u103ea\u1056a\u1059a\u105ea\u1060a\u1062a\u1064a\u1067a\u106da\u1071a\u1074a\u1082a\u108da\u108fa\u109aa\u109da\u135da\u135fa\u1712a\u1715a\u1732a\u1734a\u1752a\u1753a\u1772a\u1773a\u17b4a\u17d3a\u17dda\u180ba\u180da\u180fa\u1885a\u1886a\u18a9a\u1920a\u192ba\u1930a\u193ba\u1a17a\u1a1ba\u1a55a\u1a5ea\u1a60a\u1a7ca\u1a7fa\u1ab0a\u1adda\u1ae0a\u1aeba\u1b00a\u1b04a\u1b34a\u1b44a\u1b6ba\u1b73a\u1b80a\u1b82a\u1ba1a\u1bada\u1be6a\u1bf3a\u1c24a\u1c37a\u1cd0a\u1cd2a\u1cd4a\u1ce8a\u1ceda\u1cf4a\u1cf7a\u1cf9a\u1dc0a\u1dffa\u20d0a\u20f0a\u2cefa\u2cf1a\u2d7fa\u2de0a\u2dffa\u302aa\u302fa\u3099a\u309aa\ua66fa\ua672a\ua674a\ua67da\ua69ea\ua69fa\ua6f0a\ua6f1a\ua802a\ua806a\ua80ba\ua823a\ua827a\ua82ca\ua880a\ua881a\ua8b4a\ua8c5a\ua8e0a\ua8f1a\ua8ffa\ua926a\ua92da\ua947a\ua953a\ua980a\ua983a\ua9b3a\ua9c0a\ua9e5a\uaa29a\uaa36a\uaa43a\uaa4ca\uaa4da\uaa7ba\uaa7da\uaab0a\uaab2a\uaab4a\uaab7a\uaab8a\uaabea\uaabfa\uaac1a\uaaeba\uaaefa\uaaf5a\uaaf6a\uabe3a\uabeaa\uabeca\uabeda\ufb1ea\ufe00a\ufe0fa\ufe20a\ufe2fa\ud800\uddfda\ud800\udee0a\ud800\udf76a\ud800\udf7aa\ud802\ude01a\ud802\ude03a\ud802\ude05a\ud802\ude06a\ud802\ude0ca\ud802\ude0fa\ud802\ude38a\ud802\ude3aa\ud802\ude3fa\ud802\udee5a\ud802\udee6a\ud803\udd24a\ud803\udd27a\ud803\udd69a\ud803\udd6da\ud803\udeaba\ud803\udeaca\ud803\udefaa\ud803\udeffa\ud803\udf46a\ud803\udf50a\ud803\udf82a\ud803\udf85a\ud804\udc00a\ud804\udc02a\ud804\udc38a\ud804\udc46a\ud804\udc70a\ud804\udc73a\ud804\udc74a\ud804\udc7fa\ud804\udc82a\ud804\udcb0a\ud804\udcbaa\ud804\udcc2a\ud804\udd00a\ud804\udd02a\ud804\udd27a\ud804\udd34a\ud804\udd45a\ud804\udd46a\ud804\udd73a\ud804\udd80a\ud804\udd82a\ud804\uddb3a\ud804\uddc0a\ud804\uddc9a\ud804\uddcca\ud804\uddcea\ud804\uddcfa\ud804\ude2ca\ud804\ude37a\ud804\ude3ea\ud804\ude41a\ud804\udedfa\ud804\udeeaa\ud804\udf00a\ud804\udf03a\ud804\udf3ba\ud804\udf3ca\ud804\udf3ea\ud804\udf44a\ud804\udf47a\ud804\udf48a\ud804\udf4ba\ud804\udf4da\ud804\udf57a\ud804\udf62a\ud804\udf63a\ud804\udf66a\ud804\udf6ca\ud804\udf70a\ud804\udf74a\ud804\udfb8a\ud804\udfc0a\ud804\udfc2a\ud804\udfc5a\ud804\udfc7a\ud804\udfcaa\ud804\udfcca\ud804\udfd0a\ud804\udfd2a\ud804\udfe1a\ud804\udfe2a\ud805\udc35a\ud805\udc46a\ud805\udc5ea\ud805\udcb0a\ud805\udcc3a\ud805\uddafa\ud805\uddb5a\ud805\uddb8a\ud805\uddc0a\ud805\udddca\ud805\udddda\ud805\ude30a\ud805\ude40a\ud805\udeaba\ud805\udeb7a\ud805\udf1da\ud805\udf2ba\ud806\udc2ca\ud806\udc3aa\ud806\udd30a\ud806\udd35a\ud806\udd37a\ud806\udd38a\ud806\udd3ba\ud806\udd3ea\ud806\udd40a\ud806\udd42a\ud806\udd43a\ud806\uddd1a\ud806\uddd7a\ud806\udddaa\ud806\udde0a\ud806\udde4a\ud806\ude01a\ud806\ude0aa\ud806\ude33a\ud806\ude39a\ud806\ude3ba\ud806\ude3ea\ud806\ude47a\ud806\ude51a\ud806\ude5ba\ud806\ude8aa\ud806\ude99a\ud806\udf60a\ud806\udf67a\ud807\udc2fa\ud807\udc36a\ud807\udc38a\ud807\udc3fa\ud807\udc92a\ud807\udca7a\ud807\udca9a\ud807\udcb6a\ud807\udd31a\ud807\udd36a\ud807\udd3aa\ud807\udd3ca\ud807\udd3da\ud807\udd3fa\ud807\udd45a\ud807\udd47a\ud807\udd8aa\ud807\udd8ea\ud807\udd90a\ud807\udd91a\ud807\udd93a\ud807\udd97a\ud807\udef3a\ud807\udef6a\ud807\udf00a\ud807\udf01a\ud807\udf03a\ud807\udf34a\ud807\udf3aa\ud807\udf3ea\ud807\udf42a\ud807\udf5aa\ud80d\udc40a\ud80d\udc47a\ud80d\udc55a\ud818\udd1ea\ud818\udd2fa\ud81a\udef0a\ud81a\udef4a\ud81a\udf30a\ud81a\udf36a\ud81b\udf4fa\ud81b\udf51a\ud81b\udf87a\ud81b\udf8fa\ud81b\udf92a\ud81b\udfe4a\ud81b\udff0a\ud81b\udff1a\ud82f\udc9da\ud82f\udc9ea\ud833\udf00a\ud833\udf2da\ud833\udf30a\ud833\udf46a\ud834\udd65a\ud834\udd69a\ud834\udd6da\ud834\udd72a\ud834\udd7ba\ud834\udd82a\ud834\udd85a\ud834\udd8ba\ud834\uddaaa\ud834\uddada\ud834\ude42a\ud834\ude44a\ud836\ude00a\ud836\ude36a\ud836\ude3ba\ud836\ude6ca\ud836\ude75a\ud836\ude84a\ud836\ude9ba\ud836\ude9fa\ud836\udea1a\ud836\udeafa\ud838\udc00a\ud838\udc06a\ud838\udc08a\ud838\udc18a\ud838\udc1ba\ud838\udc21a\ud838\udc23a\ud838\udc24a\ud838\udc26a\ud838\udc2aa\ud838\udc8fa\ud838\udd30a\ud838\udd36a\ud838\udeaea\ud838\udeeca\ud838\udeefa\ud839\udceca\ud839\udcefa\ud839\uddeea\ud839\uddefa\ud839\udee3a\ud839\udee6a\ud839\udeeea\ud839\udeefa\ud839\udef5a\ud83a\udcd0a\ud83a\udcd6a\ud83a\udd44a\ud83a\udd4aa\udb40\udd00a\udb40\uddefa", "folded": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "diameter": "\u00e0a\u036fa\u0483a\u0489a\u0591a\u05bda\u05bfa\u05c1a\u05c2a\u05c4a\u05c5a\u05c7a\u0610a\u061aa\u064ba\u065fa\u0670a\u06d6a\u06dca\u06dfa\u06e4a\u06e7a\u06e8a\u06eaa\u06eda\u0711a\u0730a\u074aa\u07a6a\u07b0a\u07eba\u07f3a\u07fda\u0816a\u0819a\u081ba\u0823a\u0825a\u0827a\u0829a\u082da\u0859a\u085ba\u0897a\u089fa\u08caa\u08e1a\u08e3a\u0903a\u093aa\u093ca\u093ea\u094fa\u0951a\u0957a\u0962a\u0963a\u0981a\u0983a\u09bca\u09bea\u09c4a\u09c7a\u09c8a\u09cba\u09cda\u09d7a\u09e2a\u09e3a\u09fea\u0a01a\u0a03a\u0a3ca\u0a3ea\u0a42a\u0a47a\u0a48a\u0a4ba\u0a4da\u0a51a\u0a70a\u0a71a\u0a75a\u0a81a\u0a83a\u0abca\u0abea\u0ac5a\u0ac7a\u0ac9a\u0acba\u0acda\u0ae2a\u0ae3a\u0afaa\u0affa\u0b01a\u0b03a\u0b3ca\u0b3ea\u0b44a\u0b47a\u0b48a\u0b4ba\u0b4da\u0b55a\u0b57a\u0b62a\u0b63a\u0b82a\u0bbea\u0bc2a\u0bc6a\u0bc8a\u0bcaa\u0bcda\u0bd7a\u0c00a\u0c04a\u0c3ca\u0c3ea\u0c44a\u0c46a\u0c48a\u0c4aa\u0c4da\u0c55a\u0c56a\u0c62a\u0c63a\u0c81a\u0c83a\u0cbca\u0cbea\u0cc4a\u0cc6a\u0cc8a\u0ccaa\u0ccda\u0cd5a\u0cd6a\u0ce2a\u0ce3a\u0cf3a\u0d00a\u0d03a\u0d3ba\u0d3ca\u0d3ea\u0d44a\u0d46a\u0d48a\u0d4aa\u0d4da\u0d57a\u0d62a\u0d63a\u0d81a\u0d83a\u0dcaa\u0dcfa\u0dd4a\u0dd6a\u0dd8a\u0ddfa\u0df2a\u0df3a\u0e31a\u0e34a\u0e3aa\u0e47a\u0e4ea\u0eb1a\u0eb4a\u0ebca\u0ec8a\u0ecea\u0f18a\u0f19a\u0f35a\u0f37a\u0f39a\u0f3ea\u0f3fa\u0f71a\u0f84a\u0f86a\u0f87a\u0f8da\u0f97a\u0f99a\u0fbca\u0fc6a\u102ba\u103ea\u1056a\u1059a\u105ea\u1060a\u1062a\u1064a\u1067a\u106da\u1071a\u1074a\u1082a\u108da\u108fa\u109aa\u109da\u135da\u135fa\u1712a\u1715a\u1732a\u1734a\u1752a\u1753a\u1772a\u1773a\u17b4a\u17d3a\u17dda\u180ba\u180da\u180fa\u1885a\u1886a\u18a9a\u1920a\u192ba\u1930a\u193ba\u1a17a\u1a1ba\u1a55a\u1a5ea\u1a60a\u1a7ca\u1a7fa\u1ab0a\u1adda\u1ae0a\u1aeba\u1b00a\u1b04a\u1b34a\u1b44a\u1b6ba\u1b73a\u1b80a\u1b82a\u1ba1a\u1bada\u1be6a\u1bf3a\u1c24a\u1c37a\u1cd0a\u1cd2a\u1cd4a\u1ce8a\u1ceda\u1cf4a\u1cf7a\u1cf9a\u1dc0a\u1dffa\u20d0a\u20f0a\u2cefa\u2cf1a\u2d7fa\u2de0a\u2dffa\u302aa\u302fa\u3099a\u309aa\ua66fa\ua672a\ua674a\ua67da\ua69ea\ua69fa\ua6f0a\ua6f1a\ua802a\ua806a\ua80ba\ua823a\ua827a\ua82ca\ua880a\ua881a\ua8b4a\ua8c5a\ua8e0a\ua8f1a\ua8ffa\ua926a\ua92da\ua947a\ua953a\ua980a\ua983a\ua9b3a\ua9c0a\ua9e5a\uaa29a\uaa36a\uaa43a\uaa4ca\uaa4da\uaa7ba\uaa7da\uaab0a\uaab2a\uaab4a\uaab7a\uaab8a\uaabea\uaabfa\uaac1a\uaaeba\uaaefa\uaaf5a\uaaf6a\uabe3a\uabeaa\uabeca\uabeda\ufb1ea\ufe00a\ufe0fa\ufe20a\ufe2fa\ud800\uddfda\ud800\udee0a\ud800\udf76a\ud800\udf7aa\ud802\ude01a\ud802\ude03a\ud802\ude05a\ud802\ude06a\ud802\ude0ca\ud802\ude0fa\ud802\ude38a\ud802\ude3aa\ud802\ude3fa\ud802\udee5a\ud802\udee6a\ud803\udd24a\ud803\udd27a\ud803\udd69a\ud803\udd6da\ud803\udeaba\ud803\udeaca\ud803\udefaa\ud803\udeffa\ud803\udf46a\ud803\udf50a\ud803\udf82a\ud803\udf85a\ud804\udc00a\ud804\udc02a\ud804\udc38a\ud804\udc46a\ud804\udc70a\ud804\udc73a\ud804\udc74a\ud804\udc7fa\ud804\udc82a\ud804\udcb0a\ud804\udcbaa\ud804\udcc2a\ud804\udd00a\ud804\udd02a\ud804\udd27a\ud804\udd34a\ud804\udd45a\ud804\udd46a\ud804\udd73a\ud804\udd80a\ud804\udd82a\ud804\uddb3a\ud804\uddc0a\ud804\uddc9a\ud804\uddcca\ud804\uddcea\ud804\uddcfa\ud804\ude2ca\ud804\ude37a\ud804\ude3ea\ud804\ude41a\ud804\udedfa\ud804\udeeaa\ud804\udf00a\ud804\udf03a\ud804\udf3ba\ud804\udf3ca\ud804\udf3ea\ud804\udf44a\ud804\udf47a\ud804\udf48a\ud804\udf4ba\ud804\udf4da\ud804\udf57a\ud804\udf62a\ud804\udf63a\ud804\udf66a\ud804\udf6ca\ud804\udf70a\ud804\udf74a\ud804\udfb8a\ud804\udfc0a\ud804\udfc2a\ud804\udfc5a\ud804\udfc7a\ud804\udfcaa\ud804\udfcca\ud804\udfd0a\ud804\udfd2a\ud804\udfe1a\ud804\udfe2a\ud805\udc35a\ud805\udc46a\ud805\udc5ea\ud805\udcb0a\ud805\udcc3a\ud805\uddafa\ud805\uddb5a\ud805\uddb8a\ud805\uddc0a\ud805\udddca\ud805\udddda\ud805\ude30a\ud805\ude40a\ud805\udeaba\ud805\udeb7a\ud805\udf1da\ud805\udf2ba\ud806\udc2ca\ud806\udc3aa\ud806\udd30a\ud806\udd35a\ud806\udd37a\ud806\udd38a\ud806\udd3ba\ud806\udd3ea\ud806\udd40a\ud806\udd42a\ud806\udd43a\ud806\uddd1a\ud806\uddd7a\ud806\udddaa\ud806\udde0a\ud806\udde4a\ud806\ude01a\ud806\ude0aa\ud806\ude33a\ud806\ude39a\ud806\ude3ba\ud806\ude3ea\ud806\ude47a\ud806\ude51a\ud806\ude5ba\ud806\ude8aa\ud806\ude99a\ud806\udf60a\ud806\udf67a\ud807\udc2fa\ud807\udc36a\ud807\udc38a\ud807\udc3fa\ud807\udc92a\ud807\udca7a\ud807\udca9a\ud807\udcb6a\ud807\udd31a\ud807\udd36a\ud807\udd3aa\ud807\udd3ca\ud807\udd3da\ud807\udd3fa\ud807\udd45a\ud807\udd47a\ud807\udd8aa\ud807\udd8ea\ud807\udd90a\ud807\udd91a\ud807\udd93a\ud807\udd97a\ud807\udef3a\ud807\udef6a\ud807\udf00a\ud807\udf01a\ud807\udf03a\ud807\udf34a\ud807\udf3aa\ud807\udf3ea\ud807\udf42a\ud807\udf5aa\ud80d\udc40a\ud80d\udc47a\ud80d\udc55a\ud818\udd1ea\ud818\udd2fa\ud81a\udef0a\ud81a\udef4a\ud81a\udf30a\ud81a\udf36a\ud81b\udf4fa\ud81b\udf51a\ud81b\udf87a\ud81b\udf8fa\ud81b\udf92a\ud81b\udfe4a\ud81b\udff0a\ud81b\udff1a\ud82f\udc9da\ud82f\udc9ea\ud833\udf00a\ud833\udf2da\ud833\udf30a\ud833\udf46a\ud834\udd65a\ud834\udd69a\ud834\udd6da\ud834\udd72a\ud834\udd7ba\ud834\udd82a\ud834\udd85a\ud834\udd8ba\ud834\uddaaa\ud834\uddada\ud834\ude42a\ud834\ude44a\ud836\ude00a\ud836\ude36a\ud836\ude3ba\ud836\ude6ca\ud836\ude75a\ud836\ude84a\ud836\ude9ba\ud836\ude9fa\ud836\udea1a\ud836\udeafa\ud838\udc00a\ud838\udc06a\ud838\udc08a\ud838\udc18a\ud838\udc1ba\ud838\udc21a\ud838\udc23a\ud838\udc24a\ud838\udc26a\ud838\udc2aa\ud838\udc8fa\ud838\udd30a\ud838\udd36a\ud838\udeaea\ud838\udeeca\ud838\udeefa\ud839\udceca\ud839\udcefa\ud839\uddeea\ud839\uddefa\ud839\udee3a\ud839\udee6a\ud839\udeeea\ud839\udeefa\ud839\udef5a\ud83a\udcd0a\ud83a\udcd6a\ud83a\udd44a\ud83a\udd4aa\udb40\udd00a\udb40\uddefa"}
]$identities$::jsonb) as v(position integer, label text, value text, folded text, diameter text);
select is(private.takeoff_item_send_folded(v.value), v.folded, format('identity vector %s: %s (folded)', v.position, v.label))
from identity_vectors v order by v.position;
select is(private.takeoff_item_send_diameter(v.value), v.diameter, format('identity vector %s: %s (diameter)', v.position, v.label))
from identity_vectors v order by v.position;

-- 18. The closing of #484's last check (cases 3 and 6; cases 1, 2 and 5 sit beside the plans they change, above).
-- Closing 3: a page decision names its page; an explicit null is the page unknown, never a key left out.
select is(private.takeoff_item_send_plan_valid(jsonb_set(body, '{page_decisions}', '[{"decision": "replace"}]')), false,
  'closing 3: a page decision without its page is malformed') from plans where name = 'first';
select is(private.takeoff_item_send_plan_valid(jsonb_set(body, '{page_decisions}', '[{"page": null, "decision": "replace"}]')), true,
  'an explicit null names the pages unknown') from plans where name = 'first';

-- Closing 6: the WC's DPGF line deleted in the editor, its mapped row now on another DPGF line of the import (...994).
-- A second reading of the plan sent there retires the part left on the displaced target, never live beside the new one.
select set_config('miaouffrage.estimate_v3_writer', pg_temp.f(991)::text, true);
delete from public.estimate_items where id = pg_temp.f(993);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity, unit_code,
  pricing_status, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents, line_total_ht_cents,
  line_tax_cents, line_total_ttc_cents, source_provider, source_metadata)
values (pg_temp.f(994), pg_temp.f(10), pg_temp.f(991), pg_temp.f(992), 'line', 1, 'WC (DPGF fictif, réimporté)', 'u', 4, 'u', 'priced',
  0, 2000, 1, 0, 1, 1, 0, 0, 0, 0, 'dpgf', jsonb_build_object('import_id', pg_temp.f(340), 'mapped_row_id', pg_temp.f(342),
    'dpgf_source_quantity', 4));
select public.estimate_v3_complete_entry_for_writer(pg_temp.f(991), array[pg_temp.f(994)]);
select set_config('miaouffrage.estimate_v3_writer', '', true);
select results_eq($$select t.estimate_item_id is null, (select count(*)::integer from public.takeoff_item_send_parts p
    where p.target_id = t.id and p.state = 'live')
  from public.takeoff_item_send_targets t where t.version_id = pg_temp.f(991) and t.item_id = pg_temp.f(320)$$,
  $$values (true, 1)$$, 'the WC''s DPGF target lost its line; its part is still live');
create function pg_temp.wc_answers2() returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(320), 'outcome', 'measured', 'reasons', '[]'::jsonb,
    'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'quantity', jsonb_build_object('value', 7, 'unit', 'u'),
    'candidate', null, 'observations', jsonb_build_array(
      pg_temp.observation('contribution', 2, 2, 'u', 1932), pg_temp.observation('contribution', 7, 5, 'u', 1933))))
$$;
select results_eq($$select outcome from pg_temp.launch(22, 2)$$, $$values ('admitted'::text)$$, 'a second reading of affaire 22''s plan');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.job(22, 2), 'handed');
select is(pg_temp.claim(pg_temp.job(22, 2), 923), 1, 'claimed');
select results_eq($$select replayed from pg_temp.publish(pg_temp.job(22, 2), 923, pg_temp.wc_answers2(),
    jsonb_build_array(pg_temp.row_(1932, 2, 2), pg_temp.row_(1933, 5, 7)), null, array[2, 7], '[]'::jsonb)$$,
  $$values (false)$$, 'and published: the WC measured 2 on page 2 and 5 on page 7 again');
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb
where job_id = pg_temp.job(22, 2);
select pg_temp.sign_in(1);
set local role authenticated;
select is(public.review_takeoff_items(pg_temp.f(10), pg_temp.f(22), pg_temp.cmd('accept_measured', 652, array[320], array[320])) ->> 'outcome',
  'applied', 'the WC accepted');
reset role;
create function pg_temp.wc_again(p_replaces jsonb) returns jsonb language sql as $$
  select jsonb_set(jsonb_set(jsonb_set(pg_temp.plan(pg_temp.job(22, 2), pg_temp.f(991), jsonb_build_array(
      pg_temp.earlier_line(pg_temp.job(22, 2), 320, pg_temp.f(994), 7, 'dpgf_line', 'dpgf', p_project => 22)), '[]'::jsonb, null, 22),
    '{targets,0,replaces}', p_replaces),
    '{dependencies,resolutions}', jsonb_build_array(jsonb_build_object('key', 'target:' || pg_temp.f(320) || '|dpgf',
      'choice', jsonb_build_object('kind', 'line', 'estimate_item_id', pg_temp.f(994))))),
    '{dependencies,lines}', (select jsonb_agg(jsonb_build_object('estimate_item_id', i.id, 'updated_at', i.updated_at, 'quantity', i.quantity,
      'dpgf', jsonb_build_object('import_id', pg_temp.f(340), 'raw_row_id', null,
        'reference', private.takeoff_item_send_dpgf_reference(pg_temp.f(10), i.source_metadata))))
      from public.estimate_items i where i.id = pg_temp.f(994)))
$$;
insert into plans values
  ('wc_again', pg_temp.wc_again((select jsonb_agg(jsonb_build_object('job_id', p.job_id, 'answer_id', p.answer_id,
      'observation_ids', to_jsonb(p.observation_ids), 'quantity', p.quantity))
    from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id = p.target_id
    where t.version_id = pg_temp.f(991) and t.item_id = pg_temp.f(320) and t.estimate_item_id is null and p.state = 'live')), null),
  ('wc_again_keeping', pg_temp.wc_again('[]'::jsonb), null);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.send(782, 'wc_again_keeping')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE earlier_send_changed',
  'closing 6: a plan that would leave the displaced part live beside the new ones is refused');
select is((pg_temp.send(782, 'wc_again') ->> 'parts_replaced'), '1',
  'closing 6: the new DPGF line of the WC retires the part left on its deleted line''s target');
reset role;
select results_eq($$select p.job_id = pg_temp.job(22, 1), p.state from public.takeoff_item_send_parts p
  where p.version_id = pg_temp.f(991) and p.item_id = pg_temp.f(320) order by p.job_id = pg_temp.job(22, 1), p.created_at$$,
  $$values (false, 'live'::text), (false, 'live'), (true, 'replaced')$$, 'the old part is retired, kept in its history');
select is((select quantity from public.estimate_items where id = pg_temp.f(994)), 7::numeric,
  'the new DPGF line holds max(4, 2 + 5) = 7');

-- 19. One contract between the planner's output and the writer's input (closing of #484's last check). These plans are the
--     real planner's, serialised as the route sends them (item-send-contract.test.ts computes them and compares them with
--     these, key for key; keep one plan per line): each passes the writer's shape check, the writer reads from them the
--     keys it consumes, and a key removed or renamed makes the plan refused. A key renamed on one side breaks a test,
--     never a member's confirmation.
create temp table contract_plans as select * from jsonb_to_recordset($contract$[
{"name":"first","plan":{"format":"takeoff_item_send","version":1,"job_id":"c1000000-0000-4000-8000-000000000001","plan_key":"c4000000-0000-4000-8000-000000000001","list":{"revision_id":"c9000000-0000-4000-8000-000000000001","revision":3},"destination":{"kind":"first_draft"},"engine":3,"breakdown":"together","sections":[{"key":"list:lot-plomberie","title":"Plomberie","parent_key":null,"parent_id":null},{"key":"list:lot-plomberie/fam-sanitaires","title":"Appareils sanitaires","parent_key":"list:lot-plomberie","parent_id":null}],"targets":[{"key":"c5000000-0000-4000-8000-000000000001|together","item_id":"c5000000-0000-4000-8000-000000000001","compartment_key":"together","line":{"kind":"new_line","section_key":"list:lot-plomberie/fam-sanitaires","section_id":null,"title":"Lavabo PMR","unit_code":"u","order":1},"unit_code":"u","quantity_after":3,"quantity":{"reference":null,"entered":null,"earlier":0,"replaced":0,"added":3,"measured":3,"retained":3,"rounded_from":null,"gap":null,"kept_entry":false},"rule":{"rule_id":"ca000000-0000-4000-8000-000000000001","rule_version":"2026-01-02T00:00:00.000Z","action":"rename","effect":"renamed","category_id":null,"assembly_id":null},"contributions":[{"answer_id":"c7000000-0000-4000-8000-000000000001","answer_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"measured","observation_ids":["c8000000-0000-4000-8000-000000000010"],"quantity":2,"unit":"u","pages":[2],"identity":{"unit":"u","basis":null,"network":null,"material":null,"diameter":null}},{"answer_id":"c7000000-0000-4000-8000-000000000001","answer_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"measured","observation_ids":["c8000000-0000-4000-8000-000000000011"],"quantity":1,"unit":"u","pages":[7],"identity":{"unit":"u","basis":null,"network":null,"material":null,"diameter":null}}],"replaces":[]}],"page_contributions":[{"page":2,"item_ids":["c5000000-0000-4000-8000-000000000001"],"target_keys":["c5000000-0000-4000-8000-000000000001|together"],"observation_ids":["c8000000-0000-4000-8000-000000000010"]},{"page":7,"item_ids":["c5000000-0000-4000-8000-000000000001"],"target_keys":["c5000000-0000-4000-8000-000000000001|together"],"observation_ids":["c8000000-0000-4000-8000-000000000011"]}],"page_decisions":[],"left_out":[{"item_id":"c5000000-0000-4000-8000-000000000002","reason":"not_accepted","rule_id":null,"rule_version":null}],"parts_not_sent":[{"item_id":"c5000000-0000-4000-8000-000000000002","kind":"measured","observation_ids":["c8000000-0000-4000-8000-000000000020"],"pages":[2],"quantity":4,"unit":"u","reason":"not_accepted"}],"dependencies":{"answers":[{"item_id":"c5000000-0000-4000-8000-000000000001","answer_id":"c7000000-0000-4000-8000-000000000001","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","decision_revision":1,"entry_revision":null},{"item_id":"c5000000-0000-4000-8000-000000000002","answer_id":"c7000000-0000-4000-8000-000000000002","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","decision_revision":null,"entry_revision":null}],"affaire_entries":[],"rules":[{"item_id":"c5000000-0000-4000-8000-000000000001","rule_id":"ca000000-0000-4000-8000-000000000001","rule_version":"2026-01-02T00:00:00.000Z","action":"rename","effect":"renamed"}],"location_generation":null,"plan_pages":[2,7],"earlier_targets":[],"lines":[],"pages_in_estimate":[],"stamps":{"job":"job-stamp","peers":null,"context":null,"dpgf":[],"first_draft_settings":{"validite_jours":30,"discount_bp":0},"destination":null,"mapping":"mapping-stamp"},"resolutions":[]},"choices_sha256":"bfe634adca60f08119f1affffe5bd5d3fe69e9e7e834ed0070f4abe944c5f700"}},
{"name":"decided","plan":{"format":"takeoff_item_send","version":1,"job_id":"c1000000-0000-4000-8000-000000000001","plan_key":"c4000000-0000-4000-8000-000000000001","list":{"revision_id":"c9000000-0000-4000-8000-000000000001","revision":3},"destination":{"kind":"existing_draft","version_id":"c2000000-0000-4000-8000-000000000001"},"engine":3,"breakdown":"together","sections":[],"targets":[{"key":"c5000000-0000-4000-8000-000000000001|together","item_id":"c5000000-0000-4000-8000-000000000001","compartment_key":"together","line":{"kind":"earlier_line","estimate_item_id":"c6000000-0000-4000-8000-000000000010","expected_updated_at":"2026-11-22T08:00:00.000Z","expected_quantity":3},"unit_code":"u","quantity_after":6,"quantity":{"reference":null,"entered":null,"earlier":0,"replaced":3,"added":6,"measured":6,"retained":6,"rounded_from":null,"gap":null,"kept_entry":false},"rule":null,"contributions":[{"answer_id":"c7000000-0000-4000-8000-000000000003","answer_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"measured","observation_ids":["c8000000-0000-4000-8000-000000000030"],"quantity":2,"unit":"u","pages":[2],"identity":{"unit":"u","basis":null,"network":null,"material":null,"diameter":null}},{"answer_id":"c7000000-0000-4000-8000-000000000003","answer_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"measured","observation_ids":["c8000000-0000-4000-8000-000000000031"],"quantity":4,"unit":"u","pages":[7],"identity":{"unit":"u","basis":null,"network":null,"material":null,"diameter":null}}],"replaces":[{"job_id":"c1000000-0000-4000-8000-000000000002","answer_id":"c7000000-0000-4000-8000-000000000090","observation_ids":["c8000000-0000-4000-8000-000000000901"],"quantity":2},{"job_id":"c1000000-0000-4000-8000-000000000002","answer_id":"c7000000-0000-4000-8000-000000000090","observation_ids":["c8000000-0000-4000-8000-000000000902"],"quantity":1}]}],"page_contributions":[{"page":2,"item_ids":["c5000000-0000-4000-8000-000000000001"],"target_keys":["c5000000-0000-4000-8000-000000000001|together"],"observation_ids":["c8000000-0000-4000-8000-000000000030"]},{"page":7,"item_ids":["c5000000-0000-4000-8000-000000000001"],"target_keys":["c5000000-0000-4000-8000-000000000001|together"],"observation_ids":["c8000000-0000-4000-8000-000000000031"]}],"page_decisions":[{"page":2,"decision":"keep_both","reason_code":"complementary_scope","note":"Autre zone du plan (fictive)"}],"left_out":[],"parts_not_sent":[],"dependencies":{"answers":[{"item_id":"c5000000-0000-4000-8000-000000000001","answer_id":"c7000000-0000-4000-8000-000000000003","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","decision_revision":1,"entry_revision":null}],"affaire_entries":[],"rules":[],"location_generation":null,"plan_pages":[2,7],"earlier_targets":[{"estimate_item_id":"c6000000-0000-4000-8000-000000000010","item_id":"c5000000-0000-4000-8000-000000000001","compartment_key":"together","breakdown":"together","parts":[{"job_id":"c1000000-0000-4000-8000-000000000002","answer_id":"c7000000-0000-4000-8000-000000000090","observation_ids":["c8000000-0000-4000-8000-000000000901"],"quantity":2,"pages":[2],"plan_key":"c4000000-0000-4000-8000-000000000001","identity":{"unit":"u","basis":null,"network":null,"material":null,"diameter":null}},{"job_id":"c1000000-0000-4000-8000-000000000002","answer_id":"c7000000-0000-4000-8000-000000000090","observation_ids":["c8000000-0000-4000-8000-000000000902"],"quantity":1,"pages":[7],"plan_key":"c4000000-0000-4000-8000-000000000001","identity":{"unit":"u","basis":null,"network":null,"material":null,"diameter":null}}]}],"lines":[{"estimate_item_id":"c6000000-0000-4000-8000-000000000010","updated_at":"2026-11-22T08:00:00.000Z","quantity":3,"dpgf":null},{"estimate_item_id":"c6000000-0000-4000-8000-000000000011","updated_at":"2026-11-22T08:00:00.000Z","quantity":0,"dpgf":null}],"pages_in_estimate":[{"page":2,"earlier_job_ids":["c1000000-0000-4000-8000-000000000002"],"estimate_item_ids":["c6000000-0000-4000-8000-000000000011"]}],"stamps":{"job":"job-stamp","peers":"peers-stamp","context":{"peers":"p","locations":"l"},"dpgf":[{"import_id":"c3000000-0000-4000-8000-000000000001","mapping_id":"c3100000-0000-4000-8000-000000000001","rows_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","updated_at":"2026-11-22T07:00:00.000Z","status":"completed","row_count":3}],"first_draft_settings":null,"destination":{"version_id":"c2000000-0000-4000-8000-000000000001","status":"draft","updated_at":"2026-11-22T08:30:00.000Z"},"mapping":"mapping-stamp"},"resolutions":[]},"choices_sha256":"5a5fac9ac3f47d1bea020b8529c65a8e537ccee2ab2a117d10c7a97f4e425ff1"}},
{"name":"chosen","plan":{"format":"takeoff_item_send","version":1,"job_id":"c1000000-0000-4000-8000-000000000001","plan_key":"c4000000-0000-4000-8000-000000000001","list":{"revision_id":"c9000000-0000-4000-8000-000000000001","revision":3},"destination":{"kind":"existing_draft","version_id":"c2000000-0000-4000-8000-000000000001"},"engine":3,"breakdown":"together","sections":[],"targets":[{"key":"c5000000-0000-4000-8000-000000000003|dpgf","item_id":"c5000000-0000-4000-8000-000000000003","compartment_key":"dpgf","line":{"kind":"dpgf_line","estimate_item_id":"c6000000-0000-4000-8000-000000000020","expected_updated_at":"2026-11-22T08:00:00.000Z","expected_quantity":4},"unit_code":"u","quantity_after":5,"quantity":{"reference":4,"entered":null,"earlier":0,"replaced":0,"added":5,"measured":5,"retained":5,"rounded_from":null,"gap":{"absolute":1,"percent":25,"requires_review":true},"kept_entry":false},"rule":null,"contributions":[{"answer_id":"c7000000-0000-4000-8000-000000000004","answer_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"measured","observation_ids":["c8000000-0000-4000-8000-000000000040"],"quantity":5,"unit":"u","pages":[7],"identity":{"unit":"u","basis":null,"network":null,"material":null,"diameter":null}}],"replaces":[]}],"page_contributions":[{"page":7,"item_ids":["c5000000-0000-4000-8000-000000000003"],"target_keys":["c5000000-0000-4000-8000-000000000003|dpgf"],"observation_ids":["c8000000-0000-4000-8000-000000000040"]}],"page_decisions":[],"left_out":[],"parts_not_sent":[],"dependencies":{"answers":[{"item_id":"c5000000-0000-4000-8000-000000000003","answer_id":"c7000000-0000-4000-8000-000000000004","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","decision_revision":1,"entry_revision":null}],"affaire_entries":[],"rules":[],"location_generation":null,"plan_pages":[2,7],"earlier_targets":[],"lines":[{"estimate_item_id":"c6000000-0000-4000-8000-000000000020","updated_at":"2026-11-22T08:00:00.000Z","quantity":4,"dpgf":{"import_id":"c3000000-0000-4000-8000-000000000001","raw_row_id":"raw-9","reference":4}}],"pages_in_estimate":[],"stamps":{"job":"job-stamp","peers":"peers-stamp","context":{"peers":"p","locations":"l"},"dpgf":[{"import_id":"c3000000-0000-4000-8000-000000000001","mapping_id":"c3100000-0000-4000-8000-000000000001","rows_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","updated_at":"2026-11-22T07:00:00.000Z","status":"completed","row_count":3}],"first_draft_settings":null,"destination":{"version_id":"c2000000-0000-4000-8000-000000000001","status":"draft","updated_at":"2026-11-22T08:30:00.000Z"},"mapping":"mapping-stamp"},"resolutions":[{"key":"target:c5000000-0000-4000-8000-000000000003|dpgf","choice":{"kind":"line","estimate_item_id":"c6000000-0000-4000-8000-000000000020"}}]},"choices_sha256":"b03856d41a390a45f725207f76e260b8c745509c1a64379dd5138fccb3bddad9"}},
{"name":"recreated","plan":{"format":"takeoff_item_send","version":1,"job_id":"c1000000-0000-4000-8000-000000000001","plan_key":"c4000000-0000-4000-8000-000000000001","list":{"revision_id":"c9000000-0000-4000-8000-000000000001","revision":3},"destination":{"kind":"existing_draft","version_id":"c2000000-0000-4000-8000-000000000001"},"engine":3,"breakdown":"together","sections":[{"key":"list:lot-plomberie","title":"Plomberie","parent_key":null,"parent_id":null},{"key":"list:lot-plomberie/fam-sanitaires","title":"Appareils sanitaires","parent_key":"list:lot-plomberie","parent_id":null}],"targets":[{"key":"c5000000-0000-4000-8000-000000000001|together","item_id":"c5000000-0000-4000-8000-000000000001","compartment_key":"together","line":{"kind":"new_line","section_key":"list:lot-plomberie/fam-sanitaires","section_id":null,"title":"Lavabo","unit_code":"u","order":1},"unit_code":"u","quantity_after":2,"quantity":{"reference":null,"entered":null,"earlier":0,"replaced":0,"added":2,"measured":2,"retained":2,"rounded_from":null,"gap":null,"kept_entry":false},"rule":null,"contributions":[{"answer_id":"c7000000-0000-4000-8000-000000000005","answer_revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"measured","observation_ids":["c8000000-0000-4000-8000-000000000050"],"quantity":2,"unit":"u","pages":[2],"identity":{"unit":"u","basis":null,"network":null,"material":null,"diameter":null}}],"replaces":[{"job_id":"c1000000-0000-4000-8000-000000000002","answer_id":"c7000000-0000-4000-8000-000000000090","observation_ids":["c8000000-0000-4000-8000-000000000900"],"quantity":3}]}],"page_contributions":[{"page":2,"item_ids":["c5000000-0000-4000-8000-000000000001"],"target_keys":["c5000000-0000-4000-8000-000000000001|together"],"observation_ids":["c8000000-0000-4000-8000-000000000050"]}],"page_decisions":[],"left_out":[],"parts_not_sent":[],"dependencies":{"answers":[{"item_id":"c5000000-0000-4000-8000-000000000001","answer_id":"c7000000-0000-4000-8000-000000000005","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","decision_revision":1,"entry_revision":null}],"affaire_entries":[],"rules":[],"location_generation":null,"plan_pages":[2,7],"earlier_targets":[],"lines":[],"pages_in_estimate":[],"stamps":{"job":"job-stamp","peers":"peers-stamp","context":{"peers":"p","locations":"l"},"dpgf":[{"import_id":"c3000000-0000-4000-8000-000000000001","mapping_id":"c3100000-0000-4000-8000-000000000001","rows_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","updated_at":"2026-11-22T07:00:00.000Z","status":"completed","row_count":3}],"first_draft_settings":null,"destination":{"version_id":"c2000000-0000-4000-8000-000000000001","status":"draft","updated_at":"2026-11-22T08:30:00.000Z"},"mapping":"mapping-stamp"},"resolutions":[{"key":"target:c5000000-0000-4000-8000-000000000001|together","choice":{"kind":"new_line"}}]},"choices_sha256":"74169c00331d83e6b9f84a665c8c55bb3cd2f24d2464811d887261a0eccec391"}}
]$contract$::jsonb) as v(name text, plan jsonb);
select ok(private.takeoff_item_send_plan_valid(c.plan), format('contract: the planner''s plan « %s » is the writer''s', c.name))
from contract_plans c order by c.name;
select is((select c.plan #>> '{dependencies,resolutions,0,choice,estimate_item_id}' from contract_plans c where c.name = 'chosen'),
  'c6000000-0000-4000-8000-000000000020', 'contract: the writer reads the member''s chosen line where the planner writes it');
select is((select c.plan #>> '{page_decisions,0,page}' from contract_plans c where c.name = 'decided'), '2',
  'contract: the writer reads a page decision''s page where the planner writes it');
select ok(not private.takeoff_item_send_plan_valid(c.plan - k.key), format('contract: « %s » without its key « %s » is refused', c.name,
  k.key)) from contract_plans c cross join lateral jsonb_object_keys(c.plan) as k(key) where k.key <> 'choices_sha256'
order by c.name, k.key;
select ok(not private.takeoff_item_send_plan_valid(jsonb_set(c.plan, '{targets,0}',
    (c.plan #> '{targets,0}') - k.key || jsonb_build_object(k.key || '_renamed', c.plan #> array['targets', '0', k.key]))),
  format('contract: « %s » with its target''s key « %s » renamed is refused', c.name, k.key))
from contract_plans c cross join lateral jsonb_object_keys(c.plan #> '{targets,0}') as k(key) order by c.name, k.key;
select ok(not private.takeoff_item_send_plan_valid(jsonb_set(c.plan, '{dependencies,resolutions,0,choice}',
    jsonb_build_object('kind', 'line', 'estimateItemId', c.plan #> '{dependencies,resolutions,0,choice,estimate_item_id}'))),
  'contract: the planner''s former spelling of a chosen line is refused') from contract_plans c where c.name = 'chosen';


-- Lot 4 PR 4b (…_takeoff_item_remeasure_admission.sql): a plan sent by item, then one item of it measured again. The new
-- measure is admitted on that plan for the lavabo alone; nothing of what was sent changes (receipts, targets, parts,
-- pages, the drafts' lines, the sent jobs), before or after its publication; the new answer replaces the lavabo's reading
-- on the plan and is undecided.
create temp table sent_footprint as select pg_temp.footprint() as value;
create temp table sent_jobs as select j.id, j.status::text as status, j.estimate_version_id, j.updated_at from public.takeoff_jobs j
where j.project_id = pg_temp.f(20) and j.estimate_version_id is not null;
select ok((select count(*) from sent_jobs) > 0, 'a reading of the plan was sent by item');
create temp table seen_lavabo as select coalesce(jsonb_agg(p.answer_id), '[]'::jsonb) as answers, (array_agg(p.answer_id))[1] as answer_id
from private.takeoff_item_reading_pairs(pg_temp.f(10), pg_temp.f(20), pg_temp.f(100)) p
where p.item_id = pg_temp.f(300) and p.answer_id is not null;
create temp table latest_list as select r.id, r.revision, r.content_sha256, r.item_count from public.takeoff_list_revisions r
where r.project_id = pg_temp.f(20) order by r.revision desc limit 1;
select results_eq($$select outcome from public.launch_takeoff_item_remeasure(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
    pg_temp.f(790), pg_temp.latest_job(20), pg_temp.host(), pg_temp.selection(),
    pg_temp.manifest(20, (select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', l.id,
      'revision', l.revision, 'content_sha256', l.content_sha256, 'item_count', l.item_count,
      'asked_item_ids', jsonb_build_array(pg_temp.f(300)::text))) from latest_list l)),
    (select p.confirmed_snapshot from public.takeoff_preparations p where p.project_id = pg_temp.f(20)),
    jsonb_build_array(jsonb_build_object('id', pg_temp.f(1090), 'plan_set_id', pg_temp.f(40), 'launch_unit_key', 'plan:' || pg_temp.f(100),
      'source_file_name', 'plan-1.pdf', 'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture',
      'execution_host_id', pg_temp.host())),
    pg_temp.f(40), (select p.revision from public.takeoff_preparations p where p.project_id = pg_temp.f(20)), array[pg_temp.f(100)],
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'answers', (select answers from seen_lavabo))),
    jsonb_build_object('preview_digest', repeat('c', 64), 'setting', null))$$,
  $$values ('admitted'::text)$$, 'a new measure of the lavabo on the plan sent by item is admitted');
select is(pg_temp.footprint(), (select value from sent_footprint), 'nothing of the send changed');
select results_eq($$select j.id, j.status::text, j.estimate_version_id, j.updated_at from public.takeoff_jobs j
    where j.id in (select id from sent_jobs) order by j.id$$, $$select * from sent_jobs order by id$$, 'nor the sent jobs');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())), pg_temp.f(1090), 'its plan is handed');
select is(pg_temp.claim(pg_temp.f(1090), 990), 1, 'and claimed');
select results_eq($$select replayed, answer_count from pg_temp.publish(pg_temp.f(1090), 990, jsonb_build_array(jsonb_build_object(
    'item_id', pg_temp.f(300), 'outcome', 'not_found', 'reasons', jsonb_build_array(jsonb_build_object('code', 'NO_INDICATION',
      'by', 'model', 'text', 'Aucun indice (fictif).', 'chunk_id', 'f1-b1')),
    'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'observations', '[]'::jsonb)), '[]'::jsonb, null,
    array[2, 7], '[]'::jsonb)$$, $$values (false, 1)$$, 'it publishes the lavabo alone');
select is(pg_temp.footprint(), (select value from sent_footprint), 'and nothing of the send changed after it either');
select results_eq($$select a.replaces_answer_id, (select count(*)::integer from public.takeoff_item_answer_decisions d where d.answer_id = a.id)
    from public.takeoff_item_answers a where a.job_id = pg_temp.f(1090)$$,
  $$select answer_id, 0 from seen_lavabo$$, 'the new answer replaces the lavabo''s reading on the plan, undecided');

select * from finish();
rollback;
