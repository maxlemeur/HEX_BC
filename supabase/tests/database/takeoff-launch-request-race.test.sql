-- Lot 2, M4 (20261121170448_takeoff_launch_requests.sql): the automatic start across sessions.
-- 1. Two server confirmations of one brief at the same time: the second waits for the first and its compare-and-set
--    then fails; there is one automatic request, mandated by the first.
-- 2. An admission while a plan of the dossier is being changed: the admission waits for the change, then finds its
--    sealed source stale and admits nothing; the request waits for a new evaluation. The writer of the dossier never
--    waits for the admission.
-- 3. A second process of the Mac that lost the lease admits nothing.
-- 4. A change committed after the evaluation read the dossier, numbered before another: the admission sees it.
-- 5. A confirmation and a relaunch of one affaire at the same time, in both orders: the relaunch always finds the
--    automatic request the confirmation reserved, or the confirmation the relaunch, and only one analysis is paid.
-- 6. Two take-overs from the same view of a request: the second is refused, the first's mandate stays.
-- 7. A dossier change that commits after the admission's count: the admission waits for it and admits nothing.
-- 8. A relaunch refused while the automatic analysis runs, against the worker that holds that analysis's job and ends
--    it: the refusal's receipt waits for nothing the worker holds, and both complete.
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
select '00000000-0000-0000-0000-000000000000', ('d4900000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
  'launch-race-' || n || '@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from generate_series(1, 3) as n;
update public.tenant_memberships set role = 'engineer' where user_id = 'd4900000-0000-4000-8000-000000000001';
-- Members 2 and 3 administer the first member's tenant.
update public.tenant_memberships set is_default = false
where user_id in ('d4900000-0000-4000-8000-000000000002', 'd4900000-0000-4000-8000-000000000003');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
select m.tenant_id, member.id, 'admin', true from public.tenant_memberships m
cross join (values ('d4900000-0000-4000-8000-000000000002'::uuid), ('d4900000-0000-4000-8000-000000000003'::uuid)) as member(id)
where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
update public.feature_flags set enabled = true where flag_key = 'TAKEOFF_MODULE_ENABLED' and tenant_id = (select m.tenant_id
  from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default);
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd4900000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Dossier confirmé deux fois (fictif)', false
from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
values ('d4900000-0000-4000-8000-000000000030', 'd4900000-0000-4000-8000-000000000010', 'd4900000-0000-4000-8000-000000000001', 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object)
values ('d4900000-0000-4000-8000-000000000035', 'd4900000-0000-4000-8000-000000000010', 'd4900000-0000-4000-8000-000000000030',
  'a_confirmer', 'Résumé fictif', 'Objet fictif');
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
-- Four more affaires of the first member, each with its brief to confirm, one plan and an annex; the plans of the two
-- relaunched affaires had a first analysis from the existing dialog (a job without a request).
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select ('d4900000-0000-4000-8000-0000000001' || n || '0')::uuid, m.tenant_id, m.user_id, 'Affaire concurrente ' || n || ' (fictive)', false
from public.tenant_memberships m cross join generate_series(1, 4) as n
where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select ('d4900000-0000-4000-8000-0000000001' || n || '1')::uuid, ('d4900000-0000-4000-8000-0000000001' || n || '0')::uuid,
  'd4900000-0000-4000-8000-000000000001', 'ready' from generate_series(1, 4) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object)
select ('d4900000-0000-4000-8000-0000000001' || n || '2')::uuid, ('d4900000-0000-4000-8000-0000000001' || n || '0')::uuid,
  ('d4900000-0000-4000-8000-0000000001' || n || '1')::uuid, 'a_confirmer', 'Résumé fictif', 'Objet fictif' from generate_series(1, 4) as n;
insert into public.affaire_intake_documents (id, upload_id, file_name, upload_status, storage_path, classification_status, document_kind)
select ('d4900000-0000-4000-8000-0000000001' || n || '3')::uuid, ('d4900000-0000-4000-8000-0000000001' || n || '1')::uuid,
  'annexe.pdf', 'uploaded', 'fixture/annexe-' || n, 'classified', 'annexes' from generate_series(1, 4) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select ('d4900000-0000-4000-8000-0000000001' || n || '4')::uuid, m.tenant_id, ('d4900000-0000-4000-8000-0000000001' || n || '0')::uuid,
  'Plans du dossier ' || n
