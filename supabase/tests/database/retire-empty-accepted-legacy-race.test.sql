begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- All sessions connect to the same disposable local PostgreSQL socket. The
-- setup below is committed solely because independent sessions must see it.
create temp table retire_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)),current_setting('port'),current_database()) as connection;
select is(extensions.dblink_connect('retire_setup',(select connection from retire_race_connection)),'OK','fixture session connected');
select is(extensions.dblink_connect('retire_a',(select connection from retire_race_connection)),'OK','first maintenance session connected');
select is(extensions.dblink_connect('retire_b',(select connection from retire_race_connection)),'OK','second maintenance session connected');
select is(extensions.dblink_connect('retire_project',(select connection from retire_race_connection)),'OK','application session connected');
select is(extensions.dblink_connect('retire_writer',(select connection from retire_race_connection)),'OK','concurrent writer connected');
select is(extensions.dblink_connect('retire_storage',(select connection from retire_race_connection)),'OK','concurrent Storage writer connected');

select is(extensions.dblink_exec('retire_b','begin isolation level repeatable read'),'BEGIN','repeatable-read session started');
select is((select count(*)::integer from extensions.dblink('retire_b',
  'select private.retire_empty_accepted_legacy_estimate(null,null,null,null,null,null,null)',false) as x(result jsonb)),0,'repeatable-read call returns no result');
select ok(extensions.dblink_error_message('retire_b') like '%LEGACY_RETIRE_ISOLATION_MISMATCH%','repeatable-read caller is refused before any write');
select is(extensions.dblink_exec('retire_b','rollback'),'ROLLBACK','repeatable-read session reset');

select is(extensions.dblink_exec('retire_setup',$setup$
begin;
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','7a000000-0000-4000-8000-000000000001','authenticated','authenticated','retire-race@example.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now(),'','','','');
insert into public.estimate_projects(id,tenant_id,user_id,name,is_archived)
select x.project_id,m.tenant_id,m.user_id,x.name,false from public.tenant_memberships m cross join (values
 ('7a000000-0000-4000-8000-000000000010'::uuid,'retire race A'),
 ('7a000000-0000-4000-8000-000000000020'::uuid,'retire race B')
) x(project_id,name) where m.user_id='7a000000-0000-4000-8000-000000000001' and m.is_default;
set local miaouffrage.estimate_version_insert_contract = 'legacy_v1';
insert into public.estimate_versions(id,tenant_id,project_id,version_number,status,calc_engine_version)
select x.version_id,m.tenant_id,x.project_id,1,'accepted'::public.estimate_status,1
from public.tenant_memberships m cross join (values
 ('7a000000-0000-4000-8000-000000000011'::uuid,'7a000000-0000-4000-8000-000000000010'::uuid),
 ('7a000000-0000-4000-8000-000000000021'::uuid,'7a000000-0000-4000-8000-000000000020'::uuid)
) x(version_id,project_id) where m.user_id='7a000000-0000-4000-8000-000000000001' and m.is_default;
insert into public.plan_sets(id,tenant_id,project_id,estimate_version_id,name,created_by)
select x.set_id,m.tenant_id,x.project_id,x.version_id,'race plan',m.user_id from public.tenant_memberships m cross join (values
 ('7a000000-0000-4000-8000-000000000012'::uuid,'7a000000-0000-4000-8000-000000000010'::uuid,'7a000000-0000-4000-8000-000000000011'::uuid),
 ('7a000000-0000-4000-8000-000000000022'::uuid,'7a000000-0000-4000-8000-000000000020'::uuid,'7a000000-0000-4000-8000-000000000021'::uuid)
) x(set_id,project_id,version_id) where m.user_id='7a000000-0000-4000-8000-000000000001' and m.is_default;
insert into public.plan_files(id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,created_by)
select x.file_id,m.tenant_id,x.set_id,m.tenant_id::text||'/'||x.set_id::text||'/'||x.file_id::text||'/fixture.pdf','fixture.pdf','application/pdf',10,m.user_id
from public.tenant_memberships m cross join (values
 ('7a000000-0000-4000-8000-000000000013'::uuid,'7a000000-0000-4000-8000-000000000012'::uuid),
 ('7a000000-0000-4000-8000-000000000023'::uuid,'7a000000-0000-4000-8000-000000000022'::uuid)
) x(file_id,set_id) where m.user_id='7a000000-0000-4000-8000-000000000001' and m.is_default;
-- Committed metadata is required so the competing session can update a real
-- row. This models the Storage catalog only, not physical file bytes.
insert into storage.objects (bucket_id,name,metadata)
select 'plan-files',file_path,'{"size":10}'::jsonb from public.plan_files
where id='7a000000-0000-4000-8000-000000000013';
insert into public.estimate_version_events(id,tenant_id,estimate_version_id,event_type,created_by,metadata)
select x.event_id,m.tenant_id,x.version_id,'approval_rules_evaluated',m.user_id,'{"fixture":true}'::jsonb
from public.tenant_memberships m cross join (values
 ('7a000000-0000-4000-8000-000000000014'::uuid,'7a000000-0000-4000-8000-000000000011'::uuid),
 ('7a000000-0000-4000-8000-000000000024'::uuid,'7a000000-0000-4000-8000-000000000021'::uuid)
) x(event_id,version_id) where m.user_id='7a000000-0000-4000-8000-000000000001' and m.is_default;
commit;
$setup$),'COMMIT','concurrent fixtures committed');
select ok(exists(select 1 from storage.objects o join public.plan_files pf on pf.file_path=o.name
  where pf.id='7a000000-0000-4000-8000-000000000013' and o.bucket_id='plan-files'),
  'committed Storage descriptor is visible to independent sessions');

