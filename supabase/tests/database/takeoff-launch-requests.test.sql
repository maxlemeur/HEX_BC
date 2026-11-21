-- Lot 2, M4 (20261121083011_takeoff_launch_requests.sql): the launch requests of a takeoff. Nothing is written before
-- the owner's activation; one automatic start per affaire, paid by the member who confirmed the brief when they may
-- launch, otherwise waiting for an operator's explicit gesture; an admission seals the request and inserts its job with
-- both creation records in one commit; the recorded end of its job closes it with one notice. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d4700000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d4700000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host())
$$;

-- Engineer 1 owns the affaires; engineer 2 does not; 3 is a director (a reader); 4 an administrator of another tenant.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'launch-request-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 4) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd4700000-%';
insert into public.tenants (id, name, slug) values
  (pg_temp.f(10), 'Demandes de métré (fictif)', 'launch-requests-test'),
  (pg_temp.f(11), 'Autre entreprise (fictive)', 'launch-requests-other-test');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(2), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(3), 'director', true, '2020-01-01'),
  (pg_temp.f(11), pg_temp.f(4), 'admin', true, '2020-01-01');
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  (pg_temp.f(20), pg_temp.f(10), pg_temp.f(1), 'Affaire du dossier confirmé (fictive)'),
  (pg_temp.f(21), pg_temp.f(10), pg_temp.f(1), 'Affaire confirmée par un lecteur (fictive)'),
  (pg_temp.f(22), pg_temp.f(10), pg_temp.f(1), 'Affaire confirmée avant activation (fictive)');
insert into public.affaire_intake_uploads (id, project_id, created_by, status) values
  (pg_temp.f(30), pg_temp.f(20), pg_temp.f(1), 'ready'),
  (pg_temp.f(31), pg_temp.f(21), pg_temp.f(1), 'ready'),
  (pg_temp.f(32), pg_temp.f(22), pg_temp.f(1), 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by) values
  (pg_temp.f(35), pg_temp.f(20), pg_temp.f(30), 'a_confirmer', 'Résumé fictif', 'Objet fictif', null, null),
  (pg_temp.f(36), pg_temp.f(21), pg_temp.f(31), 'a_confirmer', 'Résumé fictif', 'Objet fictif', null, null),
  (pg_temp.f(37), pg_temp.f(22), pg_temp.f(32), 'confirme', 'Résumé fictif', 'Objet fictif', now() - interval '1 day', pg_temp.f(1));
insert into public.plan_sets (id, tenant_id, project_id, name) values
  (pg_temp.f(40), pg_temp.f(10), pg_temp.f(20), 'Plans du dossier'),
  (pg_temp.f(41), pg_temp.f(10), pg_temp.f(21), 'Plans du dossier du lecteur');

-- 1. Before activation: no write touches another table, no mandate, no claim, no command.
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count) values
  (pg_temp.f(50), pg_temp.f(10), pg_temp.f(40), 'plan-rdc.pdf',
    concat_ws('/', pg_temp.f(10), pg_temp.f(40), pg_temp.f(50), 'plan-rdc.pdf'), 'application/pdf', 8, 1),
  (pg_temp.f(51), pg_temp.f(10), pg_temp.f(41), 'plan-etage.pdf',
    concat_ws('/', pg_temp.f(10), pg_temp.f(41), pg_temp.f(51), 'plan-etage.pdf'), 'application/pdf', 8, 1);
update public.affaire_briefs set status = 'confirme', confirmed_at = now(), confirmed_by = pg_temp.f(1) where id = pg_temp.f(35);
select is((select count(*)::integer from private.takeoff_launch_marks), 0, 'before activation a dossier write records nothing');
select is((select count(*)::integer from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
  'confirmation', pg_temp.host(), pg_temp.selection())), 0, 'before activation a confirmation reserves no request');
select is((select count(*)::integer from public.takeoff_launch_requests), 0, 'no request exists');
select is((select count(*)::integer from public.claim_takeoff_launch_evaluations(pg_temp.host(), gen_random_uuid())), 0,
  'before activation a Mac claims nothing');
