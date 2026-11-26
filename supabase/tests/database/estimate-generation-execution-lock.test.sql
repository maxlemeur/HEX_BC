begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok(
  not has_function_privilege('anon', 'public.acquire_estimate_generation_execution(uuid,text,uuid,uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.release_estimate_generation_execution(uuid,text,uuid)', 'EXECUTE'),
  'anonymous callers cannot reserve or release execution');
select ok(
  not has_function_privilege('authenticated', 'private.acquire_estimate_ai_generation_lease(uuid,text,uuid)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'private.estimate_generation_execution_locks', 'SELECT'),
  'authenticated callers can only use the public RPCs');

-- Committed fixtures are needed for two sessions racing to reserve execution.
create temp table generation_connection as
select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)),
  current_setting('port'), current_database()) as connection;
select dblink_connect('generation_setup', connection),
       dblink_connect('generation_first', connection),
       dblink_connect('generation_second', connection)
from generation_connection;

select dblink_exec('generation_setup', $fixture$
begin;
insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values
  ('7e280000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'generation-owner@example.test', '',
    '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('7e280000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'generation-other@example.test', '',
    '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
insert into public.estimate_projects (id, tenant_id, user_id, name)
select '7e280000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Atelier fictif'
from public.tenant_memberships m where m.user_id = '7e280000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth, currency)
select ('7e280000-0000-4000-8000-00000000010' || n)::uuid, p.tenant_id, p.id, n, 2, 3, 'EUR'
from public.estimate_projects p cross join generate_series(1, 2) n
where p.id = '7e280000-0000-4000-8000-000000000010';
insert into public.draft_locks (version_id, tenant_id, user_id, session_id, expires_at)
select ev.id, ev.tenant_id, '7e280000-0000-4000-8000-000000000001',
  '7e280000-0000-4000-8000-000000000020', clock_timestamp() + interval '30 minutes'
from public.estimate_versions ev where ev.project_id = '7e280000-0000-4000-8000-000000000010';
commit;
$fixture$);

create function pg_temp.claim(use_ai boolean, token_suffix int, version_suffix int default 1,
  operation text default 'structure_draft', page_suffix int default 0)
returns text language sql as $$
  select format(
    'select status from public.acquire_estimate_generation_execution(%L, %L, %L, %L, %L)',
    '7e280000-0000-4000-8000-00000000010' || version_suffix, operation,
    '7e280000-0000-4000-8000-00000000003' || token_suffix,
    '7e280000-0000-4000-8000-00000000002' || page_suffix, use_ai
  );
$$;
create function pg_temp.release(token_suffix int, operation text default 'structure_draft')
returns text language sql as $$
  select format(
    'select public.release_estimate_generation_execution(%L, %L, %L)',
    '7e280000-0000-4000-8000-000000000101', operation, '7e280000-0000-4000-8000-00000000003' || token_suffix
  );
$$;

select dblink_exec(session_name, $auth$
  set role authenticated;
  set request.jwt.claim.sub = '7e280000-0000-4000-8000-000000000001';
$auth$)
from (values ('generation_first'), ('generation_second')) as s(session_name);
select dblink_exec('generation_second', 'set statement_timeout = 5000');

create function pg_temp.waits_for_admission(p_pid integer) returns boolean language plpgsql as $$
begin
  for attempt in 1..80 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity where pid = p_pid and wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_sleep(0.025);
  end loop;
  return false;
end;
$$;
create temp table generation_second_pid as
select pid from dblink('generation_second', 'select pg_backend_pid()') as t(pid integer);

select dblink_exec('generation_first', 'begin');
select results_eq(
  $$select status from dblink('generation_first', pg_temp.claim(true, 1)) as t(status text)$$,
  $$values ('acquired'::text)$$, 'the first AI request reserves both execution and quota');
select is(dblink_send_query('generation_second', pg_temp.claim(false, 2)), 1, 'a fallback races the AI reservation');
select ok(pg_temp.waits_for_admission((select pid from generation_second_pid)), 'the second request reaches admission before the first commits');
select dblink_exec('generation_first', 'commit');
select results_eq(
  $$select status from dblink_get_result('generation_second') as t(status text)$$,
  $$values ('busy'::text)$$, 'a fallback cannot run while an AI request is executing');
select status from dblink_get_result('generation_second') as t(status text);
select results_eq(
  $$select status from dblink('generation_second', pg_temp.claim(true, 2)) as t(status text)$$,
  $$values ('busy'::text)$$, 'a second AI request is also refused while execution is active');

-- Release is identical on success and failure. Simulate a provider failure by
-- completing the first request without producing any draft.
select results_eq(
  $$select released from dblink('generation_first', pg_temp.release(1)) as t(released boolean)$$,
  $$values (true)$$, 'the failed AI call releases its execution token');
select is(
  (select window_expires_at - created_at from public.estimate_ai_generation_budgets
   where version_id = '7e280000-0000-4000-8000-000000000101' and operation = 'structure_draft'),
  interval '10 minutes', 'completion preserves the ten-minute replay window');
select results_eq(
  $$select status from dblink('generation_second', pg_temp.claim(true, 2)) as t(status text)$$,
  $$values ('quota_exceeded'::text)$$, 'an AI replay still hits its window');
select results_eq(
  $$select status from dblink('generation_second', pg_temp.claim(false, 2)) as t(status text)$$,
  $$values ('acquired'::text)$$, 'a fallback runs immediately after the failed AI call');
select results_eq(
  $$select status from dblink('generation_first', pg_temp.claim(false, 3)) as t(status text)$$,
  $$values ('busy'::text)$$, 'a second fallback cannot run during a fallback');
select results_eq(
  $$select status from dblink('generation_first', pg_temp.claim(true, 3)) as t(status text)$$,
  $$values ('busy'::text)$$, 'an AI request cannot run during a fallback');
select results_eq(
  $$select released from dblink('generation_first', pg_temp.release(1)) as t(released boolean)$$,
  $$values (false)$$, 'a previous token cannot release a newer execution');

select dblink_exec('generation_first', $other$
  set request.jwt.claim.sub = '7e280000-0000-4000-8000-000000000002';
$other$);
select throws_ok(format('select status from dblink(%L, %L) as t(status text)',
    'generation_first', pg_temp.claim(false, 2)),
  '42501', 'estimate_generation_access_denied', 'another tenant cannot reserve the version');
select results_eq(
  $$select released from dblink('generation_first', pg_temp.release(2)) as t(released boolean)$$,
  $$values (false)$$, 'another tenant cannot release the lock even with its token');
select dblink_exec('generation_first', $owner$
  set request.jwt.claim.sub = '7e280000-0000-4000-8000-000000000001';
$owner$);

select throws_ok(format('select status from dblink(%L, %L) as t(status text)',
    'generation_first', pg_temp.claim(false, 3, 1, 'structure_draft', 1)),
  '40001', 'estimate_generation_page_lock_required', 'another page of the same user cannot reserve execution');
select dblink_exec('generation_setup', $expire$
  update private.estimate_generation_execution_locks set expires_at = clock_timestamp() - interval '1 second'
  where version_id = '7e280000-0000-4000-8000-000000000101' and operation = 'structure_draft'
$expire$);
select results_eq(
  $$select status from dblink('generation_first', pg_temp.claim(false, 3)) as t(status text)$$,
  $$values ('acquired'::text)$$, 'a fallback replaces an expired lock after an interrupted run');
select results_eq(
  $$select released from dblink('generation_second', pg_temp.release(2)) as t(released boolean)$$,
  $$values (false)$$, 'a late completion cannot release the replacement');
select results_eq(
  $$select released from dblink('generation_first', pg_temp.release(3)) as t(released boolean)$$,
  $$values (true)$$, 'the current execution token releases successfully');

select results_eq(
  $$select status from dblink('generation_first', pg_temp.claim(false, 4, 1, 'version_zero_draft')) as t(status text)$$,
  $$values ('acquired'::text)$$, 'V0 can reserve execution without AI');
select results_eq(
  $$select claimed from dblink('generation_second', $legacy$
    select claimed from public.acquire_estimate_ai_generation_lease(
      '7e280000-0000-4000-8000-000000000101', 'version_zero_draft', '7e280000-0000-4000-8000-000000000035')
  $legacy$) as t(claimed boolean)$$,
  $$values (false)$$, 'the old RPC also honors the new execution lock');
select results_eq(
  $$select released from dblink('generation_first', pg_temp.release(4, 'version_zero_draft')) as t(released boolean)$$,
  $$values (true)$$, 'V0 fallback releases successfully');
select results_eq(
  $$select status from dblink('generation_second', pg_temp.claim(true, 5, 1, 'version_zero_draft')) as t(status text)$$,
  $$values ('acquired'::text)$$, 'an AI run can follow the V0 fallback immediately');
select results_eq(
  $$select status from dblink('generation_first', pg_temp.claim(true, 6, 2)) as t(status text)$$,
  $$values ('quota_exceeded'::text)$$, 'the two-window quota for an actor still applies across versions');
select results_eq(
  $$select status from dblink('generation_first', pg_temp.claim(false, 6, 2)) as t(status text)$$,
  $$values ('acquired'::text)$$, 'an actor at the AI limit can still start a fallback on another version');

select dblink_exec('generation_setup', $cleanup$
begin;
create temp table generation_fixture_tenants on commit drop as
select distinct tenant_id from public.tenant_memberships where user_id in
  ('7e280000-0000-4000-8000-000000000001', '7e280000-0000-4000-8000-000000000002');
delete from public.estimate_projects where id = '7e280000-0000-4000-8000-000000000010';
delete from public.feature_flags where tenant_id in (select tenant_id from generation_fixture_tenants);
delete from public.estimate_rules where tenant_id in (select tenant_id from generation_fixture_tenants);
delete from public.audit_logs where tenant_id in (select tenant_id from generation_fixture_tenants);
delete from auth.users where id in ('7e280000-0000-4000-8000-000000000001', '7e280000-0000-4000-8000-000000000002');
delete from public.tenants where id in (select tenant_id from generation_fixture_tenants);
commit;
$cleanup$);
select dblink_disconnect('generation_setup'), dblink_disconnect('generation_first'), dblink_disconnect('generation_second');
select * from finish();
rollback;
