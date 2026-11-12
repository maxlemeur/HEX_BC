-- TI-682 lot D, PR 2 (migration …_takeoff_page_decisions.sql). Codex review of c06cbb1b: the decisions an application
-- applies are the ones its own request sent (case 1, red on c06cbb1b: tab A applied tab B's « keep both »; case 2 uses
-- the single-transaction path the route takes). Then: two relaunches of one page applied at the same time, each
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
  ('d2900000-0000-4000-8000-000000000302'::uuid), ('d2900000-0000-4000-8000-000000000303'::uuid),
  ('d2900000-0000-4000-8000-000000000304'::uuid)) as job(id)
where m.user_id = 'd2900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
  source_page, metadata, rule_results)
select line.id, m.tenant_id, line.job_id, 'WC suspendu', line.quantity, 'u', 0.95, 'Repère localisé', 'plan-fictif.pdf', 1,
  '{"source_document":{"kind":"plan_file","plan_file_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}'::jsonb, '[]'::jsonb
from public.tenant_memberships m cross join (values
  ('d2900000-0000-4000-8000-000000000401'::uuid, 'd2900000-0000-4000-8000-000000000301'::uuid, 4),
  ('d2900000-0000-4000-8000-000000000402'::uuid, 'd2900000-0000-4000-8000-000000000302'::uuid, 5),
  ('d2900000-0000-4000-8000-000000000403'::uuid, 'd2900000-0000-4000-8000-000000000303'::uuid, 6),
  ('d2900000-0000-4000-8000-000000000404'::uuid, 'd2900000-0000-4000-8000-000000000304'::uuid, 7)
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
-- The application as the route makes it (PR 2, Codex review): the decisions travel with it, recorded and applied in one
-- transaction (public.apply_takeoff_job_with_page_decisions). « replace » takes the earlier line; « keep » keeps both.
create or replace function pg_temp.race_decisions(p_job text, p_line text, p_decision text)
returns text language sql as $$
  select format($decisions$jsonb_build_array(jsonb_build_object('document', jsonb_build_object('plan_file_id',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'content_hash', null, 'logical_document_id', null, 'file_name', 'plan-fictif.pdf'),
    'source_page', 1, 'earlier_job_ids', '[]'::jsonb, 'decision', %2$L, 'reason_code', %3$s, 'note', null,
    'lines', (select jsonb_agg(jsonb_build_object('estimate_item_id', item.id, 'expected_updated_at', item.updated_at,
      'action', %4$L, 'take', %5$s, 'item_ids', '[]'::jsonb)) from public.estimate_items item
      where item.version_id = 'd2900000-0000-4000-8000-000000000101' and item.item_type = 'line'),
    'pairs', %6$s))$decisions$, p_job, p_decision,
    case when p_decision = 'keep_both' then quote_literal('other_zone') else 'null' end,
    case when p_decision = 'keep_both' then 'keep' else 'update' end,
    -- An engine 2 line names no source: whether it was changed by hand cannot be seen, so the estimator chooses.
    case when p_decision = 'keep_both' then 'null' else quote_literal('new') end,
    case when p_decision = 'keep_both' then '''[]''::jsonb' else format($pairs$(select jsonb_agg(jsonb_build_object('takeoff_item_id', %1$L,
      'estimate_item_id', item.id)) from public.estimate_items item
      where item.version_id = 'd2900000-0000-4000-8000-000000000101' and item.item_type = 'line')$pairs$, p_line) end)
$$;
create or replace function pg_temp.race_plan(p_job text)
returns text language sql as $$
  select format($plan$(select jsonb_agg(jsonb_build_object('item_id', item.id, 'source_order', 0, 'rule_id', null,
    'action', 'none', 'designation', btrim(item.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null))
   from public.takeoff_items as item where item.job_id = %L)$plan$, p_job)
$$;
insert into page_race_apply values
  ('m1', format($apply$select count(*)::integer from public.apply_takeoff_job_guarded_atomic(%1$L, 'append',
    'd2900000-0000-4000-8000-000000000201', %2$s)$apply$, 'd2900000-0000-4000-8000-000000000301',
    pg_temp.race_plan('d2900000-0000-4000-8000-000000000301'))),
  -- The two-call path, recording first and applying in another transaction.
  ('record m2 replace', format('select public.record_takeoff_page_decisions(%L, %s)', 'd2900000-0000-4000-8000-000000000302',
    pg_temp.race_decisions('d2900000-0000-4000-8000-000000000302', 'd2900000-0000-4000-8000-000000000402', 'replace'))),
  ('record m2 keep', format('select public.record_takeoff_page_decisions(%L, %s)', 'd2900000-0000-4000-8000-000000000302',
    pg_temp.race_decisions('d2900000-0000-4000-8000-000000000302', 'd2900000-0000-4000-8000-000000000402', 'keep_both'))),
  ('apply m2 alone', format($apply$select count(*)::integer from public.apply_takeoff_job_guarded_atomic(%1$L, 'append',
    'd2900000-0000-4000-8000-000000000201', %2$s)$apply$, 'd2900000-0000-4000-8000-000000000302',
    pg_temp.race_plan('d2900000-0000-4000-8000-000000000302')))
;
insert into page_race_apply
select format('%s %s', job.label, decision), format($apply$select count(*)::integer from public.apply_takeoff_job_with_page_decisions(%1$L,
    'append', 'd2900000-0000-4000-8000-000000000201', %2$s, %3$s, null)$apply$, job.id, pg_temp.race_plan(job.id),
  pg_temp.race_decisions(job.id, job.line, decision))
from (values ('m2', 'd2900000-0000-4000-8000-000000000302', 'd2900000-0000-4000-8000-000000000402'),
  ('m3', 'd2900000-0000-4000-8000-000000000303', 'd2900000-0000-4000-8000-000000000403'),
  ('m4', 'd2900000-0000-4000-8000-000000000304', 'd2900000-0000-4000-8000-000000000404')) as job(label, id, line)
cross join (values ('replace'), ('keep_both')) as decision(decision);

select is((select x.applied from extensions.dblink('page_setup', (select query from page_race_apply where label = 'm1')) as x(applied integer)),
  1, 'the first takeoff applies its page');

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
create or replace function pg_temp.lines_of_the_page()
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_array(item.quantity, item.source_job_id) order by item.id) from public.estimate_items item
  where item.version_id = 'd2900000-0000-4000-8000-000000000101' and item.item_type = 'line'
$$;

-- 1. The interleaving the review named: tab A records its replacement, tab B (the same person) records « keep both »
-- for the same takeoff, then A applies. A must never apply B's choice: decisions recorded by another transaction than
-- the application are refused.
select is((select x.recorded from extensions.dblink('page_a', (select query from page_race_apply where label = 'record m2 replace'))
  as x(recorded integer)), 1, 'tab A records its replacement');
select is((select x.recorded from extensions.dblink('page_b', (select query from page_race_apply where label = 'record m2 keep'))
  as x(recorded integer)), 1, 'tab B records « keep both » for the same takeoff');
select is((select count(*)::integer from extensions.dblink('page_a', (select query from page_race_apply where label = 'apply m2 alone'), false)
  as x(applied integer)), 0, 'tab A''s application writes nothing');
select ok(extensions.dblink_error_message('page_a') like '%TAKEOFF_PAGE_DECISION_STALE%decisions_not_of_this_application%',
  'tab A is refused: the decisions it would apply were not recorded by its own request');
select is(pg_temp.lines_of_the_page(), jsonb_build_array(jsonb_build_array(4, 'd2900000-0000-4000-8000-000000000301')),
  'the page holds the first measure only');

-- 2. The same two tabs through the route's single transaction: A records and applies its replacement, B's request waits
-- for A's takeoff, then finds it applied. A's own choice is applied.
select is(extensions.dblink_exec('page_a', 'begin'), 'BEGIN', 'tab A''s request starts');
select is((select x.applied from extensions.dblink('page_a', (select query from page_race_apply where label = 'm2 replace')) as x(applied integer)),
  1, 'tab A records and applies its replacement, not yet committed');
select is(extensions.dblink_send_query('page_b', (select query from page_race_apply where label = 'm2 keep_both')), 1,
  'tab B sends « keep both » for the same takeoff');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('page_b'), 1, 'tab B waits for tab A''s takeoff');
select is(extensions.dblink_exec('page_a', 'commit'), 'COMMIT', 'tab A commits');
select is((select count(*)::integer from extensions.dblink_get_result('page_b', false) as x(applied integer)), 0, 'tab B writes nothing');
select ok(extensions.dblink_error_message('page_b') like '%TAKEOFF_PAGE_DECISIONS_FROZEN%', 'tab B finds the takeoff applied');
select is((select count(*)::integer from extensions.dblink_get_result('page_b', false) as x(applied integer)), 0, 'tab B is done');
select is(pg_temp.lines_of_the_page(), jsonb_build_array(jsonb_build_array(5, 'd2900000-0000-4000-8000-000000000302')),
  'tab A''s replacement is what the estimate holds: the page counted once');
select is((select jsonb_agg(decision.decision) from public.takeoff_page_decisions decision
    where decision.job_id = 'd2900000-0000-4000-8000-000000000302'), '["replace"]'::jsonb, 'the frozen trace is tab A''s own decision');

-- 3. Two relaunches of the page applied at the same time, each replacing the line: they serialize on the version's lock.
select is(extensions.dblink_exec('page_a', 'begin'), 'BEGIN', 'the first relaunch''s request starts');
select is((select x.applied from extensions.dblink('page_a', (select query from page_race_apply where label = 'm3 replace')) as x(applied integer)),
  1, 'the first relaunch replaces the page, not yet committed');
select is(extensions.dblink_send_query('page_b', (select query from page_race_apply where label = 'm4 replace')), 1, 'the second relaunch starts');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('page_b'), 1, 'the second relaunch waits');
select ok(pg_temp.waits_for_version_lock('page_b'), 'it waits for the version''s lock, before reading the estimate');
select is(extensions.dblink_exec('page_a', 'commit'), 'COMMIT', 'the first relaunch commits');
select is((select count(*)::integer from extensions.dblink_get_result('page_b', false) as x(applied integer)), 0,
  'the second relaunch writes nothing');
select ok(extensions.dblink_error_message('page_b') like '%TAKEOFF_PAGE_DECISION_STALE%',
  'the second relaunch is refused: the line it was to replace changed under it');
select is((select count(*)::integer from extensions.dblink_get_result('page_b', false) as x(applied integer)), 0, 'the second relaunch is done');
select is(pg_temp.lines_of_the_page(), jsonb_build_array(jsonb_build_array(6, 'd2900000-0000-4000-8000-000000000303')),
  'the page is counted once, with the first relaunch');
select is((select array_agg(job.status::text order by job.id) from public.takeoff_jobs job
    where job.id in ('d2900000-0000-4000-8000-000000000303', 'd2900000-0000-4000-8000-000000000304')),
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
  'd2900000-0000-4000-8000-000000000302', 'd2900000-0000-4000-8000-000000000303', 'd2900000-0000-4000-8000-000000000304')), 0,
  'no fixture job is left');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('page_setup'), ('page_a'), ('page_b')) as session(name);
select * from finish();
rollback;