select throws_ok($$select * from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1), gen_random_uuid(),
  'reread_plans', null, pg_temp.host(), pg_temp.selection(), '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)$$,
  '55000', 'TAKEOFF_LAUNCH_INACTIVE', 'before activation a command is refused');

-- 2. The owner activates the automatic start and the notices.
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');
update public.affaire_briefs set status = 'a_confirmer', confirmed_at = null, confirmed_by = null where id = pg_temp.f(35);
update public.affaire_briefs set status = 'confirme', confirmed_at = clock_timestamp(), confirmed_by = pg_temp.f(1) where id = pg_temp.f(35);
select ok((select count(*) from private.takeoff_launch_marks where project_id = pg_temp.f(20) and cause = 'brief') >= 2,
  'after activation each change of the brief records the need of an evaluation');

-- The member who did not win the brief's confirmation never pays.
select is((select count(*)::integer from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(20), pg_temp.f(2),
  'confirmation', pg_temp.host(), pg_temp.selection())), 0, 'a member who is not the recorded confirmer reserves nothing');
select results_eq($$select state, reason_code, payer_id from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(1), 'confirmation', pg_temp.host(), pg_temp.selection())$$,
  $$values ('evaluating'::text, null::text, pg_temp.f(1))$$, 'the confirmer who may launch pays, on the Mac of the gesture');
select results_eq($$select origin, intent, confirmed_by, requested_by, mandate_kind, execution_host_id, mandate_selection = execution_selection
  from public.takeoff_launch_requests where project_id = pg_temp.f(20)$$,
  $$values ('automatic'::text, 'initial'::text, pg_temp.f(1), pg_temp.f(1), 'confirmation'::text, pg_temp.host(), true)$$,
  'one automatic request records its confirmer, its payer, its Mac and the selection of the mandate');
select is((select count(*)::integer from public.audit_logs where action = 'takeoff.request.mandated'
  and record_id = (select id from public.takeoff_launch_requests where project_id = pg_temp.f(20))), 1, 'the mandate leaves a trace');
select lives_ok($$select * from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
  'confirmation', pg_temp.host(), pg_temp.selection())$$, 'a replay of the gesture is accepted');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(20)), 1,
  'the replay keeps one automatic request');
select throws_ok($$insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state)
  select x, pg_temp.f(10), pg_temp.f(20), 'automatic', 'initial', x, 'evaluating' from gen_random_uuid() x$$,
  '23505', null, 'a second automatic request of the affaire is refused by the database');

-- A dossier confirmed before activation is not armed.
select is((select count(*)::integer from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(22), pg_temp.f(1),
  'confirmation', pg_temp.host(), pg_temp.selection())), 0, 'a confirmation older than the activation reserves nothing');

-- A director confirms: the brief is confirmed, nobody pays until an operator takes it on.
update public.affaire_briefs set status = 'confirme', confirmed_at = clock_timestamp(), confirmed_by = pg_temp.f(3) where id = pg_temp.f(36);
select results_eq($$select state, reason_code, payer_id from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(21),
  pg_temp.f(3), 'confirmation', null, null, 'LOCAL_RUNTIME_REQUIRED')$$,
  $$values ('blocked'::text, 'OPERATOR_REQUIRED'::text, null::uuid)$$, 'a reader who confirms does not pay');
select throws_ok($$select * from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(21), pg_temp.f(3), 'take_over',
  pg_temp.host(), pg_temp.selection())$$, '42501', 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE', 'a reader cannot take it on');
select throws_ok($$select * from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(21), pg_temp.f(2), 'take_over',
  pg_temp.host(), pg_temp.selection())$$, '42501', 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE',
  'an engineer who does not own the affaire cannot take it on');
select results_eq($$select state, payer_id from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1),
  'take_over', pg_temp.host(), pg_temp.selection())$$, $$values ('evaluating'::text, pg_temp.f(1))$$,
  'the owner takes it on with their own subscription by an explicit gesture');
select is((select requested_by from public.takeoff_launch_requests where project_id = pg_temp.f(21)), pg_temp.f(1),
  'who took it on receives its end');

