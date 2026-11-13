-- Ordering and receiving the purchase orders of an affaire (TI-691, lot 2 « l'achat », delivery 3b-1). Written before
-- the migration 20261113172746_material_request_order_confirmation.sql. Failure modes this file guards, with fictional
-- members, suppliers, articles and lines:
--  1. the two functions reach anon or PUBLIC or run without a pinned search_path; the confirmation and reception
--     tables are written by a Data API role, read by a member who may not open the order, or read without RLS;
--  2. a draft made from a request does not take the date the technician needs the material as its delivery date;
--  3. in a draft, the price or the lot of a request line changes outside the confirmation (the quote's price would be
--     replaced without proof), while a manual line of a manual draft stays editable;
--  4. an order of an affaire is confirmed, sent, received, reopened after ordering or canceled after ordering by a
--     direct write, or deleted once ordered; one marked sent before this delivery is stuck (neither returned to draft
--     nor canceled); an order without affaire loses its free status changes;
--  5. a confirmation is accepted without a proof, with the proof of another order, by a viewer, by an engineer who is
--     not the author, by a member of another tenant, on a stale revision, on an order that is not a draft, on an order
--     without affaire, with a line of another order, a negative price, an unknown lot, a future order date, a delivery
--     before the order date or an overlong supplier reference; a refusal writes nothing;
--  6. the confirmation does not record the real prices (a price for 100 not divided, rounded otherwise than half away
--     from zero, a price written 1234.0 refused), the totals, the order date, the delivery date, the proof, the
--     supplier reference and who confirmed; discounts larger than the real prices are refused only at commit; the
--     proof, or its file in storage, can then be deleted; a second confirmation is accepted;
--  7. a reception is accepted on a draft, before the order date, in the future, with an overlong note, by a viewer, on a
--     stale revision or twice; it does not record its date, note and author; a received order changes again.
-- Every member statement goes through pg_temp.pls_run or pg_temp.pls_rows (role and JWT switched in a sub-block), so a
-- red assertion fails on its own reason and the file runs to the end. Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Tenant 101: 1 engineer who owns affaire 201 and makes the orders, 2 admin, 3 viewer, 5 engineer who is not the
-- author. Member 4 is the admin of tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9320000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'confirmation-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 5) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9320000-%';
insert into public.tenants (id, name, slug) values
  ('a9320000-0000-4000-8000-000000000101', 'Confirmation fixture', 'confirmation-fixture'),
  ('a9320000-0000-4000-8000-000000000102', 'Confirmation autre tenant', 'confirmation-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 4 then 'a9320000-0000-4000-8000-000000000102' else 'a9320000-0000-4000-8000-000000000101' end)::uuid,
  ('a9320000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'viewer' when 4 then 'admin' else 'engineer' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 5) n;

insert into public.suppliers (id, tenant_id, name) values
  ('a9320000-0000-4000-8000-000000000301', 'a9320000-0000-4000-8000-000000000101', 'TI691 Confirmation Alpha'),
  ('a9320000-0000-4000-8000-000000000302', 'a9320000-0000-4000-8000-000000000101', 'TI691 Confirmation Beta');
insert into public.products (id, tenant_id, reference, designation, unit_price_cents, product_type, material, unit) values
  ('a9320000-0000-4000-8000-000000000501', 'a9320000-0000-4000-8000-000000000101', 'CNF-501', 'TI691 Coude 90° inox DN 50',
    100, 'Coude 90°', 'Inox 304L', 'u'),
  ('a9320000-0000-4000-8000-000000000502', 'a9320000-0000-4000-8000-000000000101', 'CNF-502', 'TI691 Vis inox M6x20',
    1, 'Vis', 'Inox 304L', 'u');
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9320000-0000-4000-8000-000000000201', 'a9320000-0000-4000-8000-000000000101', 'a9320000-0000-4000-8000-000000000001',
    'TI691 Affaire confirmée');
insert into public.delivery_sites (id, tenant_id, name, is_active, updated_at) values
  ('a9320000-0000-4000-8000-000000000801', 'a9320000-0000-4000-8000-000000000101', 'TI691 Chantier confirmé', true,
    now() - interval '1 second');
-- Request 601, needed on 20/11/2026: L1 elbows and L2 screws at Alpha, L3 sleeves at Beta.
insert into public.material_requests (id, project_id, requested_on, needed_on, delivery_place, created_by) values
  ('a9320000-0000-4000-8000-000000000601', 'a9320000-0000-4000-8000-000000000201', '2026-11-10', '2026-11-20', 'site',
    'a9320000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation, product_id, product_match) values
  ('a9320000-0000-4000-8000-000000000701', 'a9320000-0000-4000-8000-000000000601', 1, 4, 'u', 'DN 50', false, 'Coude 90°',
    'Inox 304L', 'project', 'a9320000-0000-4000-8000-000000000501', 'manual'),
  ('a9320000-0000-4000-8000-000000000702', 'a9320000-0000-4000-8000-000000000601', 2, 1500, 'u', 'M6x20', false, 'Vis',
    'Inox 304L', 'project', 'a9320000-0000-4000-8000-000000000502', 'manual'),
  ('a9320000-0000-4000-8000-000000000703', 'a9320000-0000-4000-8000-000000000601', 3, 2, 'u', 'DN 40', false, 'Manchon',
    'PVC', 'project', null, null);
update public.material_request_lines set status = 'validated' where request_id = 'a9320000-0000-4000-8000-000000000601';

-- Runs one statement as a signed-in member: « ok <rows> » or « <sqlstate> <message> ».
create function pg_temp.pls_run(p_user uuid, p_sql text)
returns text
language plpgsql
as $run$
declare
  run_result text;
  affected bigint;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute p_sql;
    get diagnostics affected = row_count;
    run_result := 'ok ' || affected;
  exception when others then
    run_result := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- Runs one query as a signed-in member: its rows as a JSON array, or { error, message }.
create function pg_temp.pls_rows(p_user uuid, p_sql text)
returns jsonb
language plpgsql
as $run$
declare
  run_result jsonb;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute format('select coalesce(jsonb_agg(to_jsonb(answer)), ''[]''::jsonb) from (%s) answer', p_sql) into run_result;
  exception when others then
    run_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- The retained quotes: Alpha prices L1 (12,34 € a piece) and L2 (3,40 € for 100 screws); Beta prices L3 (9,99 €).
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9320000-0000-4000-8000-000000000601', 'a9320000-0000-4000-8000-000000000301',
    false, 'Bonjour', array['a9320000-0000-4000-8000-000000000701', 'a9320000-0000-4000-8000-000000000702']::uuid[])$$),
  'ok 1', 'fixture: the owner asks Alpha for L1 and L2');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9320000-0000-4000-8000-000000000601', 'a9320000-0000-4000-8000-000000000302',
    false, 'Bonjour', array['a9320000-0000-4000-8000-000000000703']::uuid[])$$),
  'ok 1', 'fixture: and Beta for L3');
