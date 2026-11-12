-- Purchase orders from material requests (TI-691, lot 2 « l'achat », delivery 3a). Written with the migration
-- 20261112185310_material_request_purchase_orders.sql. Failure modes this file guards, with fictional members,
-- suppliers, articles and lines:
--  1. the two functions reach anon or PUBLIC, run without a pinned search_path, or the ledger and the receipts are
--     readable by a Data API role; an order may lose both its site and its affaire;
--  2. an existing order changes: the totals of a manual order (fractional quantities, 20 % and 5,5 %) or of an
--     estimate-sourced order differ from the previous formula round(quantity x price), a line written again
--     (quantity = quantity) moves by a cent, or existing lines read as something else than an article for 1 unit;
--  3. a viewer, a director, an engineer who does not own the affaire or a member of another tenant creates orders or
--     reads the summary (the director reads it; nothing is written by a refusal); another tenant's request is found;
--  4. the summary does not say which lines are ready, which are not and why (not validated, no supplier, no retained
--     quote), in the request's order;
--  5. the drafts are not one per supplier, the overhead lines do not follow in their supplier's draft imputed to
--     overhead, a line misses its article, reference at the supplier (else the article's), catalogue wording,
--     quantity, unit, quote price and lot, 20 % tax, supply type, imputation or request line; the header has a site,
--     misses its affaire, delivery mode or notes naming the request;
--  6. money: a price for 100 units is not divided, 2,5 cents rounds to 2 (half to even) instead of 3, a discount
--     adds, its tax rounds towards zero, the header totals do not subtract it, a discount larger than the order is
--     accepted, or a draft edit that passes through a negative sum before a valid one is refused;
--  7. the same key creates twice or answers something else; another member replays a key that is not theirs (an
--     admin may); a call with nothing ready writes a receipt;
--  8. a line is ordered twice among orders that are not canceled (directly, by a second call, or by reopening a
--     canceled order); canceling an order, or removing a line from a draft, does not make it ready again; a request
--     whose lines are in an order that stands is deleted; deleting a request whose orders are canceled breaks them;
--  9. a draft edit loses the request line, imputation, affaire, category, supply type or lot of a line, accepts a
--     kind change, a unit change of a request line, a supplier change of a request order, or a discount on an
--     article; shipping and discounts are not imputed to the order's affaire;
-- 10. a member writes request fields directly (request line, imputation, affaire), creates an order of an affaire or
--     a request line outside the function, or changes the affaire of an order;
-- 11. get_purchase_order_documents misses the affaire, the delivery mode, the supply type or the request of a line;
-- 12. an archived supplier is ordered from without its name in the refusal;
-- 13. a line an order that stands holds returns to draft (reopened, or by an edit of what it says), or a line whose
--     order is canceled cannot be reopened; the summary says a director may create orders, or the owner may not;
--     a replay answers the status the drafts had, not the one they have.
-- Every member statement goes through pg_temp.pls_run or pg_temp.pls_rows (role and JWT switched in a sub-block), so a
-- red assertion fails on its own reason and the file runs to the end. Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Tenant 101: 1 engineer who owns affaires 201 and 203, 2 admin, 3 viewer, 5 engineer who owns affaire 202, 6 director.
-- Member 4 is the admin of tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9310000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'commandes-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 6) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9310000-%';
insert into public.tenants (id, name, slug) values
  ('a9310000-0000-4000-8000-000000000101', 'Commandes fixture', 'commandes-fixture'),
  ('a9310000-0000-4000-8000-000000000102', 'Commandes autre tenant', 'commandes-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 4 then 'a9310000-0000-4000-8000-000000000102' else 'a9310000-0000-4000-8000-000000000101' end)::uuid,
  ('a9310000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'viewer' when 4 then 'admin' when 5 then 'engineer'
    else 'director' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 6) n;

insert into public.suppliers (id, tenant_id, name) values
  ('a9310000-0000-4000-8000-000000000301', 'a9310000-0000-4000-8000-000000000101', 'TI691 Fournisseur Alpha'),
  ('a9310000-0000-4000-8000-000000000302', 'a9310000-0000-4000-8000-000000000101', 'TI691 Fournisseur Beta'),
  ('a9310000-0000-4000-8000-000000000309', 'a9310000-0000-4000-8000-000000000102', 'TI691 Fournisseur d''ailleurs');
insert into public.supply_types (id, tenant_id, code, name) values
  ('a9310000-0000-4000-8000-000000000401', 'a9310000-0000-4000-8000-000000000101', 'TI691-RAC', 'TI691 Raccords');
insert into public.products (id, tenant_id, reference, designation, unit_price_cents, product_type, material, unit, supply_type_id) values
  ('a9310000-0000-4000-8000-000000000501', 'a9310000-0000-4000-8000-000000000101', 'ART-501', 'TI691 Coude 90° inox DN 50',
    100, 'Coude 90°', 'Inox 304L', 'u', 'a9310000-0000-4000-8000-000000000401'),
  ('a9310000-0000-4000-8000-000000000502', 'a9310000-0000-4000-8000-000000000101', 'ART-502', 'TI691 Vis inox M6x20',
    1, 'Vis', 'Inox 304L', 'u', null),
  ('a9310000-0000-4000-8000-000000000503', 'a9310000-0000-4000-8000-000000000101', 'EST-503', 'TI691 Tube chiffré',
    999, null, null, 'm', null);
-- Article 501 has an active reference at Alpha; article 502's reference there is withdrawn (the article's own is used).
insert into public.supplier_catalog_items (id, tenant_id, supplier_id, product_id, supplier_sku, is_active) values
  ('a9310000-0000-4000-8000-000000000511', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000301',
    'a9310000-0000-4000-8000-000000000501', 'ALPHA-501', true),
  ('a9310000-0000-4000-8000-000000000512', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000301',
    'a9310000-0000-4000-8000-000000000502', 'OLD-502', false),
  ('a9310000-0000-4000-8000-000000000513', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000301',
    'a9310000-0000-4000-8000-000000000503', 'EST-503-SKU', true);
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9310000-0000-4000-8000-000000000201', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000001',
    'TI691 Affaire commandée'),
  ('a9310000-0000-4000-8000-000000000202', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000005',
    'TI691 Affaire d''un autre ingénieur'),
  ('a9310000-0000-4000-8000-000000000203', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000001',
    'TI691 Affaire chiffrée');
insert into public.delivery_sites (id, tenant_id, name, is_active, updated_at) values
  ('a9310000-0000-4000-8000-000000000801', 'a9310000-0000-4000-8000-000000000101', 'TI691 Chantier', true, now() - interval '1 second');
insert into public.material_request_technicians (id, tenant_id, name) values
  ('a9310000-0000-4000-8000-000000000651', 'a9310000-0000-4000-8000-000000000101', 'Paul Fictif');
insert into public.material_requests (id, project_id, technician_id, requested_on, delivery_place, presumed_material,
  material_confirmed, created_by) values
  ('a9310000-0000-4000-8000-000000000601', 'a9310000-0000-4000-8000-000000000201', 'a9310000-0000-4000-8000-000000000651',
    '2026-11-10', 'counter', 'Inox 304L', true, 'a9310000-0000-4000-8000-000000000001'),
  ('a9310000-0000-4000-8000-000000000602', 'a9310000-0000-4000-8000-000000000202', null, '2026-11-10', null, null, false,
    'a9310000-0000-4000-8000-000000000005');
-- Request 601: L1 elbow (article 501), L2 screws (article 502, the sheet's material), L3 gloves (overhead), L4 tube,
-- L5 without supplier, L6 still a draft, L7 with a supplier but no retained quote. Request 602 (affaire 202): L8.
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation, overhead_category, product_id, product_match, original_text) values
  ('a9310000-0000-4000-8000-000000000701', 'a9310000-0000-4000-8000-000000000601', 1, 4, 'u', 'DN 50', false, 'Coude 90°',
    'Inox 304L', 'project', null, 'a9310000-0000-4000-8000-000000000501', 'manual', null),
  ('a9310000-0000-4000-8000-000000000702', 'a9310000-0000-4000-8000-000000000601', 2, 1500, 'u', 'M6x20', false, 'Vis',
    null, 'project', null, 'a9310000-0000-4000-8000-000000000502', 'manual', null),
  ('a9310000-0000-4000-8000-000000000703', 'a9310000-0000-4000-8000-000000000601', 3, 5, 'paire', null, true, 'Gants',
    null, 'overhead', 'EPI', null, null, 'gants taille 9'),
  ('a9310000-0000-4000-8000-000000000704', 'a9310000-0000-4000-8000-000000000601', 4, 2.5, 'm', 'DN 32', false, 'Tube',
    'PVC', 'project', null, null, null, null),
  ('a9310000-0000-4000-8000-000000000705', 'a9310000-0000-4000-8000-000000000601', 5, 2, 'u', 'DN 40', false, 'Manchon',
    'PVC', 'project', null, null, null, null),
  ('a9310000-0000-4000-8000-000000000706', 'a9310000-0000-4000-8000-000000000601', 6, 1, 'u', 'DN 40', false, 'Bouchon',
    'PVC', 'project', null, null, null, null),
  ('a9310000-0000-4000-8000-000000000707', 'a9310000-0000-4000-8000-000000000601', 7, 3, 'u', 'DN 40', false, 'Coude',
    'PVC', 'project', null, null, null, null),
  ('a9310000-0000-4000-8000-000000000708', 'a9310000-0000-4000-8000-000000000602', 1, 1, 'u', 'DN 80', false, 'Vanne',
    'Fonte', 'project', null, null, null, null);
update public.material_request_lines set status = 'validated'
where id in ('a9310000-0000-4000-8000-000000000701', 'a9310000-0000-4000-8000-000000000702',
  'a9310000-0000-4000-8000-000000000703', 'a9310000-0000-4000-8000-000000000704', 'a9310000-0000-4000-8000-000000000705',
  'a9310000-0000-4000-8000-000000000707', 'a9310000-0000-4000-8000-000000000708');
update public.material_request_lines set supplier_id = 'a9310000-0000-4000-8000-000000000302'
where id = 'a9310000-0000-4000-8000-000000000707';

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

-- Runs one query as a signed-in member: its rows as a JSON array, or { error, message, detail }.
create function pg_temp.pls_rows(p_user uuid, p_sql text)
returns jsonb
language plpgsql
as $run$
declare
  run_result jsonb;
  detail_text text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute format('select coalesce(jsonb_agg(to_jsonb(answer)), ''[]''::jsonb) from (%s) answer', p_sql) into run_result;
  exception when others then
    get stacked diagnostics detail_text = pg_exception_detail;
    run_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm, 'detail', detail_text);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- Runs one statement as a signed-in member: the DETAIL of its refusal, or « passed ».
