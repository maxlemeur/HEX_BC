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
  '8b000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'estimate-line-nature@example.test',
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

insert into public.estimate_projects (
  id,
  tenant_id,
  user_id,
  name,
  is_archived
)
select
  '8b000000-0000-4000-8000-000000000010',
  membership.tenant_id,
  membership.user_id,
  'Line nature fixture',
  false
from public.tenant_memberships membership
where membership.user_id = '8b000000-0000-4000-8000-000000000001';

insert into public.estimate_versions (
  id,
  tenant_id,
  project_id,
  version_number,
  status,
  calc_engine_version
)
select
  '8b000000-0000-4000-8000-000000000011',
  project.tenant_id,
  project.id,
  1,
  'draft'::public.estimate_status,
  1
from public.estimate_projects project
where project.id = '8b000000-0000-4000-8000-000000000010';

insert into public.estimate_items (
  id,
  tenant_id,
  version_id,
  item_type,
  position,
  title,
  line_nature
)
select
  '8b000000-0000-4000-8000-000000000012',
  version.tenant_id,
  version.id,
  'section'::public.estimate_item_type,
  0,
  'Section',
  'supply_only'::public.estimate_line_nature
from public.estimate_versions version
where version.id = '8b000000-0000-4000-8000-000000000011';

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
  '8b000000-0000-4000-8000-000000000012',
  'line'::public.estimate_item_type,
  fixture.position,
  fixture.title,
  1,
  fixture.unit_price_ht_cents,
  2000,
  1,
  fixture.h_mo,
  1,
  fixture.unit_price_ht_cents,
  fixture.unit_price_ht_cents,
  round(fixture.unit_price_ht_cents * 0.2)::integer,
  round(fixture.unit_price_ht_cents * 1.2)::integer
from public.estimate_versions version
cross join (
  values
    ('8b000000-0000-4000-8000-000000000013'::uuid, 1, 'Supply', 1000, 0::numeric),
    ('8b000000-0000-4000-8000-000000000014'::uuid, 2, 'Labor', 0, 2::numeric),
    ('8b000000-0000-4000-8000-000000000015'::uuid, 3, 'Mixed', 1000, 2::numeric)
) as fixture(id, position, title, unit_price_ht_cents, h_mo)
where version.id = '8b000000-0000-4000-8000-000000000011';

select has_column(
  'public',
  'estimate_items',
  'line_nature',
  'estimate items expose the persisted line nature'
);

select is(
  (
    select item.line_nature::text
    from public.estimate_items item
    where item.id = '8b000000-0000-4000-8000-000000000012'
  ),
  null,
  'sections never carry a line nature'
);

select is(
  (
    select item.line_nature::text
    from public.estimate_items item
    where item.id = '8b000000-0000-4000-8000-000000000013'
  ),
  'supply_only',
  'a priced line without labor defaults to supply-only'
);

select is(
  (
    select item.line_nature::text
    from public.estimate_items item
    where item.id = '8b000000-0000-4000-8000-000000000014'
  ),
  'labor_only',
  'a labor line without supply defaults to labor-only'
);

select is(
  (
    select item.line_nature::text
    from public.estimate_items item
    where item.id = '8b000000-0000-4000-8000-000000000015'
  ),
  'supply_and_labor',
  'a line with both inputs defaults to the mixed nature'
);

select is(
  public.bulk_update_estimate_items(
    '8b000000-0000-4000-8000-000000000011',
    '[{"id":"8b000000-0000-4000-8000-000000000013","line_nature":"supply_and_labor"}]'::jsonb,
    null,
    (
      select version.updated_at
      from public.estimate_versions version
      where version.id = '8b000000-0000-4000-8000-000000000011'
    )
  ),
  1,
  'the atomic bulk editor persists an explicit line nature'
);

select is(
  (
    select item.line_nature::text
    from public.estimate_items item
    where item.id = '8b000000-0000-4000-8000-000000000013'
  ),
  'supply_and_labor',
  'the explicit line nature survives the bulk update'
);

select is(
  (
    select rule.threshold_value::bigint
    from public.estimate_rules rule
    join public.tenant_memberships membership
      on membership.tenant_id = rule.tenant_id
    where membership.user_id = '8b000000-0000-4000-8000-000000000001'
      and rule.rule_type = 'require_approval'::public.estimate_rule_type
      and rule.scope_type = 'global'::public.estimate_rule_scope_type
      and rule.scope_id is null
    order by rule.created_at asc
    limit 1
  ),
  500000::bigint,
  'the tenant receives the configurable 5,000 EUR HT approval default'
);

update public.estimate_items
set
  line_nature = 'supply_only'::public.estimate_line_nature,
  h_mo = 1
where id = '8b000000-0000-4000-8000-000000000013';

set local role service_role;

select throws_ok(
  $$
    select public.freeze_estimate_v2_snapshot(
      '8b000000-0000-4000-8000-000000000011',
      (select tenant_id from public.estimate_versions where id = '8b000000-0000-4000-8000-000000000011'),
      (select updated_at from public.estimate_versions where id = '8b000000-0000-4000-8000-000000000011'),
      (select content_revision from public.estimate_versions where id = '8b000000-0000-4000-8000-000000000011'),
      '8b000000-0000-4000-8000-000000000001',
      'approval',
      '{}'::jsonb,
      '[]'::jsonb,
      '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0,"rounding_adjustment_cents":0}'::jsonb
    )
  $$,
  '22023',
  'ESTIMATE_LINE_NATURE_MISMATCH',
  'the database refuses to freeze a line whose selected nature hides entered labor'
);

reset role;

select * from finish();
rollback;
