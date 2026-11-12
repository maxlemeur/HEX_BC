-- Suppliers of material request lines (TI-691, lot 2 « l'achat », delivery 1). Written with the migration
-- 20261112152357_purchase_line_suppliers.sql. Failure modes this file guards, with fictional members, suppliers and
-- articles:
--  1. choosing, changing or clearing the supplier of a validated line returns it to draft and clears its stamps (the
--     supplier is the office's purchasing choice); or, the other way round, changing what a validated line says (its
--     quantity) no longer returns it to draft; a line names a supplier of another tenant;
--  2. a supply type or an article prefers a supplier of another tenant (written directly, or by moving the row to
--     another tenant); deleting the supplier fails, or leaves its id behind; an article's exception names a supplier
--     that has no item for it, or one withdrawn from it (inactive item);
--  3. a viewer or a director sets or clears the preferred supplier of a supply type, or a viewer can no longer
--     rename one (any member writes its name); an admin of another tenant reaches this tenant's types;
--  4. an engineer who did not add a shared article sets its supplier exception while the shared base is closed
--     (TI-689 rule), or the engineer who added it cannot; a viewer can;
--  5. save_supplier_catalog_item: anon or a viewer calls it; an engineer saves a reference on an article they may not
--     change, or cannot once the admin opened the shared base; an article or a supplier of another tenant is
--     accepted; a blank, too long or non-http(s) value is accepted; saving the same pair again creates a second item
--     instead of updating the first; deactivating deletes the item; a price, or the reference its row keeps, changes;
--  6. last_purchase_suppliers: anon calls it; it answers dates, amounts, quantities or order ids; a draft, sent or
--     canceled order, or an older one, is taken for the last purchase, or the tie on the date is not broken by the
--     last change (as the reference-price sync does);
--     a member who cannot read the request that names the article, an admin of another tenant, or an article that no
--     line names gets a row; more than 500 ids are accepted; the office member who reads the request gets nothing
--     because the orders are another member's (the reason it is a definer function);
--  7. retain_material_request_line_suppliers (Codex review of #274): a failing choice leaves the others written (a
--     batch is not all or nothing); a line that already has a supplier is overwritten; a line of another request or of
--     another tenant, or a line the caller may not change (RLS), is written; a validated line returns to draft; a line
--     named twice, an empty or oversized batch is accepted; it bypasses RLS (security definer) or anon calls it.
-- Every member statement goes through pg_temp.pls_run or pg_temp.pls_rows (role and JWT switched in a sub-block),
-- so a red assertion fails on its own reason and the file runs to the end. Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Tenant 101: 1 engineer who owns the affaire and added article 502, 2 admin, 3 viewer, 5 another engineer,
-- 6 director. Member 4 is the admin of tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'fournisseurs-lignes-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 6) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9200000-%';
insert into public.tenants (id, name, slug) values
  ('a9200000-0000-4000-8000-000000000101', 'Fournisseurs des lignes fixture', 'fournisseurs-lignes-fixture'),
  ('a9200000-0000-4000-8000-000000000102', 'Fournisseurs des lignes autre tenant', 'fournisseurs-lignes-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 4 then 'a9200000-0000-4000-8000-000000000102' else 'a9200000-0000-4000-8000-000000000101' end)::uuid,
  ('a9200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'viewer' when 4 then 'admin' when 5 then 'engineer'
    else 'director' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 6) n;

insert into public.suppliers (id, tenant_id, name) values
  ('a9200000-0000-4000-8000-000000000301', 'a9200000-0000-4000-8000-000000000101', 'TI691 Fournisseur Alpha'),
  ('a9200000-0000-4000-8000-000000000302', 'a9200000-0000-4000-8000-000000000101', 'TI691 Fournisseur Beta'),
  ('a9200000-0000-4000-8000-000000000303', 'a9200000-0000-4000-8000-000000000101', 'TI691 Fournisseur éphémère'),
  ('a9200000-0000-4000-8000-000000000309', 'a9200000-0000-4000-8000-000000000102', 'TI691 Fournisseur d''ailleurs');
insert into public.supply_types (id, tenant_id, code, name) values
  ('a9200000-0000-4000-8000-000000000401', 'a9200000-0000-4000-8000-000000000101', 'ti691_raccords', 'TI691 Raccords'),
  ('a9200000-0000-4000-8000-000000000402', 'a9200000-0000-4000-8000-000000000101', 'ti691_brides', 'TI691 Brides'),
  ('a9200000-0000-4000-8000-000000000409', 'a9200000-0000-4000-8000-000000000102', 'ti691_raccords', 'TI691 Raccords d''ailleurs');
insert into public.products (id, tenant_id, designation, unit_price_cents, product_type, material, unit, supply_type_id, created_by) values
  ('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000101', 'TI691 Coude 90° inox DN 50', 100,
    'Coude 90°', 'Inox 304L', 'u', 'a9200000-0000-4000-8000-000000000401', null),
  ('a9200000-0000-4000-8000-000000000502', 'a9200000-0000-4000-8000-000000000101', 'TI691 Té égal inox DN 50', 100,
    'Té égal', 'Inox 304L', 'u', 'a9200000-0000-4000-8000-000000000401', 'a9200000-0000-4000-8000-000000000001'),
  ('a9200000-0000-4000-8000-000000000503', 'a9200000-0000-4000-8000-000000000101', 'TI691 Bride plate inox DN 50', 100,
    'Bride plate', 'Inox 304L', 'u', 'a9200000-0000-4000-8000-000000000402', null),
  ('a9200000-0000-4000-8000-000000000509', 'a9200000-0000-4000-8000-000000000102', 'TI691 Coude d''ailleurs', 100,
    'Coude', 'Cuivre', 'u', 'a9200000-0000-4000-8000-000000000409', null);
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9200000-0000-4000-8000-000000000201', 'a9200000-0000-4000-8000-000000000101', 'a9200000-0000-4000-8000-000000000001',
    'TI691 Affaire des achats');
insert into public.material_requests (id, project_id, created_by) values
  ('a9200000-0000-4000-8000-000000000601', 'a9200000-0000-4000-8000-000000000201', 'a9200000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, product_type, material, status,
    product_id, product_match) values
  ('a9200000-0000-4000-8000-000000000701', 'a9200000-0000-4000-8000-000000000601', 1, 4, 'u', 'DN 50', 'Coude 90°', 'Inox 304L',
    'draft', 'a9200000-0000-4000-8000-000000000501', 'manual'),
  ('a9200000-0000-4000-8000-000000000702', 'a9200000-0000-4000-8000-000000000601', 2, 2, 'u', 'DN 50', 'Té égal', 'Inox 304L',
    'draft', 'a9200000-0000-4000-8000-000000000502', 'manual');

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

-- ---------------------------------------------------------------------------
-- 1. The supplier of a validated line.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated' where id = 'a9200000-0000-4000-8000-000000000701'$$),
  'ok 1', 'fixture: the engineer who owns the affaire validates the line');
