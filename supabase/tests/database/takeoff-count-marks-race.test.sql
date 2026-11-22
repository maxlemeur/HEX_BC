-- Lot 5, A (20261122114433_takeoff_count_marks.sql): the marks of an item across sessions.
-- 1. Two operators edit the same answer from the same revision: the second waits for the answer's marks state, then is
--    refused (TAKEOFF_MARKS_REVISION_CONFLICT); nothing of it is written.
-- 2. Two operators retain one object for two competing items at once: the second waits for the mark, then is refused
--    (TAKEOFF_MARKS_ATTRIBUTION_TAKEN): one effective item per object.
-- 3. The same intention sent twice at once (a lost answer sent again): the second waits, then answers the first one's
--    command, replayed; nothing is written twice.
-- 4. A late machine generation while a member corrects the same answer: the publication waits for the answer's marks
--    state, then leaves the member's marks as they are (the generation waits unattributed); neither waits for the other in
--    a cycle.
-- Isolation justified: these interleavings exist only across sessions, which no journey drives deterministically. Each
-- held transaction is stopped at a named point; the waits are bounded conditions. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5f00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5f00000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create temp table race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- race_setup writes and commits the fixtures; race_a and race_b are two members' servers, or a member's and the worker.
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);

-- Affaire 20, its plan 100 read on its pages 2 and 7, a list of two items (300 and 301) in its revision 400; its owner, an
-- engineer (1), and the tenant's admin (2).
select is(extensions.dblink_exec('race_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', ('d5f00000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
  'count-marks-race-' || n || '@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from generate_series(1, 2) as n;
update public.tenant_memberships set role = 'engineer' where user_id = 'd5f00000-0000-4000-8000-000000000001';
update public.tenant_memberships set is_default = false where user_id = 'd5f00000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
select m.tenant_id, 'd5f00000-0000-4000-8000-000000000002', 'admin', true from public.tenant_memberships m
where m.user_id = 'd5f00000-0000-4000-8000-000000000001' and m.is_default;
update public.feature_flags set enabled = true where flag_key = 'TAKEOFF_MODULE_ENABLED' and tenant_id = (select m.tenant_id
  from public.tenant_memberships m where m.user_id = 'd5f00000-0000-4000-8000-000000000001' and m.is_default);
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd5f00000-0000-4000-8000-000000000020', m.tenant_id, m.user_id, 'Affaire de repères en concurrence (fictive)', false
from public.tenant_memberships m where m.user_id = 'd5f00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
values ('d5f00000-0000-4000-8000-000000000030', 'd5f00000-0000-4000-8000-000000000020', 'd5f00000-0000-4000-8000-000000000001', 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
values ('d5f00000-0000-4000-8000-000000000060', 'd5f00000-0000-4000-8000-000000000020', 'd5f00000-0000-4000-8000-000000000030',
  'confirme', 'Résumé fictif', 'Objet fictif', now(), 'd5f00000-0000-4000-8000-000000000001');
insert into public.plan_sets (id, tenant_id, project_id, name)
select 'd5f00000-0000-4000-8000-000000000040', p.tenant_id, p.id, 'Plans du dossier'
from public.estimate_projects p where p.id = 'd5f00000-0000-4000-8000-000000000020';
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select 'd5f00000-0000-4000-8000-000000000100', s.tenant_id, s.id, 'plan-1.pdf',
  concat_ws('/', s.tenant_id, s.id, 'd5f00000-0000-4000-8000-000000000100', 'plan-1.pdf'), 'application/pdf', 8, 9
from public.plan_sets s where s.id = 'd5f00000-0000-4000-8000-000000000040';
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
select ('d5f00000-0000-4000-8000-000000000' || (300 + k))::uuid, p.tenant_id, p.id, 'manual', 1, p.user_id
from generate_series(0, 1) as k join public.estimate_projects p on p.id = 'd5f00000-0000-4000-8000-000000000020';
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by)
select 'd5f00000-0000-4000-8000-000000000400', p.tenant_id, p.id, 1, 'item_added', '{}', 2, repeat('1', 64), repeat('a', 64),
  'd5f00000-0000-4000-8000-000000000410', p.user_id
from public.estimate_projects p where p.id = 'd5f00000-0000-4000-8000-000000000020';
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin)
select 'd5f00000-0000-4000-8000-000000000400', p.tenant_id, p.id, ('d5f00000-0000-4000-8000-000000000' || (300 + k))::uuid, k,
  'manual:poste-' || k, 'Poste ' || k || ' (fictif)', 'u', 'manual', '{"kind":"manual"}'
from generate_series(0, 1) as k join public.estimate_projects p on p.id = 'd5f00000-0000-4000-8000-000000000020';
set local session_replication_role = origin;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 hour');
commit;
$setup$), 'COMMIT', 'an affaire of one plan and a list of two items, two operators, the activations');