create function pg_temp.pls_detail(p_user uuid, p_sql text)
returns text
language plpgsql
as $run$
declare
  run_result text := 'passed';
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute p_sql;
  exception when others then
    get stacked diagnostics run_result = pg_exception_detail;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- Orders an estimate's lines as a member through the estimate path (review, then drafts): « created » or the refusal.
create function pg_temp.order_estimate(p_user uuid, p_version uuid, p_items uuid[])
returns text
language plpgsql
as $run$
declare
  review jsonb;
  reviewed jsonb;
  groups jsonb;
  outcome text := 'created';
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    review := public.get_estimate_purchase_order_review(p_version, p_items);
    select jsonb_agg(jsonb_build_object('item_id', l->'item_id', 'review_fingerprint', l->'review_fingerprint'))
      into reviewed from jsonb_array_elements(review->'lines') l;
    select jsonb_build_array(jsonb_build_object('supplier_id', 'a9310000-0000-4000-8000-000000000301',
      'delivery_site_id', s.id, 'delivery_site_updated_at', s.updated_at, 'item_ids', to_jsonb(p_items),
      'expected_delivery_date', null, 'notes', 'TI691 chiffrage'))
      into groups from public.delivery_sites s where s.id = 'a9310000-0000-4000-8000-000000000801';
    perform public.create_estimate_purchase_order_drafts(p_version, gen_random_uuid(), reviewed, groups);
  exception when others then
    outcome := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return outcome;
end;
$run$;

-- The retained quotes: Alpha prices L1 (12,34 € a piece), L2 (3,40 € for 100 screws) and L3 (0,05 € for 10 pairs);
-- Beta prices L4 (10,00 € a metre); Beta prices L8 for affaire 202 (20,00 €).
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9310000-0000-4000-8000-000000000601', 'a9310000-0000-4000-8000-000000000301',
    true, 'Bonjour', array['a9310000-0000-4000-8000-000000000701', 'a9310000-0000-4000-8000-000000000702',
    'a9310000-0000-4000-8000-000000000703']::uuid[])$$), 'ok 1', 'fixture: the owner asks Alpha for L1, L2 and L3');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9310000-0000-4000-8000-000000000601', 'a9310000-0000-4000-8000-000000000302',
    false, 'Bonjour', array['a9310000-0000-4000-8000-000000000704']::uuid[])$$), 'ok 1', 'fixture: and Beta for L4');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000005',
  $$select public.create_material_request_quote('a9310000-0000-4000-8000-000000000602', 'a9310000-0000-4000-8000-000000000302',
    false, 'Bonjour', array['a9310000-0000-4000-8000-000000000708']::uuid[])$$), 'ok 1', 'fixture: the other engineer asks Beta for L8');
select set_config('test.quote_alpha', (select id::text from public.material_request_quotes
  where request_id = 'a9310000-0000-4000-8000-000000000601' and supplier_id = 'a9310000-0000-4000-8000-000000000301'), true);
select set_config('test.quote_beta', (select id::text from public.material_request_quotes
  where request_id = 'a9310000-0000-4000-8000-000000000601' and supplier_id = 'a9310000-0000-4000-8000-000000000302'), true);
select set_config('test.quote_other', (select id::text from public.material_request_quotes
  where request_id = 'a9310000-0000-4000-8000-000000000602'), true);
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_alpha')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(
      jsonb_build_object('line_id', 'a9310000-0000-4000-8000-000000000701', 'unit_price_ht_cents', 1234),
      jsonb_build_object('line_id', 'a9310000-0000-4000-8000-000000000702', 'unit_price_ht_cents', 340, 'price_per', 100),
      jsonb_build_object('line_id', 'a9310000-0000-4000-8000-000000000703', 'unit_price_ht_cents', 5, 'price_per', 10))))$$),
  'ok 1', 'fixture: Alpha answers');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_beta')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(jsonb_build_object('line_id', 'a9310000-0000-4000-8000-000000000704', 'unit_price_ht_cents', 1000))))$$),
  'ok 1', 'fixture: Beta answers');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000005',
  $$select public.update_material_request_quote(current_setting('test.quote_other')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(jsonb_build_object('line_id', 'a9310000-0000-4000-8000-000000000708', 'unit_price_ht_cents', 2000))))$$),
  'ok 1', 'fixture: Beta answers for L8');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_alpha')::uuid)$$), 'ok 0',
  'fixture: Alpha is retained');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_beta')::uuid)$$), 'ok 0',
  'fixture: Beta is retained');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000005',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_other')::uuid)$$), 'ok 0',
  'fixture: Beta is retained for L8');
