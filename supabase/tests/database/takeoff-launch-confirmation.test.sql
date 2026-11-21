-- Lot 2, M4 (20261121111238_takeoff_launch_requests.sql), its first review round: the automatic request is reserved in
-- the brief's own transaction (the server's confirmation, or any other confirmation through a trigger that never
-- mandates); a payable mandate only with the payer notice that was shown; a replay or a stale gesture never replaces a
-- newer mandate; nothing new is written with one cut-off only; the usage of a failed attempt and the request's budget;
-- a refused command is recorded and replayed as such. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d4a00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d4a00000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection(authorization_id text default 'autorisation-1') returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null,
    'hostId', pg_temp.host(), 'authorizationId', authorization_id)
$$;
create function pg_temp.as_member(n integer) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(n))::text, true),
    set_config('request.jwt.claim.sub', pg_temp.f(n)::text, true)
$$;
create function pg_temp.as_nobody() returns void language sql as $$
  select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)
$$;

-- Engineer 1 owns the affaires; engineer 2 does not; 3 is a director (a reader); 5 an administrator.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'launch-confirmation-' || n || '@example.test', '{}'::jsonb, now() from unnest(array[1, 2, 3, 5]) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd4a00000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Confirmations de dossier (fictif)', 'launch-confirmation-test');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(2), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(3), 'director', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(5), 'admin', true, '2020-01-01');
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(20 + n), pg_temp.f(10), pg_temp.f(1), 'Affaire de confirmation ' || n || ' (fictive)' from generate_series(0, 9) as n;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select pg_temp.f(30 + n), pg_temp.f(20 + n), pg_temp.f(1), 'ready' from generate_series(0, 9) as n;
-- The briefs of affaires 3 and 4 were confirmed by the server before this file's activation; the others wait.
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select pg_temp.f(40 + n), pg_temp.f(20 + n), pg_temp.f(30 + n), case when n in (3, 4) then 'confirme' else 'a_confirmer' end,
  'Résumé fictif', 'Objet fictif', case when n in (3, 4) then now() end, case when n in (3, 4) then pg_temp.f(1) end
from generate_series(0, 9) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select pg_temp.f(50 + n), pg_temp.f(10), pg_temp.f(20 + n), 'Plans du dossier ' || n from generate_series(0, 9) as n;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(60 + n), pg_temp.f(10), pg_temp.f(50 + n), 'plan-' || n || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(50 + n), pg_temp.f(60 + n), 'plan-' || n || '.pdf'), 'application/pdf', 8, 1
from generate_series(0, 9) as n;

create function pg_temp.request(project integer) returns uuid language sql as $$
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(project) and origin = 'automatic'
$$;
create function pg_temp.brief_at(project integer) returns timestamptz language sql as $$
  select updated_at from public.affaire_briefs where project_id = pg_temp.f(project)
$$;
create function pg_temp.confirm_in_session(member integer, project integer, written_confirmer integer) returns void
language plpgsql as $$
begin
  perform pg_temp.as_member(member);
  set local role authenticated;
  update public.affaire_briefs set status = 'confirme', confirmed_at = clock_timestamp(), confirmed_by = pg_temp.f(written_confirmer),
    updated_by = pg_temp.f(member) where project_id = pg_temp.f(project);
  reset role;
  perform pg_temp.as_nobody();
end;
$$;

-- 1. One cut-off only: the automatic start's set, the notices' not. A request could never close: nothing new is written.
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
select pg_temp.confirm_in_session(1, 20, 1);
select is((select count(*)::integer from private.takeoff_launch_marks where project_id = pg_temp.f(20)), 0,
  'with the automatic start''s cut-off alone, a confirmation records no mark');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(20)), 0,
  'and reserves no request');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');

-- 2. Any confirmation of the brief reserves the automatic request in its own transaction, never with a mandate: here a
-- released client confirms through its own update and writes another member as the confirmer.
select pg_temp.confirm_in_session(1, 21, 2);
select results_eq($$select origin, state, reason_code, confirmed_by, payer_id, mandate_kind
  from public.takeoff_launch_requests where project_id = pg_temp.f(21)$$,
  $$values ('automatic'::text, 'blocked'::text, 'MANDATE_REQUIRED'::text, pg_temp.f(1), null::uuid, null::text)$$,
  'a confirmation outside the server reserves the request, blocked and unmandated, with the session''s member as confirmer');