select set_config('test.quote_alpha', (select id::text from public.material_request_quotes
  where request_id = 'a9320000-0000-4000-8000-000000000601' and supplier_id = 'a9320000-0000-4000-8000-000000000301'), true);
select set_config('test.quote_beta', (select id::text from public.material_request_quotes
  where request_id = 'a9320000-0000-4000-8000-000000000601' and supplier_id = 'a9320000-0000-4000-8000-000000000302'), true);
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_alpha')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(
      jsonb_build_object('line_id', 'a9320000-0000-4000-8000-000000000701', 'unit_price_ht_cents', 1234),
      jsonb_build_object('line_id', 'a9320000-0000-4000-8000-000000000702', 'unit_price_ht_cents', 340, 'price_per', 100))))$$),
  'ok 1', 'fixture: Alpha answers');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_beta')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(jsonb_build_object('line_id', 'a9320000-0000-4000-8000-000000000703', 'unit_price_ht_cents', 999))))$$),
  'ok 1', 'fixture: Beta answers');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_alpha')::uuid)$$), 'ok 0',
  'fixture: Alpha is retained');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_beta')::uuid)$$), 'ok 0',
  'fixture: Beta is retained');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9320000-0000-4000-8000-000000000601',
    'a9320000-0000-4000-8000-00000000a001')$$), 'ok 1', 'fixture: the owner makes one draft per supplier');
select set_config('test.order_alpha', (select id::text from public.purchase_orders
  where project_id = 'a9320000-0000-4000-8000-000000000201' and supplier_id = 'a9320000-0000-4000-8000-000000000301'), true);
select set_config('test.order_beta', (select id::text from public.purchase_orders
  where project_id = 'a9320000-0000-4000-8000-000000000201' and supplier_id = 'a9320000-0000-4000-8000-000000000302'), true);
select set_config('test.item_elbows', (select id::text from public.purchase_order_items
  where material_request_line_id = 'a9320000-0000-4000-8000-000000000701'), true);
select set_config('test.item_screws', (select id::text from public.purchase_order_items
  where material_request_line_id = 'a9320000-0000-4000-8000-000000000702'), true);
