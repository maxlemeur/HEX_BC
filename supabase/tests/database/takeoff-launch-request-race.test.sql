-- Lot 2, M4 (20261121111238_takeoff_launch_requests.sql): the automatic start across sessions.
-- 1. Two confirmations of one affaire reserve its request at the same time: the second waits for the first and finds
--    the same request; there is one automatic request.
-- 2. An admission while a plan of the dossier is being changed: the admission waits for the change, then finds its
--    sealed source stale and admits nothing; the request waits for a new evaluation. The writer of the dossier never
--    waits for the admission.
-- 3. A second process of the Mac that lost the lease admits nothing.
-- Isolation justified: these interleavings exist only across sessions, which no journey drives deterministically. Each
-- held transaction is stopped at a named point; the waits are bounded conditions. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.fx(n integer) returns uuid language sql immutable as $$
  select ('d4900000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d4900000-0000-4000-8000-000000000099' $$;
create temp table race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- race_setup and race_writer write as the owner (the dossier's writers); race_a and race_b are two processes of the server.
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_writer'), ('race_a'), ('race_b')) as session(name);

select is(extensions.dblink_exec('race_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd4900000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'launch-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer' where user_id = 'd4900000-0000-4000-8000-000000000001';
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd4900000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Dossier confirmé deux fois (fictif)', false
from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
values ('d4900000-0000-4000-8000-000000000030', 'd4900000-0000-4000-8000-000000000010', 'd4900000-0000-4000-8000-000000000001', 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
values ('d4900000-0000-4000-8000-000000000035', 'd4900000-0000-4000-8000-000000000010', 'd4900000-0000-4000-8000-000000000030',
  'confirme', 'Résumé fictif', 'Objet fictif', now(), 'd4900000-0000-4000-8000-000000000001');
insert into public.affaire_intake_documents (id, upload_id, file_name, upload_status, storage_path, classification_status, document_kind)
values ('d4900000-0000-4000-8000-000000000060', 'd4900000-0000-4000-8000-000000000030', 'annexe.pdf', 'uploaded', 'fixture/annexe',
  'classified', 'annexes');
insert into public.plan_sets (id, tenant_id, project_id, name)
select 'd4900000-0000-4000-8000-000000000040', m.tenant_id, 'd4900000-0000-4000-8000-000000000010', 'Plans du dossier'
from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select 'd4900000-0000-4000-8000-000000000050', m.tenant_id, 'd4900000-0000-4000-8000-000000000040', 'plan-rdc.pdf',
  concat_ws('/', m.tenant_id, 'd4900000-0000-4000-8000-000000000040', 'd4900000-0000-4000-8000-000000000050', 'plan-rdc.pdf'),
  'application/pdf', 8, 1
from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
commit;
$setup$), 'COMMIT', 'an affaire whose brief was confirmed after activation, with one plan');

create temp table race_pids(label text primary key, pid integer);
insert into race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('race_writer'), ('race_a'), ('race_b')) as session(name);
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
create function pg_temp.mandate_sql() returns text language sql stable as $$
  select format($mandate$select r.request_id::text, r.state from public.record_takeoff_launch_mandate(%1$L, %2$L, %3$L,
    'confirmation', %4$L, jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null,
      'hostId', %4$L)) r$mandate$,
    (select tenant_id from public.estimate_projects where id = pg_temp.fx(10)), pg_temp.fx(10), pg_temp.fx(1), pg_temp.host())
$$;
select is(extensions.dblink_exec(session.name, 'set role service_role'), 'SET', format('%s runs as the server', session.name))
from (values ('race_a'), ('race_b')) as session(name);

-- 1. Two confirmations reserve the request at the same time.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the first confirmation''s call starts');
create temp table reserved (session text, request_id uuid, state text);
insert into reserved select 'a', x.request_id::uuid, x.state
from extensions.dblink('race_a', pg_temp.mandate_sql()) as x(request_id text, state text);
select is((select state from reserved where session = 'a'), 'evaluating', 'it reserves the request, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.mandate_sql()), 1, 'the second call arrives');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'it waits for the first reservation');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
insert into reserved select 'b', x.request_id::uuid, x.state
from extensions.dblink_get_result('race_b', false) as x(request_id text, state text);
select diag(concat('reservation: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(request_id text, state text)), 0, 'and is done');
select is((select count(distinct request_id)::integer from reserved), 1, 'both find the same request');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.fx(10)), 1,
  'the affaire has one automatic request');

-- 2. An admission while a plan of the dossier is being changed.
create temp table race_claim as select x.request_id::uuid as request_id, x.mark from extensions.dblink('race_a', format(
  'select request_id::text, mark from public.claim_takeoff_launch_evaluations(%L, %L)', pg_temp.host(), pg_temp.fx(91)))
  as x(request_id text, mark bigint);
select is((select count(*)::integer from race_claim), 1, 'the Mac claims the request and reads the dossier''s position');
create function pg_temp.admit_sql(p_token uuid, p_job integer) returns text language sql as $$
  select format($admit$select outcome || ':' || coalesce(job_id::text, '') from public.admit_takeoff_launch_request(%1$L, %2$L, %3$s,
    jsonb_build_object('format_version', 1, 'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
      'units', jsonb_build_array(jsonb_build_object('key', 'grouped', 'plans', jsonb_build_array(%4$L::uuid))),
      'plans', jsonb_build_array(jsonb_build_object('entry_key', %4$L::uuid, 'plan_file_id', %4$L::uuid, 'pages', '[]'::jsonb))),
    jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', %5$L::uuid, 'confirmed_at', '2026-11-21T08:00:00Z',
      'execution_selection', jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', %6$L),
      'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
      'preparation', jsonb_build_object('schema_version', 1, 'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
        'processing', '{"level":"C","provider":"chatgpt"}'::jsonb, 'sources', jsonb_build_array(jsonb_build_object(
          'document_id', %4$L::uuid, 'kind', 'plan', 'active', true, 'confirmed', true, 'plan_set_id', %7$L::uuid,
          'file_path', %8$L, 'page_count', %11$s, 'source_updated_at', %9$L::timestamptz)))),
    jsonb_build_object('id', %10$L::uuid, 'plan_set_id', %7$L::uuid, 'source_file_name', 'plan-rdc.pdf', 'source_file_type', 'application/pdf',
      'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', %6$L))$admit$,
    (select request_id from race_claim), p_token, (select mark from race_claim), pg_temp.fx(50), pg_temp.fx(1), pg_temp.host(),
    pg_temp.fx(40), (select file_path from public.plan_files where id = pg_temp.fx(50)),
    (select updated_at from public.plan_files where id = pg_temp.fx(50)), pg_temp.fx(p_job),
    (select page_count from public.plan_files where id = pg_temp.fx(50)))
$$;
create temp table admit_sql as select pg_temp.admit_sql(pg_temp.fx(91), 60) as body;
select is(extensions.dblink_exec('race_writer', 'begin'), 'BEGIN', 'a member changes a plan of the dossier');
select is(extensions.dblink_exec('race_writer', format('update public.plan_files set page_count = 2 where id = %L', pg_temp.fx(50))),
  'UPDATE 1', 'the change is written, not yet committed');
select is(extensions.dblink_send_query('race_a', (select body from admit_sql)), 1, 'the Mac admits the request meanwhile');
select ok(pg_temp.waits_for('race_a', 'race_writer'), 'the admission waits for the change of the plan');
select is(extensions.dblink_exec('race_writer', 'commit'), 'COMMIT', 'the change commits: the writer never waited for the admission');
select ok(pg_temp.answered('race_a'), 'the admission answers');
create temp table admitted as select x.answer from extensions.dblink_get_result('race_a', false) as x(answer text);
select diag(concat('admission: ', extensions.dblink_error_message('race_a')));
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(answer text)), 0, 'and is done');
select is((select answer from admitted), 'stale:', 'the sealed source is stale: nothing is admitted');
select is((select count(*)::integer from public.takeoff_jobs where project_id = pg_temp.fx(10)), 0, 'no job exists');
select is((select count(*)::integer from public.audit_logs where record_id in (pg_temp.fx(60), (select request_id from race_claim))
  and action in ('takeoff.job.created', 'takeoff.request.admitted')), 0, 'nor any creation record');
