-- TI-728 (migration …_takeoff_apply_dpgf_check_under_lock.sql). The 4-argument application serves a version without a
-- DPGF line and refuses one that holds a DPGF line (TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED). It checked that before
-- its locks: a DPGF line a copy committed between the check and the version's lock escaped it. The copy is
-- « Importer la DPGF » into the draft, or a section copy. The application then deleted that line (« Remplacer la
-- section ») or rewrote it (« Fusionner »), and its DPGF quantity was lost without a word. The check now runs under the
-- version's row lock. Every writer of a DPGF line into an existing version holds that lock until it commits: the copies
-- take it first (copy_estimate_items_atomic, commit_estimate_batch), a plain insert waits on it through its foreign
-- key, and any other write of a line takes it through the trigger bump_estimate_content_revision_from_item. A copy
-- that committed first is seen, and the application is refused. A copy that comes later waits for the application.
-- 1. The faulty order, replayed with the 4-argument overload: another holder of the version's takeoff lock (a review
--    save, the worker) stops the application after its check on main. The copy commits, then the application goes on.
-- 2. The route's order (apply_takeoff_job_with_page_decisions, no DPGF permit): the copy is in flight when the
--    application checks.
-- 3. The application first: the copy waits for it, then lands beside its line. A later application is refused.
-- Isolation justified: the interleaving needs two sessions, which no journey drives deterministically.
-- Written before the migration: red on dd372102 (cases 1 and 2: the application applies, the DPGF line is deleted or
-- rewritten).
-- All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create temp table check_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect(session.name, (select connection from check_race_connection)), 'OK', format('%s connected', session.name))
from (values ('check_setup'), ('check_holder'), ('check_a'), ('check_b')) as session(name);

-- One engineer. A source draft holds the DPGF line the copies take (reference 12 ml, as its DPGF printed it). Three engine 2
-- drafts hold no DPGF line, each with one section, the engineer's draft lock and a takeoff of one line (4 ml) to apply.
-- The third has a second takeoff, applied last.
select is(extensions.dblink_exec('check_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd7280000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'dpgf-check-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role where user_id = 'd7280000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd7280000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Course du contrôle DPGF (fictif)', false
from public.tenant_memberships m where m.user_id = 'd7280000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select version.id, m.tenant_id, 'd7280000-0000-4000-8000-000000000010', version.number, 'draft', 2, 1, 0
from public.tenant_memberships m cross join (values ('d7280000-0000-4000-8000-000000000100'::uuid, 1),
  ('d7280000-0000-4000-8000-000000000101'::uuid, 2), ('d7280000-0000-4000-8000-000000000102'::uuid, 3),
  ('d7280000-0000-4000-8000-000000000103'::uuid, 4)) as version(id, number)
where m.user_id = 'd7280000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
select section.id, m.tenant_id, section.version_id, 'section', 0, 'Lot fictif'
from public.tenant_memberships m cross join (values
  ('d7280000-0000-4000-8000-000000000200'::uuid, 'd7280000-0000-4000-8000-000000000100'::uuid),
  ('d7280000-0000-4000-8000-000000000201'::uuid, 'd7280000-0000-4000-8000-000000000101'::uuid),
  ('d7280000-0000-4000-8000-000000000202'::uuid, 'd7280000-0000-4000-8000-000000000102'::uuid),
  ('d7280000-0000-4000-8000-000000000203'::uuid, 'd7280000-0000-4000-8000-000000000103'::uuid)
) as section(id, version_id) where m.user_id = 'd7280000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
  unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
  line_total_ttc_cents, source_provider, source_file_name, source_page, source_metadata, fo_provision)
select 'd7280000-0000-4000-8000-000000000209', m.tenant_id, 'd7280000-0000-4000-8000-000000000100',
  'd7280000-0000-4000-8000-000000000200', 'line', 1, 'EF cuivre DN 22', 'ml', 12, null, 1000, 0, 1, 0, 1, 1000, 12000, 0, 12000,
  'dpgf', 'dpgf-fictif.xlsx', 7, '{"dpgf_source_quantity":12,"dpgf_source_unit":"ml"}'::jsonb, 1
from public.tenant_memberships m where m.user_id = 'd7280000-0000-4000-8000-000000000001' and m.is_default;
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select lease.version_id, m.user_id, m.tenant_id, now() + interval '30 minutes', lease.session_id
from public.tenant_memberships m cross join (values
  ('d7280000-0000-4000-8000-000000000101'::uuid, 'd7280000-0000-4000-8000-000000000501'::uuid),
  ('d7280000-0000-4000-8000-000000000102'::uuid, 'd7280000-0000-4000-8000-000000000502'::uuid),
  ('d7280000-0000-4000-8000-000000000103'::uuid, 'd7280000-0000-4000-8000-000000000503'::uuid)
) as lease(version_id, session_id) where m.user_id = 'd7280000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select job.id, m.tenant_id, job.version_id, 'B', 'completed', 'plan-fictif.pdf', m.user_id
from public.tenant_memberships m cross join (values
  ('d7280000-0000-4000-8000-000000000301'::uuid, 'd7280000-0000-4000-8000-000000000101'::uuid),
  ('d7280000-0000-4000-8000-000000000302'::uuid, 'd7280000-0000-4000-8000-000000000102'::uuid),
  ('d7280000-0000-4000-8000-000000000303'::uuid, 'd7280000-0000-4000-8000-000000000103'::uuid),
  ('d7280000-0000-4000-8000-000000000304'::uuid, 'd7280000-0000-4000-8000-000000000103'::uuid)
) as job(id, version_id) where m.user_id = 'd7280000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
  source_page, metadata, rule_results)
