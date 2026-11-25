-- TI-711: the costing workbook import as a batch the office reviews in bulk and can undo.
--
-- Covers the migration 20261125210441_workbook_import_batches_aliases_bulk_review.sql (written with it, not seen red
-- first). Failure modes:
--   A  a supplier alias is added by a viewer, names two suppliers in a tenant, reaches another tenant, or changes;
--   B  a batch is opened by a viewer, in another tenant, or written directly;
--   P  an article is stamped with a batch its author did not start, of another tenant or kind, or already undone,
--      or its stamp changes afterwards;
--   R  the batch import of references loses the checks of public.import_workbook_supplier_references, stores an
--      unusable address, writes part of a refused batch, or the old function stops working;
--   V  a bulk review reaches a reference the caller may not review, another tenant's, or one already reviewed;
--      a validation loses the reference or activates a reference of an archived article or supplier; a withdrawal
--      keeps the unverified reference or the article's preferred supplier;
--   D  a draft is validated by someone other than an admin, or incomplete, or the count is wrong;
--   S  a supply type of another tenant is assigned, or an article the caller may not edit is changed;
--   U  an undo deletes an article or a reference somebody used, keeps an untouched one, loses its place between
--      two pages, is run by someone else, or leaves a batch open to new articles.
-- Every statement goes through pg_temp.wi_run or pg_temp.wi_json (role and JWT subject switched in a sub-block), so
-- a red assertion fails on its own reason and the suite runs to the end. The last section is a volume probe: it
-- asserts the work done and reports durations as diagnostics, never as an assertion. Fixtures rolled back.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- ---------------------------------------------------------------------------
-- Identities: ...8000-00000000000N. 1 admin owner of tenant A, 2 and 3 engineers of tenant A, 4 viewer of tenant A,
-- 5 admin owner of tenant B. 2, 3 and 4 keep only their membership of tenant A, so it is their active tenant.
-- ---------------------------------------------------------------------------
create function pg_temp.u(p_suffix text)
returns uuid
language sql
immutable
as $$
  select ('a7110000-0000-4000-8000-' || lpad(p_suffix, 12, '0'))::uuid
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', pg_temp.u(fixture.suffix), 'authenticated', 'authenticated', fixture.email,
  crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (
  values
    ('1', 'workbook-import-admin-a@example.test'),
    ('2', 'workbook-import-engineer-a1@example.test'),
    ('3', 'workbook-import-engineer-a2@example.test'),
    ('4', 'workbook-import-viewer-a@example.test'),
    ('5', 'workbook-import-admin-b@example.test')
) as fixture(suffix, email);

create temporary table wi_fx (key text primary key, id uuid not null) on commit drop;
create temporary table wi_out (key text primary key, value jsonb) on commit drop;
create temporary table wi_probe (position serial, label text, ms numeric, outcome jsonb) on commit drop;

insert into wi_fx (key, id)
select case membership.user_id when pg_temp.u('1') then 'tenant_a' else 'tenant_b' end, membership.tenant_id
from public.tenant_memberships membership
where membership.user_id in (pg_temp.u('1'), pg_temp.u('5'))
  and membership.is_default
  and membership.role = 'admin';

insert into wi_fx (key, id) values
  ('admin_a', pg_temp.u('1')),
  ('engineer_1', pg_temp.u('2')),
  ('engineer_2', pg_temp.u('3')),
  ('viewer', pg_temp.u('4')),
  ('admin_b', pg_temp.u('5'));

create function pg_temp.fx(p_key text)
returns uuid
language sql
stable
as $$
  select id from wi_fx where key = p_key
$$;

select is(
  (select count(*)::integer from wi_fx where key in ('tenant_a', 'tenant_b')),
  2,
  'fixture: owners 1 and 5 each administer their own personal tenant'
);

delete from public.tenant_memberships
where user_id in (pg_temp.fx('engineer_1'), pg_temp.fx('engineer_2'), pg_temp.fx('viewer'));

insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
select pg_temp.u(fixture.suffix), pg_temp.fx('tenant_a'), pg_temp.fx(fixture.user_key), fixture.role, true
from (
  values
    ('21', 'engineer_1', 'engineer'::public.tenant_role),
    ('31', 'engineer_2', 'engineer'::public.tenant_role),
    ('41', 'viewer', 'viewer'::public.tenant_role)
) as fixture(suffix, user_key, role);

-- Runs one statement as a signed-in member. Returns « ok <rows> » or « <sqlstate> <message> ».
create function pg_temp.wi_run(p_user_key text, p_sql text)
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

-- Runs one query as a signed-in member and returns its jsonb value, or {"error": "<sqlstate> <message>"}.
create function pg_temp.wi_json(p_user_key text, p_sql text)
returns jsonb
language plpgsql
as $run$
declare
  run_result jsonb;
  user_id uuid := pg_temp.fx(p_user_key);
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', user_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
    execute p_sql into run_result;
  exception when others then
    run_result := jsonb_build_object('error', sqlstate || ' ' || sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- Volume probe: runs one query as a signed-in member without a sub-block and records its duration when it has a
-- label. No sub-block on purpose: a subtransaction would own the row locks of its statement, and the next
-- statement's locks on the same rows would be recorded as shared between two transactions (one multixact per
-- row), which no call of the application does. A failing statement therefore stops the file.
create function pg_temp.wi_probe_json(p_label text, p_user_key text, p_sql text)
returns jsonb
language plpgsql
as $probe$
declare
  user_id uuid := pg_temp.fx(p_user_key);
  started_at timestamptz;
  elapsed_ms numeric;
  outcome jsonb;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  started_at := clock_timestamp();
  execute p_sql into outcome;
  elapsed_ms := round(extract(epoch from clock_timestamp() - started_at) * 1000);
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  if p_label is not null then
    insert into wi_probe (label, ms, outcome) values (p_label, elapsed_ms, outcome);
  end if;
  return outcome;
end;
$probe$;

-- One row of a workbook, as the application sends it: the reference and the name it read.
create function pg_temp.wi_row(p_product uuid, p_supplier uuid, p_sku text, p_url text default null)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'product_id', product.id, 'product_reference', product.reference,
    'supplier_id', supplier.id, 'supplier_name', supplier.name, 'supplier_sku', p_sku
  ) || case when p_url is null then '{}'::jsonb else jsonb_build_object('product_url', p_url) end
  from public.products product cross join public.suppliers supplier
  where product.id = p_product and supplier.id = p_supplier
$$;

create function pg_temp.wi_import_sql(p_tenant_key text, p_rows jsonb, p_source text default null)
returns text
language sql
stable
as $$
  select format('select public.import_workbook_supplier_reference_batch(%L, %L::jsonb, %L)',
    pg_temp.fx(p_tenant_key), p_rows, p_source)
$$;

create function pg_temp.wi_review_sql(p_ids uuid[], p_validate boolean)
returns text
language sql
immutable
as $$
  select format('select public.review_supplier_references(%L::uuid[], %L)', p_ids, p_validate)
$$;

create function pg_temp.wi_undo_sql(p_batch uuid, p_limit integer)
returns text
language sql
immutable
as $$
  select format('select public.undo_catalogue_import_batch(%L, %L)', p_batch, p_limit)
$$;

create function pg_temp.wi_start_sql(p_tenant_key text, p_source text default null)
returns text
language sql
stable
as $$
  select format('select to_jsonb(public.start_workbook_article_import(%L, %L))', pg_temp.fx(p_tenant_key), p_source)
$$;

create function pg_temp.item(p_product_suffix text, p_supplier_suffix text)
returns uuid
language sql
stable
as $$
  select item.id from public.supplier_catalog_items item
  where item.product_id = pg_temp.u(p_product_suffix) and item.supplier_id = pg_temp.u(p_supplier_suffix)
$$;

-- (reference, address, active, pending) of a supplier reference.
create function pg_temp.item_state(p_product_suffix text, p_supplier_suffix text)
returns text
language sql
stable
as $$
  select row(item.supplier_sku, item.product_url, item.is_active, item.reference_needs_review)::text
  from public.supplier_catalog_items item
  where item.product_id = pg_temp.u(p_product_suffix) and item.supplier_id = pg_temp.u(p_supplier_suffix)
$$;

-- The shared base: rows with no author, in A and in B.
insert into public.suppliers (id, tenant_id, name) values
  (pg_temp.u('a1'), pg_temp.fx('tenant_a'), 'TI711 Aciers du Rhône'),
  (pg_temp.u('a2'), pg_temp.fx('tenant_a'), 'TI711 Visserie Bravo'),
  (pg_temp.u('a3'), pg_temp.fx('tenant_a'), 'TI711 Négoce Charlie'),
  (pg_temp.u('b1'), pg_temp.fx('tenant_b'), 'TI711 Fournisseur B');
insert into public.supply_types (id, tenant_id, code, name) values
  (pg_temp.u('d1'), pg_temp.fx('tenant_a'), 'TI711_TUBE', 'TI711 Tube'),
  (pg_temp.u('d2'), pg_temp.fx('tenant_a'), 'TI711_RACCORD', 'TI711 Raccord'),
  (pg_temp.u('d9'), pg_temp.fx('tenant_b'), 'TI711_B', 'TI711 Type B');
insert into public.products (id, tenant_id, reference, designation, unit, unit_price_cents) values
  (pg_temp.u('101'), pg_temp.fx('tenant_a'), 'TI711-PARTAGE', 'TI711 Article partagé A', 'u', 1000),
  (pg_temp.u('b01'), pg_temp.fx('tenant_b'), 'TI711-B01', 'TI711 Article partagé B', 'u', 1000);
insert into public.products (
  id, tenant_id, reference, designation, unit, unit_price_cents, catalogue_status, product_type, material,
  supply_type_id
) values (
  pg_temp.u('b02'), pg_temp.fx('tenant_b'), 'TI711-B02', 'TI711 Brouillon complet B', 'm', 0, 'draft', 'Tube',
  'Inox 316L', pg_temp.u('d9')
);
-- An established reference of the shared article: never pending.
insert into public.supplier_catalog_items (id, tenant_id, supplier_id, product_id, supplier_sku, is_active) values
  (pg_temp.u('601'), pg_temp.fx('tenant_a'), pg_temp.u('a2'), pg_temp.u('101'), 'ETABLI-101', true);

