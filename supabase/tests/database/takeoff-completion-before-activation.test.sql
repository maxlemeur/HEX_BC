-- Lot 2, follow-up of the end-of-analysis notice (migration 20261121020321_takeoff_completion_before_activation.sql),
-- to merge before the owner sets the activation cutoff. Isolation justified: the cutoff, the time a job waited and
-- the order of two senders are states no journey can set or interleave deterministically; time is injected through
-- the recovery's p_now and stored timestamps, never waited for.
-- Section 0 replays the previous application's statements with the cutoff unset: each answers as before M3.
-- All values are fictional.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('8f600000-0000-4000-8000-000000000001', 'followup-engineer@example.test', now(), '{}', '{}'),
  ('8f600000-0000-4000-8000-000000000002', 'followup-admin@example.test', now(), '{}', '{}'),
  ('8f600000-0000-4000-8000-000000000003', 'followup-colleague@example.test', now(), '{}', '{}'),
  ('8f600000-0000-4000-8000-000000000006', 'followup-member-6@example.test', now(), '{}', '{}'),
  ('8f600000-0000-4000-8000-000000000007', 'followup-member-7@example.test', now(), '{}', '{}'),
  ('8f600000-0000-4000-8000-000000000008', 'followup-member-8@example.test', now(), '{}', '{}'),
  ('8f600000-0000-4000-8000-000000000009', 'followup-member-9@example.test', now(), '{}', '{}');

-- One tenant: the engineer owns the affaire, an administrator and colleague engineers work in it. The jobs are
-- spread over the engineers, within the admission limits of a member (10 a day, 6 active).
create temporary table fixture as
select tenant_id from public.tenant_memberships where user_id = '8f600000-0000-4000-8000-000000000001';
update public.tenant_memberships set is_default = false
where user_id <> '8f600000-0000-4000-8000-000000000001' and user_id::text like '8f600000-%';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
select f.tenant_id, x.user_id, x.role::public.tenant_role, true
from fixture f cross join (values ('8f600000-0000-4000-8000-000000000002'::uuid, 'admin'),
  ('8f600000-0000-4000-8000-000000000003'::uuid, 'engineer'), ('8f600000-0000-4000-8000-000000000006'::uuid, 'engineer'),
  ('8f600000-0000-4000-8000-000000000007'::uuid, 'engineer'), ('8f600000-0000-4000-8000-000000000008'::uuid, 'engineer'),
  ('8f600000-0000-4000-8000-000000000009'::uuid, 'engineer')) as x(user_id, role);
update public.tenant_memberships set role = 'engineer'
where user_id = '8f600000-0000-4000-8000-000000000001' and tenant_id = (select tenant_id from fixture);

insert into public.estimate_projects (id, tenant_id, user_id, name)
select '8f600000-0000-4000-8000-000000000010', tenant_id, '8f600000-0000-4000-8000-000000000001', 'Affaire fictive'
from fixture;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status)
select '8f600000-0000-4000-8000-000000000011', tenant_id, '8f600000-0000-4000-8000-000000000010', 1, 'draft'
from fixture;

create function pg_temp.add_job(p_id uuid, p_creator uuid, p_host text) returns void language sql as $$
  insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
  select p_id, tenant_id, '8f600000-0000-4000-8000-000000000011', 'A', p_creator, 'chatgpt_local', p_host from fixture;
$$;
create function pg_temp.claim_old(p_id uuid, p_started timestamptz, p_expires timestamptz) returns bigint language sql as $$
  select count(*) from fixture f cross join lateral public.claim_local_takeoff_job(p_id, f.tenant_id,
    (select execution_host_id from public.takeoff_jobs where id = p_id), p_started, gen_random_uuid(), p_expires, 'fixture', 'fixture');
$$;
create function pg_temp.claim_new(p_id uuid, p_token uuid, p_status text, p_retry integer) returns bigint language sql as $$
  select count(*) from fixture f cross join lateral public.claim_observed_local_takeoff_job(p_id, f.tenant_id,
    (select execution_host_id from public.takeoff_jobs where id = p_id), now(), p_token, now() + interval '1 hour',
    'fixture', 'fixture', p_status, p_retry);
$$;
-- The previous application's manual relaunch, as its authenticated session sends it.
create function pg_temp.old_resubmit(p_id uuid) returns void language sql as $$
  update public.takeoff_jobs set status = 'pending', retry_count = retry_count + 1, next_retry_at = null,
    last_error_at = null, started_at = null, completed_at = null, token_count = null, cost_cents = null,
    duration_ms = null, error_code = null, error_message = null
  where id = p_id and status in ('failed', 'canceled');
$$;
grant select on fixture to authenticated, service_role;
grant execute on function pg_temp.old_resubmit(uuid) to authenticated;

-- 0. The previous application against this migration, the cutoff unset.
select pg_temp.add_job(x.id, '8f600000-0000-4000-8000-000000000001', 'urn:uuid:8f600000-0000-4000-8000-0000000000a0')
from (values ('8f600000-0000-4000-8000-000000000031'::uuid), ('8f600000-0000-4000-8000-000000000032'::uuid),
  ('8f600000-0000-4000-8000-000000000033'::uuid), ('8f600000-0000-4000-8000-000000000034'::uuid),
  ('8f600000-0000-4000-8000-000000000035'::uuid), ('8f600000-0000-4000-8000-000000000036'::uuid)) as x(id);
select pg_temp.add_job(x.id, '8f600000-0000-4000-8000-000000000006', 'urn:uuid:8f600000-0000-4000-8000-0000000000a1')
from (values ('8f600000-0000-4000-8000-000000000037'::uuid), ('8f600000-0000-4000-8000-000000000038'::uuid)) as x(id);