-- 3. RLS: readers of the affaire see the state, never the host, the selection or the manifest; nobody writes directly.
create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.f(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(n))::text, true);
$$;
select pg_temp.sign_in(3);
set local role authenticated;
select is((select state from public.takeoff_launch_requests where project_id = pg_temp.f(20)), 'evaluating',
  'a director who reads the affaire sees the state of its request');
select throws_ok($$select execution_host_id from public.takeoff_launch_requests$$, '42501', null,
  'the Mac of a mandate is never readable');
select throws_ok($$select mandate_selection, manifest from public.takeoff_launch_requests$$, '42501', null,
  'nor its selection or manifest');
select throws_ok($$update public.takeoff_launch_requests set payer_id = auth.uid()$$, '42501', null,
  'a member cannot designate a payer');
select throws_ok($$insert into public.takeoff_launch_requests (tenant_id, project_id, origin, intent, intent_key, command_digest, state)
  values (pg_temp.f(10), pg_temp.f(20), 'manual', 'reread_plans', gen_random_uuid(), repeat('a', 64), 'evaluating')$$,
  '42501', null, 'nor insert a request');
select throws_ok($$select * from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(20), auth.uid(), 'take_over',
  pg_temp.host(), pg_temp.selection())$$, '42501', null, 'nor call the server''s mandate');
reset role;
select pg_temp.sign_in(4);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_launch_requests), 0, 'another tenant sees no request');
reset role;
set local role service_role;
select throws_ok($$update public.takeoff_launch_requests set payer_id = null, mandate_kind = null, mandated_at = null$$,
  '42501', 'TAKEOFF_LAUNCH_WRITER_REQUIRED', 'the service role writes a request only through the server''s functions');
select throws_ok($$delete from public.takeoff_launch_requests$$, '42501', 'TAKEOFF_LAUNCH_WRITER_REQUIRED',
  'nor deletes one');
reset role;

-- 4. The Mac of the mandate claims and evaluates; a stale position aborts the admission.
create temp table claimed as select * from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(90));
select is((select count(*)::integer from claimed), 2, 'the Mac claims the two requests that wait for their evaluation');
select is((select count(*)::integer from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(91))), 0,
  'a second process of the Mac claims nothing while the lease holds');
select is((select count(*)::integer from public.claim_takeoff_launch_evaluations('urn:uuid:d4700000-0000-4000-8000-000000000098', pg_temp.f(91))), 0,
  'another Mac never claims a mandate it did not prepare');
select is(public.record_takeoff_launch_evaluation((select request_id from claimed where project_id = pg_temp.f(21)), pg_temp.f(90),
  (select mark from claimed where project_id = pg_temp.f(21)), 'evaluating'), 'evaluating',
  'an evaluation with nothing to decide gives its lease back');

create function pg_temp.snapshot(plan_set integer default 40) returns jsonb language sql as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-21T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', id, 'kind', 'plan', 'active', true, 'confirmed', true,
        'plan_set_id', plan_set_id, 'file_path', file_path, 'page_count', page_count, 'source_updated_at', updated_at) order by id)
        from public.plan_files where plan_set_id = pg_temp.f(plan_set))))
