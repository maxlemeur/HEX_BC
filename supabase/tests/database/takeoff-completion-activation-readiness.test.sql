-- Lot 2, end-of-analysis notices: what must hold once the cutoff is set (migration
-- 20261121020321_takeoff_completion_before_activation.sql). Isolation justified: the tenant's admission limits, a
-- relaunch recorded before this migration was installed, a recipient who changes between preparation and dispatch
-- and the codes a reader may see are database states that no journey sets deterministically. Time is injected
-- through the recovery's p_now; the Macs' work is stamped in database time.
-- All values are fictional.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select ('8f700000-0000-4000-8000-0000000000' || n)::uuid, 'readiness-' || n || '@example.test', now(), '{}', '{}'
from (values ('01'), ('02'), ('03'), ('04'), ('05')) as members(n);

-- 01 owns the affaire (engineer), 02 is an administrator, 03 to 05 are engineers who launch jobs.
create temporary table fixture as
select tenant_id from public.tenant_memberships where user_id = '8f700000-0000-4000-8000-000000000001';
update public.tenant_memberships set is_default = false
where user_id <> '8f700000-0000-4000-8000-000000000001' and user_id::text like '8f700000-%';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
select f.tenant_id, ('8f700000-0000-4000-8000-0000000000' || x.n)::uuid, x.role::public.tenant_role, true
from fixture f cross join (values ('02', 'admin'), ('03', 'engineer'), ('04', 'engineer'), ('05', 'engineer')) as x(n, role);
update public.tenant_memberships set role = 'engineer'
where user_id = '8f700000-0000-4000-8000-000000000001' and tenant_id = (select tenant_id from fixture);
insert into public.estimate_projects (id, tenant_id, user_id, name)
select '8f700000-0000-4000-8000-000000000010', tenant_id, '8f700000-0000-4000-8000-000000000001', 'Affaire fictive'
from fixture;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status)
select '8f700000-0000-4000-8000-000000000011', tenant_id, '8f700000-0000-4000-8000-000000000010', 1, 'draft'
from fixture;
grant select on fixture to authenticated, service_role;

create function pg_temp.job(p_suffix text) returns uuid language sql immutable as $$
  select ('8f700000-0000-4000-8000-0000000000' || p_suffix)::uuid;
$$;
create function pg_temp.member(p_suffix text) returns uuid language sql immutable as $$
  select ('8f700000-0000-4000-8000-0000000000' || p_suffix)::uuid;
$$;
create function pg_temp.add_job(p_suffix text, p_creator text, p_host text) returns void language sql as $$
  insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
  select pg_temp.job(p_suffix), tenant_id, '8f700000-0000-4000-8000-000000000011', 'A', pg_temp.member(p_creator),
    'chatgpt_local', 'urn:uuid:8f700000-0000-4000-8000-0000000000' || p_host from fixture;
$$;
create function pg_temp.claim(p_suffix text, p_status text, p_retry integer, p_token uuid) returns bigint language sql as $$
  select count(*) from fixture f cross join lateral public.claim_observed_local_takeoff_job(pg_temp.job(p_suffix), f.tenant_id,
    (select execution_host_id from public.takeoff_jobs where id = pg_temp.job(p_suffix)), now(), p_token,
    now() + interval '1 hour', 'fixture', 'fixture', p_status, p_retry);
$$;
create function pg_temp.fail(p_suffix text, p_token uuid, p_code text, p_retry_at timestamptz, p_outcome text) returns jsonb
language sql as $$
  select public.record_local_takeoff_failure(pg_temp.job(p_suffix), (select tenant_id from fixture), p_token,
    jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5, 'error_code', p_code,
      'error_message', 'Fixture failure', 'analysis_outcome', p_outcome, 'last_error_at', clock_timestamp(),
      'next_retry_at', p_retry_at));
$$;
create function pg_temp.succeed(p_suffix text, p_token uuid) returns uuid language sql as $$
  select public.finalize_local_takeoff_result(pg_temp.job(p_suffix), (select tenant_id from fixture), p_token,
    clock_timestamp(), 'fixture', 'fixture', '{"extracted_json": {}, "warnings": [], "tables": [], "provider_meta": {}}',
    '[{"designation": "Ligne fictive", "quantity": 1, "unit": "u", "metadata": {}, "is_excluded": false, "rules_stale": false}]');