-- 6. The one deliberate change: only the member who launched a job sends it back to pending. The previous
-- application's administrator, relaunching an engineer's job, is refused; the launcher's own relaunch is not.
update public.takeoff_jobs set status = 'failed', next_retry_at = now() - interval '1 minute'
where id = '8f600000-0000-4000-8000-000000000031';
select set_config('request.jwt.claim.sub', '8f600000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok($$select pg_temp.old_resubmit('8f600000-0000-4000-8000-000000000031')$$, '42501',
  'TAKEOFF_RELAUNCH_LAUNCHER_ONLY', 'before activation an administrator cannot relaunch an engineer''s job');
reset role;
select results_eq($$select status::text, retry_count from public.takeoff_jobs where id = '8f600000-0000-4000-8000-000000000031'$$,
  $$values ('failed'::text, 0)$$, 'the refused relaunch leaves the job as it was');
select set_config('request.jwt.claim.sub', '8f600000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok($$select pg_temp.old_resubmit('8f600000-0000-4000-8000-000000000031')$$,
  'before activation the launcher''s relaunch of an elapsed retry is accepted');
reset role;
select results_eq($$select status::text, retry_count, next_retry_at, error_code, analysis_outcome, analysis_finished_at,
    analysis_completion_event_id from public.takeoff_jobs where id = '8f600000-0000-4000-8000-000000000031'$$,
  $$values ('pending'::text, 1, null::timestamptz, null::text, null::text, null::timestamptz, null::uuid)$$,
  'the reset leaves every column the previous application reads as before');
select is((select analysis_requested_by from public.takeoff_jobs where id = '8f600000-0000-4000-8000-000000000031'),
  '8f600000-0000-4000-8000-000000000001'::uuid, 'the reset records its requester in a column no previous writer reads');

update public.takeoff_jobs set status = 'failed', retry_count = 0, next_retry_at = now() + interval '1 hour'
where id = '8f600000-0000-4000-8000-000000000032';
select is(pg_temp.claim_old('8f600000-0000-4000-8000-000000000032', now(), now() + interval '1 hour'), 1::bigint,
  'before activation the deployed claim keeps its early-retry answer');
update public.takeoff_jobs set status = 'failed', retry_count = 3, next_retry_at = now() - interval '1 second',
  processing_lease_token = null, processing_lease_expires_at = null
where id = '8f600000-0000-4000-8000-000000000032';
select is(pg_temp.claim_old('8f600000-0000-4000-8000-000000000032', now(), now() + interval '1 hour'), 1::bigint,
  'before activation the deployed claim keeps its exhausted-retry answer');

update public.takeoff_jobs set status = 'canceled', completed_at = now() where id = '8f600000-0000-4000-8000-000000000033';
set local role authenticated;
select lives_ok($$select pg_temp.old_resubmit('8f600000-0000-4000-8000-000000000033')$$,
  'before activation the launcher resubmits a canceled job');
reset role;
select results_eq($$select status::text, retry_count, analysis_outcome from public.takeoff_jobs
    where id = '8f600000-0000-4000-8000-000000000033'$$, $$values ('pending'::text, 1, null::text)$$,
  'the canceled job is pending again, without an end');

select pg_temp.claim_old('8f600000-0000-4000-8000-000000000034', now() - interval '2 hours', now() - interval '90 minutes');
set local role service_role;
select results_eq($$select job_id, error_code from public.recover_stale_local_takeoff_jobs(now() - interval '75 minutes')$$,
  $$values ('8f600000-0000-4000-8000-000000000034'::uuid, 'TAKEOFF_WORKER_OUTCOME_UNKNOWN'::text)$$,
  'before activation the recovery returns the lost worker as before');
reset role;
select is((select error_message from public.takeoff_jobs where id = '8f600000-0000-4000-8000-000000000034'),
  'Le worker a expire pendant un appel dont le resultat fournisseur est inconnu. Une reprise manuelle est requise.',
  'before activation the recovery keeps its diagnostic');
set local role authenticated;
select lives_ok($$select pg_temp.old_resubmit('8f600000-0000-4000-8000-000000000034')$$,
  'before activation the launcher resubmits a recovered job');
reset role;
select results_eq($$select status::text, retry_count, error_code, analysis_outcome from public.takeoff_jobs
    where id = '8f600000-0000-4000-8000-000000000034'$$, $$values ('pending'::text, 1, null::text, null::text)$$,
  'the recovered job is pending again, without an end');

select pg_temp.claim_old('8f600000-0000-4000-8000-000000000035', now() - interval '40 minutes', now() - interval '30 minutes');
select lives_ok($$update public.takeoff_jobs set status = 'completed' where id = '8f600000-0000-4000-8000-000000000035'$$,
  'before activation the previous worker completes after its lease expired');
select results_eq($$select status::text, analysis_outcome from public.takeoff_jobs where id = '8f600000-0000-4000-8000-000000000035'$$,
  $$values ('completed'::text, null::text)$$, 'the late completion is recorded, without an end');

select pg_temp.claim_old('8f600000-0000-4000-8000-000000000036', now(), now() + interval '1 hour');
update public.takeoff_jobs set status = 'failed', error_code = 'AI_PROVIDER', processing_lease_token = null,
  processing_lease_expires_at = null where id = '8f600000-0000-4000-8000-000000000036';
select lives_ok($$update public.takeoff_jobs set last_error_at = now(), next_retry_at = null
  where id = '8f600000-0000-4000-8000-000000000036'$$, 'before activation the previous scheduler writes after a failure');