select set_config('test.validated_at',
  (select validated_at::text from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000701'), true);

select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set supplier_id = 'a9200000-0000-4000-8000-000000000301'
    where id = 'a9200000-0000-4000-8000-000000000701'$$),
  'ok 1', '1 the owner chooses the supplier of a validated line');
select ok((select status = 'validated' and supplier_id = 'a9200000-0000-4000-8000-000000000301'
    and validated_by = 'a9200000-0000-4000-8000-000000000001'
    and validated_at = current_setting('test.validated_at')::timestamptz
  from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000701'),
  '1 a validated line keeps its status, author and date when its supplier is chosen');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set supplier_id = 'a9200000-0000-4000-8000-000000000302'
    where id = 'a9200000-0000-4000-8000-000000000701'$$),
  'ok 1', '1 the owner changes it');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set supplier_id = null where id = 'a9200000-0000-4000-8000-000000000701'$$),
  'ok 1', '1 and clears it');
select ok((select status = 'validated' and supplier_id is null and validated_by = 'a9200000-0000-4000-8000-000000000001'
    and validated_at = current_setting('test.validated_at')::timestamptz
  from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000701'),
  '1 the line is still validated with the same stamps after its supplier was changed and cleared');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set supplier_id = 'a9200000-0000-4000-8000-000000000309'
    where id = 'a9200000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_TENANT_MISMATCH', '1 a line still cannot name a supplier of another tenant');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set quantity = 5, supplier_id = 'a9200000-0000-4000-8000-000000000301'
    where id = 'a9200000-0000-4000-8000-000000000701'$$),
  'ok 1', '1 the owner changes the quantity of the validated line, with its supplier');
select ok((select status = 'draft' and validated_at is null and validated_by is null and quantity = 5
    and supplier_id = 'a9200000-0000-4000-8000-000000000301'
  from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000701'),
  '1 counterexample: changing what a validated line says (its quantity) still returns it to draft');

-- ---------------------------------------------------------------------------
-- 2. Preferred suppliers belong to the row's tenant and go with the supplier.
-- ---------------------------------------------------------------------------
select has_column('public', 'supply_types', 'preferred_supplier_id', 'a supply type has a preferred supplier');
select has_column('public', 'products', 'preferred_supplier_id', 'an article has a supplier exception');
select throws_ok($$update public.supply_types set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000309'
    where id = 'a9200000-0000-4000-8000-000000000401'$$,
  '23514', 'PREFERRED_SUPPLIER_TENANT_MISMATCH', '2 a supply type cannot prefer a supplier of another tenant, even for a server writer');
select throws_ok($$insert into public.supply_types (tenant_id, code, name, preferred_supplier_id)
    values ('a9200000-0000-4000-8000-000000000101', 'ti691_autre', 'TI691 Autre', 'a9200000-0000-4000-8000-000000000309')$$,
  '23514', 'PREFERRED_SUPPLIER_TENANT_MISMATCH', '2 nor be created preferring one');
select throws_ok($$update public.products set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000309'
    where id = 'a9200000-0000-4000-8000-000000000501'$$,
  '23514', 'PREFERRED_SUPPLIER_TENANT_MISMATCH', '2 an article cannot prefer a supplier of another tenant');
update public.supply_types set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000303'
  where id = 'a9200000-0000-4000-8000-000000000402';
select throws_ok($$update public.products set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000303'
    where id = 'a9200000-0000-4000-8000-000000000503'$$,
  '23514', 'PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED',
  '2 an article cannot prefer a supplier that has no item for it, even for a server writer');
select throws_ok($$update public.supply_types set tenant_id = 'a9200000-0000-4000-8000-000000000102'
    where id = 'a9200000-0000-4000-8000-000000000402'$$,
  '23514', 'PREFERRED_SUPPLIER_TENANT_MISMATCH', '2 a supply type does not move to another tenant with its preferred supplier');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$delete from public.suppliers where id = 'a9200000-0000-4000-8000-000000000303'$$),
  'ok 1', '2 the admin deletes a supplier that a supply type prefers');
