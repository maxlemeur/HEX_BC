-- TI-682 lot D, PR 2 (migration …_takeoff_page_decisions.sql): two relaunches of one page applied at the same time, each
-- with a decision that replaces the page's earlier line, never both reach the estimate. Both overloads take the version's
-- lock before the decisions are read: the second application waits for the first, then finds the line it was to replace
-- changed under it, and is refused (TAKEOFF_PAGE_DECISION_STALE). The page is counted once, with the first relaunch.
-- Isolation justified: two applications interleave only across two sessions, which no journey drives deterministically.
-- Written before the migration: red on 28de7bbb (no decision can be recorded; both relaunches are applied and the page is
-- in the estimate three times).
-- All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create temp table page_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect(session.name, (select connection from page_race_connection)), 'OK', format('%s connected', session.name))
from (values ('page_setup'), ('page_a'), ('page_b')) as session(name);

-- One engineer, one engine 2 draft, three takeoffs of one page: M1 applied, M2 and M3 measuring it again.
select is(extensions.dblink_exec('page_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd2900000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'page-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role where user_id = 'd2900000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd2900000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Course d''une page (fictif)', false
from public.tenant_memberships m where m.user_id = 'd2900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select 'd2900000-0000-4000-8000-000000000101', m.tenant_id, 'd2900000-0000-4000-8000-000000000010', 1, 'draft', 2, 1, 0
from public.tenant_memberships m where m.user_id = 'd2900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
select 'd2900000-0000-4000-8000-000000000201', m.tenant_id, 'd2900000-0000-4000-8000-000000000101', 'section', 0, 'Lot fictif'
from public.tenant_memberships m where m.user_id = 'd2900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select 'd2900000-0000-4000-8000-000000000101', m.user_id, m.tenant_id, now() + interval '30 minutes', gen_random_uuid()
from public.tenant_memberships m where m.user_id = 'd2900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select job.id, m.tenant_id, 'd2900000-0000-4000-8000-000000000101', 'B', 'completed', 'plan-fictif.pdf', m.user_id
from public.tenant_memberships m cross join (values ('d2900000-0000-4000-8000-000000000301'::uuid),
  ('d2900000-0000-4000-8000-000000000302'::uuid), ('d2900000-0000-4000-8000-000000000303'::uuid)) as job(id)
where m.user_id = 'd2900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
  source_page, metadata, rule_results)
select line.id, m.tenant_id, line.job_id, 'WC suspendu', line.quantity, 'u', 0.95, 'Repère localisé', 'plan-fictif.pdf', 1,
  '{"source_document":{"kind":"plan_file","plan_file_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}'::jsonb, '[]'::jsonb
from public.tenant_memberships m cross join (values
  ('d2900000-0000-4000-8000-000000000401'::uuid, 'd2900000-0000-4000-8000-000000000301'::uuid, 4),
  ('d2900000-0000-4000-8000-000000000402'::uuid, 'd2900000-0000-4000-8000-000000000302'::uuid, 5),
  ('d2900000-0000-4000-8000-000000000403'::uuid, 'd2900000-0000-4000-8000-000000000303'::uuid, 6)
) as line(id, job_id, quantity) where m.user_id = 'd2900000-0000-4000-8000-000000000001' and m.is_default;
commit;
$setup$), 'COMMIT', 'fixtures committed');

select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as the engineer', session.name))
from (values ('page_setup'), ('page_a'), ('page_b')) as session(name);
select is((select claims.sub from extensions.dblink(session.name, $claims$select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"d2900000-0000-4000-8000-000000000001"}', false), set_config('request.jwt.claim.sub',
  'd2900000-0000-4000-8000-000000000001', false)$claims$) as claims(full_claims text, sub text)),
  'd2900000-0000-4000-8000-000000000001', format('%s carries the engineer''s claims', session.name))
from (values ('page_setup'), ('page_a'), ('page_b')) as session(name);