select results_eq(
  $$select position, status, supplier_id, unit_price_ht_cents, price_per from public.material_request_lines
    where request_id = 'a9310000-0000-4000-8000-000000000601' and price_quote_id is not null order by position$$,
  $$values (1, 'validated'::text, 'a9310000-0000-4000-8000-000000000301'::uuid, 1234, 1),
    (2, 'validated', 'a9310000-0000-4000-8000-000000000301'::uuid, 340, 100),
    (3, 'validated', 'a9310000-0000-4000-8000-000000000301'::uuid, 5, 10),
    (4, 'validated', 'a9310000-0000-4000-8000-000000000302'::uuid, 1000, 1)$$,
  'fixture: four validated lines carry their retained price');

-- ---------------------------------------------------------------------------
-- 1. Structure and grants.
-- ---------------------------------------------------------------------------
select ok((select bool_and(prosecdef and exists (select 1 from unnest(proconfig) setting where setting like 'search_path=%'))
  from pg_proc where oid in ('public.create_material_request_purchase_orders(uuid, uuid)'::regprocedure,
    'public.material_request_order_summary(uuid)'::regprocedure)),
  '1 both functions are security definer with a pinned search_path (they check the rights themselves)');
select ok(not has_function_privilege('anon', 'public.create_material_request_purchase_orders(uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.material_request_order_summary(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.create_material_request_purchase_orders(uuid, uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.material_request_order_summary(uuid)', 'EXECUTE'),
  '1 a signed-in member calls them, an anonymous caller does not');
select ok(not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) grant_entry
    where p.oid in ('public.create_material_request_purchase_orders(uuid, uuid)'::regprocedure,
      'public.material_request_order_summary(uuid)'::regprocedure)
      and grant_entry.grantee = 0 and grant_entry.privilege_type = 'EXECUTE'),
  '1 nor does PUBLIC');
select ok(not has_table_privilege('authenticated', 'private.material_request_line_orders', 'SELECT')
    and not has_table_privilege('anon', 'private.material_request_line_orders', 'SELECT')
    and not has_table_privilege('service_role', 'private.material_request_line_orders', 'SELECT')
    and not has_table_privilege('authenticated', 'private.material_request_order_receipts', 'SELECT')
    and not has_table_privilege('service_role', 'private.material_request_order_receipts', 'SELECT'),
  '1 the ledger and the receipts are read by the functions only');
select is((select is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'purchase_orders' and column_name = 'delivery_site_id'), 'YES',
  '1 the delivery site of an order may be empty');
select throws_ok(
  $$insert into public.purchase_orders (tenant_id, user_id, reference, supplier_id, delivery_site_id, status)
    values ('a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000001', 'TI691-NO-SITE',
      'a9310000-0000-4000-8000-000000000301', null, 'draft')$$,
  '23514', null, '1 but only for an order of an affaire');

-- ---------------------------------------------------------------------------
-- 2. Existing orders keep their totals.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9310000-0000-4000-8000-000000000301',
    'delivery_site_id', 'a9310000-0000-4000-8000-000000000801', 'notes', 'TI691 manuel décimal'), jsonb_build_array(
    jsonb_build_object('designation', 'TI691 demi', 'quantity', 12.5, 'unit', 'm', 'unit_price_ht_cents', 123, 'tax_rate_bp', 2000),
    jsonb_build_object('designation', 'TI691 huitième', 'quantity', 0.125, 'unit', 'm', 'unit_price_ht_cents', 777, 'tax_rate_bp', 2000),
    jsonb_build_object('designation', 'TI691 millième', 'quantity', 0.001, 'unit', 'm', 'unit_price_ht_cents', 500, 'tax_rate_bp', 2000)))$$),
  'ok 1', '2 fixture: a manual order with fractional quantities');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9310000-0000-4000-8000-000000000301',
    'delivery_site_id', 'a9310000-0000-4000-8000-000000000801', 'notes', 'TI691 manuel taux'), jsonb_build_array(
    jsonb_build_object('designation', 'TI691 tiers', 'quantity', 3, 'unit', 'u', 'unit_price_ht_cents', 333, 'tax_rate_bp', 2000),
    jsonb_build_object('designation', 'TI691 taux réduit', 'quantity', 2, 'unit', 'u', 'unit_price_ht_cents', 1250, 'tax_rate_bp', 550)))$$),
  'ok 1', '2 fixture: a manual order at 20 % and 5,5 %');
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth, currency) values
  ('a9310000-0000-4000-8000-000000000901', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000203', 1, 1, 1, 'EUR');
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title) values
  ('a9310000-0000-4000-8000-000000000902', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000901',
    'section', 1, 'TI691 lot');
insert into public.supplier_pricebook (id, tenant_id, supplier_catalog_item_id, supplier_id, product_id, supplier_sku, unit,
  min_quantity, unit_price_cents, currency, valid_from, valid_to, is_active) values
  ('a9310000-0000-4000-8000-000000000906', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000513',
    'a9310000-0000-4000-8000-000000000301', 'a9310000-0000-4000-8000-000000000503', 'EST-503-SKU', 'm', 0.001, 999, 'EUR',
    current_date, current_date + 30, true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, line_nature, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, selected_supplier_price_id, product_id, pu_ht_cents,
  line_total_ht_cents, line_tax_cents, line_total_ttc_cents) values
  ('a9310000-0000-4000-8000-000000000903', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000901',
    'a9310000-0000-4000-8000-000000000902', 'line', 'supply_only', 1, 'TI691 demi', 'm', 12.5, 123, 2000, 1, 0, 1,
    'a9310000-0000-4000-8000-000000000906', 'a9310000-0000-4000-8000-000000000503', 123, 1538, 308, 1846),
  ('a9310000-0000-4000-8000-000000000904', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000901',
    'a9310000-0000-4000-8000-000000000902', 'line', 'supply_only', 2, 'TI691 huitième', 'm', 0.125, 777, 2000, 1, 0, 1,
    'a9310000-0000-4000-8000-000000000906', 'a9310000-0000-4000-8000-000000000503', 777, 97, 19, 116),
  ('a9310000-0000-4000-8000-000000000905', 'a9310000-0000-4000-8000-000000000101', 'a9310000-0000-4000-8000-000000000901',
    'a9310000-0000-4000-8000-000000000902', 'line', 'supply_only', 3, 'TI691 millième', 'm', 0.001, 500, 2000, 1, 0, 1,
    'a9310000-0000-4000-8000-000000000906', 'a9310000-0000-4000-8000-000000000503', 500, 1, 0, 1);
select is(pg_temp.order_estimate('a9310000-0000-4000-8000-000000000001', 'a9310000-0000-4000-8000-000000000901',
  array['a9310000-0000-4000-8000-000000000903', 'a9310000-0000-4000-8000-000000000904',
    'a9310000-0000-4000-8000-000000000905']::uuid[]), 'created', '2 fixture: an estimate-sourced order of the same lines');
