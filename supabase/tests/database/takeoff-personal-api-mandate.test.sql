-- A fictional two-plan request through the normal plan admission and the API payment ledger.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5130000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:' || pg_temp.f(99) $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('source', 'personal_api_key', 'profileId', pg_temp.f(200), 'model', 'personal_api_key',
    'reasoningEffort', null, 'hostId', pg_temp.host(), 'authorizationId', pg_temp.f(200))
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
values (pg_temp.f(20), pg_temp.f(10), pg_temp.f(1), 'École fictive'), (pg_temp.f(21), pg_temp.f(10), pg_temp.f(1), 'Autre affaire');
insert into public.plan_sets (id, tenant_id, project_id, name) values (pg_temp.f(40), pg_temp.f(10), pg_temp.f(20), 'Plans de l’école');
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(100 + n), pg_temp.f(10), pg_temp.f(40), 'fictif-' || n || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(40), pg_temp.f(100 + n), 'fictif-' || n || '.pdf'), 'application/pdf', 8, 9
from generate_series(1, 2) n;

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
create function pg_temp.confirm(project integer) returns void language sql as $$
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by)
  values (pg_temp.f(10), pg_temp.f(project), 1, pg_temp.snapshot(project) -> 'preparation', pg_temp.snapshot(project), now(),
    pg_temp.f(1), pg_temp.f(1))
$$;
set local session_replication_role = replica;
select pg_temp.confirm(20);
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

create function pg_temp.claim(ordinal integer, token integer, observed text default 'pending', legacy boolean default false)
returns bigint language plpgsql as $$
declare j uuid := pg_temp.unit(20, ordinal);
begin
  if legacy then
    return (select count(*) from public.claim_observed_local_takeoff_job(j, pg_temp.f(10), pg_temp.host(), clock_timestamp(),
      pg_temp.f(token), clock_timestamp() + interval '10 minutes', 'gpt-6.1-terra', 'fixture', observed, 0));
  end if;
  return (select count(*) from public.claim_personal_api_takeoff_job(j, pg_temp.f(10), pg_temp.host(), clock_timestamp(),
    pg_temp.f(token), clock_timestamp() + interval '10 minutes', 'gpt-6.1-terra', 'fixture', observed, 0));
end;
$$;
create function pg_temp.reserve(ordinal integer, token integer, branch text, cost bigint default null, tokens bigint default null)
returns table (reason text, remaining_nano_usd bigint, remaining_tokens bigint, call_id uuid) language sql as $$
  select * from public.reserve_takeoff_api_call(pg_temp.unit(20, ordinal), pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
    pg_temp.f(token), false, branch, cost, tokens)
$$;
select is(pg_temp.claim(1, 901, 'pending', true), 0::bigint, 'the prior claim RPC cannot start an API job even with its queue ID');
select is(pg_temp.claim(1, 901), 1::bigint, 'the API worker takes the job lease');
create temp table call_a as select call_id from pg_temp.reserve(1, 901, 'pdf', 15000000000, 100000);
select ok((select call_id is not null from call_a), 'the PDF generation is reserved before dispatch');
select is((select remaining_nano_usd from pg_temp.reserve(1, 901, 'vector_group')), 10000000000::bigint,
  'vector groups see the PDF reservation');
update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second' where id = pg_temp.unit(20, 1);
select is((select count(*) from public.recover_stale_local_takeoff_jobs(clock_timestamp()) where job_id = pg_temp.unit(20,1)),
  0::bigint, 'the prior recovery cannot stop an expired API job');
select lives_ok($$select public.recover_personal_api_takeoff_jobs(pg_temp.host())$$, 'the API worker reschedules its expired lease');
select is(pg_temp.claim(1, 902, 'failed'), 1::bigint, 'the API worker can retry under a new lease');
select throws_ok($$select * from pg_temp.reserve(1, 901, 'pdf', 1, 1)$$,
  '42501', 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED', 'the expired lease cannot reserve again');
select is((select remaining_nano_usd from pg_temp.reserve(1, 902, 'pdf')), 10000000000::bigint,
  'the retry still sees the crashed call’s full reservation');
select is(public.settle_takeoff_api_call((select call_id from call_a), pg_temp.unit(20,1), pg_temp.f(10), pg_temp.f(20),
  pg_temp.f(1), pg_temp.f(901), 5000000000, 20000), true, 'a late settlement is matched to the original lease');
update public.takeoff_jobs set status = 'completed', completed_at = clock_timestamp() where id = pg_temp.unit(20, 1);
select is(pg_temp.claim(2, 903), 1::bigint, 'the next plan takes its own lease');
select is((select remaining_nano_usd from pg_temp.reserve(2, 903, 'pdf')), 20000000000::bigint,
  'the second plan shares the first plan’s settled cost');
select is((select reason from pg_temp.reserve(2, 903, 'vector_group', 20000000001, 1)), 'BUDGET_EXHAUSTED',
  'the next reservation is refused before its generation');
select is((select reason from pg_temp.reserve(2, 903, 'pdf', 1, 1)), 'BUDGET_EXHAUSTED',
  'no generation can follow the budget stop');

select * from finish();
rollback;
