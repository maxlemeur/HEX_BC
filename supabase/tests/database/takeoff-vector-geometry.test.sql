-- TI-662: the vector reading of a takeoff job (pages and item geometries) is
-- written by the worker only and read through the job's access. Ways it could
-- leak or drift, written before the fixtures:
-- - a client (authenticated) inserts, updates or deletes a page or a geometry,
--   or anonymous reads them;
-- - a member of another tenant, or an engineer of the same tenant who cannot
--   access the job's estimate, reads them;
-- - a page is attached to another job's result, a geometry to another job's
--   item or page, or a row keeps a tenant other than its job's;
-- - clearing a job's results (retry, cancel) leaves its pages and geometries.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.takeoff_vector_pages'::regclass), 'vector pages force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.takeoff_item_geometries'::regclass), 'item geometries force RLS');
select is(has_table_privilege('anon', 'public.takeoff_vector_pages', 'SELECT'), false, 'anonymous cannot read vector pages');
select is(has_table_privilege('anon', 'public.takeoff_item_geometries', 'SELECT'), false, 'anonymous cannot read geometries');
select is(has_table_privilege('authenticated', 'public.takeoff_vector_pages', 'SELECT'), true, 'authenticated reads vector pages through RLS');
select is(has_table_privilege('authenticated', 'public.takeoff_item_geometries', 'SELECT'), true, 'authenticated reads geometries through RLS');
select is(has_table_privilege('authenticated', format('public.%I', relation), privilege), false,
  format('authenticated has no %s on %s: the worker writes them', privilege, relation))
from (values ('takeoff_vector_pages'), ('takeoff_item_geometries')) as relations(relation)
cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as privileges(privilege);
select is(has_table_privilege('service_role', format('public.%I', relation), privilege), true,
  format('the worker keeps %s on %s', privilege, relation))
from (values ('takeoff_vector_pages'), ('takeoff_item_geometries')) as relations(relation)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privileges(privilege);

-- Fixtures: tenant A (owner engineer 1, engineer 2 of another project), tenant B (engineer 3).
insert into auth.users(id, email, raw_user_meta_data)
select ('7e000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'vectors-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 3) n;
update public.tenant_memberships set is_default = false where user_id::text like '7e000000-%';
insert into public.tenants(id, name, slug) values
('7e000000-0000-4000-8000-000000000101', 'Vector fixture', 'vector-fixture'),
('7e000000-0000-4000-8000-000000000102', 'Foreign vector fixture', 'vector-foreign');
insert into public.tenant_memberships(tenant_id, user_id, role, is_default, created_at) values
('7e000000-0000-4000-8000-000000000101', '7e000000-0000-4000-8000-000000000001', 'engineer', true, '2020-01-01'),
('7e000000-0000-4000-8000-000000000101', '7e000000-0000-4000-8000-000000000002', 'engineer', true, '2020-01-01'),
('7e000000-0000-4000-8000-000000000102', '7e000000-0000-4000-8000-000000000003', 'engineer', true, '2020-01-01');
insert into public.estimate_projects(id, tenant_id, user_id, name) values
('7e000000-0000-4000-8000-000000000201', '7e000000-0000-4000-8000-000000000101', '7e000000-0000-4000-8000-000000000001', 'Vector project'),
('7e000000-0000-4000-8000-000000000202', '7e000000-0000-4000-8000-000000000101', '7e000000-0000-4000-8000-000000000002', 'Other project'),
('7e000000-0000-4000-8000-000000000203', '7e000000-0000-4000-8000-000000000102', '7e000000-0000-4000-8000-000000000003', 'Foreign project');
insert into public.estimate_versions(id, project_id, version_number) values
('7e000000-0000-4000-8000-000000000301', '7e000000-0000-4000-8000-000000000201', 1),
('7e000000-0000-4000-8000-000000000303', '7e000000-0000-4000-8000-000000000203', 1);
insert into public.takeoff_jobs(id, tenant_id, estimate_version_id, level, created_by, source_file_path) values
('7e000000-0000-4000-8000-000000000401', '7e000000-0000-4000-8000-000000000101', '7e000000-0000-4000-8000-000000000301', 'C',
 '7e000000-0000-4000-8000-000000000001', '7e000000-0000-4000-8000-000000000101/7e000000-0000-4000-8000-000000000401/plan.pdf'),
('7e000000-0000-4000-8000-000000000402', '7e000000-0000-4000-8000-000000000102', '7e000000-0000-4000-8000-000000000303', 'C',
 '7e000000-0000-4000-8000-000000000003', '7e000000-0000-4000-8000-000000000102/7e000000-0000-4000-8000-000000000402/plan.pdf');
insert into public.takeoff_results(id, tenant_id, job_id) values
('7e000000-0000-4000-8000-000000000501', '7e000000-0000-4000-8000-000000000101', '7e000000-0000-4000-8000-000000000401'),
('7e000000-0000-4000-8000-000000000502', '7e000000-0000-4000-8000-000000000102', '7e000000-0000-4000-8000-000000000402');
insert into public.takeoff_items(id, tenant_id, job_id, result_id, designation, quantity, unit) values
('7e000000-0000-4000-8000-000000000601', '7e000000-0000-4000-8000-000000000101', '7e000000-0000-4000-8000-000000000401',
 '7e000000-0000-4000-8000-000000000501', 'EF PVC DN 40', 5, 'ml'),