from public.tenant_memberships m cross join generate_series(1, 4) as n
where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select ('d4900000-0000-4000-8000-0000000001' || n || '5')::uuid, m.tenant_id, ('d4900000-0000-4000-8000-0000000001' || n || '4')::uuid,
  'plan-' || n || '.pdf', concat_ws('/', m.tenant_id, 'd4900000-0000-4000-8000-0000000001' || n || '4',
    'd4900000-0000-4000-8000-0000000001' || n || '5', 'plan-' || n || '.pdf'), 'application/pdf', 8, 1
from public.tenant_memberships m cross join generate_series(1, 4) as n
where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by)
select ('d4900000-0000-4000-8000-0000000001' || n || '6')::uuid, m.tenant_id, ('d4900000-0000-4000-8000-0000000001' || n || '0')::uuid,
  ('d4900000-0000-4000-8000-0000000001' || n || '4')::uuid, 'C', 'completed', m.user_id
from public.tenant_memberships m cross join generate_series(1, 2) as n
where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
set local session_replication_role = origin;
commit;
$setup$), 'COMMIT', 'affaires whose briefs wait for their confirmation after activation, with one plan each');

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
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create function pg_temp.tenant() returns uuid language sql stable as $$
  select tenant_id from public.estimate_projects where id = pg_temp.fx(10)
$$;
-- The server's confirmation of an affaire's brief by a member, with the notice that member was shown (or none), on the
-- revision of the brief read now.
create function pg_temp.confirm_sql(p_project uuid, p_member integer, p_notified boolean default true) returns text language sql stable as $$
  select format($confirm$select c.outcome, coalesce(c.request_id::text, ''), coalesce(c.state, ''), coalesce(c.reason_code, '')
    from public.confirm_affaire_brief_takeoff(%1$L, %2$L, %3$L, %4$L, %5$L, %6$L, %7$L, null,
      p_actor_claims => jsonb_build_object('sub', %3$L, 'role', 'authenticated')) c$confirm$,
    pg_temp.tenant(), p_project, pg_temp.fx(p_member), (select updated_at from public.affaire_briefs where project_id = p_project),
    case when p_notified then public.takeoff_payer_notice(pg_temp.tenant(), p_project, pg_temp.fx(p_member), pg_temp.selection()) end,
    pg_temp.host(), pg_temp.selection())
$$;
create function pg_temp.mandate_sql() returns text language sql stable as $$
  select pg_temp.confirm_sql(pg_temp.fx(10), 1)
$$;
select is(extensions.dblink_exec(session.name, 'set role service_role'), 'SET', format('%s runs as the server', session.name))
from (values ('race_a'), ('race_b')) as session(name);

-- 1. Two confirmations reserve the request at the same time.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the first confirmation''s call starts');
create temp table reserved (session text, request_id uuid, state text);
create temp table confirmation_sql as select pg_temp.mandate_sql() as body;
insert into reserved select 'a', nullif(x.request_id, '')::uuid, x.outcome || ':' || x.state
from extensions.dblink('race_a', (select body from confirmation_sql)) as x(outcome text, request_id text, state text, reason_code text);
select is((select state from reserved where session = 'a'), 'confirmed:evaluating', 'it reserves the request, not yet committed');
select is(extensions.dblink_send_query('race_b', (select body from confirmation_sql)), 1, 'the second call arrives, from the same form');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'it waits for the first reservation');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
insert into reserved select 'b', nullif(x.request_id, '')::uuid, x.outcome
from extensions.dblink_get_result('race_b', false) as x(outcome text, request_id text, state text, reason_code text);
select diag(concat('reservation: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text, request_id text, state text,
  reason_code text)), 0, 'and is done');
select is((select state from reserved where session = 'b'), 'replayed',
  'the second is the same member''s identical submission: it gets the answer of the first');
