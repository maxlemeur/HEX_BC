-- A fictional two-plan request through the normal plan admission and the API payment ledger.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5130000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.physical_host() returns text language sql immutable as $$ select 'urn:uuid:' || pg_temp.f(99) $$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5130000-0000-8000-8000-000000000099' $$;
create function pg_temp.selection(mandate integer default 200) returns jsonb language sql immutable as $$
  select jsonb_build_object('source', 'personal_api_key', 'profileId', pg_temp.f(mandate), 'model', 'personal_api_key',
    'reasoningEffort', null, 'hostId', pg_temp.host(), 'authorizationId', pg_temp.f(mandate))
$$;
create function pg_temp.plan_selection(explicit boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'fictif', 'model', 'modele-fictif', 'reasoningEffort', 'medium',
    'hostId', case when explicit then pg_temp.host() else pg_temp.physical_host() end,
    'authorizationId', 'connexion-fictive')
    || case when explicit then '{"source":"chatgpt_plan"}'::jsonb else '{}'::jsonb end
$$;
create function pg_temp.settings() returns jsonb language sql immutable as $$
  select jsonb_build_object('connectionId', pg_temp.f(201), 'connectionVersion', 1, 'model', 'gpt-6.1-terra',
    'reasoningEffort', 'medium', 'hostId', pg_temp.host(), 'maxTokens', 400000, 'maxNanoUsd', 25000000000::bigint)
$$;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'takeoff-api-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 2) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5130000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Métré fictif - clé', 'takeoff-personal-api-test');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true), (pg_temp.f(10), pg_temp.f(2), 'director', true);
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.f(project), pg_temp.f(10), pg_temp.f(1), 'Affaire fictive ' || project from generate_series(20,26) project;
insert into public.plan_sets (id, tenant_id, project_id, name)
select pg_temp.f(project + 20), pg_temp.f(10), pg_temp.f(project), 'Plans fictifs' from generate_series(20,26) project;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(100 + n + 10 * (project - 20)), pg_temp.f(10), pg_temp.f(project + 20), 'fictif-' || n || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(project + 20), pg_temp.f(100 + n + 10 * (project - 20)), 'fictif-' || n || '.pdf'),
  'application/pdf', 8, 9
from generate_series(1, 2) n cross join generate_series(20,26) project;

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
      'pages', p.pages, 'page_count', 9, 'vector_pages', case when project=20 and p.ordinal=1 then 1 else 0 end,
      'paid_vector_groups', project=20 and p.ordinal=1,
      'budget', jsonb_build_object('tokens', ceil(tokens::numeric / p.units), 'cost_cents', ceil(cents::numeric / p.units))) order by p.ordinal) from plans p),
    'plans', (select jsonb_agg(jsonb_build_object('entry_key', p.id, 'plan_file_id', p.id, 'name', p.file_name, 'logical_id', p.id,
      'content_sha256', pg_temp.digest(p.id), 'pages', p.pages, 'page_count', 9) order by p.ordinal) from plans p),
    'coverage', jsonb_build_object('plans_retained', (select count(*) from plans), 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
    'budget', jsonb_build_object('tokens', tokens, 'cost_cents', cents))
$$;
create function pg_temp.jobs(project integer, host_id text default pg_temp.host()) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', pg_temp.f(1000 + 10 * project + (u.value ->> 'ordinal')::integer),
      'plan_set_id', pg_temp.f(project + 20), 'launch_unit_key', u.value ->> 'key', 'source_file_name', 'plan.pdf',
      'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', host_id)
    order by (u.value ->> 'ordinal')::integer)
  from jsonb_array_elements(pg_temp.manifest(project) -> 'units') u(value)
$$;
-- The job of a request's unit by its place in the recorded order.
create function pg_temp.unit(project integer, ordinal integer) returns uuid language sql immutable as $$
  select pg_temp.f(1000 + 10 * project + ordinal)
$$;
create function pg_temp.launch(project integer, reference boolean default false, tokens integer default 400000,
  payment jsonb default pg_temp.selection())
