-- Lot 4, B2 (20261122125722_takeoff_item_review_decisions.sql): the review command of the table of items across sessions.
-- 1. Two tabs accept the same item at once (two intention keys): the second waits for the affaire's review, then
--    answers stale; the item is accepted once and its row verified once.
-- 2. The same command sent twice at once (a lost answer sent again while the first one still commits): the second
--    waits, then answers the first one's outcome, replayed; nothing is written twice.
-- 3. A targeted review excludes a positive row while the item is accepted in bulk: the acceptance waits for the job's
--    rules, then judges the row as committed and answers stale; the row stays excluded, never verified over the change.
-- 4. Commands on two affaires do not wait for each other.
-- 5. A set aside waits behind a targeted save on the job's rules while a new reading of the plan publishes a
--    replacement answer: the command compares what is current once its locks are held, and answers stale; the
--    superseded answer is not set aside, the replacement inherits no decision.
-- Isolation justified: these interleavings exist only across sessions, which no journey drives deterministically. Each
-- held transaction is stopped at a named point; the waits are bounded conditions. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5600000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5600000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create temp table race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- race_setup writes and commits the fixtures; race_a and race_b are two tabs (two requests) of the same member.
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);

-- Affaires 20 and 21, one plan each (100 + n, read on its pages 2 and 7), each with a list of two items (300 + 10 n + k)
-- in its revision 400 + n.
select is(extensions.dblink_exec('race_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd5600000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'item-review-race-1@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer' where user_id = 'd5600000-0000-4000-8000-000000000001';
update public.feature_flags set enabled = true where flag_key = 'TAKEOFF_MODULE_ENABLED' and tenant_id = (select m.tenant_id
  from public.tenant_memberships m where m.user_id = 'd5600000-0000-4000-8000-000000000001' and m.is_default);
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select ('d5600000-0000-4000-8000-0000000000' || (20 + n))::uuid, m.tenant_id, m.user_id, 'Affaire revue en concurrence ' || n || ' (fictive)', false
from public.tenant_memberships m cross join generate_series(0, 1) as n
where m.user_id = 'd5600000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select ('d5600000-0000-4000-8000-0000000000' || (30 + n))::uuid, ('d5600000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  'd5600000-0000-4000-8000-000000000001', 'ready' from generate_series(0, 1) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select ('d5600000-0000-4000-8000-0000000000' || (60 + n))::uuid, ('d5600000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  ('d5600000-0000-4000-8000-0000000000' || (30 + n))::uuid, 'confirme', 'Résumé fictif', 'Objet fictif', now(),
  'd5600000-0000-4000-8000-000000000001' from generate_series(0, 1) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select ('d5600000-0000-4000-8000-0000000000' || (40 + n))::uuid, p.tenant_id, p.id, 'Plans du dossier'
from generate_series(0, 1) as n join public.estimate_projects p on p.id = ('d5600000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select ('d5600000-0000-4000-8000-000000000' || (100 + n))::uuid, s.tenant_id, s.id, 'plan-1.pdf',
  concat_ws('/', s.tenant_id, s.id, ('d5600000-0000-4000-8000-000000000' || (100 + n))::uuid, 'plan-1.pdf'), 'application/pdf', 8, 9
from generate_series(0, 1) as n join public.plan_sets s on s.id = ('d5600000-0000-4000-8000-0000000000' || (40 + n))::uuid;
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
select ('d5600000-0000-4000-8000-000000000' || (300 + 10 * n + k))::uuid, p.tenant_id, p.id, 'manual', 1, p.user_id
from generate_series(0, 1) as n cross join generate_series(0, 1) as k
join public.estimate_projects p on p.id = ('d5600000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by)
select ('d5600000-0000-4000-8000-000000000' || (400 + n))::uuid, p.tenant_id, p.id, 1, 'item_added', '{}', 2, repeat('1', 64),
  repeat('a', 64), ('d5600000-0000-4000-8000-000000000' || (410 + n))::uuid, p.user_id
from generate_series(0, 1) as n join public.estimate_projects p on p.id = ('d5600000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin)
select ('d5600000-0000-4000-8000-000000000' || (400 + n))::uuid, p.tenant_id, p.id,
  ('d5600000-0000-4000-8000-000000000' || (300 + 10 * n + k))::uuid, k, 'manual:poste-' || k, 'Poste ' || k || ' (fictif)', 'u',
  'manual', '{"kind":"manual"}'
from generate_series(0, 1) as n cross join generate_series(0, 1) as k
join public.estimate_projects p on p.id = ('d5600000-0000-4000-8000-0000000000' || (20 + n))::uuid;
set local session_replication_role = origin;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 hour');
commit;
$setup$), 'COMMIT', 'two affaires of one plan and a list of two items, with the activations');

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
create function pg_temp.claim_sql(project integer, token integer) returns text language sql stable as $$
  select format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L, clock_timestamp(), %L,
    clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)$claim$,
    pg_temp.job(project), pg_temp.tenant(), pg_temp.host(), pg_temp.f(token))
$$;
-- The relaunch of an affaire's plan (a second reading, its job 1100 + n) and its publication (its row 850 + n).
create function pg_temp.relaunch_sql(project integer) returns text language sql stable as $$
  select replace(replace(pg_temp.launch_sql(project), format('%L, ''initial'', null', pg_temp.f(500 + project)),
    format('%L, ''reread_plans'', %L', pg_temp.f(600 + project), pg_temp.job(project))),
    pg_temp.job(project)::text || '", "plan_set_id"', pg_temp.f(1100 + project)::text || '", "plan_set_id"')
$$;
-- The publication of an affaire's unit: its first item measured (2 on page 2, row 800 + n of the result), its second not
-- found.
create function pg_temp.publish_sql(project integer, token integer) returns text language sql stable as $$
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
        'reasons', jsonb_build_array(jsonb_build_object('code', 'NO_INDICATION', 'by', 'model', 'text', 'Aucun indice (fictif).',
          'chunk_id', 'f1-b1')),
        'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'observations', '[]'::jsonb)),
    jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb, 'provider_meta', '{}'::jsonb,
      'token_count', 10, 'cost_cents', 0, 'duration_ms', 5),
    jsonb_build_array(jsonb_build_object('id', pg_temp.f(800 + project), 'designation', 'Poste 0 (fictif)', 'quantity', 2,
      'unit', 'u', 'confidence', 0.9, 'evidence', 'Symboles fictifs', 'source_file_name', 'plan-1.pdf', 'source_page', 2,
      'metadata', '{}'::jsonb)))
