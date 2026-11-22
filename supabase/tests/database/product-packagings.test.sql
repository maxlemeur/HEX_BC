-- Sale packagings of a catalogue article (« conditionnements de vente »): a label and a quantity expressed in the
-- article's unit (« Barre » of 6 ml), at most one of them marked usual. Informative only: nothing reads them to
-- compute a quantity or a price. Written before the migration 20261122092341_product_packagings.sql, then amended
-- with its design review (unit carried by the packaging, active tenant, database label key, positions). Failure
-- modes, with fictional members and articles:
--   K1 a member of another tenant, of a suspended tenant, or of this tenant while another one is active, writes
--      the packagings of this tenant; a member of another or a suspended tenant reads them;
--   K2 the tenant, the article, the unit, the author, the date, the label key or the position of a packaging comes
--      from the client, or its article or tenant changes;
--   K3 who adds, changes or removes a packaging differs from who may change the article (TI-689: an admin always;
--      an engineer on an article they added, or on any once the tenant opened the shared base; nobody else);
--   K4 a quantity of zero, negative or not a number, or an empty or overlong label, is stored;
--   K5 an article holds the same packaging twice (label folded for case, accents and spaces; same quantity);
--   K6 an article holds two usual packagings; marking another one does not move the mark, or a failed move loses
--      the former mark (two concurrent moves: product-packagings-usual-race.test.sql);
--   K7 the article's unit changes under its packagings, so « 6 ml » silently reads « 6 u »; an article without a
--      unit gets packagings;
--   K8 a member's departure takes their packagings with them; deleting the article leaves its packagings behind.
-- Every member statement goes through pg_temp.pk_run (role and JWT subject switched in a sub-block), so a red
-- assertion fails on its own reason and the file runs to the end. Fixtures rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- ---------------------------------------------------------------------------
-- Contract.
-- ---------------------------------------------------------------------------
select has_table('public', 'product_packagings', 'the packaging table exists');
select ok(
  coalesce((select relation.relrowsecurity and relation.relforcerowsecurity from pg_class relation
    where relation.oid = to_regclass('public.product_packagings')), false),
  'product_packagings has forced RLS'
);
select is(
  (select array_agg(policy.cmd::text order by policy.cmd) from pg_policies policy
   where policy.schemaname = 'public' and policy.tablename = 'product_packagings'),
  array['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  'product_packagings has exactly one policy per command'
);
select ok(
  coalesce((select bool_and(policy.qual is not null and policy.with_check is not null) from pg_policies policy
    where policy.schemaname = 'public' and policy.tablename = 'product_packagings' and policy.cmd = 'UPDATE'), false),
  'K3 the update policy checks both the row it reaches and the row it writes'
);
select ok(
  has_table_privilege('authenticated', 'public.product_packagings', 'SELECT')
    and has_table_privilege('authenticated', 'public.product_packagings', 'INSERT')
    and has_table_privilege('authenticated', 'public.product_packagings', 'UPDATE')
    and has_table_privilege('authenticated', 'public.product_packagings', 'DELETE'),
  'members reach product_packagings through its policies'
);
select ok(
  not has_table_privilege('anon', 'public.product_packagings', 'SELECT')
    and not has_table_privilege('anon', 'public.product_packagings', 'INSERT'),
  'an anonymous caller neither reads nor writes packagings'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_packagings', 'TRUNCATE')
    and not has_table_privilege('authenticated', 'public.product_packagings', 'TRIGGER')
    and not has_table_privilege('authenticated', 'public.product_packagings', 'REFERENCES'),
  'members receive no TRUNCATE, TRIGGER or REFERENCES on packagings'
);
select is(
  (select row(constraint_row.confupdtype, constraint_row.confdeltype,
     (select array_agg(attribute.attname::text order by key.ordinality) from unnest(constraint_row.conkey) with ordinality key(attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = constraint_row.conrelid and attribute.attnum = key.attnum),
     (select array_agg(attribute.attname::text order by key.ordinality) from unnest(constraint_row.confkey) with ordinality key(attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = constraint_row.confrelid and attribute.attnum = key.attnum))::text
   from pg_constraint constraint_row
   where constraint_row.conrelid = to_regclass('public.product_packagings') and constraint_row.contype = 'f'
     and constraint_row.confrelid = 'public.products'::regclass),
  row('r'::"char", 'c'::"char", array['product_id', 'tenant_id', 'unit'], array['id', 'tenant_id', 'unit'])::text,
  'K7 a packaging references its article with the article''s tenant and unit: changing the unit is refused, deleting the article cascades'
);
select is(
  (select row(constraint_row.confdeltype)::text from pg_constraint constraint_row
   where constraint_row.conrelid = to_regclass('public.product_packagings') and constraint_row.contype = 'f'
     and constraint_row.confrelid = 'public.profiles'::regclass),
  row('n'::"char")::text,
  'K8 the author of a packaging is set to null when their profile goes'
);
select ok(
  coalesce((select index.indisunique and pg_get_expr(index.indpred, index.indrelid) = 'is_usual'
    from pg_index index where index.indexrelid = to_regclass('public.product_packagings_one_usual_idx')), false),
  'K6 a partial unique index holds one usual packaging per article, whatever writes race'
);
select ok(
  coalesce((select index.indisunique from pg_index index
    where index.indexrelid = to_regclass('public.product_packagings_label_key_quantity_key')), false),
  'K5 a unique key holds one packaging per article, label key and quantity'
);
select ok(
  to_regclass('public.product_packagings_created_by_idx') is not null and to_regclass('public.product_packagings_tenant_idx') is not null,
  'the author and the tenant have their index (the article''s is the unique key of positions)'
);

-- ---------------------------------------------------------------------------
-- Identities a7c0a6e0-…-00000000000N. Tenant A (…0101): 1 admin, 2 engineer (adds an article), 3 engineer,
-- 4 viewer, 5 director, 9 engineer who leaves. Tenant B (…0102): 6 admin. 7 is admin of A (active, default) and of
-- B. Tenant C (…0103), suspended later: 8 admin.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data)
select ('a7c0a6e0-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'conditionnement-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 9) n;
delete from public.tenant_memberships where user_id::text like 'a7c0a6e0-%';
insert into public.tenants (id, name, slug) values
  ('a7c0a6e0-0000-4000-8000-000000000101', 'Conditionnements fixture', 'conditionnements-fixture'),
  ('a7c0a6e0-0000-4000-8000-000000000102', 'Conditionnements autre tenant', 'conditionnements-autre-tenant'),
  ('a7c0a6e0-0000-4000-8000-000000000103', 'Conditionnements tenant suspendu', 'conditionnements-tenant-suspendu');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select tenant_id::uuid, ('a7c0a6e0-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, role::public.tenant_role, is_default,
  '2020-01-01'::timestamptz + n * interval '1 minute' + (case when is_default then interval '0' else interval '1 day' end)
from (values
  (1, 'a7c0a6e0-0000-4000-8000-000000000101', 'admin', true),
  (2, 'a7c0a6e0-0000-4000-8000-000000000101', 'engineer', true),
  (3, 'a7c0a6e0-0000-4000-8000-000000000101', 'engineer', true),
  (4, 'a7c0a6e0-0000-4000-8000-000000000101', 'viewer', true),
  (5, 'a7c0a6e0-0000-4000-8000-000000000101', 'director', true),
  (6, 'a7c0a6e0-0000-4000-8000-000000000102', 'admin', true),
  (7, 'a7c0a6e0-0000-4000-8000-000000000101', 'admin', true),
  (7, 'a7c0a6e0-0000-4000-8000-000000000102', 'admin', false),
  (8, 'a7c0a6e0-0000-4000-8000-000000000103', 'admin', true),
  (9, 'a7c0a6e0-0000-4000-8000-000000000101', 'engineer', true)
) as fixture(n, tenant_id, role, is_default);

create temporary table pk_fx (key text primary key, id uuid not null) on commit drop;
grant select on pk_fx to authenticated;
insert into pk_fx (key, id) values
  ('admin', 'a7c0a6e0-0000-4000-8000-000000000001'),
  ('engineer_1', 'a7c0a6e0-0000-4000-8000-000000000002'),
  ('engineer_2', 'a7c0a6e0-0000-4000-8000-000000000003'),
  ('viewer', 'a7c0a6e0-0000-4000-8000-000000000004'),
  ('director', 'a7c0a6e0-0000-4000-8000-000000000005'),
  ('admin_b', 'a7c0a6e0-0000-4000-8000-000000000006'),
  ('two_tenants', 'a7c0a6e0-0000-4000-8000-000000000007'),
  ('admin_c', 'a7c0a6e0-0000-4000-8000-000000000008'),
  ('leaver', 'a7c0a6e0-0000-4000-8000-000000000009'),
  ('tenant_a', 'a7c0a6e0-0000-4000-8000-000000000101'),
  ('tenant_b', 'a7c0a6e0-0000-4000-8000-000000000102'),
  ('tenant_c', 'a7c0a6e0-0000-4000-8000-000000000103'),
  -- Articles: the shared base of A (no author, in ml), engineer 1's own article (in u), an article of A without a
  -- unit yet (a draft), an article of B, an article of C.
  ('shared', 'a7c0a6e0-0000-4000-8000-000000000301'),
  ('own', 'a7c0a6e0-0000-4000-8000-000000000302'),
  ('no_unit', 'a7c0a6e0-0000-4000-8000-000000000303'),
  ('other_tenant', 'a7c0a6e0-0000-4000-8000-000000000309'),
  ('suspended', 'a7c0a6e0-0000-4000-8000-000000000310');

create function pg_temp.fx(p_key text) returns uuid language sql stable as $$ select id from pk_fx where key = p_key $$;

-- Runs one statement as a signed-in member. Returns « ok <rows> » or « <sqlstate> <message> ».
create function pg_temp.pk_run(p_user_key text, p_sql text)
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

-- Counts what a member reads, under their RLS.
create function pg_temp.pk_count(p_user_key text, p_where text)
returns integer
language plpgsql
as $count$
declare
  counted integer;
  user_id uuid := pg_temp.fx(p_user_key);
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  execute 'select count(*)::integer from public.product_packagings where ' || p_where into counted;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return counted;
end;
$count$;

insert into public.products (id, tenant_id, designation, unit, unit_price_cents, catalogue_status) values
  (pg_temp.fx('shared'), pg_temp.fx('tenant_a'), 'Tube DN40 48,3x2 fictif', 'ml', 1000, 'validated'),
  (pg_temp.fx('no_unit'), pg_temp.fx('tenant_a'), 'Brouillon fictif sans unité', '', 0, 'draft'),
  (pg_temp.fx('other_tenant'), pg_temp.fx('tenant_b'), 'Tube d''un autre tenant', 'ml', 1000, 'validated'),
  (pg_temp.fx('suspended'), pg_temp.fx('tenant_c'), 'Tube d''un tenant suspendu', 'ml', 1000, 'validated');

select is(
  pg_temp.pk_run('engineer_1', format(
    'insert into public.products (id, designation, unit, unit_price_cents) values (%L, %L, %L, 500)',
    pg_temp.fx('own'), 'Coude fictif de l''ingénieur 1', 'u')),
  'ok 1',
  'fixture: engineer 1 adds their own article'
);

-- ---------------------------------------------------------------------------
-- K2, K3: adding. The tenant, the unit, the author, the date, the key and the position come from the database.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (id, tenant_id, product_id, unit, label, label_key, quantity, is_usual, position, created_by, created_at)
     values (%L, %L, %L, %L, %L, %L, 6, true, 40, %L, %L)',
    'a7c0a6e0-0000-4000-8000-000000000401', pg_temp.fx('tenant_b'), pg_temp.fx('shared'), 'u', '  Barre   inox ', 'forged',
    pg_temp.fx('engineer_2'), '2001-01-01')),
  'ok 1',
  'K3 an admin adds a packaging to an article of the shared base, whatever tenant, unit, key, position or author is sent'
);
select is(
  (select row(packaging.tenant_id, packaging.unit, packaging.created_by, packaging.label, packaging.label_key, packaging.quantity,
     packaging.is_usual, packaging.position, packaging.created_at > now() - interval '1 hour')::text
   from public.product_packagings packaging where packaging.id = 'a7c0a6e0-0000-4000-8000-000000000401'),
  row(pg_temp.fx('tenant_a'), 'ml', pg_temp.fx('admin'), 'Barre inox', 'barre inox', 6.000::numeric(14,3), true, 1, true)::text,
  'K2 the article''s tenant and unit, the caller as author, the database''s date, key and position; the label is trimmed'
);
select is(
  pg_temp.pk_run('engineer_1', format(
    'insert into public.product_packagings (id, product_id, label, quantity) values (%L, %L, %L, 10)',
    'a7c0a6e0-0000-4000-8000-000000000402', pg_temp.fx('own'), 'Boîte')),
  'ok 1',
  'K3 an engineer adds a packaging to an article they added'
);
select is(
  (select row(packaging.unit, packaging.position)::text from public.product_packagings packaging
   where packaging.id = 'a7c0a6e0-0000-4000-8000-000000000402'),
  row('u', 1)::text,
  'K7 the packaging carries its own article''s unit; positions count per article'
);
select matches(
  pg_temp.pk_run('engineer_2', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 2)', pg_temp.fx('own'), 'Carton')),
  '^42501 ',
  'K3 another engineer cannot add one to an article they did not add (no catalogue policy row)'
);
select matches(
  pg_temp.pk_run('engineer_1', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 2)', pg_temp.fx('shared'), 'Touret')),
  '^42501 ',
  'K3 an engineer cannot add one to an article of the shared base (no catalogue policy row)'
);
select matches(
  pg_temp.pk_run('viewer', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 2)', pg_temp.fx('shared'), 'Touret')),
  '^42501 ',
  'K3 a viewer adds no packaging'
);
select matches(
  pg_temp.pk_run('director', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 2)', pg_temp.fx('shared'), 'Touret')),
  '^42501 ',
  'K3 a director adds no packaging'
);
select matches(
  pg_temp.pk_run('admin_b', format(
    'insert into public.product_packagings (tenant_id, product_id, label, quantity) values (%L, %L, %L, 2)',
    pg_temp.fx('tenant_b'), pg_temp.fx('shared'), 'Touret')),
  '^23514 PRODUCT_PACKAGING_PRODUCT_NOT_FOUND',
  'K1 an admin of another tenant adds nothing to this tenant''s article: an article they cannot read does not exist'
);
select matches(
  pg_temp.pk_run('two_tenants', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 2)', pg_temp.fx('other_tenant'), 'Touret')),
  '^42501 ',
  'K1 an admin of two tenants writes only in their active one'
);
select is(
  pg_temp.pk_run('two_tenants', format(
    'insert into public.product_packagings (id, product_id, label, quantity) values (%L, %L, %L, 100)',
    'a7c0a6e0-0000-4000-8000-000000000405', pg_temp.fx('shared'), 'Touret')),
  'ok 1',
  'K1 and writes in that active tenant'
);
select matches(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 2)', pg_temp.fx('no_unit'), 'Touret')),
  '^23514 PRODUCT_PACKAGING_UNIT_REQUIRED',
  'K7 an article without a unit gets no packaging'
);

