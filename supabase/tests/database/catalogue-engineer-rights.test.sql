-- TI-689: catalogue rights depend on the company. An admin writes suppliers and items; an engineer adds some and
-- changes or deletes the ones they added; the admin decides, through public.set_tenant_catalogue_policy, whether
-- engineers also change the shared base. Validating a reference price stays an admin act.
--
-- Written red before the migration 20261111153500_catalogue_engineer_rights.sql. Failure modes:
--   C1 an engineer cannot add a supplier or an item, or a viewer can;
--   C2 the author of a row is chosen or rewritten by the caller;
--   C3 an engineer changes or deletes a row of the shared base while the setting is off, or cannot once it is on;
--   C4 the setting is written by someone other than an admin of the tenant, or reaches another tenant;
--   C5 an engineer changes a reference price without a validation, or validates one.
-- Every statement goes through pg_temp.ce_run (role and JWT subject switched in a sub-block), so a red assertion
-- fails on its own reason and the suite runs to the end. Fixtures rolled back at the end.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- ---------------------------------------------------------------------------
-- Identities: ...8000-00000000000N. 1 admin owner of tenant A, 2 and 3 engineers of tenant A, 4 viewer of tenant A,
-- 5 admin owner of tenant B. 2, 3 and 4 keep only their membership of tenant A, so it is their active tenant.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated', 'authenticated', fixture.email,
  crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (
  values
    ('ce689000-0000-4000-8000-000000000001'::uuid, 'catalogue-rights-admin-a@example.test'),
    ('ce689000-0000-4000-8000-000000000002'::uuid, 'catalogue-rights-engineer-a1@example.test'),
    ('ce689000-0000-4000-8000-000000000003'::uuid, 'catalogue-rights-engineer-a2@example.test'),
    ('ce689000-0000-4000-8000-000000000004'::uuid, 'catalogue-rights-viewer-a@example.test'),
    ('ce689000-0000-4000-8000-000000000005'::uuid, 'catalogue-rights-admin-b@example.test')
) as fixture(id, email);

create temporary table ce_fx (key text primary key, id uuid not null) on commit drop;
grant select on ce_fx to authenticated;

insert into ce_fx (key, id)
select case membership.user_id
    when 'ce689000-0000-4000-8000-000000000001' then 'tenant_a'
    else 'tenant_b'
  end,
  membership.tenant_id
from public.tenant_memberships membership
where membership.user_id in ('ce689000-0000-4000-8000-000000000001', 'ce689000-0000-4000-8000-000000000005')
  and membership.is_default
  and membership.role = 'admin';

insert into ce_fx (key, id) values
  ('admin_a', 'ce689000-0000-4000-8000-000000000001'),
  ('engineer_1', 'ce689000-0000-4000-8000-000000000002'),
  ('engineer_2', 'ce689000-0000-4000-8000-000000000003'),
  ('viewer', 'ce689000-0000-4000-8000-000000000004'),
  ('admin_b', 'ce689000-0000-4000-8000-000000000005');

create function pg_temp.fx(p_key text)
returns uuid
language sql
stable
as $$
  select id from ce_fx where key = p_key
$$;

select is(
  (select count(*)::integer from ce_fx where key in ('tenant_a', 'tenant_b')),
  2,
  'fixture: owners 1 and 5 each administer their own personal tenant'
);

delete from public.tenant_memberships
where user_id in (pg_temp.fx('engineer_1'), pg_temp.fx('engineer_2'), pg_temp.fx('viewer'));

insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
select fixture.id, pg_temp.fx('tenant_a'), pg_temp.fx(fixture.user_key), fixture.role, true
from (
  values
    ('ce689000-0000-4000-8000-000000000021'::uuid, 'engineer_1', 'engineer'::public.tenant_role),
    ('ce689000-0000-4000-8000-000000000031'::uuid, 'engineer_2', 'engineer'::public.tenant_role),
    ('ce689000-0000-4000-8000-000000000041'::uuid, 'viewer', 'viewer'::public.tenant_role)
) as fixture(id, user_key, role);

-- Runs one statement as a signed-in member. Returns « ok <rows> » or « <sqlstate> <message> ».
create function pg_temp.ce_run(p_user_key text, p_sql text)
returns text
language plpgsql
as $run$
declare
  run_result text;
  affected bigint;
  user_id uuid := pg_temp.fx(p_user_key);
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', user_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
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

-- The shared base: rows with no author (older than TI-689, or written by a server writer), in A and in B.
insert into public.suppliers (id, tenant_id, name) values
  ('ce689000-0000-4000-8000-0000000000a1', pg_temp.fx('tenant_a'), 'TI689 Fournisseur partagé A'),
  ('ce689000-0000-4000-8000-0000000000b1', pg_temp.fx('tenant_b'), 'TI689 Fournisseur partagé B');