-- Articles the engineers added themselves (no batch).
select is(
  pg_temp.wi_run('engineer_1', format($sql$
    insert into public.products (id, reference, designation, unit, unit_price_cents) values
      (%L, 'TI711-E1A', 'TI711 Tube inox 33,7', 'm', 0),
      (%L, 'TI711-E1B', 'TI711 Coude inox 90°', 'u', 0),
      (%L, 'TI711-E1C', 'TI711 Bride plate DN25', 'u', 0),
      (%L, 'TI711-E1D', 'TI711 Vanne à boule DN25', 'u', 0),
      (%L, 'TI711-E1E', 'TI711 Réduction 33,7/21,3', 'u', 0)
  $sql$, pg_temp.u('111'), pg_temp.u('112'), pg_temp.u('113'), pg_temp.u('114'), pg_temp.u('115'))),
  'ok 5',
  'fixture: engineer 1 adds five articles'
);
select is(
  pg_temp.wi_run('engineer_2', format($sql$
    insert into public.products (id, reference, designation, unit, unit_price_cents)
    values (%L, 'TI711-E2A', 'TI711 Té égal inox', 'u', 0)
  $sql$, pg_temp.u('121'))),
  'ok 1',
  'fixture: engineer 2 adds one article'
);

-- ---------------------------------------------------------------------------
-- Contract.
-- ---------------------------------------------------------------------------
select has_table('public', 'supplier_aliases', 'A the supplier alias table exists');
select has_table('public', 'catalogue_import_batches', 'B the import batch table exists');
select has_column('public', 'products', 'import_batch_id', 'P an article records the batch that created it');
select has_column('public', 'supplier_catalog_items', 'import_batch_id', 'R a supplier reference records its batch');
select ok(
  (select relation.relrowsecurity and relation.relforcerowsecurity from pg_class relation
   where relation.oid = 'public.supplier_aliases'::regclass),
  'A supplier_aliases has forced row level security'
);
select ok(
  (select relation.relrowsecurity from pg_class relation
   where relation.oid = 'public.catalogue_import_batches'::regclass),
  'B catalogue_import_batches has row level security'
);
select is(
  (select array_agg(format('%s:%s', policy.tablename, policy.cmd) order by policy.tablename, policy.cmd)
   from pg_policies policy
   where policy.schemaname = 'public' and policy.tablename in ('supplier_aliases', 'catalogue_import_batches')),
  array['catalogue_import_batches:SELECT', 'supplier_aliases:DELETE', 'supplier_aliases:INSERT',
    'supplier_aliases:SELECT'],
  'A, B the two tables carry exactly these policies'
);
select ok(
  has_table_privilege('authenticated', 'public.supplier_aliases', 'SELECT')
    and has_table_privilege('authenticated', 'public.supplier_aliases', 'INSERT')
    and has_table_privilege('authenticated', 'public.supplier_aliases', 'DELETE')
    and not has_table_privilege('authenticated', 'public.supplier_aliases', 'UPDATE')
    and not has_table_privilege('anon', 'public.supplier_aliases', 'SELECT'),
  'A members read, add and delete aliases, never change them; anon reads nothing'
);
select ok(
  has_table_privilege('authenticated', 'public.catalogue_import_batches', 'SELECT')
    and not has_table_privilege('authenticated', 'public.catalogue_import_batches', 'INSERT')
    and not has_table_privilege('authenticated', 'public.catalogue_import_batches', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.catalogue_import_batches', 'DELETE')
    and not has_table_privilege('anon', 'public.catalogue_import_batches', 'SELECT'),
  'B members only read batches; anon reads nothing'
);
select ok(
  not has_table_privilege('authenticated', 'public.supplier_catalog_items', 'INSERT')
    and not has_table_privilege('authenticated', 'public.supplier_catalog_items', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.supplier_catalog_items', 'DELETE'),
  'V, U members still write supplier references through the functions only'
);

with expected(signature, definer) as (
  values
    ('public.start_workbook_article_import(uuid,text)', true),
    ('public.import_workbook_supplier_reference_batch(uuid,jsonb,text)', true),
    ('public.review_supplier_references(uuid[],boolean)', true),
    ('public.validate_draft_products(uuid[])', false),
    ('public.assign_products_supply_type(uuid[],uuid)', false),
    ('public.undo_catalogue_import_batch(uuid,integer)', true),
    ('public.save_supplier_catalog_item(uuid,uuid,text,text,boolean)', true)
)
select ok(
  procedure.oid is not null
    and procedure.prosecdef = expected.definer
    and exists (
      select 1 from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
      where setting in ('search_path=""', 'search_path=')
    )
    and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    and not exists (
      select 1
      from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as grant_entry
      where grant_entry.grantee = 0
    )
    and obj_description(procedure.oid, 'pg_proc') is not null,
  format('%s: %s, empty search_path, authenticated only, commented',
    expected.signature, case when expected.definer then 'security definer' else 'security invoker' end)
)
from expected
left join pg_proc procedure on procedure.oid = to_regprocedure(expected.signature);

select is(
  (select return_type.typname::text from pg_proc procedure
   join pg_type return_type on return_type.oid = procedure.prorettype
   where procedure.oid = 'public.import_workbook_supplier_references(uuid,jsonb)'::regprocedure),
  'int4',
  'R the function the deployed application calls keeps its signature and its integer result'
);

with expected(index_name, definition_fragment) as (
  values
    ('products_import_batch_idx', '(import_batch_id, id) WHERE (import_batch_id IS NOT NULL)'),
    ('supplier_catalog_items_import_batch_idx', '(import_batch_id, id) WHERE (import_batch_id IS NOT NULL)'),
    ('supplier_catalog_items_review_queue_idx', '(tenant_id, created_at DESC) WHERE reference_needs_review'),
    ('catalogue_import_batches_tenant_created_idx', '(tenant_id, created_at DESC)'),
    ('estimate_items_product_id_idx', '(product_id) WHERE (product_id IS NOT NULL)'),
    ('product_reference_price_validations_product_id_idx', '(product_id)'),
    ('product_reference_price_withdrawals_product_id_idx', '(product_id)')
)
select ok(
  position(expected.definition_fragment in coalesce(index_definition.indexdef, '')) > 0,
  format('index %s exists as %s [definition=%s]', expected.index_name, expected.definition_fragment,
    index_definition.indexdef)
)
from expected
left join pg_indexes index_definition
  on index_definition.schemaname = 'public' and index_definition.indexname = expected.index_name;

-- Deleting an article, a reference or a batch looks its id up in every table that references it, and the new
-- tables are looked up when a tenant, a supplier or a member goes: each of those foreign keys has an index
-- that starts with one of its columns (whole, or partial on that column being present).
select is(
  (select coalesce(string_agg(format('%s.%s', con.conrelid::regclass, con.conname), ', '
     order by con.conrelid::regclass::text, con.conname), '')
   from pg_constraint con
   where con.contype = 'f'
     and (
       con.confrelid in ('public.products'::regclass, 'public.supplier_catalog_items'::regclass,
         'public.catalogue_import_batches'::regclass)
       or con.conrelid in ('public.supplier_aliases'::regclass, 'public.catalogue_import_batches'::regclass)
     )
     and not exists (
       select 1
       from pg_index idx
       join pg_attribute leading_column
         on leading_column.attrelid = idx.indrelid and leading_column.attnum = idx.indkey[0]
       where idx.indrelid = con.conrelid
         and idx.indisvalid
         and idx.indkey[0] = any(con.conkey)
         and (
           idx.indpred is null
           or pg_get_expr(idx.indpred, idx.indrelid) = format('(%I IS NOT NULL)', leading_column.attname)
         )
     )),
  '',
  'U every foreign key to an article, a reference or a batch, and every one of the new tables, is indexed'
);
select is(
  (select string_agg(trigger_definition.tgname::text, ', ' order by trigger_definition.tgname)
   from pg_trigger trigger_definition
   where trigger_definition.tgrelid = 'public.products'::regclass
     and not trigger_definition.tgisinternal
     and trigger_definition.tgname like 'validate_product_import_batch%'
     and trigger_definition.tgname > 'set_products_tenant_id'),
  'validate_product_import_batch_insert, validate_product_import_batch_update',
  'P the batch of an article is checked after its tenant is assigned'
);

-- ---------------------------------------------------------------------------
-- A: supplier aliases.
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.wi_run('viewer', format(
    'insert into public.supplier_aliases (supplier_id, alias, alias_key) values (%L, %L, %L)',
    pg_temp.u('a1'), 'Aciers Rhone', 'aciers rhone')),
  '^42501 ',
  'A a viewer cannot add a supplier alias'
);
select is(
  pg_temp.wi_run('engineer_1', format(
    'insert into public.supplier_aliases (id, tenant_id, supplier_id, alias, alias_key, created_by)
     values (%L, %L, %L, %L, %L, %L)',
    pg_temp.u('701'), pg_temp.fx('tenant_b'), pg_temp.u('a1'), '  ACIERS DU RHONE SAS ', 'aciers du rhone sas',
    pg_temp.fx('admin_a'))),
  'ok 1',
  'A an engineer adds a supplier alias'
);
select is(
  (select row(alias.tenant_id, alias.created_by, alias.alias)::text from public.supplier_aliases alias
   where alias.id = pg_temp.u('701')),
  row(pg_temp.fx('tenant_a'), pg_temp.fx('engineer_1'), 'ACIERS DU RHONE SAS')::text,
  'A the alias lands in the supplier''s tenant under the engineer''s name, trimmed, whatever was sent'
);
select matches(
  pg_temp.wi_run('admin_a', format(
    'insert into public.supplier_aliases (supplier_id, alias, alias_key) values (%L, %L, %L)',
    pg_temp.u('a2'), 'Aciers du Rhône S.A.S.', 'aciers du rhone sas')),
  '^23505 ',
  'A the same alias key cannot name a second supplier of the tenant'
);
select matches(
  pg_temp.wi_run('engineer_1', format(
    'insert into public.supplier_aliases (supplier_id, alias, alias_key) values (%L, %L, %L)',
    pg_temp.u('b1'), 'Chez B', 'chez b')),
  '^23514 SUPPLIER_ALIAS_TENANT_MISMATCH',
  'A a supplier of another tenant is refused'
);
select matches(
  pg_temp.wi_run('engineer_1', format(
    'insert into public.supplier_aliases (supplier_id, alias, alias_key) values (%L, %L, %L)',
    pg_temp.u('a2'), 'Visserie', key.value)),
  '^23514 ',
  format('A the alias key %L is refused (not lowercase, not trimmed or empty)', key.value)
)
from (values ('Visserie Bravo'), (' visserie bravo'), ('')) as key(value);
select matches(
  pg_temp.wi_run('engineer_1', format(
    'insert into public.supplier_aliases (supplier_id, alias, alias_key) values (%L, %L, %L)',
    pg_temp.u('a2'), '   ', 'visserie bravo')),
  '^23514 ',
  'A a blank alias is refused'
);
select is(
  pg_temp.wi_json('admin_b', format(
    'select to_jsonb(count(*)) from public.supplier_aliases where tenant_id = %L', pg_temp.fx('tenant_a'))),
  to_jsonb(0),
  'A another tenant does not read the alias'
);
select is(
  pg_temp.wi_run('admin_b', format('delete from public.supplier_aliases where id = %L', pg_temp.u('701'))),
  'ok 0',
  'A nor delete it'
);
select is(
  pg_temp.wi_run('admin_b', format(
    'insert into public.supplier_aliases (id, supplier_id, alias, alias_key) values (%L, %L, %L, %L)',
    pg_temp.u('702'), pg_temp.u('b1'), 'Aciers du Rhône SAS', 'aciers du rhone sas')),
  'ok 1',
  'A the key is taken per tenant: tenant B gives it to its own supplier'
);
select is(
  (select array_agg(alias.supplier_id order by alias.tenant_id = pg_temp.fx('tenant_a') desc)
   from public.supplier_aliases alias where alias.alias_key = 'aciers du rhone sas'),
  array[pg_temp.u('a1'), pg_temp.u('b1')],
  'A and each tenant keeps its own supplier under that key'
);
select matches(
  pg_temp.wi_run('engineer_1', format(
    'update public.supplier_aliases set alias = %L where id = %L', 'Aciers', pg_temp.u('701'))),
  '^42501 ',
  'A an alias is never changed'
);
select is(
  pg_temp.wi_run('engineer_2', format('delete from public.supplier_aliases where id = %L', pg_temp.u('701'))),
  'ok 0',
  'A another engineer does not delete it'
);
select is(
  pg_temp.wi_run('engineer_1', format('delete from public.supplier_aliases where id = %L', pg_temp.u('701'))),
  'ok 1',
  'A its author deletes it'
);
select is(
  pg_temp.wi_run('engineer_1', format(
    'insert into public.supplier_aliases (id, supplier_id, alias, alias_key) values (%L, %L, %L, %L)',
    pg_temp.u('703'), pg_temp.u('a1'), 'Aciers du Rhône', 'aciers du rhone')),
  'ok 1',
  'A the engineer adds another one'
);
select is(
  pg_temp.wi_run('admin_a', format('delete from public.supplier_aliases where id = %L', pg_temp.u('703'))),
  'ok 1',
  'A an admin deletes an alias they did not add'
);

-- ---------------------------------------------------------------------------
-- B: opening a batch of articles.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.wi_json('viewer', pg_temp.wi_start_sql('tenant_a', 'Base.xlsx')) ->> 'error',
  '42501 CATALOGUE_IMPORT_EDITORS_ONLY',
  'B a viewer cannot open a batch'
);
insert into wi_fx (key, id)
select 'batch_e1', (pg_temp.wi_json('engineer_1',
  pg_temp.wi_start_sql('tenant_a', '  Base chiffrage 2026.xlsx  ')) #>> '{}')::uuid;
select is(
  (select row(batch.tenant_id, batch.kind, batch.source_name, batch.created_by, batch.undone_at, batch.undone_by)::text
   from public.catalogue_import_batches batch where batch.id = pg_temp.fx('batch_e1')),
  row(pg_temp.fx('tenant_a'), 'workbook_articles', 'Base chiffrage 2026.xlsx', pg_temp.fx('engineer_1'),
    null::timestamptz, null::uuid)::text,
  'B an engineer gets a batch of articles of the active tenant, under their name, its source name trimmed'
);
insert into wi_fx (key, id)
select 'batch_admin', (pg_temp.wi_json('admin_a', pg_temp.wi_start_sql('tenant_a', repeat('x', 300))) #>> '{}')::uuid;
insert into wi_fx (key, id)
select 'batch_unnamed', (pg_temp.wi_json('admin_a', pg_temp.wi_start_sql('tenant_a', '   ')) #>> '{}')::uuid;
select is(
  (select array_agg(char_length(batch.source_name) order by batch.id = pg_temp.fx('batch_admin') desc)
   from public.catalogue_import_batches batch
   where batch.id in (pg_temp.fx('batch_admin'), pg_temp.fx('batch_unnamed'))),
  array[255, null]::integer[],
  'B a long source name is cut to 255 characters, a blank one is not stored'
);
select is(
  pg_temp.wi_json('viewer', format(
    'select to_jsonb(count(*)) from public.catalogue_import_batches where tenant_id = %L', pg_temp.fx('tenant_a'))),
  to_jsonb(3),
  'B a member of the tenant reads its batches'
);
select is(
  pg_temp.wi_json('admin_b', format(
    'select to_jsonb(count(*)) from public.catalogue_import_batches where tenant_id = %L', pg_temp.fx('tenant_a'))),
  to_jsonb(0),
  'B another tenant does not'
);
select matches(
  pg_temp.wi_run('admin_a', format(
    'insert into public.catalogue_import_batches (tenant_id, kind) values (%L, %L)',
    pg_temp.fx('tenant_a'), 'workbook_articles')),
  '^42501 ',
  'B even an admin does not write the batch table directly'
);
select matches(
  pg_temp.wi_run('admin_a', format(
    'update public.catalogue_import_batches set undone_at = now() where id = %L', pg_temp.fx('batch_e1'))),
  '^42501 ',
  'B nor marks a batch as undone by hand'
);

insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
values (pg_temp.u('22'), pg_temp.fx('tenant_b'), pg_temp.fx('engineer_1'), 'engineer', false);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_start_sql('tenant_b', 'Nom de fichier confidentiel fictif.xlsx')) ->> 'error',
  '42501 CATALOGUE_IMPORT_EDITORS_ONLY',
  'B a member editing both tenants cannot open an import planned for a tenant other than the active one'
);
select is(
  (select count(*)::integer from public.catalogue_import_batches
   where source_name = 'Nom de fichier confidentiel fictif.xlsx'),
  0, 'B the mismatched opening stores neither the batch nor its filename'
);

-- The member switches to tenant B after opening their batch in A. Both memberships allow inserts.
update public.tenant_memberships set is_default = false where id = pg_temp.u('21');
update public.tenant_memberships set is_default = true where id = pg_temp.u('22');
select is(pg_temp.wi_json('engineer_1', 'select to_jsonb(public.current_tenant_id())'), to_jsonb(pg_temp.fx('tenant_b')),
  'fixture: tenant B is now active');
select is(
  pg_temp.wi_run('engineer_1', format($sql$
    insert into public.products (id, tenant_id, reference, designation, unit, unit_price_cents, catalogue_status, import_batch_id)
    values (%L, %L, 'TI711-EXPLICIT', 'Article fictif', 'u', 0, 'draft', %L)
  $sql$, pg_temp.u('199'), pg_temp.fx('tenant_a'), pg_temp.fx('batch_e1'))), '42501 Tenant access denied.',
  'P a chunk naming the planned tenant is refused by the active-tenant guard after a switch'
);
select is((select count(*)::integer from public.products where id = pg_temp.u('199')), 0,
  'P the refused chunk writes nothing in either tenant');
select matches(
  pg_temp.wi_run('engineer_1', format($sql$
    insert into public.products (tenant_id, reference, designation, unit, unit_price_cents, catalogue_status, import_batch_id)
    values (%L, 'TI711-TENANT-REFUSED', 'Article fictif refusé', 'u', 0, 'draft', %L)
  $sql$, pg_temp.fx('tenant_b'), pg_temp.fx('batch_e1'))),
  '^23503 .*products_import_batch_fkey',
  'P the composite foreign key rejects a tenant B article stamped with the tenant A batch'
);
select is((select count(*)::integer from public.products where reference = 'TI711-TENANT-REFUSED'), 0,
  'P the refused insert creates no draft');
delete from public.tenant_memberships where id = pg_temp.u('22');
update public.tenant_memberships set is_default = true where id = pg_temp.u('21');

-- Two batches no article may be stamped with, written as the server.
insert into public.catalogue_import_batches (id, tenant_id, kind, created_by, undo_started_at, undone_at, undone_by) values
  (pg_temp.u('901'), pg_temp.fx('tenant_a'), 'workbook_supplier_references', pg_temp.fx('engineer_1'), null, null, null),
  (pg_temp.u('902'), pg_temp.fx('tenant_a'), 'workbook_articles', pg_temp.fx('engineer_1'), now(), now(),
    pg_temp.fx('engineer_1'));

-- ---------------------------------------------------------------------------
-- P: stamping articles with a batch.
-- 201 complete draft, 202 draft without supply type, 203 complete archived draft, 204 validated, 205 draft with a
-- blank material, 206 and 207 drafts, 208 draft created from a material request.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.wi_run('engineer_1', format($sql$
    insert into public.products (
      id, reference, designation, unit, unit_price_cents, catalogue_status, product_type, material,
      supply_type_id, is_active, created_from_material_request, import_batch_id, tenant_id
    )
    select ('a7110000-0000-4000-8000-000000000' || draft.suffix)::uuid, 'TI711-L' || draft.suffix,
      'TI711 Article importé ' || draft.suffix, draft.unit, 0, draft.status, draft.product_type, draft.material,
      draft.supply_type_id, draft.is_active, draft.from_request, %1$L::uuid, %3$L::uuid
    from (
      values
        ('201', 'm', 'draft', 'Tube', 'Inox 316L', %2$L::uuid, true, false),
        ('202', 'u', 'draft', 'Coude', 'Inox 316L', null, true, false),
        ('203', 'm', 'draft', 'Tube', 'Inox 304L', %2$L::uuid, false, false),
        ('204', 'u', 'validated', null, null, null, true, false),
        ('205', 'u', 'draft', 'Bride', '   ', %2$L::uuid, true, false),
        ('206', 'u', 'draft', null, null, null, true, false),
        ('207', 'u', 'draft', null, null, null, true, false),
        ('208', 'u', 'draft', null, null, null, true, true)
    ) as draft(suffix, unit, status, product_type, material, supply_type_id, is_active, from_request)
  $sql$, pg_temp.fx('batch_e1'), pg_temp.u('d1'), pg_temp.fx('tenant_a'))),
  'ok 8',
  'P the author of a batch inserts a chunk of articles stamped with it'
);
select is(
  (select count(*)::integer from public.products product
   where product.import_batch_id = pg_temp.fx('batch_e1') and product.created_by = pg_temp.fx('engineer_1')),
  8,
  'P the eight articles carry the batch and their author'
);
select matches(
  pg_temp.wi_run(attempt.user_key, format(
    'insert into public.products (reference, designation, unit, unit_price_cents, catalogue_status, import_batch_id)
     values (%L, %L, %L, 0, %L, %L)',
    'TI711-REFUS-' || attempt.label, 'TI711 Article refusé', 'u', 'draft', attempt.batch_id)),
  '^23514 PRODUCT_IMPORT_BATCH_INVALID',
  format('P an article stamped with %s is refused', attempt.label)
)
from (
  values
    ('engineer_2', 'another engineer''s batch', pg_temp.fx('batch_e1')),
    ('admin_a', 'a batch the admin did not start', pg_temp.fx('batch_e1')),
    ('admin_b', 'another tenant''s batch', pg_temp.fx('batch_e1')),
    ('engineer_1', 'a batch of supplier references', pg_temp.u('901')),
    ('engineer_1', 'an undone batch', pg_temp.u('902')),
    ('engineer_1', 'a batch that does not exist', pg_temp.u('999'))
) as attempt(user_key, label, batch_id);
select is(
  (select count(*)::integer from public.products product where product.reference like 'TI711-REFUS-%'),
  0,
  'P no refused insert left an article'
);
select matches(
  pg_temp.wi_run('engineer_1', format(
    'update public.products set import_batch_id = %s where id = %L', change.new_value, pg_temp.u('206'))),
  '^23514 PRODUCT_IMPORT_BATCH_INVALID',
  format('P the author cannot change the batch of an article to %s', change.new_value)
)
from (values ('null'), (quote_literal(pg_temp.u('902')))) as change(new_value);
select matches(
  pg_temp.wi_run('admin_a', format(
    'update public.products set import_batch_id = %L where id = %L', pg_temp.fx('batch_admin'), pg_temp.u('101'))),
  '^23514 PRODUCT_IMPORT_BATCH_INVALID',
  'P nor can an admin stamp an existing article with their own batch'
);
select is(
  pg_temp.wi_run('engineer_1', format(
    'update public.products set designation = %L where id = %L', 'TI711 Article importé 206 bis', pg_temp.u('206'))),
  'ok 1',
  'P the author still changes the other fields of a stamped article'
);
select lives_ok(
  format('update public.products set import_batch_id = null where id = %L', pg_temp.u('206')),
  'P a server writer without a user may clear the batch'
);
select lives_ok(
  format('update public.products set import_batch_id = %L where id = %L', pg_temp.fx('batch_e1'), pg_temp.u('206')),
  'P and set it back'
);

