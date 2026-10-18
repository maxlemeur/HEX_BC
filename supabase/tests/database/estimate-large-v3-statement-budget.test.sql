-- Local statement budget for a large v3 estimate (1 021 items, the hydraulic OPTIMA lot profile of IO01).
-- In CI (sub-lot 2.8, IO01) the atomic creation of that lot exceeded the 8 s statement_timeout of the API roles
-- (57014) while it took 660 ms locally: no local check guarded large volumes.
-- Isolation: the duration of one API statement is not asserted by a journey, and the CI journey only fails once
-- the timeout is crossed. Contract, budget derivation and limits: docs/testing/large-estimate-statement-budget.md.
--
-- 1. Everywhere: the creation updates its version as many times for 1 021 items as for 8 (once); the per-line
--    content revision bump that M6b replays in one pass would update it once per item. The other replayed effects
--    (audit, coverage, depth) write the same rows either way: only the budget below sees them come back.
-- 2. On the calibrated platform only (Apple silicon, native runtime): the median of 7 rolled-back runs of the
--    creation, then of a v3 settings save repricing every line, stays under 330 ms. Elsewhere one run of each is
--    reported and the budget assertions are skipped: a shared CI runner is not the calibrated machine, and the
--    six extra runs would only lengthen every CI pgTAP phase.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(6);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '29200000-0000-4000-8000-000000000001', 'authenticated',
  'authenticated', 'large-v3-budget@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '29200000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select tenant_id::text from public.tenant_memberships
  where user_id = '29200000-0000-4000-8000-000000000001' limit 1), true);
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('29200000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '29200000-0000-4000-8000-000000000001', 'LB29 affaire');
select public.set_tenant_calc_policy(current_setting('test.tenant_id')::uuid, 3::smallint, 1.3, 1.2, array[2000],
  'LB29 v3', '29200000-0000-4000-8000-000000000001');

-- 330 ms = 8 s statement_timeout / (CI-under-load factor 12 x safety 2); see the document for the factor bounds.
create temporary table lb29_budget as select 330::numeric as budget_ms,
  version() like '%aarch64-apple-darwin%' as calibrated_platform,
  case when version() like '%aarch64-apple-darwin%' then 7 else 1 end as runs,
  clock_timestamp() as started_at;
create temporary table lb29_sample (operation text, run integer, outcome text, duration_ms numeric, version_updates bigint);
grant all on lb29_sample to service_role;
grant select on lb29_budget to service_role;

-- The IO01 profile: one import root, 60 lots each with one sub-lot, 15 priced v3 lines per sub-lot (1 021 items),
-- with the DPGF provenance and OPTIMA structure metadata of an import.
create function pg_temp.lb29_items(p_lots integer, p_lines integer) returns jsonb language sql volatile as $$
  with meta as (
    select jsonb_build_object('import_id', gen_random_uuid(), 'mapping_id', gen_random_uuid(),
      'kind', 'dpgf_line', '_timax_structure', jsonb_build_object('sheet_name', 'DPGF', 'source_row_number', 12,
        'bold_columns', '[]'::jsonb, 'merged_columns', '[]'::jsonb, 'outline_level', null, 'column_order',
        to_jsonb(array['N°', 'Désignation', 'Uté', 'Qté', 'Prix Unitaire', 'Prix Total', 'PR Fourniture unitaire',
          'PR Total fourniture', 'Tps pose unitaire', 'Tps pose unitaire majoré', 'Tps pose total', 'Coeff FO',
          'Coeff MO', 'Majoration MO', 'Taux horaire']))) as value
  ), root as (select gen_random_uuid() as id),
  lots as (
    select lot_number, gen_random_uuid() as lot_id, gen_random_uuid() as sub_lot_id,
      2 + (lot_number - 1) * (2 + p_lines) as first_position
    from generate_series(1, p_lots) lot_number
  ), items as (
    select 1 as position, jsonb_build_object('id', root.id, 'parent_id', null, 'item_type', 'section',
      'position', 1, 'title', 'Import') as item
    from root
    union all
    select lots.first_position, jsonb_build_object('id', lots.lot_id, 'parent_id', root.id, 'item_type', 'section',
      'position', lots.first_position, 'title', 'Lot ' || lots.lot_number, 'source_metadata', meta.value)
    from lots, root, meta
    union all
    select lots.first_position + 1, jsonb_build_object('id', lots.sub_lot_id, 'parent_id', lots.lot_id,
      'item_type', 'section', 'position', lots.first_position + 1, 'title', 'Sous-lot ' || lots.lot_number,
      'source_metadata', meta.value)
    from lots, meta
    union all
    select lots.first_position + 1 + line_number, jsonb_build_object('id', gen_random_uuid(),
      'parent_id', lots.sub_lot_id, 'item_type', 'line', 'position', lots.first_position + 1 + line_number,
      'title', 'Ligne ' || lots.lot_number || '.' || line_number, 'description', 'ml', 'quantity', 20,
      'unit_price_ht_cents', 0, 'tax_rate_bp', 2000, 'k_fo', 1, 'h_mo_majoration', 1, 'k_mo', 1,
      'labor_role_id', null, 'pu_ht_cents', 0, 'line_total_ht_cents', 0, 'line_tax_cents', 0,
      'line_total_ttc_cents', 0, 'unit_code', 'ml', 'pricing_status', 'priced', 'h_mo_per_unit', 0,
      'source_provider', 'dpgf', 'source_file_name', 'BEING - DPGF HYDRAULIQUE.xlsx',
      'source_metadata', meta.value || jsonb_build_object('mapped_row_id', gen_random_uuid(),
        'row_index', lots.first_position + 1 + line_number))
    from lots, meta, generate_series(1, p_lines) line_number
  )
  select jsonb_agg(item order by position) from items
$$;

create function pg_temp.lb29_version(p_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'title', 'LB29', 'date_devis', current_date, 'validite_jours', 30,
    'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
    'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
    'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
    'contractor_role', 'principal', 'calc_engine_version', 3, 'sale_coefficient_fo', 1.3, 'sale_coefficient_mo', 1.2,
    'gross_ht_cents', 0, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0, 'total_ht_cents', 0,
    'total_tax_cents', 0, 'total_ttc_cents', 0)
$$;

create function pg_temp.lb29_version_updates() returns bigint language sql as $$
  select coalesce(sum(t.n_tup_upd), 0)::bigint from pg_stat_xact_user_tables t
  where t.schemaname = 'public' and t.relname = 'estimate_versions'
$$;

-- One creation, rolled back unless p_keep; the payload is built before the clock starts.
create function pg_temp.lb29_create(p_operation text, p_run integer, p_items jsonb, p_version_id uuid,
  p_keep boolean default false) returns void language plpgsql as $$
declare
  started_at timestamptz;
  duration numeric;
  updates_before bigint;
  updates bigint;
begin
  begin
    updates_before := pg_temp.lb29_version_updates();
    started_at := clock_timestamp();
    perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
      '29200000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000010', null,
      pg_temp.lb29_version(p_version_id), p_items, null);
    duration := round(extract(epoch from clock_timestamp() - started_at) * 1000, 1);
    updates := pg_temp.lb29_version_updates() - updates_before;
    if not p_keep then
      raise exception using errcode = 'P0001', message = 'LB29_ROLLBACK';
    end if;
    insert into lb29_sample values (p_operation, p_run, 'ok', duration, updates);
  exception when others then
    insert into lb29_sample values (p_operation, p_run,
      case when sqlerrm = 'LB29_ROLLBACK' then 'ok' else sqlstate || ' ' || sqlerrm end, duration, updates);
  end;
