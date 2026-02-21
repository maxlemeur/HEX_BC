-- Migration S5: make purchase order devis reorder atomic.

create or replace function public.reorder_purchase_order_devis(
  target_purchase_order_id uuid,
  ordered_devis_ids uuid[]
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  if coalesce(array_length(ordered_devis_ids, 1), 0) = 0 then
    return 0;
  end if;

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_devis_ids) with ordinality as src(id, ordinality)
  )
  update public.purchase_order_devis devis
  set position = -ordered.position
  from ordered
  where devis.id = ordered.id
    and devis.purchase_order_id = target_purchase_order_id
    and devis.user_id = (select auth.uid());

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_devis_ids) with ordinality as src(id, ordinality)
  )
  update public.purchase_order_devis devis
  set position = ordered.position
  from ordered
  where devis.id = ordered.id
    and devis.purchase_order_id = target_purchase_order_id
    and devis.user_id = (select auth.uid());

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;
