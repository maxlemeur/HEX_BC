-- Repair lines created before assisted line-nature promotion existed. The
-- mixed nature is the only non-destructive correction: it preserves every
-- entered supply and labor value and keeps both validation expectations.
update public.estimate_items item
set line_nature = 'supply_and_labor'::public.estimate_line_nature
where item.item_type = 'line'::public.estimate_item_type
  and (
    (
      item.line_nature = 'supply_only'::public.estimate_line_nature
      and (
        coalesce(item.h_mo, 0) > 0
        or coalesce(item.h_mo_atelier, 0) > 0
        or coalesce(item.h_mo_chantier, 0) > 0
        or item.labor_role_id is not null
        or item.labor_role_atelier_id is not null
        or item.labor_role_chantier_id is not null
      )
    )
    or (
      item.line_nature = 'labor_only'::public.estimate_line_nature
      and (
        coalesce(item.unit_price_ht_cents, 0) > 0
        or item.supply_type_id is not null
        or item.selected_supplier_price_id is not null
      )
    )
  );