select pg_temp.confirm_in_session(3, 22, 3);
select results_eq($$select state, reason_code, confirmed_by, payer_id from public.takeoff_launch_requests where project_id = pg_temp.f(22)$$,
  $$values ('blocked'::text, 'OPERATOR_REQUIRED'::text, pg_temp.f(3), null::uuid)$$,
  'a reader''s confirmation reserves it waiting for an operator');
select is((select count(*)::integer from public.claim_takeoff_launch_evaluations(pg_temp.host(), gen_random_uuid())), 0,
  'an unmandated request is never claimed');

-- 3. The usage of every attempt, a failed one included, is counted on its request; the request's budget is sealed at its
-- admission and a job stopped by it closes the request with that reason.
insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state, confirmed_by, payer_id,
  requested_by, mandate_kind, mandated_at, execution_host_id, mandate_selection, execution_selection)
select pg_temp.f(70 + n), pg_temp.f(10), pg_temp.f(23 + n), 'automatic', 'initial', pg_temp.f(70 + n), 'evaluating', pg_temp.f(1),
  pg_temp.f(1), pg_temp.f(1), 'confirmation', now(), pg_temp.host(), pg_temp.selection(), pg_temp.selection()
from generate_series(0, 1) as n;
create function pg_temp.snapshot(n integer) returns jsonb language sql as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-21T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', id, 'kind', 'plan', 'active', true, 'confirmed', true,
        'plan_set_id', plan_set_id, 'file_path', file_path, 'page_count', page_count, 'source_updated_at', updated_at) order by id)
        from public.plan_files where plan_set_id = pg_temp.f(50 + n))))
$$;
create function pg_temp.manifest(n integer) returns jsonb language sql as $$
  select jsonb_build_object('format_version', 1, 'intent', 'initial',
    'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
    'units', jsonb_build_array(jsonb_build_object('key', 'grouped', 'plans', jsonb_build_array(pg_temp.f(60 + n)))),
    'plans', jsonb_build_array(jsonb_build_object('entry_key', pg_temp.f(60 + n), 'plan_file_id', pg_temp.f(60 + n), 'pages', '[]'::jsonb)),
    'coverage', jsonb_build_object('plans_retained', 1, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
    'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))
$$;
create function pg_temp.job(n integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', pg_temp.f(80 + n), 'plan_set_id', pg_temp.f(50 + n), 'source_file_name', 'plan-' || n || '.pdf',
    'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host())
$$;
create temp table claimed as select * from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(90));
select is((select count(*)::integer from claimed), 2, 'the Mac claims both mandated requests');
select results_eq($$select a.outcome from generate_series(0, 1) as n cross join lateral public.admit_takeoff_launch_request(
  pg_temp.f(70 + n), pg_temp.f(90), (select mark from claimed where request_id = pg_temp.f(70 + n)), pg_temp.manifest(3 + n),
  pg_temp.snapshot(3 + n), pg_temp.job(3 + n)) a order by n$$, $$values ('admitted'::text), ('admitted'::text)$$, 'both are admitted');

-- The Mac's claim of a job as it stands (pending, or failed with a retry due), as its dispatcher observes it.
create function pg_temp.claim_job(n integer, lease integer) returns integer language sql as $$
  select count(*)::integer from public.takeoff_jobs j cross join lateral public.claim_observed_local_takeoff_job(j.id, j.tenant_id,
    pg_temp.host(), now(), pg_temp.f(lease), now() + interval '1 hour', 'fixture', 'fixture', j.status::text, j.retry_count) c
  where j.id = pg_temp.f(83 + n)
$$;
create function pg_temp.metric(tokens integer) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('level', 'C', 'provider', 'chatgpt', 'model', 'modele-fictif', 'chunk_index', 0,
    'chunk_start_page', 1, 'chunk_end_page', 10, 'input_tokens', tokens, 'reasoning_tokens', 0, 'output_tokens', 0,
    'total_tokens', tokens, 'cost_cents', 0, 'duration_ms', 10, 'timed_out', false, 'budget_exceeded', false, 'metadata', '{}'::jsonb))
$$;
select is(pg_temp.claim_job(0, 91), 1, 'the Mac claims the first job');
-- Its first chunk answered and was paid for, its second failed: the attempt fails, to be tried again.
select isnt(public.record_local_takeoff_failure(pg_temp.f(83), pg_temp.f(10), pg_temp.f(91),
  jsonb_build_object('completed_at', now(), 'duration_ms', 20, 'error_code', 'TAKEOFF_PROVIDER_ERROR', 'error_message', 'Échec fictif',
    'analysis_outcome', null, 'last_error_at', now(), 'next_retry_at', now()),
  jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb, 'provider_meta', '{}'::jsonb,
    'token_count', 900, 'cost_cents', 0, 'duration_ms', 20), pg_temp.metric(900)), null, 'the failed attempt is recorded');