select ok((select preferred_supplier_id is null from public.supply_types where id = 'a9200000-0000-4000-8000-000000000402'),
  '2 deleting the supplier clears the preference (an article''s exception needs an item, which restricts the deletion)');

-- ---------------------------------------------------------------------------
-- 3. Who sets the preferred supplier of a supply type.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000003',
  $$update public.supply_types set name = 'TI691 Raccords inox' where id = 'a9200000-0000-4000-8000-000000000401'$$),
  'ok 1', '3 counterexample: a viewer still renames a supply type (any member writes its name and code)');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000003',
  $$update public.supply_types set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000301'
    where id = 'a9200000-0000-4000-8000-000000000401'$$),
  '42501 SUPPLY_TYPE_PREFERRED_SUPPLIER_EDITORS_ONLY', '3 a viewer cannot set the preferred supplier of a supply type');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000006',
  $$update public.supply_types set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000301'
    where id = 'a9200000-0000-4000-8000-000000000401'$$),
  '42501 SUPPLY_TYPE_PREFERRED_SUPPLIER_EDITORS_ONLY', '3 nor can a director');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000003',
  $$insert into public.supply_types (tenant_id, code, name, preferred_supplier_id) values
    ('a9200000-0000-4000-8000-000000000101', 'ti691_vue', 'TI691 Vue', 'a9200000-0000-4000-8000-000000000301')$$),
  '42501 SUPPLY_TYPE_PREFERRED_SUPPLIER_EDITORS_ONLY', '3 a viewer cannot create a supply type that prefers a supplier');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000005',
  $$update public.supply_types set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000301'
    where id = 'a9200000-0000-4000-8000-000000000401'$$),
  'ok 1', '3 an engineer sets it');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000003',
  $$update public.supply_types set preferred_supplier_id = null where id = 'a9200000-0000-4000-8000-000000000401'$$),
  '42501 SUPPLY_TYPE_PREFERRED_SUPPLIER_EDITORS_ONLY', '3 a viewer cannot clear it either');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$update public.supply_types set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000302'
    where id = 'a9200000-0000-4000-8000-000000000401'$$),
  'ok 1', '3 an admin changes it');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000004',
  $$update public.supply_types set preferred_supplier_id = null where id = 'a9200000-0000-4000-8000-000000000401'$$),
  'ok 0', '3 an admin of another tenant does not reach the supply types of this one');
select is((select preferred_supplier_id from public.supply_types where id = 'a9200000-0000-4000-8000-000000000401'),
  'a9200000-0000-4000-8000-000000000302'::uuid, '3 the supply type prefers the supplier its admin chose, under its new name');

-- ---------------------------------------------------------------------------
-- 4. Who sets the supplier exception of an article.
-- ---------------------------------------------------------------------------
-- The article's items at the suppliers its exception will name (an exception needs an active one).
insert into public.supplier_catalog_items (id, tenant_id, supplier_id, product_id, supplier_sku) values
  ('a9200000-0000-4000-8000-000000000901', 'a9200000-0000-4000-8000-000000000101', 'a9200000-0000-4000-8000-000000000301',
    'a9200000-0000-4000-8000-000000000501', 'TI691-ANCIENNE'),
  ('a9200000-0000-4000-8000-000000000903', 'a9200000-0000-4000-8000-000000000101', 'a9200000-0000-4000-8000-000000000301',
    'a9200000-0000-4000-8000-000000000502', 'TI691-T-1');
insert into public.supplier_pricebook (id, tenant_id, supplier_catalog_item_id, supplier_id, product_id, supplier_sku,
    unit, min_quantity, unit_price_cents, currency, valid_from, valid_to, is_active) values
  ('a9200000-0000-4000-8000-000000000951', 'a9200000-0000-4000-8000-000000000101', 'a9200000-0000-4000-8000-000000000901',
    'a9200000-0000-4000-8000-000000000301', 'a9200000-0000-4000-8000-000000000501', 'TI691-ANCIENNE',
    'u', 1, 1234, 'EUR', current_date, current_date + 30, true);
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000005',
  $$update public.products set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000301'
    where id = 'a9200000-0000-4000-8000-000000000501'$$),
  'ok 0', '4 an engineer who did not add a shared article does not set its supplier exception (shared base closed)');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000003',
  $$update public.products set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000301'
    where id = 'a9200000-0000-4000-8000-000000000502'$$),
  'ok 0', '4 nor does a viewer');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$update public.products set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000301'
    where id = 'a9200000-0000-4000-8000-000000000502'$$),
  'ok 1', '4 the engineer who added the article sets it');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$update public.products set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000302'
    where id = 'a9200000-0000-4000-8000-000000000501'$$),
  '23514 PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED', '4 an admin cannot name a supplier that has no item for the article');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$update public.products set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000301'
    where id = 'a9200000-0000-4000-8000-000000000501'$$),
  'ok 1', '4 an admin sets the exception of a shared article to a supplier that has an active item for it');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$update public.products set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000309'
    where id = 'a9200000-0000-4000-8000-000000000501'$$),
  '23514 PREFERRED_SUPPLIER_TENANT_MISMATCH', '4 an admin cannot point it at a supplier of another tenant');
