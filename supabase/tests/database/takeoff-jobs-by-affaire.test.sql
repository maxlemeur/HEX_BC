begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.fixture(n integer) returns uuid language sql immutable as $$
  select ('ab220000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users(id, email, raw_user_meta_data)
select pg_temp.fixture(n), 'takeoff-affaire-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 4) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'ab220000-%';
insert into public.tenants(id, name, slug) values
  (pg_temp.fixture(10), 'Takeoff affaire', 'takeoff-affaire-test'),
  (pg_temp.fixture(11), 'Other tenant', 'takeoff-affaire-other-test');
insert into public.tenant_memberships(tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.fixture(10), pg_temp.fixture(1), 'engineer', true, '2020-01-01'),
  (pg_temp.fixture(10), pg_temp.fixture(2), 'engineer', true, '2020-01-01'),
  (pg_temp.fixture(10), pg_temp.fixture(3), 'director', true, '2020-01-01'),
  (pg_temp.fixture(11), pg_temp.fixture(4), 'admin', true, '2020-01-01');
insert into public.estimate_projects(id, tenant_id, user_id, name) values
  (pg_temp.fixture(20), pg_temp.fixture(10), pg_temp.fixture(1), 'Owned plans'),
  (pg_temp.fixture(21), pg_temp.fixture(10), pg_temp.fixture(2), 'Other affaire');
insert into public.estimate_versions(id, project_id, version_number)
values (pg_temp.fixture(30), pg_temp.fixture(20), 1);
insert into public.plan_sets(id, tenant_id, project_id, name) values
  (pg_temp.fixture(40), pg_temp.fixture(10), pg_temp.fixture(20), 'Affaire plans'),
  (pg_temp.fixture(41), pg_temp.fixture(10), pg_temp.fixture(21), 'Other plans');
insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.fixture(50), pg_temp.fixture(10), pg_temp.fixture(40), 'fixture.pdf',
  concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(50), 'fixture.pdf'), 'application/pdf', 8, 1);

with preparation as (
  select jsonb_build_object('schema_version', 1,
    'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
    'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
    'sources', jsonb_build_array(jsonb_build_object(
      'document_id', id, 'kind', 'plan', 'active', true, 'confirmed', true, 'plan_set_id', plan_set_id,
      'file_path', file_path, 'page_count', page_count, 'source_updated_at', updated_at))) as draft
  from public.plan_files where id = pg_temp.fixture(50)
)
insert into public.takeoff_preparations(tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
select pg_temp.fixture(10), pg_temp.fixture(20), 1, draft,
  jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.fixture(1),
    'confirmed_at', '2026-10-29T00:00:00Z', 'readiness', '{"can_launch":true}'::jsonb, 'preparation', draft),
  '2026-10-29T00:00:00Z', pg_temp.fixture(1), pg_temp.fixture(1)
from preparation;

create function pg_temp.insert_job(n integer, plan integer default 40, forged boolean default false, injected boolean default false)
returns void language sql as $$
  insert into public.takeoff_jobs(id, tenant_id, project_id, plan_set_id, level, created_by, execution_provider,
    execution_host_id, processing_strategy, preparation_snapshot)
  select pg_temp.fixture(n), tenant_id, project_id, pg_temp.fixture(plan), 'C', pg_temp.fixture(1),
    'chatgpt_local', 'urn:uuid:ab220000-0000-4000-8000-000000000090', 'sync',
    case when forged then '{}'::jsonb
      when injected then jsonb_set(confirmed_snapshot, '{preparation,sources}',
        (confirmed_snapshot #> '{preparation,sources}') || (
          select jsonb_build_array(jsonb_build_object('document_id', id, 'kind', 'plan', 'active', true, 'confirmed', true,
            'plan_set_id', plan_set_id, 'file_path', file_path, 'page_count', page_count, 'source_updated_at', updated_at))
          from public.plan_files where id = pg_temp.fixture(51)))
      else confirmed_snapshot end
  from public.takeoff_preparations where project_id = pg_temp.fixture(20)
$$;
create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.fixture(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.fixture(n))::text, true);
$$;

select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select pg_temp.insert_job(61, 41)$$, '42501', 'TAKEOFF_JOB_PLAN_SET_SCOPE_INVALID',
  'a job cannot take the plans of another affaire');
