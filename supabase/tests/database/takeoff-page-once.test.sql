-- TI-682 lot D, PR 2 (migration …_takeoff_page_decisions.sql): a plan page enters an estimate once. Re-measuring a page
-- replaces its earlier measure line by line, keeping both is a reasoned decision, and the application refuses a page
-- another takeoff already brought without a decision, through both guarded overloads.
-- Isolation justified: the guard and the replacement run inside the application's transaction, under the version's
-- lock, on stored provenance and frozen takeoff lines; these cases differ by page identities, engines, edits between the
-- proposal and the application and DPGF targets that no journey can seed one by one. TKD02 covers the gesture in a
-- browser.
-- Written before the migration (red on 28de7bbb): every relaunch below applies without a word and doubles the page; the
-- decision table, its RPC and the replacement do not exist. Guards (green before): two zones of one level, two plan files
-- of one name, a page the mapping plan skips.
-- One draft per case (engine 3 unless said), section ...<case>002, takeoffs M1 ...<case>011 (applied first), M2
-- ...<case>012; their lines ...<case>1nn and ...<case>2nn. All values are fictional.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

create or replace function pg_temp.po_id(p_number integer)
returns uuid language sql immutable as $$ select ('d2000000-0000-4000-8000-' || lpad(p_number::text, 12, '0'))::uuid $$;
grant execute on function pg_temp.po_id(integer) to authenticated;

-- Fixtures ---------------------------------------------------------------------------------------------------------

-- An administrator (applies), an engineer of the same tenant, and an administrator of another tenant.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', pg_temp.po_id(user_no), 'authenticated', 'authenticated',
  'page-once-' || user_no || '@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from generate_series(1, 3) as user_no;
update public.tenant_memberships set role = 'admin'::public.tenant_role where user_id = pg_temp.po_id(1);
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = pg_temp.po_id(1) limit 1), true);
update public.tenant_memberships set is_default = false where user_id = pg_temp.po_id(2);
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
values (current_setting('test.tenant_id')::uuid, pg_temp.po_id(2), 'engineer', true, '2020-01-01');

create or replace function pg_temp.po_as(p_user integer)
returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.po_id(p_user)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.po_id(p_user), 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.po_as(integer) to authenticated;

insert into public.estimate_projects (id, tenant_id, user_id, name)
values (pg_temp.po_id(10), current_setting('test.tenant_id')::uuid, pg_temp.po_id(1), 'Une page une fois (fictif)');
insert into public.estimate_categories (id, tenant_id, user_id, name, position)
values (pg_temp.po_id(20), current_setting('test.tenant_id')::uuid, pg_temp.po_id(1), 'Plomberie fictive', 1);

create temporary table po_cases (case_no integer primary key, engine smallint not null, dpgf boolean not null default false)
  on commit drop;
insert into po_cases (case_no, engine, dpgf) values
  (1, 3, false), (2, 3, true), (3, 3, false), (4, 3, false), (5, 3, false), (6, 3, false), (7, 3, false), (8, 3, false),
  (9, 3, false), (10, 3, false), (11, 3, false), (12, 3, false), (13, 3, false), (14, 3, false), (15, 3, false),
  (16, 2, false), (17, 3, true), (18, 3, false), (19, 3, false), (20, 3, false), (21, 3, false), (22, 3, false),
  -- The independent review's cases (23 to 28).
  (23, 3, false), (24, 3, false), (25, 3, false), (26, 3, false), (27, 3, true), (28, 3, false),
  -- Codex review of c06cbb1b: a mapping price on a line « Fusionner » pairs.
  (30, 3, false);
grant select on po_cases to authenticated;

insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
select pg_temp.po_id(c.case_no * 1000 + 1), current_setting('test.tenant_id')::uuid, pg_temp.po_id(10), c.case_no,
  c.engine, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1,
  case when c.engine = 3 then 1.3 end, case when c.engine = 3 then 1.2 end,
  case when c.engine = 3 then 0 end, case when c.engine = 3 then 0 end, case when c.engine = 3 then 0 end, 0, 0, 0
from po_cases c;

do $sections$
declare
  c record;
begin
  for c in select * from po_cases loop
    perform set_config('miaouffrage.estimate_v3_writer', pg_temp.po_id(c.case_no * 1000 + 1)::text, true);
    insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
    values (pg_temp.po_id(c.case_no * 1000 + 2), current_setting('test.tenant_id')::uuid, pg_temp.po_id(c.case_no * 1000 + 1),
      'section', 1, 'Lot fictif');
    if c.dpgf then
      -- A DPGF price line: the version applies through the 5-argument overload only.
      insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description,
        quantity, unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents,
        line_tax_cents, line_total_ttc_cents, source_provider, source_file_name, source_page, source_metadata, fo_provision)
      values (pg_temp.po_id(c.case_no * 1000 + 3), current_setting('test.tenant_id')::uuid, pg_temp.po_id(c.case_no * 1000 + 1),
        pg_temp.po_id(c.case_no * 1000 + 2), 'line', 1, 'EF cuivre DN 22', 'ml', 30, 'ml', 1000, 2000, 1, 0, 1, 1000, 30000,
        6000, 36000, 'dpgf', 'dpgf-fictif.xlsx', 7, '{"dpgf_source_quantity":30,"dpgf_source_unit":"ml"}', 1);
      perform public.estimate_v3_complete_entry_for_writer(pg_temp.po_id(c.case_no * 1000 + 1),
        array[pg_temp.po_id(c.case_no * 1000 + 3)]);
    end if;
    perform set_config('miaouffrage.estimate_v3_writer', '', true);
  end loop;
end;
$sections$;

-- Takeoffs: M1 and M2 of each case, level B, completed; the engineer launched case 8's.
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select pg_temp.po_id(c.case_no * 1000 + 10 + job_no), current_setting('test.tenant_id')::uuid,
  pg_temp.po_id(c.case_no * 1000 + 1), 'B', 'completed', 'plan-fictif.pdf', pg_temp.po_id(case when c.case_no = 8 then 2 else 1 end)
from po_cases c cross join generate_series(1, 2) as job_no
where (c.case_no, job_no) <> (4, 2);

-- The plan files: A and B, two documents both named plan.pdf in case 6 and 18.
select set_config('test.plan_a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('test.plan_b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);

