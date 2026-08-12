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
  '71000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'estimate-calc-governance@example.test',
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
),
(
  '00000000-0000-0000-0000-000000000000',
  '71000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'estimate-calc-foreign-import@example.test',
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
),
(
  '00000000-0000-0000-0000-000000000000',
  '71000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'estimate-calc-reviewer@example.test',
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
where user_id = '71000000-0000-4000-8000-000000000001';

update public.tenant_memberships
set is_default = false
where user_id = '71000000-0000-4000-8000-000000000003';

insert into public.tenant_memberships (
  id,
  tenant_id,
  user_id,
  role,
  is_default
)
select
  '71000000-0000-4000-8000-000000000059',
  owner_membership.tenant_id,
  '71000000-0000-4000-8000-000000000003',
  'admin'::public.tenant_role,
  true
from public.tenant_memberships as owner_membership
where owner_membership.user_id = '71000000-0000-4000-8000-000000000001';

insert into public.estimate_projects (
  id,
  tenant_id,
  user_id,
  name,
  is_archived
)
select
  '71000000-0000-4000-8000-000000000010',
  membership.tenant_id,
  membership.user_id,
  'Calc governance source project',
  false
from public.tenant_memberships as membership
where membership.user_id = '71000000-0000-4000-8000-000000000001';

insert into public.estimate_projects (
  id,
  tenant_id,
  user_id,
  name,
  is_archived
)
select
  '72000000-0000-4000-8000-000000000010',
  membership.tenant_id,
  membership.user_id,
  'Tiered effective margin fixture',
  false
from public.tenant_memberships membership
where membership.user_id = '71000000-0000-4000-8000-000000000001';

insert into public.estimate_versions (
  id,
  tenant_id,
  project_id,
  version_number,
  status,
  calc_engine_version,
  margin_mode,
  margin_multiplier,
  margin_bp,
  total_ht_cents,
  total_tax_cents,
  total_ttc_cents
)
select
  '72000000-0000-4000-8000-000000000011',
  project.tenant_id,
  project.id,
  1,
  'draft'::public.estimate_status,
  2,
  'tiered'::public.estimate_margin_mode,
  1.25,
  9999,
  160,
  32,
  192
from public.estimate_projects project
where project.id = '72000000-0000-4000-8000-000000000010';

insert into public.estimate_items (
  id,
  tenant_id,
  version_id,
  item_type,
  position,
  title
)
select
  '72000000-0000-4000-8000-000000000013',
  version.tenant_id,
  version.id,
  'section'::public.estimate_item_type,
  0,
  'Tiered default margin section'
from public.estimate_versions version
where version.id = '72000000-0000-4000-8000-000000000011';

insert into public.estimate_items (
  id,
  tenant_id,
  version_id,
  parent_id,
  item_type,
  position,
  title,
  quantity,
  unit_price_ht_cents,
  tax_rate_bp,
  k_fo,
  h_mo,
  h_mo_majoration,
  k_mo,
  pu_ht_cents,
  line_total_ht_cents,
  line_tax_cents,
  line_total_ttc_cents
)
select
  '72000000-0000-4000-8000-000000000012',
  version.tenant_id,
  version.id,
  '72000000-0000-4000-8000-000000000013',
  'line'::public.estimate_item_type,
  1,
  'Tiered default margin line',
  1,
  100,
  2000,
  1,
  0,
  1,
  1,
  160,
  160,
  32,
  192
from public.estimate_versions version
where version.id = '72000000-0000-4000-8000-000000000011';

insert into public.labor_roles (
  id,
  tenant_id,
  user_id,
  name,
  hourly_rate_cents,
  is_active,
  position
)
select
  '71000000-0000-4000-8000-000000000060',
  membership.tenant_id,
  membership.user_id,
  'Owner A role',
  5000,
  true,
  1
from public.tenant_memberships as membership
where membership.user_id = '71000000-0000-4000-8000-000000000001';

insert into public.labor_roles (
  id,
  tenant_id,
  user_id,
  name,
  hourly_rate_cents,
  is_active,
  position
)
select
  '71000000-0000-4000-8000-000000000067',
  membership.tenant_id,
  membership.user_id,
  'Legacy v1 disposable role',
  4200,
  true,
  2
from public.tenant_memberships as membership
where membership.user_id = '71000000-0000-4000-8000-000000000001';

-- These rows model data that predates the v2 creation contract. In
-- particular, the sent and accepted rows must remain pinned to v1.
insert into public.estimate_versions (
  id,
  tenant_id,
  project_id,
  version_number,
  status,
  calc_engine_version,
  seal_hash
)
select
  fixture.id,
  project.tenant_id,
  project.id,
  fixture.version_number,
  fixture.status,
  fixture.calc_engine_version,
  fixture.seal_hash
from public.estimate_projects as project
cross join (
  values
    (
      '71000000-0000-4000-8000-000000000101'::uuid,
      1,
      'draft'::public.estimate_status,
      1::smallint,
      null::text
    ),
    (
      '71000000-0000-4000-8000-000000000102'::uuid,
      2,
      'draft'::public.estimate_status,
      2::smallint,
      null::text
    ),
    (
      '71000000-0000-4000-8000-000000000103'::uuid,
      3,
      'sent'::public.estimate_status,
      1::smallint,
      repeat('a', 64)
    ),
    (
      '71000000-0000-4000-8000-000000000104'::uuid,
      4,
      'accepted'::public.estimate_status,
      1::smallint,
      repeat('b', 64)
    )
) as fixture(id, version_number, status, calc_engine_version, seal_hash)
where project.id = '71000000-0000-4000-8000-000000000010';

insert into public.estimate_items (
  id,
  tenant_id,
  version_id,
  parent_id,
  item_type,
  position,
  title,
  aid,
  labor_role_id,
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
  fixture.item_type,
  fixture.position,
  fixture.title,
  fixture.aid,
  fixture.labor_role_id,
  case when fixture.item_type = 'line' then 1 else null end,
  case when fixture.item_type = 'line' then 0 else null end,
  case when fixture.item_type = 'line' then 0 else null end,
  case when fixture.item_type = 'line' then 1 else null end,
  case when fixture.item_type = 'line' then 0 else null end,
  case when fixture.item_type = 'line' then 1 else null end,
  case when fixture.item_type = 'line' then 0 else null end,
  case when fixture.item_type = 'line' then 0 else null end,
  case when fixture.item_type = 'line' then 0 else null end,
  case when fixture.item_type = 'line' then 0 else null end
from public.estimate_versions as version
join (
  values
    (
      '71000000-0000-4000-8000-000000000070'::uuid,
      '71000000-0000-4000-8000-000000000101'::uuid,
      null::uuid,
      'section'::public.estimate_item_type,
      1,
      'Historical v1 AID section'::text,
      null::text,
      null::uuid,
      0
    ),
    (
      '71000000-0000-4000-8000-000000000071'::uuid,
      '71000000-0000-4000-8000-000000000101'::uuid,
      '71000000-0000-4000-8000-000000000070'::uuid,
      'line'::public.estimate_item_type,
      1,
      'Historical v1 AID line'::text,
      'V1-AID-LINE'::text,
      '71000000-0000-4000-8000-000000000067'::uuid,
      1
    ),
    (
      '71000000-0000-4000-8000-000000000072'::uuid,
      '71000000-0000-4000-8000-000000000102'::uuid,
      null::uuid,
      'section'::public.estimate_item_type,
      1,
      'Canonical v2 AID section'::text,
      null::text,
      null::uuid,
      0
    ),
    (
      '71000000-0000-4000-8000-000000000073'::uuid,
      '71000000-0000-4000-8000-000000000102'::uuid,
      '71000000-0000-4000-8000-000000000072'::uuid,
      'line'::public.estimate_item_type,
      1,
      'Canonical v2 AID line'::text,
      'V2-AID-LINE'::text,
      '71000000-0000-4000-8000-000000000060'::uuid,
      1
    )
) as fixture(
  id,
  version_id,
  parent_id,
  item_type,
  position,
  title,
  aid,
  labor_role_id,
  depth
) on version.id = fixture.version_id
order by fixture.version_id, fixture.depth, fixture.position, fixture.id;

insert into public.takeoff_jobs (
  id,
  tenant_id,
  estimate_version_id,
  level,
  status,
  source_file_name
)
select
  fixture.id,
  version.tenant_id,
  version.id,
  'A'::public.takeoff_job_level,
  'completed'::public.takeoff_job_status,
  fixture.source_file_name
from public.estimate_versions as version
join (
  values
    (
      '71000000-0000-4000-8000-000000000080'::uuid,
      '71000000-0000-4000-8000-000000000101'::uuid,
      'direct-v1-no-decision.pdf'::text
    ),
    (
      '71000000-0000-4000-8000-000000000081'::uuid,
      '71000000-0000-4000-8000-000000000103'::uuid,
      'inherited-v1-no-decision.pdf'::text
    ),
    (
      '71000000-0000-4000-8000-000000000082'::uuid,
      '71000000-0000-4000-8000-000000000102'::uuid,
      'direct-v2-no-decision.pdf'::text
    )
) as fixture(id, version_id, source_file_name)
  on version.id = fixture.version_id;

insert into public.takeoff_version_links (
  tenant_id,
  takeoff_job_id,
  source_version_id,
  target_version_id,
  linked_by
)
select
  version.tenant_id,
  '71000000-0000-4000-8000-000000000081',
  '71000000-0000-4000-8000-000000000103',
  '71000000-0000-4000-8000-000000000101',
  null
from public.estimate_versions as version
where version.id = '71000000-0000-4000-8000-000000000101';

insert into public.estimate_templates (
  id,
  tenant_id,
  created_by,
  name
)
select
  '71000000-0000-4000-8000-000000000020',
  membership.tenant_id,
  membership.user_id,
  'Calc governance template'
from public.tenant_memberships as membership
where membership.user_id = '71000000-0000-4000-8000-000000000001';

insert into public.dpgf_imports (
  id,
  tenant_id,
  user_id,
  filename,
  source_format,
  status,
  row_count,
  parse_mode
)
select
  '71000000-0000-4000-8000-000000000030',
  membership.tenant_id,
  membership.user_id,
  'calc-governance.xlsx',
  'xlsx',
  'completed',
  1,
  'server'
from public.tenant_memberships as membership
where membership.user_id = '71000000-0000-4000-8000-000000000001';

insert into public.dpgf_imports (
  id,
  tenant_id,
  user_id,
  project_id,
  filename,
  source_format,
  status,
  row_count,
  parse_mode
)
select
  fixture.id,
  membership.tenant_id,
  membership.user_id,
  fixture.project_id,
  fixture.filename,
  'xlsx',
  'completed',
  1,
  'server'
from public.tenant_memberships as membership
cross join (
  values
    (
      '71000000-0000-4000-8000-000000000031'::uuid,
      null::uuid,
      'calc-governance-canonical.xlsx'::text
    ),
    (
      '71000000-0000-4000-8000-000000000032'::uuid,
      '71000000-0000-4000-8000-000000000010'::uuid,
      'calc-governance-already-linked.xlsx'::text
    )
) as fixture(id, project_id, filename)
where membership.user_id = '71000000-0000-4000-8000-000000000001';

insert into public.dpgf_imports (
  id,
  tenant_id,
  user_id,
  filename,
  source_format,
  status,
  row_count,
  parse_mode
)
select
  '71000000-0000-4000-8000-000000000033',
  membership.tenant_id,
  membership.user_id,
  'calc-governance-foreign.xlsx',
  'xlsx',
  'completed',
  1,
  'server'
from public.tenant_memberships as membership
where membership.user_id = '71000000-0000-4000-8000-000000000002';

select is(
  (
    select version.calc_engine_version::integer
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000101'
  ),
  1,
  'a historical draft remains pinned to calculation engine v1'
);

select lives_ok(
  $$
    delete from public.labor_roles
    where id = '71000000-0000-4000-8000-000000000067'
  $$,
  'a labor role referenced only by a draft v1 item retains historical ON DELETE SET NULL behavior'
);

select is(
  (
    select item.labor_role_id
    from public.estimate_items item
    where item.id = '71000000-0000-4000-8000-000000000071'
  ),
  null::uuid,
  'the v1 item remains present with its deleted legacy labor role cleared'
);

select ok(
  exists (
    select 1
    from pg_constraint as constraint_definition
    where constraint_definition.conname =
        'estimate_versions_calc_engine_version_check'
      and constraint_definition.conrelid = 'public.estimate_versions'::regclass
      and constraint_definition.contype = 'c'
      and constraint_definition.convalidated
  ),
  'the calculation engine domain is enforced by a validated CHECK constraint'
);

-- Isolate the table CHECK from the defense-in-depth trigger so these two
-- assertions prove the database domain itself, not only the RPC fence.
alter table public.estimate_versions
  disable trigger enforce_estimate_calc_engine_on_insert;

select throws_ok(
  $$
    insert into public.estimate_versions (
      id,
      tenant_id,
      project_id,
      version_number,
      status,
      calc_engine_version
    )
    select
      '71000000-0000-4000-8000-000000000090',
      project.tenant_id,
      project.id,
      90,
      'draft'::public.estimate_status,
      0
    from public.estimate_projects as project
    where project.id = '71000000-0000-4000-8000-000000000010'
  $$,
  '23514',
  'new row for relation "estimate_versions" violates check constraint "estimate_versions_calc_engine_version_check"',
  'the CHECK constraint rejects calculation engine version 0'
);

select throws_ok(
  $$
    insert into public.estimate_versions (
      id,
      tenant_id,
      project_id,
      version_number,
      status,
      calc_engine_version
    )
    select
      '71000000-0000-4000-8000-000000000091',
      project.tenant_id,
      project.id,
      91,
      'draft'::public.estimate_status,
      3
    from public.estimate_projects as project
    where project.id = '71000000-0000-4000-8000-000000000010'
  $$,
  '23514',
  'new row for relation "estimate_versions" violates check constraint "estimate_versions_calc_engine_version_check"',
  'the CHECK constraint rejects calculation engine version 3'
);

alter table public.estimate_versions
  enable trigger enforce_estimate_calc_engine_on_insert;

with expected_contract(signature, contract_name) as (
  values
    (
      'public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)',
      'canonical_v2'
    ),
    (
      'public.duplicate_estimate_version(uuid,boolean)',
      'duplicate_source'
    )
)
select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid = to_regprocedure(expected.signature)
      and position(
        'miaouffrage.estimate_version_insert_contract' in procedure.prosrc
      ) > 0
      and position(expected.contract_name in procedure.prosrc) > 0
      and position('set_config' in procedure.prosrc) <
        position('insert into public.estimate_versions' in procedure.prosrc)
  ),
  format(
    '%s scopes its runtime insert contract as %s',
    expected.signature,
    expected.contract_name
  )
)
from expected_contract as expected;

with duplicate_definition as (
  select lower(pg_get_functiondef(
    'public.duplicate_estimate_version(uuid,boolean)'::regprocedure
  )) as source
)
select ok(
  position('for update of p, v' in source) > 0
  and position('and not p.is_archived' in source) > 0
  and position('and not p.is_archived' in source) <
    position('for update of p, v' in source)
  and position('for update of p, v' in source) <
    position('select coalesce(max(version_number)' in source)
  and position('for update of p, v' in source) <
    position(
      'next_variant_label := public.estimate_variant_label_from_index' in source
    )
  and position('for update of p, v' in source) <
    position('jsonb_object_agg(item.id::text' in source),
  'duplication locks the target project and source version before allocating or copying its snapshot'
)
from duplicate_definition;

with duplicate_definition as (
  select lower(pg_get_functiondef(
    'public.duplicate_estimate_version(uuid,boolean)'::regprocedure
  )) as source
)
select ok(
  position('src.aid' in source) > 0
  and position(
    'job.estimate_version_id = duplicate_estimate_version.source_version_id'
    in source
  ) > 0
  and position('from public.takeoff_version_links inherited_link' in source) > 0
  and position(
    'inherited_link.target_version_id ='
    in source
  ) > 0
  and position(
    'from public.takeoff_dpgf_review_decisions decision'
    in source
  ) > 0
  and position('order by job.id' in source) > 0
  and position('for share of job' in source) >
    position('order by job.id' in source)
  and position('insert into public.takeoff_version_links' in source) >
    position('for share of job' in source)
  and position('insert into public.takeoff_dpgf_review_decisions' in source) >
    position('insert into public.takeoff_version_links' in source)
  and position('return new_version_id' in source) >
    position('insert into public.takeoff_dpgf_review_decisions' in source),
  'duplication copies AIDs and atomically carries direct, inherited, and decision-backed takeoff jobs under deterministic job locks'
)
from duplicate_definition;