select ok((select preferred_supplier_id = 'a9200000-0000-4000-8000-000000000301' from public.products
    where id = 'a9200000-0000-4000-8000-000000000501')
  and (select preferred_supplier_id = 'a9200000-0000-4000-8000-000000000301' from public.products
    where id = 'a9200000-0000-4000-8000-000000000502'),
  '4 each article keeps the exception its editor chose');

-- ---------------------------------------------------------------------------
-- 5. An article's reference at a supplier, without a price.
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('anon', 'public.save_supplier_catalog_item(uuid, uuid, text, text, boolean)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.save_supplier_catalog_item(uuid, uuid, text, text, boolean)', 'EXECUTE'),
  '5 anon cannot call the reference writer, a signed-in member can');
select ok((select prosecdef from pg_proc where oid = 'public.save_supplier_catalog_item(uuid, uuid, text, text, boolean)'::regprocedure),
  '5 the reference writer is a definer function (members do not write supplier items)');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000003',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000502', 'a9200000-0000-4000-8000-000000000301', 'TI691-VUE', null)$$),
  '42501 SUPPLIER_CATALOG_ITEM_EDITORS_ONLY', '5 a viewer cannot save a supplier reference');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000006',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000502', 'a9200000-0000-4000-8000-000000000301', 'TI691-DIR', null)$$),
  '42501 SUPPLIER_CATALOG_ITEM_EDITORS_ONLY', '5 nor can a director');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000005',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000302', 'TI691-B-1', null)$$),
  '42501 SUPPLIER_CATALOG_ITEM_PRODUCT_LOCKED', '5 an engineer cannot save a reference on a shared article while the shared base is closed');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000509', 'a9200000-0000-4000-8000-000000000301', 'TI691-X', null)$$),
  'P0002 SUPPLIER_CATALOG_ITEM_PRODUCT_NOT_FOUND', '5 an article of another tenant is not found');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000309', 'TI691-X', null)$$),
  'P0002 SUPPLIER_CATALOG_ITEM_SUPPLIER_NOT_FOUND', '5 a supplier of another tenant is not found');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000004',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000301', 'TI691-X', null)$$),
  'P0002 SUPPLIER_CATALOG_ITEM_PRODUCT_NOT_FOUND', '5 an admin of another tenant does not find this tenant''s article');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000302', '   ', '  ')$$),
  '22023 SUPPLIER_CATALOG_ITEM_IDENTIFIER_REQUIRED', '5 a blank reference with a blank address is refused');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  format('select public.save_supplier_catalog_item(%L, %L, %L, null)', 'a9200000-0000-4000-8000-000000000501',
    'a9200000-0000-4000-8000-000000000302', repeat('R', 256))),
  '22023 SUPPLIER_CATALOG_ITEM_SKU_INVALID', '5 a reference of 256 characters is refused');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000302', null, 'ftp://fournisseur.example.test/coude')$$),
  '22023 SUPPLIER_CATALOG_ITEM_URL_INVALID', '5 an address that is not http(s) is refused');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  format('select public.save_supplier_catalog_item(%L, %L, null, %L)', 'a9200000-0000-4000-8000-000000000501',
    'a9200000-0000-4000-8000-000000000302', 'https://fournisseur.example.test/' || repeat('a', 1990))),
  '22023 SUPPLIER_CATALOG_ITEM_URL_INVALID', '5 an address of more than 2,000 characters is refused');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000302', 'TI691-B-1', null, null)$$),
  '22023 SUPPLIER_CATALOG_ITEM_ACTIVE_REQUIRED', '5 the active flag is required');
select is((select count(*) from public.supplier_catalog_items
    where id not in ('a9200000-0000-4000-8000-000000000901', 'a9200000-0000-4000-8000-000000000903')
    and product_id in ('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000502')),
  0::bigint, '5 no refused call wrote an item');

select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000301',
    '  TI691-NOUVELLE  ', ' https://fournisseur.example.test/coude-90 ') as id$$),
  '[{"id": "a9200000-0000-4000-8000-000000000901"}]'::jsonb, '5 an admin saves the existing pair: the same item is answered');
select ok((select supplier_sku = 'TI691-NOUVELLE' and product_url = 'https://fournisseur.example.test/coude-90' and is_active
  from public.supplier_catalog_items where id = 'a9200000-0000-4000-8000-000000000901'),
  '5 the reference and the address are trimmed and replace the former ones');
select is((select count(*) from public.supplier_catalog_items
    where product_id = 'a9200000-0000-4000-8000-000000000501' and supplier_id = 'a9200000-0000-4000-8000-000000000301'),
  1::bigint, '5 saving the pair again does not create a second item');
select ok((select unit_price_cents = 1234 and supplier_sku = 'TI691-ANCIENNE' and is_active
    and supplier_catalog_item_id = 'a9200000-0000-4000-8000-000000000901'
  from public.supplier_pricebook where id = 'a9200000-0000-4000-8000-000000000951')
  and (select count(*) = 1 from public.supplier_pricebook where product_id = 'a9200000-0000-4000-8000-000000000501'),
  '5 the price, and the reference its row kept, are untouched');

select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000502', 'a9200000-0000-4000-8000-000000000302', ' TI691-T-2 ', null)$$),
  'ok 1', '5 the engineer who added an article saves its reference at a new supplier');
