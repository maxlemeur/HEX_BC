-- The supply cost of an affaire (TI-691, lot 2 « l'achat », delivery 4): per supply type, the supply budget of the
-- version its client accepted, face to what its orders cost. Written before the migration that adds
-- public.affaire_supply_cost. Failure modes this file guards, with fictional members, suppliers, articles and lines:
--  1. the function reaches anon or PUBLIC, or runs without a pinned search_path;
--  2. it answers a member who may not read the affaire (a viewer, an engineer who does not own it), or a member of
--     another tenant; it refuses a director, who reads every affaire; it answers an unknown or archived affaire
--     instead of refusing it (the API finds neither);
--  3. without an accepted version, a budget is shown (from the last version, a sent one or a variant): the rule of
--     13/11/2026 is « no accepted version, no budget », the ordered cost alone;
--  4. the budget is not the accepted variant's: the base version or a sum of variants is taken; with two accepted
--     versions, the lower one is taken (the affaires list keeps the highest number);
--  5. the budget of a line is not its supply cost: a line not priced counts, the sale price is used instead of
--     Q × P × FO provision × K FO, it is rounded on the sum instead of per line, half to even instead of half up, a
--     section counts, an engine 1 or 2 line is not Q × P × K FO;
--  6. a line without supply type is lost instead of going to « non classé »;
--  7. the ordered cost is not the real one: a draft or a sent order counts as ordered (it is « en cours », at its quote's
--     price), a canceled order counts, a received order does not, the frais généraux of the order count, shipping and
--     discounts are mixed with a supply type, a discount adds instead of subtracting, an order line without article
--     is lost, an order without affaire counts;
--  8. the orders made from an estimate of the affaire (that path sets no affaire on the order) are counted silently
--     instead of being named as not counted.
-- Every member statement goes through pg_temp.pls_run or pg_temp.pls_rows (role and JWT switched in a sub-block), so a
-- red assertion fails on its own reason and the file runs to the end. Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Tenant 101: 1 engineer who owns affaire 201 and makes the orders, 2 admin, 3 viewer, 5 engineer who does not own the
-- affaire, 6 director. Member 4 is the admin of tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9340000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'supply-cost-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 6) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9340000-%';
insert into public.tenants (id, name, slug) values
  ('a9340000-0000-4000-8000-000000000101', 'Coût fournitures fixture', 'cout-fournitures-fixture'),
  ('a9340000-0000-4000-8000-000000000102', 'Coût fournitures autre tenant', 'cout-fournitures-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 4 then 'a9340000-0000-4000-8000-000000000102' else 'a9340000-0000-4000-8000-000000000101' end)::uuid,
  ('a9340000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'viewer' when 4 then 'admin' when 6 then 'director'
    else 'engineer' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 6) n;

insert into public.supply_types (id, tenant_id, code, name) values
  ('a9340000-0000-4000-8000-000000000401', 'a9340000-0000-4000-8000-000000000101', 'ti691-tube', 'TI691 Tubes'),
  ('a9340000-0000-4000-8000-000000000402', 'a9340000-0000-4000-8000-000000000101', 'ti691-raccord', 'TI691 Raccords');
insert into public.suppliers (id, tenant_id, name) values
  ('a9340000-0000-4000-8000-000000000301', 'a9340000-0000-4000-8000-000000000101', 'TI691 Coût Alpha'),
  ('a9340000-0000-4000-8000-000000000302', 'a9340000-0000-4000-8000-000000000101', 'TI691 Coût Beta');
insert into public.products (id, tenant_id, reference, designation, unit_price_cents, product_type, material, unit,
  supply_type_id) values
  ('a9340000-0000-4000-8000-000000000501', 'a9340000-0000-4000-8000-000000000101', 'CST-501', 'TI691 Tube inox DN 50',
    1000, 'Tube', 'Inox 304L', 'm', 'a9340000-0000-4000-8000-000000000401'),
  ('a9340000-0000-4000-8000-000000000502', 'a9340000-0000-4000-8000-000000000101', 'CST-502', 'TI691 Coude inox DN 50',
    200, 'Coude 90°', 'Inox 304L', 'u', 'a9340000-0000-4000-8000-000000000402');
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9340000-0000-4000-8000-000000000201', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000001',
    'TI691 Affaire coût'),
  ('a9340000-0000-4000-8000-000000000202', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000001',
    'TI691 Affaire sans commande');
insert into public.delivery_sites (id, tenant_id, name, is_active, updated_at) values
  ('a9340000-0000-4000-8000-000000000801', 'a9340000-0000-4000-8000-000000000101', 'TI691 Chantier coût', true,
    now() - interval '1 second');

-- Version 1 of affaire 201, sent, never accepted: its 113,00 € of tubes must never be a budget.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, title,
  sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents)
