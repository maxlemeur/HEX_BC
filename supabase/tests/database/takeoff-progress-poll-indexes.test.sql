-- The dashboard poll must not scan old jobs to find live work or one page of
-- recent standalone ends. Measure rows at the takeoff_jobs scan under RLS,
-- including rejected candidates, for generic parameterized plans.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.progress_id(n integer) returns uuid language sql immutable as $$
  select ('6c539000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.progress_id(n), 'takeoff-progress-' || n || '@example.test', '{}', now()
from generate_series(1, 2) n;
update public.tenant_memberships set is_default = false
where user_id in (pg_temp.progress_id(1), pg_temp.progress_id(2));
insert into public.tenants (id, name, slug)
values (pg_temp.progress_id(3), 'Progress fictional tenant', 'takeoff-progress-index-test');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
values (pg_temp.progress_id(3), pg_temp.progress_id(1), 'engineer', true),
       (pg_temp.progress_id(3), pg_temp.progress_id(2), 'engineer', true);
insert into public.estimate_projects (id, tenant_id, user_id, name)
select pg_temp.progress_id(10 + n), pg_temp.progress_id(3),
       pg_temp.progress_id(case when n = 1 then 2 else 1 end), 'Progress fictional project ' || n
from generate_series(0, 2) n;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version)
select pg_temp.progress_id(20 + n), pg_temp.progress_id(3), pg_temp.progress_id(10 + n), 1, 2
from generate_series(0, 2) n;

-- Test rows use valid stored states and fictional dates. Seeding the historical
-- snapshots bypasses job lifecycle writers only in this rolled-back fixture.
set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, created_by, level, status, created_at, updated_at)
values
  (pg_temp.progress_id(100), pg_temp.progress_id(3), pg_temp.progress_id(10), pg_temp.progress_id(20),
   pg_temp.progress_id(1), 'B', 'processing', now() - interval '2 hours', now()),
  (pg_temp.progress_id(101), pg_temp.progress_id(3), pg_temp.progress_id(10), pg_temp.progress_id(20),
   pg_temp.progress_id(1), 'B', 'pending', now() - interval '3 days', now());

-- The three branches share the same finish time, including ties across pages.
-- 18 readable, 4 hidden by job RLS, and 34 archived in each branch.
insert into public.takeoff_jobs
  (id, tenant_id, project_id, estimate_version_id, created_by, level, status, created_at, updated_at, completed_at,
   analysis_finished_at, analysis_outcome, analysis_completion_event_id)
select pg_temp.progress_id(1000 * branch + n), pg_temp.progress_id(3), pg_temp.progress_id(10 + scope),
       pg_temp.progress_id(20 + scope), pg_temp.progress_id(case when scope = 1 then 2 else 1 end), 'B', 'completed',
       now() - interval '2 hours', now() - interval '1 hour',
       case when branch in (1, 2) then now() - interval '1 hour' end,
       case when branch = 1 then now() - interval '1 hour' end,
       case when branch = 1 then 'success' end, case when branch = 1 then gen_random_uuid() end
from generate_series(1, 3) branch cross join generate_series(1, 56) n
cross join lateral (select case when n <= 18 then 0 when n <= 22 then 1 else 2 end) as project(scope);
update public.estimate_projects set is_archived = true where id = pg_temp.progress_id(12);
set local session_replication_role = origin;

-- Each finish date has its own non-overlapping range. The upper date condition
-- lets a subsequent prepared page seek to the cursor date before breaking ties.
do $$
declare
  branch record;
  join_project text := '
    join lateral (
      select p.id from public.estimate_projects p
      where p.id = j.project_id and p.tenant_id = j.tenant_id and p.user_id = $2 and not p.is_archived
      limit 1
    ) readable on true';
begin
  execute 'prepare progress_live(uuid, uuid, public.takeoff_job_status[]) as
    select j.id from public.takeoff_jobs j ' || join_project || '
    where j.tenant_id = $1 and j.launch_request_id is null and j.completed_at is null and j.status = any($3)
    order by j.created_at desc, j.id desc limit 17';
  for branch in
    select * from (values
      ('analysis', 'analysis_finished_at', 'j.analysis_finished_at is not null'),
      ('completed', 'completed_at', 'j.analysis_finished_at is null and j.completed_at is not null'),
      ('legacy', 'updated_at', 'j.analysis_finished_at is null and j.completed_at is null')
    ) as parts(name, finish_column, date_scope)
  loop
    execute format('prepare %I(uuid, uuid, timestamptz, timestamptz, uuid, public.takeoff_job_status[]) as
      select j.id from public.takeoff_jobs j %s
      where j.tenant_id = $1 and j.launch_request_id is null and %s and j.%I > $3 and j.%I <= $4
        and (j.%I < $4 or j.id < $5) and not (j.status = any($6))
        and (j.status <> ''failed'' or j.execution_provider <> ''chatgpt_local'' or j.next_retry_at is null)
      order by j.%I desc, j.id desc limit 17',
      'progress_' || branch.name, join_project, branch.date_scope,
      branch.finish_column, branch.finish_column, branch.finish_column, branch.finish_column);
  end loop;
end;
$$;

