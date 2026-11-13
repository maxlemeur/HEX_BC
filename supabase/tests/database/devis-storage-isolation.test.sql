-- Purchase-order documents in storage (bucket devis) stay within their tenant and their order's author or admins.
-- Written before 20261113195311_drop_broad_devis_storage_policies.sql. On 13/11/2026 the shared database held four
-- permissive policies on storage.objects that no migration creates, granting on bucket_id = 'devis' alone; permissive
-- policies combine with OR, so they opened every tenant's documents to any signed-in member. This file recreates them
-- as they were, shows the leak, replays the migration's statements and proves the isolation again. Failure modes:
--  1. a member of another tenant lists, reads, overwrites or deletes a document's file, or writes one under another
--     tenant's order;
--  2. a viewer of the same tenant deletes it, or the order's author loses access to it.
-- Every member statement goes through pg_temp.pls_run (role and JWT switched in a sub-block). Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Tenant 101: 1 engineer (author of the order), 3 viewer. Tenant 102: 2 admin.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9330000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'devis-isolation-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 3) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9330000-%';
insert into public.tenants (id, name, slug) values
  ('a9330000-0000-4000-8000-000000000101', 'Isolation devis fixture', 'isolation-devis-fixture'),
  ('a9330000-0000-4000-8000-000000000102', 'Isolation devis autre', 'isolation-devis-autre');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  ('a9330000-0000-4000-8000-000000000101', 'a9330000-0000-4000-8000-000000000001', 'engineer', true, '2020-01-01'),
  ('a9330000-0000-4000-8000-000000000102', 'a9330000-0000-4000-8000-000000000002', 'admin', true, '2020-01-01'),
  ('a9330000-0000-4000-8000-000000000101', 'a9330000-0000-4000-8000-000000000003', 'viewer', true, '2020-01-01');
insert into public.suppliers (id, tenant_id, name) values
  ('a9330000-0000-4000-8000-000000000301', 'a9330000-0000-4000-8000-000000000101', 'Isolation Fournisseur (fictif)');
insert into public.delivery_sites (id, tenant_id, name, is_active, updated_at) values
  ('a9330000-0000-4000-8000-000000000801', 'a9330000-0000-4000-8000-000000000101', 'Isolation Chantier', true,
    now() - interval '1 second');

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

-- The engineer's draft order with one supplier document and its stored file.
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000001',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9330000-0000-4000-8000-000000000301',
    'delivery_site_id', 'a9330000-0000-4000-8000-000000000801', 'notes', 'Isolation devis'), jsonb_build_array(
    jsonb_build_object('designation', 'Article fictif', 'quantity', 1, 'unit', 'u', 'unit_price_ht_cents', 100, 'tax_rate_bp', 2000)))$$),
  'ok 1', 'fixture: the engineer''s draft order');
select set_config('test.order', (select id::text from public.purchase_orders where notes = 'Isolation devis'), true);
select set_config('test.path', 'purchase-orders/' || current_setting('test.order') || '/devis-fictif.pdf', true);
insert into public.purchase_order_devis (id, tenant_id, purchase_order_id, user_id, name, original_filename, storage_path,
  file_size_bytes, mime_type, position)
values ('a9330000-0000-4000-8000-00000000d001', 'a9330000-0000-4000-8000-000000000101', current_setting('test.order')::uuid,
  'a9330000-0000-4000-8000-000000000001', 'Devis fictif', 'devis-fictif.pdf', current_setting('test.path'), 1024,
  'application/pdf', 1);
insert into storage.objects (bucket_id, name, metadata) values ('devis', current_setting('test.path'), '{"size": 1024}');
-- The local Storage API sets this guard for its own transactional deletes.
select set_config('storage.allow_delete_query', 'true', true);

create function pg_temp.reads(p_user uuid) returns text language sql as $fn$
  select pg_temp.pls_run(p_user, format($q$select 1 from storage.objects where bucket_id = 'devis' and name = %L$q$,
    current_setting('test.path')));
$fn$;

-- 1. As the shared database held them on 13/11/2026: the leak.
create policy devis_read on storage.objects for select to authenticated using (bucket_id = 'devis');
create policy devis_insert on storage.objects for insert to authenticated with check (bucket_id = 'devis');
create policy devis_update on storage.objects for update to authenticated using (bucket_id = 'devis');
create policy devis_delete on storage.objects for delete to authenticated using (bucket_id = 'devis');
select is(pg_temp.reads('a9330000-0000-4000-8000-000000000002'), 'ok 1',
  '1 with the bucket-wide policies, the admin of another tenant reads the document''s file');

-- The statements of 20261113195311_drop_broad_devis_storage_policies.sql, replayed.
drop policy if exists devis_read on storage.objects;
drop policy if exists devis_insert on storage.objects;
drop policy if exists devis_update on storage.objects;
drop policy if exists devis_delete on storage.objects;

-- 2. Without them, the document stays with its tenant and its author.
select is(pg_temp.reads('a9330000-0000-4000-8000-000000000002'), 'ok 0', '2 the admin of another tenant reads nothing');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000002',
  $$select 1 from storage.objects where bucket_id = 'devis'$$), 'ok 0', '2 nor lists the bucket');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000002',
  format($$update storage.objects set metadata = '{"size": 1}' where bucket_id = 'devis' and name = %L$$, current_setting('test.path'))),
  'ok 0', '2 nor overwrites the file');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000002',
  format($$delete from storage.objects where bucket_id = 'devis' and name = %L$$, current_setting('test.path'))),
  'ok 0', '2 nor deletes it');
select matches(pg_temp.pls_run('a9330000-0000-4000-8000-000000000002',
  format($$insert into storage.objects (bucket_id, name, metadata) values ('devis', %L, '{"size": 1}')$$,
    'purchase-orders/' || current_setting('test.order') || '/intrus.pdf')),
  '^42501 ', '2 nor writes a file under another tenant''s order');
select is(pg_temp.pls_run('a9330000-0000-4000-8000-000000000003',
  format($$delete from storage.objects where bucket_id = 'devis' and name = %L$$, current_setting('test.path'))),
  'ok 0', '2 a viewer of the same tenant does not delete it');
select is(pg_temp.reads('a9330000-0000-4000-8000-000000000001'), 'ok 1', '2 the order''s author still reads it');
select is((select count(*)::integer from storage.objects where bucket_id = 'devis' and name = current_setting('test.path')), 1,
  '2 the file is still stored');

select * from finish();
rollback;
