-- TI-690: public.assign_product_internal_reference() checks duplicate references through
-- products.reference_normalized (indexed) instead of reading the whole catalogue per row.
-- Failure modes: a reference that differs only by case or outer spaces is accepted; an article saving
-- another field conflicts with itself; a change to another article's reference is accepted; an article
-- without reference loses its ART- number; a multi-row insert with a repeated reference passes.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000', '9d000000-0000-4000-8000-000000000001', 'authenticated',
  'authenticated', 'product-reference-index@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);

select set_config(
  'test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '9d000000-0000-4000-8000-000000000001' limit 1),
  true
);

insert into public.products (id, tenant_id, reference, designation, unit_price_cents)
values
  ('9d000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid, 'Tub.X4so.20', 'Tube inventé', 100),
  ('9d000000-0000-4000-8000-000000000011', current_setting('test.tenant_id')::uuid, 'Cou.X4so.20', 'Coude inventé', 100);

select throws_ok(
  $$insert into public.products (tenant_id, reference, designation, unit_price_cents)
    values (current_setting('test.tenant_id')::uuid, '  TUB.x4SO.20 ', 'Doublon', 100)$$,
  '23505',
  'PRODUCT_REFERENCE_CONFLICT',
  'a reference that differs only by case and outer spaces is refused'
);

select lives_ok(
  $$update public.products set designation = 'Tube inventé renommé', reference = ' tub.x4so.20 '
    where id = '9d000000-0000-4000-8000-000000000010'$$,
  'an article keeps its own reference, written otherwise, when another field changes'
);

select throws_ok(
  $$update public.products set reference = 'COU.X4SO.20' where id = '9d000000-0000-4000-8000-000000000010'$$,
  '23505',
  'PRODUCT_REFERENCE_CONFLICT',
  'changing a reference to another article''s is refused'
);

insert into public.products (id, tenant_id, reference, designation, unit_price_cents)
values ('9d000000-0000-4000-8000-000000000012', current_setting('test.tenant_id')::uuid, '  ', 'Sans référence', 100);

select matches(
  (select reference from public.products where id = '9d000000-0000-4000-8000-000000000012'),
  '^ART-[0-9]{6,}$',
  'an article without reference still receives an ART- number'
);

select throws_ok(
  $$insert into public.products (tenant_id, reference, designation, unit_price_cents)
    values (current_setting('test.tenant_id')::uuid, 'Té.X.1', 'Té un', 100),
           (current_setting('test.tenant_id')::uuid, 'té.x.1', 'Té deux', 100)$$,
  '23505',
  null,
  'a multi-row insert repeating a reference is refused as a whole'
);

select is(
  (select count(*)::int from public.products where tenant_id = current_setting('test.tenant_id')::uuid
     and reference_normalized = 'té.x.1'),
  0,
  'nothing of the refused multi-row insert is kept'
);

-- 600 distinct references in one statement, as the workbook import writes them: all accepted.
insert into public.products (tenant_id, reference, designation, unit_price_cents)
select current_setting('test.tenant_id')::uuid, 'Imp.X.' || n, 'Article importé ' || n, 0
from generate_series(1, 600) n;

select is(
  (select count(*)::int from public.products where tenant_id = current_setting('test.tenant_id')::uuid
     and reference_normalized like 'imp.x.%'),
  600,
  'a statement of 600 distinct references is accepted'
);

select * from finish();
rollback;