select ok((select tenant_id = 'a9200000-0000-4000-8000-000000000101' and supplier_sku = 'TI691-T-2' and product_url is null
    and is_active and created_by = 'a9200000-0000-4000-8000-000000000001'
  from public.supplier_catalog_items
  where product_id = 'a9200000-0000-4000-8000-000000000502' and supplier_id = 'a9200000-0000-4000-8000-000000000302'),
  '5 the new item is of the active tenant, active, without a price, under the engineer''s name');
select set_config('test.new_item', (select id::text from public.supplier_catalog_items
  where product_id = 'a9200000-0000-4000-8000-000000000502' and supplier_id = 'a9200000-0000-4000-8000-000000000302'), true);
select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000001',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000502', 'a9200000-0000-4000-8000-000000000302',
    null, null, false) as id$$),
  jsonb_build_array(jsonb_build_object('id', current_setting('test.new_item'))),
  '5 the engineer withdraws that supplier from the article without sending its reference');
select ok((select not is_active and supplier_sku = 'TI691-T-2' from public.supplier_catalog_items
    where id = current_setting('test.new_item')::uuid),
  '5 a withdrawn supplier stays as an inactive item that keeps its reference: nothing is deleted or blanked');
select is((select preferred_supplier_id from public.products where id = 'a9200000-0000-4000-8000-000000000502'),
  'a9200000-0000-4000-8000-000000000301'::uuid,
  '5 counterexample: withdrawing another supplier keeps the article''s exception');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$update public.products set preferred_supplier_id = 'a9200000-0000-4000-8000-000000000302'
    where id = 'a9200000-0000-4000-8000-000000000502'$$),
  '23514 PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED', '5 the exception cannot name a supplier withdrawn from the article');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000502', 'a9200000-0000-4000-8000-000000000301', 'TI691-T-1', null)$$),
  'ok 1', 'fixture: the engineer saves the article''s reference at the supplier of its exception');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000502', 'a9200000-0000-4000-8000-000000000301', null, null, false)$$),
  'ok 1', '5 the engineer withdraws the supplier of the article''s exception');
select ok((select preferred_supplier_id is null from public.products where id = 'a9200000-0000-4000-8000-000000000502')
    and (select not is_active and supplier_sku = 'TI691-T-1' from public.supplier_catalog_items
      where product_id = 'a9200000-0000-4000-8000-000000000502' and supplier_id = 'a9200000-0000-4000-8000-000000000301'),
  '5 withdrawing the supplier of the article''s exception clears the exception in the same operation');

-- Value by value: null keeps, blank clears; an active item keeps an identifier.
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000301',
    null, 'https://fournisseur.example.test/coude-90-bis')$$),
  'ok 1', '5 the admin changes only the address');
select ok((select supplier_sku = 'TI691-NOUVELLE' and product_url = 'https://fournisseur.example.test/coude-90-bis' and is_active
  from public.supplier_catalog_items where id = 'a9200000-0000-4000-8000-000000000901'),
  '5 a reference left out (null) is kept');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000301', '  ', null)$$),
  'ok 1', '5 the admin clears the reference with a blank');
select ok((select supplier_sku is null and product_url = 'https://fournisseur.example.test/coude-90-bis' and is_active
  from public.supplier_catalog_items where id = 'a9200000-0000-4000-8000-000000000901'),
  '5 a blank reference clears it, and the address left out is kept');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000301', null, '')$$),
  '22023 SUPPLIER_CATALOG_ITEM_IDENTIFIER_REQUIRED', '5 the last identifier of an active item cannot be cleared');
select is((select product_url from public.supplier_catalog_items where id = 'a9200000-0000-4000-8000-000000000901'),
  'https://fournisseur.example.test/coude-90-bis', '5 the refused save left the address in place');

-- An item that only carries prices (no reference, no address), as the price book creates them.
insert into public.supplier_catalog_items (id, tenant_id, supplier_id, product_id) values
  ('a9200000-0000-4000-8000-000000000902', 'a9200000-0000-4000-8000-000000000101', 'a9200000-0000-4000-8000-000000000301',
    'a9200000-0000-4000-8000-000000000503');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000503', 'a9200000-0000-4000-8000-000000000301', null, null, false)$$),
  'ok 1', '5 an item that only carries prices is withdrawn without a reference');
select ok((select not is_active and supplier_sku is null and product_url is null
  from public.supplier_catalog_items where id = 'a9200000-0000-4000-8000-000000000902'), '5 it is withdrawn as it is');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000503', 'a9200000-0000-4000-8000-000000000301', null, null, true)$$),
  'ok 1', '5 and restored as it is');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000503', 'a9200000-0000-4000-8000-000000000302', null, null, false)$$),
  '22023 SUPPLIER_CATALOG_ITEM_IDENTIFIER_REQUIRED', '5 counterexample: a new item needs a reference or an address, withdrawn or not');

select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000002',
  $$select public.set_tenant_catalogue_policy('a9200000-0000-4000-8000-000000000101', true)$$),
  'ok 1', 'fixture: the admin opens the shared base to engineers');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000005',
  $$select public.save_supplier_catalog_item('a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000302', 'TI691-B-1', null)$$),
  'ok 1', '5 counterexample: once the shared base is open, the engineer saves a reference on a shared article');

