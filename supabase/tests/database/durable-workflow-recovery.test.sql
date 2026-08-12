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
  updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'durable-workflow@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Durable Workflow Test","role":"buyer"}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, full_name, role)
values (
  '10000000-0000-4000-8000-000000000001',
  'Durable Workflow Test',
  'buyer'
)
on conflict (id) do nothing;

insert into public.tenants (id, name, slug, created_by)
values
  (
    '20000000-0000-4000-8000-000000000001',
    'Durable Active',
    'durable-active-test',
    '10000000-0000-4000-8000-000000000001'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Durable Inactive',
    'durable-inactive-test',
    '10000000-0000-4000-8000-000000000001'
  );

insert into public.estimate_projects (id, tenant_id, user_id, name)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Durable Active Project'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Durable Inactive Project'
  );

insert into public.estimate_versions (id, tenant_id, project_id, version_number)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    1
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    1
  );

insert into public.affaire_intake_uploads (id, tenant_id, project_id, status)
values
  (
    '50000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'queued'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'queued'
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'queued'
  ),
  (
    '50000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'processing'
  ),
  (
    '50000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'processing'
  ),
  (
    '50000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    'processing'
  );

insert into public.affaire_intake_documents (
  id,
  tenant_id,
  project_id,
  upload_id,
  file_name,
  classification_status
) values
  (
    '51000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'interrupted.pdf',
    'processing'
  ),
  (
    '51000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000004',
    'exhausted.pdf',
    'processing'
  );

update public.affaire_intake_uploads
set
  attempt_count = 3,
  processing_lease_token = '60000000-0000-4000-8000-000000000004',
  processing_lease_expires_at = '2026-08-12 08:30:00+00'
where id = '50000000-0000-4000-8000-000000000004';

update public.affaire_intake_uploads
set
  processing_lease_token = case id
    when '50000000-0000-4000-8000-000000000005'::uuid
      then '60000000-0000-4000-8000-000000000005'::uuid
    else '60000000-0000-4000-8000-000000000006'::uuid
  end,
  processing_lease_expires_at = case id
    when '50000000-0000-4000-8000-000000000005'::uuid
      then '2026-08-12 09:00:00+00'::timestamptz
    else '2026-08-12 09:10:00+00'::timestamptz
  end
where id in (
  '50000000-0000-4000-8000-000000000005',
  '50000000-0000-4000-8000-000000000006'
);

insert into public.takeoff_jobs (
  id,
  tenant_id,
  estimate_version_id,
  level,
  status,
  processing_strategy,
  started_at,
  processing_lease_token,
  processing_lease_expires_at
) values
  (
    '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'A',
    'processing',
    'sync',
    '2026-08-12 08:00:00+00',
    '80000000-0000-4000-8000-000000000001',
    '2026-08-12 08:30:00+00'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    'A',
    'processing',
    'sync',
    '2026-08-12 08:00:00+00',
    '80000000-0000-4000-8000-000000000002',
    '2026-08-12 08:30:00+00'
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'A',
    'processing',
    'batch',
    '2026-08-12 08:00:00+00',
    null,
    null
  );

update public.takeoff_jobs
set
  provider_batch_id = 'batch-durable-test',
  provider_batch_state = 'running',
  provider_reconcile_lease_token = '80000000-0000-4000-8000-000000000003',
  provider_reconcile_lease_expires_at = '2026-08-12 09:05:00+00'
where id = '70000000-0000-4000-8000-000000000003';

update public.tenants
set is_active = false
where id = '20000000-0000-4000-8000-000000000002';

select is(
  (
    select claimed
    from public.claim_affaire_intake_upload(
      '50000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000002',
      '2026-08-12 09:00:00+00',
      '2026-08-12 09:10:00+00'
    )
  ),
  false,
  'a suspended tenant cannot claim intake work'
);

select is(
  (
    select reason
    from public.claim_affaire_intake_upload(
      '50000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      '2026-08-12 09:00:00+00',
      '2026-08-12 09:10:00+00'
    )
  ),
  'claimed',
  'the first active worker atomically claims intake work'
);

select is(
  (
    select claimed
    from public.claim_affaire_intake_upload(
      '50000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000003',
      '2026-08-12 09:00:01+00',
      '2026-08-12 09:10:01+00'
    )
  ),
  false,
  'a concurrent worker cannot claim a live intake lease'
);

select is(
  (
    select classification_status
    from public.affaire_intake_documents
    where id = '51000000-0000-4000-8000-000000000001'
  ),
  'failed',
  'a reclaimed queued attempt resets interrupted document processing state'
);

select is(
  (
    select reason
    from public.claim_affaire_intake_upload(
      '50000000-0000-4000-8000-000000000004',
      '60000000-0000-4000-8000-000000000044',
      '2026-08-12 09:00:00+00',
      '2026-08-12 09:10:00+00',
      3
    )
  ),
  'attempts_exhausted',
  'an expired final intake attempt is terminalized'
);

