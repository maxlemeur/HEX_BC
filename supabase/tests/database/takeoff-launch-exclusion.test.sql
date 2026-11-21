-- Lot 2, PR 6 fix round (20261121193413_takeoff_launch_exclusion_and_send_requests.sql): the rules of the takeoff's
-- launches hold in the database. A manual request is refused while the affaire's automatic start can still begin, and a
-- first analysis on an affaire that has one; an analysis launched outside any request that has not ended runs (a command is
-- answered with it, an automatic admission waits); once both cut-offs are set a member registers no job outside a request,
-- while before them the previous application's admission is unchanged. Isolation justified: every rule is a refusal of a
-- database function that the affaire's screen never reaches once it obeys the same rule; races between two sessions are in
-- takeoff-launch-request-race.test.sql. Written before the migration: red on 64a0e1c2a. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d4710000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d4710000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.f(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(n))::text, true);
$$;
create function pg_temp.sign_out() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true);
  select set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.confirm(project integer, member integer)
returns table (outcome text, request_id uuid, state text, reason_code text, payer_id uuid) language sql as $$
  select c.outcome, c.request_id, c.state, c.reason_code, c.payer_id from public.confirm_affaire_brief_takeoff(pg_temp.f(10),
    pg_temp.f(project), pg_temp.f(member), (select b.updated_at from public.affaire_briefs b where b.project_id = pg_temp.f(project)),
    public.takeoff_payer_notice(pg_temp.f(10), pg_temp.f(project), pg_temp.f(member), pg_temp.selection()),
    pg_temp.host(), pg_temp.selection(), null,
  p_actor_claims => jsonb_build_object('sub', pg_temp.f(member), 'role', 'authenticated')) c
$$;

-- Engineer 1 owns the affaires; 3 is a director (a reader, who confirms without paying).
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'launch-exclusion-' || n || '@example.test', '{}'::jsonb, now() from unnest(array[1, 3]) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd4710000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Exclusion des métrés (fictif)', 'launch-exclusion-test');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(3), 'director', true, '2020-01-01');
-- A: its automatic start waits for an operator. B: a finished analysis launched on a version. C: an analysis launched on a
-- version that still runs. D: no analysis at all. E: the previous application's admission of a job.
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(20 + n), pg_temp.f(10), pg_temp.f(1), 'Affaire fictive ' || n from generate_series(0, 4) as n;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select pg_temp.f(30 + n), pg_temp.f(20 + n), pg_temp.f(1), 'ready' from unnest(array[0, 2]) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object)
select pg_temp.f(35 + n), pg_temp.f(20 + n), pg_temp.f(30 + n), 'a_confirmer', 'Résumé fictif', 'Objet fictif' from unnest(array[0, 2]) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select pg_temp.f(40 + n), pg_temp.f(10), pg_temp.f(20 + n), 'Plans fictifs ' || n from generate_series(0, 4) as n;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(50 + n), pg_temp.f(10), pg_temp.f(40 + n), 'plan-' || n || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(40 + n), pg_temp.f(50 + n), 'plan-' || n || '.pdf'), 'application/pdf', 8, 1
from generate_series(0, 4) as n;

create function pg_temp.snapshot(n integer) returns jsonb language sql as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-21T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', id, 'kind', 'plan', 'active', true, 'confirmed', true,
        'plan_set_id', plan_set_id, 'file_path', file_path, 'page_count', page_count, 'source_updated_at', updated_at) order by id)
        from public.plan_files where plan_set_id = pg_temp.f(40 + n))))
