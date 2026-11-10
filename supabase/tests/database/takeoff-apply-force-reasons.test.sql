-- TI-686 D10 (migration …_takeoff_apply_force_reasons.sql): an administrator forces each blocked line of a takeoff job
-- with a coded reason and a justification of 10 to 500 characters (H7). The apply trigger (enforce_takeoff_apply_security)
-- consumes the override audit only when every blocked line has exactly one entry in metadata.forced_items whose reason
-- holds for that line (private.takeoff_apply_forced_item_valid), pointing to a valid entry of
-- metadata.forced_justifications, the justifications stored once. The reasons that name a rule hold on the failures
-- that block the line, as TI-681 defines them (takeoff_item_rule_blocked: a quantity warning never blocks), on results
-- that are readable and not to compute again. The former audit, with one job-level justification, is refused (H10).
-- Isolation justified: the trigger reads the audit the route writes as the service role, inside the application's
-- transaction; no journey can write a malformed audit. Cases written before the migration (red on c70b3147): the v1
-- audit is consumed, a v2 audit is never consumed (no job-level justification), a v2 audit that keeps the job-level
-- justification is consumed, the validator does not exist. The other refusals pass before for another reason (the
-- missing job-level justification) and guard the validator once it exists. All values are fictional.
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
values
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'force-reasons-admin@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'force-reasons-engineer@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

update public.tenant_memberships set role = 'admin'::public.tenant_role
where user_id = 'c4000000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = 'c4000000-0000-4000-8000-000000000001' limit 1), true);
update public.tenant_memberships set is_default = false where user_id = 'c4000000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
values (current_setting('test.tenant_id')::uuid, 'c4000000-0000-4000-8000-000000000002', 'engineer', true, '2020-01-01');

insert into public.estimate_projects (id, tenant_id, user_id, name)
values ('c4000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  'c4000000-0000-4000-8000-000000000001', 'Forçage motivé (fictif)');

-- One level C job per case (below), each in a draft of its own (engine 3): once a job is applied, every evaluated line of
-- the version's other completed jobs is to compute again (stale_takeoff_rule_peers_after_apply), as is every one when a
-- stale line is written (stale_takeoff_rule_peers); either would refuse a false positive for that reason instead of
-- the case's. The engineer holds the lock of case 26's draft, the administrator the others.
create or replace function pg_temp.fr_version(p_case integer)
returns uuid
language sql
immutable
as $$
  select ('c4000000-0000-4000-8002-' || lpad(p_case::text, 12, '0'))::uuid
$$;

create or replace function pg_temp.fr_section(p_case integer)
returns uuid
language sql
immutable
as $$
  select ('c4000000-0000-4000-8003-' || lpad(p_case::text, 12, '0'))::uuid
$$;
grant execute on function pg_temp.fr_section(integer) to authenticated;

insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents,
  commercial_rounding_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
select pg_temp.fr_version(job_case), current_setting('test.tenant_id')::uuid, 'c4000000-0000-4000-8000-000000000010', job_case,
  3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 1.3, 1.2, 0, 0, 0, 0, 0, 0
from generate_series(1, 27) as job_case;

do $seed$
declare
  job_case integer;
begin
  for job_case in 1..27 loop
    perform set_config('miaouffrage.estimate_v3_writer', pg_temp.fr_version(job_case)::text, true);
    insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
    values (pg_temp.fr_section(job_case), current_setting('test.tenant_id')::uuid, pg_temp.fr_version(job_case), 'section', 1,
      'Lot fictif');
  end loop;
  perform set_config('miaouffrage.estimate_v3_writer', '', true);
end
$seed$;

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select pg_temp.fr_version(job_case),
  case when job_case = 26 then 'c4000000-0000-4000-8000-000000000002'::uuid else 'c4000000-0000-4000-8000-000000000001'::uuid end,
  current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes', gen_random_uuid()
from generate_series(1, 27) as job_case;

-- The jobs ...2nn and their lines c4000000-0000-4000-8001-…nn1 (and …nn2). What blocks a line since TI-681
-- (protection): evidence (no localized proof), material (a blocked material), stale (a blocked material whose results
-- are to compute again), unreadable (no localized proof, results the route's schema cannot read: it reads them as none
-- and stale), scale (no localized proof and an unverified scale warning), duplicate (no localized proof and a duplicate
-- between zones), admitted (nothing).
create temporary table fr_lines (job_case integer, line integer, protection text) on commit drop;
insert into fr_lines values
  (1, 1, 'evidence'), (2, 1, 'evidence'), (3, 1, 'evidence'), (3, 2, 'material'), (4, 1, 'evidence'), (5, 1, 'evidence'),
  (6, 1, 'evidence'), (7, 1, 'evidence'), (8, 1, 'evidence'), (9, 1, 'evidence'), (10, 1, 'evidence'), (11, 1, 'material'),
  (12, 1, 'material'), (13, 1, 'material'), (14, 1, 'material'), (15, 1, 'material'), (16, 1, 'scale'), (17, 1, 'duplicate'),
  (18, 1, 'stale'), (19, 1, 'stale'), (20, 1, 'unreadable'), (21, 1, 'unreadable'), (22, 1, 'material'), (23, 1, 'evidence'),
  (24, 1, 'evidence'), (24, 2, 'admitted'), (25, 1, 'evidence'), (26, 1, 'evidence'), (27, 1, 'evidence');

create or replace function pg_temp.fr_job(p_case integer)
returns uuid
language sql
immutable
as $$
  select ('c4000000-0000-4000-8000-000000000' || lpad((200 + p_case)::text, 3, '0'))::uuid
$$;
grant execute on function pg_temp.fr_job(integer) to authenticated;

create or replace function pg_temp.fr_line(p_case integer, p_line integer)
returns uuid
language sql
immutable
as $$
  select ('c4000000-0000-4000-8001-0000000' || lpad((p_case * 10 + p_line)::text, 5, '0'))::uuid
$$;

insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select pg_temp.fr_job(job_case), current_setting('test.tenant_id')::uuid, pg_temp.fr_version(job_case),
  'C', 'completed', 'plan-fictif.pdf', 'c4000000-0000-4000-8000-000000000001'
from (select distinct job_case from fr_lines) as job;

insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
  source_page, is_verified, rule_results, rules_evaluated_at, rules_stale, rules_stale_at, created_at)
