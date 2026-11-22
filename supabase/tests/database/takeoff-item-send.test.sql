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
create temp table plans (name text primary key, body jsonb not null);
grant select on plans to authenticated;
create function pg_temp.document() returns jsonb language sql immutable as $$
  select jsonb_build_object('plan_file_id', pg_temp.f(100), 'content_hash', pg_temp.digest(pg_temp.f(100)),
    'logical_document_id', null, 'file_name', 'plan-1.pdf')
$$;
create function pg_temp.answers_of(p_job uuid) returns jsonb language sql stable as $$
  with pairs as (select p.* from private.takeoff_item_table_pairs(pg_temp.f(10), pg_temp.f(20), pg_temp.f(100)) as p)
  select coalesce(jsonb_agg(jsonb_build_object('item_id', a.item_id, 'answer_id', a.id, 'revision', a.content_sha256,
      'decision_revision', case when pair.decision_effective in ('accepted', 'set_aside') then pair.decision_revision end,
      'entry_revision', e.revision) order by a.item_id), '[]'::jsonb)
  from public.takeoff_item_answers as a left join pairs as pair on pair.answer_id = a.id
  left join public.takeoff_item_entries as e on e.item_id = a.item_id and e.plan_logical_id = a.plan_logical_id
  where a.job_id = p_job
$$;
-- The parts of an item, as the planner gives them (each with its quantitative identity).
create function pg_temp.parts(p_job uuid, p_item integer) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('answer_id', s.answer_id, 'answer_revision', s.answer_revision, 'kind', s.kind,
      'observation_ids', case when s.observation_id is null then '[]'::jsonb else jsonb_build_array(s.observation_id) end,
      'quantity', s.quantity, 'unit', s.unit, 'pages', to_jsonb(s.pages),
      'identity', jsonb_build_object('unit', (private.normalize_unit(s.unit)).unit_code, 'basis', null, 'network', null,
        'material', null, 'diameter', null)) order by s.observation_id), '[]'::jsonb)
  from private.takeoff_item_send_job_parts(pg_temp.f(10), pg_temp.f(20), p_job, array[2, 7]) as s where s.item_id = pg_temp.f(p_item)
$$;
create function pg_temp.new_line(p_job uuid, p_item integer, p_quantity numeric, p_section text default 'list:',
  p_section_id uuid default null) returns jsonb language sql stable as $$
  select jsonb_build_object('key', pg_temp.f(p_item) || '|together', 'item_id', pg_temp.f(p_item), 'compartment_key', 'together',
    'line', jsonb_build_object('kind', 'new_line', 'section_key', p_section, 'section_id', p_section_id,
      'title', (select e.label from public.takeoff_list_revision_entries e where e.item_id = pg_temp.f(p_item) limit 1),
      'unit_code', 'u', 'order', 1),
    'unit_code', 'u', 'quantity_after', p_quantity, 'quantity', jsonb_build_object('kept_entry', false), 'rule', null,
    'contributions', pg_temp.parts(p_job, p_item), 'replaces', '[]'::jsonb)
