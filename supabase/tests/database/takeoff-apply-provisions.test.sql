-- TI-686 D10/D12 (migration …_takeoff_apply_provisions.sql): a takeoff line forced past the apply guard by an
-- administrator, or whose quantity was entered as a hypothesis, reaches the estimate as an internal provision. Its
-- estimate line carries source_metadata.takeoff_provision, written in the application's own transaction by both
-- guarded overloads (without DPGF lines, and with a DPGF authorization). The client never sees it: the line prints as
-- an ordinary priced line (H9), and no client output reads source_metadata (Vitest guards).
-- Isolation justified: the forced lines come from the override audit the apply trigger consumes in the same
-- transaction, and the cases compare stored amounts across engines; no journey can read both.
-- Cases written before the migration (red on deaed1a3):
-- - a forced line and an entered hypothesis carry no marker, through either overload and either engine (2 and 3);
-- - a DPGF target reconciled from a forced and a verified source carries no marker;
-- - a hypothesis folded into an ouvrage leaves its materialized line unmarked;
-- - a later merge onto a marked line, with no provision source, cannot remove a marker that was never written;
-- - the writing helper does not exist.
-- Since TI-681 (20261109205839) low confidence no longer blocks: each forced line is blocked by a protection that still
-- does (H8, one per case): no localized proof or no page on level C, a blocked material, results to compute again. Its
-- job's override is consumed. Cases written on TI-681 (red on the M3 that rebuilt the overloads from their pre-TI-681
-- bodies): two created length lines of one estimate line are merged by finalize_takeoff_lengths, once rounded, and the
-- merged line carries the marker of its provision sources, through either overload.
-- Guards (green before the migration): stored amounts and totals equal the same application with the line's proof
-- instead of the override; another job's override consumed in the same version, even when it names this job's line,
-- marks nothing of this job.
-- TI-686 D10 (…_takeoff_apply_force_reasons.sql): the override names each forced line with its coded reason, and the
-- marker carries it (forced_reason: a false positive of the blocked material, the other lines forced with an
-- unconditional reason); red on the M3 writer, which wrote null. All values are fictional.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

-- Fixtures -----------------------------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values ('00000000-0000-0000-0000-000000000000', 'c3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'provisions-admin@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

update public.tenant_memberships set role = 'admin'::public.tenant_role
where user_id = 'c3000000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = 'c3000000-0000-4000-8000-000000000001' limit 1), true);

insert into public.estimate_projects (id, tenant_id, user_id, name)
values ('c3000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  'c3000000-0000-4000-8000-000000000001', 'Provisions de métré (fictif)');

-- Drafts: ...101 v3 without DPGF line (4 arguments: forced, hypothesis, ouvrage, then a merge), ...102 its twin with V
-- instead of the override, ...103 engine 2 (4 arguments), ...104 v3 with a DPGF line (5 arguments: reconciled target),
-- ...105 engine 2 with a DPGF line (5 arguments).
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
select fixture.id, current_setting('test.tenant_id')::uuid, 'c3000000-0000-4000-8000-000000000010', fixture.number,
  fixture.engine, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1,
  case when fixture.engine = 3 then 1.3 end, case when fixture.engine = 3 then 1.2 end,
  case when fixture.engine = 3 then 0 end, case when fixture.engine = 3 then 0 end, case when fixture.engine = 3 then 0 end,
  0, 0, 0
from (values
  ('c3000000-0000-4000-8000-000000000101'::uuid, 1, 3),
  ('c3000000-0000-4000-8000-000000000102'::uuid, 2, 3),
  ('c3000000-0000-4000-8000-000000000103'::uuid, 3, 2),
  ('c3000000-0000-4000-8000-000000000104'::uuid, 4, 3),
  ('c3000000-0000-4000-8000-000000000105'::uuid, 5, 2)
) as fixture(id, number, engine);

do $seed$
declare
  seeded record;
begin
  for seeded in
    select * from (values
      ('c3000000-0000-4000-8000-000000000101'::uuid, 'c3000000-0000-4000-8000-000000000111'::uuid),
      ('c3000000-0000-4000-8000-000000000102'::uuid, 'c3000000-0000-4000-8000-000000000112'::uuid),
      ('c3000000-0000-4000-8000-000000000103'::uuid, 'c3000000-0000-4000-8000-000000000113'::uuid),
      ('c3000000-0000-4000-8000-000000000104'::uuid, 'c3000000-0000-4000-8000-000000000114'::uuid),
      ('c3000000-0000-4000-8000-000000000105'::uuid, 'c3000000-0000-4000-8000-000000000115'::uuid)
    ) as section(version_id, id)
  loop
    perform set_config('miaouffrage.estimate_v3_writer', seeded.version_id::text, true);
    insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
    values (seeded.id, current_setting('test.tenant_id')::uuid, seeded.version_id, 'section', 1, 'Lot fictif');
  end loop;

  -- The DPGF price line the 5-argument applications reconcile (TI-680), chiffrée by the engine 3.
  perform set_config('miaouffrage.estimate_v3_writer', 'c3000000-0000-4000-8000-000000000104', true);
  insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
    unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
    line_total_ttc_cents, source_provider, source_file_name, source_page, source_metadata, fo_provision)
  values ('c3000000-0000-4000-8000-000000000124', current_setting('test.tenant_id')::uuid,
    'c3000000-0000-4000-8000-000000000104', 'c3000000-0000-4000-8000-000000000114', 'line', 1, 'EF cuivre DN 22', 'ml', 30,
    'ml', 1000, 2000, 1, 0, 1, 1000, 30000, 6000, 36000, 'dpgf', 'dpgf-fictif.xlsx', 7,
    '{"dpgf_source_quantity":30,"dpgf_source_unit":"ml","fixture":"preserve"}', 1);
  perform public.estimate_v3_complete_entry_for_writer('c3000000-0000-4000-8000-000000000104',
    array['c3000000-0000-4000-8000-000000000124'::uuid]);
  perform set_config('miaouffrage.estimate_v3_writer', '', true);

  -- An engine 2 DPGF line the 5-argument application leaves alone.
  insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
    unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
    line_total_ttc_cents, source_provider, source_file_name, source_page, source_metadata, fo_provision)
  values ('c3000000-0000-4000-8000-000000000125', current_setting('test.tenant_id')::uuid,
    'c3000000-0000-4000-8000-000000000105', 'c3000000-0000-4000-8000-000000000115', 'line', 1, 'Réseau DPGF fictif', 'u', 2,
    5000, 2000, 1, 0, 1, 5000, 10000, 2000, 12000, 'dpgf', 'dpgf-fictif.xlsx', 3, '{"dpgf_source_quantity":2}', 1);