create function pg_temp.tenant() returns uuid language sql stable as $$
  select tenant_id from public.estimate_projects where id = pg_temp.f(20)
$$;
create function pg_temp.job() returns uuid language sql immutable as $$ select pg_temp.f(1020) $$;
create function pg_temp.digest(plan uuid) returns text language sql immutable as $$
  select encode(sha256(convert_to(plan::text, 'UTF8')), 'hex')
$$;
create function pg_temp.snapshot() returns jsonb language sql stable as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-22T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', f.id, 'document_name', f.file_name, 'kind', 'plan',
          'active', true, 'confirmed', true, 'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count,
          'source_updated_at', f.updated_at, 'content_hash', pg_temp.digest(f.id), 'pages', '[2, 7]'::jsonb))
        from public.plan_files f where f.plan_set_id = pg_temp.f(40))))
$$;
create function pg_temp.launch_sql() returns text language sql stable as $$
  select format($launch$select outcome from public.launch_manual_takeoff_plan_request(%L, %L, %L, %L, 'initial', null, %L, %L::jsonb,
    %L::jsonb, %L::jsonb, %L::jsonb, %L, 1, %L::uuid[])$launch$,
    pg_temp.tenant(), pg_temp.f(20), pg_temp.f(1), pg_temp.f(500), pg_temp.host(), pg_temp.selection(),
    jsonb_build_object('format_version', 2, 'intent', 'initial',
      'order', (select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', r.id,
        'revision', r.revision, 'content_sha256', r.content_sha256, 'item_count', r.item_count))
        from public.takeoff_list_revisions r where r.id = pg_temp.f(400)),
      'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
      'units', jsonb_build_array(jsonb_build_object('key', 'plan:' || pg_temp.f(100), 'ordinal', 1,
        'plans', jsonb_build_array(pg_temp.f(100)), 'pages', '[2, 7]'::jsonb, 'page_count', 9, 'vector_pages', 0,
        'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))),
      'plans', jsonb_build_array(jsonb_build_object('entry_key', pg_temp.f(100), 'plan_file_id', pg_temp.f(100), 'name', 'plan-1.pdf',
        'logical_id', pg_temp.f(100), 'generation', null, 'content_sha256', pg_temp.digest(pg_temp.f(100)), 'pages', '[2, 7]'::jsonb,
        'page_count', 9)),
      'coverage', jsonb_build_object('plans_retained', 1, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
      'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)),
    pg_temp.snapshot(),
    jsonb_build_array(jsonb_build_object('id', pg_temp.job(), 'plan_set_id', pg_temp.f(40),
      'launch_unit_key', 'plan:' || pg_temp.f(100), 'source_file_name', 'plan-1.pdf',
      'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture',
      'execution_host_id', pg_temp.host())),
    pg_temp.f(40), array[pg_temp.f(100)])
$$;
create function pg_temp.claim_sql(token integer) returns text language sql stable as $$
  select format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L, clock_timestamp(), %L,
    clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)$claim$,
    pg_temp.job(), pg_temp.tenant(), pg_temp.host(), pg_temp.f(token))
