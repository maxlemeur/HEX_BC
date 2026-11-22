-- Lot 2, end-of-analysis notices (migration 20261121020321_takeoff_completion_before_activation.sql). The hosted
-- recovery decides that a live Mac leaves its jobs untaken while that Mac claims one of them. The decision and the
-- claim are serialized per Mac: a Mac that started something during the decision has none of its jobs closed.
-- Isolation justified: a claim committed between the recovery's reading and its update interleaves only across two
-- sessions, which no journey drives deterministically. The claim is stopped before its commit, never slept on.
-- All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create temp table host_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect(session.name, (select connection from host_race_connection)), 'OK', format('%s connected', session.name))
from (values ('host_setup'), ('host_mac'), ('host_recovery')) as session(name);

-- One engineer, one draft, two jobs pending for an hour on a Mac that has been live and idle for two hours. The
-- cutoff was set two hours ago. Nothing else of this database is activated: the row is removed at the end.
select is(extensions.dblink_exec('host_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'c5f00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'host-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'c5f00000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Décision par Mac (fictif)', false
from public.tenant_memberships m where m.user_id = 'c5f00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select 'c5f00000-0000-4000-8000-000000000011', m.tenant_id, 'c5f00000-0000-4000-8000-000000000010', 1, 'draft', 2, 1, 0
from public.tenant_memberships m where m.user_id = 'c5f00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select job.id, m.tenant_id, 'c5f00000-0000-4000-8000-000000000011', 'A', m.user_id, 'chatgpt_local',
  'urn:uuid:c5f00000-0000-4000-8000-000000000099'
from public.tenant_memberships m cross join (values ('c5f00000-0000-4000-8000-000000000021'::uuid),
  ('c5f00000-0000-4000-8000-000000000022'::uuid)) as job(id)
where m.user_id = 'c5f00000-0000-4000-8000-000000000001' and m.is_default;
update public.takeoff_jobs set created_at = now() - interval '1 hour'
where id in ('c5f00000-0000-4000-8000-000000000021', 'c5f00000-0000-4000-8000-000000000022');
insert into private.takeoff_local_host_activity (host_id, live_since, seen_at)
values ('urn:uuid:c5f00000-0000-4000-8000-000000000099', now() - interval '2 hours', now());
insert into private.takeoff_completion_activation (active_from) values (now() - interval '2 hours');
commit;
$setup$), 'COMMIT', 'fixtures committed');

create temp table host_race_pids as
select session.name, x.pid from (values ('host_mac'), ('host_recovery')) as session(name)
cross join lateral extensions.dblink(session.name, 'select pg_backend_pid()') as x(pid integer);
create function pg_temp.waits(p_name text) returns boolean language plpgsql as $f$
declare tries integer := 0;
begin
  loop
    if exists (select 1 from pg_locks l join host_race_pids p on p.pid = l.pid where p.name = p_name and not l.granted) then
      return true;
    end if;
    tries := tries + 1;
    if tries > 200000 then return false; end if;
  end loop;
end;
$f$;

-- The Mac claims the first job and stops before its commit.
select is(extensions.dblink_exec('host_mac', 'begin'), 'BEGIN', 'the Mac opens its claim');
select is(extensions.dblink_exec('host_mac', 'set local role service_role'), 'SET', 'the Mac claims as the worker');
select is((select x.claimed from extensions.dblink('host_mac', $claim$
  select count(*)::integer from public.claim_observed_local_takeoff_job('c5f00000-0000-4000-8000-000000000021',
    (select tenant_id from public.takeoff_jobs where id = 'c5f00000-0000-4000-8000-000000000021'),
    'urn:uuid:c5f00000-0000-4000-8000-000000000099', now(), 'dddddddd-0000-4000-8000-000000000021', now() + interval '1 hour',
    'fixture', 'fixture', 'pending', 0)
$claim$) as x(claimed integer)), 1, 'the Mac has claimed the first job, not yet committed');

-- The recovery decides while the claim is open, then the claim commits.
select is(extensions.dblink_exec('host_recovery', 'set role service_role'), 'SET', 'the recovery runs as the worker');
select is(extensions.dblink_send_query('host_recovery',
  'select job_id from public.recover_stale_local_takeoff_jobs(clock_timestamp())'), 1, 'the recovery is sent');
select ok(pg_temp.waits('host_recovery'), 'the recovery waits behind the open claim');
select is(extensions.dblink_exec('host_mac', 'commit'), 'COMMIT', 'the claim commits');
select is(array(select x.job_id from extensions.dblink_get_result('host_recovery') as x(job_id uuid)), '{}'::uuid[],
  'the recovery closes none of the jobs of a Mac that started work during its decision');
select count(*) from extensions.dblink_get_result('host_recovery') as x(job_id uuid);
select results_eq($$select id, status::text from public.takeoff_jobs
    where id in ('c5f00000-0000-4000-8000-000000000021', 'c5f00000-0000-4000-8000-000000000022') order by id$$,
  $$values ('c5f00000-0000-4000-8000-000000000021'::uuid, 'processing'::text),
    ('c5f00000-0000-4000-8000-000000000022'::uuid, 'pending'::text)$$,
  'the claimed job runs and its neighbour still waits its turn');

-- Clean the committed synthetic fixtures, as takeoff-failure-diagnostic-lock-race.test.sql does, and the cutoff row.
select is(extensions.dblink_exec('host_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'c5f00000-0000-4000-8000-000000000001' and is_default);
  entry record;
begin
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
end
$clean$;
delete from private.takeoff_local_host_activity where host_id = 'urn:uuid:c5f00000-0000-4000-8000-000000000099';
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'c5f00000-0000-4000-8000-000000000001';
delete from auth.users where id = 'c5f00000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures and the cutoff cleaned');
select is((select count(*)::integer from private.takeoff_completion_activation), 0, 'the database is left without a cutoff');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('host_setup'), ('host_mac'), ('host_recovery')) as session(name);
select * from finish();
rollback;