select pg_temp.fr_line(fixture.job_case, fixture.line), current_setting('test.tenant_id')::uuid, pg_temp.fr_job(fixture.job_case),
  format('Ligne %s.%s (%s)', fixture.job_case, fixture.line, fixture.protection), 4, 'ml', 0.95,
  case when fixture.protection in ('material', 'stale', 'admitted') then 'Repère localisé' end, 'plan-fictif.pdf', 1, false,
  case fixture.protection
    when 'material' then '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","version":3,"acceptable":false,"reason":"Matériau interdit (fictif)."}]'
    when 'stale' then '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","version":3,"acceptable":false,"reason":"Matériau interdit (fictif)."}]'
    when 'unreadable' then '[{"rule":"dn_network","status":"pass"}]'
    when 'scale' then '[{"rule":"scale_dimension","status":"fail","code":"SCALE_DIMENSION_MISMATCH","version":2,"acceptable":true,"reason":"Une cote contredit l''échelle (fictif)."}]'
    when 'duplicate' then '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":101,"acceptable":true,"reason":"Tronçon compté aussi sur Z2 (fictif).","details":{"partner_count":1,"overlap_m":1,"partners":[{"item_id":"c4000000-0000-4000-8000-0000000fffff","job_id":"c4000000-0000-4000-8000-000000000299","zone":"Z2","designation":"EF","overlap_m":1,"resolved":false}]}}]'
    else '[]'
  end::jsonb,
  case when fixture.protection <> 'admitted' then now() end,
  fixture.protection = 'stale', case when fixture.protection = 'stale' then now() end,
  now() + fixture.line * interval '1 second'
from fr_lines fixture;

-- Helpers ------------------------------------------------------------------------------------------------

create temporary table fr_outcome (case_name text primary key, outcome text) on commit drop;
grant all on fr_outcome to authenticated;

