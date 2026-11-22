-- The shipping and the discount of a supplier's quote, carried into the drafts made from the request (TI-691, lot 2
-- « l'achat »). Written before the migration 20261122175145_material_request_quote_shipping_discount.sql. Failure modes
-- this file guards, with fictional members, suppliers, articles and lines:
--  1. a quote's shipping or discount is not written by update_material_request_quote (nor cleared by null), or a
--     negative, decimal or text amount is accepted; a viewer writes them; they change once the quote is retained or
--     closed, through the function or by a direct update;
--  2. a quote is retained with a discount larger than its lines and its shipping (its draft would total < 0), or with
--     one equal to them before tax whose tax, rounded once, exceeds theirs, rounded per line (its draft could never be
--     made); or one equal to them, tax included, is refused;
--  3. a draft made from the request misses the shipping or the discount of the retained quote that priced its lines,
--     carries a zero or empty one, takes another supplier's, puts them before the articles, with another amount, kind,
--     quantity, unit, tax rate or quote, or totals otherwise than lines + shipping - discount;
--  4. a member writes a quote charge line directly, or changes the quote of a line, in a draft;
--  5b. a quote whose lines are ordered in two drafts (one returned to draft after the retain) puts its charges in the
--     first, or a draft whose discount exceeds what it holds fails at commit without a word (every supplier's draft
--     rolled back as a generic error) instead of a coded refusal naming the supplier;
--  5. a quote's charge is held by two orders that stand: a second creation, an order made again after a cancellation
--     that does not take it back, a canceled order reopened while another holds it; a charge removed from its draft
--     stays held;
--  6. the supply cost of the affaire does not count the charges in its « Port et remises » row;
--  7. the new functions reach anon or authenticated, run without a pinned search_path, or the ledger is readable.
-- Every member statement goes through pg_temp.pls_run or pg_temp.pls_rows (role and JWT switched in a sub-block), so a
-- red assertion fails on its own reason and the file runs to the end. Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Tenant 101: 1 engineer who owns affaire 201 and makes the orders, 2 admin, 3 viewer, 5 engineer who is not the
-- author. Member 4 is the admin of tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9330000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'charges-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 5) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9330000-%';
insert into public.tenants (id, name, slug) values
  ('a9330000-0000-4000-8000-000000000101', 'Charges fixture', 'charges-fixture'),
  ('a9330000-0000-4000-8000-000000000102', 'Charges autre tenant', 'charges-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 4 then 'a9330000-0000-4000-8000-000000000102' else 'a9330000-0000-4000-8000-000000000101' end)::uuid,
  ('a9330000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'viewer' when 4 then 'admin' else 'engineer' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 5) n;

insert into public.suppliers (id, tenant_id, name) values
  ('a9330000-0000-4000-8000-000000000301', 'a9330000-0000-4000-8000-000000000101', 'TI691 Charges Alpha'),
  ('a9330000-0000-4000-8000-000000000302', 'a9330000-0000-4000-8000-000000000101', 'TI691 Charges Beta');
insert into public.products (id, tenant_id, reference, designation, unit_price_cents, product_type, material, unit) values
  ('a9330000-0000-4000-8000-000000000501', 'a9330000-0000-4000-8000-000000000101', 'CHG-501', 'TI691 Coude 90° inox DN 50',
    100, 'Coude 90°', 'Inox 304L', 'u'),
  ('a9330000-0000-4000-8000-000000000502', 'a9330000-0000-4000-8000-000000000101', 'CHG-502', 'TI691 Vis inox M6x20',
    1, 'Vis', 'Inox 304L', 'u');
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9330000-0000-4000-8000-000000000201', 'a9330000-0000-4000-8000-000000000101', 'a9330000-0000-4000-8000-000000000001',
    'TI691 Affaire port et remise');
insert into public.delivery_sites (id, tenant_id, name, is_active, updated_at) values
  ('a9330000-0000-4000-8000-000000000801', 'a9330000-0000-4000-8000-000000000101', 'TI691 Chantier port', true,
    now() - interval '1 second');
-- Request 601, needed on 20/11/2026: L1 elbows and L2 screws at Alpha, L3 sleeves at Beta.
insert into public.material_requests (id, project_id, requested_on, needed_on, delivery_place, created_by) values
  ('a9330000-0000-4000-8000-000000000601', 'a9330000-0000-4000-8000-000000000201', '2026-11-10', '2026-11-20', 'site',
    'a9330000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation, product_id, product_match) values
  ('a9330000-0000-4000-8000-000000000701', 'a9330000-0000-4000-8000-000000000601', 1, 4, 'u', 'DN 50', false, 'Coude 90°',
    'Inox 304L', 'project', 'a9330000-0000-4000-8000-000000000501', 'manual'),
  ('a9330000-0000-4000-8000-000000000702', 'a9330000-0000-4000-8000-000000000601', 2, 1500, 'u', 'M6x20', false, 'Vis',
    'Inox 304L', 'project', 'a9330000-0000-4000-8000-000000000502', 'manual'),
  ('a9330000-0000-4000-8000-000000000703', 'a9330000-0000-4000-8000-000000000601', 3, 2, 'u', 'DN 40', false, 'Manchon',
    'PVC', 'project', null, null);
update public.material_request_lines set status = 'validated' where request_id = 'a9330000-0000-4000-8000-000000000601';

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

-- Runs one query as a signed-in member: its rows as a JSON array, or { error, message, detail when there is one }.
create function pg_temp.pls_rows(p_user uuid, p_sql text)
returns jsonb
language plpgsql
as $run$
declare
  run_result jsonb;
  error_detail text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute format('select coalesce(jsonb_agg(to_jsonb(answer)), ''[]''::jsonb) from (%s) answer', p_sql) into run_result;
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    run_result := jsonb_strip_nulls(jsonb_build_object('error', sqlstate, 'message', sqlerrm, 'detail', nullif(error_detail, '')));
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- Quotes: Alpha for L1 (4 elbows) and L2 (1 500 screws), Beta for L3 (2 sleeves).
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9330000-0000-4000-8000-000000000601', 'a9330000-0000-4000-8000-000000000301',
    false, 'Bonjour', array['a9330000-0000-4000-8000-000000000701', 'a9330000-0000-4000-8000-000000000702']::uuid[])$$),
  'ok 1', 'fixture: the owner asks Alpha for L1 and L2');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9330000-0000-4000-8000-000000000601', 'a9330000-0000-4000-8000-000000000302',
    false, 'Bonjour', array['a9330000-0000-4000-8000-000000000703']::uuid[])$$),
  'ok 1', 'fixture: and Beta for L3');
