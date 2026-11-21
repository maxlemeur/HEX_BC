-- Lot 2 of the takeoff, sending a reviewed analysis to the estimate when the affaire may have no estimate yet (M2).
-- Forward-only; no row is changed or deleted. While it is applied the previous application still runs: it never
-- calls the new command, never reads the new tables. The one write this migration refuses that a release still offers
-- is « Fusionner » onto an ordinary line: the writer now refuses it for every entry. v0.8.0 is the first release whose
-- screen refuses it before sending (merge-overwrites.ts); v0.7.0's wizard still offers it, and would receive a 409
-- « Conflit lors de l'application du job takeoff. » with nothing applied. Deploy v0.8.0 or later before applying this
-- migration. Drain the takeoff application requests (« Envoyer au tableau de chiffrage ») while it is applied.
begin;

set local lock_timeout = '5s';

-- 1. The canonical creation of a version, callable from the guarded send command below (a SECURITY DEFINER function
-- owned by postgres) so that a first draft is created inside the transaction that sends to it. The only change to the
-- body is its first check, which admitted the service role alone; API roles still have no grant on it.
create or replace function public.persist_estimate_creation_atomic(p_tenant_id uuid, p_actor_user_id uuid, p_project_id uuid, p_project_payload jsonb, p_version_payload jsonb, p_items jsonb, p_import_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if current_user not in ('service_role', 'postgres') then
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
    from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
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
  from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
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
    from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      fo_price_origin jsonb,
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
      from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(labor_role_id uuid)
      union
      select item.labor_role_atelier_id
      from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(labor_role_atelier_id uuid)
      union
      select item.labor_role_chantier_id
      from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(labor_role_chantier_id uuid)
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
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
      k_fo_manual,
      line_nature,
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
      selected_supplier_price_id,fo_price_origin,
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
      item.k_fo_manual,
      item.line_nature,
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
      item.selected_supplier_price_id,item.fo_price_origin,
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
    from jsonb_to_recordset(public.estimate_fo_price_origin_write_input(p_items)) as item(
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
      k_fo_manual boolean,
      line_nature public.estimate_line_nature,
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
      fo_price_origin jsonb,
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
$function$

;

-- 2. « Fusionner » onto an ordinary line, refused by the writer itself (until now only the screen refused it,
-- src/lib/takeoff/merge-overwrites.ts). Every guarded entry (the two overloads of apply_takeoff_job_guarded_atomic and
-- apply_takeoff_job_with_page_decisions) reaches the lines through public.apply_takeoff_job_atomic: the writer keeps its
-- body under a private name, and this entry checks what it did, under the locks it took. A line of the target section
-- the merge matched by title and unit is overwritten only when it is a DPGF line (the refusals of TI-716 and TI-723 that
-- follow the writer decide) or an earlier line of a page this takeoff reads (its page decision decides, TI-682 D). A forced
-- quantity (admin override) is never read as consent: the override does not reach this check.
alter function public.apply_takeoff_job_atomic(uuid, text, uuid, jsonb) rename to takeoff_apply_atomic_writer;
alter function public.takeoff_apply_atomic_writer(uuid, text, uuid, jsonb) set schema private;
revoke all on function private.takeoff_apply_atomic_writer(uuid, text, uuid, jsonb) from public, anon, authenticated, service_role;

create function public.apply_takeoff_job_atomic(p_job_id uuid, p_strategy text, p_target_section_id uuid, p_mapping_plan jsonb)
returns table (created_count integer, updated_count integer, ignored_count integer, created_ids uuid[], scope text, item_links jsonb)
language plpgsql security definer set search_path = pg_catalog as $$
declare
  merging boolean := lower(btrim(coalesce(p_strategy, ''))) = 'merge';
  job_version_id uuid;
  job_tenant_id uuid;
  written record;
  conflict jsonb;
begin
  if merging then
    select job.estimate_version_id, job.tenant_id into job_version_id, job_tenant_id
    from public.takeoff_jobs as job where job.id = p_job_id;
    -- The lines directly under the section, as they are before the writer (the guarded entries hold the version's row).
    drop table if exists pg_temp._takeoff_merge_section_before;
    create temporary table _takeoff_merge_section_before on commit drop as
    select item.id, item.title, item.quantity, item.source_provider,
      coalesce(item.unit_code, (private.normalize_unit(item.description)).unit_code, nullif(btrim(item.description), '')) as unit
    from public.estimate_items as item
    where item.version_id = job_version_id and item.tenant_id = job_tenant_id
      and item.item_type = 'line'::public.estimate_item_type and item.parent_id is not distinct from p_target_section_id;
    -- The earlier lines of the pages this takeoff reads and the pairs of this application's page decisions
    -- (private.takeoff_prepare_page_decisions writes both before the writer): those lines follow the page decisions and
    -- their own refusals (TAKEOFF_PAGE_ALREADY_APPLIED, TAKEOFF_PAGE_REPLACE_CONFLICT).
    create temporary table if not exists _ti682_conflicts (estimate_item_id uuid) on commit drop;
    create temporary table if not exists _ti682_pairs (decision_id uuid, takeoff_item_id uuid, estimate_item_id uuid) on commit drop;
  end if;

  select result.* into written
  from private.takeoff_apply_atomic_writer(p_job_id, p_strategy, p_target_section_id, p_mapping_plan) as result;

  if merging then
    select pg_catalog.jsonb_build_object('reason', 'merge_overwrites_ordinary_line', 'section_id', p_target_section_id,
        'estimate_item_id', before.id, 'title', before.title, 'quantity', pg_catalog.trim_scale(before.quantity),
        'unit', before.unit, 'takeoff_item_id', link.takeoff_item_id, 'designation', source.designation,
        'takeoff_quantity', pg_catalog.trim_scale(source.quantity), 'takeoff_unit', source.unit)
      into conflict
    from pg_catalog.jsonb_to_recordset(coalesce(written.item_links, '[]'::jsonb)) as link(takeoff_item_id uuid, estimate_item_id uuid)
    join pg_temp._takeoff_merge_section_before as before on before.id = link.estimate_item_id
    left join public.takeoff_items as source on source.id = link.takeoff_item_id and source.job_id = p_job_id
    where not link.estimate_item_id = any(coalesce(written.created_ids, '{}'::uuid[]))
      and before.source_provider is distinct from 'dpgf'
      and not exists (select 1 from pg_temp._ti682_pairs as pair
        where pair.takeoff_item_id = link.takeoff_item_id and pair.estimate_item_id = link.estimate_item_id)
      and not exists (select 1 from pg_temp._ti682_conflicts as conflict where conflict.estimate_item_id = link.estimate_item_id)
    order by before.id
    limit 1;
    if conflict is not null then
      raise exception 'TAKEOFF_APPLY_ORDINARY_LINE_CONFLICT' using errcode = '22023', detail = conflict::text;
    end if;
  end if;

  return query select written.created_count, written.updated_count, written.ignored_count, written.created_ids,
    written.scope, written.item_links;
end;
$$;
revoke all on function public.apply_takeoff_job_atomic(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_takeoff_job_atomic(uuid, text, uuid, jsonb) to service_role;

-- 3. The door M1 left closed. A permit is a row of this transaction, issued by public.send_takeoff_job alone, for one
-- job, one affaire and one draft; the identity trigger consumes it (deletes it) when that job's version goes from NULL
-- to that draft. No role has a privilege on the table: an API role cannot issue one, and a permit of another
-- transaction, job or version is never found.
create table private.takeoff_job_attachment_permits (
  job_id uuid primary key references public.takeoff_jobs(id) on delete cascade,
  tenant_id uuid not null,
  project_id uuid not null,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  transaction_id xid8 not null default pg_catalog.pg_current_xact_id(),
  issued_at timestamptz not null default pg_catalog.statement_timestamp()
);
revoke all on table private.takeoff_job_attachment_permits from public, anon, authenticated, service_role;

create or replace function private.has_takeoff_job_version_attachment_permit(
  p_tenant_id uuid, p_project_id uuid, p_job_id uuid, p_version_id uuid
) returns boolean
language plpgsql volatile set search_path = '' as $$
begin
  delete from private.takeoff_job_attachment_permits as permit
  where permit.job_id = p_job_id and permit.tenant_id = p_tenant_id and permit.project_id = p_project_id
    and permit.version_id = p_version_id and permit.transaction_id = pg_catalog.pg_current_xact_id();
  return found;
end;
$$;
revoke all on function private.has_takeoff_job_version_attachment_permit(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- 4. The receipt of a confirmed send: one per command (its request id), one first send per job. Written by
-- public.send_takeoff_job in the transaction of the send, readable through the job; an API role never writes one (the
-- service role keeps its table privileges, as on every public table, but an insert outside the command and any update
-- are refused by triggers; a delete follows its job or version). The
-- write plan and the result are versioned (format_version): a part names its takeoff line, its target (a new line or an
-- earlier line it adds to), the page, the source of its quantity and the revision of its evidence; the result lists
-- apart the sections and the lines actually changed. Later commands derived from a receipt (redistribute, revise a
-- contribution) will be other kinds of command on the same job; none is built here.
create table public.takeoff_send_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  request_id uuid not null,
  command_kind text not null default 'send' check (command_kind = 'send'),
  format_version smallint not null check (format_version = 1),
  actor_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  preview_fingerprint text not null check (preview_fingerprint ~ '^[0-9a-f]{64}$'),
  destination jsonb not null check (pg_catalog.jsonb_typeof(destination) = 'object'),
  target_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  write_plan jsonb not null check (pg_catalog.jsonb_typeof(write_plan) = 'object'),
  result jsonb not null check (pg_catalog.jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  constraint takeoff_send_receipts_project_tenant_fkey foreign key (project_id, tenant_id)
    references public.estimate_projects(id, tenant_id) on delete cascade,
  constraint takeoff_send_receipts_request_key unique (tenant_id, request_id)
);
create unique index takeoff_send_receipts_first_send_key on public.takeoff_send_receipts(job_id) where command_kind = 'send';
create index takeoff_send_receipts_target_idx on public.takeoff_send_receipts(tenant_id, target_version_id);
alter table public.takeoff_send_receipts enable row level security;
revoke all on table public.takeoff_send_receipts from public, anon, authenticated;
grant select on table public.takeoff_send_receipts to authenticated;
grant select, insert, update, delete on table public.takeoff_send_receipts to service_role;
create policy "Readers of the takeoff can select its send receipts" on public.takeoff_send_receipts
  for select to authenticated using ((select private.can_access_takeoff_child(tenant_id, job_id, null, false)));

create function private.guard_takeoff_send_receipt_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT'
    and nullif(pg_catalog.current_setting('mergeone.takeoff_send_receipt', true), '') is not distinct from new.request_id::text then
    return new;
  end if;
  raise exception 'TAKEOFF_SEND_RECEIPT_IMMUTABLE' using errcode = '42501';
end;
$$;
revoke all on function private.guard_takeoff_send_receipt_write() from public, anon, authenticated, service_role;
create trigger guard_takeoff_send_receipt_write before insert or update on public.takeoff_send_receipts
  for each row execute function private.guard_takeoff_send_receipt_write();

-- A receipt leaves only with its job, its version or its affaire (their cascades), never on its own: it proves the
-- send that gives a sent takeoff its readers and its attested plans.
create function private.guard_takeoff_send_receipt_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.takeoff_jobs as job where job.id = old.job_id)
    and exists (select 1 from public.estimate_versions as version where version.id = old.target_version_id)
    and exists (select 1 from public.estimate_projects as project where project.id = old.project_id) then
    raise exception 'TAKEOFF_SEND_RECEIPT_IMMUTABLE' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_takeoff_send_receipt_delete() from public, anon, authenticated, service_role;
create trigger guard_takeoff_send_receipt_delete before delete on public.takeoff_send_receipts
  for each row execute function private.guard_takeoff_send_receipt_delete();

-- 5. Readers. Before the send, a reader of the affaire (its owner, an administrator, a director) reads the job, its
-- children and the plans it attested (M1). Once attached, the version's rule applies, and it admits the owner and the
-- administrators only: a sent job keeps the affaire's readers it had, so that nobody loses it by the send. Only jobs
-- that a receipt proves were sent from the affaire get this branch; a historical versioned job keeps its rule.
create function private.can_read_sent_takeoff_job(p_tenant_id uuid, p_project_id uuid, p_job_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.takeoff_send_receipts as receipt
      where receipt.job_id = p_job_id and receipt.tenant_id = p_tenant_id and receipt.project_id = p_project_id
        and receipt.command_kind = 'send')
    and private.can_access_takeoff_scope(p_tenant_id, p_project_id, null, false)
$$;
revoke all on function private.can_read_sent_takeoff_job(uuid, uuid, uuid) from public, anon;
grant execute on function private.can_read_sent_takeoff_job(uuid, uuid, uuid) to authenticated;

create or replace function private.can_access_takeoff_child(
  p_tenant_id uuid, p_job_id uuid, p_result_id uuid, p_write boolean
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.takeoff_jobs j
    where j.id = p_job_id and j.tenant_id = p_tenant_id
      and (private.can_access_takeoff_scope(j.tenant_id, j.project_id, j.estimate_version_id, p_write)
        or (not p_write and private.can_read_sent_takeoff_job(j.tenant_id, j.project_id, j.id)))
      and (p_result_id is null or exists (
        select 1 from public.takeoff_results r
        where r.id = p_result_id and r.job_id = j.id and r.tenant_id = j.tenant_id
      ))
  )
$$;

alter policy "Current tenant can select takeoff jobs" on public.takeoff_jobs
  using ((select private.can_access_takeoff_scope(tenant_id, project_id, estimate_version_id, false))
    or (select private.can_read_sent_takeoff_job(tenant_id, project_id, id)));

create or replace function private.can_read_takeoff_plan_evidence(
  p_tenant_id uuid, p_plan_set_id uuid, p_file_id uuid, p_path text
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.plan_sets s
    join public.takeoff_jobs j on j.plan_set_id = s.id and j.tenant_id = s.tenant_id and j.project_id = s.project_id
    where s.id = p_plan_set_id and s.tenant_id = p_tenant_id
      and (j.estimate_version_id is null or exists (
        select 1 from public.takeoff_send_receipts as receipt
        where receipt.job_id = j.id and receipt.tenant_id = j.tenant_id and receipt.command_kind = 'send'))
      and private.can_access_takeoff_scope(j.tenant_id, j.project_id, null, false)
      and (p_file_id is null or j.preparation_snapshot #> '{preparation,sources}' @> jsonb_build_array(
        jsonb_build_object('document_id', p_file_id, 'plan_set_id', s.id, 'file_path', p_path,
          'kind', 'plan', 'active', true, 'confirmed', true)))
  )
$$;

-- 6. A line fed by several sends (plan A then plan B) names all its takeoff lines: `takeoff_contributions` joins the
-- provenance keys every page reading follows (the TypeScript twin is estimateLineTakeoffItemIds). Like the other keys,
-- it is stale once a later takeoff rewrote the line (its job_id is no longer the line's source_job_id).
create or replace function private.takeoff_estimate_line_item_ids(p_source_metadata jsonb, p_source_job_id uuid)
 returns uuid[]
 language sql immutable parallel safe set search_path to 'pg_catalog'
as $function$
  with metadata as (
    select case when pg_catalog.jsonb_typeof(p_source_metadata) = 'object' then p_source_metadata end as value
  ), listed as (
    select 0 as rank, 0::bigint as ordinality, metadata.value -> 'takeoff_item_id' as value from metadata
    union all
    select key.rank, element.ordinality, element.value
    from metadata
    cross join (values (1, 'takeoff_length_rounding'), (2, 'takeoff_quantity_policy'), (3, 'takeoff_page_replacement'),
      (4, 'takeoff_contributions'))
      as key(rank, name)
    cross join lateral (select case when pg_catalog.jsonb_typeof(metadata.value -> key.name) = 'object'
      then metadata.value -> key.name end as entry) as entry
    cross join lateral pg_catalog.jsonb_array_elements(case
      when p_source_job_id is not null and private.takeoff_uuid_or_null(entry.entry -> 'job_id') is not null
        and private.takeoff_uuid_or_null(entry.entry -> 'job_id') <> p_source_job_id then '[]'::jsonb
      when pg_catalog.jsonb_typeof(entry.entry -> 'item_ids') = 'array' then entry.entry -> 'item_ids'
      else '[]'::jsonb end) with ordinality as element(value, ordinality)
  ), ids as (
    select private.takeoff_uuid_or_null(listed.value) as id, listed.rank, listed.ordinality from listed
  )
  select coalesce(pg_catalog.array_agg(first.id order by first.rank, first.ordinality), '{}'::uuid[])
  from (select distinct on (ids.id) ids.id, ids.rank, ids.ordinality from ids where ids.id is not null
    order by ids.id, ids.rank, ids.ordinality) as first;
$function$;

-- 7. What the server computed for a preview or a confirmation, staged by the service role and run by the authenticated
-- session of the same actor. The rule results evaluated for the destination, the mapping plan, the accumulations and
-- the outcome the member confirmed are the server's, never the browser's: an API caller of public.send_takeoff_job names
-- a request it cannot have staged itself. A request keeps the command it was first staged with (another submission
-- under the same identity is refused); a staged command lives 15 minutes, and once its send committed the receipt
-- answers for it.
create table private.takeoff_send_commands (
  request_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- No foreign key to the job: its key-share lock would make a retry staged while the first send of that job is in
  -- flight wait for it. A staged command of a deleted job finds no job to send and expires.
  job_id uuid not null,
  actor_id uuid not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  -- Identity of what the user confirmed (request, job, actor, destination, section, page decisions, override): a replay
  -- with the same inputs returns the receipt, the same request with other inputs is a conflict.
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  command jsonb not null check (pg_catalog.jsonb_typeof(command) = 'object'),
  expires_at timestamptz not null default pg_catalog.statement_timestamp() + interval '15 minutes'
);
revoke all on table private.takeoff_send_commands from public, anon, authenticated, service_role;

create function public.stage_takeoff_send(p_actor_id uuid, p_command jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  staged_job public.takeoff_jobs%rowtype;
  hash text;
begin
  if p_actor_id is null or pg_catalog.jsonb_typeof(p_command) is distinct from 'object'
    or coalesce(p_command ->> 'request_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command ->> 'job_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_command ->> 'fingerprint', '') !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_command -> 'client') is distinct from 'object' then
    raise exception 'TAKEOFF_SEND_COMMAND_INVALID' using errcode = '22023';
  end if;
  select * into staged_job from public.takeoff_jobs as candidate where candidate.id = (p_command ->> 'job_id')::uuid;
  if not found then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
  hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'request_id', p_command -> 'request_id', 'job_id', p_command -> 'job_id', 'actor_id', p_actor_id,
    'client', p_command -> 'client')::text, 'UTF8')), 'hex');
  delete from private.takeoff_send_commands as expired where expired.expires_at < pg_catalog.statement_timestamp();
  insert into private.takeoff_send_commands (request_id, tenant_id, job_id, actor_id, fingerprint, payload_hash, command)
  values ((p_command ->> 'request_id')::uuid, staged_job.tenant_id, staged_job.id, p_actor_id, p_command ->> 'fingerprint', hash,
    p_command)
  on conflict (request_id) do nothing;
  -- The request was staged already: the same submission keeps its first command (a retry after a timeout runs what was
  -- confirmed then); any other submission under this identity is refused.
  if not found and not exists (select 1 from private.takeoff_send_commands as staged
    where staged.request_id = (p_command ->> 'request_id')::uuid and staged.actor_id = p_actor_id
      and staged.job_id = staged_job.id and staged.tenant_id = staged_job.tenant_id and staged.payload_hash = hash) then
    raise exception 'TAKEOFF_SEND_REQUEST_CONFLICT' using errcode = '40001';
  end if;
