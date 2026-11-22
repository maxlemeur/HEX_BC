-- Lot 3, migration A (20261121231238_takeoff_plan_dispatcher.sql): one analysis per plan. Nothing of format 2 before the
-- owner's activation; a request seals one unit per plan and inserts their jobs in one commit, each attesting the
-- projection of its unit; one plan at a time on the Mac (its slot); every paid call reserved before it is sent and settled
-- once; a plan that fails does not stop the others; the request ends on its last unit with one notice, partial when some
-- plans were read; a member's stop cancels the rest and keeps what was read; a unit never started when the budget is spent
-- is closed with that reason; a per-plan analysis is linked to a draft only by its send. Single session; the races are in
-- takeoff-plan-dispatcher-race.test.sql. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5100000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;

-- Engineer 1 owns the affaires; 3 is a director (a reader).
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'plan-dispatcher-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 3) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5100000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Analyses par plan (fictif)', 'plan-dispatcher-test');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(3), 'director', true, '2020-01-01');
-- Affaires 20 to 29, each with its dossier's plan set (40 + n) of plans (named so that their order is not their identifier's).
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(20 + n), pg_temp.f(10), pg_temp.f(1), 'Affaire par plan ' || n || ' (fictive)' from generate_series(0, 9) as n;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select pg_temp.f(30 + n), pg_temp.f(20 + n), pg_temp.f(1), 'ready' from generate_series(0, 9) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select pg_temp.f(60 + n), pg_temp.f(20 + n), pg_temp.f(30 + n), 'confirme', 'Résumé fictif', 'Objet fictif', now(), pg_temp.f(1)
from generate_series(0, 9) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select pg_temp.f(40 + n), pg_temp.f(10), pg_temp.f(20 + n), 'Plans du dossier' from generate_series(0, 9) as n;
-- Plan files 100 + 10 n + k (k = 1..3; affaires 26 and 29 hold 7 plans, 161 to 167 and 191 to 197, the latter named
-- against their identifiers: plan-1 is 197).
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(100 + 10 * n + k), pg_temp.f(10), pg_temp.f(40 + n), 'plan-' || (4 - k) || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(40 + n), pg_temp.f(100 + 10 * n + k), 'plan-' || (4 - k) || '.pdf'), 'application/pdf', 8, 9
from (select n from generate_series(0, 9) as n where n not in (6, 9)) as n cross join generate_series(1, 3) as k
union all
select pg_temp.f(160 + k), pg_temp.f(10), pg_temp.f(46), 'plan-' || k || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(46), pg_temp.f(160 + k), 'plan-' || k || '.pdf'), 'application/pdf', 8, 1
from generate_series(1, 7) as k
union all
select pg_temp.f(190 + k), pg_temp.f(10), pg_temp.f(49), 'plan-' || (8 - k) || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(49), pg_temp.f(190 + k), 'plan-' || (8 - k) || '.pdf'), 'application/pdf', 8, 9
from generate_series(1, 7) as k;
-- A CCTP of affaire 20, a common reference of its plans.
insert into public.affaire_intake_documents (id, upload_id, file_name, upload_status, storage_path, classification_status, document_kind)
values (pg_temp.f(70), pg_temp.f(30), 'cctp.pdf', 'uploaded', 'fixture/cctp.pdf', 'classified', 'cctp');

-- The confirmed preparation of an affaire's plans (first plan read on its pages 2 and 7), and the manifest of format 2
-- the server seals for it: units in the order of their names (plan-1, plan-2, plan-3: identifiers 3, 2, 1), equal shares.
-- Each plan carries the digest its sealing recorded (a fictional one, derived from its identifier).
create function pg_temp.digest(plan uuid) returns text language sql immutable as $$
  select encode(sha256(convert_to(plan::text, 'UTF8')), 'hex')
$$;
create function pg_temp.snapshot(project integer, reference boolean default false) returns jsonb language sql as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-21T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(source order by source ->> 'document_id') from (
        select jsonb_build_object('document_id', f.id, 'document_name', f.file_name, 'kind', 'plan', 'active', true, 'confirmed', true,
          'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count, 'source_updated_at', f.updated_at,
          'content_hash', pg_temp.digest(f.id), 'pages', case when f.file_name = 'plan-1.pdf' then '[2, 7]'::jsonb else '[]'::jsonb end) as source
        from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)
        union all
        select jsonb_build_object('document_id', d.id, 'document_name', d.file_name, 'kind', 'cctp', 'active', true, 'confirmed', true,
          'plan_set_id', null, 'file_path', d.storage_path, 'source_updated_at', d.updated_at, 'pages', '[]'::jsonb)
        from public.affaire_intake_documents d where reference and d.id = pg_temp.f(70)) s)))
$$;
create function pg_temp.manifest(project integer, tokens integer default 400000, cents integer default 2500) returns jsonb language sql as $$
  with plans as (
    select f.id, f.file_name, row_number() over (order by f.file_name, f.id) as ordinal, count(*) over () as units,
      case when f.file_name = 'plan-1.pdf' then '[2, 7]'::jsonb else '[]'::jsonb end as pages
    from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)
  )
  select jsonb_build_object('format_version', 2, 'intent', 'initial',
    'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
    'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
    'units', (select jsonb_agg(jsonb_build_object('key', 'plan:' || p.id, 'ordinal', p.ordinal, 'plans', jsonb_build_array(p.id),
      'pages', p.pages, 'page_count', 9, 'vector_pages', 0,
      'budget', jsonb_build_object('tokens', ceil(tokens::numeric / p.units), 'cost_cents', ceil(cents::numeric / p.units))) order by p.ordinal) from plans p),
    'plans', (select jsonb_agg(jsonb_build_object('entry_key', p.id, 'plan_file_id', p.id, 'name', p.file_name, 'logical_id', p.id,
      'content_sha256', pg_temp.digest(p.id), 'pages', p.pages, 'page_count', 9) order by p.ordinal) from plans p),
    'coverage', jsonb_build_object('plans_retained', (select count(*) from plans), 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
    'budget', jsonb_build_object('tokens', tokens, 'cost_cents', cents))
$$;
create function pg_temp.jobs(project integer) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', pg_temp.f(1000 + 10 * project + (u.value ->> 'ordinal')::integer),
      'plan_set_id', pg_temp.f(project + 20), 'launch_unit_key', u.value ->> 'key', 'source_file_name', 'plan.pdf',
      'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host())
    order by (u.value ->> 'ordinal')::integer)
  from jsonb_array_elements(pg_temp.manifest(project) -> 'units') u(value)
$$;
-- The job of a request's unit by its place in the recorded order.
create function pg_temp.unit(project integer, ordinal integer) returns uuid language sql immutable as $$
  select pg_temp.f(1000 + 10 * project + ordinal)
$$;
create function pg_temp.launch(project integer, reference boolean default false, tokens integer default 400000)
returns table (outcome text, request_id uuid, job_id uuid) language sql as $$
  select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(project), pg_temp.f(1), pg_temp.f(500 + project),
    'initial', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(project, tokens), pg_temp.snapshot(project, reference),
    pg_temp.jobs(project), pg_temp.f(project + 20), 1,
    (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)))
$$;
create function pg_temp.request(project integer) returns uuid language sql as $$
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(project) order by created_at desc limit 1
$$;
create function pg_temp.claim(job uuid, token integer, observed text default 'pending', retries integer default 0)
returns integer language sql as $$
  select count(*)::integer from public.claim_observed_local_takeoff_job(job, pg_temp.f(10), pg_temp.host(), clock_timestamp(),
    pg_temp.f(token), clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', observed, retries)
$$;
create function pg_temp.reserve(job uuid, token integer, call text, estimate bigint default 30000)
returns table (outcome text, reason text, reserved_tokens bigint) language sql as $$
  select r.outcome, r.reason, r.reserved_tokens from public.reserve_takeoff_launch_call(job, pg_temp.f(token), call, 'pdf', estimate) r
$$;
create function pg_temp.settle(job uuid, token integer, call text, tokens bigint) returns bigint language sql as $$
  select remaining_tokens from public.record_takeoff_launch_usage(job, pg_temp.f(token), call, tokens, 0)
$$;
create function pg_temp.complete(job uuid) returns void language sql as $$
  update public.takeoff_jobs set status = 'completed', completed_at = clock_timestamp() where id = job and status = 'processing'
$$;
create function pg_temp.fail(job uuid, code text) returns void language sql as $$
  update public.takeoff_jobs set status = 'failed', completed_at = clock_timestamp(), error_code = code, error_message = 'Échec fictif',
    analysis_outcome = 'failure', next_retry_at = null, last_error_at = clock_timestamp() where id = job and status = 'processing'
$$;
-- The worker's end of an attempt on a failure it would retry (record_local_takeoff_failure, under the attempt's lease).
create function pg_temp.fail_attempt(job uuid, token integer) returns jsonb language sql as $$
  select public.record_local_takeoff_failure(job, pg_temp.f(10), pg_temp.f(token), jsonb_build_object(
    'completed_at', clock_timestamp(), 'duration_ms', 10, 'error_code', 'AI_PROVIDER', 'error_message', 'Échec fictif',
    'analysis_outcome', null, 'last_error_at', clock_timestamp(), 'next_retry_at', clock_timestamp() - interval '1 second'))
$$;
create function pg_temp.dispatch() returns uuid language sql as $$
  select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())
$$;

-- Each affaire's confirmed preparation of revision 1, the one its commands name: its plans are those its snapshot reads.
create function pg_temp.confirm(project integer) returns void language sql as $$
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by)
  values (pg_temp.f(10), pg_temp.f(project), 1, pg_temp.snapshot(project) -> 'preparation', pg_temp.snapshot(project), now(),
    pg_temp.f(1), pg_temp.f(1))
$$;
set local session_replication_role = replica;
select pg_temp.confirm(20 + n) from generate_series(0, 9) as n;
set local session_replication_role = origin;

-- 1. Before the owner's activation of one analysis per plan (the automatic start and the notices are active).
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');
select is(public.takeoff_plan_dispatch_is_active(), false, 'one analysis per plan is not active before its activation');
select throws_ok($$select * from pg_temp.launch(20)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID',
  'before its activation no request of format 2 is sealed');
select is((select count(*)::integer from public.dispatch_next_takeoff_host_job(pg_temp.host())), 0,
  'before its activation the dispatcher answers nothing (the Mac keeps its former order)');
-- A job claimed before the activation renews its lease every minute: its heartbeat writes nothing to any Mac's slot (the
-- closing review's point 1; the probe for a plan at work is an index lookup, measured in the pull request).
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, execution_provider,
  execution_host_id, processing_lease_token, processing_lease_expires_at, started_at)