$$;

select is(extensions.dblink_exec('race_setup', (select format($prep$begin;
  set local session_replication_role = replica;
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by) values %s;
  commit;$prep$, string_agg(format('(%L, %L, 1, %L::jsonb, %L::jsonb, now(), %L, %L)', pg_temp.tenant(), pg_temp.f(project),
    pg_temp.snapshot(project) -> 'preparation', pg_temp.snapshot(project), pg_temp.f(1), pg_temp.f(1)), ', '))
  from (values (20), (21)) as affaire(project))), 'COMMIT', 'each affaire''s preparation is confirmed');
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql(project)) as x(outcome text)), 'admitted',
  format('affaire %s reads its plan against its list', project)) from (values (20), (21)) as affaire(project);
-- The Mac's one slot reads one plan at a time: each plan is read and published before the next.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(20, 920)) as x(claimed bigint)), 1::bigint,
  'the worker reads the plan of affaire 20');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(20, 920)) as x(answer text)),
  'false', 'and publishes its answers');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(21, 921)) as x(claimed bigint)), 1::bigint,
  'then the plan of affaire 21');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(21, 921)) as x(answer text)),
  'false', 'and publishes its answers');
-- The server evaluated the rules of the rows (none fails), as it does after a reading.
select is(extensions.dblink_exec('race_setup', format($rules$update public.takeoff_items set rules_stale = false,
  rules_evaluated_at = now(), rule_results = '[]'::jsonb where job_id in (%L, %L)$rules$, pg_temp.job(20), pg_temp.job(21))),
  'UPDATE 2', 'the rules of both rows are evaluated');

-- The member in both tabs.
select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as the member', session.name))
from (values ('race_a'), ('race_b')) as session(name);
select is((select claims.sub from extensions.dblink(session.name, format($claims$select set_config('request.jwt.claims', %L, false),
    set_config('request.jwt.claim.sub', %L, false)$claims$, jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(1))::text,
    pg_temp.f(1)::text)) as claims(claims text, sub text)), pg_temp.f(1)::text, format('%s is signed in', session.name))
from (values ('race_a'), ('race_b')) as session(name);

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

-- A command on items of an affaire as they are committed now (every current answer with its decision's revision, the
-- entry's revision), applied to those named, with the gesture's own fields; and the statement a tab sends.
create function pg_temp.target(item integer) returns jsonb language sql stable as $$
  select jsonb_build_object('item_id', pg_temp.f(item),
    'entry_revision', coalesce((select e.revision from public.takeoff_item_entries e where e.item_id = pg_temp.f(item)
      and e.plan_logical_id is null), 0),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('answer_id', a.id, 'decision_revision', coalesce(d.revision, 0),
        'entry_revision', coalesce(pe.revision, 0)))
      from public.takeoff_item_answers a left join public.takeoff_item_answer_decisions d on d.answer_id = a.id
      left join public.takeoff_item_entries pe on pe.item_id = a.item_id and pe.plan_logical_id = a.plan_logical_id
      where a.item_id = pg_temp.f(item)), '[]'::jsonb))