end;
$$;
revoke all on function public.stage_takeoff_send(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.stage_takeoff_send(uuid, jsonb) to service_role;

-- 8. What a send is compared with, read by the preview and again by the command under its locks.
-- The tenant's mapping rules: the preview's mapping plan comes from them; a rule changed since refuses the send.
create function public.takeoff_mapping_rules_stamp(p_tenant_id uuid)
returns text language sql stable set search_path = '' as $$
  select pg_catalog.md5(coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(rule.id, rule.updated_at, rule.is_active,
      rule.priority, rule.match_type, rule.match_pattern, rule.action, rule.action_params, rule.name) order by rule.id)::text
    from public.takeoff_mapping_rules as rule where rule.tenant_id = p_tenant_id), '[]'))
$$;
revoke all on function public.takeoff_mapping_rules_stamp(uuid) from public, anon, authenticated;
grant execute on function public.takeoff_mapping_rules_stamp(uuid) to service_role;

-- The takeoffs a version's lines come from: those attached to it and those a copy carried over to it
-- (takeoff_version_links), with their lines; and its DPGF state, as takeoff_rule_version_stamp reads it. A peer's page
-- readings and geometries are written by the worker while it processes (its status then changes) and its frame transform
-- by the evaluation itself: no other edit of them changes what a send is compared with.
create function public.takeoff_send_peers_stamp(p_tenant_id uuid, p_version_id uuid)
returns text language sql stable set search_path = '' as $$
  select pg_catalog.md5(public.takeoff_rule_version_stamp(p_tenant_id, p_version_id) || '|' || coalesce((
    select pg_catalog.string_agg(job.id::text || ':' || job.status::text || ':' || coalesce((
        select pg_catalog.string_agg(item.id::text || ':' || item.updated_at::text, ',' order by item.id)
        from public.takeoff_items as item where item.job_id = job.id and item.tenant_id = p_tenant_id), ''), ';' order by job.id)
    from public.takeoff_jobs as job
    where job.tenant_id = p_tenant_id and job.estimate_version_id is distinct from p_version_id
      and job.status in ('completed'::public.takeoff_job_status, 'applied'::public.takeoff_job_status)
      and exists (select 1 from public.takeoff_version_links as link
        where link.tenant_id = p_tenant_id and link.takeoff_job_id = job.id and link.target_version_id = p_version_id)), ''))