$$;
create function pg_temp.manifest(plan integer default 50) returns jsonb language sql as $$
  select jsonb_build_object('format_version', 1, 'intent', 'initial',
    'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
    'units', jsonb_build_array(jsonb_build_object('key', 'grouped', 'plans', jsonb_build_array(pg_temp.f(plan)))),
    'plans', jsonb_build_array(jsonb_build_object('entry_key', pg_temp.f(plan), 'plan_file_id', pg_temp.f(plan), 'pages', '[]'::jsonb)),
    'coverage', jsonb_build_object('plans_retained', 1, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb)
$$;
create function pg_temp.job(n integer, plan_set integer default 40) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', pg_temp.f(n), 'plan_set_id', pg_temp.f(plan_set), 'source_file_name', 'plan-rdc.pdf',
    'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host())
$$;
create function pg_temp.request(project integer) returns uuid language sql as $$
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(project) and origin = 'automatic'
$$;

-- The dossier changes after the evaluation read its position: the admission refuses to spend on what was not evaluated.
update public.plan_files set page_count = 1 where id = pg_temp.f(50);
select results_eq($$select outcome, job_id from public.admit_takeoff_launch_request(pg_temp.request(20), pg_temp.f(90),
  (select mark from claimed where project_id = pg_temp.f(20)), pg_temp.manifest(), pg_temp.snapshot(), pg_temp.job(60))$$,
  $$values ('stale'::text, null::uuid)$$, 'a dossier changed since the evaluation aborts the admission');
select is((select count(*)::integer from public.takeoff_jobs where project_id = pg_temp.f(20)), 0, 'no job was created');
select is((select state from public.takeoff_launch_requests where id = pg_temp.request(20)), 'evaluating', 'the request waits for a new evaluation');

-- A job claiming a request outside its admission is refused, whoever writes it.
select throws_ok($$insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, created_by, execution_provider,
  execution_host_id, preparation_snapshot, launch_request_id, launch_unit_key)
  values (pg_temp.f(69), pg_temp.f(10), pg_temp.f(20), pg_temp.f(40), 'C', pg_temp.f(1), 'chatgpt_local', pg_temp.host(),
    pg_temp.snapshot(), pg_temp.request(20), 'grouped')$$, '42501', 'TAKEOFF_JOB_REQUEST_ADMISSION_REQUIRED',
  'a job cannot attach itself to a request');

-- 5. The admission: the request sealed, its job and both creation records in one commit.
delete from claimed;
insert into claimed select * from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(92));
select results_eq($$select outcome, job_id from public.admit_takeoff_launch_request(pg_temp.request(20), pg_temp.f(92),
  (select mark from claimed where project_id = pg_temp.f(20)), pg_temp.manifest(), pg_temp.snapshot(), pg_temp.job(60))$$,
  $$values ('admitted'::text, pg_temp.f(60))$$, 'the evaluated request is admitted with its job');
select results_eq($$select launch_request_id, launch_unit_key, created_by, estimate_version_id, status::text, preparation_snapshot = pg_temp.snapshot()
  from public.takeoff_jobs where id = pg_temp.f(60)$$,
  $$values (pg_temp.request(20), 'grouped'::text, pg_temp.f(1), null::uuid, 'pending'::text, true)$$,
  'the job is the grouped unit of the request, on the payer''s subscription, with the sealed snapshot');
select results_eq($$select state, manifest_digest = encode(sha256(convert_to(manifest::text, 'UTF8')), 'hex'), units_expected,
  evaluation_lease_token is null from public.takeoff_launch_requests where id = pg_temp.request(20)$$,
  $$values ('admitted'::text, true, 1, true)$$, 'the request holds its manifest and its digest');
select is((select after_data #>> '{metadata,launch_request_id}' from public.audit_logs where action = 'takeoff.job.created'
  and record_id = pg_temp.f(60)), pg_temp.request(20)::text, 'the job''s creation record names its request');
select is((select count(*)::integer from public.audit_logs where action = 'takeoff.request.admitted'
  and record_id = pg_temp.request(20)), 1, 'the request''s admission is recorded');
select results_eq($$select outcome, job_id from public.admit_takeoff_launch_request(pg_temp.request(20), pg_temp.f(92), 0,
  pg_temp.manifest(), pg_temp.snapshot(), pg_temp.job(61))$$, $$values ('replayed'::text, pg_temp.f(60))$$,
  'a replay of the admission returns the same job');
select is((select count(*)::integer from public.takeoff_jobs where launch_request_id = pg_temp.request(20)), 1, 'and creates no other');
select throws_ok($$update public.takeoff_jobs set launch_request_id = null, launch_unit_key = null where id = pg_temp.f(60)$$,
  '42501', 'TAKEOFF_JOB_IDENTITY_IMMUTABLE', 'a job never leaves its request');
select throws_ok($$delete from public.takeoff_jobs where id = pg_temp.f(60)$$, '42501', 'TAKEOFF_JOB_REQUEST_OPEN',
  'the job of a running request is never deleted: its request would wait for ever');

