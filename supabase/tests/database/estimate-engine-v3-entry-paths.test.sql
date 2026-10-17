-- Lot 2, sub-lot 2.8 (M6): v3 entry paths. Contract: docs/testing/estimate-engine-v3-2.8.md.
-- Isolation is justified there: the SQL conversions and named refusals of the template, library assembly
-- and generated ouvrage paths are not all observable from a journey. Every call that depends on M6 runs
-- inside an exception block that records its outcome, so that before the migration this file fails on
-- named assertions instead of aborting.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000', '28000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'estimate-engine-v3-entry-paths@example.test',
  crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);

select set_config(
  'test.tenant_id',
  (select membership.tenant_id::text from public.tenant_memberships membership
   where membership.user_id = '28000000-0000-4000-8000-000000000001' limit 1),
  true
);

create temporary table ep28_outcome (case_name text primary key, outcome text) on commit drop;
grant all on ep28_outcome to authenticated;

-- Fixture: one affaire, a v3 draft (V3) and a v2 draft (V2), seeded by the native owner without a
-- contract like the 2.5 fixtures; the v3 section is written under the v3 writer contract.
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('28000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000001', 'EP28 affaire');
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values ('28000000-0000-4000-8000-000000000101', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000010',
  1, 3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0);
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth, currency)
values ('28000000-0000-4000-8000-000000000102', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000010',
  2, 2, 3, 'EUR');
select set_config('miaouffrage.estimate_v3_writer', '28000000-0000-4000-8000-000000000101', true);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title) values
  ('28000000-0000-4000-8000-000000000111', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000101',
   'section', 1, 'EP28 lot généré');
select set_config('miaouffrage.estimate_v3_writer', '', true);