$$;
create function pg_temp.state(p_suffix text) returns text language sql as $$
  select status::text || coalesce(' ' || error_code, '') from public.takeoff_jobs where id = pg_temp.job(p_suffix);
$$;
create temporary table clock as select date_trunc('second', now()) - interval '2 days' as t;
create function pg_temp.recover_at(p_offset interval) returns setof uuid language plpgsql as $$
declare
  at timestamptz := (select t from clock) + p_offset;
begin
  -- The live Macs gave their last sign just now, in database time.
  update private.takeoff_local_host_activity set seen_at = clock_timestamp()
  where host_id like 'urn:uuid:8f700000-0000-4000-8000-0000000000a_';
  return query select r.job_id from public.recover_stale_local_takeoff_jobs(at) r order by 1;
end;
$$;

insert into private.takeoff_completion_activation (active_from) select t - interval '1 hour' from clock;

-- 1. A Mac that polls but whose claims the tenant's limits refuse is not leaving its jobs untaken: they wait their
-- turn. a1 is live and idle for hours; 03 has spent the daily processing quota (20 a member); 04 has six active jobs
-- (on the silent a2), so 04's due retry cannot become a seventh.
insert into private.takeoff_local_host_activity (host_id, live_since, seen_at)
select 'urn:uuid:8f700000-0000-4000-8000-0000000000a1', t - interval '6 hours', clock_timestamp() from clock;
select pg_temp.add_job('21', '03', 'a1');
select pg_temp.add_job('22', '04', 'a1');
select pg_temp.claim('22', 'pending', 0, 'bbbbbbbb-0000-4000-8000-000000000022');
select pg_temp.fail('22', 'bbbbbbbb-0000-4000-8000-000000000022', 'AI_TIMEOUT', (select t from clock) + interval '1 minute', null);
select pg_temp.add_job(x.n, '04', 'a2') from (values ('31'), ('32'), ('33'), ('34'), ('35'), ('36')) as x(n);
update public.takeoff_jobs set created_at = (select t from clock) where id in (pg_temp.job('21'), pg_temp.job('31'),
  pg_temp.job('32'), pg_temp.job('33'), pg_temp.job('34'), pg_temp.job('35'), pg_temp.job('36'));
-- The Mac's own timestamps of that attempt, and its work in database time, are six hours before T.
update public.takeoff_jobs set started_at = t - interval '6 hours', completed_at = t - interval '6 hours',
  last_error_at = t - interval '6 hours' from clock where id = pg_temp.job('22');
update private.takeoff_local_job_work set worked_at = (select t from clock) - interval '6 hours'
where job_id = pg_temp.job('22');
insert into public.takeoff_processing_admissions (job_id, attempt_number, tenant_id, created_by, admitted_at)
select gen_random_uuid(), 0, tenant_id, pg_temp.member('03'), now() - interval '1 hour' from fixture, generate_series(1, 20);

select throws_ok($$select pg_temp.claim('21', 'pending', 0, gen_random_uuid())$$, '23514', 'TAKEOFF_PROCESSING_ADMISSION_LIMIT',
  'the Mac cannot claim the job of a member whose daily quota is spent');
select throws_ok($$select pg_temp.claim('22', 'failed', 0, gen_random_uuid())$$, '23514', 'TAKEOFF_JOB_ADMISSION_LIMIT',
  'nor the retry of a member who already has six active jobs');
select is(array(select pg_temp.recover_at(interval '30 minutes')), '{}'::uuid[],
  'after the grace on a live, idle Mac, neither job is closed: the limits make them wait their turn');
select results_eq($$select pg_temp.state('21'), pg_temp.state('22')$$, $$values ('pending'::text, 'failed AI_TIMEOUT'::text)$$,
  'both still wait');

-- The quota frees and one of 04's jobs ends: the Mac could now take both, and the rule applies again.
update public.takeoff_processing_admissions set admitted_at = now() - interval '25 hours'
where created_by = pg_temp.member('03');
update public.takeoff_jobs set status = 'canceled' where id = pg_temp.job('31');
select is(array(select pg_temp.recover_at(interval '31 minutes')), array[pg_temp.job('21'), pg_temp.job('22')],
  'once the Mac could take them, the jobs it leaves untaken are closed');