select set_config('test.item_sleeves', (select id::text from public.purchase_order_items
  where material_request_line_id = 'a9320000-0000-4000-8000-000000000703'), true);
-- A manual order of a site, without affaire, by the same engineer.
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9320000-0000-4000-8000-000000000301',
    'delivery_site_id', 'a9320000-0000-4000-8000-000000000801', 'notes', 'TI691 manuel'), jsonb_build_array(
    jsonb_build_object('designation', 'TI691 manuel', 'quantity', 3, 'unit', 'u', 'unit_price_ht_cents', 500, 'tax_rate_bp', 2000)))$$),
  'ok 1', 'fixture: a manual order of a site');
select set_config('test.order_manual', (select id::text from public.purchase_orders
  where notes = 'TI691 manuel' and tenant_id = 'a9320000-0000-4000-8000-000000000101'), true);
-- The documents joined to the orders: D1 and D2 on Alpha's, D3 on Beta's, D4 on the manual order.
insert into public.purchase_order_devis (id, tenant_id, purchase_order_id, user_id, name, original_filename, storage_path,
  file_size_bytes, mime_type, position)
select ('a9320000-0000-4000-8000-00000000d00' || n)::uuid, 'a9320000-0000-4000-8000-000000000101',
  current_setting(case when n in (1, 2) then 'test.order_alpha' when n = 3 then 'test.order_beta' else 'test.order_manual' end)::uuid,
  'a9320000-0000-4000-8000-000000000001', 'Confirmation ' || n, 'confirmation-' || n || '.pdf',
  'purchase-orders/' || current_setting(case when n in (1, 2) then 'test.order_alpha' when n = 3 then 'test.order_beta'
    else 'test.order_manual' end) || '/confirmation-' || n || '.pdf', 1024, 'application/pdf', n
from generate_series(1, 4) n;

-- Confirms Alpha's draft as a member: the screws at 3,52 € for 100, the elbows unchanged, ordered on 12/11/2026.
create function pg_temp.confirm_alpha(p_user uuid, p_revision text, p_patch jsonb default '{}'::jsonb)
returns text
language sql
as $fn$
  select format($q$select public.confirm_material_request_purchase_order(%L::uuid, %s, %L::jsonb)$q$,
    current_setting('test.order_alpha'), p_revision, (jsonb_build_object(
      'ordered_on', '2026-11-12', 'expected_delivery_date', '2026-11-19', 'supplier_reference', 'AR-4471',
      'document_id', 'a9320000-0000-4000-8000-00000000d001',
      'lines', jsonb_build_array(
        jsonb_build_object('id', current_setting('test.item_screws'), 'unit_price_ht_cents', 352, 'price_per', 100),
        jsonb_build_object('id', current_setting('test.item_elbows'), 'unit_price_ht_cents', 1234.0, 'price_per', 1)))
      || p_patch)::text);
$fn$;
create function pg_temp.revision(p_order text) returns text language sql as $fn$
  select edit_revision::text from public.purchase_orders where id = current_setting(p_order)::uuid;
$fn$;

-- ---------------------------------------------------------------------------
-- 1. Structure and grants.
-- ---------------------------------------------------------------------------
select ok((select bool_and(prosecdef and exists (select 1 from unnest(proconfig) setting where setting = 'search_path=""'))
  from pg_proc where oid in ('public.confirm_material_request_purchase_order(uuid, bigint, jsonb)'::regprocedure,
    'public.receive_material_request_purchase_order(uuid, bigint, jsonb)'::regprocedure)),
  '1 both functions are security definer with an empty search_path (they check the rights themselves)');
select ok(not has_function_privilege('anon', 'public.confirm_material_request_purchase_order(uuid, bigint, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.receive_material_request_purchase_order(uuid, bigint, jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.confirm_material_request_purchase_order(uuid, bigint, jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.receive_material_request_purchase_order(uuid, bigint, jsonb)', 'EXECUTE'),
  '1 a signed-in member calls them, an anonymous caller does not');
select ok(not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and grantee = 'PUBLIC'
      and routine_name in ('confirm_material_request_purchase_order', 'receive_material_request_purchase_order')),
  '1 PUBLIC executes neither');
select ok((select bool_and(c.relrowsecurity) from pg_class c
    where c.oid in ('public.purchase_order_confirmations'::regclass, 'public.purchase_order_receptions'::regclass)),
  '1 the confirmation and reception tables have RLS');