-- A consumed request is never re-armed: the dossier leaves and re-enters « confirmé », a plan is added.
update public.affaire_briefs set status = 'a_confirmer', confirmed_at = null, confirmed_by = null where id = pg_temp.f(35);
update public.affaire_briefs set status = 'confirme', confirmed_at = clock_timestamp(), confirmed_by = pg_temp.f(2) where id = pg_temp.f(35);
select results_eq($$select state, payer_id from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(20), pg_temp.f(2),
  'confirmation', pg_temp.host(), pg_temp.selection())$$, $$values ('admitted'::text, pg_temp.f(1))$$,
  'a later confirmation leaves the admitted request and its payer as they are');
select is((select count(*)::integer from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(93))
  where request_id = pg_temp.request(20)), 0, 'an admitted request is never evaluated again');

-- 6. One admitted request per affaire: a command meanwhile returns the running one.
select results_eq($$select outcome, request_id, job_id from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
  pg_temp.f(70), 'reread_plans', pg_temp.f(60), pg_temp.host(), pg_temp.selection(), pg_temp.manifest(), pg_temp.snapshot(), pg_temp.job(62))$$,
  $$values ('already_running'::text, pg_temp.request(20), pg_temp.f(60))$$, 'a relaunch while the analysis runs returns it');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(20)), 1, 'and creates nothing');

-- 7. The end of its job closes the request and publishes its one notice; the job publishes none of its own.
select is((select count(*)::integer from public.claim_observed_local_takeoff_job(pg_temp.f(60), pg_temp.f(10), pg_temp.host(),
  now(), pg_temp.f(95), now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)), 1, 'the Mac claims the job');
update public.takeoff_jobs set token_count = 1200, cost_cents = 0 where id = pg_temp.f(60);
select isnt(public.finalize_local_takeoff_result(pg_temp.f(60), pg_temp.f(10), pg_temp.f(95), clock_timestamp(), 'fixture', 'fixture',
  '{"extracted_json": {"items": []}, "warnings": [], "tables": [], "provider_meta": {}}', '[]'), null, 'the job succeeds');
select results_eq($$select state, outcome, units_succeeded, tokens_observed from public.takeoff_launch_requests where id = pg_temp.request(20)$$,
  $$values ('closed'::text, 'success'::text, 1, 1200::bigint)$$, 'the request closes as its only unit ended and keeps its consumption');
select ok((select analysis_outcome = 'success' and analysis_finished_at is not null and analysis_completion_event_id is null
  from public.takeoff_jobs where id = pg_temp.f(60)), 'the job records its end and leaves its event to its request');
select is((select count(*)::integer from public.takeoff_completion_notifications where job_id = pg_temp.f(60)), 0,
  'the job publishes no notice of its own');
select results_eq($$select subject_kind, request_id, job_id, recipient_user_id, outcome, plans_read_count, delivery_state
  from public.takeoff_completion_notifications where project_id = pg_temp.f(20)$$,
  $$values ('request'::text, pg_temp.request(20), null::uuid, pg_temp.f(1), 'success'::text, 1, 'pending'::text)$$,
  'one notice of the request, to its payer');
select is((select id from public.takeoff_completion_notifications where request_id = pg_temp.request(20)),
  (select completion_event_id from public.takeoff_launch_requests where id = pg_temp.request(20)), 'its event is the request''s');

-- 8. An explicit relaunch: a new manual request, on the clicker's subscription, with its predecessor; its key survives a
-- double click and refuses other content.
select results_eq($$select outcome, job_id from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
  pg_temp.f(71), 'reread_plans', pg_temp.f(60), pg_temp.host(), pg_temp.selection(), pg_temp.manifest(), pg_temp.snapshot(), pg_temp.job(63))$$,
  $$values ('admitted'::text, pg_temp.f(63))$$, 'a relaunch after the end is a new request and a new job');
select results_eq($$select origin, intent, predecessor_request_id, predecessor_job_id, payer_id, requested_by, mandate_kind
  from public.takeoff_launch_requests where intent_key = pg_temp.f(71)$$,
  $$values ('manual'::text, 'reread_plans'::text, pg_temp.request(20), pg_temp.f(60), pg_temp.f(1), pg_temp.f(1), 'command'::text)$$,
  'it points to what it replaces and is paid by who clicked');
