-- UX2-011: instantiate estimate template into an existing project.

create or replace function public.instantiate_estimate_template_into_project(
  p_template_id uuid,
  p_project_id uuid,
  p_version_title text,
  p_date_devis date,
  p_validite_jours integer
)
returns table (project_id uuid, version_id uuid)
language plpgsql
set search_path = public
as $$
declare
  source_template public.estimate_templates%rowtype;
  target_project public.estimate_projects%rowtype;
  current_user_id uuid := (select auth.uid());
  new_version_id uuid := gen_random_uuid();
  target_validite_jours integer;
  next_version_number integer := 1;
  total_ht integer := 0;
  total_tax integer := 0;
  total_ttc integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_template_id is null then
    raise exception 'p_template_id is required';
  end if;

  if p_project_id is null then
    raise exception 'p_project_id is required';
  end if;

  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id))
    and (
      t.created_by = current_user_id
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template not found or access denied';
  end if;

  select p.*
    into target_project
  from public.estimate_projects p
  where p.id = p_project_id
    and p.tenant_id = source_template.tenant_id
    and p.is_archived = false
    and (
      p.user_id = current_user_id
      or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Target project not found or access denied';
  end if;

  target_validite_jours := coalesce(p_validite_jours, source_template.validite_jours);
  if target_validite_jours <= 0 then
    raise exception 'validite_jours must be greater than 0';
  end if;

  select coalesce(max(v.version_number), 0) + 1
    into next_version_number
  from public.estimate_versions v
  where v.tenant_id = target_project.tenant_id
    and v.project_id = target_project.id;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0)
    into total_ht, total_tax
  from public.estimate_template_items item
  where item.template_id = p_template_id
    and item.tenant_id = source_template.tenant_id
    and item.item_type = 'line';

  total_ttc := total_ht + total_tax;

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
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents
  )
  values (
    new_version_id,
    source_template.tenant_id,
    target_project.id,
    next_version_number,
    'draft',
    nullif(btrim(coalesce(p_version_title, '')), ''),
    coalesce(p_date_devis, current_date),
    target_validite_jours,
    source_template.margin_multiplier,
    source_template.margin_mode,
    source_template.currency,
    source_template.margin_bp,
    source_template.discount_bp,
    source_template.discount_mode,
    source_template.discount_steps,
    source_template.global_coefficient,
    source_template.tax_rate_bp,
    source_template.rounding_mode,
    source_template.rounding_step_cents,
    total_ht,
    total_tax,
    total_ttc
  );

  create temporary table _estimate_template_instantiation_existing_project_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_instantiation_existing_project_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_template_items
  where template_id = p_template_id;

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
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_template.tenant_id,
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
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_template_items src
  join _estimate_template_instantiation_existing_project_map map on map.old_id = src.id
  left join _estimate_template_instantiation_existing_project_map parent_map
    on parent_map.old_id = src.parent_id
  where src.template_id = p_template_id;

  return query
  select target_project.id, new_version_id;
end;
$$;

revoke all on function public.instantiate_estimate_template_into_project(
  uuid,
  uuid,
  text,
  date,
  integer
) from public;

revoke all on function public.instantiate_estimate_template_into_project(
  uuid,
  uuid,
  text,
  date,
  integer
) from authenticated;

grant execute on function public.instantiate_estimate_template_into_project(
  uuid,
  uuid,
  text,
  date,
  integer
) to authenticated;