$$;
revoke all on function public.takeoff_send_peers_stamp(uuid, uuid) from public, anon, authenticated;
grant execute on function public.takeoff_send_peers_stamp(uuid, uuid) to service_role;

-- 9. The send, run once by public.send_takeoff_job (and rolled back when the command is a dry run: the preview).
--
-- Lock order, one for every destination and shared with the import and the first creation of a version
-- (persist_estimate_creation_atomic) and with the application (apply_takeoff_job_with_page_decisions): the tenant's
-- calculation policy (shared), the affaire's row, then for an existing draft its rule lock `takeoff-rules:<version>` and
-- its row, then the job's locks and row, then the tenant's mapping rules (shared), then the lines. The versions of the
-- affaire are compared only once its row is held, so no version is created after the comparison. Never the reverse.
create function private.takeoff_send_execute(p_actor uuid, p_tenant uuid, p_role public.tenant_role, p_request uuid,
  p_command jsonb, p_dry_run boolean)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  kind text := p_command #>> '{destination,kind}';
  target_job_id uuid := (p_command ->> 'job_id')::uuid;
  job public.takeoff_jobs%rowtype;
  project public.estimate_projects%rowtype;
  existing public.takeoff_send_receipts%rowtype;
  target_version uuid;
  source_version uuid;
  target_engine smallint;
  version_created boolean := false;
  created_lock uuid;
  section_id uuid;
  section_created boolean := false;
  section_position integer;
  current_versions jsonb;
  stale_reason text;
  created jsonb;
  applied record;
  links jsonb;
  created_ids uuid[];
  accumulated uuid[] := '{}'::uuid[];
  removed uuid[] := '{}'::uuid[];
  entry record;
  rules_written integer;
  previous_writer text;
  outcome jsonb;
  result jsonb;
  plan jsonb;