select throws_ok($$select pg_temp.insert_job(61, 40, true)$$, '42501', 'TAKEOFF_PREPARATION_REQUIRED',
  'the operator cannot forge a preparation attestation');
select lives_ok($$select pg_temp.insert_job(61)$$, 'the owner can admit an attested job without a version');
select lives_ok($$select pg_temp.insert_job(66)$$,
  'two versionless jobs can share an affaire, plan set, preparation revision, level and provider');
select is((select count(*) from public.takeoff_jobs where project_id = pg_temp.fixture(20)
  and plan_set_id = pg_temp.fixture(40) and estimate_version_id is null), 2::bigint, 'both standalone jobs remain visible');
select throws_ok($$update public.takeoff_jobs set project_id = pg_temp.fixture(21) where id = pg_temp.fixture(61)$$,
  '42501', 'TAKEOFF_JOB_IDENTITY_IMMUTABLE', 'a client cannot move an admitted job to another affaire');
select throws_ok($$update public.takeoff_jobs set estimate_version_id = pg_temp.fixture(30) where id = pg_temp.fixture(61)$$,
  '42501', 'TAKEOFF_JOB_IDENTITY_IMMUTABLE', 'a client cannot attach even a draft of the same affaire');
reset role;

insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.fixture(51), pg_temp.fixture(10), pg_temp.fixture(40), 'unattested.pdf',
  concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(51), 'unattested.pdf'), 'application/pdf', 8, 1);
set local role authenticated;
select throws_ok($$select pg_temp.insert_job(67, 40, false, true)$$, '42501', 'TAKEOFF_PREPARATION_REQUIRED',
  'a third plan injected into the snapshot is not attested');
reset role;

create temp table admitted_job_snapshots as
select id, preparation_snapshot from public.takeoff_jobs where id in (pg_temp.fixture(61), pg_temp.fixture(66));
update public.takeoff_preparations set revision = 2, draft = draft || '{"conventions":{"unit":"u"}}'::jsonb,
  confirmed_snapshot = null, confirmed_at = null, confirmed_by = null where project_id = pg_temp.fixture(20);
select is((select count(*) from admitted_job_snapshots a join public.takeoff_jobs j using (id)
  where a.preparation_snapshot = j.preparation_snapshot), 2::bigint,
  'editing preparation options changes neither admitted snapshot');
select is((select estimate_version_id from public.takeoff_jobs where id = pg_temp.fixture(61)),
  null::uuid, 'no estimate version was attached');
select throws_ok($$update public.takeoff_jobs set project_id = pg_temp.fixture(21) where id = pg_temp.fixture(61)$$,
  '42501', 'TAKEOFF_JOB_IDENTITY_IMMUTABLE', 'even worker updates cannot move a job to another affaire');
select throws_ok($$update public.takeoff_jobs set created_by = pg_temp.fixture(2) where id = pg_temp.fixture(61)$$,
  '42501', 'TAKEOFF_JOB_IDENTITY_IMMUTABLE', 'even worker updates cannot change the creator');
set local role service_role;
select throws_ok($$update public.takeoff_jobs set estimate_version_id = pg_temp.fixture(30) where id = pg_temp.fixture(66)$$,
  '42501', 'TAKEOFF_JOB_IDENTITY_IMMUTABLE', 'M1 grants no attachment permit to direct service-role updates');
reset role;
select throws_ok($$update public.takeoff_jobs set estimate_version_id = pg_temp.fixture(30) where id = pg_temp.fixture(61)$$,
  '42501', 'TAKEOFF_JOB_IDENTITY_IMMUTABLE', 'an elevated writer still needs the guarded attachment permit');
select throws_ok($$update public.takeoff_jobs set preparation_snapshot = '{}' where id = pg_temp.fixture(61)$$,
  '42501', 'TAKEOFF_JOB_PREPARATION_IMMUTABLE', 'the attested preparation stays immutable');

