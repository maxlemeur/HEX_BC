-- Lot 2, sub-lot 2.10b (M8): engine 3 becomes the engine of new estimate versions for a tenant without a
-- calculation policy row (design docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md §6.1 M8,
-- D3, D17, P-02, P-07). Owner approval of M8: 18/10/2026, recorded in docs/testing/estimate-engine-v3-2.10.md
-- (D-j). Contract, failure modes and proofs: that document.
--
-- public.persist_estimate_creation_atomic is copied from its live definition (20261018013249, M6b; the
-- preflight checks the md5 of that body) with exactly three lines changed:
-- 1. the engine of an absent policy row: coalesce(policy_row.new_estimate_calc_engine, 3) instead of 2;
-- 2. the FO sale coefficient of a v3 falls back to 1.3000 when no policy row gives one (P-02);
-- 3. the MO sale coefficient of a v3 falls back to 1.2000 likewise (P-02).
-- Unchanged on purpose: an absent client expectation still means 2 (an old bundle fails closed with
-- ESTIMATE_CALC_POLICY_CONTEXT_CHANGED, nothing written); an explicit policy row 2 still creates a v2 (the
-- per-tenant opt-out and rollback lever, written by the team through set_tenant_calc_policy); an explicit
-- row 3 keeps its own coefficients; duplication keeps the engine of its source and never reads the policy;
-- the column default tenant_calc_policies.new_estimate_calc_engine stays 2 (a default of 3 would violate
-- tenant_calc_policies_v3_requires_defaults); the v3 freeze already falls back to {2000,1000,550,210}.
-- CREATE OR REPLACE keeps owner and ACL. No policy row is written and no existing row is updated (D17).
begin;

do $preflight$
declare
  live_body text;
begin
  select procedure.prosrc into live_body
  from pg_catalog.pg_proc procedure
  where procedure.oid = to_regprocedure('public.persist_estimate_creation_atomic(uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid)');
  if live_body is null
    or to_regclass('public.tenant_calc_policies') is null
    or pg_catalog.md5(live_body) <> '6243492d352f478c04018d308b3f26d4'
  then
    raise exception 'LOT2_2_10_M8_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