returns table (outcome text, request_id uuid, job_id uuid) language sql as $$
  select * from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(project), pg_temp.f(1), pg_temp.f(500 + project),
    'initial', null, payment->>'hostId', payment, pg_temp.manifest(project, tokens),
    jsonb_set(pg_temp.snapshot(project, reference), '{execution_selection}', payment), pg_temp.jobs(project, payment->>'hostId'), pg_temp.f(project + 20), 1,
    (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)))
$$;
create function pg_temp.request(project integer) returns uuid language sql as $$
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(project) order by created_at desc limit 1
$$;
create function pg_temp.confirm(project integer) returns void language sql as $$
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by)
  values (pg_temp.f(10), pg_temp.f(project), 1, pg_temp.snapshot(project) -> 'preparation', pg_temp.snapshot(project), now(),
    pg_temp.f(1), pg_temp.f(1))
$$;
set local session_replication_role = replica;
select pg_temp.confirm(20), pg_temp.confirm(21), pg_temp.confirm(22), pg_temp.confirm(23), pg_temp.confirm(24),
  pg_temp.confirm(25), pg_temp.confirm(26);
set local session_replication_role = origin;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute');

select throws_ok($$select public.seal_takeoff_api_mandate(pg_temp.f(200),pg_temp.f(10),pg_temp.f(20),pg_temp.f(2),pg_temp.settings())$$,
  '42501', 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE', 'a director cannot seal payment');
select lives_ok($$select public.seal_takeoff_api_mandate(pg_temp.f(200),pg_temp.f(10),pg_temp.f(20),pg_temp.f(1),pg_temp.settings())$$,
  'the eligible payer seals the API connection, settings and budget');
select is(public.read_takeoff_api_mandate(pg_temp.f(200),pg_temp.f(10),pg_temp.f(21),pg_temp.f(1)), null::jsonb,
  'one affaire cannot read another affaire’s mandate');
select results_eq($$select outcome from pg_temp.launch(20)$$, $$values ('admitted'::text)$$, 'the normal admission records both key-funded jobs');

create function pg_temp.claim(ordinal integer, token integer, observed text default 'pending', legacy boolean default false,
  project integer default 20)
returns bigint language plpgsql as $$
declare j uuid := pg_temp.unit(project, ordinal);
begin
  if legacy then
    return (select count(*) from public.claim_observed_local_takeoff_job(j, pg_temp.f(10), pg_temp.host(), clock_timestamp(),
      pg_temp.f(token), clock_timestamp() + interval '10 minutes', 'gpt-6.1-terra', 'fixture', observed, 0));
  end if;
  return (select count(*) from public.claim_explicit_takeoff_payment_job(j, pg_temp.f(10), pg_temp.host(), clock_timestamp(),
    pg_temp.f(token), clock_timestamp() + interval '10 minutes', 'gpt-6.1-terra', 'fixture', observed, 0));
end;
$$;
create function pg_temp.reserve(ordinal integer, token integer, branch text, cost bigint default null, tokens bigint default null,
  exhausted boolean default false, tile_key text default null, project integer default 20)
returns table (reason text, remaining_nano_usd bigint, remaining_tokens bigint, call_id uuid) language sql as $$
  select * from public.reserve_takeoff_api_call(pg_temp.unit(project, ordinal), pg_temp.f(10), pg_temp.f(project), pg_temp.f(1),
    pg_temp.f(token), false, branch, cost, tokens, exhausted, tile_key)
$$;
select is(pg_temp.claim(1, 901, 'pending', true), 0::bigint, 'the prior claim RPC cannot start an API job even with its queue ID');
select is(pg_temp.claim(1, 901), 1::bigint, 'the API worker takes the job lease');
update private.takeoff_launch_commands set
  count_mark_schedule = '{"pages":[{"page":2,"width_points":600}],"tile_calls":4,"other_calls":26,"total_calls":30}'::jsonb
where request_id = pg_temp.request(20) and job_id = pg_temp.unit(20,1);
select is((select reason from pg_temp.reserve(1, 901, 'count_tile', 1, 1, false, 'tile:2:5')), 'TILE_OUTSIDE_SCOPE',
  'a tile outside the sealed schedule is refused');
create temp table tile_a as select call_id from pg_temp.reserve(1, 901, 'count_tile', 10, 2, false, 'tile:2:4');
select ok((select call_id is not null from tile_a), 'the count tile has a reservation under its confirmed tile key');
select is(public.settle_takeoff_api_call((select call_id from tile_a), pg_temp.unit(20,1), pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(1), pg_temp.f(901), 0, 0), true, 'a settled tile still counts as attempted');
select is(public.settle_takeoff_api_call((select call_id from tile_a), pg_temp.unit(20,1), pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(1), pg_temp.f(901), 0, 0), true, 'identical settlement replay succeeds under the live lease');
select is(public.settle_takeoff_api_call((select call_id from tile_a), pg_temp.unit(20,1), pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(1), pg_temp.f(901), null, null), false, 'the live lease cannot overwrite a known settlement');

create temp table call_a as select call_id from pg_temp.reserve(1, 901, 'pdf', 15000000000, 100000);
select ok((select call_id is not null from call_a), 'the PDF generation is reserved before dispatch');
select is((select remaining_nano_usd from pg_temp.reserve(1, 901, 'vector_group')), 10000000000::bigint,
  'vector groups see the PDF reservation');
select is((select reason from pg_temp.reserve(1, 901, 'vector_group', 11000000000, 1)), 'CAPACITY_HELD',
  'overlapping calls wait for the balance held by an active lease');
select is((select reason from pg_temp.reserve(1, 901, 'vector_group', 10000000000, 300000, true)), 'CAPACITY_HELD',
  'an insufficient preparation cannot freeze the request while another call may free capacity');
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second' where id = pg_temp.unit(20, 1);
select is(public.settle_takeoff_api_call((select call_id from call_a), pg_temp.unit(20,1), pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(1), pg_temp.f(901), null, null), false, 'lease 901 cannot settle even before the sweep has run');

select is((select count(*) from public.recover_stale_local_takeoff_jobs(clock_timestamp()) where job_id = pg_temp.unit(20,1)),
  0::bigint, 'the prior recovery cannot stop an expired API job');
select lives_ok($$select public.recover_takeoff_payment_jobs(clock_timestamp())$$, 'hosted recovery reschedules the lease without the originating Mac');
select is((select state from public.takeoff_launch_requests where id = pg_temp.request(20)), 'admitted'::text,
  'the request keeps its budget and remains admitted during the recovery window');
select is(pg_temp.claim(1, 902, 'failed'), 1::bigint, 'the API worker can retry under a new lease');
select is((select reason from pg_temp.reserve(1, 902, 'count_tile', 1, 1, false, 'tile:2:4')), 'TILE_ALREADY_ATTEMPTED',
  'a new lease never buys the same tile again');
select throws_ok($$select * from pg_temp.reserve(1, 901, 'pdf', 1, 1)$$,
  '42501', 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED', 'the expired lease cannot reserve again');
select is((select remaining_nano_usd from pg_temp.reserve(1, 902, 'vector_group')), 10000000000::bigint,
  'the retry still sees the crashed call’s full reservation');
select is(public.settle_takeoff_api_call((select call_id from call_a), pg_temp.unit(20,1), pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(1), pg_temp.f(901), 5000000000, 20000), false, 'lease 901 cannot credit back part of its bound after 902 starts');
select is(public.settle_takeoff_api_call((select call_id from call_a), pg_temp.unit(20,1), pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(1), pg_temp.f(901), null, null), false, 'the lost response for lease 901 cannot mark 902’s request as unknown');
select results_eq($$select actual_nano_usd,actual_tokens,settled_at from private.takeoff_api_calls where id = (select call_id from call_a)$$,
  $$values (null::bigint,null::bigint,null::timestamptz)$$, 'the abandoned reservation remains unsettled at its bound');
select results_eq($$select reason, remaining_nano_usd, remaining_tokens from pg_temp.reserve(1,902,'vector_group')$$,
  $$values (null::text,10000000000::bigint,300000::bigint)$$, 'lease 902 can still use the balance after the late response');

select is(public.settle_takeoff_api_call((select call_id from call_a), pg_temp.unit(20,1), pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(1), pg_temp.f(902), 5000000000, 20000), false, 'the new lease cannot settle the prior lease’s reservation');
select is(public.finalize_local_takeoff_result(pg_temp.unit(20,1),pg_temp.f(10),pg_temp.f(901),clock_timestamp(),
  'modele-fictif','fixture','{}','[]'), null::uuid, 'a late answer cannot publish with the old lease');
select ok(public.finalize_local_takeoff_result(pg_temp.unit(20,1),pg_temp.f(10),pg_temp.f(902),clock_timestamp(),
  'modele-fictif','fixture','{"extracted_json":{},"warnings":[],"tables":[],"provider_meta":{"fixture":true},"token_count":20,"cost_cents":0,"duration_ms":1}',
  '[]') is not null, 'the new lease publishes one result');
select is(pg_temp.claim(2, 903), 1::bigint, 'the next plan takes its own lease');
select is((select remaining_nano_usd from pg_temp.reserve(2, 903, 'pdf')), 10000000000::bigint,
  'the second plan shares the full bound of the abandoned call');
select is((select reason from pg_temp.reserve(2, 903, 'vector_group', 10000000001, 1)), 'REPREPARE',
  'a stale bound cannot send a generation');
select is((select reason from pg_temp.reserve(2, 903, 'vector_group', 10000000000, 300000, true)), 'BUDGET_EXHAUSTED',
  'an unaffordable call with fresh preparation stops the request');
select is((select reason from pg_temp.reserve(2, 903, 'pdf', 1, 1)), 'BUDGET_EXHAUSTED',
  'no generation can follow the budget stop');

-- The second Mac remains offline until the original lease deadline and recovery window are both past.
update private.takeoff_completion_activation set active_from = now() - interval '3 days';
select public.recover_takeoff_payment_jobs(clock_timestamp());
select is((select status::text from public.takeoff_jobs where id = pg_temp.unit(20,2)), 'processing',
  'hosted recovery respects a live lease');
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '2 days'
where id = pg_temp.unit(20,2);
select is((select count(*) from public.recover_stale_local_takeoff_jobs(clock_timestamp()) where job_id = pg_temp.unit(20,2)),
  0::bigint, 'legacy hosted recovery cannot stop expired work for the explicit payer');
select public.recover_takeoff_payment_jobs(clock_timestamp());
select results_eq($$select status::text, analysis_outcome, next_retry_at, error_code from public.takeoff_jobs
  where id = pg_temp.unit(20,2)$$,
  $$values ('failed'::text, 'failure'::text, null::timestamptz, 'TAKEOFF_WORKER_QUEUE_EXPIRED'::text)$$,
  'a Mac that stays offline reaches a terminal outcome at the original deadline');
select is((select state from public.takeoff_launch_requests where id = pg_temp.request(20)), 'closed'::text,
  'the abandoned plan no longer keeps the affaire occupied');
select is((select count(*) from public.takeoff_results where job_id = pg_temp.unit(20,1) and provider_meta->>'fixture' = 'true'),
  1::bigint, 'the already published result remains on the first plan');

-- Normal admission for both plan variants, then the released worker's actual queue, claim and hosted sweep.
select is((select outcome from pg_temp.launch(21, payment => pg_temp.plan_selection(true))), 'admitted', 'explicit plan choice is admitted');
select is((select outcome from pg_temp.launch(22, payment => pg_temp.plan_selection(false))), 'admitted', 'legacy plan is admitted without a source field');
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.physical_host())),
  pg_temp.unit(22,1), 'the released worker sees the unversioned plan only');
