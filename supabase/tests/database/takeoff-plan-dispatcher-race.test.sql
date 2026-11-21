-- Lot 3, migration A (20261121181031_takeoff_plan_dispatcher.sql): one analysis per plan across sessions.
-- 1. Two processes of one Mac claim two units at the same time: the second waits for the Mac's lock, then finds the Mac
--    busy and starts nothing. One plan is read at a time.
-- 2. The end of a unit and the cancellation of the last one at the same time: the second waits for the request's row,
--    then closes the request; one notice.
-- 3. A member's stop while the worker ends a unit: the stop waits for that unit's row, then cancels the rest; the read
--    plan stays read, and nobody waits for the other (the jobs, then the request, for both).
-- 4. A worker's reservation while the stop holds the request's units: it waits, then is refused (its unit is
--    cancelled): no call is reserved after the stop.
-- Isolation justified: these interleavings exist only across sessions, which no journey drives deterministically. Each
-- held transaction is stopped at a named point; the waits are bounded conditions. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5200000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create temp table race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- race_setup writes and commits the fixtures; race_a and race_b are two processes of the server and its members.
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);

select is(extensions.dblink_exec('race_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd5200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'plan-race-1@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer' where user_id = 'd5200000-0000-4000-8000-000000000001';
update public.feature_flags set enabled = true where flag_key = 'TAKEOFF_MODULE_ENABLED' and tenant_id = (select m.tenant_id
  from public.tenant_memberships m where m.user_id = 'd5200000-0000-4000-8000-000000000001' and m.is_default);
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 hour');
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select ('d5200000-0000-4000-8000-0000000000' || (20 + n))::uuid, m.tenant_id, m.user_id, 'Affaire par plan en concurrence ' || n || ' (fictive)', false
from public.tenant_memberships m cross join generate_series(0, 2) as n
where m.user_id = 'd5200000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select ('d5200000-0000-4000-8000-0000000000' || (30 + n))::uuid, ('d5200000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  'd5200000-0000-4000-8000-000000000001', 'ready' from generate_series(0, 2) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select ('d5200000-0000-4000-8000-0000000000' || (60 + n))::uuid, ('d5200000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  ('d5200000-0000-4000-8000-0000000000' || (30 + n))::uuid, 'confirme', 'Résumé fictif', 'Objet fictif', now(),
  'd5200000-0000-4000-8000-000000000001' from generate_series(0, 2) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select ('d5200000-0000-4000-8000-0000000000' || (40 + n))::uuid, p.tenant_id, p.id, 'Plans du dossier'
from generate_series(0, 2) as n join public.estimate_projects p on p.id = ('d5200000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select ('d5200000-0000-4000-8000-000000000' || (100 + 10 * n + k))::uuid, s.tenant_id, s.id, 'plan-' || k || '.pdf',
  concat_ws('/', s.tenant_id, s.id, ('d5200000-0000-4000-8000-000000000' || (100 + 10 * n + k))::uuid, 'plan-' || k || '.pdf'),
  'application/pdf', 8, 1
from generate_series(0, 2) as n cross join generate_series(1, 3) as k
join public.plan_sets s on s.id = ('d5200000-0000-4000-8000-0000000000' || (40 + n))::uuid;
commit;
$setup$), 'COMMIT', 'three affaires of three plans each, with the activations');

create function pg_temp.tenant() returns uuid language sql stable as $$
  select tenant_id from public.estimate_projects where id = pg_temp.f(20)
$$;
create function pg_temp.unit(project integer, ordinal integer) returns uuid language sql immutable as $$
  select pg_temp.f(1000 + 10 * project + ordinal)
$$;
-- The command of a request of the affaire's three plans (units in name order, which here is identifier order).
create function pg_temp.launch_sql(project integer) returns text language sql stable as $$
  with plans as (
    select f.id, f.file_name, f.file_path, f.page_count, f.updated_at, row_number() over (order by f.file_name, f.id) as ordinal
    from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)
  )
  select format($launch$select outcome from public.launch_manual_takeoff_plan_request(%L, %L, %L, %L, 'initial', null, %L, %L::jsonb,
    %L::jsonb, %L::jsonb, %L::jsonb, %L, 1, %L::uuid[])$launch$,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), pg_temp.f(500 + project), pg_temp.host(), pg_temp.selection(),
    jsonb_build_object('format_version', 2, 'intent', 'initial',
      'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
      'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
      'units', (select jsonb_agg(jsonb_build_object('key', 'plan:' || p.id, 'ordinal', p.ordinal, 'plans', jsonb_build_array(p.id),
        'pages', '[]'::jsonb, 'page_count', 1, 'vector_pages', 0, 'budget', jsonb_build_object('tokens', 133334, 'cost_cents', 834))
        order by p.ordinal) from plans p),
      'plans', (select jsonb_agg(jsonb_build_object('entry_key', p.id, 'plan_file_id', p.id, 'name', p.file_name, 'pages', '[]'::jsonb)
        order by p.ordinal) from plans p),
      'coverage', jsonb_build_object('plans_retained', 3, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
      'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)),
    jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
      'confirmed_at', '2026-11-21T08:00:00Z', 'execution_selection', pg_temp.selection(),
      'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
      'preparation', jsonb_build_object('schema_version', 1,
        'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
        'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
        'sources', (select jsonb_agg(jsonb_build_object('document_id', p.id, 'document_name', p.file_name, 'kind', 'plan', 'active', true,
          'confirmed', true, 'plan_set_id', pg_temp.f(project + 20), 'file_path', p.file_path, 'page_count', p.page_count,
          'source_updated_at', p.updated_at, 'pages', '[]'::jsonb) order by p.id) from plans p))),
    (select jsonb_agg(jsonb_build_object('id', pg_temp.unit(project, p.ordinal::integer), 'plan_set_id', pg_temp.f(project + 20),
      'launch_unit_key', 'plan:' || p.id, 'source_file_name', p.file_name, 'source_file_type', 'application/pdf',
      'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host()) order by p.ordinal) from plans p),
    pg_temp.f(project + 20), (select array_agg(p.id) from plans p))
$$;
create function pg_temp.request(project integer) returns uuid language sql stable as $$
  -- The command's request (the brief, confirmed after activation, also reserved an automatic start the command set aside).
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(project) and origin = 'manual'
$$;
create function pg_temp.claim_sql(job uuid, token integer) returns text language sql stable as $$
  select format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L, clock_timestamp(), %L,
    clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)$claim$,
    job, pg_temp.tenant(), pg_temp.host(), pg_temp.f(token))
$$;
create function pg_temp.reserve_sql(job uuid, token integer, call text) returns text language sql immutable as $$
  select format($reserve$select outcome from public.reserve_takeoff_launch_call(%L, %L, %L, 'pdf', 30000)$reserve$,
    job, pg_temp.f(token), call)
$$;
create function pg_temp.stop_sql(project integer) returns text language sql stable as $$
  select format($stop$select outcome || ':' || request_state || ':' || canceled_units from public.stop_takeoff_launch_request(%L, %L, %L, %L)$stop$,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), pg_temp.request(project))
$$;
create function pg_temp.complete_sql(job uuid) returns text language sql immutable as $$
  select format($complete$update public.takeoff_jobs set status = 'completed', completed_at = clock_timestamp()
    where id = %L and status = 'processing'$complete$, job)
$$;
create function pg_temp.cancel_sql(job uuid) returns text language sql immutable as $$
  select format($cancel$update public.takeoff_jobs set status = 'canceled', completed_at = clock_timestamp(), next_retry_at = null
    where id = %L and status in ('pending', 'processing')$cancel$, job)
$$;

select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql(project)) as x(outcome text)), 'admitted',
  format('a request of three plans on affaire %s', project)) from (values (20), (21), (22)) as affaire(project);

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