insert into public.products (id, tenant_id, designation, unit, unit_price_cents) values
  ('ce689000-0000-4000-8000-0000000000a2', pg_temp.fx('tenant_a'), 'TI689 Article partagé A', 'u', 1000),
  ('ce689000-0000-4000-8000-0000000000a3', pg_temp.fx('tenant_a'), 'TI689 Article partagé A bis', 'u', 1000),
  ('ce689000-0000-4000-8000-0000000000b2', pg_temp.fx('tenant_b'), 'TI689 Article partagé B', 'u', 1000);

-- ---------------------------------------------------------------------------
-- Contract.
-- ---------------------------------------------------------------------------
select has_table('public', 'tenant_catalogue_policies', 'the catalogue policy table exists');
select has_column('public', 'suppliers', 'created_by', 'C2 a supplier records who added it');
select has_column('public', 'products', 'created_by', 'C2 an item records who added it');
select has_function(
  'public', 'set_tenant_catalogue_policy', array['uuid', 'boolean'],
  'C4 public.set_tenant_catalogue_policy(uuid, boolean) exists'
);
select has_function(
  'public', 'can_edit_catalogue_record', array['uuid', 'uuid'],
  'public.can_edit_catalogue_record(uuid, uuid) exists'
);
select is(
  (select array_agg(format('%s:%s', policy.tablename, policy.cmd) order by policy.tablename, policy.cmd)
   from pg_policies policy
   where policy.schemaname = 'public' and policy.tablename in ('suppliers', 'products')),
  array[
    'products:DELETE', 'products:INSERT', 'products:SELECT', 'products:UPDATE',
    'suppliers:DELETE', 'suppliers:INSERT', 'suppliers:SELECT', 'suppliers:UPDATE'
  ],
  'suppliers and items keep exactly one policy per command'
);
select is(
  (select array_agg(format('%s:%s', class.relname, class.relrowsecurity::text) order by class.relname)
   from pg_class class
   where class.oid = to_regclass('public.tenant_catalogue_policies')),
  array['tenant_catalogue_policies:true'],
  'the catalogue policy table has row level security'
);
select ok(
  not has_table_privilege('authenticated', 'public.tenant_catalogue_policies', 'INSERT')
    and not has_table_privilege('authenticated', 'public.tenant_catalogue_policies', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.tenant_catalogue_policies', 'DELETE')
    and not has_table_privilege('anon', 'public.tenant_catalogue_policies', 'SELECT'),
  'C4 members never write the catalogue policy table directly, anon never reads it'
);
select ok(
  not has_function_privilege('anon', 'public.set_tenant_catalogue_policy(uuid, boolean)', 'EXECUTE'),
  'C4 anon cannot call the setting writer'
);

-- ---------------------------------------------------------------------------
-- C1, C2: adding.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.ce_run('engineer_1', format(
    'insert into public.suppliers (id, name, created_by) values (%L, %L, %L)',
    'ce689000-0000-4000-8000-0000000000c1', 'TI689 Fournisseur ingénieur 1', pg_temp.fx('admin_a'))),
  'ok 1',
  'C1 an engineer adds a supplier'
);
select is(
  (select row(supplier.tenant_id, supplier.created_by)::text from public.suppliers supplier
   where supplier.id = 'ce689000-0000-4000-8000-0000000000c1'),
  row(pg_temp.fx('tenant_a'), pg_temp.fx('engineer_1'))::text,
  'C2 the supplier lands in the engineer''s tenant under their own name, whatever author was sent'
);
select is(
  pg_temp.ce_run('engineer_1', format(
    'insert into public.products (id, designation, unit, unit_price_cents) values (%L, %L, %L, 1500)',
    'ce689000-0000-4000-8000-0000000000c2', 'TI689 Article ingénieur 1', 'u')),
  'ok 1',
  'C1 an engineer adds an item with its first price'
);
select is(
  (select product.created_by from public.products product
   where product.id = 'ce689000-0000-4000-8000-0000000000c2'),
  pg_temp.fx('engineer_1'),
  'C2 the item records the engineer as its author'
);
select is(
  pg_temp.ce_run('admin_a', format(
    'insert into public.suppliers (id, name) values (%L, %L)',
    'ce689000-0000-4000-8000-0000000000d1', 'TI689 Fournisseur admin')),
  'ok 1',
  'an admin still adds a supplier'
);
select matches(
  pg_temp.ce_run('viewer', $$insert into public.suppliers (name) values ('TI689 Fournisseur lecteur')$$),
  '^42501 ',
  'C1 a viewer cannot add a supplier'
);
select matches(
  pg_temp.ce_run('viewer', $$insert into public.products (designation, unit) values ('TI689 Article lecteur', 'u')$$),
  '^42501 ',
  'C1 a viewer cannot add an item'
);
select matches(
  pg_temp.ce_run('engineer_1', format(
    'insert into public.suppliers (tenant_id, name) values (%L, %L)', pg_temp.fx('tenant_b'), 'TI689 Chez B')),
  '^42501 ',
  'C1 an engineer of A cannot add a supplier to tenant B'
);
select is(
  pg_temp.ce_run('engineer_1', 'select public.suggest_product_reference()'),
  'ok 1',
  'C1 the reference suggestion of the item form is open to an engineer'
);
select matches(
  pg_temp.ce_run('viewer', 'select public.suggest_product_reference()'),
  '^42501 ',
  'C1 the reference suggestion stays closed to a viewer'
);