select is((select job_id from public.dispatch_next_takeoff_payment_job(pg_temp.host())),
  pg_temp.unit(21,1), 'the upgraded worker sees the explicit plan choice');
select is((select count(*) from public.claim_observed_local_takeoff_job(pg_temp.unit(21,1),pg_temp.f(10),pg_temp.host(),
  clock_timestamp(),pg_temp.f(913),clock_timestamp()+interval '10 minutes','fictif','fixture','pending',0)), 0::bigint,
  'the released claim cannot take the explicit plan even if given its queue identity');
select is((select count(*) from public.claim_observed_local_takeoff_job(pg_temp.unit(22,1),pg_temp.f(10),pg_temp.physical_host(),
  clock_timestamp(),pg_temp.f(914),clock_timestamp()+interval '10 minutes','fictif','fixture','pending',0)), 1::bigint,
  'the released claim still runs the legacy plan');
select is((select outcome from public.reserve_takeoff_launch_call(pg_temp.unit(22,1),pg_temp.f(914),'call:legacy','pdf',2500)),
  'reserved', 'the legacy plan still reserves through the subscription ledger');
select remaining_tokens from public.record_takeoff_launch_usage(pg_temp.unit(22,1),pg_temp.f(914),'call:legacy',75,3) \gset
select is(public.read_takeoff_launch_request_units(pg_temp.f(10),pg_temp.f(22),pg_temp.request(22))->'usage',
  '{"tokens_observed":75,"cost_cents_observed":3,"unknown_calls":0}'::jsonb, 'subscription usage totals remain unchanged');
