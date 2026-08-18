begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '8c000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'takeoff-atomic@example.test',
  crypt('test-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
);

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id = '8c000000-0000-4000-8000-000000000001';

insert into public.estimate_projects (
  id,
  tenant_id,
  user_id,
  name,
  is_archived
)
select
  '8c000000-0000-4000-8000-000000000010',
  membership.tenant_id,
  membership.user_id,
  'Atomic takeoff fixture',
  false
from public.tenant_memberships membership
where membership.user_id = '8c000000-0000-4000-8000-000000000001';

insert into public.estimate_versions (
  id,
  tenant_id,
  project_id,
  version_number,
  status,
  calc_engine_version
)
select
  fixture.id,
  project.tenant_id,
  project.id,
  fixture.version_number,
  'draft'::public.estimate_status,
  1
from public.estimate_projects project
cross join (
  values
    ('8c000000-0000-4000-8000-000000000011'::uuid, 1),
    ('8c000000-0000-4000-8000-000000000012'::uuid, 2),
    ('8c000000-0000-4000-8000-000000000013'::uuid, 3)
) as fixture(id, version_number)
where project.id = '8c000000-0000-4000-8000-000000000010';

insert into public.estimate_items (
  id,
  tenant_id,
  version_id,
  item_type,
  position,
  title
)
select
  fixture.id,
  version.tenant_id,
  version.id,
  'section'::public.estimate_item_type,
  0,
  fixture.title
from public.estimate_versions version
join (
  values
    (
      '8c000000-0000-4000-8000-000000000011'::uuid,
      '8c000000-0000-4000-8000-000000000021'::uuid,
      'Section append'
    ),
    (
      '8c000000-0000-4000-8000-000000000012'::uuid,
      '8c000000-0000-4000-8000-000000000022'::uuid,
      'Section rollback'
    ),
    (
      '8c000000-0000-4000-8000-000000000013'::uuid,
      '8c000000-0000-4000-8000-000000000023'::uuid,
      'Section replace'
    )
) as fixture(version_id, id, title)
  on fixture.version_id = version.id;

insert into public.estimate_items (
  id,
  tenant_id,
  version_id,
  parent_id,
  item_type,
  position,
  title,
  description,
  quantity,
  unit_price_ht_cents,
  tax_rate_bp,
  k_fo,
  h_mo,
  k_mo,
  pu_ht_cents,
  line_total_ht_cents,
  line_tax_cents,
  line_total_ttc_cents
)
select
  fixture.id,
  version.tenant_id,
  version.id,
  fixture.parent_id,
  'line'::public.estimate_item_type,
  1,
  fixture.title,
  'u',
  1,
  100,
  2000,
  1,
  0,
  1,
  100,
  100,
  20,
  120
from public.estimate_versions version
join (
  values
    (
      '8c000000-0000-4000-8000-000000000012'::uuid,
      '8c000000-0000-4000-8000-000000000022'::uuid,
      '8c000000-0000-4000-8000-000000000032'::uuid,
      'Ligne à préserver après rollback'
    ),
    (
      '8c000000-0000-4000-8000-000000000013'::uuid,
      '8c000000-0000-4000-8000-000000000023'::uuid,
      '8c000000-0000-4000-8000-000000000033'::uuid,
      'Ligne à préserver à la racine'
    )
) as fixture(version_id, parent_id, id, title)
  on fixture.version_id = version.id;

insert into public.takeoff_jobs (
  id,
  tenant_id,
  estimate_version_id,
  level,
  status,
  source_file_name,
  created_by
)
select
  fixture.id,
  version.tenant_id,
  version.id,
  'A'::public.takeoff_job_level,
  'completed'::public.takeoff_job_status,
  fixture.source_file_name,
  '8c000000-0000-4000-8000-000000000001'
from public.estimate_versions version
join (
  values
    (
      '8c000000-0000-4000-8000-000000000011'::uuid,
      '8c000000-0000-4000-8000-000000000041'::uuid,
      'append.pdf'
    ),
    (
      '8c000000-0000-4000-8000-000000000012'::uuid,
      '8c000000-0000-4000-8000-000000000042'::uuid,
      'rollback.pdf'
    ),
    (
      '8c000000-0000-4000-8000-000000000013'::uuid,
      '8c000000-0000-4000-8000-000000000043'::uuid,
      'replace.pdf'
    )
) as fixture(version_id, id, source_file_name)
  on fixture.version_id = version.id;

insert into public.takeoff_items (
  id,
  tenant_id,
  job_id,
  designation,
  quantity,
  unit,
  confidence,
  evidence,
  source_file_name,
  source_page
)
select
  fixture.id,
  job.tenant_id,
  job.id,
  fixture.designation,
  fixture.quantity,
  fixture.unit,
  0.95,
  'Repère localisé',
  job.source_file_name,
  1
