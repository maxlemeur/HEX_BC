-- Lot 2, PR 6 fix rounds (20261121193413_takeoff_launch_exclusion_and_send_requests.sql): the rules of the takeoff's
-- launches hold in the database. A manual request is refused while the affaire's automatic start can still begin (an
-- eligible payer and no new dossier change needed, or a take-over an eligible member can make); otherwise it sets that start
-- aside, as M4 did. A first analysis is refused on an affaire that has one. An analysis launched outside any request that
-- something will still move runs (a command is answered with it, an automatic admission waits); a historical one nothing
-- moves blocks nothing. Once both cut-offs are set a member registers no job outside a request and restarts none while a
-- request of the affaire runs, while before them the previous application's statements are unchanged. Isolation
-- justified: every rule is a refusal of a database function or write that the affaire's screen never reaches once it obeys
-- the same rule; races between two sessions are in takeoff-launch-request-race.test.sql. Written before each round's
-- migration change: red on 64a0e1c2a, then on 5298da6a3. All values are fictional.
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
-- version that still runs. D: no analysis at all. E: the previous application's admission of a job. F: an automatic start
-- that waits for a dossier change. G: one whose payer may no longer pay. H: one its eligible payer's Mac evaluates. I: a
-- historical failed analysis of the former provider. J: a failed analysis launched on a version, which its member resubmits.
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(20 + n), pg_temp.f(10), pg_temp.f(1), 'Affaire fictive ' || n from generate_series(0, 9) as n;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select pg_temp.f(30 + n), pg_temp.f(20 + n), pg_temp.f(1), 'ready' from unnest(array[0, 2]) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object)
select pg_temp.f(35 + n), pg_temp.f(20 + n), pg_temp.f(30 + n), 'a_confirmer', 'Résumé fictif', 'Objet fictif' from unnest(array[0, 2]) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select pg_temp.f(40 + n), pg_temp.f(10), pg_temp.f(20 + n), 'Plans fictifs ' || n from generate_series(0, 9) as n;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(50 + n), pg_temp.f(10), pg_temp.f(40 + n), 'plan-' || n || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(40 + n), pg_temp.f(50 + n), 'plan-' || n || '.pdf'), 'application/pdf', 8, 1
from generate_series(0, 9) as n;

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
-- The same command, answering a refusal with its message instead of raising: each case reports what the database answered.
create function pg_temp.attempt(n integer, key integer, intent text, predecessor uuid, job integer)
returns table (outcome text, job_id uuid) language plpgsql as $$
begin
  return query select l.outcome, l.job_id from pg_temp.launch(n, key, intent, predecessor, job) l;
exception when others then
  return query select sqlerrm::text, null::uuid;
end;
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
-- Before the cut-offs, the Mac's claim of a retry that has waited a month runs as before (no restart guard, no ceiling).
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, execution_provider,
  execution_host_id, next_retry_at, error_code)
values (pg_temp.f(173), pg_temp.f(10), pg_temp.f(24), pg_temp.f(44), 'C', 'failed', pg_temp.f(1), 'chatgpt_local', pg_temp.host(),
  now() - interval '30 days', 'AI_TIMEOUT');
set local session_replication_role = origin;
select is(public.takeoff_local_retry_floor(), null::timestamptz, 'before the cut-offs no retry expires for the Mac''s poll');
select is((select count(*)::integer from public.claim_observed_local_takeoff_job(pg_temp.f(173), pg_temp.f(10), pg_temp.host(), now(),
  pg_temp.f(97), now() + interval '5 minutes', 'modele-fictif', 'fixture', 'failed', 0)), 1,
  'and its claim of a month-old retry runs as before');
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'completed' where id = pg_temp.f(173);
set local session_replication_role = origin;

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