select line.id, m.tenant_id, line.job_id, 'EF cuivre DN 22', 4, 'ml', 0.95, 'Repère localisé', 'plan-fictif.pdf', line.page,
  '{"source_document":{"kind":"plan_file","plan_file_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}'::jsonb, '[]'::jsonb
from public.tenant_memberships m cross join (values
  ('d7280000-0000-4000-8000-000000000401'::uuid, 'd7280000-0000-4000-8000-000000000301'::uuid, 2),
  ('d7280000-0000-4000-8000-000000000402'::uuid, 'd7280000-0000-4000-8000-000000000302'::uuid, 2),
  ('d7280000-0000-4000-8000-000000000403'::uuid, 'd7280000-0000-4000-8000-000000000303'::uuid, 2),
  ('d7280000-0000-4000-8000-000000000404'::uuid, 'd7280000-0000-4000-8000-000000000304'::uuid, 3)
) as line(id, job_id, page) where m.user_id = 'd7280000-0000-4000-8000-000000000001' and m.is_default;
commit;
$setup$), 'COMMIT', 'fixtures committed');

-- A and B are the engineer, in two tabs. A lock wait longer than 15 s fails instead of holding the suite.
select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as the engineer', session.name))
from (values ('check_a'), ('check_b')) as session(name);
select is((select claims.sub from extensions.dblink(session.name, $claims$select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"d7280000-0000-4000-8000-000000000001"}', false), set_config('request.jwt.claim.sub',
  'd7280000-0000-4000-8000-000000000001', false)$claims$) as claims(full_claims text, sub text)),
  'd7280000-0000-4000-8000-000000000001', format('%s carries the engineer''s claims', session.name))
from (values ('check_a'), ('check_b')) as session(name);
select is(extensions.dblink_exec(session.name, 'set lock_timeout = ''15s'''), 'SET', format('%s bounds its lock waits', session.name))
from (values ('check_a'), ('check_b')) as session(name);