from public.takeoff_jobs job
join (
  values
    (
      '8c000000-0000-4000-8000-000000000041'::uuid,
      '8c000000-0000-4000-8000-000000000051'::uuid,
      'Tube cuivre',
      2::numeric,
      'ml'
    ),
    (
      '8c000000-0000-4000-8000-000000000042'::uuid,
      '8c000000-0000-4000-8000-000000000052'::uuid,
      'Ensemble robinetterie',
      1::numeric,
      'ens'
    ),
    (
      '8c000000-0000-4000-8000-000000000043'::uuid,
      '8c000000-0000-4000-8000-000000000053'::uuid,
      'Tube acier',
      3::numeric,
      'ml'
    )
) as fixture(job_id, id, designation, quantity, unit)
  on fixture.job_id = job.id;

insert into public.estimate_assemblies (
  id,
  tenant_id,
  created_by,
  name
)
select
  '8c000000-0000-4000-8000-000000000061',
  membership.tenant_id,
  membership.user_id,
  'Assemblée rollback'
from public.tenant_memberships membership
where membership.user_id = '8c000000-0000-4000-8000-000000000001';

insert into public.estimate_assembly_items (
  id,
  tenant_id,
  assembly_id,
  title,
  unit,
  default_quantity,
  position,
  cost_type,
  unit_cost_ht_cents
)
select
  '8c000000-0000-4000-8000-000000000062',
  assembly.tenant_id,
  assembly.id,
  'Robinet',
  'u',
  1,
  1,
  'material',
  500
from public.estimate_assemblies assembly
where assembly.id = '8c000000-0000-4000-8000-000000000061';

insert into public.draft_locks (
  version_id,
  user_id,
  tenant_id,
  expires_at,
  session_id
)
select
  version.id,
  '8c000000-0000-4000-8000-000000000001',
  version.tenant_id,
  statement_timestamp() + interval '30 minutes',
  gen_random_uuid()
from public.estimate_versions version
where version.id in (
  '8c000000-0000-4000-8000-000000000011',
  '8c000000-0000-4000-8000-000000000012',
  '8c000000-0000-4000-8000-000000000013'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '8c000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$
    create temporary table _takeoff_atomic_apply_result
    on commit drop
    as
    select * from public.apply_takeoff_job_guarded_atomic(
      '8c000000-0000-4000-8000-000000000041',
      'append',
      '8c000000-0000-4000-8000-000000000021',
      '[{
        "item_id":"8c000000-0000-4000-8000-000000000051",
        "source_order":0,
        "rule_id":null,
        "action":"set_price",
        "designation":"Tube cuivre",
        "unit_price_cents":2500,
        "category_id":null,
        "assembly_id":null
      }]'::jsonb
    )
  $$,
  'atomic apply commits the line and its selected price together'
);

select is(
  (
    select result.item_links -> 0 ->> 'takeoff_item_id'
    from pg_temp._takeoff_atomic_apply_result as result
  ),
  '8c000000-0000-4000-8000-000000000051',
  'the atomic result links the source takeoff item to its estimate line'
);

select is(
  (
    select result.item_links -> 0 ->> 'estimate_item_id'
    from pg_temp._takeoff_atomic_apply_result as result
  ),
  (
    select item.id::text
    from public.estimate_items as item
    where item.source_job_id = '8c000000-0000-4000-8000-000000000041'
      and item.item_type = 'line'
  ),
  'the returned estimate line id is the committed line'
);

select is(
  (
    select item.unit_price_ht_cents
    from public.estimate_items item
    where item.source_job_id = '8c000000-0000-4000-8000-000000000041'
      and item.item_type = 'line'
  ),
  2500,
  'the committed estimate line carries the mapping price'
);

select is(
  (
    select job.status::text
    from public.takeoff_jobs job
    where job.id = '8c000000-0000-4000-8000-000000000041'
  ),
  'applied',
  'the takeoff job becomes applied in the same transaction'
);

reset role;

drop table if exists pg_temp._takeoff_apply_source;
drop table if exists pg_temp._takeoff_apply_created_ids;
drop table if exists pg_temp._takeoff_apply_matches;
drop table if exists pg_temp._takeoff_apply_unmatched;