-- 3b. An automatic start that cannot start without a new dossier change, or without an eligible payer, waits for nothing
-- a gesture or its Mac can do: a relaunch sets it aside, as M4 did (red on 5298da6a3: refused, the affaire had no way to
-- start). H's start, evaluated for its eligible payer, can start: refused.
set local session_replication_role = replica;
insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state, reason_code, payer_id,
  mandate_kind, mandated_at, execution_host_id, mandate_selection, mandate_revision, evaluated_mark, evaluated_at, confirmed_by,
  updated_at) values
  (pg_temp.f(125), pg_temp.f(10), pg_temp.f(25), 'automatic', 'initial', pg_temp.f(125), 'not_eligible', 'NO_EXPLOITABLE_PLAN',
    pg_temp.f(1), 'confirmation', now(), pg_temp.host(), pg_temp.selection(), 1,
    private.takeoff_launch_mark_position(pg_temp.f(10), pg_temp.f(25)), now(), pg_temp.f(1), now()),
  (pg_temp.f(126), pg_temp.f(10), pg_temp.f(26), 'automatic', 'initial', pg_temp.f(126), 'evaluating', null,
    pg_temp.f(3), 'confirmation', now(), pg_temp.host(), pg_temp.selection(), 1, null, null, pg_temp.f(3), now()),
  (pg_temp.f(127), pg_temp.f(10), pg_temp.f(27), 'automatic', 'initial', pg_temp.f(127), 'evaluating', null,
    pg_temp.f(1), 'confirmation', now(), pg_temp.host(), pg_temp.selection(), 1, null, null, pg_temp.f(1), now());
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by)
select pg_temp.f(160 + n), pg_temp.f(10), pg_temp.f(20 + n), pg_temp.f(40 + n), 'C', 'completed', pg_temp.f(1) from generate_series(5, 7) as n;
set local session_replication_role = origin;
select results_eq($$select outcome, job_id from pg_temp.attempt(5, 76, 'reread_plans', pg_temp.f(165), 155)$$,
  $$values ('admitted'::text, pg_temp.f(155))$$, 'a relaunch while the automatic start waits for a dossier change runs');
select results_eq($$select state, reason_details ->> 'request_id' from public.takeoff_launch_requests where id = pg_temp.f(125)$$,
  $$select 'superseded'::text, r.id::text from public.takeoff_launch_requests r where r.project_id = pg_temp.f(25) and r.origin = 'manual'$$,
  'and sets that start aside for good, naming the relaunch');
select results_eq($$select outcome, job_id from pg_temp.attempt(6, 77, 'reread_plans', pg_temp.f(166), 156)$$,
  $$values ('admitted'::text, pg_temp.f(156))$$, 'a relaunch while the automatic start has no payer who may pay runs');
select is((select state from public.takeoff_launch_requests where id = pg_temp.f(126)), 'superseded', 'and sets that start aside');
select throws_ok($$select * from pg_temp.launch(7, 78, 'reread_plans', pg_temp.f(167), 157)$$, '55000', 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING',
  'a relaunch while the automatic start is evaluated for its eligible payer is refused');
select is((select state from public.takeoff_launch_requests where id = pg_temp.f(127)), 'evaluating', 'that start is untouched');

-- 4b. Once active, a member's resubmit of an analysis launched outside any request takes the affaire's lock and is refused
-- while a request of the affaire runs (red on 5298da6a3: the row went back to pending, two analyses ran); without a running
-- request it is written as before. The server's statement, under the member's session.
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, error_code)
values (pg_temp.f(168), pg_temp.f(10), pg_temp.f(25), pg_temp.f(45), 'C', 'failed', pg_temp.f(1), 'AI_TIMEOUT'),
  (pg_temp.f(169), pg_temp.f(10), pg_temp.f(29), pg_temp.f(49), 'C', 'failed', pg_temp.f(1), 'AI_TIMEOUT'),
  (pg_temp.f(171), pg_temp.f(10), pg_temp.f(25), pg_temp.f(45), 'C', 'failed', pg_temp.f(1), 'AI_TIMEOUT');