values ('a9340000-0000-4000-8000-000000000211', 'a9340000-0000-4000-8000-000000000101',
  'a9340000-0000-4000-8000-000000000201', 1, 'sent', 3, 'TI691 Base envoyée', 1, 1, 0, 0, 0);
set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items disable trigger ae_track_estimate_item_status_reason;
alter table public.estimate_items disable trigger bump_estimate_content_revision_from_item;
select set_config('miaouffrage.estimate_v3_writer', 'a9340000-0000-4000-8000-000000000211', true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
values ('a9340000-0000-4000-8000-000000002110', 'a9340000-0000-4000-8000-000000000101',
  'a9340000-0000-4000-8000-000000000211', null, 'section', 1, 'TI691 Lot base');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, fo_provision, h_mo_majoration, k_mo, unit_code, pricing_status, h_mo_per_unit,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, supply_type_id) values
  ('a9340000-0000-4000-8000-000000002111', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000211',
    'a9340000-0000-4000-8000-000000002110', 'line', 1, 'TI691 Tube base', 10, 1000, 2000, 1.13, 1, 1, 1, 'ml', 'priced', 0, 0, 0, 0, 0,
    'a9340000-0000-4000-8000-000000000401');
select set_config('miaouffrage.estimate_v3_writer', '', true);
set constraints public.estimate_items_parent_id_fkey immediate;
alter table public.estimate_items enable trigger ae_track_estimate_item_status_reason;
alter table public.estimate_items enable trigger bump_estimate_content_revision_from_item;

-- Request 601 of affaire 201: L1 tubes (article 501), L2 elbows (article 502), L3 sleeves without article, L4 gloves
-- (frais généraux). Alpha is asked L1, L2 and L4; Beta L3.
insert into public.material_requests (id, project_id, requested_on, needed_on, delivery_place, created_by) values
  ('a9340000-0000-4000-8000-000000000601', 'a9340000-0000-4000-8000-000000000201', '2026-11-10', '2026-11-20', 'site',
    'a9340000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation, overhead_category, product_id, product_match, original_text) values
  ('a9340000-0000-4000-8000-000000000701', 'a9340000-0000-4000-8000-000000000601', 1, 3, 'm', 'DN 50', false, 'Tube',
    'Inox 304L', 'project', null, 'a9340000-0000-4000-8000-000000000501', 'manual', null),
  ('a9340000-0000-4000-8000-000000000702', 'a9340000-0000-4000-8000-000000000601', 2, 10, 'u', 'DN 50', false, 'Coude 90°',
    'Inox 304L', 'project', null, 'a9340000-0000-4000-8000-000000000502', 'manual', null),
  ('a9340000-0000-4000-8000-000000000703', 'a9340000-0000-4000-8000-000000000601', 3, 2, 'u', 'DN 40', false, 'Manchon',
    'PVC', 'project', null, null, null, null),
  ('a9340000-0000-4000-8000-000000000704', 'a9340000-0000-4000-8000-000000000601', 4, 1, 'paire', null, true, 'Gants',
    null, 'overhead', 'EPI', null, null, 'gants taille 9');
update public.material_request_lines set status = 'validated' where request_id = 'a9340000-0000-4000-8000-000000000601';

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

-- The supply cost of an affaire as a member: its answer, or { error, message }.
create function pg_temp.cost(p_user uuid, p_project text default 'a9340000-0000-4000-8000-000000000201')
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
    execute 'select public.affaire_supply_cost($1::uuid)' into run_result using p_project;
  exception when others then
    run_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- One row of the answer, by its kind and, for a supply type, its code: « budget ordered pending » (« - » for no budget).
create function pg_temp.row_of(p_answer jsonb, p_kind text, p_code text default null)
returns text
language sql
as $fn$
  select coalesce(row_value->>'budget_cents', '-') || ' ' || (row_value->>'ordered_cents') || ' ' || (row_value->>'pending_cents')
  from jsonb_array_elements(p_answer->'rows') as answer_row(row_value)
  where row_value->>'kind' = p_kind and (p_code is null or row_value->>'code' = p_code)
$fn$;

create function pg_temp.revision(p_order text) returns text language sql as $fn$
  select edit_revision::text from public.purchase_orders where id = current_setting(p_order)::uuid;
$fn$;

-- The retained quotes: Alpha 10,00 € a metre of tube, 2,00 € an elbow, 5,00 € the gloves; Beta 9,99 € a sleeve.
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9340000-0000-4000-8000-000000000601', 'a9340000-0000-4000-8000-000000000301',
    false, 'Bonjour', array['a9340000-0000-4000-8000-000000000701', 'a9340000-0000-4000-8000-000000000702',
    'a9340000-0000-4000-8000-000000000704']::uuid[])$$),
  'ok 1', 'fixture: the owner asks Alpha for L1, L2 and L4');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9340000-0000-4000-8000-000000000601', 'a9340000-0000-4000-8000-000000000302',
    false, 'Bonjour', array['a9340000-0000-4000-8000-000000000703']::uuid[])$$),
  'ok 1', 'fixture: and Beta for L3');