end
$seed$;

-- Level C jobs. Since TI-681, confidence only recommends a review: each forced line is blocked by a protection that
-- still blocks (H8), and only an administrator's override lifts it.
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select fixture.id, current_setting('test.tenant_id')::uuid, fixture.version_id, 'C', 'completed', 'plan-fictif.pdf',
  'c3000000-0000-4000-8000-000000000001'
from (values
  ('c3000000-0000-4000-8000-000000000201'::uuid, 'c3000000-0000-4000-8000-000000000101'::uuid),
  ('c3000000-0000-4000-8000-000000000202'::uuid, 'c3000000-0000-4000-8000-000000000101'::uuid),
  ('c3000000-0000-4000-8000-000000000203'::uuid, 'c3000000-0000-4000-8000-000000000102'::uuid),
  ('c3000000-0000-4000-8000-000000000204'::uuid, 'c3000000-0000-4000-8000-000000000103'::uuid),
  ('c3000000-0000-4000-8000-000000000205'::uuid, 'c3000000-0000-4000-8000-000000000104'::uuid),
  ('c3000000-0000-4000-8000-000000000206'::uuid, 'c3000000-0000-4000-8000-000000000104'::uuid),
  ('c3000000-0000-4000-8000-000000000207'::uuid, 'c3000000-0000-4000-8000-000000000105'::uuid)
) as fixture(id, version_id);

