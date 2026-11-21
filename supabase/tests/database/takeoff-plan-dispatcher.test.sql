-- Lot 3, migration A (20261121181031_takeoff_plan_dispatcher.sql): one analysis per plan. Nothing of format 2 before the
-- owner's activation; a request seals one unit per plan and inserts their jobs in one commit, each attesting the
-- projection of its unit; one plan at a time on the Mac (its slot); every paid call reserved before it is sent and settled
-- once; a plan that fails does not stop the others; the request ends on its last unit with one notice, partial when some
-- plans were read; a member's stop cancels the rest and keeps what was read; a unit never started when the budget is spent
-- is closed with that reason; the send of a per-plan analysis stays closed. Single session; the races are in
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
-- Affaires 20 to 26, each with its dossier's plan set (40 + n) of plans (named so that their order is not their identifier's).
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(20 + n), pg_temp.f(10), pg_temp.f(1), 'Affaire par plan ' || n || ' (fictive)' from generate_series(0, 6) as n;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select pg_temp.f(30 + n), pg_temp.f(20 + n), pg_temp.f(1), 'ready' from generate_series(0, 6) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select pg_temp.f(60 + n), pg_temp.f(20 + n), pg_temp.f(30 + n), 'confirme', 'Résumé fictif', 'Objet fictif', now(), pg_temp.f(1)
from generate_series(0, 6) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select pg_temp.f(40 + n), pg_temp.f(10), pg_temp.f(20 + n), 'Plans du dossier' from generate_series(0, 6) as n;
-- Plan files 100 + 10 n + k (k = 1..3; affaire 26 holds 7 plans).
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(100 + 10 * n + k), pg_temp.f(10), pg_temp.f(40 + n), 'plan-' || (4 - k) || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(40 + n), pg_temp.f(100 + 10 * n + k), 'plan-' || (4 - k) || '.pdf'), 'application/pdf', 8, 9
from generate_series(0, 5) as n cross join generate_series(1, 3) as k
union all
select pg_temp.f(160 + k), pg_temp.f(10), pg_temp.f(46), 'plan-' || k || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(46), pg_temp.f(160 + k), 'plan-' || k || '.pdf'), 'application/pdf', 8, 1
from generate_series(1, 7) as k;
-- A CCTP of affaire 20, a common reference of its plans.
insert into public.affaire_intake_documents (id, upload_id, file_name, upload_status, storage_path, classification_status, document_kind)
values (pg_temp.f(70), pg_temp.f(30), 'cctp.pdf', 'uploaded', 'fixture/cctp.pdf', 'classified', 'cctp');

-- The confirmed preparation of an affaire's plans (first plan read on its pages 2 and 7), and the manifest of format 2
-- the server seals for it: units in the order of their names (plan-1, plan-2, plan-3: identifiers 3, 2, 1), equal shares.
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
          'pages', case when f.file_name = 'plan-1.pdf' then '[2, 7]'::jsonb else '[]'::jsonb end) as source
        from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)
        union all
        select jsonb_build_object('document_id', d.id, 'document_name', d.file_name, 'kind', 'cctp', 'active', true, 'confirmed', true,
          'plan_set_id', null, 'file_path', d.storage_path, 'source_updated_at', d.updated_at, 'pages', '[]'::jsonb)
        from public.affaire_intake_documents d where reference and d.id = pg_temp.f(70)) s)))