select results_eq($$select a.request_id is not null, a.request_id = b.request_id from reserved a, reserved b
  where a.session = 'a' and b.session = 'b'$$, $$values (true, true)$$, 'both find the same request, named by each');
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
      'plans', jsonb_build_array(jsonb_build_object('entry_key', %4$L::uuid, 'plan_file_id', %4$L::uuid, 'pages', '[]'::jsonb)),
      'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)),
    jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', %5$L::uuid, 'confirmed_at', '2026-11-21T08:00:00Z',
      'execution_selection', %12$L::jsonb,
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
    (select page_count from public.plan_files where id = pg_temp.fx(50)), pg_temp.selection())
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
select is(extensions.dblink_exec('race_setup', format('update public.affaire_briefs set confirmed_at = clock_timestamp() where id = %L', pg_temp.fx(35))),
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

-- What the server seals for an affaire's plan (its manifest, the snapshot of the member who pays, the job), and the
-- calls of its gestures, written out for the other sessions.
create function pg_temp.seal(p_plan uuid, p_set uuid, p_job uuid, p_payer integer)
returns table (manifest jsonb, snapshot jsonb, job jsonb) language sql stable as $$
  select jsonb_build_object('format_version', 1, 'intent', 'initial',
      'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
      'units', jsonb_build_array(jsonb_build_object('key', 'grouped', 'plans', jsonb_build_array(f.id))),
      'plans', jsonb_build_array(jsonb_build_object('entry_key', f.id, 'plan_file_id', f.id, 'pages', '[]'::jsonb)),
      'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)),
    jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.fx(p_payer),
      'confirmed_at', '2026-11-21T08:00:00Z', 'execution_selection', pg_temp.selection(),
      'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
      'preparation', jsonb_build_object('schema_version', 1, 'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
        'processing', '{"level":"C","provider":"chatgpt"}'::jsonb, 'sources', jsonb_build_array(jsonb_build_object(
          'document_id', f.id, 'kind', 'plan', 'active', true, 'confirmed', true, 'plan_set_id', p_set,
          'file_path', f.file_path, 'page_count', f.page_count, 'source_updated_at', f.updated_at)))),
    jsonb_build_object('id', p_job, 'plan_set_id', p_set, 'source_file_name', f.file_name, 'source_file_type', 'application/pdf',
      'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host())
  from public.plan_files f where f.id = p_plan
$$;
create function pg_temp.relaunch_sql(p_affaire integer, p_key integer, p_job integer, p_predecessor uuid default null)
returns text language sql stable as $$
  select format($relaunch$select r.outcome, coalesce(r.request_id::text, ''), coalesce(r.job_id::text, '')
    from public.launch_manual_takeoff_request(%1$L, %2$L, %3$L, %4$L, 'reread_plans', %5$L, %6$L, %7$L::jsonb, %8$L::jsonb,
      %9$L::jsonb, %10$L::jsonb, %11$L, 1) r$relaunch$,
    pg_temp.tenant(), pg_temp.fx(p_affaire), pg_temp.fx(1), pg_temp.fx(p_key), coalesce(p_predecessor, pg_temp.fx(p_affaire + 6)),
    pg_temp.host(), pg_temp.selection(), s.manifest, s.snapshot, s.job, pg_temp.fx(p_affaire + 4))
  from pg_temp.seal(pg_temp.fx(p_affaire + 5), pg_temp.fx(p_affaire + 4), pg_temp.fx(p_job), 1) s
$$;
create function pg_temp.automatic(p_affaire integer) returns public.takeoff_launch_requests language sql stable as $$
  select * from public.takeoff_launch_requests where project_id = pg_temp.fx(p_affaire) and origin = 'automatic'
$$;
create function pg_temp.take_on_sql(p_affaire integer, p_member integer, p_seen integer) returns text language sql stable as $$
  select format($take$select t.outcome, coalesce(t.payer_id::text, ''), t.mandate_revision
    from public.take_on_takeoff_launch_request(%1$L, %2$L, %3$L, %4$L, %5$s, 'take_on', %6$L, %7$L::jsonb, null) t$take$,
    pg_temp.tenant(), pg_temp.fx(p_affaire), pg_temp.fx(p_member), (pg_temp.automatic(p_affaire)).id, p_seen, pg_temp.host(),
    pg_temp.selection())
$$;

-- 5. A confirmation and a relaunch of one affaire at the same time. First order: the confirmation's transaction is open
-- when the relaunch arrives (red when the request was reserved by a call after the brief's commit: the relaunch found
-- no automatic request, ran, and the late reservation was admitted once it ended, a second paid analysis). Since
-- 20261121193413 the relaunch that finds the automatic start able to begin is refused: that start is taken on instead.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a member confirms the brief of a second affaire');
select is((select x.outcome || ':' || x.state from extensions.dblink('race_a', pg_temp.confirm_sql(pg_temp.fx(110), 1))
  as x(outcome text, request_id text, state text, reason_code text)), 'confirmed:evaluating',
  'the confirmation reserves and mandates its request, not yet committed');
create temp table relaunch_sql as select pg_temp.relaunch_sql(110, 117, 118) as body;
select is(extensions.dblink_send_query('race_b', (select body from relaunch_sql)), 1, 'a relaunch of the affaire arrives meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the relaunch waits for the confirmation');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the confirmation commits');
select ok(pg_temp.answered('race_b'), 'the relaunch answers');
create temp table relaunched as select x.outcome from extensions.dblink_get_result('race_b', false)
  as x(outcome text, request_id text, job_id text);
select diag(concat('relaunch: ', extensions.dblink_error_message('race_b')));
select ok(extensions.dblink_error_message('race_b') ~ 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING', 'by name: the start can still begin');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text, request_id text, job_id text)),
  0, 'and is done');
select is((select count(*)::integer from relaunched), 0, 'the relaunch is refused');
select results_eq($$select (pg_temp.automatic(110)).state, (pg_temp.automatic(110)).reason_code$$,
  $$values ('evaluating'::text, null::text)$$, 'it found the reserved automatic request and left it to start: it never sets it aside');
select is((select count(*)::integer from public.takeoff_jobs where project_id = pg_temp.fx(110) and launch_request_id is not null), 0,
  'the relaunch paid nothing');

-- The other order: the relaunch's transaction is open when the confirmation arrives.
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'a relaunch of a third affaire starts');
select is((select x.outcome from extensions.dblink('race_b', pg_temp.relaunch_sql(120, 127, 128))
  as x(outcome text, request_id text, job_id text)), 'admitted', 'it is admitted, not yet committed');
create temp table confirmation_after_sql as select pg_temp.confirm_sql(pg_temp.fx(120), 1) as body;
select is(extensions.dblink_send_query('race_a', (select body from confirmation_after_sql)), 1, 'a confirmation arrives meanwhile');
select ok(pg_temp.waits_for('race_a', 'race_b'), 'the confirmation waits for the relaunch');
select is(extensions.dblink_exec('race_b', 'commit'), 'COMMIT', 'the relaunch commits');
select ok(pg_temp.answered('race_a'), 'the confirmation answers');
create temp table confirmed_after as select x.outcome, x.state, x.reason_code from extensions.dblink_get_result('race_a', false)
  as x(outcome text, request_id text, state text, reason_code text);
select diag(concat('confirmation: ', extensions.dblink_error_message('race_a')));
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false)
  as x(outcome text, request_id text, state text, reason_code text)), 0, 'and is done');
