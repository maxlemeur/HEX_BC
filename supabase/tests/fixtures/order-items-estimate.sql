-- Shared fixture of the reorder/move probes (included with \ir, not a test file):
-- supabase/tests/database/estimate-order-items-atomic.test.sql (every run) and
-- supabase/tests/budget/estimate-order-statement-budget.test.sql (opt-in wall-clock budget).
-- Contract: docs/testing/reorder-move-large-v2.md. Runs inside the caller's transaction.
-- Users: 01 owner (engineer) of the affaires, 02 admin, 03 engineer and 04 viewer of the owner's tenant, 05 outsider.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', ('29500000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated',
  'authenticated', 'order-items-' || n || '@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from generate_series(1, 5) n;
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '29500000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select tenant_id::text from public.tenant_memberships
  where user_id = '29500000-0000-4000-8000-000000000001' limit 1), true);
insert into public.tenant_memberships (tenant_id, user_id, role)
select current_setting('test.tenant_id')::uuid, member.user_id, member.role
from (values ('29500000-0000-4000-8000-000000000002'::uuid, 'admin'::public.tenant_role),
  ('29500000-0000-4000-8000-000000000003'::uuid, 'engineer'::public.tenant_role),
  ('29500000-0000-4000-8000-000000000004'::uuid, 'viewer'::public.tenant_role)) as member(user_id, role);
-- One affaire per version, so that every version is number 1 of its affaire.
insert into public.estimate_projects (id, tenant_id, user_id, name)
select ('29500000-0000-4000-8000-0000000000' || n)::uuid, current_setting('test.tenant_id')::uuid,
  '29500000-0000-4000-8000-000000000001', 'RO29 affaire ' || n
from generate_series(10, 15) n;
-- The probes are about v1/v2 drafts: since M8 a tenant without a policy row creates engine 3, so the tenant starts at
-- the explicit policy 2 (the per-tenant opt-out).
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 2::smallint, p_default_sale_coefficient_fo => null, p_default_sale_coefficient_mo => null,
  p_allowed_tax_rates_bp => null, p_change_reason => 'RO29 v2', p_actor_user_id => '29500000-0000-4000-8000-000000000001');

-- Interactive tier of docs/testing/large-estimate-statement-budget.md: local WSL median of 7 runs.
create temporary table ro29_budget as select 400::numeric as budget_ms;
create temporary table ro29_sample (operation text, run integer, outcome text, duration_ms numeric, updates bigint);

-- A v2 draft with id `p_id` in affaire `p_project`, created atomically by its owner, with `p_items` (positions,
-- parents and titles as given; a line at position g: 1 u at 5·g cents, 20 % VAT) and the sums of their totals.
create function pg_temp.ro29_version(p_project uuid, p_id uuid, p_items jsonb) returns uuid
language plpgsql as $$
declare
  totals record;
begin
  select coalesce(sum((item.value->>'line_total_ht_cents')::bigint), 0) as ht,
    coalesce(sum((item.value->>'line_tax_cents')::bigint), 0) as tax,
    coalesce(sum((item.value->>'line_total_ttc_cents')::bigint), 0) as ttc
    into totals
  from jsonb_array_elements(p_items) as item(value)
  where item.value->>'item_type' = 'line';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
    '29500000-0000-4000-8000-000000000001', p_project, null,
    jsonb_build_object('id', p_id, 'title', 'RO29', 'date_devis', current_date, 'validite_jours', 30,
      'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
      'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1, 'tax_rate_bp', 2000,
      'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3, 'contractor_role', 'principal',
      'calc_engine_version', 2, 'total_ht_cents', totals.ht, 'total_tax_cents', totals.tax, 'total_ttc_cents', totals.ttc),
    p_items, null);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return p_id;
end
$$;

create function pg_temp.ro29_section(p_id uuid, p_parent uuid, p_position integer, p_title text) returns jsonb
language sql as $$
  select jsonb_build_object('id', p_id, 'parent_id', p_parent, 'item_type', 'section', 'position', p_position, 'title', p_title)
$$;