begin
  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id;
  if not found or job.tenant_id is distinct from p_tenant then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant::text, 0));
  select * into project from public.estimate_projects as row_project
  where row_project.id = job.project_id and row_project.tenant_id = p_tenant
  for update;
  if project.id is null or project.is_archived
    or (p_role <> 'admin'::public.tenant_role and project.user_id is distinct from p_actor) then
    raise exception 'TAKEOFF_SEND_PROJECT_NOT_WRITABLE' using errcode = '42501';
  end if;
  if kind = 'existing_draft' then
    target_version := (p_command #>> '{destination,version_id}')::uuid;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-rules:' || target_version::text, 0));
    select version.calc_engine_version into target_engine from public.estimate_versions as version
    where version.id = target_version and version.tenant_id = p_tenant and version.project_id = job.project_id
      and version.status = 'draft'::public.estimate_status
    for update;
    if not found then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
  end if;

  -- The locks taken: a command of this request that committed meanwhile is visible now.
  if not p_dry_run then
    select * into existing from public.takeoff_send_receipts as stored
    where stored.tenant_id = p_tenant and stored.request_id = p_request;
    if found then
      return pg_catalog.jsonb_build_object('replay', existing.id);
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job-rules:' || target_job_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-job:' || target_job_id::text, 0));
  select * into job from public.takeoff_jobs as candidate where candidate.id = target_job_id for update;
  if job.estimate_version_id is not null or job.status is distinct from 'completed'::public.takeoff_job_status then
    if exists (select 1 from public.takeoff_send_receipts as stored
      where stored.job_id = target_job_id and stored.command_kind = 'send') then
      raise exception 'TAKEOFF_SEND_ALREADY_SENT' using errcode = '40001';
    end if;
    raise exception 'TAKEOFF_SEND_JOB_NOT_READY' using errcode = '40001';
  end if;
  -- The mapping rules the preview's plan comes from stay as they are until this transaction ends.
  perform 1 from public.takeoff_mapping_rules as rule where rule.tenant_id = p_tenant for share;

  -- What the preview evaluated, read again under the locks.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', version.id, 'status', version.status,
      'updated_at', version.updated_at) order by version.id), '[]'::jsonb)
    into current_versions
  from public.estimate_versions as version
  where version.project_id = job.project_id and version.tenant_id = p_tenant;
  stale_reason := case
    when current_versions is distinct from p_command #> '{expected,versions}' then 'destination_changed'
    when kind = 'first_draft' and current_versions <> '[]'::jsonb then 'destination_changed'
    when public.takeoff_rule_job_stamp(p_tenant, job.project_id, target_job_id) is distinct from p_command #>> '{expected,job_stamp}'
      then 'takeoff_changed'
    when public.takeoff_mapping_rules_stamp(p_tenant) is distinct from p_command #>> '{expected,mapping_stamp}' then 'mapping_changed'
    when kind = 'existing_draft' and public.takeoff_send_peers_stamp(p_tenant, target_version)
      is distinct from p_command #>> '{expected,peers_stamp}' then 'estimate_changed'
    -- A copy is compared with the takeoffs of the version it copies (they become the copy's peers).
    when kind = 'version_copy' and public.takeoff_send_peers_stamp(p_tenant, (p_command #>> '{destination,source_version_id}')::uuid)
      is distinct from p_command #>> '{expected,peers_stamp}' then 'estimate_changed'
  end;
  if stale_reason is not null then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', stale_reason)::text;
  end if;

  if kind = 'first_draft' then
    section_id := (p_command #>> '{section,id}')::uuid;
    created := public.persist_estimate_creation_atomic(p_tenant, p_actor, job.project_id, null,
      p_command #> '{destination,version_payload}',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', section_id, 'parent_id', null, 'item_type', 'section',
        'position', 1, 'title', btrim(p_command #>> '{section,title}'))),
      null);
    target_version := (created #>> '{version,id}')::uuid;
    version_created := true;
    section_created := true;
  elsif kind = 'version_copy' then
    source_version := (p_command #>> '{destination,source_version_id}')::uuid;
    if not exists (select 1 from public.estimate_versions as version where version.id = source_version
      and version.tenant_id = p_tenant and version.project_id = job.project_id
      and version.status <> 'draft'::public.estimate_status) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'destination_changed')::text;
    end if;
    target_version := public.duplicate_estimate_version(source_version, false);
    version_created := true;
  end if;
  select version.calc_engine_version into target_engine from public.estimate_versions as version
  where version.id = target_version and version.tenant_id = p_tenant;

  -- A version that holds a DPGF line is sent through its reconciliation, which needs the job on the version first:
  -- refused before anything is attached (the preview names this blocker first and offers no confirmation).
  if exists (select 1 from public.estimate_items as item where item.version_id = target_version and item.tenant_id = p_tenant
    and item.item_type = 'line'::public.estimate_item_type and item.source_provider = 'dpgf') then
    raise exception 'TAKEOFF_SEND_DPGF_RECONCILIATION_REQUIRED' using errcode = '22023';
  end if;

  -- The section that receives the lines: created here for a new version or on request, else one of the draft's.
  if not section_created then
    section_id := (p_command #>> '{section,id}')::uuid;
    if (p_command #>> '{section,kind}') = 'new' then
      select coalesce(max(item.position), 0) + 1 into section_position from public.estimate_items as item
      where item.version_id = target_version and item.tenant_id = p_tenant and item.parent_id is null;
      previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
      if target_engine = 3 then
        perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);
      end if;
      insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
      values (section_id, p_tenant, target_version, null, 'section'::public.estimate_item_type, section_position,
        btrim(p_command #>> '{section,title}'));
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);
      section_created := true;
    elsif not exists (select 1 from public.estimate_items as item where item.id = section_id
      and item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'section'::public.estimate_item_type) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'estimate_changed')::text;
    end if;
  end if;

  -- What the destination holds before the send, and a reference of each item that does not depend on this run: its id in
  -- an existing draft, the id of the item it copies in a copy (copies map by position, as duplicate_estimate_version
  -- maps them), « new » for the section this command creates. The outcome compares the dry run with the send by them.
  drop table if exists pg_temp._takeoff_send_refs;
  create temporary table _takeoff_send_refs (id uuid primary key, ref text not null) on commit drop;
  if kind = 'existing_draft' then
    insert into pg_temp._takeoff_send_refs (id, ref)
    select item.id, 'item:' || item.id::text from public.estimate_items as item
    where item.version_id = target_version and item.tenant_id = p_tenant;
  elsif kind = 'version_copy' then
    insert into pg_temp._takeoff_send_refs (id, ref)
    with recursive source_tree as (
      select item.id, array[item.position] as path from public.estimate_items as item
      where item.version_id = source_version and item.parent_id is null
      union all
      select child.id, parent.path || child.position from public.estimate_items as child
      join source_tree as parent on parent.id = child.parent_id where child.version_id = source_version
    ), copy_tree as (
      select item.id, array[item.position] as path from public.estimate_items as item
      where item.version_id = target_version and item.parent_id is null and item.id <> section_id
      union all
      select child.id, parent.path || child.position from public.estimate_items as child
      join copy_tree as parent on parent.id = child.parent_id where child.version_id = target_version
    )
    select copied.id, 'copy:' || original.id::text from copy_tree as copied join source_tree as original on original.path = copied.path;
  end if;
  if section_created then
    insert into pg_temp._takeoff_send_refs (id, ref) values (section_id, 'new') on conflict (id) do update set ref = 'new';
  end if;
  drop table if exists pg_temp._takeoff_send_before;
  create temporary table _takeoff_send_before on commit drop as
  select item.id, item.parent_id, item.title,
    coalesce(item.unit_code, (private.normalize_unit(item.description)).unit_code, 'status:' || item.pricing_status::text) as unit,
    item.quantity, item.unit_price_ht_cents, item.source_job_id, item.updated_at
  from public.estimate_items as item
  where item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'line'::public.estimate_item_type;

  -- The application checks the actor's draft lock. A version created here has no other holder: its lock lives only in
  -- this transaction. An existing draft is locked by the actor before the send, as for any application; its dry run
  -- borrows it for its rolled-back run unless another member is editing it.
  if version_created then
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, p_actor, p_tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid())
    returning id into created_lock;
  elsif p_dry_run then
    if exists (select 1 from public.draft_locks as lock_row where lock_row.version_id = target_version
      and lock_row.user_id <> p_actor and lock_row.expires_at > pg_catalog.statement_timestamp()) then
      raise exception 'TAKEOFF_SEND_DRAFT_LOCKED' using errcode = '55P03';
    end if;
    insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values (target_version, p_actor, p_tenant, pg_catalog.statement_timestamp() + interval '5 minutes', gen_random_uuid())
    on conflict (version_id) do update set user_id = excluded.user_id, expires_at = excluded.expires_at;
  end if;

  -- The historical receipt of a launch on a version (takeoff_jobs_prepared_plan_receipt_uidx) holds one job per version,
  -- plan set, preparation revision, level and provider. A versionless job of that same launch is refused by name here;
  -- the launch requests of a later migration narrow that index to the jobs they do not own.
  if exists (select 1 from public.takeoff_jobs as other
    where other.tenant_id = p_tenant and other.estimate_version_id = target_version and other.id <> target_job_id
      and other.plan_set_id = job.plan_set_id and other.level = job.level
      and other.execution_provider is not distinct from job.execution_provider
      and other.preparation_snapshot is not null
      and other.preparation_snapshot ->> 'preparation_revision' = job.preparation_snapshot ->> 'preparation_revision') then
    raise exception 'TAKEOFF_SEND_PREPARATION_ALREADY_SENT' using errcode = '22023';
  end if;

  -- The door: the job's version goes from NULL to this draft of its affaire, once, by this command's permit.
  insert into private.takeoff_job_attachment_permits (job_id, tenant_id, project_id, version_id)
  values (target_job_id, p_tenant, job.project_id, target_version);
  update public.takeoff_jobs as attached set estimate_version_id = target_version where attached.id = target_job_id;
  if exists (select 1 from private.takeoff_job_attachment_permits as permit where permit.job_id = target_job_id) then
    raise exception 'TAKEOFF_SEND_PERMIT_NOT_CONSUMED' using errcode = 'P0001';
  end if;

  -- The controls that compare with other takeoffs and with the DPGF, evaluated for this destination by the preview from
  -- the state checked above: every line with rule inputs receives them, or nothing is sent.
  select pg_catalog.count(*) into rules_written
  from takeoff_internal.persist_rule_results(p_tenant, target_version, array[target_job_id], p_command -> 'rule_results',
    p_command -> 'rule_transforms');
  if rules_written <> pg_catalog.jsonb_array_length(p_command -> 'rule_results')
    or exists (select 1 from public.takeoff_items as item
      cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(item.rule_results) = 'array'
        then item.rule_results else '[]'::jsonb end) as rule_result(value)
      where item.job_id = target_job_id and item.tenant_id = p_tenant
        and rule_result.value #>> '{details,cross_job_comparison}' = 'deferred') then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'rules_changed')::text;
  end if;

  -- An administrator's override, bound to this destination, checked again by the application's trigger.
  if pg_catalog.jsonb_typeof(p_command -> 'override') = 'object' then
    if p_role <> 'admin'::public.tenant_role then
      raise exception 'TAKEOFF_APPLY_GUARD_FAILED' using errcode = 'P0001';
    end if;
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    values (p_tenant, p_actor, 'takeoff_jobs', target_job_id, target_version, 'takeoff.apply.override',
      pg_catalog.jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', target_job_id,
        'tenant_id', p_tenant, 'user_id', p_actor,
        'metadata', (p_command -> 'override') || pg_catalog.jsonb_build_object('estimate_version_id', target_version)));
  end if;

  select result_row.* into applied from public.apply_takeoff_job_with_page_decisions(target_job_id, 'append', section_id,
    p_command -> 'mapping_plan', p_command -> 'page_decisions', null) as result_row;
  links := coalesce(applied.item_links, '[]'::jsonb);
  created_ids := coalesce(applied.created_ids, '{}'::uuid[]);

  -- An engine 2 line names no takeoff line of its own. Each line this send creates there names the ones it sums, as a
  -- DPGF line names the measures it keeps (takeoff_quantity_policy): a later send can add to it (plan A then plan B)
  -- and a page re-read finds it.
  if target_engine is distinct from 3 then
    update public.estimate_items as line set source_metadata = coalesce(line.source_metadata, '{}'::jsonb)
      || pg_catalog.jsonb_build_object('takeoff_contributions', pg_catalog.jsonb_build_object('version', 1, 'job_id', target_job_id,
        'item_ids', sources.ids, 'parts', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id', target_job_id,
          'request_id', p_request, 'takeoff_item_ids', sources.ids, 'quantity', pg_catalog.trim_scale(line.quantity)))))
    from (select (output.value ->> 'estimate_item_id')::uuid as estimate_item_id,
        pg_catalog.jsonb_agg(output.value -> 'takeoff_item_id' order by output.value ->> 'takeoff_item_id') as ids
      from pg_catalog.jsonb_array_elements(links) as output(value) group by 1) as sources
    where line.id = sources.estimate_item_id and line.id = any(created_ids) and line.version_id = target_version
      and line.tenant_id = p_tenant and line.source_provider = 'takeoff'
      and pg_catalog.cardinality(private.takeoff_estimate_line_item_ids(line.source_metadata, line.source_job_id)) = 0;
  end if;

  -- Earlier takeoff lines of the same item (plan A sent 3, plan B adds 2: one line of 5). The preview proposed each part,
  -- with the line as it read it; the line must still be that line, measured by its takeoff lines only (never a quantity
  -- typed by hand), in the section, of the same title and unit, with no hypothesis nor rounded length on either side.
  -- On both engines: engine 3 completes the line as its writer does, engine 2 recalculates the version (as the DPGF
  -- composition does); the price, unit, hours and supplier stay the line's.
  for entry in
    select part.takeoff_item_id, part.estimate_item_id, part.expected_updated_at, part.expected_quantity, link.created_id
    from pg_catalog.jsonb_to_recordset(p_command -> 'accumulations')
      as part(takeoff_item_id uuid, estimate_item_id uuid, expected_updated_at timestamptz, expected_quantity numeric)
    left join lateral (select (output.value ->> 'estimate_item_id')::uuid as created_id
      from pg_catalog.jsonb_array_elements(links) as output(value)
      where (output.value ->> 'takeoff_item_id')::uuid = part.takeoff_item_id) as link on true
    order by part.estimate_item_id, part.takeoff_item_id
  loop
    if entry.created_id is null or not entry.created_id = any(created_ids)
      or entry.estimate_item_id = any(created_ids) or entry.estimate_item_id = any(removed) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'accumulation_changed', 'estimate_item_id', entry.estimate_item_id)::text;
    end if;
    perform 1 from public.estimate_items as earlier where earlier.id = entry.estimate_item_id for update;
    if not exists (
      select 1
      from public.estimate_items as earlier
      join public.estimate_items as added on added.id = entry.created_id and added.version_id = earlier.version_id
      join public.takeoff_items as source on source.id = entry.takeoff_item_id and source.job_id = target_job_id
      cross join lateral (select private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id) as ids) as sources
      cross join lateral (select pg_catalog.sum(own.quantity) as raw, pg_catalog.count(*) as readable
        from public.takeoff_items as own where own.id = any(sources.ids) and own.tenant_id = p_tenant) as measured
      where earlier.id = entry.estimate_item_id and earlier.version_id = target_version and earlier.tenant_id = p_tenant
        and earlier.item_type = 'line'::public.estimate_item_type and earlier.parent_id = section_id
        and earlier.source_provider = 'takeoff'
        -- The line as the preview read it, before this send (the engine 2 writer recalculates and dates anew every line of
        -- the version); a second part for the same line finds it as the first part left it.
        and (entry.estimate_item_id = any(accumulated)
          or exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = entry.estimate_item_id
            and before_line.updated_at = entry.expected_updated_at and before_line.quantity = entry.expected_quantity
            and earlier.quantity = before_line.quantity))
        and pg_catalog.cardinality(sources.ids) > 0 and measured.readable = pg_catalog.cardinality(sources.ids)
        and measured.raw = earlier.quantity
        and not (earlier.source_metadata ? 'takeoff_length_rounding') and not (earlier.source_metadata ? 'takeoff_provision')
        and not (added.source_metadata ? 'takeoff_length_rounding') and not (added.source_metadata ? 'takeoff_provision')
        and public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is null
        and added.parent_id = earlier.parent_id
        and lower(regexp_replace(btrim(added.title), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(earlier.title), '\s+', ' ', 'g'))
        and coalesce(added.unit_code, 'status:' || added.pricing_status::text)
          = coalesce(earlier.unit_code, 'status:' || earlier.pricing_status::text)
    ) then
      raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
        detail = pg_catalog.jsonb_build_object('reason', 'accumulation_changed', 'estimate_item_id', entry.estimate_item_id)::text;
    end if;

    previous_writer := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '');
    if target_engine = 3 then
      perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', target_version::text, true);
    end if;
    -- Only the quantity and the provenance move: price, unit, hours, supplier and status stay the line's.
    update public.estimate_items as earlier set
      quantity = earlier.quantity + added.quantity,
      source_job_id = target_job_id,
      source_metadata = coalesce(earlier.source_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object('takeoff_contributions',
        pg_catalog.jsonb_build_object('version', 1, 'job_id', target_job_id,
          'item_ids', (select pg_catalog.jsonb_agg(source_id order by ordinal) from pg_catalog.unnest(
              private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id) || entry.takeoff_item_id)
              with ordinality as listed(source_id, ordinal)),
          'parts', coalesce(earlier.source_metadata #> '{takeoff_contributions,parts}',
              pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id', earlier.source_job_id,
                'takeoff_item_ids', pg_catalog.to_jsonb(private.takeoff_estimate_line_item_ids(earlier.source_metadata, earlier.source_job_id)),
                'quantity', pg_catalog.trim_scale(earlier.quantity))))
            || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('job_id', target_job_id, 'request_id', p_request,
              'takeoff_item_ids', pg_catalog.jsonb_build_array(entry.takeoff_item_id),
              'quantity', pg_catalog.trim_scale(added.quantity))))),
      updated_at = pg_catalog.statement_timestamp()
    from public.estimate_items as added
    where earlier.id = entry.estimate_item_id and added.id = entry.created_id;
    delete from public.estimate_items as added where added.id = entry.created_id and added.version_id = target_version;
    if target_engine = 3 then
      perform public.estimate_v3_complete_entry_for_writer(target_version, array[entry.estimate_item_id]);
    end if;
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_writer, true);
    removed := removed || entry.created_id;
    accumulated := accumulated || entry.estimate_item_id;
    links := (select pg_catalog.jsonb_agg(case when (output.value ->> 'takeoff_item_id')::uuid = entry.takeoff_item_id
        then pg_catalog.jsonb_build_object('takeoff_item_id', entry.takeoff_item_id, 'estimate_item_id', entry.estimate_item_id)
        else output.value end order by output.ordinality)
      from pg_catalog.jsonb_array_elements(links) with ordinality as output(value, ordinality));
  end loop;
  if target_engine is distinct from 3 and pg_catalog.cardinality(accumulated) > 0 then
    perform public.recalculate_takeoff_estimate_version(target_version, p_tenant);
  end if;

  if created_lock is not null then
    delete from public.draft_locks as lock_row where lock_row.id = created_lock;
  end if;

  -- What the send leaves, against what the destination held: the lines created, changed and removed, each in its
  -- section, and where each takeoff line went. The dry run of the preview computes it the same way, from the same state.
  drop table if exists pg_temp._takeoff_send_after;
  create temporary table _takeoff_send_after on commit drop as
  select item.id, item.parent_id, item.title,
    coalesce(item.unit_code, (private.normalize_unit(item.description)).unit_code, 'status:' || item.pricing_status::text) as unit,
    item.quantity, item.unit_price_ht_cents, item.source_job_id,
    (select pg_catalog.jsonb_agg(output.value ->> 'takeoff_item_id' order by output.value ->> 'takeoff_item_id')
      from pg_catalog.jsonb_array_elements(links) as output(value)
      where (output.value ->> 'estimate_item_id')::uuid = item.id) as takeoff_item_ids
  from public.estimate_items as item
  where item.version_id = target_version and item.tenant_id = p_tenant and item.item_type = 'line'::public.estimate_item_type;
  with changes as (
    select 'created' as change, null::text as ref, refs.ref as section, after_line.title, after_line.unit, after_line.quantity,
      null::numeric as quantity_before, after_line.unit_price_ht_cents, coalesce(after_line.takeoff_item_ids, '[]'::jsonb) as takeoff_item_ids
    from pg_temp._takeoff_send_after as after_line
    left join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
    where not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id)
    union all
    select 'changed', line_ref.ref, refs.ref, after_line.title, after_line.unit, after_line.quantity, before_line.quantity,
      after_line.unit_price_ht_cents, coalesce(after_line.takeoff_item_ids, '[]'::jsonb)
    from pg_temp._takeoff_send_after as after_line
    join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
    left join pg_temp._takeoff_send_refs as line_ref on line_ref.id = after_line.id
    left join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
    where (after_line.parent_id, after_line.title, after_line.unit, after_line.quantity, after_line.unit_price_ht_cents,
        after_line.source_job_id)
      is distinct from (before_line.parent_id, before_line.title, before_line.unit, before_line.quantity,
        before_line.unit_price_ht_cents, before_line.source_job_id)
    union all
    select 'removed', line_ref.ref, refs.ref, before_line.title, before_line.unit, before_line.quantity, before_line.quantity,
      before_line.unit_price_ht_cents, '[]'::jsonb
    from pg_temp._takeoff_send_before as before_line
    left join pg_temp._takeoff_send_refs as line_ref on line_ref.id = before_line.id
    left join pg_temp._takeoff_send_refs as refs on refs.id = before_line.parent_id
    where not exists (select 1 from pg_temp._takeoff_send_after as after_line where after_line.id = before_line.id)
  )
  select pg_catalog.jsonb_build_object('format_version', 1, 'engine', target_engine,
    'sections_created', case when section_created
      then pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('title', btrim(p_command #>> '{section,title}')))
      else '[]'::jsonb end,
    'lines', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('change', change.change, 'ref', change.ref,
        'section', change.section, 'title', change.title, 'unit', change.unit, 'quantity', pg_catalog.trim_scale(change.quantity),
        'quantity_before', pg_catalog.trim_scale(change.quantity_before), 'unit_price_ht_cents', change.unit_price_ht_cents,
        'takeoff_item_ids', change.takeoff_item_ids)
      order by change.change, change.section collate "C", change.title collate "C", change.unit collate "C", change.quantity,
        change.ref collate "C", change.takeoff_item_ids::text collate "C") from changes as change), '[]'::jsonb),
    'parts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('takeoff_item_id', output.value ->> 'takeoff_item_id',
        'target', case when exists (select 1 from pg_temp._takeoff_send_before as before_line
          where before_line.id = (output.value ->> 'estimate_item_id')::uuid) then 'existing_line' else 'new_line' end,
        'line', (select refs.ref from pg_temp._takeoff_send_refs as refs where refs.id = (output.value ->> 'estimate_item_id')::uuid),
        'section', (select refs.ref from pg_temp._takeoff_send_after as after_line
          join pg_temp._takeoff_send_refs as refs on refs.id = after_line.parent_id
          where after_line.id = (output.value ->> 'estimate_item_id')::uuid))
      order by output.value ->> 'takeoff_item_id') from pg_catalog.jsonb_array_elements(links) as output(value)), '[]'::jsonb))
  into outcome;

  -- What the member confirmed is what is written: any other line, quantity, unit, section or target refuses everything.
  if not p_dry_run and outcome is distinct from p_command -> 'expected_outcome' then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'outcome_changed')::text;
  end if;
  if p_dry_run then
    return pg_catalog.jsonb_build_object('outcome', outcome);
  end if;

  -- The parts as stored: each one names its takeoff line, its real target (the line it entered, new or earlier, and the
  -- section that line is in), the page, the plan's attested content, the source of its quantity and the revision of its
  -- evidence, read here from the rows the application wrote from.
  plan := pg_catalog.jsonb_build_object('format_version', 1,
    'destination', pg_catalog.jsonb_build_object('kind', kind, 'version_id', target_version, 'source_version_id', source_version,
      'version_created', version_created),
    'price_rules_ignored', coalesce(p_command -> 'price_rules_ignored', '[]'::jsonb),
    'sections', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', section_id, 'created', section_created,
      'title', (select item.title from public.estimate_items as item where item.id = section_id))),
    'parts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'takeoff_item_id', source.id, 'designation', source.designation,
          'estimate_item_id', target_line.id, 'section_id', target_line.parent_id,
          'target', case when before_line.id is not null
            then pg_catalog.jsonb_build_object('kind', 'existing_line', 'estimate_item_id', before_line.id,
              'quantity_before', pg_catalog.trim_scale(before_line.quantity))
            else pg_catalog.jsonb_build_object('kind', 'new_line') end,
          'quantity', pg_catalog.trim_scale(source.quantity), 'unit', source.unit,
          'source', pg_catalog.jsonb_build_object('job_id', target_job_id, 'answer_id', null, 'observation_id', source.id,
            'plan_file_id', source.metadata #>> '{source_document,plan_file_id}', 'source_file_name', source.source_file_name,
            'source_page', source.source_page,
            'quantity_source', case
              when public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category) is not null
                then 'hypothesis:' || public.takeoff_item_hypothesis_cause(source.metadata, source.quantity_entry_category)
              when source.quantity_entry_category is not null then 'entered' else 'measured' end,
            -- The plan's bytes as the takeoff attested them (its preparation), never the plan centre's current file.
            'plan_content_hash', (select attested.value ->> 'content_hash'
              from pg_catalog.jsonb_array_elements(job.preparation_snapshot #> '{preparation,sources}') as attested(value)
              where attested.value ->> 'document_id' = source.metadata #>> '{source_document,plan_file_id}' limit 1),
            'evidence_revision', pg_catalog.md5(pg_catalog.jsonb_build_array(source.updated_at, source.evidence,
              source.source_file_name, source.source_page, source.metadata,
              (select pg_catalog.jsonb_agg(geometry.geometry - 'transform' order by geometry.vector_page_id)
                from public.takeoff_item_geometries as geometry where geometry.takeoff_item_id = source.id))::text)))
        order by source.id)
      from pg_catalog.jsonb_array_elements(links) as output(value)
      join public.takeoff_items as source on source.id = (output.value ->> 'takeoff_item_id')::uuid
        and source.job_id = target_job_id and source.tenant_id = p_tenant
      join pg_temp._takeoff_send_after as target_line on target_line.id = (output.value ->> 'estimate_item_id')::uuid
      left join pg_temp._takeoff_send_before as before_line on before_line.id = target_line.id), '[]'::jsonb));

  result := pg_catalog.jsonb_build_object(
    'format_version', 1,
    'version_id', target_version,
    'version_created', version_created,
    'source_version_id', source_version,
    'outcome', outcome,
    'sections_created', case when section_created then pg_catalog.jsonb_build_array(section_id) else '[]'::jsonb end,
    'sections_changed', coalesce((select pg_catalog.jsonb_agg(distinct touched.section_id) from (
        select after_line.parent_id as section_id from pg_temp._takeoff_send_after as after_line
        left join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
        where after_line.parent_id is not null and (before_line.id is null
          or (after_line.parent_id, after_line.title, after_line.unit, after_line.quantity, after_line.unit_price_ht_cents,
            after_line.source_job_id) is distinct from (before_line.parent_id, before_line.title, before_line.unit,
            before_line.quantity, before_line.unit_price_ht_cents, before_line.source_job_id))
        union
        select before_line.parent_id from pg_temp._takeoff_send_before as before_line
        left join pg_temp._takeoff_send_after as after_line on after_line.id = before_line.id
        where before_line.parent_id is not null and (after_line.id is null or after_line.parent_id is distinct from before_line.parent_id)
      ) as touched), '[]'::jsonb),
    'lines_created', coalesce((select pg_catalog.jsonb_agg(after_line.id order by after_line.id) from pg_temp._takeoff_send_after as after_line
      where not exists (select 1 from pg_temp._takeoff_send_before as before_line where before_line.id = after_line.id)), '[]'::jsonb),
    'lines_changed', coalesce((select pg_catalog.jsonb_agg(after_line.id order by after_line.id)
      from pg_temp._takeoff_send_after as after_line join pg_temp._takeoff_send_before as before_line on before_line.id = after_line.id
      where (after_line.parent_id, after_line.title, after_line.unit, after_line.quantity, after_line.unit_price_ht_cents,
          after_line.source_job_id) is distinct from (before_line.parent_id, before_line.title, before_line.unit,
          before_line.quantity, before_line.unit_price_ht_cents, before_line.source_job_id)), '[]'::jsonb),
    'lines_removed', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', before_line.id,
        'section_id', before_line.parent_id, 'title', before_line.title, 'quantity', pg_catalog.trim_scale(before_line.quantity),
        'unit', before_line.unit) order by before_line.id)
      from pg_temp._takeoff_send_before as before_line
      where not exists (select 1 from pg_temp._takeoff_send_after as after_line where after_line.id = before_line.id)), '[]'::jsonb),
    'item_links', links,
    'ignored_count', applied.ignored_count,
    'scope', applied.scope);
  result := result || pg_catalog.jsonb_build_object(
    'created_count', pg_catalog.jsonb_array_length(result -> 'lines_created'),
    'updated_count', pg_catalog.jsonb_array_length(result -> 'lines_changed'),
    'removed_count', pg_catalog.jsonb_array_length(result -> 'lines_removed'),
    'sent_count', pg_catalog.jsonb_array_length(links),
    'accumulated_count', pg_catalog.cardinality(accumulated));
  return pg_catalog.jsonb_build_object('version_id', target_version, 'project_id', job.project_id, 'plan', plan, 'result', result);
