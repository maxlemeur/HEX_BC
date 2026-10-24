-- Shared fixture of the large v3 estimate probes (included with \ir, not a test file):
-- supabase/tests/database/estimate-large-v3-scale.test.sql (every run) and
-- supabase/tests/budget/estimate-large-v3-statement-budget.test.sql (opt-in wall-clock budget).
-- Contract: docs/testing/large-estimate-statement-budget.md. Runs inside the caller's transaction.
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
insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents)
values ('29200000-0000-4000-8000-000000000301', current_setting('test.tenant_id')::uuid,
  '29200000-0000-4000-8000-000000000001', 'LB29 public workbook MO', 4000);
-- TI-534: the workbook oracle (HT 6 729 803 at 1,30 / 1,20) predates the FO provision. Every line of a created version
-- carries this neutral supply type (provision 1,000), so it matches private.estimate_v3_compute_items without the key.
-- The copied lines have no supply type: their projection carries the default provision 1,010, as prepareEstimateBatch
-- derives it (a supply type on each operation would grow the receipt of the 1 000-operation copy by about 90 kB).
insert into public.supply_types (id, tenant_id, code, name, default_fo_provision)
values ('29200000-0000-4000-8000-000000000302', current_setting('test.tenant_id')::uuid, 'lb29_neutral',
  'LB29 neutral supply type', 1.000);

-- Local native budgets, opt-in (AGENTS.md; docs/testing/large-estimate-statement-budget.md). The large target is
-- the real 2 031-item public workbook; bulk operations get 1 000 ms without a pro-rata approximation.
-- copy_budget_ms (L7): option A gives a 1 000-operation copy
-- 875 ms = the 3 500 ms CI/production maximum / planning factor 4. L4: at most 100 operations get 400 ms.
create temporary table lb29_budget as select 1000::numeric as budget_ms, 875::numeric as copy_budget_ms,
  400::numeric as interactive_budget_ms, clock_timestamp() as started_at;
-- updates: estimate_versions rows updated by a creation, estimate_items rows updated by a settings save.
create temporary table lb29_sample (operation text, run integer, outcome text, duration_ms numeric, updates bigint);
create temporary table lb29_payload (operation text, run integer, items jsonb, totals jsonb);
grant all on lb29_sample to service_role;
grant select on lb29_budget, lb29_payload to service_role;

-- Generated inside the owned workdir from the actual public IO01 workbook.
\ir large-v3-workbook.sql

-- Small synthetic control only (one import root, one lot/sub-lot and five lines).
-- The large target comes from lb29_workbook, not from scaling this factory.
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
      'unit_price_ht_cents', 500 + ((lots.lot_number * 37 + line_number * 101) % 4000), 'tax_rate_bp', 2000, 'k_fo', 1, 'h_mo_majoration', 1, 'k_mo', 1,
      'labor_role_id', null, 'pu_ht_cents', 0, 'line_total_ht_cents', 0, 'line_tax_cents', 0,
      'line_total_ttc_cents', 0, 'unit_code', 'ml', 'pricing_status', 'priced', 'h_mo_per_unit', 0,
      'source_provider', 'dpgf', 'source_file_name', 'optima-hydraulique-fictif.xlsx',
      'source_metadata', meta.value || jsonb_build_object('mapped_row_id', gen_random_uuid(),
        'row_index', lots.first_position + 1 + line_number))
    from lots, meta, generate_series(1, p_lines) line_number
  )
  select jsonb_agg(item order by position) from items
$$;

-- The engine 3 amounts of the payload lines (private.estimate_v3_compute_items, the D12 reference), at c_FO 1,3 and
-- c_MO 1,2: {items, totals}, each line with the neutral supply type. Called before the role switch: private is not
-- granted to service_role.
create function pg_temp.lb29_priced(p_items jsonb) returns jsonb language plpgsql as $$
declare
  computed jsonb;
