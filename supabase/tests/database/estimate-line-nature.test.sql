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

-- TI-539 : « POSE SEULE » est une nature persistée, choisie explicitement. Aucune écriture ne la déduit d'un prix
-- vide ou nul, et aucune saisie de fourniture ne la promeut : l'incohérence reste visible jusqu'au choix de
-- l'utilisateur.
select ok(
  'pose_only' = any(enum_range(null::public.estimate_line_nature)::text[]),
  'POSE SEULE is a persisted line nature'
);

-- The legacy bulk editor keeps its transaction-scoped work table, so it cannot run twice in this transaction:
-- the explicit choice is written directly and goes through the normalisation trigger.
update public.estimate_items
set line_nature = 'pose_only'::public.estimate_line_nature
where id = '8b000000-0000-4000-8000-000000000014';

select is(
  (
    select array[item.line_nature::text, (item.h_mo = 2)::text, (item.unit_price_ht_cents = 0)::text]
    from public.estimate_items item
    where item.id = '8b000000-0000-4000-8000-000000000014'
  ),
  array['pose_only', 'true', 'true'],
  'an explicit POSE SEULE is kept by the normalisation trigger, with the labor of the line and its zero supply cost'
);

select is(
  private.canonical_estimate_batch_operations(
    '[{"op":"update","id":"8b000000-0000-4000-8000-000000000014","data":{"line_nature":"pose_only"}}]'::jsonb
  ) #>> '{0,data,line_nature}',
  'pose_only',
  'the batch writer accepts an explicit POSE SEULE'
);

select throws_ok(
  $$
    select private.canonical_estimate_batch_operations(
      '[{"op":"update","id":"8b000000-0000-4000-8000-000000000014","data":{"line_nature":"pose"}}]'::jsonb
    )
  $$,
  null,
  null,
  'the batch writer still refuses an unknown line nature'
);

insert into public.estimate_items (
  id, tenant_id, version_id, parent_id, item_type, position, title, quantity, unit_price_ht_cents, tax_rate_bp,
  k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
)
select
  '8b000000-0000-4000-8000-000000000016', version.tenant_id, version.id, '8b000000-0000-4000-8000-000000000012',
  'line'::public.estimate_item_type, 4, 'Labor without supply', 1, 0, 2000, 1, 3, 1, 0, 0, 0, 0
from public.estimate_versions version
where version.id = '8b000000-0000-4000-8000-000000000011';

select is(
  (
    select item.line_nature::text
    from public.estimate_items item
    where item.id = '8b000000-0000-4000-8000-000000000016'
  ),
  'labor_only',
  'a line created without supply is never inferred as POSE SEULE'
);

-- La copie d'une version (nouvelle version ou variante) garde la nature choisie de chaque ligne : la mention
-- « POSE SEULE » ne quitte pas le devis copié, et rien n'y est re-déduit des valeurs.
set local role authenticated;
select set_config('request.jwt.claim.sub', '8b000000-0000-4000-8000-000000000001', true);
select set_config(
  'line_nature_test.duplicate_id',
  public.duplicate_estimate_version('8b000000-0000-4000-8000-000000000011', false)::text,
  true
);
reset role;

select is(
  (
    select array_agg(copy.line_nature::text order by copy.position, copy.title)
    from public.estimate_items copy
    where copy.version_id = current_setting('line_nature_test.duplicate_id')::uuid
      and copy.item_type = 'line'::public.estimate_item_type
  ),
  (
    select array_agg(source.line_nature::text order by source.position, source.title)
    from public.estimate_items source
    where source.version_id = '8b000000-0000-4000-8000-000000000011'
      and source.item_type = 'line'::public.estimate_item_type
  ),
  'a duplicated version keeps the nature of each line'
);

select is(
  (
    select count(*)::integer
    from public.estimate_items copy
    where copy.version_id = current_setting('line_nature_test.duplicate_id')::uuid
      and copy.line_nature = 'pose_only'::public.estimate_line_nature
  ),
  1,
  'the POSE SEULE line of the source is still POSE SEULE in the copy'
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
