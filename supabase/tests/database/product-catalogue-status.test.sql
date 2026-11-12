-- TI-690 : état « brouillon / validé » des articles du catalogue.
--
-- Défaillances visées, écrites avant la migration :
--  1. un article créé par un chemin existant (import CSV, modèle, RPC d'offre) ne pose aucun état : il doit rester
--     « validé », sinon il disparaîtrait des suggestions de l'éditeur de devis ;
--  2. un brouillon incomplet (type, matériau, unité ou type de fourniture absent) devient « validé » ;
--  3. le client forge la date ou l'auteur de la validation, ou les conserve après un retour en brouillon ;
--  4. un article reçoit le type de fourniture d'un autre tenant ;
--  5. un état inconnu ou une note de fiabilité hors de 0 à 10 est enregistré ;
--  6. la page du catalogue ne sait pas isoler les brouillons, ni les trier par fiabilité (les mieux notés d'abord,
--     les non notés à la fin) ;
--  7. l'ancienne signature de la page reste appelable à côté de la nouvelle ;
--  8. la suppression du compte du validateur laisse l'article pointer vers un utilisateur disparu : la clé
--     étrangère efface l'auteur (ON DELETE SET NULL) et le déclencheur ne doit pas le rétablir ;
--  9. une unité vide passe la validation ;
-- 10. un type de fourniture est créé deux fois sous le même nom (casse, accents, ponctuation, pluriel, ou type
--     historique dont le code ne dérive pas du nom), par un non-administrateur, ou dans un autre tenant que le
--     tenant actif.

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
    '00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'catalogue-status-a@example.test',
    crypt('test-password', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'catalogue-status-b@example.test',
    crypt('test-password', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
  );

select set_config(
  'test.tenant_a',
  (select membership.tenant_id::text from public.tenant_memberships membership
    where membership.user_id = 'c5000000-0000-4000-8000-000000000001' limit 1),
  true
);
select set_config(
  'test.tenant_b',
  (select membership.tenant_id::text from public.tenant_memberships membership
    where membership.user_id = 'c5000000-0000-4000-8000-000000000002' limit 1),
  true
);

insert into public.supply_types (id, tenant_id, code, name)
values
  ('c5000000-0000-4000-8000-0000000000a1', current_setting('test.tenant_a')::uuid, 'c5_sup', 'Supportage C5'),
  ('c5000000-0000-4000-8000-0000000000b1', current_setting('test.tenant_b')::uuid, 'c5_sup', 'Supportage C5');

select set_config(
  'request.jwt.claims',
  '{"sub":"c5000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

-- 1. Chemin existant : aucun état posé.
insert into public.products (id, tenant_id, reference, designation, unit_price_cents)
values (
  'c5000000-0000-4000-8000-000000000010', current_setting('test.tenant_a')::uuid,
  'C5STAT-LEGACY', 'C5STAT article historique', 120
);

select is(
  (select product.catalogue_status from public.products product
    where product.id = 'c5000000-0000-4000-8000-000000000010'),
  'validated',
  'un article créé sans état reste validé'
);

-- 4. Dès la création, le type de fourniture d'un autre tenant est refusé.
select throws_ok(
  $$insert into public.products (tenant_id, reference, designation, unit_price_cents, supply_type_id)
    values (current_setting('test.tenant_a')::uuid, 'C5STAT-FOREIGN', 'C5STAT étranger', 0,
      'c5000000-0000-4000-8000-0000000000b1')$$,
  '23514',
  'PRODUCT_SUPPLY_TYPE_INVALID',
  'un article ne se crée pas avec le type de fourniture d''un autre tenant'
);

-- 3. À la création, la validation ne se déclare pas.
insert into public.products (
  id, tenant_id, reference, designation, unit_price_cents, catalogue_status,
  catalogue_validated_at, catalogue_validated_by
)
values (
  'c5000000-0000-4000-8000-000000000011', current_setting('test.tenant_a')::uuid,
  'C5STAT-DRAFT', 'C5STAT cheville', 0, 'draft',
  '2020-01-01T00:00:00Z', 'c5000000-0000-4000-8000-000000000002'
);

select is(
  (select (product.catalogue_validated_at is null and product.catalogue_validated_by is null)
    from public.products product where product.id = 'c5000000-0000-4000-8000-000000000011'),
  true,
  'la date et l''auteur de validation fournis à la création sont ignorés'
);

-- 2. Un brouillon incomplet ne se valide pas, et l'erreur nomme ce qui manque.
select throws_ok(
  $$update public.products set catalogue_status = 'validated'
    where id = 'c5000000-0000-4000-8000-000000000011'$$,
  '23514',
  'PRODUCT_VALIDATION_INCOMPLETE',
  'un brouillon sans type, matériau ni type de fourniture ne se valide pas'
);

update public.products
set product_type = 'Cheville mécanique', material = 'Supportage', dimensions = 'M10'
where id = 'c5000000-0000-4000-8000-000000000011';

select throws_ok(
  $$update public.products set catalogue_status = 'validated'
    where id = 'c5000000-0000-4000-8000-000000000011'$$,
  '23514',
  'PRODUCT_VALIDATION_INCOMPLETE',
  'le type de fourniture reste exigé une fois le type et le matériau renseignés'
);

-- 4. Le type de fourniture d'un autre tenant est refusé.
select throws_ok(
  $$update public.products set supply_type_id = 'c5000000-0000-4000-8000-0000000000b1'
    where id = 'c5000000-0000-4000-8000-000000000011'$$,
  '23514',
  'PRODUCT_SUPPLY_TYPE_INVALID',
  'le type de fourniture d''un autre tenant est refusé'
);

select lives_ok(
  $$update public.products
    set supply_type_id = 'c5000000-0000-4000-8000-0000000000a1', catalogue_status = 'validated',
        catalogue_validated_by = 'c5000000-0000-4000-8000-000000000002',
        catalogue_validated_at = '2020-01-01T00:00:00Z'
    where id = 'c5000000-0000-4000-8000-000000000011'$$,
  'un brouillon complet se valide'
);

select is(
  (select product.catalogue_validated_by from public.products product
    where product.id = 'c5000000-0000-4000-8000-000000000011'),
  'c5000000-0000-4000-8000-000000000001'::uuid,
  'l''auteur de la validation est l''utilisateur connecté, pas la valeur envoyée'
);

select ok(
  (select product.catalogue_validated_at > now() - interval '1 hour' from public.products product
    where product.id = 'c5000000-0000-4000-8000-000000000011'),
  'la date de validation est celle du serveur, pas la valeur envoyée'
);

-- 3. Une modification ordinaire ne déplace pas la validation.
update public.products
set designation = 'C5STAT cheville mécanique',
    catalogue_validated_by = 'c5000000-0000-4000-8000-000000000002'
where id = 'c5000000-0000-4000-8000-000000000011';

select is(
  (select product.catalogue_validated_by from public.products product
    where product.id = 'c5000000-0000-4000-8000-000000000011'),
  'c5000000-0000-4000-8000-000000000001'::uuid,
  'une modification ordinaire ne réécrit pas l''auteur de la validation'
);

-- 8. L'effacement de l'auteur par la clé étrangère (compte supprimé) n'est pas annulé.
update public.products set catalogue_validated_by = null
where id = 'c5000000-0000-4000-8000-000000000011';

select is(
  (select product.catalogue_validated_by from public.products product
    where product.id = 'c5000000-0000-4000-8000-000000000011'),
  null::uuid,
  'l''auteur effacé à la suppression de son compte reste effacé'
);

select ok(
  (select product.catalogue_validated_at is not null and product.catalogue_status = 'validated'
    from public.products product where product.id = 'c5000000-0000-4000-8000-000000000011'),
  'l''article reste validé, avec sa date, quand son auteur est effacé'
);

-- 3. Le retour en brouillon efface la validation.
update public.products set catalogue_status = 'draft'
where id = 'c5000000-0000-4000-8000-000000000011';

select is(
  (select (product.catalogue_validated_at is null and product.catalogue_validated_by is null)
    from public.products product where product.id = 'c5000000-0000-4000-8000-000000000011'),
  true,
  'le retour en brouillon efface la date et l''auteur de validation'
);

-- 9. Une unité vide bloque la validation, comme les autres champs exigés.
update public.products set unit = '   ' where id = 'c5000000-0000-4000-8000-000000000011';

select throws_ok(
  $$update public.products set catalogue_status = 'validated'
    where id = 'c5000000-0000-4000-8000-000000000011'$$,
  '23514',
  'PRODUCT_VALIDATION_INCOMPLETE',
  'un brouillon sans unité ne se valide pas'
);

update public.products set unit = 'u' where id = 'c5000000-0000-4000-8000-000000000011';

-- 5. États et notes hors domaine.
select throws_ok(
  $$update public.products set catalogue_status = 'approved'
    where id = 'c5000000-0000-4000-8000-000000000011'$$,
  '23514',
  null,
  'un état inconnu est refusé'
);

select throws_ok(
  $$update public.products set reliability_score = 11
    where id = 'c5000000-0000-4000-8000-000000000011'$$,
  '23514',
  null,
  'une note de fiabilité supérieure à 10 est refusée'
);

-- 6. La page du catalogue isole les brouillons et les trie par fiabilité.
insert into public.products (
  id, tenant_id, reference, designation, unit_price_cents, catalogue_status, reliability_score
)
values
  ('c5000000-0000-4000-8000-000000000012', current_setting('test.tenant_a')::uuid,
    'C5STAT-R9', 'C5STAT tige filetée', 0, 'draft', 9),
  ('c5000000-0000-4000-8000-000000000013', current_setting('test.tenant_a')::uuid,
    'C5STAT-R0', 'C5STAT rondelle', 0, 'draft', 0);

update public.products set reliability_score = null, supply_type_id = 'c5000000-0000-4000-8000-0000000000a1'
where id = 'c5000000-0000-4000-8000-000000000011';

select results_eq(
  $$select reference, catalogue_status, reliability_score::integer, supply_type_name
    from public.catalogue_products_page(
      p_q => 'C5STAT', p_catalogue_statuses => array['draft'], p_sort => 'reliability_score', p_dir => 'desc')$$,
  $$values ('C5STAT-R9'::text, 'draft'::text, 9, null::text),
           ('C5STAT-R0'::text, 'draft'::text, 0, null::text),
           ('C5STAT-DRAFT'::text, 'draft'::text, null::integer, 'Supportage C5'::text)$$,
  'les brouillons sortent seuls, les mieux notés d''abord, les non notés à la fin, avec leur type de fourniture'
);

select results_eq(
  $$select reference from public.catalogue_products_page(
      p_q => 'C5STAT', p_catalogue_statuses => array['validated'])$$,
  $$values ('C5STAT-LEGACY'::text)$$,
  'le filtre « validé » écarte les brouillons'
);

select is(
  (select count(*)::integer from public.catalogue_products_page(p_q => 'C5STAT')),
  4,
  'sans filtre d''état, brouillons et validés sont tous listés'
);

-- 7. Une seule signature.
select is(
  (select count(*)::integer from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public' and proc.proname = 'catalogue_products_page'),
  1,
  'la page du catalogue n''a qu''une signature'
);

select ok(
  not has_function_privilege('anon', 'public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer, text[])', 'execute'),
  'un visiteur anonyme ne peut pas appeler la page du catalogue'
);

select ok(
  has_function_privilege('authenticated', 'public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer, text[])', 'execute'),
  'un utilisateur connecté peut appeler la page du catalogue'
);

-- 10. Création d'un type de fourniture : administrateur, tenant actif, jamais deux fois le même nom.
insert into public.supply_types (tenant_id, code, name)
values (current_setting('test.tenant_a')::uuid, 'cat_5d41402abc4b2a76', 'Calorifuge C5');

select results_eq(
  $$select code, name from public.create_supply_type('  Tube inox C5 ')$$,
  $$values ('tube_inox_c5'::text, 'Tube inox C5'::text)$$,
  'le type est créé avec un code dérivé de son nom'
);

select is(
  (select supply_type.tenant_id from public.supply_types supply_type where supply_type.code = 'tube_inox_c5'),
  current_setting('test.tenant_a')::uuid,
  'le type est créé dans le tenant actif'
);

select throws_ok(
  $$select * from public.create_supply_type('TUBÉ-INOX c5.')$$,
  '23505', 'SUPPLY_TYPE_NAME_TAKEN',
  'un nom déjà pris à la casse, aux accents et à la ponctuation près est refusé'
);

select lives_ok(
  $$select * from public.create_supply_type('C5 raccord')$$,
  'un second type se crée'
);

select throws_ok(
  $$select * from public.create_supply_type('c5 Raccords')$$,
  '23505', 'SUPPLY_TYPE_NAME_TAKEN',
  'le pluriel d''un nom existant est refusé'
);

select throws_ok(
  $$select * from public.create_supply_type('calorifuge c5')$$,
  '23505', 'SUPPLY_TYPE_NAME_TAKEN',
  'le nom d''un type historique, dont le code ne dérive pas du nom, est refusé'
);

select throws_ok(
  $$select * from public.create_supply_type(' -- / ')$$,
  '22023', 'SUPPLY_TYPE_NAME_INVALID',
  'un nom sans lettre ni chiffre est refusé'
);

-- Le même nom reste libre dans un autre tenant.
select set_config(
  'request.jwt.claims',
  '{"sub":"c5000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  $$select * from public.create_supply_type('Tube inox C5')$$,
  'le même nom se crée dans un autre tenant'
);

-- Un membre non administrateur ne crée pas de type.
update public.tenant_memberships set role = 'engineer'
where user_id = 'c5000000-0000-4000-8000-000000000002';

select throws_ok(
  $$select * from public.create_supply_type('Robinetterie C5')$$,
  '42501', 'SUPPLY_TYPE_ADMIN_REQUIRED',
  'un ingénieur ne crée pas de type de fourniture'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$select * from public.create_supply_type('Robinetterie C5')$$,
  '42501', 'SUPPLY_TYPE_ADMIN_REQUIRED',
  'sans utilisateur connecté, aucun type n''est créé'
);

select ok(
  not has_function_privilege('anon', 'public.create_supply_type(text)', 'execute'),
  'un visiteur anonyme ne peut pas appeler la création d''un type de fourniture'
);

select * from finish();
rollback;
