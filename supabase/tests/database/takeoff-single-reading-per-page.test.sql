-- TI-682 lot B (D11; migration …_takeoff_hypothesis_preselection.sql): the vector reading and the vision reading of
-- one page are never counted together in the estimate. Since TI-681 the application refuses two alternative readings
-- the worker paired (metadata.quantity_source.group). A vector line the worker did not pair has no group: included by
-- hand beside the vision lines of its page, it passed. private.assert_takeoff_single_quantity_source now also reasons
-- by page (file, page, source document) for such a line: nothing proves what it overlaps. Only a vision line whose
-- unit proves another quantity stays beside it: a count, or the other measure of a run or a room.
-- Isolation justified: the guard runs inside the application's transaction, behind the route; the cases below differ
-- only by stored page identities and units no journey can seed one by one. TKQ02 and TKQ03 cover the refusal through
-- the route.
-- Written before the migration (red on 53a90872): every case refused below but « paired » is applied; the paired case
-- is refused there without saying which reasoning refused. Guards (green before): every single-reading case passes.
-- All values are fictional.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values ('00000000-0000-0000-0000-000000000000', 'b6821000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'single-reading@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'admin'::public.tenant_role
where user_id = 'b6821000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = 'b6821000-0000-4000-8000-000000000001' limit 1), true);

insert into public.estimate_projects (id, tenant_id, user_id, name)
values ('b6821000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  'b6821000-0000-4000-8000-000000000001', 'Une lecture par page (fictif)');
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values ('b6821000-0000-4000-8000-000000000101', current_setting('test.tenant_id')::uuid,
  'b6821000-0000-4000-8000-000000000010', 1, 2, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 0, 0, 0);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
values ('b6821000-0000-4000-8000-000000000111', current_setting('test.tenant_id')::uuid,
  'b6821000-0000-4000-8000-000000000101', 'section', 1, 'Lot fictif');

-- One level C job per case. reading: vector (metadata.vector) or model; pair: the group the worker's selection wrote.
create temporary table page_cases (
  case_name text not null, rank integer not null, reading text not null, designation text not null, quantity numeric not null,
  unit text not null, file_name text, page integer, document text, pair text, excluded boolean not null,
  primary key (case_name, rank)
) on commit drop;
insert into page_cases values
  -- The bypass: an unpaired vector line included by hand beside the vision line of its page.
  ('bypass', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('bypass', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  -- One reading per page: the vision line left out, or the vector line left out as it arrived.
  ('vector only', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('vector only', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, true),
  ('vision only', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, true),
  ('vision only', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  -- Another page, another document of the same name, another file: nothing in common.
  ('other page', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('other page', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 2, 'doc-a', null, false),
  ('other document', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('other document', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 1, 'doc-b', null, false),
  ('other file', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, null, null, false),
  ('other file', 2, 'model', 'Réseau eau froide', 23, 'ml', 'autre-plan-fictif.pdf', 1, null, null, false),
  -- Nothing proves a different page: the error falls on the side of a refusal.
  ('no source document', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('no source document', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 1, null, null, false),
  ('no page', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('no page', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', null, 'doc-a', null, false),
  ('null source document', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('null source document', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 1, 'json-null', null, false),
  -- The same kind of measure, whatever its unit is written: metres beside linear metres, a surface beside a surface.
  ('metres', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('metres', 2, 'model', 'Réseau eau froide', 23, 'm', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('surfaces', 1, 'vector', 'Surface « Local fictif »', 14, 'm2', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('surfaces', 2, 'model', 'Sol du local', 13.8, 'm²', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  -- A unit the referential does not know says nothing of what the line measures.
  ('unknown unit', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('unknown unit', 2, 'model', 'Réseau eau froide', 23, 'métrage', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  -- A lump sum or a mass does not say what it covers; an insulation is read in metres or in square metres.
  ('lump sum', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('lump sum', 2, 'model', 'Réseau eau froide', 1, 'forfait', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('mass', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('mass', 2, 'model', 'Tube acier', 120, 'kg', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('insulation', 1, 'vector', 'EF calorifuge DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('insulation', 2, 'model', 'Calorifuge eau froide', 6.5, 'm2', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  -- A vector line whose page was lost may be on the vision line's page.
  ('no vector page', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', null, 'doc-a', null, false),
  ('no vector page', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 3, 'doc-a', null, false),
  -- What proves another quantity: a count beside a measure, a length beside a room, a surface beside a run.
  ('count beside', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('count beside', 2, 'model', 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('count beside', 3, 'model', 'Vanne', 3, 'U', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('length beside room', 1, 'vector', 'Surface « Local fictif »', 14, 'm2', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('length beside room', 2, 'model', 'Réseau eau froide', 23, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('surface beside run', 1, 'vector', 'EF DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  ('surface beside run', 2, 'model', 'Sol du local', 13.8, 'm2', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  -- What the worker's selection leaves (TI-681): the paired vision line excluded, a count of the page still included.
  ('selected', 1, 'vector', 'EF cuivre DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', 'pair-1', false),
  ('selected', 2, 'model', 'EF cuivre DN 20', 23, 'ml', 'plan-fictif.pdf', 1, 'doc-a', 'pair-1', true),
  ('selected', 3, 'model', 'WC suspendu', 4, 'u', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  -- …and a length of another identity it did not pair with its measure: the selection's own result still passes.
  ('selected with another length', 1, 'vector', 'EF cuivre DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', 'pair-1', false),
  ('selected with another length', 2, 'model', 'EF cuivre DN 20', 23, 'ml', 'plan-fictif.pdf', 1, 'doc-a', 'pair-1', true),
  ('selected with another length', 3, 'model', 'EU PVC DN 100', 30, 'ml', 'plan-fictif.pdf', 1, 'doc-a', null, false),
  -- The paired case (TI-681): both readings of one pair included.
  ('paired', 1, 'vector', 'EF cuivre DN 20', 21.07, 'ml', 'plan-fictif.pdf', 1, 'doc-a', 'pair-1', false),
  ('paired', 2, 'model', 'EF cuivre DN 20', 23, 'ml', 'plan-fictif.pdf', 1, 'doc-a', 'pair-1', false);

create temporary table page_jobs on commit drop as
select names.case_name, gen_random_uuid() as job_id
from (select distinct case_name from page_cases) names;
grant select on page_jobs to authenticated;

insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select job.job_id, current_setting('test.tenant_id')::uuid, 'b6821000-0000-4000-8000-000000000101', 'C', 'completed',
  'plan-fictif.pdf', 'b6821000-0000-4000-8000-000000000001'
from page_jobs job;

insert into public.takeoff_items (tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
  source_page, metadata, is_excluded, exclusion_reason, rule_results, created_at)
select current_setting('test.tenant_id')::uuid, job.job_id, line.designation, line.quantity, line.unit, 0.95,
  'Repère localisé', line.file_name, line.page,
  jsonb_strip_nulls(jsonb_build_object(
    'source_document', case when line.document is not null and line.document <> 'json-null'
      then jsonb_build_object('kind', 'plan_file', 'plan_file_id', line.document) end,
    'vector', case when line.reading = 'vector' then jsonb_build_object('schema_version', 1, 'kind',
      case when line.designation like '%calorifuge%' then 'insulation' when line.unit = 'm2' then 'surface' else 'network' end) end,
    'quantity_source', case
      when line.reading = 'vector' then jsonb_build_object('version', 1, 'origin', 'vector', 'group', line.pair)
      when line.pair is not null then jsonb_build_object('version', 1, 'origin', 'model', 'group', line.pair) end))
    -- A source document stored as a JSON null is no proof either.
    || case when line.document = 'json-null' then '{"source_document": null}'::jsonb else '{}'::jsonb end,
  line.excluded, case when line.excluded then 'Lecture non retenue (fictif).' end, '[]'::jsonb,
  now() + line.rank * interval '1 second'
from page_cases line
join page_jobs job on job.case_name = line.case_name;

-- The guard itself, as the application calls it --------------------------------------------------------------------

create or replace function pg_temp.page_guard(p_case text)
returns text
language plpgsql
as $$
declare
  failure_detail text;
begin
  perform private.assert_takeoff_single_quantity_source((select job_id from page_jobs where case_name = p_case));
  return 'ok';
exception when others then
  get stacked diagnostics failure_detail = pg_exception_detail;
  return sqlstate || ' ' || sqlerrm || ' ' || coalesce(nullif(failure_detail, ''), '{}');
end;
$$;

select is(pg_temp.page_guard('bypass'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'an unpaired vector line included beside the vision line of its page is refused, the page named');
select is(pg_temp.page_guard('no source document'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'a vision line without its source document is on the same page, for want of a proof');
select is(pg_temp.page_guard('no page'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'a vision line without a page may be on the vector line''s page');
select is(pg_temp.page_guard('null source document'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'a source document stored as null is no proof of another page');
select is(pg_temp.page_guard('metres'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'metres and linear metres are one kind of measure');
select is(pg_temp.page_guard('surfaces'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "area", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'a measured room beside a surface read on its page is refused');
select is(pg_temp.page_guard('unknown unit'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'a vision line whose unit says nothing may measure the same length');
select is(pg_temp.page_guard('lump sum'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'a lump sum does not say what it covers');
select is(pg_temp.page_guard('mass'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'a mass may be the measured run');
select is(pg_temp.page_guard('insulation'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": 1, "source_file_name": "plan-fictif.pdf"}',
  'a measured insulation beside its surface read on the page is refused');
select is(pg_temp.page_guard('no vector page'),
  '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "page", "dimension": "length", "source_page": null, "source_file_name": "plan-fictif.pdf"}',
  'a vector line without a page may be on the vision line''s page');
select is(pg_temp.page_guard('paired'), '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT {"scope": "group"}',
  'two readings the worker paired stay refused (TI-681)');
select is(pg_temp.page_guard('vector only'), 'ok', 'the vector reading alone on its page passes');
select is(pg_temp.page_guard('vision only'), 'ok', 'the vision reading alone on its page passes');
select is(pg_temp.page_guard('other page'), 'ok', 'two readings of two pages pass');
select is(pg_temp.page_guard('other document'), 'ok', 'two documents of the same name are two pages');
select is(pg_temp.page_guard('other file'), 'ok', 'two files are two pages');
select is(pg_temp.page_guard('count beside'), 'ok', 'the counts of the page stay beside the measured length');
select is(pg_temp.page_guard('length beside room'), 'ok', 'a length read on the page stays beside a measured room');
select is(pg_temp.page_guard('surface beside run'), 'ok', 'a surface read on the page stays beside a measured run');
select is(pg_temp.page_guard('selected with another length'), 'ok',
  'the worker''s selection passes beside a length of another identity it did not pair');
select is(pg_temp.page_guard('selected'), 'ok',
  'the worker''s selection passes: its vector line beside a count of the page it did not pair');

-- Through the application, as its signed-in operator ---------------------------------------------------------------

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
values ('b6821000-0000-4000-8000-000000000101', 'b6821000-0000-4000-8000-000000000001',
  current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes', gen_random_uuid());

create or replace function pg_temp.page_apply(p_case text)
returns text
language plpgsql
as $$
declare
  target uuid := (select job_id from page_jobs where case_name = p_case);
  result_row record;
begin
  select * into result_row from public.apply_takeoff_job_guarded_atomic(target, 'append',
    'b6821000-0000-4000-8000-000000000111',
    (select coalesce(jsonb_agg(jsonb_build_object('item_id', item.id, 'source_order', item.source_order, 'rule_id', null,
        'action', case when item.is_excluded then 'none' else 'set_price' end, 'designation', btrim(item.designation),
        'unit_price_cents', case when item.is_excluded then null else 1000 end, 'category_id', null,
        'assembly_id', null) order by item.source_order), '[]'::jsonb)
      from (select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
        from public.takeoff_items ti where ti.job_id = target) as item));
  return 'ok ' || result_row.created_count;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

grant execute on function pg_temp.page_apply(text) to authenticated;

select set_config('request.jwt.claim.sub', 'b6821000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'b6821000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

set local role authenticated;
select is(pg_temp.page_apply('bypass'), '23514 TAKEOFF_ALTERNATIVE_SOURCES_CONFLICT',
  'the application refuses both readings of one page');
select is(pg_temp.page_apply('vector only'), 'ok 1', 'the application takes the single reading of the page');
reset role;

select is((select job.status::text from public.takeoff_jobs job
    where job.id = (select job_id from page_jobs where case_name = 'bypass')), 'completed',
  'a refused application leaves its job to review');
select is((select jsonb_agg(jsonb_build_array(item.title, item.quantity) order by item.title)
    from public.estimate_items item
    where item.version_id = 'b6821000-0000-4000-8000-000000000101' and item.item_type = 'line'),
  '[["EF DN 20", 22]]'::jsonb, 'the estimate counts the page once, the length rounded up to the metre');

select * from finish();
rollback;