$$;
-- Both items measured on page 2 (one row of the result each), as the worker publishes them.
create function pg_temp.publish_answers_sql(token integer) returns text language sql stable as $$
  select format($publish$select replayed::text from public.publish_takeoff_item_answers(%L, %L,
    '2026-11-22T09:00:00Z', 'modele-fictif', 'takeoff-c-postes-v1',
    '{"schema_version": "v2", "prompt_version": "takeoff-c-postes-v1"}'::jsonb, array[2, 7], %L::jsonb, '[]'::jsonb, %L::jsonb,
    %L::jsonb)$publish$,
    pg_temp.job(), pg_temp.f(token),
    (select jsonb_agg(jsonb_build_object('item_id', pg_temp.f(300 + k), 'outcome', 'measured', 'reasons', '[]'::jsonb,
        'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'quantity', jsonb_build_object('value', 2, 'unit', 'u'),
        'observations', jsonb_build_array(jsonb_build_object('page', 2, 'evidence', 'Symboles fictifs', 'method', 'symbol_count',
          'confidence', 0.9, 'quantity', 2, 'unit', 'u', 'role', 'contribution', 'source', 'model', 'chunk_id', 'f1-b1',
          'takeoff_item_id', pg_temp.f(800 + k)))) order by k) from generate_series(0, 1) as k),
    jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb, 'provider_meta', '{}'::jsonb,
      'token_count', 10, 'cost_cents', 0, 'duration_ms', 5),
    (select jsonb_agg(jsonb_build_object('id', pg_temp.f(800 + k), 'designation', 'Poste ' || k || ' (fictif)', 'quantity', 2,
      'unit', 'u', 'confidence', 0.9, 'evidence', 'Symboles fictifs', 'source_file_name', 'plan-1.pdf', 'source_page', 2,
      'metadata', '{}'::jsonb) order by k) from generate_series(0, 1) as k))
$$;
create function pg_temp.geometry() returns jsonb language sql immutable as $$
  select '{"version": 1, "view_box": [0, 0, 1190.55, 841.89], "rotation": 0, "user_unit": 1, "width": 1190.55, "height": 841.89}'::jsonb
$$;
create function pg_temp.proposal(item integer, source_key text) returns jsonb language sql immutable as $$
  select jsonb_build_object('item_id', pg_temp.f(item), 'state', 'proposed', 'method', 'symbol_count', 'method_version', 'banc-1',
    'source_key', source_key)
$$;
create function pg_temp.publish_marks_sql(token integer, generation integer, marks jsonb) returns text language sql stable as $$
  select format($marks$select public.publish_takeoff_count_marks(%L, %L, %s, %L::jsonb, %L::jsonb)::text$marks$,
    pg_temp.job(), pg_temp.f(token), generation, jsonb_build_array(jsonb_build_object('page', 2, 'geometry', pg_temp.geometry())),
    marks)
$$;
-- A member's server: the session of member n, then its edit.
create function pg_temp.sign_in_sql(n integer) returns text language sql immutable as $$
  select format($sign$set local request.jwt.claims = %L; set local request.jwt.claim.sub = %L$sign$,
    jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(n))::text, pg_temp.f(n)::text)
$$;
create function pg_temp.edit_sql(intent integer, revisions jsonb, gestures jsonb) returns text language sql stable as $$
  select format($edit$select public.edit_takeoff_count_marks(%L, %L, %L, %L::jsonb, %L::jsonb)::text$edit$,
    pg_temp.tenant(), pg_temp.f(20), pg_temp.f(intent), revisions, gestures)