begin
  computed := private.estimate_v3_compute_items(
    (select jsonb_agg(jsonb_build_object('id', item ->> 'id', 'item_type', 'line', 'parent_id', item ->> 'parent_id',
        'pricing_status', item -> 'pricing_status', 'tax_rate_bp', item -> 'tax_rate_bp', 'unit_code', item -> 'unit_code', 'quantity', item -> 'quantity',
        'unit_price_ht_cents', item -> 'unit_price_ht_cents', 'k_fo', item -> 'k_fo', 'h_mo_per_unit', item -> 'h_mo_per_unit',
        'h_mo_atelier_per_unit', null, 'h_mo_chantier_per_unit', null, 'h_mo_majoration', item -> 'h_mo_majoration', 'k_mo', item -> 'k_mo',
        'k_mo_atelier', 1, 'k_mo_chantier', 1, 'labor_rate_cents', coalesce((select hourly_rate_cents from public.labor_roles
          where id = (item ->> 'labor_role_id')::uuid), 0), 'labor_rate_atelier_cents', null,
        'labor_rate_chantier_cents', null) order by (item ->> 'id')::uuid)
     from jsonb_array_elements(p_items) item where item ->> 'item_type' = 'line'),
    jsonb_build_object('sale_coefficient_fo', 1.3, 'sale_coefficient_mo', 1.2, 'discount_amount_cents', null,
      'discount_bp', 0, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'reverse_charge', false,
      'labor_split_enabled', false));
  return jsonb_build_object('items', (
      select jsonb_agg(item || case when item ->> 'item_type' = 'line'
            then '{"supply_type_id":"29200000-0000-4000-8000-000000000302"}'::jsonb else '{}'::jsonb end
          || coalesce((select jsonb_build_object('pu_ht_cents', line -> 'pu_ht_cents',
            'line_total_ht_cents', line -> 'line_total_ht_cents', 'line_tax_cents', line -> 'line_tax_cents',
            'line_total_ttc_cents', line -> 'line_total_ttc_cents')
          from jsonb_array_elements(computed -> 'lines') line where line ->> 'id' = item ->> 'id'), '{}'::jsonb)
        order by ordinality)
      from jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)),
    'totals', computed -> 'totals');
end
$$;

create function pg_temp.lb29_version(p_id uuid, p_totals jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'title', 'LB29', 'date_devis', current_date, 'validite_jours', 30,
    'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
    'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
    'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
    'contractor_role', 'principal', 'calc_engine_version', 3, 'sale_coefficient_fo', 1.3, 'sale_coefficient_mo', 1.2,
    'gross_ht_cents', p_totals -> 'gross_ht_cents', 'discount_applied_cents', p_totals -> 'discount_applied_cents',
    'commercial_rounding_cents', p_totals -> 'commercial_rounding_cents', 'total_ht_cents', p_totals -> 'total_ht_cents',
    'total_tax_cents', p_totals -> 'total_tax_cents', 'total_ttc_cents', p_totals -> 'total_ttc_cents')
$$;

create function pg_temp.lb29_updates(p_table text) returns bigint language sql as $$
  select coalesce(sum(t.n_tup_upd), 0)::bigint from pg_stat_xact_user_tables t
  where t.schemaname = 'public' and t.relname = p_table
$$;

create function pg_temp.lb29_context(p_version_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('labor_roles', coalesce((select jsonb_agg(jsonb_build_object('id', role.id,
    'tenant_id', role.tenant_id, 'user_id', role.user_id, 'hourly_rate_cents', role.hourly_rate_cents) order by role.id)
    from public.labor_roles role where role.id in (select labor_role_id from public.estimate_items
      where version_id = p_version_id)), '[]'::jsonb), 'margin_tiers', '[]'::jsonb, 'labor_split_flag', null)
$$;

-- One creation of a prepared payload, rolled back unless p_keep.
create function pg_temp.lb29_create(p_operation text, p_run integer, p_version_id uuid,
  p_keep boolean default false) returns void language plpgsql as $$
declare
  started_at timestamptz;
  duration numeric;
  updates_before bigint;
  updates bigint;
  payload lb29_payload%rowtype;
begin
  select * into payload from lb29_payload where operation = p_operation and run = p_run;
  begin
    updates_before := pg_temp.lb29_updates('estimate_versions');
    started_at := clock_timestamp();
    perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
      '29200000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000010', null,
      pg_temp.lb29_version(p_version_id, payload.totals), payload.items, null);
    duration := round(extract(epoch from clock_timestamp() - started_at) * 1000, 1);
    updates := pg_temp.lb29_updates('estimate_versions') - updates_before;
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

create function pg_temp.lb29_save_settings(p_run integer) returns void language plpgsql as $$
declare
  started_at timestamptz;
  duration numeric;
  updates_before bigint;
  updates bigint;
  payload lb29_payload%rowtype;
  calculation_context jsonb;