values (pg_temp.f(3990), pg_temp.f(10), pg_temp.f(28), pg_temp.f(48), 'C', 'processing', pg_temp.f(1), 'chatgpt_local',
  'urn:uuid:d5100000-0000-4000-8000-000000000097', pg_temp.f(3991), clock_timestamp() + interval '30 minutes', clock_timestamp());
set local session_replication_role = origin;
select is(public.renew_takeoff_processing_lease(pg_temp.f(3990), pg_temp.f(10), pg_temp.f(3991), clock_timestamp(),
  clock_timestamp() + interval '40 minutes'), true, 'a job claimed before the activation renews its lease as before');
select is((select count(*)::integer from pg_locks where pid = pg_backend_pid() and relation = 'private.takeoff_host_slots'::regclass
  and mode = 'RowExclusiveLock'), 0, 'without writing to any Mac''s slot');
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now(),
  processing_lease_token = null, processing_lease_expires_at = null where id = pg_temp.f(3990);
set local session_replication_role = origin;

-- 2. Activation; a request of three plans gives one request and three jobs, in one commit.
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute');
create temp table admissions_before as
  select count(*) as jobs from public.takeoff_job_admissions where tenant_id = pg_temp.f(10);
select results_eq($$select outcome, job_id from pg_temp.launch(20, true)$$, $$values ('admitted'::text, pg_temp.unit(20, 1))$$,
  'a request of three plans is admitted; its answer names the first unit''s job');
select results_eq($$select state, units_expected, manifest -> 'format_version' from public.takeoff_launch_requests where id = pg_temp.request(20)$$,
  $$values ('admitted'::text, 3, '2'::jsonb)$$, 'one request of three units');
select results_eq($$select launch_unit_key, status::text, estimate_version_id is null from public.takeoff_jobs
    where launch_request_id = pg_temp.request(20) order by id$$,
  $$values ('plan:' || pg_temp.f(103), 'pending'::text, true), ('plan:' || pg_temp.f(102), 'pending'::text, true),
    ('plan:' || pg_temp.f(101), 'pending'::text, true)$$,
  'one pending job per plan, keyed by its plan, without a version');
-- Each job attests the projection of its unit: its one plan, the common reference, and a reference to its request.
select results_eq($$select j.id, (select array_agg(s ->> 'document_id' order by s ->> 'document_id')
      from jsonb_array_elements(j.preparation_snapshot #> '{preparation,sources}') s),
    j.preparation_snapshot #>> '{launch_unit,request_id}', (j.preparation_snapshot #>> '{launch_unit,ordinal}')::integer
    from public.takeoff_jobs j where j.launch_request_id = pg_temp.request(20) order by (j.preparation_snapshot #>> '{launch_unit,ordinal}')::integer$$,
  $$values (pg_temp.unit(20, 1), array[pg_temp.f(70)::text, pg_temp.f(103)::text], pg_temp.request(20)::text, 1),
    (pg_temp.unit(20, 2), array[pg_temp.f(70)::text, pg_temp.f(102)::text], pg_temp.request(20)::text, 2),
    (pg_temp.unit(20, 3), array[pg_temp.f(70)::text, pg_temp.f(101)::text], pg_temp.request(20)::text, 3)$$,
  'each job reads only its plan and the common reference, in the recorded order');
select is((select preparation_snapshot -> 'preparation_revision' from public.takeoff_launch_requests where id = pg_temp.request(20)),
  '1'::jsonb, 'the request''s own snapshot is never written over');
select is((select count(*)::integer from public.audit_logs where action = 'takeoff.job.created'
  and record_id in (select id from public.takeoff_jobs where launch_request_id = pg_temp.request(20))), 3,
  'each job''s creation is recorded in the same commit');
select is((select count(*) - (select jobs from admissions_before) from public.takeoff_job_admissions a
    where a.tenant_id = pg_temp.f(10)), 3::bigint, 'each job is in the admission ledger');
-- A request of seven plans is one analysis for the admission limits (six active jobs per member).
select results_eq($$select outcome from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(26), pg_temp.f(1),
  pg_temp.f(526), 'initial', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(26), pg_temp.snapshot(26), pg_temp.jobs(26),
  pg_temp.f(46), 1, (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(46)))$$,
  $$values ('admitted'::text)$$, 'a request of seven plans is admitted: its units count as one analysis');
select is((select count(*)::integer from public.takeoff_jobs where launch_request_id = pg_temp.request(26)), 7, 'with its seven jobs');
-- Ten jobs of this member now wait (three requests' worth would be counted eleven by jobs): a third request is admitted.
select results_eq($$select outcome from pg_temp.launch(27)$$, $$values ('admitted'::text)$$,
  'with ten jobs waiting in two requests, a third request is still admitted: requests are counted, not their units');
-- Its units are set aside here (without their triggers) so that the next sections start from an idle Mac.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now(),
  next_retry_at = null where launch_request_id in (pg_temp.request(26), pg_temp.request(27));
update public.takeoff_launch_requests set state = 'closed', outcome = 'canceled', closed_at = now(), completion_event_id = gen_random_uuid(),
  units_canceled = units_expected where id in (pg_temp.request(26), pg_temp.request(27));
set local session_replication_role = origin;

-- The seal refuses a manifest that does not match its snapshot or the recorded rules.
select throws_ok($$select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1), pg_temp.f(601),
  'initial', null, pg_temp.host(), pg_temp.selection(), jsonb_set(pg_temp.manifest(21), '{units,0,ordinal}', '2'), pg_temp.snapshot(21),
  pg_temp.jobs(21), pg_temp.f(41), 1, (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(41)))$$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'a unit out of its recorded place is refused');
select throws_ok($$select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1), pg_temp.f(602),
  'initial', null, pg_temp.host(), pg_temp.selection(), jsonb_set(pg_temp.manifest(21), '{units,0,budget,tokens}', '400000'),
  pg_temp.snapshot(21), pg_temp.jobs(21), pg_temp.f(41), 1,
  (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(41)))$$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'shares that add up to more than the envelope are refused');
select throws_ok($$select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1), pg_temp.f(603),
  'initial', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(21),
  jsonb_set(pg_temp.snapshot(21), '{preparation,sources,0,active}', 'false'), pg_temp.jobs(21), pg_temp.f(41), 1,
  (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(41)))$$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'a unit whose plan the snapshot does not read is refused');
select throws_ok($$select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1), pg_temp.f(604),
  'initial', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(21), pg_temp.snapshot(21), pg_temp.jobs(21), pg_temp.f(41), 1,
  array[pg_temp.f(121)])$$, '22023', 'TAKEOFF_LAUNCH_COMMAND_INVALID', 'a command names exactly the plans it seals');
-- What the worker reads and what the activity shows are the same: each plan as its source, each unit as its plan.
select throws_ok($$select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1), pg_temp.f(605),
  'initial', null, pg_temp.host(), pg_temp.selection(), jsonb_set(pg_temp.manifest(21), '{plans,0,pages}', '[]'), pg_temp.snapshot(21),
  pg_temp.jobs(21), pg_temp.f(41), 1, (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(41)))$$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'a plan that declares other pages than its source reads (the whole plan for 2 and 7) is refused');
select throws_ok($$select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1), pg_temp.f(606),
  'initial', null, pg_temp.host(), pg_temp.selection(), jsonb_set(pg_temp.manifest(21), '{units,0,pages}', '[]'), pg_temp.snapshot(21),
  pg_temp.jobs(21), pg_temp.f(41), 1, (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(41)))$$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'a unit that declares other pages than its plan is refused');
select throws_ok($$select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1), pg_temp.f(607),
  'initial', null, pg_temp.host(), pg_temp.selection(), jsonb_set(pg_temp.manifest(21), '{plans,0,name}', '"autre-plan.pdf"'),
  pg_temp.snapshot(21), pg_temp.jobs(21), pg_temp.f(41), 1, (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(41)))$$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'a plan named otherwise than its source is refused');
select throws_ok($$select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1), pg_temp.f(608),
  'initial', null, pg_temp.host(), pg_temp.selection(), jsonb_set(pg_temp.manifest(21), '{units,0,page_count}', '3'),
  pg_temp.snapshot(21), pg_temp.jobs(21), pg_temp.f(41), 1, (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(41)))$$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'a unit that counts other pages than its plan is refused');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(21)), 0, 'none of them left a request');
-- A job cannot be attached to a unit outside its admission, nor to a unit the manifest does not hold.
select throws_ok($$insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, created_by, execution_provider,
  execution_host_id, preparation_snapshot, launch_request_id, launch_unit_key)
  values (pg_temp.f(990), pg_temp.f(10), pg_temp.f(20), pg_temp.f(40), 'C', pg_temp.f(1), 'chatgpt_local', pg_temp.host(),
    pg_temp.snapshot(20), pg_temp.request(20), 'plan:' || pg_temp.f(101))$$, '42501', 'TAKEOFF_JOB_REQUEST_ADMISSION_REQUIRED',
  'a fourth job cannot join the request');

-- 3. The dispatcher serves the units in their recorded order, one at a time on the Mac.
select is(pg_temp.dispatch(), pg_temp.unit(20, 1), 'the dispatcher hands the first unit of the oldest request');
select is(pg_temp.claim(pg_temp.unit(20, 1), 901), 1, 'its claim takes the Mac''s slot');
select results_eq($$select job_id, holder_token, generation from private.takeoff_host_slots where host_id = pg_temp.host()$$,
  $$values (pg_temp.unit(20, 1), pg_temp.f(901), 1::bigint)$$, 'the slot records its job, its holder and a generation');
select is(pg_temp.claim(pg_temp.unit(20, 2), 902), 0, 'a second plan is not started on the Mac while the first is read');
select is((select status::text from public.takeoff_jobs where id = pg_temp.unit(20, 2)), 'pending', 'it waits for its turn');
select is(pg_temp.dispatch(), null::uuid, 'the dispatcher hands nothing while the Mac is busy');

-- 4. The ledger: a call reserved before it is sent, settled once after its answer.
select results_eq($$select outcome, reason, reserved_tokens from pg_temp.reserve(pg_temp.unit(20, 1), 901, 'call:1')$$,
  $$values ('reserved'::text, null::text, 30000::bigint)$$, 'a call is reserved with its bound before it is sent');
select results_eq($$select outcome, reserved_tokens from pg_temp.reserve(pg_temp.unit(20, 1), 901, 'call:1')$$,
  $$values ('reserved'::text, 30000::bigint)$$, 'a replay of the reservation reserves nothing more');
