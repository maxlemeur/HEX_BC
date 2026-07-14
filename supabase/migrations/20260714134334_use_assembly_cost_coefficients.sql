-- Use the line coefficient as the single adjustment factor for assembly costs.
-- Supplies use K FO; labor uses K MO. loss_coeff_bp remains for compatibility only.

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
        sum(
          round(
            coalesce(ai.default_quantity, 0)
            * ai.unit_cost_ht_cents
            * case
                when ai.cost_type = 'labor'
                  then greatest(coalesce(ai.k_mo, 1), 0)
                else greatest(coalesce(ai.k_fo, 1), 0)
              end
          )
        ),
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