select results_eq($$select status::text, last_error_at is not null, next_retry_at, analysis_outcome from public.takeoff_jobs
    where id = '8f600000-0000-4000-8000-000000000036'$$, $$values ('failed'::text, true, null::timestamptz, null::text)$$,
  'the scheduler''s write is recorded, without an end');
set local role service_role;
select lives_ok($$select pg_temp.old_resubmit('8f600000-0000-4000-8000-000000000036')$$,
  'the service role still sends a job back to pending');
reset role;
select is((select status::text from public.takeoff_jobs where id = '8f600000-0000-4000-8000-000000000036'), 'pending',
  'the service role''s reset is applied');
select is((select analysis_requested_by from public.takeoff_jobs where id = '8f600000-0000-4000-8000-000000000036'), null,
  'a reset without a session names no requester: the launcher is the recipient');
update public.takeoff_jobs set status = 'canceled' where id = '8f600000-0000-4000-8000-000000000036';

-- A live, idle Mac and jobs that waited for days: before activation the recovery closes none of them.
update public.takeoff_jobs set created_at = now() - interval '3 days' where id = '8f600000-0000-4000-8000-000000000037';
update public.takeoff_jobs set status = 'failed', retry_count = 1, next_retry_at = now() - interval '2 days'
where id = '8f600000-0000-4000-8000-000000000038';
select public.record_local_takeoff_host_activity('urn:uuid:8f600000-0000-4000-8000-0000000000a1');
update private.takeoff_local_host_activity set live_since = now() - interval '4 days'
where host_id = 'urn:uuid:8f600000-0000-4000-8000-0000000000a1';
set local role service_role;
select is((select count(*) from public.recover_stale_local_takeoff_jobs(now())), 0::bigint,
  'before activation the recovery closes no job that waits for its Mac');
reset role;
select results_eq($$select status::text, error_code from public.takeoff_jobs
    where id in ('8f600000-0000-4000-8000-000000000037', '8f600000-0000-4000-8000-000000000038') order by id$$,
  $$values ('pending'::text, null::text), ('failed'::text, null::text)$$, 'both waiting jobs are left as they were');
update public.takeoff_jobs set status = 'canceled' where id in ('8f600000-0000-4000-8000-000000000037', '8f600000-0000-4000-8000-000000000038');

select is((select count(*) from public.takeoff_jobs where analysis_outcome is not null), 0::bigint,
  'before activation no writer stamps a terminal outcome');
select is((select count(*) from public.takeoff_completion_notifications), 0::bigint, 'before activation nothing is published');

-- 1. A relaunch accepted before the cutoff and ended after it notifies the member who relaunched, whichever side of
-- the cutoff the relaunch fell on. With point 6 that member is the job's launcher: the engineer relaunches their
-- job and the administrator theirs, both before activation; both jobs end after it.
select pg_temp.add_job('8f600000-0000-4000-8000-000000000041', '8f600000-0000-4000-8000-000000000001',
  'urn:uuid:8f600000-0000-4000-8000-0000000000a0');
select pg_temp.add_job('8f600000-0000-4000-8000-000000000042', '8f600000-0000-4000-8000-000000000002',
  'urn:uuid:8f600000-0000-4000-8000-0000000000a0');
select pg_temp.claim_old(x.id, now(), now() + interval '1 hour')
from (values ('8f600000-0000-4000-8000-000000000041'::uuid), ('8f600000-0000-4000-8000-000000000042'::uuid)) as x(id);
update public.takeoff_jobs set status = 'failed', error_code = 'AI_PROVIDER', next_retry_at = null,
  processing_lease_token = null, processing_lease_expires_at = null
where id in ('8f600000-0000-4000-8000-000000000041', '8f600000-0000-4000-8000-000000000042');
select set_config('request.jwt.claim.sub', '8f600000-0000-4000-8000-000000000001', true);
set local role authenticated;
select pg_temp.old_resubmit('8f600000-0000-4000-8000-000000000041');
reset role;
select set_config('request.jwt.claim.sub', '8f600000-0000-4000-8000-000000000002', true);
set local role authenticated;
select pg_temp.old_resubmit('8f600000-0000-4000-8000-000000000042');
reset role;
select results_eq($$select id, analysis_requested_by from public.takeoff_jobs
    where id in ('8f600000-0000-4000-8000-000000000041', '8f600000-0000-4000-8000-000000000042') order by id$$,
  $$values ('8f600000-0000-4000-8000-000000000041'::uuid, '8f600000-0000-4000-8000-000000000001'::uuid),
    ('8f600000-0000-4000-8000-000000000042'::uuid, '8f600000-0000-4000-8000-000000000002'::uuid)$$,
  'each relaunch before the cutoff records who asked for it');

-- An earlier relaunch of each, by the other member, is in the audit: if the capture were lost, the publication would
-- find that other member and keep the end unavailable, so the recipients below can only come from the capture.
insert into public.audit_logs (tenant_id, user_id, table_name, record_id, action, created_at)
select tenant_id, x.member, 'takeoff_jobs', x.id, 'takeoff.job.retried', clock_timestamp() - interval '1 second'
from fixture cross join (values ('8f600000-0000-4000-8000-000000000041'::uuid, '8f600000-0000-4000-8000-000000000002'::uuid),
  ('8f600000-0000-4000-8000-000000000042'::uuid, '8f600000-0000-4000-8000-000000000001'::uuid)) as x(id, member);

insert into private.takeoff_completion_activation (active_from) values (clock_timestamp());

select is(pg_temp.claim_new('8f600000-0000-4000-8000-000000000041', 'aaaaaaaa-0000-4000-8000-000000000041', 'pending', 1),
  1::bigint, 'after activation the relaunched job is claimed');
