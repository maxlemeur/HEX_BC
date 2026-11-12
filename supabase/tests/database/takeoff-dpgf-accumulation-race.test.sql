-- TI-682 lot D4 (migration …_takeoff_dpgf_accumulation.sql): two applications that feed one DPGF target at the same time
-- never lose each other's measure. Each service permit is bound to the target as it read it (its updated_at and its
-- composition); the second application waits for the version's lock, then finds the target changed under it and is
-- refused (TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE). Read again, it applies, and the target sums the three takeoffs.
-- Isolation justified: two applications interleave only across two sessions, which no journey drives deterministically.
-- Written before the migration: red on 32b078dd (once read again, the third takeoff overwrote the target: 4, not 9).
-- All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create temp table dpgf_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect(session.name, (select connection from dpgf_race_connection)), 'OK', format('%s connected', session.name))
from (values ('dpgf_setup'), ('dpgf_a'), ('dpgf_b')) as session(name);

-- One engineer, one engine 2 draft with a DPGF line (reference 1 ml), three takeoffs of three pages feeding it.
select is(extensions.dblink_exec('dpgf_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd4900000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'dpgf-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role where user_id = 'd4900000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd4900000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Course d''une ligne DPGF (fictif)', false
from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select 'd4900000-0000-4000-8000-000000000101', m.tenant_id, 'd4900000-0000-4000-8000-000000000010', 1, 'draft', 2, 1, 0
from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
select 'd4900000-0000-4000-8000-000000000201', m.tenant_id, 'd4900000-0000-4000-8000-000000000101', 'section', 0, 'Lot fictif'
from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
  unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
  line_total_ttc_cents, source_provider, source_file_name, source_page, source_metadata, fo_provision)
select 'd4900000-0000-4000-8000-000000000202', m.tenant_id, 'd4900000-0000-4000-8000-000000000101',
  'd4900000-0000-4000-8000-000000000201', 'line', 1, 'EF cuivre DN 22', 'ml', 1, null, 1000, 0, 1, 0, 1, 1000, 1000, 0, 1000,
  'dpgf', 'dpgf-fictif.xlsx', 7, '{"dpgf_source_quantity":1,"dpgf_source_unit":"ml"}'::jsonb, 1
from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select 'd4900000-0000-4000-8000-000000000101', m.user_id, m.tenant_id, now() + interval '30 minutes', 'd4900000-0000-4000-8000-000000000501'
from public.tenant_memberships m where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select job.id, m.tenant_id, 'd4900000-0000-4000-8000-000000000101', 'B', 'completed', 'plan-fictif.pdf', m.user_id
from public.tenant_memberships m cross join (values ('d4900000-0000-4000-8000-000000000301'::uuid),
  ('d4900000-0000-4000-8000-000000000302'::uuid), ('d4900000-0000-4000-8000-000000000303'::uuid)) as job(id)
where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
  source_page, metadata, rule_results)
select line.id, m.tenant_id, line.job_id, 'EF cuivre DN 22', line.quantity, 'ml', 0.95, 'Repère localisé', 'plan-fictif.pdf',
  line.page, '{"source_document":{"kind":"plan_file","plan_file_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}'::jsonb, '[]'::jsonb
from public.tenant_memberships m cross join (values
  ('d4900000-0000-4000-8000-000000000401'::uuid, 'd4900000-0000-4000-8000-000000000301'::uuid, 2, 1),
  ('d4900000-0000-4000-8000-000000000402'::uuid, 'd4900000-0000-4000-8000-000000000302'::uuid, 3, 2),
  ('d4900000-0000-4000-8000-000000000403'::uuid, 'd4900000-0000-4000-8000-000000000303'::uuid, 4, 3)
) as line(id, job_id, quantity, page) where m.user_id = 'd4900000-0000-4000-8000-000000000001' and m.is_default;
commit;
$setup$), 'COMMIT', 'fixtures committed');

-- The service permit of a takeoff, as the target is when it is minted (its updated_at and its metadata).
create or replace function pg_temp.race_permit(p_job text, p_token text)
returns text language sql as $$
  select format($permit$insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id,
    authorization_token_hash, review_summary, expires_at)
  select target.tenant_id, %1$L, target.version_id, 'd4900000-0000-4000-8000-000000000001',
    encode(sha256(convert_to(%2$L, 'UTF8')), 'hex'), jsonb_build_object('quantity_policy', jsonb_build_array(jsonb_build_object(
      'target_id', target.id, 'expected_updated_at', target.updated_at, 'reference_quantity', 1,
      'measured_quantity', source.quantity, 'priced_quantity', greatest(1, source.quantity), 'absolute_gap', abs(source.quantity - 1),
      'reviewed', false, 'source_file_name', 'dpgf-fictif.xlsx', 'source_page', 7, 'source_metadata', target.source_metadata,
      'takeoff_items', jsonb_build_array(jsonb_build_object('id', source.id, 'quantity', source.quantity, 'updated_at', source.updated_at,
        'measured', source.quantity, 'protective', 0, 'printed_gap', 0))))), now() + interval '5 minutes'
  from public.estimate_items target, public.takeoff_items source
  where target.id = 'd4900000-0000-4000-8000-000000000202' and source.job_id = %1$L$permit$, p_job, p_token)