set local session_replication_role = origin;
create function pg_temp.resubmit(p_job integer) returns integer language sql as $$
  with reset as (update public.takeoff_jobs set status = 'pending', retry_count = 1, next_retry_at = null, last_error_at = null,
    started_at = null, completed_at = null, token_count = null, cost_cents = null, duration_ms = null, error_code = null,
    error_message = null
    where tenant_id = pg_temp.f(10) and id = pg_temp.f(p_job) and status = 'failed' and created_by = pg_temp.f(1)
      and analysis_outcome is null and next_retry_at is null and retry_count = 0 returning 1)
  select count(*)::integer from reset
$$;
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select pg_temp.resubmit(168)$$, '55000', 'TAKEOFF_LAUNCH_REQUEST_RUNNING',
  'a resubmit while the affaire''s relaunch runs is refused');
select is(pg_temp.resubmit(169), 1, 'a resubmit on an affaire where no request runs is written');
reset role;
select pg_temp.sign_out();
select is((select status from public.takeoff_jobs where id = pg_temp.f(168)), 'failed', 'the refused job stays failed');
-- The Mac's claim of a due retry of such an analysis is a restart too.
set local session_replication_role = replica;
update public.takeoff_jobs set execution_provider = 'chatgpt_local', execution_host_id = pg_temp.host(),
  next_retry_at = now() - interval '1 minute' where id = pg_temp.f(168);
set local session_replication_role = origin;
select throws_ok($$select id from public.claim_local_takeoff_job(pg_temp.f(168), pg_temp.f(10), pg_temp.host(), now(), pg_temp.f(98),
  now() + interval '5 minutes', 'modele-fictif', 'fixture')$$, '55000', 'TAKEOFF_LAUNCH_REQUEST_RUNNING',
  'its Mac''s retry while that relaunch runs is refused');
-- The analyses 3b admitted and J's resubmitted one end, as their worker would end them: a member has at most six in flight.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'completed' where id in (pg_temp.f(155), pg_temp.f(156), pg_temp.f(169));
set local session_replication_role = origin;

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
-- A technical retry that the local recovery will make or close (on this Mac, no batch, under three attempts, within the
-- wait ceiling) counts as running too.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'failed', next_retry_at = now() + interval '1 minute', analysis_outcome = null,
  execution_provider = 'chatgpt_local', execution_host_id = pg_temp.host() where id = pg_temp.f(62);
set local session_replication_role = origin;
select results_eq($$select outcome, job_id from pg_temp.launch(2, 75, 'reread_plans', pg_temp.f(62), 66)$$,
  $$values ('already_running'::text, pg_temp.f(62))$$, 'an analysis whose retry is due is still running');
select is(public.takeoff_running_analysis_outside_request(pg_temp.f(10), pg_temp.f(22)), pg_temp.f(62),
  'the zone reads that same analysis as running, by this rule');

-- 5b. A historical failed analysis that nothing will move blocks nothing (red on 5298da6a3: every launch of the affaire was
-- answered with it, for ever): the former provider's (no recovery retries it, cancel refuses it), one past three attempts,
-- one waiting longer than the wait ceiling.
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, next_retry_at, error_code)
values (pg_temp.f(170), pg_temp.f(10), pg_temp.f(28), pg_temp.f(48), 'C', 'failed', pg_temp.f(1), now() - interval '30 days', 'AI_TIMEOUT');
set local session_replication_role = origin;
select is(private.takeoff_unrequested_analysis_running(pg_temp.f(10), pg_temp.f(28)), null::uuid,
  'a failed analysis of the former provider with a retry recorded does not run');
select is(public.takeoff_running_analysis_outside_request(pg_temp.f(10), pg_temp.f(28)), null::uuid,
  'and the zone reads that it does not (red on 63bc8324f: the zone counted it and only saved the options)');
set local session_replication_role = replica;
update public.takeoff_jobs set execution_provider = 'chatgpt_local', execution_host_id = pg_temp.host(), retry_count = 3
where id = pg_temp.f(170);
set local session_replication_role = origin;
select is(private.takeoff_unrequested_analysis_running(pg_temp.f(10), pg_temp.f(28)), null::uuid,
  'nor one of this Mac past its three attempts');
