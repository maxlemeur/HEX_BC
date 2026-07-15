-- Cover the foreign-key columns used when parent rows are updated or deleted.
create index supplier_catalog_items_created_by_idx
  on public.supplier_catalog_items (created_by);

create index supplier_catalog_items_product_id_idx
  on public.supplier_catalog_items (product_id);

create index supplier_catalog_items_supplier_id_idx
  on public.supplier_catalog_items (supplier_id);

create index supplier_pricebook_supplier_catalog_item_id_idx
  on public.supplier_pricebook (supplier_catalog_item_id);