select ok(has_table_privilege('authenticated', 'public.purchase_order_confirmations', 'SELECT')
    and has_table_privilege('authenticated', 'public.purchase_order_receptions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.purchase_order_confirmations', 'INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'public.purchase_order_receptions', 'INSERT, UPDATE, DELETE')
    and not has_table_privilege('anon', 'public.purchase_order_confirmations', 'SELECT, INSERT, UPDATE, DELETE')
    and not has_table_privilege('anon', 'public.purchase_order_receptions', 'SELECT, INSERT, UPDATE, DELETE'),
  '1 a member reads them and writes them only through the functions; an anonymous caller has nothing');

-- ---------------------------------------------------------------------------
-- 2. A draft made from a request is delivered when the technician needs the material.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select expected_delivery_date from public.purchase_orders
    where project_id = 'a9320000-0000-4000-8000-000000000201' order by supplier_id$$,
  $$values ('2026-11-20'::text), ('2026-11-20'::text)$$,
  '2 both drafts take the date the request needs its material');

-- ---------------------------------------------------------------------------
-- 3. The price of a request line changes only at the confirmation.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$update public.purchase_order_items set unit_price_ht_cents = 300 where id = %L$$, current_setting('test.item_screws'))),
  '22023 PURCHASE_ORDER_REQUEST_PRICE_AT_CONFIRMATION', '3 a direct write does not change a request line''s price');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000002',
  format($$update public.purchase_order_items set price_per = 10 where id = %L$$, current_setting('test.item_screws'))),
  '22023 PURCHASE_ORDER_REQUEST_PRICE_AT_CONFIRMATION', '3 nor its lot, even for an admin');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.replace_purchase_order_draft(%L::uuid, '{}'::jsonb, (
      select jsonb_agg(jsonb_build_object('id', oi.id, 'designation', oi.designation, 'reference', oi.reference,
        'quantity', oi.quantity, 'unit', oi.unit, 'unit_price_ht_cents', case when oi.id = %L::uuid then 300 else oi.unit_price_ht_cents end,
        'price_per', oi.price_per, 'tax_rate_bp', oi.tax_rate_bp, 'product_id', oi.product_id, 'line_kind', oi.line_kind)
        order by oi.position)
      from public.purchase_order_items oi where oi.purchase_order_id = %L::uuid), %s)$$,
    current_setting('test.order_alpha'), current_setting('test.item_screws'), current_setting('test.order_alpha'),
    pg_temp.revision('test.order_alpha'))),
  '22023 PURCHASE_ORDER_REQUEST_PRICE_AT_CONFIRMATION', '3 nor a draft edit');
select is((select unit_price_ht_cents from public.purchase_order_items where id = current_setting('test.item_screws')::uuid), 340,
  '3 the screws keep their quote price');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_order_items set unit_price_ht_cents = 450 where purchase_order_id = current_setting('test.order_manual')::uuid$$),
  'ok 1', '3 a manual line of a manual draft stays editable');

-- ---------------------------------------------------------------------------
-- 4. The status of an order of an affaire is not written directly, except to cancel or reopen a draft.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'confirmed' where id = current_setting('test.order_beta')::uuid$$),
  '42501 PURCHASE_ORDER_CONFIRM_THROUGH_FUNCTION', '4 a draft of an affaire is not confirmed by a direct write');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000002',
  $$update public.purchase_orders set status = 'sent' where id = current_setting('test.order_beta')::uuid$$),
  '23514 PURCHASE_ORDER_STATUS_TRANSITION_INVALID', '4 nor marked sent, even by an admin');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'received' where id = current_setting('test.order_beta')::uuid$$),
  '23514 PURCHASE_ORDER_STATUS_TRANSITION_INVALID', '4 nor received without being ordered');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'canceled' where id = current_setting('test.order_beta')::uuid$$),
  'ok 1', '4 a draft of an affaire is canceled');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_beta')::uuid$$),
  'ok 1', '4 and reopened');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'sent' where id = current_setting('test.order_manual')::uuid$$),
  'ok 1', '4 an order without affaire is still sent directly');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'confirmed' where id = current_setting('test.order_manual')::uuid$$),
  'ok 1', '4 and confirmed directly');
-- An order of an affaire marked sent before this delivery (its status was free): it returns to draft, or is canceled.
alter table public.purchase_orders disable trigger guard_purchase_order_lifecycle;
update public.purchase_orders set status = 'sent' where id = current_setting('test.order_beta')::uuid;
alter table public.purchase_orders enable trigger guard_purchase_order_lifecycle;
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'confirmed' where id = current_setting('test.order_beta')::uuid$$),
  '23514 PURCHASE_ORDER_STATUS_TRANSITION_INVALID', '4 a sent order of an affaire is not confirmed directly');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_beta')::uuid$$),
  'ok 1', '4 it returns to draft');
