-- UX2-022: Insert estimate template items into an existing estimate version
-- Similar to insert_estimate_assembly_into_version but handles hierarchical template items

create or replace function public.insert_estimate_template_into_version(
  p_version_id uuid,
  p_template_id uuid,
  p_after_item_id uuid default null
)
returns setof public.estimate_items
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_version public.estimate_versions%rowtype;
  source_template public.estimate_templates%rowtype;
  anchor_item record;
  target_parent_id uuid;
  target_position integer;
  tpl_section record;
  tpl_line record;
  inserted_item public.estimate_items%rowtype;
  -- Mapping from template_item_id -> new estimate_item_id (for parent references)
  id_map jsonb := '{}'::jsonb;
  new_parent_id uuid;
  section_offset integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Load target version
  select v.*
    into target_version
  from public.estimate_versions v
  where v.id = p_version_id
    and (select public.is_tenant_member(v.tenant_id));

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  if target_version.status <> 'draft' then
    raise exception 'Estimate version is read only';
  end if;

  -- Load source template
  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id));

  if not found then
    raise exception 'Estimate template not found or access denied';
  end if;

  if source_template.tenant_id <> target_version.tenant_id then
    raise exception 'Estimate template and version tenant mismatch';
  end if;

  -- Ensure template has items
  if not exists (
    select 1
    from public.estimate_template_items ti
    where ti.template_id = source_template.id
      and ti.tenant_id = source_template.tenant_id
  ) then
    raise exception 'Estimate template has no items';
  end if;

  -- Determine insertion point
  if p_after_item_id is not null then
    select id, parent_id, position
      into anchor_item
    from public.estimate_items
    where id = p_after_item_id
      and version_id = target_version.id
      and tenant_id = target_version.tenant_id;

    if not found then
      raise exception 'after_item_id invalide';
    end if;

    target_parent_id := anchor_item.parent_id;
    target_position := anchor_item.position + 1;
  else
    target_parent_id := null;
    select coalesce(max(i.position), 0) + 1
      into target_position
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id is null;
  end if;

  -- Count root-level template items to know how many positions to shift
  select count(*)::integer
    into section_offset
  from public.estimate_template_items ti
  where ti.template_id = source_template.id
    and ti.tenant_id = source_template.tenant_id
    and ti.parent_id is null;

  -- Shift existing items to make room
  if target_parent_id is null then
    perform 1
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id is null
    for update;

    update public.estimate_items
    set position = position + section_offset
    where version_id = target_version.id
      and tenant_id = target_version.tenant_id
      and parent_id is null
      and position >= target_position;
  else
    perform 1
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id = target_parent_id
    for update;

    update public.estimate_items
    set position = position + section_offset
    where version_id = target_version.id
      and tenant_id = target_version.tenant_id
      and parent_id = target_parent_id
      and position >= target_position;
  end if;

  -- Insert root-level template items (sections) first, in position order
  for tpl_section in
    select ti.*
    from public.estimate_template_items ti
    where ti.template_id = source_template.id
      and ti.tenant_id = source_template.tenant_id
      and ti.parent_id is null
    order by ti.position asc, ti.created_at asc
  loop
    insert into public.estimate_items (
      tenant_id, version_id, parent_id, item_type, position, title, description,
      quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
      h_mo_atelier, k_mo_atelier, labor_role_atelier_id,
      h_mo_chantier, k_mo_chantier, labor_role_chantier_id,
      pu_ht_cents, labor_role_id, category_id, supply_type_id,
      line_total_ht_cents, line_tax_cents, line_total_ttc_cents
    )
    values (
      target_version.tenant_id,
      target_version.id,
      target_parent_id,
      tpl_section.item_type,
      target_position + tpl_section.position - (
        select min(ti2.position)
        from public.estimate_template_items ti2
        where ti2.template_id = source_template.id
          and ti2.tenant_id = source_template.tenant_id
          and ti2.parent_id is null
      ),
      tpl_section.title,
      tpl_section.description,
      -- Sections have null numeric fields
      case when tpl_section.item_type = 'section' then null else tpl_section.quantity end,
      case when tpl_section.item_type = 'section' then null else tpl_section.unit_price_ht_cents end,
      case when tpl_section.item_type = 'section' then null else coalesce(tpl_section.tax_rate_bp, target_version.tax_rate_bp, 2000) end,
      case when tpl_section.item_type = 'section' then null else tpl_section.k_fo end,
      case when tpl_section.item_type = 'section' then null else tpl_section.h_mo end,
      case when tpl_section.item_type = 'section' then 1.0 else coalesce(tpl_section.h_mo_majoration, 1.0) end,
      case when tpl_section.item_type = 'section' then null else tpl_section.k_mo end,
      case when tpl_section.item_type = 'section' then null else tpl_section.h_mo_atelier end,
      case when tpl_section.item_type = 'section' then 1.0 else coalesce(tpl_section.k_mo_atelier, 1.0) end,
      case when tpl_section.item_type = 'section' then null else tpl_section.labor_role_atelier_id end,
      case when tpl_section.item_type = 'section' then null else tpl_section.h_mo_chantier end,
      case when tpl_section.item_type = 'section' then 1.0 else coalesce(tpl_section.k_mo_chantier, 1.0) end,
      case when tpl_section.item_type = 'section' then null else tpl_section.labor_role_chantier_id end,
      case when tpl_section.item_type = 'section' then null else tpl_section.pu_ht_cents end,
      case when tpl_section.item_type = 'section' then null else tpl_section.labor_role_id end,
      case when tpl_section.item_type = 'section' then null else tpl_section.category_id end,
      case when tpl_section.item_type = 'section' then null else tpl_section.supply_type_id end,
      case when tpl_section.item_type = 'section' then null else coalesce(tpl_section.line_total_ht_cents, 0) end,
      case when tpl_section.item_type = 'section' then null else coalesce(tpl_section.line_tax_cents, 0) end,
      case when tpl_section.item_type = 'section' then null else coalesce(tpl_section.line_total_ttc_cents, 0) end
    )
    returning *
    into inserted_item;

    -- Store mapping: template_item_id -> new_item_id
    id_map := id_map || jsonb_build_object(tpl_section.id::text, inserted_item.id::text);

    return next inserted_item;

    -- Insert child lines for this section
    for tpl_line in
      select ti.*
      from public.estimate_template_items ti
      where ti.template_id = source_template.id
        and ti.tenant_id = source_template.tenant_id
        and ti.parent_id = tpl_section.id
      order by ti.position asc, ti.created_at asc
    loop
      insert into public.estimate_items (
        tenant_id, version_id, parent_id, item_type, position, title, description,
        quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
        h_mo_atelier, k_mo_atelier, labor_role_atelier_id,
        h_mo_chantier, k_mo_chantier, labor_role_chantier_id,
        pu_ht_cents, labor_role_id, category_id, supply_type_id,
        line_total_ht_cents, line_tax_cents, line_total_ttc_cents
      )
      values (
        target_version.tenant_id,
        target_version.id,
        inserted_item.id,  -- Parent is the newly inserted section
        tpl_line.item_type,
        greatest(tpl_line.position, 1),
        tpl_line.title,
        tpl_line.description,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.quantity, 1) end,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.unit_price_ht_cents, 0) end,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.tax_rate_bp, target_version.tax_rate_bp, 2000) end,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.k_fo, 1) end,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.h_mo, 0) end,
        case when tpl_line.item_type = 'section' then 1.0 else coalesce(tpl_line.h_mo_majoration, 1.0) end,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.k_mo, 1) end,
        case when tpl_line.item_type = 'section' then null else tpl_line.h_mo_atelier end,
        case when tpl_line.item_type = 'section' then 1.0 else coalesce(tpl_line.k_mo_atelier, 1.0) end,
        case when tpl_line.item_type = 'section' then null else tpl_line.labor_role_atelier_id end,
        case when tpl_line.item_type = 'section' then null else tpl_line.h_mo_chantier end,
        case when tpl_line.item_type = 'section' then 1.0 else coalesce(tpl_line.k_mo_chantier, 1.0) end,
        case when tpl_line.item_type = 'section' then null else tpl_line.labor_role_chantier_id end,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.pu_ht_cents, 0) end,
        case when tpl_line.item_type = 'section' then null else tpl_line.labor_role_id end,
        case when tpl_line.item_type = 'section' then null else tpl_line.category_id end,
        case when tpl_line.item_type = 'section' then null else tpl_line.supply_type_id end,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.line_total_ht_cents, 0) end,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.line_tax_cents, 0) end,
        case when tpl_line.item_type = 'section' then null else coalesce(tpl_line.line_total_ttc_cents, 0) end
      )
      returning *
      into inserted_item;

      return next inserted_item;
    end loop;
  end loop;

  -- Update version timestamp
  update public.estimate_versions
  set updated_at = now()
  where id = target_version.id
    and tenant_id = target_version.tenant_id;

  return;
end;
$$;