-- ---------------------------------------------------------------------------
-- K1: reading.
-- ---------------------------------------------------------------------------
select is(pg_temp.pk_count('viewer', 'true'), 3, 'K1 a viewer of the tenant reads its packagings');
select is(pg_temp.pk_count('director', 'true'), 3, 'K1 a director of the tenant reads its packagings');
select is(pg_temp.pk_count('admin_b', format('tenant_id = %L', pg_temp.fx('tenant_a'))), 0,
  'K1 a member of another tenant reads none of them');

-- ---------------------------------------------------------------------------
-- K4: values.
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 0)', pg_temp.fx('shared'), 'Couronne')),
  '^23514 ',
  'K4 a quantity of zero is refused'
);
select matches(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, -6)', pg_temp.fx('shared'), 'Couronne')),
  '^23514 ',
  'K4 a negative quantity is refused'
);
select matches(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, %L::numeric)', pg_temp.fx('shared'), 'Couronne', 'NaN')),
  '^23514 ',
  'K4 a quantity that is not a number is refused'
);
select matches(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, null)', pg_temp.fx('shared'), 'Couronne')),
  '^23502 ',
  'K4 a missing quantity is refused'
);
select matches(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 2)', pg_temp.fx('shared'), '   ')),
  '^23514 ',
  'K4 a blank label is refused'
);
select matches(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 2)', pg_temp.fx('shared'), repeat('x', 81))),
  '^23514 ',
  'K4 a label over 80 characters is refused'
);
select matches(
  pg_temp.pk_run('admin', format(
    'update public.product_packagings set quantity = 0 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000401')),
  '^23514 ',
  'K4 a packaging cannot be changed to a quantity of zero'
);

