-- Lot 2, M4 (20261121170448_takeoff_launch_requests.sql), its closing round: the server's confirmation lets exactly the
-- members the released brief policy lets confirm (their current tenant, the JWT administrator override); the identical
-- retry of a confirmation is found without the intake event; a first analysis names no predecessor; the worker's usage
-- needs a live lease; no cent left stops a call; removing the cut-off stops new admissions only. All fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5c00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5c00000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null,
    'hostId', pg_temp.host(), 'authorizationId', 'autorisation-1')
$$;
-- The verified claims of a member's session, as the server reads them (an administrator by the JWT, or not).
create function pg_temp.claims(member integer, jwt_admin boolean default false) returns jsonb language sql immutable as $$
  select jsonb_build_object('sub', pg_temp.f(member), 'role', 'authenticated', 'aud', 'authenticated',
    'app_metadata', case when jwt_admin then '{"role": "admin"}'::jsonb else '{}'::jsonb end)
$$;

-- Engineer 1 owns the affaires of tenant 10; engineer 2 does not; engineer 4 owns affaire 3 but works in tenant 12 now
-- (its default membership); 5 administers tenant 10.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'launch-closing-round-' || n || '@example.test', '{}'::jsonb, now() from unnest(array[1, 2, 4, 5]) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5c00000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Dernière relecture (fictif)', 'launch-closing-round-test'),
  (pg_temp.f(12), 'Autre entreprise (fictif)', 'launch-closing-round-other-test');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'), (pg_temp.f(10), pg_temp.f(2), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(4), 'engineer', false, '2020-01-01'), (pg_temp.f(12), pg_temp.f(4), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(5), 'admin', true, '2020-01-01');
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(20 + n), pg_temp.f(10), case when n = 3 then pg_temp.f(4) else pg_temp.f(1) end, 'Affaire ' || n || ' (fictive)'
from generate_series(0, 5) as n;
-- Affaire 1 has no upload at all.
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select pg_temp.f(30 + n), pg_temp.f(20 + n), pg_temp.f(1), 'ready' from generate_series(0, 5) as n where n <> 1;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object)
select pg_temp.f(40 + n), pg_temp.f(20 + n), case when n = 1 then null else pg_temp.f(30 + n) end, 'a_confirmer', 'Résumé fictif',
  'Objet fictif' from generate_series(0, 5) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select pg_temp.f(50 + n), pg_temp.f(10), pg_temp.f(20 + n), 'Plans ' || n from generate_series(0, 5) as n;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(60 + n), pg_temp.f(10), pg_temp.f(50 + n), 'plan-' || n || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(50 + n), pg_temp.f(60 + n), 'plan-' || n || '.pdf'), 'application/pdf', 8, 1
from generate_series(0, 5) as n;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');

create function pg_temp.brief_at(project integer) returns timestamptz language sql as $$
  select updated_at from public.affaire_briefs where project_id = pg_temp.f(project)
$$;
create function pg_temp.notice(project integer, member integer) returns text language sql as $$
  select public.takeoff_payer_notice(pg_temp.f(10), pg_temp.f(project), pg_temp.f(member), pg_temp.selection(), false)
$$;
create function pg_temp.confirm(project integer, member integer, claims jsonb, revision timestamptz default null)
returns table (outcome text, request_id uuid, state text, reason_code text, payer_id uuid) language sql as $$
  select c.outcome, c.request_id, c.state, c.reason_code, c.payer_id from public.confirm_affaire_brief_takeoff(pg_temp.f(10),
    pg_temp.f(project), pg_temp.f(member), coalesce(revision, pg_temp.brief_at(project)), pg_temp.notice(project, member),
    pg_temp.host(), pg_temp.selection(), null, false, claims) c
