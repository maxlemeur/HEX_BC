# TKF-017 smoke test (Dev/QA)

Run this script after applying `20260224203000_tkf017_takeoff_plans.sql`.

- Recommended context: Supabase SQL editor as `postgres`/service role.
- Coverage:
  - Structural checks (`plan_sets`, `plan_files`, RLS, policies, indexes, triggers)
  - RLS cross-tenant checks (A inserts set/file, B cannot read A, cross-tenant inserts blocked)
  - Cascade delete check (`delete plan_set` removes linked `plan_files`)
  - Storage path coherence checks for bucket `plan-files` via `pg_policies` and `pg_get_expr`

```sql
-- TKF-017 smoke test (Dev/QA)
-- Run after applying: 20260224203000_tkf017_takeoff_plans.sql
-- Recommended context: Supabase SQL editor as postgres/service role.
--
-- This script has 4 parts:
-- 1) Structural checks (tables, RLS, policies, indexes, triggers)
-- 2) RLS checks (cross-tenant blocked) with transactional rollback
-- 3) Cascade delete check (plan_sets -> plan_files)
-- 4) Storage policy coherence checks on storage.objects for bucket 'plan-files'

-- ---------------------------------------------------------------------------
-- 1) Structural checks
-- ---------------------------------------------------------------------------

-- Tables must exist.
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in ('plan_sets', 'plan_files')
order by tablename;

-- Required columns for TKF-017 must exist.
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'plan_sets' and column_name in (
      'id', 'created_at', 'updated_at', 'tenant_id', 'estimate_version_id',
      'name', 'description', 'metadata', 'created_by'
    ))
    or
    (table_name = 'plan_files' and column_name in (
      'id', 'created_at', 'updated_at', 'tenant_id', 'plan_set_id',
      'file_path', 'file_name', 'file_type', 'file_size_bytes',
      'page_count', 'file_hash', 'metadata', 'created_by'
    ))
  )
order by table_name, ordinal_position;

-- FK plan_files.plan_set_id -> plan_sets.id must be ON DELETE CASCADE.
select
  conname as fk_name,
  pg_get_constraintdef(oid) as fk_definition
from pg_constraint
where conrelid = 'public.plan_files'::regclass
  and contype = 'f'
  and conname = 'plan_files_plan_set_id_fkey';

-- RLS must be enabled and forced.
select
  relname as table_name,
  relrowsecurity as rls_enabled,
  relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('plan_sets', 'plan_files')
order by relname;

-- 4 policies per table expected (SELECT/INSERT/UPDATE/DELETE).
select
  tablename,
  count(*) as policy_count
from pg_policies
where schemaname = 'public'
  and tablename in ('plan_sets', 'plan_files')
group by tablename
order by tablename;

-- Policy command coverage should include r/a/w/d.
select
  tablename,
  cmd,
  count(*) as per_cmd_count
from pg_policies
where schemaname = 'public'
  and tablename in ('plan_sets', 'plan_files')
group by tablename, cmd
order by tablename, cmd;

-- Required indexes must exist.
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'plan_sets_tenant_estimate_version_created_at_idx',
    'plan_files_tenant_plan_set_created_at_idx',
    'plan_files_file_hash_idx',
    'plan_sets_estimate_version_id_idx',
    'plan_sets_created_by_idx',
    'plan_files_plan_set_id_idx',
    'plan_files_created_by_idx'
  )
order by indexname;

-- Index definitions should match expected shape.
select
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'plan_sets_tenant_estimate_version_created_at_idx'
      and indexdef ilike '%(tenant_id, estimate_version_id, created_at desc)%'
  ) as plan_sets_composite_index_ok,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'plan_files_tenant_plan_set_created_at_idx'
      and indexdef ilike '%(tenant_id, plan_set_id, created_at desc)%'
  ) as plan_files_composite_index_ok,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'plan_files_file_hash_idx'
      and indexdef ilike '%(file_hash)%'
      and indexdef ilike '%where (file_hash is not null)%'
  ) as plan_files_file_hash_partial_index_ok,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'plan_sets_estimate_version_id_idx'
      and indexdef ilike '%(estimate_version_id)%'
  ) as plan_sets_fk_index_ok,
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'plan_files_plan_set_id_idx'
      and indexdef ilike '%(plan_set_id)%'
  ) as plan_files_fk_index_ok;

-- Updated-at + tenant assignment triggers must exist.
select
  tg.tgname as trigger_name,
  c.relname as table_name,
  p.proname as trigger_function
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_proc p on p.oid = tg.tgfoid
where not tg.tgisinternal
  and c.relnamespace = 'public'::regnamespace
  and tg.tgname in (
    'set_plan_sets_updated_at',
    'set_plan_files_updated_at',
    'set_plan_sets_tenant_id',
    'set_plan_files_tenant_id'
  )
order by tg.tgname;

-- Bucket must exist with expected id.
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'plan-files';

-- ---------------------------------------------------------------------------
-- 2) RLS checks (cross-tenant blocked) + 3) Cascade delete check
-- ---------------------------------------------------------------------------
-- Preconditions for this block:
-- - At least 2 tenants
-- - At least 1 user context per tenant where current_tenant_id() is deterministic
-- - At least 1 estimate_version accessible by each selected user
-- This block auto-discovers candidates and aborts with a clear message if missing.

begin;

create temp table _tkf_ctx on commit drop as
with membership_candidates as (
  select
    tm.tenant_id,
    tm.user_id,
    tm.is_default,
    count(*) over (partition by tm.user_id) as membership_count
  from public.tenant_memberships tm
),
tenant_user_candidates as (
  select
    mc.tenant_id,
    mc.user_id,
    ev.id as estimate_version_id,
    row_number() over (
      partition by mc.tenant_id
      order by ev.created_at desc, ev.id
    ) as tenant_row
  from membership_candidates mc
  join public.estimate_projects ep
    on ep.tenant_id = mc.tenant_id
   and ep.user_id = mc.user_id
  join public.estimate_versions ev
    on ev.project_id = ep.id
   and ev.tenant_id = ep.tenant_id
  where mc.membership_count = 1
     or mc.is_default
),
picked as (
  select
    tenant_id,
    user_id,
    estimate_version_id
  from tenant_user_candidates
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
      or tenant_a_id = tenant_b_id
      or user_a_id = user_b_id
  ) then
    raise exception
      using
        errcode = 'P0001',
        message = 'TKF017_SMOKE_PRECONDITIONS_NOT_MET',
        detail = 'Need 2 distinct tenants, 2 distinct users, and 1 accessible estimate_version per tenant.';
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

-- A inserts one plan_set.
create temp table _tkf_a_set on commit drop as
with inserted as (
  insert into public.plan_sets (
    tenant_id,
    estimate_version_id,
    name,
    description,
    metadata
  )
  select
    tenant_a_id,
    estimate_version_a_id,
    'Smoke set tenant A',
    'Set cree pendant le smoke test',
    jsonb_build_object('smoke_test', true)
  from _tkf_ctx
  returning id
)
select id
from inserted;

-- A inserts one plan_file in that set.
create temp table _tkf_a_file on commit drop as
with seeded as (
  select gen_random_uuid() as file_id
),
inserted as (
  insert into public.plan_files (
    id,
    tenant_id,
    plan_set_id,
    file_path,
    file_name,
    file_type,
    file_size_bytes,
    page_count,
    file_hash,
    metadata
  )
  select
    seeded.file_id,
    ctx.tenant_a_id,
    (select id from _tkf_a_set limit 1),
    format(
      '%s/%s/%s/%s',
      ctx.tenant_a_id::text,
      (select id from _tkf_a_set limit 1)::text,
      seeded.file_id::text,
      'a-plan.pdf'
    ),
    'a-plan.pdf',
    'application/pdf',
    1048576,
    2,
    md5(seeded.file_id::text),
    jsonb_build_object('smoke_test', true, 'owner', 'tenant_a')
  from _tkf_ctx ctx
  cross join seeded
  returning id, file_path
)
select id, file_path
from inserted;

-- User B context.
select set_config(
  'request.jwt.claim.sub',
  (select user_b_id::text from _tkf_ctx),
  true
);

-- B must not see A plan_set/plan_file.
select count(*) as tenant_b_visible_plan_sets_from_tenant_a
from public.plan_sets
where id = (select id from _tkf_a_set limit 1);

select count(*) as tenant_b_visible_plan_files_from_tenant_a
from public.plan_files
where id = (select id from _tkf_a_file limit 1);

-- B cross-tenant INSERT on plan_sets must be blocked.
do $$
declare
  blocked boolean := false;
begin
  begin
    insert into public.plan_sets (
      tenant_id,
      estimate_version_id,
      name
    )
    select
      tenant_a_id,
      estimate_version_a_id,
      'Cross-tenant forbidden set'
    from _tkf_ctx;
  exception
    when others then
      blocked := true;
  end;

  if not blocked then
    raise exception
      using
        errcode = 'P0001',
        message = 'TKF017_SMOKE_EXPECTED_SET_INSERT_BLOCKED',
        detail = 'Cross-tenant INSERT on plan_sets was expected to fail but it succeeded.';
  end if;
end
$$;

-- B cross-tenant INSERT on plan_files must be blocked.
do $$
declare
  blocked boolean := false;
  cross_file_id uuid := gen_random_uuid();
begin
  begin
    insert into public.plan_files (
      id,
      tenant_id,
      plan_set_id,
      file_path,
      file_name,
      file_type,
      file_size_bytes,
      page_count,
      metadata
    )
    select
      cross_file_id,
      tenant_a_id,
      (select id from _tkf_a_set limit 1),
      format(
        '%s/%s/%s/%s',
        tenant_a_id::text,
        (select id from _tkf_a_set limit 1)::text,
        cross_file_id::text,
        'b-cross-tenant.pdf'
      ),
      'b-cross-tenant.pdf',
      'application/pdf',
      2048,
      1,
      '{}'::jsonb
    from _tkf_ctx;
  exception
    when others then
      blocked := true;
  end;

  if not blocked then
    raise exception
      using
        errcode = 'P0001',
        message = 'TKF017_SMOKE_EXPECTED_FILE_INSERT_BLOCKED',
        detail = 'Cross-tenant INSERT on plan_files was expected to fail but it succeeded.';
  end if;
end
$$;

-- B UPDATE on A plan_file must affect 0 rows.
with updated_rows as (
  update public.plan_files
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('hijack', true)
  where id = (select id from _tkf_a_file limit 1)
  returning 1
)
select count(*) as tenant_b_updated_rows_on_tenant_a_plan_file
from updated_rows;

-- Back to user A for cascade delete check.
select set_config(
  'request.jwt.claim.sub',
  (select user_a_id::text from _tkf_ctx),
  true
);

-- Deleting plan_set must cascade-delete linked plan_files.
with deleted_set as (
  delete from public.plan_sets
  where id = (select id from _tkf_a_set limit 1)
  returning id
)
select count(*) as tenant_a_deleted_plan_set_rows
from deleted_set;

select count(*) as remaining_plan_files_after_plan_set_delete
from public.plan_files
where id = (select id from _tkf_a_file limit 1);

rollback;

-- Expected quick checks in results:
-- - tenant_b_visible_plan_sets_from_tenant_a = 0
-- - tenant_b_visible_plan_files_from_tenant_a = 0
-- - tenant_b_updated_rows_on_tenant_a_plan_file = 0
-- - tenant_a_deleted_plan_set_rows = 1
-- - remaining_plan_files_after_plan_set_delete = 0
-- - transaction rolled back, no permanent test data

-- ---------------------------------------------------------------------------
-- 4) Storage policy coherence checks (bucket + path segments)
-- ---------------------------------------------------------------------------

-- Storage policies related to plan files (raw view from pg_policies).
select
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname ilike '%plan files storage%'
order by policyname;

-- Storage policy count/commands for plan-files should cover SELECT/INSERT/UPDATE/DELETE.
select
  cmd,
  count(*) as policy_count
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname ilike '%plan files storage%'
group by cmd
order by cmd;

-- Parse expressions with pg_get_expr and validate presence of bucket/path guards.
with policy_exprs as (
  select
    p.polname as policy_name,
    case p.polcmd
      when 'r' then 'SELECT'
      when 'a' then 'INSERT'
      when 'w' then 'UPDATE'
      when 'd' then 'DELETE'
      else p.polcmd::text
    end as command,
    coalesce(pg_get_expr(p.polqual, p.polrelid), '') as using_expr,
    coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as with_check_expr
  from pg_policy p
  where p.polrelid = 'storage.objects'::regclass
    and p.polname ilike '%plan files storage%'
)
select
  policy_name,
  command,
  position('bucket_id = ''plan-files''' in (using_expr || ' ' || with_check_expr)) > 0 as has_bucket_guard,
  position('(storage.foldername(objects.name))[1]' in (using_expr || ' ' || with_check_expr)) > 0 as has_tenant_segment_guard,
  position('(storage.foldername(objects.name))[2]' in (using_expr || ' ' || with_check_expr)) > 0 as has_plan_set_segment_guard,
  position('(storage.foldername(objects.name))[3]' in (using_expr || ' ' || with_check_expr)) > 0 as has_plan_file_segment_guard,
  position('array_length(storage.foldername(objects.name), 1)' in (using_expr || ' ' || with_check_expr)) > 0 as has_path_depth_guard,
  position('storage.filename(objects.name)' in (using_expr || ' ' || with_check_expr)) > 0 as has_filename_guard,
  ((using_expr || ' ' || with_check_expr) ~* 'or\\s+not\\s+exists\\s*\\(') as has_orphan_cleanup_fallback
from policy_exprs
order by command, policy_name;

-- Expected quick checks in results:
-- - has_bucket_guard = true on all 4 policies
-- - has_tenant_segment_guard = true on all 4 policies
-- - has_plan_set_segment_guard = true on all 4 policies
-- - has_plan_file_segment_guard = true on all 4 policies
-- - has_path_depth_guard = true on all 4 policies
-- - has_orphan_cleanup_fallback = true on DELETE policy
```
