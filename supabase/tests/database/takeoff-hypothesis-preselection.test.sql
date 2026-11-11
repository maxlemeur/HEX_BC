-- TI-682 lot B (D11, D12; migration …_takeoff_hypothesis_preselection.sql): an hypothesis is never preselected.
-- A line's quantity is an hypothesis when its author entered it as one, or when nobody attested it and either the
-- takeoff was asked for an estimate (metadata.quantity_nature) or a plan cannot show it
-- (metadata.rule_inputs.non_observable). public.takeoff_item_hypothesis_cause reads it once; its TypeScript twin
-- (src/lib/takeoff/hypothesis.ts) runs the vectors of this file, which hypothesis.test.ts reads here: keep one vector
-- and one reason per line, in the forms below.
-- Isolation justified: the insert trigger is the database's own guarantee, whatever the writer (the worker's service
-- role, a restore, a later writer); no journey inserts lines beside the worker.
-- Written before the migration (red on 53a90872): the function does not exist, and an estimated or non observable line
-- inserted without an exclusion stays preselected. All values are fictional.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

-- The predicate, on the vectors the TypeScript twin runs -----------------------------------------------------------

create temporary table hypothesis_vectors (
  position integer primary key, label text not null, metadata jsonb, category text, cause text
) on commit drop;
insert into hypothesis_vectors values
  (1, 'a proposed line the plan shows', '{"quantity_nature":"proposed","rule_inputs":{"non_observable":null}}', null, null),
  (2, 'a line without metadata', null, null, null),
  (3, 'an estimate: the takeoff was asked for one', '{"quantity_nature":"estimated"}', null, 'estimated'),
  (4, 'a weld: a plan cannot show it', '{"rule_inputs":{"non_observable":"weld"}}', null, 'non_observable'),
  (5, 'an estimated weld is an estimate first', '{"quantity_nature":"estimated","rule_inputs":{"non_observable":"weld"}}', null, 'estimated'),
  (6, 'a quantity entered as an hypothesis', '{"quantity_nature":"proposed"}', 'hypothesis', 'entered_hypothesis'),
  (7, 'an estimate attested on a site survey', '{"quantity_nature":"estimated"}', 'site_survey', null),
  (8, 'a weld attested on a written confirmation', '{"rule_inputs":{"non_observable":"weld"}}', 'written_confirmation', null),
  (9, 'a weld entered as an hypothesis', '{"rule_inputs":{"non_observable":"weld"}}', 'hypothesis', 'entered_hypothesis'),
  (10, 'metadata stored as a list', '[{"quantity_nature":"estimated"}]', null, null),
  (11, 'rule inputs stored as a list', '{"rule_inputs":[{"non_observable":"weld"}]}', null, null),
  (12, 'an empty non observable cause', '{"rule_inputs":{"non_observable":""}}', null, null),
  (13, 'a non observable cause that is no text', '{"rule_inputs":{"non_observable":true}}', null, null),
  (14, 'a nature written in another case', '{"quantity_nature":"Estimated"}', null, null),
  (15, 'a nature that is no text', '{"quantity_nature":true}', null, null),
  (16, 'metadata stored as a text', '"estimated"', null, null),
  (17, 'a vector measure', '{"vector":{"kind":"network"},"rule_inputs":{"source":"vector","non_observable":null}}', null, null),
  (18, 'a nature nested under another key', '{"preparation":{"quantity_nature":"estimated"}}', null, null),
  (19, 'an empty entry category attests nothing less', '{"quantity_nature":"estimated"}', '', null),
  (20, 'an hypothesis entered on an ordinary line', null, 'hypothesis', 'entered_hypothesis');

select is(public.takeoff_item_hypothesis_cause(vector.metadata, vector.category), vector.cause,
  'vector ' || vector.position || ': ' || vector.label)
from hypothesis_vectors vector
order by vector.position;

-- The reasons a new hypothesis is excluded with, as the worker writes them ------------------------------------------

create temporary table hypothesis_reasons (cause text primary key, reason text not null) on commit drop;
insert into hypothesis_reasons values
  ('estimated', 'Hypothèse non présélectionnée : quantité estimée, sans mesure sur un plan. Incluez la ligne pour la compter.'),
  ('non_observable', 'Hypothèse non présélectionnée : quantité non lisible sur un plan. Saisissez-la avec sa justification pour la compter.');

-- The insert trigger: whatever the writer, a new hypothesis starts excluded -----------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values ('00000000-0000-0000-0000-000000000000', 'b6820000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'hypothesis-preselection@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = 'b6820000-0000-4000-8000-000000000001' limit 1), true);

insert into public.estimate_projects (id, tenant_id, user_id, name)
values ('b6820000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  'b6820000-0000-4000-8000-000000000001', 'Présélection des hypothèses (fictif)');
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values ('b6820000-0000-4000-8000-000000000101', current_setting('test.tenant_id')::uuid,
  'b6820000-0000-4000-8000-000000000010', 1, 2, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 0, 0, 0);
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values ('b6820000-0000-4000-8000-000000000201', current_setting('test.tenant_id')::uuid,
  'b6820000-0000-4000-8000-000000000101', 'C', 'processing', 'plan-fictif.pdf', 'b6820000-0000-4000-8000-000000000001');

-- One statement, as the worker inserts a result's lines.
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence,
  source_file_name, source_page, metadata, is_excluded, exclusion_reason)
