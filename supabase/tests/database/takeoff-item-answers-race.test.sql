-- Lot 4, B1 (20261122080845_takeoff_item_answers.sql): the publication of a unit across sessions.
-- 1. The same publication sent twice at once by the same attempt (a lost answer sent again while the first one still
--    commits): the second waits for the job's row, then answers the first one's result, replayed; nothing is written twice.
-- 2. Another content sent by the same attempt meanwhile: it waits, then is refused (TAKEOFF_ANSWERS_ALREADY_PUBLISHED).
-- 3. The released end of a job (finalize_local_takeoff_result) on a unit of a request that sealed a list, committed: the
--    commit is refused (TAKEOFF_ANSWERS_REQUIRED) and the job is still read under its lease.
-- 4. A member's stop while the worker publishes: the stop waits for the job's row (the job, then the request, for both),
--    then closes the request with the plan read; neither waits for the other in a cycle.
-- Isolation justified: these interleavings and a refused commit exist only across sessions, which no journey drives
-- deterministically. Each held transaction is stopped at a named point; the waits are bounded conditions. All values are
-- fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5400000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create temp table race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- race_setup writes and commits the fixtures; race_a and race_b are two processes of the worker and a member's server.
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);

-- Affaires 20 to 23, one plan each (100 + n, read on its pages 2 and 7), each with a list of two items (300 + 10 n + k) in
-- its revision 400 + n.
select is(extensions.dblink_exec('race_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd5400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'item-answers-race-1@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer' where user_id = 'd5400000-0000-4000-8000-000000000001';
update public.feature_flags set enabled = true where flag_key = 'TAKEOFF_MODULE_ENABLED' and tenant_id = (select m.tenant_id
  from public.tenant_memberships m where m.user_id = 'd5400000-0000-4000-8000-000000000001' and m.is_default);
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select ('d5400000-0000-4000-8000-0000000000' || (20 + n))::uuid, m.tenant_id, m.user_id, 'Affaire de postes en concurrence ' || n || ' (fictive)', false
from public.tenant_memberships m cross join generate_series(0, 3) as n
where m.user_id = 'd5400000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select ('d5400000-0000-4000-8000-0000000000' || (30 + n))::uuid, ('d5400000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  'd5400000-0000-4000-8000-000000000001', 'ready' from generate_series(0, 3) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select ('d5400000-0000-4000-8000-0000000000' || (60 + n))::uuid, ('d5400000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  ('d5400000-0000-4000-8000-0000000000' || (30 + n))::uuid, 'confirme', 'Résumé fictif', 'Objet fictif', now(),
  'd5400000-0000-4000-8000-000000000001' from generate_series(0, 3) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select ('d5400000-0000-4000-8000-0000000000' || (40 + n))::uuid, p.tenant_id, p.id, 'Plans du dossier'
from generate_series(0, 3) as n join public.estimate_projects p on p.id = ('d5400000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select ('d5400000-0000-4000-8000-000000000' || (100 + n))::uuid, s.tenant_id, s.id, 'plan-1.pdf',
  concat_ws('/', s.tenant_id, s.id, ('d5400000-0000-4000-8000-000000000' || (100 + n))::uuid, 'plan-1.pdf'), 'application/pdf', 8, 9
from generate_series(0, 3) as n join public.plan_sets s on s.id = ('d5400000-0000-4000-8000-0000000000' || (40 + n))::uuid;
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
select ('d5400000-0000-4000-8000-000000000' || (300 + 10 * n + k))::uuid, p.tenant_id, p.id, 'manual', 1, p.user_id
from generate_series(0, 3) as n cross join generate_series(0, 1) as k
join public.estimate_projects p on p.id = ('d5400000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by)
select ('d5400000-0000-4000-8000-000000000' || (400 + n))::uuid, p.tenant_id, p.id, 1, 'item_added', '{}', 2, repeat('1', 64),
  repeat('a', 64), ('d5400000-0000-4000-8000-000000000' || (410 + n))::uuid, p.user_id
from generate_series(0, 3) as n join public.estimate_projects p on p.id = ('d5400000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin)
select ('d5400000-0000-4000-8000-000000000' || (400 + n))::uuid, p.tenant_id, p.id,
  ('d5400000-0000-4000-8000-000000000' || (300 + 10 * n + k))::uuid, k, 'manual:poste-' || k, 'Poste ' || k || ' (fictif)', 'u',
  'manual', '{"kind":"manual"}'
from generate_series(0, 3) as n cross join generate_series(0, 1) as k
join public.estimate_projects p on p.id = ('d5400000-0000-4000-8000-0000000000' || (20 + n))::uuid;
set local session_replication_role = origin;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 hour');
commit;
$setup$), 'COMMIT', 'four affaires of one plan and a list of two items, with the activations');

create function pg_temp.tenant() returns uuid language sql stable as $$
  select tenant_id from public.estimate_projects where id = pg_temp.f(20)
$$;
create function pg_temp.job(project integer) returns uuid language sql immutable as $$ select pg_temp.f(1000 + project) $$;
create function pg_temp.digest(plan uuid) returns text language sql immutable as $$
  select encode(sha256(convert_to(plan::text, 'UTF8')), 'hex')
$$;
create function pg_temp.snapshot(project integer) returns jsonb language sql stable as $$
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
create function pg_temp.launch_sql(project integer) returns text language sql stable as $$
  select format($launch$select outcome from public.launch_manual_takeoff_plan_request(%L, %L, %L, %L, 'initial', null, %L, %L::jsonb,
    %L::jsonb, %L::jsonb, %L::jsonb, %L, 1, %L::uuid[])$launch$,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), pg_temp.f(500 + project), pg_temp.host(), pg_temp.selection(),
    jsonb_build_object('format_version', 2, 'intent', 'initial',
      'order', (select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', r.id,
        'revision', r.revision, 'content_sha256', r.content_sha256, 'item_count', r.item_count))
        from public.takeoff_list_revisions r where r.id = pg_temp.f(400 + project - 20)),
      'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
      'units', jsonb_build_array(jsonb_build_object('key', 'plan:' || pg_temp.f(100 + project - 20), 'ordinal', 1,
        'plans', jsonb_build_array(pg_temp.f(100 + project - 20)), 'pages', '[2, 7]'::jsonb, 'page_count', 9, 'vector_pages', 0,
        'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))),
      'plans', jsonb_build_array(jsonb_build_object('entry_key', pg_temp.f(100 + project - 20),
        'plan_file_id', pg_temp.f(100 + project - 20), 'name', 'plan-1.pdf', 'logical_id', pg_temp.f(100 + project - 20),
        'generation', null, 'content_sha256', pg_temp.digest(pg_temp.f(100 + project - 20)), 'pages', '[2, 7]'::jsonb,
        'page_count', 9)),
      'coverage', jsonb_build_object('plans_retained', 1, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
      'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)),
    pg_temp.snapshot(project),
    jsonb_build_array(jsonb_build_object('id', pg_temp.job(project), 'plan_set_id', pg_temp.f(project + 20),
      'launch_unit_key', 'plan:' || pg_temp.f(100 + project - 20), 'source_file_name', 'plan-1.pdf',
      'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture',
      'execution_host_id', pg_temp.host())),
    pg_temp.f(project + 20), array[pg_temp.f(100 + project - 20)])
$$;
create function pg_temp.request(project integer) returns uuid language sql stable as $$
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(project) and origin = 'manual'
$$;
create function pg_temp.claim_sql(project integer, token integer) returns text language sql stable as $$
  select format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L, clock_timestamp(), %L,
    clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)$claim$,
    pg_temp.job(project), pg_temp.tenant(), pg_temp.host(), pg_temp.f(token))
$$;
-- The publication of an affaire's unit: its first item measured (2 on page 2, a row of the result), its second not found.
create function pg_temp.publish_sql(project integer, token integer, reason text default 'Aucun indice (fictif).')
returns text language sql stable as $$
  select format($publish$select result_id::text || ':' || replayed::text from public.publish_takeoff_item_answers(%L, %L,
    '2026-11-22T09:00:00Z', 'modele-fictif', 'takeoff-c-postes-v1',
    '{"schema_version": "v2", "prompt_version": "takeoff-c-postes-v1"}'::jsonb, array[2, 7], %L::jsonb, '[]'::jsonb, %L::jsonb,
    %L::jsonb)$publish$,
    pg_temp.job(project), pg_temp.f(token),
    jsonb_build_array(
      jsonb_build_object('item_id', pg_temp.f(300 + 10 * (project - 20)), 'outcome', 'measured', 'reasons', '[]'::jsonb,
        'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'quantity', jsonb_build_object('value', 2, 'unit', 'u'),
        'observations', jsonb_build_array(jsonb_build_object('page', 2, 'evidence', 'Symboles fictifs', 'method', 'symbol_count',
          'confidence', 0.9, 'quantity', 2, 'unit', 'u', 'role', 'contribution', 'source', 'model', 'chunk_id', 'f1-b1',
          'takeoff_item_id', pg_temp.f(800 + project)))),
      jsonb_build_object('item_id', pg_temp.f(301 + 10 * (project - 20)), 'outcome', 'not_found',
        'reasons', jsonb_build_array(jsonb_build_object('code', 'NO_INDICATION', 'by', 'model', 'text', reason, 'chunk_id', 'f1-b1')),
        'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'observations', '[]'::jsonb)),
    jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb, 'provider_meta', '{}'::jsonb,
      'token_count', 10, 'cost_cents', 0, 'duration_ms', 5),
    jsonb_build_array(jsonb_build_object('id', pg_temp.f(800 + project), 'designation', 'Poste 0 (fictif)', 'quantity', 2,
      'unit', 'u', 'confidence', 0.9, 'evidence', 'Symboles fictifs', 'source_file_name', 'plan-1.pdf', 'source_page', 2,
      'metadata', '{}'::jsonb)))
$$;
create function pg_temp.finalize_sql(project integer, token integer) returns text language sql stable as $$
  select format($finalize$select public.finalize_local_takeoff_result(%L, %L, %L, clock_timestamp(), 'modele-fictif', 'fixture',
    %L::jsonb, '[]'::jsonb, null)$finalize$, pg_temp.job(project), pg_temp.tenant(), pg_temp.f(token),
    jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb, 'provider_meta', '{}'::jsonb,
      'token_count', 10, 'cost_cents', 0, 'duration_ms', 5))
$$;
create function pg_temp.stop_sql(project integer) returns text language sql stable as $$
  select format($stop$select request_state from public.stop_takeoff_launch_request(%L, %L, %L, %L)$stop$,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), pg_temp.request(project))
$$;

select is(extensions.dblink_exec('race_setup', (select format($prep$begin;
  set local session_replication_role = replica;
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by) values %s;
  commit;$prep$, string_agg(format('(%L, %L, 1, %L::jsonb, %L::jsonb, now(), %L, %L)', pg_temp.tenant(), pg_temp.f(project),
    pg_temp.snapshot(project) -> 'preparation', pg_temp.snapshot(project), pg_temp.f(1), pg_temp.f(1)), ', '))
  from (values (20), (21), (22), (23)) as affaire(project))), 'COMMIT', 'each affaire''s preparation is confirmed');
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql(project)) as x(outcome text)), 'admitted',
  format('affaire %s reads its plan against its list', project)) from (values (20), (21), (22), (23)) as affaire(project);