select results_eq($$select outcome, state, reason_code from confirmed_after$$,
  $$values ('confirmed'::text, 'superseded'::text, ''::text)$$,
  'the brief is confirmed and its automatic request is reserved already set aside by the relaunch');
select is((select count(*)::integer from public.takeoff_jobs where project_id = pg_temp.fx(120) and launch_request_id is not null), 1,
  'one analysis is paid');

-- 6. Two operators take the same request on from the same view (red when the mandate was overwritten by the second).
select is((select x.outcome || ':' || x.reason_code from extensions.dblink('race_setup', pg_temp.confirm_sql(pg_temp.fx(130), 1, false))
  as x(outcome text, request_id text, state text, reason_code text)), 'confirmed:MANDATE_REQUIRED',
  'a fourth affaire is confirmed without the payer notice: its request waits for a gesture');
create temp table take_on_sql as select pg_temp.take_on_sql(130, 2, 0) as first, pg_temp.take_on_sql(130, 3, 0) as second;
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'an administrator takes it on');
select is((select x.outcome from extensions.dblink('race_a', (select first from take_on_sql))
  as x(outcome text, payer_id text, mandate_revision integer)), 'mandated', 'with their subscription, not yet committed');
select is(extensions.dblink_send_query('race_b', (select second from take_on_sql)), 1, 'another administrator, from the same view');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second gesture waits for the first');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
create temp table taken_second as select x.outcome, x.payer_id from extensions.dblink_get_result('race_b', false)
  as x(outcome text, payer_id text, mandate_revision integer);