-- Lines: job 1 or 2 of a case, its number, designation, quantity, unit, file, page, document (A, B, upload, none), extra
-- metadata.
create temporary table po_items (
  case_no integer not null, job_no integer not null, line_no integer not null, designation text not null,
  quantity numeric not null, unit text not null, file_name text, page integer, document text, metadata jsonb not null default '{}',
  hypothesis boolean not null default false, verified boolean not null default false,
  primary key (case_no, job_no, line_no)
) on commit drop;
insert into po_items (case_no, job_no, line_no, designation, quantity, unit, file_name, page, document, metadata) values
  -- 1: the same page measured again, applied with « Ajouter ».
  (1, 1, 1, 'EF cuivre DN 20', 12.4, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'), (1, 1, 2, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (1, 2, 1, 'EF cuivre DN 20', 12.6, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'), (1, 2, 2, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 2: the same, through the 5-argument overload of a DPGF version.
  (2, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (2, 2, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 3: the other reading of the page (a vector run, then the model's length).
  (3, 1, 1, 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'A', '{"vector":{"schema_version":1,"kind":"network"}}'),
  (3, 2, 1, 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 4: the page measured again in a copy of the version.
  (4, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (4, 2, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 5: two zones of one level (TKR negative control).
  (5, 1, 1, 'WC suspendu', 4, 'u', 'zone-R+1-Z1.pdf', 1, null, '{}'), (5, 2, 1, 'WC suspendu', 3, 'u', 'zone-R+1-Z2.pdf', 1, null, '{}'),
  -- 6: two plan files of one name.
  (6, 1, 1, 'WC suspendu', 4, 'u', 'plan.pdf', 1, 'A', '{}'), (6, 2, 1, 'WC suspendu', 3, 'u', 'plan.pdf', 1, 'B', '{}'),
  -- 7: the page measured again, its lines skipped by the mapping plan; another page applied.
  (7, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (7, 2, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (7, 2, 2, 'Vanne d''arrêt', 2, 'u', 'plan-fictif.pdf', 2, 'A', '{}'),
  -- 8: two zones drawn on one sheet, kept both by the engineer.
  (8, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (8, 2, 1, 'WC suspendu', 2, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 9: the gesture: one length and one count updated, one line gone, one new line.
  (9, 1, 1, 'EF cuivre DN 20', 12.4, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'), (9, 1, 2, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (9, 1, 3, 'Vanne d''arrêt', 3, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (9, 2, 1, 'EF cuivre DN 20', 15.2, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'), (9, 2, 2, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (9, 2, 3, 'Lave-mains', 2, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 10: a length merged over two pages; only page 1 measured again.
  (10, 1, 1, 'EF cuivre DN 20', 10.2, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'), (10, 1, 2, 'EF cuivre DN 20', 5.3, 'ml', 'plan-fictif.pdf', 2, 'A', '{}'),
  (10, 2, 1, 'EF cuivre DN 20', 8.1, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 11: a line the new takeoff no longer has.
  (11, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (11, 1, 2, 'Vanne d''arrêt', 3, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (11, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 12 and 22: a quantity changed by hand.
  (12, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (12, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (22, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (22, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 13: lines deleted or changed between the decision and the application.
  (13, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (13, 1, 2, 'Vanne d''arrêt', 3, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (13, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (13, 2, 2, 'Vanne d''arrêt', 3, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 14: `merge` sends a new line onto another earlier line than its pair.
  (14, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (14, 1, 2, 'Vanne d''arrêt', 3, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (14, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (14, 2, 2, 'Vanne d''arrêt', 3, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 15: provisions (below): M1's support is an entered hypothesis, M2's is verified; M2's collar is an entered hypothesis.
  (15, 1, 2, 'Collier', 6, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 16: engine 2.
  (16, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (16, 1, 2, 'Vanne d''arrêt', 3, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (16, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (16, 2, 2, 'Vanne d''arrêt', 3, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 17: a DPGF target fed by M1, fed again by M2's page.
  (17, 1, 1, 'EF cuivre DN 22', 30, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'), (17, 2, 1, 'EF cuivre DN 22', 30, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 18: a line known only by its name meets two identified documents of that name.
  (18, 1, 1, 'WC suspendu', 4, 'u', 'plan.pdf', 1, 'A', '{}'), (18, 1, 2, 'Vanne d''arrêt', 3, 'u', 'plan.pdf', 1, 'B', '{}'),
  (18, 2, 1, 'WC suspendu', 5, 'u', 'plan.pdf', 1, 'upload', '{}'),
  -- 19, 20, 21: decided by another person, with « Remplacer la section », merged by title without a decision.
  (19, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (19, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (20, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (20, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (21, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (21, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 23: « keep mine » with « Fusionner », which writes the new quantity on its matched line first.
  (23, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (23, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 24: a length merged over two pages, gone from page 1 only: removing the line would remove page 2's part.
  (24, 1, 1, 'EF cuivre DN 20', 10.2, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'), (24, 1, 2, 'EF cuivre DN 20', 5.3, 'ml', 'plan-fictif.pdf', 2, 'A', '{}'),
  (24, 2, 1, 'WC suspendu', 2, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 25: an ouvrage applied from a line of the page (its section and its component lines carry the source line).
  (25, 1, 1, 'Collier', 6, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (25, 1, 2, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  (25, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (25, 2, 2, 'Collier', 7, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 26: a « replacement » that keeps every earlier line and replaces nothing.
  (26, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (26, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 27: a DPGF target fed by M1 from the page, not fed again by M2.
  (27, 1, 1, 'EF cuivre DN 22', 30, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'), (27, 2, 1, 'Vanne d''arrêt', 3, 'u', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 28: a length applied before TI-681, never rounded (its quantity is its raw measure).
  (28, 1, 1, 'EF cuivre DN 20', 10.2, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'), (28, 2, 1, 'EF cuivre DN 20', 8, 'ml', 'plan-fictif.pdf', 1, 'A', '{}'),
  -- 30: a line priced from a site offer (transport included), then a mapping rule pricing the new line on « Fusionner ».
  (30, 1, 1, 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'A', '{}'), (30, 2, 1, 'WC suspendu', 5, 'u', 'plan-fictif.pdf', 1, 'A', '{}');
insert into po_items (case_no, job_no, line_no, designation, quantity, unit, file_name, page, document, hypothesis, verified) values
  (15, 1, 1, 'Support mural', 8, 'u', 'plan-fictif.pdf', 1, 'A', true, false),
  (15, 2, 1, 'Support mural', 9, 'u', 'plan-fictif.pdf', 1, 'A', false, true),
  (15, 2, 2, 'Collier', 7, 'u', 'plan-fictif.pdf', 1, 'A', true, false);

create or replace function pg_temp.po_item(p_case integer, p_job integer, p_line integer)
returns uuid language sql immutable as $$ select pg_temp.po_id(p_case * 1000 + p_job * 100 + p_line) $$;
grant execute on function pg_temp.po_item(integer, integer, integer) to authenticated;
create or replace function pg_temp.po_job(p_case integer, p_job integer)
returns uuid language sql immutable as $$ select pg_temp.po_id(p_case * 1000 + 10 + p_job) $$;
grant execute on function pg_temp.po_job(integer, integer) to authenticated;
create or replace function pg_temp.po_version(p_case integer)
returns uuid language sql immutable as $$ select pg_temp.po_id(p_case * 1000 + 1) $$;
grant execute on function pg_temp.po_version(integer) to authenticated;
create or replace function pg_temp.po_section(p_case integer)
returns uuid language sql immutable as $$ select pg_temp.po_id(p_case * 1000 + 2) $$;
grant execute on function pg_temp.po_section(integer) to authenticated;

-- A job's lines are written when the case needs them (M2 after M1's application, as a relaunch is).
create or replace function pg_temp.po_seed(p_case integer, p_job integer)
returns void language sql as $$
  insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
    source_page, metadata, rule_results, is_verified, verified_by, verified_at, quantity_entered_by, quantity_entered_at,
    quantity_entry_category, quantity_entry_note, created_at)
  select pg_temp.po_item(item.case_no, item.job_no, item.line_no), current_setting('test.tenant_id')::uuid,
    pg_temp.po_job(item.case_no, item.job_no), item.designation, item.quantity, item.unit, 0.95, 'Repère localisé',
    item.file_name, item.page,
    item.metadata || case item.document
      when 'A' then jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', current_setting('test.plan_a')))
      when 'B' then jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', current_setting('test.plan_b')))
      when 'upload' then jsonb_build_object('source_document', jsonb_build_object('kind', 'job_upload', 'job_id', pg_temp.po_job(item.case_no, item.job_no)))
      else '{}'::jsonb end,
    '[]'::jsonb, item.verified, case when item.verified then pg_temp.po_id(1) end, case when item.verified then now() end,
    case when item.hypothesis then pg_temp.po_id(1) end, case when item.hypothesis then now() end,
    case when item.hypothesis then 'hypothesis' end,
    case when item.hypothesis then 'Quantité supposée, à confirmer au relevé.' end, now() + item.line_no * interval '1 second'
  from po_items item where item.case_no = p_case and item.job_no = p_job
$$;

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version.id, pg_temp.po_id(case when version.id = pg_temp.po_version(8) then 2 else 1 end), version.tenant_id,
  statement_timestamp() + interval '30 minutes', gen_random_uuid()
from public.estimate_versions version where version.project_id = pg_temp.po_id(10);

-- Helpers ------------------------------------------------------------------------------------------------------------

create temporary table po_outcome (case_name text primary key, state text, message text, detail jsonb) on commit drop;
grant all on po_outcome to authenticated;

create or replace function pg_temp.po_plan(p_job uuid, p_overrides jsonb)
returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', item.id, 'source_order', item.source_order, 'rule_id', null,
    'action', coalesce(p_overrides -> item.id::text ->> 'action', 'none'), 'designation', btrim(item.designation),
    'unit_price_cents', (p_overrides -> item.id::text ->> 'unit_price_cents')::integer, 'category_id', null,
    'assembly_id', (p_overrides -> item.id::text ->> 'assembly_id')::uuid)
    order by item.source_order), '[]'::jsonb)
  from (select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
    from public.takeoff_items ti where ti.job_id = p_job) as item
$$;
grant execute on function pg_temp.po_plan(uuid, jsonb) to authenticated;

create or replace function pg_temp.po_section_of(p_job uuid)
returns uuid language sql security definer as $$
  select item.id from public.estimate_items item join public.takeoff_jobs job on job.estimate_version_id = item.version_id
  where job.id = p_job and item.item_type = 'section' order by item.position limit 1
$$;
grant execute on function pg_temp.po_section_of(uuid) to authenticated;

-- Each application runs as the signed-in user, through the real overload; a refusal is recorded with its state, message
-- and detail, and its work rolled back with it.
create or replace function pg_temp.po_apply(p_case text, p_job uuid, p_strategy text, p_overrides jsonb, p_token text)
returns text language plpgsql as $$
declare
  failure_detail text;
  target_section uuid := pg_temp.po_section_of(p_job);
  result_row record;
begin
  perform set_config('app.takeoff_apply_atomic', '', true);
  perform set_config('app.takeoff_apply_job', '', true);
  begin
    if p_token is null then
      select * into result_row from public.apply_takeoff_job_guarded_atomic(p_job, p_strategy, target_section,
        pg_temp.po_plan(p_job, p_overrides));
    else
      select * into result_row from public.apply_takeoff_job_guarded_atomic(p_job, p_strategy, target_section,
        pg_temp.po_plan(p_job, p_overrides), p_token);
    end if;
    insert into po_outcome values (p_case, 'ok', null, null);
  exception when others then
    get stacked diagnostics failure_detail = pg_exception_detail;
    insert into po_outcome values (p_case, sqlstate, sqlerrm,
      case when failure_detail ~ '^\s*\{' then failure_detail::jsonb end);
  end;
  return (select case when state = 'ok' then 'ok' else state || ' ' || message end from po_outcome where case_name = p_case);
end;
$$;
grant execute on function pg_temp.po_apply(text, uuid, text, jsonb, text) to authenticated;

create or replace function pg_temp.po_decide(p_job uuid, p_decisions jsonb)
returns text language plpgsql as $$
declare
  failure_detail text;
begin
  return 'ok ' || public.record_takeoff_page_decisions(p_job, p_decisions);
exception when others then
  get stacked diagnostics failure_detail = pg_exception_detail;
  return sqlstate || ' ' || sqlerrm
    || coalesce(' ' || (case when failure_detail ~ '^\s*\{' then failure_detail::jsonb ->> 'reason' end), '');
end;
$$;
grant execute on function pg_temp.po_decide(uuid, jsonb) to authenticated;

-- The one line of a version with this title (null when there is none or several; each case counts them too).
-- Read as the fixtures' owner: a decision names the lines as the proposal read them, whoever records it.
create or replace function pg_temp.po_line(p_case integer, p_title text)
returns public.estimate_items language sql security definer as $$
  select case when count(*) = 1 then (array_agg(item))[1] end from public.estimate_items item
  where item.version_id = pg_temp.po_version(p_case) and item.item_type = 'line' and item.title = p_title
$$;
grant execute on function pg_temp.po_line(integer, text) to authenticated;
create or replace function pg_temp.po_count(p_case integer, p_title text)
returns integer language sql as $$
  select count(*)::integer from public.estimate_items item
  where item.version_id = pg_temp.po_version(p_case) and item.item_type = 'line' and item.title = p_title
$$;
grant execute on function pg_temp.po_count(integer, text) to authenticated;

-- A decision line: the earlier estimate line as it is now, its action, the estimator's choice for a quantity changed by
-- hand, and its earlier source lines on the page.
create or replace function pg_temp.po_ref(p_case integer, p_title text, p_action text, p_take text, p_item_ids uuid[])
returns jsonb language sql as $$
  select jsonb_build_object('estimate_item_id', (pg_temp.po_line(p_case, p_title)).id,
    'expected_updated_at', (pg_temp.po_line(p_case, p_title)).updated_at, 'action', p_action, 'take', p_take,
    'item_ids', to_jsonb(coalesce(p_item_ids, '{}'::uuid[])))
$$;
grant execute on function pg_temp.po_ref(integer, text, text, text, uuid[]) to authenticated;
create or replace function pg_temp.po_pair(p_takeoff_item uuid, p_case integer, p_title text)
returns jsonb language sql as $$
  select jsonb_build_object('takeoff_item_id', p_takeoff_item, 'estimate_item_id', (pg_temp.po_line(p_case, p_title)).id)
$$;
grant execute on function pg_temp.po_pair(uuid, integer, text) to authenticated;
create or replace function pg_temp.po_decision(p_case integer, p_decision text, p_reason text, p_note text, p_lines jsonb,
  p_pairs jsonb, p_page integer default 1, p_file text default 'plan-fictif.pdf')
returns jsonb language sql as $$
  select jsonb_build_object('document', jsonb_build_object('plan_file_id', current_setting('test.plan_a'), 'content_hash', null,
    'logical_document_id', null, 'file_name', p_file), 'source_page', p_page,
    'earlier_job_ids', jsonb_build_array(pg_temp.po_job(p_case, 1)), 'decision', p_decision, 'reason_code', p_reason,
    'note', p_note, 'lines', p_lines, 'pairs', p_pairs)
$$;
grant execute on function pg_temp.po_decision(integer, text, text, text, jsonb, jsonb, integer, text) to authenticated;

-- The first takeoff of every case applies alone (nothing of its page is in the estimate yet).
select pg_temp.po_seed(c.case_no, 1) from po_cases c;

-- The DPGF authorizations: case 2 reconciles nothing; case 17's M1 feeds the DPGF line from its run of page 1.
insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash,
  review_summary, expires_at)
values
  (current_setting('test.tenant_id')::uuid, pg_temp.po_job(2, 1), pg_temp.po_version(2), pg_temp.po_id(1),
   encode(sha256(convert_to('page-once-2-1', 'UTF8')), 'hex'), '{}'::jsonb, now() + interval '5 minutes'),
  (current_setting('test.tenant_id')::uuid, pg_temp.po_job(2, 2), pg_temp.po_version(2), pg_temp.po_id(1),
   encode(sha256(convert_to('page-once-2-2', 'UTF8')), 'hex'), '{}'::jsonb, now() + interval '5 minutes');

create or replace function pg_temp.po_dpgf_permit(p_case integer, p_job integer, p_token text)
returns void language sql as $$
  insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash,
    review_summary, expires_at)
  select current_setting('test.tenant_id')::uuid, pg_temp.po_job(p_case, p_job), pg_temp.po_version(p_case), pg_temp.po_id(1),
    encode(sha256(convert_to(p_token, 'UTF8')), 'hex'),
    jsonb_build_object('quantity_policy', jsonb_build_array(jsonb_build_object(
      'target_id', target.id, 'expected_updated_at', target.updated_at,
      'reference_quantity', 30, 'measured_quantity', 30, 'priced_quantity', 30, 'absolute_gap', 0, 'reviewed', false,
      'source_file_name', 'dpgf-fictif.xlsx', 'source_page', 7,
      'source_metadata', jsonb_build_object('dpgf_source_quantity', 30, 'dpgf_source_unit', 'ml'),
      'takeoff_items', (select jsonb_agg(jsonb_build_object('id', ti.id, 'quantity', ti.quantity, 'updated_at', ti.updated_at))
        from public.takeoff_items ti where ti.job_id = pg_temp.po_job(p_case, p_job))))),
    now() + interval '5 minutes'
  from public.estimate_items target where target.id = pg_temp.po_id(p_case * 1000 + 3)
$$;
select pg_temp.po_dpgf_permit(17, 1, 'page-once-17-1');
select pg_temp.po_dpgf_permit(27, 1, 'page-once-27-1');
-- Case 25: the ouvrage M1 applies from its collar (a section and one component line).
insert into public.estimate_assemblies (id, tenant_id, created_by, name)
values (pg_temp.po_id(25900), current_setting('test.tenant_id')::uuid, pg_temp.po_id(1), 'Ouvrage support fictif');
insert into public.estimate_assembly_items (id, tenant_id, assembly_id, title, unit, default_quantity, h_mo, position, cost_type,
  unit_cost_ht_cents)
values (pg_temp.po_id(25901), current_setting('test.tenant_id')::uuid, pg_temp.po_id(25900), 'Support distribution', 'u', 4, 0, 1,
  'material', 300);

select pg_temp.po_as(1);
set local role authenticated;
select is(pg_temp.po_apply('M1 ' || c.case_no, pg_temp.po_job(c.case_no, 1), case when c.case_no in (17, 27) then 'merge' else 'append' end,
    case when c.case_no = 25 then jsonb_build_object(pg_temp.po_item(25, 1, 1)::text,
      jsonb_build_object('action', 'apply_assembly', 'assembly_id', pg_temp.po_id(25900))) else '{}'::jsonb end,
    case c.case_no when 2 then 'page-once-2-1' when 17 then 'page-once-17-1' when 27 then 'page-once-27-1' end), 'ok',
  'fixture: the first takeoff of case ' || c.case_no || ' applies alone')
from po_cases c where c.case_no <> 8;
reset role;
select pg_temp.po_as(2);
set local role authenticated;
select is(pg_temp.po_apply('M1 8', pg_temp.po_job(8, 1), 'append', '{}'::jsonb, null), 'ok',
  'fixture: the engineer applies the first takeoff of case 8');
reset role;

-- Case 4: the version is copied; the second takeoff is launched in the copy.
select pg_temp.po_as(1);
set local role authenticated;
select set_config('test.copy_4', public.duplicate_estimate_version(pg_temp.po_version(4))::text, true);
reset role;
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values (pg_temp.po_job(4, 2), current_setting('test.tenant_id')::uuid, current_setting('test.copy_4')::uuid, 'B', 'completed',
  'plan-fictif.pdf', pg_temp.po_id(1));
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
values (current_setting('test.copy_4')::uuid, pg_temp.po_id(1), current_setting('test.tenant_id')::uuid,
  statement_timestamp() + interval '30 minutes', gen_random_uuid());

-- The estimator's work on case 9 after the first application: the length line renamed, priced, categorised, with hours;
-- the count line priced, once « Non chiffrée ».
do $edits$
begin
  perform set_config('miaouffrage.estimate_v3_writer', pg_temp.po_version(9)::text, true);
  update public.estimate_items set title = 'Réseau EF chiffré', unit_price_ht_cents = 2500, category_id = pg_temp.po_id(20),
    h_mo_per_unit = 0.4
  where id = (pg_temp.po_line(9, 'EF cuivre DN 20')).id;
  update public.estimate_items set pricing_status = 'not_priced' where id = (pg_temp.po_line(9, 'WC suspendu')).id;
  update public.estimate_items set pricing_status = 'priced', unit_price_ht_cents = 15000
  where id = (pg_temp.po_line(9, 'WC suspendu')).id;
  perform public.estimate_v3_complete_entry_for_writer(pg_temp.po_version(9), '{}'::uuid[]);
  -- Cases 12 and 22: a quantity changed by hand (4 measured, 6 typed).
  perform set_config('miaouffrage.estimate_v3_writer', pg_temp.po_version(12)::text, true);
  update public.estimate_items set quantity = 6 where id = (pg_temp.po_line(12, 'WC suspendu')).id;
  perform public.estimate_v3_complete_entry_for_writer(pg_temp.po_version(12), '{}'::uuid[]);
  -- Case 30: the estimator's supply price, typed from a site offer with transport included (TI-541).
  perform set_config('miaouffrage.estimate_v3_writer', pg_temp.po_version(30)::text, true);
  update public.estimate_items set unit_price_ht_cents = 15000, fo_price_origin = jsonb_build_object(
    'selection_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'kind', 'site', 'source_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'transport_mode', 'included', 'site', jsonb_build_object('supplier', 'Fournisseur fictif', 'offer_reference', null,
      'offer_date', '2026-11-01', 'document', null))
  where id = (pg_temp.po_line(30, 'WC suspendu')).id;
  perform public.estimate_v3_complete_entry_for_writer(pg_temp.po_version(30), '{}'::uuid[]);
  perform set_config('miaouffrage.estimate_v3_writer', pg_temp.po_version(23)::text, true);
  update public.estimate_items set quantity = 6 where id = (pg_temp.po_line(23, 'WC suspendu')).id;
  perform public.estimate_v3_complete_entry_for_writer(pg_temp.po_version(23), '{}'::uuid[]);
  -- Case 28: a length line as an application before TI-681 left it, its raw measure without a rounding key.
  perform set_config('miaouffrage.estimate_v3_writer', pg_temp.po_version(28)::text, true);
  update public.estimate_items set quantity = 10.2, source_metadata = source_metadata - 'takeoff_length_rounding'
  where id = (pg_temp.po_line(28, 'EF cuivre DN 20')).id;
  perform public.estimate_v3_complete_entry_for_writer(pg_temp.po_version(28), '{}'::uuid[]);
  perform set_config('miaouffrage.estimate_v3_writer', pg_temp.po_version(22)::text, true);
  update public.estimate_items set quantity = 6 where id = (pg_temp.po_line(22, 'WC suspendu')).id;
  -- Lot C (#231): the line left « Non chiffrée » with a written reserve declared in the offer.
  update public.estimate_items set pricing_status = 'not_priced' where id = (pg_temp.po_line(22, 'WC suspendu')).id;
  update public.estimate_items set offer_choice = jsonb_build_object('kind', 'reserve', 'basis', 'private_estimate',
    'code', 'pending_survey', 'note', null, 'decided_by', pg_temp.po_id(1), 'decided_at', '2026-11-11T10:00:00Z')
  where id = (pg_temp.po_line(22, 'WC suspendu')).id;
  perform public.estimate_v3_complete_entry_for_writer(pg_temp.po_version(22), '{}'::uuid[]);
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
end;
$edits$;
create temporary table po_before on commit drop as
select item.title, to_jsonb(item) as row from public.estimate_items item
where item.version_id = pg_temp.po_version(9) and item.item_type = 'line';
insert into po_before select 'case 30', to_jsonb(item) from public.estimate_items item where item.id = (pg_temp.po_line(30, 'WC suspendu')).id;

-- The relaunches: every second takeoff reads its page again.
select pg_temp.po_seed(c.case_no, 2) from po_cases c;
select pg_temp.po_dpgf_permit(17, 2, 'page-once-17-2');
select pg_temp.po_dpgf_permit(17, 2, 'page-once-17-2b');

-- Refused without a decision ---------------------------------------------------------------------------------------

select pg_temp.po_as(1);
set local role authenticated;
select is(pg_temp.po_apply('relaunch', pg_temp.po_job(1, 2), 'append', '{}'::jsonb, null), '23514 TAKEOFF_PAGE_ALREADY_APPLIED',
  'a page measured again and applied with « Ajouter » without a decision is refused');
select is(pg_temp.po_apply('relaunch dpgf', pg_temp.po_job(2, 2), 'append', '{}'::jsonb, 'page-once-2-2'),
  '23514 TAKEOFF_PAGE_ALREADY_APPLIED', 'the 5-argument overload refuses it the same way');
select is(pg_temp.po_apply('other reading', pg_temp.po_job(3, 2), 'append', '{}'::jsonb, null), '23514 TAKEOFF_PAGE_ALREADY_APPLIED',
  'the other reading of the page (vector, then the model) is the same page');
select is(pg_temp.po_apply('copy', pg_temp.po_job(4, 2), 'append', '{}'::jsonb, null), '23514 TAKEOFF_PAGE_ALREADY_APPLIED',
  'in a copy of the version, the copied lines still bring the page');
select is(pg_temp.po_apply('merged by title', pg_temp.po_job(21, 2), 'merge', '{}'::jsonb, null), '23514 TAKEOFF_PAGE_ALREADY_APPLIED',
  '« Fusionner » onto the earlier line by its title, without a decision, is refused too');
reset role;

select is((select detail from po_outcome where case_name = 'relaunch'),
  jsonb_build_object('scope', 'page', 'reason', 'page_already_applied', 'source_file_name', 'plan-fictif.pdf', 'source_page', 1,
    'plan_file_id', current_setting('test.plan_a'), 'earlier_job_ids', jsonb_build_array(pg_temp.po_job(1, 1)), 'line_count', 2),
  'the refusal names the page, its plan file, the earlier takeoff and its lines there');
select is((select detail ->> 'earlier_job_ids' from po_outcome where case_name = 'copy'),
  jsonb_build_array(pg_temp.po_job(4, 1))::text, 'the copy''s refusal names the takeoff of the original version');
select is((select status::text from public.takeoff_jobs where id = pg_temp.po_job(1, 2)), 'completed',
  'a refused takeoff stays to apply');
select is((select count(*)::integer from public.estimate_items where version_id = pg_temp.po_version(1) and item_type = 'line'), 2,
  'nothing of a refused application is written');
select is((pg_temp.po_line(21, 'WC suspendu')).quantity, 4::numeric, 'the line « Fusionner » matched keeps its earlier quantity');

-- Passes: other pages, another document, a page the plan skips ---------------------------------------------------------

set local role authenticated;
select is(pg_temp.po_apply('zones', pg_temp.po_job(5, 2), 'append', '{}'::jsonb, null), 'ok', 'two zones of one level are two pages');
select is(pg_temp.po_apply('two files', pg_temp.po_job(6, 2), 'append', '{}'::jsonb, null), 'ok',
  'two plan files of one name are two documents');
select is(pg_temp.po_apply('skipped', pg_temp.po_job(7, 2), 'append',
    jsonb_build_object(pg_temp.po_item(7, 2, 1)::text, jsonb_build_object('action', 'skip')), null), 'ok',
  'a page whose new lines the mapping plan skips brings nothing: its other page applies');
reset role;
select is(pg_temp.po_count(7, 'WC suspendu'), 1, 'the skipped page is counted once');

-- Keep both ----------------------------------------------------------------------------------------------------------

select pg_temp.po_as(2);
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(8, 2), jsonb_build_array(pg_temp.po_decision(8, 'keep_both', 'whatever', null,
    jsonb_build_array(pg_temp.po_ref(8, 'WC suspendu', 'keep', null, array[pg_temp.po_item(8, 1, 1)])), '[]'::jsonb))),
  '22023 TAKEOFF_PAGE_DECISION_INVALID shape', 'an unknown reason is refused');
select is(pg_temp.po_decide(pg_temp.po_job(8, 2), jsonb_build_array(pg_temp.po_decision(8, 'keep_both', 'complementary_scope', 'court',
    jsonb_build_array(pg_temp.po_ref(8, 'WC suspendu', 'keep', null, array[pg_temp.po_item(8, 1, 1)])), '[]'::jsonb))),
  '22023 TAKEOFF_PAGE_DECISION_INVALID shape', 'a complementary scope needs a note of ten characters at least');
select is(pg_temp.po_decide(pg_temp.po_job(8, 2), jsonb_build_array(pg_temp.po_decision(8, 'keep_both', 'other_zone', null,
    jsonb_build_array(pg_temp.po_ref(8, 'WC suspendu', 'keep', null, array[pg_temp.po_item(8, 1, 1)])
      || '{"expected_updated_at": "hier"}'::jsonb), '[]'::jsonb))),
  '22023 TAKEOFF_PAGE_DECISION_INVALID shape', 'a line read at no readable time is refused');
select is(pg_temp.po_decide(pg_temp.po_job(8, 2), jsonb_build_array(pg_temp.po_decision(8, 'keep_both', 'other_zone', null,
    jsonb_build_array(pg_temp.po_ref(8, 'WC suspendu', 'keep', null, array[pg_temp.po_item(8, 1, 1)])), '[]'::jsonb)
    || '{"source_page": 1.5}'::jsonb)),
  '22023 TAKEOFF_PAGE_DECISION_INVALID shape', 'a page that is no whole number is refused');
select is(pg_temp.po_decide(pg_temp.po_job(8, 2), jsonb_build_array(pg_temp.po_decision(8, 'keep_both', 'other_zone', null,
    jsonb_build_array(pg_temp.po_ref(8, 'WC suspendu', 'keep', null, array[pg_temp.po_item(8, 1, 1)])), '[]'::jsonb))),
  'ok 1', 'an engineer keeps both with « another zone »');
select is(pg_temp.po_apply('keep both', pg_temp.po_job(8, 2), 'append', '{}'::jsonb, null), 'ok',
  'the engineer applies the second zone of the sheet');
select is(pg_temp.po_decide(pg_temp.po_job(8, 2), '[]'::jsonb), '55000 TAKEOFF_PAGE_DECISIONS_FROZEN',
  'the decisions of an applied takeoff are frozen');
reset role;
select is((select jsonb_agg(item.quantity order by item.quantity) from public.estimate_items item
    where item.version_id = pg_temp.po_version(8) and item.title = 'WC suspendu'), '[2, 4]'::jsonb, 'both zones are in the estimate');
select pg_temp.po_as(1);
set local role authenticated;
select is((select reason_code from public.takeoff_page_decisions where job_id = pg_temp.po_job(8, 2)), 'other_zone',
  'the reason is read back by a member of the tenant');
reset role;

-- Replace: the gesture -------------------------------------------------------------------------------------------------

set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(9, 2), jsonb_build_array(pg_temp.po_decision(9, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(9, 'Réseau EF chiffré', 'update', null, array[pg_temp.po_item(9, 1, 1)]),
      pg_temp.po_ref(9, 'WC suspendu', 'update', null, array[pg_temp.po_item(9, 1, 2)]),
      pg_temp.po_ref(9, 'Vanne d''arrêt', 'remove', null, array[pg_temp.po_item(9, 1, 3)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(9, 2, 1), 9, 'Réseau EF chiffré'),
      pg_temp.po_pair(pg_temp.po_item(9, 2, 2), 9, 'WC suspendu'))))), 'ok 1', 'the replacement is recorded');
select is(pg_temp.po_apply('replace', pg_temp.po_job(9, 2), 'append', '{}'::jsonb, null), 'ok', 'the replacement applies');
reset role;

select is((select jsonb_agg(jsonb_build_array(item.title, item.quantity, item.source_job_id = pg_temp.po_job(9, 2)) order by item.title)
    from public.estimate_items item where item.version_id = pg_temp.po_version(9) and item.item_type = 'line'),
  '[["Lave-mains", 2, true], ["Réseau EF chiffré", 16, true], ["WC suspendu", 5, true]]'::jsonb,
  'each quantity of the page is counted once: two updated, the vanished one removed, the new one added');
select is((pg_temp.po_line(9, 'Réseau EF chiffré')).id, (select (row ->> 'id')::uuid from po_before where title = 'Réseau EF chiffré'),
  'the replaced line keeps its identity');
select is(
  (select to_jsonb(after) - array['quantity', 'h_mo', 'h_mo_atelier', 'h_mo_chantier', 'source_job_id', 'source_file_name', 'source_page',
      'source_metadata', 'updated_at', 'pu_ht_cents', 'line_total_ht_cents', 'line_tax_cents', 'line_total_ttc_cents']
    from public.estimate_items after where after.id = (select (row ->> 'id')::uuid from po_before where title = 'Réseau EF chiffré')),
  (select row - array['quantity', 'h_mo', 'h_mo_atelier', 'h_mo_chantier', 'source_job_id', 'source_file_name', 'source_page',
      'source_metadata', 'updated_at', 'pu_ht_cents', 'line_total_ht_cents', 'line_tax_cents', 'line_total_ttc_cents'] from po_before where title = 'Réseau EF chiffré'),
  'the length line keeps its title, price, category, hours per unit, position, status and every other column (its total hours follow the quantity)');
select is(
  (select to_jsonb(after) - array['quantity', 'h_mo', 'h_mo_atelier', 'h_mo_chantier', 'source_job_id', 'source_file_name', 'source_page',
      'source_metadata', 'updated_at', 'pu_ht_cents', 'line_total_ht_cents', 'line_tax_cents', 'line_total_ttc_cents']
    from public.estimate_items after where after.id = (select (row ->> 'id')::uuid from po_before where title = 'WC suspendu')),
  (select row - array['quantity', 'h_mo', 'h_mo_atelier', 'h_mo_chantier', 'source_job_id', 'source_file_name', 'source_page',
      'source_metadata', 'updated_at', 'pu_ht_cents', 'line_total_ht_cents', 'line_tax_cents', 'line_total_ttc_cents'] from po_before where title = 'WC suspendu'),
  'the count line keeps its price and « was not priced » (lot C)');
select is((pg_temp.po_line(9, 'WC suspendu')).was_not_priced, true, 'fixture: the count line had been « Non chiffrée »');
select is((pg_temp.po_line(9, 'Réseau EF chiffré')).source_metadata -> 'takeoff_page_replacement',
  jsonb_build_object('version', 1, 'job_id', pg_temp.po_job(9, 2), 'replaced_job_ids', jsonb_build_array(pg_temp.po_job(9, 1)),
    'previous_quantity', 13, 'removed_raw', 12.4, 'added_raw', 15.2, 'take', 'new',
    'item_ids', jsonb_build_array(pg_temp.po_item(9, 2, 1))),
  'the replacement is written on the line: earlier quantity, part removed, part added');
select is((pg_temp.po_line(9, 'Réseau EF chiffré')).source_metadata -> 'takeoff_length_rounding',
  jsonb_build_object('version', 1, 'job_id', pg_temp.po_job(9, 2), 'raw_quantity', 15.2, 'metres_per_unit', 1,
    'item_ids', jsonb_build_array(pg_temp.po_item(9, 2, 1))), 'the length is rounded once, up to the metre');
select is((select count(*)::integer from public.estimate_items where version_id = pg_temp.po_version(9)
    and source_metadata ->> 'takeoff_item_id' in (pg_temp.po_item(9, 2, 1)::text, pg_temp.po_item(9, 2, 2)::text)), 2,
  'no line is left from what the application created for the paired lines');
select is((select jsonb_build_array(count(*), count(*) filter (where (line.value ->> 'pu_ht_cents')::integer is distinct from item.pu_ht_cents
      or (line.value ->> 'line_total_ht_cents')::integer is distinct from item.line_total_ht_cents))
    from public.estimate_items item
    join jsonb_array_elements(private.estimate_v3_compute(pg_temp.po_version(9)) -> 'lines') as line(value)
      on (line.value ->> 'id')::uuid = item.id
    where item.version_id = pg_temp.po_version(9) and item.item_type = 'line'), '[3, 0]'::jsonb,
  'the stored v3 amounts of the three lines are the engine''s');
select is((select total_ht_cents from public.estimate_versions where id = pg_temp.po_version(9)),
  (private.estimate_v3_compute(pg_temp.po_version(9)) -> 'totals' ->> 'total_ht_cents')::integer, 'the version total is the engine''s');
select is(current_setting('miaouffrage.estimate_v3_writer', true), '', 'the v3 writer contract is restored after the application');
select is(pg_temp.po_count(9, 'Vanne d''arrêt'), 0, 'the line the new takeoff no longer has is removed as chosen');

-- A length merged over two pages, one measured again: its other page keeps its part.
select pg_temp.po_as(1);
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(10, 2), jsonb_build_array(pg_temp.po_decision(10, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(10, 'EF cuivre DN 20', 'update', null, array[pg_temp.po_item(10, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(10, 2, 1), 10, 'EF cuivre DN 20'))))), 'ok 1', 'fixture: page 1 replaced');
select is(pg_temp.po_apply('two pages', pg_temp.po_job(10, 2), 'append', '{}'::jsonb, null), 'ok', 'page 1 of a two-page line is replaced');
reset role;
select is((pg_temp.po_line(10, 'EF cuivre DN 20')).quantity, 14::numeric,
  'the line holds 5.3 m of page 2 kept and 8.1 m of page 1 measured again, rounded once (16 before)');
select is((pg_temp.po_line(10, 'EF cuivre DN 20')).source_metadata #> '{takeoff_length_rounding,item_ids}',
  jsonb_build_array(pg_temp.po_item(10, 2, 1), pg_temp.po_item(10, 1, 2)), 'its sources are the new run and page 2''s earlier run');

-- A line the new takeoff no longer has: a choice, never a default.
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(11, 2), jsonb_build_array(pg_temp.po_decision(11, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(11, 'WC suspendu', 'update', null, array[pg_temp.po_item(11, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(11, 2, 1), 11, 'WC suspendu'))))), 'ok 1', 'fixture: the vanished line left out');
select is(pg_temp.po_apply('vanished without choice', pg_temp.po_job(11, 2), 'append', '{}'::jsonb, null),
  '40001 TAKEOFF_PAGE_DECISION_STALE', 'a vanished line without a choice is refused');
select is(pg_temp.po_decide(pg_temp.po_job(11, 2), jsonb_build_array(pg_temp.po_decision(11, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(11, 'WC suspendu', 'update', null, array[pg_temp.po_item(11, 1, 1)]),
      jsonb_build_object('estimate_item_id', (pg_temp.po_line(11, 'Vanne d''arrêt')).id,
        'expected_updated_at', (pg_temp.po_line(11, 'Vanne d''arrêt')).updated_at, 'item_ids', jsonb_build_array(pg_temp.po_item(11, 1, 2)))),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(11, 2, 1), 11, 'WC suspendu'))))),
  '22023 TAKEOFF_PAGE_DECISION_INVALID shape', 'a line without an action is not recorded');
select is(pg_temp.po_decide(pg_temp.po_job(11, 2), jsonb_build_array(pg_temp.po_decision(11, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(11, 'WC suspendu', 'update', null, array[pg_temp.po_item(11, 1, 1)]),
      pg_temp.po_ref(11, 'Vanne d''arrêt', 'keep', null, array[pg_temp.po_item(11, 1, 2)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(11, 2, 1), 11, 'WC suspendu'))))), 'ok 1', 'fixture: the vanished line kept');
select is(pg_temp.po_apply('vanished kept', pg_temp.po_job(11, 2), 'append', '{}'::jsonb, null), 'ok', 'a kept line applies');
reset role;
select is((select jsonb_agg(jsonb_build_array(item.title, item.quantity, item.source_job_id = pg_temp.po_job(11, 1)) order by item.title)
    from public.estimate_items item where item.version_id = pg_temp.po_version(11) and item.item_type = 'line'),
  '[["Vanne d''arrêt", 3, true], ["WC suspendu", 5, false]]'::jsonb, 'the kept line stays with its earlier takeoff');

-- A quantity changed by hand: the estimator chooses.
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(12, 2), jsonb_build_array(pg_temp.po_decision(12, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(12, 'WC suspendu', 'update', null, array[pg_temp.po_item(12, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(12, 2, 1), 12, 'WC suspendu'))))), 'ok 1', 'fixture: no choice for the hand quantity');
select is(pg_temp.po_apply('hand quantity', pg_temp.po_job(12, 2), 'append', '{}'::jsonb, null), '22023 TAKEOFF_PAGE_DECISION_INVALID',
  'a quantity changed by hand is never overwritten without the estimator''s choice');
reset role;
select is((select detail ->> 'reason' from po_outcome where case_name = 'hand quantity'), 'take_required', 'the refusal says why');
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(12, 2), jsonb_build_array(pg_temp.po_decision(12, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(12, 'WC suspendu', 'update', 'keep_mine', array[pg_temp.po_item(12, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(12, 2, 1), 12, 'WC suspendu'))))), 'ok 1', 'fixture: « garder la mienne »');
select is(pg_temp.po_apply('keep mine', pg_temp.po_job(12, 2), 'append', '{}'::jsonb, null), 'ok', 'the estimator keeps their quantity');
select is(pg_temp.po_decide(pg_temp.po_job(22, 2), jsonb_build_array(pg_temp.po_decision(22, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(22, 'WC suspendu', 'update', 'new', array[pg_temp.po_item(22, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(22, 2, 1), 22, 'WC suspendu'))))), 'ok 1', 'fixture: « prendre la nouvelle mesure »');
select is(pg_temp.po_apply('take new', pg_temp.po_job(22, 2), 'append', '{}'::jsonb, null), 'ok', 'the estimator takes the new measure');
reset role;
select is(jsonb_build_array((pg_temp.po_line(12, 'WC suspendu')).quantity, (pg_temp.po_line(12, 'WC suspendu')).source_job_id = pg_temp.po_job(12, 2),
    (pg_temp.po_line(12, 'WC suspendu')).source_metadata #>> '{takeoff_page_replacement,take}'),
  '[6, true, "keep_mine"]'::jsonb, '« keep mine »: the hand quantity stays, the provenance is the new takeoff''s');
select is((pg_temp.po_line(22, 'WC suspendu')).quantity, 5::numeric, '« take new »: the new measure replaces the hand quantity');
select is(jsonb_build_array((pg_temp.po_line(22, 'WC suspendu')).pricing_status, (pg_temp.po_line(22, 'WC suspendu')).was_not_priced,
    (pg_temp.po_line(22, 'WC suspendu')).offer_choice ->> 'code'),
  '["not_priced", true, "pending_survey"]'::jsonb, 'the replaced line keeps its status and the reserve written in the offer (lot C)');

-- Between the decision and the application.
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(13, 2), jsonb_build_array(pg_temp.po_decision(13, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(13, 'WC suspendu', 'update', null, array[pg_temp.po_item(13, 1, 1)]),
      pg_temp.po_ref(13, 'Vanne d''arrêt', 'update', null, array[pg_temp.po_item(13, 1, 2)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(13, 2, 1), 13, 'WC suspendu'),
      pg_temp.po_pair(pg_temp.po_item(13, 2, 2), 13, 'Vanne d''arrêt'))))), 'ok 1', 'fixture: both lines replaced');
reset role;
do $deleted$
begin
  perform set_config('miaouffrage.estimate_v3_writer', pg_temp.po_version(13)::text, true);
  delete from public.estimate_items where id = (pg_temp.po_line(13, 'Vanne d''arrêt')).id;
  perform public.estimate_v3_complete_entry_for_writer(pg_temp.po_version(13), '{}'::uuid[]);
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
end;
$deleted$;
set local role authenticated;
select is(pg_temp.po_apply('line deleted', pg_temp.po_job(13, 2), 'append', '{}'::jsonb, null), '40001 TAKEOFF_PAGE_DECISION_STALE',
  'a paired line deleted since the decision makes it stale');
select is(pg_temp.po_decide(pg_temp.po_job(13, 2), jsonb_build_array(pg_temp.po_decision(13, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(13, 'WC suspendu', 'update', null, array[pg_temp.po_item(13, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(13, 2, 1), 13, 'WC suspendu'))))), 'ok 1', 'fixture: decided again');
reset role;
-- An edit in another transaction moves the line's updated_at; within this test's one transaction it cannot (now() is fixed),
-- so the decision is recorded as read one second before it.
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(13, 2), jsonb_build_array(pg_temp.po_decision(13, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(13, 'WC suspendu', 'update', null, array[pg_temp.po_item(13, 1, 1)])
      || jsonb_build_object('expected_updated_at', (pg_temp.po_line(13, 'WC suspendu')).updated_at - interval '1 second')),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(13, 2, 1), 13, 'WC suspendu'))))), 'ok 1', 'fixture: decided before an edit');
reset role;
set local role authenticated;
select is(pg_temp.po_apply('line edited', pg_temp.po_job(13, 2), 'append', '{}'::jsonb, null), '40001 TAKEOFF_PAGE_DECISION_STALE',
  'a paired line edited since the decision makes it stale');
reset role;
select is((select jsonb_agg(detail ->> 'reason' order by case_name) from po_outcome where case_name in ('line deleted', 'line edited')),
  '["line_missing", "line_changed"]'::jsonb, 'each staleness says why');

-- `merge` sends a new line onto another earlier line than its pair.
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(14, 2), jsonb_build_array(pg_temp.po_decision(14, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(14, 'WC suspendu', 'update', null, array[pg_temp.po_item(14, 1, 1)]),
      pg_temp.po_ref(14, 'Vanne d''arrêt', 'update', null, array[pg_temp.po_item(14, 1, 2)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(14, 2, 1), 14, 'Vanne d''arrêt'),
      pg_temp.po_pair(pg_temp.po_item(14, 2, 2), 14, 'WC suspendu'))))), 'ok 1', 'fixture: crossed pairs');
select is(pg_temp.po_apply('merge elsewhere', pg_temp.po_job(14, 2), 'merge', '{}'::jsonb, null), '40001 TAKEOFF_PAGE_REPLACE_CONFLICT',
  '« Fusionner » sending a line elsewhere than its pair is refused');
select is(pg_temp.po_apply('crossed append', pg_temp.po_job(14, 2), 'append', '{}'::jsonb, null), 'ok',
  'with « Ajouter », the pairs the estimator corrected apply');
reset role;
select is((select jsonb_agg(jsonb_build_array(item.title, item.quantity) order by item.title) from public.estimate_items item
    where item.version_id = pg_temp.po_version(14) and item.item_type = 'line'),
  '[["Vanne d''arrêt", 5], ["WC suspendu", 3]]'::jsonb, 'each line takes the quantity of the new line paired with it');

-- Provisions: the last takeoff wins.
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(15, 2), jsonb_build_array(pg_temp.po_decision(15, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(15, 'Support mural', 'update', null, array[pg_temp.po_item(15, 1, 1)]),
      pg_temp.po_ref(15, 'Collier', 'update', null, array[pg_temp.po_item(15, 1, 2)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(15, 2, 1), 15, 'Support mural'),
      pg_temp.po_pair(pg_temp.po_item(15, 2, 2), 15, 'Collier'))))), 'ok 1', 'fixture: both replaced');
reset role;
select ok((pg_temp.po_line(15, 'Support mural')).source_metadata ? 'takeoff_provision', 'fixture: the earlier hypothesis marked its line');
set local role authenticated;
select is(pg_temp.po_apply('provisions', pg_temp.po_job(15, 2), 'append', '{}'::jsonb, null), 'ok', 'provisions: applied');
reset role;
select ok(not ((pg_temp.po_line(15, 'Support mural')).source_metadata ? 'takeoff_provision'),
  'a line replaced by a verified line loses the earlier hypothesis marker');
select is((pg_temp.po_line(15, 'Collier')).source_metadata #> '{takeoff_provision,sources,0,takeoff_item_id}',
  to_jsonb(pg_temp.po_item(15, 2, 2)), 'a line replaced by an entered hypothesis of the new takeoff is marked with it');

-- Engine 2: the line names no source; its quantity is the new measure.
do $v2$
begin
  update public.estimate_items set unit_price_ht_cents = 15000 where id = (pg_temp.po_line(16, 'WC suspendu')).id;
end;
$v2$;
drop table if exists pg_temp._takeoff_apply_source;
drop table if exists pg_temp._takeoff_apply_created_ids;
drop table if exists pg_temp._takeoff_apply_matches;
drop table if exists pg_temp._takeoff_apply_unmatched;
set local role authenticated;
select is(pg_temp.po_apply('engine 2 relaunch', pg_temp.po_job(16, 2), 'append', '{}'::jsonb, null), '23514 TAKEOFF_PAGE_ALREADY_APPLIED',
  'engine 2: a page measured again without a decision is refused');
select is(pg_temp.po_decide(pg_temp.po_job(16, 2), jsonb_build_array(pg_temp.po_decision(16, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(16, 'WC suspendu', 'update', null, null), pg_temp.po_ref(16, 'Vanne d''arrêt', 'update', null, null)),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(16, 2, 1), 16, 'WC suspendu'),
      pg_temp.po_pair(pg_temp.po_item(16, 2, 2), 16, 'Vanne d''arrêt'))))), 'ok 1', 'fixture: engine 2 replacement without a choice');
reset role;
drop table if exists pg_temp._takeoff_apply_source;
drop table if exists pg_temp._takeoff_apply_created_ids;
drop table if exists pg_temp._takeoff_apply_matches;
drop table if exists pg_temp._takeoff_apply_unmatched;
set local role authenticated;
select is(pg_temp.po_apply('engine 2 no choice', pg_temp.po_job(16, 2), 'append', '{}'::jsonb, null), '22023 TAKEOFF_PAGE_DECISION_INVALID',
  'engine 2: a line names no source, so a quantity changed by hand cannot be seen: the estimator chooses');
select is(pg_temp.po_decide(pg_temp.po_job(16, 2), jsonb_build_array(pg_temp.po_decision(16, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(16, 'WC suspendu', 'update', 'new', null), pg_temp.po_ref(16, 'Vanne d''arrêt', 'update', 'new', null)),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(16, 2, 1), 16, 'WC suspendu'),
      pg_temp.po_pair(pg_temp.po_item(16, 2, 2), 16, 'Vanne d''arrêt'))))), 'ok 1', 'fixture: engine 2 replacement');
reset role;
drop table if exists pg_temp._takeoff_apply_source;
drop table if exists pg_temp._takeoff_apply_created_ids;
drop table if exists pg_temp._takeoff_apply_matches;
drop table if exists pg_temp._takeoff_apply_unmatched;
set local role authenticated;
select is(pg_temp.po_apply('engine 2 replace', pg_temp.po_job(16, 2), 'append', '{}'::jsonb, null), 'ok', 'engine 2: the replacement applies');
reset role;
select is((select jsonb_agg(jsonb_build_array(item.title, item.quantity, item.unit_price_ht_cents, item.source_job_id = pg_temp.po_job(16, 2))
      order by item.title) from public.estimate_items item where item.version_id = pg_temp.po_version(16) and item.item_type = 'line'),
  '[["Vanne d''arrêt", 3, 0, true], ["WC suspendu", 5, 15000, true]]'::jsonb,
  'engine 2: each line takes the new measure, keeps its price, and nothing is doubled');
select is((select total_ht_cents from public.estimate_versions where id = pg_temp.po_version(16)), 75000,
  'engine 2: the version total is recomputed on the new quantity');

-- DPGF: keeping both is refused where the page now feeds a target another takeoff fed (D-6).
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(17, 2), jsonb_build_array(pg_temp.po_decision(17, 'keep_both', 'other_zone', null,
    jsonb_build_array(pg_temp.po_ref(17, 'EF cuivre DN 22', 'keep', null, array[pg_temp.po_item(17, 1, 1)])), '[]'::jsonb))),
  'ok 1', 'fixture: both kept on a DPGF target');
select is(pg_temp.po_apply('dpgf keep both', pg_temp.po_job(17, 2), 'merge', '{}'::jsonb, 'page-once-17-2'),
  '22023 TAKEOFF_PAGE_DECISION_INVALID', 'keeping both is refused where the page feeds a DPGF target another takeoff fed');
select is(pg_temp.po_decide(pg_temp.po_job(17, 2), jsonb_build_array(pg_temp.po_decision(17, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(17, 'EF cuivre DN 22', 'keep', null, array[pg_temp.po_item(17, 1, 1)])), '[]'::jsonb))),
  'ok 1', 'fixture: the target left to its own policy');
select is(pg_temp.po_apply('dpgf replace', pg_temp.po_job(17, 2), 'merge', '{}'::jsonb, 'page-once-17-2b'), 'ok',
  'a replacement leaves the DPGF target to its own policy: the new measure replaces the earlier one');
reset role;
select is((select detail ->> 'reason' from po_outcome where case_name = 'dpgf keep both'), 'dpgf_keep_both', 'the refusal says why');
select is(jsonb_build_array((pg_temp.po_line(17, 'EF cuivre DN 22')).quantity,
    (pg_temp.po_line(17, 'EF cuivre DN 22')).source_metadata #>> '{takeoff_quantity_policy,job_id}'),
  jsonb_build_array(30, pg_temp.po_job(17, 2)), 'the DPGF target holds the new measure once');

-- Never across two documents; never decided by someone else; never beside « Remplacer la section ».
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(18, 2), jsonb_build_array(pg_temp.po_decision(18, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(18, 'WC suspendu', 'update', null, array[pg_temp.po_item(18, 1, 1)]),
      pg_temp.po_ref(18, 'Vanne d''arrêt', 'keep', null, array[pg_temp.po_item(18, 1, 2)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(18, 2, 1), 18, 'WC suspendu')), 1, 'plan.pdf'))), 'ok 1',
  'fixture: a line known by its name paired on a page of two documents');
select is(pg_temp.po_apply('two documents', pg_temp.po_job(18, 2), 'append', '{}'::jsonb, null), '22023 TAKEOFF_PAGE_DECISION_INVALID',
  'a line known only by its name is not paired where two plan files of that name meet');
reset role;
select is((select detail ->> 'reason' from po_outcome where case_name = 'two documents'), 'ambiguous_document', 'the refusal says why');
select pg_temp.po_as(2);
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(19, 2), jsonb_build_array(pg_temp.po_decision(19, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(19, 'WC suspendu', 'update', null, array[pg_temp.po_item(19, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(19, 2, 1), 19, 'WC suspendu'))))), 'ok 1', 'fixture: decided by the engineer');
reset role;
select pg_temp.po_as(1);
set local role authenticated;
select is(pg_temp.po_apply('decided by another', pg_temp.po_job(19, 2), 'append', '{}'::jsonb, null), '40001 TAKEOFF_PAGE_DECISION_STALE',
  'a decision recorded by another person is not applied in their place');
select is(pg_temp.po_decide(pg_temp.po_job(20, 2), jsonb_build_array(pg_temp.po_decision(20, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(20, 'WC suspendu', 'update', null, array[pg_temp.po_item(20, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(20, 2, 1), 20, 'WC suspendu'))))), 'ok 1', 'fixture: decided');
select is(pg_temp.po_apply('section emptied', pg_temp.po_job(20, 2), 'replace', '{}'::jsonb, null), '22023 TAKEOFF_PAGE_DECISION_INVALID',
  'a replacement beside « Remplacer la section » is refused');
reset role;

-- The independent review's cases ----------------------------------------------------------------------------------
-- Written before their fixes (red on the first version of this migration): « keep mine » kept what « Fusionner » wrote;
-- removing a length merged over two pages removed the page kept; an ouvrage's section blocked every decision; a new line
-- replaced an ouvrage's component; a « replacement » that kept everything let the page in twice without a reason; a DPGF
-- target not fed again was kept silently; a length applied before TI-681 was taken for a quantity changed by hand.
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(23, 2), jsonb_build_array(pg_temp.po_decision(23, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(23, 'WC suspendu', 'update', 'keep_mine', array[pg_temp.po_item(23, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(23, 2, 1), 23, 'WC suspendu'))))), 'ok 1', 'fixture: « keep mine »');
select is(pg_temp.po_apply('keep mine merged', pg_temp.po_job(23, 2), 'merge', '{}'::jsonb, null), 'ok',
  '« keep mine » applies with « Fusionner »');
select is(pg_temp.po_decide(pg_temp.po_job(24, 2), jsonb_build_array(pg_temp.po_decision(24, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(24, 'EF cuivre DN 20', 'remove', null, array[pg_temp.po_item(24, 1, 1)])), '[]'::jsonb))),
  'ok 1', 'fixture: a length of two pages removed');
select is(pg_temp.po_apply('remove other pages', pg_temp.po_job(24, 2), 'append', '{}'::jsonb, null), '22023 TAKEOFF_PAGE_DECISION_INVALID',
  'a line that also carries another page is not removed: its other page would go with it');
select is(pg_temp.po_decide(pg_temp.po_job(25, 2), jsonb_build_array(pg_temp.po_decision(25, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(25, 'WC suspendu', 'update', null, array[pg_temp.po_item(25, 1, 2)]),
      pg_temp.po_ref(25, 'Support distribution', 'update', null, array[pg_temp.po_item(25, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(25, 2, 1), 25, 'WC suspendu'),
      pg_temp.po_pair(pg_temp.po_item(25, 2, 2), 25, 'Support distribution'))))), 'ok 1', 'fixture: an ouvrage component paired');
select is(pg_temp.po_apply('assembly paired', pg_temp.po_job(25, 2), 'append', '{}'::jsonb, null), '22023 TAKEOFF_PAGE_DECISION_INVALID',
  'a new line never replaces an ouvrage''s component: its quantity is the ouvrage''s, not a measure');
select is(pg_temp.po_decide(pg_temp.po_job(25, 2), jsonb_build_array(pg_temp.po_decision(25, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(25, 'WC suspendu', 'update', null, array[pg_temp.po_item(25, 1, 2)]),
      pg_temp.po_ref(25, 'Support distribution', 'keep', null, array[pg_temp.po_item(25, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(25, 2, 1), 25, 'WC suspendu'))))), 'ok 1', 'fixture: the ouvrage kept');
select is(pg_temp.po_apply('assembly kept', pg_temp.po_job(25, 2), 'append', '{}'::jsonb, null), 'ok',
  'an ouvrage''s section is no line to decide: the decision of its lines is enough');
select is(pg_temp.po_decide(pg_temp.po_job(26, 2), jsonb_build_array(pg_temp.po_decision(26, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(26, 'WC suspendu', 'keep', null, array[pg_temp.po_item(26, 1, 1)])), '[]'::jsonb))),
  'ok 1', 'fixture: a « replacement » keeping everything');
select is(pg_temp.po_apply('nothing replaced', pg_temp.po_job(26, 2), 'append', '{}'::jsonb, null), '22023 TAKEOFF_PAGE_DECISION_INVALID',
  'a « replacement » that replaces nothing is keeping both, which needs a reason');
reset role;
insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash,
  review_summary, expires_at)
select current_setting('test.tenant_id')::uuid, pg_temp.po_job(27, 2), pg_temp.po_version(27), pg_temp.po_id(1),
  encode(sha256(convert_to(token, 'UTF8')), 'hex'), '{}'::jsonb, now() + interval '5 minutes'
from unnest(array['page-once-27-2', 'page-once-27-2b']) as token;
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(27, 2), jsonb_build_array(pg_temp.po_decision(27, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(27, 'EF cuivre DN 22', 'keep', null, array[pg_temp.po_item(27, 1, 1)])), '[]'::jsonb))),
  'ok 1', 'fixture: a DPGF target left to a policy that does not feed it');
select is(pg_temp.po_apply('dpgf not fed', pg_temp.po_job(27, 2), 'append', '{}'::jsonb, 'page-once-27-2'),
  '22023 TAKEOFF_PAGE_DECISION_INVALID', 'a DPGF target the new takeoff does not feed again is not « replaced »: its earlier measure stays');
select is(pg_temp.po_decide(pg_temp.po_job(27, 2), jsonb_build_array(pg_temp.po_decision(27, 'keep_both', 'other_trade', null,
    jsonb_build_array(pg_temp.po_ref(27, 'EF cuivre DN 22', 'keep', null, array[pg_temp.po_item(27, 1, 1)])), '[]'::jsonb))),
  'ok 1', 'fixture: both kept');
select is(pg_temp.po_apply('dpgf kept both', pg_temp.po_job(27, 2), 'append', '{}'::jsonb, 'page-once-27-2b'), 'ok',
  'keeping both is allowed where the DPGF target is not fed again');
select is(pg_temp.po_decide(pg_temp.po_job(28, 2), jsonb_build_array(pg_temp.po_decision(28, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(28, 'EF cuivre DN 20', 'update', null, array[pg_temp.po_item(28, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(28, 2, 1), 28, 'EF cuivre DN 20'))))), 'ok 1', 'fixture: an unrounded length');
select is(pg_temp.po_apply('unrounded', pg_temp.po_job(28, 2), 'append', '{}'::jsonb, null), 'ok',
  'a length applied before TI-681 (its raw measure, never rounded) is no quantity changed by hand');
reset role;
select is((select jsonb_agg(detail ->> 'reason' order by case_name) from po_outcome
    where case_name in ('remove other pages', 'assembly paired', 'nothing replaced', 'dpgf not fed', 'engine 2 no choice')),
  '["assembly_line", "dpgf_not_replaced", "take_required", "nothing_replaced", "remove_other_pages"]'::jsonb, 'each refusal says why');
select is((pg_temp.po_line(23, 'WC suspendu')).quantity, 6::numeric, '« keep mine » keeps the estimator''s 6, not what « Fusionner » wrote');
select is((select jsonb_agg(jsonb_build_array(item.title, item.quantity) order by item.title) from public.estimate_items item
    where item.version_id = pg_temp.po_version(25) and item.item_type = 'line'),
  '[["Collier", 7], ["Support distribution", 4], ["WC suspendu", 5]]'::jsonb, 'the ouvrage stays, the count is replaced, the new collar added');
select is((pg_temp.po_line(28, 'EF cuivre DN 20')).quantity, 8::numeric, 'the unrounded length takes the new measure');

-- Codex review of c06cbb1b: « Fusionner » matches the new line onto its pair and a mapping rule prices it. That price
-- was written on the paired line before the replacement restored it, and the supply provision trigger cleared its site
-- origin and derived its provision again: the selling price moved. Red on c06cbb1b. No mapping price nor category is
-- written on a line a decision replaces: every column but the quantity, the provenance and the amounts stays.
select is(((pg_temp.po_line(30, 'WC suspendu')).fo_price_origin ->> 'kind'), 'site', 'fixture: the line is priced from a site offer');
set local role authenticated;
select is(pg_temp.po_decide(pg_temp.po_job(30, 2), jsonb_build_array(pg_temp.po_decision(30, 'replace', null, null,
    jsonb_build_array(pg_temp.po_ref(30, 'WC suspendu', 'update', null, array[pg_temp.po_item(30, 1, 1)])),
    jsonb_build_array(pg_temp.po_pair(pg_temp.po_item(30, 2, 1), 30, 'WC suspendu'))))), 'ok 1', 'fixture: the line replaced');
select is(pg_temp.po_apply('mapping price on a pair', pg_temp.po_job(30, 2), 'merge',
    jsonb_build_object(pg_temp.po_item(30, 2, 1)::text, jsonb_build_object('action', 'set_price', 'unit_price_cents', 999)), null), 'ok',
  'the replacement applies with « Fusionner » and a mapping price on the new line');
reset role;
select is(
  (select to_jsonb(after) - array['quantity', 'h_mo', 'h_mo_atelier', 'h_mo_chantier', 'source_job_id', 'source_file_name', 'source_page',
      'source_metadata', 'updated_at', 'pu_ht_cents', 'line_total_ht_cents', 'line_tax_cents', 'line_total_ttc_cents']
    from public.estimate_items after where after.id = (select (row ->> 'id')::uuid from po_before where title = 'case 30')),
  (select row - array['quantity', 'h_mo', 'h_mo_atelier', 'h_mo_chantier', 'source_job_id', 'source_file_name', 'source_page',
      'source_metadata', 'updated_at', 'pu_ht_cents', 'line_total_ht_cents', 'line_tax_cents', 'line_total_ttc_cents']
    from po_before where title = 'case 30'),
  'the paired line keeps its price, its site origin, its provision and every other column: no mapping price reaches it');
select is((pg_temp.po_line(30, 'WC suspendu')).quantity, 5::numeric, 'its quantity takes the new measure');

-- The decisions table: no direct write, other tenants see nothing and write nothing -------------------------------------

set local role authenticated;
select throws_ok(format($sql$insert into public.takeoff_page_decisions (tenant_id, job_id, estimate_version_id, document, decision,
    decided_by) values (%L, %L, %L, '{}', 'replace', %L)$sql$, current_setting('test.tenant_id'), pg_temp.po_job(20, 2),
    pg_temp.po_version(20), pg_temp.po_id(1)), '42501', null, 'no member writes a decision directly');
reset role;
select pg_temp.po_as(3);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_page_decisions), 0, 'another tenant reads no decision');
select is(pg_temp.po_decide(pg_temp.po_job(20, 2), '[]'::jsonb), '42501 TAKEOFF_APPLY_OPERATOR_REQUIRED',
  'another tenant records no decision');
reset role;
select ok(has_function_privilege('authenticated', 'public.record_takeoff_page_decisions(uuid,jsonb)', 'execute'),
  'members record their decisions through the RPC');
select ok(not has_function_privilege('authenticated', 'private.assert_takeoff_pages_once(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.takeoff_replace_pages(uuid,uuid,uuid,jsonb,uuid[])', 'execute')
    and not has_function_privilege('authenticated', 'private.takeoff_prepare_page_decisions(uuid,uuid,uuid,text,jsonb)', 'execute'),
  'the guard and the replacement run inside the application only');

select * from finish();
rollback;