-- 1. Two processes of the Mac claim two units at the same time.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a first process starts its claim');
select is((select x.claimed from extensions.dblink('race_a', pg_temp.claim_sql(pg_temp.unit(20, 1), 901)) as x(claimed bigint)), 1::bigint,
  'it claims the first unit and takes the Mac, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.claim_sql(pg_temp.unit(20, 2), 902)), 1, 'a second process claims the second unit');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second claim waits for the Mac''s lock');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first claim commits');
select ok(pg_temp.answered('race_b'), 'the second claim answers');
select is((select x.claimed from extensions.dblink_get_result('race_b', false) as x(claimed bigint)), 0::bigint,
  'the second process starts nothing: the Mac is busy');
select diag(concat('second claim: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(claimed bigint)), 0, 'and is done');
select results_eq($$select id, status::text from public.takeoff_jobs where launch_request_id = pg_temp.request(20) order by id$$,
  $$values (pg_temp.unit(20, 1), 'processing'::text), (pg_temp.unit(20, 2), 'pending'::text), (pg_temp.unit(20, 3), 'pending'::text)$$,
  'one plan is read at a time');

-- 2. The end of a unit and the cancellation of the last one at the same time: one closure, one notice.
select is(extensions.dblink_exec('race_setup', pg_temp.complete_sql(pg_temp.unit(20, 1))), 'UPDATE 1', 'the first plan is read');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(pg_temp.unit(20, 2), 903)) as x(claimed bigint)),
  1::bigint, 'the second plan takes the Mac');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the worker ends the second plan');
