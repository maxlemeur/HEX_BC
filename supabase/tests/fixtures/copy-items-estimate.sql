-- Shared fixture of the v1/v2 copy probes (included with \ir, not a test file):
-- supabase/tests/database/estimate-copy-items-atomic.test.sql (every run) and
-- supabase/tests/budget/estimate-copy-statement-budget.test.sql (opt-in wall-clock budget).
-- Contract: docs/testing/copy-large-v2.md. Runs inside the caller's transaction.
-- Users: 01 owner (engineer) of the affaire, 02 admin, 03 engineer and 04 viewer of the owner's tenant, 05 outsider.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', ('29300000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated',
  'authenticated', 'copy-items-' || n || '@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from generate_series(1, 5) n;
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '29300000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select tenant_id::text from public.tenant_memberships
  where user_id = '29300000-0000-4000-8000-000000000001' limit 1), true);
insert into public.tenant_memberships (tenant_id, user_id, role)
select current_setting('test.tenant_id')::uuid, member.user_id, member.role
from (values ('29300000-0000-4000-8000-000000000002'::uuid, 'admin'::public.tenant_role),
  ('29300000-0000-4000-8000-000000000003'::uuid, 'engineer'::public.tenant_role),
  ('29300000-0000-4000-8000-000000000004'::uuid, 'viewer'::public.tenant_role)) as member(user_id, role);
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('29300000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
   '29300000-0000-4000-8000-000000000001', 'CP29 affaire');
-- The copies under test write v1/v2 drafts. Since M8 a tenant without a policy row creates engine 3, so the tenant
-- starts at the explicit policy 2 (the per-tenant opt-out).
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 2::smallint, p_default_sale_coefficient_fo => null, p_default_sale_coefficient_mo => null,
  p_allowed_tax_rates_bp => null, p_change_reason => 'CP29 v2 copies', p_actor_user_id => '29300000-0000-4000-8000-000000000001')
  is not null as v2_policy;
-- Three labor roles of the owner, so that every copied column of a line carries a distinct value.
insert into public.labor_roles (id, tenant_id, user_id, name, hourly_rate_cents)
select ('29300000-0000-4000-8000-00000000040' || n)::uuid, current_setting('test.tenant_id')::uuid,
  '29300000-0000-4000-8000-000000000001', 'CP29 rôle ' || n, 4000 + n
from generate_series(1, 3) n;

create temporary table cp29_budget as select 330::numeric as budget_ms, clock_timestamp() as started_at;
create temporary table cp29_sample (operation text, run integer, outcome text, duration_ms numeric, updates bigint);
grant all on cp29_sample to authenticated;
grant select on cp29_budget to authenticated;

-- A v2 draft of the affaire with `p_lines` lines under one section titled 'Lot', created atomically by its owner
-- (line g: 1 u at 5·g cents, 20 % VAT, stored totals as given; the other copied columns hold distinct values).
-- Its draft lock, held by `p_holder` under session `p_session`.
create function pg_temp.cp29_version(p_id uuid, p_lines integer, p_holder uuid, p_session uuid) returns uuid
language plpgsql as $$
declare
  section_id uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000010', null,
    jsonb_build_object('id', p_id, 'title', 'CP29', 'date_devis', current_date, 'validite_jours', 30,
      'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
      'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1, 'tax_rate_bp', 2000,
      'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3, 'contractor_role', 'principal',
      'calc_engine_version', 2, 'total_ht_cents', 5 * p_lines * (p_lines + 1) / 2,
      'total_tax_cents', p_lines * (p_lines + 1) / 2, 'total_ttc_cents', 6 * p_lines * (p_lines + 1) / 2),
    case when p_lines = 0 then '[]'::jsonb else (
      select jsonb_build_array(jsonb_build_object('id', section_id, 'parent_id', null, 'item_type', 'section',
          'position', 1, 'title', 'Lot'))
        || jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'parent_id', section_id, 'item_type', 'line',
          'position', g, 'title', 'Lot ligne ' || g, 'description', 'u', 'quantity', 1, 'unit_price_ht_cents', 5 * g,
          'tax_rate_bp', 2000, 'k_fo', 1, 'h_mo', 0, 'h_mo_majoration', 1, 'k_mo', 1, 'pu_ht_cents', 5 * g,
          'line_total_ht_cents', 5 * g, 'line_tax_cents', g, 'line_total_ttc_cents', 6 * g,
          'aid', 'CP-' || g, 'h_mo_atelier', 0.5, 'k_mo_atelier', 1.2, 'h_mo_chantier', 0.25, 'k_mo_chantier', 1.1,
          'labor_role_id', '29300000-0000-4000-8000-000000000401',
          'labor_role_atelier_id', '29300000-0000-4000-8000-000000000402',
          'labor_role_chantier_id', '29300000-0000-4000-8000-000000000403',
          'source_file_name', 'CP29.xlsx', 'source_page', g,
          'source_provider', 'dpgf', 'source_metadata', jsonb_build_object('row_index', g)) order by g)
      from generate_series(1, p_lines) g) end, null);
  perform set_config('role', 'none', true);
  insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
  values (p_id, p_holder, current_setting('test.tenant_id')::uuid, statement_timestamp() + interval '30 minutes', p_session);
  return case when p_lines = 0 then null else section_id end;
