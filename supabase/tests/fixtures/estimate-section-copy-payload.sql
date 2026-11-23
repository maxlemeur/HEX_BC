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
