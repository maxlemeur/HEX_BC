-- TI-691, delivery 3b-1 (Codex review of #311): the proof of a confirmed order and its file are not lost to a deletion
-- running at the same time (migration 20261113190113_material_request_order_confirmation.sql). Isolation justified: the
-- failure needs two sessions whose writes interleave, which no journey does deterministically.
-- Cases written before the fix:
--  A. one session deletes the proof's file from storage and has not committed; another confirms the order with that
--     proof. The confirmation checked only that the document row existed, recorded it and committed after the file was
--     gone: a confirmed order whose proof has no file. With the fix, the confirmation share-locks the stored file, waits
--     for the deletion, then finds no file and refuses (PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED).
--  B. one session confirms the order with a proof and has not committed; another deletes that proof's file. The
--     deletion's check ran before the confirmation committed and removed the file. With the fix, the file's deletion
--     waits for the confirmation's lock, then reads the confirmation and refuses (PURCHASE_ORDER_PROOF_FILE_KEPT).
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Every session connects to the same disposable local PostgreSQL socket; the fixtures are committed because
-- independent sessions must see them, and removed at the end.
create temp table proof_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect('proof_setup', (select connection from proof_race_connection)), 'OK', 'fixture session connected');
select is(extensions.dblink_connect('proof_hold', (select connection from proof_race_connection)), 'OK', 'holding session connected');
select is(extensions.dblink_connect('proof_other', (select connection from proof_race_connection)), 'OK', 'racing session connected');