select results_eq($$select outcome, job_id from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
  pg_temp.f(71), 'reread_plans', pg_temp.f(60), pg_temp.host(), pg_temp.selection(), pg_temp.manifest(), pg_temp.snapshot(), pg_temp.job(64))$$,
  $$values ('replayed'::text, pg_temp.f(63))$$, 'a double click returns the same request and job');
select throws_ok($$select * from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
  pg_temp.f(71), 'initial', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(), pg_temp.snapshot(), pg_temp.job(64))$$,
  '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT', 'the same key with other content is a conflict');
select is((select count(*)::integer from public.takeoff_jobs where project_id = pg_temp.f(20)), 2, 'two jobs in all: the first and the relaunch');

-- 9. The admission and its records roll back together: a payer over the admission limit is blocked, visibly.
select results_eq($$select outcome from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
  pg_temp.f(72), 'reread_plans', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(), pg_temp.snapshot(), pg_temp.job(65))$$,
  $$values ('already_running'::text)$$, 'the relaunch still runs');
update public.takeoff_jobs set status = 'canceled' where id = pg_temp.f(63);
select is((select state from public.takeoff_launch_requests where intent_key = pg_temp.f(71)), 'closed', 'a canceled job closes its request');
select is((select delivery_state from public.takeoff_completion_notifications where request_id = (select id from public.takeoff_launch_requests
  where intent_key = pg_temp.f(71))), 'suppressed', 'a cancellation sends no e-mail');
insert into public.takeoff_job_admissions (job_id, tenant_id, created_by)
select gen_random_uuid(), pg_temp.f(10), pg_temp.f(1) from generate_series(1, 10);
-- The fixture gives back the leases the claims above took on the reader's affaire.
update public.takeoff_launch_requests set evaluation_lease_token = null, evaluation_lease_expires_at = null
where evaluation_lease_token is not null;
delete from claimed;
insert into claimed select * from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(94));
select results_eq($$select outcome, reason_code from public.admit_takeoff_launch_request(pg_temp.request(21), pg_temp.f(94),
  (select mark from claimed where project_id = pg_temp.f(21)), pg_temp.manifest(51), pg_temp.snapshot(41), pg_temp.job(66, 41))$$, $$values ('blocked'::text, 'ADMISSION_LIMIT'::text)$$,
  'a payer over the admission limit is blocked with that reason');
select is((select count(*)::integer from public.takeoff_jobs where id = pg_temp.f(66)), 0, 'no job remains');
select is((select count(*)::integer from public.audit_logs where record_id in (pg_temp.f(66), pg_temp.request(21))
  and action in ('takeoff.job.created', 'takeoff.request.admitted')), 0, 'nor any of its creation records');
select results_eq($$select state, reason_code, admitted_at, manifest from public.takeoff_launch_requests where id = pg_temp.request(21)$$,
  $$values ('blocked'::text, 'ADMISSION_LIMIT'::text, null::timestamptz, null::jsonb)$$, 'the request is visibly blocked, unsealed');

-- 10. A payer who lost the right to launch before the admission is blocked.
update public.tenant_memberships set role = 'director' where user_id = pg_temp.f(1) and tenant_id = pg_temp.f(10);
update public.takeoff_launch_requests set evaluated_at = now() - interval '1 hour', evaluation_lease_token = null,
  evaluation_lease_expires_at = null where id = pg_temp.request(21);
delete from claimed;
insert into claimed select * from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(96));
select results_eq($$select outcome, reason_code from public.admit_takeoff_launch_request(pg_temp.request(21), pg_temp.f(96),
  (select mark from claimed where project_id = pg_temp.f(21)), pg_temp.manifest(51), pg_temp.snapshot(41), pg_temp.job(67, 41))$$,
  $$values ('blocked'::text, 'PAYER_NOT_ELIGIBLE'::text)$$, 'a payer demoted before the admission pays nothing');
update public.tenant_memberships set role = 'engineer' where user_id = pg_temp.f(1) and tenant_id = pg_temp.f(10);

