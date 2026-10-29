-- Batch only content revision writes during a service-role V3 freeze.
-- Preserve exact revision increments and version audit rows; item audits, source coverage,
-- locks, full SQL recomputation, ownership, draft and projection checks are unchanged.
-- No existing business data is changed by installation. CREATE OR REPLACE preserves ACLs.
begin;
create or replace function public.bump_estimate_content_revision_from_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid;
  target_version_ids uuid[];
  target_status public.estimate_status;
begin
  -- A service-role freeze has already locked and validated this version and every line.
  -- Keep all ordinary writes and all changes outside the frozen projections on the row path.
  if tg_op = 'UPDATE'
    and pg_catalog.current_setting('role', true) = 'service_role'
    and old.id = new.id and old.version_id = new.version_id and old.tenant_id = new.tenant_id
    and old.item_type = 'line'::public.estimate_item_type and new.item_type = old.item_type
    and new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_freeze_items', true), '')
    and new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true), '')
    and coalesce(pg_catalog.current_setting('miaouffrage.estimate_v2_snapshot_freeze', true), '') = 'on'
    and (to_jsonb(new) - array['pu_ht_cents','snapshot_pu_ht_cents','snapshot_gross_ht_cents','snapshot_gross_fo_ht_cents','snapshot_fo_ht_cents','snapshot_mo_ht_cents','snapshot_mo_atelier_ht_cents','snapshot_mo_chantier_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','updated_at']) is not distinct from (to_jsonb(old) - array['pu_ht_cents','snapshot_pu_ht_cents','snapshot_gross_ht_cents','snapshot_gross_fo_ht_cents','snapshot_fo_ht_cents','snapshot_mo_ht_cents','snapshot_mo_atelier_ht_cents','snapshot_mo_chantier_ht_cents','line_total_ht_cents','line_tax_cents','line_total_ttc_cents','updated_at'])
  then return new;
  end if;
  -- Lot 2, sub-lot 2.8 (M6b): the atomic creation of a version bumps the revision once per item
  -- itself, after its insert (public.estimate_creation_replay_item_effects_for_writer).
  if tg_op = 'INSERT' then
    if new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '') then
      return new;
    end if;
  -- Reorder and move: an order operation takes one revision step per written item itself
  -- (private.estimate_item_order_replay_effects).
  elsif tg_op = 'UPDATE' then
    if old.version_id = new.version_id
      and new.version_id::text = coalesce(pg_catalog.current_setting('miaouffrage.estimate_item_order_atomic', true), '')
    then
      return new;
    end if;
  end if;

  target_version_ids := case
    when tg_op = 'INSERT' then array[new.version_id]
    when tg_op = 'DELETE' then array[old.version_id]
    else array[old.version_id, new.version_id]
  end;

  if tg_op = 'UPDATE'
    and (to_jsonb(new) - 'updated_at') is not distinct from
      (to_jsonb(old) - 'updated_at')
  then
    return new;
  end if;

  -- Lock both parents in a stable order when an item is moved between versions.
  for target_version_id in
    select distinct candidate.version_id
    from unnest(target_version_ids) as candidate(version_id)
    where candidate.version_id is not null
    order by candidate.version_id
  loop
    target_status := null;
    select version.status
      into target_status
    from public.estimate_versions version
    where version.id = target_version_id
    for update;

    -- A cascading parent delete removes the version before its child rows.
    if target_status is null then
      if tg_op = 'DELETE' then
        continue;
      end if;
      raise exception
        using
          errcode = 'P0001',
          message = 'ESTIMATE_VERSION_NOT_FOUND';
    end if;

    if target_status <> 'draft'::public.estimate_status then
      raise exception
        using
          errcode = '42501',
          message = 'ESTIMATE_VERSION_READ_ONLY';
    end if;

    update public.estimate_versions version
    set content_revision = version.content_revision + 1
    where version.id = target_version_id;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.freeze_estimate_v3_snapshot(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_content_revision bigint,
  p_actor_user_id uuid,
  p_purpose text,
  p_calculation_context jsonb,
  p_item_snapshots jsonb,
  p_version_totals jsonb
)
returns public.estimate_versions
language plpgsql
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  project_owner_id uuid;
  actor_role public.tenant_role;
  allowed_tax_rates integer[];
  previous_v3_writer text;
  computed jsonb;
  expected_context jsonb;
  expected_items jsonb;
  submitted_items jsonb;
  expected_totals jsonb;
  frozen_version public.estimate_versions;
  previous_freeze_items text;
  previous_creation text;
  previous_replay text;
  version_before jsonb;
  version_after jsonb;
  base_revision bigint;
  revision_steps integer;
  audit_user_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_purpose is null or p_purpose not in ('send', 'approval') then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_SNAPSHOT_PURPOSE_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  join public.tenants tenant
    on tenant.id = version.tenant_id
   and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = version.tenant_id
   and membership.user_id = p_actor_user_id
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update of version;

  select project.user_id, membership.role
    into project_owner_id, actor_role
  from public.estimate_projects project
  join public.tenants tenant
    on tenant.id = project.tenant_id
   and tenant.is_active
  join public.tenant_memberships membership
    on membership.tenant_id = project.tenant_id
   and membership.user_id = p_actor_user_id
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id
  for share of project, tenant, membership;

  if target_version.id is null
    or actor_role is null
    or actor_role not in (
      'admin'::public.tenant_role,
      'engineer'::public.tenant_role
    )
    or (
      project_owner_id <> p_actor_user_id
      and actor_role <> 'admin'::public.tenant_role
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V3_SNAPSHOT_NOT_WRITABLE';
  end if;

  if p_purpose = 'send' and not exists (
      select 1
      from public.draft_locks lock
      where lock.version_id = target_version.id
        and lock.tenant_id = target_version.tenant_id
        and lock.user_id = p_actor_user_id
        and lock.expires_at > statement_timestamp()
    ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  if p_purpose = 'approval' and exists (
      select 1
      from public.draft_locks lock
      where lock.version_id = target_version.id
        and lock.tenant_id = target_version.tenant_id
        and lock.user_id <> p_actor_user_id
        and lock.expires_at > statement_timestamp()
    ) then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_CONFLICT';
  end if;

  if target_version.updated_at is distinct from p_expected_updated_at
    or target_version.content_revision is distinct from p_expected_content_revision
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.status <> 'draft'::public.estimate_status
    or target_version.calc_engine_version <> 3
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V3_SNAPSHOT_REQUIRES_DRAFT';
  end if;

  if jsonb_typeof(p_calculation_context) is distinct from 'object'
    or jsonb_typeof(p_item_snapshots) is distinct from 'array'
    or jsonb_typeof(p_version_totals) is distinct from 'object'
    or exists (
      select 1
      from jsonb_array_elements(p_item_snapshots) snapshot(value)
      where jsonb_typeof(snapshot.value) is distinct from 'object'
        or jsonb_typeof(snapshot.value -> 'id') is distinct from 'string'
        or (snapshot.value ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_SNAPSHOT_INVALID';
  end if;

  perform role.id
  from public.labor_roles role
  where role.id in (
    select referenced.role_id
    from (
      select item.labor_role_id as role_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_atelier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_chantier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
    ) referenced
    where referenced.role_id is not null
  )
  order by role.id
  for share of role;

  if exists (
    select 1
    from (
      select item.labor_role_id as role_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_atelier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
      union
      select item.labor_role_chantier_id
      from public.estimate_items item
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
    ) referenced
    left join public.labor_roles role
      on role.id = referenced.role_id
     and role.tenant_id = target_version.tenant_id
     and role.user_id = project_owner_id
    where referenced.role_id is not null
      and role.id is null
  ) then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH';
  end if;

  perform flag.id
  from public.feature_flags flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT'
  for share;

  -- Heures sans rôle : la MO serait chiffrée à 0 en silence (même règle que le gel v2, sur les
  -- heures par unité d'une ligne chiffrée).
  if exists (
    select 1
    from public.estimate_items item
    cross join lateral (
      select coalesce((
        select bool_or(flag.enabled)
        from public.feature_flags flag
        where flag.tenant_id = target_version.tenant_id
          and flag.flag_key = 'EST_031_LABOR_SPLIT'
      ), false) and (
        coalesce(item.h_mo_atelier_per_unit, 0) > 0
        or item.labor_role_atelier_id is not null
        or coalesce(item.h_mo_chantier_per_unit, 0) > 0
        or item.labor_role_chantier_id is not null
        or coalesce(item.k_mo_atelier, 1) <> 1
        or coalesce(item.k_mo_chantier, 1) <> 1
      ) as use_split
    ) calculation_mode
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.pricing_status = 'priced'::public.estimate_line_pricing_status
      and (
        (
          not calculation_mode.use_split
          and coalesce(item.h_mo_per_unit, 0) > 0
          and item.labor_role_id is null
        )
        or (
          calculation_mode.use_split
          and (
            (coalesce(item.h_mo_atelier_per_unit, 0) > 0 and item.labor_role_atelier_id is null)
            or (coalesce(item.h_mo_chantier_per_unit, 0) > 0 and item.labor_role_chantier_id is null)
          )
        )
      )
  ) then
    raise exception using
      errcode = '23502',
      message = 'ESTIMATE_V3_LABOR_ROLE_REQUIRED';
  end if;

  -- D9 : unité obligatoire au gel d'une ligne chiffrée (un brouillon peut rester incomplet).
  if exists (
    select 1
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.pricing_status = 'priced'::public.estimate_line_pricing_status
      and item.unit_code is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_UNIT_REQUIRED';
  end if;

  -- D8 : taux autorisés par la politique (absente : liste par défaut de §6.3).
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('estimate-calc-policy:' || target_version.tenant_id::text, 0)
  );
  select policy.allowed_tax_rates_bp
    into allowed_tax_rates
  from public.tenant_calc_policies policy
  where policy.tenant_id = target_version.tenant_id
  for share;
  allowed_tax_rates := coalesce(allowed_tax_rates, '{2000,1000,550,210}'::integer[]);

  if exists (
    select 1
    from public.estimate_items item
    where item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.pricing_status = 'priced'::public.estimate_line_pricing_status
      and not (item.tax_rate_bp = any(allowed_tax_rates))
  ) then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_TAX_RATE_NOT_ALLOWED';
  end if;

  previous_v3_writer := coalesce(
    pg_catalog.current_setting('miaouffrage.estimate_v3_writer', true),
    ''
  );
  perform pg_catalog.set_config(
    'miaouffrage.estimate_v3_writer',
    target_version.id::text,
    true
  );

  computed := public.estimate_v3_compute_for_writer(target_version.id);

  expected_context := jsonb_build_object(
    'engine', 3,
    'labor_split_enabled', computed -> 'params' -> 'labor_split_enabled',
    'labor_roles', computed -> 'labor_roles',
    'sale_coefficients', jsonb_build_object(
      'fo', computed -> 'params' -> 'sale_coefficient_fo',
      'mo', computed -> 'params' -> 'sale_coefficient_mo'
    ),
    'discount', jsonb_build_object(
      'kind', case
        when target_version.discount_amount_cents is not null then 'amount'
        when target_version.discount_bp > 0 then 'rate'
        else 'none'
      end,
      'requested_cents', target_version.discount_amount_cents,
      'rate_bp', case
        when target_version.discount_amount_cents is null and target_version.discount_bp > 0
          then target_version.discount_bp
      end,
      'base_cents', computed -> 'totals' -> 'gross_ht_cents',
      'applied_cents', computed -> 'totals' -> 'discount_applied_cents'
    ),
    'commercial_rounding', jsonb_build_object(
      'mode', target_version.rounding_mode::text,
      'step_cents', target_version.rounding_step_cents,
      'applied_cents', computed -> 'totals' -> 'commercial_rounding_cents'
    ),
    'cost_subtotal_cents', computed -> 'totals' -> 'cost_subtotal_cents',
    'realized_sale_coefficient', (computed -> 'totals' ->> 'realized_sale_coefficient')::numeric,
    'tax_breakdown', computed -> 'totals' -> 'tax_breakdown'
  );

  if p_calculation_context is distinct from expected_context then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_V3_CALCULATION_CONTEXT_CONFLICT';
  end if;

  select coalesce(jsonb_object_agg(line.value ->> 'id', jsonb_build_object(
      'snapshot_pu_ht_cents', line.value -> 'pu_ht_cents',
      'snapshot_gross_ht_cents', line.value -> 'gross_ht_cents',
      'snapshot_gross_fo_ht_cents', line.value -> 'gross_fo_ht_cents',
      'snapshot_fo_ht_cents', line.value -> 'snapshot_fo_ht_cents',
      'snapshot_mo_ht_cents', line.value -> 'snapshot_mo_ht_cents',
      'snapshot_mo_atelier_ht_cents', line.value -> 'snapshot_mo_atelier_ht_cents',
      'snapshot_mo_chantier_ht_cents', line.value -> 'snapshot_mo_chantier_ht_cents',
      'line_total_ht_cents', line.value -> 'line_total_ht_cents',
      'line_tax_cents', line.value -> 'line_tax_cents',
      'line_total_ttc_cents', line.value -> 'line_total_ttc_cents'
    )), '{}'::jsonb)
    into expected_items
  from jsonb_array_elements(computed -> 'lines') line(value);

  select coalesce(jsonb_object_agg(lower(snapshot.value ->> 'id'), snapshot.value - 'id'), '{}'::jsonb)
    into submitted_items
  from jsonb_array_elements(p_item_snapshots) snapshot(value);

  expected_totals := jsonb_build_object(
    'gross_ht_cents', computed -> 'totals' -> 'gross_ht_cents',
    'discount_applied_cents', computed -> 'totals' -> 'discount_applied_cents',
    'commercial_rounding_cents', computed -> 'totals' -> 'commercial_rounding_cents',
    'total_ht_cents', computed -> 'totals' -> 'total_ht_cents',
    'total_tax_cents', computed -> 'totals' -> 'total_tax_cents',
    'total_ttc_cents', computed -> 'totals' -> 'total_ttc_cents',
    'rounding_adjustment_cents', 0
  );

  if (select count(distinct lower(snapshot.value ->> 'id')) from jsonb_array_elements(p_item_snapshots) snapshot(value))
      <> jsonb_array_length(p_item_snapshots)
    or submitted_items is distinct from expected_items
    or p_version_totals is distinct from expected_totals
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V3_PROJECTION_MISMATCH';
  end if;

  if target_version.calc_snapshot_content_revision = target_version.content_revision
    and target_version.calc_snapshot_context = p_calculation_context
    and target_version.gross_ht_cents = (expected_totals ->> 'gross_ht_cents')::integer
    and target_version.discount_applied_cents = (expected_totals ->> 'discount_applied_cents')::integer
    and target_version.commercial_rounding_cents = (expected_totals ->> 'commercial_rounding_cents')::integer
    and target_version.total_ht_cents = (expected_totals ->> 'total_ht_cents')::integer
    and target_version.total_tax_cents = (expected_totals ->> 'total_tax_cents')::integer
    and target_version.total_ttc_cents = (expected_totals ->> 'total_ttc_cents')::integer
    and not exists (
      select 1
      from public.estimate_items item
      join jsonb_array_elements(computed -> 'lines') line(value)
        on (line.value ->> 'id')::uuid = item.id
      where item.version_id = target_version.id
        and item.tenant_id = target_version.tenant_id
        and (
          item.pu_ht_cents is distinct from (line.value ->> 'pu_ht_cents')::integer
          or item.snapshot_pu_ht_cents is distinct from (line.value ->> 'pu_ht_cents')::integer
          or item.snapshot_gross_ht_cents is distinct from (line.value ->> 'gross_ht_cents')::integer
          or item.snapshot_gross_fo_ht_cents is distinct from (line.value ->> 'gross_fo_ht_cents')::integer
          or item.snapshot_fo_ht_cents is distinct from (line.value ->> 'snapshot_fo_ht_cents')::integer
          or item.snapshot_mo_ht_cents is distinct from (line.value ->> 'snapshot_mo_ht_cents')::integer
          or item.snapshot_mo_atelier_ht_cents is distinct from (line.value ->> 'snapshot_mo_atelier_ht_cents')::integer
          or item.snapshot_mo_chantier_ht_cents is distinct from (line.value ->> 'snapshot_mo_chantier_ht_cents')::integer
          or item.line_total_ht_cents is distinct from (line.value ->> 'line_total_ht_cents')::integer
          or item.line_tax_cents is distinct from (line.value ->> 'line_tax_cents')::integer
          or item.line_total_ttc_cents is distinct from (line.value ->> 'line_total_ttc_cents')::integer
        )
    )
  then
    perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_v3_writer, true);
    return target_version;
  end if;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_freeze',
    'on',
    true
  );

  -- Only revision bumps are batched; item audit and source coverage triggers still run.
  previous_freeze_items := coalesce(pg_catalog.current_setting('miaouffrage.estimate_v3_freeze_items', true), '');
  perform pg_catalog.set_config('miaouffrage.estimate_v3_freeze_items', target_version.id::text, true);
  select to_jsonb(version.*) into version_before from public.estimate_versions version where version.id = target_version.id;
  base_revision := (version_before->>'content_revision')::bigint;
  with old_rows as materialized (
    select item.id, to_jsonb(item.*) as before_data from public.estimate_items item
    where item.version_id = target_version.id and item.tenant_id = target_version.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
  ), writes as (
    update public.estimate_items item
  set
    pu_ht_cents = (line.value ->> 'pu_ht_cents')::integer,
    snapshot_pu_ht_cents = (line.value ->> 'pu_ht_cents')::integer,
    snapshot_gross_ht_cents = (line.value ->> 'gross_ht_cents')::integer,
    snapshot_gross_fo_ht_cents = (line.value ->> 'gross_fo_ht_cents')::integer,
    snapshot_fo_ht_cents = (line.value ->> 'snapshot_fo_ht_cents')::integer,
    snapshot_mo_ht_cents = (line.value ->> 'snapshot_mo_ht_cents')::integer,
    snapshot_mo_atelier_ht_cents = (line.value ->> 'snapshot_mo_atelier_ht_cents')::integer,
    snapshot_mo_chantier_ht_cents = (line.value ->> 'snapshot_mo_chantier_ht_cents')::integer,
    line_total_ht_cents = (line.value ->> 'line_total_ht_cents')::integer,
    line_tax_cents = (line.value ->> 'line_tax_cents')::integer,
    line_total_ttc_cents = (line.value ->> 'line_total_ttc_cents')::integer
  from old_rows prior join jsonb_array_elements(computed -> 'lines') line(value)
    on (line.value ->> 'id')::uuid = prior.id
  where item.id = prior.id and item.id = (line.value ->> 'id')::uuid
    and item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
  returning prior.before_data, to_jsonb(item.*) as after_data
  ) select count(*) filter (where after_data - 'updated_at' is distinct from before_data - 'updated_at')::integer
    into revision_steps from writes;
  perform pg_catalog.set_config('miaouffrage.estimate_v3_freeze_items', previous_freeze_items, true);

  if revision_steps > 0 then
    previous_creation := coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_atomic', true), '');
    previous_replay := coalesce(pg_catalog.current_setting('miaouffrage.estimate_creation_replay', true), '');
    perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', target_version.id::text, true);
    perform pg_catalog.set_config('miaouffrage.estimate_creation_replay', target_version.id::text, true);
    update public.estimate_versions version set content_revision = version.content_revision + revision_steps
    where version.id = target_version.id;
    perform pg_catalog.set_config('miaouffrage.estimate_creation_replay', previous_replay, true);
    perform pg_catalog.set_config('miaouffrage.estimate_creation_atomic', previous_creation, true);
    select to_jsonb(version.*) into version_after from public.estimate_versions version where version.id = target_version.id;
    audit_user_id := coalesce(nullif(version_after->>'user_id','')::uuid, nullif(version_before->>'user_id','')::uuid,
      nullif(version_after->>'created_by','')::uuid, nullif(version_before->>'created_by','')::uuid, project_owner_id);
    insert into public.audit_logs (tenant_id,user_id,table_name,record_id,estimate_version_id,action,before_data,after_data)
    select target_version.tenant_id, coalesce((select auth.uid()),audit_user_id), 'estimate_versions', target_version.id,
      target_version.id,'UPDATE',
      case when step.k=1 then version_before else version_after || jsonb_build_object('content_revision',base_revision+step.k-1) end,
      version_after || jsonb_build_object('content_revision',base_revision+step.k)
    from generate_series(1,revision_steps) step(k);
  end if;

  update public.estimate_versions version
  set
    gross_ht_cents = (expected_totals ->> 'gross_ht_cents')::integer,
    discount_applied_cents = (expected_totals ->> 'discount_applied_cents')::integer,
    commercial_rounding_cents = (expected_totals ->> 'commercial_rounding_cents')::integer,
    total_ht_cents = (expected_totals ->> 'total_ht_cents')::integer,
    total_tax_cents = (expected_totals ->> 'total_tax_cents')::integer,
    total_ttc_cents = (expected_totals ->> 'total_ttc_cents')::integer,
    calc_snapshot_context = p_calculation_context
  where version.id = target_version.id
    and version.tenant_id = target_version.tenant_id
  returning version.* into frozen_version;

  update public.estimate_versions version
  set calc_snapshot_content_revision = version.content_revision
  where version.id = frozen_version.id
    and version.tenant_id = frozen_version.tenant_id
  returning version.* into frozen_version;

  perform pg_catalog.set_config(
    'miaouffrage.estimate_v2_snapshot_freeze',
    'off',
    true
  );
  perform pg_catalog.set_config('miaouffrage.estimate_v3_writer', previous_v3_writer, true);

  if frozen_version.id is null then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  return frozen_version;
end;
$$;

commit;