-- protection: what blocks a forced line (null: nothing does) — no localized proof (evidence), no page (page), a blocked
-- material (material), results to compute again (stale).
create temporary table prov_items (
  id uuid primary key, job_id uuid, designation text, quantity numeric, unit text, confidence numeric,
  verified boolean, hypothesis boolean, rank integer, protection text
) on commit drop;
insert into prov_items values
  -- ...201 (4 arguments, v3): forced F (no localized proof) and an admitted run of the same line (merged with it once
  -- rounded), verified K, hypothesis H, hypothesis folded into an ouvrage.
  ('c3000000-0000-4000-8000-000000000301', 'c3000000-0000-4000-8000-000000000201', 'P3 Tube forcé', 12.5, 'ml', 0.95, false, false, 1, 'evidence'),
  ('c3000000-0000-4000-8000-000000000302', 'c3000000-0000-4000-8000-000000000201', 'P3 Vanne vérifiée', 4, 'u', 0.3, true, false, 2, null),
  ('c3000000-0000-4000-8000-000000000303', 'c3000000-0000-4000-8000-000000000201', 'P3 Collier supposé', 6, 'u', 0.95, false, true, 3, null),
  ('c3000000-0000-4000-8000-000000000304', 'c3000000-0000-4000-8000-000000000201', 'P3 Ensemble supposé', 1, 'ens', 0.95, false, true, 4, null),
  ('c3000000-0000-4000-8000-000000000305', 'c3000000-0000-4000-8000-000000000201', 'P3 Tube forcé', 2.2, 'ml', 0.95, false, false, 5, null),
  -- ...203: the same measures, F with its localized proof instead of the override (twin of ...201).
  ('c3000000-0000-4000-8000-000000000321', 'c3000000-0000-4000-8000-000000000203', 'P3 Tube forcé', 12.5, 'ml', 0.95, false, false, 1, null),
  ('c3000000-0000-4000-8000-000000000322', 'c3000000-0000-4000-8000-000000000203', 'P3 Vanne vérifiée', 4, 'u', 0.3, true, false, 2, null),
  ('c3000000-0000-4000-8000-000000000323', 'c3000000-0000-4000-8000-000000000203', 'P3 Collier supposé', 6, 'u', 0.95, false, true, 3, null),
  ('c3000000-0000-4000-8000-000000000324', 'c3000000-0000-4000-8000-000000000203', 'P3 Ensemble supposé', 1, 'ens', 0.95, false, true, 4, null),
  ('c3000000-0000-4000-8000-000000000325', 'c3000000-0000-4000-8000-000000000203', 'P3 Tube forcé', 2.2, 'ml', 0.95, false, false, 5, null),
  -- ...204 (4 arguments, engine 2): forced F (no page).
  ('c3000000-0000-4000-8000-000000000331', 'c3000000-0000-4000-8000-000000000204', 'P3 Tube forcé', 12.5, 'ml', 0.95, false, false, 1, 'page'),
  ('c3000000-0000-4000-8000-000000000332', 'c3000000-0000-4000-8000-000000000204', 'P3 Collier supposé', 6, 'u', 0.95, false, true, 2, null),
  ('c3000000-0000-4000-8000-000000000333', 'c3000000-0000-4000-8000-000000000204', 'P3 Vanne vérifiée', 4, 'u', 0.3, true, false, 3, null),
  -- ...205 (5 arguments, v3): a forced (blocked material) and a verified run reconciled on the DPGF line, a verified
  -- line of its own, a hypothesis, a hypothesis folded into an ouvrage.
  ('c3000000-0000-4000-8000-000000000341', 'c3000000-0000-4000-8000-000000000205', 'EF cuivre DN 22', 10, 'ml', 0.95, false, false, 1, 'material'),
  ('c3000000-0000-4000-8000-000000000342', 'c3000000-0000-4000-8000-000000000205', 'EF cuivre DN 22', 20, 'ml', 0.95, false, false, 2, null),
  ('c3000000-0000-4000-8000-000000000343', 'c3000000-0000-4000-8000-000000000205', 'P3 Collier supposé', 6, 'u', 0.95, false, true, 3, null),
  ('c3000000-0000-4000-8000-000000000344', 'c3000000-0000-4000-8000-000000000205', 'P3 Ensemble supposé', 1, 'ens', 0.95, false, true, 4, null),
  ('c3000000-0000-4000-8000-000000000345', 'c3000000-0000-4000-8000-000000000205', 'P3 Vanne vérifiée', 4, 'u', 0.3, true, false, 5, null),
  -- ...207 (5 arguments, engine 2): forced F (results to compute again) and a hypothesis run of the same line (merged
  -- with it once rounded).
  ('c3000000-0000-4000-8000-000000000361', 'c3000000-0000-4000-8000-000000000207', 'P3 Tube forcé', 12.5, 'ml', 0.95, false, false, 1, 'stale'),
  ('c3000000-0000-4000-8000-000000000362', 'c3000000-0000-4000-8000-000000000207', 'P3 Collier supposé', 6, 'u', 0.95, false, true, 2, null),
  ('c3000000-0000-4000-8000-000000000363', 'c3000000-0000-4000-8000-000000000207', 'P3 Vanne vérifiée', 4, 'u', 0.3, true, false, 3, null),
  ('c3000000-0000-4000-8000-000000000364', 'c3000000-0000-4000-8000-000000000207', 'P3 Tube forcé', 2.2, 'ml', 0.95, false, true, 4, null),
  -- The later jobs (written once the first application is done): ...202 merges onto the forced line of ...201 and adds a
  -- line; ...206 reconciles the DPGF line again from a single verified run.
  ('c3000000-0000-4000-8000-000000000311', 'c3000000-0000-4000-8000-000000000202', 'P3 Tube forcé', 13, 'ml', 0.95, false, false, 1, null),
  ('c3000000-0000-4000-8000-000000000312', 'c3000000-0000-4000-8000-000000000202', 'P3 Nouvelle ligne', 2, 'u', 0.95, false, false, 2, null),
  ('c3000000-0000-4000-8000-000000000351', 'c3000000-0000-4000-8000-000000000206', 'EF cuivre DN 22', 30, 'ml', 0.95, false, false, 1, null);

create or replace function pg_temp.prov_seed_items(p_jobs uuid[])
returns void
language sql
as $$
  insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
    source_page, is_verified, verified_by, verified_at, quantity_entered_by, quantity_entered_at, quantity_entry_category,
    quantity_entry_note, rule_results, rules_evaluated_at, rules_stale, rules_stale_at, created_at)
  select item.id, current_setting('test.tenant_id')::uuid, item.job_id, item.designation, item.quantity, item.unit,
    item.confidence, case when item.protection is distinct from 'evidence' then 'Repère localisé' end, 'plan-fictif.pdf',
    case when item.protection is distinct from 'page' then 1 end, item.verified,
    case when item.verified then 'c3000000-0000-4000-8000-000000000001'::uuid end, case when item.verified then now() end,
    case when item.hypothesis then 'c3000000-0000-4000-8000-000000000001'::uuid end, case when item.hypothesis then now() end,
    case when item.hypothesis then 'hypothesis' end,
    case when item.hypothesis then 'Quantité supposée, à confirmer au relevé.' end,
    case when item.protection = 'material' then '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED",
      "version":1,"acceptable":false,"reason":"Matériau interdit sur ce réseau (fictif)."}]'::jsonb else '[]'::jsonb end,
    case when item.protection = 'material' then now() end,
    item.protection is not distinct from 'stale', case when item.protection = 'stale' then now() end,
    now() + item.rank * interval '1 second'
  from prov_items item
  where item.job_id = any(p_jobs)
$$;

select pg_temp.prov_seed_items(array[
  'c3000000-0000-4000-8000-000000000201', 'c3000000-0000-4000-8000-000000000203', 'c3000000-0000-4000-8000-000000000204',
  'c3000000-0000-4000-8000-000000000205', 'c3000000-0000-4000-8000-000000000207'
]::uuid[]);

insert into public.estimate_assemblies (id, tenant_id, created_by, name) values
  ('c3000000-0000-4000-8000-000000000401', current_setting('test.tenant_id')::uuid,
   'c3000000-0000-4000-8000-000000000001', 'P3 ouvrage distribution');
insert into public.estimate_assembly_items (id, tenant_id, assembly_id, title, unit, default_quantity, h_mo, position,
  cost_type, unit_cost_ht_cents)