select diag(concat('take-over: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false)
  as x(outcome text, payer_id text, mandate_revision integer)), 0, 'and is done');
select results_eq($$select outcome, payer_id from taken_second$$, $$values ('moved'::text, pg_temp.fx(2)::text)$$,
  'the second gesture saw a mandate that moved: it is refused');
select results_eq($$select (pg_temp.automatic(130)).payer_id, (pg_temp.automatic(130)).mandate_revision$$,
  $$values (pg_temp.fx(2), 1)$$, 'the first mandate stays');

-- 7. A dossier change committed after the admission counted the dossier (red when the admission compared its count and
-- committed: the job ran against a dossier back in classification).
select is((select x.outcome || ':' || x.state from extensions.dblink('race_setup', pg_temp.confirm_sql(pg_temp.fx(140), 1))
  as x(outcome text, request_id text, state text, reason_code text)), 'confirmed:evaluating', 'a fifth affaire is confirmed and mandated');
delete from race_claim;
insert into race_claim select x.request_id::uuid, x.mark from extensions.dblink('race_a', format(
  'select request_id::text, mark from public.claim_takeoff_launch_evaluations(%L, %L, 20)', pg_temp.host(), pg_temp.fx(96)))
  as x(request_id text, mark bigint) where x.request_id::uuid = (pg_temp.automatic(140)).id;
select is((select count(*)::integer from race_claim), 1, 'the Mac claims it and reads the dossier''s position');
create temp table late_admit_sql as select format($admit$select outcome || ':' || coalesce(job_id::text, '')
  from public.admit_takeoff_launch_request(%1$L, %2$L, %3$s, %4$L::jsonb, %5$L::jsonb, %6$L::jsonb)$admit$,
  (select request_id from race_claim), pg_temp.fx(96), (select mark from race_claim), s.manifest, s.snapshot, s.job) as body
from pg_temp.seal(pg_temp.fx(145), pg_temp.fx(144), pg_temp.fx(148), 1) s;
select is(extensions.dblink_exec('race_writer', 'begin'), 'BEGIN', 'a member sends an annex of the dossier back to classification');
select is(extensions.dblink_exec('race_writer', format($annex$update public.affaire_intake_documents set classification_status = 'processing'
  where id = %L$annex$, pg_temp.fx(143))), 'UPDATE 1', 'the change is written, not yet committed: the admission does not count it');
select is(extensions.dblink_send_query('race_a', (select body from late_admit_sql)), 1, 'the Mac admits the request meanwhile');
select ok(pg_temp.waits_for('race_a', 'race_writer'), 'the admission''s final comparison waits for the change');
select is(extensions.dblink_exec('race_writer', 'commit'), 'COMMIT', 'the change commits');
select ok(pg_temp.answered('race_a'), 'the admission answers');
create temp table late_admitted as select x.answer from extensions.dblink_get_result('race_a', false) as x(answer text);
select diag(concat('late admission: ', extensions.dblink_error_message('race_a')));
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(answer text)), 0, 'and is done');
select is((select answer from late_admitted), 'stale:', 'it counts the change and admits nothing');
select is((select count(*)::integer from public.takeoff_jobs where project_id = pg_temp.fx(140)), 0, 'no job exists');
select is((pg_temp.automatic(140)).state, 'evaluating', 'the request waits for a new evaluation');