$$;
create function pg_temp.cmd(gesture text, key integer, items integer[], extra jsonb default '{}'::jsonb)
returns jsonb language sql stable as $$
  select jsonb_build_object('command_version', 1, 'intent_key', pg_temp.f(key), 'gesture', gesture,
    'scope', '{"kind":"affaire"}'::jsonb,
    'targets', (select jsonb_agg(pg_temp.target(i) order by i) from unnest(items) i),
    'apply', (select jsonb_agg(pg_temp.f(i) order by i) from unnest(items) i),
    'skipped', '[]'::jsonb) || extra
$$;
create function pg_temp.review_sql(project integer, command jsonb) returns text language sql stable as $$
  select format($review$select public.review_takeoff_items(%L, %L, %L::jsonb)::text$review$, pg_temp.tenant(), pg_temp.f(project),
    command)
$$;
create function pg_temp.review_events(project integer) returns integer language sql stable as $$
  select count(*)::integer from public.takeoff_item_review_events where project_id = pg_temp.f(project)
$$;

-- 1. Two tabs accept the same item at once.
create temp table accept_read as select pg_temp.cmd('accept_measured', 600, array[300]) as first_,
  pg_temp.cmd('accept_measured', 601, array[300]) as second_;
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the first tab accepts the measured item');
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_a', pg_temp.review_sql(20, (select first_ from accept_read)))
  as x(outcome text)), 'applied', 'applied, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.review_sql(20, (select second_ from accept_read))), 1,
  'the second tab accepts it meanwhile, with what it read before');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second waits for the affaire''s review');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
select is((select x.outcome::jsonb from extensions.dblink_get_result('race_b', false) as x(outcome text)),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(300))), 'stale: nothing applied twice');
select diag(concat('second acceptance: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text)), 0, 'and is done');
select results_eq($$select kind, revision from public.takeoff_item_answer_decisions where item_id = pg_temp.f(300)$$,
  $$values ('accepted'::text, 1)$$, 'one decision, revision 1');
select results_eq($$select is_verified, verified_by from public.takeoff_items where id = pg_temp.f(820)$$,
  $$values (true, pg_temp.f(1))$$, 'its row verified in the member''s name');
select is(pg_temp.review_events(20), 2, 'journaled once: the row and the decision');
select is((select count(*)::integer from public.takeoff_item_review_commands where project_id = pg_temp.f(20)), 1,
  'one receipt: a stale answer keeps none');

-- 2. The same command sent twice at once.
create temp table set_aside_read as select pg_temp.cmd('set_aside', 602, array[301], '{"reason":"duplicate"}') as command;
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a tab sets the absent item aside');
create temp table first_set_aside as select x.outcome::jsonb as outcome
  from extensions.dblink('race_a', pg_temp.review_sql(20, (select command from set_aside_read))) as x(outcome text);
select is((select outcome ->> 'outcome' from first_set_aside), 'applied', 'applied, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.review_sql(20, (select command from set_aside_read))), 1,
  'its lost answer is sent again meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second waits for the affaire''s review');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
select is((select x.outcome::jsonb from extensions.dblink_get_result('race_b', false) as x(outcome text)),
  (select outcome - 'replayed' || '{"replayed": true}'::jsonb from first_set_aside), 'with the first one''s outcome, replayed');
select diag(concat('command sent again: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text)), 0, 'and is done');
select results_eq($$select kind, reason, revision from public.takeoff_item_answer_decisions where item_id = pg_temp.f(301)$$,
  $$values ('set_aside'::text, 'duplicate'::text, 1)$$, 'set aside once');
select is((select count(*)::integer from public.takeoff_item_review_commands where intent_key = pg_temp.f(602)), 1, 'one receipt');
select is(pg_temp.review_events(20), 3, 'journaled once');

-- 3. A targeted review excludes the positive row while the item is accepted in bulk.
create temp table targeted_read as select format($save$select count(*) from public.update_takeoff_item_for_review(%L, %L, %L,
    %L::timestamptz, %L::jsonb, %L::timestamptz)$save$, i.tenant_id, i.job_id, i.id, i.updated_at,
    jsonb_build_object('is_excluded', true, 'exclusion_reason', 'Exclue dans la revue ciblée (fictif)', 'updated_at', clock_timestamp()),
    i.rules_evaluated_at) as save, pg_temp.cmd('accept_measured', 603, array[310]) as command
  from public.takeoff_items i where i.id = pg_temp.f(821);
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the targeted review saves the row of affaire 21');
select is((select x.saved from extensions.dblink('race_a', (select save from targeted_read)) as x(saved bigint)), 1::bigint,
  'excluded, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.review_sql(21, (select command from targeted_read))), 1,
  'the table accepts its item meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the acceptance waits for the job''s rules before judging the row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the targeted save commits');
select ok(pg_temp.answered('race_b'), 'the acceptance answers');
select is((select x.outcome::jsonb from extensions.dblink_get_result('race_b', false) as x(outcome text)),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(310))), 'stale: the row changed under it');
select diag(concat('acceptance over a targeted save: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text)), 0, 'and is done');
select results_eq($$select is_excluded, is_verified, verified_by from public.takeoff_items where id = pg_temp.f(821)$$,
  $$values (true, false, null::uuid)$$, 'the row stays excluded and is never verified');
select is((select count(*)::integer from public.takeoff_item_answer_decisions where item_id = pg_temp.f(310)), 0, 'no decision');
select is(pg_temp.review_events(21), 0, 'nothing journaled');

-- 4. Commands on two affaires at once.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a tab sets an item of affaire 21 aside');
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_a',
    pg_temp.review_sql(21, pg_temp.cmd('set_aside', 604, array[311], '{"reason":"out_of_scope"}'))) as x(outcome text)), 'applied',
  'applied, not yet committed');
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_b',
    pg_temp.review_sql(20, pg_temp.cmd('reinstate', 605, array[301]))) as x(outcome text)), 'applied',
  'another tab reinstates an item of affaire 20 without waiting');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select results_eq($$select item_id, kind from public.takeoff_item_answer_decisions where item_id in (pg_temp.f(301), pg_temp.f(311))
  order by item_id$$, $$values (pg_temp.f(301), 'none'::text), (pg_temp.f(311), 'set_aside'::text)$$, 'both applied');