end
$$;

-- The copied row as the estimate API builds it (buildImportedEstimateItemInsert): every copied column, plus the
-- target tenant and version.
create function pg_temp.cp29_item(p_item public.estimate_items, p_version uuid, p_id uuid, p_parent uuid,
  p_position integer, p_title text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'tenant_id', p_item.tenant_id, 'version_id', p_version, 'parent_id', p_parent,
    'item_type', p_item.item_type, 'position', p_position, 'title', p_title, 'aid', p_item.aid,
    'description', p_item.description, 'quantity', p_item.quantity, 'unit_price_ht_cents', p_item.unit_price_ht_cents,
    'tax_rate_bp', p_item.tax_rate_bp, 'k_fo', p_item.k_fo, 'h_mo', p_item.h_mo, 'h_mo_majoration', p_item.h_mo_majoration,
    'k_mo', p_item.k_mo, 'h_mo_atelier', p_item.h_mo_atelier, 'k_mo_atelier', p_item.k_mo_atelier,
    'labor_role_atelier_id', p_item.labor_role_atelier_id, 'h_mo_chantier', p_item.h_mo_chantier,
    'k_mo_chantier', p_item.k_mo_chantier, 'labor_role_chantier_id', p_item.labor_role_chantier_id,
    'pu_ht_cents', p_item.pu_ht_cents, 'labor_role_id', p_item.labor_role_id, 'category_id', p_item.category_id,
    'supply_type_id', p_item.supply_type_id, 'selected_supplier_price_id', p_item.selected_supplier_price_id,
    'source_provider', p_item.source_provider, 'source_job_id', p_item.source_job_id,
    'source_file_name', p_item.source_file_name, 'source_page', p_item.source_page,
    'source_metadata', p_item.source_metadata, 'line_total_ht_cents', p_item.line_total_ht_cents,
    'line_tax_cents', p_item.line_tax_cents, 'line_total_ttc_cents', p_item.line_total_ttc_cents)
$$;

-- The copy of section `p_section` and its lines into `p_version`: a new root section at `p_root_position`, or, with
-- `p_parent`, its lines only, appended under that section after position `p_offset` (a merge).
create function pg_temp.cp29_copy(p_section uuid, p_version uuid, p_root_position integer,
  p_parent uuid default null, p_offset integer default 0) returns jsonb language sql volatile as $$
  with root as (select gen_random_uuid() as id)
  select jsonb_agg(entry.item order by entry.ord)
  from (
    select 0 as ord, pg_temp.cp29_item(section, p_version, root.id, null, p_root_position, section.title || ' (copie)') as item
    from public.estimate_items section, root
    where section.id = p_section and p_parent is null
    union all
    select line.position, pg_temp.cp29_item(line, p_version, gen_random_uuid(), coalesce(p_parent, root.id),
      line.position + p_offset, line.title)
    from public.estimate_items line, root
    where line.parent_id = p_section
  ) entry
$$;

-- One call as `p_actor` through the API role (null: no user); its outcome, the version kept unless the call fails.
create function pg_temp.cp29_call(p_actor uuid, p_version uuid, p_session uuid, p_items jsonb) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.copy_estimate_items_atomic(p_version, p_session, p_items);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;

create function pg_temp.cp29_updates() returns bigint language sql as $$
  select coalesce(sum(t.n_tup_upd), 0)::bigint from pg_stat_xact_user_tables t
  where t.schemaname = 'public' and t.relname = 'estimate_versions'
$$;

-- One copy of a prepared payload by the owner, measured and rolled back.
create function pg_temp.cp29_measure(p_operation text, p_run integer, p_version uuid, p_session uuid, p_items jsonb)
returns void language plpgsql as $$
declare
  started_at timestamptz;
  duration numeric;
  updates_before bigint;
  updates bigint;
  outcome text;
begin
  begin
    updates_before := pg_temp.cp29_updates();
    started_at := clock_timestamp();
    outcome := pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', p_version, p_session, p_items);
    duration := round(extract(epoch from clock_timestamp() - started_at) * 1000, 1);
    updates := pg_temp.cp29_updates() - updates_before;
    raise exception using errcode = 'P0001', message = 'CP29_ROLLBACK';
  exception when others then
    insert into cp29_sample values (p_operation, p_run,
      case when sqlerrm = 'CP29_ROLLBACK' then outcome else sqlstate || ' ' || sqlerrm end, duration, updates);
  end;
end
$$;

create function pg_temp.cp29_median(p_operation text) returns numeric language sql as $$
  select percentile_cont(0.5) within group (order by duration_ms)::numeric from cp29_sample where operation = p_operation
$$;
create function pg_temp.cp29_report(p_operation text) returns text language sql as $$
  select format('%s: median %s ms over %s runs (%s), budget %s ms', p_operation,
    pg_temp.cp29_median(p_operation), count(*), string_agg(duration_ms::text, ' ' order by run),
    (select budget_ms from cp29_budget))
  from cp29_sample where operation = p_operation
$$;