end
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- Scale invariance: an 8-item creation (root, lot, sub-lot, five lines) and the 1 021-item one.
select pg_temp.lb29_create('create-small', 1, pg_temp.lb29_items(1, 5), gen_random_uuid());
select pg_temp.lb29_create('create', run, pg_temp.lb29_items(60, 15), gen_random_uuid())
from generate_series(1, (select runs from lb29_budget)) run;
-- The kept version, the subject of the settings saves.
select pg_temp.lb29_create('create-kept', 1, pg_temp.lb29_items(60, 15), '29200000-0000-4000-8000-000000000101', true);

reset role;
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
values ('29200000-0000-4000-8000-000000000101', '29200000-0000-4000-8000-000000000001',
  current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes',
  '29200000-0000-4000-8000-000000000401');

-- A v3 settings save (c_FO 1,3 -> 2) with the projection of every line, as the settings route sends it.
create function pg_temp.lb29_save_settings(p_run integer) returns void language plpgsql as $$
declare
  started_at timestamptz;
  duration numeric;
  projections jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', item.id, 'pu_ht_cents', 0, 'line_total_ht_cents', 0, 'line_tax_cents', 0,
      'line_total_ttc_cents', 0, 'tax_rate_bp', 2000) order by item.position)
    into projections
  from public.estimate_items item
  where item.version_id = '29200000-0000-4000-8000-000000000101' and item.item_type = 'line';
  begin
    started_at := clock_timestamp();
    perform public.save_estimate_settings_atomic('29200000-0000-4000-8000-000000000101',
      current_setting('test.tenant_id')::uuid, '29200000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '29200000-0000-4000-8000-000000000101'),
      (select content_revision from public.estimate_versions where id = '29200000-0000-4000-8000-000000000101'),
      '29200000-0000-4000-8000-000000000401', '{"sale_coefficient_fo":2}'::jsonb, projections,
      '{"total_ht_cents":0,"total_tax_cents":0,"total_ttc_cents":0,"rounding_adjustment_cents":0,"gross_ht_cents":0,"discount_applied_cents":0,"commercial_rounding_cents":0}'::jsonb,
      '{"labor_roles":[],"margin_tiers":[],"labor_split_flag":null}'::jsonb);
    duration := round(extract(epoch from clock_timestamp() - started_at) * 1000, 1);
    raise exception using errcode = 'P0001', message = 'LB29_ROLLBACK';
  exception when others then
    insert into lb29_sample values ('settings', p_run,
      case when sqlerrm = 'LB29_ROLLBACK' then 'ok' else sqlstate || ' ' || sqlerrm end, duration, null);
  end;
