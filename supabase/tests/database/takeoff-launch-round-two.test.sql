-- Lot 2, M4 (20261121111238_takeoff_launch_requests.sql), its second review round: one rule for who may confirm and
-- pay, checked on the rows the confirmation locks; a brief without its own upload is confirmed; the identical
-- submission of a confirmation whose answer was lost finds its request; the takeoff module and the activation decided in
-- SQL; usage counted only from the worker's own records, both budget stops closing the request so; command receipts kept
-- apart from requests; a set-aside start is a terminal state; a write that changes nothing marks nothing. All fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d4c00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d4c00000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null,
    'hostId', pg_temp.host(), 'authorizationId', 'autorisation-1')
$$;

-- Engineer 1 owns the affaires; engineer 2 does not; 3 is a director; 5 an administrator. Tenant 10 has the takeoff
-- module on; tenant 11 (engineer 6's) has it off.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'launch-round-two-' || n || '@example.test', '{}'::jsonb, now() from unnest(array[1, 2, 3, 5, 6]) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd4c00000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Deuxième relecture (fictif)', 'launch-round-two-test'),
  (pg_temp.f(11), 'Métré désactivé (fictif)', 'launch-round-two-off-test');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'), (pg_temp.f(10), pg_temp.f(2), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(3), 'director', true, '2020-01-01'), (pg_temp.f(10), pg_temp.f(5), 'admin', true, '2020-01-01'),
  (pg_temp.f(11), pg_temp.f(6), 'engineer', true, '2020-01-01');
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(20 + n), case when n = 9 then pg_temp.f(11) else pg_temp.f(10) end, case when n = 9 then pg_temp.f(6) else pg_temp.f(1) end,
  'Affaire ' || n || ' (fictive)' from generate_series(0, 9) as n;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select pg_temp.f(30 + n), pg_temp.f(20 + n), case when n = 9 then pg_temp.f(6) else pg_temp.f(1) end, 'ready' from generate_series(0, 9) as n;
-- Affaire 1's brief lost its upload; affaire 2's points to affaire 3's upload.
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object)
select pg_temp.f(40 + n), pg_temp.f(20 + n), case n when 1 then null when 2 then pg_temp.f(33) else pg_temp.f(30 + n) end,
  'a_confirmer', 'Résumé fictif', 'Objet fictif' from generate_series(0, 9) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select pg_temp.f(50 + n), case when n = 9 then pg_temp.f(11) else pg_temp.f(10) end, pg_temp.f(20 + n), 'Plans ' || n from generate_series(0, 9) as n;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(60 + n), case when n = 9 then pg_temp.f(11) else pg_temp.f(10) end, pg_temp.f(50 + n), 'plan-' || n || '.pdf',
  concat_ws('/', case when n = 9 then pg_temp.f(11) else pg_temp.f(10) end, pg_temp.f(50 + n), pg_temp.f(60 + n), 'plan-' || n || '.pdf'),
  'application/pdf', 8, 1
from generate_series(0, 9) as n;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');

create function pg_temp.brief_at(project integer) returns timestamptz language sql as $$
  select updated_at from public.affaire_briefs where project_id = pg_temp.f(project)
$$;
create function pg_temp.request(project integer) returns uuid language sql as $$
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(project) and origin = 'automatic'
$$;
create function pg_temp.notice(project integer, member integer, tenant integer default 10) returns text language sql as $$
  select public.takeoff_payer_notice(pg_temp.f(tenant), pg_temp.f(project), pg_temp.f(member), pg_temp.selection(), false)
$$;
create function pg_temp.confirm(project integer, member integer, tenant integer default 10)
returns table (outcome text, request_id uuid, state text, reason_code text, payer_id uuid) language sql as $$
  select c.outcome, c.request_id, c.state, c.reason_code, c.payer_id from public.confirm_affaire_brief_takeoff(pg_temp.f(tenant),
    pg_temp.f(project), pg_temp.f(member), pg_temp.brief_at(project), pg_temp.notice(project, member, tenant), pg_temp.host(),
    pg_temp.selection(), null, false) c
$$;