create function pg_temp.progress_explain(query text)
returns jsonb language plpgsql as $$
declare
  explained jsonb;
begin
  execute 'explain (analyze, buffers, format json) ' || query into explained;
  return explained -> 0;
end;
$$;

create function pg_temp.progress_rows(plan jsonb)
returns bigint language sql as $$
  with recursive nodes(node) as (
    select plan -> 'Plan'
    union all
    select child from nodes cross join lateral jsonb_array_elements(nodes.node -> 'Plans') as children(child)
  )
  select coalesce(sum(
    ((node ->> 'Actual Rows')::bigint + coalesce((node ->> 'Rows Removed by Filter')::bigint, 0))
    * (node ->> 'Actual Loops')::bigint
  ), 0)::bigint
  from nodes where node ->> 'Relation Name' = 'takeoff_jobs'
$$;

set local request.jwt.claim.sub = '6c539000-0000-4000-8000-000000000001';
set local request.jwt.claims = '{"sub":"6c539000-0000-4000-8000-000000000001","role":"authenticated"}';
set local plan_cache_mode = force_generic_plan;
analyze public.takeoff_jobs;
analyze public.estimate_projects;
set local role authenticated;

create temp table progress_queries (label text primary key, command text not null, expected uuid[]) on commit drop;
insert into progress_queries
values ('live', format('execute progress_live(%L, %L, ''{pending,processing}'')',
                       pg_temp.progress_id(3), pg_temp.progress_id(1)), array[pg_temp.progress_id(100), pg_temp.progress_id(101)]);
insert into progress_queries
select branch || ' page ' || page,
       format('execute %I(%L, %L, %L, %L, %L, ''{pending,processing}'')', 'progress_' || branch,
              pg_temp.progress_id(3), pg_temp.progress_id(1), now() - interval '24 hours',
              case when page = 1 then now() else now() - interval '1 hour' end,
              case when page = 1 then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid else pg_temp.progress_id(number * 1000 + 3) end),
       array(select pg_temp.progress_id(number * 1000 + n)
             from generate_series(case when page = 1 then 2 else 1 end, case when page = 1 then 18 else 2 end) n
             order by n desc)
from (values ('analysis', 1), ('completed', 2), ('legacy', 3)) as branches(branch, number)
cross join generate_series(1, 2) as pages(page);

select is(public.current_tenant_id(), pg_temp.progress_id(3), 'the engineer uses the fixture as active tenant');
select ok(current_user = 'authenticated' and row_security_active('public.takeoff_jobs'),
          'execution plans use authenticated row security');
create temp table progress_small on commit drop as
select label, pg_temp.progress_explain(command) as plan from progress_queries;

reset role;
set local session_replication_role = replica;
-- Most history belongs to the other engineer. Every old finish has a recorded
-- completion time, as normal worker writes do. The fallback is exercised above.
insert into public.takeoff_jobs
  (id, tenant_id, project_id, estimate_version_id, created_by, level, status, created_at, updated_at, completed_at,
   analysis_finished_at, analysis_outcome, analysis_completion_event_id)
select pg_temp.progress_id(10000 + n), pg_temp.progress_id(3), pg_temp.progress_id(10 + scope), pg_temp.progress_id(20 + scope),
       pg_temp.progress_id(scope + 1), 'B', 'completed', now() - interval '3 years', now() - interval '2 years',
       now() - interval '2 years', case when n % 2 = 0 then now() - interval '2 years' end,
       case when n % 2 = 0 then 'success' end, case when n % 2 = 0 then gen_random_uuid() end
from generate_series(1, 32000) n
cross join lateral (select case when n % 2000 = 0 then 0 else 1 end) as project(scope);
set local session_replication_role = origin;
analyze public.takeoff_jobs;
set local role authenticated;

create temp table progress_large on commit drop as
select label, pg_temp.progress_explain(command) as plan from progress_queries;

create function pg_temp.progress_page(query text)
returns uuid[] language plpgsql as $$
declare
  job record;
  ids uuid[] := array[]::uuid[];
begin
  for job in execute query loop
    ids := array_append(ids, job.id);
  end loop;
  return ids;
end;
$$;

select is(pg_temp.progress_page(command), expected, label || ' returns the expected readable jobs in order')
from progress_queries order by label;
select cmp_ok(pg_temp.progress_rows(large.plan), '<=', 170::bigint,
              large.label || ' examines at most 170 jobs with 32,000 old ends')
from progress_large large order by large.label;
select cmp_ok(pg_temp.progress_rows(large.plan), '<=', pg_temp.progress_rows(small.plan) + 8,
              large.label || ' work stays bounded as the old history grows')
from progress_large large join progress_small small using (label) order by large.label;
select diag(format('%s: %s -> %s job rows, %s shared hit blocks, %s ms',
                   label, pg_temp.progress_rows(small.plan), pg_temp.progress_rows(large.plan),
                   large.plan #>> '{Plan,Shared Hit Blocks}', large.plan ->> 'Execution Time'))
from progress_large large join progress_small small using (label) order by label;

deallocate progress_live;
deallocate progress_analysis;
deallocate progress_completed;
deallocate progress_legacy;
select * from finish();
rollback;
