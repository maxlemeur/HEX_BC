-- Commit only the remote fixtures so two real sessions can contend on the same dossier.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();
create temp table sessions as select name, format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)),current_setting('port'),current_database()) as conn
  from (values ('depositor'),('launcher')) as connections(name);
select is(dblink_connect(name,conn),'OK',name || ' connected') from sessions;
select dblink_exec('depositor',$remote$
  create function pg_temp.f(n integer) returns uuid language sql immutable as 'select (''ae200000-0000-4000-8000-'' || lpad(n::text,12,''0''))::uuid';
  begin;
  insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) select pg_temp.f(n),'intake-race-'||n||'@example.test','{}',now() from generate_series(1,2) n;
  update public.tenant_memberships set is_default=false where user_id in (pg_temp.f(1),pg_temp.f(2));
  insert into public.tenants(id,name,slug) values(pg_temp.f(10),'Course fictive','intake-launch-race-tests');
  insert into public.tenant_memberships(tenant_id,user_id,role,is_default) values(pg_temp.f(10),pg_temp.f(1),'engineer',true),(pg_temp.f(10),pg_temp.f(2),'admin',true);
  insert into public.estimate_projects(id,tenant_id,user_id,name) values(pg_temp.f(20),pg_temp.f(10),pg_temp.f(1),'Dossier fictif');
  insert into public.affaire_intake_uploads(id,project_id,created_by,status) values(pg_temp.f(41),pg_temp.f(20),pg_temp.f(1),'deposited');
  insert into public.affaire_briefs(project_id,status,summary,project_object) values(pg_temp.f(20),'a_confirmer','Résumé fictif','Objet fictif');
  commit;
  set role authenticated;
  set request.jwt.claim.sub='ae200000-0000-4000-8000-000000000001';
  begin;
  insert into public.affaire_intake_documents(id,created_by,upload_id,file_name,storage_path,upload_status,classification_status)
    values(pg_temp.f(51),pg_temp.f(1),pg_temp.f(41),'scan.pdf','fixture/51','uploaded','awaiting_launch');
$remote$);
select dblink_exec('launcher',$remote$
  set role authenticated;
  set request.jwt.claim.sub='ae200000-0000-4000-8000-000000000002';
  set lock_timeout='150ms';
$remote$);
select throws_ok($$select dblink_exec('launcher',$cmd$update public.affaire_briefs set status='confirme',confirmed_by='ae200000-0000-4000-8000-000000000002',
  confirmed_at=now() where project_id='ae200000-0000-4000-8000-000000000020'$cmd$)$$,
  '55P03',null,'confirmation waits for the uncommitted deposit');
select dblink_exec('depositor','commit');
select throws_ok($$select dblink_exec('launcher',$cmd$update public.affaire_briefs set status='confirme',confirmed_by='ae200000-0000-4000-8000-000000000002',
  confirmed_at=now() where project_id='ae200000-0000-4000-8000-000000000020'$cmd$)$$,
  'P0001','INTAKE_ANALYSIS_REQUIRED','confirmation sees the newly committed piece');
select dblink_exec('launcher','begin');
create temp table winner as select * from dblink('launcher',
  $$select launch_id,outcome from public.launch_affaire_intake_analysis('ae200000-0000-4000-8000-000000000020',true)$$) as r(id uuid,outcome text);
select is((select outcome from winner),'launched','admin locks the waiting piece and its payer');
select dblink_exec('depositor',$$set lock_timeout='150ms'$$);
create function pg_temp.competing_press() returns table(id uuid,outcome text) language sql as $$
  select * from extensions.dblink('depositor',$cmd$select launch_id,outcome from public.launch_affaire_intake_analysis('ae200000-0000-4000-8000-000000000020',false)$cmd$)
    as r(id uuid,outcome text)
$$;
select throws_ok('select * from pg_temp.competing_press()','55P03',null,'depositor pressing concurrently waits for the admin');
select dblink_exec('launcher','commit');
select results_eq('select * from pg_temp.competing_press()', $$select id,'already_running'::text from winner$$,'depositor gets the first launch after commit');
select results_eq($$select created_by,launch_read_scans from public.affaire_intake_uploads where id=(select id from winner)$$,
  $$values ('ae200000-0000-4000-8000-000000000002'::uuid,true)$$,'the first payer and reading choice survive both presses');
select dblink_exec('depositor',$remote$
  reset role;
  begin;
  create temp table cleanup_tenants as select distinct tenant_id from public.tenant_memberships where user_id in (pg_temp.f(1),pg_temp.f(2))
    and (tenant_id=pg_temp.f(10) or tenant_id in (select id from public.tenants where created_by in (pg_temp.f(1),pg_temp.f(2))));
  delete from public.estimate_projects where id=pg_temp.f(20);
  delete from public.tenant_memberships where tenant_id=pg_temp.f(10);
  delete from public.feature_flags where tenant_id in (select tenant_id from cleanup_tenants);
  delete from public.estimate_rules where tenant_id in (select tenant_id from cleanup_tenants);
  delete from public.audit_logs where tenant_id in (select tenant_id from cleanup_tenants);
  delete from auth.users where id in (pg_temp.f(1),pg_temp.f(2));
  delete from public.tenants where id in (select tenant_id from cleanup_tenants);
  commit;
$remote$);
select dblink_disconnect(name) from sessions;
select * from finish();
rollback;