select set_config('test.quote_alpha', (select id::text from public.material_request_quotes
  where request_id = 'a9330000-0000-4000-8000-000000000601' and supplier_id = 'a9330000-0000-4000-8000-000000000301'), true);
select set_config('test.quote_beta', (select id::text from public.material_request_quotes
  where request_id = 'a9330000-0000-4000-8000-000000000601' and supplier_id = 'a9330000-0000-4000-8000-000000000302'), true);

-- 1. Alpha answers: L1 at 12,34 € (49,36 €), L2 at 3,40 € for 100 (51,00 €), 33,91 € of shipping, 5,00 € off.
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_alpha')::uuid, jsonb_build_object('received', true,
    'shipping_ht_cents', 3391, 'discount_ht_cents', 500, 'lines', jsonb_build_array(
      jsonb_build_object('line_id', 'a9330000-0000-4000-8000-000000000701', 'unit_price_ht_cents', 1234),
      jsonb_build_object('line_id', 'a9330000-0000-4000-8000-000000000702', 'unit_price_ht_cents', 340, 'price_per', 100))))$$),
  'ok 1', '1 the owner records Alpha''s answer with its shipping and discount');
select is((select array[shipping_ht_cents, discount_ht_cents] from public.material_request_quotes
  where id = current_setting('test.quote_alpha')::uuid), array[3391, 500], '1 the quote holds them');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  format($$select public.update_material_request_quote(%L::uuid, '{"shipping_ht_cents": -1}')$$, current_setting('test.quote_alpha'))),
  '22023 MATERIAL_REQUEST_QUOTE_CHANGES_INVALID', '1 a negative shipping is refused');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  format($$select public.update_material_request_quote(%L::uuid, '{"discount_ht_cents": 12.5}')$$, current_setting('test.quote_alpha'))),
  '22023 MATERIAL_REQUEST_QUOTE_CHANGES_INVALID', '1 a discount in fractions of a cent is refused');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  format($$select public.update_material_request_quote(%L::uuid, '{"discount_ht_cents": "500"}')$$, current_setting('test.quote_alpha'))),
  '22023 MATERIAL_REQUEST_QUOTE_CHANGES_INVALID', '1 a discount written as text is refused');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000003',
  format($$select public.update_material_request_quote(%L::uuid, '{"shipping_ht_cents": 1}')$$, current_setting('test.quote_alpha'))),
  'P0002 MATERIAL_REQUEST_QUOTE_NOT_FOUND', '1 a viewer, who does not read the affaire''s requests, does not write the shipping');