-- What the server seals for affaire n's plan (its manifest, the snapshot of member 1, the job).
create function pg_temp.seal(n integer, revision integer default 1) returns table (manifest jsonb, snapshot jsonb, job jsonb) language sql as $$
  select jsonb_build_object('format_version', 1, 'intent', 'initial', 'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
      'units', jsonb_build_array(jsonb_build_object('key', 'grouped', 'plans', jsonb_build_array(f.id))),
      'plans', jsonb_build_array(jsonb_build_object('entry_key', f.id, 'plan_file_id', f.id, 'pages', '[]'::jsonb)),
      'budget', jsonb_build_object('tokens', 1000, 'cost_cents', 10)),
    jsonb_build_object('schema_version', 1, 'preparation_revision', revision, 'confirmed_by', pg_temp.f(1), 'confirmed_at', '2026-11-21T08:00:00Z',
      'execution_selection', pg_temp.selection(),
      'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
      'preparation', jsonb_build_object('schema_version', 1, 'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
        'processing', '{"level":"C","provider":"chatgpt"}'::jsonb, 'sources', jsonb_build_array(jsonb_build_object('document_id', f.id,
          'kind', 'plan', 'active', true, 'confirmed', true, 'plan_set_id', f.plan_set_id, 'file_path', f.file_path,
          'page_count', f.page_count, 'source_updated_at', f.updated_at)))),
    jsonb_build_object('id', pg_temp.f(80 + n), 'plan_set_id', f.plan_set_id, 'source_file_name', f.file_name, 'source_file_type', 'application/pdf',
      'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host())
  from public.plan_files f where f.id = pg_temp.f(60 + n)
$$;

-- 1. One rule for who confirms and who pays, on the locked rows: an engineer who neither owns the affaire nor
-- administers it may not confirm it through the server (as the released brief policy refuses it); an archived affaire
-- is confirmed by its owner, who pays nothing.
select throws_ok($$select * from pg_temp.confirm(20, 2)$$, '42501', 'TAKEOFF_BRIEF_CONFIRMATION_FORBIDDEN',
  'an engineer who does not own the affaire cannot confirm it through the server');
update public.estimate_projects set is_archived = true where id = pg_temp.f(24);
select results_eq($$select outcome, state, payer_id from pg_temp.confirm(24, 1)$$,
  $$values ('confirmed'::text, 'blocked'::text, null::uuid)$$, 'the owner of an archived affaire confirms it and engages nobody');
select is(public.takeoff_payer_may_launch(pg_temp.f(10), pg_temp.f(24), pg_temp.f(1)), false,
  'the one payer rule refuses an archived affaire');
select is(public.takeoff_payer_may_launch(pg_temp.f(10), pg_temp.f(20), pg_temp.f(5)), true, 'and accepts an administrator');
-- The payer notice names both cut-offs: replacing the notices' cut-off alone invalidates an old notice.
create temp table old_notice as select pg_temp.notice(25, 1) as digest;
delete from private.takeoff_completion_activation;
insert into private.takeoff_completion_activation (active_from) values (now() - interval '30 seconds');
select isnt(pg_temp.notice(25, 1), (select digest from old_notice), 'a new notices cut-off makes another notice');
select results_eq($$select c.outcome, c.state, c.reason_code from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(25),
  pg_temp.f(1), pg_temp.brief_at(25), (select digest from old_notice), pg_temp.host(), pg_temp.selection(), null, false) c$$,
  $$values ('confirmed'::text, 'blocked'::text, 'MANDATE_REQUIRED'::text)$$, 'and the old notice engages nobody');

-- 2. A brief without an upload, or whose upload belongs to another affaire, is confirmed; its event is the brief's
-- own affaire's, never another one's.
select results_eq($$select outcome from pg_temp.confirm(21, 1)$$, $$values ('confirmed'::text)$$, 'a brief without an upload is confirmed');
select results_eq($$select outcome from pg_temp.confirm(22, 1)$$, $$values ('confirmed'::text)$$,
  'a brief pointing to another affaire''s upload is confirmed');
select is((select count(*)::integer from public.affaire_intake_events where project_id = pg_temp.f(23) and event_type = 'brief.confirmed'), 0,
  'no event is written into the other affaire');

-- 3. The identical submission of a confirmation whose answer was lost finds the request it reserved; a stale form is
-- still refused.
create temp table first_answer as select * from pg_temp.confirm(26, 1);
-- Its commit gave the brief a later revision than the one the form carried (this file runs in one transaction).
set local session_replication_role = replica;
update public.affaire_briefs set updated_at = clock_timestamp() where project_id = pg_temp.f(26);
set local session_replication_role = origin;
select results_eq($$select c.outcome, c.request_id from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(26), pg_temp.f(1),
  (select (e.before_payload ->> 'updated_at')::timestamptz from public.affaire_intake_events e
    where e.project_id = pg_temp.f(26) and e.event_type = 'brief.confirmed'), pg_temp.notice(26, 1), pg_temp.host(), pg_temp.selection(),
  null, false) c$$, $$select 'replayed'::text, request_id from first_answer$$,
  'the same submission, replayed with the revision it was sent with, gets the request it reserved');