-- The copy the linked DPGF import and the section copy make into an engine 1/2 draft: the source DPGF line, all its copied
-- fields, under the target's section, through public.copy_estimate_items_atomic (the version's row lock, then the lease).
create or replace function pg_temp.race_copy(p_version text, p_lease text, p_section text, p_line text)
returns text language sql as $$
  select format($copy$select (public.copy_estimate_items_atomic(%1$L, %2$L, jsonb_build_array(
      (select jsonb_object_agg(field.key, field.value) from jsonb_each(to_jsonb(source)) as field(key, value)
        where field.key = any(array['id', 'parent_id', 'item_type', 'position', 'title', 'aid', 'description', 'quantity',
          'unit_price_ht_cents', 'tax_rate_bp', 'k_fo', 'h_mo', 'h_mo_majoration', 'k_mo', 'h_mo_atelier', 'k_mo_atelier',
          'labor_role_atelier_id', 'h_mo_chantier', 'k_mo_chantier', 'labor_role_chantier_id', 'pu_ht_cents', 'labor_role_id',
          'category_id', 'supply_type_id', 'selected_supplier_price_id', 'source_provider', 'source_job_id', 'source_file_name',
          'source_page', 'source_metadata', 'line_total_ht_cents', 'line_tax_cents', 'line_total_ttc_cents']))
      || jsonb_build_object('id', %4$L, 'parent_id', %3$L, 'position', 9))) ->> 'item_count')::integer
    from public.estimate_items as source where source.id = 'd7280000-0000-4000-8000-000000000209'$copy$,
    p_version, p_lease, p_section, p_line)
$$;
-- The takeoff's plan: its line, as read.
create or replace function pg_temp.race_plan(p_job text)
returns text language sql as $$
  select format($plan$(select jsonb_agg(jsonb_build_object('item_id', item.id, 'source_order', 0, 'rule_id', null,
    'action', 'none', 'designation', btrim(item.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null))
   from public.takeoff_items as item where item.job_id = %L)$plan$, p_job)
$$;
-- The 4-argument overload, called directly.
create or replace function pg_temp.race_apply(p_job text, p_strategy text, p_section text)
returns text language sql as $$
  select format('select count(*)::integer from public.apply_takeoff_job_guarded_atomic(%L, %L, %L, %s)',
    p_job, p_strategy, p_section, pg_temp.race_plan(p_job))
$$;
-- The route's call (src/lib/takeoff/apply-repository.ts): no page decision, no DPGF permit, so the 4-argument overload.
create or replace function pg_temp.race_route(p_job text, p_strategy text, p_section text)
returns text language sql as $$
  select format($route$select count(*)::integer from public.apply_takeoff_job_with_page_decisions(%L, %L, %L, %s,
    '[]'::jsonb, null)$route$, p_job, p_strategy, p_section, pg_temp.race_plan(p_job))
$$;
-- A copied DPGF line as the estimate holds it: quantity, provider, DPGF reference, title (null once deleted).
create or replace function pg_temp.dpgf_line(p_line text)
returns jsonb language sql as $$
  select jsonb_build_array(item.quantity, item.source_provider, item.source_metadata -> 'dpgf_source_quantity', item.title)
  from public.estimate_items as item where item.id = p_line::uuid
$$;
-- A takeoff as the estimate holds it: its status, and its lines in the estimate.
create or replace function pg_temp.takeoff_state(p_job text)
returns jsonb language sql as $$
  select jsonb_build_array(job.status, (select count(*)::integer from public.estimate_items as item
    where item.source_job_id = job.id and item.item_type = 'line'))
  from public.takeoff_jobs as job where job.id = p_job::uuid
$$;

create temp table check_race_pids(label text primary key, pid integer);
insert into check_race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('check_holder'), ('check_a'), ('check_b')) as session(name);
-- Whether p_waiter waits for p_blocker's lock, read for at most 10 s.
create or replace function pg_temp.waits_for(p_waiter text, p_blocker text)
returns boolean language plpgsql as $$
begin
  for attempt in 1..200 loop
    if (select pid from check_race_pids where label = p_blocker)
      = any(pg_catalog.pg_blocking_pids((select pid from check_race_pids where label = p_waiter)))
    then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
  return false;