create temp table race_pids(label text primary key, pid integer);
insert into race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('race_a'), ('race_b')) as session(name);
create function pg_temp.waits_for(p_waiting text, p_holding text) returns boolean language plpgsql as $$
declare
  waiting integer := (select pid from race_pids where label = p_waiting);
  holding integer := (select pid from race_pids where label = p_holding);
begin
  for attempt in 1..400 loop
    if holding = any(pg_catalog.pg_blocking_pids(waiting)) then return true; end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;
create function pg_temp.answered(p_session text) returns boolean language plpgsql as $$
begin
  for attempt in 1..400 loop
    if extensions.dblink_is_busy(p_session) = 0 then return true; end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;

-- 1. The same publication twice at once.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(20, 901)) as x(claimed bigint)), 1::bigint,
  'the worker reads the plan of affaire 20');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'it publishes the unit');
create temp table first_answer as
  select x.answer from extensions.dblink('race_a', pg_temp.publish_sql(20, 901)) as x(answer text);
select is((select split_part(answer, ':', 2) from first_answer), 'false', 'written, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.publish_sql(20, 901)), 1,
  'the same attempt sends the same publication again meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second waits for the job''s row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
select is((select x.answer from extensions.dblink_get_result('race_b', false) as x(answer text)),
  (select split_part(answer, ':', 1) || ':true' from first_answer), 'with the first one''s result, replayed');
select diag(concat('second publication: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select results_eq($$select count(*)::integer from public.takeoff_item_answers where job_id = pg_temp.job(20)$$, $$values (2)$$,
  'two answers, written once');
select results_eq($$select status::text, analysis_outcome::text from public.takeoff_jobs where id = pg_temp.job(20)$$,
  $$values ('completed'::text, 'success'::text)$$, 'the job ended once');

-- 2. Another content from the same attempt at once.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(21, 902)) as x(claimed bigint)), 1::bigint,
  'the worker reads the plan of affaire 21');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'it publishes the unit');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_a', pg_temp.publish_sql(21, 902)) as x(answer text)),
  'false', 'written, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.publish_sql(21, 902, 'Autre raison (fictive).')), 1,
  'the same attempt sends another content meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second waits for the job''s row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'with no result');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ANSWERS_ALREADY_PUBLISHED%', 'refused as a conflict');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select results_eq($$select reasons #>> '{0,text}' from public.takeoff_item_answers where job_id = pg_temp.job(21)
  and outcome = 'not_found'$$, $$values ('Aucun indice (fictif).'::text)$$, 'the first content stays');

