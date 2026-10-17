-- Lot 2, sub-lot 2.2: zero-priced supplier offers (A7) and linear metre units (P-08).
-- Contract: docs/testing/estimate-engine-v3-2.2.md. Isolation is justified there: the
-- catalogue summary counts, the best-price choice behind the catalogue page and the
-- transactional refusal of create_estimate_purchase_order_drafts are not all observable
-- from a journey, and the zero_price_kind constraint is data integrity.
-- Statements that need the new column run inside lives_ok/throws_ok so that, before
-- the migration, this file fails on named assertions instead of aborting.
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
  '00000000-0000-0000-0000-000000000000', '22000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'supplier-offer-zero@example.test',
  crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);

select set_config(
  'test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '22000000-0000-4000-8000-000000000001' limit 1),
  true
);
-- Freight conditions (transport_mode) may only be set by a tenant admin: seed as that user.
select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '22000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

-- Fixture: S1..S3 suppliers; P1 has an unmarked 0 € offer (S1) and a 12,40 € offer (S2),
-- both in "ml"; P2 has only an unmarked 0 € offer; P3 has a 0 € offer marked "included"
-- below; P4 has no offer.
insert into public.suppliers (id, tenant_id, name, is_active) values
  ('22000000-0000-4000-8000-000000000011', current_setting('test.tenant_id')::uuid, 'ZP22 fournisseur un', true),
  ('22000000-0000-4000-8000-000000000012', current_setting('test.tenant_id')::uuid, 'ZP22 fournisseur deux', true),
  ('22000000-0000-4000-8000-000000000013', current_setting('test.tenant_id')::uuid, 'ZP22 fournisseur trois', true);

insert into public.products (id, tenant_id, reference, designation, unit, unit_price_cents, is_active,
  reference_quantity, reference_transport_mode) values
  ('22000000-0000-4000-8000-000000000021', current_setting('test.tenant_id')::uuid, 'ZP22-1', 'ZP22 article un', 'ml', 1000, true, 1, 'included'),
  ('22000000-0000-4000-8000-000000000022', current_setting('test.tenant_id')::uuid, 'ZP22-2', 'ZP22 article deux', 'ml', 1000, true, 1, 'included'),
  ('22000000-0000-4000-8000-000000000023', current_setting('test.tenant_id')::uuid, 'ZP22-3', 'ZP22 article trois', 'ml', 1000, true, 1, 'included'),
  ('22000000-0000-4000-8000-000000000024', current_setting('test.tenant_id')::uuid, 'ZP22-4', 'ZP22 article quatre', 'ml', 1000, true, 1, 'included');