select set_config('test.quote_alpha', (select id::text from public.material_request_quotes
  where request_id = 'a9340000-0000-4000-8000-000000000601' and supplier_id = 'a9340000-0000-4000-8000-000000000301'), true);
select set_config('test.quote_beta', (select id::text from public.material_request_quotes
  where request_id = 'a9340000-0000-4000-8000-000000000601' and supplier_id = 'a9340000-0000-4000-8000-000000000302'), true);
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_alpha')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(
      jsonb_build_object('line_id', 'a9340000-0000-4000-8000-000000000701', 'unit_price_ht_cents', 1000),
      jsonb_build_object('line_id', 'a9340000-0000-4000-8000-000000000702', 'unit_price_ht_cents', 200),
      jsonb_build_object('line_id', 'a9340000-0000-4000-8000-000000000704', 'unit_price_ht_cents', 500))))$$),
  'ok 1', 'fixture: Alpha answers');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_beta')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(jsonb_build_object('line_id', 'a9340000-0000-4000-8000-000000000703', 'unit_price_ht_cents', 999))))$$),
  'ok 1', 'fixture: Beta answers');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_alpha')::uuid)$$), 'ok 0',
  'fixture: Alpha is retained');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_beta')::uuid)$$), 'ok 0',
  'fixture: Beta is retained');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9340000-0000-4000-8000-000000000601',
    'a9340000-0000-4000-8000-00000000a001')$$), 'ok 1', 'fixture: the owner makes one draft per supplier');
select set_config('test.order_alpha', (select id::text from public.purchase_orders
  where project_id = 'a9340000-0000-4000-8000-000000000201' and supplier_id = 'a9340000-0000-4000-8000-000000000301'), true);
select set_config('test.order_beta', (select id::text from public.purchase_orders
  where project_id = 'a9340000-0000-4000-8000-000000000201' and supplier_id = 'a9340000-0000-4000-8000-000000000302'), true);
select set_config('test.item_tubes', (select id::text from public.purchase_order_items
  where material_request_line_id = 'a9340000-0000-4000-8000-000000000701'), true);

