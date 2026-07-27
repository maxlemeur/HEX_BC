-- Close the integrity gaps introduced when calc_engine_version and
-- contractor_role were added to estimate_versions.
--
-- 1. A sent/accepted/archived version must not change either contractual
--    setting.
-- 2. A duplicate must retain both settings instead of accepting their defaults.

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    if new.status = old.status then
      raise exception 'Estimate version is read-only';
    end if;

    if new.created_at is distinct from old.created_at
      or new.project_id is distinct from old.project_id
      or new.version_number is distinct from old.version_number
      or new.title is distinct from old.title
      or new.exclusions is distinct from old.exclusions
      or new.date_devis is distinct from old.date_devis
      or new.validite_jours is distinct from old.validite_jours
      or new.margin_multiplier is distinct from old.margin_multiplier
      or new.margin_mode is distinct from old.margin_mode
      or new.currency is distinct from old.currency
      or new.margin_bp is distinct from old.margin_bp
      or new.discount_bp is distinct from old.discount_bp
      or new.discount_mode is distinct from old.discount_mode
      or new.discount_steps is distinct from old.discount_steps
      or new.global_coefficient is distinct from old.global_coefficient
      or new.max_section_depth is distinct from old.max_section_depth
      or new.tax_rate_bp is distinct from old.tax_rate_bp
      or new.rounding_mode is distinct from old.rounding_mode
      or new.rounding_step_cents is distinct from old.rounding_step_cents
      or new.total_ht_cents is distinct from old.total_ht_cents
      or new.total_tax_cents is distinct from old.total_tax_cents
      or new.total_ttc_cents is distinct from old.total_ttc_cents
      or new.seal_hash is distinct from old.seal_hash
      or new.parent_version_id is distinct from old.parent_version_id
      or new.variant_label is distinct from old.variant_label
      or new.tenant_id is distinct from old.tenant_id
      or new.calc_engine_version is distinct from old.calc_engine_version
      or new.contractor_role is distinct from old.contractor_role
    then
      raise exception 'Estimate version is read-only';
    end if;
  end if;

  return new;
end;
$$;

-- These settings change the contractual totals and therefore invalidate any
-- approval captured against the previous content_revision.
create or replace function public.guard_estimate_version_workflow_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    new.status is distinct from old.status
    or new.seal_hash is distinct from old.seal_hash
  ) and current_user <> 'service_role' then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_STATUS_REQUIRES_TRUSTED_WORKFLOW';
  end if;

  if new.content_revision is distinct from old.content_revision
    and pg_trigger_depth() = 1
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_CONTENT_REVISION_IS_MANAGED';
  end if;

  if new.tenant_id is distinct from old.tenant_id
    or new.project_id is distinct from old.project_id
    or new.version_number is distinct from old.version_number
    or new.title is distinct from old.title
    or new.exclusions is distinct from old.exclusions
    or new.date_devis is distinct from old.date_devis
    or new.validite_jours is distinct from old.validite_jours
    or new.margin_multiplier is distinct from old.margin_multiplier
    or new.margin_mode is distinct from old.margin_mode
    or new.currency is distinct from old.currency
    or new.margin_bp is distinct from old.margin_bp
    or new.discount_bp is distinct from old.discount_bp
    or new.discount_mode is distinct from old.discount_mode
    or new.discount_steps is distinct from old.discount_steps
    or new.global_coefficient is distinct from old.global_coefficient
    or new.max_section_depth is distinct from old.max_section_depth
    or new.tax_rate_bp is distinct from old.tax_rate_bp
    or new.rounding_mode is distinct from old.rounding_mode
    or new.rounding_step_cents is distinct from old.rounding_step_cents
    or new.total_ht_cents is distinct from old.total_ht_cents
    or new.total_tax_cents is distinct from old.total_tax_cents
    or new.total_ttc_cents is distinct from old.total_ttc_cents
    or new.parent_version_id is distinct from old.parent_version_id
    or new.variant_label is distinct from old.variant_label
    or new.calc_engine_version is distinct from old.calc_engine_version
    or new.contractor_role is distinct from old.contractor_role
  then
    new.content_revision := old.content_revision + 1;
  end if;

  return new;