select results_eq($$select pg_temp.state('21'), pg_temp.state('22')$$,
  $$values ('failed TAKEOFF_WORKER_NOT_STARTED'::text, 'failed TAKEOFF_WORKER_NOT_STARTED'::text)$$, 'nobody took them');

-- 3. A job sent back to pending before this migration was installed recorded no requester, and who asked cannot be
-- known: the release's « Soumettre à nouveau » cannot store its audit row, and a stored one need not be the last.
-- A job created before installation that was retried or relaunched without a captured requester never has its end
-- sent to anyone, whatever the audit says; the activation precondition (the pull request's query, verbatim) lists
-- those still open. After installation only the launcher relaunches, and the requester is captured.
create temporary view open_jobs_without_requester as
select j.id, j.tenant_id, j.status, j.created_by, j.retry_count
from public.takeoff_jobs j
where j.analysis_outcome is null and j.analysis_requested_by is null and j.retry_count > 0
  and j.created_at < (select captured_from from private.takeoff_requester_capture)
  and (j.status in ('pending', 'processing') or (j.status = 'failed' and j.next_retry_at is not null));

-- 41, 42 and 44 were created before installation, 46 after it.
select pg_temp.add_job(x.n, '01', 'a3') from (values ('41'), ('42'), ('44'), ('46')) as x(n);
update public.takeoff_jobs set created_at = (select t from clock) - interval '1 day'
where id in (pg_temp.job('41'), pg_temp.job('42'), pg_temp.job('44'));
select pg_temp.claim(x.n, 'pending', 0, ('bbbbbbbb-0000-4000-8000-0000000000' || x.n)::uuid)
from (values ('41'), ('42'), ('44'), ('46')) as x(n);
select pg_temp.fail(x.n, ('bbbbbbbb-0000-4000-8000-0000000000' || x.n)::uuid, 'AI_PROVIDER', null, null)
from (values ('41'), ('42')) as x(n);
-- The previous application relaunched 41 and 42 before installation, capturing nobody. A v0.7.0 retry audit names
-- the launcher for 41: it proves nothing about the last relaunch.
update public.takeoff_jobs set status = 'pending', retry_count = retry_count + 1, next_retry_at = null, error_code = null,
  error_message = null, last_error_at = null, started_at = null, completed_at = null
where id in (pg_temp.job('41'), pg_temp.job('42'));
insert into public.audit_logs (tenant_id, user_id, table_name, record_id, action, created_at)
select tenant_id, pg_temp.member('01'), 'takeoff_jobs', pg_temp.job('41'), 'takeoff.job.retried', clock_timestamp() from fixture;
-- 46 is retried by its worker, as any job may be.
select pg_temp.fail('46', 'bbbbbbbb-0000-4000-8000-000000000046', 'AI_TIMEOUT', clock_timestamp() - interval '1 second', null);
select pg_temp.claim('46', 'failed', 0, 'bbbbbbbb-0000-4000-8000-000000000146');
select results_eq($$select id from open_jobs_without_requester where tenant_id = (select tenant_id from fixture) order by id$$,
  $$values (pg_temp.job('41')), (pg_temp.job('42'))$$,
  'the precondition lists the open jobs relaunched before installation, whatever the audit says');
-- 42 fails again; its launcher relaunches it under this migration.
select pg_temp.claim('42', 'pending', 1, 'bbbbbbbb-0000-4000-8000-000000000142');
select pg_temp.fail('42', 'bbbbbbbb-0000-4000-8000-000000000142', 'AI_PROVIDER', null, null);
-- Past the relaunch backoff of the previous application.
update public.takeoff_jobs set completed_at = now() - interval '1 minute' where id = pg_temp.job('42');
select set_config('request.jwt.claim.sub', pg_temp.member('01')::text, true);
set local role authenticated;
update public.takeoff_jobs set status = 'pending', retry_count = retry_count + 1, next_retry_at = null, last_error_at = null,
  started_at = null, completed_at = null, token_count = null, cost_cents = null, duration_ms = null, error_code = null,
  error_message = null
where id = pg_temp.job('42');
reset role;
select results_eq($$select status::text, analysis_requested_by from public.takeoff_jobs where id = pg_temp.job('42')$$,
  $$values ('pending'::text, pg_temp.member('01'))$$, 'the launcher''s relaunch is accepted and captured');
select results_eq($$select id from open_jobs_without_requester where tenant_id = (select tenant_id from fixture) order by id$$,
  $$values (pg_temp.job('41'))$$, 'the precondition no longer lists the job its launcher relaunched');
select pg_temp.claim(x.n, 'pending', x.retry, ('bbbbbbbb-0000-4000-8000-0000000002' || x.n)::uuid)
from (values ('41', 1), ('42', 2)) as x(n, retry);
select pg_temp.succeed(x.n, ('bbbbbbbb-0000-4000-8000-0000000002' || x.n)::uuid) from (values ('41'), ('42')) as x(n);
select pg_temp.succeed('44', 'bbbbbbbb-0000-4000-8000-000000000044');
select pg_temp.succeed('46', 'bbbbbbbb-0000-4000-8000-000000000146');
select results_eq($$select job_id, recipient_user_id, delivery_state, last_delivery_code from public.takeoff_completion_notifications
    where job_id in (pg_temp.job('41'), pg_temp.job('42'), pg_temp.job('44'), pg_temp.job('46')) order by job_id$$,
  $$values (pg_temp.job('41'), null::uuid, 'unavailable'::text, 'REQUESTER_UNKNOWN'::text),
    (pg_temp.job('42'), pg_temp.member('01'), 'pending'::text, null::text),
    (pg_temp.job('44'), pg_temp.member('01'), 'pending'::text, null::text),
    (pg_temp.job('46'), pg_temp.member('01'), 'pending'::text, null::text)$$,
  'an end whose requester is unknown is sent to nobody; a captured requester, a job never relaunched and a later job are');
select is((select count(*) from open_jobs_without_requester where tenant_id = (select tenant_id from fixture)), 0::bigint,
  'once the jobs ended, the precondition is empty');

-- 4. At dispatch, the recipient is checked again: a changed address or a lost membership ends the delivery.
select pg_temp.add_job('43', '02', 'a3');
select pg_temp.claim('43', 'pending', 0, 'bbbbbbbb-0000-4000-8000-000000000043');
select pg_temp.succeed('43', 'bbbbbbbb-0000-4000-8000-000000000043');
create temporary table moved_sender as select * from public.claim_takeoff_completion_email(
  (select id from public.takeoff_completion_notifications where job_id = pg_temp.job('42')));
create temporary table removed_sender as select * from public.claim_takeoff_completion_email(
  (select id from public.takeoff_completion_notifications where job_id = pg_temp.job('43')));
select ok((select public.prepare_takeoff_completion_email(id, lease_token, 'redirect', 'collector@example.test', 'fixture')
  from moved_sender) and (select public.prepare_takeoff_completion_email(id, lease_token, 'redirect', 'collector@example.test',
  'fixture') from removed_sender), 'both e-mails are prepared');
update auth.users set email = 'readiness-moved@example.test' where id = pg_temp.member('01');
delete from public.tenant_memberships where user_id = pg_temp.member('02') and tenant_id = (select tenant_id from fixture);
select is((select public.confirm_takeoff_completion_email_dispatch(id, lease_token) from moved_sender), null,
  'a recipient whose address changed after preparation is not sent the e-mail');
select is((select public.confirm_takeoff_completion_email_dispatch(id, lease_token) from removed_sender), null,
  'nor a recipient removed after preparation');
select results_eq($$select delivery_state, last_delivery_code, lease_token is null from public.takeoff_completion_notifications
    where job_id in (pg_temp.job('42'), pg_temp.job('43')) order by job_id$$,
  $$values ('unavailable'::text, 'RECIPIENT_UNAVAILABLE'::text, true), ('unavailable'::text, 'RECIPIENT_UNAVAILABLE'::text, true)$$,
  'both deliveries end as unavailable');

-- 5. A sender whose lease has already expired when it prepares or confirms gives its attempt back: claims that never
-- call the provider do not exhaust the delivery.
create function pg_temp.expired_round(p_suffix text, p_step text) returns boolean language plpgsql as $$
declare
  claimed public.takeoff_completion_notifications;
  answer boolean;
begin
  -- Due before this statement began, which is the time the claim compares with.
  update public.takeoff_completion_notifications set next_attempt_at = now() - interval '1 second'
  where job_id = pg_temp.job(p_suffix) and delivery_state = 'pending';
  select * into claimed from public.claim_takeoff_completion_email(
    (select id from public.takeoff_completion_notifications where job_id = pg_temp.job(p_suffix)));
  update public.takeoff_completion_notifications set lease_expires_at = clock_timestamp() - interval '1 second'
  where id = claimed.id;
  if p_step = 'prepare' then
    answer := public.prepare_takeoff_completion_email(claimed.id, claimed.lease_token, 'redirect', 'collector@example.test', 'fixture');
  else
    answer := public.confirm_takeoff_completion_email_dispatch(claimed.id, claimed.lease_token) is not null;
  end if;
  return answer;
end;
$$;
select ok(not pg_temp.expired_round('44', 'prepare'), 'a sender whose lease expired before preparing may not prepare');
select ok(not pg_temp.expired_round('44', 'confirm'), 'nor send');
select ok(bool_and(not pg_temp.expired_round('44', case when round % 2 = 0 then 'prepare' else 'confirm' end)),
  'nine more claims expire the same way') from generate_series(1, 9) as round;
select results_eq($$select delivery_state, attempt_count, lease_token is null, next_attempt_at is not null, last_delivery_code
    from public.takeoff_completion_notifications where job_id = pg_temp.job('44')$$,
  $$values ('pending'::text, 0, true, true, 'DISPATCH_LEASE_EXPIRED'::text)$$,
  'each gave its attempt back: the delivery is pending, with no attempt spent');

-- 6. A reader who cannot read the job sees only codes that have a public French reason.
select pg_temp.add_job(x.n, '05', 'a3') from (values ('51'), ('52')) as x(n);
select pg_temp.claim(x.n, 'pending', 0, ('bbbbbbbb-0000-4000-8000-0000000000' || x.n)::uuid) from (values ('51'), ('52')) as x(n);
select pg_temp.fail('51', 'bbbbbbbb-0000-4000-8000-000000000051', 'TAKEOFF_PREPARATION_SOURCE_CHANGED', null, 'failure');
select pg_temp.fail('52', 'bbbbbbbb-0000-4000-8000-000000000052', 'AI_SAFETY', null, 'failure');
select results_eq($$select job_id, reason_code from public.takeoff_completion_notifications
    where job_id in (pg_temp.job('51'), pg_temp.job('52')) order by job_id$$,
  $$values (pg_temp.job('51'), null::text), (pg_temp.job('52'), 'AI_SAFETY'::text)$$,
  'an internal code is not published; a code with a public reason is');
select is(private.takeoff_public_failure_codes(), array['AI_PROVIDER', 'AI_RATE_LIMIT', 'AI_SAFETY', 'AI_SCHEMA', 'AI_TIMEOUT',
  'FORBIDDEN', 'INTERNAL_ERROR',
  'TAKEOFF_FILE_TOO_LARGE', 'TAKEOFF_FILE_TYPE_INVALID', 'TAKEOFF_LEVEL_C_BUDGET_EXCEEDED', 'TAKEOFF_LEVEL_C_INVALID_SCHEMA',
  'TAKEOFF_LEVEL_C_TIMEOUT', 'TAKEOFF_PDF_CORRUPTED', 'TAKEOFF_PDF_NOT_INTERPRETABLE', 'TAKEOFF_WORKER_HOST_SILENT',
  'TAKEOFF_WORKER_NOT_STARTED', 'TAKEOFF_WORKER_OUTCOME_UNKNOWN', 'TAKEOFF_WORKER_QUEUE_EXPIRED'],
  'the allow-list holds the codes the application labels in French (FAILURE_FACTS, src/lib/takeoff/visible-status.ts)');

select * from finish();
rollback;