end;
$$;

-- 1. The faulty order. The holder takes the version's takeoff lock, the one the application takes after its DPGF check
-- on main: A sends « Remplacer la section » and stops on it. B copies a DPGF line into that section and commits, then the
-- holder lets A go. On main, A had passed its check and emptied the section: the DPGF line was deleted.
select is(extensions.dblink_exec('check_holder', 'begin'), 'BEGIN', '1. the holder starts');
select is(extensions.dblink_exec('check_holder', $lock$do $hold$ begin perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('takeoff-rules:d7280000-0000-4000-8000-000000000101', 0)); end $hold$$lock$), 'DO',
  '1. it holds the version''s takeoff lock');
select is(extensions.dblink_send_query('check_a', pg_temp.race_apply('d7280000-0000-4000-8000-000000000301', 'replace',
  'd7280000-0000-4000-8000-000000000201')), 1, '1. A sends « Remplacer la section » on a version without a DPGF line');
select ok(pg_temp.waits_for('check_a', 'check_holder'), '1. A waits for the version''s takeoff lock');
select is((select x.copied from extensions.dblink('check_b', pg_temp.race_copy('d7280000-0000-4000-8000-000000000101',
  'd7280000-0000-4000-8000-000000000501', 'd7280000-0000-4000-8000-000000000201', 'd7280000-0000-4000-8000-000000000211'))
  as x(copied integer)), 1, '1. B copies a DPGF line into the section meanwhile and commits');
select is(extensions.dblink_exec('check_holder', 'commit'), 'COMMIT', '1. the holder lets A go');
select is((select count(*)::integer from extensions.dblink_get_result('check_a', false) as x(applied integer)), 0,
  '1. A writes nothing');
select ok(extensions.dblink_error_message('check_a') like '%TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED%',
  '1. A is refused: under the version''s lock, the version holds a DPGF line');
select is((select count(*)::integer from extensions.dblink_get_result('check_a', false) as x(applied integer)), 0, '1. A is done');
select is(pg_temp.dpgf_line('d7280000-0000-4000-8000-000000000211'), '[12, "dpgf", 12, "EF cuivre DN 22"]'::jsonb,
  '1. the DPGF line is kept, with its quantity and its DPGF reference');
select is(pg_temp.takeoff_state('d7280000-0000-4000-8000-000000000301'), '["completed", 0]'::jsonb,
  '1. the takeoff is still to apply, none of its lines in the estimate');

-- 2. The route's order. B's copy holds the version's row, uncommitted, when A applies « Fusionner » through the route. On
-- main, A's check did not see the line, A waited on the version's row, then merged its line onto the DPGF line by
-- designation and unit: the DPGF line was rewritten as an ordinary takeoff line.
select is(extensions.dblink_exec('check_b', 'begin'), 'BEGIN', '2. B starts a copy');
select is((select x.copied from extensions.dblink('check_b', pg_temp.race_copy('d7280000-0000-4000-8000-000000000102',
  'd7280000-0000-4000-8000-000000000502', 'd7280000-0000-4000-8000-000000000202', 'd7280000-0000-4000-8000-000000000212'))
  as x(copied integer)), 1, '2. B copies a DPGF line into the section, not yet committed');
select is(extensions.dblink_send_query('check_a', pg_temp.race_route('d7280000-0000-4000-8000-000000000302', 'merge',
  'd7280000-0000-4000-8000-000000000202')), 1, '2. A applies « Fusionner » through the route meanwhile');
select ok(pg_temp.waits_for('check_a', 'check_b'), '2. A waits for the copy');
select is(extensions.dblink_exec('check_b', 'commit'), 'COMMIT', '2. the copy commits');
select is((select count(*)::integer from extensions.dblink_get_result('check_a', false) as x(applied integer)), 0,
  '2. A writes nothing');
select ok(extensions.dblink_error_message('check_a') like '%TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED%',
  '2. A is refused: the copy committed before A checked');