$$;
create function pg_temp.earlier_line(p_job uuid, p_item integer, p_line uuid, p_quantity numeric, p_kind text default 'earlier_line',
  p_compartment text default 'together', p_kept boolean default false) returns jsonb language sql stable as $$
  select jsonb_build_object('key', pg_temp.f(p_item) || '|' || p_compartment, 'item_id', pg_temp.f(p_item),
    'compartment_key', p_compartment,
    'line', jsonb_build_object('kind', p_kind, 'estimate_item_id', i.id, 'expected_updated_at', i.updated_at,
      'expected_quantity', i.quantity),
    'unit_code', 'u', 'quantity_after', p_quantity, 'quantity', jsonb_build_object('kept_entry', p_kept), 'rule', null,
    'contributions', pg_temp.parts(p_job, p_item),
    'replaces', coalesce((select jsonb_agg(jsonb_build_object('job_id', p.job_id, 'answer_id', p.answer_id,
        'observation_ids', to_jsonb(p.observation_ids), 'quantity', p.quantity) order by p.id)
      from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id = p.target_id
      where t.estimate_item_id = p_line and p.state = 'live' and p.plan_logical_id = pg_temp.f(100)), '[]'::jsonb))
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
  p_payload jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('format', 'takeoff_item_send', 'version', 1, 'job_id', p_job, 'plan_key', pg_temp.f(100),
    'list', jsonb_build_object('revision_id', pg_temp.f(310), 'revision', 1),
    'destination', case when p_version is null then jsonb_build_object('kind', 'first_draft', 'version_payload', p_payload)
      else jsonb_build_object('kind', 'existing_draft', 'version_id', p_version) end,
    'engine', 3, 'breakdown', 'together', 'sections', p_sections, 'targets', p_targets,
    'page_contributions', pg_temp.page_contributions(p_targets), 'page_decisions', '[]'::jsonb, 'left_out', '[]'::jsonb,
    'parts_not_sent', '[]'::jsonb,
    'dependencies', jsonb_build_object('answers', pg_temp.answers_of(p_job),
      'affaire_entries', coalesce((select jsonb_agg(jsonb_build_object('item_id', e.item_id, 'revision', e.revision))
        from public.takeoff_item_entries e where e.project_id = pg_temp.f(20) and e.plan_logical_id is null), '[]'::jsonb),
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
        from jsonb_array_elements(private.takeoff_item_send_held_pages(pg_temp.f(10), p_version, p_job, pg_temp.document(),
          array[2, 7])) h(value)) end,
      'stamps', jsonb_build_object('job', public.takeoff_rule_job_stamp(pg_temp.f(10), pg_temp.f(20), p_job),
        'peers', case when p_version is not null then public.takeoff_send_peers_stamp(pg_temp.f(10), p_version) end,
        'context', (select jsonb_build_object('peers', s.stamps ->> 'peers', 'locations', s.stamps ->> 'locations')
          from (select private.takeoff_send_context_stamps(private.takeoff_send_context(pg_temp.f(10), pg_temp.f(20), p_job,
            p_version)) as stamps) s),
        'dpgf', '[]'::jsonb,
        'first_draft_settings', case when p_version is null then pg_temp.first_draft_settings(p_payload) end,
        'destination', (select jsonb_build_object('version_id', v.id, 'status', v.status, 'updated_at', v.updated_at)
          from public.estimate_versions v where v.id = p_version),
        'mapping', public.takeoff_mapping_rules_stamp(pg_temp.f(10))),
      'resolutions', '[]'::jsonb))
$$;
create function pg_temp.send(p_request integer, p_plan text) returns jsonb language sql as $$
  select public.send_takeoff_item_plan(jsonb_build_object('request_id', pg_temp.f(p_request),
    'plan', (select body from plans where name = p_plan)))
$$;
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
  '[{"key": "list:", "title": "Métré", "parent_key": null, "parent_id": null}]'::jsonb, pg_temp.payload(700)));
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
insert into plans select 'first_other', jsonb_set(body, '{breakdown}', '"by_level"') from plans where name = 'first';
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
select is(pg_temp.refusal($$select pg_temp.send(712, 'first')$$), 'P0002 TAKEOFF_JOB_NOT_FOUND',
  'another tenant''s administrator does not find the job');
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is(pg_temp.refusal($$select pg_temp.send(712, 'first')$$), '42501 TAKEOFF_ITEM_SEND_AUTH_REQUIRED',
  'no session, no send');
reset role;
select is(has_function_privilege('anon', 'public.send_takeoff_item_plan(jsonb)', 'EXECUTE'), false, 'an anonymous client cannot send');
select is(has_function_privilege('service_role', 'public.send_takeoff_item_plan(jsonb)', 'EXECUTE'), false,
  'nor the service role: the member''s session is the author');
select is(has_function_privilege('authenticated', 'public.send_takeoff_item_plan(jsonb)', 'EXECUTE'), true, 'a member calls it');
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

-- 5. What is refused before any lock: a malformed request, an override (no block of this send admits one).
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select public.send_takeoff_item_plan(jsonb_build_object('request_id', pg_temp.f(713),
    'plan', (select body - 'targets' from plans where name = 'first')))$$), '22023 TAKEOFF_ITEM_SEND_INVALID', 'a plan without targets');
select is(pg_temp.refusal($$select public.send_takeoff_item_plan(jsonb_build_object('request_id', pg_temp.f(713),
    'plan', (select jsonb_set(body, '{engine}', '2') from plans where name = 'first')))$$), '22023 TAKEOFF_ITEM_SEND_INVALID',
  'a plan for another engine');
select is(pg_temp.refusal($$select public.send_takeoff_item_plan(jsonb_build_object('request_id', pg_temp.f(713),
    'plan', (select body from plans where name = 'first'), 'override', jsonb_build_object('reason_code', 'other',
      'justification', 'Forçage fictif demandé')))$$), '22023 TAKEOFF_ITEM_SEND_OVERRIDE_NOT_ADMITTED',
  'an override is refused: no block of this send admits one');