-- TPL1, a template saved from a v1/v2 estimate (line hours): A 10 ml × 5 h (0,5 h/u exact),
-- B 3000 u × 1 h (0,0003 h/u, which gives back 0,900 h: listed), C 2 m2 without hours.
-- TPL2: D, no quantity but 2 h (refused, named).
insert into public.estimate_templates (id, tenant_id, created_by, name) values
  ('28000000-0000-4000-8000-000000000201', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000001', 'EP28 modèle v2'),
  ('28000000-0000-4000-8000-000000000202', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000001', 'EP28 modèle sans quantité');
insert into public.estimate_template_items (id, tenant_id, template_id, parent_id, item_type, position, title) values
  ('28000000-0000-4000-8000-000000000211', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000201', null, 'section', 1, 'EP28 lot modèle'),
  ('28000000-0000-4000-8000-000000000221', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000202', null, 'section', 1, 'EP28 lot vide');
insert into public.estimate_template_items (id, tenant_id, template_id, parent_id, item_type, position, title, description, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
select line.id::uuid, current_setting('test.tenant_id')::uuid, line.template::uuid, line.parent::uuid, 'line', line.position,
  line.title, line.unit, line.quantity, 1000, 2000, 1, line.hours, 1, 1000, 0, 0, 0
from (values
  ('28000000-0000-4000-8000-000000000212', '28000000-0000-4000-8000-000000000201', '28000000-0000-4000-8000-000000000211', 1, 'EP28 A tube', 'ml', 10::numeric, 5::numeric),
  ('28000000-0000-4000-8000-000000000213', '28000000-0000-4000-8000-000000000201', '28000000-0000-4000-8000-000000000211', 2, 'EP28 B collier', 'u', 3000::numeric, 1::numeric),
  ('28000000-0000-4000-8000-000000000214', '28000000-0000-4000-8000-000000000201', '28000000-0000-4000-8000-000000000211', 3, 'EP28 C dalle', 'm2', 2::numeric, 0::numeric),
  ('28000000-0000-4000-8000-000000000222', '28000000-0000-4000-8000-000000000202', '28000000-0000-4000-8000-000000000221', 1, 'EP28 D sans quantité', 'u', 0::numeric, 2::numeric)
) as line(id, template, parent, position, title, unit, quantity, hours);

-- AS1: X 10 ml for 5 h (0,5 h/u); AS2: Y 3 u for 1 h (0,3333… h/u, not exact: refused);
-- AS3: Z without default quantity but 2 h (refused).
insert into public.estimate_assemblies (id, tenant_id, created_by, name) values
  ('28000000-0000-4000-8000-000000000301', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000001', 'EP28 ouvrage exact'),
  ('28000000-0000-4000-8000-000000000302', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000001', 'EP28 ouvrage inexact'),
  ('28000000-0000-4000-8000-000000000303', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000001', 'EP28 ouvrage sans quantité');
insert into public.estimate_assembly_items (id, tenant_id, assembly_id, title, unit, default_quantity, h_mo, position, cost_type,
  unit_cost_ht_cents)
select item.id::uuid, current_setting('test.tenant_id')::uuid, item.assembly::uuid, item.title, item.unit, item.quantity, item.hours,
  1, 'material', 500
from (values
  ('28000000-0000-4000-8000-000000000311', '28000000-0000-4000-8000-000000000301', 'EP28 X tube', 'ml', 10::numeric, 5::numeric),
  ('28000000-0000-4000-8000-000000000312', '28000000-0000-4000-8000-000000000302', 'EP28 Y robinet', 'u', 3::numeric, 1::numeric),
  ('28000000-0000-4000-8000-000000000313', '28000000-0000-4000-8000-000000000303', 'EP28 Z vanne', 'u', 0::numeric, 2::numeric)
) as item(id, assembly, title, unit, quantity, hours);

-- Template columns -----------------------------------------------------------------------------

select has_column('public', 'estimate_template_items', 'unit_code', 'a template line can carry a v3 unit code');
select has_column('public', 'estimate_template_items', 'pricing_status', 'a template line can carry a v3 pricing status');
select has_column('public', 'estimate_template_items', 'h_mo_per_unit', 'a template line can carry hours per unit');
select has_column('public', 'estimate_template_items', 'h_mo_atelier_per_unit', 'a template line can carry workshop hours per unit');
select has_column('public', 'estimate_template_items', 'h_mo_chantier_per_unit', 'a template line can carry site hours per unit');

-- Generated ouvrage line (rendement par unité), written by the native owner under the writer contract ---

do $generated$
begin
  begin
    perform set_config('miaouffrage.estimate_v3_writer', '28000000-0000-4000-8000-000000000101', true);
    perform private.generated_ouvrage_insert_line('28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000121',
      jsonb_build_object('item_type', 'line', 'parent_id', '28000000-0000-4000-8000-000000000111', 'title', 'EP28 G ouvrage généré',
        'description', 'u', 'unit_code', 'u', 'quantity', 4, 'h_mo_per_unit', 0.25, 'source_provider', 'generated_ouvrage'),
      jsonb_build_object('pu_ht_cents', 0, 'line_total_ht_cents', 0, 'line_tax_cents', 0, 'line_total_ttc_cents', 0));
    insert into ep28_outcome values ('G', 'ok');
  exception when others then
    insert into ep28_outcome values ('G', sqlstate || ' ' || sqlerrm);
  end;
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
end
$generated$;

select results_eq(
  $$select o.outcome, i.unit_code, i.quantity, i.h_mo_per_unit, i.h_mo
    from ep28_outcome o left join public.estimate_items i on i.id = '28000000-0000-4000-8000-000000000121'
    where o.case_name = 'G'$$,
  $$values ('ok'::text, 'u'::text, 4::numeric, 0.25::numeric, 1::numeric)$$,
  'a generated ouvrage line in a v3 carries its yield per unit (0,25 h/u × 4 = 1 h), never a total'
);

-- Application paths (authenticated owner) ---------------------------------------------------------

select set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '28000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;

do $paths$
declare
  case_row record;
  failure_detail text;
begin
  for case_row in
    select * from (values
      ('T1', 'template', '28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000201'),
      ('T2', 'template', '28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000202'),
      ('T1-v2', 'template', '28000000-0000-4000-8000-000000000102', '28000000-0000-4000-8000-000000000201'),
      ('A1', 'assembly', '28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000301'),
      ('A2', 'assembly', '28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000302'),
      ('A3', 'assembly', '28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000303')
    ) as cases(case_name, kind, version_id, source_id)
  loop
    begin
      if case_row.kind = 'template' then
        perform public.insert_estimate_template_into_version(case_row.version_id::uuid, case_row.source_id::uuid, null);
      else
        perform public.insert_estimate_assembly_into_version(case_row.version_id::uuid, case_row.source_id::uuid, null);
      end if;
      insert into ep28_outcome values (case_row.case_name, 'ok');
    exception when others then
      get stacked diagnostics failure_detail = pg_exception_detail;
      insert into ep28_outcome values (case_row.case_name,
        sqlstate || ' ' || sqlerrm || coalesce(' | ' || nullif(failure_detail, ''), ''));
    end;
  end loop;
end
$paths$;

select results_eq(
  $$select case_name, outcome from ep28_outcome where case_name in ('T1', 'T2', 'T1-v2', 'A1', 'A2', 'A3') order by case_name$$,
  $$values ('A1'::text, 'ok'::text),
           ('A2', '22023 ESTIMATE_V3_ASSEMBLY_HOURS_PER_UNIT_INEXACT | EP28 Y robinet'),
           ('A3', '22023 ESTIMATE_V3_ASSEMBLY_HOURS_WITHOUT_QUANTITY | EP28 Z vanne'),
           ('T1', 'ok'),
           ('T1-v2', 'ok'),
           ('T2', '22023 ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY | EP28 D sans quantité')$$,
  'v3 entry paths convert or refuse by name; a template still enters a v2 as before'
);

select results_eq(
  $$select title, unit_code, pricing_status::text, quantity, h_mo_per_unit, h_mo
    from public.estimate_items
    where version_id = '28000000-0000-4000-8000-000000000101' and item_type = 'line' and title like 'EP28 _ %'
      and title <> 'EP28 G ouvrage généré'
    order by title$$,
  $$values ('EP28 A tube'::text, 'ml'::text, 'priced'::text, 10::numeric, 0.5::numeric, 5::numeric),
           ('EP28 B collier', 'u', 'priced', 3000::numeric, 0.0003::numeric, 0.9::numeric),
           ('EP28 C dalle', 'm2', 'priced', 2::numeric, 0::numeric, 0::numeric),
           ('EP28 X tube', 'ml', 'priced', 10::numeric, 0.5::numeric, 5::numeric)$$,
  'a v2 template converts line hours to hours per unit (h / Q, 4 decimals) and an assembly divides by its default quantity'
);

select results_eq(
  $$select title, description, unit_code, quantity, h_mo, h_mo_per_unit
    from public.estimate_items
    where version_id = '28000000-0000-4000-8000-000000000102' and item_type = 'line'
    order by title$$,
  $$values ('EP28 A tube'::text, 'ml'::text, null::text, 10::numeric, 5::numeric, null::numeric),
           ('EP28 B collier', 'u', null, 3000::numeric, 1::numeric, null::numeric),
           ('EP28 C dalle', 'm2', null, 2::numeric, 0::numeric, null::numeric)$$,
  'a template enters a v2 unchanged: line hours, unit in the description, no v3 column'
);

-- A template saved from the v3 keeps its hours per unit and unit codes.
do $from_v3$
declare
  template_id uuid;
begin
  begin
    template_id := public.create_estimate_template_from_version('28000000-0000-4000-8000-000000000101', 'EP28 modèle v3', null);
    insert into ep28_outcome values ('T3', template_id::text);
  exception when others then
    insert into ep28_outcome values ('T3', 'error ' || sqlstate || ' ' || sqlerrm);
  end;
end
$from_v3$;

select results_eq(
  $$select item.title, to_jsonb(item) ->> 'unit_code', (to_jsonb(item) ->> 'h_mo_per_unit')::numeric, item.h_mo
    from public.estimate_template_items item
    join ep28_outcome o on o.case_name = 'T3' and o.outcome !~ '^error' and item.template_id = o.outcome::uuid
    where item.item_type = 'line' and item.title in ('EP28 A tube', 'EP28 X tube')
    order by item.title$$,
  $$values ('EP28 A tube'::text, 'ml'::text, 0.5::numeric, 5::numeric),
           ('EP28 X tube', 'ml', 0.5::numeric, 5::numeric)$$,
  'a template saved from a v3 keeps the hours per unit and unit codes of its lines'
);

reset role;

select is(
  (select total_ht_cents from public.estimate_versions where id = '28000000-0000-4000-8000-000000000101')
    = ((private.estimate_v3_compute('28000000-0000-4000-8000-000000000101') -> 'totals' ->> 'total_ht_cents')::integer)
    and exists (select 1 from public.estimate_items where version_id = '28000000-0000-4000-8000-000000000101'
      and title = 'EP28 A tube'),
  true,
  'the v3 totals stored after the insertions are those of the v3 engine'
);

select * from finish();
rollback;