$$;
create function pg_temp.begin_as(session text, n integer) returns boolean language sql as $$
  select extensions.dblink_exec(session, 'begin') = 'BEGIN'
    and extensions.dblink_exec(session, pg_temp.sign_in_sql(n)) = 'SET'
    and extensions.dblink_exec(session, 'set local role authenticated') = 'SET'
$$;

select is(extensions.dblink_exec('race_setup', (select format($prep$begin;
  set local session_replication_role = replica;
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by) values (%L, %L, 1, %L::jsonb, %L::jsonb, now(), %L, %L);
  commit;$prep$, pg_temp.tenant(), pg_temp.f(20), pg_temp.snapshot() -> 'preparation', pg_temp.snapshot(), pg_temp.f(1),
  pg_temp.f(1)))), 'COMMIT', 'the affaire''s preparation is confirmed');
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql()) as x(outcome text)), 'admitted',
  'the affaire reads its plan against its list');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(901)) as x(claimed bigint)), 1::bigint,
  'the worker reads the plan');
select is((select x.replayed from extensions.dblink('race_setup', pg_temp.publish_answers_sql(901)) as x(replayed text)), 'false',
  'and publishes both answers');
-- On page 2, three marks of the first item, the third also proposed for the second (competing items).
select is((select (x.answer::jsonb ->> 'marks')::integer from extensions.dblink('race_setup', pg_temp.publish_marks_sql(901, 1,
  jsonb_build_array(
    jsonb_build_object('page', 2, 'x', 0.1, 'y', 0.1, 'proposals', jsonb_build_array(pg_temp.proposal(300, 'p0-1'))),
    jsonb_build_object('page', 2, 'x', 0.2, 'y', 0.1, 'proposals', jsonb_build_array(pg_temp.proposal(300, 'p0-2'))),
    jsonb_build_object('page', 2, 'x', 0.3, 'y', 0.1, 'proposals', jsonb_build_array(pg_temp.proposal(300, 'p0-3'),
      pg_temp.proposal(301, 'p1-1')))))) as x(answer text)), 3, 'and its first generation of marks');

create function pg_temp.answer(item integer) returns uuid language sql stable as $$
  select a.id from public.takeoff_item_answers a where a.job_id = pg_temp.job() and a.item_id = pg_temp.f(item)
$$;
create function pg_temp.m(source_key text) returns uuid language sql stable as $$
  select p.mark_id from public.takeoff_count_mark_proposals p where p.job_id = pg_temp.job() and p.source_key = $1
$$;
create function pg_temp.at(answer uuid, revision integer) returns jsonb language sql immutable as $$
  select jsonb_build_object(answer::text, revision)
$$;
create function pg_temp.revision(item integer) returns integer language sql stable as $$
  select revision from public.takeoff_count_answer_states where answer_id = pg_temp.answer(item)
$$;

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

-- 1. Two operators edit the first item's marks from the same revision.
select ok(pg_temp.begin_as('race_a', 1), 'the owner opens an edit');
select is((select x.answer::jsonb -> 'revisions' from extensions.dblink('race_a', pg_temp.edit_sql(701,
  pg_temp.at(pg_temp.answer(300), 1), jsonb_build_array(jsonb_build_object('op', 'retain', 'answer_id', pg_temp.answer(300),
  'mark_id', pg_temp.m('p0-1'))))) as x(answer text)), pg_temp.at(pg_temp.answer(300), 2), 'retains a mark, not yet committed');
select ok(pg_temp.begin_as('race_b', 2), 'the admin opens another one meanwhile');
select is(extensions.dblink_send_query('race_b', pg_temp.edit_sql(702, pg_temp.at(pg_temp.answer(300), 1),
  jsonb_build_array(jsonb_build_object('op', 'remove', 'answer_id', pg_temp.answer(300), 'mark_id', pg_temp.m('p0-2'),
  'reason', 'duplicate')))), 1, 'from the same revision');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second waits for the answer''s marks state');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'with no result');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_MARKS_REVISION_CONFLICT%', 'refused as a conflict');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(extensions.dblink_exec('race_b', 'rollback'), 'ROLLBACK', 'its transaction ends');