-- ---------------------------------------------------------------------------
-- 6. The supplier of the last purchase.
-- ---------------------------------------------------------------------------
insert into public.delivery_sites (id, tenant_id, name) values
  ('a9200000-0000-4000-8000-000000000551', 'a9200000-0000-4000-8000-000000000101', 'TI691 Chantier');
insert into public.purchase_orders (id, tenant_id, reference, user_id, supplier_id, delivery_site_id, order_date, created_at)
select fixture.id, 'a9200000-0000-4000-8000-000000000101', fixture.reference, 'a9200000-0000-4000-8000-000000000002',
  fixture.supplier_id, 'a9200000-0000-4000-8000-000000000551', fixture.order_date, fixture.created_at
from (values
  ('a9200000-0000-4000-8000-000000000801'::uuid, 'TI691-PO-1', 'a9200000-0000-4000-8000-000000000301'::uuid, date '2026-10-01', timestamptz '2026-10-01 08:00+00'),
  ('a9200000-0000-4000-8000-000000000802'::uuid, 'TI691-PO-2', 'a9200000-0000-4000-8000-000000000302'::uuid, date '2026-10-15', timestamptz '2026-10-15 08:00+00'),
  ('a9200000-0000-4000-8000-000000000803'::uuid, 'TI691-PO-3', 'a9200000-0000-4000-8000-000000000301'::uuid, date '2026-10-15', timestamptz '2026-10-15 09:00+00'),
  ('a9200000-0000-4000-8000-000000000804'::uuid, 'TI691-PO-4', 'a9200000-0000-4000-8000-000000000302'::uuid, date '2026-11-01', timestamptz '2026-11-01 08:00+00'),
  ('a9200000-0000-4000-8000-000000000805'::uuid, 'TI691-PO-5', 'a9200000-0000-4000-8000-000000000302'::uuid, date '2026-11-02', timestamptz '2026-11-02 08:00+00'),
  ('a9200000-0000-4000-8000-000000000806'::uuid, 'TI691-PO-6', 'a9200000-0000-4000-8000-000000000302'::uuid, date '2026-11-03', timestamptz '2026-11-03 08:00+00'),
  ('a9200000-0000-4000-8000-000000000807'::uuid, 'TI691-PO-7', 'a9200000-0000-4000-8000-000000000302'::uuid, date '2026-10-20', timestamptz '2026-10-20 08:00+00'),
  ('a9200000-0000-4000-8000-000000000808'::uuid, 'TI691-PO-8', 'a9200000-0000-4000-8000-000000000302'::uuid, date '2026-09-01', timestamptz '2026-09-01 08:00+00')
) as fixture(id, reference, supplier_id, order_date, created_at);
insert into public.purchase_order_items (tenant_id, purchase_order_id, position, product_id, designation, quantity, unit,
    unit_price_ht_cents, tax_rate_bp)
select 'a9200000-0000-4000-8000-000000000101', fixture.order_id, 1, fixture.product_id, 'TI691 Ligne de commande', 3, 'u', 2500, 2000
from (values
  ('a9200000-0000-4000-8000-000000000801'::uuid, 'a9200000-0000-4000-8000-000000000501'::uuid),
  ('a9200000-0000-4000-8000-000000000802'::uuid, 'a9200000-0000-4000-8000-000000000501'::uuid),
  ('a9200000-0000-4000-8000-000000000803'::uuid, 'a9200000-0000-4000-8000-000000000501'::uuid),
  ('a9200000-0000-4000-8000-000000000804'::uuid, 'a9200000-0000-4000-8000-000000000501'::uuid),
  ('a9200000-0000-4000-8000-000000000805'::uuid, 'a9200000-0000-4000-8000-000000000501'::uuid),
  ('a9200000-0000-4000-8000-000000000806'::uuid, 'a9200000-0000-4000-8000-000000000501'::uuid),
  ('a9200000-0000-4000-8000-000000000807'::uuid, 'a9200000-0000-4000-8000-000000000503'::uuid),
  ('a9200000-0000-4000-8000-000000000808'::uuid, 'a9200000-0000-4000-8000-000000000502'::uuid)
) as fixture(order_id, product_id);
update public.purchase_orders set status = 'received' where id in ('a9200000-0000-4000-8000-000000000801', 'a9200000-0000-4000-8000-000000000808');
update public.purchase_orders set status = 'confirmed'
  where id in ('a9200000-0000-4000-8000-000000000802', 'a9200000-0000-4000-8000-000000000803', 'a9200000-0000-4000-8000-000000000807');
update public.purchase_orders set status = 'sent' where id = 'a9200000-0000-4000-8000-000000000805';
update public.purchase_orders set status = 'canceled' where id = 'a9200000-0000-4000-8000-000000000806';
-- On the same order date, order 2 was created first but changed last: the last change decides, as for the
-- reference-price sync. Its trigger stamps now(), equal for every statement of this transaction, so it is set here.
alter table public.purchase_orders disable trigger set_purchase_orders_updated_at;
update public.purchase_orders set updated_at = '2026-10-16 10:00+00' where id = 'a9200000-0000-4000-8000-000000000802';
update public.purchase_orders set updated_at = '2026-10-15 09:30+00' where id = 'a9200000-0000-4000-8000-000000000803';
alter table public.purchase_orders enable trigger set_purchase_orders_updated_at;
select is((select array_agg(status::text order by reference) from public.purchase_orders where reference like 'TI691-PO-%'),
  array['received', 'confirmed', 'confirmed', 'draft', 'sent', 'canceled', 'confirmed', 'received'],
  'fixture: the orders of the admin have their statuses');