select is((select shipping_ht_cents from public.material_request_quotes where id = current_setting('test.quote_alpha')::uuid),
  3391, '1 the refusals wrote nothing');

-- Beta answers L3 at 9,99 € (19,98 €), a shipping then cleared, and 30,00 € off: more than its lines.
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_beta')::uuid, jsonb_build_object('received', true,
    'shipping_ht_cents', 700, 'discount_ht_cents', 3000,
    'lines', jsonb_build_array(jsonb_build_object('line_id', 'a9330000-0000-4000-8000-000000000703', 'unit_price_ht_cents', 999))))$$),
  'ok 1', 'fixture: Beta answers');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  format($$select public.update_material_request_quote(%L::uuid, '{"shipping_ht_cents": null}')$$, current_setting('test.quote_beta'))),
  'ok 1', '1 null clears the shipping');
select is((select shipping_ht_cents from public.material_request_quotes where id = current_setting('test.quote_beta')::uuid),
  null::integer, '1 the shipping is cleared');

-- 2. The discount of a retained quote is no larger than its lines and its shipping.
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_beta')::uuid)$$),
  '23514 MATERIAL_REQUEST_QUOTE_DISCOUNT_TOO_LARGE', '2 Beta is not retained with 30,00 € off 19,98 €');
select is((select status from public.material_request_quotes where id = current_setting('test.quote_beta')::uuid),
  'received', '2 the refusal retained nothing');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  format($$select public.update_material_request_quote(%L::uuid, '{"discount_ht_cents": 1998}')$$, current_setting('test.quote_beta'))),
  'ok 1', 'fixture: Beta''s discount becomes its whole lines');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_beta')::uuid)$$), 'ok 0',
  '2 a discount equal to the lines is retained');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_alpha')::uuid)$$), 'ok 0',
  'fixture: Alpha is retained');

-- 1. Retained: the charges are read-only, through the function and directly.
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  format($$select public.update_material_request_quote(%L::uuid, '{"shipping_ht_cents": 1}')$$, current_setting('test.quote_alpha'))),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '1 a retained quote''s shipping does not change through the function');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$update public.material_request_quotes set discount_ht_cents = 0 where id = current_setting('test.quote_alpha')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '1 nor its discount by a direct update');

-- 3. One draft per supplier, each with its quote's charges after its articles.
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9330000-0000-4000-8000-000000000601',
    'a9330000-0000-4000-8000-00000000a001')$$), 'ok 1', 'fixture: the owner makes the drafts');
select set_config('test.order_alpha', (select id::text from public.purchase_orders
  where project_id = 'a9330000-0000-4000-8000-000000000201' and supplier_id = 'a9330000-0000-4000-8000-000000000301'), true);
select set_config('test.order_beta', (select id::text from public.purchase_orders
  where project_id = 'a9330000-0000-4000-8000-000000000201' and supplier_id = 'a9330000-0000-4000-8000-000000000302'), true);
select is((select jsonb_agg(jsonb_build_array(position, line_kind, designation, quantity, unit, unit_price_ht_cents, price_per,
    tax_rate_bp, line_total_ht_cents, line_tax_cents, imputation, material_request_quote_id::text) order by position)
  from public.purchase_order_items where purchase_order_id = current_setting('test.order_alpha')::uuid and line_kind <> 'article'),
  jsonb_build_array(
    jsonb_build_array(3, 'shipping', 'Port', 1, 'forfait', 3391, 1, 2000, 3391, 678, 'project', current_setting('test.quote_alpha')),
    jsonb_build_array(4, 'discount', 'Remise', 1, 'forfait', 500, 1, 2000, -500, -100, 'project', current_setting('test.quote_alpha'))),
  '3 Alpha''s draft carries its shipping then its discount, after its two articles, linked to its quote');
select is((select array[total_ht_cents, total_tax_cents] from public.purchase_orders where id = current_setting('test.order_alpha')::uuid),
  array[4936 + 5100 + 3391 - 500, 987 + 1020 + 678 - 100], '3 Alpha''s draft totals its lines, plus shipping, minus discount');