-- ---------------------------------------------------------------------------
-- K5: one packaging per label key and quantity.
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.pk_run('engineer_1', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 10.000)', pg_temp.fx('own'), 'BOITE')),
  '^23505 .*product_packagings_label_key_quantity_key',
  'K5 « BOITE » is « Boîte »: the same quantity is refused'
);
select matches(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 6)', pg_temp.fx('shared'), ' barre  INOX')),
  '^23505 .*product_packagings_label_key_quantity_key',
  'K5 spaces and case are folded too'
);
select is(
  pg_temp.pk_run('engineer_1', format(
    'insert into public.product_packagings (id, product_id, label, quantity) values (%L, %L, %L, 25)',
    'a7c0a6e0-0000-4000-8000-000000000406', pg_temp.fx('own'), 'BOITE')),
  'ok 1',
  'K5 « BOITE » with another quantity is another packaging'
);
select is(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (id, product_id, label, quantity) values (%L, %L, %L, 3)',
    'a7c0a6e0-0000-4000-8000-000000000403', pg_temp.fx('shared'), 'Barre inox')),
  'ok 1',
  'K5 the same label with another quantity is another packaging (Barre de 3)'
);

-- ---------------------------------------------------------------------------
-- K6: a single usual packaging; marking another one moves the mark; a failed move keeps the former one.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.pk_run('admin', format(
    'insert into public.product_packagings (id, product_id, label, quantity, is_usual) values (%L, %L, %L, 50, true)',
    'a7c0a6e0-0000-4000-8000-000000000404', pg_temp.fx('shared'), 'Couronne')),
  'ok 1',
  'K6 a new packaging marked usual is added'
);
select is(
  (select array_agg(packaging.label || ':' || packaging.quantity::text || ':' || packaging.is_usual order by packaging.position, packaging.id)
   from public.product_packagings packaging where packaging.product_id = pg_temp.fx('shared')),
  array['Barre inox:6.000:false', 'Touret:100.000:false', 'Barre inox:3.000:false', 'Couronne:50.000:true'],
  'K6 the mark moved to it, and the list keeps the order of its positions'
);
select is(
  pg_temp.pk_run('admin', format(
    'update public.product_packagings set is_usual = true where id = %L', 'a7c0a6e0-0000-4000-8000-000000000403')),
  'ok 1',
  'K6 marking another packaging usual is accepted'
);
select is(
  (select array_agg(packaging.id::text order by packaging.id) from public.product_packagings packaging
   where packaging.product_id = pg_temp.fx('shared') and packaging.is_usual),
  array['a7c0a6e0-0000-4000-8000-000000000403'],
  'K6 the mark moved again: one usual packaging per article'
);
select matches(
  pg_temp.pk_run('admin', format(
    'update public.product_packagings set is_usual = true, label = %L, quantity = 50 where id = %L',
    'COURONNE', 'a7c0a6e0-0000-4000-8000-000000000405')),
  '^23505 ',
  'K6 a move that fails (the packaging would duplicate another one) is refused'
);
select is(
  (select array_agg(packaging.id::text order by packaging.id) from public.product_packagings packaging
   where packaging.product_id = pg_temp.fx('shared') and packaging.is_usual),
  array['a7c0a6e0-0000-4000-8000-000000000403'],
  'K6 and the former usual packaging keeps its mark'
);
select is(
  pg_temp.pk_run('admin', format(
    'update public.product_packagings set is_usual = false where id = %L', 'a7c0a6e0-0000-4000-8000-000000000403')),
  'ok 1',
  'K6 the mark can be removed'
);
select is(
  (select count(*)::integer from public.product_packagings packaging where packaging.product_id = pg_temp.fx('shared') and packaging.is_usual),
  0,
  'K6 the article then has no usual packaging'
);

