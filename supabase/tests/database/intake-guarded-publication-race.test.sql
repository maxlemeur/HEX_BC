-- The worker has its model response. A second session is committing a new category.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
select dblink_connect('editor',format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'),',',1)),current_setting('port'),current_database()));
select dblink_exec('editor',$setup$
  create function pg_temp.f(n integer) returns uuid language sql immutable as
    'select (''ae570000-0000-4000-8000-''||lpad(n::text,12,''0''))::uuid';
  begin;
  insert into auth.users(id,email,email_confirmed_at) values(pg_temp.f(1),'intake-publication-race@example.test',now());
  insert into public.estimate_projects(id,tenant_id,user_id,name)
    select pg_temp.f(20),tenant_id,user_id,'Fixture' from public.tenant_memberships where user_id=pg_temp.f(1) and is_default;
  insert into public.affaire_intake_uploads(id,project_id,created_by,status,processing_lease_token,processing_lease_expires_at)
    values(pg_temp.f(30),pg_temp.f(20),pg_temp.f(1),'processing',pg_temp.f(60),now()+interval '10 minutes');
  insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status,document_kind)
    values(pg_temp.f(40),pg_temp.f(30),'Exemple.pdf','uploaded','classified','plans');
  commit;
$setup$);
create temp table model_input as select jsonb_build_array(jsonb_build_object('id',id,'updated_at',updated_at,'document_kind',document_kind)) manifest
  from public.affaire_intake_documents where id='ae570000-0000-4000-8000-000000000040';
grant select on model_input to service_role;
create function pg_temp.publish() returns uuid language sql as $$
  select public.publish_affaire_intake_brief('ae570000-0000-4000-8000-000000000030','ae570000-0000-4000-8000-000000000060',
    null,manifest,null,'{"summary":"Résultat du plan","project_object":"Fixture"}','[]') from model_input
$$;
select dblink_exec('editor',$edit$
  begin;
  update public.affaire_intake_documents set document_kind='cctp' where id=pg_temp.f(40);
$edit$);
set local role service_role;
set local lock_timeout='200ms';
select throws_ok('select pg_temp.publish()','55P03',null,'publishing waits for an uncommitted change to an input');
reset role;
select dblink_exec('editor','commit');
set local role service_role;
select throws_ok('select pg_temp.publish()','40001','INTAKE_BRIEF_INPUT_CHANGED','after the edit commits, the held response cannot publish');
select is((select count(*) from public.affaire_briefs where project_id='ae570000-0000-4000-8000-000000000020'),0::bigint,'no stale draft was offered');
reset role;
select dblink_exec('editor',$cleanup$
  begin;
  create temp table own_tenant as select tenant_id from public.tenant_memberships where user_id=pg_temp.f(1);
  delete from public.estimate_projects where id=pg_temp.f(20);
  delete from public.feature_flags where tenant_id in (select tenant_id from own_tenant);
  delete from public.estimate_rules where tenant_id in (select tenant_id from own_tenant);
  delete from public.audit_logs where tenant_id in (select tenant_id from own_tenant);
  delete from auth.users where id=pg_temp.f(1);
  delete from public.tenants where id in (select tenant_id from own_tenant);
  commit;
$cleanup$);
select dblink_disconnect('editor');
select * from finish();
rollback;
