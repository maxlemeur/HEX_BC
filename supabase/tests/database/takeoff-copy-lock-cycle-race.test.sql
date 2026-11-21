-- Lot 2, M4 (20261121111238_takeoff_launch_requests.sql): « Dupliquer » against the end of an analysis, with the
-- end-of-analysis notices activated. The copy holds the affaire and then locks each job it carries; the worker ending one
-- of those jobs holds its row and inserts its notice, whose foreign key needs a key-share lock on the affaire. Here the
-- worker holds the job (as its ending functions lock it first), the copy waits for it, and the worker ends the job: the
-- worker's notice does not wait for the copy, the worker commits, and the copy then completes and carries the job (red
-- before M4: the copy held the affaire FOR UPDATE, the notice's foreign key waited for it, and one of the two was
-- aborted as a deadlock).
-- Isolation justified: this interleaving exists only across two sessions, which no journey drives deterministically.
-- The held transaction is stopped at a named point; the waits are bounded conditions. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();
-- M4 patched exactly the definition main left (its guard stops on any other source): only its affaire lock changed.
select is((select md5(p.prosrc) from pg_catalog.pg_proc p
  where p.oid = 'public.duplicate_estimate_version_without_product_id(uuid,boolean)'::regprocedure),
  'f8fdd1470e774fe76e6d020fa989bac8', 'the copy is main''s definition with its affaire held FOR NO KEY UPDATE');

create function pg_temp.fx(n integer) returns uuid language sql immutable as $$
  select ('d4800000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create temp table cycle_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- cycle_setup writes the fixtures as the owner; cycle_worker is the Mac's worker; cycle_copy is the engineer's « Dupliquer ».
select is(extensions.dblink_connect(session.name, (select connection from cycle_connection)), 'OK', format('%s connected', session.name))
from (values ('cycle_setup'), ('cycle_worker'), ('cycle_copy')) as session(name);

select is(extensions.dblink_exec('cycle_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd4800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'copy-cycle@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer' where user_id = 'd4800000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd4800000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Copie pendant une fin d’analyse (fictif)', false
from public.tenant_memberships m where m.user_id = 'd4800000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select 'd4800000-0000-4000-8000-000000000011', m.tenant_id, 'd4800000-0000-4000-8000-000000000010', 1, 'draft', 2, 1, 0
from public.tenant_memberships m where m.user_id = 'd4800000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select 'd4800000-0000-4000-8000-000000000021', m.tenant_id, 'd4800000-0000-4000-8000-000000000011', 'A', m.user_id, 'chatgpt_local',
  'urn:uuid:d4800000-0000-4000-8000-000000000099'
from public.tenant_memberships m where m.user_id = 'd4800000-0000-4000-8000-000000000001' and m.is_default;
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
select count(*) from public.tenant_memberships m
cross join lateral public.claim_observed_local_takeoff_job('d4800000-0000-4000-8000-000000000021', m.tenant_id,
  'urn:uuid:d4800000-0000-4000-8000-000000000099', now(), 'eeeeeeee-0000-4000-8000-000000000021', now() + interval '1 hour',
  'fixture', 'fixture', 'pending', 0)
where m.user_id = 'd4800000-0000-4000-8000-000000000001' and m.is_default;
commit;
$setup$), 'COMMIT', 'a draft with an analysis under way on the Mac, the notices activated');
select is((select status::text from public.takeoff_jobs where id = pg_temp.fx(21)), 'processing', 'the analysis is under way');

create temp table cycle_pids(label text primary key, pid integer);
insert into cycle_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('cycle_worker'), ('cycle_copy')) as session(name);
create function pg_temp.waits_for(p_waiting text, p_holding text) returns boolean language plpgsql as $$
declare
  waiting integer := (select pid from cycle_pids where label = p_waiting);
  holding integer := (select pid from cycle_pids where label = p_holding);
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

select is(extensions.dblink_exec('cycle_worker', 'set role service_role'), 'SET', 'the worker writes as the service role');
select is(extensions.dblink_exec('cycle_copy', format('set request.jwt.claim.sub = %L', pg_temp.fx(1))), 'SET',
  'the engineer is signed in');