insert into public.takeoff_results(id, tenant_id, job_id)
values (pg_temp.fixture(62), pg_temp.fixture(10), pg_temp.fixture(61));
insert into public.takeoff_items(id, tenant_id, job_id, result_id, designation, quantity, unit)
values (pg_temp.fixture(63), pg_temp.fixture(10), pg_temp.fixture(61), pg_temp.fixture(62), 'Canalisation', 7, 'm');
insert into public.takeoff_run_metrics(tenant_id, job_id, result_id, level, model)
values (pg_temp.fixture(10), pg_temp.fixture(61), pg_temp.fixture(62), 'C', 'fixture');
insert into public.takeoff_vector_pages(id, tenant_id, job_id, result_id, source_page, reading, schema_version)
values (pg_temp.fixture(64), pg_temp.fixture(10), pg_temp.fixture(61), pg_temp.fixture(62), 1, '{}', 1);
insert into public.takeoff_item_geometries(takeoff_item_id, tenant_id, job_id, vector_page_id, geometry, schema_version)
values (pg_temp.fixture(63), pg_temp.fixture(10), pg_temp.fixture(61), pg_temp.fixture(64), '{"length_m":7}', 1);

-- A versioned upload omits project_id just like the historical client.
insert into public.takeoff_jobs(id, tenant_id, estimate_version_id, level, created_by, source_file_path)
values (pg_temp.fixture(65), pg_temp.fixture(10), pg_temp.fixture(30), 'A', pg_temp.fixture(1),
  concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(65), 'historic.csv'));
select is((select project_id from public.takeoff_jobs where id = pg_temp.fixture(65)),
  pg_temp.fixture(20), 'legacy versioned uploads derive their affaire');

insert into storage.objects(bucket_id, name) values
  ('takeoff-files', concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(65), 'historic.csv')),
  ('takeoff-files', concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(65), 'other.csv')),
  ('takeoff-files', concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(66), 'private.csv')),
  ('plan-files', concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(50), 'fixture.pdf')),
  ('plan-files', concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(51), 'unattested.pdf'));

create function pg_temp.visible_plan(expected bigint, actor text) returns setof text language sql as $$
  select is((select count(*) from public.plan_sets where id = pg_temp.fixture(40)), expected, actor || ': attested plan set')
  union all select is((select count(*) from public.plan_files where id = pg_temp.fixture(50)), expected, actor || ': attested plan')
  union all select is((select count(*) from storage.objects where bucket_id = 'plan-files'
    and name = concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(50), 'fixture.pdf')),
    expected, actor || ': attested plan Storage object')
$$;

create function pg_temp.visible_children(expected bigint, actor text) returns setof text language sql as $$
  select is((select count(*) from public.takeoff_jobs where id = pg_temp.fixture(61)), expected, actor || ': job')
  union all select is((select count(*) from public.takeoff_results where job_id = pg_temp.fixture(61)), expected, actor || ': result')
  union all select is((select count(*) from public.takeoff_items where job_id = pg_temp.fixture(61)), expected, actor || ': line and evidence')
  union all select is((select count(*) from public.takeoff_run_metrics where job_id = pg_temp.fixture(61)), expected, actor || ': metrics')
  union all select is((select count(*) from public.takeoff_vector_pages where job_id = pg_temp.fixture(61)), expected, actor || ': vector page')
  union all select is((select count(*) from public.takeoff_item_geometries where job_id = pg_temp.fixture(61)), expected, actor || ': geometry')
$$;

set local role authenticated;
select * from pg_temp.visible_children(1, 'owner');
select * from pg_temp.visible_plan(1, 'owner');
select is((select count(*) from storage.objects where bucket_id = 'takeoff-files'
  and split_part(name, '/', 2) = pg_temp.fixture(65)::text), 1::bigint, 'owner reads the canonical legacy upload only');
select throws_ok($$insert into storage.objects(bucket_id, name)
  values ('takeoff-files', concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(61), 'not-a-job-source.csv'))$$,
  '42501', null, 'an authenticated client cannot attach an unregistered path to a job');
reset role;
select pg_temp.sign_in(3);
set local role authenticated;
select * from pg_temp.visible_children(1, 'read-only director');
select * from pg_temp.visible_plan(1, 'read-only director');
select is((select count(*) from storage.objects where bucket_id = 'plan-files'
  and name = concat_ws('/', pg_temp.fixture(10), pg_temp.fixture(40), pg_temp.fixture(51), 'unattested.pdf')),
  0::bigint, 'two readable jobs do not expose other plans from their set through takeoff evidence');
select is((select count(*) from storage.objects where bucket_id = 'takeoff-files'
  and split_part(name, '/', 2) = pg_temp.fixture(66)::text), 0::bigint,
  'permission on the affaire and both jobs exposes no unregistered private object');