-- 8. The automatic analysis of the fifth affaire is admitted; its worker holds its job while a relaunch of it is refused
-- (red when the refusal was a request row whose foreign key waited for that job while it held the automatic request
-- the worker's end needs: a deadlock).
delete from race_claim;
insert into race_claim select x.request_id::uuid, x.mark from extensions.dblink('race_a', format(
  'select request_id::text, mark from public.claim_takeoff_launch_evaluations(%L, %L, 20)', pg_temp.host(), pg_temp.fx(97)))
  as x(request_id text, mark bigint) where x.request_id::uuid = (pg_temp.automatic(140)).id;
select is((select x.answer from pg_temp.seal(pg_temp.fx(145), pg_temp.fx(144), pg_temp.fx(149), 1) s
  cross join lateral extensions.dblink('race_a', format($admit$select outcome || ':' || coalesce(job_id::text, '')
  from public.admit_takeoff_launch_request(%1$L, %2$L, %3$s, %4$L::jsonb, %5$L::jsonb, %6$L::jsonb)$admit$,
  (select request_id from race_claim), pg_temp.fx(97), (select mark from race_claim), s.manifest, s.snapshot, s.job))
  as x(answer text)),
  'admitted:' || pg_temp.fx(149), 'the automatic analysis is admitted with its job');
select is(extensions.dblink_exec('race_writer', 'begin'), 'BEGIN', 'the worker starts ending that job');
select is((select x.locked from extensions.dblink('race_writer', format('select id::text from public.takeoff_jobs where id = %L for update',
  pg_temp.fx(149))) as x(locked text)), pg_temp.fx(149)::text, 'it holds the job');
create temp table refused_sql as select pg_temp.relaunch_sql(140, 147, 146, pg_temp.fx(149)) as body;
select is(extensions.dblink_send_query('race_b', (select body from refused_sql)), 1, 'a relaunch of that analysis arrives meanwhile');
select ok(pg_temp.answered('race_b'), 'the relaunch answers without waiting for the worker''s job');
create temp table refused as select x.outcome, x.job_id from extensions.dblink_get_result('race_b', false)
  as x(outcome text, request_id text, job_id text);
select diag(concat('refused relaunch: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text, request_id text, job_id text)),
  0, 'and is done');
select results_eq($$select outcome, job_id from refused$$, $$values ('already_running'::text, pg_temp.fx(149)::text)$$,
  'it is refused with the analysis it found running');
select is(extensions.dblink_exec('race_writer', format($end$update public.takeoff_jobs set status = 'failed', error_code = 'TAKEOFF_WORKER_NOT_STARTED',
  error_message = 'Fin fictive', analysis_outcome = 'failure', completed_at = clock_timestamp(), next_retry_at = null where id = %L$end$,
  pg_temp.fx(149))), 'UPDATE 1', 'the worker records the job''s end, which closes its request');
select is(extensions.dblink_exec('race_writer', 'commit'), 'COMMIT', 'and commits: nothing deadlocked');
select is((pg_temp.automatic(140)).state, 'closed', 'the automatic request is closed');

-- Clean the committed synthetic fixtures and the cut-offs.
select is(extensions.dblink_exec('race_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid;
  entry record;
begin
  for target in select distinct m.tenant_id from public.tenant_memberships m
    where m.user_id::text like 'd4900000-0000-4000-8000-00000000000_'
  loop
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
delete from private.takeoff_launch_activation;
delete from private.takeoff_completion_activation;
delete from public.profiles where id::text like 'd4900000-0000-4000-8000-00000000000_';
delete from auth.users where id::text like 'd4900000-0000-4000-8000-00000000000_';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures and the cut-offs cleaned');
select is((select count(*)::integer from private.takeoff_launch_activation), 0, 'the database is left without a cut-off');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('race_setup'), ('race_writer'), ('race_a'), ('race_b')) as session(name);
select * from finish();
rollback;