select is((select count(*)::integer from private.takeoff_launch_usage where job_id = pg_temp.unit(20, 1)), 1, 'one row for the call');
select throws_ok($$select * from pg_temp.reserve(pg_temp.unit(20, 1), 999, 'call:2')$$, '42501', 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED',
  'a process that does not hold the job''s lease reserves nothing');
select is(pg_temp.settle(pg_temp.unit(20, 1), 901, 'call:1', 120000), 133334 - 120000::bigint,
  'the answer''s usage settles the call: the unit''s share less what it observed');
select is(pg_temp.settle(pg_temp.unit(20, 1), 901, 'call:1', 120000), 133334 - 120000::bigint, 'settling the same call again counts nothing');
select results_eq($$select tokens_observed from public.takeoff_launch_requests where id = pg_temp.request(20)$$,
  $$values (120000::bigint)$$, 'the request counts it once');
-- The bound of a call is the largest the request observed on its branch: 120 000 here.
select results_eq($$select outcome, reserved_tokens from pg_temp.reserve(pg_temp.unit(20, 1), 901, 'call:2')$$,
  $$values ('reserved'::text, 120000::bigint)$$, 'a call still needs a positive balance only, and reserves its bound');
select results_eq($$select outcome, reason from pg_temp.reserve(pg_temp.unit(20, 1), 901, 'call:3')$$,
  $$values ('wait'::text, null::text)$$, 'while that call is in flight, the next one waits: it may give some back');
select is(pg_temp.settle(pg_temp.unit(20, 1), 901, 'call:2', 20000), -6666::bigint, 'one call may overshoot the share it started within');
select results_eq($$select outcome, reason from pg_temp.reserve(pg_temp.unit(20, 1), 901, 'call:3')$$,
  $$values ('refused'::text, 'BUDGET_EXHAUSTED'::text)$$, 'then the unit''s share is spent: nothing more is sent');
select results_eq($$select reason, remaining_tokens from public.takeoff_job_may_pay(pg_temp.unit(20, 1))$$,
  $$values ('BUDGET_EXHAUSTED'::text, -6666::bigint)$$, 'the check before an attempt reads the same balance');
select results_eq($$select reason, remaining_tokens from public.takeoff_job_may_pay(pg_temp.unit(20, 2))$$,
  $$values (null::text, 133334::bigint)$$, 'another unit''s share is untouched');
-- A reader cannot reserve, settle or read the ledger.
set local role authenticated;
select throws_ok($$select * from pg_temp.reserve(pg_temp.unit(20, 1), 901, 'call:9')$$, '42501', null, 'a member cannot reserve a call');
select throws_ok($$select count(*) from private.takeoff_launch_usage$$, '42501', null, 'nor read the ledger');
select throws_ok($$select * from public.dispatch_next_takeoff_host_job(pg_temp.host())$$, '42501', null, 'nor dispatch');
reset role;

-- 5. The first plan's end gives the Mac back; the second plan fails definitively and does not stop the third.
select pg_temp.complete(pg_temp.unit(20, 1));
select results_eq($$select job_id, holder_token from private.takeoff_host_slots where host_id = pg_temp.host()$$,
  $$values (null::uuid, null::uuid)$$, 'the end of the first plan gives the slot back with its token');
select results_eq($$select state, units_succeeded from public.takeoff_launch_requests where id = pg_temp.request(20)$$,
  $$values ('admitted'::text, 1)$$, 'the first plan read does not end the request');
select is((select count(*)::integer from public.takeoff_completion_notifications where request_id = pg_temp.request(20)), 0,
  'and publishes no notice');
select is(pg_temp.dispatch(), pg_temp.unit(20, 2), 'the dispatcher hands the second unit');
select is(pg_temp.claim(pg_temp.unit(20, 2), 902), 1, 'which takes the Mac');
select is((select generation from private.takeoff_host_slots where host_id = pg_temp.host()), 2::bigint, 'a new generation of the slot');
select pg_temp.fail(pg_temp.unit(20, 2), 'TAKEOFF_PDF_CORRUPTED');
select results_eq($$select state, units_succeeded, units_failed from public.takeoff_launch_requests where id = pg_temp.request(20)$$,
  $$values ('admitted'::text, 1, 1)$$, 'a plan that fails definitively fails alone');
select is(pg_temp.dispatch(), pg_temp.unit(20, 3), 'the third plan follows');
select is(pg_temp.claim(pg_temp.unit(20, 3), 903), 1, 'and takes the Mac');
-- An unknown outcome: a call reserved and never answered, then its attempt ends. It stays held, never credited back.
select results_eq($$select outcome from pg_temp.reserve(pg_temp.unit(20, 3), 903, 'call:1')$$, $$values ('reserved'::text)$$,
  'a call of the third plan is reserved');
select is(public.record_takeoff_launch_call_unknown(pg_temp.unit(20, 3), pg_temp.f(903), 'call:1'), true,
  'its call ended without a known usage: it stays held as unknown');
select results_eq($$select outcome, reason from pg_temp.reserve(pg_temp.unit(20, 3), 903, 'call:2')$$,
  $$values ('refused'::text, 'USAGE_UNKNOWN'::text)$$, 'then no further paid call of the request is made, whatever its share');
select pg_temp.complete(pg_temp.unit(20, 3));
select results_eq($$select call_key, state from private.takeoff_launch_usage where job_id = pg_temp.unit(20, 3) order by call_key$$,
  $$values ('call:1'::text, 'unknown'::text)$$, 'the call stays held as unknown');

-- 6. The end of the last unit closes the request with one notice: two plans read of three.
select results_eq($$select state, outcome, units_succeeded, units_failed, units_not_started, units_canceled, reason_code
    from public.takeoff_launch_requests where id = pg_temp.request(20)$$,
  $$values ('closed'::text, 'partial'::text, 2, 1, 0, 0, null::text)$$, 'the request is partial: two read, one failed');
select results_eq($$select subject_kind, outcome, plans_read_count, plans_failed_count, plans_not_started_count, recipient_user_id,
    delivery_state from public.takeoff_completion_notifications where project_id = pg_temp.f(20)$$,
  $$values ('request'::text, 'partial'::text, 2, 1, 0, pg_temp.f(1), 'pending'::text)$$,
  'one notice of the request to its payer, and none of its jobs');
select is((select count(*)::integer from public.reconcile_takeoff_launch_requests() where request_id = pg_temp.request(20)), 0,
  'a closed request is not reconciled again');
select is(public.read_takeoff_launch_request_units(pg_temp.f(10), pg_temp.f(20), pg_temp.request(20)) -> 'units' @> jsonb_build_array(
    jsonb_build_object('ordinal', 2, 'state', 'failed', 'reason_code', 'TAKEOFF_PDF_CORRUPTED', 'name', 'plan-2.pdf')), true,
  'the reading of the request names each unit''s state and public reason');
select results_eq($$select (u ->> 'ordinal')::integer, u ->> 'state', (u ->> 'job_id')::uuid from
    jsonb_array_elements(public.read_takeoff_launch_request_units(pg_temp.f(10), pg_temp.f(20), pg_temp.request(20)) -> 'units') u$$,
  $$values (1, 'succeeded'::text, pg_temp.unit(20, 1)), (2, 'failed'::text, pg_temp.unit(20, 2)), (3, 'succeeded'::text, pg_temp.unit(20, 3))$$,
  'each unit in exactly one state, in the recorded order');