select is((select state from public.takeoff_launch_requests where id = (select request_id from race_claim)), 'evaluating',
  'the request waits for a new evaluation');
select ok(private.takeoff_launch_mark_position((select tenant_id from public.estimate_projects where id = pg_temp.fx(10)), pg_temp.fx(10))
  > (select mark from race_claim), 'the change recorded the need of an evaluation');

-- 3. A second process that lost the lease admits nothing.
delete from race_claim;
insert into race_claim select x.request_id::uuid, x.mark from extensions.dblink('race_a', format(
  'select request_id::text, mark from public.claim_takeoff_launch_evaluations(%L, %L)', pg_temp.host(), pg_temp.fx(92)))
  as x(request_id text, mark bigint);
select is((select count(*)::integer from race_claim), 1, 'the first process claims the request again');
select is((select x.answer from extensions.dblink('race_b', pg_temp.admit_sql(pg_temp.fx(93), 61)) as x(answer text)), 'lost:',
  'a process without the lease admits nothing');
select is((select count(*)::integer from public.takeoff_jobs where project_id = pg_temp.fx(10)), 0, 'still no job');

-- 4. A change of the dossier numbered before another but committed after the evaluation read the dossier: the admission
-- sees it and admits nothing (red when the position was the highest mark number: the late mark did not raise it).
select is((select x.state from extensions.dblink('race_a', format(
  'select public.record_takeoff_launch_evaluation(%L, %L, 0, %L)', (select request_id from race_claim), pg_temp.fx(92), 'evaluating'))
  as x(state text)), 'evaluating', 'the first process gives its lease back');
