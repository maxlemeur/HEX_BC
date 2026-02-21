-- EST-032 follow-up: restore split-labor invariants in estimate item payload constraint.

alter table public.estimate_items
  drop constraint if exists estimate_items_item_type_payload_check;

alter table public.estimate_items
  add constraint estimate_items_item_type_payload_check
  check (
    (
      item_type = 'section'
      and quantity is null
      and unit_price_ht_cents is null
      and tax_rate_bp is null
      and k_fo is null
      and h_mo is null
      and h_mo_majoration = 1.0
      and k_mo is null
      and h_mo_atelier is null
      and k_mo_atelier = 1.0
      and labor_role_atelier_id is null
      and h_mo_chantier is null
      and k_mo_chantier = 1.0
      and labor_role_chantier_id is null
      and pu_ht_cents is null
      and labor_role_id is null
      and category_id is null
      and supply_type_id is null
      and selected_supplier_price_id is null
      and line_total_ht_cents is null
      and line_tax_cents is null
      and line_total_ttc_cents is null
    )
    or
    (
      item_type = 'line'
      and quantity is not null
      and unit_price_ht_cents is not null
      and tax_rate_bp is not null
      and k_fo is not null
      and h_mo is not null
      and h_mo_majoration is not null
      and k_mo is not null
      and pu_ht_cents is not null
      and line_total_ht_cents is not null
      and line_tax_cents is not null
      and line_total_ttc_cents is not null
    )
  );