select is((select unknown_calls from public.read_takeoff_launch_unknown_calls(pg_temp.f(10),pg_temp.f(22),array[pg_temp.request(22)])),
  0::bigint, 'the bulk count still excludes a known subscription settlement');
select is(private.takeoff_local_host_lock_key(pg_temp.host()), private.takeoff_local_host_lock_key(pg_temp.physical_host()),
  'the two queue identifiers resolve to the same advisory lock');
select is((select count(*) from public.claim_explicit_takeoff_payment_job(pg_temp.unit(21,1),pg_temp.f(10),pg_temp.host(),
  clock_timestamp(),pg_temp.f(915),clock_timestamp()+interval '10 minutes','fictif','fixture','pending',0)), 0::bigint,
  'a legacy plan prevents an explicit plan from starting on the same Mac');
update public.takeoff_jobs set status = 'failed', analysis_outcome = 'failure' where id = pg_temp.unit(22,1);
select is((select job_id from public.dispatch_next_takeoff_host_job(pg_temp.physical_host())),
  pg_temp.unit(22,2), 'the second legacy plan is runnable before the explicit claim');

select is((select count(*) from public.claim_explicit_takeoff_payment_job(pg_temp.unit(21,1),pg_temp.f(10),pg_temp.host(),
  clock_timestamp(),pg_temp.f(915),clock_timestamp()+interval '10 minutes','fictif','fixture','pending',0)), 1::bigint,
  'the versioned claim runs the explicitly selected plan');