$$;
create function pg_temp.manifest(project integer, tokens integer default 400000, cents integer default 2500) returns jsonb language sql as $$
  with plans as (
    select f.id, f.file_name, row_number() over (order by f.file_name, f.id) as ordinal, count(*) over () as units
    from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)
  )
  select jsonb_build_object('format_version', 2, 'intent', 'initial',
    'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
    'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
    'units', (select jsonb_agg(jsonb_build_object('key', 'plan:' || p.id, 'ordinal', p.ordinal, 'plans', jsonb_build_array(p.id),
      'pages', '[]'::jsonb, 'page_count', 9, 'vector_pages', 0,
      'budget', jsonb_build_object('tokens', ceil(tokens::numeric / p.units), 'cost_cents', ceil(cents::numeric / p.units))) order by p.ordinal) from plans p),
    'plans', (select jsonb_agg(jsonb_build_object('entry_key', p.id, 'plan_file_id', p.id, 'name', p.file_name, 'logical_id', p.id,
      'pages', '[]'::jsonb) order by p.ordinal) from plans p),
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
create function pg_temp.dispatch() returns uuid language sql as $$
  select job_id from public.dispatch_next_takeoff_host_job(pg_temp.host())
$$;

-- 1. Before the owner's activation of one analysis per plan (the automatic start and the notices are active).
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');
select is(public.takeoff_plan_dispatch_is_active(), false, 'one analysis per plan is not active before its activation');
select throws_ok($$select * from pg_temp.launch(20)$$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID',
  'before its activation no request of format 2 is sealed');
select is((select count(*)::integer from public.dispatch_next_takeoff_host_job(pg_temp.host())), 0,
  'before its activation the dispatcher answers nothing (the Mac keeps its former order)');

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
-- Its units are set aside here (without their triggers) so that the next sections start from an idle Mac.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now(),
  next_retry_at = null where launch_request_id = pg_temp.request(26);
update public.takeoff_launch_requests set state = 'closed', outcome = 'canceled', closed_at = now(), completion_event_id = gen_random_uuid(),
  units_canceled = 7 where id = pg_temp.request(26);
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
select results_eq($$select outcome, reserved_tokens from pg_temp.reserve(pg_temp.unit(20, 3), 903, 'call:2')$$,
  $$values ('reserved'::text, 120000::bigint)$$, 'what is left of the share still allows a call, counted against what is held');
select pg_temp.complete(pg_temp.unit(20, 3));
select results_eq($$select call_key, state from private.takeoff_launch_usage where job_id = pg_temp.unit(20, 3) order by call_key$$,
  $$values ('call:1'::text, 'unknown'::text), ('call:2'::text, 'unknown'::text)$$,
  'a call still reserved when its attempt ends is held as unknown too');

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
  2, 'the consumption left unknown is told');
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
select is((select count(*)::integer from public.audit_logs where action = 'takeoff.job.canceled'
  and after_data #>> '{metadata,launch_request_id}' = pg_temp.request(22)::text), 2, 'each cancellation is traced');
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

-- 9. A unit whose attempt died: the hosted recovery closes it, its reservation stays unknown, the Mac is free again.
select results_eq($$select outcome from pg_temp.launch(25)$$, $$values ('admitted'::text)$$, 'a fourth request');
select is(pg_temp.claim(pg_temp.unit(25, 1), 931), 1, 'its first plan is claimed');
select results_eq($$select outcome from pg_temp.reserve(pg_temp.unit(25, 1), 931, 'call:1')$$, $$values ('reserved'::text)$$,
  'and its call reserved; then the Mac stops');
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second' where id = pg_temp.unit(25, 1);
select is(pg_temp.dispatch(), pg_temp.unit(25, 2), 'a lease that expired holds the Mac no more: the next unit may start');
select is((select count(*)::integer from public.recover_stale_local_takeoff_jobs(now()) where job_id = pg_temp.unit(25, 1)), 1,
  'the recovery closes the abandoned attempt');
select results_eq($$select state from private.takeoff_launch_usage where job_id = pg_temp.unit(25, 1)$$, $$values ('unknown'::text)$$,
  'its call is held as unknown: no second call is made on its credit');
select is((select error_code from public.takeoff_jobs where id = pg_temp.unit(25, 1)), 'TAKEOFF_WORKER_OUTCOME_UNKNOWN',
  'with the unknown outcome named');

-- 10. The send of a per-plan analysis stays closed; a reconciliation closes a request whose ends were not settled.
select throws_ok($$update public.takeoff_jobs set estimate_version_id = pg_temp.f(80) where id = pg_temp.unit(20, 1)$$,
  '40001', 'TAKEOFF_SEND_JOB_NOT_READY', 'a per-plan analysis is never attached to a draft (its send stays closed)');
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now(), next_retry_at = null
where launch_request_id = pg_temp.request(25) and analysis_outcome is null;
set local session_replication_role = origin;
select results_eq($$select state from public.reconcile_takeoff_launch_requests() where request_id = pg_temp.request(25)$$,
  $$values ('closed'::text)$$, 'a request whose units all ended is closed by the reconciliation, without any call');
select is((select count(*)::integer from public.takeoff_completion_notifications where request_id = pg_temp.request(25)), 1,
  'with one notice');
select is((select count(*)::integer from public.reconcile_takeoff_launch_requests() where request_id = pg_temp.request(25)), 0,
  'and only once');

select * from finish();
rollback;