select is(extensions.dblink_exec('cycle_copy', format('set request.jwt.claims = %L',
  jsonb_build_object('role', 'authenticated', 'sub', pg_temp.fx(1))::text)), 'SET', 'with their claims');
select is(extensions.dblink_exec('cycle_copy', 'set role authenticated'), 'SET', 'the copy runs as the engineer');

-- The worker's ending functions lock the job's row first.
select is(extensions.dblink_exec('cycle_worker', 'begin'), 'BEGIN', 'the worker starts the end of the analysis');
select is((select count(*)::integer from extensions.dblink('cycle_worker', format(
  'select 1 from public.takeoff_jobs where id = %L for update', pg_temp.fx(21))) as x(one integer)), 1, 'it holds the job');
select is(extensions.dblink_send_query('cycle_copy', format('select public.duplicate_estimate_version(%L, false)::text', pg_temp.fx(11))),
  1, 'the engineer duplicates the draft');
select ok(pg_temp.waits_for('cycle_copy', 'cycle_worker'), 'the copy holds the affaire and waits for the job it carries');

-- The worker records the definitive failure: the job's end and its notice, in the same transaction.
select is(extensions.dblink_send_query('cycle_worker', format($end$
  select (public.record_local_takeoff_failure(%L, (select tenant_id from public.takeoff_jobs where id = %L),
    'eeeeeeee-0000-4000-8000-000000000021', jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5,
      'error_code', 'AI_PROVIDER', 'error_message', 'Échec fictif', 'analysis_outcome', 'failure',
      'last_error_at', clock_timestamp())) is not null)::text
$end$, pg_temp.fx(21), pg_temp.fx(21))), 1, 'the worker ends the analysis');
select ok(pg_temp.answered('cycle_worker'), 'the end of the analysis does not wait for the copy');
select is((select x.ended from extensions.dblink_get_result('cycle_worker', false) as x(ended text)), 'true',
  'the end is recorded, its notice included');
select diag(concat('worker: ', extensions.dblink_error_message('cycle_worker'), '; copy: ', extensions.dblink_error_message('cycle_copy')));
select is((select count(*)::integer from extensions.dblink_get_result('cycle_worker', false) as x(ended text)), 0, 'the worker is done');
select is(extensions.dblink_exec('cycle_worker', 'commit'), 'COMMIT', 'the worker commits');
select ok(pg_temp.answered('cycle_copy'), 'the copy then completes');
create temp table copied as select x.version_id::uuid as version_id
from extensions.dblink_get_result('cycle_copy', false) as x(version_id text);
select diag(concat('copy: ', extensions.dblink_error_message('cycle_copy')));
select is((select count(*)::integer from copied where version_id is not null), 1, 'the copy created its version: no deadlock');
select is((select count(*)::integer from extensions.dblink_get_result('cycle_copy', false) as x(version_id text)), 0, 'the copy is done');

select results_eq($$select status::text, analysis_outcome from public.takeoff_jobs where id = pg_temp.fx(21)$$,
  $$values ('failed'::text, 'failure'::text)$$, 'the job''s end is recorded');
select is((select count(*)::integer from public.takeoff_completion_notifications where job_id = pg_temp.fx(21)), 1,
  'its one notice is published');
select is((select count(*)::integer from public.takeoff_version_links where takeoff_job_id = pg_temp.fx(21)
  and target_version_id = (select version_id from copied)), 1, 'the copy carries the job, as before');

-- Clean the committed synthetic fixtures and the cut-off, as takeoff-completion-stamp-and-admission-race.test.sql does.
select is(extensions.dblink_exec('cycle_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'd4800000-0000-4000-8000-000000000001' and is_default);
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
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'd4800000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd4800000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures and the cut-off cleaned');
select is((select count(*)::integer from private.takeoff_completion_activation), 0, 'the database is left without a cut-off');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('cycle_setup'), ('cycle_worker'), ('cycle_copy')) as session(name);
select * from finish();
rollback;