-- ---------------------------------------------------------------------------
-- K3: changing and removing follow the article's edit rights.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.pk_run('engineer_2', format(
    'update public.product_packagings set label = %L where id = %L', 'Boîte de 10', 'a7c0a6e0-0000-4000-8000-000000000402')),
  'ok 0',
  'K3 another engineer changes nothing on an article they did not add (no catalogue policy row)'
);
select is(
  pg_temp.pk_run('engineer_2', format(
    'delete from public.product_packagings where id = %L', 'a7c0a6e0-0000-4000-8000-000000000402')),
  'ok 0',
  'K3 another engineer removes nothing from an article they did not add (no catalogue policy row)'
);
select is(
  pg_temp.pk_run('engineer_1', format(
    'update public.product_packagings set quantity = 12 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000401')),
  'ok 0',
  'K3 an engineer changes nothing on the shared base (no catalogue policy row)'
);
select is(
  pg_temp.pk_run('viewer', format(
    'update public.product_packagings set quantity = 12 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000401')),
  'ok 0',
  'K3 a viewer changes no packaging'
);
select is(
  pg_temp.pk_run('director', format(
    'update public.product_packagings set quantity = 12 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000401')),
  'ok 0',
  'K3 a director changes no packaging'
);
select is(
  pg_temp.pk_run('viewer', format(
    'delete from public.product_packagings where id = %L', 'a7c0a6e0-0000-4000-8000-000000000401')),
  'ok 0',
  'K3 a viewer removes no packaging'
);
select is(
  pg_temp.pk_run('director', format(
    'delete from public.product_packagings where id = %L', 'a7c0a6e0-0000-4000-8000-000000000401')),
  'ok 0',
  'K3 a director removes no packaging'
);
select is(
  pg_temp.pk_run('admin_b', format(
    'update public.product_packagings set quantity = 12 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000401')),
  'ok 0',
  'K1 an admin of another tenant changes no packaging of this tenant'
);
select is(
  pg_temp.pk_run('admin_b', format(
    'delete from public.product_packagings where id = %L', 'a7c0a6e0-0000-4000-8000-000000000401')),
  'ok 0',
  'K1 an admin of another tenant removes no packaging of this tenant'
);
select is(
  pg_temp.pk_run('engineer_1', format(
    'update public.product_packagings set label = %L, quantity = 12 where id = %L', 'Boîte de 12', 'a7c0a6e0-0000-4000-8000-000000000402')),
  'ok 1',
  'K3 an engineer changes a packaging of an article they added'
);
select is(
  (select row(packaging.label_key, packaging.position)::text from public.product_packagings packaging
   where packaging.id = 'a7c0a6e0-0000-4000-8000-000000000402'),
  row('boite de 12', 1)::text,
  'K2 the label key follows the new label; the position stays'
);
select matches(
  pg_temp.pk_run('engineer_1', format(
    'update public.product_packagings set product_id = %L where id = %L', pg_temp.fx('shared'), 'a7c0a6e0-0000-4000-8000-000000000402')),
  '^23514 PRODUCT_PACKAGING_SCOPE_IMMUTABLE',
  'K2 a packaging does not move to another article'
);
select matches(
  pg_temp.pk_run('admin', format(
    'update public.product_packagings set tenant_id = %L where id = %L', pg_temp.fx('tenant_b'), 'a7c0a6e0-0000-4000-8000-000000000401')),
  '^23514 PRODUCT_PACKAGING_SCOPE_IMMUTABLE',
  'K2 a packaging does not move to another tenant'
);
select is(
  pg_temp.pk_run('admin', format(
    'update public.product_packagings set created_by = %L, created_at = %L, unit = %L, label_key = %L, position = 99 where id = %L',
    pg_temp.fx('viewer'), '2001-01-01', 'u', 'forged', 'a7c0a6e0-0000-4000-8000-000000000401')),
  'ok 1',
  'K2 an update that sends an author, a date, a unit, a key and a position runs'
);
select is(
  (select row(packaging.created_by, packaging.created_at > now() - interval '1 hour', packaging.unit, packaging.label_key, packaging.position)::text
   from public.product_packagings packaging where packaging.id = 'a7c0a6e0-0000-4000-8000-000000000401'),
  row(pg_temp.fx('admin'), true, 'ml', 'barre inox', 1)::text,
  'K2 but keeps what the database stamped'
);
select is(
  pg_temp.pk_run('admin', format(
    'update public.product_packagings set label = %L where id = %L', 'Boîte de 12 bis', 'a7c0a6e0-0000-4000-8000-000000000402')),
  'ok 1',
  'K3 an admin changes a packaging of an engineer''s article'
);
select is(
  pg_temp.pk_run('two_tenants', format(
    'update public.product_packagings set quantity = 120 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000405')),
  'ok 1',
  'K1 an admin of two tenants changes a packaging of their active tenant'
);

