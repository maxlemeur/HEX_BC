-- TI-682 lot D4 (migration …_takeoff_dpgf_accumulation.sql): a DPGF target sums the measures it keeps. Its composition
-- (takeoff_quantity_policy version 2) lists what each takeoff line still brings to it; the application adds the new
-- takeoff's lines, takes out the earlier lines of the pages it replaces, and writes max(DPGF reference, sum), a length
-- rounded once on the sum.
-- Isolation justified: the sum is written inside the application's transaction, under the version's lock, from stored
-- compositions, page decisions and a service permit no journey can seed case by case; TKD03 and TKD04 cover the gesture.
-- Written before the migration (red on 32b078dd): the second takeoff overwrote the target (the last one won), keeping
-- both was refused (dpgf_keep_both), replacing a page whose DPGF line the relaunch does not feed was refused
-- (dpgf_not_replaced), and a version 1 policy was overwritten without being read.
-- One draft per case (engine 3), section ...<case>002, DPGF target ...<case>003 (a second one ...<case>004 in case 5),
-- takeoffs M1 ...<case>011, M2 ...<case>012, M3 ...<case>013; their lines ...<case><job>nn. All values are fictional.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

create or replace function pg_temp.da_id(p_number integer)
returns uuid language sql immutable as $$ select ('d4000000-0000-4000-8000-' || lpad(p_number::text, 12, '0'))::uuid $$;
grant execute on function pg_temp.da_id(integer) to authenticated;

-- Fixtures ---------------------------------------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', pg_temp.da_id(1), 'authenticated', 'authenticated',
  'dpgf-accumulation-1@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'admin'::public.tenant_role where user_id = pg_temp.da_id(1);
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = pg_temp.da_id(1) limit 1), true);
select set_config('test.plan', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

create or replace function pg_temp.da_as()
returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.da_id(1)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.da_id(1), 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.da_as() to authenticated;

insert into public.estimate_projects (id, tenant_id, user_id, name)
values (pg_temp.da_id(10), current_setting('test.tenant_id')::uuid, pg_temp.da_id(1), 'Cumul DPGF (fictif)');

-- Each case: its DPGF target (title, unit, DPGF reference).
create temporary table da_cases (case_no integer primary key, title text not null, unit text not null, reference numeric not null)
  on commit drop;
insert into da_cases values
  -- 1: two takeoffs of two pages feed one target.
  (1, 'EF cuivre DN 22', 'ml', 20),
  -- 2: the relaunch replaces page 1 of a target fed from pages 1 and 2.
  (2, 'EF cuivre DN 22', 'ml', 10),
  -- 3: both kept on a page whose new lines feed the target again.
  (3, 'EF cuivre DN 22', 'ml', 20),
  -- 4: page 1 replaced by a relaunch that no longer feeds the target.
  (4, 'EF cuivre DN 22', 'ml', 5),
  -- 5: a target of a version 1 policy (applied before D4) fed again from another page; a second target untouched.
  (5, 'EF cuivre DN 22', 'ml', 20),
  -- 6: two contributions of a length, rounded once on their sum.
  (6, 'EF cuivre DN 22', 'ml', 5),
  -- 9: a version no longer a draft.
  (9, 'EF cuivre DN 22', 'ml', 5),
  -- 10: a count, two takeoffs of two pages.
  (10, 'WC suspendu', 'u', 4),
  -- 11: two applications on one target, one after the other.
  (11, 'EF cuivre DN 22', 'ml', 1),
  -- 12: a version 1 policy that cannot be split, one of its pages replaced.
  (12, 'EF cuivre DN 22', 'ml', 10),
  -- 13 and 14: a version 1 policy read through a forged composition, or none.
  (13, 'EF cuivre DN 22', 'ml', 20), (14, 'EF cuivre DN 22', 'ml', 20),
  -- 15: an hypothesis of the first takeoff, a measure of the second: the target still rests on the hypothesis.
  (15, 'EF cuivre DN 22', 'ml', 5),
  -- 16: the page of the hypothesis replaced by a relaunch that no longer feeds the target: nothing of it remains.
  (16, 'EF cuivre DN 22', 'ml', 5),
  -- 17: an hypothesis in each takeoff.
  (17, 'EF cuivre DN 22', 'ml', 5),
  -- 18: a replaced page whose relaunch writes a line of the target's title onto it, outside the reconciliation.
  (18, 'EF cuivre DN 22', 'ml', 5),
  -- 19: the relaunch's only line on page 1 excluded at the review, its line on page 2 feeding the target.
  (19, 'WC suspendu', 'u', 20),
  -- 20: a version 1 policy that cannot be split, both its pages replaced.
  (20, 'EF cuivre DN 22', 'ml', 10);
grant select on da_cases to authenticated;

insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
select pg_temp.da_id(c.case_no * 1000 + 1), current_setting('test.tenant_id')::uuid, pg_temp.da_id(10), c.case_no,
  3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0
from da_cases c;

do $sections$
declare
  c record;
begin
  for c in select * from da_cases loop
    perform set_config('miaouffrage.estimate_v3_writer', pg_temp.da_id(c.case_no * 1000 + 1)::text, true);
    insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
    values (pg_temp.da_id(c.case_no * 1000 + 2), current_setting('test.tenant_id')::uuid, pg_temp.da_id(c.case_no * 1000 + 1),
      'section', 1, 'Lot fictif');
    insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description,
      quantity, unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents,
      line_tax_cents, line_total_ttc_cents, source_provider, source_file_name, source_page, source_metadata, fo_provision)
    values (pg_temp.da_id(c.case_no * 1000 + 3), current_setting('test.tenant_id')::uuid, pg_temp.da_id(c.case_no * 1000 + 1),
      pg_temp.da_id(c.case_no * 1000 + 2), 'line', 1, c.title, c.unit, c.reference, c.unit, 1000, 2000, 1, 0, 1, 1000,
      (c.reference * 1000)::bigint, (c.reference * 200)::bigint, (c.reference * 1200)::bigint, 'dpgf', 'dpgf-fictif.xlsx', 7,
      jsonb_build_object('dpgf_source_quantity', c.reference, 'dpgf_source_unit', c.unit), 1);
    if c.case_no = 5 then
      insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description,
        quantity, unit_code, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents,
        line_tax_cents, line_total_ttc_cents, source_provider, source_file_name, source_page, source_metadata, fo_provision)
      values (pg_temp.da_id(5004), current_setting('test.tenant_id')::uuid, pg_temp.da_id(5001), pg_temp.da_id(5002), 'line', 2,
        'Calorifuge DN 22', 'ml', 8, 'ml', 500, 2000, 1, 0, 1, 500, 4000, 800, 4800, 'dpgf', 'dpgf-fictif.xlsx', 8,
        '{"dpgf_source_quantity":8,"dpgf_source_unit":"ml"}', 1);
    end if;
    perform public.estimate_v3_complete_entry_for_writer(pg_temp.da_id(c.case_no * 1000 + 1), '{}'::uuid[]);
    perform set_config('miaouffrage.estimate_v3_writer', '', true);
  end loop;