-- Alpha's draft gets 15,00 € of shipping and a 3,00 € discount.
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  format($$select public.replace_purchase_order_draft(%L::uuid, '{}'::jsonb, (
      select jsonb_agg(item order by ordinal, position) from (
        select 1 as ordinal, oi.position, jsonb_build_object('id', oi.id, 'designation', oi.designation,
          'reference', oi.reference, 'quantity', oi.quantity, 'unit', oi.unit, 'unit_price_ht_cents', oi.unit_price_ht_cents,
          'price_per', oi.price_per, 'tax_rate_bp', oi.tax_rate_bp, 'product_id', oi.product_id, 'line_kind', oi.line_kind) as item
        from public.purchase_order_items oi where oi.purchase_order_id = %L::uuid
        union all
        select 2, 1, jsonb_build_object('designation', 'TI691 Port fictif', 'quantity', 1, 'unit', 'forfait',
          'unit_price_ht_cents', 1500, 'tax_rate_bp', 2000, 'line_kind', 'shipping')
        union all
        select 2, 2, jsonb_build_object('designation', 'TI691 Remise fictive', 'quantity', 1, 'unit', 'forfait',
          'unit_price_ht_cents', 300, 'tax_rate_bp', 2000, 'line_kind', 'discount')
      ) lines), %s)$$,
    current_setting('test.order_alpha'), current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'))),
  'ok 1', 'fixture: Alpha''s draft gets shipping and a discount');

-- Alpha's proof, stored.
insert into public.purchase_order_devis (id, tenant_id, purchase_order_id, user_id, name, original_filename, storage_path,
  file_size_bytes, mime_type, position)
values ('a9340000-0000-4000-8000-00000000d001', 'a9340000-0000-4000-8000-000000000101',
  current_setting('test.order_alpha')::uuid, 'a9340000-0000-4000-8000-000000000001', 'Confirmation Alpha',
  'confirmation-alpha.pdf', 'purchase-orders/' || current_setting('test.order_alpha') || '/confirmation-alpha.pdf', 1024,
  'application/pdf', 1);
insert into storage.objects (bucket_id, name, metadata)
select 'devis', storage_path, '{"size": 1024}'::jsonb from public.purchase_order_devis
where id = 'a9340000-0000-4000-8000-00000000d001';

-- Alpha is confirmed with the tubes at their real price, 11,00 € a metre (3 m: 33,00 €), then received.
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  format($$select public.confirm_material_request_purchase_order(%L::uuid, %s, %L::jsonb)$$,
    current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'), jsonb_build_object(
      'ordered_on', current_date::text, 'document_id', 'a9340000-0000-4000-8000-00000000d001',
      'lines', jsonb_build_array(jsonb_build_object('id', current_setting('test.item_tubes'), 'unit_price_ht_cents', 1100,
        'price_per', 1)))::text)),
  'ok 1', 'fixture: Alpha is confirmed at its real price');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  format($$select public.receive_material_request_purchase_order(%L::uuid, %s, jsonb_build_object('received_on', current_date::text))$$,
    current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'))),
  'ok 1', 'fixture: and received');

-- A manual order of a site, without affaire, by the same engineer: never this affaire's.
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9340000-0000-4000-8000-000000000301',
    'delivery_site_id', 'a9340000-0000-4000-8000-000000000801', 'notes', 'TI691 manuel coût'), jsonb_build_array(
    jsonb_build_object('designation', 'TI691 manuel', 'quantity', 3, 'unit', 'u', 'unit_price_ht_cents', 500, 'tax_rate_bp', 2000)))$$),
  'ok 1', 'fixture: a manual order of a site');
-- A draft an estimate made before this delivery: its version is the affaire's, its order has no affaire.
update public.purchase_orders set source_estimate_version_id = 'a9340000-0000-4000-8000-000000000211'
where notes = 'TI691 manuel coût' and tenant_id = 'a9340000-0000-4000-8000-000000000101';

-- ---------------------------------------------------------------------------
-- 1. Structure and grants.
-- ---------------------------------------------------------------------------
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid = 'public.affaire_supply_cost(uuid)'::regprocedure),
  '1 the function is security definer with an empty search_path (it checks the rights itself)');
select ok(not has_function_privilege('anon', 'public.affaire_supply_cost(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.affaire_supply_cost(uuid)', 'EXECUTE')
    and not exists (select 1 from pg_proc, aclexplode(proacl) acl
      where oid = 'public.affaire_supply_cost(uuid)'::regprocedure and acl.grantee = 0),
  '1 anon and PUBLIC cannot run it, a member can');

