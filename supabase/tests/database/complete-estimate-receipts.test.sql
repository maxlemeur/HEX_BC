-- Before receipt implementation: exact IDs and one invocation of each write, above 1 000 items.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();
set local statement_timeout = '60s';
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','10001000-0000-4000-8000-000000000001',
  'authenticated','authenticated','army-pagination@example.test',crypt('test-password',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
select set_config('test.pagination_tenant',(select tenant_id::text from public.tenant_memberships
  where user_id='10001000-0000-4000-8000-000000000001' and is_default),true);
insert into public.estimate_projects(id,tenant_id,user_id,name) values
  ('10001000-0000-4000-8000-000000000010',current_setting('test.pagination_tenant')::uuid,'10001000-0000-4000-8000-000000000001','ARMY pagination');
insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version) values
  ('10001000-0000-4000-8000-000000000011',current_setting('test.pagination_tenant')::uuid,'10001000-0000-4000-8000-000000000010',1,2),
  ('10001000-0000-4000-8000-000000000012',current_setting('test.pagination_tenant')::uuid,'10001000-0000-4000-8000-000000000010',2,2);
insert into public.estimate_templates(id,tenant_id,created_by,name) values
  ('10001000-0000-4000-8000-000000000020',current_setting('test.pagination_tenant')::uuid,'10001000-0000-4000-8000-000000000001','ARMY large template');
insert into public.estimate_template_items(id,tenant_id,template_id,item_type,position,title) values
  ('10001000-0000-4000-8000-000000000021',current_setting('test.pagination_tenant')::uuid,
   '10001000-0000-4000-8000-000000000020','section',1,'ARMY lot');
insert into public.estimate_template_items(tenant_id,template_id,parent_id,item_type,position,title,description,quantity,
  unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
select current_setting('test.pagination_tenant')::uuid,'10001000-0000-4000-8000-000000000020','10001000-0000-4000-8000-000000000021','line',n,'ARMY item '||n,'u',1,100,2000,1,0,1,100,100,20,120
from generate_series(1,1001) n;
-- An allowed shallow tree: 21 children x 50 components, beyond 1 000 rows.
insert into public.estimate_assemblies(id,tenant_id,created_by,name) values
  ('10001000-0000-4000-8000-000000000030',current_setting('test.pagination_tenant')::uuid,'10001000-0000-4000-8000-000000000001','ARMY root');
insert into public.estimate_assemblies(id,tenant_id,created_by,name)
select md5('pg1000-child-'||n)::uuid,current_setting('test.pagination_tenant')::uuid,
  '10001000-0000-4000-8000-000000000001','ARMY child '||n from generate_series(1,21) n;
insert into public.estimate_assembly_members(tenant_id,parent_assembly_id,child_assembly_id,position,quantity)
select current_setting('test.pagination_tenant')::uuid,'10001000-0000-4000-8000-000000000030',
  md5('pg1000-child-'||n)::uuid,n,1 from generate_series(1,21) n;
insert into public.estimate_assembly_items(tenant_id,assembly_id,title,unit,position,default_quantity,unit_cost_ht_cents)
select current_setting('test.pagination_tenant')::uuid,md5('pg1000-child-'||child)::uuid,
  'ARMY component '||child||'/'||n,'u',n,1,100
from generate_series(1,21) child cross join generate_series(1,50) n;
-- Give the planner the real fixture cardinalities, including in a file-only run.
analyze public.tenant_memberships;
analyze public.estimate_projects;
analyze public.estimate_versions;
analyze public.estimate_templates;
analyze public.estimate_template_items;
analyze public.estimate_assemblies;
analyze public.estimate_assembly_items;
analyze public.estimate_assembly_members;
create temporary table pg_receipts(kind text primary key,body jsonb);
grant all on pg_receipts to authenticated;
select set_config('request.jwt.claims','{"sub":"10001000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
insert into pg_receipts values ('template',public.insert_estimate_template_with_receipt(
  '10001000-0000-4000-8000-000000000011','10001000-0000-4000-8000-000000000020',null));
select is((select (body->>'count')::integer from pg_receipts where kind='template'),1002,'receipt counts the section and all 1001 inserted lines');
select is((select jsonb_array_length(body->'items') from pg_receipts where kind='template'),1002,'JSON contains all rows rather than a PostgREST rowset');
select is((select count(*)::integer from public.estimate_items where version_id='10001000-0000-4000-8000-000000000011'),1002,'the insertion executes once');
select results_eq(
  $$select x->>'id' from pg_receipts r cross join lateral jsonb_array_elements(r.body->'items') x where kind='template' order by 1$$,
  $$select id::text from public.estimate_items where version_id='10001000-0000-4000-8000-000000000011' order by 1$$,
  'returned IDs exactly equal persisted IDs');
insert into pg_receipts values ('assembly',public.insert_estimate_assembly_with_receipt(
  '10001000-0000-4000-8000-000000000012','10001000-0000-4000-8000-000000000030',null));
select cmp_ok((select (body->>'count')::integer from pg_receipts where kind='assembly'),'>',1000,'assembly receipt exceeds the rowset cap');
select is((select count(*)::integer from public.estimate_items where version_id='10001000-0000-4000-8000-000000000012' and item_type='line'),1050,'all 1050 components are inserted once');
select is((select jsonb_array_length(body->'items') from pg_receipts where kind='assembly'),
  (select count(*)::integer from public.estimate_items where version_id='10001000-0000-4000-8000-000000000012'),'assembly JSON includes every section and component');
select results_eq(
  $$select x->>'id' from pg_receipts r cross join lateral jsonb_array_elements(r.body->'items') x where kind='assembly' order by 1$$,
  $$select id::text from public.estimate_items where version_id='10001000-0000-4000-8000-000000000012' order by 1$$,
  'assembly returned IDs exactly equal persisted IDs');
reset role;
select ok(not has_function_privilege('anon','public.insert_estimate_template_with_receipt(uuid,uuid,uuid)','execute'),'anon cannot call template writer');
select ok(not has_function_privilege('anon','public.insert_estimate_assembly_with_receipt(uuid,uuid,uuid)','execute'),'anon cannot call assembly writer');
select finish();
rollback;