end;
$sections$;

insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select pg_temp.da_id(c.case_no * 1000 + 10 + job_no), current_setting('test.tenant_id')::uuid,
  pg_temp.da_id(c.case_no * 1000 + 1), 'B', 'completed', 'plan-fictif.pdf', pg_temp.da_id(1)
from da_cases c cross join generate_series(1, case when c.case_no = 11 then 3 else 2 end) as job_no;

-- Lines: case, job, line, designation, quantity, unit, page.
create temporary table da_items (
  case_no integer not null, job_no integer not null, line_no integer not null, designation text not null,
  quantity numeric not null, unit text not null, page integer not null, primary key (case_no, job_no, line_no)
) on commit drop;
insert into da_items values
  (1, 1, 1, 'EF cuivre DN 22', 12.4, 'ml', 1), (1, 2, 1, 'EF cuivre DN 22', 10.2, 'ml', 2),
  (2, 1, 1, 'EF cuivre DN 22', 10.2, 'ml', 1), (2, 1, 2, 'EF cuivre DN 22', 5.3, 'ml', 2), (2, 2, 1, 'EF cuivre DN 22', 8.1, 'ml', 1),
  (3, 1, 1, 'EF cuivre DN 22', 12.4, 'ml', 1), (3, 2, 1, 'EF cuivre DN 22', 12.6, 'ml', 1),
  (4, 1, 1, 'EF cuivre DN 22', 10, 'ml', 1), (4, 1, 2, 'EF cuivre DN 22', 6, 'ml', 2), (4, 2, 1, 'Vanne d''arrêt', 3, 'u', 1),
  (5, 1, 1, 'EF cuivre DN 22', 12.4, 'ml', 1), (5, 1, 2, 'Calorifuge DN 22', 7, 'ml', 1), (5, 2, 1, 'EF cuivre DN 22', 10.2, 'ml', 2),
  (6, 1, 1, 'EF cuivre DN 22', 10.004, 'ml', 1), (6, 2, 1, 'EF cuivre DN 22', 10.004, 'ml', 2),
  (9, 1, 1, 'EF cuivre DN 22', 10, 'ml', 1), (9, 2, 1, 'EF cuivre DN 22', 4, 'ml', 2),
  (10, 1, 1, 'WC suspendu', 4, 'u', 1), (10, 2, 1, 'WC suspendu', 3, 'u', 2),
  (11, 1, 1, 'EF cuivre DN 22', 2, 'ml', 1), (11, 2, 1, 'EF cuivre DN 22', 3, 'ml', 2), (11, 3, 1, 'EF cuivre DN 22', 4, 'ml', 3),
  (12, 1, 1, 'EF cuivre DN 22', 10, 'ml', 1), (12, 1, 2, 'EF cuivre DN 22', 6, 'ml', 2), (12, 2, 1, 'EF cuivre DN 22', 8, 'ml', 1),
  (13, 1, 1, 'EF cuivre DN 22', 12.4, 'ml', 1), (13, 2, 1, 'EF cuivre DN 22', 10.2, 'ml', 2),
  (14, 1, 1, 'EF cuivre DN 22', 12.4, 'ml', 1), (14, 2, 1, 'EF cuivre DN 22', 10.2, 'ml', 2),
  (15, 1, 1, 'EF cuivre DN 22', 8, 'ml', 1), (15, 2, 1, 'EF cuivre DN 22', 4, 'ml', 2),
  (16, 1, 1, 'EF cuivre DN 22', 10, 'ml', 1), (16, 1, 2, 'EF cuivre DN 22', 6, 'ml', 2), (16, 2, 1, 'Vanne d''arrêt', 3, 'u', 1),
  (17, 1, 1, 'EF cuivre DN 22', 8, 'ml', 1), (17, 2, 1, 'EF cuivre DN 22', 4, 'ml', 2),
  (18, 1, 1, 'EF cuivre DN 22', 10, 'ml', 1), (18, 1, 2, 'EF cuivre DN 22', 6, 'ml', 2), (18, 2, 1, 'EF cuivre DN 22', 3, 'ml', 1),
  (19, 1, 1, 'WC suspendu', 12, 'u', 1), (19, 2, 1, 'Vanne d''arrêt', 2, 'u', 1), (19, 2, 2, 'WC suspendu', 10, 'u', 2),
  (20, 1, 1, 'EF cuivre DN 22', 10, 'ml', 1), (20, 1, 2, 'EF cuivre DN 22', 6, 'ml', 2),
  (20, 2, 1, 'EF cuivre DN 22', 8, 'ml', 1), (20, 2, 2, 'EF cuivre DN 22', 5, 'ml', 2);