values ('c3000000-0000-4000-8000-000000000411', current_setting('test.tenant_id')::uuid,
  'c3000000-0000-4000-8000-000000000401', 'P3 Tube distribution', 'ml', 10, 0, 1, 'material', 500);

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version.id, 'c3000000-0000-4000-8000-000000000001', version.tenant_id,
  statement_timestamp() + interval '30 minutes', gen_random_uuid()
from public.estimate_versions version
where version.project_id = 'c3000000-0000-4000-8000-000000000010';

-- The admin's override of each forced line, as the route records it (audit.ts, apply-override-state.ts), with its coded
-- reason (TI-686 D10): the blocked material is a false positive of its rule, the other protections take an
-- unconditional reason.
insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
select current_setting('test.tenant_id')::uuid, 'c3000000-0000-4000-8000-000000000001', 'takeoff_jobs', job.id,
  job.estimate_version_id, 'takeoff.apply.override',
  jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', job.id,
    'tenant_id', current_setting('test.tenant_id'), 'user_id', 'c3000000-0000-4000-8000-000000000001',
    'metadata', jsonb_build_object('estimate_version_id', job.estimate_version_id, 'threshold', 0.5,
      'blocked_item_ids', jsonb_build_array(ti.id), 'blocked_items_count', 1,
      'forced_justifications', jsonb_build_array('Contrôlé sur le plan fictif, provision chiffrée.'),
      'forced_items', jsonb_build_array(jsonb_build_object('item_id', ti.id, 'justification_index', 0)
        || case prov.protection
          when 'material' then '{"reason_code": "rule_false_positive", "false_positive_rules": ["dn_network"]}'::jsonb
          when 'page' then '{"reason_code": "engineer_or_client_confirmation"}'::jsonb
          when 'stale' then '{"reason_code": "controlled_correction"}'::jsonb
          else '{"reason_code": "additional_evidence"}'::jsonb end),
      'blocked_items_state', jsonb_build_array(jsonb_build_object('item_id', ti.id, 'quantity', ti.quantity, 'unit', ti.unit,
        'updated_at', ti.updated_at, 'rule_failures', public.takeoff_rule_failure_keys(ti.rule_results),
        'rules_stale', ti.rules_stale, 'designation', ti.designation, 'evidence', ti.evidence, 'source_page', ti.source_page,
        'is_verified', ti.is_verified, 'quantity_entered_by', ti.quantity_entered_by))))
from public.takeoff_items ti
join public.takeoff_jobs job on job.id = ti.job_id
join prov_items prov on prov.id = ti.id
where ti.id in ('c3000000-0000-4000-8000-000000000301', 'c3000000-0000-4000-8000-000000000331',
  'c3000000-0000-4000-8000-000000000341', 'c3000000-0000-4000-8000-000000000361');

-- The DPGF authorizations of the 5-argument applications: ...205 reconciles the DPGF line from its two runs; ...207
-- has nothing to reconcile.
insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash,
  review_summary, expires_at)
values
  (current_setting('test.tenant_id')::uuid, 'c3000000-0000-4000-8000-000000000205', 'c3000000-0000-4000-8000-000000000104',
   'c3000000-0000-4000-8000-000000000001', encode(sha256(convert_to('provisions-205', 'UTF8')), 'hex'),
   jsonb_build_object('quantity_policy', jsonb_build_array(jsonb_build_object(
     'target_id', 'c3000000-0000-4000-8000-000000000124',
     'expected_updated_at', (select updated_at from public.estimate_items where id = 'c3000000-0000-4000-8000-000000000124'),
     'reference_quantity', 30, 'measured_quantity', 30, 'priced_quantity', 30, 'absolute_gap', 0, 'reviewed', false,
     'source_file_name', 'dpgf-fictif.xlsx', 'source_page', 7,
     'source_metadata', jsonb_build_object('dpgf_source_quantity', 30, 'dpgf_source_unit', 'ml', 'fixture', 'preserve'),
     'takeoff_items', (select jsonb_agg(jsonb_build_object('id', ti.id, 'quantity', ti.quantity, 'updated_at', ti.updated_at)
       order by ti.id) from public.takeoff_items ti where ti.id in ('c3000000-0000-4000-8000-000000000341',
         'c3000000-0000-4000-8000-000000000342'))))),
   now() + interval '5 minutes'),
  (current_setting('test.tenant_id')::uuid, 'c3000000-0000-4000-8000-000000000207', 'c3000000-0000-4000-8000-000000000105',
   'c3000000-0000-4000-8000-000000000001', encode(sha256(convert_to('provisions-207', 'UTF8')), 'hex'), '{}'::jsonb,
   now() + interval '5 minutes');

-- Helpers ------------------------------------------------------------------------------------------------

create temporary table prov_outcome (case_name text primary key, outcome text) on commit drop;
grant all on prov_outcome to authenticated;
create temporary table prov_amounts (case_name text primary key, amounts jsonb) on commit drop;

create or replace function pg_temp.prov_plan(p_job_id uuid, p_overrides jsonb)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.id, 'source_order', item.source_order, 'rule_id', null,
    'action', coalesce(p_overrides -> item.id::text ->> 'action', 'none'), 'designation', btrim(item.designation),
    'unit_price_cents', (p_overrides -> item.id::text ->> 'unit_price_cents')::integer, 'category_id', null,
    'assembly_id', (p_overrides -> item.id::text ->> 'assembly_id')::uuid
  ) order by item.source_order), '[]'::jsonb)
  from (
    select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
    from public.takeoff_items ti where ti.job_id = p_job_id
  ) as item
$$;
grant execute on function pg_temp.prov_plan(uuid, jsonb) to authenticated;