-- The override audit, as the route writes it (audit.ts, apply-override-state.ts): the given lines blocked, the metadata
-- given merged last (the forced entries, or the former job-level justification).
create or replace function pg_temp.fr_override(p_case integer, p_blocked integer[], p_metadata jsonb)
returns void
language sql
as $$
  insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
  select job.tenant_id, 'c4000000-0000-4000-8000-000000000001', 'takeoff_jobs', job.id, job.estimate_version_id,
    'takeoff.apply.override',
    jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', job.id,
      'tenant_id', job.tenant_id, 'user_id', 'c4000000-0000-4000-8000-000000000001',
      'metadata', jsonb_build_object('estimate_version_id', job.estimate_version_id, 'threshold', 0.5,
        'blocked_item_ids', (select jsonb_agg(pg_temp.fr_line(p_case, line) order by line) from unnest(p_blocked) as line),
        'blocked_items_count', cardinality(p_blocked),
        'blocked_items_state', (select jsonb_agg(jsonb_build_object('item_id', ti.id, 'quantity', ti.quantity, 'unit', ti.unit,
            'updated_at', ti.updated_at, 'rule_failures', public.takeoff_rule_failure_keys(ti.rule_results),
            'rules_stale', ti.rules_stale, 'designation', ti.designation, 'evidence', ti.evidence,
            'source_page', ti.source_page, 'is_verified', ti.is_verified, 'quantity_entered_by', ti.quantity_entered_by))
          from public.takeoff_items ti where ti.id in (select pg_temp.fr_line(p_case, line) from unnest(p_blocked) as line)))
        || p_metadata)
  from public.takeoff_jobs job
  where job.id = pg_temp.fr_job(p_case)
$$;

-- A forced entry of the line ...nn1 (or the line given), as the route records it.
create or replace function pg_temp.fr_item(p_case integer, p_reason text, p_index integer default 0, p_rules jsonb default null,
  p_line integer default 1)
returns jsonb
language sql
as $$
  select jsonb_build_object('item_id', pg_temp.fr_line(p_case, p_line), 'reason_code', p_reason, 'justification_index', p_index)
    || case when p_rules is null then '{}'::jsonb else jsonb_build_object('false_positive_rules', p_rules) end
$$;

-- Each job's mapping plan, as the route builds it (every line kept as is), read here as the table owner: the
-- engineer's own read of the lines is not what this file tests.
create temporary table fr_plans on commit drop as
select job.job_case, (select coalesce(jsonb_agg(jsonb_build_object('item_id', item.id, 'source_order', item.source_order,
    'rule_id', null, 'action', 'none', 'designation', btrim(item.designation), 'unit_price_cents', null, 'category_id', null,
    'assembly_id', null) order by item.source_order), '[]'::jsonb)
  from (select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
    from public.takeoff_items ti where ti.job_id = pg_temp.fr_job(job.job_case)) as item) as plan
from (select distinct job_case from fr_lines) as job;
grant select on fr_plans to authenticated;

-- The application through the 4-argument overload, as the signed-in user; its outcome recorded so that a refusal
-- fails a named assertion.
create or replace function pg_temp.fr_apply(p_case integer)
returns text
language plpgsql
as $$
declare
  result_row record;
  v_case text := 'case-' || p_case;
begin
  begin
    select * into result_row from public.apply_takeoff_job_guarded_atomic(pg_temp.fr_job(p_case), 'append',
      pg_temp.fr_section(p_case), (select plan from fr_plans where fr_plans.job_case = p_case));
    insert into fr_outcome values (v_case, 'ok');
  exception when others then
    insert into fr_outcome values (v_case, sqlstate || ' ' || sqlerrm);
  end;
  return (select outcome from fr_outcome where fr_outcome.case_name = v_case);
end;
$$;
grant execute on function pg_temp.fr_apply(integer) to authenticated;

create or replace function pg_temp.fr_consumed(p_case integer)
returns integer
language sql
as $$
  select count(*)::integer from public.takeoff_apply_override_consumptions consumed where consumed.job_id = pg_temp.fr_job(p_case)
$$;

create or replace function pg_temp.fr_as(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', p_user::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_user)::text, true);
$$;
grant execute on function pg_temp.fr_as(uuid) to authenticated;

select set_config('test.note', 'Relevé chantier joint au dossier (fictif).', true);

-- The audits -----------------------------------------------------------------------------------------------

-- 1: the former audit, one job-level justification and no forced entry (H10).
select pg_temp.fr_override(1, array[1], jsonb_build_object('justification', current_setting('test.note')));
-- 2: forced justifications without forced entries.
select pg_temp.fr_override(2, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note'))));
-- 3: two blocked lines, only the first one forced.
select pg_temp.fr_override(3, array[1, 2], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(3, 'additional_evidence'))));
-- 4: an unknown reason.
select pg_temp.fr_override(4, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(4, 'trust_me'))));
-- 5: a justification index out of bounds.
select pg_temp.fr_override(5, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(5, 'additional_evidence', 1))));
-- 6 to 9: justifications of 9 code points once trimmed, 501, 10 and 500 (multibyte).
select pg_temp.fr_override(6, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(E' \n123456789 \t'),
  'forced_items', jsonb_build_array(pg_temp.fr_item(6, 'additional_evidence'))));
