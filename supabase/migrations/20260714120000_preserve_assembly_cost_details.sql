-- Preserve EST-383 cost details when assemblies are edited or inserted.

create or replace function public.replace_estimate_assembly_items(
  p_assembly_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  target_assembly public.estimate_assemblies%rowtype;
  normalized_items jsonb := coalesce(p_items, '[]'::jsonb);
  inserted_count integer := 0;
begin
  if jsonb_typeof(normalized_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  if jsonb_array_length(normalized_items) = 0 then
    raise exception 'Estimate assembly must contain at least one item';
  end if;

  select a.*
    into target_assembly
  from public.estimate_assemblies a
  where a.id = p_assembly_id
    and (select public.is_tenant_member(a.tenant_id));

  if not found then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  delete from public.estimate_assembly_items
  where assembly_id = target_assembly.id
    and tenant_id = target_assembly.tenant_id;

  insert into public.estimate_assembly_items (
    tenant_id,
    assembly_id,
    title,
    unit,
    k_fo,
    k_mo,
    labor_role_id,
    default_quantity,
    position,
    cost_type,
    unit_cost_ht_cents,
    loss_coeff_bp,
    yield_value,
    yield_unit,
    source_metadata
  )
  select
    target_assembly.tenant_id,
    target_assembly.id,
    item.title,
    nullif(btrim(coalesce(item.unit, '')), ''),
    coalesce(item.k_fo, 1),
    coalesce(item.k_mo, 1),
    item.labor_role_id,
    item.default_quantity,
    item.position,
    coalesce(item.cost_type, 'material'),
    coalesce(item.unit_cost_ht_cents, 0),
    coalesce(item.loss_coeff_bp, 0),
    item.yield_value,
    nullif(btrim(coalesce(item.yield_unit, '')), ''),
    coalesce(item.source_metadata, '{}'::jsonb)
  from jsonb_to_recordset(normalized_items) as item(
    title text,
    unit text,
    k_fo numeric,
    k_mo numeric,
    labor_role_id uuid,
    default_quantity numeric,
    position integer,
    cost_type text,
    unit_cost_ht_cents integer,
    loss_coeff_bp integer,
    yield_value numeric,
    yield_unit text,
    source_metadata jsonb
  );

  get diagnostics inserted_count = row_count;

  update public.estimate_assemblies a
  set
    ds_cents = metrics.direct_cost_cents,
    avg_time_hours = metrics.labor_hours
  from (
    select
      coalesce(
        sum(round(coalesce(ai.default_quantity, 0) * ai.unit_cost_ht_cents * (1 + ai.loss_coeff_bp / 10000.0))),
        0
      )::integer as direct_cost_cents,
      nullif(
        sum(case when ai.cost_type = 'labor' then coalesce(ai.default_quantity, 0) else 0 end),
        0
      ) as labor_hours
    from public.estimate_assembly_items ai
    where ai.assembly_id = target_assembly.id
      and ai.tenant_id = target_assembly.tenant_id
  ) metrics
  where a.id = target_assembly.id
    and a.tenant_id = target_assembly.tenant_id;

  return inserted_count;
end;
$$;

create or replace function public.insert_estimate_assembly_into_version(
  p_version_id uuid,
  p_assembly_id uuid,
  p_after_item_id uuid default null
)
returns setof public.estimate_items
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_version public.estimate_versions%rowtype;
  source_assembly public.estimate_assemblies%rowtype;
  anchor_item record;
  target_parent_id uuid;
  target_position integer;
  inserted_section public.estimate_items%rowtype;
  inserted_line public.estimate_items%rowtype;
  assembly_item public.estimate_assembly_items%rowtype;
  line_position integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

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

  select a.*
    into source_assembly
  from public.estimate_assemblies a
  where a.id = p_assembly_id
    and (select public.is_tenant_member(a.tenant_id));

  if not found then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  if source_assembly.tenant_id <> target_version.tenant_id then
    raise exception 'Estimate assembly and version tenant mismatch';
  end if;

  if not exists (
    select 1
    from public.estimate_assembly_items ai
    where ai.assembly_id = source_assembly.id
      and ai.tenant_id = source_assembly.tenant_id
  ) then
    raise exception 'Estimate assembly has no items';
  end if;

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

  if target_parent_id is null then
    perform 1
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id is null
    for update;

    update public.estimate_items
    set position = position + 1
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
    set position = position + 1
    where version_id = target_version.id
      and tenant_id = target_version.tenant_id
      and parent_id = target_parent_id
      and position >= target_position;
  end if;

  insert into public.estimate_items (
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title
  )
  values (
    target_version.tenant_id,
    target_version.id,
    target_parent_id,
    'section',
    target_position,
    source_assembly.name
  )
  returning * into inserted_section;

  return next inserted_section;

  for assembly_item in
    select ai.*
    from public.estimate_assembly_items ai
    where ai.assembly_id = source_assembly.id
      and ai.tenant_id = source_assembly.tenant_id
    order by ai.position asc, ai.created_at asc
  loop
    line_position := greatest(assembly_item.position, 1);

    insert into public.estimate_items (
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
      pu_ht_cents,
      labor_role_id,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
    )
    values (
      target_version.tenant_id,
      target_version.id,
      inserted_section.id,
      'line',
      line_position,
      assembly_item.title,
      nullif(btrim(coalesce(assembly_item.unit, '')), ''),
      case
        when assembly_item.cost_type = 'labor' then 1
        else coalesce(assembly_item.default_quantity, 1)
      end,
      case
        when assembly_item.cost_type = 'labor' then 0
        else coalesce(assembly_item.unit_cost_ht_cents, 0)
      end,
      coalesce(target_version.tax_rate_bp, 2000),
      coalesce(assembly_item.k_fo, 1),
      case
        when assembly_item.cost_type = 'labor'
          then coalesce(assembly_item.default_quantity, 0)
        else 0
      end,
      1,
      coalesce(assembly_item.k_mo, 1),
      0,
      assembly_item.labor_role_id,
      0,
      0,
      0
    )
    returning * into inserted_line;

    return next inserted_line;
  end loop;

  update public.estimate_versions
  set updated_at = now()
  where id = target_version.id
    and tenant_id = target_version.tenant_id;

  return;
end;
$$;