end;
$$;

-- A contractor-role PATCH changes both the contractual totals and the tax
-- carried by every line. Keep those writes in one transaction and revalidate
-- the authorization, draft lock and optimistic-concurrency token inside the
-- database immediately before the first mutation.
--
-- The JSON patch is computed by the trusted server with the canonical
-- TypeScript calculation engine. This RPC is consequently service-role-only:
-- exposing it to authenticated clients would let them forge those totals.
create or replace function public.patch_estimate_contractor_role(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid,
  p_patch jsonb
)
returns public.estimate_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  patched_version public.estimate_versions%rowtype;
  updated_version public.estimate_versions%rowtype;
  unexpected_patch_keys text[];
begin
  if p_version_id is null
    or p_tenant_id is null
    or p_expected_updated_at is null
    or p_actor_user_id is null
  then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_CONTRACTOR_ROLE_PATCH_INVALID_ARGUMENTS';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_CONTRACTOR_ROLE_PATCH_INVALID_PAYLOAD';
  end if;

  select array_agg(key order by key)
    into unexpected_patch_keys
  from jsonb_object_keys(p_patch) as patch_key(key)
  where key <> all (array[
    'title',
    'exclusions',
    'date_devis',
    'validite_jours',
    'margin_multiplier',
    'margin_mode',
    'currency',
    'margin_bp',
    'discount_bp',
    'discount_mode',
    'discount_steps',
    'global_coefficient',
    'max_section_depth',
    'tax_rate_bp',
    'contractor_role',
    'rounding_mode',
    'rounding_step_cents',
    'total_ht_cents',
    'total_tax_cents',
    'total_ttc_cents'
  ]);

  if unexpected_patch_keys is not null then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_CONTRACTOR_ROLE_PATCH_UNEXPECTED_FIELDS',
        detail = array_to_string(unexpected_patch_keys, ',');
  end if;

  if not (p_patch ? 'contractor_role')
    or not (p_patch ? 'total_ht_cents')
    or not (p_patch ? 'total_tax_cents')
    or not (p_patch ? 'total_ttc_cents')
  then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_CONTRACTOR_ROLE_PATCH_INCOMPLETE';
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
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update of version;

  if not found then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_NOT_FOUND';
  end if;

  if target_version.status <> 'draft'::public.estimate_status then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_READ_ONLY';
  end if;

  if target_version.updated_at is distinct from p_expected_updated_at then
    raise exception
      using
        errcode = '40001',
        message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    join public.estimate_projects project
      on project.id = target_version.project_id
     and project.tenant_id = target_version.tenant_id
    where membership.tenant_id = target_version.tenant_id
      and membership.user_id = p_actor_user_id
      and membership.role in (
        'admin'::public.tenant_role,
        'engineer'::public.tenant_role
      )
      and (
        project.user_id = p_actor_user_id
        or membership.role = 'admin'::public.tenant_role
      )
  ) then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_WRITE_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.draft_locks lock
    where lock.version_id = target_version.id
      and lock.tenant_id = target_version.tenant_id
      and lock.user_id = p_actor_user_id
      and lock.expires_at > now()
  ) then
    raise exception
      using
        errcode = '40001',
        message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  patched_version := jsonb_populate_record(target_version, p_patch);

  if patched_version.contractor_role = 'subcontractor'
    and (
      patched_version.total_tax_cents <> 0
      or patched_version.total_ttc_cents <> patched_version.total_ht_cents
    )
  then
    raise exception
      using
        errcode = '22023',
        message = 'ESTIMATE_REVERSE_CHARGE_TOTALS_INVALID';
  end if;

  update public.estimate_items item
  set
    line_tax_cents = case
      when item.line_total_ht_cents is null then null
      when patched_version.contractor_role = 'subcontractor' then 0
      else least(
        round(
          item.line_total_ht_cents::numeric
          * coalesce(item.tax_rate_bp, patched_version.tax_rate_bp, 0)::numeric
          / 10000
        ),
        2147483647
      )::integer
    end,
    line_total_ttc_cents = case
      when item.line_total_ht_cents is null then null
      when patched_version.contractor_role = 'subcontractor'
        then item.line_total_ht_cents
      else least(
        item.line_total_ht_cents::numeric
        + least(
          round(
            item.line_total_ht_cents::numeric
            * coalesce(item.tax_rate_bp, patched_version.tax_rate_bp, 0)::numeric
            / 10000
          ),
          2147483647
        ),
        2147483647
      )::integer
    end
  where item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
    and item.item_type = 'line'::public.estimate_item_type
    and (
      item.line_tax_cents is distinct from case
        when item.line_total_ht_cents is null then null
        when patched_version.contractor_role = 'subcontractor' then 0
        else least(
          round(
            item.line_total_ht_cents::numeric
            * coalesce(item.tax_rate_bp, patched_version.tax_rate_bp, 0)::numeric
            / 10000
          ),
          2147483647
        )::integer
      end
      or item.line_total_ttc_cents is distinct from case
        when item.line_total_ht_cents is null then null
        when patched_version.contractor_role = 'subcontractor'
          then item.line_total_ht_cents
        else least(
          item.line_total_ht_cents::numeric
          + least(
            round(
              item.line_total_ht_cents::numeric
              * coalesce(item.tax_rate_bp, patched_version.tax_rate_bp, 0)::numeric
              / 10000
            ),
            2147483647
          ),
          2147483647
        )::integer
      end
    );

  update public.estimate_versions version
  set
    title = patched_version.title,
    exclusions = patched_version.exclusions,
    date_devis = patched_version.date_devis,
    validite_jours = patched_version.validite_jours,
    margin_multiplier = patched_version.margin_multiplier,
    margin_mode = patched_version.margin_mode,
    currency = patched_version.currency,
    margin_bp = patched_version.margin_bp,
    discount_bp = patched_version.discount_bp,
    discount_mode = patched_version.discount_mode,
    discount_steps = patched_version.discount_steps,
    global_coefficient = patched_version.global_coefficient,
    max_section_depth = patched_version.max_section_depth,
    tax_rate_bp = patched_version.tax_rate_bp,
    contractor_role = patched_version.contractor_role,
    rounding_mode = patched_version.rounding_mode,
    rounding_step_cents = patched_version.rounding_step_cents,
    total_ht_cents = patched_version.total_ht_cents,
    total_tax_cents = patched_version.total_tax_cents,
    total_ttc_cents = patched_version.total_ttc_cents
  where version.id = target_version.id
    and version.tenant_id = target_version.tenant_id
  returning version.* into updated_version;

  return updated_version;