-- 11. A job of a request that nobody takes ends as never started (the recovery closes it so), and its request with it.
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
delete from public.takeoff_job_admissions where tenant_id = pg_temp.f(10) and job_id not in (select id from public.takeoff_jobs);
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  (pg_temp.f(23), pg_temp.f(10), pg_temp.f(1), 'Affaire dont le Mac est éteint (fictive)');
insert into public.affaire_intake_uploads (id, project_id, created_by, status) values (pg_temp.f(33), pg_temp.f(23), pg_temp.f(1), 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
values (pg_temp.f(38), pg_temp.f(23), pg_temp.f(33), 'confirme', 'Résumé fictif', 'Objet fictif', clock_timestamp(), pg_temp.f(1));
insert into public.plan_sets (id, tenant_id, project_id, name) values (pg_temp.f(42), pg_temp.f(10), pg_temp.f(23), 'Plans du Mac éteint');
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.f(52), pg_temp.f(10), pg_temp.f(42), 'plan-sous-sol.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(42), pg_temp.f(52), 'plan-sous-sol.pdf'), 'application/pdf', 8, 1);
select is((select state from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(23), pg_temp.f(1), 'confirmation',
  pg_temp.host(), pg_temp.selection())), 'evaluating', 'the confirmer of a third affaire mandates its request');
update public.takeoff_launch_requests set evaluation_lease_token = null, evaluation_lease_expires_at = null where evaluation_lease_token is not null;
-- Three evaluations that stop on an error in a row leave the request blocked, visibly, until a gesture.
create function pg_temp.fail_evaluation(token integer) returns text language sql as $$
  select public.record_takeoff_launch_evaluation_failure(c.request_id, pg_temp.f(token))
  from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(token)) c where c.project_id = pg_temp.f(23)
$$;
select is(pg_temp.fail_evaluation(84), 'evaluating', 'a first failed evaluation gives the lease back');
select is(pg_temp.fail_evaluation(85), 'evaluating', 'a second one too');
select is(pg_temp.fail_evaluation(86), 'blocked', 'the third leaves the request blocked');
select results_eq($$select state, reason_code, evaluation_failures from public.takeoff_launch_requests where id = pg_temp.request(23)$$,
  $$values ('blocked'::text, 'EVALUATION_FAILED'::text, 3)$$, 'with its reason, and nothing retries it on its own');
select is((select count(*)::integer from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(87)) where project_id = pg_temp.f(23)), 0,
  'a request blocked by repeated failures is not claimed again');
select results_eq($$select state, payer_id from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(23), pg_temp.f(1), 'take_over',
  pg_temp.host(), pg_temp.selection())$$, $$values ('evaluating'::text, pg_temp.f(1))$$, 'the payer''s gesture evaluates it again');
delete from claimed;
insert into claimed select * from public.claim_takeoff_launch_evaluations(pg_temp.host(), pg_temp.f(97));
select results_eq($$select outcome, job_id from public.admit_takeoff_launch_request(pg_temp.request(23), pg_temp.f(97),
  (select mark from claimed where project_id = pg_temp.f(23)), pg_temp.manifest(52), pg_temp.snapshot(42), pg_temp.job(68, 42))$$,
  $$values ('admitted'::text, pg_temp.f(68))$$, 'its request is admitted with a pending job');
update public.takeoff_jobs set status = 'failed', error_code = 'TAKEOFF_WORKER_NOT_STARTED', error_message = 'Aucun Mac fictif',
  analysis_outcome = 'failure', completed_at = clock_timestamp(), next_retry_at = null
where id = pg_temp.f(68) and status = 'pending';
select results_eq($$select state, outcome, units_failed from public.takeoff_launch_requests where id = pg_temp.request(23)$$,
  $$values ('closed'::text, 'failure'::text, 1)$$, 'an admitted request whose job never started ends visibly');
select results_eq($$select outcome, plans_read_count, plans_failed_count, plans_not_started_count, recipient_user_id
  from public.takeoff_completion_notifications where request_id = pg_temp.request(23)$$,
  $$values ('failure'::text, 0, 0, 1, pg_temp.f(1))$$, 'its notice counts the plan as not started, for its payer');