select results_eq(
  $$
    select upload.status, document.classification_status
    from public.affaire_intake_uploads as upload
    join public.affaire_intake_documents as document
      on document.upload_id = upload.id
    where upload.id = '50000000-0000-4000-8000-000000000004'
  $$,
  $$ values ('failed'::text, 'failed'::text) $$,
  'attempt exhaustion terminalizes both the upload and its interrupted document'
);

select is(
  public.finish_affaire_intake_upload_attempt(
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000003',
    'ready',
    '2026-08-12 09:01:00+00'
  ),
  false,
  'a stale worker cannot finish another worker lease'
);

select is(
  public.finish_affaire_intake_upload_attempt(
    '50000000-0000-4000-8000-000000000005',
    '60000000-0000-4000-8000-000000000005',
    'failed',
    '2026-08-12 09:01:00+00',
    null,
    'expired worker'
  ),
  false,
  'a lease owner cannot finish intake work after its lease expires'
);

select is(
  public.finish_affaire_intake_upload_attempt(
    '50000000-0000-4000-8000-000000000006',
    '60000000-0000-4000-8000-000000000006',
    'failed',
    '2026-08-12 09:01:00+00',
    null,
    'suspended tenant'
  ),
  false,
  'a suspended tenant cannot persist an intake attempt result'
);

select is(
  public.finish_affaire_intake_upload_attempt(
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'ready',
    '2026-08-12 09:01:00+00'
  ),
  true,
  'the lease owner can finish intake work exactly once'
);

select ok(
  exists (
    select 1
    from public.list_due_durable_workflows('2026-08-12 09:00:00+00', 20)
    where workflow_kind = 'affaire_intake'
      and work_id = '50000000-0000-4000-8000-000000000003'
  ),
  'active queued intake work is listed as due'
);

select ok(
  not exists (
    select 1
    from public.list_due_durable_workflows('2026-08-12 09:00:00+00', 20)
    where work_id = '50000000-0000-4000-8000-000000000002'
  ),
  'inactive tenant work is omitted from durable dispatch'
);

select is(
  public.renew_takeoff_processing_lease(
    '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    '2026-08-12 08:15:00+00',
    '2026-08-12 08:45:00+00'
  ),
  true,
  'the live synchronous owner can renew its lease'
);

select is(
  public.renew_takeoff_processing_lease(
    '70000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000099',
    '2026-08-12 08:16:00+00',
    '2026-08-12 08:46:00+00'
  ),
  false,
  'a stale synchronous worker cannot renew another lease'
);

select is(
  public.renew_takeoff_batch_reconcile_lease(
    '70000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000003',
    '2026-08-12 09:00:00+00',
    '2026-08-12 09:05:00+00'
  ),
  true,
  'the batch owner renews beyond the provider poll timeout'
);

select is(
  public.persist_takeoff_provider_batch_snapshot_fenced(
    '70000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'gemini', 'batch', 'batch-durable-test', 'running',
    '2026-08-12 09:00:00+00', 'JOB_STATE_RUNNING', null, '{}'::jsonb,
    true, true, null, '80000000-0000-4000-8000-000000000099',
    '2026-08-12 09:00:00+00'
  ),
  false,
  'a stale batch worker cannot mutate the provider snapshot or event log'
);

select is(
  (select count(*)::integer from public.takeoff_job_provider_events where takeoff_job_id = '70000000-0000-4000-8000-000000000003'),
  0,
  'a rejected fenced mutation leaves no provider event'
);

create temporary table recovered_takeoff on commit drop as
select *
from public.recover_stale_takeoff_jobs(
  '2026-08-12 09:00:00+00',
  interval '10 minutes'
);

select is(
  (select count(*)::integer from recovered_takeoff),
  2,
  'all stale synchronous work is cleaned up regardless of tenant activity'
);

select is(
  (
    select error_code
    from public.takeoff_jobs
    where id = '70000000-0000-4000-8000-000000000001'
  ),
  'TAKEOFF_WORKER_OUTCOME_UNKNOWN',
  'stale synchronous takeoff outcome requires manual review'
);

select is(
  (
    select status::text
    from public.takeoff_jobs
    where id = '70000000-0000-4000-8000-000000000002'
  ),
  'failed',
  'inactive stale takeoff work is cleaned up without becoming dispatchable'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_affaire_intake_upload(uuid,uuid,timestamptz,timestamptz,integer)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.claim_affaire_intake_upload(uuid,uuid,timestamptz,timestamptz,integer)',
    'EXECUTE'
  ),
  'intake claim is service-role only'
);

select * from finish();
rollback;
