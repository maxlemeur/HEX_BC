begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('8f400000-0000-4000-8000-000000000001', 'takeoff-requester@example.test', now(), '{}', '{}'),
  ('8f400000-0000-4000-8000-000000000002', 'takeoff-colleague@example.test', now(), '{}', '{}');

create temporary table completion_fixture as
select tenant_id from public.tenant_memberships where user_id = '8f400000-0000-4000-8000-000000000001';

insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
select tenant_id, '8f400000-0000-4000-8000-000000000002', 'director', false
from completion_fixture;

insert into public.estimate_projects (id, tenant_id, user_id, name)
select '8f400000-0000-4000-8000-000000000010', tenant_id,
  '8f400000-0000-4000-8000-000000000001', 'Affaire fictive'
from completion_fixture;

insert into public.estimate_versions (id, tenant_id, project_id, version_number, status)
select '8f400000-0000-4000-8000-000000000011', tenant_id,
  '8f400000-0000-4000-8000-000000000010', 1, 'draft'
from completion_fixture;

insert into public.takeoff_jobs (
  id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id
)
select x.id, f.tenant_id, '8f400000-0000-4000-8000-000000000011', 'A',
  '8f400000-0000-4000-8000-000000000001', 'chatgpt_local', 'urn:uuid:8f400000-0000-4000-8000-000000000099'
from completion_fixture f
cross join (values
  ('8f400000-0000-4000-8000-000000000021'::uuid),
  ('8f400000-0000-4000-8000-000000000022'::uuid),
  ('8f400000-0000-4000-8000-000000000023'::uuid),
  ('8f400000-0000-4000-8000-000000000024'::uuid),
  ('8f400000-0000-4000-8000-000000000025'::uuid)
) as x(id);

select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000021', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture');
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000022', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now() - interval '2 hours', gen_random_uuid(), now() - interval '1 hour', 'fixture', 'fixture');
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000024', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture');
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000025', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture');

update public.takeoff_jobs set status = 'completed'
where id = '8f400000-0000-4000-8000-000000000024';
select is((select count(*) from public.takeoff_completion_notifications), 0::bigint, 'activation is opt-in');

-- Replay pre-M3 writes with the activation row absent.
do $$
declare
  suffix text;
  fixture_job_id uuid;
begin
  foreach suffix in array array['81','82','83','84','85','86','87','88','89'] loop
    fixture_job_id := ('8f400000-0000-4000-8000-0000000000' || suffix)::uuid;
    insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
    select fixture_job_id, tenant_id, '8f400000-0000-4000-8000-000000000011', 'A',
      (case when suffix in ('81','82','84','89') then '8f400000-0000-4000-8000-000000000001'
        else '8f400000-0000-4000-8000-000000000002' end)::uuid,
      'chatgpt_local', 'urn:uuid:8f400000-0000-4000-8000-000000000099'
    from completion_fixture;
    if suffix <> '89' then
      update public.takeoff_jobs set status = 'failed' where id = fixture_job_id;
    end if;
  end loop;
end;
$$;
update public.takeoff_jobs set created_at = now() - interval '20 minutes'
where id = '8f400000-0000-4000-8000-000000000089';

update public.takeoff_jobs set status = 'failed', next_retry_at = now() - interval '1 minute'
where id = '8f400000-0000-4000-8000-000000000081';
select set_config('request.jwt.claim.sub', '8f400000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok($$update public.takeoff_jobs set status = 'pending', retry_count = retry_count + 1,
    next_retry_at = null, last_error_at = null, started_at = null, completed_at = null,
    token_count = null, cost_cents = null, duration_ms = null, error_code = null, error_message = null
  where id = '8f400000-0000-4000-8000-000000000081'$$, 'before activation the old operator can reset an elapsed retry');
reset role;
update public.takeoff_jobs set status = 'failed', retry_count = 0, next_retry_at = now() + interval '1 hour'
where id = '8f400000-0000-4000-8000-000000000081';
select is((select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000081', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture')), 1::bigint,
  'before activation the claim RPC retains its old early-retry response');
update public.takeoff_jobs set status = 'failed', retry_count = 3, next_retry_at = now() - interval '1 second',
  processing_lease_token = null, processing_lease_expires_at = null