select is((select count(*) from public.claim_observed_local_takeoff_job(pg_temp.unit(22,2),pg_temp.f(10),pg_temp.physical_host(),
  clock_timestamp(),pg_temp.f(916),clock_timestamp()+interval '10 minutes','fictif','fixture','pending',0)), 0::bigint,
  'an explicit plan also prevents a released worker from starting a second plan on the same Mac');
select is((select holder_token from private.takeoff_host_slots where host_id=pg_temp.physical_host()),pg_temp.f(915),
  'the explicit plan holds the physical Mac’s slot');
select is((select count(*) from private.takeoff_host_slots where host_id=pg_temp.host()),0::bigint,
  'the alias does not acquire its own slot');

set local session_replication_role = replica;
update public.takeoff_jobs set status = 'failed', next_retry_at = now() - interval '2 days',
  processing_lease_token = null, processing_lease_expires_at = null where id = pg_temp.unit(21,1);
update public.takeoff_jobs set analysis_queued_at = now() - interval '2 days' where id = pg_temp.unit(21,2);
set local session_replication_role = origin;
select is((select count(*) from public.recover_stale_local_takeoff_jobs(clock_timestamp())
  where job_id in (pg_temp.unit(21,1),pg_temp.unit(21,2))), 0::bigint, 'the released worker cannot terminate explicit pending or retrying plans');
select is((select state from public.takeoff_launch_requests where id = pg_temp.request(21)), 'admitted'::text,
  'legacy recovery leaves the explicit mandate usable');
select public.recover_takeoff_payment_jobs(clock_timestamp());
select is((select state from public.takeoff_launch_requests where id = pg_temp.request(21)), 'closed'::text,
  'the new hosted recovery closes the overdue explicit plan request');
select public.release_takeoff_host_slot(pg_temp.host(),pg_temp.f(915));

-- Publish the actuals of a known generation and the missing receipt of another.
select public.seal_takeoff_api_mandate(pg_temp.f(223),pg_temp.f(10),pg_temp.f(23),pg_temp.f(1),pg_temp.settings());
select is((select outcome from pg_temp.launch(23, payment => pg_temp.selection(223))),
  'admitted','a personal key funds the request whose usage will be read');