alter table public.purchase_orders disable trigger guard_purchase_order_lifecycle;
update public.purchase_orders set status = 'sent' where id = current_setting('test.order_beta')::uuid;
alter table public.purchase_orders enable trigger guard_purchase_order_lifecycle;
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'canceled' where id = current_setting('test.order_beta')::uuid$$),
  'ok 1', '4 or is canceled');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_beta')::uuid$$),
  'ok 1', '4 and reopened as a draft');

-- ---------------------------------------------------------------------------
-- 5. What a confirmation refuses, without writing anything.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'), '{"document_id": null}')),
  '22023 PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED', '5 a confirmation needs a proof');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'),
    '{"document_id": "a9320000-0000-4000-8000-00000000d003"}')),
  '22023 PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED', '5 joined to this order, not to another');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000003',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000003', pg_temp.revision('test.order_alpha'))),
  '42501 PURCHASE_ORDER_ACCESS_DENIED', '5 a viewer does not confirm');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000005',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000005', pg_temp.revision('test.order_alpha'))),
  '42501 PURCHASE_ORDER_ACCESS_DENIED', '5 nor an engineer who is not the author');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000004',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000004', pg_temp.revision('test.order_alpha'))),
  '42501 PURCHASE_ORDER_ACCESS_DENIED', '5 nor the admin of another tenant');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', (pg_temp.revision('test.order_alpha')::bigint - 1)::text)),
  '40001 PURCHASE_ORDER_REVISION_CONFLICT', '5 a stale revision is refused');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', 'null')),
  '40001 PURCHASE_ORDER_REVISION_REQUIRED', '5 and a missing one');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.confirm_material_request_purchase_order(%L::uuid, %s, %L::jsonb)$$,
    current_setting('test.order_manual'), pg_temp.revision('test.order_manual'),
    '{"ordered_on": "2026-11-12", "document_id": "a9320000-0000-4000-8000-00000000d004", "lines": []}')),
  '22023 PURCHASE_ORDER_AFFAIRE_ONLY', '5 an order without affaire is not confirmed this way');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'), jsonb_build_object('lines',
    jsonb_build_array(jsonb_build_object('id', current_setting('test.item_sleeves'), 'unit_price_ht_cents', 1, 'price_per', 1))))),
  '22023 PURCHASE_ORDER_ITEMS_INVALID', '5 a line of another order is refused');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'), jsonb_build_object('lines',
    jsonb_build_array(
      jsonb_build_object('id', current_setting('test.item_screws'), 'unit_price_ht_cents', 1, 'price_per', 1),
      jsonb_build_object('id', current_setting('test.item_screws'), 'unit_price_ht_cents', 2, 'price_per', 1))))),
  '22023 PURCHASE_ORDER_ITEMS_INVALID', '5 and a line given twice');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'), jsonb_build_object('lines',
    jsonb_build_array(jsonb_build_object('id', current_setting('test.item_screws'), 'unit_price_ht_cents', -1, 'price_per', 100))))),
  '22023 PURCHASE_ORDER_INPUT_INVALID', '5 a negative price is refused');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'), jsonb_build_object('lines',
    jsonb_build_array(jsonb_build_object('id', current_setting('test.item_screws'), 'unit_price_ht_cents', 352, 'price_per', 7))))),
  '22023 PURCHASE_ORDER_INPUT_INVALID', '5 and a lot other than 1, 10, 100 or 1 000');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'),
    jsonb_build_object('ordered_on', (current_date + 2)::text, 'expected_delivery_date', (current_date + 9)::text))),
  '22023 PURCHASE_ORDER_CONFIRMATION_DATE_INVALID', '5 an order is not passed in the future');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'),
    '{"expected_delivery_date": "2026-11-11"}')),
  '22023 PURCHASE_ORDER_CONFIRMATION_DATE_INVALID', '5 nor delivered before it is passed');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'),
    jsonb_build_object('supplier_reference', repeat('R', 121)))),
  '22023 PURCHASE_ORDER_INPUT_INVALID', '5 a supplier reference holds 120 characters at most');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'), '{"surprise": true}')),
  '22023 PURCHASE_ORDER_INPUT_INVALID', '5 an unknown field is refused');