-- ---------------------------------------------------------------------------
-- 2. Who reads it.
-- ---------------------------------------------------------------------------
select is(pg_temp.cost('a9340000-0000-4000-8000-000000000003')->>'message', 'AFFAIRE_SUPPLY_COST_ACCESS_DENIED',
  '2 a viewer who does not own the affaire is refused');
select is(pg_temp.cost('a9340000-0000-4000-8000-000000000005')->>'message', 'AFFAIRE_SUPPLY_COST_ACCESS_DENIED',
  '2 so is an engineer who does not own it');
select is(pg_temp.cost('a9340000-0000-4000-8000-000000000004')->>'message', 'AFFAIRE_SUPPLY_COST_NOT_FOUND',
  '2 the admin of another tenant does not find it');
select is(pg_temp.cost('a9340000-0000-4000-8000-000000000001', 'a9340000-0000-4000-8000-000000000999')->>'message',
  'AFFAIRE_SUPPLY_COST_NOT_FOUND', '2 an unknown affaire is not found');
select is(pg_temp.cost('a9340000-0000-4000-8000-000000000002')->>'error', null,
  '2 the admin reads it, though he made none of its orders');
select is(pg_temp.cost('a9340000-0000-4000-8000-000000000006')->>'error', null, '2 so does a director');

-- ---------------------------------------------------------------------------
-- 3, 7, 8. No accepted version: no budget, the ordered cost alone.
-- ---------------------------------------------------------------------------
select set_config('test.answer', pg_temp.cost('a9340000-0000-4000-8000-000000000001')::text, true);
select is(current_setting('test.answer')::jsonb->'budget_version', 'null'::jsonb,
  '3 the sent version 1 gives no budget');
select is(current_setting('test.answer')::jsonb #>> '{totals,budget_cents}', null, '3 and the totals have none');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'supply_type', 'ti691-tube'), '- 3300 0',
  '7 the tubes are ordered at their real price (3 × 11,00 €), not the quote''s, received included');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'supply_type', 'ti691-raccord'), '- 2000 0',
  '7 the elbows (10 × 2,00 €) are under their article''s supply type');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'unclassified'), '- 0 1998',
  '7 the sleeves without article, in Beta''s draft, are « en cours » under « non classé » at the quote''s price');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'shipping_discount'), '- 1200 0',
  '7 shipping (15,00 €) less the discount (3,00 €) are a row of their own');
select is(current_setting('test.answer')::jsonb #>> '{totals,ordered_cents}', '6500',
  '7 the ordered total leaves out the gloves of the frais généraux and the manual order');
select is(current_setting('test.answer')::jsonb #>> '{totals,pending_cents}', '1998', '7 the pending total is Beta''s draft');
select is(jsonb_array_length(current_setting('test.answer')::jsonb->'rows'), 4,
  '7 four rows: the two supply types, « non classé », shipping and discounts');
select is(current_setting('test.answer')::jsonb #>> '{not_counted,estimate_orders}', '1',
  '8 the order made from an estimate is named as not counted');
select is(pg_temp.cost('a9340000-0000-4000-8000-000000000001', 'a9340000-0000-4000-8000-000000000202')
  ->> 'rows', '[]', '7 an affaire without version nor order has no row');

-- ---------------------------------------------------------------------------
-- 4, 5, 6. The client accepts variant A of version 1, as version 2.
-- ---------------------------------------------------------------------------
-- Its lines: tubes 3 × 12,34 € × 1,13 = 41,8326 € (41,83 €) and 0,5 m of tube at 0,05 € = 0,025 € (0,03 € half up, 0,02 €
-- half to even); an elbow 0,01 € × 1,5 = 0,015 € (0,02 €); 5 elbows not priced (100,00 € that never count); a fitting
-- at 10,00 € with a 1,1 FO provision (11,00 €); 2 sleeves without supply type at 5,00 € × 1,02 (10,20 €) and two caps
-- at 0,01 € × 1,4 = 0,014 € each (0,01 € each per line: 10,22 €; rounding the sum would give 10,23 €); a section.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, title,
  parent_version_id, variant_label, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents)
values ('a9340000-0000-4000-8000-000000000212', 'a9340000-0000-4000-8000-000000000101',
  'a9340000-0000-4000-8000-000000000201', 2, 'accepted', 3, 'TI691 Variante acceptée',
  'a9340000-0000-4000-8000-000000000211', 'A', 1, 1, 0, 0, 0);
