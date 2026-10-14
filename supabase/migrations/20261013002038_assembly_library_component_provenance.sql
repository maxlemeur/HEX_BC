begin;

-- CORE07: copy reusable item origin without attributing a new IA/CCTP application.
-- Existing lines, library rows and historical migrations are unchanged.
create or replace function public.materialize_estimate_assembly_tree(
  p_version_id uuid,
  p_assembly_id uuid,
  p_parent_item_id uuid,
  p_section_position integer,
  p_quantity_multiplier numeric,
  p_depth integer
)
returns setof public.estimate_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_version public.estimate_versions%rowtype;
  source_assembly public.estimate_assemblies%rowtype;
  inserted_section public.estimate_items%rowtype;
  inserted_line public.estimate_items%rowtype;
  content record;
  assembly_item public.estimate_assembly_items%rowtype;
  assembly_member public.estimate_assembly_members%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_depth < 0 or p_depth > 2 then
    raise exception 'Estimate assembly composition is limited to two nested levels';
  end if;

  if p_quantity_multiplier < 0 then
    raise exception 'Estimate assembly quantity must be positive';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = p_version_id
    and (select public.is_tenant_member(version.tenant_id));

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  if target_version.status <> 'draft' then
    raise exception 'Estimate version is read only';
  end if;

  select assembly.*
    into source_assembly
  from public.estimate_assemblies assembly
  where assembly.id = p_assembly_id
    and assembly.tenant_id = target_version.tenant_id
    and (select public.is_tenant_member(assembly.tenant_id));

  if not found then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  if p_parent_item_id is not null and not exists (
    select 1
    from public.estimate_items parent_item
    where parent_item.id = p_parent_item_id
      and parent_item.version_id = target_version.id
      and parent_item.tenant_id = target_version.tenant_id
      and parent_item.item_type = 'section'
  ) then
    raise exception 'Estimate assembly parent section is invalid';
  end if;

  insert into public.estimate_items (
    tenant_id, version_id, parent_id, item_type, position, title
  )
  values (
    target_version.tenant_id,
    target_version.id,
    p_parent_item_id,
    'section',
    p_section_position,
    source_assembly.name
  )
  returning * into inserted_section;

  return next inserted_section;

  for content in
    select 'item'::text as content_type, item.id as content_id,
      item.position, item.created_at
    from public.estimate_assembly_items item
    where item.assembly_id = source_assembly.id
      and item.tenant_id = source_assembly.tenant_id
    union all
    select 'member'::text, member.id, member.position, member.created_at
    from public.estimate_assembly_members member
    where member.parent_assembly_id = source_assembly.id
      and member.tenant_id = source_assembly.tenant_id
    order by position, created_at
  loop
    if content.content_type = 'item' then
      select item.*
        into assembly_item
      from public.estimate_assembly_items item
      where item.id = content.content_id;

      insert into public.estimate_items (
        tenant_id, version_id, parent_id, item_type, position, title,
        description, quantity, unit_price_ht_cents, tax_rate_bp, k_fo,
        supply_type_id, h_mo, h_mo_majoration, k_mo, pu_ht_cents,
        labor_role_id, line_total_ht_cents, line_tax_cents,
        line_total_ttc_cents, source_provider, source_metadata
      )
      values (
        target_version.tenant_id,
        target_version.id,
        inserted_section.id,
        'line',
        assembly_item.position,
        assembly_item.title,
        nullif(btrim(coalesce(assembly_item.unit, '')), ''),
        coalesce(assembly_item.default_quantity, 1) * p_quantity_multiplier,
        case
          when assembly_item.cost_type = 'labor' then 0
          else coalesce(assembly_item.unit_cost_ht_cents, 0)
        end,
        coalesce(target_version.tax_rate_bp, 2000),
        coalesce(assembly_item.k_fo, 1),
        assembly_item.supply_type_id,
        coalesce(assembly_item.h_mo, 0) * p_quantity_multiplier,
        1,
        coalesce(assembly_item.k_mo, 1),
        0,
        assembly_item.labor_role_id,
        0,
        0,
        0,
        'assembly_library',
        jsonb_build_object(
          'kind', 'assembly_library',
          'library_origin', jsonb_build_object(
            'assembly_id', source_assembly.id,
            'assembly_item_id', assembly_item.id,
            'source_metadata', assembly_item.source_metadata
          )
        )
      )
      returning * into inserted_line;

      return next inserted_line;
    else
      select member.*
        into assembly_member
      from public.estimate_assembly_members member
      where member.id = content.content_id;

      return query
      select *
      from public.materialize_estimate_assembly_tree(
        target_version.id,
        assembly_member.child_assembly_id,
        inserted_section.id,
        assembly_member.position,
        p_quantity_multiplier * assembly_member.quantity,
        p_depth + 1
      );
    end if;
  end loop;

  return;
end;
$$;

revoke execute on function public.materialize_estimate_assembly_tree(
  uuid, uuid, uuid, integer, numeric, integer
) from public, anon;
grant execute on function public.materialize_estimate_assembly_tree(
  uuid, uuid, uuid, integer, numeric, integer
) to authenticated;

commit;