select pg_temp.fr_override(7, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(repeat('é', 501)),
  'forced_items', jsonb_build_array(pg_temp.fr_item(7, 'additional_evidence'))));
select pg_temp.fr_override(8, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(E'\t1234567890 '),
  'forced_items', jsonb_build_array(pg_temp.fr_item(8, 'controlled_correction'))));
select pg_temp.fr_override(9, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(repeat('é', 500)),
  'forced_items', jsonb_build_array(pg_temp.fr_item(9, 'engineer_or_client_confirmation'))));
-- 10: a false positive on a line no rule blocks (forced for its missing localized proof).
select pg_temp.fr_override(10, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(10, 'rule_false_positive', 0, '["dn_network"]'))));
-- 11 to 15 (a blocked material): a rule that does not fail, none, the same twice, none given, given to another reason.
select pg_temp.fr_override(11, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(11, 'rule_false_positive', 0, '["scale_dimension"]'))));
select pg_temp.fr_override(12, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(12, 'rule_false_positive', 0, '[]'))));
select pg_temp.fr_override(13, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(13, 'rule_false_positive', 0, '["dn_network", "dn_network"]'))));
select pg_temp.fr_override(14, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(14, 'rule_false_positive'))));
select pg_temp.fr_override(15, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(15, 'additional_evidence', 0, '["dn_network"]'))));
-- 16: a false positive of a scale warning, which never blocks since TI-681.
select pg_temp.fr_override(16, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(16, 'rule_false_positive', 0, '["scale_dimension"]'))));
-- 17: « doublon résolu » on a duplicate between zones, which never blocks since TI-681.
select pg_temp.fr_override(17, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(17, 'duplicate_resolved'))));
-- 18, 19: results to compute again: a false positive, then an unconditional reason.
select pg_temp.fr_override(18, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(18, 'rule_false_positive', 0, '["dn_network"]'))));
select pg_temp.fr_override(19, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(19, 'additional_evidence'))));
-- 20, 21: unreadable results: a false positive, then an unconditional reason.
select pg_temp.fr_override(20, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(20, 'rule_false_positive', 0, '["dn_network"]'))));
select pg_temp.fr_override(21, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(21, 'additional_evidence'))));
-- 22: a false positive of the blocked material.
select pg_temp.fr_override(22, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(22, 'rule_false_positive', 0, '["dn_network"]'))));
-- 23: a forced entry with a key of its own.
select pg_temp.fr_override(23, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(23, 'additional_evidence') || '{"note": "?"}'::jsonb)));
-- 24: an entry for the admitted line too.
select pg_temp.fr_override(24, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(24, 'additional_evidence'), pg_temp.fr_item(24, 'additional_evidence', 0, null, 2))));
-- 25: valid forced entries, but the former job-level justification kept beside them.
select pg_temp.fr_override(25, array[1], jsonb_build_object('justification', current_setting('test.note'),
  'forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(25, 'additional_evidence'))));
-- 26: a valid override, applied by an engineer.
select pg_temp.fr_override(26, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(26, 'additional_evidence'))));
update public.audit_logs set user_id = 'c4000000-0000-4000-8000-000000000002',
  after_data = jsonb_set(after_data, '{user_id}', '"c4000000-0000-4000-8000-000000000002"')
where record_id = pg_temp.fr_job(26) and action = 'takeoff.apply.override';
-- 27: a priced hypothesis (unconditional), justifications stored once for one line.
select pg_temp.fr_override(27, array[1], jsonb_build_object('forced_justifications', jsonb_build_array(current_setting('test.note')),
  'forced_items', jsonb_build_array(pg_temp.fr_item(27, 'priced_hypothesis'))));

-- The applications -------------------------------------------------------------------------------------------

-- Each refusal must come from the forced entry: only the lines of cases 18 and 19 are to compute again, each in its
-- own draft.
select is(array(select distinct fixture.job_case from fr_lines fixture
    join public.takeoff_items ti on ti.id = pg_temp.fr_line(fixture.job_case, fixture.line)
    where ti.rules_stale order by fixture.job_case),
  array[18, 19], '(fixture) only the lines of cases 18 and 19 are to compute again');