select is((select jsonb_agg(jsonb_build_array(line_kind, line_total_ht_cents) order by position)
  from public.purchase_order_items where purchase_order_id = current_setting('test.order_beta')::uuid),
  jsonb_build_array(jsonb_build_array('article', 1998), jsonb_build_array('discount', -1998)),
  '3 Beta''s draft carries its discount only: its cleared shipping makes no line');
select is((select total_ht_cents from public.purchase_orders where id = current_setting('test.order_beta')::uuid), 0,
  '3 and totals nothing');

-- 4. A charge line is the function's: not written, nor relinked, by a member.
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$insert into public.purchase_order_items (purchase_order_id, position, designation, quantity, unit, unit_price_ht_cents,
      tax_rate_bp, line_kind, material_request_quote_id)
    values (current_setting('test.order_alpha')::uuid, 9, 'Port', 1, 'forfait', 100, 2000, 'shipping',
      current_setting('test.quote_alpha')::uuid)$$),
  '42501 PURCHASE_ORDER_REQUEST_LINES_THROUGH_FUNCTION', '4 a member does not write a quote''s charge into a draft');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$update public.purchase_order_items set material_request_quote_id = current_setting('test.quote_beta')::uuid
    where purchase_order_id = current_setting('test.order_alpha')::uuid and line_kind = 'shipping'$$),
  '22023 PURCHASE_ORDER_ITEMS_INVALID', '4 nor relinks a charge to another quote');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$update public.purchase_order_items set unit_price_ht_cents = 3500
    where purchase_order_id = current_setting('test.order_alpha')::uuid and line_kind = 'shipping'$$),
  'ok 1', '4 the shipping''s amount stays editable in the draft, as any shipping line');

-- 6. The supply cost counts the charges of the drafts in « Port et remises ».
select is((select (row->>'pending_cents')::integer from jsonb_array_elements(
    (pg_temp.pls_rows('a9330000-0000-4000-8000-000000000001',
      $$select public.affaire_supply_cost('a9330000-0000-4000-8000-000000000201') as r$$)->0->'r'->'rows')) row
  where row->>'kind' = 'shipping_discount'),
  3500 - 500 - 1998, '6 the supply cost counts shipping minus discounts');

-- 5. A charge is held once: canceling frees it for the next draft, reopening the first is then refused.
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'canceled' where id = current_setting('test.order_alpha')::uuid$$),
  'ok 1', 'fixture: the owner cancels Alpha''s draft');
select is((select count(*)::integer from private.material_request_quote_charge_orders
  where quote_id = current_setting('test.quote_alpha')::uuid), 0, '5 canceling frees Alpha''s charges');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9330000-0000-4000-8000-000000000601',
    'a9330000-0000-4000-8000-00000000a002')$$), 'ok 1', 'fixture: the owner orders Alpha''s lines again');
select set_config('test.order_alpha_again', (select id::text from public.purchase_orders
  where supplier_id = 'a9330000-0000-4000-8000-000000000301' and project_id = 'a9330000-0000-4000-8000-000000000201'
    and status = 'draft'), true);
select is((select jsonb_agg(jsonb_build_array(line_kind, unit_price_ht_cents) order by position)
  from public.purchase_order_items where purchase_order_id = current_setting('test.order_alpha_again')::uuid
    and line_kind <> 'article'),
  jsonb_build_array(jsonb_build_array('shipping', 3391), jsonb_build_array('discount', 500)),
  '5 the new draft takes the quote''s charges back, at the quote''s amounts');
select is((select count(*)::integer from private.material_request_quote_charge_orders
  where purchase_order_id = current_setting('test.order_alpha_again')::uuid), 2, '5 and holds them');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_alpha')::uuid$$),
  '23505 MATERIAL_REQUEST_LINE_ALREADY_ORDERED', '5 the canceled draft is not reopened while another holds its lines');
-- Its lines freed by hand, the reopening still meets the charges.
delete from private.material_request_line_orders where purchase_order_id = current_setting('test.order_alpha_again')::uuid;
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_alpha')::uuid$$),
  '23505 MATERIAL_REQUEST_LINE_ALREADY_ORDERED', '5 nor while another holds its charges');
insert into private.material_request_line_orders (line_id, tenant_id, purchase_order_id, item_id)
select material_request_line_id, tenant_id, purchase_order_id, id from public.purchase_order_items
where purchase_order_id = current_setting('test.order_alpha_again')::uuid and material_request_line_id is not null;
-- Removed from its draft, a charge is held no more; nothing makes it again while the quote's lines stand ordered.
delete from public.purchase_order_items
where purchase_order_id = current_setting('test.order_alpha_again')::uuid and line_kind = 'discount';
select is((select array_agg(line_kind) from private.material_request_quote_charge_orders
  where quote_id = current_setting('test.quote_alpha')::uuid), array['shipping'], '5 a removed discount is held no more');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9330000-0000-4000-8000-000000000601',
    'a9330000-0000-4000-8000-00000000a003')$$),
  '22023 MATERIAL_REQUEST_ORDER_NOTHING_READY', '5 and no new draft carries it alone');