-- A fictional engineer owns an affaire; two validated lines are priced by a retained quote and ordered in two drafts
-- (one per supplier), each with a joined proof whose file is stored.
select is(extensions.dblink_exec('proof_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '9f310000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'proof-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role where user_id = '9f310000-0000-4000-8000-000000000001';
insert into public.suppliers (id, tenant_id, name)
select supplier.id, m.tenant_id, supplier.name
from public.tenant_memberships m
cross join (values ('9f310000-0000-4000-8000-000000000301'::uuid, 'Fournisseur A de la course (fictif)'),
  ('9f310000-0000-4000-8000-000000000302'::uuid, 'Fournisseur B de la course (fictif)')) as supplier(id, name)
where m.user_id = '9f310000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_projects (id, tenant_id, user_id, name)
select '9f310000-0000-4000-8000-000000000201', m.tenant_id, m.user_id, 'Affaire de la course aux preuves (fictive)'
from public.tenant_memberships m where m.user_id = '9f310000-0000-4000-8000-000000000001' and m.is_default;
insert into public.material_requests (id, project_id, requested_on, delivery_place, created_by)
values ('9f310000-0000-4000-8000-000000000601', '9f310000-0000-4000-8000-000000000201', '2026-11-12', 'counter',
  '9f310000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation)
values ('9f310000-0000-4000-8000-000000000701', '9f310000-0000-4000-8000-000000000601', 1, 2, 'u', 'DN 80', false, 'Vanne',
  'Fonte', 'project'),
  ('9f310000-0000-4000-8000-000000000702', '9f310000-0000-4000-8000-000000000601', 2, 3, 'u', 'DN 50', false, 'Coude',
  'Inox', 'project');
update public.material_request_lines set status = 'validated' where request_id = '9f310000-0000-4000-8000-000000000601';
commit;
$setup$), 'COMMIT', 'fixture request committed');
select is(extensions.dblink_exec('proof_setup', $claims$
set request.jwt.claim.sub = '9f310000-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"9f310000-0000-4000-8000-000000000001","role":"authenticated"}'
$claims$), 'SET', 'fixture session signed in');
select is(extensions.dblink_exec('proof_setup', $order$
begin;
do $steps$
declare
  quote_a uuid;
  quote_b uuid;
begin
  quote_a := public.create_material_request_quote('9f310000-0000-4000-8000-000000000601',
    '9f310000-0000-4000-8000-000000000301', false, 'Bonjour', array['9f310000-0000-4000-8000-000000000701']::uuid[]);
  quote_b := public.create_material_request_quote('9f310000-0000-4000-8000-000000000601',
    '9f310000-0000-4000-8000-000000000302', false, 'Bonjour', array['9f310000-0000-4000-8000-000000000702']::uuid[]);
  perform public.update_material_request_quote(quote_a, jsonb_build_object('received', true,
    'lines', jsonb_build_array(jsonb_build_object('line_id', '9f310000-0000-4000-8000-000000000701', 'unit_price_ht_cents', 2000))));
  perform public.update_material_request_quote(quote_b, jsonb_build_object('received', true,
    'lines', jsonb_build_array(jsonb_build_object('line_id', '9f310000-0000-4000-8000-000000000702', 'unit_price_ht_cents', 1500))));
  perform public.retain_material_request_quote(quote_a);
  perform public.retain_material_request_quote(quote_b);
  perform public.create_material_request_purchase_orders('9f310000-0000-4000-8000-000000000601',
    '9f310000-0000-4000-8000-00000000a001');
end
$steps$;
insert into public.purchase_order_devis (id, tenant_id, purchase_order_id, user_id, name, original_filename, storage_path,
  file_size_bytes, mime_type, position)
select ('9f310000-0000-4000-8000-00000000d00' || case po.supplier_id when '9f310000-0000-4000-8000-000000000301' then '1' else '2' end)::uuid,
  po.tenant_id, po.id, po.user_id, 'Confirmation de commande', 'ar.pdf', 'purchase-orders/' || po.id || '/ar.pdf', 1024,
  'application/pdf', 1
from public.purchase_orders po where po.project_id = '9f310000-0000-4000-8000-000000000201';
insert into storage.objects (bucket_id, name, metadata)
select 'devis', document.storage_path, '{"size": 1024}'::jsonb from public.purchase_order_devis document
where document.id in ('9f310000-0000-4000-8000-00000000d001', '9f310000-0000-4000-8000-00000000d002');
commit;
$order$), 'COMMIT', 'fixture drafts, proofs and files committed');
select set_config('test.order_a', (select id::text from public.purchase_orders
  where supplier_id = '9f310000-0000-4000-8000-000000000301'), true);
select set_config('test.order_b', (select id::text from public.purchase_orders
  where supplier_id = '9f310000-0000-4000-8000-000000000302'), true);
select is((select count(*)::integer from storage.objects where bucket_id = 'devis'
    and name in (select storage_path from public.purchase_order_devis where purchase_order_id in
      (current_setting('test.order_a')::uuid, current_setting('test.order_b')::uuid))), 2,
  'both proofs have their file');

-- The confirmation, as the engineer: the order with its proof, at the quote's prices, today.
create function pg_temp.confirmation(p_order text, p_document text) returns text language sql as $fn$
  select format($q$select public.confirm_material_request_purchase_order(%L::uuid, %s, %L::jsonb)$q$,
    current_setting(p_order), (select edit_revision from public.purchase_orders where id = current_setting(p_order)::uuid),
    jsonb_build_object('ordered_on', '2026-11-12', 'document_id', p_document, 'lines', '[]'::jsonb)::text);
$fn$;
create function pg_temp.file_of(p_document text) returns text language sql as $fn$
  select format($q$delete from storage.objects where bucket_id = 'devis' and name = %L$q$,
    (select storage_path from public.purchase_order_devis where id = p_document::uuid));
$fn$;
select is(extensions.dblink_exec('proof_other', $claims$
set request.jwt.claim.sub = '9f310000-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"9f310000-0000-4000-8000-000000000001","role":"authenticated"}'
$claims$), 'SET', 'racing session signed in');
select is(extensions.dblink_exec('proof_hold', $claims$
set request.jwt.claim.sub = '9f310000-0000-4000-8000-000000000001';
set request.jwt.claims = '{"sub":"9f310000-0000-4000-8000-000000000001","role":"authenticated"}'
$claims$), 'SET', 'holding session signed in');

-- A. The holding session deletes A's proof file and keeps its transaction open; the confirmation of A starts meanwhile.
select is(extensions.dblink_exec('proof_hold', 'begin'), 'BEGIN', 'A: the deletion begins');
select is(extensions.dblink_exec('proof_hold', $$set local storage.allow_delete_query = 'true'$$), 'SET', 'A: as the Storage API does');
select is(extensions.dblink_exec('proof_hold', pg_temp.file_of('9f310000-0000-4000-8000-00000000d001')), 'DELETE 1',
  'A: the proof''s file is deleted, not committed yet');
select is(extensions.dblink_send_query('proof_other', pg_temp.confirmation('test.order_a', '9f310000-0000-4000-8000-00000000d001')), 1,
  'A: the confirmation starts');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('proof_other'), 1, 'A: the confirmation waits for the file being deleted');