select isnt(public.finalize_local_takeoff_result('8f600000-0000-4000-8000-000000000041', (select tenant_id from fixture),
  'aaaaaaaa-0000-4000-8000-000000000041', clock_timestamp(), 'fixture', 'fixture',
  '{"extracted_json": {}, "warnings": [], "tables": [], "provider_meta": {}}',
  '[{"designation": "Ligne fictive", "quantity": 1, "unit": "u", "metadata": {}, "is_excluded": false, "rules_stale": false}]'),
  null, 'the relaunched job succeeds');
select is(pg_temp.claim_new('8f600000-0000-4000-8000-000000000042', 'aaaaaaaa-0000-4000-8000-000000000042', 'pending', 1),
  1::bigint, 'the administrator''s relaunched job is claimed');
select isnt(public.record_local_takeoff_failure('8f600000-0000-4000-8000-000000000042', (select tenant_id from fixture),
  'aaaaaaaa-0000-4000-8000-000000000042', jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5,
    'error_code', 'AI_PROVIDER', 'error_message', 'Fixture provider failure', 'analysis_outcome', 'failure',
    'last_error_at', clock_timestamp(), 'next_retry_at', null)), null, 'the administrator''s relaunched job fails for good');
select results_eq($$select n.job_id, n.recipient_user_id, n.recipient_email, n.delivery_state
    from public.takeoff_completion_notifications n
    where n.job_id in ('8f600000-0000-4000-8000-000000000041', '8f600000-0000-4000-8000-000000000042') order by n.job_id$$,
  $$values ('8f600000-0000-4000-8000-000000000041'::uuid, '8f600000-0000-4000-8000-000000000001'::uuid,
      'followup-engineer@example.test'::text, 'pending'::text),
    ('8f600000-0000-4000-8000-000000000042'::uuid, '8f600000-0000-4000-8000-000000000002'::uuid,
      'followup-admin@example.test'::text, 'pending'::text)$$,
  'each end goes to the member who relaunched before the cutoff');
select set_config('request.jwt.claim.sub', '8f600000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok($$select pg_temp.old_resubmit('8f600000-0000-4000-8000-000000000036')$$, '42501',
  'TAKEOFF_RELAUNCH_LAUNCHER_ONLY', 'after activation too, an administrator cannot relaunch an engineer''s job');
reset role;

-- 2. A job that waits for its Mac. Time is injected: T is three days ago, the cutoff an hour before it, and each
-- recovery runs at an instant after T with the Macs' signs of life placed just before that instant.
select set_config('request.jwt.claim.sub', '', true);
create temporary table clock as select date_trunc('second', now()) - interval '3 days' as t;
update private.takeoff_completion_activation set active_from = (select t from clock) - interval '1 hour';
select ok((select pickup_grace = interval '15 minutes' and wait_ceiling = interval '24 hours'
  from private.takeoff_completion_activation), 'the stated defaults: a 15-minute pickup grace and a 24-hour ceiling');

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('8f600000-0000-4000-8000-000000000005', 'followup-suspended@example.test', now(), '{}', '{}');
insert into public.estimate_projects (id, tenant_id, user_id, name)
select '8f600000-0000-4000-8000-000000000020', tenant_id, user_id, 'Affaire suspendue fictive'
from public.tenant_memberships where user_id = '8f600000-0000-4000-8000-000000000005';
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status)
select '8f600000-0000-4000-8000-000000000021', tenant_id, '8f600000-0000-4000-8000-000000000020', 1, 'draft'
from public.tenant_memberships where user_id = '8f600000-0000-4000-8000-000000000005';

-- b1 is busy (a job under lease until T + 25 h); b2 is live and idle (its last job ended at T - 1 h); b3 has
-- just woken up; b4 ended a job five minutes before each recovery; b5 never gave a sign of life.
select pg_temp.add_job(x.id, x.creator, x.host)
from (values
  ('8f600000-0000-4000-8000-000000000051'::uuid, '8f600000-0000-4000-8000-000000000007'::uuid, 'urn:uuid:8f600000-0000-4000-8000-0000000000b1'),
  ('8f600000-0000-4000-8000-000000000052'::uuid, '8f600000-0000-4000-8000-000000000007'::uuid, 'urn:uuid:8f600000-0000-4000-8000-0000000000b1'),
  ('8f600000-0000-4000-8000-000000000053'::uuid, '8f600000-0000-4000-8000-000000000007'::uuid, 'urn:uuid:8f600000-0000-4000-8000-0000000000b2'),
  ('8f600000-0000-4000-8000-000000000054'::uuid, '8f600000-0000-4000-8000-000000000007'::uuid, 'urn:uuid:8f600000-0000-4000-8000-0000000000b2'),
  ('8f600000-0000-4000-8000-000000000055'::uuid, '8f600000-0000-4000-8000-000000000008'::uuid, 'urn:uuid:8f600000-0000-4000-8000-0000000000b3'),
  ('8f600000-0000-4000-8000-000000000056'::uuid, '8f600000-0000-4000-8000-000000000008'::uuid, 'urn:uuid:8f600000-0000-4000-8000-0000000000b4'),
  ('8f600000-0000-4000-8000-000000000057'::uuid, '8f600000-0000-4000-8000-000000000008'::uuid, 'urn:uuid:8f600000-0000-4000-8000-0000000000b4'),
  ('8f600000-0000-4000-8000-000000000058'::uuid, '8f600000-0000-4000-8000-000000000008'::uuid, 'urn:uuid:8f600000-0000-4000-8000-0000000000b5'),
  ('8f600000-0000-4000-8000-000000000059'::uuid, '8f600000-0000-4000-8000-000000000009'::uuid, 'urn:uuid:8f600000-0000-4000-8000-0000000000b5')
) as x(id, creator, host);
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, created_by, execution_provider, execution_host_id)
select '8f600000-0000-4000-8000-00000000005c', tenant_id, '8f600000-0000-4000-8000-000000000021', 'A',
  user_id, 'chatgpt_local', 'urn:uuid:8f600000-0000-4000-8000-0000000000b2'