end
$$;

set local role service_role;
select pg_temp.lb29_save_settings(run) from generate_series(1, (select runs from lb29_budget)) run;
reset role;

create function pg_temp.lb29_median(p_operation text) returns numeric language sql as $$
  select percentile_cont(0.5) within group (order by duration_ms)::numeric from lb29_sample where operation = p_operation
$$;
create function pg_temp.lb29_report(p_operation text) returns text language sql as $$
  select format('%s: median %s ms over %s runs (%s), budget %s ms, platform %s', p_operation,
    pg_temp.lb29_median(p_operation), count(*), string_agg(duration_ms::text, ' ' order by run),
    (select budget_ms from lb29_budget),
    case when (select calibrated_platform from lb29_budget) then 'calibrated' else 'not calibrated: reported only' end)
  from lb29_sample where operation = p_operation
$$;

select diag('statement_timeout of the API roles: ' || coalesce((select string_agg(role.rolname || ' '
  || coalesce(array_to_string(role.rolconfig, ','), 'default'), '; ' order by role.rolname) from pg_roles role
  where role.rolname in ('anon', 'authenticated', 'authenticator', 'service_role')), 'none'));
select diag(pg_temp.lb29_report('create'));
select diag(pg_temp.lb29_report('settings'));
select diag(format('probe runs and setup: %s ms', round(extract(epoch from clock_timestamp()
  - (select started_at from lb29_budget)) * 1000)));

select results_eq(
  $$select operation, count(*) filter (where outcome = 'ok') from lb29_sample group by operation order by operation$$,
  format($f$values ('create'::text, %1$s::bigint), ('create-kept', 1), ('create-small', 1), ('settings', %1$s)$f$,
    (select runs from lb29_budget)),
  'every v3 creation and settings save of the probe succeeds (failure: ' || coalesce((select string_agg(distinct outcome, '; ')
    from lb29_sample where outcome <> 'ok'), 'none') || ')'
);

select is(
  (select jsonb_array_length(pg_temp.lb29_items(60, 15))),
  1021,
  'the probe payload has the 1 021 items of the hydraulic OPTIMA lot'
);

select is(
  (select coalesce(max(version_updates), -1) from lb29_sample where operation = 'create'),
  (select coalesce(max(version_updates), -2) from lb29_sample where operation = 'create-small'),
  'a 1 021-item creation updates its version as many times as an 8-item one (no per-line revision bump)'
);

select is(
  (select count(*) from public.audit_logs where estimate_version_id = '29200000-0000-4000-8000-000000000101'
    and table_name = 'estimate_items'),
  1021::bigint,
  'the kept creation still writes one audit row per item'
);

select case when (select calibrated_platform from lb29_budget)
  then cmp_ok(pg_temp.lb29_median('create'), '<=', (select budget_ms from lb29_budget),
    'the 1 021-item v3 creation stays within the local statement budget: ' || pg_temp.lb29_report('create'))
  else skip('statement budget calibrated on Apple silicon only: ' || pg_temp.lb29_report('create'), 1) end;

select case when (select calibrated_platform from lb29_budget)
  then cmp_ok(pg_temp.lb29_median('settings'), '<=', (select budget_ms from lb29_budget),
    'the v3 settings save of 1 021 items stays within the local statement budget: ' || pg_temp.lb29_report('settings'))
  else skip('statement budget calibrated on Apple silicon only: ' || pg_temp.lb29_report('settings'), 1) end;

select * from finish();
rollback;