select is((public.read_takeoff_launch_request_units(pg_temp.f(10), pg_temp.f(20), pg_temp.request(20)) #>> '{usage,unknown_calls}')::integer,
  1, 'the consumption left unknown is told');
select is(public.read_takeoff_launch_request_units(pg_temp.f(10), pg_temp.f(21), pg_temp.request(20)), null::jsonb,
  'a request is read only with its own affaire');

-- 7. A member stops the rest of a request after its first plan: the others are cancelled, the first stays read.
select results_eq($$select outcome from pg_temp.launch(22)$$, $$values ('admitted'::text)$$, 'a second request of three plans');
select is(pg_temp.claim(pg_temp.unit(22, 1), 911), 1, 'its first plan is read');
select pg_temp.complete(pg_temp.unit(22, 1));
select is(pg_temp.claim(pg_temp.unit(22, 2), 912), 1, 'its second plan is being read');
select throws_ok($$select * from public.stop_takeoff_launch_request(pg_temp.f(10), pg_temp.f(22), pg_temp.f(3), pg_temp.request(22))$$,
  '42501', 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE', 'a reader cannot stop it');
select results_eq($$select outcome, request_state, canceled_units from public.stop_takeoff_launch_request(pg_temp.f(10), pg_temp.f(22),
  pg_temp.f(1), pg_temp.request(22))$$, $$values ('stopped'::text, 'closed'::text, 2)$$, 'the operator stops the rest of it');
select results_eq($$select outcome, units_succeeded, units_canceled, reason_code from public.takeoff_launch_requests where id = pg_temp.request(22)$$,
  $$values ('partial'::text, 1, 2, 'STOPPED_BY_MEMBER'::text)$$, 'one plan available, two stopped at a member''s request');
select results_eq($$select outcome, plans_read_count, delivery_state from public.takeoff_completion_notifications
    where request_id = pg_temp.request(22)$$, $$values ('partial'::text, 1, 'pending'::text)$$,
  'its requester is told: the e-mail of a partial end is sent');
select throws_ok($$select * from pg_temp.reserve(pg_temp.unit(22, 2), 912, 'call:1')$$, '42501', 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED',
  'a plan stopped while read can no longer spend');
select pg_temp.complete(pg_temp.unit(22, 2));
select is((select status::text from public.takeoff_jobs where id = pg_temp.unit(22, 2)), 'canceled', 'it stays cancelled');
select is(pg_temp.dispatch(), null::uuid, 'its provider call may still run: the Mac stays held until its worker ends');
select is(public.release_takeoff_host_slot(pg_temp.host(), pg_temp.f(912)), true, 'then its worker gives the Mac back');
select is((select count(*)::integer from public.audit_logs where action = 'takeoff.job.canceled'
  and after_data #>> '{metadata,launch_request_id}' = pg_temp.request(22)::text), 2, 'each cancellation is traced');
-- A stop after a plan failed and before any was read: a failure, not a partial end (nothing was read).
select results_eq($$select outcome from pg_temp.launch(21)$$, $$values ('admitted'::text)$$, 'a request whose first plan fails');
select is(pg_temp.claim(pg_temp.unit(21, 1), 941), 1, 'its first plan is claimed');
select pg_temp.fail(pg_temp.unit(21, 1), 'TAKEOFF_PDF_NOT_INTERPRETABLE');
select results_eq($$select request_state from public.stop_takeoff_launch_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1),
  pg_temp.request(21))$$, $$values ('closed'::text)$$, 'the rest of it is stopped');
select results_eq($$select r.outcome, r.units_failed, r.units_canceled, n.outcome, n.reason_code from public.takeoff_launch_requests r
    join public.takeoff_completion_notifications n on n.request_id = r.id where r.id = pg_temp.request(21)$$,
  $$values ('failure'::text, 1, 2, 'failure'::text, 'TAKEOFF_PDF_NOT_INTERPRETABLE'::text)$$,
  'no plan read and one failed: the request failed, with the failure''s public reason');
-- A full stop before any plan is read: cancelled, no e-mail.
select results_eq($$select outcome from pg_temp.launch(23)$$, $$values ('admitted'::text)$$, 'a third request');
select results_eq($$select request_state, canceled_units from public.stop_takeoff_launch_request(pg_temp.f(10), pg_temp.f(23),
  pg_temp.f(1), pg_temp.request(23))$$, $$values ('closed'::text, 3)$$, 'stopped before any reading');
select results_eq($$select r.outcome, n.delivery_state from public.takeoff_launch_requests r
    join public.takeoff_completion_notifications n on n.request_id = r.id where r.id = pg_temp.request(23)$$,
  $$values ('canceled'::text, 'suppressed'::text)$$, 'a full cancellation sends no e-mail');

-- 8. The request's budget spent before a unit's turn: the unit is closed, never started, with that reason.
select results_eq($$select outcome from pg_temp.launch(24, false, 300)$$, $$values ('admitted'::text)$$,
  'a request of three plans with a small envelope (100 tokens each)');
select is(pg_temp.claim(pg_temp.unit(24, 1), 921), 1, 'its first plan is read');
select results_eq($$select outcome from pg_temp.reserve(pg_temp.unit(24, 1), 921, 'call:1')$$, $$values ('reserved'::text)$$,
  'its one call is reserved');
select pg_temp.settle(pg_temp.unit(24, 1), 921, 'call:1', 1000);
select pg_temp.complete(pg_temp.unit(24, 1));
select results_eq($$select array_length(closed_jobs, 1), job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())$$,
  $$values (2, null::uuid)$$, 'the dispatcher closes the units the spent envelope cannot pay, instead of starting them');
select results_eq($$select outcome, units_succeeded, units_not_started, reason_code from public.takeoff_launch_requests
    where id = pg_temp.request(24)$$, $$values ('partial'::text, 1, 2, 'BUDGET_EXHAUSTED'::text)$$,
  'they count as not started, and the request names its budget');
select results_eq($$select plans_read_count, plans_not_started_count from public.takeoff_completion_notifications
    where request_id = pg_temp.request(24)$$, $$values (1, 2)$$, 'its notice counts them');

-- 9. A unit whose attempt died with a call reserved: that call may have spent what is left, so its request makes no
-- further paid call even before any recovery (its plans not started are closed, none is handed); the hosted recovery
-- then closes the attempt and holds its call as unknown.
select results_eq($$select outcome from pg_temp.launch(25)$$, $$values ('admitted'::text)$$, 'a fourth request');
select is(pg_temp.claim(pg_temp.unit(25, 1), 931), 1, 'its first plan is claimed');
select results_eq($$select outcome from pg_temp.reserve(pg_temp.unit(25, 1), 931, 'call:1')$$, $$values ('reserved'::text)$$,
  'and its call reserved; then the Mac stops');
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second' where id = pg_temp.unit(25, 1);
select results_eq($$select job_id, closed_jobs from public.dispatch_next_takeoff_host_job(pg_temp.host())$$,
  $$values (null::uuid, array[pg_temp.unit(25, 2), pg_temp.unit(25, 3)])$$,
  'the Mac is free, but no plan of the request is handed: those not started are closed');
select is((select count(*)::integer from public.recover_stale_local_takeoff_jobs(now()) where job_id = pg_temp.unit(25, 1)), 1,
  'the recovery closes the abandoned attempt');
select results_eq($$select state from private.takeoff_launch_usage where job_id = pg_temp.unit(25, 1)$$, $$values ('unknown'::text)$$,
  'its call is held as unknown: no second call is made on its credit');
select is((select error_code from public.takeoff_jobs where id = pg_temp.unit(25, 1)), 'TAKEOFF_WORKER_OUTCOME_UNKNOWN',
  'with the unknown outcome named');

-- 10. A per-plan analysis is linked to a draft only by its send, which checks the context it compares (the plans read
-- beside it, their locations) in the same transaction (20261122030312): a link written directly, without that check,
-- is refused (a reconciliation of a request whose ends were not settled: the end of section 14).
select throws_ok($$update public.takeoff_jobs set estimate_version_id = pg_temp.f(80) where id = pg_temp.unit(20, 1)$$,
  '40001', 'TAKEOFF_SEND_JOB_NOT_READY', 'a per-plan analysis is never linked to a draft without its send''s checked context');

-- 11. Affaire 29's seven plans: the dispatcher counts the admission limits as the claim's triggers do, an attempt that
-- holds a call of unknown outcome is never retried on its own, a job read without the slot still holds the Mac, the
-- answers name the first unit by its place, and a stopped reading's late end is refused.
select results_eq($$select outcome, job_id from pg_temp.launch(29)$$, $$values ('admitted'::text, pg_temp.unit(29, 1))$$,
  'a request of seven plans whose names run against their identifiers');
-- A command meanwhile names the analysis it replaces (a first analysis is refused once the affaire has one, 20261121193413).
select results_eq($$select outcome, job_id from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(29), pg_temp.f(1),
  pg_temp.f(629), 'reread_plans', pg_temp.unit(29, 7), pg_temp.host(), pg_temp.selection(), pg_temp.manifest(29), pg_temp.snapshot(29),
  pg_temp.jobs(29), pg_temp.f(49), 1, (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(49)))$$,
  $$values ('already_running'::text, pg_temp.unit(29, 1))$$,
  'a command meanwhile gets the running request''s first unit by its place, not by its key');
select is(pg_temp.dispatch(), pg_temp.unit(29, 1), 'the dispatcher hands its first unit');
select is(pg_temp.claim(pg_temp.unit(29, 1), 951), 1, 'which the Mac reads');
-- A failure after calls whose usage is known keeps its technical retry.
select results_eq($$select outcome from pg_temp.reserve(pg_temp.unit(29, 1), 951, 'call:1')$$, $$values ('reserved'::text)$$,
  'a call of its first attempt is reserved');
select pg_temp.settle(pg_temp.unit(29, 1), 951, 'call:1', 1000);
select results_eq($$select f ->> 'error_code', (f ->> 'retry_scheduled')::boolean from pg_temp.fail_attempt(pg_temp.unit(29, 1), 951) f$$,
  $$values ('AI_PROVIDER'::text, true)$$, 'the attempt ends on a failure its worker would retry, recorded as asked');
select results_eq($$select status::text, next_retry_at is not null, analysis_outcome::text from public.takeoff_jobs
    where id = pg_temp.unit(29, 1)$$, $$values ('failed'::text, true, null::text)$$, 'every usage known, its retry stays planned');
-- Six other units of its request wait: one analysis, so its retry may be claimed, as its claim's trigger counts it.
select results_eq($$select job_id, trigger_kind from public.dispatch_next_takeoff_host_job(pg_temp.host())$$,
  $$values (pg_temp.unit(29, 1), 'retry'::text)$$, 'a due retry is handed while six units of its own request wait');
select is(pg_temp.claim(pg_temp.unit(29, 1), 953, 'failed', 0), 1, 'and its claim is admitted alike');
-- A job read without the slot (claimed before the activation) holds the Mac all the same.
delete from private.takeoff_host_slots where host_id = pg_temp.host();
select is(pg_temp.claim(pg_temp.unit(29, 2), 952), 0, 'a job read without the slot still keeps a second plan from starting');
select is(pg_temp.dispatch(), null::uuid, 'and the dispatcher hands nothing meanwhile');
select pg_temp.complete(pg_temp.unit(29, 1));
-- Twenty attempts of the member today, far fewer analyses: the next unit is handed, and its claim admitted.
insert into public.takeoff_processing_admissions (job_id, attempt_number, tenant_id, created_by, admitted_at)
select j.id, 0, j.tenant_id, j.created_by, clock_timestamp() from public.takeoff_jobs j
where j.launch_request_id in (pg_temp.request(26), pg_temp.request(27));
select ok((select count(*) from public.takeoff_processing_admissions where created_by = pg_temp.f(1)
  and admitted_at > clock_timestamp() - interval '24 hours') >= 20, 'the member''s claims of the day reach twenty attempts');
select is(pg_temp.dispatch(), pg_temp.unit(29, 2), 'they are far fewer analyses: the next unit is handed');
select is(pg_temp.claim(pg_temp.unit(29, 2), 954), 1, 'and its claim is admitted alike');
-- A member stops the rest while the second plan is read: that reading's late end is refused.
select results_eq($$select request_state from public.stop_takeoff_launch_request(pg_temp.f(10), pg_temp.f(29), pg_temp.f(1),
  pg_temp.request(29))$$, $$values ('closed'::text)$$, 'the rest of the request is stopped');
select is(pg_temp.fail_attempt(pg_temp.unit(29, 2), 954), null::jsonb, 'the stopped reading''s failure is refused under its old lease');
select is(public.finalize_local_takeoff_result(pg_temp.unit(29, 2), pg_temp.f(10), pg_temp.f(954), clock_timestamp(), 'fixture', 'fixture',
  '{"extracted_json": {"items": []}, "warnings": [], "tables": [], "provider_meta": {}, "token_count": 0, "cost_cents": 0,
    "run_metrics": []}', '[]'), null, 'and so is its result');
select results_eq($$select status::text, analysis_outcome::text from public.takeoff_jobs where id = pg_temp.unit(29, 2)$$,
  $$values ('canceled'::text, 'canceled'::text)$$, 'it stays cancelled');
-- Its worker gives the Mac back when it ends: the slot is free again for what follows.
select is(public.release_takeoff_host_slot(pg_temp.host(), pg_temp.f(954)), true, 'the stopped worker gives the Mac back');

-- 12. One plan at a time against a renewal, a stop and a withdrawal; an unknown outcome freezes the request.
-- A request's jobs of a later round: their own identifiers and keys, the same manifest and snapshot.
create function pg_temp.round_unit(project integer, round integer, ordinal integer) returns uuid language sql immutable as $$
  select pg_temp.f(3000 + 100 * round + 10 * (project - 20) + ordinal)
$$;
create function pg_temp.plan_command(project integer, round integer, intent text, predecessor uuid)
returns table (outcome text, request_id uuid, job_id uuid) language sql as $$
  select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(project), pg_temp.f(1),
    pg_temp.f(700 + 10 * round + project - 20), intent, predecessor, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(project),
    pg_temp.snapshot(project), (select jsonb_agg(j.value || jsonb_build_object('id',
        pg_temp.round_unit(project, round, (u.value ->> 'ordinal')::integer)) order by (u.value ->> 'ordinal')::integer)
      from jsonb_array_elements(pg_temp.jobs(project)) with ordinality as j(value, position)
      join jsonb_array_elements(pg_temp.manifest(project) -> 'units') with ordinality as u(value, position) using (position)),
    pg_temp.f(project + 20), 1, (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)))
