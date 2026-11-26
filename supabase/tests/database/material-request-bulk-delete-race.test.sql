-- A consultation holds its draft line. Even if its transaction has not committed
-- when the deletion starts, a second selected draft must stay with it.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok(not has_function_privilege('anon', 'public.delete_draft_material_request_lines(uuid, uuid, uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.delete_draft_material_request_lines(uuid, uuid, uuid[])', 'EXECUTE')
  and not (select prosecdef from pg_proc where oid = 'public.delete_draft_material_request_lines(uuid, uuid, uuid[])'::regprocedure),
  'only signed-in callers reach the function, which keeps their RLS');

create temp table bulk_delete_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect('bulk_delete_quote', (select connection from bulk_delete_race_connection)), 'OK', 'consultation session connected');
select is(extensions.dblink_connect('bulk_delete_operator', (select connection from bulk_delete_race_connection)), 'OK', 'deletion session connected');

select is(extensions.dblink_exec('bulk_delete_quote', $setup$
begin;
insert into auth.users (id, email, raw_user_meta_data)
values ('c7110000-0000-4000-8000-000000000001', 'bulk-delete-race@example.test', '{}'::jsonb);
update public.tenant_memberships set role = 'engineer'
where user_id = 'c7110000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id, tenant_id, user_id, name)
select 'c7110000-0000-4000-8000-000000000201', tenant_id, user_id, 'Affaire fictive'
from public.tenant_memberships where user_id = 'c7110000-0000-4000-8000-000000000001' and is_default;
insert into public.suppliers (id, tenant_id, name)
select 'c7110000-0000-4000-8000-000000000301', tenant_id, 'Fournisseur fictif'
from public.tenant_memberships where user_id = 'c7110000-0000-4000-8000-000000000001' and is_default;
insert into public.material_requests (id, project_id, created_by) values
  ('c7110000-0000-4000-8000-000000000601', 'c7110000-0000-4000-8000-000000000201', 'c7110000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position) values
  ('c7110000-0000-4000-8000-000000000701', 'c7110000-0000-4000-8000-000000000601', 1),
  ('c7110000-0000-4000-8000-000000000702', 'c7110000-0000-4000-8000-000000000601', 2),
  ('c7110000-0000-4000-8000-000000000703', 'c7110000-0000-4000-8000-000000000601', 3);
commit;
$setup$), 'COMMIT', 'three drafts committed');

select is(extensions.dblink_exec(session.name, $claims$
set role authenticated;
set request.jwt.claim.sub = 'c7110000-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"c7110000-0000-4000-8000-000000000001","role":"authenticated"}';
$claims$), 'SET', session.name || ' signed in as the engineer')
from (values ('bulk_delete_quote'), ('bulk_delete_operator')) as session(name);

create temp table bulk_delete_race_pids as
select session.name, remote.pid
from (values ('bulk_delete_quote'), ('bulk_delete_operator')) as session(name)
cross join lateral extensions.dblink(session.name, 'select pg_backend_pid()') as remote(pid integer);

create function pg_temp.bulk_delete_waits_for_quote()
returns boolean language plpgsql as $$
declare
  quote_pid integer := (select pid from bulk_delete_race_pids where name = 'bulk_delete_quote');
  delete_pid integer := (select pid from bulk_delete_race_pids where name = 'bulk_delete_operator');
begin
  for attempt in 1..200 loop
    if quote_pid = any(pg_catalog.pg_blocking_pids(delete_pid)) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;

select is(extensions.dblink_exec('bulk_delete_quote', $quote$
begin;
do $create$
begin
  perform public.create_material_request_quote(
    'c7110000-0000-4000-8000-000000000601',
    'c7110000-0000-4000-8000-000000000301',
    false, 'Consultation fictive', array['c7110000-0000-4000-8000-000000000702']::uuid[]
  );
end
$create$;
$quote$), 'DO', 'the pending consultation holds the second draft');

select is(extensions.dblink_send_query('bulk_delete_operator', $delete$
select public.delete_draft_material_request_lines(
  'c7110000-0000-4000-8000-000000000201', 'c7110000-0000-4000-8000-000000000601',
  array['c7110000-0000-4000-8000-000000000701', 'c7110000-0000-4000-8000-000000000702']::uuid[]
);
$delete$), 1, 'the deletion starts while the consultation is open');
select ok(pg_temp.bulk_delete_waits_for_quote(), 'the deletion waits for the draft held by the consultation');
select is(extensions.dblink_exec('bulk_delete_quote', 'commit'), 'COMMIT', 'the consultation commits');
select is((select count(*)::integer from extensions.dblink_get_result('bulk_delete_operator', false) as result(ids uuid[])), 0,
  'the selected drafts are refused as a group');
select matches(extensions.dblink_error_message('bulk_delete_operator'), 'MATERIAL_REQUEST_LINES_KEPT',
  'the deletion detected the consultation that committed during its wait');
select count(*) from extensions.dblink_get_result('bulk_delete_operator', false) as result(ids uuid[]);
select is((select count(*)::integer from public.material_request_lines
  where request_id = 'c7110000-0000-4000-8000-000000000601'), 3, 'all three drafts are preserved');
select is((select count(*)::integer from public.material_request_quote_lines
  where line_id = 'c7110000-0000-4000-8000-000000000702'), 1, 'the consultation retains its line');
select is((select ids from extensions.dblink('bulk_delete_operator', $delete$
select public.delete_draft_material_request_lines(
  'c7110000-0000-4000-8000-000000000201', 'c7110000-0000-4000-8000-000000000601',
  array['c7110000-0000-4000-8000-000000000703', 'c7110000-0000-4000-8000-000000000701']::uuid[]
);
$delete$) as result(ids uuid[])), array['c7110000-0000-4000-8000-000000000701', 'c7110000-0000-4000-8000-000000000703']::uuid[],
  'both unquoted drafts can be deleted in one call');
select is((select position from public.material_request_lines
  where id = 'c7110000-0000-4000-8000-000000000702'), 2, 'the remaining line keeps its position');

select is(extensions.dblink_exec('bulk_delete_quote', $cleanup$
reset role;
begin;
delete from public.estimate_projects where id = 'c7110000-0000-4000-8000-000000000201';
delete from public.suppliers where id = 'c7110000-0000-4000-8000-000000000301';
delete from auth.users where id = 'c7110000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'the committed fixtures are removed');
select is(extensions.dblink_disconnect('bulk_delete_quote'), 'OK', 'consultation session disconnected');
select is(extensions.dblink_disconnect('bulk_delete_operator'), 'OK', 'deletion session disconnected');
select * from finish();
rollback;
