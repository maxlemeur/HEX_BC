begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '9c000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'chatgpt-takeoff@example.test', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select '9c000000-0000-4000-8000-000000000010', tenant_id, user_id, 'Local plan test', false
from public.tenant_memberships where user_id = '9c000000-0000-4000-8000-000000000001';
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status,
  calc_engine_version, margin_multiplier, tax_rate_bp, discount_amount_cents)
select '9c000000-0000-4000-8000-000000000011', tenant_id, id, 1, 'draft', 2, 1, 0, 0
from public.estimate_projects where id = '9c000000-0000-4000-8000-000000000010';
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status,
  source_file_name, created_by, execution_provider, execution_host_id, processing_strategy)
select f.id, v.tenant_id, v.id, 'A', 'pending', 'fictional.csv',
  '9c000000-0000-4000-8000-000000000001', f.provider, f.host, 'sync'
from public.estimate_versions v cross join (values
  ('9c000000-0000-4000-8000-000000000021'::uuid, 'chatgpt_local', 'urn:uuid:9c000000-0000-4000-8000-000000000099'),
  ('9c000000-0000-4000-8000-000000000022'::uuid, 'gemini', null)
) f(id, provider, host) where v.id = '9c000000-0000-4000-8000-000000000011';

select is((select count(*) from public.list_due_durable_workflows(now(), 100)
  where work_id = '9c000000-0000-4000-8000-000000000021'), 0::bigint, 'shared cron excludes local plan jobs');
select is((select count(*) from public.list_due_durable_workflows(now(), 100)
  where work_id = '9c000000-0000-4000-8000-000000000022'), 1::bigint, 'shared cron retains Gemini jobs');
set local role service_role;
select throws_ok($$update public.takeoff_jobs set status = 'processing'
  where id = '9c000000-0000-4000-8000-000000000021'$$,
  '42501', 'TAKEOFF_LOCAL_CLAIM_REQUIRED', 'old service-role worker cannot claim a local job');
select throws_ok($$update public.takeoff_jobs set execution_provider = 'gemini', execution_host_id = null
  where id = '9c000000-0000-4000-8000-000000000021'$$,
  '42501', 'TAKEOFF_EXECUTION_OWNER_IMMUTABLE', 'provider cannot change even with service_role');
select is((select count(*) from public.claim_local_takeoff_job(
  '9c000000-0000-4000-8000-000000000021',
  (select tenant_id from public.takeoff_jobs where id = '9c000000-0000-4000-8000-000000000021'),
  'urn:uuid:9c000000-0000-4000-8000-000000000098', now(), gen_random_uuid(), now() + interval '10 minutes',
  'plan-model', 'v1')), 0::bigint, 'other Mac cannot claim the job');
select is((select count(*) from public.claim_local_takeoff_job(
  '9c000000-0000-4000-8000-000000000021',
  (select tenant_id from public.takeoff_jobs where id = '9c000000-0000-4000-8000-000000000021'),
  'urn:uuid:9c000000-0000-4000-8000-000000000099', now(), gen_random_uuid(), now() + interval '10 minutes',
  'plan-model', 'v1')), 1::bigint, 'owning Mac claims exactly once');
select is((select model from public.takeoff_jobs where id = '9c000000-0000-4000-8000-000000000021'),
  'plan-model', 'local claim persists the selected model');
select is(current_setting('app.local_takeoff_claim_job', true), '', 'claim scope cleared before returning');
select lives_ok($$update public.takeoff_jobs set processing_lease_expires_at = now() + interval '20 minutes'
  where id = '9c000000-0000-4000-8000-000000000021'$$, 'local processing lease can renew');
update public.takeoff_jobs set status = 'failed', error_code = 'OUTCOME_UNKNOWN', next_retry_at = null
where id = '9c000000-0000-4000-8000-000000000021';
select is((select count(*) from public.claim_local_takeoff_job(
  '9c000000-0000-4000-8000-000000000021',
  (select tenant_id from public.takeoff_jobs where id = '9c000000-0000-4000-8000-000000000021'),
  'urn:uuid:9c000000-0000-4000-8000-000000000099', now(), gen_random_uuid(), now() + interval '10 minutes',
  'plan-model', 'v1')), 1::bigint, 'manual recovery stays on owning Mac');
select is((select retry_count from public.takeoff_jobs where id = '9c000000-0000-4000-8000-000000000021'),
  1, 'recovery increments retry count');
select lives_ok($$update public.takeoff_jobs set status = 'canceled'
  where id = '9c000000-0000-4000-8000-000000000021'$$, 'local job remains cancellable');
reset role;
select ok(not has_function_privilege('authenticated',
  'public.claim_local_takeoff_job(uuid,uuid,text,timestamptz,uuid,timestamptz,text,text)', 'EXECUTE'),
  'authenticated callers cannot use the local worker claim');
select * from finish();
rollback;