select ok(not has_function_privilege('anon', 'public.last_purchase_suppliers(uuid[])', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.last_purchase_suppliers(uuid[])', 'EXECUTE'),
  '6 anon cannot ask for the last purchases, a signed-in member can');
select is(pg_get_function_result('public.last_purchase_suppliers(uuid[])'::regprocedure),
  'TABLE(product_id uuid, supplier_id uuid)', '6 the answer carries no order id, date, quantity, price or amount');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$select 1 from public.purchase_orders where tenant_id = 'a9200000-0000-4000-8000-000000000101'$$),
  'ok 0', '6 under RLS the engineer who reads the request sees none of these orders, which are the admin''s: hence a definer function');

select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000001',
  $$select * from public.last_purchase_suppliers(array['a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000502',
    'a9200000-0000-4000-8000-000000000503', 'a9200000-0000-4000-8000-000000000509', null]::uuid[]) order by product_id$$),
  '[{"product_id": "a9200000-0000-4000-8000-000000000501", "supplier_id": "a9200000-0000-4000-8000-000000000302"},
    {"product_id": "a9200000-0000-4000-8000-000000000502", "supplier_id": "a9200000-0000-4000-8000-000000000302"}]'::jsonb,
  '6 the owner of the affaire gets, per article of a line, the latest confirmed or received order (the last changed on a tie of dates, not the last created), never a draft, sent or canceled one, nor an article that no line names nor one of another tenant');
select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000006',
  $$select * from public.last_purchase_suppliers(array['a9200000-0000-4000-8000-000000000501']::uuid[])$$),
  '[{"product_id": "a9200000-0000-4000-8000-000000000501", "supplier_id": "a9200000-0000-4000-8000-000000000302"}]'::jsonb,
  '6 a director, who reads every affaire, gets it too');
select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000003',
  $$select * from public.last_purchase_suppliers(array['a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000502']::uuid[])$$),
  '[]'::jsonb, '6 a viewer who cannot read the request gets nothing');
select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000005',
  $$select * from public.last_purchase_suppliers(array['a9200000-0000-4000-8000-000000000501']::uuid[])$$),
  '[]'::jsonb, '6 nor does an engineer who does not own the affaire');
select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000004',
  $$select * from public.last_purchase_suppliers(array['a9200000-0000-4000-8000-000000000501', 'a9200000-0000-4000-8000-000000000509']::uuid[])$$),
  '[]'::jsonb, '6 nor does an admin of another tenant');
select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000001',
  $$select * from public.last_purchase_suppliers(array(select gen_random_uuid() from generate_series(1, 501)))$$),
  '{"error": "22023", "message": "LAST_PURCHASE_SUPPLIERS_TOO_MANY"}'::jsonb, '6 more than 500 ids are refused');
select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000001',
  $$select * from public.last_purchase_suppliers(array(select gen_random_uuid() from generate_series(1, 500)))$$),
  '[]'::jsonb, '6 500 ids are accepted');

-- ---------------------------------------------------------------------------
-- 7. Retaining the suppliers of several lines, all or nothing.
-- ---------------------------------------------------------------------------
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, product_type, material, status) values
  ('a9200000-0000-4000-8000-000000000703', 'a9200000-0000-4000-8000-000000000601', 3, 1, 'u', 'DN 50', 'Bride', 'Inox 304L', 'draft'),
  ('a9200000-0000-4000-8000-000000000704', 'a9200000-0000-4000-8000-000000000601', 4, 1, 'u', 'DN 50', 'Vanne', 'Inox 304L', 'draft'),
  ('a9200000-0000-4000-8000-000000000706', 'a9200000-0000-4000-8000-000000000601', 6, 1, 'u', 'DN 50', 'Manchon', 'Inox 304L', 'draft');
-- A line of the other tenant, in its own affaire and request.
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9200000-0000-4000-8000-000000000202', 'a9200000-0000-4000-8000-000000000102', 'a9200000-0000-4000-8000-000000000004',
    'TI691 Affaire d''ailleurs');
insert into public.material_requests (id, project_id, created_by) values
  ('a9200000-0000-4000-8000-000000000602', 'a9200000-0000-4000-8000-000000000202', 'a9200000-0000-4000-8000-000000000004');
insert into public.material_request_lines (id, request_id, position, product_type) values
  ('a9200000-0000-4000-8000-000000000705', 'a9200000-0000-4000-8000-000000000602', 1, 'Coude');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated' where id = 'a9200000-0000-4000-8000-000000000704'$$),
  'ok 1', 'fixture: the owner validates a line that has no supplier yet');