-- ---------------------------------------------------------------------------
-- R: supplier references of a workbook, as a batch.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.wi_json('viewer', pg_temp.wi_import_sql('tenant_a',
    jsonb_build_array(pg_temp.wi_row(pg_temp.u('111'), pg_temp.u('a1'), '00042')))) ->> 'error',
  '42501 WORKBOOK_SUPPLIER_REFERENCES_EDITORS_ONLY',
  'R a viewer cannot import supplier references'
);
insert into wi_out (key, value)
select 'refs_e1', pg_temp.wi_json('engineer_1', pg_temp.wi_import_sql('tenant_a', jsonb_build_array(
  pg_temp.wi_row(pg_temp.u('111'), pg_temp.u('a1'), ' 00042 ', '  https://exemple.test/tube-337  '),
  pg_temp.wi_row(pg_temp.u('112'), pg_temp.u('a1'), 'REF-112'),
  pg_temp.wi_row(pg_temp.u('115'), pg_temp.u('a2'), 'REF-115', '   '),
  pg_temp.wi_row(pg_temp.u('114'), pg_temp.u('a3'), 'REF-114')
), '  Base références.xlsx '));
select is(
  (select value - 'batch_id' from wi_out where key = 'refs_e1'),
  '{"imported": 4}'::jsonb,
  'R an engineer imports four references of their own articles'
);
select is(
  (select row(batch.tenant_id, batch.kind, batch.source_name, batch.created_by, batch.undone_at)::text
   from public.catalogue_import_batches batch
   where batch.id = (select (value ->> 'batch_id')::uuid from wi_out where key = 'refs_e1')),
  row(pg_temp.fx('tenant_a'), 'workbook_supplier_references', 'Base références.xlsx', pg_temp.fx('engineer_1'),
    null::timestamptz)::text,
  'R the import answers with the batch it created'
);
select is(
  (select row(item.supplier_sku, item.product_url, item.is_active, item.reference_needs_review, item.created_by,
     item.import_batch_id)::text
   from public.supplier_catalog_items item where item.id = pg_temp.item('111', 'a1')),
  row('00042', 'https://exemple.test/tube-337', false, true, pg_temp.fx('engineer_1'),
    (select (value ->> 'batch_id')::uuid from wi_out where key = 'refs_e1'))::text,
  'R the reference keeps its leading zeros and its address, is pending, inactive, attributed and stamped'
);
select is(
  (select row(count(*), count(item.product_url))::text from public.supplier_catalog_items item
   where item.import_batch_id = (select (value ->> 'batch_id')::uuid from wi_out where key = 'refs_e1')),
  '(4,1)',
  'R the four references carry the batch; a blank address is not stored'
);