$$;
create or replace function pg_temp.race_apply(p_job text, p_token text)
returns text language sql as $$
  select format($apply$select count(*)::integer from public.apply_takeoff_job_guarded_atomic(%1$L, 'merge',
    'd4900000-0000-4000-8000-000000000201', (select jsonb_agg(jsonb_build_object('item_id', item.id, 'source_order', 0, 'rule_id', null,
      'action', 'none', 'designation', btrim(item.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null))
      from public.takeoff_items as item where item.job_id = %1$L), %2$L)$apply$, p_job, p_token)
$$;
create or replace function pg_temp.the_target()
returns jsonb language sql as $$
  select jsonb_build_array(item.quantity, (select jsonb_agg((entry ->> 'quantity')::numeric order by (entry ->> 'quantity')::numeric)
    from jsonb_array_elements(item.source_metadata #> '{takeoff_quantity_policy,contributions}') as entry))
  from public.estimate_items item where item.id = 'd4900000-0000-4000-8000-000000000202'
$$;

select is(extensions.dblink_exec('dpgf_setup', pg_temp.race_permit('d4900000-0000-4000-8000-000000000301', 'race-m1')), 'INSERT 0 1',
  'the first takeoff''s permit');
select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as the engineer', session.name))
from (values ('dpgf_setup'), ('dpgf_a'), ('dpgf_b')) as session(name);
select is((select claims.sub from extensions.dblink(session.name, $claims$select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"d4900000-0000-4000-8000-000000000001"}', false), set_config('request.jwt.claim.sub',
  'd4900000-0000-4000-8000-000000000001', false)$claims$) as claims(full_claims text, sub text)),
  'd4900000-0000-4000-8000-000000000001', format('%s carries the engineer''s claims', session.name))
from (values ('dpgf_setup'), ('dpgf_a'), ('dpgf_b')) as session(name);
select is((select x.applied from extensions.dblink('dpgf_setup', pg_temp.race_apply('d4900000-0000-4000-8000-000000000301', 'race-m1'))
  as x(applied integer)), 1, 'the first takeoff feeds the target');

-- Both later permits are minted from the same state of the target.
select is(extensions.dblink_exec('dpgf_setup', 'reset role'), 'RESET', 'the service mints the permits');
select is(extensions.dblink_exec('dpgf_setup', pg_temp.race_permit('d4900000-0000-4000-8000-000000000302', 'race-m2')), 'INSERT 0 1',
  'the second takeoff''s permit');
select is(extensions.dblink_exec('dpgf_setup', pg_temp.race_permit('d4900000-0000-4000-8000-000000000303', 'race-m3')), 'INSERT 0 1',
  'the third takeoff''s permit, read from the same target');

create temp table dpgf_race_pids(label text primary key, pid integer);
insert into dpgf_race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('dpgf_a'), ('dpgf_b')) as session(name);

select is(extensions.dblink_exec('dpgf_a', 'begin'), 'BEGIN', 'the second takeoff''s application starts');
select is((select x.applied from extensions.dblink('dpgf_a', pg_temp.race_apply('d4900000-0000-4000-8000-000000000302', 'race-m2'))
  as x(applied integer)), 1, 'it feeds the target, not yet committed');
select is(extensions.dblink_send_query('dpgf_b', pg_temp.race_apply('d4900000-0000-4000-8000-000000000303', 'race-m3')), 1,
  'the third takeoff is applied meanwhile');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('dpgf_b'), 1, 'it waits');
select ok(exists (select 1 from pg_catalog.pg_locks as held where held.locktype = 'advisory' and not held.granted
    and held.pid = (select pid from dpgf_race_pids where label = 'dpgf_b')
    and ((held.classid::bigint << 32) | held.objid::bigint) = pg_catalog.hashtextextended('takeoff-rules:d4900000-0000-4000-8000-000000000101', 0)),
  'on the version''s lock, before it reads the target');
select is(extensions.dblink_exec('dpgf_a', 'commit'), 'COMMIT', 'the second takeoff commits');
select is((select count(*)::integer from extensions.dblink_get_result('dpgf_b', false) as x(applied integer)), 0, 'the third writes nothing');
select ok(extensions.dblink_error_message('dpgf_b') like '%TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE%',
  'the third is refused: its permit read the target before the second wrote it');
select is((select count(*)::integer from extensions.dblink_get_result('dpgf_b', false) as x(applied integer)), 0, 'the third is done');
select is(pg_temp.the_target(), '[5, [2, 3]]'::jsonb, 'the target holds the first two takeoffs, 2 + 3');

-- Read again, the third applies on what the second wrote.
select is(extensions.dblink_exec('dpgf_setup', pg_temp.race_permit('d4900000-0000-4000-8000-000000000303', 'race-m3b')), 'INSERT 0 1',
  'the third takeoff''s permit, read again');
select is((select x.applied from extensions.dblink('dpgf_b', pg_temp.race_apply('d4900000-0000-4000-8000-000000000303', 'race-m3b'))
  as x(applied integer)), 1, 'the third applies');
select is(pg_temp.the_target(), '[9, [2, 3, 4]]'::jsonb, 'the target sums the three takeoffs: none lost another''s');

-- Clean the committed synthetic fixtures of this disposable database, as takeoff-page-once-race.test.sql does.
select is(extensions.dblink_exec('dpgf_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'd4900000-0000-4000-8000-000000000001' and is_default);
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
delete from public.profiles where id = 'd4900000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd4900000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures cleaned');
select is((select count(*)::integer from public.takeoff_jobs where id in ('d4900000-0000-4000-8000-000000000301',
  'd4900000-0000-4000-8000-000000000302', 'd4900000-0000-4000-8000-000000000303')), 0, 'no fixture job is left');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('dpgf_setup'), ('dpgf_a'), ('dpgf_b')) as session(name);
select * from finish();
rollback;