where id = '8f400000-0000-4000-8000-000000000081';
select is((select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000081', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture')), 1::bigint,
  'before activation the claim RPC retains its old exhausted-retry response');
update public.takeoff_jobs set status = 'failed', next_retry_at = null,
  processing_lease_token = null, processing_lease_expires_at = null
where id = '8f400000-0000-4000-8000-000000000081';
update public.takeoff_jobs set status = 'pending' where id = '8f400000-0000-4000-8000-000000000083';
update public.takeoff_jobs set status = 'canceled', completed_at = now()
where id = '8f400000-0000-4000-8000-000000000083';
select lives_ok($$update public.takeoff_jobs set status = 'pending', completed_at = null
  where id = '8f400000-0000-4000-8000-000000000083'$$, 'before activation the old operator can resubmit a canceled job');
update public.takeoff_jobs set status = 'failed'
where id = '8f400000-0000-4000-8000-000000000083' and status = 'pending';

update public.takeoff_jobs set status = 'pending' where id = '8f400000-0000-4000-8000-000000000085';
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000085', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now() - interval '2 hours', gen_random_uuid(), now() - interval '90 minutes', 'fixture', 'fixture');
-- The later active-recovery fixture has an expiry an hour ago.
set local role service_role;
select is((select job_id from public.recover_stale_local_takeoff_jobs(now() - interval '75 minutes')),
  '8f400000-0000-4000-8000-000000000085'::uuid, 'before activation the existing recovery returns the old worker failure');
reset role;
select is((select error_message from public.takeoff_jobs where id = '8f400000-0000-4000-8000-000000000085'),
  'Le worker a expire pendant un appel dont le resultat fournisseur est inconnu. Une reprise manuelle est requise.',
  'before activation lost-worker recovery keeps the old diagnostic');
select lives_ok($$update public.takeoff_jobs set status = 'pending', completed_at = null
  where id = '8f400000-0000-4000-8000-000000000085'$$, 'before activation a recovered job can be resubmitted');
update public.takeoff_jobs set status = 'failed' where id = '8f400000-0000-4000-8000-000000000085';

update public.takeoff_jobs set status = 'pending' where id = '8f400000-0000-4000-8000-000000000086';
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000086', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now() - interval '40 minutes', gen_random_uuid(), now() - interval '30 minutes', 'fixture', 'fixture');
select lives_ok($$update public.takeoff_jobs set status = 'completed'
  where id = '8f400000-0000-4000-8000-000000000086'$$, 'before activation the old worker can complete after expiry');

update public.takeoff_jobs set status = 'pending' where id = '8f400000-0000-4000-8000-000000000087';
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000087', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture');
update public.takeoff_jobs set status = 'failed', error_code = 'AI_PROVIDER', processing_lease_token = null,
  processing_lease_expires_at = null where id = '8f400000-0000-4000-8000-000000000087';
select lives_ok($$update public.takeoff_jobs set last_error_at = now(), next_retry_at = null
  where id = '8f400000-0000-4000-8000-000000000087'$$, 'before activation the old scheduler can write after failure');
-- Two callbacks of this application read the same row; one is stopped between
-- its read and its claim. The deployed claim would still accept the row. The
-- colleague creates these jobs: the requester's admission budget is spent.
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select x.id, f.tenant_id, '8f400000-0000-4000-8000-000000000011', 'A', '8f400000-0000-4000-8000-000000000002',
  'chatgpt_local', 'urn:uuid:8f400000-0000-4000-8000-000000000099'
from completion_fixture f
cross join (values ('8f400000-0000-4000-8000-000000000091'::uuid), ('8f400000-0000-4000-8000-000000000092'::uuid),
  ('8f400000-0000-4000-8000-000000000093'::uuid)) as x(id);
-- The worker's role reads the fixture's tenant like the processor reads its job.
grant select on completion_fixture to service_role;
set local role service_role;
select throws_ok($$select * from public.claim_observed_local_takeoff_job('8f400000-0000-4000-8000-000000000091',
    (select tenant_id from completion_fixture), 'urn:uuid:8f400000-0000-4000-8000-000000000099', now(), gen_random_uuid(),
    now() + interval '1 hour', 'fixture', 'fixture', 'processing', 0)$$,
  '22023', 'TAKEOFF_LOCAL_CLAIM_INVALID', 'a claim names the pending or failed state it observed');
