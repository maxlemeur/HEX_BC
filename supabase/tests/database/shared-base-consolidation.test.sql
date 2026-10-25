-- Lot 3.3: real roles, stored approvals, Vault fixture and future ACL defaults.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select is((select count(*)::integer from pg_proc
  where pronamespace = 'public'::regnamespace and prokind = 'f'
    and has_function_privilege('anon', oid, 'execute')), 0,
  'no public function is executable by anon, including invokers and overloads');
select is((select count(*)::integer from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
  where p.pronamespace = 'public'::regnamespace and a.grantee = 0
    and a.privilege_type = 'EXECUTE'), 0, 'PUBLIC has no execute grant');

-- Creating a function is the counterexample to a one-time REVOKE sweep.
create function public.lot33_future_rpc() returns integer language sql as 'select 33';
select ok(not has_function_privilege('anon','public.lot33_future_rpc()','execute'),
  'new public functions do not reopen anonymous access');
select ok(has_function_privilege('authenticated','public.lot33_future_rpc()','execute'),
  'new public functions preserve the authenticated default');
select ok(has_function_privilege('service_role','public.lot33_future_rpc()','execute'),
  'new public functions preserve the service default');
set local role anon;
select throws_ok('select public.lot33_future_rpc()', '42501',
  'permission denied for function lot33_future_rpc', 'anonymous execution is refused');
reset role;
set local role authenticated;
select is(public.lot33_future_rpc(),33,'signed-in execution still works');
reset role;

-- No real secret is read; Vault writes and the function disappear on rollback.
select vault.create_secret('fictional-lot33-worker-value','lot33-fictional-worker');
set local role anon;
select throws_ok($$select public.get_takeoff_secret('lot33-fictional-worker')$$,
  '42501','permission denied for function get_takeoff_secret','anon cannot read worker secrets');
reset role;
set local role authenticated;
select throws_ok($$select public.get_takeoff_secret('lot33-fictional-worker')$$,
  '42501','permission denied for function get_takeoff_secret','signed-in users cannot read worker secrets');
reset role;
set local role service_role;
select is(public.get_takeoff_secret('lot33-fictional-worker'),'fictional-lot33-worker-value',
  'the worker can read its synthetic Vault secret on a fresh database');
select is(public.get_takeoff_secret('lot33-missing-secret'),null::text,'a missing secret stays null');
select throws_ok('select public.insert_estimate_template_into_version(null,null,null)',
  '42501','permission denied for function insert_estimate_template_into_version','service cannot insert a template');
select throws_ok('select public.insert_estimate_assembly_into_version(null,null,null)',
  '42501','permission denied for function insert_estimate_assembly_into_version','service cannot insert an assembly');
select throws_ok('select public.insert_estimate_template_with_receipt(null,null,null)',
  '42501','permission denied for function insert_estimate_template_with_receipt','service cannot call the template wrapper');
select throws_ok('select public.insert_estimate_assembly_with_receipt(null,null,null)',
  '42501','permission denied for function insert_estimate_assembly_with_receipt','service cannot call the assembly wrapper');
reset role;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','33000000-0000-4000-8000-000000000001',
  'authenticated','authenticated','lot33@example.test',crypt('test-password',gen_salt('bf')),now(),
  '{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
select set_config('test.lot33_tenant',(select tenant_id::text from public.tenant_memberships
  where user_id='33000000-0000-4000-8000-000000000001' and is_default),true);
insert into public.estimate_projects(id,tenant_id,user_id,name) values
  ('33000000-0000-4000-8000-000000000010',current_setting('test.lot33_tenant')::uuid,
   '33000000-0000-4000-8000-000000000001','Lot 3.3 fictional approval');
insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version) values
  ('33000000-0000-4000-8000-000000000011',current_setting('test.lot33_tenant')::uuid,
   '33000000-0000-4000-8000-000000000010',1,2),
  ('33000000-0000-4000-8000-000000000012',current_setting('test.lot33_tenant')::uuid,
   '33000000-0000-4000-8000-000000000010',2,2);
insert into public.estimate_rules(id,tenant_id,rule_type,threshold_value,action) values
  ('33000000-0000-4000-8000-000000000020',current_setting('test.lot33_tenant')::uuid,
   'require_approval',100,'require_approval');

select throws_ok($sql$insert into public.estimate_approvals(tenant_id,version_id,rule_id,requested_by,status,approved_by)
  values(current_setting('test.lot33_tenant')::uuid,'33000000-0000-4000-8000-000000000011',
    '33000000-0000-4000-8000-000000000020','33000000-0000-4000-8000-000000000001',
    'pending','33000000-0000-4000-8000-000000000001')$sql$,
  '23514','ESTIMATE_APPROVAL_PENDING_INVALID','pending cannot already have a decider');
select throws_ok($sql$insert into public.estimate_approvals(tenant_id,version_id,rule_id,requested_by,status,decided_at)
  values(current_setting('test.lot33_tenant')::uuid,'33000000-0000-4000-8000-000000000011',
    '33000000-0000-4000-8000-000000000020','33000000-0000-4000-8000-000000000001',
    'pending',now())$sql$,
  '23514','ESTIMATE_APPROVAL_PENDING_INVALID','pending cannot carry a decision time');
select throws_ok($sql$insert into public.estimate_approvals(tenant_id,version_id,rule_id,requested_by,status)
  values(current_setting('test.lot33_tenant')::uuid,'33000000-0000-4000-8000-000000000011',
    '33000000-0000-4000-8000-000000000020','33000000-0000-4000-8000-000000000001','approved')$sql$,
  '23514','ESTIMATE_APPROVAL_DECISION_INVALID','a decided approval needs both fields');
insert into public.estimate_approvals(tenant_id,version_id,rule_id,requested_by,status)
values(current_setting('test.lot33_tenant')::uuid,'33000000-0000-4000-8000-000000000011',
  '33000000-0000-4000-8000-000000000020','33000000-0000-4000-8000-000000000001','pending');
select is((select count(*)::integer from public.estimate_approvals where
  version_id='33000000-0000-4000-8000-000000000011' and status='pending'
  and approved_by is null and decided_at is null),1,'a legitimate pending approval is stored');

select set_config('request.jwt.claims','{"sub":"33000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
insert into public.estimate_explanations(id,tenant_id,project_id,version_id,compare_version_id,explanation_kind,
  snapshot_fingerprint,summary_short,summary_detail,confidence_label)
values ('33000000-0000-4000-8000-000000000030','33000000-0000-4000-8000-000000000099',
  '33000000-0000-4000-8000-000000000098','33000000-0000-4000-8000-000000000011',
  '33000000-0000-4000-8000-000000000012','delta','lot33-fictional','Fictional','Fictional','low');
select is((select tenant_id from public.estimate_explanations where
  id='33000000-0000-4000-8000-000000000030'),current_setting('test.lot33_tenant')::uuid,
  'the canonical invoker derives the tenant from the accessible version');
select is((select project_id from public.estimate_explanations where
  id='33000000-0000-4000-8000-000000000030'),'33000000-0000-4000-8000-000000000010'::uuid,
  'a caller-supplied project cannot override the version scope');
insert into public.estimate_explanation_sources(explanation_id,source_kind,label)
values ('33000000-0000-4000-8000-000000000030','fixture','Lot 3.3 fictional source');
select is((select count(*)::integer from public.estimate_explanation_sources where
  explanation_id='33000000-0000-4000-8000-000000000030'),1,'explanation provenance remains writable under RLS');
reset role;

select finish();
rollback;