$$;
-- The affaire's latest analysis: a later command names it (a first analysis only on an affaire that has none).
create function pg_temp.latest_job(project integer) returns uuid language sql as $$
  select j.id from public.takeoff_jobs j where j.project_id = pg_temp.f(project) order by j.created_at desc, j.id desc limit 1
$$;
create function pg_temp.round_launch(project integer, round integer) returns table (outcome text, request_id uuid, job_id uuid)
language sql as $$
  select * from pg_temp.plan_command(project, round, case when pg_temp.latest_job(project) is null then 'initial' else 'reread_plans' end,
    pg_temp.latest_job(project))
$$;
-- A new day for the member: the admission ledgers of the cases above are set aside (their limits are section 2's and 11's).
delete from public.takeoff_job_admissions where tenant_id = pg_temp.f(10);
delete from public.takeoff_processing_admissions where tenant_id = pg_temp.f(10);
-- A renewal that lost the Mac: the first worker's clock is behind; after its lease lapsed, another process took the Mac.
select results_eq($$select outcome from pg_temp.round_launch(28, 1)$$, $$values ('admitted'::text)$$, 'a request of three plans');
select is(pg_temp.claim(pg_temp.round_unit(28, 1, 1), 961), 1, 'its first plan is read');
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second' where id = pg_temp.round_unit(28, 1, 1);
select is(pg_temp.claim(pg_temp.round_unit(28, 1, 2), 962), 1, 'its lease lapsed: another process takes the Mac with the next plan');
select throws_ok($$select public.renew_takeoff_processing_lease(pg_temp.round_unit(28, 1, 1), pg_temp.f(10), pg_temp.f(961),
    clock_timestamp() - interval '1 hour', clock_timestamp() + interval '30 minutes')$$, '40001', 'TAKEOFF_HOST_SLOT_LOST',
  'the first worker''s late renewal is refused: it no longer holds the Mac');
select is((select count(*)::integer from public.takeoff_jobs where execution_host_id = pg_temp.host() and status = 'processing'
  and processing_lease_expires_at > clock_timestamp()), 1, 'one live lease on the Mac');
select throws_ok($$select * from pg_temp.reserve(pg_temp.round_unit(28, 1, 1), 961, 'call:1')$$, '42501', 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED',
  'nor can it reserve a call');
-- A member's stop while the second plan is read: its provider call may still run, so the Mac stays held until its worker
-- ends (or its lease lapses).
select results_eq($$select request_state from public.stop_takeoff_launch_request(pg_temp.f(10), pg_temp.f(28), pg_temp.f(1),
  pg_temp.request(28))$$, $$values ('closed'::text)$$, 'the rest of the request is stopped');
select results_eq($$select job_id, holder_token from private.takeoff_host_slots where host_id = pg_temp.host()$$,
  $$values (pg_temp.round_unit(28, 1, 2), pg_temp.f(962))$$, 'the stopped reading still holds the Mac');
select results_eq($$select outcome from pg_temp.round_launch(20, 1)$$, $$values ('admitted'::text)$$, 'another request waits for it');
select is(pg_temp.dispatch(), null::uuid, 'the dispatcher hands nothing while the stopped reading may still call');
select is(pg_temp.claim(pg_temp.round_unit(20, 1, 1), 963), 0, 'and no other plan starts meanwhile');
select is(public.release_takeoff_host_slot(pg_temp.host(), pg_temp.f(961)), false, 'a worker that does not hold the Mac gives nothing back');
select is(public.release_takeoff_host_slot(pg_temp.host(), pg_temp.f(962)), true, 'the stopped worker gives the Mac back when it ends');
select is(pg_temp.dispatch(), pg_temp.round_unit(20, 1, 1), 'then the next request''s first plan is handed');
-- A call of unknown outcome freezes every further paid call of its request; its attempt is not retried on its own.
select is(pg_temp.claim(pg_temp.round_unit(20, 1, 1), 964), 1, 'its first plan is read');
select results_eq($$select outcome from pg_temp.reserve(pg_temp.round_unit(20, 1, 1), 964, 'call:1')$$, $$values ('reserved'::text)$$,
  'a call is reserved');
select is(public.record_takeoff_launch_call_unknown(pg_temp.round_unit(20, 1, 1), pg_temp.f(964), 'call:1'), true,
  'and ends without a known usage');
select results_eq($$select outcome, reason from pg_temp.reserve(pg_temp.round_unit(20, 1, 1), 964, 'call:2')$$,
  $$values ('refused'::text, 'USAGE_UNKNOWN'::text)$$, 'no further paid call of the request is made');
select results_eq($$select f ->> 'error_code', (f ->> 'retry_scheduled')::boolean from pg_temp.fail_attempt(pg_temp.round_unit(20, 1, 1), 964) f$$,
  $$values ('TAKEOFF_USAGE_UNRECORDED'::text, false)$$, 'the failure its worker would retry ends the plan: the writer answers what it recorded');
select results_eq($$select status::text, next_retry_at is null, analysis_outcome::text from public.takeoff_jobs
    where id = pg_temp.round_unit(20, 1, 1)$$, $$values ('failed'::text, true, 'failure'::text)$$, 'without a retry');
select results_eq($$select array_length(closed_jobs, 1), job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())$$,
  $$values (2, null::uuid)$$, 'the plans not started are closed, never started');
select results_eq($$select r.outcome, r.units_failed, r.units_not_started from public.takeoff_launch_requests r
    where r.id = pg_temp.request(20)$$, $$values ('failure'::text, 1, 2)$$, 'the request ends, one plan failed and two not started');
select results_eq($$select u ->> 'reason_code', count(*)::integer from
    jsonb_array_elements(public.read_takeoff_launch_request_units(pg_temp.f(10), pg_temp.f(20), pg_temp.request(20)) -> 'units') u
    group by 1$$, $$values ('TAKEOFF_USAGE_UNRECORDED'::text, 3)$$, 'each plan names the reason the member reads in the activity');
select results_eq($$select request_id, unknown_calls from public.read_takeoff_launch_unknown_calls(pg_temp.f(10), pg_temp.f(20),
    array[pg_temp.request(20)]) order by request_id$$, $$values (pg_temp.request(20), 1::bigint)$$,
  'the durable count of calls of unknown consumption, read in bulk for a page''s requests');
select is((select count(*)::integer from public.read_takeoff_launch_unknown_calls(pg_temp.f(10), pg_temp.f(21), array[pg_temp.request(20)])),
  0, 'only with its own affaire');
-- The owner withdraws the activation: the plans already admitted keep one at a time on the Mac.
select results_eq($$select outcome from pg_temp.round_launch(21, 1)$$, $$values ('admitted'::text)$$, 'a request of three plans is admitted');
delete from private.takeoff_plan_dispatch_activation;
select is(public.takeoff_plan_dispatch_is_active(), false, 'then one analysis per plan is withdrawn');
select is(pg_temp.dispatch(), pg_temp.round_unit(21, 1, 1), 'the dispatcher still serves the plans already admitted');
select is(pg_temp.claim(pg_temp.round_unit(21, 1, 1), 971), 1, 'a first process reads one');
select is(pg_temp.claim(pg_temp.round_unit(21, 1, 2), 972), 0, 'a second process cannot read another at the same time');
select throws_ok($$select count(*) from public.claim_local_takeoff_job(pg_temp.round_unit(21, 1, 3), pg_temp.f(10), pg_temp.host(),
    clock_timestamp(), pg_temp.f(973), clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture')$$, '42501',
  'TAKEOFF_HOST_SLOT_REQUIRED', 'nor can a released worker''s direct claim, which never holds the Mac');
select results_eq($$select outcome from pg_temp.reserve(pg_temp.round_unit(21, 1, 1), 971, 'call:1')$$, $$values ('reserved'::text)$$,
  'the reading in progress still reserves its calls');


-- 13. The launch rules of lot 2 PR 6 (20261121193413_takeoff_launch_exclusion_and_send_requests.sql) hold for a command of
-- plans too, through the command both manual entry points share; the dispatcher never hands a retry past the wait ceiling,
-- which only its recovery closes. Written before migration A was rebuilt on that migration's bodies: red then (the command
-- of plans admitted each case, and the expired retry was handed first).
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute');
-- The Mac is free again: the reading in progress is stopped, and its worker ends.
select results_eq($$select request_state from public.stop_takeoff_launch_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1),
  pg_temp.request(21))$$, $$values ('closed'::text)$$, 'the request read since the withdrawal is stopped');
select is(public.release_takeoff_host_slot(pg_temp.host(), pg_temp.f(971)), true, 'and its worker gives the Mac back');
-- A first analysis of an affaire that has one is refused: a command names the analysis it replaces or extends.
select throws_ok($$select * from pg_temp.plan_command(22, 2, 'initial', null)$$, '22023', 'TAKEOFF_LAUNCH_ANALYSIS_EXISTS',
  'a first analysis of plans on an affaire that has one is refused');
-- An analysis of the affaire launched outside any request still runs (another Mac's, waiting): the command is answered
-- with it, its receipt names no request, and nothing is admitted.
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, execution_provider,
  execution_host_id, created_at)
values (pg_temp.f(3901), pg_temp.f(10), pg_temp.f(23), pg_temp.f(43), 'C', 'pending', pg_temp.f(1), 'chatgpt_local',
  'urn:uuid:d5100000-0000-4000-8000-000000000098', now() + interval '1 second');
set local session_replication_role = origin;
select results_eq($$select outcome, request_id, job_id from pg_temp.plan_command(23, 2, 'reread_plans', pg_temp.unit(23, 1))$$,
  $$values ('already_running'::text, null::uuid, pg_temp.f(3901))$$, 'a command of plans is answered with the analysis outside any request');