select is((select count(*) from storage.objects where bucket_id = 'takeoff-files'
  and split_part(name, '/', 2) = pg_temp.fixture(65)::text), 0::bigint, 'a director keeps the historical version access rule');
with changed as (update public.takeoff_run_metrics set model = 'changed' where job_id = pg_temp.fixture(61) returning id)
select is((select count(*) from changed), 0::bigint, 'the director cannot modify metrics');
with changed as (update public.takeoff_jobs set status = 'canceled' where id = pg_temp.fixture(61) returning id)
select is((select count(*) from changed), 0::bigint, 'the director cannot cancel the job');
with changed as (update public.takeoff_items set quantity = 8 where id = pg_temp.fixture(63) returning id)
select is((select count(*) from changed), 0::bigint, 'the director cannot edit the line');
reset role;
select pg_temp.sign_in(2);
set local role authenticated;
select * from pg_temp.visible_children(0, 'engineer from another affaire');
select * from pg_temp.visible_plan(0, 'engineer from another affaire');
reset role;
select pg_temp.sign_in(4);
set local role authenticated;
select * from pg_temp.visible_children(0, 'administrator of another tenant');
reset role;
update public.tenants set is_active = false where id = pg_temp.fixture(10);
select pg_temp.sign_in(1);
set local role authenticated;
select * from pg_temp.visible_children(0, 'owner in an inactive tenant');
select * from pg_temp.visible_plan(0, 'owner in an inactive tenant');
reset role;

update public.tenants set is_active = true where id = pg_temp.fixture(10);
-- A completed job can be evaluated only from a stamp of that affaire and job.
update public.takeoff_jobs set status = 'completed' where id = pg_temp.fixture(61);
create temp table original_rule_stamp as
select public.takeoff_rule_job_stamp(pg_temp.fixture(10), pg_temp.fixture(20), pg_temp.fixture(61)) stamp;
update public.takeoff_vector_pages set source_page = 2 where id = pg_temp.fixture(64);
select isnt((select stamp from original_rule_stamp),
  public.takeoff_rule_job_stamp(pg_temp.fixture(10), pg_temp.fixture(20), pg_temp.fixture(61)), 'a changed page invalidates the job stamp');
select is((select count(*) from public.write_takeoff_job_rule_results(
  pg_temp.fixture(10), pg_temp.fixture(20), pg_temp.fixture(61),
  (select jsonb_agg(jsonb_build_object('id', id, 'results', '[]'::jsonb,
    'expected_updated_at', updated_at, 'expected_stale_at', rules_stale_at)) from public.takeoff_items where id = pg_temp.fixture(63)),
  '[]', (select stamp from original_rule_stamp))), 0::bigint, 'a stale computation writes nothing');
select is((select count(*) from public.write_takeoff_job_rule_results(
  pg_temp.fixture(10), pg_temp.fixture(20), pg_temp.fixture(61),
  (select jsonb_agg(jsonb_build_object('id', id, 'results', '[]'::jsonb,
    'expected_updated_at', updated_at, 'expected_stale_at', rules_stale_at)) from public.takeoff_items where id = pg_temp.fixture(63)),
  '[]', public.takeoff_rule_job_stamp(pg_temp.fixture(10), pg_temp.fixture(20), pg_temp.fixture(61)))),
  1::bigint, 'the current computation writes its own item');
select is(public.takeoff_rule_job_stamp(pg_temp.fixture(10), pg_temp.fixture(21), pg_temp.fixture(61)),
  null::text, 'a valid job ID alone cannot address another affaire');

select pg_temp.sign_in(1);
set local role authenticated;
select is((select count(*) from public.takeoff_items i
  cross join lateral public.update_takeoff_item_for_review(i.tenant_id, i.job_id, i.id, i.updated_at,
    '{"evidence":"A new review note"}'::jsonb, i.rules_evaluated_at - interval '1 second') saved
  where i.id = pg_temp.fixture(63)), 0::bigint, 'a versionless guided action refuses an obsolete rule evaluation');
select is((select count(*) from public.takeoff_items i
  cross join lateral public.update_takeoff_item_for_review(i.tenant_id, i.job_id, i.id, i.updated_at,
    '{"evidence":"A new review note"}'::jsonb, i.rules_evaluated_at) saved
  where i.id = pg_temp.fixture(63)), 1::bigint, 'a versionless guided action accepts its current rule evaluation');
reset role;

select * from finish();
rollback;