begin
  select * into payload from lb29_payload where operation = 'settings';
  calculation_context := pg_temp.lb29_context('29200000-0000-4000-8000-000000000101');
  begin
    updates_before := pg_temp.lb29_updates('estimate_items');
    started_at := clock_timestamp();
    perform public.save_estimate_settings_atomic('29200000-0000-4000-8000-000000000101',
      current_setting('test.tenant_id')::uuid, '29200000-0000-4000-8000-000000000001',
      (select updated_at from public.estimate_versions where id = '29200000-0000-4000-8000-000000000101'),
      (select content_revision from public.estimate_versions where id = '29200000-0000-4000-8000-000000000101'),
      '29200000-0000-4000-8000-000000000401', '{"sale_coefficient_fo":2}'::jsonb, payload.items, payload.totals,
      calculation_context);
    duration := round(extract(epoch from clock_timestamp() - started_at) * 1000, 1);
    updates := pg_temp.lb29_updates('estimate_items') - updates_before;
    raise exception using errcode = 'P0001', message = 'LB29_ROLLBACK';
  exception when others then
    insert into lb29_sample values ('settings', p_run,
      case when sqlerrm = 'LB29_ROLLBACK' then 'ok' else sqlstate || ' ' || sqlerrm end, duration, updates);
  end;
end
$$;

-- p_runs rolled-back 2 031-item creations, one 8-item creation, one kept creation (the subject of the settings
-- saves) and p_runs rolled-back v3 settings saves (c_FO 1,3 -> 2) with the projection of every line, as the
-- settings route sends it: engine 3 amounts at the new coefficient change the 785 nonzero workbook lines.
-- Payloads are built and priced as the caller, before the clock and the role switch.
create function pg_temp.lb29_run(p_runs integer) returns void language plpgsql as $$
begin
  insert into lb29_payload
  select payload.operation, 1, priced -> 'items', priced -> 'totals'
  from (values ('create-small', pg_temp.lb29_items(1, 5)), ('create-kept', (select items from lb29_workbook))) payload(operation, items)
  cross join lateral pg_temp.lb29_priced(payload.items) priced
  union all
  select 'create', run, priced -> 'items', priced -> 'totals'
  from generate_series(1, p_runs) run
  cross join lateral pg_temp.lb29_priced((select items from lb29_workbook)) priced;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  perform pg_temp.lb29_create('create-small', 1, gen_random_uuid());
  perform pg_temp.lb29_create('create', run, gen_random_uuid()) from generate_series(1, p_runs) run;
  perform pg_temp.lb29_create('create-kept', 1, '29200000-0000-4000-8000-000000000101', true);
  perform set_config('role', 'none', true);

  insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
  values ('29200000-0000-4000-8000-000000000101', '29200000-0000-4000-8000-000000000001',
    current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes',
    '29200000-0000-4000-8000-000000000401');
  insert into lb29_payload
  select 'settings', 1, (
      select jsonb_agg(jsonb_build_object('id', line -> 'id', 'pu_ht_cents', line -> 'pu_ht_cents',
        'line_total_ht_cents', line -> 'line_total_ht_cents', 'line_tax_cents', line -> 'line_tax_cents',
        'line_total_ttc_cents', line -> 'line_total_ttc_cents', 'tax_rate_bp', 2000))
      from jsonb_array_elements(computed -> 'lines') line),
    (computed -> 'totals') - array(select key from jsonb_object_keys(computed -> 'totals') key
      where key not in ('total_ht_cents', 'total_tax_cents', 'total_ttc_cents', 'rounding_adjustment_cents',
        'gross_ht_cents', 'discount_applied_cents', 'commercial_rounding_cents'))
  from (select canonical from (select private.estimate_v3_canonical_input('29200000-0000-4000-8000-000000000101')
    as canonical) input) input
  cross join lateral (select private.estimate_v3_compute_items(input.canonical -> 'items',
    jsonb_set(input.canonical -> 'params', '{sale_coefficient_fo}', '2'::jsonb)) as computed) computation;

  perform set_config('role', 'service_role', true);
  perform pg_temp.lb29_save_settings(run) from generate_series(1, p_runs) run;
  perform set_config('role', 'none', true);
end
$$;

create function pg_temp.lb29_median(p_operation text) returns numeric language sql as $$
  select percentile_cont(0.5) within group (order by duration_ms)::numeric from lb29_sample where operation = p_operation
