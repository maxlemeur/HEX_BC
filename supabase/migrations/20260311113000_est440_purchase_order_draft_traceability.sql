alter table public.purchase_orders
  add column if not exists source_estimate_version_id uuid references public.estimate_versions(id) on delete set null;

create index if not exists purchase_orders_tenant_source_estimate_version_idx
  on public.purchase_orders (tenant_id, source_estimate_version_id)
  where source_estimate_version_id is not null;

alter table public.purchase_order_items
  add column if not exists source_estimate_item_id uuid references public.estimate_items(id) on delete set null;

alter table public.purchase_order_items
  add column if not exists source_selected_supplier_price_id uuid references public.supplier_pricebook(id) on delete set null;

create index if not exists purchase_order_items_tenant_source_estimate_item_idx
  on public.purchase_order_items (tenant_id, source_estimate_item_id)
  where source_estimate_item_id is not null;

create index if not exists purchase_order_items_tenant_source_supplier_price_idx
  on public.purchase_order_items (tenant_id, source_selected_supplier_price_id)
  where source_selected_supplier_price_id is not null;