select results_eq($$select answer, request_id, job_id from private.takeoff_launch_commands where intent_key = pg_temp.f(723)$$,
  $$values ('already_running'::text, null::uuid, pg_temp.f(3901))$$, 'its receipt names that analysis and no request');
select is((select count(*)::integer from public.takeoff_jobs where id = pg_temp.round_unit(23, 2, 1)), 0, 'nothing is admitted');
-- While the affaire's automatic start can still begin (evaluated for its eligible payer), it is taken on from the zone: a
-- command of plans is refused and records nothing.
set local session_replication_role = replica;
insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state, reason_code, payer_id,
  mandate_kind, mandated_at, execution_host_id, mandate_selection, mandate_revision, evaluated_mark, evaluated_at, confirmed_by,
  updated_at) values
  (pg_temp.f(3902), pg_temp.f(10), pg_temp.f(24), 'automatic', 'initial', pg_temp.f(3902), 'evaluating', null,
    pg_temp.f(1), 'confirmation', now(), pg_temp.host(), pg_temp.selection(), 1, null, null, pg_temp.f(1), now());
set local session_replication_role = origin;
select throws_ok($$select * from pg_temp.plan_command(24, 2, 'reread_plans', pg_temp.unit(24, 1))$$, '55000',
  'TAKEOFF_LAUNCH_AUTOMATIC_PENDING', 'a command of plans while the automatic start can still begin is refused');
select results_eq($$select state, reason_code from public.takeoff_launch_requests where id = pg_temp.f(3902)$$,
  $$values ('evaluating'::text, null::text)$$, 'the automatic start is never set aside');
select is((select count(*)::integer from private.takeoff_launch_commands where intent_key = pg_temp.f(724)), 0, 'nothing is recorded');
-- Two retries of analyses outside any request on this Mac, both due: the older one has waited past the wait ceiling, which
-- the notices' activation started long ago. Only its recovery closes it; the dispatcher hands the other one.
update private.takeoff_completion_activation set active_from = now() - interval '3 days';
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, execution_provider,
  execution_host_id, retry_count, next_retry_at, analysis_queued_at)
values
  (pg_temp.f(3903), pg_temp.f(10), pg_temp.f(25), pg_temp.f(45), 'C', 'failed', pg_temp.f(1), 'chatgpt_local', pg_temp.host(), 1,
    clock_timestamp() - interval '25 hours', now() - interval '26 hours'),
  (pg_temp.f(3904), pg_temp.f(10), pg_temp.f(25), pg_temp.f(45), 'C', 'failed', pg_temp.f(1), 'chatgpt_local', pg_temp.host(), 1,
    clock_timestamp() - interval '1 minute', now() - interval '2 hours');
set local session_replication_role = origin;
select is(public.takeoff_local_retry_floor() > (select next_retry_at from public.takeoff_jobs where id = pg_temp.f(3903)), true,
  'the older retry is past the wait ceiling');
select is(pg_temp.dispatch(), pg_temp.f(3904), 'the dispatcher hands the retry within the ceiling, never the expired one');

-- 14. The closing review round, written before its fixes (red then). Once one analysis per plan is active, and after its
-- withdrawal while its plans are still at work on a Mac: a dead attempt's call freezes its request before any recovery,
-- an expired retry of a plan never starts, no other job runs or pays beside a plan on its Mac, and the seal refuses what
-- the worker would refuse, the worker reading a plan's pages in the manifest's order.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now(), next_retry_at = null
where id in (pg_temp.f(3901), pg_temp.f(3903), pg_temp.f(3904));
set local session_replication_role = origin;
-- A worker dies with a call reserved: its lease lapses, and no recovery has run yet.
select results_eq($$select outcome from pg_temp.round_launch(21, 2)$$, $$values ('admitted'::text)$$, 'a request of three plans');
select is(pg_temp.claim(pg_temp.round_unit(21, 2, 1), 991), 1, 'its first plan is read');
select results_eq($$select outcome from pg_temp.reserve(pg_temp.round_unit(21, 2, 1), 991, 'call:1')$$, $$values ('reserved'::text)$$,
  'a call is reserved');
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second'
where id = pg_temp.round_unit(21, 2, 1);
select is(pg_temp.claim(pg_temp.round_unit(21, 2, 2), 992), 1, 'another process reads the next plan, the Mac being free');
select results_eq($$select reason from public.takeoff_job_may_pay(pg_temp.round_unit(21, 2, 2))$$, $$values ('USAGE_UNKNOWN'::text)$$,
  'the dead attempt''s call may have spent what is left: the next plan may not pay');
select results_eq($$select outcome, reason from pg_temp.reserve(pg_temp.round_unit(21, 2, 2), 992, 'call:1')$$,
  $$values ('refused'::text, 'USAGE_UNKNOWN'::text)$$, 'nor reserve a call');
-- That worker dies too, before any recovery: the plan not started is never handed.
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second'
where id = pg_temp.round_unit(21, 2, 2);
select results_eq($$select job_id, closed_jobs from public.dispatch_next_takeoff_host_job(pg_temp.host())$$,
  $$values (null::uuid, array[pg_temp.round_unit(21, 2, 3)])$$, 'the plan not started is closed, never handed');
-- A retry of a plan that has waited past the ceiling never starts, whoever claims it: only its recovery closes it.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'failed', retry_count = 1, next_retry_at = clock_timestamp() - interval '25 hours',
  completed_at = clock_timestamp() - interval '25 hours', processing_lease_token = null, processing_lease_expires_at = null
where id = pg_temp.round_unit(21, 2, 1);
set local session_replication_role = origin;
select throws_ok($$select pg_temp.claim(pg_temp.round_unit(21, 2, 1), 993, 'failed', 1)$$, '55000', 'TAKEOFF_JOB_RETRY_EXPIRED',
  'a retry of a plan past the wait ceiling never starts');
-- Withdrawn while a plan is at work on the Mac: every other job of that Mac keeps to the Mac's slot.
delete from private.takeoff_plan_dispatch_activation;
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'processing', next_retry_at = null, processing_lease_token = pg_temp.f(994),
  processing_lease_expires_at = clock_timestamp() + interval '30 minutes', started_at = clock_timestamp()
where id = pg_temp.round_unit(21, 2, 1);
insert into private.takeoff_host_slots (host_id, job_id, holder_token, generation, acquired_at, expires_at)
values (pg_temp.host(), pg_temp.round_unit(21, 2, 1), pg_temp.f(994), 100, clock_timestamp(), clock_timestamp() + interval '30 minutes')
on conflict (host_id) do update set job_id = excluded.job_id, holder_token = excluded.holder_token, generation = excluded.generation,
  acquired_at = excluded.acquired_at, expires_at = excluded.expires_at;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, execution_provider,
  execution_host_id, processing_lease_token, processing_lease_expires_at, started_at)
values
  (pg_temp.f(3905), pg_temp.f(10), pg_temp.f(22), pg_temp.f(42), 'C', 'pending', pg_temp.f(1), 'chatgpt_local', pg_temp.host(),
    null, null, null),
  (pg_temp.f(3906), pg_temp.f(10), pg_temp.f(22), pg_temp.f(42), 'C', 'processing', pg_temp.f(1), 'chatgpt_local', pg_temp.host(),
    pg_temp.f(995), clock_timestamp() + interval '30 minutes', clock_timestamp()),
  (pg_temp.f(3907), pg_temp.f(10), pg_temp.f(22), pg_temp.f(42), 'C', 'pending', pg_temp.f(1), 'chatgpt_local',
    'urn:uuid:d5100000-0000-4000-8000-000000000098', null, null, null);
set local session_replication_role = origin;
select is(pg_temp.claim(pg_temp.f(3905), 996), 0, 'a job outside any request waits for the plan read on its Mac');
select throws_ok($$select count(*) from public.claim_local_takeoff_job(pg_temp.f(3905), pg_temp.f(10), pg_temp.host(),
    clock_timestamp(), pg_temp.f(997), clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture')$$, '42501',
  'TAKEOFF_HOST_SLOT_REQUIRED', 'nor does a released worker''s direct claim start it');
select throws_ok($$select * from pg_temp.reserve(pg_temp.f(3906), 995, 'call:1')$$, '42501', 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED',
  'a job running beside the plan pays nothing');
select throws_ok($$select public.renew_takeoff_processing_lease(pg_temp.f(3906), pg_temp.f(10), pg_temp.f(995), clock_timestamp(),
    clock_timestamp() + interval '30 minutes')$$, '40001', 'TAKEOFF_HOST_SLOT_LOST',
  'nor renews its lease while the plan holds the Mac');
select is((select count(*)::integer from public.claim_local_takeoff_job(pg_temp.f(3907), pg_temp.f(10),
    'urn:uuid:d5100000-0000-4000-8000-000000000098', clock_timestamp(), pg_temp.f(998), clock_timestamp() + interval '30 minutes',
    'modele-fictif', 'fixture')), 1, 'a Mac without a plan at work claims as before');
-- The seal, active again: a plan without its digest is refused (its worker would refuse it), and a plan's pages are read
-- in the manifest's order whatever order its source listed them in.
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute');
create function pg_temp.plan_command_with(project integer, round integer, manifest jsonb, snapshot jsonb)
returns table (outcome text, request_id uuid, job_id uuid) language sql as $$
  select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(project), pg_temp.f(1),
    pg_temp.f(700 + 10 * round + project - 20), 'reread_plans', pg_temp.latest_job(project), pg_temp.host(), pg_temp.selection(),
    manifest, snapshot, (select jsonb_agg(j.value || jsonb_build_object('id',
        pg_temp.round_unit(project, round, (u.value ->> 'ordinal')::integer)) order by (u.value ->> 'ordinal')::integer)
      from jsonb_array_elements(pg_temp.jobs(project)) with ordinality as j(value, position)
      join jsonb_array_elements(manifest -> 'units') with ordinality as u(value, position) using (position)),
    pg_temp.f(project + 20), 1, (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)))