with guard_definition as (
  select lower(pg_get_functiondef(
    'public.guard_estimate_v2_snapshot_columns()'::regprocedure
  )) as source
)
select ok(
  position('target_version_id := old.version_id' in source) > 0
  and position('target_version_id := new.version_id' in source) >
    position('target_version_id := old.version_id' in source)
  and position('where version.id = target_version_id' in source) >
    position('target_version_id := new.version_id' in source)
  and position('for share of project' in source) > 0
  and position('perform role.id' in source) >
    position('for share of project' in source)
  and position('from unnest(array[' in source) >
    position('perform role.id' in source)
  and position('order by role.id' in source) >
    position('perform role.id' in source)
  and position('for share of role' in source) >
    position('order by role.id' in source)
  and position('for share of role' in source) <
    position('estimate_labor_role_owner_mismatch' in source)
  and position('target_version_status <> ''draft''::public.estimate_status' in source) > 0
  and position('tg_op = ''delete''' in source) > 0
  and position('return old' in source) >
    position('estimate_version_read_only' in source)
  and position('return old' in source) <
    position('perform role.id' in source)
  and position('to_jsonb(new) - ''updated_at''' in source) > 0
  and position('estimate_version_read_only' in source) > 0
  and exists (
    select 1
    from pg_trigger trigger_definition
    where trigger_definition.tgrelid = 'public.estimate_items'::regclass
      and trigger_definition.tgname = 'aaz_guard_estimate_v2_snapshot_columns'
      and not trigger_definition.tgisinternal
      and position(
        'delete' in lower(pg_get_triggerdef(trigger_definition.oid))
      ) > 0
  ),
  'the item guard resolves DELETE without NEW, locks project and roles, and rejects every non-draft v2 mutation or deletion'
)
from guard_definition;

with canonical_definition as (
  select lower(pg_get_functiondef(
    'public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)'::regprocedure
  )) as source
)
select ok(
  position('perform role.id' in source) >
    position('returning * into project_row' in source)
  and position('perform role.id' in source) >
    position('select project.*' in source)
  and position('order by role.id' in source) >
    position('perform role.id' in source)
  and position('for share of role' in source) >
    position('order by role.id' in source)
  and position('for share of role' in source) <
    position('left join public.labor_roles labor_role' in source)
  and position('for share of role' in source) <
    position('estimate_labor_role_owner_mismatch' in source)
  and position('''contractor_role''' in source) > 0
  and position('version_contractor_role::text' in source) > 0
  and position('estimate_reverse_charge_totals_invalid' in source) > 0,
  'canonical creation locks payload roles and persists the checked contractor/VAT contract'
)
from canonical_definition;

with freeze_definition as (
  select lower(pg_get_functiondef(
    'public.freeze_estimate_v2_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)'::regprocedure
  )) as source
)
select ok(
  position('for share of project, tenant, membership' in source) > 0
  and position('perform role.id' in source) >
    position('for share of project, tenant, membership' in source)
  and position('order by role.id' in source) >
    position('perform role.id' in source)
  and position('for share of role' in source) >
    position('order by role.id' in source)
  and position('for share of role' in source) <
    position('estimate_labor_role_owner_mismatch' in source)
  and position('''effective_margin_multiplier''' in source) > 0
  and position(')::numeric <= 0' in source) >
    position('''effective_margin_multiplier''' in source)
  and position(')::numeric > 100' in source) >
    position(')::numeric <= 0' in source)
  and position('estimate_v2_effective_margin_conflict' in source) > 0
  and position('10000000' in source) > 0
  and position('100000000' in source) > 0,
  'snapshot freeze locks external inputs and validates the mandatory fixed-or-tiered effective margin against a materialized effective tier set'
)
from freeze_definition;

with owner_change_definition as (
  select lower(pg_get_functiondef(
    'public.guard_estimate_project_v2_owner_change()'::regprocedure
  )) as source
)
select ok(
  position('version.calc_engine_version = 2' in source) > 0
  and position('perform role.id' in source) > 0
  and position('order by role.id' in source) >
    position('perform role.id' in source)
  and position('for share of role' in source) >
    position('order by role.id' in source)
  and position('for share of role' in source) <
    position('estimate_project_owner_labor_role_mismatch' in source)
  and position('role.user_id = new.user_id' in source) > 0,
  'project owner transfer locks all v2 labor roles in UUID order and rejects every status with a candidate-owner mismatch'
)
from owner_change_definition;

with labor_role_owner_definition as (
  select lower(pg_get_functiondef(
    'public.guard_labor_role_v2_owner_change()'::regprocedure
  )) as source
)
select ok(
  position('version.calc_engine_version = 2' in source) > 0
  and position('old.id in (' in source) > 0
  and position('item.labor_role_id' in source) > 0
  and position('item.labor_role_atelier_id' in source) > 0
  and position('item.labor_role_chantier_id' in source) > 0
  and position('tg_op = ''delete''' in source) > 0
  and position('return old' in source) >
    position('estimate_labor_role_assignment_in_use' in source)
  and position('project.user_id <> new.user_id' in source) > 0
  and position('estimate_labor_role_assignment_in_use' in source) > 0,
  'labor-role reassignment checks all three v2 reference columns against the candidate owner while the role row is locked'
)
from labor_role_owner_definition;

with review_capture_definition as (
  select lower(pg_get_functiondef(
    'public.capture_estimate_review_content_revision()'::regprocedure
  )) as source
)
select ok(
  position('version.calc_snapshot_content_revision' in source) > 0
  and position('version.calc_snapshot_context' in source) > 0
  and position('for update' in source) >
    position('version.calc_snapshot_context' in source)
  and position('current_snapshot_content_revision is distinct from current_content_revision' in source) >
    position('for update' in source)
  and position('current_snapshot_context is null' in source) >
    position('for update' in source)
  and position('estimate_v2_snapshot_stale' in source) > 0,
  'review-cycle capture locks the version and accepts only a fresh non-null v2 snapshot context'
)
from review_capture_definition;

with review_open_definition as (
  select
    lower(pg_get_functiondef(
      'public.open_estimate_review_cycle(uuid,uuid,uuid,uuid,uuid[],text,jsonb)'::regprocedure
    )) as source,
    procedure.prosecdef,
    procedure.proacl
  from pg_proc as procedure
  where procedure.oid =
    'public.open_estimate_review_cycle(uuid,uuid,uuid,uuid,uuid[],text,jsonb)'::regprocedure
)
select ok(
  not prosecdef
  and position('current_user <> ''service_role''' in source) > 0
  and position('for update of version, project' in source) > 0
  and position('for update of cycle' in source) > 0
  and position('for update of approval' in source) > 0
  and position('opened_cycle_id := gen_random_uuid()' in source) > 0
  and position('superseded_by_cycle_id = opened_cycle_id' in source) >
    position('opened_cycle_id := gen_random_uuid()' in source)
  and position('historical pending approvals were keyed only by version/rule' in source) > 0
  and position('previous_supersession_setting' in source) > 0
  and position('''created'', false' in source) > 0
  and position('''created'', true' in source) > 0
  and position('''approval_submitted''' in source) > 0
  and has_function_privilege(
    'service_role',
    'public.open_estimate_review_cycle(uuid,uuid,uuid,uuid,uuid[],text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.open_estimate_review_cycle(uuid,uuid,uuid,uuid,uuid[],text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.open_estimate_review_cycle(uuid,uuid,uuid,uuid,uuid[],text,jsonb)',
    'EXECUTE'
  ),
  'review submission is an invoker service-role-only seam with deterministic locks, atomic legacy supersession, idempotence, and audit logging'
)
from review_open_definition;

select ok(
  not has_table_privilege(
    'authenticated',
    'public.estimate_review_cycles',
    'INSERT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.estimate_review_cycles',
    'UPDATE'
  )
  and not has_table_privilege(
    'authenticated',
    'public.estimate_approvals',
    'INSERT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.estimate_approvals',
    'UPDATE'
  )
  and has_function_privilege(
    'authenticated',
    'public.decide_estimate_review_cycle(uuid,public.estimate_review_decision,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.decide_estimate_approval(uuid,public.estimate_approval_status)',
    'EXECUTE'
  ),
  'Data API callers cannot write review rows directly and must use the governed submission and decision facades'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_definition
    where constraint_definition.conrelid =
      'public.estimate_review_cycles'::regclass
      and constraint_definition.conname =
        'estimate_review_cycles_superseded_by_cycle_id_fkey'
      and constraint_definition.condeferrable
      and constraint_definition.condeferred
  )
  and position(
    'superseded_at is null' in
    lower(pg_get_indexdef(
      'public.estimate_review_cycles_open_cycle_idx'::regclass
    ))
  ) > 0
  and position(
    'superseded_at is null' in
    lower(pg_get_indexdef(
      'public.estimate_approvals_pending_unique_idx'::regclass
    ))
  ) > 0,
  'the deferred supersession link and both open/pending uniqueness contracts permit one atomic replacement cycle'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.log_estimate_version_event(uuid,text,uuid,jsonb,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.log_estimate_version_event(uuid,text,uuid,jsonb,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.log_estimate_version_event(uuid,text,uuid,jsonb,timestamptz)',
    'EXECUTE'
  )
  and position(
    '''approval_submitted''' in lower(pg_get_functiondef(
      'public.log_estimate_version_event(uuid,text,uuid,jsonb,timestamptz)'::regprocedure
    ))
  ) > 0,
  'the event logger remains service-role only and accepts approval_submitted'
);

with decision_definitions as (
  select
    lower(pg_get_functiondef(
      'public.decide_estimate_review_cycle(uuid,public.estimate_review_decision,jsonb)'::regprocedure
    )) as cycle_source,
    lower(pg_get_functiondef(
      'public.decide_estimate_approval(uuid,public.estimate_approval_status)'::regprocedure
    )) as approval_source
)
select ok(
  position('cycle_row.superseded_at is not null' in cycle_source) > 0
  and position('estimate_review_cycle_superseded' in cycle_source) > 0
  and position('approval.superseded_at is null' in cycle_source) > 0
  and position('approval.review_cycle_id = cycle_row.id' in cycle_source) > 0
  and position('approval_row.superseded_at is not null' in approval_source) > 0
  and position('estimate_approval_superseded' in approval_source) > 0
  and position('cycle.superseded_at is null' in approval_source) > 0
  and position('approval.superseded_at is null' in approval_source) > 0
  and position(
    'estimate_review_correction_comments_required' in cycle_source
  ) > 0
  and position(
    'estimate_review_reservation_comments_required' in cycle_source
  ) > 0
  and position('with inserted_comments as' in cycle_source) > 0
  and position(
    'insert into public.estimate_review_correction_items' in cycle_source
  ) > position('with inserted_comments as' in cycle_source)
  and position(
    'if cycle_decision =' in approval_source
  ) > 0
  and position(
    'estimate_review_correction_comments_required' in approval_source
  ) > position('if cycle_decision =' in approval_source),
  'decision RPCs fence supersession and comment-less outcomes while restoring atomic correction snapshots'
)
from decision_definitions;

with active_review_boundaries as (
  select
    lower(pg_get_functiondef(
      'public.list_approval_queue(text)'::regprocedure
    )) as queue_source,
    lower(pg_get_functiondef(
      'public.guard_estimate_review_comment_active_cycle()'::regprocedure
    )) as comment_guard_source,
    lower(pg_get_functiondef(
      'public.guard_estimate_review_correction_active_context()'::regprocedure
    )) as correction_guard_source
)
select ok(
  position('cycle.decision is null' in queue_source) > 0
  and position('cycle.superseded_at is null' in queue_source) >
    position('cycle.decision is null' in queue_source)
  and position('version.calc_engine_version = 1' in queue_source) > 0
  and position(
    'version.calc_snapshot_content_revision = version.content_revision'
    in queue_source
  ) > 0
  and position('effective_margin_multiplier' in queue_source) > 0
  and position('1 - 1 /' in queue_source) > 0
  and position('estimate_review_cycle_superseded' in comment_guard_source) > 0
  and position('cycle_decision is not null' in comment_guard_source) > 0
  and position('estimate_review_cycle_superseded' in correction_guard_source) > 0
  and position('estimate_review_comment_superseded' in correction_guard_source) > 0
  and position('changes_requested' in correction_guard_source) > 0
  and exists (
    select 1
    from pg_trigger trigger_definition
    where trigger_definition.tgrelid =
      'public.estimate_review_comments'::regclass
      and trigger_definition.tgname =
        'aaz_guard_estimate_review_comment_active_cycle'
      and not trigger_definition.tgisinternal
  )
  and exists (
    select 1
    from pg_trigger trigger_definition
    where trigger_definition.tgrelid =
      'public.estimate_review_correction_items'::regclass
      and trigger_definition.tgname =
        'aaz_guard_estimate_review_correction_active_context'
      and not trigger_definition.tgisinternal
      and position(
        'update' in lower(pg_get_triggerdef(trigger_definition.oid))
      ) > 0
  ),
  'queue derives v2 effective margin while preserving v1 margin_bp, and review guards treat superseded cycles as historical'
)
from active_review_boundaries;

select ok(
  not has_table_privilege(
    'anon',
    'public.estimate_review_comments',
    'INSERT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.estimate_review_comments',
    'INSERT'
  )
  and has_table_privilege(
    'service_role',
    'public.estimate_review_comments',
    'INSERT'
  )
  and not has_table_privilege(
    'anon',
    'public.estimate_review_correction_items',
    'INSERT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.estimate_review_correction_items',
    'INSERT'
  )
  and has_table_privilege(
    'service_role',
    'public.estimate_review_correction_items',
    'INSERT'
  )
  and not exists (
    select 1
    from pg_policy policy_definition
    where policy_definition.polrelid in (
      'public.estimate_review_comments'::regclass,
      'public.estimate_review_correction_items'::regclass
    )
      and policy_definition.polcmd = 'a'
  )
  and not exists (
    select 1
    from pg_class relation
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) acl_entry
    where relation.oid in (
      'public.estimate_review_comments'::regclass,
      'public.estimate_review_correction_items'::regclass
    )
      and acl_entry.grantee = 0
      and acl_entry.privilege_type = 'INSERT'
  ),
  'comment and correction INSERT are absent from Data API roles and PUBLIC while governed RPC writers retain their table seam'
);

set local role authenticated;

select throws_ok(
  'insert into public.estimate_review_comments default values',
  '42501',
  'permission denied for table estimate_review_comments',
  'authenticated cannot bypass the review RPC with a direct comment INSERT'
);

select throws_ok(
  'insert into public.estimate_review_correction_items default values',
  '42501',
  'permission denied for table estimate_review_correction_items',
  'authenticated cannot bypass the review RPC with a direct correction INSERT'
);

reset role;

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_approval_queue(text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.list_approval_queue(text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.list_approval_queue(text)',
    'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )
    ) as acl_entry
    where procedure.oid =
      'public.list_approval_queue(text)'::regprocedure
      and acl_entry.grantee = 0
      and acl_entry.privilege_type = 'EXECUTE'
  ),
  'the approval queue keeps an explicit authenticated-only execution boundary'
);

