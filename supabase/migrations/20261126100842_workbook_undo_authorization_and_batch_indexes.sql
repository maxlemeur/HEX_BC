-- TI-711: authorize workbook undo before waiting on the batch and cover the composite batch foreign keys.
begin;

-- Tenant and batch cover the foreign keys and list counts, then id orders the undo pages.
drop index public.products_import_batch_idx;
create index products_import_batch_idx
  on public.products (tenant_id, import_batch_id, id)
  where import_batch_id is not null;
drop index public.supplier_catalog_items_import_batch_idx;
create index supplier_catalog_items_import_batch_idx
  on public.supplier_catalog_items (tenant_id, import_batch_id, id)
  where import_batch_id is not null;

create or replace function public.undo_catalogue_import_batch(
  p_batch_id uuid,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  active_tenant_id uuid := public.current_tenant_id();
  batch public.catalogue_import_batches%rowtype;
  candidate_id uuid;
  page_ids uuid[];
  removable_ids uuid[];
  last_id uuid;
  has_more boolean := false;
  deleted_count integer := 0;
  kept_count integer := 0;
begin
  if actor_id is null or active_tenant_id is null then
    raise exception using errcode = '42501', message = 'CATALOGUE_IMPORT_UNDO_FORBIDDEN';
  end if;

  -- Refuse unauthorized or invalid calls before they can wait on a writer.
  select found_batch.created_by into batch.created_by
  from public.catalogue_import_batches found_batch
  where found_batch.id = p_batch_id and found_batch.tenant_id = active_tenant_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'CATALOGUE_IMPORT_BATCH_NOT_FOUND';
  end if;
  if (
    public.has_tenant_role(active_tenant_id, array['admin'::public.tenant_role])
    or (
      batch.created_by = actor_id
      and public.has_tenant_role(active_tenant_id, array['engineer'::public.tenant_role])
    )
  ) is not true then
    raise exception using errcode = '42501', message = 'CATALOGUE_IMPORT_UNDO_FORBIDDEN';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'CATALOGUE_IMPORT_UNDO_INVALID';
  end if;

  -- Serialize undo pages and wait for in-flight article chunks. The locked row may have lost its author.
  select found_batch.* into batch
  from public.catalogue_import_batches found_batch
  where found_batch.id = p_batch_id and found_batch.tenant_id = active_tenant_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CATALOGUE_IMPORT_BATCH_NOT_FOUND';
  end if;
  if (
    public.has_tenant_role(active_tenant_id, array['admin'::public.tenant_role])
    or (
      batch.created_by = actor_id
      and public.has_tenant_role(active_tenant_id, array['engineer'::public.tenant_role])
    )
  ) is not true then
    raise exception using errcode = '42501', message = 'CATALOGUE_IMPORT_UNDO_FORBIDDEN';
  end if;

  if batch.undone_at is not null then
    return pg_catalog.jsonb_build_object('deleted', 0, 'kept', 0, 'done', true);
  end if;
  if batch.undo_started_at is null then
    update public.catalogue_import_batches found_batch
    set undo_started_at = pg_catalog.now()
    where found_batch.id = batch.id;
  end if;

  if batch.kind = 'workbook_supplier_references' then
    select coalesce(pg_catalog.array_agg(page.id order by page.id), '{}'::uuid[]) into page_ids
    from (
      select item.id
      from public.supplier_catalog_items item
      where item.tenant_id = batch.tenant_id and item.import_batch_id = batch.id
        and (batch.undo_cursor is null or item.id > batch.undo_cursor)
      order by item.id
      limit p_limit
    ) page;

    if pg_catalog.cardinality(page_ids) > 0 then
      last_id := page_ids[pg_catalog.cardinality(page_ids)];

      -- Still pending and never priced: nobody used them. Held in the order of every writer of references.
      select coalesce(pg_catalog.array_agg(locked.id), '{}'::uuid[]) into removable_ids
      from (
        select item.id
        from public.supplier_catalog_items item
        where item.id = any(page_ids)
          and item.reference_needs_review
          and not exists (
            select 1 from public.supplier_pricebook price where price.supplier_catalog_item_id = item.id
          )
        order by item.product_id, item.id
        for update of item
      ) locked;

      if pg_catalog.cardinality(removable_ids) > 0 then
        perform 1
        from public.products product
        where product.id in (
          select item.product_id from public.supplier_catalog_items item where item.id = any(removable_ids)
        )
        order by product.id
        for update of product;

        -- Read the locked articles' authors and ask the permission helper once per distinct author.
        with candidates as materialized (
          select item.id, product.created_by
          from public.supplier_catalog_items item
          join public.products product on product.id = item.product_id and product.tenant_id = item.tenant_id
          where item.id = any(removable_ids)
            and not exists (
              select 1 from public.supplier_pricebook price where price.supplier_catalog_item_id = item.id
            )
        ), authors as materialized (
          select distinct candidates.created_by from candidates
        ), editable_authors as materialized (
          select authors.created_by
          from authors
          where public.can_edit_catalogue_record(active_tenant_id, authors.created_by)
        )
        delete from public.supplier_catalog_items item
        using candidates
        where item.id = candidates.id
          and exists (
            select 1 from editable_authors
            where editable_authors.created_by is not distinct from candidates.created_by
          );
        get diagnostics deleted_count = row_count;
      end if;
      kept_count := pg_catalog.cardinality(page_ids) - deleted_count;

      has_more := exists (
        select 1 from public.supplier_catalog_items item
        where item.tenant_id = batch.tenant_id and item.import_batch_id = batch.id and item.id > last_id
      );
    end if;
  else
    for candidate_id in
      select product.id
      from public.products product
      where product.tenant_id = batch.tenant_id and product.import_batch_id = batch.id
        and (batch.undo_cursor is null or product.id > batch.undo_cursor)
      order by product.id
      limit p_limit
    loop
      last_id := candidate_id;

      -- One article at a time: what protects one must not keep the others. Its pending references are held
      -- before the article itself (the order of every writer of references), and go with it or stay with it.
      begin
        removable_ids := array(
          select item.id
          from public.supplier_catalog_items item
          where item.product_id = candidate_id
            and item.reference_needs_review
            and not exists (
              select 1 from public.supplier_pricebook price where price.supplier_catalog_item_id = item.id
            )
          order by item.id
          for update of item
        );

        perform 1
        from public.products product
        where product.id = candidate_id
        for update of product;

        -- A fresh snapshot after locking the article sees every link committed while we waited for it.
        -- New links must now wait for the article lock before their foreign keys can be checked.
        perform 1
        from public.products product
        where product.id = candidate_id
          and product.tenant_id = active_tenant_id
          and product.import_batch_id = batch.id
          and product.catalogue_status = 'draft'
          and not product.created_from_material_request
          and public.can_edit_catalogue_record(product.tenant_id, product.created_by)
          and not exists (select 1 from public.estimate_items line where line.product_id = product.id)
          and not exists (select 1 from public.material_request_lines line where line.product_id = product.id)
          and not exists (select 1 from public.purchase_order_items line where line.product_id = product.id)
          and not exists (select 1 from public.dpgf_catalogue_links link where link.product_id = product.id)
          and not exists (select 1 from public.product_aliases usual_name where usual_name.product_id = product.id)
          and not exists (select 1 from public.product_packagings packaging where packaging.product_id = product.id);

        -- A fresh read without row locks sees references that were outside the capture. Deleting the article
        -- would let its foreign key seek a reference lock in the reverse order of a concurrent review.
        if not found or exists (
          select 1 from public.supplier_catalog_items item
          where item.product_id = candidate_id and not (item.id = any(removable_ids))
        ) then
          -- Roll back this article's subtransaction to release its locks before waiting on another article.
          raise sqlstate 'P0711' using message = 'CATALOGUE_IMPORT_UNDO_KEEP_ARTICLE';
        end if;

        delete from public.supplier_catalog_items item where item.id = any(removable_ids);
        delete from public.products product where product.id = candidate_id;
        deleted_count := deleted_count + 1;
      exception
        -- Keep the draft if a constraint still protects it (for example, a validated reference price).
        -- PostgreSQL 18 reports ON DELETE RESTRICT with its own code.
        when sqlstate 'P0711' or foreign_key_violation or restrict_violation then
          kept_count := kept_count + 1;
      end;
    end loop;

    if last_id is not null then
      has_more := exists (
        select 1 from public.products product
        where product.tenant_id = batch.tenant_id and product.import_batch_id = batch.id and product.id > last_id
      );
    end if;
  end if;

  update public.catalogue_import_batches found_batch
  set undo_cursor = coalesce(last_id, batch.undo_cursor),
      undone_at = case when not has_more then pg_catalog.now() end,
      undone_by = case when not has_more then actor_id end
  where found_batch.id = batch.id;

  return pg_catalog.jsonb_build_object(
    'deleted', deleted_count,
    'kept', kept_count,
    'done', not has_more
  );
end;
$$;

commit;