$$;
create function pg_temp.lb29_report(p_operation text) returns text language sql as $$
  select format('%s: median %s ms over %s runs (%s), local native budget %s ms (opt-in)', p_operation,
    pg_temp.lb29_median(p_operation), count(*), string_agg(duration_ms::text, ' ' order by run),
    (select budget_ms from lb29_budget))
  from lb29_sample where operation = p_operation
$$;

create function pg_temp.lb29_diag() returns setof text language sql as $$
  select diag('statement_timeout of the API roles: ' || coalesce((select string_agg(role.rolname || ' '
    || coalesce(array_to_string(role.rolconfig, ','), 'default'), '; ' order by role.rolname) from pg_roles role
    where role.rolname in ('anon', 'authenticated', 'authenticator', 'service_role')), 'none'))
  union all select diag('server: ' || version())
  union all select diag(pg_temp.lb29_report('create'))
  union all select diag(pg_temp.lb29_report('settings'))
  union all select diag(format('probe runs and setup: %s ms', round(extract(epoch from clock_timestamp()
    - (select started_at from lb29_budget)) * 1000)))
$$;

create function pg_temp.lb29_succeeded(p_runs integer) returns text language sql as $$
  select results_eq(
    $q$select operation, count(*) filter (where outcome = 'ok') from lb29_sample group by operation order by operation$q$,
    format($f$values ('create'::text, %1$s::bigint), ('create-kept', 1), ('create-small', 1), ('settings', %1$s)$f$, p_runs),
    'every v3 creation and settings save of the probe succeeds (failure: ' || coalesce((select string_agg(distinct outcome, '; ')
      from lb29_sample where outcome <> 'ok'), 'none') || ')')
$$;

-- Sub-lot 2.8b (review, L7): a copy into a v3 is one commit_estimate_batch statement (sections from the same or
-- another version, the linked DPGF): one root section and p_size - 1 priced lines under it, the IO13 profile, into
-- the kept 2 031-item version ('large') and into a kept 8-item version ('small'). The projections of every line of
-- the target and its v3 totals come from private.estimate_v3_compute_items before the clock, as
-- prepareEstimateBatch sends them. Each copy runs as the owner (authenticated) and is rolled back.
create temporary table lb29_copy (target text, size integer, version_id uuid, session_id uuid, operations jsonb,
  created_ids jsonb, item_updates jsonb, version_patch jsonb);
-- updates: estimate_items rows updated by the copy (L7: none, the lines already stored keep their amounts).
create temporary table lb29_copy_sample (target text, size integer, run integer, outcome text, duration_ms numeric,
  receipt_bytes integer, updates bigint);
grant select on lb29_copy to authenticated;
grant insert on lb29_copy_sample to authenticated;

create function pg_temp.lb29_copy_payload(p_target text, p_version_id uuid, p_session_id uuid, p_size integer)
returns void language plpgsql as $$
declare
  section_id uuid := gen_random_uuid();
  line_ids uuid[];
  canonical jsonb := private.estimate_v3_canonical_input(p_version_id);
  computed jsonb;