-- 3. The released end of a unit reading against a list, committed.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(22, 903)) as x(claimed bigint)), 1::bigint,
  'the worker reads the plan of affaire 22');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a released worker ends the job its way');
select isnt((select x.result from extensions.dblink('race_a', pg_temp.finalize_sql(22, 903)) as x(result uuid)), null::uuid,
  'its end is written, not yet committed');
select throws_ok($$select extensions.dblink_exec('race_a', 'commit')$$, null, null, 'its commit is refused');
select diag(concat('released end: ', extensions.dblink_error_message('race_a')));
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_ANSWERS_REQUIRED%', 'for want of the answers');
select results_eq($$select status::text, processing_lease_token from public.takeoff_jobs where id = pg_temp.job(22)$$,
  $$values ('processing'::text, pg_temp.f(903))$$, 'the job is still read under its lease');
select is((select count(*)::integer from public.takeoff_results where job_id = pg_temp.job(22)), 0, 'and nothing of it was kept');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(22, 903)) as x(answer text)),
  'false', 'the publication then ends it');

-- 4. A member's stop while the worker publishes.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(23, 904)) as x(claimed bigint)), 1::bigint,
  'the worker reads the plan of affaire 23');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'it publishes the unit');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_a', pg_temp.publish_sql(23, 904)) as x(answer text)),
  'false', 'written, not yet committed: it holds the job, then the request');
