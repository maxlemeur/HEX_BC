-- Lot 2, sub-lot 2.9 (P-18): purchase unit and packaging of a supplier offer, and the shared unit
-- referential in purchase preparation (D9). Contract: docs/testing/estimate-engine-v3-2.9.md.
-- Isolation is justified there: the conversion arithmetic of create_estimate_purchase_order_drafts
-- and the integrity of the three conversion columns are not all observable from a journey.
-- Statements that need the new columns run inside lives_ok/throws_ok so that, before the
-- migration, this file fails on named assertions instead of aborting.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000', '29000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'supplier-offer-purchase-unit@example.test',
  crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);

select set_config(
  'test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '29000000-0000-4000-8000-000000000001' limit 1),
  true
);

-- Fixture: one supplier; P1 cast-iron pipe in ml; offers O1 (bar of 3 m, 262,45 €), O2 (bar of 3 m,
-- 27,00 €), O3 (bar of 3 m, 262,45 €, no rounding), O4 (ml, 10,00 €, no conversion), O5 (bar of 3 m,
-- minimum 100 bars). Conversions are declared below, after the columns exist.
insert into public.suppliers (id, tenant_id, name, is_active) values
  ('29000000-0000-4000-8000-000000000011', current_setting('test.tenant_id')::uuid, 'PU29 fournisseur', true);
insert into public.products (id, tenant_id, reference, designation, unit, unit_price_cents, is_active) values
  ('29000000-0000-4000-8000-000000000021', current_setting('test.tenant_id')::uuid, 'PU29-1', 'PU29 tube fonte DN100', 'ml', 0, true);
insert into public.supplier_catalog_items (id, tenant_id, supplier_id, product_id, supplier_sku, is_active) values
  ('29000000-0000-4000-8000-000000000031', current_setting('test.tenant_id')::uuid, '29000000-0000-4000-8000-000000000011',
   '29000000-0000-4000-8000-000000000021', 'PU29-S1-P1', true);
insert into public.supplier_pricebook (id, tenant_id, supplier_catalog_item_id, supplier_id, product_id, supplier_sku,
  unit, min_quantity, unit_price_cents, currency, valid_from, valid_to, is_active)
select offer.id::uuid, current_setting('test.tenant_id')::uuid, '29000000-0000-4000-8000-000000000031',
  '29000000-0000-4000-8000-000000000011', '29000000-0000-4000-8000-000000000021', 'PU29-S1-P1',
  offer.unit, offer.min_quantity, offer.cents, 'EUR', current_date - offer.age, current_date + 30, true
from (values
  ('29000000-0000-4000-8000-000000000041', 'barre', 1, 26245, 0),
  ('29000000-0000-4000-8000-000000000042', 'barre', 1, 2700, 1),
  ('29000000-0000-4000-8000-000000000043', 'barre', 1, 26245, 2),
  ('29000000-0000-4000-8000-000000000044', 'ml', 1, 1000, 3),
  ('29000000-0000-4000-8000-000000000045', 'barre', 100, 26245, 4)
) as offer(id, unit, min_quantity, cents, age);
-- One article at one supplier: each offer opens its validity window on a different day.

-- Conversion columns and their integrity -----------------------------------------------------

select lives_ok(
  $$update public.supplier_pricebook
    set estimate_unit_code = 'ml', estimate_units_per_purchase_unit = 3, purchase_rounding = 'ceil'
    where id in ('29000000-0000-4000-8000-000000000041', '29000000-0000-4000-8000-000000000042',
      '29000000-0000-4000-8000-000000000045')$$,
  'an offer sold by the bar declares 3 ml per bar, rounded up to whole bars'
);
select lives_ok(
  $$update public.supplier_pricebook
    set estimate_unit_code = 'ml', estimate_units_per_purchase_unit = 3, purchase_rounding = 'none'
    where id = '29000000-0000-4000-8000-000000000043'$$,
  'an offer may declare a conversion without rounding'
);
select throws_ok(
  $$update public.supplier_pricebook set estimate_unit_code = 'ml'
    where id = '29000000-0000-4000-8000-000000000044'$$,
  '23514', null, 'the three conversion columns are set together'
);
select throws_ok(
  $$update public.supplier_pricebook set estimate_units_per_purchase_unit = 0
    where id = '29000000-0000-4000-8000-000000000041'$$,
  '23514', null, 'the quantity per purchase unit is positive'
);
select throws_ok(
  $$update public.supplier_pricebook set purchase_rounding = 'floor'
    where id = '29000000-0000-4000-8000-000000000041'$$,
  '23514', null, 'the purchase rounding is none or ceil'
);
select throws_ok(
  $$update public.supplier_pricebook set estimate_unit_code = 'barre'
    where id = '29000000-0000-4000-8000-000000000041'$$,
  '23503', null, 'the estimate unit is a code of the unit referential'
);