select is(extensions.dblink_exec('race_writer', 'begin'), 'BEGIN', 'a member marks a piece of the dossier to review');
select is(extensions.dblink_exec('race_writer', format($review$update public.affaire_intake_documents set issues = array['Pièce à revoir (fictif)']
  where id = %L$review$, pg_temp.fx(60))), 'UPDATE 1', 'the change is written, its mark numbered, not yet committed');
select is(extensions.dblink_exec('race_setup', format('update public.affaire_briefs set confirmed_at = confirmed_at where id = %L', pg_temp.fx(35))),
  'UPDATE 1', 'another change of the dossier, numbered after it, commits first');
delete from race_claim;
insert into race_claim select x.request_id::uuid, x.mark from extensions.dblink('race_a', format(
  'select request_id::text, mark from public.claim_takeoff_launch_evaluations(%L, %L)', pg_temp.host(), pg_temp.fx(94)))
  as x(request_id text, mark bigint);
select is((select count(*)::integer from race_claim), 1, 'the Mac claims the request and reads the dossier''s position');
select is(extensions.dblink_exec('race_writer', 'commit'), 'COMMIT', 'the first change commits after that read');
select is((select x.answer from extensions.dblink('race_a', pg_temp.admit_sql(pg_temp.fx(94), 62)) as x(answer text)), 'stale:',
  'the admission sees a change it did not evaluate and admits nothing');
select is((select count(*)::integer from public.takeoff_jobs where project_id = pg_temp.fx(10)), 0, 'no job exists');

-- Clean the committed synthetic fixtures and the cut-offs.
select is(extensions.dblink_exec('race_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'd4900000-0000-4000-8000-000000000001' and is_default);
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
delete from private.takeoff_launch_activation;
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'd4900000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd4900000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures and the cut-offs cleaned');
select is((select count(*)::integer from private.takeoff_launch_activation), 0, 'the database is left without a cut-off');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('race_setup'), ('race_writer'), ('race_a'), ('race_b')) as session(name);
select * from finish();
rollback;
