-- The source version's tuple lock serializes duplication and deletion. Exercise both commit
-- orders on engine 2, where the original FK used to clear provenance without an error.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select dblink_connect(name, format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()))
from (values ('draft_copy'), ('draft_delete')) as sessions(name);
select dblink_exec('draft_copy', $setup$
begin;
insert into auth.users(id,email,raw_user_meta_data) values
  ('dd730000-0000-4000-8000-000000000001','draft-copy@example.test','{}');
insert into public.estimate_projects(id,tenant_id,user_id,name)
select 'dd730000-0000-4000-8000-000000000010',tenant_id,user_id,'Draft copy'
from public.tenant_memberships where user_id='dd730000-0000-4000-8000-000000000001' and is_default;
insert into public.estimate_versions(id,tenant_id,project_id,version_number,status,calc_engine_version,margin_multiplier,tax_rate_bp)
select ('dd730000-0000-4000-8000-00000000001'||n)::uuid, tenant_id,id,n,'draft',2,1,0
from public.estimate_projects cross join generate_series(1,2) n where id='dd730000-0000-4000-8000-000000000010';
insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by)
select ('dd730000-0000-4000-8000-00000000002'||version_number)::uuid,tenant_id,id,'A','dd730000-0000-4000-8000-000000000001'
from public.estimate_versions where project_id='dd730000-0000-4000-8000-000000000010';
insert into public.estimate_items(tenant_id,version_id,item_type,position,title)
select tenant_id,id,'section',0,'Sanitaires' from public.estimate_versions
where project_id='dd730000-0000-4000-8000-000000000010';
insert into public.estimate_items(tenant_id,version_id,parent_id,item_type,position,title,source_provider,source_job_id,quantity,
  unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
select j.tenant_id,j.estimate_version_id,s.id,'line',1,'Lavabo','takeoff',j.id,3,0,0,1,0,1,0,0,0,0
from public.takeoff_jobs j join public.estimate_items s on s.version_id=j.estimate_version_id and s.item_type='section'
where j.project_id='dd730000-0000-4000-8000-000000000010';
commit;
$setup$);
select dblink_exec(name, $auth$
  set statement_timeout = '15s';
  set request.jwt.claim.sub = 'dd730000-0000-4000-8000-000000000001';
  set role authenticated;
$auth$) from (values ('draft_copy'), ('draft_delete')) as sessions(name);
create temp table pids as select name, backend.pid from (values ('draft_copy'), ('draft_delete')) as sessions(name)
cross join lateral dblink(name, 'select pg_backend_pid()') as backend(pid int);

create function pg_temp.blocked(waiter text, holder text) returns boolean language plpgsql as $$
declare
  waiting int := (select pid from pids where name = waiter);
  holding int := (select pid from pids where name = holder);
begin
  for n in 1..200 loop
    if holding = any(pg_blocking_pids(waiting)) then return true; end if;
    perform pg_sleep(0.025);
  end loop;
  return false;
end;
$$;

select dblink_exec('draft_copy','begin');
create temp table new_copy as select id from dblink('draft_copy',
  $$select public.duplicate_estimate_version('dd730000-0000-4000-8000-000000000011',false)$$) as c(id uuid);
select dblink_send_query('draft_delete',
  $$delete from public.estimate_versions where id='dd730000-0000-4000-8000-000000000011' returning id$$);
select ok(pg_temp.blocked('draft_delete','draft_copy'),'deletion waits for the uncommitted copy');
select dblink_exec('draft_copy','commit');
select count(*) from dblink_get_result('draft_delete',false) as d(id uuid);
select matches(dblink_error_message('draft_delete'),'ESTIMATE_DRAFT_TAKEOFF_IN_USE', 'the committed copy prevents deletion');
select count(*) from dblink_get_result('draft_delete',false) as d(id uuid);
select results_eq($$select source_job_id,quantity from public.estimate_items where version_id=(select id from new_copy) and item_type='line'$$,
  $$values ('dd730000-0000-4000-8000-000000000021'::uuid,3::numeric)$$,'the copied line keeps its job and quantity');

select dblink_exec('draft_delete','begin');
select is(dblink_exec('draft_delete',$$delete from public.estimate_versions where id='dd730000-0000-4000-8000-000000000012'$$),
  'DELETE 1','unreferenced source is deleted');
select dblink_send_query('draft_copy',
  $$select public.duplicate_estimate_version('dd730000-0000-4000-8000-000000000012',false)$$);
select ok(pg_temp.blocked('draft_copy','draft_delete'),'copy waits for the uncommitted deletion');
select dblink_exec('draft_delete','commit');
select count(*) from dblink_get_result('draft_copy',false) as d(id uuid);
select matches(dblink_error_message('draft_copy'),'Estimate version not found or access denied', 'a committed deletion prevents duplication');
select count(*) from dblink_get_result('draft_copy',false) as d(id uuid);
select is((select count(*) from public.estimate_versions where project_id='dd730000-0000-4000-8000-000000000010'),
  2::bigint,'only the first source and its copy survive');

select dblink_exec('draft_copy','reset role');
select dblink_exec('draft_copy',$cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'dd730000-0000-4000-8000-000000000001' and is_default);
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
  delete from public.audit_logs where tenant_id = target;
  delete from public.tenants where id = target;
end
$clean$;
delete from public.profiles where id = 'dd730000-0000-4000-8000-000000000001';
delete from auth.users where id = 'dd730000-0000-4000-8000-000000000001';
commit;
$cleanup$);
select dblink_disconnect(name) from (values ('draft_copy'), ('draft_delete')) as sessions(name);
select * from finish();
rollback;