set local role authenticated;
select pg_temp.fr_as('c4000000-0000-4000-8000-000000000001');
select is(pg_temp.fr_apply(1), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'the former audit, with one job-level justification and no forced entry, is refused (H10)');
select is(pg_temp.fr_apply(2), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'an audit without forced entries is refused');
select is(pg_temp.fr_apply(3), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'an audit that leaves a blocked line without its entry is refused');
select is(pg_temp.fr_apply(4), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'an unknown reason is refused');
select is(pg_temp.fr_apply(5), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a justification index out of bounds is refused');
select is(pg_temp.fr_apply(6), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'a justification of 9 characters once its blanks are trimmed is refused');
select is(pg_temp.fr_apply(7), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a justification of 501 characters is refused');
select is(pg_temp.fr_apply(8), 'ok', 'a justification of 10 characters once trimmed is consumed');
select is(pg_temp.fr_apply(9), 'ok', 'a justification of 500 multibyte characters is consumed');
select is(pg_temp.fr_apply(10), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'a false positive on a line no rule blocks (forced for its missing proof) is refused');
select is(pg_temp.fr_apply(11), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a false positive of a rule that does not block the line is refused');
select is(pg_temp.fr_apply(12), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a false positive that names no rule is refused');
select is(pg_temp.fr_apply(13), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a false positive that names a rule twice is refused');
select is(pg_temp.fr_apply(14), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a false positive without its rules is refused');
select is(pg_temp.fr_apply(15), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'rules named for another reason than a false positive are refused');
select is(pg_temp.fr_apply(16), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'a false positive of a scale warning, which never blocks since TI-681, is refused');
select is(pg_temp.fr_apply(17), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  '« doublon résolu » on a duplicate between zones, which never blocks since TI-681, is refused');
select is(pg_temp.fr_apply(18), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a false positive on results to compute again is refused');
select is(pg_temp.fr_apply(19), 'ok', 'an unconditional reason on results to compute again is consumed');
select is(pg_temp.fr_apply(20), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a false positive on unreadable results is refused');
select is(pg_temp.fr_apply(21), 'ok', 'an unconditional reason on unreadable results is consumed');
select is(pg_temp.fr_apply(22), 'ok', 'a false positive of the blocked material is consumed');
select is(pg_temp.fr_apply(23), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a forced entry with a key of its own is refused');
select is(pg_temp.fr_apply(24), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'an entry for a line that is not blocked is refused');
select is(pg_temp.fr_apply(25), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'an audit that keeps the former job-level justification beside its forced entries is refused (H10)');
select is(pg_temp.fr_apply(27), 'ok', 'a priced hypothesis is consumed');
select pg_temp.fr_as('c4000000-0000-4000-8000-000000000002');
select is(pg_temp.fr_apply(26), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'an engineer cannot force, even with a valid override');
reset role;

select is(array(select job_case from (select distinct job_case from fr_lines) as job
    where pg_temp.fr_consumed(job_case) > 0 order by job_case),
  array[8, 9, 19, 21, 22, 27], 'each valid override is consumed once, and only those');
select is((select count(*)::integer from public.takeoff_apply_override_consumptions consumed
    where consumed.job_id in (select pg_temp.fr_job(job_case) from fr_lines)),
  6, 'no override is consumed twice');

-- The validator ----------------------------------------------------------------------------------------------

select ok(coalesce((select not procedure.prosecdef and procedure.provolatile = 's'
    and 'search_path=pg_catalog' = any(coalesce(procedure.proconfig, array[]::text[]))
    from pg_proc procedure
    where procedure.oid = to_regprocedure('private.takeoff_apply_forced_item_valid(jsonb,public.takeoff_items,jsonb)')), false),
  'private.takeoff_apply_forced_item_valid exists, stable, invoker, with search_path pg_catalog');
select ok(case when to_regprocedure('private.takeoff_apply_forced_item_valid(jsonb,public.takeoff_items,jsonb)') is null then false
    else not has_function_privilege('authenticated', 'private.takeoff_apply_forced_item_valid(jsonb,public.takeoff_items,jsonb)', 'EXECUTE')
      and not has_function_privilege('anon', 'private.takeoff_apply_forced_item_valid(jsonb,public.takeoff_items,jsonb)', 'EXECUTE')
      and not has_function_privilege('service_role', 'private.takeoff_apply_forced_item_valid(jsonb,public.takeoff_items,jsonb)', 'EXECUTE')
      and not exists (
        select 1 from pg_proc procedure
        cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as grant_entry
        where procedure.oid = to_regprocedure('private.takeoff_apply_forced_item_valid(jsonb,public.takeoff_items,jsonb)')
          and grant_entry.grantee = 0 and grant_entry.privilege_type = 'EXECUTE')
    end,
  'neither authenticated, anon, service_role nor PUBLIC can execute the validator');

select * from finish();
rollback;