begin
  select array_agg(gen_random_uuid()) into line_ids from generate_series(1, p_size - 1);
  computed := private.estimate_v3_compute_items((select jsonb_agg(item order by (item ->> 'id')::uuid)
    from jsonb_array_elements((canonical -> 'items') || (select jsonb_agg(jsonb_build_object('id', line_ids[n],
      'item_type', 'line', 'parent_id', section_id, 'pricing_status', 'priced', 'tax_rate_bp', 2000, 'unit_code', 'ml',
      'quantity', 20, 'unit_price_ht_cents', 500 + (n * 101) % 4000, 'k_fo', 1, 'fo_provision', 1.01, 'h_mo_per_unit', 0,
      'h_mo_atelier_per_unit', null, 'h_mo_chantier_per_unit', null, 'h_mo_majoration', 1, 'k_mo', 1,
      'k_mo_atelier', 1, 'k_mo_chantier', 1, 'labor_rate_cents', 0, 'labor_rate_atelier_cents', null,
      'labor_rate_chantier_cents', null)) from generate_series(1, p_size - 1) n)) item), canonical -> 'params');
  insert into lb29_copy values (p_target, p_size, p_version_id, p_session_id,
    jsonb_build_array(jsonb_build_object('op', 'create', 'data', jsonb_build_object('item_type', 'section',
      'parent_id', null, 'position', (select coalesce(max(position), 0) + 1 from public.estimate_items
        where version_id = p_version_id and parent_id is null), 'title', 'Copie LB29 ' || p_size,
      'source_provider', 'dpgf', 'source_file_name', 'optima-hydraulique-fictif.xlsx')))
    || (select jsonb_agg(jsonb_build_object('op', 'create', 'data', jsonb_build_object('item_type', 'line',
      'parent_id', section_id, 'position', n, 'title', 'Fourniture et pose tube acier noir DN' || n || ' copie LB29',
      'description', 'ml', 'quantity', 20, 'unit_price_ht_cents', 500 + (n * 101) % 4000, 'tax_rate_bp', 2000,
      'k_fo', 1, 'h_mo_majoration', 1, 'k_mo', 1, 'unit_code', 'ml', 'pricing_status', 'priced', 'h_mo_per_unit', 0,
      'source_provider', 'dpgf', 'source_file_name', 'optima-hydraulique-fictif.xlsx', 'source_page', n)) order by n)
      from generate_series(1, p_size - 1) n),
    -- Each line carries the provenance of its mapped row, as the copies send it (server-side created ids).
    (select jsonb_agg(jsonb_build_object('index', n, 'id', case when n = 0 then section_id else line_ids[n] end)
      || case when n = 0 then '{}'::jsonb else jsonb_build_object('source_metadata', jsonb_build_object('import_id',
        section_id, 'mapped_row_id', gen_random_uuid(), 'row_index', n)) end order by n) from generate_series(0, p_size - 1) n),
    (select jsonb_agg(jsonb_build_object('id', line -> 'id', 'pu_ht_cents', line -> 'pu_ht_cents',
      'line_total_ht_cents', line -> 'line_total_ht_cents', 'line_tax_cents', line -> 'line_tax_cents',
      'line_total_ttc_cents', line -> 'line_total_ttc_cents')) from jsonb_array_elements(computed -> 'lines') line),
    (select jsonb_object_agg(key, computed -> 'totals' -> key) from unnest(array['total_ht_cents', 'total_tax_cents',
      'total_ttc_cents', 'gross_ht_cents', 'discount_applied_cents', 'commercial_rounding_cents']) key));
end
$$;

create function pg_temp.lb29_copy_once(p_target text, p_size integer, p_run integer) returns void
language plpgsql as $$
declare
  started_at timestamptz;
  duration numeric;
  response jsonb;
  receipt text;
  updates_before bigint;
  payload lb29_copy%rowtype;
  calculation_context jsonb;
begin
  select * into payload from lb29_copy where target = p_target and size = p_size;
  calculation_context := pg_temp.lb29_context(payload.version_id);
  begin
    updates_before := pg_temp.lb29_updates('estimate_items');
    started_at := clock_timestamp();
    response := public.commit_estimate_batch(payload.version_id, gen_random_uuid(),
      (select updated_at from public.estimate_versions where id = payload.version_id), payload.session_id,
      payload.operations, payload.created_ids, payload.item_updates, payload.version_patch,
      calculation_context, null);
    duration := round(extract(epoch from clock_timestamp() - started_at) * 1000, 1);
    if (response ->> 'committed')::boolean is not true then
      raise exception using errcode = 'P0001', message = 'LB29_REFUSED ' || left((response -> 'results' -> -1)::text, 300);
    end if;
    raise exception using errcode = 'P0001', message = 'LB29_ROLLBACK',
      detail = octet_length(response::text) || ' ' || (pg_temp.lb29_updates('estimate_items') - updates_before);
  exception when others then
    get stacked diagnostics receipt = pg_exception_detail;
    insert into lb29_copy_sample values (p_target, p_size, p_run,
      case when sqlerrm = 'LB29_ROLLBACK' then 'ok' else sqlstate || ' ' || left(sqlerrm, 300) end, duration,
      case when sqlerrm = 'LB29_ROLLBACK' then split_part(receipt, ' ', 1)::integer end,
      case when sqlerrm = 'LB29_ROLLBACK' then split_part(receipt, ' ', 2)::bigint end);
  end;
end
$$;

