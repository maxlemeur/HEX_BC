-- EST-182: atomic replacement of assembly items during updates.

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
    position
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
    item.position
  from jsonb_to_recordset(normalized_items) as item(
    title text,
    unit text,
    k_fo numeric,
    k_mo numeric,
    labor_role_id uuid,
    default_quantity numeric,
    position integer
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