select is(extensions.dblink_send_query('race_b', pg_temp.stop_sql(23)), 1, 'a member stops the request meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the stop waits for the job''s row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the publication commits');
select ok(pg_temp.answered('race_b'), 'the stop answers');
select is((select x.state from extensions.dblink_get_result('race_b', false) as x(state text)), 'closed',
  'the request is closed');
select diag(concat('stop: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(state text)), 0, 'and is done');
select results_eq($$select j.status::text, r.outcome, (select count(*)::integer from public.takeoff_item_answers a where a.job_id = j.id)
  from public.takeoff_jobs j join public.takeoff_launch_requests r on r.id = j.launch_request_id where j.id = pg_temp.job(23)$$,
  $$values ('completed'::text, 'success'::text, 2)$$, 'the plan read stays read, with its answers');

select is(extensions.dblink_exec('race_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid;
  entry record;
begin
  for target in select distinct m.tenant_id from public.tenant_memberships m where m.user_id = 'd5400000-0000-4000-8000-000000000001'
  loop
  delete from private.takeoff_launch_usage u using public.takeoff_launch_requests r where r.id = u.request_id and r.tenant_id = target;
  for entry in
    select columns.table_schema, columns.table_name
    from information_schema.columns as columns
    join information_schema.tables as tables
      on tables.table_schema = columns.table_schema and tables.table_name = columns.table_name
    where columns.table_schema in ('public', 'private') and columns.column_name = 'tenant_id'
      and tables.table_type = 'BASE TABLE' and not (columns.table_schema = 'public' and columns.table_name = 'tenants')
      and not (columns.table_schema = 'public' and columns.table_name = 'audit_logs')
  loop
    execute format('delete from %I.%I where tenant_id = $1', entry.table_schema, entry.table_name) using target;
  end loop;
  -- Tenant data deletes can write audit entries, so clear them after the loop.
  delete from public.audit_logs where tenant_id = target;
  delete from public.tenants where id = target;
  end loop;
end
$clean$;
delete from private.takeoff_host_slots where host_id = 'urn:uuid:d5400000-0000-4000-8000-000000000099';
delete from private.takeoff_local_job_work where host_id = 'urn:uuid:d5400000-0000-4000-8000-000000000099';
delete from private.takeoff_item_list_order_activation;
delete from private.takeoff_plan_dispatch_activation;
delete from private.takeoff_launch_activation;
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'd5400000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd5400000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures, the Mac''s slot and the activations cleaned');
select is((select count(*)::integer from private.takeoff_item_list_order_activation), 0, 'the database is left without an activation');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);
select * from finish();
rollback;