-- The lines whose quantity is an hypothesis its author entered (the provision marker's sources).
create temporary table da_hypotheses (case_no integer, job_no integer, line_no integer, primary key (case_no, job_no, line_no))
  on commit drop;
insert into da_hypotheses values (15, 1, 1), (16, 1, 1), (17, 1, 1), (17, 2, 1);
-- The lines excluded at the review: they bring nothing, nor their page.
create temporary table da_excluded (case_no integer, job_no integer, line_no integer, primary key (case_no, job_no, line_no))
  on commit drop;
insert into da_excluded values (19, 2, 1);

create or replace function pg_temp.da_item(p_case integer, p_job integer, p_line integer)
returns uuid language sql immutable as $$ select pg_temp.da_id(p_case * 1000 + p_job * 100 + p_line) $$;
grant execute on function pg_temp.da_item(integer, integer, integer) to authenticated;
create or replace function pg_temp.da_job(p_case integer, p_job integer)
returns uuid language sql immutable as $$ select pg_temp.da_id(p_case * 1000 + 10 + p_job) $$;
grant execute on function pg_temp.da_job(integer, integer) to authenticated;
create or replace function pg_temp.da_version(p_case integer)
returns uuid language sql immutable as $$ select pg_temp.da_id(p_case * 1000 + 1) $$;
grant execute on function pg_temp.da_version(integer) to authenticated;
create or replace function pg_temp.da_target(p_case integer)
returns public.estimate_items language sql security definer as $$
  select item from public.estimate_items item where item.id = pg_temp.da_id(p_case * 1000 + 3)
$$;
grant execute on function pg_temp.da_target(integer) to authenticated;

create or replace function pg_temp.da_seed(p_case integer, p_job integer)
returns void language sql as $$
  insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
    source_page, metadata, rule_results, created_at)
  select pg_temp.da_item(item.case_no, item.job_no, item.line_no), current_setting('test.tenant_id')::uuid,
    pg_temp.da_job(item.case_no, item.job_no), item.designation, item.quantity, item.unit, 0.95, 'Repère localisé',
    'plan-fictif.pdf', item.page,
    jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', current_setting('test.plan'))),
    '[]'::jsonb, now() + item.line_no * interval '1 second'
  from da_items item where item.case_no = p_case and item.job_no = p_job;
  update public.takeoff_items item set quantity_entered_by = pg_temp.da_id(1), quantity_entered_at = now(),
    quantity_entry_category = 'hypothesis', quantity_entry_note = 'Quantité supposée, à confirmer au relevé (fictif).'
  from da_hypotheses hypothesis
  where hypothesis.case_no = p_case and hypothesis.job_no = p_job
    and item.id = pg_temp.da_item(hypothesis.case_no, hypothesis.job_no, hypothesis.line_no);
  update public.takeoff_items item set is_excluded = true, exclusion_reason = 'Écartée à la revue (fictif).'
  from da_excluded excluded
  where excluded.case_no = p_case and excluded.job_no = p_job
    and item.id = pg_temp.da_item(excluded.case_no, excluded.job_no, excluded.line_no);
$$;

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version.id, pg_temp.da_id(1), version.tenant_id, statement_timestamp() + interval '30 minutes', gen_random_uuid()
from public.estimate_versions version where version.project_id = pg_temp.da_id(10);

-- Helpers ------------------------------------------------------------------------------------------------------------

create temporary table da_outcome (case_name text primary key, state text, message text, detail jsonb) on commit drop;
grant all on da_outcome to authenticated;

create or replace function pg_temp.da_plan(p_job uuid)
returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', item.id, 'source_order', item.source_order, 'rule_id', null,
    'action', 'none', 'designation', btrim(item.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null)
    order by item.source_order), '[]'::jsonb)
  from (select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
    from public.takeoff_items ti where ti.job_id = p_job) as item
$$;
grant execute on function pg_temp.da_plan(uuid) to authenticated;

-- The application as the signed-in user, through the real 5-argument overload (« Fusionner », required with a DPGF).
create or replace function pg_temp.da_apply(p_case_name text, p_case integer, p_job integer, p_token text)
returns text language plpgsql as $$
declare
  failure_detail text;
  result_row record;
begin
  perform set_config('app.takeoff_apply_atomic', '', true);
  perform set_config('app.takeoff_apply_job', '', true);
  begin
    select * into result_row from public.apply_takeoff_job_guarded_atomic(pg_temp.da_job(p_case, p_job), 'merge',
      pg_temp.da_id(p_case * 1000 + 2), pg_temp.da_plan(pg_temp.da_job(p_case, p_job)), p_token);
    insert into da_outcome values (p_case_name, 'ok', null, null);
  exception when others then
    get stacked diagnostics failure_detail = pg_exception_detail;
    insert into da_outcome values (p_case_name, sqlstate, sqlerrm,
      case when failure_detail ~ '^\s*\{' then failure_detail::jsonb end);
  end;
  return (select case when state = 'ok' then 'ok' else state || ' ' || message end from da_outcome where case_name = p_case_name);