select is(extensions.dblink_exec('proof_hold', 'commit'), 'COMMIT', 'A: the deletion commits');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('proof_other'), 0, 'A: the confirmation is done');
select is((select count(*)::integer from extensions.dblink_get_result('proof_other', false) as x(result jsonb)), 0,
  'A: the confirmation returns no row');
select matches(extensions.dblink_error_message('proof_other'), 'PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED',
  'A: the confirmation is refused: its proof has no file any more');
select is((select count(*)::integer from extensions.dblink_get_result('proof_other', false) as x(result jsonb)), 0,
  'A: the confirmation has nothing more to answer');
select results_eq(
  $$select po.status::text, (select count(*)::integer from public.purchase_order_confirmations c where c.purchase_order_id = po.id)
    from public.purchase_orders po where po.id = current_setting('test.order_a')::uuid$$,
  $$values ('draft'::text, 0)$$, 'A: the order stays a draft, without confirmation');

-- B. The holding session confirms B with its proof and keeps its transaction open; the deletion of that file starts.
select is(extensions.dblink_exec('proof_hold', 'begin'), 'BEGIN', 'B: the confirmation begins');
select ok((select count(*) = 1 from extensions.dblink('proof_hold', pg_temp.confirmation('test.order_b',
    '9f310000-0000-4000-8000-00000000d002')) as x(result jsonb)), 'B: the order is confirmed, not committed yet');
select is(extensions.dblink_exec('proof_other', 'begin'), 'BEGIN', 'B: the deletion begins');
select is(extensions.dblink_exec('proof_other', $$set local storage.allow_delete_query = 'true'$$), 'SET', 'B: as the Storage API does');
select is(extensions.dblink_send_query('proof_other', pg_temp.file_of('9f310000-0000-4000-8000-00000000d002')), 1,
  'B: the deletion of the proof''s file starts');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('proof_other'), 1, 'B: the deletion waits for the confirmation');
select is(extensions.dblink_exec('proof_hold', 'commit'), 'COMMIT', 'B: the confirmation commits');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('proof_other'), 0, 'B: the deletion is done');
select is((select count(*)::integer from extensions.dblink_get_result('proof_other', false) as x(status text)), 0,
  'B: the deletion returns no row');
select matches(extensions.dblink_error_message('proof_other'), 'PURCHASE_ORDER_PROOF_FILE_KEPT',
  'B: the deletion is refused: the file proves a confirmed order');
select is((select count(*)::integer from extensions.dblink_get_result('proof_other', false) as x(status text)), 0,
  'B: the deletion has nothing more to answer');
select is(extensions.dblink_exec('proof_other', 'rollback'), 'ROLLBACK', 'B: the deletion''s transaction ends');
select is((select count(*)::integer from storage.objects where bucket_id = 'devis'
    and name = (select storage_path from public.purchase_order_devis where id = '9f310000-0000-4000-8000-00000000d002')),
  1, 'B: the proof''s file is still stored');

-- Clean the committed synthetic fixtures of this disposable database: the stored files, every tenant-scoped row of the
-- fixture's own tenant, with triggers off (orders keep their affaire, a priced line its quote), then the tenant,
-- profile and user.
select is(extensions.dblink_exec('proof_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = '9f310000-0000-4000-8000-000000000001' and is_default);
  entry record;
begin
  delete from storage.objects where bucket_id = 'devis' and name in (
    select storage_path from public.purchase_order_devis where tenant_id = target);
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
delete from public.profiles where id = '9f310000-0000-4000-8000-000000000001';
delete from auth.users where id = '9f310000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures cleaned');
select is((select count(*)::integer from public.purchase_orders where project_id = '9f310000-0000-4000-8000-000000000201'),
  0, 'no fixture order is left');
select is(extensions.dblink_disconnect('proof_setup'), 'OK', 'fixture session disconnected');
select is(extensions.dblink_disconnect('proof_hold'), 'OK', 'holding session disconnected');
select is(extensions.dblink_disconnect('proof_other'), 'OK', 'racing session disconnected');
select * from finish();
rollback;