select is(pg_temp.claim(1,930,project=>23),1::bigint,'the usage fixture has a live lease');
select ok(public.settle_takeoff_api_call((select call_id from pg_temp.reserve(1,930,'pdf',20000000,1500,project=>23)),
  pg_temp.unit(23,1),pg_temp.f(10),pg_temp.f(23),pg_temp.f(1),pg_temp.f(930),15000000,121), 'one key generation settles with actual usage');
select ok(public.settle_takeoff_api_call((select call_id from pg_temp.reserve(1,930,'pdf',20000000,1500,project=>23)),
  pg_temp.unit(23,1),pg_temp.f(10),pg_temp.f(23),pg_temp.f(1),pg_temp.f(930),null,null), 'one key generation loses its receipt');
select is(public.read_takeoff_launch_request_units(pg_temp.f(10),pg_temp.f(23),pg_temp.request(23))->'usage',
  '{"tokens_observed":121,"cost_cents_observed":1,"unknown_calls":1}'::jsonb, 'request units show actual and unknown key usage');
select is((select unknown_calls from public.read_takeoff_launch_unknown_calls(pg_temp.f(10),pg_temp.f(23),array[pg_temp.request(23)])),
  1::bigint, 'the bulk reader counts the lost key receipt but not the known settlement');
select is((select count(*) from public.read_takeoff_launch_unknown_calls(pg_temp.f(10),pg_temp.f(22),array[pg_temp.request(23)])),
  0::bigint, 'a different affaire cannot read the key usage count');
select is(public.read_takeoff_launch_request_units(pg_temp.f(11),pg_temp.f(23),pg_temp.request(23)),
  null::jsonb, 'a different tenant cannot read the key usage totals');
update public.takeoff_jobs set status='failed',analysis_outcome='failure' where id=pg_temp.unit(23,1);

-- One paid PDF and four named tiles are all the member confirmed. Crash after settling the PDF.
select public.seal_takeoff_api_mandate(pg_temp.f(224),pg_temp.f(10),pg_temp.f(24),pg_temp.f(1),pg_temp.settings());
select is((select outcome from pg_temp.launch(24, payment => pg_temp.selection(224))),
  'admitted','a separate request has a confirmed one-page schedule for this unit');
select is(pg_temp.claim(1,931,project=>24),1::bigint,'the first scheduled attempt has its lease');
update private.takeoff_launch_commands set
  count_mark_schedule='{"pages":[{"page":2,"width_points":600}],"tile_calls":4,"other_calls":1,"total_calls":5}'::jsonb
where request_id=pg_temp.request(24) and job_id=pg_temp.unit(24,1);
select ok(public.settle_takeoff_api_call((select call_id from pg_temp.reserve(1,931,'pdf',20000000,1500,project=>24)),
  pg_temp.unit(24,1),pg_temp.f(10),pg_temp.f(24),pg_temp.f(1),pg_temp.f(931),8000000,100), 'the first lease settles the only confirmed PDF');
update public.takeoff_jobs set processing_lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.unit(24,1);
select public.recover_takeoff_payment_jobs(clock_timestamp(),pg_temp.host());
select is(pg_temp.claim(1,932,'failed',project=>24),1::bigint,'a new lease resumes without a published PDF result');
select results_eq($$select reason,call_id from pg_temp.reserve(1,932,'pdf',20000000,1500,project=>24)$$,
  $$values ('CALLS_EXHAUSTED'::text,null::uuid)$$, 'the retry cannot charge another PDF beyond the confirmed lane, and is told its calls are spent, not its dollars');
select is((select reason from pg_temp.reserve(1,932,'vector_group',10000000,1000,project=>24)),
  'CALLS_EXHAUSTED','the request cannot reserve a classifier call that the member did not confirm');
select is((select count(call_id) from generate_series(1,4) n cross join lateral
  pg_temp.reserve(1,932,'count_tile',10000000,1000,tile_key=>'tile:2:'||n,project=>24)),4::bigint,
  'the four confirmed tiles remain available on the new lease');
select is((select count(*) from private.takeoff_api_calls where mandate_id=pg_temp.f(224) and scope_id=pg_temp.request(24)),
  5::bigint, 'the two leases can reserve at most one PDF and four tiles in all');
