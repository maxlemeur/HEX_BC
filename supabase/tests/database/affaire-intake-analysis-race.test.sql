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
  insert into public.estimate_projects(id,tenant_id,user_id,name) values(pg_temp.f(21),pg_temp.f(10),pg_temp.f(1),'Dossier vide fictif');
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
-- A second, empty dossier lets us check only the permission decision while a press waits.
select dblink_exec('depositor',$setup$
  reset role;
  begin;
  do $$begin perform private.lock_affaire_intake_analysis(pg_temp.f(21)); end$$;
$setup$);
select dblink_exec('launcher',$setup$
  reset lock_timeout;
  set statement_timeout='10s';
  create function pg_temp.press_test_dossier() returns text language plpgsql as $$
  begin
    return (select outcome from public.start_affaire_intake_analysis('ae200000-0000-4000-8000-000000000021',true,'profile-A','authorization-A'));
  exception when insufficient_privilege then return 'forbidden';
  end;
  $$;
$setup$);
create temp table race_pid as select name, pid from sessions cross join lateral dblink(name,'select pg_backend_pid()') remote(pid int);
select dblink_send_query('launcher','select pg_temp.press_test_dossier()');
create function pg_temp.wait_for_launcher() returns boolean language plpgsql as $$
declare
  waiting int := (select pid from race_pid where name='launcher');
  holder int := (select pid from race_pid where name='depositor');
begin
  for attempt in 1..200 loop
    if holder=any(pg_blocking_pids(waiting)) then return true; end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end;
$$;
select ok(pg_temp.wait_for_launcher(),'the press is waiting in SQL before the role changes');
select dblink_exec('depositor',$change$
  update public.tenant_memberships set role='director' where tenant_id=pg_temp.f(10) and user_id=pg_temp.f(2);
  commit;
$change$);
select is((select reply from dblink_get_result('launcher') x(reply text)),'forbidden','write permission is checked after the lock wait');
select count(*) from dblink_get_result('launcher') x(reply text);

-- The admin's personal tenant is the default. Its suspension leaves the dossier's
-- tenant as the fallback. Fence the synthetic launch against any write during the
-- negative case, so even a failed assertion cannot commit a reservation.
select dblink_exec('depositor',$setup$
  begin;
  update public.tenant_memberships set role='admin',is_default=false where user_id=pg_temp.f(2) and tenant_id=pg_temp.f(10);
  update public.tenant_memberships set is_default=true where user_id=pg_temp.f(2) and tenant_id<>pg_temp.f(10);
  update public.tenants set is_active=false where created_by=pg_temp.f(2);
  insert into public.affaire_intake_uploads(id,project_id,created_by,status)
    values(pg_temp.f(42),pg_temp.f(21),pg_temp.f(1),'deposited');
  insert into public.affaire_intake_documents(id,upload_id,file_name,storage_path,upload_status,classification_status)
    values(pg_temp.f(52),pg_temp.f(42),'scan.pdf','fixture/52','uploaded','awaiting_launch');
  alter table public.affaire_intake_uploads add constraint test_no_fixture_reservation
    check (project_id <> 'ae200000-0000-4000-8000-000000000021' or launch_read_scans is null);
  commit;
  begin;
  do $$begin perform 1 from public.affaire_intake_documents where id=pg_temp.f(52) for update; end$$;
$setup$);
select is((select id from dblink('launcher','select public.current_tenant_id()') x(id uuid)),
  'ae200000-0000-4000-8000-000000000010'::uuid,'the dossier is in the active fallback tenant at the press');
select dblink_send_query('launcher','select pg_temp.press_test_dossier()');
select ok(pg_temp.wait_for_launcher(),'the launch waits for the eligible piece');
select dblink_exec('depositor',$change$
  update public.tenants set is_active=true where created_by=pg_temp.f(2);
  commit;
$change$);
select is((select reply from dblink_get_result('launcher',false) x(reply text)),'forbidden',
  'the restored default tenant is authoritative at reservation');
select count(*) from dblink_get_result('launcher',false) x(reply text);
select dblink_exec('depositor',$control$
  begin;
  alter table public.affaire_intake_uploads drop constraint test_no_fixture_reservation;
  update public.tenants set is_active=false where created_by=pg_temp.f(2);
  commit;
$control$);
select results_eq($$select classification_status,analysis_launch_id,
    (select count(*) from public.affaire_intake_uploads where project_id=d.project_id and launch_read_scans is not null)
    from public.affaire_intake_documents d where id='ae200000-0000-4000-8000-000000000052'$$,
  $$values ('awaiting_launch'::text,null::uuid,0::bigint)$$,'refusal leaves no launch and the piece still waits');

select dblink_exec('launcher','begin');
select is((select reply from dblink('launcher','select pg_temp.press_test_dossier()') x(reply text)),'launched',
  'the same fallback member can reserve the same piece while the default stays suspended');
select throws_ok($$select * from dblink('depositor',
    'select id from public.tenants where created_by=pg_temp.f(2) for no key update nowait') x(id uuid)$$,
  '55P03',null,'the default tenant stays locked through the reservation commit');
select dblink_exec('launcher','commit');
select results_eq($$select created_by,launch_read_scans from public.affaire_intake_uploads where id=(select id from winner)$$,
  $$values ('ae200000-0000-4000-8000-000000000002'::uuid,true)$$,'the first payer and reading choice survive both presses');

select dblink_exec('depositor',$remote$
  reset role;
  begin;
  create temp table cleanup_tenants as select distinct tenant_id from public.tenant_memberships where user_id in (pg_temp.f(1),pg_temp.f(2))
    and (tenant_id=pg_temp.f(10) or tenant_id in (select id from public.tenants where created_by in (pg_temp.f(1),pg_temp.f(2))));
  delete from public.estimate_projects where id in (pg_temp.f(20),pg_temp.f(21));
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