values
  ('b6820000-0000-4000-8000-000000000301', current_setting('test.tenant_id')::uuid, 'b6820000-0000-4000-8000-000000000201',
    'Vanne DN 20', 4, 'u', 0.95, 'Repère localisé', 'plan-fictif.pdf', 1,
    '{"quantity_nature":"proposed","rule_inputs":{"non_observable":null}}', false, null),
  ('b6820000-0000-4000-8000-000000000302', current_setting('test.tenant_id')::uuid, 'b6820000-0000-4000-8000-000000000201',
    'Réseau EF estimé', 40, 'ml', 0.6, 'Estimation', 'plan-fictif.pdf', 1,
    '{"quantity_nature":"estimated"}', false, null),
  ('b6820000-0000-4000-8000-000000000303', current_setting('test.tenant_id')::uuid, 'b6820000-0000-4000-8000-000000000201',
    'Soudures inox', 48, 'u', 0.95, 'Supposées', 'plan-fictif.pdf', 1,
    '{"rule_inputs":{"non_observable":"weld"}}', false, null),
  ('b6820000-0000-4000-8000-000000000304', current_setting('test.tenant_id')::uuid, 'b6820000-0000-4000-8000-000000000201',
    'Supports déjà exclus', 12, 'u', 0.95, 'Supposés', 'plan-fictif.pdf', 1,
    '{"rule_inputs":{"non_observable":"support"}}', true, 'Hors lot, exclu par son auteur.'),
  ('b6820000-0000-4000-8000-000000000305', current_setting('test.tenant_id')::uuid, 'b6820000-0000-4000-8000-000000000201',
    'EF DN 20', 21.07, 'ml', 0.5, 'Lecture vectorielle', 'plan-fictif.pdf', 1,
    '{"vector":{"kind":"network"},"quantity_source":{"version":1,"origin":"vector"},"rule_inputs":{"source":"vector","non_observable":null}}',
    true, 'Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut.');
-- A line restored with its author's entry: an attested quantity is no new hypothesis.
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence,
  source_file_name, source_page, metadata, quantity_entered_by, quantity_entered_at, quantity_entry_category,
  quantity_entry_note)
values
  ('b6820000-0000-4000-8000-000000000306', current_setting('test.tenant_id')::uuid, 'b6820000-0000-4000-8000-000000000201',
    'Soudures saisies', 6, 'u', 0.95, 'Saisie', 'plan-fictif.pdf', 1, '{"rule_inputs":{"non_observable":"weld"}}',
    'b6820000-0000-4000-8000-000000000001', now(), 'hypothesis', '6 soudures supposées, à confirmer au relevé.'),
  ('b6820000-0000-4000-8000-000000000307', current_setting('test.tenant_id')::uuid, 'b6820000-0000-4000-8000-000000000201',
    'Soudures relevées', 6, 'u', 0.95, 'Saisie', 'plan-fictif.pdf', 1, '{"rule_inputs":{"non_observable":"weld"}}',
    'b6820000-0000-4000-8000-000000000001', now(), 'site_survey', null);

select is((select jsonb_build_array(item.is_excluded, item.exclusion_reason) from public.takeoff_items item
    where item.id = 'b6820000-0000-4000-8000-000000000301'),
  '[false, null]'::jsonb, 'a proposed line the plan shows stays preselected');
select is((select jsonb_build_array(item.is_excluded, item.exclusion_reason) from public.takeoff_items item
    where item.id = 'b6820000-0000-4000-8000-000000000302'),
  jsonb_build_array(true, (select reason from hypothesis_reasons where cause = 'estimated')),
  'an estimated line arrives excluded, with its reason');
select is((select jsonb_build_array(item.is_excluded, item.exclusion_reason) from public.takeoff_items item
    where item.id = 'b6820000-0000-4000-8000-000000000303'),
  jsonb_build_array(true, (select reason from hypothesis_reasons where cause = 'non_observable')),
  'a non observable line arrives excluded, with its reason');
select is((select jsonb_build_array(item.is_excluded, item.exclusion_reason) from public.takeoff_items item
    where item.id = 'b6820000-0000-4000-8000-000000000304'),
  '[true, "Hors lot, exclu par son auteur."]'::jsonb, 'an hypothesis written excluded keeps its writer''s reason');
select is((select jsonb_build_array(item.is_excluded, item.exclusion_reason) from public.takeoff_items item
    where item.id = 'b6820000-0000-4000-8000-000000000305'),
  '[true, "Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut."]'::jsonb,
  'a vector measure keeps its own exclusion');
select is((select jsonb_agg(jsonb_build_array(item.is_excluded, item.exclusion_reason) order by item.id)
    from public.takeoff_items item
    where item.id in ('b6820000-0000-4000-8000-000000000306', 'b6820000-0000-4000-8000-000000000307')),
  '[[false, null], [false, null]]'::jsonb, 'a line written with its author''s entry is left as written');

-- Including an hypothesis afterwards is its reviewer's decision: the trigger only reads a new line.
update public.takeoff_items set is_excluded = false, exclusion_reason = null
where id = 'b6820000-0000-4000-8000-000000000302';
select is((select jsonb_build_array(item.is_excluded, item.exclusion_reason) from public.takeoff_items item
    where item.id = 'b6820000-0000-4000-8000-000000000302'),
  '[false, null]'::jsonb, 'an hypothesis included afterwards stays included');

select * from finish();
rollback;