select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_import_sql('tenant_a', jsonb_build_array(
    pg_temp.wi_row(pg_temp.u('113'), pg_temp.u('a1'), 'REF-113-A', 'https://exemple.test/bride'),
    pg_temp.wi_row(pg_temp.u('113'), pg_temp.u('a2'), 'REF-113-B', address.value)
  ))) ->> 'error',
  '22023 WORKBOOK_SUPPLIER_REFERENCES_INVALID',
  format('R one unusable address refuses the whole batch (%s)', address.label)
)
from (
  values
    ('not http', 'ftp://exemple.test/bride'),
    ('a space inside', 'https://exemple.test/bride plate'),
    ('over 2 000 characters', 'https://exemple.test/' || repeat('a', 2000))
) as address(label, value);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_import_sql('tenant_a', jsonb_build_array(
    pg_temp.wi_row(pg_temp.u('113'), pg_temp.u('a1'), 'REF-113-A'),
    jsonb_set(pg_temp.wi_row(pg_temp.u('113'), pg_temp.u('a2'), 'REF-113-B'), '{product_reference}',
      '"TI711-RENOMME"')
  ))) ->> 'error',
  'P0001 WORKBOOK_SUPPLIER_REFERENCES_CHANGED',
  'R a row whose article changed since the workbook was read refuses the batch'
);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_import_sql('tenant_a', jsonb_build_array(
    pg_temp.wi_row(pg_temp.u('113'), pg_temp.u('a1'), 'REF-113-A'),
    jsonb_set(pg_temp.wi_row(pg_temp.u('113'), pg_temp.u('a2'), 'REF-113-B'), '{supplier_name}',
      '"TI711 Visserie Bravo SARL"')
  ))) ->> 'error',
  'P0001 WORKBOOK_SUPPLIER_REFERENCES_CHANGED',
  'R so does a row whose supplier was renamed'
);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_import_sql('tenant_a', jsonb_build_array(attempt.row_value))) ->> 'error',
  'P0001 WORKBOOK_SUPPLIER_REFERENCES_CHANGED',
  format('R %s', attempt.label)
)
from (
  values
    ('an engineer cannot attach a reference to a colleague''s article',
      pg_temp.wi_row(pg_temp.u('121'), pg_temp.u('a1'), 'REF-121')),
    ('a supplier of another tenant cannot be attached',
      pg_temp.wi_row(pg_temp.u('113'), pg_temp.u('b1'), 'REF-113-X')),
    ('a pair that already exists is not overwritten',
      pg_temp.wi_row(pg_temp.u('111'), pg_temp.u('a1'), 'REF-111-BIS'))
) as attempt(label, row_value);
select is(
  pg_temp.wi_json('admin_a', pg_temp.wi_import_sql('tenant_b', jsonb_build_array(
    pg_temp.wi_row(pg_temp.u('b01'), pg_temp.u('b1'), 'REF-B01')))) ->> 'error',
  '42501 WORKBOOK_SUPPLIER_REFERENCES_EDITORS_ONLY',
  'R a tenant that is not the active one is refused'
);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_import_sql('tenant_a', payload.value)) ->> 'error',
  '22023 WORKBOOK_SUPPLIER_REFERENCES_INVALID',
  format('R %s is not a batch', payload.label)
)
from (values ('an empty list', '[]'::jsonb), ('an object', '{}'::jsonb)) as payload(label, value);
select is(
  (select row(
     (select count(*) from public.supplier_catalog_items item where item.product_id = pg_temp.u('113')),
     (select count(*) from public.catalogue_import_batches batch
      where batch.tenant_id = pg_temp.fx('tenant_a') and batch.kind = 'workbook_supplier_references')
   )::text),
  '(0,2)',
  'R no refused batch wrote a reference or a batch row (the two batches are the fixture and the first import)'
);

select is(
  pg_temp.wi_json('engineer_1', format(
    'select to_jsonb(public.import_workbook_supplier_references(%L, %L::jsonb))', pg_temp.fx('tenant_a'),
    jsonb_build_array(pg_temp.wi_row(pg_temp.u('113'), pg_temp.u('a2'), 'ANCIEN-113')))),
  to_jsonb(1),
  'R the function the deployed application calls still imports'
);
select is(
  (select row(item.supplier_sku, item.is_active, item.reference_needs_review, item.import_batch_id)::text
   from public.supplier_catalog_items item where item.id = pg_temp.item('113', 'a2')),
  '(ANCIEN-113,f,t,)',
  'R and its reference is pending, without a batch'
);

insert into wi_out (key, value)
select 'refs_admin', pg_temp.wi_json('admin_a', pg_temp.wi_import_sql('tenant_a', jsonb_build_array(
  pg_temp.wi_row(pg_temp.u('101'), pg_temp.u('a1'), 'ADM-101', 'https://exemple.test/partage'),
  pg_temp.wi_row(pg_temp.u('121'), pg_temp.u('a2'), 'ADM-121')
)));
insert into wi_out (key, value)
select 'refs_b', pg_temp.wi_json('admin_b', pg_temp.wi_import_sql('tenant_b', jsonb_build_array(
  pg_temp.wi_row(pg_temp.u('b01'), pg_temp.u('b1'), 'B-01'))));
select is(
  (select array_agg(value ->> 'imported' order by key) from wi_out where key in ('refs_admin', 'refs_b')),
  array['2', '1'],
  'R an admin imports references of shared and engineers'' articles; tenant B imports its own'
);

-- ---------------------------------------------------------------------------
-- V: reviewing pending references in bulk. Shared catalogue edits are closed (no policy row).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.wi_json('viewer', pg_temp.wi_review_sql(array[pg_temp.item('111', 'a1')], true)) ->> 'error',
  '42501 SUPPLIER_CATALOG_ITEM_EDITORS_ONLY',
  'V a viewer cannot review a reference'
);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_review_sql(attempt.ids, attempt.decision)) ->> 'error',
  '22023 SUPPLIER_REFERENCE_REVIEW_INVALID',
  format('V a review %s is refused', attempt.label)
)
from (
  values
    ('without a decision', array[pg_temp.item('111', 'a1')], null::boolean),
    ('of no reference', array[]::uuid[], true),
    ('of a missing id', array[pg_temp.item('111', 'a1'), null], true),
    ('of 5 001 references', array(select gen_random_uuid() from generate_series(1, 5001)), true)
) as attempt(label, ids, decision);
select is(
  pg_temp.wi_json('engineer_1', 'select public.review_supplier_references(null, true)') ->> 'error',
  '22023 SUPPLIER_REFERENCE_REVIEW_INVALID',
  'V a review without a list is refused'
);
select matches(
  pg_temp.wi_run('engineer_1', format(
    'select public.create_supplier_catalog_price(%L::jsonb)',
    jsonb_build_object('product_id', pg_temp.u('111'), 'supplier_id', pg_temp.u('a1'),
      'price', jsonb_build_object('unit_price_cents', 1900)))),
  '^23514 .*supplier_catalog_item_pending_reference_check',
  'V a pending reference receives no price'
);