-- The admin records the setting off: engineers still change only their own articles.
select is(
  pg_temp.pk_run('admin', format('select public.set_tenant_catalogue_policy(%L, false)', pg_temp.fx('tenant_a'))),
  'ok 1',
  'fixture: the admin records that the shared base stays closed to engineers'
);
select is(
  pg_temp.pk_run('engineer_2', format(
    'update public.product_packagings set quantity = 7 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000403')),
  'ok 0',
  'K3 an engineer changes nothing on the shared base with the setting off'
);
select matches(
  pg_temp.pk_run('engineer_2', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 4)', pg_temp.fx('own'), 'Carton')),
  '^42501 ',
  'K3 nor adds to another engineer''s article with the setting off'
);
select is(
  pg_temp.pk_run('engineer_2', format(
    'delete from public.product_packagings where id = %L', 'a7c0a6e0-0000-4000-8000-000000000406')),
  'ok 0',
  'K3 nor removes from it with the setting off'
);

-- The admin opens the shared base to engineers: engineer 2 now changes any article, so any packaging.
select is(
  pg_temp.pk_run('admin', format('select public.set_tenant_catalogue_policy(%L, true)', pg_temp.fx('tenant_a'))),
  'ok 1',
  'fixture: the admin opens the shared base to engineers'
);
select is(
  pg_temp.pk_run('engineer_2', format(
    'update public.product_packagings set quantity = 7 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000403')),
  'ok 1',
  'K3 an engineer changes a packaging of the shared base once it is open'
);
select is(
  pg_temp.pk_run('engineer_2', format(
    'insert into public.product_packagings (id, product_id, label, quantity) values (%L, %L, %L, 4)',
    'a7c0a6e0-0000-4000-8000-000000000407', pg_temp.fx('own'), 'Carton')),
  'ok 1',
  'K3 and adds one to another engineer''s article'
);
select is(
  pg_temp.pk_run('engineer_2', format(
    'delete from public.product_packagings where id = %L', 'a7c0a6e0-0000-4000-8000-000000000407')),
  'ok 1',
  'K3 and removes it'
);
select is(
  pg_temp.pk_run('viewer', format(
    'delete from public.product_packagings where id = %L', 'a7c0a6e0-0000-4000-8000-000000000403')),
  'ok 0',
  'K3 opening the shared base gives a viewer nothing'
);
select is(
  pg_temp.pk_run('director', format(
    'update public.product_packagings set quantity = 8 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000403')),
  'ok 0',
  'K3 nor a director'
);
select is(
  pg_temp.pk_run('admin', format(
    'delete from public.product_packagings where id = %L', 'a7c0a6e0-0000-4000-8000-000000000404')),
  'ok 1',
  'K3 an admin removes a packaging'
);