select set_config('test.manual_decimal', (select id::text from public.purchase_orders where notes = 'TI691 manuel décimal'), true);
select set_config('test.manual_rates', (select id::text from public.purchase_orders where notes = 'TI691 manuel taux'), true);
select set_config('test.estimate_order', (select id::text from public.purchase_orders
  where source_estimate_version_id = 'a9310000-0000-4000-8000-000000000901'), true);
create temporary table ti691_existing on commit drop as
select oi.id, oi.purchase_order_id, oi.quantity, oi.unit_price_ht_cents, oi.tax_rate_bp,
  oi.line_total_ht_cents, oi.line_tax_cents, oi.line_total_ttc_cents
from public.purchase_order_items oi
where oi.purchase_order_id in (current_setting('test.manual_decimal')::uuid, current_setting('test.manual_rates')::uuid,
  current_setting('test.estimate_order')::uuid);

select results_eq(
  $$select total_ht_cents, total_tax_cents, total_ttc_cents from public.purchase_orders
    where id in (current_setting('test.manual_decimal')::uuid, current_setting('test.estimate_order')::uuid) order by notes$$,
  $$values (1636, 327, 1963), (1636, 327, 1963)$$,
  '2 a manual and an estimate-sourced order of 12,5 x 1,23 + 0,125 x 7,77 + 0,001 x 5,00 keep their pinned totals');
select results_eq(
  $$select line_total_ht_cents, line_tax_cents, line_total_ttc_cents from public.purchase_order_items
    where purchase_order_id = current_setting('test.estimate_order')::uuid order by position$$,
  $$values (1538, 308, 1846), (97, 19, 116), (1, 0, 1)$$,
  '2 its lines too: 1537,5 and 0,5 cents round half away from zero');
select results_eq(
  $$select line_total_ht_cents, line_tax_cents, line_total_ttc_cents from public.purchase_order_items
    where purchase_order_id = current_setting('test.manual_rates')::uuid order by position$$,
  $$values (999, 200, 1199), (2500, 138, 2638)$$,
  '2 a 5,5 % line keeps its tax (137,5 rounds to 138)');
select ok((select bool_and(line_total_ht_cents = round(quantity * unit_price_ht_cents)
    and line_tax_cents = round(round(quantity * unit_price_ht_cents) * tax_rate_bp / 10000)
    and line_total_ttc_cents = round(quantity * unit_price_ht_cents) + round(round(quantity * unit_price_ht_cents) * tax_rate_bp / 10000))
  from ti691_existing),
  '2 every existing-shaped line equals the previous formula round(quantity x price)');
select ok((select bool_and(line_kind = 'article' and price_per = 1 and material_request_line_id is null and project_id is null
    and imputation is null and overhead_category is null)
  from public.purchase_order_items where id in (select id from ti691_existing)),
  '2 existing-shaped lines are articles for 1 unit, without request, affaire or imputation');
update public.purchase_order_items set quantity = quantity where id in (select id from ti691_existing);
select ok((select bool_and(oi.line_total_ht_cents = e.line_total_ht_cents and oi.line_tax_cents = e.line_tax_cents
    and oi.line_total_ttc_cents = e.line_total_ttc_cents)
  from public.purchase_order_items oi join ti691_existing e on e.id = oi.id),
  '2 lines written again (quantity = quantity) keep every cent');
select results_eq(
  $$select total_ht_cents, total_tax_cents, total_ttc_cents from public.purchase_orders
    where id in (current_setting('test.manual_decimal')::uuid, current_setting('test.manual_rates')::uuid,
      current_setting('test.estimate_order')::uuid) order by notes$$,
  $$values (1636, 327, 1963), (1636, 327, 1963), (3499, 338, 3837)$$,
  '2 and so do their orders');

-- ---------------------------------------------------------------------------
-- 3. Rights.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000003',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601', gen_random_uuid())$$),
  '42501 PURCHASE_ORDER_ACCESS_DENIED', '3 a viewer creates no order');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000006',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601', gen_random_uuid())$$),
  '42501 PURCHASE_ORDER_ACCESS_DENIED', '3 nor a director, who reads the affaire but does not buy');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000005',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601', gen_random_uuid())$$),
  '42501 MATERIAL_REQUEST_ORDER_WRITERS_ONLY', '3 nor an engineer who does not own the affaire');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000602', gen_random_uuid())$$),
  '42501 MATERIAL_REQUEST_ORDER_WRITERS_ONLY', '3 the owner of one affaire does not order the requests of another');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000004',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601', gen_random_uuid())$$),
  'P0002 MATERIAL_REQUEST_ORDER_NOT_FOUND', '3 a member of another tenant does not find the request');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601', null)$$),
  '22023 MATERIAL_REQUEST_ORDER_INPUT_INVALID', '3 a call without key is refused');
select is((select count(*) from public.purchase_orders where project_id is not null), 0::bigint,
  '3 none of them wrote an order');
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000003',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->>'message',
  'MATERIAL_REQUEST_ORDER_ACCESS_DENIED', '3 a viewer does not read the summary');
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000005',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->>'message',
  'MATERIAL_REQUEST_ORDER_ACCESS_DENIED', '3 nor an engineer who does not own the affaire');
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000004',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->>'message',
  'MATERIAL_REQUEST_ORDER_NOT_FOUND', '3 nor a member of another tenant');
select ok(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000006',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->0->'r' ? 'ready_line_ids',
  '3 a director reads it');

-- ---------------------------------------------------------------------------
-- 4. Where the lines stand before ordering.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000001',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->0->'r',
  jsonb_build_object(
    'ready_line_ids', jsonb_build_array('a9310000-0000-4000-8000-000000000701', 'a9310000-0000-4000-8000-000000000702',
      'a9310000-0000-4000-8000-000000000703', 'a9310000-0000-4000-8000-000000000704'),
    'not_ready', jsonb_build_array(
      jsonb_build_object('line_id', 'a9310000-0000-4000-8000-000000000705', 'reason', 'no_supplier'),
      jsonb_build_object('line_id', 'a9310000-0000-4000-8000-000000000706', 'reason', 'not_validated'),
      jsonb_build_object('line_id', 'a9310000-0000-4000-8000-000000000707', 'reason', 'not_priced')),
    'ordered', '[]'::jsonb, 'orders', '[]'::jsonb, 'can_create', true),
  '4 four lines are ready; the others say what they lack, in the request''s order; the owner may create');
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000006',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->0->'r'->'can_create',
  'false'::jsonb, '13 a director reads the summary, told that it may not create');
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000002',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->0->'r'->'can_create',
  'true'::jsonb, '13 an admin may');

-- ---------------------------------------------------------------------------
-- 5. One draft per supplier, overhead included.
-- ---------------------------------------------------------------------------
select set_config('test.created', (pg_temp.pls_rows('a9310000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601',
    'a9310000-0000-4000-8000-00000000a001') as r$$)->0->'r')::text, true);
select is(current_setting('test.created')::jsonb->>'replayed', 'false', '5 the owner creates the drafts');
select set_config('test.order_alpha', (select id::text from public.purchase_orders
  where project_id = 'a9310000-0000-4000-8000-000000000201' and supplier_id = 'a9310000-0000-4000-8000-000000000301'), true);
