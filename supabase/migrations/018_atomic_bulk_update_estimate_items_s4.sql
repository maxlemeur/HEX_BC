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
  expected_count integer := 0;
  snapshot_count integer := 0;
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  expected_count := coalesce(jsonb_array_length(item_updates), 0);

  if expected_count = 0 then
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

  select count(*)
    into snapshot_count
  from _estimate_item_bulk_snapshot;

  if snapshot_count <> expected_count then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,updated_count=%s',
          expected_count,
          snapshot_count
        );
  end if;

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

  if updated_count <> expected_count then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,updated_count=%s',
          expected_count,
          updated_count
        );
  end if;

  return updated_count;
end;
$$;
