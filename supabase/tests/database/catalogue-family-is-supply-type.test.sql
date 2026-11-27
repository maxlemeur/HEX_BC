-- La famille d'un article est son type de fourniture (20261127120151).
--
-- Défaillances visées, écrites avant la migration :
--  1. la page du catalogue ne sait pas filtrer par famille (type de fourniture), ou le filtre laisse passer un
--     article d'une autre famille ou sans famille ;
--  2. chercher le nom d'une famille ne trouve pas ses articles quand leur désignation ne le dit pas ;
--  3. l'application déployée avant ce changement (p_categories, colonne « category ») cesse de fonctionner tant
--     que la colonne n'est pas supprimée ;
--  4. l'ancienne signature de la page reste appelable à côté de la nouvelle, ou la nouvelle s'ouvre aux anonymes ;
--  5. créer un article avec une offre fournisseur échoue (la fonction nommait products.tax_rate_bp, supprimée),
--     ne retient pas la famille choisie, ou écrit encore l'ancienne famille en texte libre ;
--  6. un article créé avec une offre reçoit la famille d'une autre entreprise.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'catalogue-family-a@example.test',
    crypt('test-password', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'catalogue-family-b@example.test',
    crypt('test-password', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  );

select set_config(
  'test.tenant_a',
  (select membership.tenant_id::text from public.tenant_memberships membership
    where membership.user_id = 'f1000000-0000-4000-8000-000000000001' limit 1),
  true
);
select set_config(
  'test.tenant_b',
  (select membership.tenant_id::text from public.tenant_memberships membership
    where membership.user_id = 'f1000000-0000-4000-8000-000000000002' limit 1),
  true
);

insert into public.supply_types (id, tenant_id, code, name)
values
  ('f1000000-0000-4000-8000-0000000000a1', current_setting('test.tenant_a')::uuid, 'f1_raccord', 'Raccorderie F1'),
  ('f1000000-0000-4000-8000-0000000000a2', current_setting('test.tenant_a')::uuid, 'f1_tube', 'Tuberie F1'),
  ('f1000000-0000-4000-8000-0000000000b1', current_setting('test.tenant_b')::uuid, 'f1_raccord', 'Raccorderie F1');

select set_config(
  'request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

insert into public.products (id, tenant_id, reference, designation, unit_price_cents, supply_type_id, category)
values
  ('f1000000-0000-4000-8000-000000000011', current_setting('test.tenant_a')::uuid,
    'F1FAM-COUDE', 'F1FAM coude 90', 100, 'f1000000-0000-4000-8000-0000000000a1', 'Ancienne famille F1'),
  ('f1000000-0000-4000-8000-000000000012', current_setting('test.tenant_a')::uuid,
    'F1FAM-TUBE', 'F1FAM barre 6 m', 200, 'f1000000-0000-4000-8000-0000000000a2', null),
  ('f1000000-0000-4000-8000-000000000013', current_setting('test.tenant_a')::uuid,
    'F1FAM-SANS', 'F1FAM article sans famille', 300, null, null);

-- 1. Filtre par famille.
select results_eq(
  $$select reference, supply_type_name from public.catalogue_products_page(
      p_q => 'F1FAM', p_supply_type_ids => array['f1000000-0000-4000-8000-0000000000a1'::uuid])$$,
  $$values ('F1FAM-COUDE'::text, 'Raccorderie F1'::text)$$,
  'le filtre par famille ne garde que les articles de cette famille'
);

select results_eq(
  $$select reference from public.catalogue_products_page(
      p_q => 'F1FAM',
      p_supply_type_ids => array['f1000000-0000-4000-8000-0000000000a1'::uuid, 'f1000000-0000-4000-8000-0000000000a2'::uuid])$$,
  $$values ('F1FAM-TUBE'::text), ('F1FAM-COUDE'::text)$$,
  'plusieurs familles se cumulent, et un article sans famille est écarté'
);

select is(
  (select count(*)::integer from public.catalogue_products_page(p_q => 'F1FAM')),
  3,
  'sans filtre de famille, tous les articles sont listés'
);

-- 2. Recherche par le nom de la famille.
select results_eq(
  $$select reference from public.catalogue_products_page(p_q => 'tuberie f1')$$,
  $$values ('F1FAM-TUBE'::text)$$,
  'le nom de la famille trouve ses articles, sans la casse, quand leur désignation ne le dit pas'
);

-- 3. L'application d'avant ce changement fonctionne encore.
select results_eq(
  $$select reference, category from public.catalogue_products_page(
      p_q => 'F1FAM', p_categories => array['Ancienne famille F1'])$$,
  $$values ('F1FAM-COUDE'::text, 'Ancienne famille F1'::text)$$,
  'l''ancien filtre en texte libre et sa colonne restent servis jusqu''à la suppression de la colonne'
);

-- 4. Une seule signature, fermée aux anonymes.
select is(
  (select count(*)::integer from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public' and proc.proname = 'catalogue_products_page'),
  1,
  'la page du catalogue n''a qu''une signature'
);

select ok(
  not has_function_privilege('anon', 'public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer, text[], uuid[])', 'execute'),
  'un visiteur anonyme ne peut pas appeler la page du catalogue'
);

select ok(
  has_function_privilege('authenticated', 'public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer, text[], uuid[])', 'execute'),
  'un utilisateur connecté peut appeler la page du catalogue'
);

-- 5. Article créé avec une offre fournisseur : il prend la famille choisie.
select lives_ok(
  $$select public.create_supplier_catalog_price('{
      "new_supplier": {"name": "Fournisseur F1FAM"},
      "new_product": {
        "reference": "F1FAM-OFFRE", "designation": "F1FAM manchon", "product_type": "Manchon", "material": "Inox",
        "unit": "u", "supply_type_id": "f1000000-0000-4000-8000-0000000000a1", "category": "Texte libre ignoré"
      },
      "supplier_sku": "F1-SKU-1",
      "price": {"unit_price_cents": 450}
    }'::jsonb)$$,
  'un article se crée avec son offre fournisseur'
);

select results_eq(
  $$select supply_type_id, category, product_type, unit from public.products where reference = 'F1FAM-OFFRE'$$,
  $$values ('f1000000-0000-4000-8000-0000000000a1'::uuid, null::text, 'Manchon'::text, 'u'::text)$$,
  'il porte la famille choisie, et plus aucune famille en texte libre'
);

select lives_ok(
  $$select public.create_supplier_catalog_price('{
      "new_supplier": {"name": "Fournisseur F1FAM bis"},
      "new_product": {"reference": "F1FAM-OFFRE-SANS", "designation": "F1FAM article sans famille choisie"},
      "supplier_sku": "F1-SKU-2",
      "price": {"unit_price_cents": 100}
    }'::jsonb)$$,
  'la famille reste facultative à la création'
);

select is(
  (select supply_type_id from public.products where reference = 'F1FAM-OFFRE-SANS'),
  null::uuid,
  'sans famille choisie, l''article n''en a pas'
);

-- 6. La famille d'une autre entreprise est refusée, et rien n'est créé.
select throws_ok(
  $$select public.create_supplier_catalog_price('{
      "new_supplier": {"name": "Fournisseur F1FAM ter"},
      "new_product": {
        "reference": "F1FAM-ETRANGER", "designation": "F1FAM article étranger",
        "supply_type_id": "f1000000-0000-4000-8000-0000000000b1"
      },
      "supplier_sku": "F1-SKU-3",
      "price": {"unit_price_cents": 100}
    }'::jsonb)$$,
  '23514',
  'PRODUCT_SUPPLY_TYPE_INVALID',
  'un article ne se crée pas avec la famille d''une autre entreprise'
);

select is(
  (select count(*)::integer from public.suppliers where name = 'Fournisseur F1FAM ter'),
  0,
  'le refus n''a laissé ni fournisseur ni article'
);

select * from finish();
rollback;