select is((select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000091', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), 'aaaaaaaa-0000-4000-8000-000000000091', now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)), 1::bigint,
  'the first callback claims the pending attempt it observed');
select ok(public.record_local_takeoff_failure('8f400000-0000-4000-8000-000000000091', (select tenant_id from completion_fixture),
  'aaaaaaaa-0000-4000-8000-000000000091', jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5,
    'error_code', 'AI_PROVIDER', 'error_message', 'Fixture provider failure', 'analysis_outcome', 'failure',
    'last_error_at', clock_timestamp(), 'next_retry_at', null),
  '{"extracted_json": {}, "warnings": [], "tables": [], "provider_meta": {"status": "failed"}, "raw_response": {"fixture": true},
    "token_count": 0, "cost_cents": 0, "duration_ms": 5}') is not null, 'the leased worker records its definitive failure');
select is((select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000091', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)), 0::bigint,
  'a callback delayed after reading pending starts no attempt after a definitive failure');
select results_eq($$select status::text, retry_count, error_code, processing_lease_token is null,
    (select count(*) from public.takeoff_results r where r.job_id = j.id and r.provider_meta ->> 'status' = 'failed')
  from public.takeoff_jobs j where j.id = '8f400000-0000-4000-8000-000000000091'$$,
  $$values ('failed'::text, 0, 'AI_PROVIDER'::text, true, 1::bigint)$$,
  'the failure, its diagnostic and the released lease commit together');

select is((select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000092', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), 'aaaaaaaa-0000-4000-8000-000000000092', now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)), 1::bigint,
  'a callback claims a pending attempt');
select ok(public.record_local_takeoff_failure('8f400000-0000-4000-8000-000000000092', (select tenant_id from completion_fixture),
  'aaaaaaaa-0000-4000-8000-000000000092', jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5,
    'error_code', 'AI_TIMEOUT', 'error_message', 'Fixture timeout', 'analysis_outcome', null,
    'last_error_at', clock_timestamp(), 'next_retry_at', clock_timestamp() + interval '15 seconds')) is not null,
  'the leased worker schedules its retry with its failure');
select is((select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000092', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)), 0::bigint,
  'a callback delayed after reading pending cannot consume the scheduled retry early');
reset role;
update public.takeoff_jobs set next_retry_at = clock_timestamp() - interval '1 second'
where id = '8f400000-0000-4000-8000-000000000092';
set local role service_role;
select is((select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000092', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), 'aaaaaaaa-0000-4000-8000-000000000192', now() + interval '1 hour', 'fixture', 'fixture', 'failed', 0)), 1::bigint,
  'the due retry is claimed from the attempt its callback observed');
select ok(public.record_local_takeoff_failure('8f400000-0000-4000-8000-000000000092', (select tenant_id from completion_fixture),
  'aaaaaaaa-0000-4000-8000-000000000192', jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5,
    'error_code', 'AI_TIMEOUT', 'error_message', 'Fixture timeout', 'analysis_outcome', null,
    'last_error_at', clock_timestamp(), 'next_retry_at', clock_timestamp() - interval '1 second')) is not null,
  'the retried attempt fails again with a due schedule');
select is((select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000092', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture', 'failed', 0)), 0::bigint,
  'a second callback of the same due retry cannot spend the next attempt');
select is((select retry_count from public.takeoff_jobs where id = '8f400000-0000-4000-8000-000000000092'), 1,
  'one due retry spends one attempt');

-- A worker stopped after its failure renewal: the recovery closes it, the
-- previous application relaunches the job and another worker succeeds.
select is((select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000093', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), 'aaaaaaaa-0000-4000-8000-000000000093', now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)), 1::bigint,
  'the first worker claims the job');
reset role;
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second'
where id = '8f400000-0000-4000-8000-000000000093';
set local role service_role;
select is(public.record_local_takeoff_failure('8f400000-0000-4000-8000-000000000093', (select tenant_id from completion_fixture),
  'aaaaaaaa-0000-4000-8000-000000000093', jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5,
    'error_code', 'AI_PROVIDER', 'error_message', 'Fixture', 'analysis_outcome', 'failure', 'last_error_at', clock_timestamp())),
  null, 'an expired lease cannot record a failure');
reset role;
-- The deployed recovery's statement, then the previous application's relaunch
-- once its backoff after that recovery has elapsed.
update public.takeoff_jobs set status = 'failed', completed_at = now() - interval '1 minute', next_retry_at = null,
  last_error_at = now() - interval '1 minute',
  error_code = 'TAKEOFF_WORKER_OUTCOME_UNKNOWN', error_message = 'Fixture recovery',
  processing_lease_token = null, processing_lease_expires_at = null
where id = '8f400000-0000-4000-8000-000000000093' and status = 'processing';
select set_config('request.jwt.claim.sub', '8f400000-0000-4000-8000-000000000001', true);
set local role authenticated;
update public.takeoff_jobs set status = 'pending', retry_count = retry_count + 1, next_retry_at = null, last_error_at = null,
  started_at = null, completed_at = null, token_count = null, cost_cents = null, duration_ms = null,
  error_code = null, error_message = null
where id = '8f400000-0000-4000-8000-000000000093';
reset role;
set local role service_role;
select is((select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000093', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), 'aaaaaaaa-0000-4000-8000-000000000193', now() + interval '1 hour', 'fixture', 'fixture', 'pending', 1)), 1::bigint,
  'the relaunched attempt is claimed by a second worker');
select set_config('app.completion_test_relaunch_result', public.finalize_local_takeoff_result(
  '8f400000-0000-4000-8000-000000000093', (select tenant_id from completion_fixture),
  'aaaaaaaa-0000-4000-8000-000000000193', clock_timestamp(), 'fixture', 'fixture',
  '{"extracted_json": {"items": [{"designation":"Ligne de la relance"}]}, "warnings": [], "tables": [], "provider_meta": {}}',
  '[{"designation":"Ligne de la relance", "quantity": 2, "unit":"u", "metadata": {}, "is_excluded": false, "rules_stale": false}]'
)::text, true);
select is(public.record_local_takeoff_failure('8f400000-0000-4000-8000-000000000093', (select tenant_id from completion_fixture),
  'aaaaaaaa-0000-4000-8000-000000000093', jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5,
    'error_code', 'AI_PROVIDER', 'error_message', 'Fixture', 'analysis_outcome', 'failure', 'last_error_at', clock_timestamp()),
  '{"extracted_json": {}, "warnings": [], "tables": [], "provider_meta": {"status": "failed"}, "token_count": 0,
    "cost_cents": 0, "duration_ms": 5}'),
  null, 'the resumed first worker cannot record its failure');
reset role;
select results_eq($$select j.status::text, (select array_agg(r.id::text) from public.takeoff_results r where r.job_id = j.id),
    (select array_agg(i.designation) from public.takeoff_items i where i.job_id = j.id)
  from public.takeoff_jobs j where j.id = '8f400000-0000-4000-8000-000000000093'$$,
  $$values ('completed'::text, array[current_setting('app.completion_test_relaunch_result')], array['Ligne de la relance'::text])$$,
  'the later result and its lines survive the resumed worker');

select is((select count(*) from public.takeoff_jobs where analysis_outcome is not null), 0::bigint,
  'before activation no writer stamps a terminal outcome');

insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');

select throws_ok(
  $$update public.takeoff_jobs set status = 'completed' where id = '8f400000-0000-4000-8000-000000000022'$$,
  '23514', 'TAKEOFF_ANALYSIS_LEASE_EXPIRED', 'an expired lease cannot publish success'
);

update public.takeoff_jobs set status = 'completed'
where id = '8f400000-0000-4000-8000-000000000021' and status = 'processing';
update public.takeoff_jobs set status = 'completed'
where id = '8f400000-0000-4000-8000-000000000021' and status = 'processing';
select set_config('request.jwt.claim.sub', '8f400000-0000-4000-8000-000000000001', true);
insert into public.draft_locks (version_id, tenant_id, user_id, expires_at, session_id)
select '8f400000-0000-4000-8000-000000000011', tenant_id,
  '8f400000-0000-4000-8000-000000000001', now() + interval '1 hour', gen_random_uuid()
from completion_fixture;
update public.takeoff_jobs set status = 'applied'
where id = '8f400000-0000-4000-8000-000000000021';
select is((select analysis_outcome from public.takeoff_jobs where id = '8f400000-0000-4000-8000-000000000021'),
  'success', 'later application preserves the analysis outcome');

update public.takeoff_jobs set status = 'canceled'
where id = '8f400000-0000-4000-8000-000000000023';
update public.takeoff_jobs set status = 'completed'
where id = '8f400000-0000-4000-8000-000000000023' and status = 'processing';
select is((select delivery_state from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000023'),
  'suppressed', 'cancellation wins against stale success and produces an in-app notice only');

update public.takeoff_jobs set status = 'failed', next_retry_at = now() + interval '15 seconds'
where id = '8f400000-0000-4000-8000-000000000025';
select is((select analysis_outcome from public.takeoff_jobs where id = '8f400000-0000-4000-8000-000000000025'),
  null, 'a scheduled retry has no terminal event');
select throws_ok(
  $$update public.takeoff_jobs set status = 'pending', next_retry_at = null
    where id = '8f400000-0000-4000-8000-000000000025'$$,
  '23514', 'TAKEOFF_ANALYSIS_RETRY_SCHEDULED', 'a manual reset cannot erase the durable automatic retry'
);

select is((select count(*) from public.recover_stale_local_takeoff_jobs(now())), 1::bigint,
  'recovery closes an abandoned lease');
select is((select analysis_outcome from public.takeoff_jobs where id = '8f400000-0000-4000-8000-000000000022'),
  'failure', 'unknown worker outcome is terminal');
select is((select count(*) from public.takeoff_completion_notifications), 3::bigint,
  'a replay and a historical result do not add notices');

select ok(exists (
  select 1 from public.takeoff_jobs j
  join public.takeoff_completion_notifications n on n.id = j.analysis_completion_event_id
  where j.id = '8f400000-0000-4000-8000-000000000021' and n.job_id = j.id and n.id <> j.id
), 'the affaire and inbox share an event ID distinct from the job');

update public.takeoff_jobs set next_retry_at = clock_timestamp() - interval '1 second'
where id = '8f400000-0000-4000-8000-000000000025';
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000025', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture');
update public.takeoff_jobs set status = 'completed'
where id = '8f400000-0000-4000-8000-000000000025' and status = 'processing';
update public.takeoff_jobs set status = 'completed'
where id = '8f400000-0000-4000-8000-000000000025' and status = 'processing';
select is((select count(*) from public.takeoff_completion_notifications
  where subject_kind = 'job' and job_id = '8f400000-0000-4000-8000-000000000025' and outcome = 'success'),
  1::bigint, 'retry followed by success and repeated finalization produce one logical notice');

select throws_ok($$
  insert into public.takeoff_completion_notifications (
    tenant_id, project_id, subject_kind, request_id, outcome, finished_at,
    plans_read_count, plans_failed_count, plans_not_started_count, delivery_state, provider_key
  )
  select tenant_id, '8f400000-0000-4000-8000-000000000010', 'request',
    '8f400000-0000-4000-8000-000000000099', 'partial', now(), 2, 1, 0, 'unavailable',
    'takeoff-completion/' || tenant_id::text || '/request/8f400000-0000-4000-8000-000000000099/unavailable'
  from completion_fixture
$$, '23514', 'new row for relation "takeoff_completion_notifications" violates check constraint "takeoff_completion_autonomous_only_check"',
  'an unbacked launch-request subject cannot be inserted');

select set_config('app.completion_test_other_event_id', (
  select id::text from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000022'
), true);
select set_config('app.completion_test_success_id', (
  select id::text from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000021'
), true);

select set_config('request.jwt.claim.sub', '8f400000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(id) from public.takeoff_completion_notifications), 4::bigint, 'requester sees own notices');
select ok(public.mark_takeoff_completion_notification_read(
  (select id from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000021')
),
  'requester can mark one notice read');
select is((select count(read_at) from public.takeoff_completion_notifications), 1::bigint, 'read mark is bounded');
select throws_ok($$select recipient_email from public.takeoff_completion_notifications$$, '42501',
  'permission denied for table takeoff_completion_notifications', 'private delivery data has no browser grant');
reset role;

update public.tenant_memberships set is_default = (tenant_id = (select tenant_id from completion_fixture))
where user_id = '8f400000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub', '8f400000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(id) from public.takeoff_completion_notifications), 0::bigint,
  'a colleague with affaire read access sees no private notices');
select ok(not public.mark_takeoff_completion_notification_read(current_setting('app.completion_test_other_event_id')::uuid),
  'a colleague cannot mark the requester notice read');
select lives_ok($test$do $check$
begin
  if not exists (select 1 from public.list_affaire_takeoff_completions('8f400000-0000-4000-8000-000000000010')
    where event_id = current_setting('app.completion_test_success_id')::uuid and outcome = 'success' and finished_at is not null) then
    raise exception 'Expected the shared completion for the non-owner director';
  end if;
end;
$check$$test$, 'the non-owner director can read the shared event without the private notice');
reset role;

set local role service_role;
select throws_ok(
  $$update public.takeoff_completion_notifications set recipient_email = 'different@example.test'
    where job_id = '8f400000-0000-4000-8000-000000000021'$$,
  '42501', 'TAKEOFF_COMPLETION_IDENTITY_IMMUTABLE', 'the mailer cannot rewrite the logical recipient'
);
reset role;

-- Simulate a mailer exit after reserving the provider key. A second lease
-- must keep the envelope, and the old token must never start a second send.
create temporary table first_email_claim as
select * from public.claim_takeoff_completion_email(
  (select id from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000021')
);
select ok((select public.prepare_takeoff_completion_email(
  id, lease_token, 'redirect', 'collector@example.test', 'fixture-payload'
) from first_email_claim), 'the initial authorized route is fixed before the provider call');
update public.takeoff_completion_notifications set lease_expires_at = now() - interval '1 second'
where job_id = '8f400000-0000-4000-8000-000000000021';
create temporary table second_email_claim as
select * from public.claim_takeoff_completion_email(
  (select id from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000021')
);
select ok(not (select public.prepare_takeoff_completion_email(
  id, lease_token, 'redirect', 'collector@example.test', 'fixture-payload'
) from first_email_claim), 'an expired mailer no longer owns the provider attempt');
select ok(not (select public.prepare_takeoff_completion_email(
  id, lease_token, 'redirect', 'other-collector@example.test', 'different-payload'
) from second_email_claim), 'a different mailbox cannot receive an ambiguous replay');
select is((select delivery_state from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000021'),
  'unknown', 'route changes preserve an unknown delivery outcome');

create temporary table revoked_email_claim as
select * from public.claim_takeoff_completion_email(
  (select id from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000022')
);
update public.estimate_projects set is_archived = true
where id = '8f400000-0000-4000-8000-000000000010';
set local role authenticated;
select lives_ok($test$do $check$
begin
  if exists (select 1 from public.list_affaire_takeoff_completions('8f400000-0000-4000-8000-000000000010')) then
    raise exception 'Archived affaire must expose no completion';
  end if;
end;
$check$$test$, 'the shared projection hides completions of an archived affaire');
reset role;
select ok(not (select public.prepare_takeoff_completion_email(
  id, lease_token, 'redirect', 'collector@example.test', 'fixture-payload'
) from revoked_email_claim), 'loss of affaire access blocks the provider call');
select is((select delivery_state from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000022'),
  'unavailable', 'loss of access records delivery unavailable');

-- Simulate the future link on an owned transaction that rolls back with this
-- test. M4 will validate the foreign key and the request's own finalizer.
alter table public.takeoff_jobs add column if not exists launch_request_id uuid;
update public.estimate_projects set is_archived = false where id = '8f400000-0000-4000-8000-000000000010';
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by,
  execution_provider, execution_host_id, launch_request_id)
select '8f400000-0000-4000-8000-000000000026', tenant_id, '8f400000-0000-4000-8000-000000000011',
  'A', '8f400000-0000-4000-8000-000000000001', 'chatgpt_local', 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  '8f400000-0000-4000-8000-000000000099'
from completion_fixture;
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000026', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture');
update public.takeoff_jobs set status = 'completed'
where id = '8f400000-0000-4000-8000-000000000026' and status = 'processing';
select ok((select analysis_outcome = 'success' and analysis_finished_at is not null
    and analysis_completion_event_id is null
  from public.takeoff_jobs where id = '8f400000-0000-4000-8000-000000000026'),
  'a request child records its result and leaves event allocation to the request');
select is((select count(*) from public.takeoff_completion_notifications
  where job_id = '8f400000-0000-4000-8000-000000000026'), 0::bigint,
  'a request child cannot publish an autonomous notice');

update public.takeoff_jobs set status = 'pending' where id = '8f400000-0000-4000-8000-000000000088';
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000088', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture');
set local role service_role;
select lives_ok($$
  select public.finalize_local_takeoff_result(id, tenant_id, processing_lease_token, clock_timestamp(), 'fixture', 'fixture',
    '{"extracted_json": {"items": [{"designation":"Fictive"}]}, "warnings": [], "tables": [], "provider_meta": {}}',
    '[{"designation":"Fictive", "quantity": 2, "unit":"u", "metadata": {}, "is_excluded": false, "rules_stale": false}]')
  from public.takeoff_jobs where id = '8f400000-0000-4000-8000-000000000088'
$$, 'the result and line commit with success even if the processor makes no later write');
reset role;
select is((select n.outcome from public.takeoff_completion_notifications n
  join public.takeoff_items i on i.job_id = n.job_id and i.designation = 'Fictive'
  where n.job_id = '8f400000-0000-4000-8000-000000000088'), 'success',
  'the committed extracted line and the success notice are visible together');

select ok(exists (select 1 from public.recover_stale_local_takeoff_jobs(clock_timestamp(), interval '1 minute')
  where job_id = '8f400000-0000-4000-8000-000000000089' and error_code = 'TAKEOFF_WORKER_NOT_STARTED'),
  'a pending admission with no worker is closed by recovery after its deadline');
select is((select outcome from public.takeoff_completion_notifications where job_id = '8f400000-0000-4000-8000-000000000089'),
  'failure', 'a pending admission that cannot be picked up produces a failure notice');

update public.tenant_memberships set role = 'admin' where tenant_id = (select tenant_id from completion_fixture)
and user_id = '8f400000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub', '8f400000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok($$update public.takeoff_jobs set status = 'pending', retry_count = retry_count + 1
  where id = '8f400000-0000-4000-8000-000000000082'$$,
  'the administrator can use the ordinary reset on a legacy failure');
reset role;
select is((select analysis_requested_by from public.takeoff_jobs where id = '8f400000-0000-4000-8000-000000000082'),
  '8f400000-0000-4000-8000-000000000002'::uuid, 'the accepted reset freezes the authenticated administrator as requester');
select count(*) from completion_fixture f cross join lateral public.claim_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000082', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), gen_random_uuid(), now() + interval '1 hour', 'fixture', 'fixture');
update public.takeoff_jobs set status = 'completed' where id = '8f400000-0000-4000-8000-000000000082' and status = 'processing';
select results_eq($$select n.recipient_user_id, n.recipient_email, j.created_by
  from public.takeoff_completion_notifications n join public.takeoff_jobs j on j.id = n.job_id
  where j.id = '8f400000-0000-4000-8000-000000000082'$$,
  $$values ('8f400000-0000-4000-8000-000000000002'::uuid, 'takeoff-colleague@example.test'::text,
    '8f400000-0000-4000-8000-000000000001'::uuid)$$,
  'an accepted legacy relaunch notifies the administrator, preserving the original creator');

-- M1 is applied first: a job admitted through its RPC without a version
-- carries its own affaire, and its end is published there.
insert into public.plan_sets (id, tenant_id, project_id, name)
select '8f400000-0000-4000-8000-000000000014', tenant_id, '8f400000-0000-4000-8000-000000000010', 'Jeu de plans fictif'
from completion_fixture;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select '8f400000-0000-4000-8000-000000000015', tenant_id, '8f400000-0000-4000-8000-000000000014', 'plan-fictif.pdf',
  concat_ws('/', tenant_id, '8f400000-0000-4000-8000-000000000014', '8f400000-0000-4000-8000-000000000015', 'plan-fictif.pdf'),
  'application/pdf', 8, 1
from completion_fixture;
with preparation as (
  select jsonb_build_object('schema_version', 1,
    'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
    'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
    'sources', jsonb_build_array(jsonb_build_object(
      'document_id', id, 'kind', 'plan', 'active', true, 'confirmed', true, 'plan_set_id', plan_set_id,
      'file_path', file_path, 'page_count', page_count, 'source_updated_at', updated_at))) as draft
  from public.plan_files where id = '8f400000-0000-4000-8000-000000000015'
)
insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
select f.tenant_id, '8f400000-0000-4000-8000-000000000010', 1, draft,
  jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', '8f400000-0000-4000-8000-000000000002',
    'confirmed_at', '2026-11-20T00:00:00Z', 'readiness', '{"can_launch":true}'::jsonb, 'preparation', draft),
  '2026-11-20T00:00:00Z', '8f400000-0000-4000-8000-000000000002', '8f400000-0000-4000-8000-000000000002'
from preparation cross join completion_fixture f;
create temporary table versionless_admission as
select jsonb_build_object('id', '8f400000-0000-4000-8000-000000000095', 'tenant_id', p.tenant_id, 'project_id', p.project_id,
  'plan_set_id', '8f400000-0000-4000-8000-000000000014', 'level', 'C', 'created_by', '8f400000-0000-4000-8000-000000000002',
  'execution_provider', 'chatgpt_local', 'execution_host_id', 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  'processing_strategy', 'sync', 'preparation_snapshot', p.confirmed_snapshot,
  'classification', '{"recommended_level":"C"}'::jsonb, 'selection', '{"selected_level":"C"}'::jsonb) as job
from public.takeoff_preparations p where p.project_id = '8f400000-0000-4000-8000-000000000010';
grant select on versionless_admission to authenticated;
select set_config('request.jwt.claim.sub', '8f400000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"8f400000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
select lives_ok($$select * from public.admit_prepared_takeoff_job((select job from versionless_admission))$$,
  'the administrator admits an analysis of the affaire without a version');
reset role;
set local role service_role;
select is((select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000095', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), 'aaaaaaaa-0000-4000-8000-000000000095', now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)), 1::bigint,
  'the versionless job is claimed');
select isnt(public.finalize_local_takeoff_result('8f400000-0000-4000-8000-000000000095', (select tenant_id from completion_fixture),
  'aaaaaaaa-0000-4000-8000-000000000095', clock_timestamp(), 'fixture', 'fixture',
  '{"extracted_json": {"items": [{"designation":"Ligne sans version"}]}, "warnings": [], "tables": [], "provider_meta": {}}',
  '[{"designation":"Ligne sans version", "quantity": 1, "unit":"u", "metadata": {}, "is_excluded": false, "rules_stale": false}]'),
  null, 'the versionless job completes');
reset role;
select results_eq($$select j.estimate_version_id, j.project_id, n.project_id, n.outcome
  from public.takeoff_jobs j join public.takeoff_completion_notifications n on n.id = j.analysis_completion_event_id
  where j.id = '8f400000-0000-4000-8000-000000000095'$$,
  $$values (null::uuid, '8f400000-0000-4000-8000-000000000010'::uuid, '8f400000-0000-4000-8000-000000000010'::uuid,
    'success'::text)$$,
  'a versionless job publishes its end to its own affaire');

-- After activation the same writer publishes the definitive end it commits.
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select '8f400000-0000-4000-8000-000000000094', tenant_id, '8f400000-0000-4000-8000-000000000011', 'A',
  '8f400000-0000-4000-8000-000000000002', 'chatgpt_local', 'urn:uuid:8f400000-0000-4000-8000-000000000099'
from completion_fixture;
set local role service_role;
select count(*) from completion_fixture f cross join lateral public.claim_observed_local_takeoff_job(
  '8f400000-0000-4000-8000-000000000094', f.tenant_id, 'urn:uuid:8f400000-0000-4000-8000-000000000099',
  now(), 'aaaaaaaa-0000-4000-8000-000000000094', now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0);
select ok(public.record_local_takeoff_failure('8f400000-0000-4000-8000-000000000094', (select tenant_id from completion_fixture),
  'aaaaaaaa-0000-4000-8000-000000000094', jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5,
    'error_code', 'AI_PROVIDER', 'error_message', 'Fixture', 'analysis_outcome', 'failure', 'last_error_at', clock_timestamp(),
    'next_retry_at', null)) is not null, 'an activated worker records its definitive failure');
reset role;
select results_eq($$select j.analysis_outcome, n.outcome from public.takeoff_jobs j
  join public.takeoff_completion_notifications n on n.id = j.analysis_completion_event_id
  where j.id = '8f400000-0000-4000-8000-000000000094'$$, $$values ('failure'::text, 'failure'::text)$$,
  'the definitive failure and its notice commit with the worker write');

select * from finish();
rollback;