from public.tenant_memberships where user_id = '8f600000-0000-4000-8000-000000000005';
update public.takeoff_jobs set created_at = (select t from clock)
where id in ('8f600000-0000-4000-8000-000000000052', '8f600000-0000-4000-8000-000000000053',
  '8f600000-0000-4000-8000-000000000055', '8f600000-0000-4000-8000-000000000056',
  '8f600000-0000-4000-8000-000000000058', '8f600000-0000-4000-8000-00000000005c');
update public.tenants set is_active = false
where id = (select tenant_id from public.tenant_memberships where user_id = '8f600000-0000-4000-8000-000000000005');

select pg_temp.claim_old('8f600000-0000-4000-8000-000000000051', (select t from clock), (select t from clock) + interval '25 hours');
select pg_temp.claim_old(x.id, (select t from clock) - interval '2 hours', now() + interval '1 hour')
from (values ('8f600000-0000-4000-8000-000000000054'::uuid), ('8f600000-0000-4000-8000-000000000057'::uuid)) as x(id);
update public.takeoff_jobs set status = 'completed'
where id in ('8f600000-0000-4000-8000-000000000054', '8f600000-0000-4000-8000-000000000057');
update public.takeoff_jobs set completed_at = (select t from clock) - interval '1 hour'
where id = '8f600000-0000-4000-8000-000000000054';
-- A due retry on the silent Mac, scheduled for T + 1 h by a worker that then disappeared.
select pg_temp.claim_old('8f600000-0000-4000-8000-000000000059', (select t from clock), now() + interval '1 hour');
update public.takeoff_jobs set status = 'failed', error_code = 'AI_TIMEOUT', last_error_at = (select t from clock),
  next_retry_at = (select t from clock) + interval '1 hour', processing_lease_token = null, processing_lease_expires_at = null
where id = '8f600000-0000-4000-8000-000000000059';
-- b5 has given no sign of life: it has no activity row, only the stamps of that claim and failure.
select is((select count(*) from private.takeoff_local_host_activity where host_id = 'urn:uuid:8f600000-0000-4000-8000-0000000000b5'),
  0::bigint, 'a job write gives no sign of life: only the poller does');
select is((select analysis_outcome from public.takeoff_jobs where id = '8f600000-0000-4000-8000-000000000059'), null,
  'the scheduled retry has no end');

insert into private.takeoff_local_host_activity as a (host_id, live_since, seen_at)
select 'urn:uuid:8f600000-0000-4000-8000-0000000000' || host, t - interval '1 hour', t - interval '1 hour'
from clock cross join (values ('b1'), ('b2'), ('b3'), ('b4'), ('b6')) as hosts(host)
on conflict (host_id) do update set live_since = excluded.live_since, seen_at = excluded.seen_at;
-- The claims above stamped their jobs' work in database time, that is now; b2's last work ended at T - 1 h.
update private.takeoff_local_job_work set worked_at = (select t from clock) - interval '1 hour'
where job_id = '8f600000-0000-4000-8000-000000000054';

create function pg_temp.recover_at(p_offset interval) returns setof uuid language plpgsql as $$
declare
  at timestamptz := (select t from clock) + p_offset;
begin
  -- The live Macs gave their last sign just now, in database time; b3 woke up two minutes before the instant, and
  -- b4 ended a job five minutes before it.
  update private.takeoff_local_host_activity set seen_at = clock_timestamp(),
    live_since = case when host_id like '%b3' then at - interval '2 minutes' else live_since end
  where host_id like 'urn:uuid:8f600000-0000-4000-8000-0000000000b_';
  update private.takeoff_local_job_work set worked_at = at - interval '5 minutes'
  where job_id = '8f600000-0000-4000-8000-000000000057';
  return query select r.job_id from public.recover_stale_local_takeoff_jobs(at) r;
end;
$$;
create function pg_temp.state(p_id uuid) returns text language sql as $$
  select status::text || coalesce(' ' || error_code, '') from public.takeoff_jobs where id = p_id;
$$;

select is(array(select pg_temp.recover_at(interval '14 minutes') order by 1), '{}'::uuid[],
  'at T + 14 min nothing waiting is closed: a busy Mac, an idle one within its grace, a silent one');
select results_eq($$select pg_temp.state(id) from (values ('8f600000-0000-4000-8000-000000000052'::uuid),
    ('8f600000-0000-4000-8000-000000000053'::uuid), ('8f600000-0000-4000-8000-000000000058'::uuid)) as x(id)$$,
  $$values ('pending'::text), ('pending'::text), ('pending'::text)$$, 'the queued, the idle and the silent jobs still wait');

select is(array(select pg_temp.recover_at(interval '16 minutes') order by 1),
  array['8f600000-0000-4000-8000-000000000053'::uuid],
  'at T + 16 min only the job a live, idle Mac left untaken for its grace is closed');
select is(pg_temp.state('8f600000-0000-4000-8000-000000000053'), 'failed TAKEOFF_WORKER_NOT_STARTED',
  'nobody took it: its end says it did not start');
select results_eq($$select outcome, reason_code, recipient_user_id from public.takeoff_completion_notifications
    where job_id = '8f600000-0000-4000-8000-000000000053'$$,
  $$values ('failure'::text, 'TAKEOFF_WORKER_NOT_STARTED'::text, '8f600000-0000-4000-8000-000000000007'::uuid)$$,
  'its notice says which of the two happened');