select set_config('test.order_beta', (select id::text from public.purchase_orders
  where project_id = 'a9310000-0000-4000-8000-000000000201' and supplier_id = 'a9310000-0000-4000-8000-000000000302'), true);
select is((select count(*) from public.purchase_orders where project_id = 'a9310000-0000-4000-8000-000000000201'), 2::bigint,
  '5 two drafts: one per supplier');
select is((select jsonb_agg(jsonb_build_object('supplier_name', o->>'supplier_name', 'line_count', (o->>'line_count')::integer,
    'total_ht_cents', (o->>'total_ht_cents')::integer, 'line_ids', o->'line_ids')) from jsonb_array_elements(current_setting('test.created')::jsonb->'orders') o),
  jsonb_build_array(
    jsonb_build_object('supplier_name', 'TI691 Fournisseur Alpha', 'line_count', 3, 'total_ht_cents', 10039,
      'line_ids', jsonb_build_array('a9310000-0000-4000-8000-000000000701', 'a9310000-0000-4000-8000-000000000702',
        'a9310000-0000-4000-8000-000000000703')),
    jsonb_build_object('supplier_name', 'TI691 Fournisseur Beta', 'line_count', 1, 'total_ht_cents', 2500,
      'line_ids', jsonb_build_array('a9310000-0000-4000-8000-000000000704'))),
  '5 the answer names each draft, its supplier, its lines and its total; the overhead gloves follow Alpha');
select is((select jsonb_agg(o->>'status') from jsonb_array_elements(current_setting('test.created')::jsonb->'orders') o),
  '["draft", "draft"]'::jsonb, '5 and says they are drafts');
select results_eq(
  $$select status::text, user_id, delivery_site_id, project_id, delivery_mode, notes, reference like 'C-____-___%'
    from public.purchase_orders where id in (current_setting('test.order_alpha')::uuid, current_setting('test.order_beta')::uuid)
    order by order_number$$,
  $$values ('draft'::text, 'a9310000-0000-4000-8000-000000000001'::uuid, null::uuid, 'a9310000-0000-4000-8000-000000000201'::uuid,
      'counter'::text, 'Demande de matériel du 10/11/2026 (Paul Fictif)'::text, true),
    ('draft', 'a9310000-0000-4000-8000-000000000001'::uuid, null::uuid, 'a9310000-0000-4000-8000-000000000201'::uuid,
      'counter', 'Demande de matériel du 10/11/2026 (Paul Fictif)', true)$$,
  '5 each header: draft of its author, no site, the affaire, the request''s delivery place, notes naming the request');
select results_eq(
  $$select position, product_id, reference, designation, quantity, unit, unit_price_ht_cents, price_per, tax_rate_bp,
      supply_type_id, imputation, overhead_category, project_id, material_request_line_id, line_kind
    from public.purchase_order_items where purchase_order_id = current_setting('test.order_alpha')::uuid order by position$$,
  $$values
    (1, 'a9310000-0000-4000-8000-000000000501'::uuid, 'ALPHA-501'::text, 'Coude 90°, DN 50, Inox 304L'::text, 4::numeric,
      'u'::text, 1234, 1, 2000, 'a9310000-0000-4000-8000-000000000401'::uuid, 'project'::text, null::text,
      'a9310000-0000-4000-8000-000000000201'::uuid, 'a9310000-0000-4000-8000-000000000701'::uuid, 'article'::text),
    (2, 'a9310000-0000-4000-8000-000000000502'::uuid, 'ART-502', 'Vis, M6x20, Inox 304L', 1500::numeric, 'u', 340, 100, 2000,
      null::uuid, 'project', null, 'a9310000-0000-4000-8000-000000000201'::uuid, 'a9310000-0000-4000-8000-000000000702'::uuid, 'article'),
    (3, null::uuid, null, 'Gants', 5::numeric, 'paire', 5, 10, 2000, null::uuid, 'overhead', 'EPI',
      'a9310000-0000-4000-8000-000000000201'::uuid, 'a9310000-0000-4000-8000-000000000703'::uuid, 'article')$$,
  '5 each line: article, reference at Alpha (else the article''s), catalogue wording, quantity, unit, quote price and lot, 20 %, supply type, imputation, request line');

-- ---------------------------------------------------------------------------
-- 6. Money: lots, half away from zero, discounts.
-- ---------------------------------------------------------------------------
select results_eq(
  $$select line_total_ht_cents, line_tax_cents, line_total_ttc_cents from public.purchase_order_items
    where purchase_order_id = current_setting('test.order_alpha')::uuid order by position$$,
  $$values (4936, 987, 5923), (5100, 1020, 6120), (3, 1, 4)$$,
  '6 4 x 12,34 €; 1 500 screws at 3,40 € per 100 = 51,00 €; 5 pairs at 0,05 € per 10 = 2,5 cents, rounded to 3 (not 2)');
select results_eq(
  $$select total_ht_cents, total_tax_cents, total_ttc_cents from public.purchase_orders
    where id in (current_setting('test.order_alpha')::uuid, current_setting('test.order_beta')::uuid) order by order_number$$,
  $$values (10039, 2008, 12047), (2500, 500, 3000)$$,
  '6 the drafts add their lines');

-- ---------------------------------------------------------------------------
-- 7. Idempotency and 8. a line ordered once.
-- ---------------------------------------------------------------------------
select is((pg_temp.pls_rows('a9310000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601',
    'a9310000-0000-4000-8000-00000000a001') as r$$)->0->'r') - 'replayed',
  current_setting('test.created')::jsonb - 'replayed', '7 the same key answers the same drafts');
select is((pg_temp.pls_rows('a9310000-0000-4000-8000-000000000002',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601',
    'a9310000-0000-4000-8000-00000000a001') as r$$)->0->'r'->>'replayed'), 'true', '7 an admin may replay a member''s key');
select is((select count(*) from public.purchase_orders where project_id = 'a9310000-0000-4000-8000-000000000201'), 2::bigint,
  '7 and nothing more is created');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601',
    'a9310000-0000-4000-8000-00000000a002')$$),
  '22023 MATERIAL_REQUEST_ORDER_NOTHING_READY', '8 a new key finds nothing ready: every line is ordered');
select is((select count(*) from private.material_request_order_receipts
  where request_id = 'a9310000-0000-4000-8000-000000000601'), 1::bigint, '7 a refused call leaves no receipt');
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000001',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->0->'r'->'ordered',
  (select jsonb_agg(jsonb_build_object('line_id', l.id, 'purchase_order_id', po.id, 'purchase_order_reference', po.reference,
      'status', 'draft') order by l.position)
    from public.material_request_lines l join public.purchase_order_items oi on oi.material_request_line_id = l.id
    join public.purchase_orders po on po.id = oi.purchase_order_id
    where l.request_id = 'a9310000-0000-4000-8000-000000000601'),
  '8 the summary names the order holding each ordered line');
