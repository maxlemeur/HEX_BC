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

-- A user of another tenant (review of 2.8): the entry bridge must not serve them.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000', '28000000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'estimate-engine-v3-entry-paths-other@example.test',
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

-- TPL3, a template saved from a v3 with split labour (review of 2.8): E carries only workshop hours per
-- unit, 0,0004 h/u for 1 u (its line hours round to 0,000 h); inserted into a v3 it keeps 0,0004 h/u.
insert into public.estimate_templates (id, tenant_id, created_by, name) values
  ('28000000-0000-4000-8000-000000000203', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000001', 'EP28 modèle v3 ventilé');
insert into public.estimate_template_items (id, tenant_id, template_id, parent_id, item_type, position, title) values
  ('28000000-0000-4000-8000-000000000231', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000203', null, 'section', 1, 'EP28 lot ventilé');
insert into public.estimate_template_items (id, tenant_id, template_id, parent_id, item_type, position, title, description, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, h_mo_atelier, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents,
  unit_code, h_mo_atelier_per_unit)
values ('28000000-0000-4000-8000-000000000232', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000203',
  '28000000-0000-4000-8000-000000000231', 'line', 1, 'EP28 E atelier', 'u', 1, 1000, 2000, 1, 0, 1, 0, 1000, 0, 0, 0, 'u', 0.0004);

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

-- H (review of 2.8), a reviewed generated ouvrage for the v3, as the WFC02 native fixture: one supply
-- component of 0,03 €, under the draft lock of the owner's session.
insert into public.draft_locks (version_id, user_id, session_id, expires_at)
values ('28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000001', '28000000-0000-4000-8000-000000000701', clock_timestamp() + interval '1 hour');
insert into public.estimate_generated_ouvrage_drafts (id, tenant_id, project_id, target_version_id, created_by, source_kind, status, summary)
values ('28000000-0000-4000-8000-000000000601', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000010', '28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000001', 'free_text', 'pending', '{"totalCandidates":1,"pendingCount":1}');
insert into public.estimate_generated_ouvrage_candidates (id, tenant_id, project_id, target_version_id, draft_id, candidate_order,
  designation, normalized_designation, unit, quantity, confidence, ai_status, resolution_status)
values ('28000000-0000-4000-8000-000000000611', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000010', '28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000601', 0, 'EP28 H généré', 'ep28 h genere', 'm', 1, 1, 'certain', 'pending');
insert into public.estimate_generated_ouvrage_source_fragments (id, tenant_id, project_id, draft_id, fragment_order, source_kind, label,
  excerpt, normalized_excerpt)
values ('28000000-0000-4000-8000-000000000621', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000010', '28000000-0000-4000-8000-000000000601', 0, 'free_text', 'Source H', 'Fourniture H trois centimes', 'fourniture h trois centimes');
insert into public.estimate_generated_ouvrage_candidate_sources (id, tenant_id, draft_id, candidate_id, source_fragment_id, source_rank, rationale)
values ('28000000-0000-4000-8000-000000000631', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000601', '28000000-0000-4000-8000-000000000611', '28000000-0000-4000-8000-000000000621', 0, 'Preuve candidat');
insert into public.estimate_generated_ouvrage_subdetail_drafts (id, tenant_id, project_id, target_version_id, draft_id, parent_work_id,
  created_by, status, summary, generation_metadata)
values ('28000000-0000-4000-8000-000000000641', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000010', '28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000601', '28000000-0000-4000-8000-000000000611', '28000000-0000-4000-8000-000000000001', 'reviewed',
  '{"component_count":1,"ds_cents":3,"indicative_target_price_cents":3,"confidence":1,"pricing_source":"manual","risk_signals":[],"facts":[],"hypotheses":[],"inferences":[],"margin_multiplier":1}',
  jsonb_build_object('reviewed_candidate', jsonb_build_object('designation', 'EP28 H généré', 'unit', 'm', 'quantity', 1)));
insert into public.estimate_generated_ouvrage_subdetail_items (id, tenant_id, project_id, draft_id, subdetail_id, parent_work_id,
  source_fragment_id, component_order, status, cost_type, designation, unit, quantity, unit_cost_ht_cents, confidence)
values ('28000000-0000-4000-8000-000000000651', current_setting('test.tenant_id')::uuid, '28000000-0000-4000-8000-000000000010', '28000000-0000-4000-8000-000000000601', '28000000-0000-4000-8000-000000000641', '28000000-0000-4000-8000-000000000611', '28000000-0000-4000-8000-000000000621', 0, 'manual', 'material', 'FO H', 'm', 1, 3, 1);

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
      ('T4', 'template', '28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000203'),
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
  $$select case_name, outcome from ep28_outcome where case_name in ('T1', 'T2', 'T1-v2', 'T4', 'A1', 'A2', 'A3') order by case_name$$,
  $$values ('A1'::text, 'ok'::text),
           ('A2', '22023 ESTIMATE_V3_ASSEMBLY_HOURS_PER_UNIT_INEXACT | EP28 Y robinet'),
           ('A3', '22023 ESTIMATE_V3_ASSEMBLY_HOURS_WITHOUT_QUANTITY | EP28 Z vanne'),
           ('T1', 'ok'),
           ('T1-v2', 'ok'),
           ('T2', '22023 ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY | EP28 D sans quantité'),
           ('T4', 'ok')$$,
  'v3 entry paths convert or refuse by name; a template still enters a v2 as before'
);

select results_eq(
  $$select title, unit_code, pricing_status::text, quantity, h_mo_per_unit, h_mo
    from public.estimate_items
    where version_id = '28000000-0000-4000-8000-000000000101' and item_type = 'line' and title like 'EP28 _ %'
      and title not in ('EP28 G ouvrage généré', 'EP28 E atelier')
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

select results_eq(
  $$select h_mo_per_unit, h_mo_atelier_per_unit from public.estimate_items
    where version_id = '28000000-0000-4000-8000-000000000101' and title = 'EP28 E atelier'$$,
  $$values (null::numeric, 0.0004::numeric)$$,
  'a template line saved from a v3 with only workshop hours per unit keeps them (never reconverted from 0,000 h)'
);

-- H: the generated ouvrage enters the v3 through commit_generated_ouvrages, without client projection.
do $generated_commit$
declare
  review jsonb;
  response jsonb;
  context jsonb;
  preferred jsonb;
  version_token timestamptz;
begin
  begin
    review := public.read_generated_ouvrage_review('28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000601', '28000000-0000-4000-8000-000000000611');
    select updated_at into version_token from public.estimate_versions where id = '28000000-0000-4000-8000-000000000101';
    select jsonb_build_object('id', role.id, 'name', role.name, 'hourly_rate_cents', role.hourly_rate_cents,
        'is_active', role.is_active, 'position', role.position)
      into preferred
    from public.labor_roles role
    where role.tenant_id = current_setting('test.tenant_id')::uuid and role.user_id = '28000000-0000-4000-8000-000000000001' and role.is_active
    order by role.position, role.id limit 1;
    context := jsonb_build_object('labor_roles', '[]'::jsonb, 'margin_tiers', '[]'::jsonb, 'labor_split_flag',
      (select jsonb_build_object('id', flag.id, 'enabled', flag.enabled) from public.feature_flags flag
       where flag.tenant_id = current_setting('test.tenant_id')::uuid and flag.flag_key = 'EST_031_LABOR_SPLIT'));
    response := public.commit_generated_ouvrages('28000000-0000-4000-8000-000000000101', '28000000-0000-4000-8000-000000000601', '28000000-0000-4000-8000-000000000661', version_token, '28000000-0000-4000-8000-000000000701',
      jsonb_build_array(jsonb_build_object('candidateId', '28000000-0000-4000-8000-000000000611', 'designation', 'EP28 H généré', 'unit', 'm', 'quantity', 1,
        'lotId', '28000000-0000-4000-8000-000000000111', 'reviewToken', review ->> 'reviewToken')),
      jsonb_build_array(jsonb_build_object('candidateId', '28000000-0000-4000-8000-000000000611', 'subdetailId', '28000000-0000-4000-8000-000000000641', 'estimateItemId', '28000000-0000-4000-8000-000000000671',
        'assemblyId', '28000000-0000-4000-8000-000000000672', 'applicationId', '28000000-0000-4000-8000-000000000673', 'snapshotId', '28000000-0000-4000-8000-000000000674', 'resolvedLotId', '28000000-0000-4000-8000-000000000111',
        'placementMode', 'explicit',
        'estimateItemMapping', jsonb_build_object('source', 'generated_ouvrage_subdetail_review', 'mode', 'no_labor',
          'unitPriceHtCents', 3, 'hMo', 0, 'kFo', 1, 'kMo', 1, 'laborRoleId', null, 'laborRoleName', null,
          'laborRoleHourlyRateCents', null, 'totalDsCents', 3, 'nonLaborDsCents', 3, 'laborDsCents', 0,
          'costBreakdown', jsonb_build_array(jsonb_build_object('costType', 'material', 'componentCount', 1, 'quantity', 1, 'dsCents', 3)),
          'laborTrace', '[]'::jsonb),
        'componentProjections', jsonb_build_array(jsonb_build_object('componentId', '28000000-0000-4000-8000-000000000651', 'kFo', 1, 'kMo', 0, 'hMo', 0, 'dsCents', 3)),
        'item', jsonb_build_object('item_type', 'line', 'parent_id', '28000000-0000-4000-8000-000000000111', 'title', 'EP28 H généré', 'description', 'm',
          'quantity', 1, 'unit_price_ht_cents', 3, 'k_fo', 1, 'h_mo', 0, 'k_mo', 1, 'labor_role_id', null,
          'source_provider', 'generated_ouvrage', 'source_file_name', null, 'source_page', null))),
      null, '[]'::jsonb, '{}'::jsonb, context, preferred);
    insert into ep28_outcome values ('H', format('%s|%s', response ->> 'ok',
      coalesce(nullif(current_setting('miaouffrage.estimate_v3_writer', true), ''), 'closed')));
  exception when others then
    insert into ep28_outcome values ('H', sqlstate || ' ' || sqlerrm);
  end;
end
$generated_commit$;

select results_eq(
  $$select o.outcome, i.unit_code, i.pricing_status::text, i.h_mo_per_unit, i.pu_ht_cents
    from ep28_outcome o left join public.estimate_items i on i.id = '28000000-0000-4000-8000-000000000671'
    where o.case_name = 'H'$$,
  $$values ('true|closed'::text, 'ml'::text, 'priced'::text, 0::numeric, 4)$$,
  'a generated ouvrage enters a v3: unit through the referential (m → ml), hours per unit, PU of the v3 engine (0,03 € × 1,3), contract closed'
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

-- D5, §6.2: a template saved from a v3 keeps the sale coefficients of the version; others stay null.
select results_eq(
  $$select template.name, (to_jsonb(template) ->> 'sale_coefficient_fo')::numeric, (to_jsonb(template) ->> 'sale_coefficient_mo')::numeric
    from public.estimate_templates template
    where template.name in ('EP28 modèle v3', 'EP28 modèle v2')
    order by template.name$$,
  $$values ('EP28 modèle v2'::text, null::numeric, null::numeric),
           ('EP28 modèle v3', 1.3::numeric, 1.2::numeric)$$,
  'a template saved from a v3 carries its sale coefficients (D5); a template of engines 1 and 2 none'
);

-- The entry bridge serves only a member of the version's tenant, even inside a writer contract.
select set_config('request.jwt.claim.sub', '28000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', '28000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
do $other_tenant$
begin
  begin
    perform set_config('miaouffrage.estimate_v3_writer', '28000000-0000-4000-8000-000000000101', true);
    perform public.estimate_v3_complete_entry_for_writer('28000000-0000-4000-8000-000000000101', '{}');
    insert into ep28_outcome values ('B', 'ok');
  exception when others then
    insert into ep28_outcome values ('B', sqlstate || ' ' || sqlerrm);
  end;
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
end
$other_tenant$;

select is(
  (select outcome from ep28_outcome where case_name = 'B'),
  '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'the entry bridge refuses a user of another tenant, even under a writer contract'
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