select is((select count(*)::integer from extensions.dblink_get_result('check_a', false) as x(applied integer)), 0, '2. A is done');
select is(pg_temp.dpgf_line('d7280000-0000-4000-8000-000000000212'), '[12, "dpgf", 12, "EF cuivre DN 22"]'::jsonb,
  '2. the DPGF line is kept, with its quantity and its DPGF reference');
select is(pg_temp.takeoff_state('d7280000-0000-4000-8000-000000000302'), '["completed", 0]'::jsonb,
  '2. the takeoff is still to apply, none of its lines in the estimate');

-- 3. The application first. A applies through the route, uncommitted; B's copy waits for it, then lands beside A's line.
-- The version now holds a DPGF line: a later application without a DPGF permit is refused, and the line stays.
select is(extensions.dblink_exec('check_a', 'begin'), 'BEGIN', '3. A starts an application');
select is((select x.applied from extensions.dblink('check_a', pg_temp.race_route('d7280000-0000-4000-8000-000000000303',
  'merge', 'd7280000-0000-4000-8000-000000000203')) as x(applied integer)), 1, '3. A applies its takeoff, not yet committed');
select is(extensions.dblink_send_query('check_b', pg_temp.race_copy('d7280000-0000-4000-8000-000000000103',
  'd7280000-0000-4000-8000-000000000503', 'd7280000-0000-4000-8000-000000000203', 'd7280000-0000-4000-8000-000000000213')), 1,
  '3. B copies a DPGF line into the section meanwhile');
select ok(pg_temp.waits_for('check_b', 'check_a'), '3. the copy waits for the application');
select is(extensions.dblink_exec('check_a', 'commit'), 'COMMIT', '3. the application commits');
select is((select x.copied from extensions.dblink_get_result('check_b') as x(copied integer)), 1, '3. the copy lands after it');
select is((select count(*)::integer from extensions.dblink_get_result('check_b', false) as x(copied integer)), 0, '3. B is done');
select is(pg_temp.dpgf_line('d7280000-0000-4000-8000-000000000213'), '[12, "dpgf", 12, "EF cuivre DN 22"]'::jsonb,
  '3. the DPGF line holds its own quantity');
select is(pg_temp.takeoff_state('d7280000-0000-4000-8000-000000000303'), '["applied", 1]'::jsonb,
  '3. the takeoff''s line is beside it');
select is((select count(*)::integer from extensions.dblink('check_a', pg_temp.race_apply('d7280000-0000-4000-8000-000000000304',
  'append', 'd7280000-0000-4000-8000-000000000203'), false) as x(applied integer)), 0, '3. a later application writes nothing');
select ok(extensions.dblink_error_message('check_a') like '%TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED%',
  '3. it is refused: the version holds a DPGF line');
select is(pg_temp.dpgf_line('d7280000-0000-4000-8000-000000000213'), '[12, "dpgf", 12, "EF cuivre DN 22"]'::jsonb,
  '3. the DPGF line is unchanged');
select is(pg_temp.takeoff_state('d7280000-0000-4000-8000-000000000304'), '["completed", 0]'::jsonb,
  '3. the later takeoff is still to apply');

-- Clean the committed synthetic fixtures of this disposable database, as takeoff-page-once-race.test.sql does.
select is(extensions.dblink_exec('check_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'd7280000-0000-4000-8000-000000000001' and is_default);
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
delete from public.profiles where id = 'd7280000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd7280000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures cleaned');
select is((select count(*)::integer from public.takeoff_jobs where id in ('d7280000-0000-4000-8000-000000000301',
  'd7280000-0000-4000-8000-000000000302', 'd7280000-0000-4000-8000-000000000303', 'd7280000-0000-4000-8000-000000000304')), 0,
  'no fixture job is left');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('check_setup'), ('check_holder'), ('check_a'), ('check_b')) as session(name);
select * from finish();
rollback;