-- Beta's draft gets a discount of 10,00 € on its sleeves (2 × 9,99 €); confirmed with the sleeves at 1,00 €, the
-- discount would exceed them.
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.replace_purchase_order_draft(%L::uuid, '{}'::jsonb, (
      select jsonb_agg(item order by ordinal) from (
        select 1 as ordinal, jsonb_build_object('id', oi.id, 'designation', oi.designation, 'reference', oi.reference,
          'quantity', oi.quantity, 'unit', oi.unit, 'unit_price_ht_cents', oi.unit_price_ht_cents, 'price_per', oi.price_per,
          'tax_rate_bp', oi.tax_rate_bp, 'product_id', oi.product_id, 'line_kind', oi.line_kind) as item
        from public.purchase_order_items oi where oi.purchase_order_id = %L::uuid
        union all
        select 2, jsonb_build_object('designation', 'TI691 Remise fictive', 'quantity', 1, 'unit', 'forfait',
          'unit_price_ht_cents', 1000, 'tax_rate_bp', 2000, 'line_kind', 'discount')
      ) lines), %s)$$,
    current_setting('test.order_beta'), current_setting('test.order_beta'), pg_temp.revision('test.order_beta'))),
  'ok 1', 'fixture: Beta''s draft gets a discount of 10,00 €');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.confirm_material_request_purchase_order(%L::uuid, %s, %L::jsonb)$$,
    current_setting('test.order_beta'), pg_temp.revision('test.order_beta'), jsonb_build_object(
      'ordered_on', '2026-11-12', 'document_id', 'a9320000-0000-4000-8000-00000000d003',
      'lines', jsonb_build_array(jsonb_build_object('id', current_setting('test.item_sleeves'), 'unit_price_ht_cents', 100,
        'price_per', 1)))::text)),
  '23514 PURCHASE_ORDER_TOTAL_NEGATIVE', '5 discounts larger than the real prices are refused by the confirmation itself');
select results_eq(
  $$select status::text, total_ht_cents from public.purchase_orders where id = current_setting('test.order_beta')::uuid$$,
  $$values ('draft'::text, 2 * 999 - 1000)$$,
  '5 Beta''s draft stays as it was');
select results_eq(
  $$select status::text, order_date, expected_delivery_date, total_ht_cents from public.purchase_orders
    where id = current_setting('test.order_alpha')::uuid$$,
  $$values ('draft'::text, current_date, '2026-11-20'::text, 4936 + 5100)$$,
  '5 the refusals left the draft as it was (elbows 4 × 12,34 €, screws 1 500 × 3,40 € ÷ 100)');
select is((select count(*)::integer from public.purchase_order_confirmations
    where purchase_order_id = current_setting('test.order_alpha')::uuid), 0,
  '5 and recorded no confirmation');