reset role;

-- 6. The send by item refuses every job not read against a list: a job of the first order (no list), completed.
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, preparation_snapshot,
  source_file_name)
values (pg_temp.f(1900), pg_temp.f(10), pg_temp.f(21), pg_temp.f(41), 'C', 'completed', pg_temp.f(1), pg_temp.snapshot(21),
  'plan-1.pdf');
set local session_replication_role = origin;
insert into plans select 'free', jsonb_set(body, '{job_id}', to_jsonb(pg_temp.f(1900))) from plans where name = 'first';
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
      'values', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(302), 'quantity', 6, 'unit', 'u')),
      'entry', jsonb_build_object('category', 'site_survey')))) ->> 'outcome', 'applied', 'the bathtub entered on this plan');
reset role;

-- The draft as it is now: the lavabo's line (3 u) priced by hand, a DPGF line of the bathtub (its DPGF quantity 4), a
-- line today's send wrote from page 2 of the same plan (its provenance names the file and the page).
create temp table draft as select v.id as version_id, t.estimate_item_id as line_id,
  (select i.parent_id from public.estimate_items i where i.id = t.estimate_item_id) as section_id
from public.estimate_versions v join public.takeoff_item_send_targets t on t.version_id = v.id where v.project_id = pg_temp.f(20);
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

create function pg_temp.second(p_decisions jsonb, p_resolutions jsonb) returns jsonb language sql as $$
  select jsonb_set(jsonb_set(pg_temp.plan(pg_temp.job(20, 2), (select version_id from draft), jsonb_build_array(
      pg_temp.earlier_line(pg_temp.job(20, 2), 300, (select line_id from draft), 5),
      pg_temp.earlier_line(pg_temp.job(20, 2), 302, pg_temp.f(950), 6, 'dpgf_line', 'dpgf'))),
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
insert into plans values ('unchosen', pg_temp.second(pg_temp.decisions(), '[]'::jsonb));
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
select is(pg_temp.refusal($$select pg_temp.send(720, 'unchosen')$$), '40001 TAKEOFF_ITEM_SEND_PREVIEW_STALE target_unproven',
  'a DPGF line without proof is fed only by the member''s choice');
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
--    too), the bathtub feeds its DPGF line (the protective maximum: 6 above the DPGF's 4), page 2 is kept both.
create temp table takeoff_item_send_parts (id uuid);
create function pg_temp.trap() returns trigger language plpgsql as $$ begin raise exception 'ITEM_SEND_TEST_TRAP'; end; $$;
create trigger trap before insert or update or delete on pg_temp.takeoff_item_send_parts for each row execute function pg_temp.trap();
grant all on pg_temp.takeoff_item_send_parts to authenticated;
select pg_temp.sign_in(1);
set local role authenticated;
create temp table sent_second as select pg_temp.send(720, 'second') as answer;
reset role;
select is((select count(*)::integer from pg_temp.takeoff_item_send_parts), 0, 'the session''s own relation of the same name is untouched');
select is((select pg_get_functiondef('public.send_takeoff_item_plan(jsonb)'::regprocedure) ~* '(temporary|pg_temp)'), false,
  'the writer names no temporary relation');
select results_eq($$select i.id, i.quantity from public.estimate_items i where i.id in ((select line_id from draft), pg_temp.f(950), pg_temp.f(951))
  order by i.position$$,
  $$values ((select line_id from draft), 5::numeric), (pg_temp.f(950), 6::numeric), (pg_temp.f(951), 1::numeric)$$,
  'the lavabo 5, the DPGF line 6, today''s line untouched');
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
    (pg_temp.job(20, 2), 'measured', 1::numeric, array[7], 'live', false),
    (pg_temp.job(20, 2), 'entered', 6::numeric, array[2, 7], 'live', false)$$,
  'the journal: the first send''s parts replaced, never added to; the new parts live, the entry on both pages');
select results_eq($$select t.item_id, t.breakdown, t.line_kind from public.takeoff_item_send_targets t order by t.created_at, t.line_kind desc$$,
  $$values (pg_temp.f(300), 'together'::text, 'new_line'::text), (pg_temp.f(302), 'dpgf', 'dpgf_line')$$,
  'the lavabo keeps its target, the DPGF line is claimed once');
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

select * from finish();
rollback;