create function pg_temp.ro29_line(p_id uuid, p_parent uuid, p_position integer, p_title text) returns jsonb
language sql as $$
  select jsonb_build_object('id', p_id, 'parent_id', p_parent, 'item_type', 'line', 'position', p_position,
    'title', p_title, 'description', 'u', 'quantity', 1, 'unit_price_ht_cents', 5 * p_position, 'tax_rate_bp', 2000,
    'k_fo', 1, 'h_mo', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'pu_ht_cents', 5 * p_position,
    'line_total_ht_cents', 5 * p_position, 'line_tax_cents', p_position, 'line_total_ttc_cents', 6 * p_position,
    'source_provider', 'dpgf', 'source_metadata', jsonb_build_object('row_index', p_position))
$$;

-- Item `p_suffix` (12 hex digits) of the tree with id prefix `p_prefix` ('29500000-0000-4000-8100-' …).
create function pg_temp.ro29_id(p_prefix text, p_suffix text) returns uuid language sql as $$
  select (p_prefix || p_suffix)::uuid
$$;

-- A section of `p_lines` lines (line g titled `${p_title} ligne g`, ids `${p_prefix}${p_tag}` then g on 8 digits)
-- at root position `p_position`.
create function pg_temp.ro29_large_section(p_prefix text, p_tag text, p_position integer, p_title text, p_lines integer)
returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.ro29_section(pg_temp.ro29_id(p_prefix, p_tag || '00000000'), null, p_position, p_title))
    || coalesce(jsonb_agg(pg_temp.ro29_line(pg_temp.ro29_id(p_prefix, p_tag || lpad(g::text, 8, '0')),
      pg_temp.ro29_id(p_prefix, p_tag || '00000000'), g, p_title || ' ligne ' || g) order by g), '[]'::jsonb)
  from generate_series(1, p_lines) g
$$;

-- One statement as `p_actor` through the API role (null: an authenticated role without user); its single value as
-- text, or the refusal. A refusal writes nothing: the statement runs in its own subtransaction.
create function pg_temp.ro29_call(p_actor uuid, p_statement text) returns text
language plpgsql as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', case when p_actor is null then '{"role":"authenticated"}'
    else jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text end, true);
  perform set_config('role', 'authenticated', true);
  execute p_statement into result;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(result, 'ok');
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;

create function pg_temp.ro29_reorder_sql(p_version uuid, p_parent uuid, p_ids uuid[]) returns text language sql as $$
  select format('select public.reorder_estimate_items(%L, %L, %L)::text', p_version, p_parent, p_ids)
$$;

create function pg_temp.ro29_move_sql(p_version uuid, p_item uuid, p_from uuid, p_to uuid, p_source uuid[], p_target uuid[])
returns text language sql as $$
  select format('select public.move_estimate_item(%L, %L, %L, %L, %L, %L)::text',
    p_version, p_item, p_from, p_to, p_source, p_target)
$$;

-- Updates of estimate_versions so far in this transaction: the per-row bump updated the version once per write.
create function pg_temp.ro29_version_updates() returns bigint language sql as $$
  select coalesce(sum(t.n_tup_upd), 0)::bigint from pg_stat_xact_user_tables t
  where t.schemaname = 'public' and t.relname = 'estimate_versions'
$$;

-- One prepared statement by the owner, measured and rolled back.
create function pg_temp.ro29_measure(p_operation text, p_run integer, p_statement text)
returns void language plpgsql as $$
declare
  started_at timestamptz;
  duration numeric;
  updates_before bigint;
  updates bigint;
  outcome text;
begin
  begin
    updates_before := pg_temp.ro29_version_updates();
    started_at := clock_timestamp();
    outcome := pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', p_statement);
    duration := round(extract(epoch from clock_timestamp() - started_at) * 1000, 1);
    updates := pg_temp.ro29_version_updates() - updates_before;
    raise exception using errcode = 'P0001', message = 'RO29_ROLLBACK';
  exception when others then
    insert into ro29_sample values (p_operation, p_run,
      case when sqlerrm = 'RO29_ROLLBACK' then outcome else sqlstate || ' ' || sqlerrm end, duration, updates);
  end;
end
$$;

create function pg_temp.ro29_median(p_operation text) returns numeric language sql as $$
  select percentile_cont(0.5) within group (order by duration_ms)::numeric from ro29_sample where operation = p_operation
$$;
create function pg_temp.ro29_report(p_operation text) returns text language sql as $$
  select format('%s: median %s ms over %s runs (%s), budget %s ms', p_operation,
    pg_temp.ro29_median(p_operation), count(*), string_agg(duration_ms::text, ' ' order by run),
    (select budget_ms from ro29_budget))
  from ro29_sample where operation = p_operation
$$;
