-- TI-691, delivery 3a (Codex review of #291): reopening a canceled order made from a material request takes its lines
-- back only as they were ordered (migration 20261112202147_material_request_purchase_orders.sql). Isolation justified:
-- the failure needs two sessions whose writes interleave, which no journey does deterministically.
-- Case written before the fix: one session reopens the order's request line to draft and has not committed; another
-- reopens the canceled order. The reopening read the line as last committed (validated), passed its check and took the
-- line back while the first session returned it to draft: an order that stands then held a draft line. With the fix,
-- the reopening share-locks its lines before checking them: it waits for the first session, then sees the draft line
-- and refuses (MATERIAL_REQUEST_ORDER_LINES_CHANGED); the order stays canceled.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Every session connects to the same disposable local PostgreSQL socket; the fixtures are committed because
-- independent sessions must see them, and removed at the end.
create temp table reopen_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect('reopen_setup', (select connection from reopen_race_connection)), 'OK', 'fixture session connected');
select is(extensions.dblink_connect('reopen_hold', (select connection from reopen_race_connection)), 'OK', 'line session connected');
select is(extensions.dblink_connect('reopen_order', (select connection from reopen_race_connection)), 'OK', 'reopening session connected');

-- A fictional engineer owns an affaire; one validated line is priced by a retained quote, ordered, then the order canceled.
select is(extensions.dblink_exec('reopen_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '9f300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'reopen-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role where user_id = '9f300000-0000-4000-8000-000000000001';
insert into public.suppliers (id, tenant_id, name)
select '9f300000-0000-4000-8000-000000000301', m.tenant_id, 'Fournisseur de la course (fictif)'
from public.tenant_memberships m where m.user_id = '9f300000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_projects (id, tenant_id, user_id, name)
select '9f300000-0000-4000-8000-000000000201', m.tenant_id, m.user_id, 'Affaire de la course (fictive)'
from public.tenant_memberships m where m.user_id = '9f300000-0000-4000-8000-000000000001' and m.is_default;
insert into public.material_requests (id, project_id, requested_on, delivery_place, created_by)
values ('9f300000-0000-4000-8000-000000000601', '9f300000-0000-4000-8000-000000000201', '2026-11-12', 'counter',
  '9f300000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation)
values ('9f300000-0000-4000-8000-000000000701', '9f300000-0000-4000-8000-000000000601', 1, 2, 'u', 'DN 80', false, 'Vanne',
  'Fonte', 'project');
update public.material_request_lines set status = 'validated' where id = '9f300000-0000-4000-8000-000000000701';
commit;
$setup$), 'COMMIT', 'fixture request committed');
-- The engineer, as auth.uid() sees him, consults, prices, retains, orders and cancels.
select is(extensions.dblink_exec('reopen_setup', $claims$
set request.jwt.claim.sub = '9f300000-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"9f300000-0000-4000-8000-000000000001","role":"authenticated"}'
$claims$), 'SET', 'fixture session signed in');
select is(extensions.dblink_exec('reopen_setup', $order$
begin;
do $steps$
declare
  quote_id uuid;
begin
  quote_id := public.create_material_request_quote('9f300000-0000-4000-8000-000000000601',
    '9f300000-0000-4000-8000-000000000301', false, 'Bonjour', array['9f300000-0000-4000-8000-000000000701']::uuid[]);
  perform public.update_material_request_quote(quote_id, jsonb_build_object('received', true,
    'lines', jsonb_build_array(jsonb_build_object('line_id', '9f300000-0000-4000-8000-000000000701', 'unit_price_ht_cents', 2000))));
  perform public.retain_material_request_quote(quote_id);
  perform public.create_material_request_purchase_orders('9f300000-0000-4000-8000-000000000601',
    '9f300000-0000-4000-8000-00000000a001');
  update public.purchase_orders set status = 'canceled' where project_id = '9f300000-0000-4000-8000-000000000201';
end
$steps$;
commit;
$order$), 'COMMIT', 'fixture order made and canceled');
select is((select status::text from public.purchase_orders where project_id = '9f300000-0000-4000-8000-000000000201'), 'canceled',
  'the order is canceled');
select is((select count(*)::integer from private.material_request_line_orders where line_id = '9f300000-0000-4000-8000-000000000701'),
  0, 'its line is free');

-- The line session reopens the line to draft and holds its transaction open.
select is(extensions.dblink_exec('reopen_hold', $hold$
begin;
update public.material_request_lines set status = 'draft' where id = '9f300000-0000-4000-8000-000000000701';
$hold$), 'UPDATE 1', 'the line is reopened, not committed yet');
-- The reopening of the canceled order starts meanwhile, as the engineer.
select is(extensions.dblink_exec('reopen_order', $claims$
set request.jwt.claim.sub = '9f300000-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"9f300000-0000-4000-8000-000000000001","role":"authenticated"}'
$claims$), 'SET', 'reopening session signed in');
select is(extensions.dblink_send_query('reopen_order',
  $$update public.purchase_orders set status = 'draft' where project_id = '9f300000-0000-4000-8000-000000000201'$$), 1,
  'the reopening starts');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('reopen_order'), 1, 'the reopening waits for the line being changed');
select is(extensions.dblink_exec('reopen_hold', 'commit'), 'COMMIT', 'the line change commits');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('reopen_order'), 0, 'the reopening is done');
select is((select count(*)::integer from extensions.dblink_get_result('reopen_order', false) as x(status text)), 0,
  'the reopening returns no row');
select matches(extensions.dblink_error_message('reopen_order'), 'MATERIAL_REQUEST_ORDER_LINES_CHANGED',
  'the reopening is refused: its line no longer says what was ordered');
select is((select count(*)::integer from extensions.dblink_get_result('reopen_order', false) as x(status text)), 0,
  'the reopening has nothing more to answer');
select is((select status::text from public.purchase_orders where project_id = '9f300000-0000-4000-8000-000000000201'), 'canceled',
  'the order stays canceled');
select is((select count(*)::integer from private.material_request_line_orders where line_id = '9f300000-0000-4000-8000-000000000701'),
  0, 'no order holds the draft line');

-- Clean the committed synthetic fixtures of this disposable database: every tenant-scoped row of the fixture's own
-- tenant, with triggers off (orders keep their affaire, a priced line its quote), then the tenant, profile and user.
select is(extensions.dblink_exec('reopen_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = '9f300000-0000-4000-8000-000000000001' and is_default);
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
delete from public.profiles where id = '9f300000-0000-4000-8000-000000000001';
delete from auth.users where id = '9f300000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures cleaned');
select is((select count(*)::integer from public.purchase_orders where project_id = '9f300000-0000-4000-8000-000000000201'),
  0, 'no fixture order is left');
select is(extensions.dblink_disconnect('reopen_setup'), 'OK', 'fixture session disconnected');
select is(extensions.dblink_disconnect('reopen_hold'), 'OK', 'line session disconnected');
select is(extensions.dblink_disconnect('reopen_order'), 'OK', 'reopening session disconnected');
select * from finish();
rollback;