with decision_definitions as (
  select
    lower(pg_get_functiondef(
      'public.decide_estimate_review_cycle(uuid,public.estimate_review_decision,jsonb)'::regprocedure
    )) as cycle_source,
    lower(pg_get_functiondef(
      'public.decide_estimate_approval(uuid,public.estimate_approval_status)'::regprocedure
    )) as approval_source
)
select ok(
  position('select version.content_revision' in cycle_source) <
    position('select cycle.*' in cycle_source)
  and position('select cycle.*' in cycle_source) <
    position('perform approval.id' in cycle_source)
  and position('select version.content_revision' in approval_source) <
    position('select cycle.*' in approval_source)
  and position('select cycle.*' in approval_source) <
    position('select approval.*' in approval_source),
  'both decision facades lock version then cycle then approvals, matching submission order and avoiding cross-workflow deadlocks'
)
from decision_definitions;

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid =
      'public.duplicate_estimate_version(uuid,boolean)'::regprocedure
      and procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting in ('search_path=', 'search_path=""')
      )
      and position('join public.tenants tenant' in procedure.prosrc) > 0
      and position('and tenant.is_active' in procedure.prosrc) > 0
      and position('join public.tenant_memberships membership' in procedure.prosrc) > 0
      and position(
        'membership.role in (' in procedure.prosrc
      ) > 0
      and position(
        '''engineer''::public.tenant_role' in procedure.prosrc
      ) > 0
      and position('p.user_id = actor_user_id' in procedure.prosrc) > 0
      and position(
        'membership.role = ''admin''::public.tenant_role' in procedure.prosrc
      ) > 0
  )
  and has_function_privilege(
    'authenticated',
    'public.duplicate_estimate_version(uuid,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.duplicate_estimate_version(uuid,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.duplicate_estimate_version(uuid,boolean)',
    'EXECUTE'
  ),
  'duplication is a strict authenticated-only definer facade restricted to writer roles and owner-or-admin access'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)',
    'EXECUTE'
  ),
  'the canonical seven-argument creation RPC is service-role only'
);

select ok(
  has_table_privilege(
    'authenticated',
    'public.estimate_versions',
    'SELECT'
  )
  and has_table_privilege(
    'authenticated',
    'public.estimate_versions',
    'UPDATE'
  )
  and has_table_privilege(
    'authenticated',
    'public.estimate_versions',
    'DELETE'
  )
  and not has_table_privilege(
    'authenticated',
    'public.estimate_versions',
    'INSERT'
  )
  and has_table_privilege(
    'service_role',
    'public.estimate_versions',
    'INSERT'
  ),
  'estimate version relation privileges preserve authenticated edits while direct creation remains revoked'
);

select ok(
  to_regprocedure(
    'public.freeze_estimate_v2_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)'
  ) is not null
  and has_function_privilege(
    'service_role',
    'public.freeze_estimate_v2_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.freeze_estimate_v2_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.freeze_estimate_v2_snapshot(uuid,uuid,timestamptz,bigint,uuid,text,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'the nine-argument purpose-aware v2 freeze RPC is service-role only'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$
    insert into public.estimate_versions (
      id,
      tenant_id,
      project_id,
      version_number,
      status,
      calc_engine_version
    )
    values (
      '71000000-0000-4000-8000-000000000092',
      public.current_tenant_id(),
      '71000000-0000-4000-8000-000000000010',
      92,
      'draft'::public.estimate_status,
      2
    )
  $$,
  '42501',
  'permission denied for table estimate_versions',
  'an authenticated direct estimate version insert is rejected at the relation boundary'
);

reset role;
set local role service_role;

select throws_ok(
  $$
    select public.persist_estimate_creation_atomic(
      (
        select membership.tenant_id
        from public.tenant_memberships as membership
        where membership.user_id = '71000000-0000-4000-8000-000000000001'
      ),
      '71000000-0000-4000-8000-000000000001',
      null,
      '{"id":"71000000-0000-4000-8000-000000000093","name":"Rejected unordered project"}'::jsonb,
      '{"id":"71000000-0000-4000-8000-000000000094","title":"Rejected unordered version","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"calc_engine_version":2,"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000095","parent_id":"71000000-0000-4000-8000-000000000096","item_type":"line","position":1,"title":"Child before parent","line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0},{"id":"71000000-0000-4000-8000-000000000096","parent_id":null,"item_type":"section","position":1,"title":"Late parent"}]'::jsonb,
      null
    )
  $$,
  '22023',
  'ESTIMATE_ITEMS_HIERARCHY_INVALID',
  'canonical persistence rejects a child-before-parent payload before mutation'
);

select is(
  (
    select count(*)::integer
    from public.estimate_projects as project
    where project.id = '71000000-0000-4000-8000-000000000093'
  ),
  0,
  'a rejected unordered payload leaves no project behind'
);

select lives_ok(
  $$
    select public.persist_estimate_creation_atomic(
      (
        select membership.tenant_id
        from public.tenant_memberships as membership
        where membership.user_id = '71000000-0000-4000-8000-000000000001'
      ),
      '71000000-0000-4000-8000-000000000001',
      null,
      '{"id":"71000000-0000-4000-8000-000000000040","name":"Canonical v2 project"}'::jsonb,
      '{"id":"71000000-0000-4000-8000-000000000041","title":"Canonical v2 version","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"calc_engine_version":2,"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000042","parent_id":null,"item_type":"section","position":1,"title":"Snapshot section"},{"id":"71000000-0000-4000-8000-000000000043","parent_id":"71000000-0000-4000-8000-000000000042","item_type":"line","position":1,"title":"Snapshot line","quantity":1,"unit_price_ht_cents":80,"tax_rate_bp":2000,"k_fo":1,"h_mo":1,"h_mo_majoration":1,"k_mo":1,"labor_role_id":"71000000-0000-4000-8000-000000000060","h_mo_atelier":0.25,"k_mo_atelier":1,"h_mo_chantier":0.75,"k_mo_chantier":1,"pu_ht_cents":120,"source_provider":"dpgf","source_file_name":"calc-governance-canonical.xlsx","source_page":7,"source_metadata":{"import_id":"71000000-0000-4000-8000-000000000031","row_index":7,"sheet":"DPGF"},"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '71000000-0000-4000-8000-000000000031'
    )
  $$,
  'the canonical creation RPC creates an estimate version'
);

select lives_ok(
  $$
    select public.persist_estimate_creation_atomic(
      (
        select membership.tenant_id
        from public.tenant_memberships as membership
        where membership.user_id = '71000000-0000-4000-8000-000000000001'
      ),
      '71000000-0000-4000-8000-000000000001',
      null,
      '{"id":"71000000-0000-4000-8000-000000000050","name":"Frozen lifecycle project"}'::jsonb,
      '{"id":"71000000-0000-4000-8000-000000000051","title":"Frozen lifecycle version","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"calc_engine_version":2,"total_ht_cents":210,"total_tax_cents":42,"total_ttc_cents":252}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000052","parent_id":null,"item_type":"section","position":1,"title":"Frozen lifecycle section"},{"id":"71000000-0000-4000-8000-000000000053","parent_id":"71000000-0000-4000-8000-000000000052","item_type":"line","position":1,"title":"Frozen lifecycle line","quantity":1,"unit_price_ht_cents":140,"tax_rate_bp":2000,"k_fo":1,"h_mo":1,"h_mo_majoration":1,"k_mo":1,"labor_role_id":"71000000-0000-4000-8000-000000000060","h_mo_atelier":0.4,"k_mo_atelier":1,"h_mo_chantier":0.6,"k_mo_chantier":1,"pu_ht_cents":210,"line_total_ht_cents":210,"line_tax_cents":42,"line_total_ttc_cents":252}]'::jsonb,
      null
    )
  $$,
  'the canonical creation RPC creates an isolated v2 lifecycle fixture'
);

select lives_ok(
  $$
    select public.persist_estimate_creation_atomic(
      (
        select membership.tenant_id
        from public.tenant_memberships as membership
        where membership.user_id = '71000000-0000-4000-8000-000000000001'
      ),
      '71000000-0000-4000-8000-000000000001',
      null,
      '{"id":"71000000-0000-4000-8000-000000000085","name":"Reverse charge canonical project"}'::jsonb,
      '{"id":"71000000-0000-4000-8000-000000000086","title":"Reverse charge canonical version","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"calc_engine_version":2,"contractor_role":"subcontractor","total_ht_cents":100,"total_tax_cents":0,"total_ttc_cents":100}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000087","parent_id":null,"item_type":"section","position":1,"title":"Reverse charge section"},{"id":"71000000-0000-4000-8000-000000000088","parent_id":"71000000-0000-4000-8000-000000000087","item_type":"line","position":1,"title":"Reverse charge line","quantity":1,"unit_price_ht_cents":100,"tax_rate_bp":2000,"k_fo":1,"h_mo":0,"h_mo_majoration":1,"k_mo":1,"pu_ht_cents":100,"line_total_ht_cents":100,"line_tax_cents":0,"line_total_ttc_cents":100}]'::jsonb,
      null
    )
  $$,
  'canonical creation accepts an explicit subcontractor contract with reverse-charge totals'
);

select ok(
  (
    select version.contractor_role = 'subcontractor'
      and version.total_ht_cents = 100
      and version.total_tax_cents = 0
      and version.total_ttc_cents = version.total_ht_cents
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000086'
  )
  and not exists (
    select 1
    from public.estimate_items item
    where item.version_id = '71000000-0000-4000-8000-000000000086'
      and item.item_type = 'line'::public.estimate_item_type
      and (
        item.line_tax_cents <> 0
        or item.line_total_ttc_cents <> item.line_total_ht_cents
      )
  ),
  'the explicit subcontractor version persists its role and coherent zero-VAT footer and lines'
);

select lives_ok(
  $$
    select public.persist_estimate_creation_atomic(
      (
        select membership.tenant_id
        from public.tenant_memberships as membership
        where membership.user_id = '71000000-0000-4000-8000-000000000001'
      ),
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000085',
      null,
      '{"id":"71000000-0000-4000-8000-000000000089","title":"Inherited reverse charge version","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"calc_engine_version":2,"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb
        || jsonb_build_object(
          'contractor_role',
          (
            select latest.contractor_role
            from public.estimate_versions latest
            where latest.project_id =
              '71000000-0000-4000-8000-000000000085'
            order by latest.version_number desc
            limit 1
          )
        ),
      '[]'::jsonb,
      null
    )
  $$,
  'canonical creation on an existing project accepts the contractor role inherited from its latest version'
);

select ok(
  (
    select inherited.contractor_role = source.contractor_role
      and inherited.contractor_role = 'subcontractor'
      and inherited.version_number = source.version_number + 1
      and inherited.total_tax_cents = 0
      and inherited.total_ttc_cents = inherited.total_ht_cents
    from public.estimate_versions inherited
    join public.estimate_versions source
      on source.id = '71000000-0000-4000-8000-000000000086'
    where inherited.id = '71000000-0000-4000-8000-000000000089'
  ),
  'the existing-project v2 version preserves the inherited subcontractor contract and reverse-charge totals'
);

select throws_ok(
  $$
    select public.persist_estimate_creation_atomic(
      (
        select membership.tenant_id
        from public.tenant_memberships as membership
        where membership.user_id = '71000000-0000-4000-8000-000000000001'
      ),
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000085',
      null,
      '{"id":"71000000-0000-4000-8000-000000000097","title":"Invalid reverse charge version","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"calc_engine_version":2,"contractor_role":"subcontractor","total_ht_cents":100,"total_tax_cents":20,"total_ttc_cents":120}'::jsonb,
      '[]'::jsonb,
      null
    )
  $$,
  '22023',
  'ESTIMATE_REVERSE_CHARGE_TOTALS_INVALID',
  'canonical creation rejects a subcontractor payload carrying VAT before mutation'
);

select is(
  (
    select count(*)::integer
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000097'
  ),
  0,
  'the rejected incoherent reverse-charge payload leaves no version behind'
);

select is(
  (
    select version.calc_engine_version::integer
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  2,
  'the canonical creation RPC accepts and pins an explicit engine v2 contract'
);

select is(
  (
    select source_import.project_id
    from public.dpgf_imports as source_import
    where source_import.id = '71000000-0000-4000-8000-000000000031'
  ),
  '71000000-0000-4000-8000-000000000040'::uuid,
  'canonical persistence atomically claims an owned unlinked import for its project'
);

select is(
  (
    select item.source_metadata
    from public.estimate_items as item
    where item.id = '71000000-0000-4000-8000-000000000043'
  ),
  '{"import_id":"71000000-0000-4000-8000-000000000031","row_index":7,"sheet":"DPGF"}'::jsonb,
  'canonical persistence retains structured source metadata on imported lines'
);

select throws_ok(
  $$
    select public.persist_estimate_creation_atomic(
      (
        select membership.tenant_id
        from public.tenant_memberships as membership
        where membership.user_id = '71000000-0000-4000-8000-000000000001'
      ),
      '71000000-0000-4000-8000-000000000001',
      null,
      '{"id":"71000000-0000-4000-8000-000000000046","name":"Rejected linked import project"}'::jsonb,
      '{"id":"71000000-0000-4000-8000-000000000047","title":"Rejected linked import version","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"calc_engine_version":2,"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
      '[]'::jsonb,
      '71000000-0000-4000-8000-000000000032'
    )
  $$,
  '23505',
  'DPGF_IMPORT_ALREADY_LINKED',
  'canonical persistence rejects an import already linked to another project'
);

select throws_ok(
  $$
    select public.persist_estimate_creation_atomic(
      (
        select membership.tenant_id
        from public.tenant_memberships as membership
        where membership.user_id = '71000000-0000-4000-8000-000000000001'
      ),
      '71000000-0000-4000-8000-000000000001',
      null,
      '{"id":"71000000-0000-4000-8000-000000000048","name":"Rejected foreign import project"}'::jsonb,
      '{"id":"71000000-0000-4000-8000-000000000049","title":"Rejected foreign import version","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"calc_engine_version":2,"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
      '[]'::jsonb,
      '71000000-0000-4000-8000-000000000033'
    )
  $$,
  '42501',
  'DPGF_IMPORT_NOT_WRITABLE',
  'canonical persistence rejects an import owned by another tenant'
);

update public.estimate_items
set labor_role_id = null
where id = '71000000-0000-4000-8000-000000000053';

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000051',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":false,"labor_roles":[],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000053","snapshot_pu_ht_cents":210,"snapshot_fo_ht_cents":140,"snapshot_mo_ht_cents":70,"snapshot_mo_atelier_ht_cents":30,"snapshot_mo_chantier_ht_cents":40,"line_total_ht_cents":210,"line_tax_cents":42,"line_total_ttc_cents":252}]'::jsonb,
      '{"total_ht_cents":210,"total_tax_cents":42,"total_ttc_cents":252}'::jsonb
    )
  $$,
  '23502',
  'ESTIMATE_V2_LABOR_ROLE_REQUIRED',
  'freeze rejects positive legacy labor hours without a legacy role when split is inactive'
);

select ok(
  (
    select version.calc_snapshot_context is null
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000051'
  )
  and (
    select item.snapshot_pu_ht_cents is null
      and item.snapshot_fo_ht_cents is null
      and item.snapshot_mo_ht_cents is null
      and item.snapshot_mo_atelier_ht_cents is null
      and item.snapshot_mo_chantier_ht_cents is null
    from public.estimate_items item
    where item.id = '71000000-0000-4000-8000-000000000053'
  ),
  'a rejected incomplete legacy labor freeze writes neither context nor snapshots'
);

update public.estimate_items
set labor_role_id = '71000000-0000-4000-8000-000000000060'
where id = '71000000-0000-4000-8000-000000000053';

insert into public.feature_flags (tenant_id, flag_key, enabled)
select
  version.tenant_id,
  'EST_031_LABOR_SPLIT',
  true
from public.estimate_versions version
where version.id = '71000000-0000-4000-8000-000000000051'
on conflict (tenant_id, flag_key) do update
set enabled = excluded.enabled;

update public.estimate_items
set
  labor_role_id = null,
  h_mo_atelier = 0,
  k_mo_atelier = 1,
  labor_role_atelier_id = null,
  h_mo_chantier = 0,
  k_mo_chantier = 1,
  labor_role_chantier_id = null
where id = '71000000-0000-4000-8000-000000000053';

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000051',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":true,"labor_roles":[],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000053","snapshot_pu_ht_cents":210,"snapshot_fo_ht_cents":140,"snapshot_mo_ht_cents":70,"snapshot_mo_atelier_ht_cents":0,"snapshot_mo_chantier_ht_cents":70,"line_total_ht_cents":210,"line_tax_cents":42,"line_total_ttc_cents":252}]'::jsonb,
      '{"total_ht_cents":210,"total_tax_cents":42,"total_ttc_cents":252}'::jsonb
    )
  $$,
  '23502',
  'ESTIMATE_V2_LABOR_ROLE_REQUIRED',
  'a split-enabled tenant still requires the legacy role when the line carries no active split payload'
);

update public.estimate_items
set
  labor_role_id = '71000000-0000-4000-8000-000000000060',
  h_mo_atelier = 0.4,
  h_mo_chantier = 0.6
where id = '71000000-0000-4000-8000-000000000053';

update public.estimate_items
set labor_role_chantier_id = '71000000-0000-4000-8000-000000000060'
where id = '71000000-0000-4000-8000-000000000053';

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000051',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":true,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000053","snapshot_pu_ht_cents":210,"snapshot_fo_ht_cents":140,"snapshot_mo_ht_cents":70,"snapshot_mo_atelier_ht_cents":30,"snapshot_mo_chantier_ht_cents":40,"line_total_ht_cents":210,"line_tax_cents":42,"line_total_ttc_cents":252}]'::jsonb,
      '{"total_ht_cents":210,"total_tax_cents":42,"total_ttc_cents":252}'::jsonb
    )
  $$,
  '23502',
  'ESTIMATE_V2_LABOR_ROLE_REQUIRED',
  'split freeze rejects positive atelier hours without an atelier role'
);

update public.estimate_items
set
  labor_role_atelier_id = '71000000-0000-4000-8000-000000000060',
  labor_role_chantier_id = null
where id = '71000000-0000-4000-8000-000000000053';

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000051',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":true,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000053","snapshot_pu_ht_cents":210,"snapshot_fo_ht_cents":140,"snapshot_mo_ht_cents":70,"snapshot_mo_atelier_ht_cents":30,"snapshot_mo_chantier_ht_cents":40,"line_total_ht_cents":210,"line_tax_cents":42,"line_total_ttc_cents":252}]'::jsonb,
      '{"total_ht_cents":210,"total_tax_cents":42,"total_ttc_cents":252}'::jsonb
    )
  $$,
  '23502',
  'ESTIMATE_V2_LABOR_ROLE_REQUIRED',
  'split freeze rejects positive chantier hours without a chantier role'
);

select ok(
  (
    select version.calc_snapshot_context is null
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000051'
  )
  and (
    select item.snapshot_pu_ht_cents is null
      and item.snapshot_fo_ht_cents is null
      and item.snapshot_mo_ht_cents is null
      and item.snapshot_mo_atelier_ht_cents is null
      and item.snapshot_mo_chantier_ht_cents is null
    from public.estimate_items item
    where item.id = '71000000-0000-4000-8000-000000000053'
  ),
  'rejected incomplete split freezes remain atomic and write no snapshots'
);

update public.estimate_items
set
  labor_role_id = null,
  labor_role_chantier_id = '71000000-0000-4000-8000-000000000060'
where id = '71000000-0000-4000-8000-000000000053';

select lives_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000051',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000051'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":true,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000053","snapshot_pu_ht_cents":210,"snapshot_fo_ht_cents":140,"snapshot_mo_ht_cents":70,"snapshot_mo_atelier_ht_cents":30,"snapshot_mo_chantier_ht_cents":40,"line_total_ht_cents":210,"line_tax_cents":42,"line_total_ttc_cents":252}]'::jsonb,
      '{"total_ht_cents":210,"total_tax_cents":42,"total_ttc_cents":252}'::jsonb
    )
  $$,
  'split freeze ignores legacy h_mo and its missing legacy role once both active split durations have dedicated roles'
);

update public.feature_flags
set enabled = false
where flag_key = 'EST_031_LABOR_SPLIT'
  and tenant_id = (
    select tenant_id
    from public.estimate_versions
    where id = '71000000-0000-4000-8000-000000000051'
  );

update public.estimate_items
set labor_role_id = '71000000-0000-4000-8000-000000000060'
where id = '71000000-0000-4000-8000-000000000053';

select lives_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000051',
      (
        select version.tenant_id
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000051'
      ),
      (
        select version.updated_at
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000051'
      ),
      (
        select version.content_revision
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000051'
      ),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000053","snapshot_pu_ht_cents":210,"snapshot_fo_ht_cents":140,"snapshot_mo_ht_cents":70,"snapshot_mo_atelier_ht_cents":30,"snapshot_mo_chantier_ht_cents":40,"line_total_ht_cents":210,"line_tax_cents":42,"line_total_ttc_cents":252}]'::jsonb,
      '{"total_ht_cents":210,"total_tax_cents":42,"total_ttc_cents":252}'::jsonb
    )
  $$,
  'an approval freeze succeeds without requiring a draft lock'
);

reset role;

insert into public.draft_locks (
  id,
  version_id,
  user_id,
  tenant_id,
  locked_at,
  expires_at,
  session_id
)
select
  '71000000-0000-4000-8000-000000000056',
  version.id,
  '71000000-0000-4000-8000-000000000002',
  version.tenant_id,
  statement_timestamp(),
  statement_timestamp() + interval '30 minutes',
  '71000000-0000-4000-8000-000000000057'
from public.estimate_versions as version
where version.id = '71000000-0000-4000-8000-000000000051';

set local role service_role;

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000051',
      (
        select version.tenant_id
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000051'
      ),
      (
        select version.updated_at
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000051'
      ),
      (
        select version.content_revision
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000051'
      ),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000053","snapshot_pu_ht_cents":210,"snapshot_fo_ht_cents":140,"snapshot_mo_ht_cents":70,"snapshot_mo_atelier_ht_cents":30,"snapshot_mo_chantier_ht_cents":40,"line_total_ht_cents":210,"line_tax_cents":42,"line_total_ttc_cents":252}]'::jsonb,
      '{"total_ht_cents":210,"total_tax_cents":42,"total_ttc_cents":252}'::jsonb
    )
  $$,
  '40001',
  'ESTIMATE_DRAFT_LOCK_CONFLICT',
  'an approval freeze rejects an active draft lock held by another user'
);

reset role;

delete from public.draft_locks
where id = '71000000-0000-4000-8000-000000000056';

insert into public.draft_locks (
  id,
  version_id,
  user_id,
  tenant_id,
  locked_at,
  expires_at,
  session_id
)
select
  '71000000-0000-4000-8000-000000000044',
  version.id,
  '71000000-0000-4000-8000-000000000001',
  version.tenant_id,
  statement_timestamp(),
  statement_timestamp() + interval '30 minutes',
  '71000000-0000-4000-8000-000000000045'
from public.estimate_versions as version
where version.id = '71000000-0000-4000-8000-000000000041';

insert into public.draft_locks (
  id,
  version_id,
  user_id,
  tenant_id,
  locked_at,
  expires_at,
  session_id
)
select
  '71000000-0000-4000-8000-000000000054',
  version.id,
  '71000000-0000-4000-8000-000000000001',
  version.tenant_id,
  statement_timestamp(),
  statement_timestamp() + interval '30 minutes',
  '71000000-0000-4000-8000-000000000055'
from public.estimate_versions as version
where version.id = '71000000-0000-4000-8000-000000000051';

set local role service_role;

select throws_ok(
  $$
    update public.estimate_versions
    set status = 'sending'::public.estimate_status
    where id = '71000000-0000-4000-8000-000000000041'
  $$,
  '40001',
  'ESTIMATE_V2_SNAPSHOT_STALE',
  'a v2 estimate cannot enter publication before its snapshot is frozen'
);

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (
        select version.tenant_id
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.updated_at - interval '1 second'
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.content_revision
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      '71000000-0000-4000-8000-000000000001',
      'send',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  '40001',
  'ESTIMATE_VERSION_CONFLICT',
  'the freeze RPC rejects a stale updated_at compare-and-swap token'
);

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (
        select version.tenant_id
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.updated_at
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.content_revision - 1
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      '71000000-0000-4000-8000-000000000001',
      'send',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  '40001',
  'ESTIMATE_VERSION_CONFLICT',
  'the freeze RPC rejects a stale content_revision compare-and-swap token'
);

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (
        select version.tenant_id
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.updated_at
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.content_revision
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      '71000000-0000-4000-8000-000000000001',
      'send',
      '{"labor_split_enabled":true,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  '40001',
  'ESTIMATE_V2_CALCULATION_CONTEXT_CONFLICT',
  'the freeze RPC rejects a caller-supplied context that differs from database state'
);

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      '71000000-0000-4000-8000-000000000001',
      'send',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[]}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  '22023',
  'ESTIMATE_V2_CALCULATION_CONTEXT_INVALID',
  'fixed v2 freeze rejects the obsolete calculation context without an effective multiplier'
);

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      '71000000-0000-4000-8000-000000000001',
      'send',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1.25}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  '40001',
  'ESTIMATE_V2_EFFECTIVE_MARGIN_CONFLICT',
  'fixed v2 freeze rejects an effective multiplier distinct from the version configuration'
);

select lives_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (
        select version.tenant_id
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.updated_at
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.content_revision
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      '71000000-0000-4000-8000-000000000001',
      'send',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  'the freeze RPC accepts the exact calculation context and all five snapshots'
);

select is(
  (
    select version.calc_snapshot_context
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
  'the exact database-derived calculation context is persisted'
);

delete from public.margin_tiers tier
where tier.tenant_id = (
  select version.tenant_id
  from public.estimate_versions version
  where version.id = '72000000-0000-4000-8000-000000000011'
);

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '72000000-0000-4000-8000-000000000011',
      (select tenant_id from public.estimate_versions where id = '72000000-0000-4000-8000-000000000011'),
      (select updated_at from public.estimate_versions where id = '72000000-0000-4000-8000-000000000011'),
      (select content_revision from public.estimate_versions where id = '72000000-0000-4000-8000-000000000011'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":false,"labor_roles":[],"margin_tiers":[{"threshold_cents":0,"multiplier":1.6},{"threshold_cents":10000000,"multiplier":1.45},{"threshold_cents":100000000,"multiplier":1.4}],"effective_margin_multiplier":0}'::jsonb,
      '[{"id":"72000000-0000-4000-8000-000000000012","snapshot_pu_ht_cents":160,"snapshot_fo_ht_cents":160,"snapshot_mo_ht_cents":0,"snapshot_mo_atelier_ht_cents":0,"snapshot_mo_chantier_ht_cents":0,"line_total_ht_cents":160,"line_tax_cents":32,"line_total_ttc_cents":192}]'::jsonb,
      '{"total_ht_cents":160,"total_tax_cents":32,"total_ttc_cents":192}'::jsonb
    )
  $$,
  '22023',
  'ESTIMATE_V2_CALCULATION_CONTEXT_INVALID',
  'tiered freeze rejects a non-positive effective margin before writing a snapshot'
);

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '72000000-0000-4000-8000-000000000011',
      (select tenant_id from public.estimate_versions where id = '72000000-0000-4000-8000-000000000011'),
      (select updated_at from public.estimate_versions where id = '72000000-0000-4000-8000-000000000011'),
      (select content_revision from public.estimate_versions where id = '72000000-0000-4000-8000-000000000011'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":false,"labor_roles":[],"margin_tiers":[{"threshold_cents":0,"multiplier":1.6},{"threshold_cents":10000000,"multiplier":1.45},{"threshold_cents":100000000,"multiplier":1.4}],"effective_margin_multiplier":1.25}'::jsonb,
      '[{"id":"72000000-0000-4000-8000-000000000012","snapshot_pu_ht_cents":160,"snapshot_fo_ht_cents":160,"snapshot_mo_ht_cents":0,"snapshot_mo_atelier_ht_cents":0,"snapshot_mo_chantier_ht_cents":0,"line_total_ht_cents":160,"line_tax_cents":32,"line_total_ttc_cents":192}]'::jsonb,
      '{"total_ht_cents":160,"total_tax_cents":32,"total_ttc_cents":192}'::jsonb
    )
  $$,
  '40001',
  'ESTIMATE_V2_EFFECTIVE_MARGIN_CONFLICT',
  'tiered freeze rejects an effective multiplier outside the locked effective tier set'
);

select lives_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '72000000-0000-4000-8000-000000000011',
      (select tenant_id from public.estimate_versions where id = '72000000-0000-4000-8000-000000000011'),
      (select updated_at from public.estimate_versions where id = '72000000-0000-4000-8000-000000000011'),
      (select content_revision from public.estimate_versions where id = '72000000-0000-4000-8000-000000000011'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":false,"labor_roles":[],"margin_tiers":[{"threshold_cents":0,"multiplier":1.6},{"threshold_cents":10000000,"multiplier":1.45},{"threshold_cents":100000000,"multiplier":1.4}],"effective_margin_multiplier":1.6}'::jsonb,
      '[{"id":"72000000-0000-4000-8000-000000000012","snapshot_pu_ht_cents":160,"snapshot_fo_ht_cents":160,"snapshot_mo_ht_cents":0,"snapshot_mo_atelier_ht_cents":0,"snapshot_mo_chantier_ht_cents":0,"line_total_ht_cents":160,"line_tax_cents":32,"line_total_ttc_cents":192}]'::jsonb,
      '{"total_ht_cents":160,"total_tax_cents":32,"total_ttc_cents":192}'::jsonb
    )
  $$,
  'tiered freeze materializes the default tier set and persists its applied multiplier'
);

select is(
  (
    select version.calc_snapshot_context
    from public.estimate_versions version
    where version.id = '72000000-0000-4000-8000-000000000011'
  ),
  '{"labor_split_enabled":false,"labor_roles":[],"margin_tiers":[{"threshold_cents":0,"multiplier":1.6},{"threshold_cents":10000000,"multiplier":1.45},{"threshold_cents":100000000,"multiplier":1.4}],"effective_margin_multiplier":1.6}'::jsonb,
  'the tiered v2 snapshot freezes defaults and the effective multiplier as one exact calculation context'
);

select is(
  (
    select concat_ws(
      '|',
      item.snapshot_pu_ht_cents,
      item.snapshot_fo_ht_cents,
      item.snapshot_mo_ht_cents,
      item.snapshot_mo_atelier_ht_cents,
      item.snapshot_mo_chantier_ht_cents
    )
    from public.estimate_items as item
    where item.id = '71000000-0000-4000-8000-000000000043'
  ),
  '120|80|40|10|30',
  'the freeze persists all five line-level calculation snapshots'
);

select is(
  (
    select concat_ws(
      '|',
      version.total_ht_cents,
      version.total_tax_cents,
      version.total_ttc_cents
    )
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  '120|24|144',
  'the freeze persists version totals matching the line snapshots'
);

select ok(
  (
    select version.calc_snapshot_content_revision = version.content_revision
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'the frozen snapshot is pinned to the current content revision'
);

-- now() is transaction-stable, so seed a distinct timestamp after the first
-- freeze. The fast path must preserve it; any hidden UPDATE would run the
-- ordinary updated_at trigger and replace it with the transaction timestamp.
reset role;
alter table public.estimate_versions
  disable trigger set_estimate_versions_updated_at;
update public.estimate_versions
set updated_at = updated_at + interval '1 microsecond'
where id = '71000000-0000-4000-8000-000000000041';
alter table public.estimate_versions
  enable trigger set_estimate_versions_updated_at;
set local role service_role;

select set_config(
  'test.v2_freeze_updated_at',
  (
    select version.updated_at::text
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  true
);
select set_config(
  'test.v2_freeze_content_revision',
  (
    select version.content_revision::text
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  true
);

select lives_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (
        select version.tenant_id
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.updated_at
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      (
        select version.content_revision
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000041'
      ),
      '71000000-0000-4000-8000-000000000001',
      'send',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  'an identical second freeze succeeds through the idempotent fast path'
);

select is(
  (
    select version.content_revision
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  current_setting('test.v2_freeze_content_revision')::bigint,
  'an identical second freeze does not bump content_revision'
);

select is(
  (
    select version.updated_at::text
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  current_setting('test.v2_freeze_updated_at'),
  'an identical second freeze does not change updated_at'
);

select lives_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000051',
      (
        select version.tenant_id
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000051'
      ),
      (
        select version.updated_at
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000051'
      ),
      (
        select version.content_revision
        from public.estimate_versions as version
        where version.id = '71000000-0000-4000-8000-000000000051'
      ),
      '71000000-0000-4000-8000-000000000001',
      'send',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000053","snapshot_pu_ht_cents":210,"snapshot_fo_ht_cents":140,"snapshot_mo_ht_cents":70,"snapshot_mo_atelier_ht_cents":30,"snapshot_mo_chantier_ht_cents":40,"line_total_ht_cents":210,"line_tax_cents":42,"line_total_ttc_cents":252}]'::jsonb,
      '{"total_ht_cents":210,"total_tax_cents":42,"total_ttc_cents":252}'::jsonb
    )
  $$,
  'the isolated lifecycle estimate freezes with all five snapshots'
);

select set_config(
  'test.v2_lifecycle_fingerprint',
  (
    select jsonb_build_object(
      'content_revision', version.content_revision,
      'calc_snapshot_content_revision', version.calc_snapshot_content_revision,
      'calc_snapshot_context', version.calc_snapshot_context,
      'version_totals', jsonb_build_array(
        version.total_ht_cents,
        version.total_tax_cents,
        version.total_ttc_cents
      ),
      'line_id', item.id,
      'line_totals', jsonb_build_array(
        item.line_total_ht_cents,
        item.line_tax_cents,
        item.line_total_ttc_cents
      ),
      'line_snapshots', jsonb_build_array(
        item.snapshot_pu_ht_cents,
        item.snapshot_fo_ht_cents,
        item.snapshot_mo_ht_cents,
        item.snapshot_mo_atelier_ht_cents,
        item.snapshot_mo_chantier_ht_cents
      )
    )::text
    from public.estimate_versions as version
    join public.estimate_items as item
      on item.version_id = version.id
     and item.tenant_id = version.tenant_id
     and item.item_type = 'line'::public.estimate_item_type
    where version.id = '71000000-0000-4000-8000-000000000051'
  ),
  true
);

select set_config(
  'test.v2_lifecycle_item_count',
  (
    select count(*)::text
    from public.estimate_items item
    where item.version_id = '71000000-0000-4000-8000-000000000051'
  ),
  true
);

select lives_ok(
  $$
    update public.estimate_versions
    set status = 'sending'::public.estimate_status
    where id = '71000000-0000-4000-8000-000000000051'
  $$,
  'a frozen v2 estimate may enter the sending state'
);

select lives_ok(
  $$
    update public.estimate_versions
    set seal_hash = repeat('c', 64)
    where id = '71000000-0000-4000-8000-000000000051'
      and status = 'sending'::public.estimate_status
  $$,
  'the trusted workflow may set the seal once while sending'
);

select lives_ok(
  $$
    update public.estimate_versions
    set status = 'sent'::public.estimate_status
    where id = '71000000-0000-4000-8000-000000000051'
  $$,
  'the sealed frozen v2 estimate may enter the sent state'
);

select lives_ok(
  $$
    update public.estimate_versions
    set status = 'accepted'::public.estimate_status
    where id = '71000000-0000-4000-8000-000000000051'
  $$,
  'the sent frozen v2 estimate may enter the accepted state'
);

select is(
  (
    select version.status::text
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000051'
  ),
  'accepted',
  'the complete frozen publication lifecycle persists acceptance'
);

select is(
  (
    select jsonb_build_object(
      'content_revision', version.content_revision,
      'calc_snapshot_content_revision', version.calc_snapshot_content_revision,
      'calc_snapshot_context', version.calc_snapshot_context,
      'version_totals', jsonb_build_array(
        version.total_ht_cents,
        version.total_tax_cents,
        version.total_ttc_cents
      ),
      'line_id', item.id,
      'line_totals', jsonb_build_array(
        item.line_total_ht_cents,
        item.line_tax_cents,
        item.line_total_ttc_cents
      ),
      'line_snapshots', jsonb_build_array(
        item.snapshot_pu_ht_cents,
        item.snapshot_fo_ht_cents,
        item.snapshot_mo_ht_cents,
        item.snapshot_mo_atelier_ht_cents,
        item.snapshot_mo_chantier_ht_cents
      )
    )
    from public.estimate_versions as version
    join public.estimate_items as item
      on item.version_id = version.id
     and item.tenant_id = version.tenant_id
     and item.item_type = 'line'::public.estimate_item_type
    where version.id = '71000000-0000-4000-8000-000000000051'
  ),
  current_setting('test.v2_lifecycle_fingerprint')::jsonb,
  'context, totals, and all five snapshots remain unchanged through acceptance'
);

select throws_ok(
  $$
    update public.estimate_items
    set quantity = quantity + 1
    where id = '71000000-0000-4000-8000-000000000053'
  $$,
  '42501',
  'ESTIMATE_VERSION_READ_ONLY',
  'an accepted frozen v2 estimate rejects subsequent calculation input mutation'
);

select throws_ok(
  $$
    update public.estimate_items
    set category_id = '71000000-0000-4000-8000-000000000099'
    where id = '71000000-0000-4000-8000-000000000053'
  $$,
  '42501',
  'ESTIMATE_VERSION_READ_ONLY',
  'even service_role cannot apply a reference-field update to an accepted v2 item'
);

select throws_ok(
  $$
    delete from public.labor_roles
    where id = '71000000-0000-4000-8000-000000000060'
  $$,
  '23503',
  'ESTIMATE_LABOR_ROLE_ASSIGNMENT_IN_USE',
  'deleting a role cannot drive SET NULL into an accepted v2 estimate'
);

select throws_ok(
  $$
    delete from public.estimate_items
    where id = '71000000-0000-4000-8000-000000000053'
  $$,
  '42501',
  'ESTIMATE_VERSION_READ_ONLY',
  'even service_role cannot delete an accepted v2 item'
);

select is(
  (
    select count(*)
    from public.estimate_items item
    where item.version_id = '71000000-0000-4000-8000-000000000051'
  ),
  current_setting('test.v2_lifecycle_item_count')::bigint,
  'a rejected accepted-item deletion leaves the item set unchanged'
);

select is(
  (
    select jsonb_build_object(
      'content_revision', version.content_revision,
      'calc_snapshot_content_revision', version.calc_snapshot_content_revision,
      'calc_snapshot_context', version.calc_snapshot_context,
      'version_totals', jsonb_build_array(
        version.total_ht_cents,
        version.total_tax_cents,
        version.total_ttc_cents
      ),
      'line_id', item.id,
      'line_totals', jsonb_build_array(
        item.line_total_ht_cents,
        item.line_tax_cents,
        item.line_total_ttc_cents
      ),
      'line_snapshots', jsonb_build_array(
        item.snapshot_pu_ht_cents,
        item.snapshot_fo_ht_cents,
        item.snapshot_mo_ht_cents,
        item.snapshot_mo_atelier_ht_cents,
        item.snapshot_mo_chantier_ht_cents
      )
    )
    from public.estimate_versions as version
    join public.estimate_items as item
      on item.version_id = version.id
     and item.tenant_id = version.tenant_id
     and item.item_type = 'line'::public.estimate_item_type
    where version.id = '71000000-0000-4000-8000-000000000051'
  ),
  current_setting('test.v2_lifecycle_fingerprint')::jsonb,
  'rejected direct and referential post-acceptance mutations leave the frozen fingerprint intact'
);

select throws_ok(
  $$
    update public.estimate_versions
    set
      status = 'sending'::public.estimate_status,
      total_ht_cents = total_ht_cents + 1,
      total_ttc_cents = total_ttc_cents + 1
    where id = '71000000-0000-4000-8000-000000000041'
  $$,
  '40001',
  'ESTIMATE_V2_SNAPSHOT_STALE',
  'publication validates the candidate row and rejects a combined status and totals mutation'
);

select is(
  (
    select version.status::text
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'draft',
  'a rejected combined publication mutation leaves the estimate in draft'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$
    update public.estimate_items
    set snapshot_pu_ht_cents = snapshot_pu_ht_cents + 1
    where id = '71000000-0000-4000-8000-000000000043'
  $$,
  '42501',
  'ESTIMATE_V2_SNAPSHOT_IS_MANAGED',
  'an authenticated caller cannot mutate a managed snapshot directly'
);

select throws_ok(
  $$
    update public.estimate_versions
    set calc_snapshot_content_revision = content_revision + 1
    where id = '71000000-0000-4000-8000-000000000041'
  $$,
  '42501',
  'ESTIMATE_V2_SNAPSHOT_IS_MANAGED',
  'an authenticated caller cannot mutate the managed frozen revision directly'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    update public.estimate_versions
    set status = 'sending'::public.estimate_status
    where id = '71000000-0000-4000-8000-000000000041'
  $$,
  'a freshly frozen v2 estimate may enter publication'
);

select is(
  (
    select version.status::text
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'sending',
  'the successful publication transition is persisted'
);

select lives_ok(
  $$
    update public.estimate_versions
    set
      status = 'draft'::public.estimate_status,
      seal_hash = null
    where id = '71000000-0000-4000-8000-000000000041'
  $$,
  'the trusted workflow may return an unsealed sending version to draft'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  $$
    select public.duplicate_estimate_version(
      '71000000-0000-4000-8000-000000000101',
      false
    )
  $$,
  'P0001',
  'Estimate version not found or access denied',
  'duplication rejects an authenticated user outside the active source tenant'
);

reset role;

select set_config(
  'test.archived_duplicate_version_count',
  (
    select count(*)::text
    from public.estimate_versions as version
    where version.project_id = '71000000-0000-4000-8000-000000000010'
  ),
  true
);

update public.estimate_projects
set is_archived = true
where id = '71000000-0000-4000-8000-000000000010';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$
    select public.duplicate_estimate_version(
      '71000000-0000-4000-8000-000000000101',
      false
    )
  $$,
  'P0001',
  'Estimate version not found or access denied',
  'duplication rejects a source whose project is archived'
);

reset role;

select is(
  (
    select count(*)
    from public.estimate_versions as version
    where version.project_id = '71000000-0000-4000-8000-000000000010'
  ),
  current_setting('test.archived_duplicate_version_count')::bigint,
  'a rejected archived-project duplication creates no estimate version'
);

update public.estimate_projects
set is_archived = false
where id = '71000000-0000-4000-8000-000000000010';

select set_config(
  'test.duplicate_version_count',
  (
    select count(*)::text
    from public.estimate_versions as version
    where version.project_id = '71000000-0000-4000-8000-000000000010'
  ),
  true
);

update public.tenant_memberships
set role = 'viewer'::public.tenant_role
where user_id = '71000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$
    select public.duplicate_estimate_version(
      '71000000-0000-4000-8000-000000000101',
      false
    )
  $$,
  'P0001',
  'Estimate version not found or access denied',
  'duplication rejects a project owner whose tenant role is read-only'
);

reset role;

select is(
  (
    select count(*)
    from public.estimate_versions as version
    where version.project_id = '71000000-0000-4000-8000-000000000010'
  ),
  current_setting('test.duplicate_version_count')::bigint,
  'a rejected read-only owner duplication creates no estimate version'
);

update public.tenant_memberships
set role = 'engineer'::public.tenant_role
where user_id = '71000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$
    update public.estimate_items
    set quantity = 2
    where id = '71000000-0000-4000-8000-000000000043'
  $$,
  'an ordinary draft input mutation remains writable'
);

select ok(
  (
    select item.snapshot_pu_ht_cents is null
      and item.snapshot_fo_ht_cents is null
      and item.snapshot_mo_ht_cents is null
      and item.snapshot_mo_atelier_ht_cents is null
      and item.snapshot_mo_chantier_ht_cents is null
    from public.estimate_items as item
    where item.id = '71000000-0000-4000-8000-000000000043'
  ),
  'changing a calculation input invalidates all five stored snapshots'
);

select ok(
  (
    select version.calc_snapshot_content_revision <> version.content_revision
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'changing a calculation input makes the frozen revision stale'
);

reset role;
set local role service_role;

select throws_ok(
  $$
    update public.estimate_versions
    set status = 'sending'::public.estimate_status
    where id = '71000000-0000-4000-8000-000000000041'
  $$,
  '40001',
  'ESTIMATE_V2_SNAPSHOT_STALE',
  'publication is blocked again after a calculation input mutation'
);

select throws_ok(
  $$
    insert into public.estimate_review_cycles (
      id,
      tenant_id,
      version_id,
      cycle_number,
      requested_by,
      submission_message
    )
    select
      '71000000-0000-4000-8000-000000000068',
      version.tenant_id,
      version.id,
      1,
      '71000000-0000-4000-8000-000000000001',
      'Stale snapshot must not enter approval'
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  $$,
  '40001',
  'ESTIMATE_V2_SNAPSHOT_STALE',
  'review-cycle creation rejects a v2 snapshot invalidated at revision N+1'
);

select is(
  (
    select count(*)::integer
    from public.estimate_review_cycles cycle
    where cycle.id = '71000000-0000-4000-8000-000000000068'
  ),
  0,
  'a rejected stale v2 review cycle leaves no approval request behind'
);

select lives_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  'the v2 estimate can be re-frozen at revision N+1 before approval capture'
);

select lives_ok(
  $$
    insert into public.estimate_review_cycles (
      id,
      tenant_id,
      version_id,
      cycle_number,
      requested_by,
      submission_message
    )
    select
      '71000000-0000-4000-8000-000000000068',
      version.tenant_id,
      version.id,
      1,
      '71000000-0000-4000-8000-000000000001',
      'Fresh snapshot may enter approval'
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  $$,
  'review-cycle creation accepts the freshly re-frozen v2 revision'
);

select is(
  (
    select cycle.requested_content_revision
    from public.estimate_review_cycles cycle
    where cycle.id = '71000000-0000-4000-8000-000000000068'
  ),
  (
    select version.content_revision
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'the accepted approval cycle captures exactly the freshly frozen content revision'
);

select lives_ok(
  $$
    update public.estimate_review_cycles
    set
      decision = 'approved'::public.estimate_review_decision,
      decided_by = '71000000-0000-4000-8000-000000000001',
      decided_at = statement_timestamp()
    where id = '71000000-0000-4000-8000-000000000068'
  $$,
  'the freshly captured review cycle can complete its approval decision'
);

insert into public.estimate_rules (
  id,
  tenant_id,
  rule_type,
  scope_type,
  threshold_value,
  action,
  is_active
)
select
  fixture.id,
  version.tenant_id,
  'require_approval'::public.estimate_rule_type,
  'global'::public.estimate_rule_scope_type,
  0,
  'require_approval'::public.estimate_rule_action,
  true
from public.estimate_versions version
cross join (
  values
    ('71000000-0000-4000-8000-000000000074'::uuid),
    ('71000000-0000-4000-8000-000000000075'::uuid)
) fixture(id)
where version.id = '71000000-0000-4000-8000-000000000041';

select throws_ok(
  $$
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      '71000000-0000-4000-8000-000000000002',
      '71000000-0000-4000-8000-000000000003',
      array['71000000-0000-4000-8000-000000000074'::uuid],
      null,
      '{}'::jsonb
    )
  $$,
  '42501',
  'ESTIMATE_REVIEW_OPEN_FORBIDDEN',
  'atomic review submission rejects an actor outside the active tenant'
);

select throws_ok(
  $$
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000001',
      array['71000000-0000-4000-8000-000000000074'::uuid],
      null,
      '{}'::jsonb
    )
  $$,
  'P0001',
  'ESTIMATE_REVIEW_ASSIGNED_REVIEWER_INVALID',
  'atomic review submission requires an active admin or director reviewer'
);

select throws_ok(
  $$
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array['71000000-0000-4000-8000-000000000077'::uuid],
      null,
      '{}'::jsonb
    )
  $$,
  'P0001',
  'ESTIMATE_REVIEW_RULES_INVALID',
  'atomic review submission rejects missing or inactive tenant rules'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      public.current_tenant_id(),
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array['71000000-0000-4000-8000-000000000074'::uuid],
      null,
      '{}'::jsonb
    )
  $$,
  '42501',
  'permission denied for function open_estimate_review_cycle',
  'authenticated callers cannot invoke the service-role submission seam directly'
);

reset role;
set local role service_role;

select set_config(
  'test.review_open_first',
  (
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      version.tenant_id,
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array['71000000-0000-4000-8000-000000000074'::uuid],
      null,
      '{"requestedRuleLabels":["Governance approval A"]}'::jsonb
    )::text
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  true
);

select ok(
  (current_setting('test.review_open_first')::jsonb->>'created')::boolean
  and jsonb_array_length(
    current_setting('test.review_open_first')::jsonb->'approvals'
  ) = 1
  and (
    current_setting('test.review_open_first')::jsonb#>>
      '{cycle,requested_content_revision}'
  )::bigint = (
    select version.content_revision
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'atomic review submission creates one cycle with one linked approval at the fresh frozen revision'
);

select set_config(
  'test.review_cycle_r',
  current_setting('test.review_open_first')::jsonb#>>'{cycle,id}',
  true
);
select set_config(
  'test.review_approval_r',
  current_setting('test.review_open_first')::jsonb#>>'{approvals,0,id}',
  true
);

select is(
  (
    select count(*)::integer
    from public.estimate_version_events event
    where event.estimate_version_id =
      '71000000-0000-4000-8000-000000000041'
      and event.event_type = 'approval_submitted'
  ),
  1,
  'atomic review submission records approval_submitted in the same transaction'
);

select set_config(
  'test.review_open_retry',
  (
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      version.tenant_id,
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array['71000000-0000-4000-8000-000000000074'::uuid],
      null,
      '{"requestedRuleLabels":["Governance approval A"]}'::jsonb
    )::text
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  true
);

select ok(
  not (
    current_setting('test.review_open_retry')::jsonb->>'created'
  )::boolean
  and current_setting('test.review_open_retry')::jsonb#>>'{cycle,id}' =
    current_setting('test.review_cycle_r'),
  'an identical network retry reuses the fresh cycle and returns created=false'
);

select is(
  (
    select count(*)::integer
    from public.estimate_version_events event
    where event.estimate_version_id =
      '71000000-0000-4000-8000-000000000041'
      and event.event_type = 'approval_submitted'
  ),
  1,
  'the idempotent review retry creates neither a duplicate event nor a duplicate notification signal'
);

update public.estimate_versions version
set margin_bp = 4321
where version.id = '71000000-0000-4000-8000-000000000101';

select set_config(
  'test.review_open_tiered',
  (
    select public.open_estimate_review_cycle(
      '72000000-0000-4000-8000-000000000011',
      version.tenant_id,
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array['71000000-0000-4000-8000-000000000074'::uuid],
      'Tiered effective margin review',
      '{}'::jsonb
    )::text
    from public.estimate_versions version
    where version.id = '72000000-0000-4000-8000-000000000011'
  ),
  true
);

select set_config(
  'test.review_open_legacy_v1',
  (
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000101',
      version.tenant_id,
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array['71000000-0000-4000-8000-000000000074'::uuid],
      'Legacy margin review',
      '{}'::jsonb
    )::text
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000101'
  ),
  true
);

select ok(
  (current_setting('test.review_open_tiered')::jsonb->>'created')::boolean
  and (
    current_setting('test.review_open_legacy_v1')::jsonb->>'created'
  )::boolean
  and exists (
    select 1
    from public.estimate_review_cycles cycle
    join public.estimate_versions version on version.id = cycle.version_id
    where cycle.id = (
        current_setting('test.review_open_tiered')::jsonb#>>'{cycle,id}'
      )::uuid
      and cycle.requested_content_revision =
        version.calc_snapshot_content_revision
      and version.calc_snapshot_context->>'effective_margin_multiplier' =
        '1.6'
      and jsonb_array_length(
        version.calc_snapshot_context->'margin_tiers'
      ) = 3
  ),
  'fixed, tiered, and legacy queue fixtures open through the governed seam while the tiered cycle fingerprint targets its exact frozen effective-margin context'
);

select lives_ok(
  format(
    'insert into public.estimate_review_comments (id, tenant_id, version_id, cycle_id, scope_type, scope_id, scope_label, comment, created_by) values (%L::uuid, (select tenant_id from public.estimate_versions where id = %L::uuid), %L::uuid, %L::uuid, %L::public.estimate_review_comment_scope, null, %L, %L, %L::uuid)',
    '71000000-0000-4000-8000-000000000077',
    '71000000-0000-4000-8000-000000000041',
    '71000000-0000-4000-8000-000000000041',
    current_setting('test.review_cycle_r'),
    'project',
    'Initial active review',
    'This comment remains valid historical evidence after supersession.',
    '71000000-0000-4000-8000-000000000003'
  ),
  'an active cycle accepts a comment before a later resubmission supersedes it'
);

-- Compatibility fixture: pending approvals created before review_cycle_id was
-- introduced are superseded by version/rule, not silently left behind.
insert into public.estimate_approvals (
  id,
  tenant_id,
  version_id,
  rule_id,
  requested_by,
  status,
  review_cycle_id
)
select
  '71000000-0000-4000-8000-000000000076',
  version.tenant_id,
  version.id,
  '71000000-0000-4000-8000-000000000075',
  '71000000-0000-4000-8000-000000000001',
  'pending'::public.estimate_approval_status,
  null
from public.estimate_versions version
where version.id = '71000000-0000-4000-8000-000000000041';

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$
    update public.estimate_items
    set quantity = quantity + 1
    where id = '71000000-0000-4000-8000-000000000043'
  $$,
  'editing after submission advances the estimate content revision'
);

reset role;
set local role service_role;

select throws_ok(
  $$
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array[
        '71000000-0000-4000-8000-000000000074'::uuid,
        '71000000-0000-4000-8000-000000000075'::uuid
      ],
      'Revision N+1 submission',
      '{}'::jsonb
    )
  $$,
  '40001',
  'ESTIMATE_V2_SNAPSHOT_STALE',
  'review resubmission rejects revision N+1 until it is re-frozen'
);

select ok(
  (
    select cycle.superseded_at is null
    from public.estimate_review_cycles cycle
    where cycle.id = current_setting('test.review_cycle_r')::uuid
  )
  and (
    select approval.superseded_at is null
    from public.estimate_approvals approval
    where approval.id = '71000000-0000-4000-8000-000000000076'
  ),
  'a rejected stale resubmission rolls back without superseding either current or legacy pending work'
);

select lives_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  'revision N+1 is freshly frozen before review resubmission'
);

select set_config(
  'test.review_open_second',
  (
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      version.tenant_id,
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array[
        '71000000-0000-4000-8000-000000000074'::uuid,
        '71000000-0000-4000-8000-000000000075'::uuid
      ],
      'Revision N+1 submission',
      '{"notificationChannels":["email"]}'::jsonb
    )::text
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  true
);
select set_config(
  'test.review_cycle_r_plus_one',
  current_setting('test.review_open_second')::jsonb#>>'{cycle,id}',
  true
);

select ok(
  (current_setting('test.review_open_second')::jsonb->>'created')::boolean
  and current_setting('test.review_cycle_r_plus_one') <>
    current_setting('test.review_cycle_r')
  and (
    select count(*)::integer
    from public.estimate_approvals approval
    where approval.review_cycle_id =
      current_setting('test.review_cycle_r_plus_one')::uuid
      and approval.status = 'pending'::public.estimate_approval_status
      and approval.superseded_at is null
  ) = 2,
  'fresh revision N+1 creates a replacement cycle with both active pending approvals'
);

select ok(
  (
    select cycle.superseded_at is not null
      and cycle.superseded_by =
        '71000000-0000-4000-8000-000000000001'::uuid
      and cycle.superseded_by_cycle_id =
        current_setting('test.review_cycle_r_plus_one')::uuid
    from public.estimate_review_cycles cycle
    where cycle.id = current_setting('test.review_cycle_r')::uuid
  )
  and (
    select approval.superseded_at is not null
    from public.estimate_approvals approval
    where approval.id = current_setting('test.review_approval_r')::uuid
  )
  and (
    select approval.superseded_at is not null
      and approval.review_cycle_id is null
    from public.estimate_approvals approval
    where approval.id = '71000000-0000-4000-8000-000000000076'
  ),
  'resubmission atomically supersedes the stale cycle, its linked pending row, and the legacy null-cycle pending row'
);

select ok(
  (
    select count(*)::integer
    from public.estimate_review_cycles cycle
    where cycle.version_id = '71000000-0000-4000-8000-000000000041'
      and cycle.decision is null
      and cycle.superseded_at is null
  ) = 1
  and (
    select count(*)::integer
    from public.estimate_approvals approval
    where approval.version_id = '71000000-0000-4000-8000-000000000041'
      and approval.status = 'pending'::public.estimate_approval_status
      and approval.superseded_at is null
  ) = 2,
  'exactly one open cycle and its two pending approvals remain active after supersession'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

select is(
  (
    select count(*)::integer
    from public.list_approval_queue('priority') queue_entry
    where queue_entry.version_id =
      '71000000-0000-4000-8000-000000000041'
  ),
  1,
  'the approval queue returns only the replacement when old and new open-cycle rows coexist historically'
);

select is(
  (
    select queue_entry.cycle_id
    from public.list_approval_queue('priority') queue_entry
    where queue_entry.version_id =
      '71000000-0000-4000-8000-000000000041'
  ),
  current_setting('test.review_cycle_r_plus_one')::uuid,
  'the sole queued row is the active non-superseded review cycle'
);

select is(
  (
    select queue_entry.margin_bp
    from public.list_approval_queue('margin') queue_entry
    where queue_entry.version_id =
      '72000000-0000-4000-8000-000000000011'
  ),
  3750,
  'the approval queue exposes the tiered v2 effective multiplier as margin basis points'
);

select is(
  (
    select queue_entry.margin_bp
    from public.list_approval_queue('margin') queue_entry
    where queue_entry.version_id =
      '71000000-0000-4000-8000-000000000101'
  ),
  4321,
  'the approval queue preserves the stored historical margin_bp for engine v1'
);

select is(
  (
    select jsonb_agg(
      ordered_queue.version_id
      order by ordered_queue.position
    )
    from (
      select
        queue_entry.version_id,
        row_number() over () as position
      from public.list_approval_queue('margin') queue_entry
      where queue_entry.version_id in (
        '72000000-0000-4000-8000-000000000011'::uuid,
        '71000000-0000-4000-8000-000000000101'::uuid
      )
    ) ordered_queue
  ),
  '["72000000-0000-4000-8000-000000000011", "71000000-0000-4000-8000-000000000101"]'::jsonb,
  'margin queue ordering compares the effective v2 basis points with legacy v1 margin_bp'
);

reset role;
alter table public.estimate_versions
  disable trigger aaa_guard_estimate_version_workflow_columns;
update public.estimate_versions version
set calc_snapshot_content_revision = version.content_revision + 1
where version.id = '72000000-0000-4000-8000-000000000011';
alter table public.estimate_versions
  enable trigger aaa_guard_estimate_version_workflow_columns;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

select is(
  (
    select queue_entry.margin_bp
    from public.list_approval_queue('margin') queue_entry
    where queue_entry.version_id =
      '72000000-0000-4000-8000-000000000011'
  ),
  null::integer,
  'the approval queue never exposes an effective v2 margin from a stale snapshot context'
);

reset role;
alter table public.estimate_versions
  disable trigger aaa_guard_estimate_version_workflow_columns;
update public.estimate_versions version
set calc_snapshot_content_revision = version.content_revision
where version.id = '72000000-0000-4000-8000-000000000011';
alter table public.estimate_versions
  enable trigger aaa_guard_estimate_version_workflow_columns;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

reset role;
set local role service_role;

select throws_ok(
  format(
    'insert into public.estimate_review_comments (id, tenant_id, version_id, cycle_id, scope_type, scope_id, scope_label, comment, created_by) values (%L::uuid, (select tenant_id from public.estimate_versions where id = %L::uuid), %L::uuid, %L::uuid, %L::public.estimate_review_comment_scope, null, %L, %L, %L::uuid)',
    '71000000-0000-4000-8000-000000000083',
    '71000000-0000-4000-8000-000000000041',
    '71000000-0000-4000-8000-000000000041',
    current_setting('test.review_cycle_r'),
    'project',
    'Superseded review',
    'Historical cycles reject new comments.',
    '71000000-0000-4000-8000-000000000003'
  ),
  '42501',
  'ESTIMATE_REVIEW_CYCLE_SUPERSEDED',
  'even service_role cannot append a comment to a superseded review cycle'
);

select lives_ok(
  format(
    'insert into public.estimate_review_comments (id, tenant_id, version_id, cycle_id, scope_type, scope_id, scope_label, comment, created_by) values (%L::uuid, (select tenant_id from public.estimate_versions where id = %L::uuid), %L::uuid, %L::uuid, %L::public.estimate_review_comment_scope, null, %L, %L, %L::uuid)',
    '71000000-0000-4000-8000-000000000078',
    '71000000-0000-4000-8000-000000000041',
    '71000000-0000-4000-8000-000000000041',
    current_setting('test.review_cycle_r_plus_one'),
    'project',
    'Active review',
    'The active cycle still accepts review comments.',
    '71000000-0000-4000-8000-000000000003'
  ),
  'the active non-superseded cycle still accepts a review comment'
);

select throws_ok(
  format(
    'insert into public.estimate_review_correction_items (id, tenant_id, version_id, cycle_id, source_comment_id, scope_type, scope_id, scope_label, comment) values (%L::uuid, (select tenant_id from public.estimate_versions where id = %L::uuid), %L::uuid, %L::uuid, %L::uuid, %L::public.estimate_review_comment_scope, null, %L, %L)',
    '71000000-0000-4000-8000-000000000079',
    '71000000-0000-4000-8000-000000000041',
    '71000000-0000-4000-8000-000000000041',
    current_setting('test.review_cycle_r'),
    '71000000-0000-4000-8000-000000000078',
    'project',
    'Superseded correction',
    'A superseded cycle cannot receive correction work.'
  ),
  '42501',
  'ESTIMATE_REVIEW_CYCLE_SUPERSEDED',
  'a correction item cannot target a superseded review cycle'
);

select throws_ok(
  format(
    'insert into public.estimate_review_correction_items (id, tenant_id, version_id, cycle_id, source_comment_id, scope_type, scope_id, scope_label, comment) values (%L::uuid, (select tenant_id from public.estimate_versions where id = %L::uuid), %L::uuid, %L::uuid, %L::uuid, %L::public.estimate_review_comment_scope, null, %L, %L)',
    '71000000-0000-4000-8000-000000000098',
    '71000000-0000-4000-8000-000000000041',
    '71000000-0000-4000-8000-000000000041',
    current_setting('test.review_cycle_r_plus_one'),
    '71000000-0000-4000-8000-000000000077',
    'project',
    'Superseded source comment',
    'An active cycle cannot reuse a comment from a superseded cycle.'
  ),
  '42501',
  'ESTIMATE_REVIEW_COMMENT_SUPERSEDED',
  'a correction item cannot reuse a comment whose source cycle is superseded'
);

select is(
  (
    select count(*)::integer
    from public.estimate_review_comments comment
    where comment.id = '71000000-0000-4000-8000-000000000083'
  ),
  0,
  'the rejected historical comment leaves no row behind'
);

select ok(
  exists (
    select 1
    from public.estimate_review_comments comment
    join public.estimate_review_cycles cycle on cycle.id = comment.cycle_id
    where comment.id = '71000000-0000-4000-8000-000000000077'
      and cycle.superseded_at is not null
  ),
  'the comment written while active remains immutable historical evidence on the superseded cycle'
);

select is(
  (
    select count(*)::integer
    from public.estimate_review_correction_items correction
    where correction.id = '71000000-0000-4000-8000-000000000079'
  ),
  0,
  'the rejected superseded-cycle correction leaves no row behind'
);

select is(
  (
    select count(*)::integer
    from public.estimate_review_correction_items correction
    where correction.id = '71000000-0000-4000-8000-000000000098'
  ),
  0,
  'the rejected superseded-source-comment correction leaves no row behind'
);

select is(
  (
    select count(*)::integer
    from public.estimate_version_events event
    where event.estimate_version_id =
      '71000000-0000-4000-8000-000000000041'
      and event.event_type = 'approval_submitted'
  ),
  2,
  'the replacement submission journals exactly one additional approval_submitted event'
);

select is(
  (
    select count(*)::integer
    from public.estimate_version_events event
    where event.estimate_version_id =
      '71000000-0000-4000-8000-000000000041'
      and event.event_type = 'approval_submitted'
      and event.metadata->>'cycleId' =
        current_setting('test.review_cycle_r_plus_one')
  ),
  1,
  'the replacement cycle and its approval_submitted audit record commit together exactly once'
);

select ok(
  (
    select event.metadata->>'cycleId' =
      current_setting('test.review_cycle_r_plus_one')
      and (event.metadata->>'requestedApprovalCount')::integer = 2
      and event.metadata->>'assignedReviewerUserId' =
        '71000000-0000-4000-8000-000000000003'
      and event.metadata->'notificationChannels' = '["email"]'::jsonb
    from public.estimate_version_events event
    where event.estimate_version_id =
      '71000000-0000-4000-8000-000000000041'
      and event.event_type = 'approval_submitted'
    order by event.occurred_at desc, event.id desc
    limit 1
  ),
  'approval_submitted enriches caller metadata with the canonical cycle, reviewer, and approval count'
);

select is(
  coalesce(
    current_setting(
      'miaouffrage.estimate_review_cycle_supersession',
      true
    ),
    ''
  ),
  '',
  'the trusted supersession boundary is restored before the RPC returns'
);

select set_config(
  'test.review_open_second_retry',
  (
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      version.tenant_id,
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array[
        '71000000-0000-4000-8000-000000000074'::uuid,
        '71000000-0000-4000-8000-000000000075'::uuid
      ],
      'Revision N+1 submission',
      '{"notificationChannels":["email"]}'::jsonb
    )::text
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  true
);

select ok(
  not (
    current_setting('test.review_open_second_retry')::jsonb->>'created'
  )::boolean
  and current_setting('test.review_open_second_retry')::jsonb#>>'{cycle,id}' =
    current_setting('test.review_cycle_r_plus_one')
  and (
    select count(*)::integer
    from public.estimate_version_events event
    where event.estimate_version_id =
      '71000000-0000-4000-8000-000000000041'
      and event.event_type = 'approval_submitted'
  ) = 2,
  'same-revision resubmission is idempotent and does not duplicate its audit event'
);

reset role;
select set_config(
  'test.review_approval_r_plus_one_rule_74',
  (
    select approval.id::text
    from public.estimate_approvals approval
    where approval.review_cycle_id =
      current_setting('test.review_cycle_r_plus_one')::uuid
      and approval.rule_id = '71000000-0000-4000-8000-000000000074'::uuid
      and approval.superseded_at is null
  ),
  true
);
select set_config(
  'test.review_approval_r_plus_one_rule_75',
  (
    select approval.id::text
    from public.estimate_approvals approval
    where approval.review_cycle_id =
      current_setting('test.review_cycle_r_plus_one')::uuid
      and approval.rule_id = '71000000-0000-4000-8000-000000000075'::uuid
      and approval.superseded_at is null
  ),
  true
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

select throws_ok(
  format(
    'select public.decide_estimate_approval(%L::uuid, %L::public.estimate_approval_status)',
    current_setting('test.review_approval_r'),
    'approved'
  ),
  '42501',
  'ESTIMATE_APPROVAL_SUPERSEDED',
  'the decision RPC rejects a superseded approval without mutating active review state'
);

select throws_ok(
  format(
    'select * from public.decide_estimate_review_cycle(%L::uuid, %L::public.estimate_review_decision, %L::jsonb)',
    current_setting('test.review_cycle_r'),
    'approved',
    '[]'
  ),
  '42501',
  'ESTIMATE_REVIEW_CYCLE_SUPERSEDED',
  'the cycle decision RPC rejects a superseded cycle without synthesizing a decision'
);

select lives_ok(
  format(
    'select public.decide_estimate_approval(%L::uuid, %L::public.estimate_approval_status)',
    current_setting('test.review_approval_r_plus_one_rule_74'),
    'approved'
  ),
  'a reviewer can decide an approval belonging to the fresh replacement cycle'
);

reset role;
select is(
  (
    select approval.status::text
    from public.estimate_approvals approval
    where approval.review_cycle_id =
      current_setting('test.review_cycle_r_plus_one')::uuid
      and approval.rule_id = '71000000-0000-4000-8000-000000000074'
  ),
  'approved',
  'the fresh replacement approval persists the reviewer decision'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

select lives_ok(
  format(
    'select public.decide_estimate_approval(%L::uuid, %L::public.estimate_approval_status)',
    current_setting('test.review_approval_r_plus_one_rule_75'),
    'approved'
  ),
  'the reviewer can decide the final active approval without stale pending rows interfering'
);

reset role;
select ok(
  (
    select cycle.decision = 'approved'::public.estimate_review_decision
      and cycle.decided_by =
        '71000000-0000-4000-8000-000000000003'::uuid
      and cycle.decided_at is not null
    from public.estimate_review_cycles cycle
    where cycle.id = current_setting('test.review_cycle_r_plus_one')::uuid
  )
  and (
    select count(*)::integer
    from public.estimate_approvals approval
    where approval.review_cycle_id =
      current_setting('test.review_cycle_r_plus_one')::uuid
      and approval.status = 'approved'::public.estimate_approval_status
      and approval.superseded_at is null
  ) = 2,
  'the fresh replacement cycle closes only after both active approvals are decided'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    update public.estimate_items
    set quantity = quantity + 1
    where id = '71000000-0000-4000-8000-000000000043'
  $$,
  'a post-review draft edit prepares a fresh changes-requested review cycle'
);

select lives_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '71000000-0000-4000-8000-000000000041',
      (select tenant_id from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select updated_at from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      (select content_revision from public.estimate_versions where id = '71000000-0000-4000-8000-000000000041'),
      '71000000-0000-4000-8000-000000000001',
      'approval',
      '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000043","snapshot_pu_ht_cents":120,"snapshot_fo_ht_cents":80,"snapshot_mo_ht_cents":40,"snapshot_mo_atelier_ht_cents":10,"snapshot_mo_chantier_ht_cents":30,"line_total_ht_cents":120,"line_tax_cents":24,"line_total_ttc_cents":144}]'::jsonb,
      '{"total_ht_cents":120,"total_tax_cents":24,"total_ttc_cents":144}'::jsonb
    )
  $$,
  'the edited draft is re-frozen before its correction review'
);

select set_config(
  'test.review_open_correction',
  (
    select public.open_estimate_review_cycle(
      '71000000-0000-4000-8000-000000000041',
      version.tenant_id,
      '71000000-0000-4000-8000-000000000001',
      '71000000-0000-4000-8000-000000000003',
      array['71000000-0000-4000-8000-000000000074'::uuid],
      'Correction review',
      '{}'::jsonb
    )::text
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  true
);
select set_config(
  'test.review_cycle_correction',
  current_setting('test.review_open_correction')::jsonb#>>'{cycle,id}',
  true
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

select throws_ok(
  format(
    'select * from public.decide_estimate_review_cycle(%L::uuid, %L::public.estimate_review_decision, %L::jsonb)',
    current_setting('test.review_cycle_correction'),
    'changes_requested',
    '[]'
  ),
  '22023',
  'ESTIMATE_REVIEW_CORRECTION_COMMENTS_REQUIRED',
  'changes_requested is rejected without at least one correction comment'
);

select throws_ok(
  format(
    'select * from public.decide_estimate_review_cycle(%L::uuid, %L::public.estimate_review_decision, %L::jsonb)',
    current_setting('test.review_cycle_correction'),
    'approved_with_reservations',
    '[]'
  ),
  '22023',
  'ESTIMATE_REVIEW_RESERVATION_COMMENTS_REQUIRED',
  'approved_with_reservations is rejected without at least one reservation comment'
);

reset role;
select ok(
  (
    select cycle.decision is null
      and cycle.superseded_at is null
    from public.estimate_review_cycles cycle
    where cycle.id = current_setting('test.review_cycle_correction')::uuid
  )
  and (
    select count(*)::integer
    from public.estimate_approvals approval
    where approval.review_cycle_id =
      current_setting('test.review_cycle_correction')::uuid
      and approval.status = 'pending'::public.estimate_approval_status
      and approval.superseded_at is null
  ) = 1
  and (
    select count(*)::integer
    from public.estimate_review_comments comment
    where comment.cycle_id =
      current_setting('test.review_cycle_correction')::uuid
  ) = 0
  and (
    select count(*)::integer
    from public.estimate_review_correction_items correction
    where correction.cycle_id =
      current_setting('test.review_cycle_correction')::uuid
  ) = 0,
  'both comment-less cycle decision attempts roll back without closing the cycle or creating review rows'
);

reset role;
set local role service_role;

insert into public.estimate_approvals (
  id,
  tenant_id,
  version_id,
  rule_id,
  requested_by,
  status,
  review_cycle_id
)
select
  '71000000-0000-4000-8000-000000000084',
  version.tenant_id,
  version.id,
  '71000000-0000-4000-8000-000000000075',
  '71000000-0000-4000-8000-000000000001',
  'pending'::public.estimate_approval_status,
  current_setting('test.review_cycle_correction')::uuid
from public.estimate_versions version
where version.id = '71000000-0000-4000-8000-000000000041';

reset role;
select set_config(
  'test.review_approval_correction_pending',
  (
    select approval.id::text
    from public.estimate_approvals approval
    where approval.review_cycle_id =
      current_setting('test.review_cycle_correction')::uuid
      and approval.status = 'pending'::public.estimate_approval_status
      and approval.superseded_at is null
      and approval.id <> '71000000-0000-4000-8000-000000000084'::uuid
    limit 1
  ),
  true
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

select lives_ok(
  $$
    select public.decide_estimate_approval(
      '71000000-0000-4000-8000-000000000084',
      'rejected'::public.estimate_approval_status
    )
  $$,
  'an intermediate individual rejection remains compatible while another approval is pending'
);

reset role;
select ok(
  (
    select cycle.decision is null
    from public.estimate_review_cycles cycle
    where cycle.id = current_setting('test.review_cycle_correction')::uuid
  )
  and (
    select approval.status = 'rejected'::public.estimate_approval_status
    from public.estimate_approvals approval
    where approval.id = '71000000-0000-4000-8000-000000000084'
  )
  and (
    select count(*)::integer
    from public.estimate_approvals approval
    where approval.review_cycle_id =
      current_setting('test.review_cycle_correction')::uuid
      and approval.status = 'pending'::public.estimate_approval_status
      and approval.superseded_at is null
  ) = 1,
  'the intermediate rejection does not close the cycle while one approval remains pending'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

select throws_ok(
  format(
    'select public.decide_estimate_approval(%L::uuid, %L::public.estimate_approval_status)',
    current_setting('test.review_approval_correction_pending'),
    'approved'
  ),
  '22023',
  'ESTIMATE_REVIEW_CORRECTION_COMMENTS_REQUIRED',
  'a prior rejection prevents the last individual approval from closing the cycle without review comments'
);

reset role;
select ok(
  (
    select cycle.decision is null
    from public.estimate_review_cycles cycle
    where cycle.id = current_setting('test.review_cycle_correction')::uuid
  )
  and (
    select approval.status = 'rejected'::public.estimate_approval_status
    from public.estimate_approvals approval
    where approval.id = '71000000-0000-4000-8000-000000000084'
  )
  and (
    select count(*)::integer
    from public.estimate_approvals approval
    where approval.review_cycle_id =
      current_setting('test.review_cycle_correction')::uuid
      and approval.status = 'pending'::public.estimate_approval_status
      and approval.superseded_at is null
  ) = 1,
  'the failed comment-less closure rolls back only its attempted approval and leaves the cycle actionable through the cycle facade'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000003',
  true
);

select lives_ok(
  format(
    'select * from public.decide_estimate_review_cycle(%L::uuid, %L::public.estimate_review_decision, %L::jsonb)',
    current_setting('test.review_cycle_correction'),
    'changes_requested',
    '[{"scope_type":"project","scope_id":null,"scope_label":"Affaire complete","comment":"Corriger le perimetre avant une nouvelle soumission."},{"scope_type":"line","scope_id":"71000000-0000-4000-8000-000000000043","scope_label":"Ligne principale","comment":"Verifier le quantitatif de la ligne."}]'
  ),
  'changes_requested atomically records every comment and its correction checklist item'
);

reset role;
select ok(
  (
    select cycle.decision =
      'changes_requested'::public.estimate_review_decision
      and cycle.superseded_at is null
    from public.estimate_review_cycles cycle
    where cycle.id = current_setting('test.review_cycle_correction')::uuid
  )
  and (
    select count(*)::integer
    from public.estimate_review_comments comment
    where comment.cycle_id =
      current_setting('test.review_cycle_correction')::uuid
  ) = 2
  and (
    select count(*)::integer
    from public.estimate_review_correction_items correction
    where correction.cycle_id =
      current_setting('test.review_cycle_correction')::uuid
      and correction.status =
        'pending'::public.estimate_review_correction_status
  ) = 2
  and not exists (
    select 1
    from public.estimate_review_comments comment
    left join public.estimate_review_correction_items correction
      on correction.source_comment_id = comment.id
     and correction.cycle_id = comment.cycle_id
    where comment.cycle_id =
      current_setting('test.review_cycle_correction')::uuid
    group by comment.id
    having count(correction.id) <> 1
  ),
  'the changes-requested decision closes the active cycle with a one-to-one pending correction snapshot'
);

reset role;
select set_config(
  'test.review_correction_first',
  (
    select correction.id::text
    from public.estimate_review_correction_items correction
    where correction.cycle_id =
      current_setting('test.review_cycle_correction')::uuid
    order by correction.id
    limit 1
  ),
  true
);
select set_config(
  'test.review_correction_second',
  (
    select correction.id::text
    from public.estimate_review_correction_items correction
    where correction.cycle_id =
      current_setting('test.review_cycle_correction')::uuid
    order by correction.id
    offset 1
    limit 1
  ),
  true
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  format(
    'select public.record_estimate_review_correction_action(correction.id, %L::public.estimate_review_correction_status, null) from (values (%L::uuid), (%L::uuid)) as correction(id)',
    'corrected',
    current_setting('test.review_correction_first'),
    current_setting('test.review_correction_second')
  ),
  'the owner can treat every correction on a non-superseded changes-requested cycle'
);

reset role;
select ok(
  (
    select count(*)::integer = 2
      and count(*) filter (
        where correction.status =
          'corrected'::public.estimate_review_correction_status
      ) = 2
    from public.estimate_review_correction_items correction
    where correction.cycle_id =
      current_setting('test.review_cycle_correction')::uuid
  ),
  'the historical changes-requested correction treatment contract remains persisted'
);

reset role;

insert into public.tenant_memberships (
  id,
  tenant_id,
  user_id,
  role,
  is_default
)
select
  '71000000-0000-4000-8000-000000000058',
  owner_membership.tenant_id,
  '71000000-0000-4000-8000-000000000002',
  'engineer'::public.tenant_role,
  false
from public.tenant_memberships as owner_membership
where owner_membership.user_id = '71000000-0000-4000-8000-000000000001'
on conflict (tenant_id, user_id) do update
set role = excluded.role;

insert into public.labor_roles (
  id,
  tenant_id,
  user_id,
  name,
  hourly_rate_cents,
  is_active,
  position
)
select
  fixture.id,
  owner_membership.tenant_id,
  fixture.user_id,
  fixture.name,
  5000,
  true,
  fixture.position
from public.tenant_memberships as owner_membership
  cross join (
    values
    (
      '71000000-0000-4000-8000-000000000061'::uuid,
      '71000000-0000-4000-8000-000000000002'::uuid,
      'Owner B role'::text,
      2
    )
) as fixture(id, user_id, name, position)
where owner_membership.user_id = '71000000-0000-4000-8000-000000000001'
on conflict (id) do nothing;

set local role service_role;

select throws_ok(
  $$
    update public.estimate_projects
    set user_id = '71000000-0000-4000-8000-000000000002'
    where id = '71000000-0000-4000-8000-000000000040'
  $$,
  '23503',
  'ESTIMATE_PROJECT_OWNER_LABOR_ROLE_MISMATCH',
  'a v2 project cannot transfer from owner A to owner B while an item still references an owner A labor role'
);

select is(
  (
    select project.user_id
    from public.estimate_projects project
    where project.id = '71000000-0000-4000-8000-000000000040'
  ),
  '71000000-0000-4000-8000-000000000001'::uuid,
  'a rejected v2 project transfer leaves its owner unchanged'
);

select throws_ok(
  $$
    update public.labor_roles
    set user_id = '71000000-0000-4000-8000-000000000002'
    where id = '71000000-0000-4000-8000-000000000060'
  $$,
  '23503',
  'ESTIMATE_LABOR_ROLE_ASSIGNMENT_IN_USE',
  'a labor role referenced by a v2 estimate cannot be reassigned away from its project owner'
);

select is(
  (
    select role.user_id
    from public.labor_roles role
    where role.id = '71000000-0000-4000-8000-000000000060'
  ),
  '71000000-0000-4000-8000-000000000001'::uuid,
  'a rejected in-use labor-role reassignment leaves its owner unchanged'
);

select throws_ok(
  $$
    delete from public.labor_roles
    where id = '71000000-0000-4000-8000-000000000060'
  $$,
  '23503',
  'ESTIMATE_LABOR_ROLE_ASSIGNMENT_IN_USE',
  'a labor role referenced by a draft v2 estimate cannot be deleted through its SET NULL foreign key'
);

select ok(
  exists (
    select 1
    from public.labor_roles role
    where role.id = '71000000-0000-4000-8000-000000000060'
      and role.user_id = '71000000-0000-4000-8000-000000000001'
  ),
  'a rejected deletion leaves the referenced v2 labor role intact'
);

select throws_ok(
  $$
    insert into public.estimate_items (
      id,
      tenant_id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      labor_role_id,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
    )
    select
      '71000000-0000-4000-8000-000000000062',
      version.tenant_id,
      version.id,
      '71000000-0000-4000-8000-000000000042',
      'line'::public.estimate_item_type,
      2,
      'Rejected foreign-owner labor role line',
      '71000000-0000-4000-8000-000000000061',
      0,
      0,
      0
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000041'
  $$,
  '23503',
  'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH',
  'a direct v2 item insert rejects a labor role owned by another project owner'
);

select is(
  (
    select count(*)::integer
    from public.estimate_items as item
    where item.id = '71000000-0000-4000-8000-000000000062'
  ),
  0,
  'the rejected direct v2 item insert creates no line'
);

select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000002',
  true
);

select throws_ok(
  $$
    select public.persist_estimate_creation_atomic(
      (
        select membership.tenant_id
        from public.tenant_memberships as membership
        where membership.user_id = '71000000-0000-4000-8000-000000000001'
      ),
      '71000000-0000-4000-8000-000000000002',
      null,
      '{"id":"71000000-0000-4000-8000-000000000063","name":"Rejected owner B labor role project"}'::jsonb,
      '{"id":"71000000-0000-4000-8000-000000000064","title":"Rejected owner B labor role version","date_devis":"2026-08-12","validite_jours":30,"margin_multiplier":1,"margin_mode":"fixed","currency":"EUR","margin_bp":0,"discount_bp":0,"discount_mode":"simple","discount_steps":[],"global_coefficient":1,"tax_rate_bp":2000,"rounding_mode":"none","rounding_step_cents":1,"max_section_depth":3,"calc_engine_version":2,"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0}'::jsonb,
      '[{"id":"71000000-0000-4000-8000-000000000065","parent_id":null,"item_type":"section","position":1,"title":"Rejected role section"},{"id":"71000000-0000-4000-8000-000000000066","parent_id":"71000000-0000-4000-8000-000000000065","item_type":"line","position":1,"title":"Rejected owner A role in owner B project","labor_role_id":"71000000-0000-4000-8000-000000000060","line_total_ht_cents":0,"line_tax_cents":0,"line_total_ttc_cents":0}]'::jsonb,
      null
    )
  $$,
  '23503',
  'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH',
  'canonical v2 persistence rejects an owner A labor role for an owner B project'
);

select ok(
  not exists (
    select 1
    from public.estimate_projects as project
    where project.id = '71000000-0000-4000-8000-000000000063'
  )
  and not exists (
    select 1
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000064'
  ),
  'a rejected canonical labor-role mismatch leaves no project or version'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$
    select public.duplicate_estimate_version(
      '71000000-0000-4000-8000-000000000101',
      false
    )
  $$,
  'duplication accepts a v1 source'
);

reset role;
select is(
  (
    select version.calc_engine_version::integer
    from public.estimate_versions as version
    where version.project_id = '71000000-0000-4000-8000-000000000010'
      and version.version_number = 5
  ),
  1,
  'duplication preserves a v1 source contract'
);

select is(
  (
    select jsonb_agg(item.aid order by item.aid)
    from public.estimate_items item
    join public.estimate_versions version on version.id = item.version_id
    where version.project_id = '71000000-0000-4000-8000-000000000010'
      and version.version_number = 5
      and item.aid is not null
  ),
  (
    select jsonb_agg(item.aid order by item.aid)
    from public.estimate_items item
    where item.version_id = '71000000-0000-4000-8000-000000000101'
      and item.aid is not null
  ),
  'duplication preserves every v1 item AID'
);

select ok(
  exists (
    select 1
    from public.takeoff_version_links link
    join public.estimate_versions target on target.id = link.target_version_id
    where link.takeoff_job_id = '71000000-0000-4000-8000-000000000080'
      and link.source_version_id = '71000000-0000-4000-8000-000000000101'
      and target.project_id = '71000000-0000-4000-8000-000000000010'
      and target.version_number = 5
  )
  and not exists (
    select 1
    from public.takeoff_dpgf_review_decisions decision
    where decision.takeoff_job_id = '71000000-0000-4000-8000-000000000080'
  ),
  'a direct source takeoff job with no review decision is linked atomically to the v1 duplicate'
);

select ok(
  exists (
    select 1
    from public.takeoff_version_links link
    join public.estimate_versions target on target.id = link.target_version_id
    where link.takeoff_job_id = '71000000-0000-4000-8000-000000000081'
      and link.source_version_id = '71000000-0000-4000-8000-000000000103'
      and target.project_id = '71000000-0000-4000-8000-000000000010'
      and target.version_number = 5
  ),
  'an inherited takeoff link is propagated from the v1 source to its duplicate'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select lives_ok(
  $$
    select public.duplicate_estimate_version(
      '71000000-0000-4000-8000-000000000102',
      false
    )
  $$,
  'duplication accepts a v2 source'
);

reset role;
select is(
  (
    select version.calc_engine_version::integer
    from public.estimate_versions as version
    where version.project_id = '71000000-0000-4000-8000-000000000010'
      and version.version_number = 6
  ),
  2,
  'duplication preserves a v2 source contract'
);

select is(
  (
    select jsonb_agg(item.aid order by item.aid)
    from public.estimate_items item
    join public.estimate_versions version on version.id = item.version_id
    where version.project_id = '71000000-0000-4000-8000-000000000010'
      and version.version_number = 6
      and item.aid is not null
  ),
  (
    select jsonb_agg(item.aid order by item.aid)
    from public.estimate_items item
    where item.version_id = '71000000-0000-4000-8000-000000000102'
      and item.aid is not null
  ),
  'duplication preserves every v2 item AID'
);

select ok(
  exists (
    select 1
    from public.takeoff_version_links link
    join public.estimate_versions target on target.id = link.target_version_id
    where link.takeoff_job_id = '71000000-0000-4000-8000-000000000082'
      and link.source_version_id = '71000000-0000-4000-8000-000000000102'
      and target.project_id = '71000000-0000-4000-8000-000000000010'
      and target.version_number = 6
  ),
  'a direct v2 takeoff job is linked atomically to the v2 duplicate without requiring a review decision'
);

with legacy_creator(signature) as (
  values
    ('public.instantiate_estimate_from_template(uuid,text,text,date,integer)'),
    ('public.instantiate_estimate_template_into_project(uuid,uuid,text,date,integer)'),
    ('public.create_affaire_from_import_lines(uuid,text,text,text,text,text,jsonb)'),
    ('public.create_estimate_version_from_import_lines(uuid,uuid,text,text,jsonb)')
)
select ok(
  to_regprocedure(legacy_creator.signature) is not null
  and not has_function_privilege(
    'anon',
    legacy_creator.signature,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    legacy_creator.signature,
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    legacy_creator.signature,
    'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )
    ) as acl_entry
    where procedure.oid = to_regprocedure(legacy_creator.signature)
      and acl_entry.grantee = 0
      and acl_entry.privilege_type = 'EXECUTE'
  ),
  format(
    '%s remains internal and is not executable by PUBLIC or Data API roles',
    legacy_creator.signature
  )
)
from legacy_creator;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '71000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$
    update public.estimate_versions
    set calc_engine_version = 2
    where id = '71000000-0000-4000-8000-000000000101'
  $$,
  '42501',
  'ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE',
  'a draft v1 estimate cannot be rewritten to v2'
);

select throws_ok(
  $$
    update public.estimate_versions
    set calc_engine_version = 1
    where id = '71000000-0000-4000-8000-000000000102'
  $$,
  '42501',
  'ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE',
  'a draft v2 estimate cannot be rewritten to v1'
);

select is(
  (
    select version.calc_engine_version::integer
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000101'
  ),
  1,
  'the rejected upgrade leaves the draft v1 contract unchanged'
);

select is(
  (
    select version.calc_engine_version::integer
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000102'
  ),
  2,
  'the rejected downgrade leaves the draft v2 contract unchanged'
);

select throws_ok(
  $$
    update public.estimate_versions
    set calc_engine_version = 2
    where id = '71000000-0000-4000-8000-000000000103'
  $$,
  '42501',
  'ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE',
  'a sent v1 estimate cannot be rewritten to v2'
);

select throws_ok(
  $$
    update public.estimate_versions
    set calc_engine_version = 2
    where id = '71000000-0000-4000-8000-000000000104'
  $$,
  '42501',
  'ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE',
  'an accepted v1 estimate cannot be rewritten to v2'
);

select is(
  (
    select version.calc_engine_version::integer
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000103'
  ),
  1,
  'the sent historical estimate remains on engine v1'
);

select is(
  (
    select version.calc_engine_version::integer
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000104'
  ),
  1,
  'the accepted historical estimate remains on engine v1'
);

select is(
  (
    select version.calc_engine_version::integer
    from public.estimate_versions as version
    where version.id = '71000000-0000-4000-8000-000000000101'
  ),
  1,
  'governed creations and duplications never rewrite the historical v1 source'
);

reset role;
set local role service_role;

select ok(
  not has_function_privilege(
    'authenticated',
    'public.invalidate_estimate_v2_snapshot_context()',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.invalidate_estimate_v2_snapshot_context()',
    'EXECUTE'
  ),
  'the context invalidator is trigger-only and cannot be called through Data API roles'
);

select set_config(
  'test.accepted_v2_context_fingerprint',
  (
    select jsonb_build_object(
      'content_revision', version.content_revision,
      'calc_snapshot_content_revision',
        version.calc_snapshot_content_revision,
      'calc_snapshot_context', version.calc_snapshot_context
    )::text
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000051'
  ),
  true
);

select set_config(
  'miaouffrage.estimate_v2_snapshot_freeze',
  'on',
  true
);

update public.estimate_versions version
set calc_snapshot_context =
  '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5000}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb
where version.id = '71000000-0000-4000-8000-000000000041';

update public.estimate_versions version
set calc_snapshot_content_revision = version.content_revision
where version.id = '71000000-0000-4000-8000-000000000041';

update public.estimate_versions version
set calc_snapshot_context =
  '{"labor_split_enabled":false,"labor_roles":[],"margin_tiers":[{"threshold_cents":0,"multiplier":1.6},{"threshold_cents":10000000,"multiplier":1.45},{"threshold_cents":100000000,"multiplier":1.4}],"effective_margin_multiplier":1.6}'::jsonb
where version.id = '72000000-0000-4000-8000-000000000011';

update public.estimate_versions version
set calc_snapshot_content_revision = version.content_revision
where version.id = '72000000-0000-4000-8000-000000000011';

select set_config(
  'test.tiered_context_revision',
  (
    select version.content_revision::text
    from public.estimate_versions version
    where version.id = '72000000-0000-4000-8000-000000000011'
  ),
  true
);

select set_config(
  'miaouffrage.estimate_v2_snapshot_freeze',
  'off',
  true
);

insert into public.margin_tiers (
  tenant_id,
  threshold_cents,
  multiplier,
  position
)
select
  version.tenant_id,
  0,
  1.61,
  0
from public.estimate_versions version
where version.id = '72000000-0000-4000-8000-000000000011';

select ok(
  (
    select version.calc_snapshot_content_revision is null
      and version.calc_snapshot_context is null
      and version.content_revision >
        current_setting('test.tiered_context_revision')::bigint
    from public.estimate_versions version
    where version.id = '72000000-0000-4000-8000-000000000011'
  ),
  'a margin-tier mutation atomically invalidates a fresh tiered v2 draft snapshot'
);

select ok(
  (
    select version.calc_snapshot_content_revision = version.content_revision
      and version.calc_snapshot_context is not null
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'a margin-tier mutation leaves a fixed-margin v2 draft snapshot fresh'
);

select set_config(
  'test.fixed_context_revision',
  (
    select version.content_revision::text
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  true
);

update public.labor_roles role
set hourly_rate_cents = role.hourly_rate_cents + 1
where role.id = '71000000-0000-4000-8000-000000000060';

select ok(
  (
    select version.calc_snapshot_content_revision is null
      and version.calc_snapshot_context is null
      and version.content_revision >
        current_setting('test.fixed_context_revision')::bigint
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'an hourly-rate mutation atomically invalidates each referencing v2 draft snapshot'
);

select set_config(
  'miaouffrage.estimate_v2_snapshot_freeze',
  'on',
  true
);

update public.estimate_versions version
set calc_snapshot_context =
  '{"labor_split_enabled":false,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5001}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb
where version.id = '71000000-0000-4000-8000-000000000041';

update public.estimate_versions version
set calc_snapshot_content_revision = version.content_revision
where version.id = '71000000-0000-4000-8000-000000000041';

select set_config(
  'test.fixed_context_revision',
  (
    select version.content_revision::text
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  true
);

select set_config(
  'miaouffrage.estimate_v2_snapshot_freeze',
  'off',
  true
);

update public.feature_flags flag
set enabled = not flag.enabled
where flag.tenant_id = (
    select version.tenant_id
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  )
  and flag.flag_key = 'EST_031_LABOR_SPLIT';

select ok(
  (
    select version.calc_snapshot_content_revision is null
      and version.calc_snapshot_context is null
      and version.content_revision >
        current_setting('test.fixed_context_revision')::bigint
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'the labor-split feature flag atomically invalidates every v2 draft snapshot in its tenant'
);

select set_config(
  'miaouffrage.estimate_v2_snapshot_freeze',
  'on',
  true
);

update public.estimate_versions version
set calc_snapshot_context =
  '{"labor_split_enabled":true,"labor_roles":[{"id":"71000000-0000-4000-8000-000000000060","hourly_rate_cents":5001}],"margin_tiers":[],"effective_margin_multiplier":1}'::jsonb
where version.id = '71000000-0000-4000-8000-000000000041';

update public.estimate_versions version
set calc_snapshot_content_revision = version.content_revision
where version.id = '71000000-0000-4000-8000-000000000041';

select set_config(
  'miaouffrage.estimate_v2_snapshot_freeze',
  'off',
  true
);

insert into public.feature_flags (tenant_id, flag_key, enabled)
select
  version.tenant_id,
  'UNRELATED_ESTIMATE_TEST_FLAG',
  true
from public.estimate_versions version
where version.id = '71000000-0000-4000-8000-000000000041';

select ok(
  (
    select version.calc_snapshot_content_revision = version.content_revision
      and version.calc_snapshot_context is not null
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000041'
  ),
  'an unrelated feature flag does not invalidate v2 calculation snapshots'
);

select set_config(
  'miaouffrage.estimate_v2_snapshot_invalidation',
  'on',
  true
);

select throws_ok(
  $$
    update public.estimate_versions
    set
      calc_snapshot_content_revision = null,
      calc_snapshot_context = null
    where id = '71000000-0000-4000-8000-000000000041'
  $$,
  '42501',
  'ESTIMATE_V2_SNAPSHOT_IS_MANAGED',
  'the internal invalidation setting cannot bypass the snapshot guard outside its trigger'
);

select set_config(
  'miaouffrage.estimate_v2_snapshot_invalidation',
  'off',
  true
);

select is(
  (
    select jsonb_build_object(
      'content_revision', version.content_revision,
      'calc_snapshot_content_revision',
        version.calc_snapshot_content_revision,
      'calc_snapshot_context', version.calc_snapshot_context
    )
    from public.estimate_versions version
    where version.id = '71000000-0000-4000-8000-000000000051'
  ),
  current_setting('test.accepted_v2_context_fingerprint')::jsonb,
  'live calculation-context mutations never rewrite an accepted v2 snapshot'
);

select * from finish();
rollback;