select results_eq($$select state from public.takeoff_count_mark_attributions where mark_id = pg_temp.m('p0-2')$$,
  $$values ('proposed'::text)$$, 'nothing of it was written');
select is(pg_temp.revision(300), 2, 'the answer is at the first edit''s revision');

-- 2. Two operators retain the competing object for two items at once.
select ok(pg_temp.begin_as('race_a', 1), 'the owner retains the third mark for the first item');
select is((select x.answer::jsonb -> 'revisions' from extensions.dblink('race_a', pg_temp.edit_sql(703,
  pg_temp.at(pg_temp.answer(300), 2), jsonb_build_array(jsonb_build_object('op', 'retain', 'answer_id', pg_temp.answer(300),
  'mark_id', pg_temp.m('p0-3'))))) as x(answer text)), pg_temp.at(pg_temp.answer(300), 3), 'not yet committed');
select ok(pg_temp.begin_as('race_b', 2), 'the admin retains it for the second item meanwhile');
select is(extensions.dblink_send_query('race_b', pg_temp.edit_sql(704, pg_temp.at(pg_temp.answer(301), 1),
  jsonb_build_array(jsonb_build_object('op', 'retain', 'answer_id', pg_temp.answer(301), 'mark_id', pg_temp.m('p0-3'))))), 1,
  'on its own answer''s revision');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second waits for the mark');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'with no result');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_MARKS_ATTRIBUTION_TAKEN%',
  'refused: the object counts for the first item');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(extensions.dblink_exec('race_b', 'rollback'), 'ROLLBACK', 'its transaction ends');
select results_eq($$select answer_id = pg_temp.answer(300), state from public.takeoff_count_mark_attributions
  where mark_id = pg_temp.m('p0-3') order by answer_id = pg_temp.answer(300) desc$$,
  $$values (true, 'retained'::text), (false, 'proposed')$$, 'one retained attribution, the other still proposed');
select is(pg_temp.revision(301), 1, 'the second item''s answer did not change');

-- 3. The same intention sent twice at once.
select ok(pg_temp.begin_as('race_a', 1), 'the owner removes a duplicate');
create temp table first_command as select (x.answer::jsonb ->> 'command_id')::uuid as id
from extensions.dblink('race_a', pg_temp.edit_sql(705, pg_temp.at(pg_temp.answer(300), 3), jsonb_build_array(
  jsonb_build_object('op', 'remove', 'answer_id', pg_temp.answer(300), 'mark_id', pg_temp.m('p0-2'), 'reason', 'duplicate'))))
  as x(answer text);
select isnt((select id from first_command), null::uuid, 'not yet committed');
select ok(pg_temp.begin_as('race_b', 1), 'its server sends the same edit again, its answer lost');
select is(extensions.dblink_send_query('race_b', pg_temp.edit_sql(705, pg_temp.at(pg_temp.answer(300), 3), jsonb_build_array(
  jsonb_build_object('op', 'remove', 'answer_id', pg_temp.answer(300), 'mark_id', pg_temp.m('p0-2'), 'reason', 'duplicate')))), 1,
  'under the same intention');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second waits for the answer''s marks state');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
select results_eq($$select (x.answer::jsonb ->> 'replayed')::boolean, (x.answer::jsonb ->> 'command_id')::uuid
  from extensions.dblink_get_result('race_b', false) as x(answer text)$$,
  $$select true, id from first_command$$, 'with the first one''s command, replayed');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(extensions.dblink_exec('race_b', 'commit'), 'COMMIT', 'its transaction ends');
select results_eq($$select (select count(*)::integer from public.takeoff_count_mark_commands where intent_key = pg_temp.f(705)),
  pg_temp.revision(300), (select count(*)::integer from public.takeoff_count_mark_events where command_id = (select id from first_command))$$,
  $$values (1, 4, 1)$$, 'one command, one revision more, one event');