end;
$$;
grant execute on function pg_temp.da_apply(text, integer, integer, text) to authenticated;

create or replace function pg_temp.da_decide(p_case integer, p_decision text, p_reason text, p_earlier integer[])
returns text language plpgsql as $$
declare
  failure_detail text;
begin
  return 'ok ' || public.record_takeoff_page_decisions(pg_temp.da_job(p_case, 2), jsonb_build_array(jsonb_build_object(
    'document', jsonb_build_object('plan_file_id', current_setting('test.plan'), 'content_hash', null, 'logical_document_id', null,
      'file_name', 'plan-fictif.pdf'), 'source_page', 1, 'earlier_job_ids', jsonb_build_array(pg_temp.da_job(p_case, 1)),
    'decision', p_decision, 'reason_code', p_reason, 'note', null,
    'lines', jsonb_build_array(jsonb_build_object('estimate_item_id', (pg_temp.da_target(p_case)).id,
      'expected_updated_at', (pg_temp.da_target(p_case)).updated_at, 'action', 'keep', 'take', null,
      'item_ids', (select jsonb_agg(pg_temp.da_item(p_case, 1, line)) from unnest(p_earlier) as line))),
    'pairs', '[]'::jsonb)));
exception when others then
  get stacked diagnostics failure_detail = pg_exception_detail;
  return sqlstate || ' ' || sqlerrm
    || coalesce(' ' || (case when failure_detail ~ '^\s*\{' then failure_detail::jsonb ->> 'reason' end), '');
end;
$$;
grant execute on function pg_temp.da_decide(integer, text, text, integer[]) to authenticated;

-- The service permit: the target the job's lines of its title feed, with what each line brings (no printed surface
-- here), and the compositions the service read for version 1 policies (p_compositions). As the service builds it
-- (buildDpgfApplyQuantityPolicy), the target's source_metadata is the one it holds, its DPGF reference restated.
create or replace function pg_temp.da_permit(p_case integer, p_job integer, p_token text, p_compositions jsonb default null)
returns void language sql as $$
  insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash,
    review_summary, expires_at)
  select current_setting('test.tenant_id')::uuid, pg_temp.da_job(p_case, p_job), pg_temp.da_version(p_case), pg_temp.da_id(1),
    encode(sha256(convert_to(p_token, 'UTF8')), 'hex'),
    jsonb_build_object('quantity_policy', coalesce((select jsonb_agg(jsonb_build_object(
      'target_id', target.id, 'expected_updated_at', target.updated_at,
      'reference_quantity', c.reference, 'measured_quantity', fed.total, 'priced_quantity', greatest(c.reference, fed.total),
      'absolute_gap', abs(fed.total - c.reference), 'reviewed', false,
      'source_file_name', 'dpgf-fictif.xlsx', 'source_page', 7,
      'source_metadata', coalesce(target.source_metadata, '{}'::jsonb)
        || jsonb_build_object('dpgf_source_quantity', c.reference, 'dpgf_source_unit', c.unit),
      'takeoff_items', fed.items))
      from da_cases c
      join public.estimate_items target on target.id = pg_temp.da_id(p_case * 1000 + 3)
      cross join lateral (select sum(ti.quantity) as total, jsonb_agg(jsonb_build_object('id', ti.id, 'quantity', ti.quantity,
          'updated_at', ti.updated_at, 'measured', ti.quantity, 'protective', 0, 'printed_gap', 0) order by ti.id) as items
        from public.takeoff_items ti where ti.job_id = pg_temp.da_job(p_case, p_job) and ti.designation = c.title) as fed
      where c.case_no = p_case and fed.total is not null), '[]'::jsonb))
    || case when p_compositions is null then '{}'::jsonb else jsonb_build_object('dpgf_compositions', p_compositions) end,
    now() + interval '5 minutes'
$$;

-- What a version 1 policy holds, as the application wrote it before D4 (one takeoff, its lines, its measure).
create or replace function pg_temp.da_version_one(p_case integer, p_lines integer[], p_measured numeric, p_priced numeric)
returns void language plpgsql as $$
begin
  perform set_config('miaouffrage.estimate_v3_writer', pg_temp.da_version(p_case)::text, true);
  update public.estimate_items set source_metadata = jsonb_build_object('dpgf_source_quantity',
      (select reference from da_cases where case_no = p_case), 'dpgf_source_unit', 'ml',
      'takeoff_quantity_policy', jsonb_build_object('version', 1, 'job_id', pg_temp.da_job(p_case, 1), 'reference_quantity',
        (select reference from da_cases where case_no = p_case), 'measured_quantity', p_measured, 'priced_quantity', p_priced,
        'absolute_gap', 0, 'reviewed', false,
        'item_ids', (select jsonb_agg(pg_temp.da_item(p_case, 1, line) order by pg_temp.da_item(p_case, 1, line)) from unnest(p_lines) as line))),
    quantity = ceil(p_priced)
  where id = pg_temp.da_id(p_case * 1000 + 3);
  perform public.estimate_v3_complete_entry_for_writer(pg_temp.da_version(p_case), '{}'::uuid[]);
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
end;
$$;