select set_config('test.retain_validated_at',
  (select validated_at::text from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000704'), true);

select ok(not has_function_privilege('anon', 'public.retain_material_request_line_suppliers(uuid, jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.retain_material_request_line_suppliers(uuid, jsonb)', 'EXECUTE')
    and not (select prosecdef from pg_proc where oid = 'public.retain_material_request_line_suppliers(uuid, jsonb)'::regprocedure),
  '7 the retain function runs as the caller (RLS applies), signed-in members only');

select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000001', format(
  $$select * from public.retain_material_request_line_suppliers(%L, %L::jsonb)$$, 'a9200000-0000-4000-8000-000000000601',
  jsonb_build_array(
    jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000703', 'supplier_id', 'a9200000-0000-4000-8000-000000000301'),
    jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000704', 'supplier_id', 'a9200000-0000-4000-8000-000000000302'),
    jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000701', 'supplier_id', 'a9200000-0000-4000-8000-000000000302'),
    jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000705', 'supplier_id', 'a9200000-0000-4000-8000-000000000301'))::text)),
  '[{"line_id": "a9200000-0000-4000-8000-000000000703", "retained": true},
    {"line_id": "a9200000-0000-4000-8000-000000000704", "retained": true},
    {"line_id": "a9200000-0000-4000-8000-000000000701", "retained": false},
    {"line_id": "a9200000-0000-4000-8000-000000000705", "retained": false}]'::jsonb,
  '7 the owner retains suppliers: the lines without one are written, the one that had one and a line of another tenant are not');
select ok((select supplier_id = 'a9200000-0000-4000-8000-000000000301' from public.material_request_lines
    where id = 'a9200000-0000-4000-8000-000000000701')
  and (select supplier_id is null from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000705')
  and (select supplier_id = 'a9200000-0000-4000-8000-000000000301' from public.material_request_lines
    where id = 'a9200000-0000-4000-8000-000000000703'),
  '7 a supplier set before is kept, and the line of another tenant is untouched');
select ok((select status = 'validated' and supplier_id = 'a9200000-0000-4000-8000-000000000302'
    and validated_at = current_setting('test.retain_validated_at')::timestamptz
    and validated_by = 'a9200000-0000-4000-8000-000000000001'
  from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000704'),
  '7 a validated line keeps its status and stamps when its supplier is retained');

select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001', format(
  $$select * from public.retain_material_request_line_suppliers(%L, %L::jsonb)$$, 'a9200000-0000-4000-8000-000000000601',
  jsonb_build_array(
    jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000702', 'supplier_id', 'a9200000-0000-4000-8000-000000000301'),
    jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000706', 'supplier_id', 'a9200000-0000-4000-8000-000000000309'))::text)),
  '23514 MATERIAL_REQUEST_TENANT_MISMATCH', '7 a choice of a supplier of another tenant fails the batch');
select ok((select supplier_id is null from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000702')
    and (select supplier_id is null from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000706'),
  '7 all or nothing: the valid choice of the failed batch is not written either');

select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000003', format(
  $$select * from public.retain_material_request_line_suppliers(%L, %L::jsonb)$$, 'a9200000-0000-4000-8000-000000000601',
  jsonb_build_array(jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000702', 'supplier_id', 'a9200000-0000-4000-8000-000000000301'))::text)),
  '[{"line_id": "a9200000-0000-4000-8000-000000000702", "retained": false}]'::jsonb,
  '7 a viewer writes nothing (the update policy applies)');
select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000004', format(
  $$select * from public.retain_material_request_line_suppliers(%L, %L::jsonb)$$, 'a9200000-0000-4000-8000-000000000601',
  jsonb_build_array(jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000702', 'supplier_id', 'a9200000-0000-4000-8000-000000000301'))::text)),
  '[{"line_id": "a9200000-0000-4000-8000-000000000702", "retained": false}]'::jsonb,
  '7 nor does an admin of another tenant');
select is(pg_temp.pls_rows('a9200000-0000-4000-8000-000000000001', format(
  $$select * from public.retain_material_request_line_suppliers(%L, %L::jsonb)$$, 'a9200000-0000-4000-8000-000000000602',
  jsonb_build_array(jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000702', 'supplier_id', 'a9200000-0000-4000-8000-000000000301'))::text)),
  '[{"line_id": "a9200000-0000-4000-8000-000000000702", "retained": false}]'::jsonb,
  '7 a line is written only through its own request');
select ok((select supplier_id is null from public.material_request_lines where id = 'a9200000-0000-4000-8000-000000000702'),
  '7 the line refused three times still has no supplier');

select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001', format(
  $$select * from public.retain_material_request_line_suppliers(%L, %L::jsonb)$$, 'a9200000-0000-4000-8000-000000000601',
  jsonb_build_array(
    jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000702', 'supplier_id', 'a9200000-0000-4000-8000-000000000301'),
    jsonb_build_object('line_id', 'a9200000-0000-4000-8000-000000000702', 'supplier_id', 'a9200000-0000-4000-8000-000000000302'))::text)),
  '22023 MATERIAL_REQUEST_RETAIN_CHOICES_INVALID', '7 a line named twice is refused');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_line_suppliers('a9200000-0000-4000-8000-000000000601', '[]'::jsonb)$$),
  '22023 MATERIAL_REQUEST_RETAIN_CHOICES_INVALID', '7 an empty batch is refused');
select is(pg_temp.pls_run('a9200000-0000-4000-8000-000000000001', format(
  $$select * from public.retain_material_request_line_suppliers(%L, %L::jsonb)$$, 'a9200000-0000-4000-8000-000000000601',
  (select jsonb_agg(jsonb_build_object('line_id', gen_random_uuid(), 'supplier_id', 'a9200000-0000-4000-8000-000000000301'))
    from generate_series(1, 301))::text)),
  '22023 MATERIAL_REQUEST_RETAIN_CHOICES_INVALID', '7 more than 300 choices are refused');

select * from finish();
rollback;