('7e000000-0000-4000-8000-000000000602', '7e000000-0000-4000-8000-000000000102', '7e000000-0000-4000-8000-000000000402',
 '7e000000-0000-4000-8000-000000000502', 'EF PVC DN 40', 3, 'ml');

-- The tenant follows the result's job, whatever the writer sends.
insert into public.takeoff_vector_pages(id, tenant_id, job_id, result_id, source_page, reading, schema_version) values
('7e000000-0000-4000-8000-000000000701', '7e000000-0000-4000-8000-000000000102', '7e000000-0000-4000-8000-000000000401',
 '7e000000-0000-4000-8000-000000000501', 1, '{"scale":{"status":"format"}}', 1),
('7e000000-0000-4000-8000-000000000702', '7e000000-0000-4000-8000-000000000102', '7e000000-0000-4000-8000-000000000402',
 '7e000000-0000-4000-8000-000000000502', 1, '{"scale":{"status":"unverified"}}', 1);
select is((select tenant_id from public.takeoff_vector_pages where id = '7e000000-0000-4000-8000-000000000701'),
  '7e000000-0000-4000-8000-000000000101'::uuid, 'a page takes the tenant of its result''s job');
insert into public.takeoff_item_geometries(takeoff_item_id, tenant_id, job_id, vector_page_id, geometry, schema_version) values
('7e000000-0000-4000-8000-000000000601', '7e000000-0000-4000-8000-000000000101', '7e000000-0000-4000-8000-000000000401',
 '7e000000-0000-4000-8000-000000000701', '{"length_m":5}', 1),
('7e000000-0000-4000-8000-000000000602', '7e000000-0000-4000-8000-000000000102', '7e000000-0000-4000-8000-000000000402',
 '7e000000-0000-4000-8000-000000000702', '{"length_m":3}', 1);

select throws_ok($$insert into public.takeoff_vector_pages(job_id, result_id, source_page, reading, schema_version)
  values ('7e000000-0000-4000-8000-000000000401', '7e000000-0000-4000-8000-000000000502', 2, '{}', 1)$$,
  '23514', 'TAKEOFF_VECTOR_JOB_MISMATCH', 'a page cannot hang on another job''s result');
select throws_ok($$update public.takeoff_item_geometries set vector_page_id = '7e000000-0000-4000-8000-000000000702'
  where takeoff_item_id = '7e000000-0000-4000-8000-000000000601'$$,
  '23514', 'TAKEOFF_VECTOR_GEOMETRY_PAGE_MISMATCH', 'a geometry cannot move to another job''s page');
select throws_ok($$insert into public.takeoff_vector_pages(job_id, result_id, source_page, reading, schema_version)
  values ('7e000000-0000-4000-8000-000000000401', '7e000000-0000-4000-8000-000000000501', 3, '[]', 1)$$,
  '23514', null, 'a page reading is an object');
select throws_ok($$insert into public.takeoff_vector_pages(job_id, result_id, source_page, reading, schema_version)
  values ('7e000000-0000-4000-8000-000000000401', '7e000000-0000-4000-8000-000000000501', 1, '{}', 1)$$,
  '23505', null, 'a result reads a page once');

-- The job's owner reads the job's rows only.
select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"7e000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select is((select count(*) from public.takeoff_vector_pages), 1::bigint, 'the owner reads the vector page of their job');
select is((select count(*) from public.takeoff_item_geometries), 1::bigint, 'the owner reads the geometry of their job');
select throws_ok($$insert into public.takeoff_vector_pages(job_id, result_id, source_page, reading, schema_version)
  values ('7e000000-0000-4000-8000-000000000401', '7e000000-0000-4000-8000-000000000501', 9, '{}', 1)$$,
  '42501', null, 'a client cannot write a vector page');
select throws_ok($$update public.takeoff_item_geometries set geometry = '{"length_m":50}'$$,
  '42501', null, 'a client cannot rewrite a geometry');
select throws_ok($$delete from public.takeoff_vector_pages$$, '42501', null, 'a client cannot delete a vector page');
reset role;

-- An engineer of the same tenant without access to the job's estimate reads nothing.
select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"7e000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
select is((select count(*) from public.takeoff_vector_pages), 0::bigint, 'another project''s engineer reads no vector page');
select is((select count(*) from public.takeoff_item_geometries), 0::bigint, 'another project''s engineer reads no geometry');
reset role;

-- A member of another tenant reads their own rows, never tenant A's.
select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"7e000000-0000-4000-8000-000000000003"}', true);
set local role authenticated;
select is((select array_agg(id::text) from public.takeoff_vector_pages), array['7e000000-0000-4000-8000-000000000702'],
  'a foreign tenant reads only its own vector page');
select is((select array_agg(takeoff_item_id::text) from public.takeoff_item_geometries), array['7e000000-0000-4000-8000-000000000602'],
  'a foreign tenant reads only its own geometry');
reset role;

-- Clearing the job's results (retry, cancel) deletes its vector rows.
delete from public.takeoff_items where job_id = '7e000000-0000-4000-8000-000000000401';
delete from public.takeoff_results where job_id = '7e000000-0000-4000-8000-000000000401';
select is((select count(*) from public.takeoff_vector_pages where job_id = '7e000000-0000-4000-8000-000000000401'), 0::bigint,
  'clearing the results deletes the job''s vector pages');
select is((select count(*) from public.takeoff_item_geometries where job_id = '7e000000-0000-4000-8000-000000000401'), 0::bigint,
  'clearing the items deletes their geometries');

select * from finish();
rollback;