-- ---------------------------------------------------------------------------
-- 6. The confirmation records the real prices and its proof.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_rows('a9320000-0000-4000-8000-000000000001',
  format($$select r->>'status' as status, (r->>'total_ht_cents')::integer as ht, (r->>'total_tax_cents')::integer as tax,
      (r->>'total_ttc_cents')::integer as ttc
    from (%s) confirmed(r)$$,
    pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha')))),
  jsonb_build_array(jsonb_build_object('status', 'confirmed', 'ht', 4936 + 5280, 'tax', 987 + 1056, 'ttc', 4936 + 5280 + 987 + 1056)),
  '6 the author confirms: the screws at 1 500 × 3,52 € ÷ 100 = 52,80 €, the totals follow');
select results_eq(
  $$select id::text, unit_price_ht_cents, price_per, line_total_ht_cents, line_tax_cents from public.purchase_order_items
    where purchase_order_id = current_setting('test.order_alpha')::uuid order by position$$,
  $$values (current_setting('test.item_elbows'), 1234, 1, 4936, 987), (current_setting('test.item_screws'), 352, 100, 5280, 1056)$$,
  '6 each line holds its real price and lot');
select results_eq(
  $$select status::text, order_date, expected_delivery_date from public.purchase_orders
    where id = current_setting('test.order_alpha')::uuid$$,
  $$values ('confirmed'::text, '2026-11-12'::date, '2026-11-19'::text)$$,
  '6 the order is confirmed, passed on 12/11 and delivered on 19/11');
select results_eq(
  $$select document_id, supplier_reference, confirmed_by, tenant_id from public.purchase_order_confirmations
    where purchase_order_id = current_setting('test.order_alpha')::uuid$$,
  $$values ('a9320000-0000-4000-8000-00000000d001'::uuid, 'AR-4471'::text, 'a9320000-0000-4000-8000-000000000001'::uuid,
    'a9320000-0000-4000-8000-000000000101'::uuid)$$,
  '6 the confirmation names its proof, the supplier''s reference and who confirmed');
select is((select unit_price_ht_cents from public.material_request_lines where id = 'a9320000-0000-4000-8000-000000000702'), 340,
  '6 the request line keeps the quote''s price');
select is(pg_temp.pls_rows('a9320000-0000-4000-8000-000000000001',
  $$select supplier_reference from public.purchase_order_confirmations where purchase_order_id = current_setting('test.order_alpha')::uuid$$),
  '[{"supplier_reference": "AR-4471"}]'::jsonb, '6 its author reads the confirmation');
select is(pg_temp.pls_rows('a9320000-0000-4000-8000-000000000002',
  $$select supplier_reference from public.purchase_order_confirmations where purchase_order_id = current_setting('test.order_alpha')::uuid$$),
  '[{"supplier_reference": "AR-4471"}]'::jsonb, '6 so does an admin');
select is(pg_temp.pls_rows('a9320000-0000-4000-8000-000000000005',
  $$select supplier_reference from public.purchase_order_confirmations$$),
  '[]'::jsonb, '6 an engineer who may not open the order reads nothing');
select is(pg_temp.pls_rows('a9320000-0000-4000-8000-000000000004',
  $$select supplier_reference from public.purchase_order_confirmations$$),
  '[]'::jsonb, '6 nor does another tenant');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  pg_temp.confirm_alpha('a9320000-0000-4000-8000-000000000001', pg_temp.revision('test.order_alpha'))),
  '55000 PURCHASE_ORDER_CONFIRMATION_NOT_DRAFT', '6 a confirmed order is not confirmed again');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$delete from public.purchase_order_devis where id = 'a9320000-0000-4000-8000-00000000d001'$$),
  '23503 update or delete on table "purchase_order_devis" violates foreign key constraint "purchase_order_confirmations_document_id_fkey" on table "purchase_order_confirmations"',
  '6 the proof is not deleted');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$delete from public.purchase_order_devis where id = 'a9320000-0000-4000-8000-00000000d002'$$),
  'ok 1', '6 another document of the order still is');
-- In storage: the proof's file and the file of another document of the order (a file is read through its document;
-- the local Storage API sets the guard below for its own deletes).
insert into public.purchase_order_devis (id, tenant_id, purchase_order_id, user_id, name, original_filename, storage_path,
  file_size_bytes, mime_type, position)
values ('a9320000-0000-4000-8000-00000000d005', 'a9320000-0000-4000-8000-000000000101', current_setting('test.order_alpha')::uuid,
  'a9320000-0000-4000-8000-000000000001', 'Plan libre', 'libre.pdf',
  'purchase-orders/' || current_setting('test.order_alpha') || '/libre.pdf', 1024, 'application/pdf', 5);
insert into storage.objects (bucket_id, name, metadata) values
  ('devis', 'purchase-orders/' || current_setting('test.order_alpha') || '/confirmation-1.pdf', '{"size": 1024}'),
  ('devis', 'purchase-orders/' || current_setting('test.order_alpha') || '/libre.pdf', '{"size": 1024}');
select set_config('storage.allow_delete_query', 'true', true);
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$delete from storage.objects where bucket_id = 'devis' and name = %L$$,
    'purchase-orders/' || current_setting('test.order_alpha') || '/confirmation-1.pdf')),
  'ok 0', '6 the proof''s file is not deleted from storage');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$delete from storage.objects where bucket_id = 'devis' and name = %L$$,
    'purchase-orders/' || current_setting('test.order_alpha') || '/libre.pdf')),
  'ok 1', '6 another file of the order still is');
select is((select count(*)::integer from storage.objects
    where bucket_id = 'devis' and name = 'purchase-orders/' || current_setting('test.order_alpha') || '/confirmation-1.pdf'),
  1, '6 the proof''s file is still stored');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'canceled' where id = current_setting('test.order_alpha')::uuid$$),
  '23514 PURCHASE_ORDER_STATUS_TRANSITION_INVALID', '6 an ordered order is not canceled');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000002',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_alpha')::uuid$$),
  '23514 PURCHASE_ORDER_STATUS_TRANSITION_INVALID', '6 nor returned to draft, even by an admin');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'received' where id = current_setting('test.order_alpha')::uuid$$),
  '42501 PURCHASE_ORDER_RECEIVE_THROUGH_FUNCTION', '6 nor received by a direct write');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000002',
  $$delete from public.purchase_orders where id = current_setting('test.order_alpha')::uuid$$),
  'ok 0', '6 nor deleted, even by an admin: a member deletes drafts only');
