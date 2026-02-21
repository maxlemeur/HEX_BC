-- Migration S4: make estimate item reorder atomic.

create or replace function public.reorder_estimate_items(
  target_version_id uuid,
  target_parent_id uuid,
  ordered_item_ids uuid[]
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  if coalesce(array_length(ordered_item_ids, 1), 0) = 0 then
    return 0;
  end if;

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_item_ids) with ordinality as src(id, ordinality)
  )
  update public.estimate_items item
  set position = -ordered.position
  from ordered
  where item.id = ordered.id
    and item.version_id = target_version_id
    and (
      (target_parent_id is null and item.parent_id is null)
      or item.parent_id = target_parent_id
    );

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_item_ids) with ordinality as src(id, ordinality)
  )
  update public.estimate_items item
  set position = ordered.position
  from ordered
  where item.id = ordered.id
    and item.version_id = target_version_id
    and (
      (target_parent_id is null and item.parent_id is null)
      or item.parent_id = target_parent_id
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;