select results_eq($$select tokens_observed, cost_cents_observed from public.takeoff_launch_requests where id = pg_temp.f(70)$$,
  $$values (900::bigint, 0::bigint)$$, 'the request counts what the failed attempt consumed');
select is(pg_temp.claim_job(0, 92), 1, 'the Mac claims the job again');
select isnt(public.record_local_takeoff_failure(pg_temp.f(83), pg_temp.f(10), pg_temp.f(92),
  jsonb_build_object('completed_at', now(), 'duration_ms', 20, 'error_code', 'TAKEOFF_PROVIDER_ERROR', 'error_message', 'Échec fictif',
    'analysis_outcome', null, 'last_error_at', now(), 'next_retry_at', now()),
  jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb, 'provider_meta', '{}'::jsonb,
    'token_count', 300, 'cost_cents', 0, 'duration_ms', 20), pg_temp.metric(300)), null, 'a second failed attempt is recorded');
select is((select tokens_observed from public.takeoff_launch_requests where id = pg_temp.f(70)), 1200::bigint,
  'a retry adds its own consumption: it never starts from zero');
select results_eq($$select token_budget, cost_budget_cents from public.takeoff_launch_requests where id = pg_temp.f(70)$$,
  $$values (400000::bigint, 2500::bigint)$$, 'the request holds the budget sealed with its manifest');

-- The second job is stopped before its next paid attempt by the request's spent budget.
select is(pg_temp.claim_job(1, 93), 1, 'the Mac claims the second job');
select isnt(public.record_local_takeoff_failure(pg_temp.f(84), pg_temp.f(10), pg_temp.f(93),
  jsonb_build_object('completed_at', now(), 'duration_ms', 5, 'error_code', 'TAKEOFF_REQUEST_BUDGET_EXHAUSTED',
    'error_message', 'Budget de la demande épuisé.', 'analysis_outcome', 'failure', 'last_error_at', now(), 'next_retry_at', null)),
  null, 'the job ends on the spent budget');
select results_eq($$select state, outcome, reason_code from public.takeoff_launch_requests where id = pg_temp.f(71)$$,
  $$values ('closed'::text, 'failure'::text, 'BUDGET_EXHAUSTED'::text)$$, 'its request closes with that reason');

-- 4. A command that finds another analysis running is recorded with its key: its replay after that analysis ended is
-- still the same answer, never a paid job. A relaunch names the analysis it replaces.
select throws_ok($$select * from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(23), pg_temp.f(1), pg_temp.f(95),
  'reread_plans', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(3), pg_temp.snapshot(3), pg_temp.job(5))$$,
  '22023', 'TAKEOFF_LAUNCH_PREDECESSOR_REQUIRED', 'a relaunch without the analysis it replaces is refused');
select results_eq($$select outcome, job_id from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(23), pg_temp.f(1),
  pg_temp.f(96), 'reread_plans', pg_temp.f(83), pg_temp.host(), pg_temp.selection(), pg_temp.manifest(3), pg_temp.snapshot(3), pg_temp.job(5))$$,
  $$values ('already_running'::text, pg_temp.f(83))$$, 'a relaunch while the analysis runs returns it');
