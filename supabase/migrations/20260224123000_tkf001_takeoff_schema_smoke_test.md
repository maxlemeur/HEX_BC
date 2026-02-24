# TKF-001 smoke test (Dev/QA)

Run this script after applying `20260224123000_tkf001_takeoff_schema.sql`.

- Recommended context: Supabase SQL editor as `postgres`/service role.
- Coverage:
  - Structural checks (enums, tables, indexes, policies, triggers)
  - RLS checks with two tenants/users (transactional + rollback)

```sql
-- TKF-001 smoke test (Dev/QA)
-- Run after applying: 20260224123000_tkf001_takeoff_schema.sql
-- Recommended context: Supabase SQL editor as postgres/service role.
--
-- This script has 2 parts:
-- 1) Structural checks (enums, tables, indexes, policies, triggers)
-- 2) RLS checks with two tenants/users (transactional + rollback)

-- ---------------------------------------------------------------------------
-- 1) Structural checks
-- ---------------------------------------------------------------------------

-- Enums must exist with exact values.
select
  t.typname as enum_name,
  string_agg(e.enumlabel, ', ' order by e.enumsortorder) as enum_values
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typnamespace = 'public'::regnamespace
  and t.typname in ('takeoff_job_level', 'takeoff_job_status')
group by t.typname
order by t.typname;

-- Tables must exist.
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in ('takeoff_jobs', 'takeoff_results', 'takeoff_items')
order by tablename;

-- RLS must be enabled.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('takeoff_jobs', 'takeoff_results', 'takeoff_items')
order by relname;

-- 4 policies per table expected (SELECT/INSERT/UPDATE/DELETE).
select tablename, count(*) as policy_count
from pg_policies
where schemaname = 'public'
  and tablename in ('takeoff_jobs', 'takeoff_results', 'takeoff_items')
group by tablename
order by tablename;

-- Required indexes must exist.
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'takeoff_jobs_tenant_status_created_at_idx',
    'takeoff_jobs_tenant_estimate_version_idx',
    'takeoff_results_tenant_job_idx',
    'takeoff_items_tenant_job_excluded_verified_idx'
  )
order by indexname;

-- Updated-at triggers must exist.
select tgname as trigger_name, c.relname as table_name
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
where not tg.tgisinternal
  and c.relnamespace = 'public'::regnamespace
  and tg.tgname in (
    'set_takeoff_jobs_updated_at',
    'set_takeoff_results_updated_at',
    'set_takeoff_items_updated_at'
  )
order by tg.tgname;

-- ---------------------------------------------------------------------------
-- 2) RLS checks (cross-tenant blocked)
-- ---------------------------------------------------------------------------
-- Preconditions for this block:
-- - At least 2 tenants
-- - For each tenant, at least 1 membership (user_id)
-- - For each tenant, at least 1 estimate_version linked to that user's project
-- The block auto-discovers candidates and aborts with a clear message if missing.

begin;

create temp table _tkf_ctx on commit drop as
with candidates as (
  select
    tm.tenant_id,
    tm.user_id,
    ev.id as estimate_version_id,
    row_number() over (
      partition by tm.tenant_id
      order by ev.created_at desc, ev.id
    ) as tenant_row
  from public.tenant_memberships tm
  join public.estimate_projects ep
    on ep.tenant_id = tm.tenant_id
   and ep.user_id = tm.user_id
  join public.estimate_versions ev
    on ev.project_id = ep.id
   and ev.tenant_id = ep.tenant_id
),
picked as (
  select tenant_id, user_id, estimate_version_id
  from candidates
  where tenant_row = 1
),
ranked as (
  select
    tenant_id,
    user_id,
    estimate_version_id,
    row_number() over (order by tenant_id, user_id) as tenant_rank
  from picked
)
select
  (select tenant_id from ranked where tenant_rank = 1) as tenant_a_id,
  (select user_id from ranked where tenant_rank = 1) as user_a_id,
  (select estimate_version_id from ranked where tenant_rank = 1) as estimate_version_a_id,
  (select tenant_id from ranked where tenant_rank = 2) as tenant_b_id,
  (select user_id from ranked where tenant_rank = 2) as user_b_id,
  (select estimate_version_id from ranked where tenant_rank = 2) as estimate_version_b_id;

do $$
begin
  if exists (
    select 1
    from _tkf_ctx
    where tenant_a_id is null
      or user_a_id is null
      or estimate_version_a_id is null
      or tenant_b_id is null
      or user_b_id is null
      or estimate_version_b_id is null
  ) then
    raise exception
      using
        errcode = 'P0001',
        message = 'TKF_SMOKE_PRECONDITIONS_NOT_MET',
        detail = 'Need 2 tenants with tenant member users and at least 1 estimate_version each.';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- User A context.
select set_config(
  'request.jwt.claim.sub',
  (select user_a_id::text from _tkf_ctx),
  true
);

create temp table _tkf_a_job on commit drop as
with inserted as (
  insert into public.takeoff_jobs (
    tenant_id,
    estimate_version_id,
    level,
    status,
    source_file_name,
    created_by
  )
  select
    tenant_a_id,
    estimate_version_a_id,
    'A'::public.takeoff_job_level,
    'pending'::public.takeoff_job_status,
    'tkf-smoke-a.csv',
    user_a_id
  from _tkf_ctx
  returning id
)
select id
from inserted;

create temp table _tkf_a_result on commit drop as
with inserted as (
  insert into public.takeoff_results (
    tenant_id,
    job_id,
    extracted_json,
    warnings,
    confidence
  )
  select
    tenant_a_id,
    (select id from _tkf_a_job limit 1),
    '{"items":[]}'::jsonb,
    '[]'::jsonb,
    0.95
  from _tkf_ctx
  returning id
)
select id
from inserted;

insert into public.takeoff_items (
  tenant_id,
  job_id,
  result_id,
  designation,
  quantity,
  unit,
  confidence,
  is_excluded,
  is_verified
)
select
  tenant_a_id,
  (select id from _tkf_a_job limit 1),
  (select id from _tkf_a_result limit 1),
  'Tube cuivre',
  12.500,
  'ml',
  0.87,
  false,
  false
from _tkf_ctx;

-- User B context.
select set_config(
  'request.jwt.claim.sub',
  (select user_b_id::text from _tkf_ctx),
  true
);

-- B must not see A data.
select count(*) as tenant_b_visible_jobs_from_tenant_a
from public.takeoff_jobs
where id = (select id from _tkf_a_job limit 1);

-- B cross-tenant INSERT (tenant_a_id) must be blocked.
do $$
declare
  blocked boolean := false;
begin
  begin
    insert into public.takeoff_jobs (
      tenant_id,
      estimate_version_id,
      level,
      status,
      source_file_name,
      created_by
    )
    select
      tenant_a_id,
      estimate_version_a_id,
      'A'::public.takeoff_job_level,
      'pending'::public.takeoff_job_status,
      'tkf-smoke-cross-tenant.csv',
      user_b_id
    from _tkf_ctx;
  exception
    when others then
      blocked := true;
  end;

  if not blocked then
    raise exception
      using
        errcode = 'P0001',
        message = 'TKF_SMOKE_EXPECTED_INSERT_BLOCKED',
        detail = 'Cross-tenant INSERT was expected to fail but it succeeded.';
  end if;
end
$$;

-- B UPDATE/DELETE on A rows must affect 0 rows.
with updated_rows as (
  update public.takeoff_jobs
  set status = 'canceled'::public.takeoff_job_status
  where id = (select id from _tkf_a_job limit 1)
  returning 1
)
select count(*) as tenant_b_updated_rows_on_tenant_a_job
from updated_rows;

with deleted_rows as (
  delete from public.takeoff_jobs
  where id = (select id from _tkf_a_job limit 1)
  returning 1
)
select count(*) as tenant_b_deleted_rows_on_tenant_a_job
from deleted_rows;

-- B own-tenant INSERT should succeed.
create temp table _tkf_b_job on commit drop as
with inserted as (
  insert into public.takeoff_jobs (
    tenant_id,
    estimate_version_id,
    level,
    status,
    source_file_name,
    created_by
  )
  select
    tenant_b_id,
    estimate_version_b_id,
    'B'::public.takeoff_job_level,
    'pending'::public.takeoff_job_status,
    'tkf-smoke-b.pdf',
    user_b_id
  from _tkf_ctx
  returning id
)
select id
from inserted;

select count(*) as tenant_b_visible_own_job
from public.takeoff_jobs
where id = (select id from _tkf_b_job limit 1);

rollback;

-- Expected quick checks in results:
-- - tenant_b_visible_jobs_from_tenant_a = 0
-- - tenant_b_updated_rows_on_tenant_a_job = 0
-- - tenant_b_deleted_rows_on_tenant_a_job = 0
-- - tenant_b_visible_own_job = 1
-- - transaction rolled back, no permanent test data
```