-- ---------------------------------------------------------------------------
-- C3, setting off (no row): an engineer changes only what they added.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.ce_run('engineer_1', $$update public.suppliers set city = 'Lyon'
    where id = 'ce689000-0000-4000-8000-0000000000c1'$$),
  'ok 1',
  'C3 an engineer changes the supplier they added'
);
select is(
  pg_temp.ce_run('engineer_1', format(
    'update public.suppliers set created_by = %L where id = %L',
    pg_temp.fx('engineer_2'), 'ce689000-0000-4000-8000-0000000000c1')),
  'ok 1',
  'C2 an update that sends another author goes through'
);
select is(
  (select supplier.created_by from public.suppliers supplier
   where supplier.id = 'ce689000-0000-4000-8000-0000000000c1'),
  pg_temp.fx('engineer_1'),
  'C2 and leaves the author as it was'
);
select is(
  pg_temp.ce_run('engineer_1', $$update public.products set designation = 'TI689 Article ingénieur 1 renommé'
    where id = 'ce689000-0000-4000-8000-0000000000c2'$$),
  'ok 1',
  'C3 an engineer changes the item they added'
);
select is(
  pg_temp.ce_run('engineer_2', $$update public.suppliers set city = 'Paris'
    where id = 'ce689000-0000-4000-8000-0000000000c1'$$),
  'ok 0',
  'C3 another engineer does not change it while the setting is off'
);
select is(
  pg_temp.ce_run('engineer_1', $$update public.suppliers set city = 'Paris'
    where id in ('ce689000-0000-4000-8000-0000000000a1', 'ce689000-0000-4000-8000-0000000000d1')$$),
  'ok 0',
  'C3 an engineer changes neither a shared supplier nor the admin''s while the setting is off'
);
select is(
  pg_temp.ce_run('engineer_1', $$update public.products set designation = 'TI689 touché'
    where id = 'ce689000-0000-4000-8000-0000000000a2'$$),
  'ok 0',
  'C3 an engineer does not change a shared item while the setting is off'
);
select is(
  pg_temp.ce_run('engineer_1', $$delete from public.products where id = 'ce689000-0000-4000-8000-0000000000a2'$$),
  'ok 0',
  'C3 an engineer does not delete a shared item while the setting is off'
);
select is(
  pg_temp.ce_run('admin_a', $$update public.suppliers set city = 'Nantes'
    where id in ('ce689000-0000-4000-8000-0000000000a1', 'ce689000-0000-4000-8000-0000000000c1')$$),
  'ok 2',
  'an admin changes shared suppliers and the engineers'' ones'
);
select is(
  pg_temp.ce_run('viewer', $$update public.suppliers set city = 'Lille'
    where tenant_id = (select id from ce_fx where key = 'tenant_a')$$),
  'ok 0',
  'a viewer changes no supplier'
);

-- ---------------------------------------------------------------------------
-- C5: a reference price is never changed without the admin's validation.
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.ce_run('engineer_1', $$update public.products set unit_price_cents = 9900
    where id = 'ce689000-0000-4000-8000-0000000000c2'$$),
  '^P0001 REFERENCE_PRICE_VALIDATION_REQUIRED',
  'C5 an engineer cannot change the price of the item they added without a validation'
);
select matches(
  pg_temp.ce_run('engineer_1', $$select public.validate_product_reference_price(
    'ce689000-0000-4000-8000-0000000000c2'::uuid, 1, 'franco', 'x', 9900, 'TI689')$$),
  '^42501 ',
  'C5 an engineer cannot validate a reference price'
);

