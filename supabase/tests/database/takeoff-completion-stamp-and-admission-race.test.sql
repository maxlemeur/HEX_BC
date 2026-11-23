-- Lot 2, end-of-analysis notices (migration 20261121020321_takeoff_completion_before_activation.sql). Two writes of
-- two jobs of one Mac never wait on each other because of the stamp of the Mac's work, which does not exist before
-- activation; and the recovery does not judge a tenant's admission while an admission of that tenant is in flight.
-- Isolation justified: an uncommitted renewal and an uncommitted admission interleave only across sessions, which no
-- journey drives deterministically. Each first write is stopped before its commit, never slept on.
-- All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create temp table stamp_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect(session.name, (select connection from stamp_race_connection)), 'OK', format('%s connected', session.name))
from (values ('stamp_setup'), ('stamp_first'), ('stamp_second')) as session(name);

-- One engineer, one draft, two jobs under lease on one Mac, a third pending.
select is(extensions.dblink_exec('stamp_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'c6f00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'stamp-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'c6f00000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Écritures d’un Mac (fictif)', false
from public.tenant_memberships m where m.user_id = 'c6f00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select 'c6f00000-0000-4000-8000-000000000011', m.tenant_id, 'c6f00000-0000-4000-8000-000000000010', 1, 'draft', 2, 1, 0
from public.tenant_memberships m where m.user_id = 'c6f00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select job.id, m.tenant_id, 'c6f00000-0000-4000-8000-000000000011', 'A', m.user_id, 'chatgpt_local',
  'urn:uuid:c6f00000-0000-4000-8000-000000000099'
from public.tenant_memberships m cross join (values ('c6f00000-0000-4000-8000-000000000021'::uuid),
  ('c6f00000-0000-4000-8000-000000000022'::uuid), ('c6f00000-0000-4000-8000-000000000023'::uuid)) as job(id)
where m.user_id = 'c6f00000-0000-4000-8000-000000000001' and m.is_default;
select count(*) from (values ('c6f00000-0000-4000-8000-000000000021'::uuid, 'eeeeeeee-0000-4000-8000-000000000021'::uuid),
  ('c6f00000-0000-4000-8000-000000000022'::uuid, 'eeeeeeee-0000-4000-8000-000000000022'::uuid)) as job(id, token)
cross join public.tenant_memberships m
cross join lateral public.claim_observed_local_takeoff_job(job.id, m.tenant_id,
  'urn:uuid:c6f00000-0000-4000-8000-000000000099', now(), job.token, now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)
where m.user_id = 'c6f00000-0000-4000-8000-000000000001' and m.is_default;
commit;
$setup$), 'COMMIT', 'fixtures committed');

create function pg_temp.renew(p_job uuid, p_token uuid) returns text language sql as $$
  select format('select public.renew_takeoff_processing_lease(%L, (select tenant_id from public.takeoff_jobs where id = %L), %L,
    clock_timestamp(), clock_timestamp() + interval ''1 hour'')::text', p_job, p_job, p_token);
$$;
select is(extensions.dblink_exec(session.name, 'set role service_role'), 'SET', format('%s writes as the worker', session.name))
from (values ('stamp_first'), ('stamp_second')) as session(name);
select is(extensions.dblink_exec('stamp_second', 'set statement_timeout = ''2s'''), 'SET',
  'the second writer gives up after two seconds');

-- 1. The cutoff unset: the first job's renewal is open; the second job's renewal and end do not wait for it.
select is(extensions.dblink_exec('stamp_first', 'begin'), 'BEGIN', 'the first writer opens its transaction');
select is((select x.renewed from extensions.dblink('stamp_first',
  pg_temp.renew('c6f00000-0000-4000-8000-000000000021', 'eeeeeeee-0000-4000-8000-000000000021')) as x(renewed text)),
  'true', 'the first job''s lease is renewed, not yet committed');
select is((select x.renewed from extensions.dblink('stamp_second',
  pg_temp.renew('c6f00000-0000-4000-8000-000000000022', 'eeeeeeee-0000-4000-8000-000000000022'), false) as x(renewed text)),
  'true', 'before activation the second job''s renewal does not wait for the first');
select is(extensions.dblink_exec('stamp_first', 'commit'), 'COMMIT', 'the first writer commits');
select is((select count(*)::integer from private.takeoff_local_host_activity
  where host_id = 'urn:uuid:c6f00000-0000-4000-8000-000000000099'), 0, 'before activation no job write touches the Mac''s activity');

-- 2. The cutoff set: the same two writes, and the second job's end, still do not wait on each other.
select is(extensions.dblink_exec('stamp_setup', $activate$
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour')
$activate$), 'INSERT 0 1', 'the cutoff is set');
select is(extensions.dblink_exec('stamp_first', 'begin'), 'BEGIN', 'the first writer opens its transaction again');
select is((select x.renewed from extensions.dblink('stamp_first',
  pg_temp.renew('c6f00000-0000-4000-8000-000000000021', 'eeeeeeee-0000-4000-8000-000000000021')) as x(renewed text)),
  'true', 'the first job''s lease is renewed and its work stamped, not yet committed');
select is((select x.renewed from extensions.dblink('stamp_second',
  pg_temp.renew('c6f00000-0000-4000-8000-000000000022', 'eeeeeeee-0000-4000-8000-000000000022'), false) as x(renewed text)),
  'true', 'after activation the second job''s renewal does not wait for the first');