create temp table retire_race_queries(label text primary key,query text);
insert into retire_race_queries values
 ('a',$query$select private.retire_empty_accepted_legacy_estimate(
  (select tenant_id from public.estimate_projects where id='7a000000-0000-4000-8000-000000000010'),
  '7a000000-0000-4000-8000-000000000010','7a000000-0000-4000-8000-000000000011',
  '7a000000-0000-4000-8000-000000000012','7a000000-0000-4000-8000-000000000013',
  array['7a000000-0000-4000-8000-000000000014'::uuid],
  array(select id from public.audit_logs where estimate_version_id='7a000000-0000-4000-8000-000000000011' order by id))$query$),
 ('b',$query$select private.retire_empty_accepted_legacy_estimate(
  (select tenant_id from public.estimate_projects where id='7a000000-0000-4000-8000-000000000020'),
  '7a000000-0000-4000-8000-000000000020','7a000000-0000-4000-8000-000000000021',
  '7a000000-0000-4000-8000-000000000022','7a000000-0000-4000-8000-000000000023',
  array['7a000000-0000-4000-8000-000000000024'::uuid],
  array(select id from public.audit_logs where estimate_version_id='7a000000-0000-4000-8000-000000000021' order by id))$query$);

-- Real application order: hold the target project, then acquire the versions
-- table. Maintenance must fail NOWAIT rather than deadlock or abort this session.
select is(extensions.dblink_exec('retire_project','begin'),'BEGIN','application transaction started');
select is((select count(*)::integer from extensions.dblink('retire_project',
 'select id from public.estimate_projects where id=''7a000000-0000-4000-8000-000000000020'' for update') as x(id uuid)),1,'application holds project row');
select is(extensions.dblink_send_query('retire_a',(select query from retire_race_queries where label='b')),1,'maintenance starts against held project');
select is((select count(*)::integer from extensions.dblink_get_result('retire_a',false) as x(result jsonb)),0,'maintenance does not delete while project is held');
select ok(extensions.dblink_error_message('retire_a') like '%could not obtain lock%','maintenance fails immediately on occupied project');
select is(extensions.dblink_exec('retire_project','update public.estimate_versions set updated_at=updated_at where false',false),'UPDATE 0','application transaction can continue to its versions write');
select is(extensions.dblink_exec('retire_project','rollback'),'ROLLBACK','application transaction closes without being aborted');
select count(*) from extensions.dblink_get_result('retire_a',false) as x(result jsonb);

create temp table retire_race_time(started_at timestamptz,ended_at timestamptz);
insert into retire_race_time values(clock_timestamp(),null);
select is(extensions.dblink_exec('retire_a','begin'),'BEGIN','first maintenance transaction started');
select is(extensions.dblink_exec('retire_a', $$set local statement_timeout = '10s'$$),'SET','maintenance statement timeout configured');
select ok((select (x.result->>'guard_restored')::boolean from extensions.dblink('retire_a',
  (select query from retire_race_queries where label='a')) as x(result jsonb)),
  'first target removed while transaction remains uncommitted');
select is(extensions.dblink_send_query('retire_b',(select query from retire_race_queries where label='b')),1,'second admissible target starts before first commit');
select is(extensions.dblink_send_query('retire_writer','with u as (update public.estimate_versions set updated_at=updated_at where false returning id) select count(*)::integer from u'),1,'concurrent estimate writer starts');
select is(extensions.dblink_send_query('retire_storage',$writer$with u as (
  update storage.objects set metadata=metadata where bucket_id='plan-files' and name=(
    select file_path from public.plan_files where id='7a000000-0000-4000-8000-000000000013'
  ) returning id) select count(*)::integer from u$writer$),1,'concurrent Storage writer starts');
