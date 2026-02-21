-- Migration S5: allow tenant admins to reorder purchase order devis atomically.

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

  if not exists (
    select 1
    from public.purchase_orders po
    where po.id = target_purchase_order_id
      and po.tenant_id is not null
      and (
        exists (
          select 1
          from public.tenant_memberships tm
          where tm.tenant_id = po.tenant_id
            and tm.user_id = (select auth.uid())
        )
        or exists (
          select 1
          from public.profiles p
          where p.id = (select auth.uid())
            and p.role = 'admin'
        )
      )
      and (
        po.user_id = (select auth.uid())
        or exists (
          select 1
          from public.tenant_memberships tm
          where tm.tenant_id = po.tenant_id
            and tm.user_id = (select auth.uid())
            and tm.role::text = 'admin'
        )
        or exists (
          select 1
          from public.profiles p
          where p.id = (select auth.uid())
            and p.role = 'admin'
        )
      )
  ) then
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
    and devis.purchase_order_id = target_purchase_order_id;

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
    and devis.purchase_order_id = target_purchase_order_id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;