-- Each application runs as the signed-in administrator, through the real overload; its outcome is recorded so that a
-- refusal fails a named assertion.
create or replace function pg_temp.prov_apply(
  p_case text, p_job_id uuid, p_strategy text, p_section_id uuid, p_overrides jsonb, p_token text
)
returns text
language plpgsql
as $$
declare
  failure_detail text;
  result_row record;
begin
  begin
    if p_token is null then
      select * into result_row from public.apply_takeoff_job_guarded_atomic(p_job_id, p_strategy, p_section_id,
        pg_temp.prov_plan(p_job_id, p_overrides));
    else
      select * into result_row from public.apply_takeoff_job_guarded_atomic(p_job_id, p_strategy, p_section_id,
        pg_temp.prov_plan(p_job_id, p_overrides), p_token);
    end if;
    insert into prov_outcome values (p_case, 'ok');
  exception when others then
    get stacked diagnostics failure_detail = pg_exception_detail;
    insert into prov_outcome values (p_case, sqlstate || ' ' || sqlerrm || coalesce(' | ' || nullif(failure_detail, ''), ''));
  end;
  return (select outcome from prov_outcome where case_name = p_case);
end;
$$;
grant execute on function pg_temp.prov_apply(text, uuid, text, uuid, jsonb, text) to authenticated;

-- The engine 1/2 writer keeps its working tables until commit: dropped as their owner between two applications.
create or replace function pg_temp.prov_clear()
returns void
language sql
as $$
  drop table if exists pg_temp._takeoff_apply_source;
  drop table if exists pg_temp._takeoff_apply_created_ids;
  drop table if exists pg_temp._takeoff_apply_matches;
  drop table if exists pg_temp._takeoff_apply_unmatched;
  select pg_catalog.set_config('app.takeoff_apply_atomic', '', true);
  select pg_catalog.set_config('app.takeoff_apply_job', '', true);
$$;

-- The one line of a version with this title; null when there is none or more than one (each case also counts them).
create or replace function pg_temp.prov_line(p_version_id uuid, p_title text)
returns jsonb
language sql
as $$
  select case when count(*) = 1 then (array_agg(to_jsonb(item)))[1] end
  from public.estimate_items item
  where item.version_id = p_version_id and item.item_type = 'line' and item.title = p_title
$$;

create or replace function pg_temp.prov_line_count(p_version_id uuid, p_title text)
returns integer
language sql
as $$
  select count(*)::integer from public.estimate_items item
  where item.version_id = p_version_id and item.item_type = 'line' and item.title = p_title
$$;

-- The overrides the apply trigger consumed for a job: one when a line of the job was blocked, none otherwise.
create or replace function pg_temp.prov_consumed(p_job_id uuid)
returns integer
language sql
as $$
  select count(*)::integer from public.takeoff_apply_override_consumptions consumed where consumed.job_id = p_job_id
$$;

create or replace function pg_temp.prov_marker(p_job_id uuid, variadic p_sources jsonb[])
returns jsonb
language sql
as $$
  select jsonb_build_object('version', 1, 'job_id', p_job_id, 'sources', to_jsonb(p_sources))
$$;

create or replace function pg_temp.prov_source(p_item_id uuid, p_forced boolean, p_entry_category text,
  p_forced_reason text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object('takeoff_item_id', p_item_id, 'forced', p_forced, 'forced_reason', p_forced_reason,
    'entry_category', p_entry_category)
$$;

-- Stored amounts of a version and its lines, by title: a length merge (TI-681) keeps the line with the smallest id,
-- a random uuid, so the kept line's position differs from one application to its twin.
create or replace function pg_temp.prov_amounts_of(p_version_id uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'version', (select jsonb_build_array(version.gross_ht_cents, version.discount_applied_cents,
        version.commercial_rounding_cents, version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents)
      from public.estimate_versions version where version.id = p_version_id),
    'lines', (select jsonb_agg(jsonb_build_array(item.title, item.quantity, item.unit_code, item.pricing_status,
        item.unit_price_ht_cents, item.pu_ht_cents, item.snapshot_pu_ht_cents, item.snapshot_gross_ht_cents,
        item.snapshot_gross_fo_ht_cents, item.snapshot_fo_ht_cents, item.snapshot_mo_ht_cents, item.line_total_ht_cents,
        item.line_tax_cents, item.line_total_ttc_cents) order by item.title, item.quantity)
      from public.estimate_items item where item.version_id = p_version_id and item.item_type = 'line'))
$$;

select set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'c3000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

-- 4 arguments, engine 3 ------------------------------------------------------------------------------------

set local role authenticated;
select is(pg_temp.prov_apply('v3-4', 'c3000000-0000-4000-8000-000000000201', 'append',
  'c3000000-0000-4000-8000-000000000111', '{
    "c3000000-0000-4000-8000-000000000301": {"action": "set_price", "unit_price_cents": 1234},
    "c3000000-0000-4000-8000-000000000302": {"action": "set_price", "unit_price_cents": 500},
    "c3000000-0000-4000-8000-000000000304": {"action": "apply_assembly", "assembly_id": "c3000000-0000-4000-8000-000000000401"},
    "c3000000-0000-4000-8000-000000000305": {"action": "set_price", "unit_price_cents": 1234}
  }', null), 'ok', '4 arguments, v3: the admin applies the job with its override');
select is(coalesce(current_setting('miaouffrage.estimate_v3_writer', true), ''), '',
  '4 arguments, v3: the writer contract is restored once the application returns');
reset role;
insert into prov_amounts values ('forced', pg_temp.prov_amounts_of('c3000000-0000-4000-8000-000000000101'));

select is(pg_temp.prov_consumed('c3000000-0000-4000-8000-000000000201'), 1,
  '4 arguments, v3: a line without its localized proof (level C) is still blocked, and the override lifts it');
select is(pg_temp.prov_line_count('c3000000-0000-4000-8000-000000000101', 'P3 Tube forcé'), 1,
  '4 arguments, v3: the two runs of one length line are merged into one estimate line (TI-681)');
select is((pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Tube forcé') ->> 'quantity')::numeric, 15::numeric,
  '4 arguments, v3: the merged line is rounded once, to the next metre (12,5 + 2,2 = 14,7 -> 15)');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Tube forcé') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000201',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000301', true, null, 'additional_evidence')),
  '4 arguments, v3: the forced line enters the estimate as an internal provision with its coded reason, its admitted run is no source');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Tube forcé') #> '{source_metadata,takeoff_length_rounding,item_ids}',
  '["c3000000-0000-4000-8000-000000000301", "c3000000-0000-4000-8000-000000000305"]'::jsonb,
  '4 arguments, v3: the line keeps its takeoff provenance (the merged runs) beside the marker');
select ok(coalesce(not (pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Vanne vérifiée') -> 'source_metadata'
    ? 'takeoff_provision'), false),
  '4 arguments, v3: a verified line carries no marker');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Collier supposé') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000201',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000303', false, 'hypothesis')),
  '4 arguments, v3: a quantity entered as a hypothesis enters as a provision, without override');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Tube distribution') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000201',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000304', false, 'hypothesis')),
  '4 arguments, v3: the line an hypothesis folded into an ouvrage materializes keeps the hypothesis');