insert into wi_out (key, value)
select 'ctid_' || item.id, to_jsonb(item.ctid::text)
from public.supplier_catalog_items item
where item.id in (pg_temp.u('601'), pg_temp.item('b01', 'b1'), pg_temp.item('101', 'a1'), pg_temp.item('121', 'a2'));

select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_review_sql(array[
    pg_temp.item('111', 'a1'), pg_temp.item('111', 'a1'), pg_temp.item('101', 'a1'), pg_temp.item('121', 'a2'),
    pg_temp.item('b01', 'b1'), pg_temp.u('601'), pg_temp.u('999')
  ], true)),
  '{"reviewed": 1, "skipped": 5}'::jsonb,
  'V an engineer validates the reference of their own article; a shared article, a colleague''s, another tenant''s, an established reference and an unknown id are skipped, a repeated id counted once'
);
select is(
  pg_temp.item_state('111', 'a1'),
  '(00042,https://exemple.test/tube-337,t,f)',
  'V the validated reference is active, reviewed, and keeps its reference and its address'
);
select is(
  (select count(*)::integer from public.supplier_catalog_items item
   join wi_out saved on saved.key = 'ctid_' || item.id and saved.value = to_jsonb(item.ctid::text)),
  4,
  'V none of the skipped references was written'
);
select is(
  array[pg_temp.item_state('101', 'a1'), pg_temp.item_state('121', 'a2'), pg_temp.item_state('b01', 'b1'),
    pg_temp.item_state('101', 'a2')],
  array['(ADM-101,https://exemple.test/partage,f,t)', '(ADM-121,,f,t)', '(B-01,,f,t)', '(ETABLI-101,,t,f)'],
  'V and each is as it was'
);
select is(
  pg_temp.wi_run('engineer_1', format(
    'select public.create_supplier_catalog_price(%L::jsonb)',
    jsonb_build_object('product_id', pg_temp.u('111'), 'supplier_id', pg_temp.u('a1'),
      'price', jsonb_build_object('unit_price_cents', 1900)))),
  'ok 1',
  'V once validated, the reference receives a price'
);

-- Withdrawing. Article 111 prefers supplier a1 (its validated reference) and gets a second, pending reference at
-- a2. Article 112 prefers a1 while its reference there is pending: a state only the server can write (the
-- preference requires an active reference), built here to prove the withdrawal clears it.
select is(
  pg_temp.wi_run('engineer_1', format(
    'update public.products set preferred_supplier_id = %L where id = %L', pg_temp.u('a1'), pg_temp.u('111'))),
  'ok 1',
  'fixture: article 111 prefers the supplier of its validated reference'
);
update public.supplier_catalog_items set is_active = true, reference_needs_review = false
where id = pg_temp.item('112', 'a1');
update public.products set preferred_supplier_id = pg_temp.u('a1') where id = pg_temp.u('112');
update public.supplier_catalog_items set is_active = false, reference_needs_review = true
where id = pg_temp.item('112', 'a1');
insert into wi_out (key, value)
select 'refs_e1b', pg_temp.wi_json('engineer_1', pg_temp.wi_import_sql('tenant_a', jsonb_build_array(
  pg_temp.wi_row(pg_temp.u('111'), pg_temp.u('a2'), 'REF-111-B', 'https://exemple.test/tube-bravo'))));
select is(
  array[pg_temp.item_state('112', 'a1'), pg_temp.item_state('111', 'a2')],
  array['(REF-112,,f,t)', '(REF-111-B,https://exemple.test/tube-bravo,f,t)'],
  'fixture: two pending references to withdraw'
);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_review_sql(
    array[pg_temp.item('112', 'a1'), pg_temp.item('111', 'a2')], false)),
  '{"reviewed": 2, "skipped": 0}'::jsonb,
  'V an engineer withdraws two pending references'
);
select is(
  array[pg_temp.item_state('112', 'a1'), pg_temp.item_state('111', 'a2')],
  array['(,,f,f)', '(,,f,f)'],
  'V a withdrawn reference is inactive, reviewed, and its unverified reference and address are discarded'
);
select is(
  (select array_agg(product.preferred_supplier_id order by product.id) from public.products product
   where product.id in (pg_temp.u('111'), pg_temp.u('112'))),
  array[pg_temp.u('a1'), null]::uuid[],
  'V the withdrawal clears the preferred supplier that was withdrawn, and only that one'
);

-- An archived article, a deactivated supplier.
select is(
  pg_temp.wi_run('engineer_1', format(
    'update public.products set is_active = false where id = %L', pg_temp.u('115'))),
  'ok 1',
  'fixture: article 115 is archived'
);
update public.suppliers set is_active = false where id = pg_temp.u('a3');
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_review_sql(
    array[pg_temp.item('115', 'a2'), pg_temp.item('114', 'a3')], true)),
  '{"reviewed": 0, "skipped": 2}'::jsonb,
  'V a reference of an archived article or of a deactivated supplier is not validated'
);
select is(
  array[pg_temp.item_state('115', 'a2'), pg_temp.item_state('114', 'a3')],
  array['(REF-115,,f,t)', '(REF-114,,f,t)'],
  'V both stay pending'
);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_review_sql(array[pg_temp.item('115', 'a2')], false)),
  '{"reviewed": 1, "skipped": 0}'::jsonb,
  'V but the reference of an archived article can be withdrawn'
);

select is(
  pg_temp.wi_json('admin_a', pg_temp.wi_review_sql(
    array[pg_temp.item('101', 'a1'), pg_temp.item('121', 'a2'), pg_temp.item('b01', 'b1')], true)),
  '{"reviewed": 2, "skipped": 1}'::jsonb,
  'V an admin validates references of shared and engineers'' articles, never another tenant''s'
);
select is(
  pg_temp.wi_json('admin_a', pg_temp.wi_review_sql(array[pg_temp.item('101', 'a1')], false)),
  '{"reviewed": 0, "skipped": 1}'::jsonb,
  'V a reference already reviewed is not reviewed again'
);
select is(
  array[pg_temp.item_state('101', 'a1'), pg_temp.item_state('b01', 'b1')],
  array['(ADM-101,https://exemple.test/partage,t,f)', '(B-01,,f,t)'],
  'V the validated reference stays validated; tenant B''s is still pending'
);

select is(
  pg_temp.wi_json('engineer_2', pg_temp.wi_review_sql(array[pg_temp.item('113', 'a2')], true)),
  '{"reviewed": 0, "skipped": 1}'::jsonb,
  'V an engineer does not review a colleague''s article while the shared base is closed'
);
select is(
  pg_temp.wi_run('admin_a', format('select public.set_tenant_catalogue_policy(%L, true)', pg_temp.fx('tenant_a'))),
  'ok 1',
  'fixture: the admin opens the shared base to engineers'
);
select is(
  pg_temp.wi_json('engineer_2', pg_temp.wi_review_sql(array[pg_temp.item('113', 'a2')], true)),
  '{"reviewed": 1, "skipped": 0}'::jsonb,
  'V once allowed, the engineer validates it (a reference of the old import, without a batch)'
);
select is(
  pg_temp.wi_run('admin_a', format('select public.set_tenant_catalogue_policy(%L, false)', pg_temp.fx('tenant_a'))),
  'ok 1',
  'fixture: the admin closes the shared base again'
);

-- ---------------------------------------------------------------------------
-- D: validating drafts in bulk.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.wi_json(attempt.user_key, format('select public.validate_draft_products(%L::uuid[])',
    array[pg_temp.u('201')])) ->> 'error',
  '42501 PRODUCT_VALIDATION_ADMIN_ONLY',
  format('D %s cannot validate drafts', attempt.label)
)
from (values ('engineer_1', 'an engineer, even their author'), ('viewer', 'a viewer')) as attempt(user_key, label);
select is(
  pg_temp.wi_json('admin_a', format('select public.validate_draft_products(%L::uuid[])', attempt.ids)) ->> 'error',
  '22023 PRODUCT_BULK_INVALID',
  format('D a validation %s is refused', attempt.label)
)
from (
  values
    ('of no article', array[]::uuid[]),
    ('of a missing id', array[pg_temp.u('201'), null]),
    ('of 5 001 articles', array(select gen_random_uuid() from generate_series(1, 5001)))
) as attempt(label, ids);
select is(
  pg_temp.wi_json('admin_a', format('select public.validate_draft_products(%L::uuid[])', array[
    pg_temp.u('201'), pg_temp.u('202'), pg_temp.u('203'), pg_temp.u('204'), pg_temp.u('205'), pg_temp.u('b02'),
    pg_temp.u('999'), pg_temp.u('201')
  ])),
  '{"validated": 1, "incomplete": 2, "skipped": 4}'::jsonb,
  'D an admin validates the complete draft; two incomplete drafts are counted; an archived draft, a validated article, another tenant''s draft and an unknown id are skipped'
);
select is(
  (select row(product.catalogue_status, product.catalogue_validated_by, product.catalogue_validated_at is not null)::text
   from public.products product where product.id = pg_temp.u('201')),
  format('(validated,%s,t)', pg_temp.fx('admin_a')),
  'D the validated article carries the admin and the date of its validation'
);
select is(
  (select array_agg(row(product.catalogue_status, product.catalogue_validated_at)::text order by product.id)
   from public.products product
   where product.id in (pg_temp.u('202'), pg_temp.u('203'), pg_temp.u('205'), pg_temp.u('b02'))),
  array['(draft,)', '(draft,)', '(draft,)', '(draft,)'],
  'D the incomplete, archived and foreign drafts stay drafts'
);
select is(
  pg_temp.wi_json('admin_a', format('select public.validate_draft_products(%L::uuid[])', array[pg_temp.u('201')])),
  '{"validated": 0, "incomplete": 0, "skipped": 1}'::jsonb,
  'D an article already validated is skipped'
);