-- 5b. Request 602: Alpha quotes L4 at 1 000 € and L5 at 100 €, 500 € off, retained; L5 then returns to draft.
insert into public.material_requests (id, project_id, requested_on, needed_on, delivery_place, created_by) values
  ('a9330000-0000-4000-8000-000000000602', 'a9330000-0000-4000-8000-000000000201', '2026-11-11', '2026-11-21', 'site',
    'a9330000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation) values
  ('a9330000-0000-4000-8000-000000000704', 'a9330000-0000-4000-8000-000000000602', 1, 1, 'u', 'DN 80', false, 'Vanne',
    'Fonte', 'project'),
  ('a9330000-0000-4000-8000-000000000705', 'a9330000-0000-4000-8000-000000000602', 2, 1, 'u', 'DN 20', false, 'Clapet',
    'Laiton', 'project');
update public.material_request_lines set status = 'validated' where request_id = 'a9330000-0000-4000-8000-000000000602';
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9330000-0000-4000-8000-000000000602', 'a9330000-0000-4000-8000-000000000301',
    false, 'Bonjour', array['a9330000-0000-4000-8000-000000000704', 'a9330000-0000-4000-8000-000000000705']::uuid[])$$),
  'ok 1', 'fixture: the owner asks Alpha for L4 and L5');
select set_config('test.quote_split', (select id::text from public.material_request_quotes
  where request_id = 'a9330000-0000-4000-8000-000000000602'), true);
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_split')::uuid, jsonb_build_object('received', true,
    'discount_ht_cents', 50000, 'lines', jsonb_build_array(
      jsonb_build_object('line_id', 'a9330000-0000-4000-8000-000000000704', 'unit_price_ht_cents', 100000),
      jsonb_build_object('line_id', 'a9330000-0000-4000-8000-000000000705', 'unit_price_ht_cents', 10000))))$$),
  'ok 1', 'fixture: Alpha answers with 500 € off');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_split')::uuid)$$), 'ok 0',
  'fixture: the quote is retained (500 € off 1 100 €)');
update public.material_request_lines set status = 'draft' where id = 'a9330000-0000-4000-8000-000000000705';
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9330000-0000-4000-8000-000000000602',
    'a9330000-0000-4000-8000-00000000a004')$$), 'ok 1', 'fixture: the owner orders L4 alone');
select is((select jsonb_agg(jsonb_build_array(oi.line_kind, oi.line_total_ht_cents) order by oi.position)
  from public.purchase_order_items oi join public.purchase_orders po on po.id = oi.purchase_order_id
  where po.project_id = 'a9330000-0000-4000-8000-000000000201' and po.status = 'draft'
    and exists (select 1 from public.purchase_order_items l4 where l4.purchase_order_id = po.id
      and l4.material_request_line_id = 'a9330000-0000-4000-8000-000000000704')),
  jsonb_build_array(jsonb_build_array('article', 100000)),
  '5b a draft that does not complete its quote carries none of its charges');
update public.material_request_lines set status = 'validated' where id = 'a9330000-0000-4000-8000-000000000705';
select is(pg_temp.pls_rows('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9330000-0000-4000-8000-000000000602',
    'a9330000-0000-4000-8000-00000000a005') as r$$) - 'error',
  jsonb_build_object('message', 'MATERIAL_REQUEST_ORDER_TOTAL_NEGATIVE', 'detail', '["TI691 Charges Alpha"]'),
  '5b the draft completing it, 100 € with 500 € off, is refused by a coded word naming its supplier');
select is((select count(*)::integer from public.purchase_order_items
  where material_request_line_id = 'a9330000-0000-4000-8000-000000000705'), 0, '5b and nothing of it is written');

-- 1. The function checks an amount against its column before anything else.
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  format($$select public.update_material_request_quote(%L::uuid, '{"shipping_ht_cents": 2147483648}')$$,
    current_setting('test.quote_split'))),
  '22023 MATERIAL_REQUEST_QUOTE_CHANGES_INVALID', '1 an amount the column cannot hold is refused as invalid');