select is((select x.ended from extensions.dblink('stamp_second', $end$
  select (public.record_local_takeoff_failure('c6f00000-0000-4000-8000-000000000022',
    (select tenant_id from public.takeoff_jobs where id = 'c6f00000-0000-4000-8000-000000000022'),
    'eeeeeeee-0000-4000-8000-000000000022', jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5,
      'error_code', 'AI_TIMEOUT', 'error_message', 'Délai fictif dépassé', 'analysis_outcome', null,
      'last_error_at', clock_timestamp(), 'next_retry_at', clock_timestamp() + interval '1 minute')) is not null)::text
$end$, false) as x(ended text)), 'true', 'nor does its end');
select is(extensions.dblink_exec('stamp_first', 'commit'), 'COMMIT', 'the first writer commits');
select is((select count(*)::integer from private.takeoff_local_job_work
  where host_id = 'urn:uuid:c6f00000-0000-4000-8000-000000000099' and worked_at > now() - interval '1 minute'), 2,
  'after activation each job''s work is stamped on a row of its own');

-- 3. An admission of the tenant is in flight: the recovery does not decide on that tenant's limits.
-- The second job's retry is due on a Mac live and idle for hours, as if the stamps above were old; the member has
-- five active jobs, and a sixth is being admitted.
select is(extensions.dblink_exec('stamp_setup', $idle$
begin;
update public.takeoff_jobs set status = 'failed', error_code = 'AI_TIMEOUT', next_retry_at = clock_timestamp() - interval '1 hour',
  processing_lease_token = null, processing_lease_expires_at = null
where id = 'c6f00000-0000-4000-8000-000000000022';
update public.takeoff_jobs set status = 'canceled' where id = 'c6f00000-0000-4000-8000-000000000021';
insert into private.takeoff_local_host_activity as a (host_id, live_since, seen_at)
values ('urn:uuid:c6f00000-0000-4000-8000-000000000099', now() - interval '6 hours', now())
on conflict (host_id) do update set live_since = excluded.live_since, seen_at = excluded.seen_at;
update private.takeoff_local_job_work set worked_at = now() - interval '6 hours'
where host_id = 'urn:uuid:c6f00000-0000-4000-8000-000000000099';
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select job.id, m.tenant_id, 'c6f00000-0000-4000-8000-000000000011', 'A', m.user_id, 'chatgpt_local',
  'urn:uuid:c6f00000-0000-4000-8000-000000000098'
from public.tenant_memberships m cross join (values ('c6f00000-0000-4000-8000-000000000031'::uuid),
  ('c6f00000-0000-4000-8000-000000000032'::uuid), ('c6f00000-0000-4000-8000-000000000033'::uuid),
  ('c6f00000-0000-4000-8000-000000000034'::uuid)) as job(id)
where m.user_id = 'c6f00000-0000-4000-8000-000000000001' and m.is_default;
update public.takeoff_jobs set created_at = clock_timestamp() where execution_host_id = 'urn:uuid:c6f00000-0000-4000-8000-000000000098';
commit;
$idle$), 'COMMIT', 'the retry is due and the member has five active jobs');
select is(extensions.dblink_exec('stamp_first', 'reset role'), 'RESET', 'the first session writes as the application');
select is(extensions.dblink_exec('stamp_first', 'begin'), 'BEGIN', 'an admission opens');
select is(extensions.dblink_exec('stamp_first', $admit$
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select 'c6f00000-0000-4000-8000-000000000035', m.tenant_id, 'c6f00000-0000-4000-8000-000000000011', 'A', m.user_id,
  'chatgpt_local', 'urn:uuid:c6f00000-0000-4000-8000-000000000098'
from public.tenant_memberships m where m.user_id = 'c6f00000-0000-4000-8000-000000000001' and m.is_default
$admit$), 'INSERT 0 1', 'the sixth active job is admitted, not yet committed');
select is(extensions.dblink_exec('stamp_second', 'reset statement_timeout'), 'RESET', 'the recovery may wait');
select is((select array_agg(x.job_id) from extensions.dblink('stamp_second',
  'select job_id from public.recover_stale_local_takeoff_jobs(clock_timestamp())') as x(job_id uuid)), null::uuid[],
  'while the admission is in flight, the due retry is waiting its turn');
select is(extensions.dblink_exec('stamp_first', 'commit'), 'COMMIT', 'the admission commits');
select is((select array_agg(x.job_id) from extensions.dblink('stamp_second',
  'select job_id from public.recover_stale_local_takeoff_jobs(clock_timestamp())') as x(job_id uuid)), null::uuid[],
  'with six active jobs, the retry still waits: a claim would be refused');
select is((select status::text from public.takeoff_jobs where id = 'c6f00000-0000-4000-8000-000000000022'), 'failed',
  'the retry is still scheduled');
select is((select analysis_outcome from public.takeoff_jobs where id = 'c6f00000-0000-4000-8000-000000000022'), null,
  'and has no end');

-- Clean the committed synthetic fixtures, as takeoff-failure-diagnostic-lock-race.test.sql does, and the cutoff row.
select is(extensions.dblink_exec('stamp_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'c6f00000-0000-4000-8000-000000000001' and is_default);
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
delete from private.takeoff_local_host_activity where host_id like 'urn:uuid:c6f00000-0000-4000-8000-0000000000__';
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'c6f00000-0000-4000-8000-000000000001';
delete from auth.users where id = 'c6f00000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures and the cutoff cleaned');
select is((select count(*)::integer from private.takeoff_completion_activation), 0, 'the database is left without a cutoff');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('stamp_setup'), ('stamp_first'), ('stamp_second')) as session(name);
select * from finish();
rollback;