-- ---------------------------------------------------------------------------
-- S: assigning a supply type in bulk.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.wi_json('viewer', format('select to_jsonb(public.assign_products_supply_type(%L::uuid[], %L))',
    array[pg_temp.u('202')], pg_temp.u('d2'))) ->> 'error',
  '42501 CATALOGUE_IMPORT_EDITORS_ONLY',
  'S a viewer cannot assign a supply type'
);
select is(
  pg_temp.wi_json('engineer_1', format('select to_jsonb(public.assign_products_supply_type(%L::uuid[], %L))',
    array[pg_temp.u('202')], attempt.supply_type_id)) ->> 'error',
  '23514 PRODUCT_SUPPLY_TYPE_INVALID',
  format('S %s is refused', attempt.label)
)
from (
  values
    ('a supply type of another tenant', pg_temp.u('d9')),
    ('a supply type that does not exist', pg_temp.u('999')),
    ('no supply type', null::uuid)
) as attempt(label, supply_type_id);
select is(
  pg_temp.wi_json('engineer_1', format('select to_jsonb(public.assign_products_supply_type(%L::uuid[], %L))',
    array[]::uuid[], pg_temp.u('d2'))) ->> 'error',
  '22023 PRODUCT_BULK_INVALID',
  'S an assignment to no article is refused'
);
select is(
  pg_temp.wi_json('engineer_1', format('select to_jsonb(public.assign_products_supply_type(%L::uuid[], %L))',
    array[pg_temp.u('202'), pg_temp.u('204'), pg_temp.u('205'), pg_temp.u('101'), pg_temp.u('121'),
      pg_temp.u('b01'), pg_temp.u('202')],
    pg_temp.u('d2'))),
  to_jsonb(3),
  'S an engineer assigns the type to the three articles they added, not to a shared one, a colleague''s or another tenant''s'
);
select is(
  (select array_agg(product.supply_type_id order by product.id) from public.products product
   where product.id in (pg_temp.u('101'), pg_temp.u('121'), pg_temp.u('202'), pg_temp.u('204'), pg_temp.u('205'),
     pg_temp.u('b01'))),
  array[null, null, pg_temp.u('d2'), pg_temp.u('d2'), pg_temp.u('d2'), null]::uuid[],
  'S the type is on those three articles only'
);
select is(
  pg_temp.wi_json('engineer_1', format('select to_jsonb(public.assign_products_supply_type(%L::uuid[], %L))',
    array[pg_temp.u('202'), pg_temp.u('204'), pg_temp.u('205')], pg_temp.u('d2'))),
  to_jsonb(0),
  'S an article that already has the type is not counted again'
);
select is(
  pg_temp.wi_json('admin_a', format('select to_jsonb(public.assign_products_supply_type(%L::uuid[], %L))',
    array[pg_temp.u('101'), pg_temp.u('121'), pg_temp.u('b01')], pg_temp.u('d1'))),
  to_jsonb(2),
  'S an admin assigns a type to shared and engineers'' articles of their tenant'
);

-- ---------------------------------------------------------------------------
-- U: undoing a batch.
-- The batch of articles of engineer 1 now holds: 201 validated, 202 draft, 203 archived draft, 204 validated,
-- 205 draft, 206 draft with two pending references, 207 draft with a validated and a pending reference,
-- 208 draft created from a material request, with a pending reference.
-- ---------------------------------------------------------------------------
insert into wi_out (key, value)
select 'refs_undo', pg_temp.wi_json('engineer_1', pg_temp.wi_import_sql('tenant_a', jsonb_build_array(
  pg_temp.wi_row(pg_temp.u('206'), pg_temp.u('a1'), 'U-206-A'),
  pg_temp.wi_row(pg_temp.u('207'), pg_temp.u('a1'), 'U-207-A'),
  pg_temp.wi_row(pg_temp.u('207'), pg_temp.u('a2'), 'U-207-B'),
  pg_temp.wi_row(pg_temp.u('208'), pg_temp.u('a1'), 'U-208-A')
)));
select is(
  pg_temp.wi_json('engineer_1', format(
    'select to_jsonb(public.import_workbook_supplier_references(%L, %L::jsonb))', pg_temp.fx('tenant_a'),
    jsonb_build_array(pg_temp.wi_row(pg_temp.u('206'), pg_temp.u('a2'), 'U-206-ANCIEN')))),
  to_jsonb(1),
  'fixture: article 206 also has a pending reference of the old import'
);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_review_sql(array[pg_temp.item('207', 'a1')], true)),
  '{"reviewed": 1, "skipped": 0}'::jsonb,
  'fixture: one reference of article 207 is validated'
);
insert into wi_fx (key, id)
select 'batch_refs_undo', (value ->> 'batch_id')::uuid from wi_out where key = 'refs_undo';
insert into wi_fx (key, id)
select 'batch_refs_e1', (value ->> 'batch_id')::uuid from wi_out where key = 'refs_e1';
insert into wi_fx (key, id)
select 'batch_refs_e1b', (value ->> 'batch_id')::uuid from wi_out where key = 'refs_e1b';

select is(
  pg_temp.wi_json(attempt.user_key, pg_temp.wi_undo_sql(attempt.batch_id, attempt.page_size)) ->> 'error',
  attempt.expected,
  format('U %s', attempt.label)
)
from (
  values
    ('engineer_2', pg_temp.fx('batch_e1'), 500, '42501 CATALOGUE_IMPORT_UNDO_FORBIDDEN',
      'an engineer who did not start the batch cannot undo it'),
    ('viewer', pg_temp.fx('batch_e1'), 500, '42501 CATALOGUE_IMPORT_UNDO_FORBIDDEN', 'a viewer cannot undo a batch'),
    ('admin_b', pg_temp.fx('batch_e1'), 500, 'P0002 CATALOGUE_IMPORT_BATCH_NOT_FOUND',
      'another tenant does not find the batch'),
    ('engineer_1', pg_temp.u('999'), 500, 'P0002 CATALOGUE_IMPORT_BATCH_NOT_FOUND',
      'a batch that does not exist is not found'),
    ('engineer_1', pg_temp.fx('batch_e1'), 0, '22023 CATALOGUE_IMPORT_UNDO_INVALID', 'a page of no row is refused'),
    ('engineer_1', pg_temp.fx('batch_e1'), 501, '22023 CATALOGUE_IMPORT_UNDO_INVALID',
      'a page of more than 500 rows is refused'),
    ('engineer_1', pg_temp.fx('batch_e1'), null, '22023 CATALOGUE_IMPORT_UNDO_INVALID',
      'a page without a size is refused')
) as attempt(user_key, batch_id, page_size, expected, label);
select is(
  (select row(
     (select count(*) from public.products product where product.import_batch_id = pg_temp.fx('batch_e1')),
     (select batch.undone_at from public.catalogue_import_batches batch where batch.id = pg_temp.fx('batch_e1'))
   )::text),
  '(8,)',
  'U no refused undo deleted an article or closed the batch'
);

-- The office taught a usual name for draft 205: the article is in use, an undo must leave it and the name.
insert into public.product_aliases (product_id, alias, alias_key)
values (pg_temp.u('205'), 'Bride de démonstration', 'bride demonstration');

select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_undo_sql(pg_temp.fx('batch_e1'), 3)),
  jsonb_build_object('deleted', 2, 'kept', 1, 'done', false),
  'U first page of three: the validated article is kept, the draft and the archived draft are deleted'
);
select is(
  (select row(
     (select array_agg(right(product.id::text, 3) order by product.id) from public.products product
      where product.import_batch_id = pg_temp.fx('batch_e1')),
     batch.undo_started_at is not null, batch.undo_cursor, batch.undone_at
   )::text from public.catalogue_import_batches batch where batch.id = pg_temp.fx('batch_e1')),
  format('("{201,204,205,206,207,208}",t,%s,)', pg_temp.u('203')),
  'U the rest of the batch is untouched and the batch records a partial undo'
);
select is(
  pg_temp.wi_run('engineer_1', format(
    'insert into public.products (id, reference, designation, unit, unit_price_cents, catalogue_status, import_batch_id)
     values (%L, %L, %L, %L, 0, %L, %L)',
    pg_temp.u('200'), 'TI711-TARDIF', 'TI711 Article tardif', 'u', 'draft', pg_temp.fx('batch_e1'))),
  '23514 PRODUCT_IMPORT_BATCH_INVALID',
  'U a late article below the cursor is refused while the undo is in progress'
);
select is(
  pg_temp.wi_json('admin_a', pg_temp.wi_undo_sql(pg_temp.fx('batch_e1'), 3)),
  jsonb_build_object('deleted', 1, 'kept', 2, 'done', false),
  'U an admin resumes the engineer’s undo: a validated article and a draft with a usual name are kept, one draft deleted'
);
select is(
  (select array_agg(usual_name.alias) from public.product_aliases usual_name where usual_name.product_id = pg_temp.u('205')),
  array['Bride de démonstration'],
  'U a draft the office named keeps its usual name: the undo does not take work away with the import'
);
select is(
  (select count(*)::integer from public.supplier_catalog_items item where item.product_id = pg_temp.u('206')),
  0,
  'U the pending references of a deleted draft go with it, whatever import created them'
);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_undo_sql(pg_temp.fx('batch_e1'), 3)),
  '{"deleted": 0, "kept": 2, "done": true}'::jsonb,
  'U last page: a draft a validated reference protects and a draft created from a material request are kept'
);
select is(
  (select array_agg(right(product.id::text, 3) order by product.id) from public.products product
   where product.import_batch_id = pg_temp.fx('batch_e1')),
  array['201', '204', '205', '207', '208'],
  'U the batch keeps its validated articles, the named draft, the protected draft and the draft of a request'
);
-- The undo names every table whose rows are cleared or deleted with an article. A new foreign key to an
-- article must be read against it: this list fails until it is.
select is(
  (select array_agg(format('%s.%s', con.conrelid::regclass, con.conname) order by con.conrelid::regclass::text, con.conname)
   from pg_constraint con
   where con.contype = 'f' and con.confrelid = 'public.products'::regclass),
  array[
    'dpgf_catalogue_links.dpgf_catalogue_links_product_id_fkey',
    'estimate_items.estimate_items_product_id_fkey',
    'material_request_lines.material_request_lines_product_id_fkey',
    'product_aliases.product_aliases_product_id_fkey',
    'product_packagings.product_packagings_article_unit_fkey',
    'product_reference_price_validations.product_reference_price_validations_product_id_fkey',
    'product_reference_price_withdrawals.product_reference_price_withdrawals_product_id_fkey',
    'purchase_order_items.purchase_order_items_product_id_fkey',
    'supplier_catalog_items.supplier_catalog_items_product_id_fkey',
    'supplier_pricebook.supplier_pricebook_product_id_fkey'
  ],
  'U every table that references an article is one the undo keeps a draft for, or one whose foreign key refuses the deletion'
);
select is(
  array[pg_temp.item_state('207', 'a1'), pg_temp.item_state('207', 'a2'), pg_temp.item_state('208', 'a1')],
  array['(U-207-A,,t,f)', '(U-207-B,,f,t)', '(U-208-A,,f,t)'],
  'U a kept article keeps its references, the pending ones too'
);
select is(
  (select row(batch.undone_at is not null, batch.undone_by)::text from public.catalogue_import_batches batch
   where batch.id = pg_temp.fx('batch_e1')),
  format('(t,%s)', pg_temp.fx('engineer_1')),
  'U the finished undo stamps the batch with its date and its author'
);
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_undo_sql(pg_temp.fx('batch_e1'), 500)),
  '{"deleted": 0, "kept": 0, "done": true}'::jsonb,
  'U undoing an undone batch does nothing'
);
select is(
  (select count(*)::integer from public.products product where product.import_batch_id = pg_temp.fx('batch_e1')),
  5,
  'U and deletes nothing'
);