select is(pg_temp.state('8f600000-0000-4000-8000-00000000005c'), 'pending',
  'a job of a suspended tenant is not counted as untaken by the Mac that skips it');

-- Closed by this rule, the job cannot be claimed afterwards: a callback stopped between its read and its claim,
-- the deployed claim, and a relaunch all find it closed.
select is(pg_temp.claim_new('8f600000-0000-4000-8000-000000000053', gen_random_uuid(), 'pending', 0), 0::bigint,
  'a callback that read it pending cannot claim the closed job');
select is(pg_temp.claim_new('8f600000-0000-4000-8000-000000000053', gen_random_uuid(), 'failed', 0), 0::bigint,
  'a callback that reads it failed cannot claim it either');
select is(pg_temp.claim_old('8f600000-0000-4000-8000-000000000053', now(), now() + interval '1 hour'), 0::bigint,
  'the deployed claim cannot start it');
set local role service_role;
select throws_ok($$select pg_temp.old_resubmit('8f600000-0000-4000-8000-000000000053')$$, '23514', null,
  'even a reset without a session cannot reopen it');
reset role;
select is(pg_temp.state('8f600000-0000-4000-8000-000000000053'), 'failed TAKEOFF_WORKER_NOT_STARTED', 'it stays closed');

select is(array(select pg_temp.recover_at(interval '23 hours') order by 1), '{}'::uuid[],
  'at T + 23 h the queue behind a busy Mac, a woken Mac and a silent Mac still wait');

select is(array(select pg_temp.recover_at(interval '24 hours 1 minute') order by 1),
  array['8f600000-0000-4000-8000-000000000052'::uuid, '8f600000-0000-4000-8000-000000000055'::uuid,
    '8f600000-0000-4000-8000-000000000056'::uuid, '8f600000-0000-4000-8000-000000000058'::uuid,
    '8f600000-0000-4000-8000-00000000005c'::uuid],
  'past the 24-hour ceiling every waiting job is closed, the due retry scheduled an hour later excepted');
select results_eq($$select pg_temp.state(id) from (values ('8f600000-0000-4000-8000-000000000052'::uuid),
    ('8f600000-0000-4000-8000-000000000056'::uuid), ('8f600000-0000-4000-8000-000000000055'::uuid),
    ('8f600000-0000-4000-8000-000000000058'::uuid), ('8f600000-0000-4000-8000-00000000005c'::uuid)) as x(id)$$,
  $$values ('failed TAKEOFF_WORKER_QUEUE_EXPIRED'::text), ('failed TAKEOFF_WORKER_QUEUE_EXPIRED'::text),
    ('failed TAKEOFF_WORKER_NOT_STARTED'::text), ('failed TAKEOFF_WORKER_HOST_SILENT'::text),
    ('failed TAKEOFF_WORKER_NOT_STARTED'::text)$$,
  'behind a busy or working Mac it was waiting its turn; a woken or skipping Mac did not take it; a silent one never reported');
select is(pg_temp.state('8f600000-0000-4000-8000-000000000051'), 'processing', 'the job under lease keeps running');

select is(array(select pg_temp.recover_at(interval '25 hours 1 minute') order by 1),
  array['8f600000-0000-4000-8000-000000000051'::uuid, '8f600000-0000-4000-8000-000000000059'::uuid],
  'an expired lease and the due retry past its own ceiling are closed');
select results_eq($$select pg_temp.state(id), analysis_outcome from public.takeoff_jobs
    where id in ('8f600000-0000-4000-8000-000000000051', '8f600000-0000-4000-8000-000000000059') order by id$$,
  $$values ('failed TAKEOFF_WORKER_OUTCOME_UNKNOWN'::text, 'failure'::text),
    ('failed TAKEOFF_WORKER_HOST_SILENT'::text, 'failure'::text)$$,
  'the lost worker ends as unknown, the retry of the silent Mac as never reported');

-- The owner states another ceiling: a job queued behind the busy b6 is closed after three hours of waiting.
update private.takeoff_completion_activation set wait_ceiling = interval '3 hours', pickup_grace = interval '10 minutes';
select pg_temp.add_job(x.id, '8f600000-0000-4000-8000-000000000009', 'urn:uuid:8f600000-0000-4000-8000-0000000000b6')
from (values ('8f600000-0000-4000-8000-00000000005a'::uuid), ('8f600000-0000-4000-8000-00000000005b'::uuid),
  ('8f600000-0000-4000-8000-00000000005d'::uuid)) as x(id);
select pg_temp.claim_old('8f600000-0000-4000-8000-00000000005a', (select t from clock) + interval '26 hours',
  (select t from clock) + interval '50 hours');
update public.takeoff_jobs set created_at = (select t from clock) + interval '30 hours'
where id = '8f600000-0000-4000-8000-00000000005b';
-- A due retry behind the same busy Mac, scheduled for T + 30 h.
select pg_temp.claim_old('8f600000-0000-4000-8000-00000000005d', (select t from clock) + interval '29 hours', now() + interval '1 hour');
update public.takeoff_jobs set status = 'failed', error_code = 'AI_TIMEOUT', last_error_at = (select t from clock) + interval '29 hours',
  next_retry_at = (select t from clock) + interval '30 hours', processing_lease_token = null, processing_lease_expires_at = null
where id = '8f600000-0000-4000-8000-00000000005d';
select is(array(select pg_temp.recover_at(interval '32 hours') order by 1), '{}'::uuid[],
  'two hours behind the busy Mac it still waits');