insert into public.supplier_catalog_items (id, tenant_id, supplier_id, product_id, supplier_sku, is_active) values
  ('22000000-0000-4000-8000-000000000031', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000021', 'ZP22-S1-P1', true),
  ('22000000-0000-4000-8000-000000000032', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000012', '22000000-0000-4000-8000-000000000021', 'ZP22-S2-P1', true),
  ('22000000-0000-4000-8000-000000000033', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000022', 'ZP22-S1-P2', true),
  ('22000000-0000-4000-8000-000000000034', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000013', '22000000-0000-4000-8000-000000000023', 'ZP22-S3-P3', true);

insert into public.supplier_pricebook (id, tenant_id, supplier_catalog_item_id, supplier_id, product_id, supplier_sku,
  unit, min_quantity, unit_price_cents, currency, valid_from, valid_to, is_active, transport_mode) values
  ('22000000-0000-4000-8000-000000000040', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000031',
   '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000021', 'ZP22-S1-P1', 'ml', 1, 0, 'EUR', current_date, current_date + 30, true, 'included'),
  ('22000000-0000-4000-8000-000000000041', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000032',
   '22000000-0000-4000-8000-000000000012', '22000000-0000-4000-8000-000000000021', 'ZP22-S2-P1', 'ml', 1, 1240, 'EUR', current_date, current_date + 30, true, 'included'),
  ('22000000-0000-4000-8000-000000000042', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000033',
   '22000000-0000-4000-8000-000000000011', '22000000-0000-4000-8000-000000000022', 'ZP22-S1-P2', 'ml', 1, 0, 'EUR', current_date, current_date + 30, true, 'included'),
  ('22000000-0000-4000-8000-000000000043', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000034',
   '22000000-0000-4000-8000-000000000013', '22000000-0000-4000-8000-000000000023', 'ZP22-S3-P3', 'ml', 1, 0, 'EUR', current_date, current_date + 30, true, 'included');

-- Marking and its integrity -------------------------------------------------------------

select lives_ok(
  $$update public.supplier_pricebook set zero_price_kind = 'included'
    where id = '22000000-0000-4000-8000-000000000043'$$,
  'an offer at 0 € can be marked included'
);
select throws_ok(
  $$update public.supplier_pricebook set zero_price_kind = 'free'
    where id = '22000000-0000-4000-8000-000000000041'$$,
  '23514', null,
  'zero_price_kind is refused on an offer priced above 0 €'
);
select throws_ok(
  $$update public.supplier_pricebook set zero_price_kind = 'gift'
    where id = '22000000-0000-4000-8000-000000000042'$$,
  '23514', null,
  'zero_price_kind only admits included or free'
);
select lives_ok(
  $$update public.supplier_pricebook set zero_price_kind = null
    where id = '22000000-0000-4000-8000-000000000042'$$,
  'an unmarked offer keeps zero_price_kind null'
);

-- Purchase fixture: lines in "ML" (P1, 12,40 € in "ml"), "ml" (P2, unmarked 0 €) and "m"
-- (P3, marked included). Direct estimate inserts are refused to an authenticated caller.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
insert into public.delivery_sites (id, tenant_id, name, is_active, updated_at) values
  ('22000000-0000-4000-8000-000000000050', current_setting('test.tenant_id')::uuid, 'ZP22 chantier', true, now() - interval '1 second');
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('22000000-0000-4000-8000-000000000051', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000001', 'ZP22 affaire');
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth, currency) values
  ('22000000-0000-4000-8000-000000000052', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000051', 1, 1, 1, 'EUR');
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title) values
  ('22000000-0000-4000-8000-000000000053', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000052', 'section', 1, 'ZP22 lot');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, line_nature, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, selected_supplier_price_id, product_id,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents) values
  ('22000000-0000-4000-8000-000000000061', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000052',
   '22000000-0000-4000-8000-000000000053', 'line', 'supply_only', 1, 'ZP22 ligne ML', 'ML', 2, 1240, 2000, 1, 0, 1,
   '22000000-0000-4000-8000-000000000041', '22000000-0000-4000-8000-000000000021', 1240, 2480, 496, 2976),
  ('22000000-0000-4000-8000-000000000062', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000052',
   '22000000-0000-4000-8000-000000000053', 'line', 'supply_only', 2, 'ZP22 ligne zéro', 'ml', 1, 500, 2000, 1, 0, 1,
   '22000000-0000-4000-8000-000000000042', '22000000-0000-4000-8000-000000000022', 500, 500, 100, 600),
  ('22000000-0000-4000-8000-000000000063', current_setting('test.tenant_id')::uuid, '22000000-0000-4000-8000-000000000052',
   '22000000-0000-4000-8000-000000000053', 'line', 'supply_only', 3, 'ZP22 ligne incluse', 'm', 1, 0, 2000, 1, 0, 1,
   '22000000-0000-4000-8000-000000000043', '22000000-0000-4000-8000-000000000023', 0, 0, 0, 0);

select is(
  (select count(*)::integer from public.products where tenant_id = current_setting('test.tenant_id')::uuid),
  4,
  'the fixture tenant holds exactly the four fixture articles'
);

select set_config('request.jwt.claim.sub', '22000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '22000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Catalogue page and summary --------------------------------------------------------------

select results_eq(
  $$select reference, best_supplier_price_cents, supplier_price_count::integer, price_status
    from public.catalogue_products_page(p_q => 'ZP22', p_sort => 'designation', p_dir => 'asc')
    order by reference$$,
  $$values ('ZP22-1'::text, 1240, 2, 'fresh'::text),
           ('ZP22-2'::text, null::integer, 1, 'none'::text),
           ('ZP22-3'::text, 0, 1, 'fresh'::text),
           ('ZP22-4'::text, null::integer, 0, 'none'::text)$$,
  'the catalogue page never retains an unmarked 0 € offer as the best price, retains a marked one, and keeps every offer in the count'
);

select results_eq(
  $$select active_count::integer, covered_count::integer, without_supplier_price_count::integer
    from public.catalogue_products_summary()$$,
  $$values (4, 2, 2)$$,
  'the catalogue summary counts an article whose only offer is an unmarked 0 € as without supplier price'
);

-- Purchase-order drafts -------------------------------------------------------------------

create temporary table zp22_purchase (case_name text primary key, outcome text) on commit drop;

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
      ('ML line, ml offer', '22000000-0000-4000-8000-000000000061'::uuid, '22000000-0000-4000-8000-000000000012'::uuid),
      ('unmarked 0 € offer', '22000000-0000-4000-8000-000000000062'::uuid, '22000000-0000-4000-8000-000000000011'::uuid),
      ('marked 0 € offer, m line', '22000000-0000-4000-8000-000000000063'::uuid, '22000000-0000-4000-8000-000000000013'::uuid)
    ) as cases(case_name, item_id, supplier_id)
  loop
    begin
      review := public.get_estimate_purchase_order_review('22000000-0000-4000-8000-000000000052', array[case_line.item_id]);
      select jsonb_agg(jsonb_build_object('item_id', l->'item_id', 'review_fingerprint', l->'review_fingerprint'))
        into reviewed from jsonb_array_elements(review->'lines') l;
      select jsonb_build_array(jsonb_build_object('supplier_id', case_line.supplier_id,
        'delivery_site_id', s.id, 'delivery_site_updated_at', s.updated_at,
        'item_ids', jsonb_build_array(case_line.item_id), 'expected_delivery_date', null, 'notes', 'ZP22'))
        into groups from public.delivery_sites s where s.id = '22000000-0000-4000-8000-000000000050';
      perform public.create_estimate_purchase_order_drafts('22000000-0000-4000-8000-000000000052',
        gen_random_uuid(), reviewed, groups);
      outcome := 'created';
    exception when others then
      outcome := sqlstate || ' ' || sqlerrm;
    end;
    insert into zp22_purchase values (case_line.case_name, outcome);
  end loop;
end
$purchase$;

select is(
  (select outcome from zp22_purchase where case_name = 'ML line, ml offer'),
  'created',
  'a line in ML linked to an offer in ml becomes a purchase-order draft'
);
select is(
  (select outcome from zp22_purchase where case_name = 'unmarked 0 € offer'),
  '40001 ORDER_DRAFT_PREPARATION_STALE',
  'a line linked to an unmarked 0 € offer is refused at purchase preparation'
);
select is(
  (select outcome from zp22_purchase where case_name = 'marked 0 € offer, m line'),
  'created',
  'a line in m linked to an offer at 0 € marked included becomes a purchase-order draft'
);

-- Reference price stays unchanged: every 0 € offer, marked or not, is excluded ---------------

select is(
  (select jsonb_build_array(proposal->'offer_count', proposal->'proposed_price_cents')
   from public.product_reference_price_proposal('22000000-0000-4000-8000-000000000021') proposal),
  '[1, 1240]'::jsonb,
  'the reference price of P1 averages only the 12,40 € offer'
);
select is(
  (select offer->>'exclusion'
   from public.product_reference_price_proposal('22000000-0000-4000-8000-000000000023') proposal,
     jsonb_array_elements(proposal->'offers') offer
   where offer->>'id' = '22000000-0000-4000-8000-000000000043'),
  'zero_price',
  'an offer at 0 € marked included stays out of the reference price'
);

select * from finish();
rollback;