-- Purchase fixture ---------------------------------------------------------------------------
-- L1 282 ml at 87,48 (O1); L2 10 ml at 9,00 (O2); L3 282 ml negotiated at 80,00 (O1);
-- L4 10 ml (O3, no rounding: 10 / 3 is not representable); L5 5 « m.l. » (O4 in ml);
-- L6 282 ml (O5, 94 bars under the minimum of 100).
insert into public.delivery_sites (id, tenant_id, name, is_active, updated_at) values
  ('29000000-0000-4000-8000-000000000050', current_setting('test.tenant_id')::uuid, 'PU29 chantier', true, now() - interval '1 second');
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('29000000-0000-4000-8000-000000000051', current_setting('test.tenant_id')::uuid, '29000000-0000-4000-8000-000000000001', 'PU29 affaire');
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth, currency) values
  ('29000000-0000-4000-8000-000000000052', current_setting('test.tenant_id')::uuid, '29000000-0000-4000-8000-000000000051', 1, 1, 1, 'EUR');
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title) values
  ('29000000-0000-4000-8000-000000000053', current_setting('test.tenant_id')::uuid, '29000000-0000-4000-8000-000000000052', 'section', 1, 'PU29 lot');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, line_nature, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, selected_supplier_price_id, product_id,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
select line.id::uuid, current_setting('test.tenant_id')::uuid, '29000000-0000-4000-8000-000000000052',
  '29000000-0000-4000-8000-000000000053', 'line', 'supply_only', line.position, line.title, line.unit,
  line.quantity, line.cents, 2000, 1, 0, 1, line.offer::uuid, '29000000-0000-4000-8000-000000000021',
  line.cents, round(line.quantity * line.cents), round(round(line.quantity * line.cents) * 0.2),
  round(line.quantity * line.cents) + round(round(line.quantity * line.cents) * 0.2)
from (values
  ('29000000-0000-4000-8000-000000000061', 1, 'PU29 L1 282 ml', 'ml', 282::numeric, 8748, '29000000-0000-4000-8000-000000000041'),
  ('29000000-0000-4000-8000-000000000062', 2, 'PU29 L2 10 ml', 'ml', 10::numeric, 900, '29000000-0000-4000-8000-000000000042'),
  ('29000000-0000-4000-8000-000000000063', 3, 'PU29 L3 négocié', 'ml', 282::numeric, 8000, '29000000-0000-4000-8000-000000000041'),
  ('29000000-0000-4000-8000-000000000064', 4, 'PU29 L4 sans arrondi', 'ml', 10::numeric, 8748, '29000000-0000-4000-8000-000000000043'),
  ('29000000-0000-4000-8000-000000000065', 5, 'PU29 L5 m.l.', 'm.l.', 5::numeric, 1000, '29000000-0000-4000-8000-000000000044'),
  ('29000000-0000-4000-8000-000000000066', 6, 'PU29 L6 minimum', 'ml', 282::numeric, 8748, '29000000-0000-4000-8000-000000000045'),
  -- Review of 2.9: a line already written in the purchase unit keeps its bars and its bar price.
  ('29000000-0000-4000-8000-000000000067', 7, 'PU29 L7 en barres', 'Barre', 94::numeric, 26245, '29000000-0000-4000-8000-000000000041')
) as line(id, position, title, unit, quantity, cents, offer);