select is(array(select pg_temp.recover_at(interval '33 hours 1 minute') order by 1),
  array['8f600000-0000-4000-8000-00000000005b'::uuid, '8f600000-0000-4000-8000-00000000005d'::uuid],
  'past the configured ceiling the queued job and the due retry are closed');
select results_eq($$select pg_temp.state(id) from (values ('8f600000-0000-4000-8000-00000000005b'::uuid),
    ('8f600000-0000-4000-8000-00000000005d'::uuid)) as x(id)$$,
  $$values ('failed TAKEOFF_WORKER_QUEUE_EXPIRED'::text), ('failed TAKEOFF_WORKER_QUEUE_EXPIRED'::text)$$,
  'both while waiting their turn');

-- The recovery's own closures are not work of the Mac. On b7, live but whose poller takes nothing, a due retry is
-- closed by the grace; a job queued five minutes after its retry fell due then waits the grace from its own queue
-- time, not from the moment the recovery closed the retry.
select pg_temp.add_job(x.id, '8f600000-0000-4000-8000-000000000009', 'urn:uuid:8f600000-0000-4000-8000-0000000000b7')
from (values ('8f600000-0000-4000-8000-00000000005e'::uuid), ('8f600000-0000-4000-8000-00000000005f'::uuid)) as x(id);
select pg_temp.claim_old('8f600000-0000-4000-8000-00000000005e', (select t from clock) + interval '40 hours', now() + interval '1 hour');
update public.takeoff_jobs set status = 'failed', error_code = 'AI_TIMEOUT', last_error_at = (select t from clock) + interval '40 hours',
  next_retry_at = (select t from clock) + interval '40 hours 1 minute', processing_lease_token = null, processing_lease_expires_at = null
where id = '8f600000-0000-4000-8000-00000000005e';
update public.takeoff_jobs set created_at = (select t from clock) + interval '40 hours 5 minutes'
where id = '8f600000-0000-4000-8000-00000000005f';
-- b7 has been live since T + 39 h; its last own work is that failure at T + 40 h.
insert into private.takeoff_local_host_activity (host_id, live_since, seen_at)
select 'urn:uuid:8f600000-0000-4000-8000-0000000000b7', t + interval '39 hours', clock_timestamp() from clock;
update private.takeoff_local_job_work set worked_at = t + interval '40 hours' from clock
where job_id = '8f600000-0000-4000-8000-00000000005e';
select is(array(select pg_temp.recover_at(interval '40 hours 11 minutes') order by 1),
  array['8f600000-0000-4000-8000-00000000005e'::uuid], 'the due retry the live, idle Mac leaves untaken is closed');
select is(pg_temp.state('8f600000-0000-4000-8000-00000000005e'), 'failed TAKEOFF_WORKER_NOT_STARTED',
  'nobody took the retry');
select is(array(select pg_temp.recover_at(interval '40 hours 15 minutes 30 seconds') order by 1),
  array['8f600000-0000-4000-8000-00000000005f'::uuid], 'the next job is closed after its own grace');
select is(pg_temp.state('8f600000-0000-4000-8000-00000000005f'), 'failed TAKEOFF_WORKER_NOT_STARTED',
  'nobody took it either');
select throws_ok($$update private.takeoff_completion_activation set pickup_grace = interval '9 minutes'$$, '23514', null,
  'a grace shorter than ten minutes is refused');
select throws_ok($$update private.takeoff_completion_activation set wait_ceiling = interval '59 minutes'$$, '23514', null,
  'a ceiling shorter than an hour is refused');
select throws_ok($$update private.takeoff_completion_activation set pickup_grace = interval '4 hours'$$, '23514', null,
  'a grace longer than the ceiling is refused');

-- 3. The private delivery follows the affaire's read rule, like the shared state. The administrator who launched
-- and relaunched a job on the engineer's affaire is now a director: the affaire stays readable, the job no longer is.
update public.tenant_memberships set role = 'director'
where user_id = '8f600000-0000-4000-8000-000000000002' and tenant_id = (select tenant_id from fixture);
create temporary table second_event as
select n.id from public.takeoff_completion_notifications n where n.project_id = '8f600000-0000-4000-8000-000000000010'
order by n.finished_at desc, n.id desc limit 1 offset 1;
grant select on second_event to authenticated;
select set_config('request.jwt.claim.sub', '8f600000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*) from public.takeoff_jobs where id = '8f600000-0000-4000-8000-000000000042'), 0::bigint,
  'the job''s own rule hides it from the director');
select results_eq($$select outcome, reason_code from public.takeoff_completion_notifications
    where job_id = '8f600000-0000-4000-8000-000000000042'$$,
  $$values ('failure'::text, 'AI_PROVIDER'::text)$$, 'the director''s notice carries the reason of its end');
select results_eq($$select outcome, reason_code from public.list_affaire_takeoff_completions(
    '8f600000-0000-4000-8000-000000000010', 20, 0, '8f600000-0000-4000-8000-000000000042')$$,
  $$values ('failure'::text, 'AI_PROVIDER'::text)$$, 'the shared state names that job''s end and reason for the link');
select is((select count(*) from public.list_affaire_takeoff_completions('8f600000-0000-4000-8000-000000000010', 1, 0)),
  1::bigint, 'the shared list is paged');
select results_eq($$select event_id from public.list_affaire_takeoff_completions('8f600000-0000-4000-8000-000000000010', 1, 1)$$,
  $$select id from second_event$$, 'its next page holds exactly the next event');
reset role;
select set_config('request.jwt.claim.sub', '8f600000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*) from public.list_affaire_takeoff_completions('8f600000-0000-4000-8000-000000000010')), 0::bigint,
  'an engineer who does not own the affaire reads no shared end');