select is((select count(*)::integer from public.estimate_items item
    where item.version_id = 'c3000000-0000-4000-8000-000000000101' and item.item_type = 'section'
      and item.source_metadata ? 'takeoff_provision'), 0,
  '4 arguments, v3: only lines carry the marker, never the ouvrage''s section');

-- The twin: the line with its localized proof instead of the override. The marker changes no stored amount.
set local role authenticated;
select is(pg_temp.prov_apply('v3-4-twin', 'c3000000-0000-4000-8000-000000000203', 'append',
  'c3000000-0000-4000-8000-000000000112', '{
    "c3000000-0000-4000-8000-000000000321": {"action": "set_price", "unit_price_cents": 1234},
    "c3000000-0000-4000-8000-000000000322": {"action": "set_price", "unit_price_cents": 500},
    "c3000000-0000-4000-8000-000000000324": {"action": "apply_assembly", "assembly_id": "c3000000-0000-4000-8000-000000000401"},
    "c3000000-0000-4000-8000-000000000325": {"action": "set_price", "unit_price_cents": 1234}
  }', null), 'ok', 'twin: the same job with the line''s localized proof instead of the override applies');
reset role;
select is(pg_temp.prov_consumed('c3000000-0000-4000-8000-000000000203'), 0,
  'twin: nothing blocked, no override consumed');
select ok(coalesce(not (pg_temp.prov_line('c3000000-0000-4000-8000-000000000102', 'P3 Tube forcé') -> 'source_metadata'
    ? 'takeoff_provision'), false),
  'twin: the line admitted with its proof carries no marker');
select ok((select (amounts #>> '{version,3}')::integer > 0 from prov_amounts where case_name = 'forced'),
  'twin: the forced application has an amount to compare');
select is(pg_temp.prov_amounts_of('c3000000-0000-4000-8000-000000000102'),
  (select amounts from prov_amounts where case_name = 'forced'),
  '(guard) stored line amounts and version totals equal the same application with the proof instead of the override');

-- A later job of the same version merges onto the forced line: the last application wins, and the first job's
-- override marks nothing of it. To make the job filter observable, an override consumed for the first job (as the
-- table owner: no route writes it) names a line of the later job; only the later job's own consumption may force it.
select pg_temp.prov_seed_items(array['c3000000-0000-4000-8000-000000000202']::uuid[]);
insert into public.audit_logs (id, tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
values ('c3000000-0000-4000-8000-000000000501', current_setting('test.tenant_id')::uuid,
  'c3000000-0000-4000-8000-000000000001', 'takeoff_jobs', 'c3000000-0000-4000-8000-000000000201',
  'c3000000-0000-4000-8000-000000000101', 'takeoff.apply.override',
  jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override',
    'job_id', 'c3000000-0000-4000-8000-000000000201', 'tenant_id', current_setting('test.tenant_id'),
    'user_id', 'c3000000-0000-4000-8000-000000000001',
    'metadata', jsonb_build_object('estimate_version_id', 'c3000000-0000-4000-8000-000000000101', 'threshold', 0.5,
      'blocked_item_ids', jsonb_build_array('c3000000-0000-4000-8000-000000000312'), 'blocked_items_count', 1,
      'forced_justifications', jsonb_build_array('Audit d''un autre job, consommé pour lui seul.'),
      'forced_items', jsonb_build_array(jsonb_build_object('item_id', 'c3000000-0000-4000-8000-000000000312',
        'reason_code', 'additional_evidence', 'justification_index', 0)))));
insert into public.takeoff_apply_override_consumptions (audit_log_id, tenant_id, job_id, estimate_version_id, user_id)
values ('c3000000-0000-4000-8000-000000000501', current_setting('test.tenant_id')::uuid,
  'c3000000-0000-4000-8000-000000000201', 'c3000000-0000-4000-8000-000000000101',
  'c3000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(pg_temp.prov_apply('v3-4-merge', 'c3000000-0000-4000-8000-000000000202', 'merge',
  'c3000000-0000-4000-8000-000000000111', '{}', null), 'ok', '4 arguments, v3: a later verified job merges onto the line');
reset role;
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Tube forcé') #>> '{source_metadata,takeoff_item_id}',
  'c3000000-0000-4000-8000-000000000311', '4 arguments, v3: the merge took the forced line');
select ok(coalesce(not (pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Tube forcé') -> 'source_metadata'
    ? 'takeoff_provision'), false),
  '4 arguments, v3: a merge without provision source removes the marker of the previous application');
select is(pg_temp.prov_consumed('c3000000-0000-4000-8000-000000000202'), 0,
  '4 arguments, v3: the later job has nothing blocked and consumes no override');
select ok(coalesce(not (pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Nouvelle ligne') -> 'source_metadata'
    ? 'takeoff_provision'), false),
  '(guard) an override consumed for another job of the version, even naming this job''s line, marks nothing of this job');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000101', 'P3 Collier supposé') #>> '{source_metadata,takeoff_provision,job_id}',
  'c3000000-0000-4000-8000-000000000201', '4 arguments, v3: a line the later job does not touch keeps its marker');