select results_eq($$select origin, state, reason_code, intent_key from public.takeoff_launch_requests
  where project_id = pg_temp.f(23) and origin = 'manual'$$, $$values ('manual'::text, 'refused'::text, 'ANOTHER_ANALYSIS_RUNNING'::text, pg_temp.f(96))$$,
  'the refused click is recorded under its key');
select is(pg_temp.claim_job(0, 94), 1, 'the running analysis is claimed');
select isnt(public.record_local_takeoff_failure(pg_temp.f(83), pg_temp.f(10), pg_temp.f(94),
  jsonb_build_object('completed_at', now(), 'duration_ms', 5, 'error_code', 'TAKEOFF_PROVIDER_ERROR', 'error_message', 'Échec fictif',
    'analysis_outcome', 'failure', 'last_error_at', now(), 'next_retry_at', null)), null, 'and ends');
select results_eq($$select outcome, job_id from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(23), pg_temp.f(1),
  pg_temp.f(96), 'reread_plans', pg_temp.f(83), pg_temp.host(), pg_temp.selection(), pg_temp.manifest(3), pg_temp.snapshot(3), pg_temp.job(5))$$,
  $$values ('already_running'::text, pg_temp.f(83))$$, 'the lost answer replayed after that end is the recorded refusal');
select is((select count(*)::integer from public.takeoff_jobs where project_id = pg_temp.f(23)), 1, 'and no paid job is created');
select results_eq($$select outcome from public.replay_manual_takeoff_request(pg_temp.f(10), pg_temp.f(23), pg_temp.f(1), pg_temp.f(96),
  'reread_plans', pg_temp.f(83))$$, $$values ('already_running'::text)$$, 'the replay is answered before any other check');

-- 5. The server's confirmation: one transaction for the brief's compare-and-set, its event, the reservation and the
-- mandate, which is payable only with the payer notice that was shown for it.
select is(public.takeoff_payer_notice(pg_temp.f(10), pg_temp.f(25), pg_temp.f(3), pg_temp.selection()), null,
  'a reader is shown no payer notice');
select isnt(public.takeoff_payer_notice(pg_temp.f(10), pg_temp.f(25), pg_temp.f(1), pg_temp.selection()), null,
  'the owning engineer is shown one');
select results_eq($$select outcome, state, reason_code, payer_id from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(25),
  pg_temp.f(1), pg_temp.brief_at(25), public.takeoff_payer_notice(pg_temp.f(10), pg_temp.f(25), pg_temp.f(1), pg_temp.selection()),
  pg_temp.host(), pg_temp.selection(), null)$$,
  $$values ('confirmed'::text, 'evaluating'::text, null::text, pg_temp.f(1))$$, 'a notified confirmation mandates its member');
select results_eq($$select b.status, b.confirmed_by, (select count(*)::integer from public.affaire_intake_events e
  where e.project_id = b.project_id and e.event_type = 'brief.confirmed' and e.actor_user_id = pg_temp.f(1))
  from public.affaire_briefs b where b.project_id = pg_temp.f(25)$$, $$values ('confirme'::text, pg_temp.f(1), 1)$$,
  'the brief and its event are written in the same commit');
select results_eq($$select outcome, state, reason_code, payer_id from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(26),
  pg_temp.f(1), pg_temp.brief_at(26), null, pg_temp.host(), pg_temp.selection(), null)$$,
  $$values ('confirmed'::text, 'blocked'::text, 'MANDATE_REQUIRED'::text, null::uuid)$$,
  'a confirmation that carries no notice confirms the brief and engages nobody');
select results_eq($$select outcome, state, reason_code, payer_id from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(27),
  pg_temp.f(1), pg_temp.brief_at(27), public.takeoff_payer_notice(pg_temp.f(10), pg_temp.f(27), pg_temp.f(1), pg_temp.selection('autorisation-0')),
  pg_temp.host(), pg_temp.selection(), null)$$,
  $$values ('confirmed'::text, 'blocked'::text, 'MANDATE_REQUIRED'::text, null::uuid)$$,
  'a notice shown for another subscription or settings engages nobody either');