insert into public.catalogue_import_batches (id, tenant_id, kind)
values (pg_temp.u('910'), pg_temp.fx('tenant_a'), 'workbook_articles');
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_undo_sql(pg_temp.u('910'), 500)) ->> 'error',
  '42501 CATALOGUE_IMPORT_UNDO_FORBIDDEN',
  'U an engineer cannot undo an authorless batch'
);
select throws_ok(format(
  'update public.catalogue_import_batches set undone_at = now() where id = %L', pg_temp.u('910')),
  '23514', null, 'U a batch cannot be marked undone if no undo started');
select is(
  pg_temp.wi_json('admin_a', pg_temp.wi_undo_sql(pg_temp.u('910'), 500)),
  '{"deleted": 0, "kept": 0, "done": true}'::jsonb,
  'U an administrator can undo an authorless batch'
);
select matches(
  pg_temp.wi_run('engineer_1', format(
    'insert into public.products (reference, designation, unit, unit_price_cents, catalogue_status, import_batch_id)
     values (%L, %L, %L, 0, %L, %L)',
    'TI711-APRES', 'TI711 Article après annulation', 'u', 'draft', pg_temp.fx('batch_e1'))),
  '^23514 PRODUCT_IMPORT_BATCH_INVALID',
  'U an undone batch takes no new article'
);

-- A batch of references, undone by an admin who did not start it: 207/a1 validated, 207/a2 and 208/a1 pending
-- (206/a1 went with its article).
select is(
  pg_temp.wi_json('admin_a', pg_temp.wi_undo_sql(pg_temp.fx('batch_refs_undo'), 500)),
  '{"deleted": 2, "kept": 1, "done": true}'::jsonb,
  'U an admin undoes an engineer''s batch of references: the pending ones are deleted, the validated one kept'
);
select is(
  array[pg_temp.item_state('207', 'a1'), pg_temp.item_state('207', 'a2'), pg_temp.item_state('208', 'a1')],
  array['(U-207-A,,t,f)', null, null],
  'U only the validated reference is left'
);
select is(
  (select row(batch.undone_at is not null, batch.undone_by)::text from public.catalogue_import_batches batch
   where batch.id = pg_temp.fx('batch_refs_undo')),
  format('(t,%s)', pg_temp.fx('admin_a')),
  'U the batch of references is stamped with the admin'
);
select is(
  pg_temp.item_state('114', 'a3'),
  '(REF-114,,f,t)',
  'U a pending reference of another batch is untouched'
);

-- The first import of engineer 1, two rows a page: 111/a1 validated and priced, 112/a1 and 115/a2 withdrawn,
-- 114/a3 pending. Ids are random; the database keeps the resume cursor.
insert into wi_out (key, value)
select 'undo_refs_page_1', pg_temp.wi_json('engineer_1', pg_temp.wi_undo_sql(pg_temp.fx('batch_refs_e1'), 2));
select ok(
  (select (value ->> 'deleted')::integer + (value ->> 'kept')::integer = 2 and value -> 'done' = 'false'::jsonb
   from wi_out where key = 'undo_refs_page_1'),
  'U a page of two references examines two and reports there is more to undo'
);
select is(
  (select batch.undone_at from public.catalogue_import_batches batch where batch.id = pg_temp.fx('batch_refs_e1')),
  null,
  'U the batch is not stamped before its last page'
);
insert into wi_out (key, value)
select 'undo_refs_page_2', pg_temp.wi_json('engineer_1', pg_temp.wi_undo_sql(pg_temp.fx('batch_refs_e1'), 2));
select is(
  (select row(sum((value ->> 'deleted')::integer), sum((value ->> 'kept')::integer),
     count(*) filter (where value -> 'done' = 'true'::jsonb))::text
   from wi_out where key in ('undo_refs_page_1', 'undo_refs_page_2')),
  '(1,3,1)',
  'U the two pages delete the pending reference, keep the three reviewed ones, and only the last one ends'
);
select is(
  array[pg_temp.item_state('111', 'a1'), pg_temp.item_state('112', 'a1'), pg_temp.item_state('115', 'a2'),
    pg_temp.item_state('114', 'a3')],
  array['(00042,https://exemple.test/tube-337,t,f)', '(,,f,f)', '(,,f,f)', null],
  'U the validated and the withdrawn references are as they were, the pending one is gone'
);
select is(
  (select row(batch.undone_at is not null, batch.undone_by)::text from public.catalogue_import_batches batch
   where batch.id = pg_temp.fx('batch_refs_e1')),
  format('(t,%s)', pg_temp.fx('engineer_1')),
  'U the author''s undo stamps the batch once the last page is done'
);

-- ---------------------------------------------------------------------------
-- U: the author of a batch undoes it only while still an editor.
-- ---------------------------------------------------------------------------
update public.tenant_memberships set role = 'viewer' where id = pg_temp.u('21');
select is(
  pg_temp.wi_json('engineer_1', pg_temp.wi_undo_sql(pg_temp.fx('batch_refs_e1b'), 500)) ->> 'error',
  '42501 CATALOGUE_IMPORT_UNDO_FORBIDDEN',
  'U the author of a batch, once a viewer, no longer undoes it'
);
select is(
  (select batch.undone_at from public.catalogue_import_batches batch where batch.id = pg_temp.fx('batch_refs_e1b')),
  null,
  'U and the batch stays open'
);

-- U: a batch's author still needs the current right to edit each article. Stamp a colleague's draft
-- through the server-writer exception so the article branch encounters a draft it cannot edit.
update public.tenant_memberships set role = 'engineer' where id = pg_temp.u('21');
insert into wi_fx (key, id)
select 'batch_article_rights', (pg_temp.wi_json('engineer_2', pg_temp.wi_start_sql('tenant_a')) #>> '{}')::uuid;
select is(pg_temp.wi_run('engineer_1', format(
  $$insert into public.products (id, reference, designation, unit, unit_price_cents, catalogue_status)
    values (%L, 'TI711-U-RIGHTS', 'Tube droits fictif', 'u', 0, 'draft')$$, pg_temp.u('219'))),
  'ok 1', 'fixture: a colleague owns the draft');
update public.products set import_batch_id = pg_temp.fx('batch_article_rights') where id = pg_temp.u('219');

select is(pg_temp.wi_run('admin_a', format(
  'select public.set_tenant_catalogue_policy(%L, true)', pg_temp.fx('tenant_a'))),
  'ok 1', 'fixture: engineers can add references to colleagues’ articles');
insert into wi_out (key, value)
select 'refs_rights', pg_temp.wi_json('engineer_2', pg_temp.wi_import_sql('tenant_a', jsonb_build_array(
  pg_temp.wi_row(pg_temp.u('219'), pg_temp.u('a1'), 'U-COLLEAGUE'),
  pg_temp.wi_row(pg_temp.u('121'), pg_temp.u('a1'), 'U-OWN')
)));
select is((select value -> 'imported' from wi_out where key = 'refs_rights'), '2'::jsonb,
  'fixture: both references were imported while the shared base was open');
select is(pg_temp.wi_run('admin_a', format(
  'select public.set_tenant_catalogue_policy(%L, false)', pg_temp.fx('tenant_a'))),
  'ok 1', 'fixture: the admin withdraws access to the shared base');
select is(
  pg_temp.wi_json('engineer_2', pg_temp.wi_undo_sql(
    (select (value ->> 'batch_id')::uuid from wi_out where key = 'refs_rights'), 500)),
  '{"deleted": 1, "kept": 1, "done": true}'::jsonb,
  'U the engineer removes the reference of their own article and keeps the colleague’s reference'
);
select is(pg_temp.item_state('219', 'a1'), '(U-COLLEAGUE,,f,t)', 'U the colleague’s reference is still pending');
select is(pg_temp.item_state('121', 'a1'), null, 'U the engineer’s reference was deleted');
-- Remove the remaining pending reference so only the current article permission can protect the draft.
delete from public.supplier_catalog_items where id = pg_temp.item('219', 'a1');
select is(
  pg_temp.wi_json('engineer_2', pg_temp.wi_undo_sql(pg_temp.fx('batch_article_rights'), 500)),
  '{"deleted": 0, "kept": 1, "done": true}'::jsonb,
  'U a batch author cannot undo a colleague’s draft after losing permission to edit it'
);
select is((select catalogue_status from public.products where id = pg_temp.u('219')), 'draft',
  'U the colleague’s article remains a draft');

-- Each protected relationship has its own draft, with no other link to prevent the delete.
insert into wi_fx (key, id)
select 'batch_links', (pg_temp.wi_json('admin_a', pg_temp.wi_start_sql('tenant_a')) #>> '{}')::uuid;
select is(pg_temp.wi_run('admin_a', format($sql$
  insert into public.products (id, reference, designation, unit, unit_price_cents, catalogue_status, import_batch_id)
  select ('a7110000-0000-4000-8000-000000000' || n)::uuid,
    'TI711-U-LINK-' || n, 'Brouillon fictif ' || n, 'u', 0, 'draft', %L
  from generate_series(211, 215) n
$sql$, pg_temp.fx('batch_links'))), 'ok 5', 'fixture: one draft per additional protected relationship');

insert into public.estimate_projects (id, tenant_id, user_id, name)
values (pg_temp.u('920'), pg_temp.fx('tenant_a'), pg_temp.fx('admin_a'), 'Affaire protection catalogue fictive');
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth)
values (pg_temp.u('921'), pg_temp.fx('tenant_a'), pg_temp.u('920'), 1, 1, 1);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
values (pg_temp.u('922'), pg_temp.fx('tenant_a'), pg_temp.u('921'), 'section', 1, 'Lot fictif');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, line_nature, position,
  title, quantity, product_id, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents,
  line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
values (pg_temp.u('923'), pg_temp.fx('tenant_a'), pg_temp.u('921'), pg_temp.u('922'), 'line', 'supply_only', 1,
  'Ligne fictive', 1, pg_temp.u('211'), 100, 2000, 1, 0, 1, 100, 100, 20, 120);

insert into public.material_requests (id, project_id, created_by)
values (pg_temp.u('924'), pg_temp.u('920'), pg_temp.fx('admin_a'));
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, product_type,
  material, status, product_id, product_match)