select set_config('request.jwt.claim.sub', '29000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '29000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

create temporary table pu29_purchase (case_name text primary key, outcome text) on commit drop;

do $purchase$
declare
  case_line record;
  review jsonb;
  reviewed jsonb;
  groups jsonb;
  outcome text;
begin
  for case_line in
    select * from (values
      ('L1', '29000000-0000-4000-8000-000000000061'::uuid), ('L2', '29000000-0000-4000-8000-000000000062'::uuid),
      ('L3', '29000000-0000-4000-8000-000000000063'::uuid), ('L4', '29000000-0000-4000-8000-000000000064'::uuid),
      ('L5', '29000000-0000-4000-8000-000000000065'::uuid), ('L6', '29000000-0000-4000-8000-000000000066'::uuid),
      ('L7', '29000000-0000-4000-8000-000000000067'::uuid)
    ) as cases(case_name, item_id)
  loop
    begin
      review := public.get_estimate_purchase_order_review('29000000-0000-4000-8000-000000000052', array[case_line.item_id]);
      select jsonb_agg(jsonb_build_object('item_id', l->'item_id', 'review_fingerprint', l->'review_fingerprint'))
        into reviewed from jsonb_array_elements(review->'lines') l;
      select jsonb_build_array(jsonb_build_object('supplier_id', '29000000-0000-4000-8000-000000000011',
        'delivery_site_id', s.id, 'delivery_site_updated_at', s.updated_at,
        'item_ids', jsonb_build_array(case_line.item_id), 'expected_delivery_date', null, 'notes', 'PU29'))
        into groups from public.delivery_sites s where s.id = '29000000-0000-4000-8000-000000000050';
      perform public.create_estimate_purchase_order_drafts('29000000-0000-4000-8000-000000000052',
        gen_random_uuid(), reviewed, groups);
      outcome := 'created';
    exception when others then
      outcome := sqlstate || ' ' || sqlerrm;
    end;
    insert into pu29_purchase values (case_line.case_name, outcome);
  end loop;
end
$purchase$;

select results_eq(
  $$select case_name, outcome from pu29_purchase order by case_name$$,
  $$values ('L1'::text, 'created'::text), ('L2', 'created'), ('L3', 'created'),
           ('L4', '40001 ORDER_DRAFT_PREPARATION_STALE'), ('L5', 'created'), ('L6', '40001 ORDER_DRAFT_PREPARATION_STALE'),
           ('L7', 'created')$$,
  'converted lines are ordered; an unrepresentable quantity and a minimum missed in bars are refused; m.l. matches ml'
);

select results_eq(
  $$select item.source_estimate_item_id::text, item.quantity, item.unit, item.price_unit, item.unit_price_ht_cents,
      item.line_total_ht_cents, item.line_tax_cents
    from public.purchase_order_items item
    where item.source_estimate_item_id in ('29000000-0000-4000-8000-000000000061', '29000000-0000-4000-8000-000000000062',
      '29000000-0000-4000-8000-000000000063', '29000000-0000-4000-8000-000000000065', '29000000-0000-4000-8000-000000000067')
    order by item.source_estimate_item_id$$,
  $$values ('29000000-0000-4000-8000-000000000061'::text, 94::numeric, 'barre'::text, 'barre'::text, 26245, 2467030, 493406),
           ('29000000-0000-4000-8000-000000000062', 4::numeric, 'barre', 'barre', 2700, 10800, 2160),
           ('29000000-0000-4000-8000-000000000063', 94::numeric, 'barre', 'barre', 24000, 2256000, 451200),
           ('29000000-0000-4000-8000-000000000065', 5::numeric, 'm.l.', 'ml', 1000, 5000, 1000),
           ('29000000-0000-4000-8000-000000000067', 94::numeric, 'Barre', 'barre', 26245, 2467030, 493406)$$,
  'a converted line orders whole bars at the offer price, or at the negotiated price times 3; an unconverted line is unchanged'
);

select results_eq(
  $$select order_row.total_ht_cents, order_row.total_tax_cents, order_row.total_ttc_cents
    from public.purchase_orders order_row
    join public.purchase_order_items item on item.purchase_order_id = order_row.id
    where item.source_estimate_item_id = '29000000-0000-4000-8000-000000000061'$$,
  $$values (2467030, 493406, 2960436)$$,
  'the draft totals follow the purchase quantity and price'
);

-- Review of 2.9: the catalogue compares offers per estimate unit. P1: bar of 3 m at 27,00 € (9,00 €/ml)
-- beats the 10,00 €/ml offer and the bars at 262,45 € (87,48 €/ml).
select is(
  (select best_supplier_price_cents from public.catalogue_products_page(p_q => 'PU29'))::integer,
  900,
  'the catalogue best price is the cheapest price per estimate unit'
);

select * from finish();
rollback;