select results_eq($$select c.outcome from public.confirm_affaire_brief_takeoff(pg_temp.f(10), pg_temp.f(26), pg_temp.f(5),
  (select (e.before_payload ->> 'updated_at')::timestamptz from public.affaire_intake_events e
    where e.project_id = pg_temp.f(26) and e.event_type = 'brief.confirmed'), null, pg_temp.host(), pg_temp.selection(), null, false) c$$,
  $$values ('conflict'::text)$$, 'another member''s form of that revision is stale');

-- 4. The takeoff module, decided in SQL with the server's default: off, the confirmation reserves nothing.
select results_eq($$select outcome, request_id from pg_temp.confirm(29, 6, 11)$$, $$values ('confirmed'::text, null::uuid)$$,
  'with the module off a confirmation reserves no request');
select results_eq($$select c.outcome, c.state from public.confirm_affaire_brief_takeoff(pg_temp.f(11), pg_temp.f(29), pg_temp.f(6),
  pg_temp.brief_at(29), null, pg_temp.host(), pg_temp.selection(), null, true) c$$, $$values ('replayed'::text, null::text)$$,
  'a replay with the module on by default still finds no request: the brief was confirmed while it was off');
select is(public.takeoff_launch_is_active(), true, 'the activation is one boolean the server reads');
select throws_ok($$select * from public.launch_manual_takeoff_request(pg_temp.f(11), pg_temp.f(29), pg_temp.f(6), gen_random_uuid(),
  'initial', null, pg_temp.host(), pg_temp.selection(), '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, pg_temp.f(59), 1, false)$$,
  '55000', 'TAKEOFF_LAUNCH_MODULE_DISABLED', 'with the module off a relaunch is refused');
-- The module turned off while the Mac reads the dossier: nothing more is claimed, and the admission refuses.
create temp table module_claim as select * from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(98), 20)
  where request_id = pg_temp.request(26);
select is((select count(*)::integer from module_claim), 1, 'the Mac claims the mandated request of the sixth affaire');
update public.feature_flags set enabled = false where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
select is((select count(*)::integer from public.claim_takeoff_launch_evaluations(pg_temp.host(), gen_random_uuid(), 20)), 0,
  'with the module off a Mac claims nothing');
select results_eq($$select a.outcome, a.reason_code from pg_temp.seal(6) s cross join lateral public.admit_takeoff_launch_request(
  pg_temp.request(26), pg_temp.f(98), (select mark from module_claim), s.manifest, s.snapshot, s.job) a$$,
  $$values ('blocked'::text, 'TAKEOFF_DISABLED'::text)$$, 'and the admission refuses, visibly');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';

-- 5. A set-aside start is terminal, and the receipts of commands are apart from the requests.
select results_eq($$select state, reason_code from pg_temp.confirm(27, 3)$$, $$values ('blocked'::text, 'OPERATOR_REQUIRED'::text)$$,
  'a reader''s confirmation reserves a request for an operator');
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by)
values (pg_temp.f(77), pg_temp.f(10), pg_temp.f(27), pg_temp.f(57), 'C', 'completed', pg_temp.f(1));
set local session_replication_role = origin;
create function pg_temp.relaunch(key integer, revision integer, intent text default 'reread_plans', predecessor uuid default pg_temp.f(77))
returns table (outcome text, request_id uuid, job_id uuid) language sql as $$
  select r.outcome, r.request_id, r.job_id from pg_temp.seal(7, revision) s cross join lateral public.launch_manual_takeoff_request(
    pg_temp.f(10), pg_temp.f(27), pg_temp.f(1), pg_temp.f(key), intent, predecessor, pg_temp.host(), pg_temp.selection(),
    s.manifest, s.snapshot, s.job, pg_temp.f(57), revision, false) r
$$;
select results_eq($$select outcome from pg_temp.relaunch(90, 3)$$, $$values ('admitted'::text)$$, 'a relaunch runs');
select results_eq($$select state, reason_code from public.takeoff_launch_requests where id = pg_temp.request(27)$$,
  $$values ('superseded'::text, null::text)$$, 'the automatic start it set aside is in its terminal state');
select throws_ok($$update public.takeoff_launch_requests set state = 'evaluating' where id = pg_temp.request(27)$$, '23514', null,
  'a set-aside start never becomes due again');
select results_eq($$select command_digest is not null, request_id is not null, job_id from private.takeoff_launch_commands where intent_key = pg_temp.f(90)$$,
  $$values (true, true, pg_temp.f(87))$$, 'the command''s receipt names its request and job');
select throws_ok($$select * from pg_temp.relaunch(90, 4)$$, '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT',
  'the same key for another preparation revision is another command: a conflict');