-- 4. A late machine generation while the owner corrects the first item's marks.
select ok(pg_temp.begin_as('race_a', 1), 'the owner adds a mark by hand');
select is((select x.answer::jsonb -> 'revisions' from extensions.dblink('race_a', pg_temp.edit_sql(706,
  pg_temp.at(pg_temp.answer(300), 4), jsonb_build_array(jsonb_build_object('op', 'add', 'answer_id', pg_temp.answer(300),
  'key', pg_temp.f(707), 'page', 2, 'x', 0.6, 'y', 0.6)))) as x(answer text)), pg_temp.at(pg_temp.answer(300), 5),
  'not yet committed');
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'the worker publishes a second generation meanwhile');
select is(extensions.dblink_exec('race_b', 'set local role service_role'), 'SET', 'as the service role');
select is(extensions.dblink_send_query('race_b', pg_temp.publish_marks_sql(901, 2, jsonb_build_array(
  jsonb_build_object('page', 2, 'x', 0.8, 'y', 0.8, 'proposals', jsonb_build_array(pg_temp.proposal(300, 'g2-p0-1'),
    pg_temp.proposal(301, 'g2-p1-1')))))), 1, 'for both items');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the publication waits for the first item''s marks state');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the owner''s edit commits');
select ok(pg_temp.answered('race_b'), 'the publication answers');
create temp table late_generation as select x.answer::jsonb as answer
from extensions.dblink_get_result('race_b', false) as x(answer text);
select diag(concat('late generation: ', extensions.dblink_error_message('race_b')));
select results_eq($$select (a ->> 'answer_id')::uuid, (a ->> 'effective')::boolean, (a ->> 'revision')::integer
  from late_generation, jsonb_array_elements(answer -> 'answers') a order by (a ->> 'revision')::integer$$,
  $$values (pg_temp.answer(301), false, 1), (pg_temp.answer(300), false, 5)$$,
  'it leaves both answers as they are: the member''s correction stands, the generation waits');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(extensions.dblink_exec('race_b', 'commit'), 'COMMIT', 'its transaction ends');
select results_eq($$select (s ->> 'pending')::integer, (s ->> 'retained')::integer, (s ->> 'revision')::integer
  from (select private.takeoff_count_mark_summary(pg_temp.answer(300)) s) x$$, $$values (1, 3, 5)$$,
  'the first item keeps its three retained marks, one more pending');

select is(extensions.dblink_exec('race_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid;
  entry record;
begin
  for target in select distinct m.tenant_id from public.tenant_memberships m
    where m.user_id in ('d5f00000-0000-4000-8000-000000000001', 'd5f00000-0000-4000-8000-000000000002')
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
delete from private.takeoff_host_slots where host_id = 'urn:uuid:d5f00000-0000-4000-8000-000000000099';
delete from private.takeoff_local_job_work where host_id = 'urn:uuid:d5f00000-0000-4000-8000-000000000099';
delete from private.takeoff_item_list_order_activation;
delete from private.takeoff_plan_dispatch_activation;
delete from private.takeoff_launch_activation;
delete from private.takeoff_completion_activation;
delete from public.profiles where id in ('d5f00000-0000-4000-8000-000000000001', 'd5f00000-0000-4000-8000-000000000002');
delete from auth.users where id in ('d5f00000-0000-4000-8000-000000000001', 'd5f00000-0000-4000-8000-000000000002');
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures, the Mac''s slot and the activations cleaned');
select is((select count(*)::integer from public.takeoff_count_marks where project_id = pg_temp.f(20)), 0, 'no mark is left');
select is((select count(*)::integer from private.takeoff_item_list_order_activation), 0, 'the database is left without an activation');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);
select * from finish();
rollback;