-- 4 arguments, engine 2 ------------------------------------------------------------------------------------

set local role authenticated;
select is(pg_temp.prov_apply('v2-4', 'c3000000-0000-4000-8000-000000000204', 'append',
  'c3000000-0000-4000-8000-000000000113', '{}', null), 'ok', '4 arguments, engine 2: the admin applies the job with its override');
reset role;
select pg_temp.prov_clear();
select is(pg_temp.prov_consumed('c3000000-0000-4000-8000-000000000204'), 1,
  '4 arguments, engine 2: a line without its page (level C) is still blocked, and the override lifts it');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000103', 'P3 Tube forcé') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000204',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000331', true, null, 'engineer_or_client_confirmation')),
  '4 arguments, engine 2: the forced line enters as an internal provision with its coded reason');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000103', 'P3 Collier supposé') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000204',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000332', false, 'hypothesis')),
  '4 arguments, engine 2: the hypothesis enters as a provision');
select ok(coalesce(not (pg_temp.prov_line('c3000000-0000-4000-8000-000000000103', 'P3 Vanne vérifiée') -> 'source_metadata'
    ? 'takeoff_provision'), false),
  '4 arguments, engine 2: a verified line carries no marker');

-- 5 arguments (DPGF authorization), engine 3 ---------------------------------------------------------------

set local role authenticated;
select is(pg_temp.prov_apply('v3-5', 'c3000000-0000-4000-8000-000000000205', 'merge',
  'c3000000-0000-4000-8000-000000000114', '{
    "c3000000-0000-4000-8000-000000000344": {"action": "apply_assembly", "assembly_id": "c3000000-0000-4000-8000-000000000401"}
  }', 'provisions-205'), 'ok', '5 arguments, v3: the admin reconciles the DPGF line with its override');
select is(coalesce(current_setting('miaouffrage.estimate_v3_writer', true), ''), '',
  '5 arguments, v3: the writer contract is restored once the application returns');
reset role;
select is(pg_temp.prov_consumed('c3000000-0000-4000-8000-000000000205'), 1,
  '5 arguments, v3: a run of a blocked material is still blocked, and the override lifts it');
select is((select count(*)::integer from public.estimate_items item
    where item.version_id = 'c3000000-0000-4000-8000-000000000104' and item.title = 'EF cuivre DN 22'), 1,
  '5 arguments, v3: both runs reach the one DPGF line');
select is((pg_temp.prov_line('c3000000-0000-4000-8000-000000000104', 'EF cuivre DN 22') ->> 'quantity')::numeric, 30::numeric,
  '5 arguments, v3: the DPGF line takes the reconciled quantity');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000104', 'EF cuivre DN 22') #> '{source_metadata,takeoff_quantity_policy,item_ids}',
  '["c3000000-0000-4000-8000-000000000341", "c3000000-0000-4000-8000-000000000342"]'::jsonb,
  '5 arguments, v3: the quantity policy of the reconciliation is kept beside the marker');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000104', 'EF cuivre DN 22') #>> '{source_metadata,fixture}',
  'preserve', '5 arguments, v3: the DPGF provenance is kept');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000104', 'EF cuivre DN 22') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000205',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000341', true, null, 'rule_false_positive')),
  '5 arguments, v3: a DPGF line reconciled from a forced and a verified run names only the forced one, a false positive of its rule');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000104', 'P3 Collier supposé') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000205',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000343', false, 'hypothesis')),
  '5 arguments, v3: the hypothesis enters as a provision');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000104', 'P3 Tube distribution') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000205',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000344', false, 'hypothesis')),
  '5 arguments, v3: the line an hypothesis folded into an ouvrage materializes keeps the hypothesis');
select ok(coalesce(not (pg_temp.prov_line('c3000000-0000-4000-8000-000000000104', 'P3 Vanne vérifiée') -> 'source_metadata'
    ? 'takeoff_provision'), false),
  '5 arguments, v3: a verified line carries no marker');

-- The DPGF line reconciled again from a single verified run: the marker of the previous application goes.
select pg_temp.prov_seed_items(array['c3000000-0000-4000-8000-000000000206']::uuid[]);
insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash,
  review_summary, expires_at)