create temp table page_race_apply(label text primary key, query text);
insert into page_race_apply
select job.label, format($apply$select count(*)::integer from public.apply_takeoff_job_guarded_atomic(%1$L, 'append',
  'd2900000-0000-4000-8000-000000000201', (select jsonb_agg(jsonb_build_object('item_id', item.id, 'source_order', 0, 'rule_id', null,
    'action', 'none', 'designation', btrim(item.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null))
   from public.takeoff_items as item where item.job_id = %1$L))$apply$, job.id)
from (values ('m1', 'd2900000-0000-4000-8000-000000000301'), ('m2', 'd2900000-0000-4000-8000-000000000302'),
  ('m3', 'd2900000-0000-4000-8000-000000000303')) as job(label, id);

select is((select x.applied from extensions.dblink('page_setup', (select query from page_race_apply where label = 'm1')) as x(applied integer)),
  1, 'the first takeoff applies its page');
-- Both relaunches decide, against the same estimate, to replace the page's earlier line by their own.
select is((select x.recorded from extensions.dblink('page_setup', format($decide$select public.record_takeoff_page_decisions(%1$L,
  jsonb_build_array(jsonb_build_object('document', jsonb_build_object('plan_file_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'content_hash', null, 'logical_document_id', null, 'file_name', 'plan-fictif.pdf'), 'source_page', 1,
    'earlier_job_ids', jsonb_build_array('d2900000-0000-4000-8000-000000000301'), 'decision', 'replace', 'reason_code', null, 'note', null,
    'lines', (select jsonb_agg(jsonb_build_object('estimate_item_id', item.id, 'expected_updated_at', item.updated_at, 'action', 'update',
      -- An engine 2 line names no source: whether it was changed by hand cannot be seen, so the estimator chooses.
      'take', 'new', 'item_ids', '[]'::jsonb)) from public.estimate_items item
      where item.version_id = 'd2900000-0000-4000-8000-000000000101' and item.item_type = 'line'),
    'pairs', (select jsonb_agg(jsonb_build_object('takeoff_item_id', %2$L, 'estimate_item_id', item.id)) from public.estimate_items item
      where item.version_id = 'd2900000-0000-4000-8000-000000000101' and item.item_type = 'line'))))$decide$, job.id, job.line), false)
    as x(recorded integer)), 1, format('the relaunch %s records its replacement', job.id))
from (values ('d2900000-0000-4000-8000-000000000302', 'd2900000-0000-4000-8000-000000000402'),
  ('d2900000-0000-4000-8000-000000000303', 'd2900000-0000-4000-8000-000000000403')) as job(id, line);

create temp table page_race_pids(label text primary key, pid integer);
insert into page_race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('page_a'), ('page_b')) as session(name);
create or replace function pg_temp.waits_for_version_lock(p_label text)
returns boolean
language sql
as $$
  select exists (
    select 1 from pg_catalog.pg_locks as held
    where held.locktype = 'advisory' and not held.granted
      and held.pid = (select pid from page_race_pids where label = p_label)
      and ((held.classid::bigint << 32) | held.objid::bigint)
        = pg_catalog.hashtextextended('takeoff-rules:d2900000-0000-4000-8000-000000000101', 0)
  )
$$;

select is(extensions.dblink_exec('page_a', 'begin'), 'BEGIN', 'the first relaunch''s transaction starts');
select is((select x.applied from extensions.dblink('page_a', (select query from page_race_apply where label = 'm2')) as x(applied integer)),
  1, 'the first relaunch replaces the page, not yet committed');
select is(extensions.dblink_send_query('page_b', (select query from page_race_apply where label = 'm3')), 1, 'the second relaunch starts');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('page_b'), 1, 'the second relaunch waits');
select ok(pg_temp.waits_for_version_lock('page_b'), 'it waits for the version''s lock, before reading the estimate');
select is(extensions.dblink_exec('page_a', 'commit'), 'COMMIT', 'the first relaunch commits');
select is((select count(*)::integer from extensions.dblink_get_result('page_b', false) as x(applied integer)), 0,
  'the second relaunch writes nothing');
select ok(extensions.dblink_error_message('page_b') like '%TAKEOFF_PAGE_DECISION_STALE%',
  'the second relaunch is refused: the line it was to replace changed under it');
select is((select count(*)::integer from extensions.dblink_get_result('page_b', false) as x(applied integer)), 0, 'the second relaunch is done');

select is((select jsonb_agg(jsonb_build_array(item.quantity, item.source_job_id) order by item.id) from public.estimate_items item
    where item.version_id = 'd2900000-0000-4000-8000-000000000101' and item.item_type = 'line'),
  jsonb_build_array(jsonb_build_array(5, 'd2900000-0000-4000-8000-000000000302')),
  'the page is counted once, with the first relaunch');
select is((select array_agg(job.status::text order by job.id) from public.takeoff_jobs job
    where job.id in ('d2900000-0000-4000-8000-000000000302', 'd2900000-0000-4000-8000-000000000303')),
  array['applied', 'completed'], 'the second relaunch stays to apply, to be decided again');

-- Clean the committed synthetic fixtures of this disposable database, as takeoff-rule-peers-race.test.sql does: every
-- tenant-scoped row of the fixture's own tenant removed with triggers off, then the tenant, its profile and its user.
select is(extensions.dblink_exec('page_setup', 'reset role'), 'RESET', 'the fixture session cleans as the owner');
select is(extensions.dblink_exec('page_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'd2900000-0000-4000-8000-000000000001' and is_default);
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
delete from public.profiles where id = 'd2900000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd2900000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures cleaned');
select is((select count(*)::integer from public.takeoff_jobs where id in ('d2900000-0000-4000-8000-000000000301',
  'd2900000-0000-4000-8000-000000000302', 'd2900000-0000-4000-8000-000000000303')), 0, 'no fixture job is left');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('page_setup'), ('page_a'), ('page_b')) as session(name);
select * from finish();
rollback;