-- ---------------------------------------------------------------------------
-- C4: the setting.
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.ce_run('engineer_1', format(
    'select public.set_tenant_catalogue_policy(%L, true)', pg_temp.fx('tenant_a'))),
  '^42501 TENANT_CATALOGUE_POLICY_ADMIN_ONLY',
  'C4 an engineer cannot open the shared base to engineers'
);
select matches(
  pg_temp.ce_run('admin_b', format(
    'select public.set_tenant_catalogue_policy(%L, true)', pg_temp.fx('tenant_a'))),
  '^42501 TENANT_CATALOGUE_POLICY_ADMIN_ONLY',
  'C4 the admin of another tenant cannot either'
);
select matches(
  pg_temp.ce_run('admin_a', format(
    'insert into public.tenant_catalogue_policies (tenant_id, engineers_can_edit_shared) values (%L, true)',
    pg_temp.fx('tenant_a'))),
  '^42501 ',
  'C4 even an admin does not write the table directly'
);
select matches(
  pg_temp.ce_run('admin_a', format(
    'select public.set_tenant_catalogue_policy(%L, null)', pg_temp.fx('tenant_a'))),
  '^22023 TENANT_CATALOGUE_POLICY_REQUIRED',
  'C4 the setting needs a value'
);
select is(
  (select count(*)::integer from public.tenant_catalogue_policies
   where tenant_id in (pg_temp.fx('tenant_a'), pg_temp.fx('tenant_b'))),
  0,
  'C4 no refused call wrote a row'
);
select is(
  pg_temp.ce_run('admin_a', format(
    'select public.set_tenant_catalogue_policy(%L, true)', pg_temp.fx('tenant_a'))),
  'ok 1',
  'C4 the admin of tenant A opens the shared base to its engineers'
);
select is(
  (select row(policy.engineers_can_edit_shared, policy.updated_by)::text
   from public.tenant_catalogue_policies policy where policy.tenant_id = pg_temp.fx('tenant_a')),
  row(true, pg_temp.fx('admin_a'))::text,
  'C4 the setting is stored with its author'
);

-- ---------------------------------------------------------------------------
-- C3, setting on: engineers change the shared base of their tenant, and only theirs.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.ce_run('engineer_2', $$update public.suppliers set city = 'Paris'
    where id in ('ce689000-0000-4000-8000-0000000000a1', 'ce689000-0000-4000-8000-0000000000c1',
                 'ce689000-0000-4000-8000-0000000000d1')$$),
  'ok 3',
  'C3 once allowed, an engineer changes shared suppliers, a colleague''s and the admin''s'
);
select is(
  pg_temp.ce_run('engineer_1', $$update public.products set designation = 'TI689 touché'
    where id = 'ce689000-0000-4000-8000-0000000000a2'$$),
  'ok 1',
  'C3 once allowed, an engineer changes a shared item'
);
select matches(
  pg_temp.ce_run('engineer_1', $$update public.products set unit_price_cents = 9900
    where id = 'ce689000-0000-4000-8000-0000000000a2'$$),
  '^P0001 REFERENCE_PRICE_VALIDATION_REQUIRED',
  'C5 the setting does not open reference prices'
);
select is(
  pg_temp.ce_run('engineer_1', $$delete from public.products where id = 'ce689000-0000-4000-8000-0000000000a3'$$),
  'ok 1',
  'C3 once allowed, an engineer deletes a shared item'
);
select is(
  pg_temp.ce_run('viewer', $$update public.suppliers set city = 'Lille'
    where tenant_id = (select id from ce_fx where key = 'tenant_a')$$),
  'ok 0',
  'C3 the setting gives a viewer nothing'
);
select is(
  (select row(supplier.city)::text from public.suppliers supplier
   where supplier.id = 'ce689000-0000-4000-8000-0000000000b1'),
  row(null::text)::text,
  'C4 tenant B''s supplier was never reached'
);
select is(
  (select count(*)::integer from public.tenant_catalogue_policies where tenant_id = pg_temp.fx('tenant_b')),
  0,
  'C4 tenant B keeps no setting'
);

select is(
  pg_temp.ce_run('admin_a', format(
    'select public.set_tenant_catalogue_policy(%L, false)', pg_temp.fx('tenant_a'))),
  'ok 1',
  'C4 the admin closes the shared base again'
);
select is(
  pg_temp.ce_run('engineer_2', $$update public.suppliers set city = 'Brest'
    where id in ('ce689000-0000-4000-8000-0000000000a1', 'ce689000-0000-4000-8000-0000000000c1')$$),
  'ok 0',
  'C3 and engineers are back to what they added'
);
select is(
  pg_temp.ce_run('engineer_1', $$delete from public.suppliers where id = 'ce689000-0000-4000-8000-0000000000c1'$$),
  'ok 1',
  'C3 an engineer deletes the supplier they added'
);

select * from finish();
rollback;