update public.takeoff_jobs set status='failed',analysis_outcome='failure' where id=pg_temp.unit(24,1);

-- Owner decision of 2026-11-27: a key's request has no token ceiling. Its mandate seals dollars, and says so.
select throws_ok($$select public.seal_takeoff_api_mandate(pg_temp.f(225),pg_temp.f(10),pg_temp.f(25),pg_temp.f(1),
  pg_temp.settings() - 'maxTokens')$$, '22023', 'TAKEOFF_API_MANDATE_INVALID', 'a mandate says whether it has a token ceiling');
select throws_ok($$select public.seal_takeoff_api_mandate(pg_temp.f(225),pg_temp.f(10),pg_temp.f(25),pg_temp.f(1),
  pg_temp.settings() || '{"maxTokens":0}')$$, '22023', 'TAKEOFF_API_MANDATE_INVALID', 'a token ceiling of zero is not a mandate');
select throws_ok($$select public.seal_takeoff_api_mandate(pg_temp.f(225),pg_temp.f(10),pg_temp.f(25),pg_temp.f(1),
  pg_temp.settings() || '{"maxTokens":null,"maxNanoUsd":null}')$$, '22023', 'TAKEOFF_API_MANDATE_INVALID',
  'a mandate without a token ceiling still needs its dollar ceiling');
select lives_ok($$select public.seal_takeoff_api_mandate(pg_temp.f(225),pg_temp.f(10),pg_temp.f(25),pg_temp.f(1),
  pg_temp.settings() || '{"maxTokens":null}')$$, 'the payer seals a mandate bounded in dollars only');
select is(public.read_takeoff_api_mandate(pg_temp.f(225),pg_temp.f(10),pg_temp.f(25),pg_temp.f(1)) -> 'maxTokens', 'null'::jsonb,
  'the sealed mandate reads back without a token ceiling');
select is((select outcome from pg_temp.launch(25, payment => pg_temp.selection(225))), 'admitted',
  'a request funded in dollars only is admitted');
select is(pg_temp.claim(1,940,project=>25),1::bigint,'its first plan has a live lease');
-- Twenty-six calls of a one-page plan read against the list reserve 780,000 tokens at the ledger's estimate.
-- One reservation per turn of the loop: a set-returning call that names no column of a series is made once for all its rows.
create function pg_temp.reserve_calls(calls integer, token integer, project integer) returns bigint language plpgsql as $$
declare
  reserved bigint := 0;
begin
  for turn in 1..calls loop
    if (select call_id from pg_temp.reserve(1,token,'pdf',10000000,30000,project=>project)) is not null then
      reserved := reserved + 1;
    end if;
  end loop;
  return reserved;
end;
$$;
select is(pg_temp.reserve_calls(26,940,25),26::bigint,
  'twenty-six calls are reserved past the 400,000 tokens a mandate used to carry');
select is((select sum(bound_tokens) from private.takeoff_api_calls where mandate_id=pg_temp.f(225)), 780000::numeric,
  'each reservation records its call’s token estimate');
select results_eq($$select reason, remaining_nano_usd, remaining_tokens from pg_temp.reserve(1,940,'pdf',project=>25)$$,
  $$values (null::text,24740000000::bigint,null::bigint)$$, 'the balance of a mandate without a token ceiling is its dollars');
select results_eq($$select reason, remaining_tokens from pg_temp.reserve(1,940,'pdf',1000000000,100000,true,project=>25)$$,
  $$values ('CAPACITY_HELD'::text,null::bigint)$$,
  'a preparation waiting on live reservations of a mandate without a token ceiling reads no token number');
create temp table call_b as select call_id from pg_temp.reserve(1,940,'pdf',1000000000,100000,project=>25);
select ok(public.settle_takeoff_api_call((select call_id from call_b),pg_temp.unit(25,1),pg_temp.f(10),pg_temp.f(25),
  pg_temp.f(1),pg_temp.f(940),500000000,2000000), 'a call settles with more tokens than its own estimate');
select is((select reason from pg_temp.reserve(1,940,'pdf',project=>25)), null::text,
  'tokens past a call’s estimate stop nothing while its cost stays within the dollars it reserved');