end;
$$;

revoke all on function public.patch_estimate_contractor_role(
  uuid,
  uuid,
  timestamptz,
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function public.patch_estimate_contractor_role(
  uuid,
  uuid,
  timestamptz,
  uuid,
  jsonb
) to service_role;

create or replace function public.duplicate_estimate_version(
  source_version_id uuid,
  as_variant boolean default false
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
  variant_parent_id uuid := null;
  next_variant_index integer := 0;
  next_variant_label text := null;
begin
  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
  where v.id = duplicate_estimate_version.source_version_id
    and (select public.is_tenant_member(p.tenant_id))
    and (
      p.user_id = (select auth.uid())
      or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  if coalesce(as_variant, false) then
    variant_parent_id := duplicate_estimate_version.source_version_id;

    loop
      next_variant_index := next_variant_index + 1;
      next_variant_label := public.estimate_variant_label_from_index(next_variant_index);

      exit when not exists (
        select 1
        from public.estimate_versions existing_variant
        where existing_variant.parent_version_id = variant_parent_id
          and existing_variant.variant_label = next_variant_label
      );
    end loop;
  end if;

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    exclusions,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    calc_engine_version,
    contractor_role,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    parent_version_id,
    variant_label,
    max_section_depth
  )
  values (
    new_version_id,
    source_version.tenant_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
    source_version.exclusions,
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.calc_engine_version,
    source_version.contractor_role,
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents,
    variant_parent_id,
    next_variant_label,
    source_version.max_section_depth
  );

  create temporary table _estimate_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_item_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_items
  where version_id = duplicate_estimate_version.source_version_id;

  with recursive source_item_hierarchy as (
    select
      root.id,
      root.parent_id,
      0 as depth
    from public.estimate_items root
    where root.version_id = duplicate_estimate_version.source_version_id
      and root.parent_id is null

    union all

    select
      child.id,
      child.parent_id,
      parent.depth + 1
    from public.estimate_items child
    join source_item_hierarchy parent on parent.id = child.parent_id
    where child.version_id = duplicate_estimate_version.source_version_id
  )
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
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
    new_version_id,
    parent_map.new_id,
    src.item_type,
    src.position,
    src.title,
    src.description,
    src.quantity,
    src.unit_price_ht_cents,
    src.tax_rate_bp,
    src.k_fo,
    src.h_mo,
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.selected_supplier_price_id,
    src.source_provider,
    src.source_job_id,
    src.source_file_name,
    src.source_page,
    coalesce(src.source_metadata, '{}'::jsonb),
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from source_item_hierarchy hierarchy
  join public.estimate_items src on src.id = hierarchy.id
  join _estimate_item_map map on map.old_id = src.id
  left join _estimate_item_map parent_map on parent_map.old_id = src.parent_id
  order by hierarchy.depth asc, src.position asc, src.id asc;

  insert into public.takeoff_version_links (
    tenant_id,
    takeoff_job_id,
    source_version_id,
    target_version_id,
    linked_at,
    linked_by
  )
  select distinct on (src.takeoff_job_id)
    source_version.tenant_id,
    src.takeoff_job_id,
    coalesce(existing_link.source_version_id, job.estimate_version_id),
    new_version_id,
    now(),
    null
  from public.takeoff_dpgf_review_decisions src
  join public.takeoff_jobs job
    on job.id = src.takeoff_job_id
   and job.tenant_id = source_version.tenant_id
  left join public.takeoff_version_links existing_link
   on existing_link.tenant_id = source_version.tenant_id
   and existing_link.target_version_id = duplicate_estimate_version.source_version_id
   and existing_link.takeoff_job_id = src.takeoff_job_id
  where src.version_id = duplicate_estimate_version.source_version_id
  order by src.takeoff_job_id
  on conflict (takeoff_job_id, target_version_id) do nothing;

  insert into public.takeoff_dpgf_review_decisions (
    id,
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    review_reference,
    line_label,
    line_position,
    source_file_name,
    source_page,
    carried_over_from_version_id,
    carried_over_at,
    decision,
    reason,
    decided_at,
    updated_at,
    decided_by
  )
  select
    gen_random_uuid(),
    src.tenant_id,
    new_version_id,
    src.takeoff_job_id,
    map.new_id,
    src.review_reference,
    src.line_label,
    src.line_position,
    src.source_file_name,
    src.source_page,
    duplicate_estimate_version.source_version_id,
    now(),
    src.decision,
    src.reason,
    src.decided_at,
    src.updated_at,
    src.decided_by
  from public.takeoff_dpgf_review_decisions src
  join _estimate_item_map map on map.old_id = src.estimate_item_id
  where src.version_id = duplicate_estimate_version.source_version_id;

  return new_version_id;
end;
$$;