-- 2. Request 603: two lines of 5,02 € and 10,04 € off: zero before tax, -0,01 € of tax (2 x 1,00 € - 2,01 €).
insert into public.material_requests (id, project_id, requested_on, needed_on, delivery_place, created_by) values
  ('a9330000-0000-4000-8000-000000000603', 'a9330000-0000-4000-8000-000000000201', '2026-11-12', '2026-11-22', 'site',
    'a9330000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation) values
  ('a9330000-0000-4000-8000-000000000706', 'a9330000-0000-4000-8000-000000000603', 1, 1, 'u', 'DN 15', false, 'Bouchon',
    'Laiton', 'project'),
  ('a9330000-0000-4000-8000-000000000707', 'a9330000-0000-4000-8000-000000000603', 2, 1, 'u', 'DN 15', false, 'Mamelon',
    'Laiton', 'project');
update public.material_request_lines set status = 'validated' where request_id = 'a9330000-0000-4000-8000-000000000603';
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9330000-0000-4000-8000-000000000603', 'a9330000-0000-4000-8000-000000000301',
    false, 'Bonjour', array['a9330000-0000-4000-8000-000000000706', 'a9330000-0000-4000-8000-000000000707']::uuid[])$$),
  'ok 1', 'fixture: the owner asks Alpha for two fittings');
select set_config('test.quote_tax', (select id::text from public.material_request_quotes
  where request_id = 'a9330000-0000-4000-8000-000000000603'), true);
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_tax')::uuid, jsonb_build_object('received', true,
    'discount_ht_cents', 1004, 'lines', jsonb_build_array(
      jsonb_build_object('line_id', 'a9330000-0000-4000-8000-000000000706', 'unit_price_ht_cents', 502),
      jsonb_build_object('line_id', 'a9330000-0000-4000-8000-000000000707', 'unit_price_ht_cents', 502))))$$),
  'ok 1', 'fixture: Alpha answers 10,04 € off two lines of 5,02 €');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_tax')::uuid)$$),
  '23514 MATERIAL_REQUEST_QUOTE_DISCOUNT_TOO_LARGE', '2 a discount whose tax would exceed its lines'' is not retained');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  format($$select public.update_material_request_quote(%L::uuid, '{"discount_ht_cents": 1000}')$$, current_setting('test.quote_tax'))),
  'ok 1', 'fixture: the discount becomes 10,00 € (tax 2,00 €, the lines'' 2,00 €)');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_tax')::uuid)$$), 'ok 0',
  '2 a discount equal to the lines'' tax is retained');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9330000-0000-4000-8000-000000000603',
    'a9330000-0000-4000-8000-00000000a006')$$), 'ok 1', '2 and its draft is made');
select is((select array[po.total_ht_cents, po.total_tax_cents] from public.purchase_orders po
  where exists (select 1 from public.purchase_order_items oi where oi.purchase_order_id = po.id
    and oi.material_request_line_id = 'a9330000-0000-4000-8000-000000000706')), array[4, 0],
  '2 at 0,04 € before tax and nothing of tax');

-- 7. Rights and shape of the new objects.
select ok((select bool_and(not has_function_privilege(role_name, p.oid, 'EXECUTE')
    and p.proconfig @> array['search_path=""'])
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) roles(role_name)
  where n.nspname = 'private' and p.proname in ('guard_material_request_quote_charges', 'guard_purchase_order_item_quote_charge',
    'track_material_request_quote_charge_order', 'track_material_request_quote_charge_order_status')),
  '7 the new trigger functions reach neither anon nor authenticated and pin their search_path');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in ('guard_material_request_quote_charges', 'guard_purchase_order_item_quote_charge',
    'track_material_request_quote_charge_order', 'track_material_request_quote_charge_order_status')), 4,
  '7 the four trigger functions exist');
select ok(not has_table_privilege('authenticated', 'private.material_request_quote_charge_orders', 'SELECT')
  and not has_table_privilege('anon', 'private.material_request_quote_charge_orders', 'SELECT')
  and not has_table_privilege('service_role', 'private.material_request_quote_charge_orders', 'SELECT'),
  '7 the ledger of charges is read by no Data API role');
select ok(not has_function_privilege('anon', 'public.update_material_request_quote(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_material_request_purchase_orders(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_material_request_quote(uuid, jsonb)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_material_request_purchase_orders(uuid, uuid)', 'EXECUTE'),
  '7 the replaced functions keep their grants');

select * from finish();
rollback;