select pg_sleep(0.1);
select is(extensions.dblink_is_busy('retire_b'),1,'second maintenance call waits for first');
select is(extensions.dblink_is_busy('retire_writer'),1,'estimate writer waits during maintenance');
select is(extensions.dblink_is_busy('retire_storage'),1,'Storage writer waits during maintenance');
select is(md5(pg_get_functiondef('public.guard_estimate_versions_delete_draft_only()'::regprocedure)),
 '84c050bbd790875f403d24077ba53395','independent session sees original guard before commit');
select is(extensions.dblink_exec('retire_a','commit'),'COMMIT','first maintenance commits and releases locks');
update retire_race_time set ended_at=clock_timestamp();
select is((select count(*)::integer from extensions.dblink_get_result('retire_b',false) as x(result jsonb)),0,'second target is not deleted');
select ok(extensions.dblink_error_message('retire_b') like '%LEGACY_RETIRE_ALREADY_CONSUMED%','second call observes committed one-shot audit marker');
select is((select x.n from extensions.dblink_get_result('retire_writer') as x(n integer)),0,'estimate writer resumes after commit');
select is((select x.n from extensions.dblink_get_result('retire_storage') as x(n integer)),1,'Storage writer updates the real row after commit');
select diag(format('local transaction duration: %s ms including an intentional 100 ms concurrent-writer observation',
 round(extract(epoch from ((select ended_at-started_at from retire_race_time)))*1000)));
select ok(exists(select 1 from public.estimate_versions where id='7a000000-0000-4000-8000-000000000021'),'second admissible target remains intact');
select ok(exists(select 1 from public.plan_sets where id='7a000000-0000-4000-8000-000000000022' and estimate_version_id='7a000000-0000-4000-8000-000000000021'),'second target retains its plan');

-- Clean only the committed synthetic fixture in this disposable database. The
-- second deletion is test cleanup, after removing the first synthetic marker.
select is(extensions.dblink_exec('retire_setup',$cleanup_before$
delete from public.audit_logs where table_name='estimate_version_maintenance'
  and record_id='7a000000-0000-4000-8000-000000000011';
$cleanup_before$),'DELETE 1','synthetic one-shot marker removed for fixture cleanup');
select ok((select (x.result->>'guard_restored')::boolean from extensions.dblink('retire_setup',(select query from retire_race_queries where label='b')) as x(result jsonb)),'second synthetic target removed for cleanup');
select is(extensions.dblink_exec('retire_setup',$cleanup$
begin;
delete from public.plan_files where id in ('7a000000-0000-4000-8000-000000000013','7a000000-0000-4000-8000-000000000023');
set local storage.allow_delete_query='true';
delete from storage.objects where bucket_id='plan-files' and name=(
  select tenant_id::text||'/7a000000-0000-4000-8000-000000000012/7a000000-0000-4000-8000-000000000013/fixture.pdf'
  from public.tenant_memberships where user_id='7a000000-0000-4000-8000-000000000001' and is_default
);
delete from public.plan_sets where id in ('7a000000-0000-4000-8000-000000000012','7a000000-0000-4000-8000-000000000022');
delete from public.estimate_projects where id in ('7a000000-0000-4000-8000-000000000010','7a000000-0000-4000-8000-000000000020');
delete from public.estimate_rules where tenant_id=(select tenant_id from public.tenant_memberships where user_id='7a000000-0000-4000-8000-000000000001' and is_default);
delete from public.audit_logs where tenant_id=(select tenant_id from public.tenant_memberships where user_id='7a000000-0000-4000-8000-000000000001' and is_default);
delete from public.feature_flags where tenant_id=(select tenant_id from public.tenant_memberships where user_id='7a000000-0000-4000-8000-000000000001' and is_default);
delete from public.tenants where id=(select tenant_id from public.tenant_memberships where user_id='7a000000-0000-4000-8000-000000000001' and is_default);
delete from auth.users where id='7a000000-0000-4000-8000-000000000001';
commit;
$cleanup$),'COMMIT','synthetic fixtures cleaned');
select is(extensions.dblink_disconnect('retire_setup'),'OK','fixture session disconnected');
select is(extensions.dblink_disconnect('retire_a'),'OK','first maintenance session disconnected');
select is(extensions.dblink_disconnect('retire_b'),'OK','second maintenance session disconnected');
select is(extensions.dblink_disconnect('retire_project'),'OK','application session disconnected');
select is(extensions.dblink_disconnect('retire_writer'),'OK','writer disconnected');
select is(extensions.dblink_disconnect('retire_storage'),'OK','Storage writer disconnected');
select * from finish();
rollback;
