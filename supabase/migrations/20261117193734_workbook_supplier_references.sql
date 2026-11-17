-- TI-711: an imported reference is available for review on the article, before it is used in purchasing.
alter table public.supplier_catalog_items
  add column reference_needs_review boolean not null default false,
  add constraint supplier_catalog_item_pending_reference_check check (
    not reference_needs_review or (not is_active and supplier_sku is not null)
  );

-- Price writers reuse an existing pair and can change its activation or metadata. Only the article
-- editor can take a pending pair out of review. Keep rejecting incidental changes via the price book.
create function public.protect_pending_supplier_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reference_needs_review and (
    new.is_active or new.supplier_sku is distinct from old.supplier_sku
    or new.product_url is distinct from old.product_url
  ) then
    raise check_violation using message = 'supplier_catalog_item_pending_reference_check';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_pending_supplier_reference() from public, anon, authenticated;

create trigger protect_pending_supplier_reference
  before update on public.supplier_catalog_items
  for each row when (old.reference_needs_review)
  execute function public.protect_pending_supplier_reference();

-- TI-711: reviewing a pending reference is an explicit save on the article. Withdrawing a pending
-- reference discards its unverified metadata, while withdrawing an established one still keeps it.
create or replace function public.save_supplier_catalog_item(
  p_product_id uuid,
  p_supplier_id uuid,
  p_supplier_sku text,
  p_product_url text,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  active_tenant_id uuid := public.current_tenant_id();
  article record;
  normalized_sku text := nullif(pg_catalog.btrim(p_supplier_sku), '');
  normalized_url text := nullif(pg_catalog.btrim(p_product_url), '');
  saved public.supplier_catalog_items%rowtype;
  created boolean;
begin
  if actor_id is null or active_tenant_id is null
    or not public.has_tenant_role(active_tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])
  then
    raise exception using errcode = '42501', message = 'SUPPLIER_CATALOG_ITEM_EDITORS_ONLY';
  end if;

  select product.tenant_id, product.created_by into article
  from public.products product
  where product.id = p_product_id and product.tenant_id = active_tenant_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SUPPLIER_CATALOG_ITEM_PRODUCT_NOT_FOUND';
  end if;
  if not public.can_edit_catalogue_record(article.tenant_id, article.created_by) then
    raise exception using errcode = '42501', message = 'SUPPLIER_CATALOG_ITEM_PRODUCT_LOCKED';
  end if;
  if not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id and supplier.tenant_id = active_tenant_id
  ) then
    raise exception using errcode = 'P0002', message = 'SUPPLIER_CATALOG_ITEM_SUPPLIER_NOT_FOUND';
  end if;

  if p_is_active is null then
    raise exception using errcode = '22023', message = 'SUPPLIER_CATALOG_ITEM_ACTIVE_REQUIRED';
  end if;
  if normalized_sku is not null and pg_catalog.char_length(normalized_sku) > 255 then
    raise exception using errcode = '22023', message = 'SUPPLIER_CATALOG_ITEM_SKU_INVALID';
  end if;
  if normalized_url is not null and (
    pg_catalog.char_length(normalized_url) > 2000 or normalized_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception using errcode = '22023', message = 'SUPPLIER_CATALOG_ITEM_URL_INVALID';
  end if;

  -- Items are never deleted (no delete grant, prices restrict it): once the insert finds the pair, the update
  -- reaches it.
  insert into public.supplier_catalog_items as item (
    tenant_id, supplier_id, product_id, supplier_sku, product_url, is_active, created_by
  ) values (
    active_tenant_id, p_supplier_id, p_product_id, normalized_sku, normalized_url, p_is_active, actor_id
  )
  on conflict on constraint supplier_catalog_items_tenant_supplier_product_key do nothing
  returning item.* into saved;
  created := saved.id is not null;
  if not created then
    update public.supplier_catalog_items item
    set supplier_sku = case
          when item.reference_needs_review and not p_is_active then null
          when p_supplier_sku is null then item.supplier_sku else normalized_sku end,
        product_url = case
          when item.reference_needs_review and not p_is_active then null
          when p_product_url is null then item.product_url else normalized_url end,
        is_active = p_is_active,
        reference_needs_review = false
    where item.tenant_id = active_tenant_id
      and item.supplier_id = p_supplier_id
      and item.product_id = p_product_id
    returning item.* into saved;
  end if;

  if saved.supplier_sku is null and saved.product_url is null
    and (created or (p_is_active and (p_supplier_sku is not null or p_product_url is not null)))
  then
    raise exception using errcode = '22023', message = 'SUPPLIER_CATALOG_ITEM_IDENTIFIER_REQUIRED';
  end if;

  if not p_is_active then
    update public.products product
    set preferred_supplier_id = null
    where product.id = p_product_id
      and product.tenant_id = active_tenant_id
      and product.preferred_supplier_id = p_supplier_id;
  end if;

  return saved.id;
end;
$$;

-- The price table also has its own write policies. Guard the association before it copies the SKU.
create or replace function public.sync_supplier_price_catalog_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  catalog_item public.supplier_catalog_items%rowtype;
begin
  if new.supplier_catalog_item_id is null then
    select item.* into catalog_item
    from public.supplier_catalog_items item
    where item.tenant_id = new.tenant_id
      and item.supplier_id = new.supplier_id
      and item.product_id = new.product_id;
  else
    select item.* into catalog_item
    from public.supplier_catalog_items item
    where item.id = new.supplier_catalog_item_id;
  end if;

  if catalog_item.id is null then
    raise check_violation using message = 'A supplier catalogue item is required for every supplier price.';
  end if;

  if catalog_item.reference_needs_review then
    raise check_violation using message = 'supplier_catalog_item_pending_reference_check';
  end if;

  new.supplier_catalog_item_id := catalog_item.id;
  new.tenant_id := catalog_item.tenant_id;
  new.supplier_id := catalog_item.supplier_id;
  new.product_id := catalog_item.product_id;

  if tg_op = 'INSERT' or old.supplier_catalog_item_id is distinct from catalog_item.id then
    new.supplier_sku := catalog_item.supplier_sku;
  end if;

  return new;
end;
$$;

-- The item table grants authenticated callers SELECT only. This insert-only RPC has the same catalogue
-- rights as save_supplier_catalog_item and applies the whole confirmed batch or rolls it back.
create function public.import_workbook_supplier_references(p_tenant_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  active_tenant_id uuid := public.current_tenant_id();
  inserted_count integer;
begin
  if actor_id is null or active_tenant_id is null or p_tenant_id is distinct from active_tenant_id
    or not public.has_tenant_role(active_tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])
  then
    raise exception using errcode = '42501', message = 'WORKBOOK_SUPPLIER_REFERENCES_EDITORS_ONLY';
  end if;

  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'WORKBOOK_SUPPLIER_REFERENCES_INVALID';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) not between 1 and 18000 then
    raise exception using errcode = '22023', message = 'WORKBOOK_SUPPLIER_REFERENCES_INVALID';
  end if;

  with candidates as materialized (
    select product.id as product_id, supplier.id as supplier_id,
      nullif(pg_catalog.btrim(candidate.supplier_sku), '') as supplier_sku
    from pg_catalog.jsonb_to_recordset(p_rows) as candidate (
      product_id uuid, product_reference text, supplier_id uuid, supplier_name text, supplier_sku text
    )
    join public.products product on product.id = candidate.product_id
      and product.tenant_id = active_tenant_id and product.is_active
      and product.reference = candidate.product_reference
    join public.suppliers supplier on supplier.id = candidate.supplier_id
      and supplier.tenant_id = active_tenant_id and supplier.is_active
      and supplier.name = candidate.supplier_name
    where public.can_edit_catalogue_record(product.tenant_id, product.created_by)
    order by product.id, supplier.id
    for share of product, supplier
  )
  insert into public.supplier_catalog_items (
    tenant_id, product_id, supplier_id, supplier_sku, is_active, reference_needs_review, created_by
  )
  select active_tenant_id, product_id, supplier_id, supplier_sku, false, true, actor_id
  from candidates
  order by product_id, supplier_id
  on conflict on constraint supplier_catalog_items_tenant_supplier_product_key do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count <> pg_catalog.jsonb_array_length(p_rows) then
    raise exception using errcode = 'P0001', message = 'WORKBOOK_SUPPLIER_REFERENCES_CHANGED';
  end if;
  return inserted_count;
end;
$$;

revoke all on function public.import_workbook_supplier_references(uuid, jsonb) from public, anon;
grant execute on function public.import_workbook_supplier_references(uuid, jsonb) to authenticated;

comment on function public.import_workbook_supplier_references(uuid, jsonb) is
  'TI-711: atomically inserts pending, inactive supplier references for editable active articles and active suppliers in the team currently selected. Existing supplier items and prices are kept as stored.';