$$;
-- A confirmation committed: the brief's revision moves on (this file runs in one transaction).
create function pg_temp.commit_brief(project integer) returns void language sql as $$
  set local session_replication_role = replica;
  update public.affaire_briefs set updated_at = clock_timestamp() where project_id = pg_temp.f(project);
  set local session_replication_role = origin;
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
create function pg_temp.relaunch(n integer, key integer, intent text, predecessor uuid)
returns table (outcome text, request_id uuid, job_id uuid) language sql as $$
  select r.outcome, r.request_id, r.job_id from pg_temp.seal(n) s cross join lateral public.launch_manual_takeoff_request(
    pg_temp.f(10), pg_temp.f(20 + n), pg_temp.f(1), pg_temp.f(key), intent, predecessor, pg_temp.host(), pg_temp.selection(),
    s.manifest, s.snapshot, s.job, pg_temp.f(50 + n), 1, false) r
$$;
-- A finished analysis of affaires 4 and 5, which a relaunch replaces.
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by)
select pg_temp.f(70 + n), pg_temp.f(10), pg_temp.f(20 + n), pg_temp.f(50 + n), 'C', 'completed', pg_temp.f(1) from unnest(array[4, 5]) as n;
set local session_replication_role = origin;

-- 1. Exactly the members the released brief policy lets confirm (20260306224500_est372_affaire_brief.sql), by its own
-- functions under the member's session: an administrator by the JWT confirms an affaire they do not own; a member
-- confirms only in the tenant they work in now; the claims are the member's own.
select lives_ok($$select * from pg_temp.confirm(20, 2, pg_temp.claims(2, true))$$,
  'an engineer the JWT makes an administrator confirms an affaire they do not own, as the released policy allows');
select results_eq($$select status::text, confirmed_by from public.affaire_briefs where project_id = pg_temp.f(20)$$,
  $$values ('confirme'::text, pg_temp.f(2))$$, 'the brief is confirmed by that engineer');
select results_eq($$select payer_id, reason_code from public.takeoff_launch_requests where project_id = pg_temp.f(20)$$,
  $$values (null::uuid, 'OPERATOR_REQUIRED'::text)$$, 'and pays nothing: the payer rule is the tenant''s');
select throws_ok($$select * from pg_temp.confirm(22, 2, pg_temp.claims(2))$$, '42501', 'TAKEOFF_BRIEF_CONFIRMATION_FORBIDDEN',
  'without the override the engineer still cannot');
select throws_ok($$select * from pg_temp.confirm(23, 4, pg_temp.claims(4))$$, '42501', 'TAKEOFF_BRIEF_CONFIRMATION_FORBIDDEN',
  'the owner of an affaire who works in another tenant now cannot confirm it in the old one');
select throws_ok($$select * from pg_temp.confirm(22, 1, pg_temp.claims(2, true))$$, '42501', 'TAKEOFF_BRIEF_CONFIRMATION_FORBIDDEN',
  'another member''s claims confirm nothing');
select throws_ok($$select * from pg_temp.confirm(22, 1, null)$$, '42501', 'TAKEOFF_BRIEF_CONFIRMATION_FORBIDDEN',
  'nor does a confirmation without the member''s session');

-- 2. The identical retry of a confirmation on an affaire without any upload (no intake event) finds the request it
-- reserved; a form of another revision, or another member's form of that one, stays stale.
create temp table revision_21 as select pg_temp.brief_at(21) as at;
create temp table first_21 as select * from pg_temp.confirm(21, 1, pg_temp.claims(1));
select results_eq($$select outcome, request_id is not null from first_21$$, $$values ('confirmed'::text, true)$$,
  'the first confirmation reserves the request');
select is((select count(*)::integer from public.affaire_intake_events where project_id = pg_temp.f(21)), 0, 'and writes no event');
select pg_temp.commit_brief(21);
select results_eq($$select outcome, request_id from pg_temp.confirm(21, 1, pg_temp.claims(1), (select at from revision_21))$$,
  $$select 'replayed'::text, request_id from first_21$$, 'the identical retry gets the request it reserved');