select throws_ok(
  $q$do $direct$ begin
    perform set_config('app.material_request_ordering', current_setting('test.order_beta'), true);
    insert into public.purchase_order_items (tenant_id, purchase_order_id, position, designation, quantity, unit,
      unit_price_ht_cents, tax_rate_bp, material_request_line_id, project_id, imputation)
    values ('a9310000-0000-4000-8000-000000000101', current_setting('test.order_beta')::uuid, 9, 'Doublon', 4, 'u', 1234, 2000,
      'a9310000-0000-4000-8000-000000000701', 'a9310000-0000-4000-8000-000000000201', 'project');
  end $direct$ $q$,
  '23505', 'MATERIAL_REQUEST_LINE_ALREADY_ORDERED', '8 a line in a draft cannot enter a second order');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$insert into public.purchase_order_items (purchase_order_id, position, designation, quantity, unit, unit_price_ht_cents,
      tax_rate_bp, material_request_line_id, project_id, imputation)
    values (current_setting('test.order_beta')::uuid, 9, 'Ligne directe', 2, 'u', 1, 2000,
      'a9310000-0000-4000-8000-000000000705', 'a9310000-0000-4000-8000-000000000201', 'project')$$),
  '42501 PURCHASE_ORDER_REQUEST_LINES_THROUGH_FUNCTION', '10 a member does not write a request line into an order directly');

-- Canceling frees a line; an archived supplier is named; another member's key is not replayed; reopening is refused.
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'canceled' where id = current_setting('test.order_beta')::uuid$$),
  'ok 1', '8 fixture: the owner cancels the Beta draft');
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000001',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->0->'r'->'ready_line_ids',
  jsonb_build_array('a9310000-0000-4000-8000-000000000704'), '8 its line is ready again');
select is((select jsonb_agg(o->>'status') from jsonb_array_elements(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000001',
    $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601',
      'a9310000-0000-4000-8000-00000000a001') as r$$)->0->'r'->'orders') o),
  '["draft", "canceled"]'::jsonb, '13 a replay answers each draft with its status as it now stands');
update public.suppliers set is_active = false where id = 'a9310000-0000-4000-8000-000000000302';
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601',
    'a9310000-0000-4000-8000-00000000a003') as r$$) - 'error',
  jsonb_build_object('message', 'MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE', 'detail', '["TI691 Fournisseur Beta"]'),
  '12 an archived supplier is refused, by its name');
update public.suppliers set is_active = true where id = 'a9310000-0000-4000-8000-000000000302';
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000002',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601',
    'a9310000-0000-4000-8000-00000000a003') as r$$)->0->'r'->'orders'->0->>'line_count', '1',
  '8 an admin orders the freed line again');
select set_config('test.order_beta_again', (select id::text from public.purchase_orders
  where project_id = 'a9310000-0000-4000-8000-000000000201' and supplier_id = 'a9310000-0000-4000-8000-000000000302'
    and status = 'draft'), true);
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000601',
    'a9310000-0000-4000-8000-00000000a003')$$),
  '23505 MATERIAL_REQUEST_ORDER_KEY_TAKEN', '7 the owner does not replay the admin''s key');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_beta')::uuid$$),
  '23505 MATERIAL_REQUEST_LINE_ALREADY_ORDERED', '8 reopening the canceled draft would order its line twice: refused');
select is((select status::text from public.purchase_orders where id = current_setting('test.order_beta')::uuid), 'canceled',
  '8 it stays canceled');
select throws_ok(
  $$delete from public.material_requests where id = 'a9310000-0000-4000-8000-000000000601'$$,
  '23503', null, '8 a request whose lines are in an order that stands is not deleted');

select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'draft' where id = 'a9310000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_ORDERED', '13 a line in a draft order is not reopened');
select is(pg_temp.pls_detail('a9310000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'draft' where id = 'a9310000-0000-4000-8000-000000000701'$$),
  (select reference from public.purchase_orders where id = current_setting('test.order_alpha')::uuid),
  '13 the refusal names the order');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set zone = 'Chaufferie' where id = 'a9310000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_ORDERED', '13 nor returned to draft by an edit of what it says');
select is((select status from public.material_request_lines where id = 'a9310000-0000-4000-8000-000000000701'), 'validated',
  '13 it stays validated');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set duplicate_acknowledged = true where id = 'a9310000-0000-4000-8000-000000000701'$$),
  'ok 1', '13 what does not reopen it still changes');

-- ---------------------------------------------------------------------------
-- 9. A draft edit keeps what the request gave; shipping and discounts.
-- ---------------------------------------------------------------------------
select set_config('test.item_l1', (select id::text from public.purchase_order_items
  where material_request_line_id = 'a9310000-0000-4000-8000-000000000701'), true);
select set_config('test.item_l2', (select id::text from public.purchase_order_items
  where material_request_line_id = 'a9310000-0000-4000-8000-000000000702'), true);
select set_config('test.item_l3', (select id::text from public.purchase_order_items
  where material_request_line_id = 'a9310000-0000-4000-8000-000000000703'), true);
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.replace_purchase_order_draft(current_setting('test.order_alpha')::uuid,
    jsonb_build_object('delivery_site_id', 'a9310000-0000-4000-8000-000000000801'), jsonb_build_array(
      jsonb_build_object('id', current_setting('test.item_l1'), 'designation', 'Coude 90°, DN 50, Inox 304L', 'quantity', 5,
        'unit_price_ht_cents', 1234, 'tax_rate_bp', 2000),
      jsonb_build_object('id', current_setting('test.item_l2'), 'designation', 'Vis, M6x20, Inox 304L', 'quantity', 1500,
        'unit_price_ht_cents', 340, 'tax_rate_bp', 2000),
      jsonb_build_object('id', current_setting('test.item_l3'), 'designation', 'Gants', 'quantity', 5,
        'unit_price_ht_cents', 5, 'tax_rate_bp', 2000),
      jsonb_build_object('designation', 'Port', 'quantity', 1, 'unit', 'forfait', 'unit_price_ht_cents', 1500,
        'tax_rate_bp', 2000, 'line_kind', 'shipping'),
      jsonb_build_object('designation', 'Remise', 'quantity', 1, 'unit', 'forfait', 'unit_price_ht_cents', 10,
        'tax_rate_bp', 500, 'line_kind', 'discount'),
      jsonb_build_object('designation', 'Rondelles', 'quantity', 3, 'unit', 'u', 'unit_price_ht_cents', 50,
        'tax_rate_bp', 2000, 'price_per', 100)),
    (select edit_revision from public.purchase_orders where id = current_setting('test.order_alpha')::uuid))$$),
  'ok 1', '9 the owner edits the draft as the API sends it: a quantity, a site, shipping, a discount, a line for 100');
select results_eq(
  $$select position, line_kind, product_id, material_request_line_id, imputation, overhead_category, project_id, supply_type_id,
      price_per, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
    from public.purchase_order_items where purchase_order_id = current_setting('test.order_alpha')::uuid order by position$$,
  $$values
    (1, 'article'::text, 'a9310000-0000-4000-8000-000000000501'::uuid, 'a9310000-0000-4000-8000-000000000701'::uuid, 'project'::text,
      null::text, 'a9310000-0000-4000-8000-000000000201'::uuid, 'a9310000-0000-4000-8000-000000000401'::uuid, 1, 6170, 1234, 7404),
    (2, 'article', 'a9310000-0000-4000-8000-000000000502'::uuid, 'a9310000-0000-4000-8000-000000000702'::uuid, 'project', null,
      'a9310000-0000-4000-8000-000000000201'::uuid, null::uuid, 100, 5100, 1020, 6120),
    (3, 'article', null::uuid, 'a9310000-0000-4000-8000-000000000703'::uuid, 'overhead', 'EPI',
      'a9310000-0000-4000-8000-000000000201'::uuid, null::uuid, 10, 3, 1, 4),
    (4, 'shipping', null::uuid, null::uuid, 'project', null, 'a9310000-0000-4000-8000-000000000201'::uuid, null::uuid, 1, 1500, 300, 1800),
    (5, 'discount', null::uuid, null::uuid, 'project', null, 'a9310000-0000-4000-8000-000000000201'::uuid, null::uuid, 1, -10, -1, -11),
    (6, 'article', null::uuid, null::uuid, 'project', null, 'a9310000-0000-4000-8000-000000000201'::uuid, null::uuid, 100, 2, 0, 2)$$,
  '9 request lines keep their request line, imputation, affaire, category, supply type and lot; shipping, discount and the new line are imputed to the affaire; the discount subtracts (its 0,5 cent of tax rounds to 1), 3 x 0,50 € per 100 = 1,5 cents is 2');