-- An explicit relaunch sets aside an automatic start that had not begun: it never spends later on its own.
select results_eq($$select outcome, job_id from public.launch_manual_takeoff_request(pg_temp.f(10), pg_temp.f(21), pg_temp.f(1),
  pg_temp.f(74), 'reread_plans', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(51), pg_temp.snapshot(41), pg_temp.job(69, 41))$$,
  $$values ('admitted'::text, pg_temp.f(69))$$, 'a relaunch on the affaire whose automatic start waits for its payer runs');
select results_eq($$select state, reason_code, reason_details ->> 'request_id' from public.takeoff_launch_requests where id = pg_temp.request(21)$$,
  $$values ('blocked'::text, 'SUPERSEDED'::text, (select id::text from public.takeoff_launch_requests where intent_key = pg_temp.f(74)))$$,
  'the automatic start is set aside by it, and names it');

-- A dossier confirmed after activation whose confirmation recorded no request is reserved by the operator who takes it on.
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  (pg_temp.f(24), pg_temp.f(10), pg_temp.f(1), 'Affaire dont la confirmation n’a rien enregistré (fictive)');
insert into public.affaire_intake_uploads (id, project_id, created_by, status) values (pg_temp.f(34), pg_temp.f(24), pg_temp.f(1), 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
values (pg_temp.f(39), pg_temp.f(24), pg_temp.f(34), 'confirme', 'Résumé fictif', 'Objet fictif', clock_timestamp(), pg_temp.f(3));
select results_eq($$select state, payer_id from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(24), pg_temp.f(1), 'take_over',
  pg_temp.host(), pg_temp.selection())$$, $$values ('evaluating'::text, pg_temp.f(1))$$, 'the take-over reserves the automatic request');
select results_eq($$select origin, confirmed_by, mandate_kind from public.takeoff_launch_requests where project_id = pg_temp.f(24)$$,
  $$values ('automatic'::text, pg_temp.f(3), 'take_over'::text)$$, 'it keeps the confirmer and records the gesture');
select throws_ok($$select * from public.record_takeoff_launch_mandate(pg_temp.f(10), pg_temp.f(22), pg_temp.f(1), 'take_over',
  pg_temp.host(), pg_temp.selection())$$, 'P0002', 'TAKEOFF_LAUNCH_REQUEST_NOT_FOUND',
  'a dossier confirmed before the activation is not armed by a take-over either');

-- 12. Deleting an affaire removes its requests, their jobs and notices, also through the service role.
set local role service_role;
select lives_ok($$delete from public.estimate_projects where id = pg_temp.f(23)$$,
  'the service role deletes an affaire that holds a request');
reset role;
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(23)), 0, 'its request is gone');
select is((select count(*)::integer from public.takeoff_completion_notifications where project_id = pg_temp.f(23)), 0, 'and its notice');

-- 13. Every takeoff action the application writes passes the audit check.
select lives_ok(format($$insert into public.audit_logs (tenant_id, user_id, table_name, record_id, action, after_data)
  values (%L, %L, 'takeoff_jobs', gen_random_uuid(), %L, '{}'::jsonb)$$, pg_temp.f(10), pg_temp.f(1), action),
  format('the audit check accepts %s', action))
from unnest(array['takeoff.job.created', 'takeoff.job.processing', 'takeoff.job.completed', 'takeoff.job.failed',
  'takeoff.job.resubmitted', 'takeoff.job.canceled', 'takeoff.item.excluded', 'takeoff.item.modified',
  'takeoff.dpgf.review_decision', 'takeoff.apply.started', 'takeoff.apply.override', 'takeoff.apply.completed',
  'takeoff.apply.failed', 'takeoff.mapping.applied', 'takeoff.preparation.version_created', 'takeoff.request.mandated',
  'takeoff.request.admitted']) as action;
select throws_ok($$insert into public.audit_logs (tenant_id, user_id, table_name, record_id, action, after_data)
  values (pg_temp.f(10), pg_temp.f(1), 'takeoff_jobs', gen_random_uuid(), 'takeoff.job.invented', '{}'::jsonb)$$,
  '23514', null, 'an action outside the catalogue is still refused');

select * from finish();
rollback;