-- After lb29_run: an 8-item v3 kept as the small target, a draft lease on it (the large one has its own), the
-- payloads of p_sizes, then p_runs rolled-back copies of each size into each target.
create function pg_temp.lb29_copy_run(p_runs integer, p_sizes integer[]) returns void language plpgsql as $$
declare
  small jsonb := pg_temp.lb29_priced(pg_temp.lb29_items(1, 5));
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
    '29200000-0000-4000-8000-000000000001', '29200000-0000-4000-8000-000000000010', null,
    pg_temp.lb29_version('29200000-0000-4000-8000-000000000102', small -> 'totals'), small -> 'items', null);
  perform set_config('role', 'none', true);
  insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
  values ('29200000-0000-4000-8000-000000000102', '29200000-0000-4000-8000-000000000001',
    current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes',
    '29200000-0000-4000-8000-000000000402');
  perform pg_temp.lb29_copy_payload(target.name, target.version_id, target.session_id, size)
  from (values ('small', '29200000-0000-4000-8000-000000000102'::uuid, '29200000-0000-4000-8000-000000000402'::uuid),
    ('large', '29200000-0000-4000-8000-000000000101', '29200000-0000-4000-8000-000000000401'))
    target(name, version_id, session_id)
  cross join unnest(p_sizes) size;

  perform set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"29200000-0000-4000-8000-000000000001"}', true);
  perform set_config('request.jwt.claim.sub', '29200000-0000-4000-8000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  perform pg_temp.lb29_copy_once(target, size, run)
  from unnest(array['small', 'large']) target cross join unnest(p_sizes) size cross join generate_series(1, p_runs) run;
  perform set_config('role', 'none', true);
end
$$;

create function pg_temp.lb29_copy_median(p_target text, p_size integer) returns numeric language sql as $$
  select percentile_cont(0.5) within group (order by duration_ms)::numeric from lb29_copy_sample
  where target = p_target and size = p_size and outcome = 'ok'
$$;
create function pg_temp.lb29_copy_report() returns setof text language sql as $$
  select diag(format('copy of %s operations into the %s target: median %s ms over %s runs (%s), receipt %s bytes, '
      || '%s line updates, local native budget %s ms (opt-in)', size, target, pg_temp.lb29_copy_median(target, size),
    count(*), string_agg(case when outcome = 'ok' then duration_ms::text else outcome end, ' ' order by run),
    max(receipt_bytes), max(updates),
    (select case when size <= 100 then interactive_budget_ms else copy_budget_ms end from lb29_budget)))
  from lb29_copy_sample group by target, size order by size, target
$$;

-- Lot 3.1: INSERT statements of the batch writer's item insert (commit_estimate_batch, one per operation in its loop),
-- counted by pg_stat_statements once the caller tracks nested statements. Read as the caller (postgres).
create function pg_temp.lb29_batch_insert_statements() returns bigint language sql as $$
  select coalesce(sum(statement.calls), 0)::bigint from extensions.pg_stat_statements statement
  where statement.query like 'insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,%'
$$;

-- Lot 3.1: the 1 000-operation copy into the 2 031-item v3 with operation p_index naming a parent that does not exist,
-- as the owner: the outcome, the items written and whether the version changed.
create function pg_temp.lb29_copy_refused_at(p_index integer) returns jsonb language plpgsql as $$
declare
  payload lb29_copy%rowtype;
  response jsonb;
  items_before bigint;
  updated_before timestamptz;
begin
  select * into payload from lb29_copy where target = 'large' and size = 1000;
  select count(*) into items_before from public.estimate_items where version_id = payload.version_id;
  select updated_at into updated_before from public.estimate_versions where id = payload.version_id;
  perform set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"29200000-0000-4000-8000-000000000001"}', true);
  perform set_config('request.jwt.claim.sub', '29200000-0000-4000-8000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  response := public.commit_estimate_batch(payload.version_id, gen_random_uuid(), updated_before, payload.session_id,
    jsonb_set(payload.operations, array[p_index::text, 'data', 'parent_id'], to_jsonb(gen_random_uuid())),
    payload.created_ids, payload.item_updates, payload.version_patch,
    pg_temp.lb29_context(payload.version_id), null);
  perform set_config('role', 'none', true);
  return jsonb_build_object('committed', (response ->> 'committed')::boolean,
    'results', jsonb_array_length(response -> 'results'),
    'index', (response -> 'results' -> -1 ->> 'index')::integer,
    'code', response -> 'results' -> -1 ->> 'code',
    'rolled_back', (select count(*) from jsonb_array_elements(response -> 'results') entry
      where entry -> 'data' ->> 'rolled_back' = 'true'),
    'items_written', (select count(*) from public.estimate_items where version_id = payload.version_id) - items_before,
    'version_unchanged', (select updated_at from public.estimate_versions where id = payload.version_id) = updated_before);
end
$$;