create or replace function public.persist_estimate_creation_atomic(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_project_id uuid,
  p_project_payload jsonb,
  p_version_payload jsonb,
  p_items jsonb,
  p_import_id uuid default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  actor_user_id uuid := p_actor_user_id;
  actor_role public.tenant_role;
  project_row public.estimate_projects%rowtype;
  version_row public.estimate_versions%rowtype;
  import_row public.dpgf_imports%rowtype;
  import_claimed_rows integer := 0;
  item_total_ht bigint := 0;
  item_total_tax bigint := 0;
  item_total_ttc bigint := 0;
  next_version_number integer;
  version_contractor_role text;
  previous_insert_contract text;
  policy_row public.tenant_calc_policies%rowtype;
  policy_engine smallint;
  creates_v3 boolean;
  previous_v3_writer text;
  previous_creation_contract text;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select membership.role
    into actor_role
  from public.tenant_memberships membership
  join public.tenants tenant
    on tenant.id = membership.tenant_id
   and tenant.is_active
  where membership.tenant_id = p_tenant_id
    and membership.user_id = actor_user_id;

  if actor_user_id is null
    or p_tenant_id is null
    or actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_CREATION_ROLE_REQUIRED';
  end if;

  if p_version_payload is null
    or jsonb_typeof(p_version_payload) <> 'object'
    or p_version_payload - array[
      'id',
      'title',
      'date_devis',
      'validite_jours',
      'margin_multiplier',
      'margin_mode',
      'currency',
      'margin_bp',
      'discount_bp',
      'discount_amount_cents',
      'discount_mode',
      'discount_steps',
      'global_coefficient',
      'tax_rate_bp',
      'rounding_mode',
      'rounding_step_cents',
      'max_section_depth',
      'calc_engine_version',
      'contractor_role',
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents',
      'sale_coefficient_fo',
      'sale_coefficient_mo',
      'gross_ht_cents',
      'discount_applied_cents',
      'commercial_rounding_cents'
    ] <> '{}'::jsonb
    or coalesce(
      (p_version_payload->>'calc_engine_version')::smallint,
      2
    ) not in (1, 2, 3)
    or coalesce(
      nullif(btrim(p_version_payload->>'contractor_role'), ''),
      'principal'
    ) not in ('principal', 'subcontractor')
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  -- Lot 2, sub-lot 2.5 (D3): the engine is decided by the tenant policy, never by the
  -- client, which only states the engine its projections expect (absent = 2).
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant_id::text, 0)
  );
  select policy.*
    into policy_row
  from public.tenant_calc_policies policy
  where policy.tenant_id = p_tenant_id
  for share;
  policy_engine := coalesce(policy_row.new_estimate_calc_engine, 3);
  if coalesce((p_version_payload->>'calc_engine_version')::smallint, 2) <> policy_engine then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_CALC_POLICY_CONTEXT_CHANGED';
  end if;
  creates_v3 := policy_engine = 3;

  if not creates_v3
    and exists (
      select 1
      from jsonb_each(p_version_payload) entry
      where entry.key in (
          'sale_coefficient_fo', 'sale_coefficient_mo', 'gross_ht_cents',
          'discount_applied_cents', 'commercial_rounding_cents'
        )
        and entry.value <> 'null'::jsonb
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if creates_v3 and (
      exists (
        select 1
        from jsonb_each(p_version_payload) entry
        where entry.key in ('sale_coefficient_fo', 'sale_coefficient_mo')
          and entry.value <> 'null'::jsonb
          and (
            jsonb_typeof(entry.value) <> 'number'
            or entry.value::text::numeric <= 0
            or entry.value::text::numeric > 10
            or pg_catalog.min_scale(entry.value::text::numeric) > 4
          )
      )
      or exists (
        select 1
        from unnest(array['gross_ht_cents', 'discount_applied_cents', 'commercial_rounding_cents']) as required(key)
        where jsonb_typeof(p_version_payload->required.key) is distinct from 'number'
          or p_version_payload->>required.key !~ '^[0-9]+$'
          or (p_version_payload->>required.key)::numeric > 2147483647
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_PAYLOAD_INVALID';
  end if;

  if p_version_payload ? 'discount_amount_cents'
    and p_version_payload->'discount_amount_cents' <> 'null'::jsonb then
    if jsonb_typeof(p_version_payload->'discount_amount_cents') <> 'number'
      or p_version_payload->>'discount_amount_cents' !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
    if (p_version_payload->>'discount_amount_cents')::numeric > 2147483647
      or p_version_payload->>'discount_mode' is distinct from 'simple'
      or coalesce(jsonb_array_length(p_version_payload->'discount_steps'),0) <> 0 then
      raise exception using errcode='22023',message='ESTIMATE_VERSION_PAYLOAD_INVALID';
    end if;
  end if;

  version_contractor_role := coalesce(
    nullif(btrim(p_version_payload->>'contractor_role'), ''),
    'principal'
  )::text;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_PAYLOAD_INVALID';
  end if;

  -- The hierarchy check (replayed after the insert since M6b) and the coverage
  -- replay rely on the accepted payload order, made explicit before any
  -- project/import mutation: every child must follow its section parent in the
  -- payload and every payload id must be unique and concrete.
  if exists (
    with payload_item as (
      select
        entry.ordinality,
        (entry.value->>'id')::uuid as id,
        (entry.value->>'parent_id')::uuid as parent_id,
        entry.value->>'item_type' as item_type
      from jsonb_array_elements(p_items) with ordinality
        as entry(value, ordinality)
    )
    select 1
    from payload_item as child
    left join payload_item as parent on parent.id = child.parent_id
    where child.id is null
      or child.item_type is null
      or child.item_type not in ('section', 'line')
      or (child.item_type = 'line' and child.parent_id is null)
      or (
        child.parent_id is not null
        and (
          parent.id is null
          or parent.item_type <> 'section'
          or parent.ordinality >= child.ordinality
        )
      )
    union all
    select 1
    from payload_item
    group by payload_item.id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEMS_HIERARCHY_INVALID';
  end if;

  if p_import_id is not null then
    select source_import.*
      into import_row
    from public.dpgf_imports as source_import
    where source_import.id = p_import_id
      and source_import.tenant_id = p_tenant_id
      and (
        source_import.user_id = actor_user_id
        or actor_role = 'admin'::public.tenant_role
      )
    for update;

    if import_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'DPGF_IMPORT_NOT_WRITABLE';
    end if;

    if import_row.project_id is not null
      and (
        p_project_id is null
        or import_row.project_id <> p_project_id
      )
    then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  if (p_version_payload->>'total_ht_cents') is null
    or (p_version_payload->>'total_tax_cents') is null
    or (p_version_payload->>'total_ttc_cents') is null
    or (p_version_payload->>'total_ht_cents')::integer < 0
    or (p_version_payload->>'total_tax_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer < 0
    or (p_version_payload->>'total_ttc_cents')::integer <>
      (p_version_payload->>'total_ht_cents')::integer
      + (p_version_payload->>'total_tax_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_INVALID';
  end if;

  if version_contractor_role = 'subcontractor'
    and (
      (p_version_payload->>'total_tax_cents')::integer <> 0
      or (p_version_payload->>'total_ttc_cents')::integer <>
        (p_version_payload->>'total_ht_cents')::integer
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_REVERSE_CHARGE_TOTALS_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      item_type public.estimate_item_type,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    )
    where item.item_type = 'line'
      and (
        item.line_total_ht_cents is null
        or item.line_tax_cents is null
        or item.line_total_ttc_cents is null
        or item.line_total_ht_cents < 0
        or item.line_tax_cents < 0
        or item.line_total_ttc_cents < 0
        or item.line_total_ttc_cents <>
          item.line_total_ht_cents + item.line_tax_cents
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_ITEM_TOTALS_INVALID';
  end if;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0),
    coalesce(sum(item.line_total_ttc_cents), 0)
    into item_total_ht, item_total_tax, item_total_ttc
  from jsonb_to_recordset(p_items) as item(
    item_type public.estimate_item_type,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  )
  where item.item_type = 'line'::public.estimate_item_type;

  if item_total_ht <> (p_version_payload->>'total_ht_cents')::integer
    or item_total_tax <> (p_version_payload->>'total_tax_cents')::integer
    or item_total_ttc <> (p_version_payload->>'total_ttc_cents')::integer
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_VERSION_TOTALS_DO_NOT_MATCH_ITEMS';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      source_job_id uuid
    )
    left join public.estimate_categories category
      on category.id = item.category_id
     and category.tenant_id = p_tenant_id
    left join public.supply_types supply_type
      on supply_type.id = item.supply_type_id
     and supply_type.tenant_id = p_tenant_id
    left join public.supplier_pricebook supplier_price
      on supplier_price.id = item.selected_supplier_price_id
     and supplier_price.tenant_id = p_tenant_id
    left join public.takeoff_jobs source_job
      on source_job.id = item.source_job_id
     and source_job.tenant_id = p_tenant_id
    where (item.category_id is not null and category.id is null)
      or (item.supply_type_id is not null and supply_type.id is null)
      or (
        item.selected_supplier_price_id is not null
        and supplier_price.id is null
      )
      or (item.source_job_id is not null and source_job.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_ITEM_REFERENCE_TENANT_MISMATCH';
  end if;

  if p_project_id is null then
    if p_project_payload is null
      or jsonb_typeof(p_project_payload) <> 'object'
      or p_project_payload - array[
        'id',
        'name',
        'reference',
        'client_name',
        'notes'
      ] <> '{}'::jsonb
      or btrim(coalesce(p_project_payload->>'name', '')) = ''
    then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_PAYLOAD_INVALID';
    end if;

    insert into public.estimate_projects (
      id,
      tenant_id,
      user_id,
      name,
      reference,
      client_name,
      notes,
      is_archived
    )
    values (
      (p_project_payload->>'id')::uuid,
      p_tenant_id,
      actor_user_id,
      btrim(p_project_payload->>'name'),
      nullif(btrim(p_project_payload->>'reference'), ''),
      nullif(btrim(p_project_payload->>'client_name'), ''),
      nullif(btrim(p_project_payload->>'notes'), ''),
      false
    )
    returning * into project_row;

    next_version_number := 1;
  else
    if p_project_payload is not null then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_PROJECT_SELECTOR_INVALID';
    end if;

    select project.*
      into project_row
    from public.estimate_projects as project
    where project.id = p_project_id
      and project.tenant_id = p_tenant_id
    for update;

    if project_row.id is null
      or project_row.is_archived
      or (
        project_row.user_id <> actor_user_id
        and actor_role <> 'admin'::public.tenant_role
      )
    then
      raise exception using
        errcode = '42501',
        message = 'ESTIMATE_PROJECT_NOT_WRITABLE';
    end if;

    select coalesce(max(version.version_number), 0) + 1
      into next_version_number
    from public.estimate_versions as version
    where version.project_id = project_row.id
      and version.tenant_id = p_tenant_id;
  end if;

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from (
      select item.labor_role_id as role_id
      from jsonb_to_recordset(p_items) as item(labor_role_id uuid)
      union
      select item.labor_role_atelier_id
      from jsonb_to_recordset(p_items) as item(labor_role_atelier_id uuid)
      union
      select item.labor_role_chantier_id
      from jsonb_to_recordset(p_items) as item(labor_role_chantier_id uuid)
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      labor_role_id uuid,
      labor_role_atelier_id uuid,
      labor_role_chantier_id uuid
    )
    left join public.labor_roles labor_role
      on labor_role.id = item.labor_role_id
     and labor_role.tenant_id = p_tenant_id
     and labor_role.user_id = project_row.user_id
    left join public.labor_roles atelier_role
      on atelier_role.id = item.labor_role_atelier_id
     and atelier_role.tenant_id = p_tenant_id
     and atelier_role.user_id = project_row.user_id
    left join public.labor_roles chantier_role
      on chantier_role.id = item.labor_role_chantier_id
     and chantier_role.tenant_id = p_tenant_id
     and chantier_role.user_id = project_row.user_id
    where (item.labor_role_id is not null and labor_role.id is null)
      or (item.labor_role_atelier_id is not null and atelier_role.id is null)
      or (item.labor_role_chantier_id is not null and chantier_role.id is null)
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  if import_row.id is not null and import_row.project_id is null then
    update public.dpgf_imports as source_import
    set project_id = project_row.id
    where source_import.id = import_row.id
      and source_import.tenant_id = p_tenant_id
      and source_import.project_id is null;

    get diagnostics import_claimed_rows = row_count;
    if import_claimed_rows <> 1 then
      raise exception using
        errcode = '23505',
        message = 'DPGF_IMPORT_ALREADY_LINKED';
    end if;
  end if;

  previous_insert_contract := coalesce(
    pg_catalog.current_setting(
      'miaouffrage.estimate_version_insert_contract',
      true
    ),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    case when creates_v3 then 'canonical_v3' else 'canonical_v2' end,
    true
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_amount_cents,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    max_section_depth,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    sale_coefficient_fo,
    sale_coefficient_mo,
    gross_ht_cents,
    discount_applied_cents,
    commercial_rounding_cents
  )
  values (
    (p_version_payload->>'id')::uuid,
    p_tenant_id,
    project_row.id,
    next_version_number,
    'draft'::public.estimate_status,
    nullif(btrim(p_version_payload->>'title'), ''),
    (p_version_payload->>'date_devis')::date,
    (p_version_payload->>'validite_jours')::integer,
    (p_version_payload->>'margin_multiplier')::numeric,
    (p_version_payload->>'margin_mode')::public.estimate_margin_mode,
    p_version_payload->>'currency',
    (p_version_payload->>'margin_bp')::integer,
    (p_version_payload->>'discount_bp')::integer,
    (p_version_payload->>'discount_amount_cents')::integer,
    (p_version_payload->>'discount_mode')::public.estimate_discount_mode,
    array(
      select discount_step.value::integer
      from jsonb_array_elements_text(p_version_payload->'discount_steps')
        as discount_step(value)
    ),
    (p_version_payload->>'global_coefficient')::numeric,
    (p_version_payload->>'tax_rate_bp')::integer,
    (p_version_payload->>'rounding_mode')::public.estimate_rounding_mode,
    (p_version_payload->>'rounding_step_cents')::integer,
    (p_version_payload->>'max_section_depth')::integer,
    policy_engine,
    version_contractor_role::text,
    (p_version_payload->>'total_ht_cents')::integer,
    (p_version_payload->>'total_tax_cents')::integer,
    (p_version_payload->>'total_ttc_cents')::integer,
    case when creates_v3 then coalesce(
      (p_version_payload->>'sale_coefficient_fo')::numeric,
      policy_row.default_sale_coefficient_fo,
      1.3000
    ) end,
    case when creates_v3 then coalesce(
      (p_version_payload->>'sale_coefficient_mo')::numeric,
      policy_row.default_sale_coefficient_mo,
      1.2000
    ) end,
    case when creates_v3 then (p_version_payload->>'gross_ht_cents')::integer end,
    case when creates_v3 then (p_version_payload->>'discount_applied_cents')::integer end,
    case when creates_v3 then (p_version_payload->>'commercial_rounding_cents')::integer end
  )
  returning * into version_row;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_version_insert_contract',
    previous_insert_contract,
    true
  );

  previous_v3_writer := coalesce(
    pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
    ''
  );
  if creates_v3 then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      version_row.id::text,
      true
    );
  end if;

  if jsonb_array_length(p_items) > 0 then
    -- Lot 2, sub-lot 2.8 (M6b): under the creation contract of this version, the per-line triggers
    -- (content revision, audit, source coverage, depth) leave its items to one replay, in payload
    -- order, at the end of the insert.
    previous_creation_contract := coalesce(
      pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true),
      ''
    );
    perform pg_catalog.set_config(
      'miaouffrage.estimate_creation_atomic',
      version_row.id::text,
      true
    );
    insert into public.estimate_items (
      id,
      tenant_id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      description,
      quantity,
      unit_price_ht_cents,
      tax_rate_bp,
      k_fo,
      h_mo,
      h_mo_majoration,
      k_mo,
      h_mo_atelier,
      k_mo_atelier,
      labor_role_atelier_id,
      h_mo_chantier,
      k_mo_chantier,
      labor_role_chantier_id,
      pu_ht_cents,
      labor_role_id,
      category_id,
      supply_type_id,
      selected_supplier_price_id,
      source_provider,
      source_job_id,
      source_file_name,
      source_page,
      source_metadata,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents,
      unit_code,
      pricing_status,
      h_mo_per_unit,
      h_mo_atelier_per_unit,
      h_mo_chantier_per_unit
    )
    select
      coalesce(item.id, gen_random_uuid()),
      p_tenant_id,
      version_row.id,
      item.parent_id,
      item.item_type,
      item.position,
      item.title,
      item.description,
      item.quantity,
      item.unit_price_ht_cents,
      item.tax_rate_bp,
      item.k_fo,
      item.h_mo,
      coalesce(item.h_mo_majoration, 1),
      item.k_mo,
      item.h_mo_atelier,
      coalesce(item.k_mo_atelier, 1),
      item.labor_role_atelier_id,
      item.h_mo_chantier,
      coalesce(item.k_mo_chantier, 1),
      item.labor_role_chantier_id,
      item.pu_ht_cents,
      item.labor_role_id,
      item.category_id,
      item.supply_type_id,
      item.selected_supplier_price_id,
      item.source_provider,
      item.source_job_id,
      item.source_file_name,
      item.source_page,
      coalesce(item.source_metadata, '{}'::jsonb),
      item.line_total_ht_cents,
      item.line_tax_cents,
      item.line_total_ttc_cents,
      item.unit_code,
      coalesce(item.pricing_status, 'priced'::public.estimate_line_pricing_status),
      item.h_mo_per_unit,
      item.h_mo_atelier_per_unit,
      item.h_mo_chantier_per_unit
    from jsonb_to_recordset(p_items) as item(
      id uuid,
      parent_id uuid,
      item_type public.estimate_item_type,
      position integer,
      title text,
      description text,
      quantity numeric,
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric,
      h_mo numeric,
      h_mo_majoration numeric,
      k_mo numeric,
      h_mo_atelier numeric,
      k_mo_atelier numeric,
      labor_role_atelier_id uuid,
      h_mo_chantier numeric,
      k_mo_chantier numeric,
      labor_role_chantier_id uuid,
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      source_provider text,
      source_job_id uuid,
      source_file_name text,
      source_page integer,
      source_metadata jsonb,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer,
      unit_code text,
      pricing_status public.estimate_line_pricing_status,
      h_mo_per_unit numeric,
      h_mo_atelier_per_unit numeric,
      h_mo_chantier_per_unit numeric
    );
    perform public.estimate_creation_replay_item_effects_for_writer(
      version_row.id,
      array(
        select (entry.value->>'id')::uuid
        from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality)
        order by entry.ordinality
      )
    );
    perform pg_catalog.set_config(
      'miaouffrage.estimate_creation_atomic',
      previous_creation_contract,
      true
    );
  end if;

  if creates_v3 then
    perform public.estimate_v3_assert_draft_for_writer(version_row.id);
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v3_writer',
      previous_v3_writer,
      true
    );
  end if;

  return jsonb_build_object(
    'project', to_jsonb(project_row),
    'version', to_jsonb(version_row)
  );
end;
$$;

comment on table public.tenant_calc_policies is
  'Typed tenant calculation policy (lot 2, D3): engine of new estimate versions (absent row = 3 since M8, sub-lot 2.10; an explicit row 2 keeps engine 2), default v3 sale coefficients (absent row: 1.30 FO, 1.20 MO), VAT rates allowed at the v3 freeze, reason and author. Written only by public.set_tenant_calc_policy (service_role, P-13).';

do $postflight$
begin
  if pg_catalog.md5((select procedure.prosrc from pg_catalog.pg_proc procedure
      where procedure.oid = 'public.persist_estimate_creation_atomic(uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid)'::regprocedure))
    <> '7167bf9a7a81b90a4b830a4abc550341'
  then
    raise exception 'LOT2_2_10_M8_DEFINITION_MISMATCH';
  end if;
end;
$postflight$;

commit;