select results_eq($$select outcome from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(28), pg_temp.f(1),
  '2001-01-01T00:00:00Z', null, null, null, 'CHATGPT_NOT_CONNECTED')$$, $$values ('conflict'::text)$$,
  'a form older than the brief is refused, and nothing is written');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(28)), 0, 'no request is reserved');

-- 6. A replay of a confirmation returns the request as it is; a gesture names the revision of the mandate it saw and
-- the action it was offered, and is refused when either moved.
select results_eq($$select payer_id, mandate_revision from public.take_on_takeoff_launch_request(pg_temp.f(10), pg_temp.f(26),
  pg_temp.f(5), pg_temp.request(26), 0, 'take_on', pg_temp.host(), pg_temp.selection(), null)$$,
  $$values (pg_temp.f(5), 1)$$, 'an administrator takes the unmandated request on');
select results_eq($$select outcome, payer_id from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(26), pg_temp.f(1),
  pg_temp.brief_at(26), public.takeoff_payer_notice(pg_temp.f(10), pg_temp.f(26), pg_temp.f(1), pg_temp.selection()),
  pg_temp.host(), pg_temp.selection(), null)$$, $$values ('replayed'::text, pg_temp.f(5))$$,
  'the confirmer''s late replay leaves the newer mandate and its payer');
select results_eq($$select outcome, payer_id from public.take_on_takeoff_launch_request(pg_temp.f(10), pg_temp.f(26), pg_temp.f(1),
  pg_temp.request(26), 0, 'take_on', pg_temp.host(), pg_temp.selection(), null)$$, $$values ('moved'::text, pg_temp.f(5))$$,
  'a take-over from a view of the previous mandate is refused');
select results_eq($$select outcome, payer_id from public.take_on_takeoff_launch_request(pg_temp.f(10), pg_temp.f(26), pg_temp.f(1),
  pg_temp.request(26), 1, 'take_on', pg_temp.host(), pg_temp.selection(), null)$$, $$values ('moved'::text, pg_temp.f(5))$$,
  'a take-over the request does not offer (it waits for its Mac) is refused');
select results_eq($$select outcome, mandate_revision from public.take_on_takeoff_launch_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1),
  pg_temp.request(21), 0, 'take_on', pg_temp.host(), pg_temp.selection(), null)$$, $$values ('mandated'::text, 1)$$,
  'the confirmer of a request reserved outside the server engages it by an explicit gesture');

-- A gesture from a view of an earlier mandate is refused even when the action it saw is still offered: an operator took
-- the request on from a Mac without the subscription connected (it waits for that operator's gesture again).
select results_eq($$select outcome, reason_code from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(29), pg_temp.f(1),
  pg_temp.brief_at(29), null, pg_temp.host(), pg_temp.selection(), null)$$, $$values ('confirmed'::text, 'MANDATE_REQUIRED'::text)$$,
  'a sixth affaire is confirmed without the notice');
select results_eq($$select outcome, state, reason_code, mandate_revision from public.take_on_takeoff_launch_request(pg_temp.f(10),
  pg_temp.f(29), pg_temp.f(5), pg_temp.request(29), 0, 'take_on', null, null, 'CHATGPT_NOT_CONNECTED')$$,
  $$values ('mandated'::text, 'blocked'::text, 'CHATGPT_NOT_CONNECTED'::text, 1)$$,
  'an administrator takes it on from a Mac whose subscription is not connected');
select results_eq($$select outcome, payer_id from public.take_on_takeoff_launch_request(pg_temp.f(10), pg_temp.f(29), pg_temp.f(1),
  pg_temp.request(29), 0, 'take_on', pg_temp.host(), pg_temp.selection(), null)$$, $$values ('moved'::text, pg_temp.f(5))$$,
  'the owner''s take-over from the view before that mandate is refused, though a take-over is still offered');

select * from finish();
rollback;