select results_eq($$select outcome from pg_temp.confirm(21, 1, pg_temp.claims(1), (select at - interval '1 second' from revision_21))$$,
  $$values ('conflict'::text)$$, 'a form of another revision is stale');
select results_eq($$select outcome from pg_temp.confirm(21, 5, pg_temp.claims(5), (select at from revision_21))$$,
  $$values ('conflict'::text)$$, 'another member''s form of that revision is stale');

-- 3. A first analysis has no predecessor; every other intent names the analysis it replaces.
select throws_ok($$select * from pg_temp.relaunch(4, 90, 'initial', pg_temp.f(74))$$, '22023', 'TAKEOFF_LAUNCH_PREDECESSOR_INVALID',
  'an initial command naming a predecessor is refused');
select is((select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(24)), 0, 'and creates nothing');

-- 4. Usage is recorded only under a live lease of the job.
select results_eq($$select outcome from pg_temp.relaunch(5, 91, 'reread_plans', pg_temp.f(75))$$, $$values ('admitted'::text)$$,
  'a relaunch runs');
select is((select count(*)::integer from public.claim_observed_local_takeoff_job(pg_temp.f(85), pg_temp.f(10), pg_temp.host(),
  now(), pg_temp.f(95), now() + interval '1 hour', 'fixture', 'fixture', 'pending', 0)), 1, 'the Mac claims its job');
select results_eq($$select remaining_tokens from public.record_takeoff_launch_usage(pg_temp.f(85), pg_temp.f(95), 'C:0', 100, 0)$$,
  $$values (900::bigint)$$, 'a call recorded under the live lease counts');
set local session_replication_role = replica;
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second' where id = pg_temp.f(85);
set local session_replication_role = origin;
select throws_ok($$select * from public.record_takeoff_launch_usage(pg_temp.f(85), pg_temp.f(95), 'C:1', 100, 0)$$, '42501',
  'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED', 'a call recorded under an expired lease is refused');
select is((select tokens_observed from public.takeoff_launch_requests r join public.takeoff_jobs j on j.launch_request_id = r.id
  where j.id = pg_temp.f(85)), 100::bigint, 'and counts nothing');
set local session_replication_role = replica;
update public.takeoff_jobs set processing_lease_expires_at = now() + interval '1 hour' where id = pg_temp.f(85);
set local session_replication_role = origin;

-- 5. Removing the automatic start's cut-off stops new claims and admissions; an admitted analysis finishes (the worker
-- does not check the activation).
delete from private.takeoff_launch_activation;
select results_eq($$select reason from public.takeoff_job_may_pay(pg_temp.f(85), false)$$, $$values (null::text)$$,
  'an admitted analysis may still pay without the cut-off');
select is((select count(*)::integer from public.claim_takeoff_launch_evaluations(pg_temp.host(), gen_random_uuid(), 20)), 0,
  'while nothing new is claimed');
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');

-- 6. A request with nothing left, in tokens or in cents, stops the next call.
create temp table budget_85 as select r.id, r.token_budget, r.cost_budget_cents from public.takeoff_launch_requests r
  join public.takeoff_jobs j on j.launch_request_id = r.id where j.id = pg_temp.f(85);
update public.takeoff_launch_requests r set cost_cents_observed = b.cost_budget_cents from budget_85 b where r.id = b.id;
select results_eq($$select reason, remaining_cost_cents from public.takeoff_job_may_pay(pg_temp.f(85), false)$$,
  $$values ('BUDGET_EXHAUSTED'::text, 0::bigint)$$, 'no cent left stops the call');
update public.takeoff_launch_requests r set cost_cents_observed = 0, tokens_observed = b.token_budget from budget_85 b where r.id = b.id;
select results_eq($$select reason, remaining_tokens from public.takeoff_job_may_pay(pg_temp.f(85), false)$$,
  $$values ('BUDGET_EXHAUSTED'::text, 0::bigint)$$, 'no token left stops the call');

select * from finish();
rollback;
