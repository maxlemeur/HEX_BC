-- Lot 2, end-of-analysis notice (migration 20261121011212_takeoff_analysis_completion.sql). A worker records a known
-- retryable failure while another session holds the job's previous result row. The diagnostic that replaces that row
-- is best effort: it gives up on the held row, or on the caller's statement timeout, and the failure with its
-- automatic retry is recorded anyway. Isolation justified: a held row and a statement timeout interleave only across
-- two sessions, which no journey drives deterministically.
-- Written before the fix: red on 7e776ea6 (the delete waited until the statement timeout, which the diagnostic's
-- handler does not trap, and the job stayed processing without its retry).
-- All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create temp table failure_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect(session.name, (select connection from failure_race_connection)), 'OK', format('%s connected', session.name))
from (values ('failure_setup'), ('failure_hold'), ('failure_worker')) as session(name);

-- One member, one draft, two claimed local jobs that each keep a previous result.
select is(extensions.dblink_exec('failure_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'c4f00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'failure-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'c4f00000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Diagnostic retenu (fictif)', false
from public.tenant_memberships m where m.user_id = 'c4f00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select 'c4f00000-0000-4000-8000-000000000011', m.tenant_id, 'c4f00000-0000-4000-8000-000000000010', 1, 'draft', 2, 1, 0
from public.tenant_memberships m where m.user_id = 'c4f00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select job.id, m.tenant_id, 'c4f00000-0000-4000-8000-000000000011', 'A', m.user_id, 'chatgpt_local',
  'urn:uuid:c4f00000-0000-4000-8000-000000000099'
from public.tenant_memberships m cross join (values ('c4f00000-0000-4000-8000-000000000021'::uuid),
  ('c4f00000-0000-4000-8000-000000000022'::uuid)) as job(id)
where m.user_id = 'c4f00000-0000-4000-8000-000000000001' and m.is_default;
select count(*) from (values ('c4f00000-0000-4000-8000-000000000021'::uuid, 'c4f00000-0000-4000-8000-000000000031'::uuid),
  ('c4f00000-0000-4000-8000-000000000022'::uuid, 'c4f00000-0000-4000-8000-000000000032'::uuid)) as job(id, token)
cross join public.tenant_memberships m
cross join lateral public.claim_observed_local_takeoff_job(job.id, m.tenant_id,
  'urn:uuid:c4f00000-0000-4000-8000-000000000099', now(), job.token, now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)
where m.user_id = 'c4f00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_results (tenant_id, job_id, extracted_json, warnings, tables, provider_meta, token_count, cost_cents, duration_ms)
select m.tenant_id, job.id, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '{"fixture": "previous"}'::jsonb, 0, 0, 1
from public.tenant_memberships m cross join (values ('c4f00000-0000-4000-8000-000000000021'::uuid),
  ('c4f00000-0000-4000-8000-000000000022'::uuid)) as job(id)
where m.user_id = 'c4f00000-0000-4000-8000-000000000001' and m.is_default;
commit;
$setup$), 'COMMIT', 'fixtures committed');
select is((select count(*)::integer from public.takeoff_jobs where id in ('c4f00000-0000-4000-8000-000000000021',
  'c4f00000-0000-4000-8000-000000000022') and status = 'processing'), 2, 'both jobs hold a processing lease');

-- Another session holds both previous result rows, as a reader of the review would while it saves.
select is(extensions.dblink_exec('failure_hold', 'begin'), 'BEGIN', 'the holding session opens its transaction');
select is((select x.held from extensions.dblink('failure_hold', $hold$
  select count(*)::integer from (select 1 from public.takeoff_results
    where job_id in ('c4f00000-0000-4000-8000-000000000021', 'c4f00000-0000-4000-8000-000000000022') for update) as held
$hold$) as x(held integer)), 2, 'the previous result rows are held');