select results_eq(
  $$select total_ht_cents, total_tax_cents, total_ttc_cents, delivery_site_id from public.purchase_orders
    where id = current_setting('test.order_alpha')::uuid$$,
  $$values (12765, 2554, 15319, 'a9310000-0000-4000-8000-000000000801'::uuid)$$,
  '6 the header subtracts the discount; a site may be added to an order of an affaire');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.replace_purchase_order_draft(current_setting('test.order_alpha')::uuid,
    jsonb_build_object('supplier_id', 'a9310000-0000-4000-8000-000000000302'), null,
    (select edit_revision from public.purchase_orders where id = current_setting('test.order_alpha')::uuid))$$),
  '22023 PURCHASE_ORDER_REQUEST_SUPPLIER_IMMUTABLE', '9 the supplier of a request order is its quote''s');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.replace_purchase_order_draft(current_setting('test.order_alpha')::uuid, '{}'::jsonb, jsonb_build_array(
      jsonb_build_object('id', current_setting('test.item_l1'), 'designation', 'Coude', 'quantity', 5, 'unit', 'm',
        'unit_price_ht_cents', 1234, 'tax_rate_bp', 2000)),
    (select edit_revision from public.purchase_orders where id = current_setting('test.order_alpha')::uuid))$$),
  '22023 PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE', '9 the unit of a request line is its quote''s');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.replace_purchase_order_draft(current_setting('test.order_alpha')::uuid, '{}'::jsonb, jsonb_build_array(
      jsonb_build_object('id', (select id from public.purchase_order_items where purchase_order_id = current_setting('test.order_alpha')::uuid
        and line_kind = 'shipping'), 'designation', 'Port', 'quantity', 1, 'unit_price_ht_cents', 1500, 'tax_rate_bp', 2000,
        'line_kind', 'discount')),
    (select edit_revision from public.purchase_orders where id = current_setting('test.order_alpha')::uuid))$$),
  '22023 PURCHASE_ORDER_ITEMS_INVALID', '9 the kind of a line does not change');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.replace_purchase_order_draft(current_setting('test.order_alpha')::uuid, '{}'::jsonb, jsonb_build_array(
      jsonb_build_object('designation', 'Remise article', 'quantity', 1, 'unit', 'u', 'unit_price_ht_cents', 1, 'tax_rate_bp', 2000,
        'line_kind', 'discount', 'product_id', 'a9310000-0000-4000-8000-000000000501')),
    (select edit_revision from public.purchase_orders where id = current_setting('test.order_alpha')::uuid))$$),
  '22023 PURCHASE_ORDER_INPUT_INVALID', '9 a discount is no article');
select is((select count(*) from public.purchase_order_items where purchase_order_id = current_setting('test.order_alpha')::uuid),
  6::bigint, '9 a refused edit writes nothing');

-- ---------------------------------------------------------------------------
-- 10. Direct writes.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$update public.purchase_order_items set imputation = 'overhead', overhead_category = 'EPI'
    where id = current_setting('test.item_l1')::uuid$$),
  '22023 PURCHASE_ORDER_ITEMS_INVALID', '10 the imputation of an order line is not rewritten');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$update public.purchase_order_items set material_request_line_id = 'a9310000-0000-4000-8000-000000000705'
    where purchase_order_id = current_setting('test.order_alpha')::uuid and line_kind = 'article' and material_request_line_id is null$$),
  '22023 PURCHASE_ORDER_ITEMS_INVALID', '10 nor is a request line attached afterwards');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set project_id = 'a9310000-0000-4000-8000-000000000203'
    where id = current_setting('test.order_alpha')::uuid$$),
  '22023 PURCHASE_ORDER_INPUT_INVALID', '10 nor does an order change affaire');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$insert into public.purchase_orders (user_id, reference, supplier_id, project_id, status)
    values ('a9310000-0000-4000-8000-000000000001', 'TI691-DIRECT', 'a9310000-0000-4000-8000-000000000301',
      'a9310000-0000-4000-8000-000000000201', 'draft')$$),
  '42501 PURCHASE_ORDER_AFFAIRE_THROUGH_REQUEST', '10 an order of an affaire comes from a request only');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$insert into public.purchase_order_items (purchase_order_id, position, designation, quantity, unit, unit_price_ht_cents,
      tax_rate_bp, imputation, overhead_category)
    values (current_setting('test.order_alpha')::uuid, 7, 'Casque', 1, 'u', 900, 2000, 'overhead', 'EPI')$$),
  'ok 1', '10 a line added directly is accepted');
select results_eq(
  $$select imputation, overhead_category, project_id from public.purchase_order_items
    where purchase_order_id = current_setting('test.order_alpha')::uuid and position = 7$$,
  $$values ('project'::text, null::text, 'a9310000-0000-4000-8000-000000000201'::uuid)$$,
  '10 but imputed to the affaire whatever it claims');

-- ---------------------------------------------------------------------------
-- 6. A discount larger than the order; an edit through a negative sum.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9310000-0000-4000-8000-000000000301',
    'delivery_site_id', 'a9310000-0000-4000-8000-000000000801', 'notes', 'TI691 remise trop forte'), jsonb_build_array(
    jsonb_build_object('designation', 'Tube', 'quantity', 1, 'unit', 'u', 'unit_price_ht_cents', 1000, 'tax_rate_bp', 2000),
    jsonb_build_object('designation', 'Remise', 'quantity', 1, 'unit', 'forfait', 'unit_price_ht_cents', 1001, 'tax_rate_bp', 2000,
      'line_kind', 'discount')))$$),
  '23514 PURCHASE_ORDER_TOTAL_NEGATIVE', '6 a discount larger than the order is refused');
select is((select count(*) from public.purchase_orders where notes = 'TI691 remise trop forte'), 0::bigint, '6 and nothing is written');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9310000-0000-4000-8000-000000000301',
    'delivery_site_id', 'a9310000-0000-4000-8000-000000000801', 'notes', 'TI691 remise'), jsonb_build_array(
    jsonb_build_object('designation', 'Tube', 'quantity', 1, 'unit', 'u', 'unit_price_ht_cents', 10000, 'tax_rate_bp', 2000),
    jsonb_build_object('designation', 'Coude', 'quantity', 1, 'unit', 'u', 'unit_price_ht_cents', 5000, 'tax_rate_bp', 2000),
    jsonb_build_object('designation', 'Remise', 'quantity', 1, 'unit', 'forfait', 'unit_price_ht_cents', 12000, 'tax_rate_bp', 2000,
      'line_kind', 'discount')))$$),
  'ok 1', '6 fixture: a manual order of 150,00 € less 120,00 €');