end;
$$;
revoke all on function private.takeoff_send_execute(uuid, uuid, public.tenant_role, uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

-- A replay: the receipt of this request, to the member who sent it, for the job and the fingerprint it was confirmed
-- with and, when this call staged a command, the same inputs; and only while that member may still read the takeoff
-- (an affaire handed to another engineer takes its receipts with it).
create function private.takeoff_send_replay(p_receipt public.takeoff_send_receipts, p_actor uuid, p_job_id uuid,
  p_fingerprint text, p_staged_hash text)
returns jsonb
language plpgsql set search_path = '' as $$
begin
  if p_receipt.actor_id is distinct from p_actor or p_receipt.job_id is distinct from p_job_id
    or p_receipt.preview_fingerprint is distinct from p_fingerprint
    or (p_staged_hash is not null and p_staged_hash is distinct from p_receipt.payload_hash) then
    raise exception 'TAKEOFF_SEND_REQUEST_CONFLICT' using errcode = '40001';
  end if;
  if not private.can_access_takeoff_child(p_receipt.tenant_id, p_receipt.job_id, null, false) then
    raise exception 'TAKEOFF_SEND_RECEIPT_NOT_READABLE' using errcode = '42501';
  end if;
  delete from private.takeoff_send_commands as spent where spent.request_id = p_receipt.request_id and spent.actor_id = p_actor;
  return pg_catalog.to_jsonb(p_receipt) || pg_catalog.jsonb_build_object('replayed', true);
end;
$$;
revoke all on function private.takeoff_send_replay(public.takeoff_send_receipts, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

-- 10. The send command. The browser previews by a dry run of the command the server staged for it (the very send,
-- rolled back: what the writer would leave, rounded lengths and grouped lines included); the confirmation recomputes that
-- preview, compares its fingerprint with the one the member confirmed, and stages the command with the outcome the
-- member saw; the member's session sends it. Under the locks the state the preview came from is read again: any change
-- since (another version, an edit of the takeoff or of the estimate, a rule input, a mapping rule, a takeoff carried
-- over to the destination) or any other outcome refuses the whole command with TAKEOFF_SEND_PREVIEW_STALE and nothing is
-- written. A replay of the same request returns its receipt, to a caller who may still read it, for the fingerprint it
-- was confirmed with.
create function public.send_takeoff_job(p_request jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  tenant uuid := (select public.current_tenant_id());
  p_command jsonb;
  staged private.takeoff_send_commands%rowtype;
  request uuid;
  target_job_id uuid;
  receipt public.takeoff_send_receipts%rowtype;
  actor_role public.tenant_role;
  dry_run boolean;
  executed jsonb;
begin
  if actor is null or tenant is null then
    raise exception 'TAKEOFF_SEND_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_request) is distinct from 'object'
    or p_request - array['request_id', 'job_id', 'fingerprint'] <> '{}'::jsonb
    or coalesce(p_request ->> 'request_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'job_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(p_request ->> 'fingerprint', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'TAKEOFF_SEND_COMMAND_INVALID' using errcode = '22023';
  end if;
  request := (p_request ->> 'request_id')::uuid;
  target_job_id := (p_request ->> 'job_id')::uuid;
  select * into staged from private.takeoff_send_commands as command_row
  where command_row.request_id = request and command_row.tenant_id = tenant and command_row.actor_id = actor
    and command_row.job_id = target_job_id;

  -- A replay of a committed command returns its receipt, to the member who sent it, for the fingerprint it was confirmed
  -- with, while that member may still read it; the same request with other inputs is a conflict.
  select * into receipt from public.takeoff_send_receipts as stored where stored.tenant_id = tenant and stored.request_id = request;
  if found then
    return private.takeoff_send_replay(receipt, actor, target_job_id, p_request ->> 'fingerprint', staged.payload_hash);
  end if;
  if staged.request_id is null or staged.fingerprint is distinct from p_request ->> 'fingerprint'
    or staged.expires_at <= pg_catalog.statement_timestamp() then
    raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001',
      detail = pg_catalog.jsonb_build_object('reason', 'command_not_staged')::text;
  end if;
  p_command := staged.command;
  if pg_catalog.jsonb_typeof(p_command) is distinct from 'object'
    or p_command - array['format_version', 'mode', 'request_id', 'job_id', 'fingerprint', 'client', 'destination', 'section',
      'expected', 'mapping_plan', 'page_decisions', 'rule_results', 'rule_transforms', 'accumulations', 'override',
      'price_rules_ignored', 'expected_outcome'] <> '{}'::jsonb
    or p_command ->> 'request_id' is distinct from request::text or p_command ->> 'job_id' is distinct from target_job_id::text
    or p_command -> 'format_version' is distinct from '1'::jsonb
    or (p_command ->> 'mode') is null or (p_command ->> 'mode') not in ('send', 'dry_run')
    or pg_catalog.jsonb_typeof(p_command -> 'destination') is distinct from 'object'
    or (p_command #>> '{destination,kind}') is null
    or (p_command #>> '{destination,kind}') not in ('first_draft', 'existing_draft', 'version_copy')
    or pg_catalog.jsonb_typeof(p_command -> 'section') is distinct from 'object'
    or (p_command #>> '{section,kind}') is null or (p_command #>> '{section,kind}') not in ('new', 'existing')
    or coalesce(p_command #>> '{section,id}', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or ((p_command #>> '{section,kind}') = 'new' and char_length(btrim(coalesce(p_command #>> '{section,title}', '')))
      not between 1 and 200)
    or pg_catalog.jsonb_typeof(p_command -> 'expected') is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_command #> '{expected,versions}') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command #> '{expected,job_stamp}') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_command #> '{expected,mapping_stamp}') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_command -> 'mapping_plan') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'page_decisions') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'rule_results') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'rule_transforms') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_command -> 'accumulations') is distinct from 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_command -> 'price_rules_ignored', '[]'::jsonb)) is distinct from 'array'
    or coalesce(pg_catalog.jsonb_typeof(p_command -> 'override'), 'null') not in ('null', 'object')
    -- A send carries the outcome its member saw; a dry run computes it.
    or ((p_command ->> 'mode') = 'send' and pg_catalog.jsonb_typeof(p_command -> 'expected_outcome') is distinct from 'object')
    or ((p_command ->> 'mode') = 'dry_run' and coalesce(pg_catalog.jsonb_typeof(p_command -> 'expected_outcome'), 'null') <> 'null')
    or ((p_command #>> '{destination,kind}') = 'first_draft'
      and pg_catalog.jsonb_typeof(p_command #> '{destination,version_payload}') is distinct from 'object')
    or ((p_command #>> '{destination,kind}') = 'existing_draft'
      and coalesce(p_command #>> '{destination,version_id}', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or ((p_command #>> '{destination,kind}') = 'version_copy'
      and coalesce(p_command #>> '{destination,source_version_id}', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    -- A new version gets a new section; a section of the version is chosen only in an existing draft.
    or ((p_command #>> '{destination,kind}') <> 'existing_draft' and (p_command #>> '{section,kind}') <> 'new')
  then
    raise exception 'TAKEOFF_SEND_COMMAND_INVALID' using errcode = '22023';
  end if;
  -- Prices are never touched by this journey: a mapping rule that sets a price or folds lines into a priced ouvrage is
  -- neutralised by the server before the plan is built (it is reported in the preview and the receipt).
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_command -> 'mapping_plan') as plan_entry(value)
    where pg_catalog.jsonb_typeof(plan_entry.value) <> 'object'
      or plan_entry.value ->> 'action' in ('set_price', 'apply_assembly')
      or plan_entry.value -> 'unit_price_cents' is distinct from 'null'::jsonb
      or plan_entry.value -> 'assembly_id' is distinct from 'null'::jsonb
  ) then
    raise exception 'TAKEOFF_SEND_PRICE_RULE_REFUSED' using errcode = '22023';
  end if;

  select membership.role into actor_role
  from public.tenant_memberships as membership
  join public.tenants as tenant_row on tenant_row.id = membership.tenant_id and tenant_row.is_active
  where membership.tenant_id = tenant and membership.user_id = actor;
  if actor_role is null or actor_role not in ('admin'::public.tenant_role, 'engineer'::public.tenant_role) then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  dry_run := (p_command ->> 'mode') = 'dry_run';
  if dry_run then
    -- The preview: the very send, in a block rolled back once it computed what it would leave.
    begin
      executed := private.takeoff_send_execute(actor, tenant, actor_role, request, p_command, true);
      raise exception 'TAKEOFF_SEND_DRY_RUN_DONE' using errcode = 'P0001';
    exception when raise_exception then
      if sqlerrm <> 'TAKEOFF_SEND_DRY_RUN_DONE' then
        raise;
      end if;
    end;
    return pg_catalog.jsonb_build_object('dry_run', true, 'outcome', executed -> 'outcome');
  end if;

  executed := private.takeoff_send_execute(actor, tenant, actor_role, request, p_command, false);
  if executed ? 'replay' then
    select * into receipt from public.takeoff_send_receipts as stored where stored.id = (executed ->> 'replay')::uuid;
    return private.takeoff_send_replay(receipt, actor, target_job_id, p_request ->> 'fingerprint', staged.payload_hash);
  end if;

  perform pg_catalog.set_config('mergeone.takeoff_send_receipt', request::text, true);
  insert into public.takeoff_send_receipts (tenant_id, project_id, job_id, request_id, command_kind, format_version, actor_id,
    payload_hash, preview_fingerprint, destination, target_version_id, write_plan, result)
  values (tenant, (executed ->> 'project_id')::uuid, target_job_id, request, 'send', 1, actor, staged.payload_hash,
    p_command ->> 'fingerprint', executed #> '{plan,destination}', (executed ->> 'version_id')::uuid, executed -> 'plan',
    executed -> 'result')
  returning * into receipt;
  perform pg_catalog.set_config('mergeone.takeoff_send_receipt', '', true);
  -- The staged command stays until it expires: from now on the receipt answers every call of this request (a retry
  -- staged meanwhile must not wait on this transaction's row).
  return pg_catalog.to_jsonb(receipt) || pg_catalog.jsonb_build_object('replayed', false);
end;
$$;
revoke all on function public.send_takeoff_job(jsonb) from public, anon, service_role;
grant execute on function public.send_takeoff_job(jsonb) to authenticated;


commit;