/** The composition stored on a target: [job number, line number, quantity] per contribution line. */
create or replace function pg_temp.da_composition(p_case integer)
returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_array(
      (select job_no from generate_series(1, 3) job_no where pg_temp.da_job(p_case, job_no)::text = entry ->> 'job_id'),
      (select line from generate_series(1, 3) line, generate_series(1, 3) job_no
        where pg_temp.da_item(p_case, job_no, line)::text = entry #>> '{item_ids,0}'),
      (entry ->> 'quantity')::numeric) order by entry ->> 'job_id', entry #>> '{item_ids,0}'), '[]'::jsonb)
  from jsonb_array_elements((pg_temp.da_target(p_case)).source_metadata #> '{takeoff_quantity_policy,contributions}') as entry
$$;

-- Every first takeoff applies alone, feeding its target.
select pg_temp.da_seed(c.case_no, 1) from da_cases c;
select pg_temp.da_permit(c.case_no, 1, 'da-' || c.case_no || '-1') from da_cases c;
select pg_temp.da_as();
set local role authenticated;
select is(pg_temp.da_apply('M1 ' || c.case_no, c.case_no, 1, 'da-' || c.case_no || '-1'), 'ok',
  'fixture: the first takeoff of case ' || c.case_no || ' feeds its DPGF target') from da_cases c;
reset role;
select pg_temp.da_seed(c.case_no, 2) from da_cases c;

-- 1. Two takeoffs of two pages: the target sums both. -------------------------------------------------------------------
select pg_temp.da_permit(1, 2, 'da-1-2');
set local role authenticated;
select is(pg_temp.da_apply('two pages', 1, 2, 'da-1-2'), 'ok', 'a second takeoff of another page feeds the same target');
reset role;
select is((pg_temp.da_target(1)).quantity, 23::numeric,
  'the target holds max(20, 12.4 + 10.2) rounded up once: the second takeoff no longer overwrites the first');
select is(pg_temp.da_composition(1), '[[1, 1, 12.4], [2, 1, 10.2]]'::jsonb, 'its composition names both takeoffs, line by line');
select is((pg_temp.da_target(1)).source_metadata #>> '{takeoff_quantity_policy,version}', '2', 'stored as a version 2 policy');
-- 8. D2 reads every takeoff of the target: both pages are in the estimate.
select is((select array_agg(id order by id) from unnest(private.takeoff_estimate_line_item_ids((pg_temp.da_target(1)).source_metadata,
    (pg_temp.da_target(1)).source_job_id)) as id), array[pg_temp.da_item(1, 1, 1), pg_temp.da_item(1, 2, 1)],
  'the lines a target holds are those of both takeoffs (a relaunch of either page meets it)');

-- 2. Replacing page 1 keeps page 2's part. ------------------------------------------------------------------------------
select pg_temp.da_permit(2, 2, 'da-2-2');
set local role authenticated;
select is(pg_temp.da_decide(2, 'replace', null, array[1]), 'ok 1', 'fixture: page 1 replaced');
select is(pg_temp.da_apply('replace page 1', 2, 2, 'da-2-2'), 'ok', 'the relaunch of page 1 applies');
reset role;
select is((pg_temp.da_target(2)).quantity, 14::numeric,
  'the target holds max(10, 5.3 kept from page 2 + 8.1 of the relaunch) rounded up: page 2 is not lost');
select is(pg_temp.da_composition(2), '[[1, 2, 5.3], [2, 1, 8.1]]'::jsonb, 'page 1''s earlier line is out, page 2''s stays');

-- 3. Both kept: both count. ------------------------------------------------------------------------------------------------
select pg_temp.da_permit(3, 2, 'da-3-2');
set local role authenticated;
select is(pg_temp.da_decide(3, 'keep_both', 'other_zone', array[1]), 'ok 1', 'fixture: both kept');
select is(pg_temp.da_apply('keep both', 3, 2, 'da-3-2'), 'ok',
  'keeping both on a page whose new lines feed the target again is accepted: the target holds both');
reset role;
select is((pg_temp.da_target(3)).quantity, 25::numeric, 'the target holds 12.4 + 12.6');
select is(pg_temp.da_composition(3), '[[1, 1, 12.4], [2, 1, 12.6]]'::jsonb, 'its composition holds both measures of the page');

-- 4. Replacing a page the relaunch no longer feeds the target from. -----------------------------------------------------
select pg_temp.da_permit(4, 2, 'da-4-2');
set local role authenticated;
select is(pg_temp.da_decide(4, 'replace', null, array[1]), 'ok 1', 'fixture: page 1 replaced by a relaunch feeding nothing');
select is(pg_temp.da_apply('replace not fed', 4, 2, 'da-4-2'), 'ok',
  'replacing page 1 is accepted though the relaunch does not feed the target: page 1''s part leaves it');
reset role;
select is((pg_temp.da_target(4)).quantity, 6::numeric, 'the target falls to max(5, 6 kept from page 2)');
select is(pg_temp.da_composition(4), '[[1, 2, 6]]'::jsonb, 'only page 2''s part stays');
select is((select count(*)::integer from public.estimate_items where version_id = pg_temp.da_version(4) and title = 'Vanne d''arrêt'),
  1, 'the page''s new measure entered outside the DPGF line');

-- 5. A version 1 policy read as a composition, the other targets untouched. -------------------------------------------
select pg_temp.da_version_one(5, array[1], 12.4, 20);
create temporary table da_untouched on commit drop as
select item.id, item.quantity, item.updated_at, item.source_metadata from public.estimate_items item where item.id = pg_temp.da_id(5004);
select pg_temp.da_permit(5, 2, 'da-5-2', jsonb_build_array(jsonb_build_object('target_id', (pg_temp.da_target(5)).id,
  'expected_updated_at', (pg_temp.da_target(5)).updated_at, 'job_id', pg_temp.da_job(5, 1),
  'item_ids', jsonb_build_array(pg_temp.da_item(5, 1, 1)),
  'contributions', jsonb_build_array(jsonb_build_object('job_id', pg_temp.da_job(5, 1), 'item_ids', jsonb_build_array(pg_temp.da_item(5, 1, 1)),
    'quantity', 12.4, 'protective', 0, 'printed_gap', 0)))));
set local role authenticated;
select is(pg_temp.da_apply('version one', 5, 2, 'da-5-2'), 'ok', 'a target of a version 1 policy is fed again');
reset role;
select is((pg_temp.da_target(5)).quantity, 23::numeric, 'it sums the takeoff of its version 1 policy and the new one');
select is(pg_temp.da_composition(5), '[[1, 1, 12.4], [2, 1, 10.2]]'::jsonb, 'its version 1 takeoff is now one line of its composition');
select is((select jsonb_build_array(item.quantity, item.updated_at = before.updated_at, item.source_metadata = before.source_metadata)
    from public.estimate_items item join da_untouched before on before.id = item.id),
  jsonb_build_array((select quantity from da_untouched), true, true), 'a target the application does not touch is not rewritten');

-- 6. A length is rounded once, on the sum. -----------------------------------------------------------------------------
select pg_temp.da_permit(6, 2, 'da-6-2');
set local role authenticated;
select is(pg_temp.da_apply('rounding', 6, 2, 'da-6-2'), 'ok', 'two contributions of a length');
reset role;
select is((pg_temp.da_target(6)).quantity, 21::numeric, '10.004 + 10.004 = 20.008 is rounded up once to 21, never 11 + 11');

-- 9. A version that is no longer a draft is never written. ----------------------------------------------------------------
select pg_temp.da_permit(9, 2, 'da-9-2');
-- The emission's workflow is not what is tested here: its triggers are set aside for this fixture only.
set local session_replication_role = replica;
update public.estimate_versions set status = 'sent' where id = pg_temp.da_version(9);
set local session_replication_role = origin;
set local role authenticated;
select is(pg_temp.da_apply('not draft', 9, 2, 'da-9-2'), 'P0001 TAKEOFF_TARGET_VERSION_DRAFT_REQUIRED',
  'a version sent is never written: its target keeps what it holds');
reset role;
select is((pg_temp.da_target(9)).quantity, 10::numeric, 'the sent version''s target is unchanged');

-- 10. A count sums the same way. ------------------------------------------------------------------------------------------
select pg_temp.da_permit(10, 2, 'da-10-2');
set local role authenticated;
select is(pg_temp.da_apply('count', 10, 2, 'da-10-2'), 'ok', 'a second takeoff of a count');
reset role;
select is((pg_temp.da_target(10)).quantity, 7::numeric, 'a count holds 4 + 3 (no length rounding)');
select is(pg_temp.da_composition(10), '[[1, 1, 4], [2, 1, 3]]'::jsonb, 'a count''s composition names both takeoffs');

-- 11. Two applications on one target, one after the other: the second reads what the first wrote. Two applications at
-- the same time are takeoff-dpgf-accumulation-race.test.sql (the permit is bound to the target's updated_at).
select pg_temp.da_seed(11, 3);
select pg_temp.da_permit(11, 2, 'da-11-2');
set local role authenticated;
select is(pg_temp.da_apply('first of two', 11, 2, 'da-11-2'), 'ok', 'the first application');
reset role;
select pg_temp.da_permit(11, 3, 'da-11-3');
set local role authenticated;
select is(pg_temp.da_apply('second of two', 11, 3, 'da-11-3'), 'ok', 'the second application, its permit read after the first');
reset role;
select is((pg_temp.da_target(11)).quantity, 9::numeric, 'the target holds 2 + 3 + 4: no application lost another''s');
select is(pg_temp.da_composition(11), '[[1, 1, 2], [2, 1, 3], [3, 1, 4]]'::jsonb, 'its composition names the three takeoffs');

-- 12. A version 1 policy that could not be split is never cut by a page. --------------------------------------------------
select pg_temp.da_version_one(12, array[1, 2], 16, 16);
select pg_temp.da_permit(12, 2, 'da-12-2', jsonb_build_array(jsonb_build_object('target_id', (pg_temp.da_target(12)).id,
  'expected_updated_at', (pg_temp.da_target(12)).updated_at, 'job_id', pg_temp.da_job(12, 1),
  'item_ids', jsonb_build_array(pg_temp.da_item(12, 1, 1), pg_temp.da_item(12, 1, 2)),
  'contributions', jsonb_build_array(jsonb_build_object('job_id', pg_temp.da_job(12, 1),
    'item_ids', jsonb_build_array(pg_temp.da_item(12, 1, 1), pg_temp.da_item(12, 1, 2)), 'quantity', 16, 'protective', 0,
    'printed_gap', 0)))));
set local role authenticated;
select is(pg_temp.da_decide(12, 'replace', null, array[1]), 'ok 1', 'fixture: page 1 of an unsplit policy replaced');
select is(pg_temp.da_apply('block cut', 12, 2, 'da-12-2'), '22023 TAKEOFF_PAGE_DECISION_INVALID',
  'replacing one page of a takeoff whose part per page is unknown is refused, never all of it removed');
reset role;
select is((select detail ->> 'reason' from da_outcome where case_name = 'block cut'), 'dpgf_part_unknown', 'the refusal says why');
select is((pg_temp.da_target(12)).quantity, 16::numeric, 'the target keeps what it holds');

-- 7. The composition of a version 1 policy comes from the service, bound to what the target holds. ------------------------
select pg_temp.da_version_one(13, array[1], 12.4, 20);
select pg_temp.da_permit(13, 2, 'da-13-2', jsonb_build_array(jsonb_build_object('target_id', (pg_temp.da_target(13)).id,
  'expected_updated_at', (pg_temp.da_target(13)).updated_at, 'job_id', pg_temp.da_job(13, 1),
  'item_ids', jsonb_build_array(pg_temp.da_item(13, 2, 1)),
  'contributions', jsonb_build_array(jsonb_build_object('job_id', pg_temp.da_job(13, 1), 'item_ids', jsonb_build_array(pg_temp.da_item(13, 2, 1)),
    'quantity', 10.2, 'protective', 0, 'printed_gap', 0)))));
select pg_temp.da_version_one(14, array[1], 12.4, 20);
select pg_temp.da_permit(14, 2, 'da-14-2');
set local role authenticated;
select is(pg_temp.da_apply('forged composition', 13, 2, 'da-13-2'), '40001 TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE',
  'a composition that names other lines than the version 1 policy (here the new takeoff''s, counted twice) is refused');
select is(pg_temp.da_apply('no composition', 14, 2, 'da-14-2'), '40001 TAKEOFF_DPGF_QUANTITY_SNAPSHOT_STALE',
  'a version 1 policy is never overwritten unread: without its composition the application is refused');
reset role;
select is(jsonb_build_array((pg_temp.da_target(13)).quantity, (pg_temp.da_target(14)).quantity), '[20, 20]'::jsonb,
  'both targets keep what they hold');

-- Provisions. The marker (source_metadata.takeoff_provision, private.takeoff_mark_provisions) names the hypotheses a
-- line rests on, and the « quantité provisionnelle » an administrator declares on it stands only with that marker
-- (private.clear_estimate_item_offer_choice). A target that sums several takeoffs rests on the hypotheses of every line
-- it keeps: neither is lost when a measured takeoff accumulates onto it; both go when the page of the hypothesis leaves it.

/** The marker's sources on a target: [job number, line number] each. */
create or replace function pg_temp.da_marker(p_case integer)
returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_array(job_no, line) order by job_no, line), '[]'::jsonb)
  from jsonb_array_elements((pg_temp.da_target(p_case)).source_metadata #> '{takeoff_provision,sources}') as source(value)
  cross join generate_series(1, 3) as job_no cross join generate_series(1, 3) as line
  where pg_temp.da_item(p_case, job_no, line)::text = source.value ->> 'takeoff_item_id'
$$;
-- The « quantité provisionnelle » declared on a target, by the trusted writer of its v3 draft.
create or replace function pg_temp.da_declare(p_case integer)
returns text language plpgsql as $$
begin
  perform set_config('miaouffrage.estimate_v3_writer', pg_temp.da_version(p_case)::text, true);
  update public.estimate_items set offer_choice = jsonb_build_object('kind', 'provisional_quantity', 'basis', 'private_estimate',
    'note', null, 'established_on', 'le plan fictif indice A', 'to_confirm_by', 'le relevé contradictoire sur site',
    'decided_by', pg_temp.da_id(1), 'decided_at', '2026-11-12T09:00:00.123456+00:00')
  where id = pg_temp.da_id(p_case * 1000 + 3);
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
  return (pg_temp.da_target(p_case)).offer_choice ->> 'kind';
end;
$$;

select is(jsonb_build_array(pg_temp.da_marker(15), pg_temp.da_marker(16), pg_temp.da_marker(17)), '[[[1, 1]], [[1, 1]], [[1, 1]]]'::jsonb,
  'fixture: the first takeoff''s hypothesis marks each target');
select is(jsonb_build_array(pg_temp.da_declare(15), pg_temp.da_declare(16)), '["provisional_quantity", "provisional_quantity"]'::jsonb,
  'fixture: a « quantité provisionnelle » is declared on two of them');

-- 15. A measured takeoff accumulates onto a target that rests on an hypothesis: it still does.
select pg_temp.da_permit(15, 2, 'da-15-2');
set local role authenticated;
select is(pg_temp.da_apply('measure beside an hypothesis', 15, 2, 'da-15-2'), 'ok', 'a measured takeoff of another page feeds the target');
reset role;
select is((pg_temp.da_target(15)).quantity, 12::numeric, 'the target holds 8 (hypothesis) + 4 (measured)');
select is(pg_temp.da_marker(15), '[[1, 1]]'::jsonb, 'its marker still names the first takeoff''s hypothesis it keeps');
select is((pg_temp.da_target(15)).offer_choice ->> 'kind', 'provisional_quantity',
  'the « quantité provisionnelle » declared on it stands: the quantity sold still rests on the hypothesis');

-- 16. The page of the hypothesis replaced, the relaunch feeding the target nothing: the target no longer rests on it.
select pg_temp.da_permit(16, 2, 'da-16-2');
set local role authenticated;
select is(pg_temp.da_decide(16, 'replace', null, array[1]), 'ok 1', 'fixture: the page of the hypothesis replaced');
select is(pg_temp.da_apply('hypothesis page replaced', 16, 2, 'da-16-2'), 'ok', 'the relaunch applies');
reset role;
select is((pg_temp.da_target(16)).quantity, 6::numeric, 'the target falls to max(5, 6 measured on page 2)');
select is(jsonb_build_array((pg_temp.da_target(16)).source_metadata ? 'takeoff_provision', (pg_temp.da_target(16)).offer_choice),
  '[false, null]'::jsonb, 'its marker leaves with the hypothesis, and the « quantité provisionnelle » with it');

-- 17. An hypothesis in each takeoff: the marker names both.
select pg_temp.da_permit(17, 2, 'da-17-2');
set local role authenticated;
select is(pg_temp.da_apply('two hypotheses', 17, 2, 'da-17-2'), 'ok', 'a second takeoff with its own hypothesis');
reset role;
select is(pg_temp.da_marker(17), '[[1, 1], [2, 1]]'::jsonb, 'the marker names the hypothesis of each takeoff the target keeps');

-- 18. A line of the relaunch merged onto a target whose page it replaces, without the reconciliation linking it: refused
-- (its measure would be lost under the target's composition), as replacing such a page was before the sum.
insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash,
  review_summary, expires_at)
values (current_setting('test.tenant_id')::uuid, pg_temp.da_job(18, 2), pg_temp.da_version(18), pg_temp.da_id(1),
  encode(sha256(convert_to('da-18-2', 'UTF8')), 'hex'), '{"quantity_policy": []}'::jsonb, now() + interval '5 minutes');
set local role authenticated;
select is(pg_temp.da_decide(18, 'replace', null, array[1]), 'ok 1', 'fixture: page 1 replaced');
select is(pg_temp.da_apply('merged onto a target not fed', 18, 2, 'da-18-2'), '40001 TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT',
  'a relaunch line written onto a DPGF target it does not feed is refused, never overwritten by the composition');
reset role;
select is(jsonb_build_array((pg_temp.da_target(18)).quantity, (pg_temp.da_target(18)).source_provider), '[16, "dpgf"]'::jsonb,
  'the target keeps what it holds');

-- 19. A page whose only new line is excluded at the review is not read again: the application keeps its earlier part,
-- with no page decision (the reconciliation must judge the same total: TI-696, Codex review of PR 288).
select pg_temp.da_permit(19, 2, 'da-19-2');
set local role authenticated;
select is(pg_temp.da_apply('excluded line on the earlier page', 19, 2, 'da-19-2'), 'ok',
  'no decision is asked for page 1: its only new line is excluded');
reset role;
select is((pg_temp.da_target(19)).quantity, 22::numeric, 'the target holds 12 kept from page 1 + 10 from page 2');
select is(pg_temp.da_composition(19), '[[1, 1, 12], [2, 2, 10]]'::jsonb, 'its composition keeps the earlier page');

-- 20. A version 1 policy that could not be split, both its pages replaced: it leaves whole (as the confirmation shows).
create or replace function pg_temp.da_decide_pages(p_case integer, p_pages integer[])
returns text language plpgsql as $$
declare
  failure_detail text;
begin
  return 'ok ' || public.record_takeoff_page_decisions(pg_temp.da_job(p_case, 2), (select jsonb_agg(jsonb_build_object(
    'document', jsonb_build_object('plan_file_id', current_setting('test.plan'), 'content_hash', null, 'logical_document_id', null,
      'file_name', 'plan-fictif.pdf'), 'source_page', page, 'earlier_job_ids', jsonb_build_array(pg_temp.da_job(p_case, 1)),
    'decision', 'replace', 'reason_code', null, 'note', null,
    'lines', jsonb_build_array(jsonb_build_object('estimate_item_id', (pg_temp.da_target(p_case)).id,
      'expected_updated_at', (pg_temp.da_target(p_case)).updated_at, 'action', 'keep', 'take', null,
      'item_ids', jsonb_build_array(pg_temp.da_item(p_case, 1, page)))),
    'pairs', '[]'::jsonb) order by page) from unnest(p_pages) as page));
exception when others then
  get stacked diagnostics failure_detail = pg_exception_detail;
  return sqlstate || ' ' || sqlerrm
    || coalesce(' ' || (case when failure_detail ~ '^\s*\{' then failure_detail::jsonb ->> 'reason' end), '');
end;
$$;
select pg_temp.da_version_one(20, array[1, 2], 16, 16);
select pg_temp.da_permit(20, 2, 'da-20-2', jsonb_build_array(jsonb_build_object('target_id', (pg_temp.da_target(20)).id,
  'expected_updated_at', (pg_temp.da_target(20)).updated_at, 'job_id', pg_temp.da_job(20, 1),
  'item_ids', jsonb_build_array(pg_temp.da_item(20, 1, 1), pg_temp.da_item(20, 1, 2)),
  'contributions', jsonb_build_array(jsonb_build_object('job_id', pg_temp.da_job(20, 1),
    'item_ids', jsonb_build_array(pg_temp.da_item(20, 1, 1), pg_temp.da_item(20, 1, 2)), 'quantity', 16, 'protective', 0,
    'printed_gap', 0)))));
set local role authenticated;
select is(pg_temp.da_decide_pages(20, array[1, 2]), 'ok 2', 'fixture: both pages of the unsplit policy replaced');
select is(pg_temp.da_apply('block replaced whole', 20, 2, 'da-20-2'), 'ok',
  'replacing every page of a takeoff whose part per page is unknown takes it out whole');
reset role;
select is((pg_temp.da_target(20)).quantity, 13::numeric, 'the target holds max(10, 8 + 5): nothing of the block stays');
select is(pg_temp.da_composition(20), '[[2, 1, 8], [2, 2, 5]]'::jsonb, 'its composition holds the relaunch only');

select * from finish();
rollback;