select results_eq($$select outcome, job_id from pg_temp.relaunch(90, 3)$$, $$values ('replayed'::text, pg_temp.f(87))$$,
  'the genuine replay of revision 3 still gets its receipt');
select results_eq($$select outcome, job_id from pg_temp.relaunch(91, 3)$$, $$values ('already_running'::text, pg_temp.f(87))$$,
  'a relaunch while it runs is refused with the analysis it observed');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(27) and origin = 'manual'), 1,
  'a refused command creates no request');
select results_eq($$select answer, request_id is not null, job_id from private.takeoff_launch_commands where intent_key = pg_temp.f(91)$$,
  $$values ('already_running'::text, true, pg_temp.f(87))$$, 'its receipt records what it observed');
select lives_ok($$select * from pg_temp.relaunch(92, 3, 'initial', null)$$, 'an initial command needs no predecessor');
select throws_ok($$select * from pg_temp.relaunch(93, 3, 'reread_plans', null)$$, '22023', 'TAKEOFF_LAUNCH_PREDECESSOR_REQUIRED',
  'any other intent names the analysis it replaces');

-- 6. Usage counts only from the worker's own records: a metric an operator writes changes nothing; a call recorded under
-- the job's lease counts once; both budget stops close the request with the same reason.
select is((select count(*)::integer from public.claim_observed_local_takeoff_job(pg_temp.f(87), pg_temp.f(10), pg_temp.host(),
  now(), pg_temp.f(95), now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)), 1, 'the Mac claims the relaunch''s job');
insert into public.takeoff_run_metrics (tenant_id, job_id, level, provider, model, chunk_index, chunk_start_page, chunk_end_page,
  input_tokens, reasoning_tokens, output_tokens, total_tokens, cost_cents, duration_ms, timed_out, budget_exceeded, metadata)
values (pg_temp.f(10), pg_temp.f(87), 'C', 'chatgpt', 'fixture', 0, 1, 1, 5000, 0, 0, 5000, 0, 1, false, false, '{}'::jsonb);
select is((select tokens_observed from public.takeoff_launch_requests r join public.takeoff_jobs j on j.launch_request_id = r.id
  where j.id = pg_temp.f(87)), 0::bigint, 'a metric written outside the worker counts nothing');
select throws_ok($$select * from public.record_takeoff_launch_usage(pg_temp.f(87), pg_temp.f(96), 'C:0', 300, 0)$$, '42501',
  'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED', 'a call recorded without the job''s lease is refused');
select results_eq($$select remaining_tokens from public.record_takeoff_launch_usage(pg_temp.f(87), pg_temp.f(95), 'C:0', 300, 0)$$,
  $$values (700::bigint)$$, 'a call recorded under the lease counts, and returns what is left');
select results_eq($$select remaining_tokens from public.record_takeoff_launch_usage(pg_temp.f(87), pg_temp.f(95), 'C:0', 300, 0)$$,
  $$values (700::bigint)$$, 'the same call recorded again counts once');
select isnt(public.record_local_takeoff_failure(pg_temp.f(87), pg_temp.f(10), pg_temp.f(95),
  jsonb_build_object('completed_at', now(), 'duration_ms', 5, 'error_code', 'TAKEOFF_LEVEL_C_BUDGET_EXCEEDED',
    'error_message', 'Budget fictif dépassé.', 'analysis_outcome', 'failure', 'last_error_at', now(), 'next_retry_at', null)), null,
  'the job ends on its reading''s budget');
select results_eq($$select r.state, r.reason_code from public.takeoff_launch_requests r join public.takeoff_jobs j on j.launch_request_id = r.id
  where j.id = pg_temp.f(87)$$, $$values ('closed'::text, 'BUDGET_EXHAUSTED'::text)$$, 'its request closes with the budget''s reason');

-- 7. A write of the dossier that changes nothing marks nothing, and one transaction marks an affaire once.
create temp table marks_before as select count(*) as n from private.takeoff_launch_marks where project_id = pg_temp.f(28);
update public.affaire_briefs set status = status where project_id = pg_temp.f(28);
select is((select count(*) from private.takeoff_launch_marks where project_id = pg_temp.f(28)), (select n from marks_before),
  'an update that changes nothing marks nothing');
update public.plan_files set page_count = 2 where id = pg_temp.f(68);
update public.plan_files set page_count = 3 where id = pg_temp.f(68);
select is((select count(*) from private.takeoff_launch_marks where project_id = pg_temp.f(28)), (select n + 1 from marks_before),
  'two changes in one transaction mark the affaire once');

select * from finish();
rollback;