set local session_replication_role = replica;
update public.takeoff_jobs set retry_count = 0 where id = pg_temp.f(170);
update private.takeoff_completion_activation set active_from = now() - interval '3 days';
set local session_replication_role = origin;
select is(private.takeoff_unrequested_analysis_running(pg_temp.f(10), pg_temp.f(28)), null::uuid,
  'nor one waiting longer than the wait ceiling');
set local session_replication_role = replica;
update private.takeoff_completion_activation set active_from = now() - interval '1 minute';
update public.takeoff_jobs set execution_provider = 'gemini', execution_host_id = null where id = pg_temp.f(170);
set local session_replication_role = origin;
select results_eq($$select outcome, job_id from pg_temp.attempt(8, 79, 'reread_plans', pg_temp.f(170), 158)$$,
  $$values ('admitted'::text, pg_temp.f(158))$$, 'a relaunch of the affaire of a historical failed analysis runs');
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'completed' where id = pg_temp.f(158);
set local session_replication_role = origin;

-- 5c. A retry past its wait ceiling no longer runs, so a replacement is admitted; once that replacement has ended, the
-- expired retry never runs after it (red on 63bc8324f: the next poll's claim ran it), and the Mac's poll no longer selects
-- it (its ceiling read from the database).
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, execution_provider,
  execution_host_id, next_retry_at, error_code)
values (pg_temp.f(172), pg_temp.f(10), pg_temp.f(29), pg_temp.f(49), 'C', 'failed', pg_temp.f(1), 'chatgpt_local', pg_temp.host(),
  now() - interval '30 days', 'AI_TIMEOUT');
update private.takeoff_completion_activation set active_from = now() - interval '3 days';
set local session_replication_role = origin;
select is(public.takeoff_running_analysis_outside_request(pg_temp.f(10), pg_temp.f(29)), null::uuid, 'the expired retry does not run');
select ok(public.takeoff_local_retry_floor() between now() - interval '24 hours 1 minute' and now() - interval '23 hours 59 minutes',
  'the Mac''s poll reads the wait ceiling: a retry due before it has expired');
select results_eq($$select outcome, job_id from pg_temp.attempt(9, 85, 'reread_plans', pg_temp.f(172), 159)$$,
  $$values ('admitted'::text, pg_temp.f(159))$$, 'a replacement is admitted');
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'completed', analysis_outcome = 'success', analysis_finished_at = now() where id = pg_temp.f(159);
update public.takeoff_launch_requests set state = 'closed', outcome = 'success', closed_at = now(), units_succeeded = 1,
  completion_event_id = gen_random_uuid()
where project_id = pg_temp.f(29) and origin = 'manual';
set local session_replication_role = origin;
select throws_ok($$select id from public.claim_observed_local_takeoff_job(pg_temp.f(172), pg_temp.f(10), pg_temp.host(), now(),
  pg_temp.f(96), now() + interval '5 minutes', 'modele-fictif', 'fixture', 'failed', 0)$$, '55000', 'TAKEOFF_JOB_RETRY_EXPIRED',
  'after the replacement ended, the expired retry''s claim is refused');
select is((select status from public.takeoff_jobs where id = pg_temp.f(172)), 'failed', 'it stays failed, for its recovery to close');
set local session_replication_role = replica;
update private.takeoff_completion_activation set active_from = now() - interval '1 minute';
set local session_replication_role = origin;
select is(public.takeoff_local_retry_floor(), null::timestamptz, 'within the ceiling of a recent activation, nothing has expired');

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
select is(pg_temp.resubmit(171), 1, 'and a member''s resubmit while a request runs is written as before');
reset role;
select pg_temp.sign_out();

-- What the affaire's zone reads of 3b's starts, to offer the options' launch or only their saving.
select ok(public.takeoff_launch_request_can_start(pg_temp.f(127), pg_temp.f(1)), 'the zone reads that H''s start can still begin');
select ok(not public.takeoff_launch_request_can_start(pg_temp.f(125), pg_temp.f(1)), 'and that F''s, set aside, cannot');

select * from finish();
rollback;