$$;
-- The source of an affaire's plan-1 (the third plan of its set: identifier 100 + 10 n + 3), changed.
create function pg_temp.with_plan_one(project integer, snapshot jsonb, source jsonb) returns jsonb language sql as $$
  select jsonb_set(snapshot, '{preparation,sources}', (select jsonb_agg(case
      when s.value ->> 'document_id' = pg_temp.f(100 + 10 * (project - 20) + 3)::text then s.value || source else s.value end
      order by s.position)
    from jsonb_array_elements(snapshot #> '{preparation,sources}') with ordinality as s(value, position)))
$$;
select throws_ok($$select * from pg_temp.plan_command_with(27, 3,
    jsonb_set(pg_temp.manifest(27), '{plans,0}', (pg_temp.manifest(27) #> '{plans,0}') - 'content_sha256'),
    pg_temp.with_plan_one(27, pg_temp.snapshot(27), '{"content_hash": null}'))$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID',
  'a plan without its digest is refused at the seal');
-- On another affaire, so that the case stands on its own: affaire 28's plan-1 (identifier 183).
select results_eq($$select outcome from pg_temp.plan_command_with(28, 4, pg_temp.manifest(28),
    pg_temp.with_plan_one(28, pg_temp.snapshot(28), '{"pages": [7, 2]}'))$$, $$values ('admitted'::text)$$,
  'a plan whose source lists its pages 7 then 2 is admitted with the manifest''s pages 2 and 7');
select is((select s -> 'pages' from public.takeoff_jobs j, jsonb_array_elements(j.preparation_snapshot #> '{preparation,sources}') s
    where j.id = pg_temp.round_unit(28, 4, 1) and s ->> 'document_id' = pg_temp.f(183)::text), '[2, 7]'::jsonb,
  'its worker reads them in the manifest''s order');
-- A reconciliation closes a request whose ends were not settled (written without their triggers here).
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now(), next_retry_at = null
where launch_request_id = pg_temp.request(28) and analysis_outcome is null;
set local session_replication_role = origin;
select results_eq($$select state from public.reconcile_takeoff_launch_requests() where request_id = pg_temp.request(28)$$,
  $$values ('closed'::text)$$, 'a request whose units all ended is closed by the reconciliation, without any call');
select is((select count(*)::integer from public.takeoff_completion_notifications where request_id = pg_temp.request(28)), 1,
  'with one notice');
select is((select count(*)::integer from public.reconcile_takeoff_launch_requests() where request_id = pg_temp.request(28)), 0,
  'and only once');
-- The first analysis of an affaire, launched from its zone without naming any plan: M4's command, its identity, with the
-- manifest of every plan the preparation retains, one unit each; its lost answer is replayed by the same receipt lookup a
-- command naming its plans uses, whatever the activation.
insert into public.estimate_projects (id, tenant_id, user_id, name)
values (pg_temp.f(2030), pg_temp.f(10), pg_temp.f(1), 'Affaire sans analyse (fictive)');
insert into public.plan_sets (id, tenant_id, project_id, name) values (pg_temp.f(2050), pg_temp.f(10), pg_temp.f(2030), 'Plans du dossier');
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(2050 + k), pg_temp.f(10), pg_temp.f(2050), 'plan-' || k || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(2050), pg_temp.f(2050 + k), 'plan-' || k || '.pdf'), 'application/pdf', 8, 9
from generate_series(1, 2) as k;
set local session_replication_role = replica;
select pg_temp.confirm(2030);
set local session_replication_role = origin;
select results_eq($$select outcome, job_id from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(2030), pg_temp.f(1),
    pg_temp.f(2031), 'initial', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(2030), pg_temp.snapshot(2030),
    pg_temp.jobs(2030), pg_temp.f(2050), 1)$$, $$values ('admitted'::text, pg_temp.unit(2030, 1))$$,
  'a first analysis of every plan is admitted through M4''s command');
select results_eq($$select units_expected, manifest -> 'format_version' from public.takeoff_launch_requests where id = pg_temp.request(2030)$$,
  $$values (2, '2'::jsonb)$$, 'as one analysis per plan');
select results_eq($$select outcome, job_id from public.replay_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(2030), pg_temp.f(1),
    pg_temp.f(2031), 'initial', null, pg_temp.f(2050), 1, null)$$, $$values ('replayed'::text, pg_temp.unit(2030, 1))$$,
  'its lost answer is replayed without naming any plan');
-- Under the same key, another selection of plans is another command: a conflict, in both directions (the closing review's
-- point 4: the assertion here once expected a retry naming one of its plans to replay).
select throws_ok($$select * from public.replay_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(2030), pg_temp.f(1),
    pg_temp.f(2031), 'initial', null, pg_temp.f(2050), 1, array[pg_temp.f(2051)])$$, '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT',
  'a retry under the same key naming one of its plans is another command');
select throws_ok($$select * from public.replay_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(2030), pg_temp.f(1),
    pg_temp.f(2031), 'initial', null, pg_temp.f(2050), 1, array[pg_temp.f(2099)])$$, '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT',
  'and so is one naming a plan it never read');
select throws_ok($$select * from public.replay_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(2030), pg_temp.f(1),
    pg_temp.f(2031), 'initial', null, pg_temp.f(2050), 2, null)$$, '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT',
  'the same key for another command is still a conflict');
-- The other direction: a command naming its plans (answered with the analysis that runs), then the same key naming none.
select results_eq($$select outcome from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(2030), pg_temp.f(1),
    pg_temp.f(2032), 'reread_plans', pg_temp.unit(2030, 1), pg_temp.host(), pg_temp.selection(), pg_temp.manifest(2030),
    pg_temp.snapshot(2030), pg_temp.jobs(2030), pg_temp.f(2050), 1, array[pg_temp.f(2051), pg_temp.f(2052)])$$,
  $$values ('already_running'::text)$$, 'a command naming the two plans meanwhile is answered with the analysis that runs');
select results_eq($$select outcome from public.replay_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(2030), pg_temp.f(1),
    pg_temp.f(2032), 'reread_plans', pg_temp.unit(2030, 1), pg_temp.f(2050), 1, array[pg_temp.f(2052), pg_temp.f(2051)])$$,
  $$values ('already_running'::text)$$, 'the same command repeated replays, whatever the order it names its plans in');
select throws_ok($$select * from public.replay_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(2030), pg_temp.f(1),
    pg_temp.f(2032), 'reread_plans', pg_temp.unit(2030, 1), pg_temp.f(2050), 1, null)$$, '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT',
  'the same key naming no plan is another command');

-- 15. The last SQL round, written before its fixes (red then). After a withdrawal, a cancelled plan whose stopped reading
-- still holds the Mac keeps every other job of that Mac to the slot; a first analysis reads exactly the plans of the
-- confirmed preparation it names.
delete from private.takeoff_plan_dispatch_activation;
-- The plans of the earlier sections are set aside (without their triggers), but for the two requests stopped below.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now(), next_retry_at = null
where execution_host_id = pg_temp.host() and launch_unit_key like 'plan:%' and analysis_outcome is null
  and launch_request_id not in (pg_temp.request(21), pg_temp.request(2030));
set local session_replication_role = origin;
-- The last plans of one analysis per plan at work on the Mac are stopped; the first one's reading still holds the Mac.
select results_eq($$select request_state from public.stop_takeoff_launch_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1),
  pg_temp.request(21))$$, $$values ('closed'::text)$$, 'the request whose reading holds the Mac is stopped');
select results_eq($$select request_state from public.stop_takeoff_launch_request(pg_temp.f(10), pg_temp.f(2030), pg_temp.f(1),
  pg_temp.request(2030))$$, $$values ('closed'::text)$$, 'and so is the last other one');
select is((select count(*)::integer from public.takeoff_jobs where execution_host_id = pg_temp.host() and launch_unit_key like 'plan:%'
  and analysis_outcome is null and status in ('pending', 'processing', 'failed')), 0, 'no plan of one analysis per plan is left on the Mac');
select results_eq($$select job_id, holder_token from private.takeoff_host_slots where host_id = pg_temp.host()$$,
  $$values (pg_temp.round_unit(21, 2, 1), pg_temp.f(994))$$, 'but the stopped reading still holds the Mac, its call possibly running');
select is(pg_temp.claim(pg_temp.f(3905), 996), 0, 'a job outside any request still waits for the Mac');
select throws_ok($$select * from pg_temp.reserve(pg_temp.f(3906), 995, 'call:1')$$, '42501', 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED',
  'and one running beside it pays nothing');
select is(public.release_takeoff_host_slot(pg_temp.host(), pg_temp.f(994)), true, 'the stopped reading''s worker gives the Mac back');
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now(),
  processing_lease_token = null, processing_lease_expires_at = null where id = pg_temp.f(3906);
set local session_replication_role = origin;
select is(pg_temp.claim(pg_temp.f(3905), 996), 1, 'then a job outside any request claims the free Mac as before');
-- A first analysis of every plan (M4's command) reads exactly the plans of the confirmed preparation it names: a snapshot,
-- manifest and jobs that leave one out, alike, are refused. Affaire 2060 has two plans; its preparation reads both.
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute');
insert into public.estimate_projects (id, tenant_id, user_id, name)
values (pg_temp.f(2060), pg_temp.f(10), pg_temp.f(1), 'Affaire au dossier réduit (fictive)');
insert into public.plan_sets (id, tenant_id, project_id, name) values (pg_temp.f(2080), pg_temp.f(10), pg_temp.f(2060), 'Plans du dossier');
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.f(2081), pg_temp.f(10), pg_temp.f(2080), 'plan-1.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(2080), pg_temp.f(2081), 'plan-1.pdf'), 'application/pdf', 8, 9);
-- The command of its one first plan, computed while the set holds it alone.
create temp table narrowed as select pg_temp.manifest(2060) as manifest, pg_temp.snapshot(2060) as snapshot, pg_temp.jobs(2060) as jobs;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.f(2082), pg_temp.f(10), pg_temp.f(2080), 'plan-2.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(2080), pg_temp.f(2082), 'plan-2.pdf'), 'application/pdf', 8, 9);
set local session_replication_role = replica;
select pg_temp.confirm(2060);
set local session_replication_role = origin;
select throws_ok($$select * from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(2060), pg_temp.f(1), pg_temp.f(2061),
    'initial', null, pg_temp.host(), pg_temp.selection(), (select manifest from narrowed), (select snapshot from narrowed),
    (select jobs from narrowed), pg_temp.f(2080), 1)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID',
  'a first analysis whose snapshot leaves out a plan of the confirmed preparation is refused');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(2060)), 0, 'nothing is admitted');
select results_eq($$select outcome from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(2060), pg_temp.f(1),
    pg_temp.f(2062), 'initial', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(2060), pg_temp.snapshot(2060),
    pg_temp.jobs(2060), pg_temp.f(2080), 1)$$, $$values ('admitted'::text)$$, 'the first analysis of both plans is admitted');


