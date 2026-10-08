begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '9c000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'product-reference-case@example.test',
  crypt('test-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

select set_config(
  'test.tenant_id',
  (
    select membership.tenant_id::text
    from public.tenant_memberships membership
    where membership.user_id = '9c000000-0000-4000-8000-000000000001'
    limit 1
  ),
  true
);

insert into public.products (id, tenant_id, reference, designation, unit_price_cents)
values (
  '9c000000-0000-4000-8000-000000000010',
  current_setting('test.tenant_id')::uuid,
  '  Bou.M8.40 ',
  '  Boulon M8x40 ',
  120
);

select is(
  (
    select product.reference
    from public.products product
    where product.id = '9c000000-0000-4000-8000-000000000010'
  ),
  '  Bou.M8.40 ',
  'la reference saisie est conservee telle quelle'
);

select is(
  (
    select product.reference_normalized
    from public.products product
    where product.id = '9c000000-0000-4000-8000-000000000010'
  ),
  'bou.m8.40',
  'reference_normalized applique trim puis minuscules'
);

select is(
  (
    select product.designation
    from public.products product
    where product.id = '9c000000-0000-4000-8000-000000000010'
  ),
  '  Boulon M8x40 ',
  'la designation saisie est conservee telle quelle'
);

select is(
  (
    select product.designation_normalized
    from public.products product
    where product.id = '9c000000-0000-4000-8000-000000000010'
  ),
  'boulon m8x40',
  'designation_normalized applique trim puis minuscules'
);

select throws_ok(
  format(
    $insert$
      insert into public.products (tenant_id, reference, designation, unit_price_cents)
      values (%L, 'BOU.M8.40', 'Boulon M8x40 doublon', 130)
    $insert$,
    current_setting('test.tenant_id')
  ),
  '23505',
  null::text,
  'une reference qui ne differe que par la casse est refusee dans le meme tenant'
);

select throws_ok(
  format(
    $insert$
      insert into public.products (tenant_id, reference, designation, unit_price_cents)
      values (%L, 'bou.M8.40   ', 'Boulon M8x40 doublon espace', 130)
    $insert$,
    current_setting('test.tenant_id')
  ),
  '23505',
  null::text,
  'une reference qui ne differe que par les espaces de bord est refusee'
);

select lives_ok(
  format(
    $insert$
      insert into public.products (tenant_id, reference, designation, unit_price_cents)
      values
        (%1$L, null, 'Article sans reference A', 100),
        (%1$L, null, 'Article sans reference B', 100),
        (%1$L, '   ', 'Article a reference vide', 100)
    $insert$,
    current_setting('test.tenant_id')
  ),
  'les references absentes ou vides restent exemptees de l''unicite'
);

select ok(
  not exists (
    select 1
    from pg_class index_class
    join pg_namespace index_schema
      on index_schema.oid = index_class.relnamespace
    where index_schema.nspname = 'public'
      and index_class.relname = 'products_tenant_reference_key'
  ),
  'l''ancienne unicite sensible a la casse est supprimee'
);

select ok(
  exists (
    select 1
    from pg_index index_definition
    join pg_class index_class
      on index_class.oid = index_definition.indexrelid
    join pg_namespace index_schema
      on index_schema.oid = index_class.relnamespace
    where index_schema.nspname = 'public'
      and index_class.relname = 'products_tenant_reference_normalized_key'
      and index_definition.indisunique
  ),
  'l''unicite insensible a la casse est en place'
);

select ok(
  exists (
    select 1
    from pg_class index_class
    join pg_namespace index_schema
      on index_schema.oid = index_class.relnamespace
    where index_schema.nspname = 'public'
      and index_class.relname = 'products_tenant_designation_normalized_idx'
  ),
  'la designation normalisee est indexee pour le rapprochement a l''import'
);

select * from finish();
rollback;