select is(extensions.dblink_exec('race_a', pg_temp.complete_sql(pg_temp.unit(20, 2))), 'UPDATE 1', 'its end is written, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.cancel_sql(pg_temp.unit(20, 3))), 1, 'a member cancels the third plan meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the cancellation waits for the request''s row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the end commits');
select ok(pg_temp.answered('race_b'), 'the cancellation answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(status text)), 1, 'with its command status');
select diag(concat('cancellation: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(status text)), 0, 'and is done');
select results_eq($$select state, outcome, units_succeeded, units_canceled from public.takeoff_launch_requests where id = pg_temp.request(20)$$,
  $$values ('closed'::text, 'partial'::text, 2, 1)$$, 'the request is closed once: two plans read, one cancelled');
select is((select count(*)::integer from public.takeoff_completion_notifications where request_id = pg_temp.request(20)), 1,
  'with one notice');

-- 3. A member's stop while the worker ends a unit.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(pg_temp.unit(21, 1), 911)) as x(claimed bigint)),
  1::bigint, 'the first plan of the second request is read');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the worker ends it');
select is(extensions.dblink_exec('race_a', pg_temp.complete_sql(pg_temp.unit(21, 1))), 'UPDATE 1', 'its end is written, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.stop_sql(21)), 1, 'the operator stops the rest of the request meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the stop waits for that unit''s row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the end commits');
select ok(pg_temp.answered('race_b'), 'the stop answers');
select is((select x.answer from extensions.dblink_get_result('race_b', false) as x(answer text)), 'stopped:closed:2',
  'it cancels the two plans not read');
select diag(concat('stop: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select results_eq($$select outcome, units_succeeded, units_canceled, reason_code from public.takeoff_launch_requests
    where id = pg_temp.request(21)$$, $$values ('partial'::text, 1, 2, 'STOPPED_BY_MEMBER'::text)$$,
  'the plan read stays read; the request ends partial, stopped by a member');

-- 4. A worker's reservation while the stop holds the request's units.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(pg_temp.unit(22, 1), 921)) as x(claimed bigint)),
  1::bigint, 'the first plan of the third request is read');
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'the operator stops the request');
select is((select x.answer from extensions.dblink('race_b', pg_temp.stop_sql(22)) as x(answer text)), 'stopped:closed:3',
  'every unit is cancelled, not yet committed');
select is(extensions.dblink_send_query('race_a', pg_temp.reserve_sql(pg_temp.unit(22, 1), 921, 'call:1')), 1,
  'the worker reserves a call meanwhile');
select ok(pg_temp.waits_for('race_a', 'race_b'), 'the reservation waits for the unit''s row');
select is(extensions.dblink_exec('race_b', 'commit'), 'COMMIT', 'the stop commits');
select ok(pg_temp.answered('race_a'), 'the reservation answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(outcome text)), 0, 'with no reservation');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED%',
  'it is refused: its unit was cancelled, nothing is sent');
select is((select count(*)::integer from private.takeoff_launch_usage where request_id = pg_temp.request(22)), 0,
  'no call of the stopped request is in its ledger');

select is(extensions.dblink_exec('race_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid;
  entry record;
begin
  for target in select distinct m.tenant_id from public.tenant_memberships m where m.user_id = 'd5200000-0000-4000-8000-000000000001'
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
delete from private.takeoff_host_slots where host_id = 'urn:uuid:d5200000-0000-4000-8000-000000000099';
delete from private.takeoff_local_job_work where host_id = 'urn:uuid:d5200000-0000-4000-8000-000000000099';
delete from private.takeoff_plan_dispatch_activation;
delete from private.takeoff_launch_activation;
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'd5200000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd5200000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures, the Mac''s slot and the activations cleaned');
select is((select count(*)::integer from private.takeoff_plan_dispatch_activation), 0, 'the database is left without an activation');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);
select * from finish();
rollback;