set constraints public.estimate_items_parent_id_fkey deferred;
alter table public.estimate_items disable trigger ae_track_estimate_item_status_reason;
alter table public.estimate_items disable trigger bump_estimate_content_revision_from_item;
select set_config('miaouffrage.estimate_v3_writer', 'a9340000-0000-4000-8000-000000000212', true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
values ('a9340000-0000-4000-8000-000000002120', 'a9340000-0000-4000-8000-000000000101',
  'a9340000-0000-4000-8000-000000000212', null, 'section', 1, 'TI691 Lot plomberie');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, fo_provision, h_mo_majoration, k_mo, unit_code, pricing_status, h_mo_per_unit,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, supply_type_id) values
  ('a9340000-0000-4000-8000-000000002121', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000212',
    'a9340000-0000-4000-8000-000000002120', 'line', 1, 'TI691 Tube', 3, 1234, 2000, 1.13, 1, 1, 1, 'ml', 'priced', 0,
    0, 0, 0, 0, 'a9340000-0000-4000-8000-000000000401'),
  ('a9340000-0000-4000-8000-000000002122', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000212',
    'a9340000-0000-4000-8000-000000002120', 'line', 2, 'TI691 Coude', 1, 1, 2000, 1.5, 1, 1, 1, 'u', 'priced', 0,
    0, 0, 0, 0, 'a9340000-0000-4000-8000-000000000402'),
  ('a9340000-0000-4000-8000-000000002123', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000212',
    'a9340000-0000-4000-8000-000000002120', 'line', 3, 'TI691 Coudes non chiffrés', 5, 2000, 2000, 1, 1, 1, 1, 'u',
    'not_priced', 0, null, 0, 0, 0, 'a9340000-0000-4000-8000-000000000402'),
  ('a9340000-0000-4000-8000-000000002124', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000212',
    'a9340000-0000-4000-8000-000000002120', 'line', 4, 'TI691 Raccord provisionné', 1, 1000, 2000, 1, 1.1, 1, 1, 'u',
    'priced', 0, 0, 0, 0, 0, 'a9340000-0000-4000-8000-000000000402'),
  ('a9340000-0000-4000-8000-000000002125', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000212',
    'a9340000-0000-4000-8000-000000002120', 'line', 5, 'TI691 Manchon sans type', 2, 500, 2000, 1.02, 1, 1, 1, 'u',
    'priced', 0, 0, 0, 0, 0, null),
  ('a9340000-0000-4000-8000-000000002126', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000212',
    'a9340000-0000-4000-8000-000000002120', 'line', 6, 'TI691 Chute de tube', 0.5, 5, 2000, 1, 1, 1, 1, 'ml',
    'priced', 0, 0, 0, 0, 0, 'a9340000-0000-4000-8000-000000000401'),
  ('a9340000-0000-4000-8000-000000002127', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000212',
    'a9340000-0000-4000-8000-000000002120', 'line', 7, 'TI691 Bouchon sans type', 1, 1, 2000, 1.4, 1, 1, 1, 'u',
    'priced', 0, 0, 0, 0, 0, null),
  ('a9340000-0000-4000-8000-000000002128', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000212',
    'a9340000-0000-4000-8000-000000002120', 'line', 8, 'TI691 Second bouchon sans type', 1, 1, 2000, 1.4, 1, 1, 1, 'u',
    'priced', 0, 0, 0, 0, 0, null);
select set_config('miaouffrage.estimate_v3_writer', '', true);
set constraints public.estimate_items_parent_id_fkey immediate;
alter table public.estimate_items enable trigger ae_track_estimate_item_status_reason;
alter table public.estimate_items enable trigger bump_estimate_content_revision_from_item;