$$;
create function pg_temp.manifest(n integer) returns jsonb language sql as $$
  select jsonb_build_object('format_version', 1, 'intent', 'initial',
    'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
    'units', jsonb_build_array(jsonb_build_object('key', 'grouped', 'plans', jsonb_build_array(pg_temp.f(50 + n)))),
    'plans', jsonb_build_array(jsonb_build_object('entry_key', pg_temp.f(50 + n), 'plan_file_id', pg_temp.f(50 + n), 'pages', '[]'::jsonb)),
    'coverage', jsonb_build_object('plans_retained', 1, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
    'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))
$$;
create function pg_temp.job(id integer, n integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', pg_temp.f(id), 'plan_set_id', pg_temp.f(40 + n), 'source_file_name', 'plan-' || n || '.pdf',
    'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host())
$$;
-- A command of a manual launch request on affaire n, as the server sends it.
create function pg_temp.launch(n integer, key integer, intent text, predecessor uuid, job integer)
returns table (outcome text, request_id uuid, job_id uuid) language sql as $$
  select r.outcome, r.request_id, r.job_id from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(20 + n), pg_temp.f(1),
    pg_temp.f(key), intent, predecessor, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(n), pg_temp.snapshot(n),
    pg_temp.job(job, n), pg_temp.f(40 + n), 1) r
$$;
create function pg_temp.request(n integer) returns uuid language sql as $$
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(20 + n) and origin = 'automatic'
$$;

-- Analyses launched on a version before the activation (jobs without a request): B's finished, C's still read.
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by) values
  (pg_temp.f(61), pg_temp.f(10), pg_temp.f(21), pg_temp.f(41), 'C', 'completed', pg_temp.f(1)),
  (pg_temp.f(62), pg_temp.f(10), pg_temp.f(22), pg_temp.f(42), 'C', 'processing', pg_temp.f(1));
set local session_replication_role = origin;

-- E's confirmed preparation, which the previous application's admission attests a job against.
insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
select pg_temp.f(10), pg_temp.f(24), 1, s -> 'preparation', s - 'execution_selection', '2026-11-21T08:00:00Z', pg_temp.f(1), pg_temp.f(1)
from pg_temp.snapshot(4) as s;
-- The previous application's admission of a job without a request (M1's RPC, a member's session), as it sends it.
create function pg_temp.admit_unrequested(id integer) returns void language sql as $$
  select null::void from public.admit_prepared_takeoff_job(jsonb_build_object(
    'id', pg_temp.f(id), 'tenant_id', pg_temp.f(10), 'project_id', pg_temp.f(24), 'plan_set_id', pg_temp.f(44), 'level', 'C',
    'created_by', pg_temp.f(1), 'execution_provider', 'chatgpt_local', 'execution_host_id', pg_temp.host(),
    'processing_strategy', 'sync', 'preparation_snapshot',
    (select confirmed_snapshot from public.takeoff_preparations where project_id = pg_temp.f(24))))
$$;

-- 1. Before the cut-offs, nothing changes for the previous application: its admission of a job without a request runs.
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.admit_unrequested(80)$$, 'before the activation a member''s admission without a request runs');
reset role;
select pg_temp.sign_out();
select is((select count(*)::integer from public.takeoff_jobs where id = pg_temp.f(80) and launch_request_id is null), 1,
  'its job is registered outside any request');

-- The owner activates the automatic start and the notices.
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');

-- 2. Once active, a member registers no new job outside a request; a job that exists still reaches its unique key.
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select pg_temp.admit_unrequested(81)$$, '55000', 'TAKEOFF_JOB_REQUEST_REQUIRED',
  'once active the admission of a new job without a request is refused');
select throws_ok($$select pg_temp.admit_unrequested(80)$$, '23505', null,
  'a replay of the job admitted before still meets its unique key, as it did');
select throws_ok($$insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, plan_set_id, level, created_by)
  values (pg_temp.f(82), pg_temp.f(10), pg_temp.f(24), null, pg_temp.f(44), 'C', pg_temp.f(1))$$, '55000', 'TAKEOFF_JOB_REQUEST_REQUIRED',
  'nor does a member''s direct insert register one');
reset role;
select pg_temp.sign_out();
select is((select count(*)::integer from public.takeoff_jobs where id in (pg_temp.f(81), pg_temp.f(82))), 0, 'no job was registered');

-- 3. While the affaire's automatic start can still begin, no command sets it aside: it is taken on from the zone.
select results_eq($$select state, reason_code, payer_id from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(3), (select updated_at from public.affaire_briefs where id = pg_temp.f(35)), null, null, null, 'LOCAL_RUNTIME_REQUIRED',
  p_actor_claims => jsonb_build_object('sub', pg_temp.f(3), 'role', 'authenticated'))$$,
  $$values ('blocked'::text, 'OPERATOR_REQUIRED'::text, null::uuid)$$, 'a director''s confirmation leaves A''s start waiting for an operator');
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by)
values (pg_temp.f(60), pg_temp.f(10), pg_temp.f(20), pg_temp.f(40), 'C', 'completed', pg_temp.f(1));
set local session_replication_role = origin;
select throws_ok($$select * from pg_temp.launch(0, 70, 'reread_plans', pg_temp.f(60), 63)$$, '55000', 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING',
  'a relaunch while the automatic start waits is refused');
select results_eq($$select state, reason_code from public.takeoff_launch_requests where id = pg_temp.request(0)$$,
  $$values ('blocked'::text, 'OPERATOR_REQUIRED'::text)$$, 'the automatic start keeps waiting for its gesture, never set aside');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(20) and origin = 'manual'), 0,
  'no manual request exists');
select is((select count(*)::integer from private.takeoff_launch_commands where project_id = pg_temp.f(20)), 0,
  'and the refused command recorded nothing');
select is((select count(*)::integer from public.takeoff_jobs where id = pg_temp.f(63)), 0, 'no job either');