select is((select count(*)::integer from public.purchase_orders where id = current_setting('test.order_alpha')::uuid), 1,
  '6 the confirmed order is still there');
select is((select count(*)::integer from private.material_request_line_orders
    where purchase_order_id = current_setting('test.order_alpha')::uuid), 2,
  '6 its request lines stay ordered');

-- ---------------------------------------------------------------------------
-- 7. The reception.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.receive_material_request_purchase_order(%L::uuid, %s, jsonb_build_object('received_on', current_date::text))$$,
    current_setting('test.order_beta'), pg_temp.revision('test.order_beta'))),
  '55000 PURCHASE_ORDER_RECEPTION_NOT_CONFIRMED', '7 a draft is not received');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.receive_material_request_purchase_order(%L::uuid, %s, '{"received_on": "2026-11-11"}'::jsonb)$$,
    current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'))),
  '22023 PURCHASE_ORDER_RECEPTION_DATE_INVALID', '7 an order is not received before it was passed');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.receive_material_request_purchase_order(%L::uuid, %s, %L::jsonb)$$,
    current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'),
    jsonb_build_object('received_on', (current_date + 2)::text)::text)),
  '22023 PURCHASE_ORDER_RECEPTION_DATE_INVALID', '7 nor in the future');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.receive_material_request_purchase_order(%L::uuid, %s, %L::jsonb)$$,
    current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'),
    jsonb_build_object('received_on', current_date::text, 'note', repeat('n', 2001))::text)),
  '22023 PURCHASE_ORDER_INPUT_INVALID', '7 a note holds 2 000 characters at most');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000003',
  format($$select public.receive_material_request_purchase_order(%L::uuid, %s, jsonb_build_object('received_on', current_date::text))$$,
    current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'))),
  '42501 PURCHASE_ORDER_ACCESS_DENIED', '7 a viewer does not receive');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.receive_material_request_purchase_order(%L::uuid, %s, jsonb_build_object('received_on', current_date::text))$$,
    current_setting('test.order_alpha'), (pg_temp.revision('test.order_alpha')::bigint - 1)::text)),
  '40001 PURCHASE_ORDER_REVISION_CONFLICT', '7 a stale revision is refused');
select is((select count(*)::integer from public.purchase_order_receptions), 0, '7 the refusals recorded no reception');
select is(pg_temp.pls_rows('a9320000-0000-4000-8000-000000000001',
  format($$select public.receive_material_request_purchase_order(%L::uuid, %s,
      jsonb_build_object('received_on', current_date::text, 'note', '  Reliquat : 500 vis à suivre  '))->>'status' as status$$,
    current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'))),
  '[{"status": "received"}]'::jsonb, '7 the author records the reception');
select results_eq(
  $$select received_on, note, received_by from public.purchase_order_receptions
    where purchase_order_id = current_setting('test.order_alpha')::uuid$$,
  $$values (current_date, 'Reliquat : 500 vis à suivre'::text, 'a9320000-0000-4000-8000-000000000001'::uuid)$$,
  '7 with its date, its trimmed note and who received it');
select results_eq(
  $$select status::text, total_ht_cents, order_date from public.purchase_orders where id = current_setting('test.order_alpha')::uuid$$,
  $$values ('received'::text, 4936 + 5280, '2026-11-12'::date)$$,
  '7 the order is received, its amounts and date unchanged');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  format($$select public.receive_material_request_purchase_order(%L::uuid, %s, jsonb_build_object('received_on', current_date::text))$$,
    current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'))),
  '55000 PURCHASE_ORDER_RECEPTION_NOT_CONFIRMED', '7 a received order is not received twice');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000002',
  $$update public.purchase_orders set status = 'confirmed' where id = current_setting('test.order_alpha')::uuid$$),
  '23514 PURCHASE_ORDER_STATUS_TRANSITION_INVALID', '7 a received order does not change again');
select is(pg_temp.pls_run('a9320000-0000-4000-8000-000000000001',
  $$delete from public.purchase_orders where id = current_setting('test.order_alpha')::uuid$$),
  'ok 0', '7 nor is it deleted');
select is((select status::text from public.purchase_orders where id = current_setting('test.order_alpha')::uuid), 'received',
  '7 the received order is still there');
select is(pg_temp.pls_rows('a9320000-0000-4000-8000-000000000005',
  $$select note from public.purchase_order_receptions$$),
  '[]'::jsonb, '7 an engineer who may not open the order reads no reception');

select * from finish();
rollback;