select set_config('test.answer', pg_temp.cost('a9340000-0000-4000-8000-000000000001')::text, true);
select is((current_setting('test.answer')::jsonb->'budget_version') - 'id',
  '{"version_number": 2, "variant_label": "A", "title": "TI691 Variante acceptée", "accepted_count": 1}'::jsonb,
  '4 the budget is the accepted variant''s');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'supply_type', 'ti691-tube'), '4186 3300 0',
  '5 tubes: 41,83 € + 0,025 € rounded half up to 0,03 € (not half to even), the sent base version''s 113,00 € left out');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'supply_type', 'ti691-raccord'), '1102 2000 0',
  '5 fittings: 0,015 € rounds half up to 0,02 €, the FO provision counts, the line not priced does not');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'unclassified'), '1022 0 1998',
  '6 the lines without supply type are budgeted under « non classé », each rounded on its own (not on their sum)');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'shipping_discount'), '0 1200 0',
  '5 shipping and discounts have no budget of their own');
select is(current_setting('test.answer')::jsonb #>> '{totals,budget_cents}', '6310', '5 the budget total');

-- ---------------------------------------------------------------------------
-- 7. Beta's draft is canceled: it no longer counts.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'canceled' where id = current_setting('test.order_beta')::uuid$$),
  'ok 1', 'fixture: the owner cancels Beta''s draft');
select set_config('test.answer', pg_temp.cost('a9340000-0000-4000-8000-000000000001')::text, true);
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'unclassified'), '1022 0 0',
  '7 a canceled order is neither ordered nor « en cours »');
select is(current_setting('test.answer')::jsonb #>> '{totals,pending_cents}', '0', '7 the pending total follows');

-- ---------------------------------------------------------------------------
-- 4, 5. A second accepted version, numbered 3, on engine 1: it is the budget, without the FO provision.
-- ---------------------------------------------------------------------------
-- Its tube line: 1 × 1,00 € × K FO 1,5 = 1,50 €. An engine 1 or 2 line cannot carry a FO provision
-- (ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED): the database itself keeps it out of the budget there.
select set_config('miaouffrage.estimate_version_insert_contract', 'legacy_v1', true);
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, seal_hash,
  seal_payload_version, title)
values ('a9340000-0000-4000-8000-000000000213', 'a9340000-0000-4000-8000-000000000101',
  'a9340000-0000-4000-8000-000000000201', 3, 'accepted', 1, repeat('b', 64), null, 'TI691 Version moteur 1');
select set_config('miaouffrage.estimate_version_insert_contract', '', true);
select set_config('miaouffrage.estimate_creation_atomic', 'a9340000-0000-4000-8000-000000000213', true);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title, quantity, unit_price_ht_cents,
  tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, supply_type_id)
values ('a9340000-0000-4000-8000-000000002131', 'a9340000-0000-4000-8000-000000000101',
  'a9340000-0000-4000-8000-000000000213', 'line', 1, 'TI691 Tube moteur 1', 1, 100, 2000, 1.5, 0, 1, 150, 150, 30, 180,
  'a9340000-0000-4000-8000-000000000401');
select set_config('miaouffrage.estimate_creation_atomic', '', true);

select set_config('test.answer', pg_temp.cost('a9340000-0000-4000-8000-000000000001')::text, true);
select is((current_setting('test.answer')::jsonb->'budget_version') - 'id' - 'title',
  '{"version_number": 3, "variant_label": null, "accepted_count": 2}'::jsonb,
  '4 with two accepted versions, the highest number is the budget, and the answer says there are two');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'supply_type', 'ti691-tube'), '150 3300 0',
  '5 an engine 1 line is Q × P × K FO');
select is(pg_temp.row_of(current_setting('test.answer')::jsonb, 'supply_type', 'ti691-raccord'), '0 2000 0',
  '4 a supply type the budget version does not carry has a budget of 0, not of the other version');
select is(current_setting('test.answer')::jsonb #>> '{totals,budget_cents}', '150', '4 the budget total is version 3''s');

-- ---------------------------------------------------------------------------
-- 2. An archived affaire is not found, as the API does not find it.
-- ---------------------------------------------------------------------------
update public.estimate_projects set is_archived = true where id = 'a9340000-0000-4000-8000-000000000202';
select is(pg_temp.cost('a9340000-0000-4000-8000-000000000001', 'a9340000-0000-4000-8000-000000000202')->>'message',
  'AFFAIRE_SUPPLY_COST_NOT_FOUND', '2 an archived affaire is not found, even by its owner');

select * from finish();
rollback;