-- 4. A first analysis only on an affaire that has none: a relaunch names the analysis it replaces.
select throws_ok($$select * from pg_temp.launch(1, 71, 'initial', null, 64)$$, '22023', 'TAKEOFF_LAUNCH_ANALYSIS_EXISTS',
  'a first analysis of an affaire that already has one is refused');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(21)), 0, 'it creates no request');
select results_eq($$select outcome, job_id from pg_temp.launch(1, 72, 'reread_plans', pg_temp.f(61), 64)$$,
  $$values ('admitted'::text, pg_temp.f(64))$$, 'the relaunch naming it runs');
select results_eq($$select outcome, job_id from pg_temp.launch(3, 73, 'initial', null, 65)$$,
  $$values ('admitted'::text, pg_temp.f(65))$$, 'the first analysis of an affaire without any runs');

-- 5. An analysis launched outside any request that has not ended runs: a command is answered with it.
select results_eq($$select outcome, request_id, job_id from pg_temp.launch(2, 74, 'reread_plans', pg_temp.f(62), 66)$$,
  $$values ('already_running'::text, null::uuid, pg_temp.f(62))$$, 'a relaunch while an analysis without request is read returns it');
select results_eq($$select answer, request_id, job_id from private.takeoff_launch_commands where intent_key = pg_temp.f(74)$$,
  $$values ('already_running'::text, null::uuid, pg_temp.f(62))$$, 'its receipt records the analysis it found');
select results_eq($$select outcome, request_id, job_id from public.replay_manual_takeoff_request(pg_temp.f(10), pg_temp.f(22), pg_temp.f(1),
  pg_temp.f(74), 'reread_plans', pg_temp.f(62), pg_temp.f(42), 1)$$,
  $$values ('already_running'::text, null::uuid, pg_temp.f(62))$$, 'its replay is that answer');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(22)), 0, 'no request is created');
select is((select count(*)::integer from public.takeoff_jobs where id = pg_temp.f(66)), 0, 'nor a second paid job');
-- A technical retry due counts as running too.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'failed', next_retry_at = now() + interval '1 minute', analysis_outcome = null where id = pg_temp.f(62);
set local session_replication_role = origin;
select results_eq($$select outcome, job_id from pg_temp.launch(2, 75, 'reread_plans', pg_temp.f(62), 66)$$,
  $$values ('already_running'::text, pg_temp.f(62))$$, 'an analysis whose retry is due is still running');

-- The automatic start of that affaire waits for it too, and its Mac tries again.
select results_eq($$select state from pg_temp.confirm(22, 1)$$, $$values ('evaluating'::text)$$, 'C''s confirmer mandates its start');
create temp table claimed as select * from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(90));
select results_eq($$select a.outcome, a.reason_code from public.admit_takeoff_launch_request(pg_temp.request(2), pg_temp.f(90),
  (select mark from claimed where project_id = pg_temp.f(22)), pg_temp.manifest(2), pg_temp.snapshot(2), pg_temp.job(67, 2)) a$$,
  $$values ('blocked'::text, 'ANOTHER_ANALYSIS_RUNNING'::text)$$, 'its admission waits while the analysis without request runs');
select is((select count(*)::integer from public.takeoff_jobs where id = pg_temp.f(67)), 0, 'and admits no job');
select ok((select 'ANOTHER_ANALYSIS_RUNNING' = any (private.takeoff_launch_transient_reasons())), 'a reason its Mac retries on its own');

-- Once that analysis ends, the command and the admission run.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'failed', next_retry_at = null, analysis_outcome = 'failure', analysis_finished_at = now()
where id = pg_temp.f(62);
update public.takeoff_launch_requests set evaluation_lease_token = null, evaluation_lease_expires_at = null, state = 'evaluating',
  reason_code = null, evaluated_at = now() - interval '1 hour' where id = pg_temp.request(2);
set local session_replication_role = origin;
delete from claimed;
insert into claimed select * from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(91));
select results_eq($$select a.outcome, a.job_id from public.admit_takeoff_launch_request(pg_temp.request(2), pg_temp.f(91),
  (select mark from claimed where project_id = pg_temp.f(22)), pg_temp.manifest(2), pg_temp.snapshot(2), pg_temp.job(67, 2)) a$$,
  $$values ('admitted'::text, pg_temp.f(67))$$, 'the automatic start is admitted once the analysis without request ended');

-- 6. After the cut-off is withdrawn, the previous application's admission runs again as before.
delete from private.takeoff_launch_activation;
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.admit_unrequested(83)$$, 'without the automatic start a member''s admission runs as before');
reset role;
select pg_temp.sign_out();

select * from finish();
rollback;