-- ---------------------------------------------------------------------------
-- K1: a suspended tenant.
-- ---------------------------------------------------------------------------
insert into public.product_packagings (id, product_id, label, quantity)
values ('a7c0a6e0-0000-4000-8000-000000000408', pg_temp.fx('suspended'), 'Barre', 6);
select is(pg_temp.pk_count('admin_c', 'true'), 1, 'fixture: the admin of C reads the packaging of C while C is active');
update public.tenants set is_active = false where id = pg_temp.fx('tenant_c');
select is(pg_temp.pk_count('admin_c', 'true'), 0, 'K1 a member of a suspended tenant reads none of its packagings');
select isnt(
  pg_temp.pk_run('admin_c', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 3)', pg_temp.fx('suspended'), 'Touret')),
  'ok 1',
  'K1 nor adds one'
);
select is(
  pg_temp.pk_run('admin_c', format(
    'update public.product_packagings set quantity = 3 where id = %L', 'a7c0a6e0-0000-4000-8000-000000000408')),
  'ok 0',
  'K1 nor changes one'
);
select is(
  pg_temp.pk_run('admin_c', format(
    'delete from public.product_packagings where id = %L', 'a7c0a6e0-0000-4000-8000-000000000408')),
  'ok 0',
  'K1 nor removes one'
);