values (pg_temp.u('925'), pg_temp.u('924'), 1, 1, 'u', 'DN 25', 'Tube', 'Inox', 'draft', pg_temp.u('212'), 'manual');

insert into public.delivery_sites (id, tenant_id, name)
values (pg_temp.u('926'), pg_temp.fx('tenant_a'), 'Chantier fictif');
insert into public.purchase_orders (id, tenant_id, reference, user_id, supplier_id, delivery_site_id, order_date)
values (pg_temp.u('927'), pg_temp.fx('tenant_a'), 'TI711-U-LINK', pg_temp.fx('admin_a'), pg_temp.u('a1'), pg_temp.u('926'), current_date);
insert into public.purchase_order_items (id, tenant_id, purchase_order_id, position, product_id, designation, quantity,
  unit, unit_price_ht_cents, tax_rate_bp)
values (pg_temp.u('928'), pg_temp.fx('tenant_a'), pg_temp.u('927'), 1, pg_temp.u('213'), 'Achat fictif', 1, 'u', 100, 2000);

insert into public.dpgf_imports (id, tenant_id, user_id, project_id, filename, source_format, status, row_count, parse_mode)
values (pg_temp.u('929'), pg_temp.fx('tenant_a'), pg_temp.fx('admin_a'), pg_temp.u('920'), 'fictif.csv', 'csv', 'completed', 1, 'server');
insert into public.dpgf_rows_mapped (id, tenant_id, import_id, payload, status)
values (pg_temp.u('930'), pg_temp.fx('tenant_a'), pg_temp.u('929'), '{"designation": "Tube fictif"}', 'mapped');
insert into public.dpgf_catalogue_links (id, tenant_id, import_id, mapped_row_id, product_id)
values (pg_temp.u('931'), pg_temp.fx('tenant_a'), pg_temp.u('929'), pg_temp.u('930'), pg_temp.u('214'));

insert into public.product_packagings (id, product_id, label, quantity)
values (pg_temp.u('932'), pg_temp.u('215'), 'Lot de démonstration', 6);

select is(
  pg_temp.wi_json('admin_a', pg_temp.wi_undo_sql(pg_temp.fx('batch_links'), 500)),
  '{"deleted": 0, "kept": 5, "done": true}'::jsonb,
  'U every linked draft is kept'
);
select is(
  (select link.product_id from public.estimate_items link where link.id = pg_temp.u('923')),
  pg_temp.u('211'), 'U the estimate line keeps its draft'
);
select is(
  (select link.product_id from public.material_request_lines link where link.id = pg_temp.u('925')),
  pg_temp.u('212'), 'U the material request line keeps its draft'
);
select is(
  (select link.product_id from public.purchase_order_items link where link.id = pg_temp.u('928')),
  pg_temp.u('213'), 'U the purchase order line keeps its draft'
);
select is(
  (select link.product_id from public.dpgf_catalogue_links link where link.id = pg_temp.u('931')),
  pg_temp.u('214'), 'U the DPGF link keeps its draft'
);
select is(
  (select link.product_id from public.product_packagings link where link.id = pg_temp.u('932')),
  pg_temp.u('215'), 'U the packaging keeps its draft'
);
select is(
  (select count(*)::integer from public.products
   where import_batch_id = pg_temp.fx('batch_links') and catalogue_status = 'draft'),
  5, 'U the five linked articles are still drafts'
);

-- ---------------------------------------------------------------------------
-- Volume probe (work asserted, durations reported as diagnostics, one run each): one admin, the largest call of
-- each function. The articles are loaded like the application does, 500 a statement, and the planner statistics
-- are refreshed as autovacuum would between two requests: every statement above ran on a few rows, and the plans
-- the triggers cached for them would otherwise scan the 6 000 articles once per row.
-- ---------------------------------------------------------------------------
insert into wi_fx (key, id)
select 'batch_volume', (pg_temp.wi_json('admin_a', pg_temp.wi_start_sql('tenant_a', 'Volume 5000.xlsx')) #>> '{}')::uuid;
insert into wi_fx (key, id)
select 'batch_volume_page', (pg_temp.wi_json('admin_a', pg_temp.wi_start_sql('tenant_a', 'Volume 500.xlsx')) #>> '{}')::uuid;

create function pg_temp.wi_volume_insert_sql(p_batch uuid, p_first integer, p_last integer)
returns text
language sql
immutable
as $$
  select format($sql$
    with inserted as (
      insert into public.products (
        id, reference, designation, unit, unit_price_cents, catalogue_status, product_type, material,
        supply_type_id, import_batch_id
      )
      select ('a7110000-0000-4000-8000-' || lpad(to_hex(1048576 + n), 12, '0'))::uuid,
        'TI711-VOL-' || lpad(n::text, 5, '0'), 'TI711 Article volume ' || n, 'u', 0, 'draft', 'Tube', 'Inox 316L',
        %L::uuid, %L::uuid
      from generate_series(%s, %s) n
      returning 1
    )
    select to_jsonb(count(*)) from inserted
  $sql$, pg_temp.u('d1'), p_batch, p_first, p_last)
$$;

do $load$
begin
  for chunk in 0..9 loop
    perform pg_temp.wi_probe_json(null, 'admin_a',
      pg_temp.wi_volume_insert_sql(pg_temp.fx('batch_volume'), chunk * 500 + 1, chunk * 500 + 500));
    analyze public.products;
  end loop;
end;
$load$;
select is(
  (select count(*)::integer from public.products product where product.import_batch_id = pg_temp.fx('batch_volume')),
  5000,
  'volume: 5 000 drafts are stamped with their batch, 500 a statement'
);
select is(
  pg_temp.wi_probe_json('insert a chunk of 500 drafts without a batch', 'admin_a',
    pg_temp.wi_volume_insert_sql(null, 5501, 6000)),
  to_jsonb(500),
  'volume: a chunk of 500 drafts without a batch, for comparison'
);
analyze public.products;
select is(
  pg_temp.wi_probe_json('insert a chunk of 500 drafts stamped with their batch', 'admin_a',
    pg_temp.wi_volume_insert_sql(pg_temp.fx('batch_volume_page'), 5001, 5500)),
  to_jsonb(500),
  'volume: a chunk of 500 drafts is stamped with its batch'
);
analyze public.products;
select is(
  pg_temp.wi_probe_json('import 5 000 supplier references as a batch', 'admin_a', pg_temp.wi_import_sql('tenant_a', (
    select jsonb_agg(jsonb_build_object('product_id', product.id, 'product_reference', product.reference,
      'supplier_id', pg_temp.u('a1'), 'supplier_name', 'TI711 Aciers du Rhône',
      'supplier_sku', 'V-' || product.reference, 'product_url', 'https://exemple.test/' || product.reference))
    from public.products product where product.import_batch_id = pg_temp.fx('batch_volume')
  ))) -> 'imported',
  to_jsonb(5000),
  'volume: 5 000 references are imported as one batch'
);
select is(
  pg_temp.wi_probe_json('import 500 supplier references as a batch', 'admin_a', pg_temp.wi_import_sql('tenant_a', (
    select jsonb_agg(jsonb_build_object('product_id', product.id, 'product_reference', product.reference,
      'supplier_id', pg_temp.u('a2'), 'supplier_name', 'TI711 Visserie Bravo',
      'supplier_sku', 'V-' || product.reference))
    from public.products product where product.import_batch_id = pg_temp.fx('batch_volume_page')
  ))) -> 'imported',
  to_jsonb(500),
  'volume: 500 references are imported for the second batch'
);
analyze public.supplier_catalog_items;
select is(
  pg_temp.wi_probe_json('validate 5 000 pending references', 'admin_a', pg_temp.wi_review_sql((
    select array_agg(item.id) from public.supplier_catalog_items item
    join public.products product on product.id = item.product_id
    where product.import_batch_id = pg_temp.fx('batch_volume')
  ), true)),
  '{"reviewed": 5000, "skipped": 0}'::jsonb,
  'volume: 5 000 references are validated in one call'
);
select is(
  pg_temp.wi_probe_json('undo a page of 500 drafts a validated reference protects', 'admin_a',
    pg_temp.wi_undo_sql(pg_temp.fx('batch_volume'), 500)),
  jsonb_build_object('deleted', 0, 'kept', 500, 'done', false),
  'volume: a page of 500 drafts protected by a validated reference is kept, one refusal per article'
);
select is(
  pg_temp.wi_probe_json('undo a page of 500 drafts with a pending reference each', 'admin_a',
    pg_temp.wi_undo_sql(pg_temp.fx('batch_volume_page'), 500)),
  '{"deleted": 500, "kept": 0, "done": true}'::jsonb,
  'volume: a page of 500 untouched drafts is deleted with its 500 pending references'
);
select is(
  (select row(
     (select count(*) from public.products product where product.import_batch_id = pg_temp.fx('batch_volume_page')),
     (select count(*) from public.supplier_catalog_items item where item.supplier_sku like 'V-TI711-VOL-05%'
        and item.supplier_id = pg_temp.u('a2')),
     (select count(*) from public.products product where product.import_batch_id = pg_temp.fx('batch_volume'))
   )::text),
  '(0,0,5000)',
  'volume: the second batch is gone with its references, the first is whole'
);
select is(
  pg_temp.wi_probe_json('assign a supply type to 5 000 articles', 'admin_a', format(
    'select to_jsonb(public.assign_products_supply_type(%L::uuid[], %L))',
    (select array_agg(product.id) from public.products product
     where product.import_batch_id = pg_temp.fx('batch_volume')),
    pg_temp.u('d2'))),
  to_jsonb(5000),
  'volume: 5 000 articles change supply type in one call'
);
select is(
  pg_temp.wi_probe_json('validate 5 000 drafts', 'admin_a', format(
    'select public.validate_draft_products(%L::uuid[])',
    (select array_agg(product.id) from public.products product
     where product.import_batch_id = pg_temp.fx('batch_volume')))),
  '{"validated": 5000, "incomplete": 0, "skipped": 0}'::jsonb,
  'volume: 5 000 complete drafts are validated in one call'
);
select diag('server: ' || version());
-- pg_prove hides TAP diagnostics on passing files. Print the timings in the standard local run.
do $probes$
declare
  probe record;
begin
  for probe in select label, ms from wi_probe order by position loop
    raise notice 'TI-711 volume probe, one run each: %: % ms', probe.label, probe.ms;
  end loop;
end
$probes$;

select * from finish();
rollback;
