-- Migration S4: add transactional bulk updates for estimate items.

create or replace function public.snapshot_estimate_item_bulk_updates(
  target_version_id uuid,
  item_updates jsonb
)
returns table (
  id uuid,
  parent_id uuid,
  item_position integer,
  title text,
  description text,
  quantity numeric(12,3),
  unit_price_ht_cents integer,
  tax_rate_bp integer,
  k_fo numeric(12,3),
  h_mo numeric(12,3),
  k_mo numeric(12,3),
  pu_ht_cents integer,
  labor_role_id uuid,
  category_id uuid,
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer
)
language sql
stable
set search_path = public
as $$
  with requested_updates as (
    select value as payload
    from jsonb_array_elements(item_updates)
  )
  select
    item.id,
    case
      when requested.payload ? 'parent_id'
        then nullif(requested.payload->>'parent_id', '')::uuid
      else item.parent_id
    end as parent_id,
    case
      when requested.payload ? 'position'
        then (requested.payload->>'position')::integer
      else item.position
    end as item_position,
    case
      when requested.payload ? 'title'
        then requested.payload->>'title'
      else item.title
    end as title,
    case
      when requested.payload ? 'description'
        then nullif(btrim(requested.payload->>'description'), '')
      else item.description
    end as description,
    case
      when requested.payload ? 'quantity'
        then (requested.payload->>'quantity')::numeric(12,3)
      else item.quantity
    end as quantity,
    case
      when requested.payload ? 'unit_price_ht_cents'
        then (requested.payload->>'unit_price_ht_cents')::integer
      else item.unit_price_ht_cents
    end as unit_price_ht_cents,
    case
      when requested.payload ? 'tax_rate_bp'
        then (requested.payload->>'tax_rate_bp')::integer
      else item.tax_rate_bp
    end as tax_rate_bp,
    case
      when requested.payload ? 'k_fo'
        then (requested.payload->>'k_fo')::numeric(12,3)
      else item.k_fo
    end as k_fo,
    case
      when requested.payload ? 'h_mo'
        then (requested.payload->>'h_mo')::numeric(12,3)
      else item.h_mo
    end as h_mo,
    case
      when requested.payload ? 'k_mo'
        then (requested.payload->>'k_mo')::numeric(12,3)
      else item.k_mo
    end as k_mo,
    case
      when requested.payload ? 'pu_ht_cents'
        then (requested.payload->>'pu_ht_cents')::integer
      else item.pu_ht_cents
    end as pu_ht_cents,
    case
      when requested.payload ? 'labor_role_id'
        then nullif(requested.payload->>'labor_role_id', '')::uuid
      else item.labor_role_id
    end as labor_role_id,
    case
      when requested.payload ? 'category_id'
        then nullif(requested.payload->>'category_id', '')::uuid
      else item.category_id
    end as category_id,
    case
      when requested.payload ? 'line_total_ht_cents'
        then (requested.payload->>'line_total_ht_cents')::integer
      else item.line_total_ht_cents
    end as line_total_ht_cents,
    case
      when requested.payload ? 'line_tax_cents'
        then (requested.payload->>'line_tax_cents')::integer
      else item.line_tax_cents
    end as line_tax_cents,
    case
      when requested.payload ? 'line_total_ttc_cents'
        then (requested.payload->>'line_total_ttc_cents')::integer
      else item.line_total_ttc_cents
    end as line_total_ttc_cents
  from requested_updates requested
  join public.estimate_items item
    on item.id = (requested.payload->>'id')::uuid
    and item.version_id = target_version_id;
$$;

create or replace function public.bulk_update_estimate_items(
  target_version_id uuid,
  item_updates jsonb
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  if coalesce(jsonb_array_length(item_updates), 0) = 0 then
    return 0;
  end if;

  create temporary table _estimate_item_bulk_snapshot (
    id uuid primary key,
    parent_id uuid,
    item_position integer,
    title text,
    description text,
    quantity numeric(12,3),
    unit_price_ht_cents integer,
    tax_rate_bp integer,
    k_fo numeric(12,3),
    h_mo numeric(12,3),
    k_mo numeric(12,3),
    pu_ht_cents integer,
    labor_role_id uuid,
    category_id uuid,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  ) on commit drop;

  insert into _estimate_item_bulk_snapshot (
    id,
    parent_id,
    item_position,
    title,
    description,
    quantity,
    unit_price_ht_cents,
    tax_rate_bp,
    k_fo,
    h_mo,
    k_mo,
    pu_ht_cents,
    labor_role_id,
    category_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    snapshot.id,
    snapshot.parent_id,
    snapshot.item_position,
    snapshot.title,
    snapshot.description,
    snapshot.quantity,
    snapshot.unit_price_ht_cents,
    snapshot.tax_rate_bp,
    snapshot.k_fo,
    snapshot.h_mo,
    snapshot.k_mo,
    snapshot.pu_ht_cents,
    snapshot.labor_role_id,
    snapshot.category_id,
    snapshot.line_total_ht_cents,
    snapshot.line_tax_cents,
    snapshot.line_total_ttc_cents
  from public.snapshot_estimate_item_bulk_updates(target_version_id, item_updates) snapshot;

  update public.estimate_items item
  set position = -snapshot.item_position
  from _estimate_item_bulk_snapshot snapshot
  where item.id = snapshot.id
    and item.version_id = target_version_id;

  update public.estimate_items item
  set
    parent_id = snapshot.parent_id,
    position = snapshot.item_position,
    title = snapshot.title,
    description = snapshot.description,
    quantity = snapshot.quantity,
    unit_price_ht_cents = snapshot.unit_price_ht_cents,
    tax_rate_bp = snapshot.tax_rate_bp,
    k_fo = snapshot.k_fo,
    h_mo = snapshot.h_mo,
    k_mo = snapshot.k_mo,
    pu_ht_cents = snapshot.pu_ht_cents,
    labor_role_id = snapshot.labor_role_id,
    category_id = snapshot.category_id,
    line_total_ht_cents = snapshot.line_total_ht_cents,
    line_tax_cents = snapshot.line_tax_cents,
    line_total_ttc_cents = snapshot.line_total_ttc_cents
  from _estimate_item_bulk_snapshot snapshot
  where item.id = snapshot.id
    and item.version_id = target_version_id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;