-- ---------------------------------------------------------------------------
-- K7: the unit of an article with packagings does not change.
-- ---------------------------------------------------------------------------
select matches(
  pg_temp.pk_run('admin', format('update public.products set unit = %L where id = %L', 'kg', pg_temp.fx('shared'))),
  '^23503 .*product_packagings_article_unit_fkey',
  'K7 the unit of an article that has packagings cannot change'
);
select is((select unit from public.products where id = pg_temp.fx('shared')), 'ml', 'K7 the article keeps its unit');
select is(
  pg_temp.pk_run('admin', format('update public.products set designation = %L where id = %L', 'Tube DN40 renommé', pg_temp.fx('shared'))),
  'ok 1',
  'K7 its other fields still change'
);
select is(
  pg_temp.pk_run('engineer_1', format('delete from public.product_packagings where product_id = %L', pg_temp.fx('own'))),
  'ok 2',
  'fixture: engineer 1 removes the packagings of their article'
);
select is(
  pg_temp.pk_run('engineer_1', format('update public.products set unit = %L where id = %L', 'kg', pg_temp.fx('own'))),
  'ok 1',
  'K7 without packagings, the article''s unit changes'
);

-- ---------------------------------------------------------------------------
-- K8: a member's departure keeps their packagings; the article's deletion takes them.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.pk_run('leaver', format(
    'insert into public.product_packagings (id, product_id, label, quantity) values (%L, %L, %L, 12)',
    'a7c0a6e0-0000-4000-8000-000000000409', pg_temp.fx('shared'), 'Fagot')),
  'ok 1',
  'fixture: an engineer adds a packaging to the shared base, open to engineers'
);
delete from public.profiles where id = pg_temp.fx('leaver');
select is(
  (select row(packaging.label, packaging.created_by)::text from public.product_packagings packaging
   where packaging.id = 'a7c0a6e0-0000-4000-8000-000000000409'),
  row('Fagot', null::uuid)::text,
  'K8 once their profile is gone, the packaging stays, without an author'
);
select is(
  pg_temp.pk_run('engineer_1', format(
    'insert into public.product_packagings (product_id, label, quantity) values (%L, %L, 2)', pg_temp.fx('own'), 'Sac')),
  'ok 1',
  'fixture: engineer 1 adds a packaging to their article in its new unit'
);
select is(
  pg_temp.pk_run('engineer_1', format('delete from public.products where id = %L', pg_temp.fx('own'))),
  'ok 1',
  'fixture: engineer 1 deletes their article'
);
select is(
  (select count(*)::integer from public.product_packagings packaging where packaging.product_id = pg_temp.fx('own')),
  0,
  'K8 its packagings are gone with it'
);
select is(
  (select count(*)::integer from public.product_packagings packaging where packaging.product_id = pg_temp.fx('shared')),
  4,
  'K8 the packagings of other articles stay'
);

select * from finish();
rollback;