select set_config('test.discounted', (select id::text from public.purchase_orders where notes = 'TI691 remise'), true);
select is((select total_ht_cents from public.purchase_orders where id = current_setting('test.discounted')::uuid), 3000,
  '6 its total is 30,00 €');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.replace_purchase_order_draft(current_setting('test.discounted')::uuid, '{}'::jsonb, (
      select jsonb_agg(jsonb_build_object('id', id, 'designation', designation, 'quantity', quantity,
        'unit_price_ht_cents', case when line_kind = 'discount' then 4000 else unit_price_ht_cents end, 'tax_rate_bp', tax_rate_bp)
        order by position)
      from public.purchase_order_items where purchase_order_id = current_setting('test.discounted')::uuid and designation <> 'Tube'),
    (select edit_revision from public.purchase_orders where id = current_setting('test.discounted')::uuid))$$),
  'ok 1', '6 removing the 100,00 € line while lowering the discount to 40,00 € passes (the sum is negative in between)');
select results_eq(
  $$select total_ht_cents, total_tax_cents, total_ttc_cents from public.purchase_orders where id = current_setting('test.discounted')::uuid$$,
  $$values (1000, 200, 1200)$$, '6 and lands on 50,00 € less 40,00 €');
select set_config('test.discounted_revision', (select edit_revision::text from public.purchase_orders
  where id = current_setting('test.discounted')::uuid), true);
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.replace_purchase_order_draft(current_setting('test.discounted')::uuid, '{}'::jsonb, (
      select jsonb_agg(jsonb_build_object('id', id, 'designation', designation, 'quantity', quantity,
        'unit_price_ht_cents', case when line_kind = 'discount' then 6000 else unit_price_ht_cents end, 'tax_rate_bp', tax_rate_bp)
        order by position)
      from public.purchase_order_items where purchase_order_id = current_setting('test.discounted')::uuid),
    current_setting('test.discounted_revision')::bigint)$$),
  '23514 PURCHASE_ORDER_TOTAL_NEGATIVE', '6 an edit ending below zero is refused');
select results_eq(
  $$select total_ht_cents, edit_revision from public.purchase_orders where id = current_setting('test.discounted')::uuid$$,
  format('values (1000, %s::bigint)', current_setting('test.discounted_revision')),
  '6 and writes nothing');

-- ---------------------------------------------------------------------------
-- 8. Removing a line from a draft frees it; a request whose orders are canceled is deleted.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000001',
  $$select public.replace_purchase_order_draft(current_setting('test.order_alpha')::uuid, '{}'::jsonb, (
      select jsonb_agg(jsonb_build_object('id', id, 'designation', designation, 'quantity', quantity,
        'unit_price_ht_cents', unit_price_ht_cents, 'tax_rate_bp', tax_rate_bp) order by position)
      from public.purchase_order_items where purchase_order_id = current_setting('test.order_alpha')::uuid
        and material_request_line_id is distinct from 'a9310000-0000-4000-8000-000000000703'),
    (select edit_revision from public.purchase_orders where id = current_setting('test.order_alpha')::uuid))$$),
  'ok 1', '8 fixture: the owner takes the gloves out of the Alpha draft');
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000001',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->0->'r'->'ready_line_ids',
  jsonb_build_array('a9310000-0000-4000-8000-000000000703'), '8 the gloves are ready again');
select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000006',
  $$select public.material_request_order_summary('a9310000-0000-4000-8000-000000000601') as r$$)->0->'r'->'orders',
  (select jsonb_agg(jsonb_build_object('id', po.id, 'reference', po.reference, 'supplier_name', s.name, 'status', po.status,
      'total_ht_cents', po.total_ht_cents, 'line_count', counts.line_count) order by po.order_number)
    from public.purchase_orders po join public.suppliers s on s.id = po.supplier_id
    join (values (current_setting('test.order_alpha')::uuid, 2), (current_setting('test.order_beta')::uuid, 1),
      (current_setting('test.order_beta_again')::uuid, 1)) as counts(order_id, line_count) on counts.order_id = po.id),
  '8 the director reads every order of the request, the canceled one included, with its lines of the request and its total');

select is(pg_temp.pls_rows('a9310000-0000-4000-8000-000000000005',
  $$select public.create_material_request_purchase_orders('a9310000-0000-4000-8000-000000000602',
    'a9310000-0000-4000-8000-00000000b001') as r$$)->0->'r'->'orders'->0->>'total_ht_cents', '2000',
  '3 the engineer who owns affaire 202 orders its request');
select set_config('test.order_other', (select id::text from public.purchase_orders
  where project_id = 'a9310000-0000-4000-8000-000000000202'), true);
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000005',
  $$update public.purchase_orders set status = 'canceled' where id = current_setting('test.order_other')::uuid$$),
  'ok 1', '8 fixture: and cancels the order');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000005',
  $$update public.material_request_lines set status = 'draft' where id = 'a9310000-0000-4000-8000-000000000708'$$),
  'ok 1', '13 a line whose order is canceled is reopened');
select is(pg_temp.pls_run('a9310000-0000-4000-8000-000000000005',
  $$delete from public.material_requests where id = 'a9310000-0000-4000-8000-000000000602'$$),
  'ok 1', '8 a request whose orders are all canceled is deleted');
select results_eq(
  $$select oi.material_request_line_id, oi.imputation, oi.line_total_ht_cents, po.total_ht_cents, po.status::text
    from public.purchase_order_items oi join public.purchase_orders po on po.id = oi.purchase_order_id
    where po.id = current_setting('test.order_other')::uuid$$,
  $$values (null::uuid, 'project'::text, 2000, 2000, 'canceled'::text)$$,
  '8 its canceled order stays, its line detached, its money unchanged');

-- ---------------------------------------------------------------------------
-- 11. The documents of an order.
-- ---------------------------------------------------------------------------
select set_config('test.documents', (pg_temp.pls_rows('a9310000-0000-4000-8000-000000000001',
  $$select public.get_purchase_order_documents(array[current_setting('test.order_alpha')::uuid]) as r$$)->0->'r'->'orders'->0)::text, true);
select is(current_setting('test.documents')::jsonb - array['id', 'reference', 'created_at', 'edit_revision', 'items',
    'expected_delivery_date', 'suppliers', 'delivery_sites', 'status', 'total_ht_cents', 'total_tax_cents', 'total_ttc_cents'],
  jsonb_build_object('project_id', 'a9310000-0000-4000-8000-000000000201',
    'project', jsonb_build_object('id', 'a9310000-0000-4000-8000-000000000201', 'name', 'TI691 Affaire commandée'),
    'delivery_mode', 'counter'),
  '11 the documents name the affaire and the delivery mode');
select is((select jsonb_agg(jsonb_build_object('kind', i->>'line_kind', 'supply_type_name', i->>'supply_type_name',
    'material_request_id', i->>'material_request_id', 'price_per', (i->>'price_per')::integer) order by (i->>'position')::integer)
  from jsonb_array_elements(current_setting('test.documents')::jsonb->'items') i where (i->>'position')::integer <= 2),
  jsonb_build_array(
    jsonb_build_object('kind', 'article', 'supply_type_name', 'TI691 Raccords', 'material_request_id', 'a9310000-0000-4000-8000-000000000601', 'price_per', 1),
    jsonb_build_object('kind', 'article', 'supply_type_name', null, 'material_request_id', 'a9310000-0000-4000-8000-000000000601', 'price_per', 100)),
  '11 and each line its kind, supply type, request and lot');

select * from finish();
rollback;