create or replace function pg_temp.fail_atomic_assembly_metadata()
returns trigger
language plpgsql
as $$
begin
  if new.source_metadata ->> 'mapping_action' = 'apply_assembly' then
    raise exception 'TEST_ATOMIC_ASSEMBLY_FAILURE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger test_fail_atomic_assembly_metadata
  before update on public.estimate_items
  for each row
  execute function pg_temp.fail_atomic_assembly_metadata();

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '8c000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$
    select *
    from public.apply_takeoff_job_guarded_atomic(
      '8c000000-0000-4000-8000-000000000042',
      'append',
      '8c000000-0000-4000-8000-000000000022',
      '[{
        "item_id":"8c000000-0000-4000-8000-000000000052",
        "source_order":0,
        "rule_id":null,
        "action":"apply_assembly",
        "designation":"Ensemble robinetterie",
        "unit_price_cents":null,
        "category_id":null,
        "assembly_id":"8c000000-0000-4000-8000-000000000061"
      }]'::jsonb
    )
  $$,
  'P0001',
  'TEST_ATOMIC_ASSEMBLY_FAILURE',
  'a post-materialization failure aborts the whole apply statement'
);

select is(
  (
    select count(*)::integer
    from public.estimate_items item
    where item.source_job_id = '8c000000-0000-4000-8000-000000000042'
  ),
  0,
  'no raw or assembly estimate line survives the failed apply'
);

select is(
  (
    select job.status::text
    from public.takeoff_jobs job
    where job.id = '8c000000-0000-4000-8000-000000000042'
  ),
  'completed',
  'the failed job remains reviewable and can be retried'
);

select is(
  (
    select item.is_excluded
    from public.takeoff_items item
    where item.id = '8c000000-0000-4000-8000-000000000052'
  ),
  false,
  'the source measurement exclusion is rolled back too'
);

select ok(
  exists (
    select 1
    from public.estimate_items item
    where item.id = '8c000000-0000-4000-8000-000000000032'
  ),
  'pre-existing estimate content survives the failed apply'
);

select throws_ok(
  $$
    select *
    from public.apply_takeoff_job_guarded_atomic(
      '8c000000-0000-4000-8000-000000000043',
      'replace',
      null,
      '[{
        "item_id":"8c000000-0000-4000-8000-000000000053",
        "source_order":0,
        "rule_id":null,
        "action":"none",
        "designation":"Tube acier",
        "unit_price_cents":null,
        "category_id":null,
        "assembly_id":null
      }]'::jsonb
    )
  $$,
  '22023',
  'TAKEOFF_ROOT_REPLACE_DISABLED',
  'version-root replacement is disabled before any deletion'
);

select ok(
  exists (
    select 1
    from public.estimate_items item
    where item.id = '8c000000-0000-4000-8000-000000000033'
  ),
  'root content remains intact after a rejected replacement'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_takeoff_job(uuid,text,uuid)',
    'EXECUTE'
  ),
  'authenticated callers cannot bypass the atomic apply through the legacy RPC'
);

reset role;

select is(
  (
    select public.takeoff_allocate_pro_rata(5, array[1::bigint])
  ),
  array[5::bigint],
  'single-line allocation never indexes outside its one-element array'
);

set local role service_role;
select lives_ok(
  $$
    select *
    from public.record_takeoff_dispatch_outcome(
      '8c000000-0000-4000-8000-000000000043',
      'create',
      '8c000000-0000-4000-8000-000000000071',
      'timeout',
      null
    )
  $$,
  'service role persists a failed immediate dispatch'
);

select is(
  (
    select job.dispatch_status
    from public.takeoff_jobs job
    where job.id = '8c000000-0000-4000-8000-000000000043'
  ),
  'trigger_failed',
  'a timeout remains visible as trigger_failed after reload'
);

select lives_ok(
  $$
    select *
    from public.record_takeoff_dispatch_outcome(
      '8c000000-0000-4000-8000-000000000043',
      'create',
      '8c000000-0000-4000-8000-000000000071',
      'accepted',
      null
    )
  $$,
  'the worker receipt resolves the delayed-start warning'
);

select is(
  (
    select job.dispatch_status
    from public.takeoff_jobs job
    where job.id = '8c000000-0000-4000-8000-000000000043'
  ),
  'started',
  'the durable dispatch state records the actual worker start'
);

select lives_ok(
  $$
    select *
    from public.record_takeoff_dispatch_outcome(
      '8c000000-0000-4000-8000-000000000043',
      'create',
      '8c000000-0000-4000-8000-000000000071',
      'timeout',
      null
    )
  $$,
  'a late timeout result is accepted without racing the worker receipt'
);

select is(
  (
    select job.dispatch_status || ':' || job.dispatch_outcome
    from public.takeoff_jobs job
    where job.id = '8c000000-0000-4000-8000-000000000043'
  ),
  'started:accepted',
  'a late timeout cannot downgrade a confirmed worker start'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '8c000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$
    select *
    from public.record_takeoff_dispatch_outcome(
      '8c000000-0000-4000-8000-000000000043',
      'create',
      '8c000000-0000-4000-8000-000000000072',
      'accepted',
      202
    )
  $$,
  '42501',
  'permission denied for function record_takeoff_dispatch_outcome',
  'authenticated clients cannot forge the durable dispatch state'
);

select * from finish();
rollback;