reset role;
select is((select reason_code from public.takeoff_completion_notifications where job_id = '8f600000-0000-4000-8000-000000000041'),
  null, 'a success has no reason');
set local role service_role;
select throws_ok($$update public.takeoff_completion_notifications set reason_code = 'AI_TIMEOUT'
    where job_id = '8f600000-0000-4000-8000-000000000042'$$, '42501', 'TAKEOFF_COMPLETION_IDENTITY_IMMUTABLE',
  'the mailer cannot rewrite the reason');
reset role;
-- The e-mail applies the same check as the inbox: the director still reads the affaire.
create temporary table director_claim as select * from public.claim_takeoff_completion_email(
  (select id from public.takeoff_completion_notifications where job_id = '8f600000-0000-4000-8000-000000000042'));
select ok((select public.prepare_takeoff_completion_email(id, lease_token, 'redirect', 'collector@example.test', 'fixture')
  from director_claim), 'the e-mail is prepared for the requester who still reads the affaire');

-- 5. At the moment of sending, the lease and the age of the first attempt are checked again.
create temporary table first_sender as select * from public.claim_takeoff_completion_email(
  (select id from public.takeoff_completion_notifications where job_id = '8f600000-0000-4000-8000-000000000041'));
select ok((select public.prepare_takeoff_completion_email(id, lease_token, 'redirect', 'collector@example.test', 'fixture')
  from first_sender), 'the first sender prepares');
select ok((select public.confirm_takeoff_completion_email_dispatch(id, lease_token) between 1 and 120000 from first_sender),
  'while it holds its lease it may send, for at most the rest of the lease');
-- The first sender pauses after prepare; its lease expires and a second sender sends.
update public.takeoff_completion_notifications set lease_expires_at = clock_timestamp() - interval '1 second'
where id = (select id from first_sender);
create temporary table second_sender as select * from public.claim_takeoff_completion_email((select id from first_sender));
grant select on first_sender, second_sender to service_role;
select ok((select public.prepare_takeoff_completion_email(id, lease_token, 'redirect', 'collector@example.test', 'fixture')
  from second_sender), 'the second sender prepares the same envelope');
select ok((select public.confirm_takeoff_completion_email_dispatch(id, lease_token) > 0 from second_sender),
  'the second sender may send');
set local role service_role;
update public.takeoff_completion_notifications set next_attempt_at = null, delivery_state = 'sent', provider_id = 'fixture-id',
  last_delivery_code = null, lease_token = null, lease_expires_at = null
where id = (select id from second_sender) and lease_token = (select lease_token from second_sender);
reset role;
select is((select public.confirm_takeoff_completion_email_dispatch(id, lease_token) from first_sender), null,
  'the first sender, resuming, may not send again');
select is((select delivery_state from public.takeoff_completion_notifications where id = (select id from first_sender)), 'sent',
  'the delivery stays sent');
-- A sender whose first attempt is older than the provider keeps its key may not send either.
update public.takeoff_completion_notifications set first_send_at = clock_timestamp() - interval '23 hours 1 second'
where id = (select id from director_claim);
select is((select public.confirm_takeoff_completion_email_dispatch(id, lease_token) from director_claim), null,
  'past the idempotency window the sender may not send');
select results_eq($$select delivery_state, last_delivery_code, lease_token is null from public.takeoff_completion_notifications
    where id = (select id from director_claim)$$, $$values ('unknown'::text, 'IDEMPOTENCY_WINDOW_EXPIRED'::text, true)$$,
  'its delivery is left to verify, without a second send');
select ok(has_function_privilege('service_role', 'public.confirm_takeoff_completion_email_dispatch(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.confirm_takeoff_completion_email_dispatch(uuid,uuid)', 'EXECUTE'),
  'only the worker checks a dispatch');

-- What a Mac last did: a sign of life keeps its live period; a gap longer than five minutes starts a new one.
select public.record_local_takeoff_host_activity('urn:uuid:8f600000-0000-4000-8000-0000000000c1');
update private.takeoff_local_host_activity set live_since = clock_timestamp() - interval '1 hour',
  seen_at = clock_timestamp() - interval '1 minute' where host_id = 'urn:uuid:8f600000-0000-4000-8000-0000000000c1';
select public.record_local_takeoff_host_activity('urn:uuid:8f600000-0000-4000-8000-0000000000c1');
select ok((select live_since < clock_timestamp() - interval '59 minutes' and seen_at > clock_timestamp() - interval '1 minute'
  from private.takeoff_local_host_activity where host_id = 'urn:uuid:8f600000-0000-4000-8000-0000000000c1'),
  'a beat within the live window keeps the live period');
update private.takeoff_local_host_activity set seen_at = clock_timestamp() - interval '6 minutes'
where host_id = 'urn:uuid:8f600000-0000-4000-8000-0000000000c1';
select public.record_local_takeoff_host_activity('urn:uuid:8f600000-0000-4000-8000-0000000000c1');
select ok((select live_since > clock_timestamp() - interval '1 minute'
  from private.takeoff_local_host_activity where host_id = 'urn:uuid:8f600000-0000-4000-8000-0000000000c1'),
  'a beat after a longer gap starts a new live period');
select throws_ok($$select public.record_local_takeoff_host_activity('not-a-host')$$, '22023', 'TAKEOFF_HOST_ACTIVITY_INVALID',
  'only a host identifier is recorded');
select ok(has_function_privilege('service_role', 'public.record_local_takeoff_host_activity(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_local_takeoff_host_activity(text)', 'EXECUTE')
  and not has_table_privilege('service_role', 'private.takeoff_local_host_activity', 'SELECT'),
  'only the worker records a sign of life, through the function');

select * from finish();
rollback;