-- 5. A replacement answer published while a set aside waits for the job's rules.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a targeted save holds the rules of affaire 21''s plan');
select is((select x.held from extensions.dblink('race_a', format($hold$select pg_advisory_xact_lock(hashtextextended(%L, 0))::text
    || pg_advisory_xact_lock(hashtextextended(%L, 0))::text$hold$, 'takeoff-job-rules:' || pg_temp.job(21), 'takeoff-job:' || pg_temp.job(21)))
  as x(held text)), '', 'its keys held, not yet committed');
create temp table superseded as select pg_temp.target(310) -> 'answers' -> 0 ->> 'answer_id' as answer_id;
select is(extensions.dblink_send_query('race_b', pg_temp.review_sql(21, pg_temp.cmd('set_aside', 606, array[310],
  '{"reason":"duplicate"}'))), 1, 'the table sets the valve aside meanwhile, with the answer it read');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the set aside waits for the job''s rules');
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.relaunch_sql(21)) as x(outcome text)), 'admitted',
  'meanwhile the plan is read again');
select is((select x.claimed from extensions.dblink('race_setup', replace(pg_temp.claim_sql(21, 931), pg_temp.job(21)::text,
  pg_temp.f(1121)::text)) as x(claimed bigint)), 1::bigint, 'its new job claimed');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', replace(replace(pg_temp.publish_sql(21, 931),
  pg_temp.job(21)::text, pg_temp.f(1121)::text), pg_temp.f(821)::text, pg_temp.f(871)::text)) as x(answer text)), 'false',
  'and its replacement answers published, committed');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the targeted save commits');
select ok(pg_temp.answered('race_b'), 'the set aside answers');
select is((select x.outcome::jsonb from extensions.dblink_get_result('race_b', false) as x(outcome text)),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(310))),
  'stale: what it read is no longer current once its locks are held');
select diag(concat('set aside over a replacement: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text)), 0, 'and is done');
select is((select count(*)::integer from public.takeoff_item_answer_decisions where answer_id::text = (select answer_id from superseded)),
  0, 'the superseded answer is not set aside');
select is((select count(*)::integer from public.takeoff_item_answer_decisions d join public.takeoff_item_answers a on a.id = d.answer_id
  where a.job_id = pg_temp.f(1121)), 0, 'the replacement inherits no decision');

select is(extensions.dblink_exec('race_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid;
  entry record;
begin
  for target in select distinct m.tenant_id from public.tenant_memberships m where m.user_id = 'd5600000-0000-4000-8000-000000000001'
  loop
  delete from private.takeoff_launch_usage u using public.takeoff_launch_requests r where r.id = u.request_id and r.tenant_id = target;
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
  end loop;
end
$clean$;
delete from private.takeoff_host_slots where host_id = 'urn:uuid:d5600000-0000-4000-8000-000000000099';
delete from private.takeoff_local_job_work where host_id = 'urn:uuid:d5600000-0000-4000-8000-000000000099';
delete from private.takeoff_item_list_order_activation;
delete from private.takeoff_plan_dispatch_activation;
delete from private.takeoff_launch_activation;
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'd5600000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd5600000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures, the Mac''s slot and the activations cleaned');
select is((select count(*)::integer from private.takeoff_item_list_order_activation), 0, 'the database is left without an activation');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);
select * from finish();
rollback;