create function pg_temp.record_failure(p_job_id uuid, p_token uuid)
returns text language sql as $$
  select format($call$select coalesce(public.record_local_takeoff_failure(%L, (select tenant_id from public.takeoff_jobs where id = %L),
    %L, jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5, 'error_code', 'AI_TIMEOUT',
      'error_message', 'Délai fictif dépassé', 'analysis_outcome', null, 'last_error_at', clock_timestamp(),
      'next_retry_at', clock_timestamp() + interval '15 seconds'),
    '{"extracted_json": {}, "warnings": [], "tables": [], "provider_meta": {"status": "failed"}, "raw_response": {"fixture": true},
      "token_count": 0, "cost_cents": 0, "duration_ms": 5}')::text, 'null')$call$, p_job_id, p_job_id, p_token)
$$;
create function pg_temp.job_after(p_job_id uuid)
returns table (status text, error_code text, retry_scheduled boolean, lease_released boolean, previous_results bigint, results bigint)
language sql as $$
  select j.status::text, j.error_code, j.next_retry_at is not null, j.processing_lease_token is null,
    (select count(*) from public.takeoff_results r where r.job_id = j.id and r.provider_meta ->> 'fixture' = 'previous'),
    (select count(*) from public.takeoff_results r where r.job_id = j.id)
  from public.takeoff_jobs j where j.id = p_job_id
$$;

select is(extensions.dblink_exec('failure_worker', 'set role service_role'), 'SET', 'the worker session writes as the worker');

-- Case 1: the caller's statement timeout is longer than the diagnostic may wait for the held row.
select is(extensions.dblink_exec('failure_worker', 'set statement_timeout = ''6s'''), 'SET', 'a six second statement timeout');
select is((select count(*)::integer from extensions.dblink('failure_worker',
    pg_temp.record_failure('c4f00000-0000-4000-8000-000000000021', 'c4f00000-0000-4000-8000-000000000031'), false) as x(result text)),
  1, 'the failure writer answers although the diagnostic could not replace the held row');
select results_eq($$select * from pg_temp.job_after('c4f00000-0000-4000-8000-000000000021')$$,
  $$values ('failed'::text, 'AI_TIMEOUT'::text, true, true, 1::bigint, 1::bigint)$$,
  'the failure and its automatic retry are recorded, and the held previous result stays whole');

-- Case 2: the caller's statement timeout expires while the diagnostic waits for the held row.
select is(extensions.dblink_exec('failure_worker', 'set statement_timeout = ''1s'''), 'SET', 'a one second statement timeout');
select is((select count(*)::integer from extensions.dblink('failure_worker',
    pg_temp.record_failure('c4f00000-0000-4000-8000-000000000022', 'c4f00000-0000-4000-8000-000000000032'), false) as x(result text)),
  1, 'the failure writer answers after the statement timeout cancelled only the diagnostic');
select results_eq($$select * from pg_temp.job_after('c4f00000-0000-4000-8000-000000000022')$$,
  $$values ('failed'::text, 'AI_TIMEOUT'::text, true, true, 1::bigint, 1::bigint)$$,
  'a statement timeout during the diagnostic keeps the failure and its automatic retry');

select is(extensions.dblink_exec('failure_hold', 'rollback'), 'ROLLBACK', 'the holding session releases the rows');
select is(extensions.dblink_exec('failure_worker', 'reset statement_timeout'), 'RESET', 'the worker session resets its timeout');

-- Clean the committed synthetic fixtures of this disposable database, as takeoff-rule-peers-race.test.sql does: every
-- tenant-scoped row of the fixture's own tenant removed with triggers off, then the tenant, its profile and its user.
select is(extensions.dblink_exec('failure_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'c4f00000-0000-4000-8000-000000000001' and is_default);
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
delete from public.profiles where id = 'c4f00000-0000-4000-8000-000000000001';
delete from auth.users where id = 'c4f00000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures cleaned');
select is((select count(*)::integer from public.takeoff_jobs where id in ('c4f00000-0000-4000-8000-000000000021',
  'c4f00000-0000-4000-8000-000000000022')), 0, 'no fixture job is left');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('failure_setup'), ('failure_hold'), ('failure_worker')) as session(name);
select * from finish();
rollback;