select is((select actual_tokens from private.takeoff_api_calls where id=(select call_id from call_b)), 2000000::bigint,
  'the tokens a call used are recorded');
select is(public.read_takeoff_launch_request_units(pg_temp.f(10),pg_temp.f(25),pg_temp.request(25))->'usage',
  '{"tokens_observed":2000000,"cost_cents_observed":50,"unknown_calls":0}'::jsonb, 'the activity still shows the tokens and the cost');
-- 25 $ sealed, 26 abandoned-or-live bounds of 0.01 $ and one call settled at 0.50 $: 24.24 $ left.
select is((select remaining_nano_usd from pg_temp.reserve(1,940,'pdf',project=>25)), 24240000000::bigint,
  'every reservation and settlement counts in dollars');
update private.takeoff_api_calls set actual_nano_usd=bound_nano_usd, actual_tokens=bound_tokens, settled_at=clock_timestamp()
where mandate_id=pg_temp.f(225) and settled_at is null;
select is((select reason from pg_temp.reserve(1,940,'pdf',24240000001,1,project=>25)), 'REPREPARE',
  'a bound past the dollars left sends nothing and is prepared again');
select results_eq($$select reason, remaining_tokens from pg_temp.reserve(1,940,'pdf',24240000000,null,true,project=>25)$$,
  $$values ('BUDGET_EXHAUSTED'::text,null::bigint)$$,
  'a call that cannot fit the dollars left stops the request at its ceiling, with no token number sent or returned');
select is((select reason from pg_temp.reserve(1,940,'pdf',1,1,project=>25)), 'BUDGET_EXHAUSTED',
  'no call follows the stop at the dollar ceiling');
select is((select count(*) from private.takeoff_api_calls where mandate_id=pg_temp.f(225)), 27::bigint,
  'the refused calls reserved nothing');
update public.takeoff_jobs set status='failed',analysis_outcome='failure' where id=pg_temp.unit(25,1);

-- A mandate sealed before the decision carries a token number: it stays readable and bounds nothing.
select public.seal_takeoff_api_mandate(pg_temp.f(226),pg_temp.f(10),pg_temp.f(26),pg_temp.f(1),pg_temp.settings());
select is((select outcome from pg_temp.launch(26, payment => pg_temp.selection(226))), 'admitted',
  'a request whose mandate carries the former token ceiling is admitted');
select is(pg_temp.claim(1,941,project=>26),1::bigint,'its first plan has a live lease');
create temp table call_c as select call_id from pg_temp.reserve(1,941,'pdf',1000000000,500000,project=>26);
select ok((select call_id is not null from call_c), 'a call past the token number its mandate carries is reserved');
select is((select reason from pg_temp.reserve(1,941,'pdf',1000000000,500000,true,project=>26)), 'CAPACITY_HELD',
  'only the dollars held by a live reservation make a preparation wait');
select ok(public.settle_takeoff_api_call((select call_id from call_c),pg_temp.unit(26,1),pg_temp.f(10),pg_temp.f(26),
  pg_temp.f(1),pg_temp.f(941),1000000001,10), 'a call settles one nano-dollar past the dollars it reserved');
select is((select reason from pg_temp.reserve(1,941,'pdf',1,1,project=>26)), 'CALL_OVER_BOUND',
  'a call that cost more than the dollars it reserved stops its request, which is told so');
select is((select reason from private.takeoff_api_budget_stops where mandate_id=pg_temp.f(226)), 'BUDGET_EXHAUSTED',
  'the stop of a call over its bound is stored under the reason the table already allows');

-- Replacing the three functions kept their rights: the service role alone executes them.
select is((select count(*) from (values
    ('public.seal_takeoff_api_mandate(uuid,uuid,uuid,uuid,jsonb)'),
    ('public.reserve_takeoff_api_call(uuid,uuid,uuid,uuid,uuid,boolean,text,bigint,bigint,boolean,text)'),
    ('public.settle_takeoff_api_call(uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint)')) f(signature)
  cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
  where has_function_privilege(r.role, f.signature, 'execute') is distinct from (r.role = 'service_role')), 0::bigint,
  'the mandate, reservation and settlement functions stay reserved to the service role');

select * from finish();
rollback;