values (current_setting('test.tenant_id')::uuid, 'c3000000-0000-4000-8000-000000000206', 'c3000000-0000-4000-8000-000000000104',
  'c3000000-0000-4000-8000-000000000001', encode(sha256(convert_to('provisions-206', 'UTF8')), 'hex'),
  jsonb_build_object('quantity_policy', jsonb_build_array(jsonb_build_object(
    'target_id', 'c3000000-0000-4000-8000-000000000124',
    'expected_updated_at', (select updated_at from public.estimate_items where id = 'c3000000-0000-4000-8000-000000000124'),
    'reference_quantity', 30, 'measured_quantity', 30, 'priced_quantity', 30, 'absolute_gap', 0, 'reviewed', false,
    'source_file_name', 'dpgf-fictif.xlsx', 'source_page', 7,
    'source_metadata', jsonb_build_object('dpgf_source_quantity', 30, 'dpgf_source_unit', 'ml', 'fixture', 'preserve'),
    'takeoff_items', (select jsonb_agg(jsonb_build_object('id', ti.id, 'quantity', ti.quantity, 'updated_at', ti.updated_at))
      from public.takeoff_items ti where ti.id = 'c3000000-0000-4000-8000-000000000351')))),
  now() + interval '5 minutes');
set local role authenticated;
select is(pg_temp.prov_apply('v3-5-again', 'c3000000-0000-4000-8000-000000000206', 'merge',
  'c3000000-0000-4000-8000-000000000114', '{}', 'provisions-206'), 'ok',
  '5 arguments, v3: a later verified job reconciles the DPGF line again');
reset role;
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000104', 'EF cuivre DN 22') #>> '{source_metadata,takeoff_quantity_policy,job_id}',
  'c3000000-0000-4000-8000-000000000206', '5 arguments, v3: the later reconciliation took the DPGF line');
select ok(coalesce(not (pg_temp.prov_line('c3000000-0000-4000-8000-000000000104', 'EF cuivre DN 22') -> 'source_metadata'
    ? 'takeoff_provision'), false),
  '5 arguments, v3: a reconciliation without provision source removes the marker of the previous application');

-- 5 arguments (DPGF authorization), engine 2 ---------------------------------------------------------------

set local role authenticated;
select is(pg_temp.prov_apply('v2-5', 'c3000000-0000-4000-8000-000000000207', 'append',
  'c3000000-0000-4000-8000-000000000115', '{}', 'provisions-207'), 'ok',
  '5 arguments, engine 2: the admin applies the job with its override');
reset role;
select pg_temp.prov_clear();
select is(pg_temp.prov_consumed('c3000000-0000-4000-8000-000000000207'), 1,
  '5 arguments, engine 2: a line whose results are to compute again is still blocked, and the override lifts it');
select is(pg_temp.prov_line_count('c3000000-0000-4000-8000-000000000105', 'P3 Tube forcé'), 1,
  '5 arguments, engine 2: the forced run and the hypothesis run of one length line are merged into one line (TI-681)');
select is((pg_temp.prov_line('c3000000-0000-4000-8000-000000000105', 'P3 Tube forcé') ->> 'quantity')::numeric, 15::numeric,
  '5 arguments, engine 2: the merged line is rounded once, to the next metre (12,5 + 2,2 = 14,7 -> 15)');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000105', 'P3 Tube forcé') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000207',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000361', true, null, 'controlled_correction'),
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000364', false, 'hypothesis')),
  '5 arguments, engine 2: the merged line enters as an internal provision and names both of its provision sources');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000105', 'P3 Collier supposé') #> '{source_metadata,takeoff_provision}',
  pg_temp.prov_marker('c3000000-0000-4000-8000-000000000207',
    pg_temp.prov_source('c3000000-0000-4000-8000-000000000362', false, 'hypothesis')),
  '5 arguments, engine 2: the hypothesis enters as a provision');
select ok(coalesce(not (pg_temp.prov_line('c3000000-0000-4000-8000-000000000105', 'P3 Vanne vérifiée') -> 'source_metadata'
    ? 'takeoff_provision'), false),
  '5 arguments, engine 2: a verified line carries no marker');
select is(pg_temp.prov_line('c3000000-0000-4000-8000-000000000105', 'Réseau DPGF fictif') -> 'source_metadata',
  '{"dpgf_source_quantity": 2}'::jsonb, '5 arguments, engine 2: a DPGF line the job does not touch is left as it was');

-- The writer -----------------------------------------------------------------------------------------------

select ok(coalesce((select procedure.prosecdef
    and 'search_path=pg_catalog' = any(coalesce(procedure.proconfig, array[]::text[]))
    from pg_proc procedure
    where procedure.oid = to_regprocedure('private.takeoff_mark_provisions(uuid,uuid,uuid,jsonb,uuid[])')), false),
  'the marker has one writer, private.takeoff_mark_provisions, security definer with search_path pg_catalog');
select ok(case when to_regprocedure('private.takeoff_mark_provisions(uuid,uuid,uuid,jsonb,uuid[])') is null then false
    else not has_function_privilege('authenticated', 'private.takeoff_mark_provisions(uuid,uuid,uuid,jsonb,uuid[])', 'EXECUTE')
      and not has_function_privilege('anon', 'private.takeoff_mark_provisions(uuid,uuid,uuid,jsonb,uuid[])', 'EXECUTE')
      and not has_function_privilege('service_role', 'private.takeoff_mark_provisions(uuid,uuid,uuid,jsonb,uuid[])', 'EXECUTE')
      and not exists (
        select 1 from pg_proc procedure
        cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as grant_entry
        where procedure.oid = to_regprocedure('private.takeoff_mark_provisions(uuid,uuid,uuid,jsonb,uuid[])')
          and grant_entry.grantee = 0 and grant_entry.privilege_type = 'EXECUTE')
    end,
  'neither authenticated, anon, service_role nor PUBLIC can execute the writer');

select * from finish();
rollback;