-- 16. The measuring order of #447 (20261121230719_takeoff_item_lists.sql) with both formats of manifest: the free
-- extraction, or a list of items of the request's own affaire named by its latest revision. Written before migration A's
-- seal was rebuilt on #447's (red then: A's own seal refused every list and answered a stale one as invalid).
-- Affaires 2110, 2140 and 2190 hold one plan each (format 2); 2170, 2180, 2200 and 2230 none (format 1). 2140 and 2180
-- have a list of two revisions, the second the latest. Each affaire has a request waiting for its seal: an admitted one
-- is never sealed again below (2190 and 2200 are admitted before the activation, 2230 is the grouped manifest of two
-- units, refused only by its count of units).
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(n), pg_temp.f(10), pg_temp.f(1), 'Affaire au poste ' || n || ' (fictive)'
from unnest(array[2110, 2140, 2170, 2180, 2190, 2200, 2230]) n;
insert into public.plan_sets (id, tenant_id, project_id, name)
values (pg_temp.f(2130), pg_temp.f(10), pg_temp.f(2110), 'Plans du dossier'), (pg_temp.f(2160), pg_temp.f(10), pg_temp.f(2140), 'Plans du dossier'),
  (pg_temp.f(2210), pg_temp.f(10), pg_temp.f(2190), 'Plans du dossier');
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.f(2131), pg_temp.f(10), pg_temp.f(2130), 'plan-1.pdf', concat_ws('/', pg_temp.f(10), pg_temp.f(2130), pg_temp.f(2131), 'plan-1.pdf'),
    'application/pdf', 8, 9),
  (pg_temp.f(2161), pg_temp.f(10), pg_temp.f(2160), 'plan-1.pdf', concat_ws('/', pg_temp.f(10), pg_temp.f(2160), pg_temp.f(2161), 'plan-1.pdf'),
    'application/pdf', 8, 9),
  (pg_temp.f(2211), pg_temp.f(10), pg_temp.f(2210), 'plan-1.pdf', concat_ws('/', pg_temp.f(10), pg_temp.f(2210), pg_temp.f(2211), 'plan-1.pdf'),
    'application/pdf', 8, 9);
set local session_replication_role = replica;
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by)
values (pg_temp.f(2141), pg_temp.f(10), pg_temp.f(2140), 1, 'initial', '{}', 3, repeat('1', 64), repeat('a', 64), pg_temp.f(2142), pg_temp.f(1)),
  (pg_temp.f(2143), pg_temp.f(10), pg_temp.f(2140), 2, 'proposal', '{}', 4, repeat('2', 64), repeat('b', 64), pg_temp.f(2144), pg_temp.f(1)),
  (pg_temp.f(2181), pg_temp.f(10), pg_temp.f(2180), 1, 'initial', '{}', 3, repeat('3', 64), repeat('c', 64), pg_temp.f(2182), pg_temp.f(1)),
  (pg_temp.f(2183), pg_temp.f(10), pg_temp.f(2180), 2, 'proposal', '{}', 5, repeat('4', 64), repeat('d', 64), pg_temp.f(2184), pg_temp.f(1));
insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state, payer_id, mandate_kind,
  mandated_at, execution_host_id, mandate_selection)
select pg_temp.f(n + 9), pg_temp.f(10), pg_temp.f(n), 'automatic', 'initial', pg_temp.f(n + 9), 'evaluating', pg_temp.f(1),
  'confirmation', now(), pg_temp.host(), pg_temp.selection() from unnest(array[2110, 2140, 2170, 2180, 2190, 2200, 2230]) n;
set local session_replication_role = origin;
create function pg_temp.waiting(project integer) returns public.takeoff_launch_requests language sql stable as $$
  select * from public.takeoff_launch_requests where id = pg_temp.f(project + 9)
$$;
-- The order naming one stored revision, as the server seals it.
create function pg_temp.item_order(p_revision_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', r.id, 'revision', r.revision,
    'content_sha256', r.content_sha256, 'item_count', r.item_count)) from public.takeoff_list_revisions r where r.id = p_revision_id
$$;
-- Format 1: lot 2's grouped unit. Format 2: the affaire's manifest of one unit per plan (section 1's), with that order.
create function pg_temp.grouped(order_ jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('format_version', 1, 'intent', 'initial', 'order', order_,
    'units', jsonb_build_array(jsonb_build_object('key', 'grouped', 'plans', jsonb_build_array('plan-fictif'))),
    'plans', jsonb_build_array(jsonb_build_object('entry_key', 'plan-fictif')), 'budget', jsonb_build_object('tokens', 1000, 'cost_cents', 0))
$$;
create function pg_temp.per_plan(project integer, order_ jsonb) returns jsonb language sql stable as $$
  select jsonb_set(pg_temp.manifest(project), '{order}', order_)
$$;
create function pg_temp.free_order() returns jsonb language sql immutable as $$
  select '{"kind":"free_extraction","version":1,"list":null}'::jsonb
$$;
-- Before the second order's activation, the free extraction is admitted and a list is refused in either format, as
-- before #447, whatever its revision: the latest, a stale one, or another affaire's (the activation decides first).
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2140), pg_temp.per_plan(2140, pg_temp.item_order(pg_temp.f(2143))),
    pg_temp.snapshot(2140), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'format 2: a list before its order is activated is refused');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2140), pg_temp.per_plan(2140, pg_temp.item_order(pg_temp.f(2141))),
    pg_temp.snapshot(2140), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'format 2, before the activation: a stale revision is refused');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2140), pg_temp.per_plan(2140, pg_temp.item_order(pg_temp.f(2183))),
    pg_temp.snapshot(2140), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'format 2, before the activation: another affaire''s revision is refused');
select results_eq($$select r.state, r.item_list_revision_id from private.seal_takeoff_launch_request(pg_temp.waiting(2190),
    pg_temp.per_plan(2190, pg_temp.free_order()), pg_temp.snapshot(2190), 0) r$$, $$values ('admitted'::text, null::uuid)$$,
  'format 2, before the activation: the free extraction is admitted, no list recorded');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2180), pg_temp.grouped(pg_temp.item_order(pg_temp.f(2183))),
    pg_temp.snapshot(2180), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'format 1: so is it');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2180), pg_temp.grouped(pg_temp.item_order(pg_temp.f(2181))),
    pg_temp.snapshot(2180), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'format 1, before the activation: a stale revision is refused');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2180), pg_temp.grouped(pg_temp.item_order(pg_temp.f(2143))),
    pg_temp.snapshot(2180), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'format 1, before the activation: another affaire''s revision is refused');
select results_eq($$select r.state, r.item_list_revision_id from private.seal_takeoff_launch_request(pg_temp.waiting(2200),
    pg_temp.grouped(pg_temp.free_order()), pg_temp.snapshot(2200), 0) r$$, $$values ('admitted'::text, null::uuid)$$,
  'format 1, before the activation: the free extraction is admitted, no list recorded');
select results_eq($$select r.state, r.manifest from public.takeoff_launch_requests r where r.id in (pg_temp.f(2149), pg_temp.f(2189))
    order by r.id$$, $$values ('evaluating'::text, null::jsonb), ('evaluating'::text, null::jsonb)$$,
  'the refusals before the activation sealed nothing');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 minute');
-- Format 2 (one unit per plan).
select results_eq($$select r.state, r.item_list_revision_id from private.seal_takeoff_launch_request(pg_temp.waiting(2110),
    pg_temp.per_plan(2110, pg_temp.free_order()), pg_temp.snapshot(2110), 0) r$$, $$values ('admitted'::text, null::uuid)$$,
  'format 2, the free extraction: admitted, no list recorded');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2140), pg_temp.per_plan(2140, pg_temp.item_order(pg_temp.f(2141))),
    pg_temp.snapshot(2140), 0)$$, '40001', 'TAKEOFF_LAUNCH_DOSSIER_CHANGED', 'format 2, a stale revision: the admission is stale');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2140), pg_temp.per_plan(2140, pg_temp.item_order(pg_temp.f(2183))),
    pg_temp.snapshot(2140), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'format 2, another affaire''s revision: refused');
select results_eq($$select r.state, r.item_list_revision_id from private.seal_takeoff_launch_request(pg_temp.waiting(2140),
    pg_temp.per_plan(2140, pg_temp.item_order(pg_temp.f(2143))), pg_temp.snapshot(2140), 0) r$$, $$values ('admitted'::text, pg_temp.f(2143))$$,
  'format 2, the latest revision: admitted, its list recorded on the request');
-- Format 1 (lot 2's grouped unit).
select results_eq($$select r.state, r.item_list_revision_id from private.seal_takeoff_launch_request(pg_temp.waiting(2170),
    pg_temp.grouped(pg_temp.free_order()), pg_temp.snapshot(2170), 0) r$$, $$values ('admitted'::text, null::uuid)$$,
  'format 1, the free extraction: admitted, no list recorded');
-- Format 1 never seals a list once activated either (20261122113611_takeoff_item_answers_before_activation.sql): its
-- grouped job could never publish answers, plan by plan. Until then these three were a stale admission, a refusal and an
-- admission recording the list.
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2180), pg_temp.grouped(pg_temp.item_order(pg_temp.f(2181))),
    pg_temp.snapshot(2180), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'format 1, a stale revision: refused');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2180), pg_temp.grouped(pg_temp.item_order(pg_temp.f(2143))),
    pg_temp.snapshot(2180), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'format 1, another affaire''s revision: refused');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2180),
    pg_temp.grouped(pg_temp.item_order(pg_temp.f(2183))), pg_temp.snapshot(2180), 0)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID',
  'format 1, the latest revision: refused, a list is read plan by plan');
select results_eq($$select r.state, r.item_list_revision_id from private.seal_takeoff_launch_request(pg_temp.waiting(2180),
    pg_temp.grouped(pg_temp.free_order()), pg_temp.snapshot(2180), 0) r$$, $$values ('admitted'::text, null::uuid)$$,
  'format 1 of that affaire still seals the free extraction');
-- A's own rules keep their place beside the order: a grouped manifest of two units is refused whatever its order. Its
-- request waits for its seal and the manifest is valid but for its count of units (each operand of `||` in parentheses:
-- `->` and `||` bind alike, left to right), so that the count alone refuses it.
create function pg_temp.two_grouped_units() returns jsonb language sql immutable as $$
  select jsonb_set(pg_temp.grouped(pg_temp.free_order()), '{units}',
    (pg_temp.grouped(pg_temp.free_order()) -> 'units') || (pg_temp.grouped(pg_temp.free_order()) -> 'units'))
$$;
select is(jsonb_array_length(pg_temp.two_grouped_units() -> 'units'), 2, 'the grouped manifest of the next check holds two units');
select throws_ok($$select private.seal_takeoff_launch_request(pg_temp.waiting(2230), pg_temp.two_grouped_units(), pg_temp.snapshot(2230), 0)$$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'a grouped manifest of two units is refused');

select * from finish();
rollback;
