-- TI-691, lot 2 « l'achat », delivery 1 (« fournisseurs des lignes »). No remote application is authorized here.
--
-- 1. The supplier of a material request line is purchasing information chosen by the office, not what the
--    technician asked: choosing or changing it no longer returns a validated line to draft. Every other column of
--    the backstop still does. private.enforce_material_request_line_write() is copied from
--    20261112101124_material_request_articles.sql; only supplier_id leaves the backstop comparison (its same-tenant
--    check stays).
-- 2. A preferred supplier per supply type (supply_types.preferred_supplier_id) and an exception per article
--    (products.preferred_supplier_id): null, or a supplier of the row's tenant (PREFERRED_SUPPLIER_TENANT_MISMATCH);
--    deleting the supplier clears them. An article's exception is moreover a supplier with an active item for the
--    article (PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED): the office can buy the article there. Who sets them:
--    - an article's: whoever may change the article (policy « Catalogue editors can update products », TI-689
--      can_edit_catalogue_record), like any other field of it;
--    - a supply type's: any member still writes a type's name and code (policy « Users can manage supply types »),
--      but only an admin or an engineer of the active tenant sets or clears its preferred supplier
--      (SUPPLY_TYPE_PREFERRED_SUPPLIER_EDITORS_ONLY). A trigger, not a restrictive policy: a policy sees the rows,
--      not which column a statement changes, so it could only refuse every write of a viewer, name included.
-- 3. public.save_supplier_catalog_item: an article's reference (and address) at one supplier, without any price;
--    withdrawing a supplier from an article also withdraws it as the article's exception. Until now every write
--    path of supplier_catalog_items also wrote a price, or checked the role only.
-- 4. public.last_purchase_suppliers: the supplier of the latest confirmed or received order of each article, the
--    fourth source of a line's proposed supplier (after the technician's, the article's exception and the supply
--    type's preferred supplier; the order is the application's).
-- 5. public.retain_material_request_line_suppliers: retains the suppliers chosen for several lines of a request in one
--    statement, all or nothing, writing only the lines that still have no supplier.
-- Regression: supabase/tests/database/purchase-line-suppliers.test.sql.

begin;

do $preflight$
begin
  if to_regclass('public.material_request_lines') is null
    or to_regclass('public.supply_types') is null
    or to_regclass('public.products') is null
    or to_regclass('public.suppliers') is null
    or to_regclass('public.supplier_catalog_items') is null
    or to_regclass('public.purchase_orders') is null
    or to_regclass('public.purchase_order_items') is null
    or to_regprocedure('private.enforce_material_request_line_write()') is null
    or to_regprocedure('public.can_edit_catalogue_record(uuid, uuid)') is null
    or to_regprocedure('public.can_read_affaire_intake_project(uuid, uuid)') is null
    or to_regprocedure('public.has_tenant_role(uuid, public.tenant_role[])') is null
    or to_regprocedure('public.current_tenant_id()') is null
    or not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = 'public.supplier_catalog_items'::regclass
        and conname = 'supplier_catalog_items_tenant_supplier_product_key'
    )
  then
    raise exception 'TI691_SUPPLIERS_PREREQUISITE_MISSING';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid in ('public.products'::regclass, 'public.supply_types'::regclass)
      and attname = 'preferred_supplier_id' and not attisdropped
  ) then
    raise exception 'TI691_SUPPLIERS_PREFLIGHT: preferred_supplier_id already exists';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The supplier of a line is not what the line says.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_material_request_line_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  parent record;
  presumed record;
begin
  if tg_op = 'INSERT' then
    select request.tenant_id, request.project_id into parent
    from public.material_requests request where request.id = new.request_id;
    if parent.tenant_id is null then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_NOT_FOUND';
    end if;
    new.tenant_id := parent.tenant_id;
    new.project_id := parent.project_id;
    new.created_at := now();
    -- Three hundred lines per request (MATERIAL_REQUEST_MAX_LINES in the application, which refuses
    -- first and in friendlier words). Appends to one request wait for each other on its row, so two of
    -- them cannot both count 299 and pass; a batch that would cross the cap fails as a whole. The
    -- request row is the first lock an append takes, and an append holds no line another transaction
    -- waits for, so it cannot close a lock cycle with a validation or a change to the request.
    perform 1 from public.material_requests request where request.id = new.request_id for update;
    if (select count(*) from public.material_request_lines other where other.request_id = new.request_id) >= 300 then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_LIMIT';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id or new.project_id is distinct from old.project_id
    or new.request_id is distinct from old.request_id then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_SCOPE_IMMUTABLE';
  else
    new.created_at := old.created_at;
  end if;

  if new.supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = new.supplier_id and supplier.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
  end if;

  -- The article is one of the line's tenant. The trigger runs as the caller: an article the caller cannot
  -- read is one that does not exist. Checked when it is set; the tenant of a line never changes.
  if new.product_id is not null and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id)
    and not exists (
      select 1 from public.products product
      where product.id = new.product_id and product.tenant_id = new.tenant_id
    )
  then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
  end if;

  -- The wording before the first link belongs to the link: it is written or cleared with the article, never
  -- alone, so that no edit can make the line "remember" words the technician did not write.
  if new.pre_link_wording is not null and tg_op = 'INSERT' and new.product_id is null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE';
  end if;
  if tg_op = 'UPDATE' and new.pre_link_wording is distinct from old.pre_link_wording
    and new.product_id is not distinct from old.product_id then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE';
  end if;

  -- How a line was linked goes with its link: unlinked by the office, or erased by the article's deletion
  -- (ON DELETE SET NULL, which would otherwise fail the presence check and block the deletion). A match
  -- sent without an article, on a line that had none, is refused by that check.
  if tg_op = 'UPDATE' and old.product_id is not null and new.product_id is null then
    new.product_match := null;
  end if;

  -- A validated line always describes what was validated: changing what it says returns it to draft,
  -- even when the same statement keeps it validated. Position and the duplicate acknowledgement are
  -- not what it says, nor is its supplier (TI-691: the office's purchasing choice, made or changed on a
  -- validated line), and an article erased by its own deletion (trigger depth 2) is not an edit. Linking,
  -- changing or removing the article is. pre_link_wording is left out: it is what the line said before
  -- its link, not what it says, and it only changes with product_id, which is compared.
  if tg_op = 'UPDATE' and old.status = 'validated' and new.status = 'validated' and pg_trigger_depth() = 1 and (
    (new.original_text, new.quantity, new.quantity_doubtful, new.unit, new.dimension, new.no_dimension,
      new.product_type, new.material, new.material_precision, new.reference, new.zone,
      new.imputation, new.overhead_category, new.product_id, new.product_match)
    is distinct from
    (old.original_text, old.quantity, old.quantity_doubtful, old.unit, old.dimension, old.no_dimension,
      old.product_type, old.material, old.material_precision, old.reference, old.zone,
      old.imputation, old.overhead_category, old.product_id, old.product_match)
  ) then
    new.status := 'draft';
  end if;

  -- A line is validated in a material: its own, or the one presumed for its request once an operator
  -- has confirmed it. Overhead (PPE, small tooling) is not ordered in the request's material. The
  -- request row is locked against a concurrent change of that material until this validation commits;
  -- the request's own trigger returns to draft the lines that relied on a material it withdraws.
  if new.status = 'validated' and (tg_op = 'INSERT' or old.status <> 'validated')
    and new.imputation = 'project' and btrim(coalesce(new.material, '')) = '' then
    select request.presumed_material, request.material_confirmed into presumed
    from public.material_requests request where request.id = new.request_id for share;
    if btrim(coalesce(presumed.presumed_material, '')) = '' then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_MATERIAL_MISSING';
    elsif not presumed.material_confirmed then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_MATERIAL_UNCONFIRMED';
    end if;
  end if;

  -- Author and date of a validation are stamped here, never taken from the client.
  if new.status <> 'validated' then
    new.validated_at := null;
    new.validated_by := null;
  elsif tg_op = 'UPDATE' and old.status = 'validated' then
    new.validated_at := old.validated_at;
    if new.validated_by is not null or pg_trigger_depth() = 1 then new.validated_by := old.validated_by; end if;
  else
    new.validated_at := clock_timestamp();
    new.validated_by := (select auth.uid());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on column public.material_request_lines.supplier_id is
  'TI-691: the supplier the line will be bought from, chosen by the office (same tenant). Purchasing information: setting or changing it keeps a validated line validated.';

-- ---------------------------------------------------------------------------
-- 2. Preferred suppliers of supply types and articles.
-- ---------------------------------------------------------------------------
alter table public.supply_types
  add column preferred_supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.products
  add column preferred_supplier_id uuid references public.suppliers(id) on delete set null;

comment on column public.supply_types.preferred_supplier_id is
  'TI-691: supplier proposed for the material request lines whose article is of this supply type (same tenant). Set or cleared by an admin or engineer of the active tenant only.';
comment on column public.products.preferred_supplier_id is
  'TI-691: the article''s supplier exception, proposed before its supply type''s preferred supplier (same tenant). Written like any field of the article (can_edit_catalogue_record).';

create index supply_types_preferred_supplier_id_idx
  on public.supply_types (preferred_supplier_id)
  where preferred_supplier_id is not null;
create index products_preferred_supplier_id_idx
  on public.products (preferred_supplier_id)
  where preferred_supplier_id is not null;

-- The foreign keys are not composite: the supplier is one of the row's tenant. Runs as the caller, so a supplier
-- the caller cannot read is one that does not exist. Checked when it is set and when the row changes tenant.
-- An article's exception is also a supplier the office can buy it from: one with an active item for the article
-- (a supplier withdrawn from the article is not proposed; withdrawing clears the exception, see
-- save_supplier_catalog_item). Checked when the exception is set; both tables carry the columns read here.
create function private.enforce_preferred_supplier()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.preferred_supplier_id is not null
    and (tg_op = 'INSERT' or new.preferred_supplier_id is distinct from old.preferred_supplier_id
      or new.tenant_id is distinct from old.tenant_id)
    and not exists (
      select 1 from public.suppliers supplier
      where supplier.id = new.preferred_supplier_id and supplier.tenant_id = new.tenant_id
    )
  then
    raise exception using errcode = '23514', message = 'PREFERRED_SUPPLIER_TENANT_MISMATCH';
  end if;
  if tg_table_name = 'products' and new.preferred_supplier_id is not null
    and (tg_op = 'INSERT' or new.preferred_supplier_id is distinct from old.preferred_supplier_id)
    and not exists (
      select 1 from public.supplier_catalog_items item
      where item.tenant_id = new.tenant_id
        and item.product_id = new.id
        and item.supplier_id = new.preferred_supplier_id
        and item.is_active
    )
  then
    raise exception using errcode = '23514', message = 'PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_preferred_supplier() from public, anon, authenticated;

-- Named to fire after set_products_tenant_id: the supplier is checked against the assigned tenant.
create trigger validate_product_preferred_supplier
  before insert or update on public.products
  for each row execute function private.enforce_preferred_supplier();
create trigger validate_supply_type_preferred_supplier
  before insert or update on public.supply_types
  for each row execute function private.enforce_preferred_supplier();

-- The preferred supplier of a supply type is a purchasing decision of the catalogue's editors, although any member
-- still writes the type's name and code. A server writer without a user (service role, a migration) is not
-- concerned, nor is the clearing done by the deletion of the supplier itself (ON DELETE SET NULL, trigger depth 2):
-- its deleter was allowed to delete it. Named to fire before validate_supply_type_preferred_supplier.
create function private.guard_supply_type_preferred_supplier()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.preferred_supplier_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.preferred_supplier_id is not distinct from old.preferred_supplier_id then
    return new;
  end if;
  if new.preferred_supplier_id is null and pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.tenant_id is distinct from (select public.current_tenant_id())
    or not public.has_tenant_role(new.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])
  then
    raise exception using errcode = '42501', message = 'SUPPLY_TYPE_PREFERRED_SUPPLIER_EDITORS_ONLY';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_supply_type_preferred_supplier() from public, anon, authenticated;

create trigger guard_supply_type_preferred_supplier
  before insert or update on public.supply_types
  for each row execute function private.guard_supply_type_preferred_supplier();

-- ---------------------------------------------------------------------------
-- 3. An article's reference at a supplier, without any price.
-- ---------------------------------------------------------------------------
-- Security definer: authenticated only reads supplier_catalog_items (no write grant, no write policy), and
-- the item's rights are those of its article. The caller is an admin or engineer of the active tenant who may
-- change the article (TI-689 rule, the one its update policy applies); the article and the supplier are of the
-- active tenant. Upsert on the item's unique key, value by value: a null reference or address keeps the stored
-- one, a blank one clears it (the application sends null for a key its caller left out, a blank for an explicit
-- null). An active item keeps a reference or an address: a new item needs one, and a save cannot clear the last
-- one of an active item; a withdrawn item does not need one, so an item that only carries prices can be withdrawn
-- (and restored) as it is. Withdrawing is p_is_active false, nothing is deleted; it also clears the article's
-- supplier exception when it names that supplier, so that a withdrawn supplier is not proposed as the article's.
-- Prices, and the reference each price row keeps as it was when written, are not touched.
create function public.save_supplier_catalog_item(
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
    set supplier_sku = case when p_supplier_sku is null then item.supplier_sku else normalized_sku end,
        product_url = case when p_product_url is null then item.product_url else normalized_url end,
        is_active = p_is_active
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

comment on function public.save_supplier_catalog_item(uuid, uuid, text, text, boolean) is
  'TI-691: adds or changes an article''s reference (1-255 characters, trimmed) and/or http(s) address at a supplier, without a price, and returns the item id. Null keeps the stored value, blank clears it; an active item keeps one of them (SUPPLIER_CATALOG_ITEM_IDENTIFIER_REQUIRED), a withdrawn one need not. Caller: admin or engineer of the active tenant who may change the article (SUPPLIER_CATALOG_ITEM_EDITORS_ONLY, SUPPLIER_CATALOG_ITEM_PRODUCT_LOCKED); article and supplier of the active tenant (..._NOT_FOUND). p_is_active false withdraws the supplier from the article and clears the article''s exception when it names that supplier.';

revoke all on function public.save_supplier_catalog_item(uuid, uuid, text, text, boolean) from public, anon;
grant execute on function public.save_supplier_catalog_item(uuid, uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The supplier of the last purchase of each article.
-- ---------------------------------------------------------------------------
-- Security definer because purchase orders and their items are readable only by the order's owner or a tenant
-- admin (policies « Users can view own purchase orders » and « ... purchase order items »): as the caller, the
-- office member who reads a request would only see their own orders. What crosses that boundary is the least the
-- proposal needs: per article, the supplier of the latest confirmed or received order of the active tenant carrying
-- it, never an order id, a date, a quantity, a price or an amount. Latest by order date, then last change, then id,
-- as the reference-price sync reads it (refresh_product_reference_prices, 20260714090000).
-- Who may ask: a member of the active tenant, for the articles that a material request line they may read names
-- (the read rule of material requests, can_read_affaire_intake_project: owner of the affaire, admin, director).
-- Any other id gives no row. At most 500 ids per call.
create function public.last_purchase_suppliers(p_product_ids uuid[])
returns table (product_id uuid, supplier_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_tenant_id uuid := public.current_tenant_id();
begin
  if (select auth.uid()) is null or active_tenant_id is null then
    raise exception using errcode = '42501', message = 'LAST_PURCHASE_SUPPLIERS_MEMBER_ONLY';
  end if;
  if pg_catalog.cardinality(coalesce(p_product_ids, '{}'::uuid[])) > 500 then
    raise exception using errcode = '22023', message = 'LAST_PURCHASE_SUPPLIERS_TOO_MANY';
  end if;

  return query
  with readable as (
    select distinct wanted.id
    from pg_catalog.unnest(coalesce(p_product_ids, '{}'::uuid[])) as wanted(id)
    where wanted.id is not null
      and exists (
        select 1
        from public.material_request_lines line
        where line.tenant_id = active_tenant_id
          and line.product_id = wanted.id
          and public.can_read_affaire_intake_project(line.project_id, active_tenant_id)
      )
  )
  select distinct on (readable.id) readable.id, purchase_order.supplier_id
  from readable
  join public.purchase_order_items order_item
    on order_item.product_id = readable.id and order_item.tenant_id = active_tenant_id
  join public.purchase_orders purchase_order
    on purchase_order.id = order_item.purchase_order_id and purchase_order.tenant_id = active_tenant_id
  where purchase_order.status in ('confirmed'::public.purchase_order_status, 'received'::public.purchase_order_status)
  order by readable.id, purchase_order.order_date desc, purchase_order.updated_at desc, purchase_order.id desc;
end;
$$;

comment on function public.last_purchase_suppliers(uuid[]) is
  'TI-691: per article named by a material request line the caller may read, the supplier of the latest confirmed or received order of the active tenant carrying it (order date, then last change, then id). No date, no amounts. At most 500 ids (LAST_PURCHASE_SUPPLIERS_TOO_MANY).';

revoke all on function public.last_purchase_suppliers(uuid[]) from public, anon;
grant execute on function public.last_purchase_suppliers(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Retaining the suppliers of several lines, all or nothing.
-- ---------------------------------------------------------------------------
-- « Retenir les fournisseurs proposés »: one statement for the whole batch, so a failing choice (a supplier of
-- another tenant, refused by the line trigger) writes none of them, and the caller is never told « nothing retained »
-- while part of the batch was written. Security invoker: the policies of material_request_lines decide which lines
-- the caller may change (owner of the affaire or admin, with the role admin or engineer, active tenant); a line
-- they may not change, of another request or of another tenant is simply not written. Only lines whose supplier is
-- still null are written: the condition is re-checked on the row being updated, so a supplier another session set
-- in the meantime is kept. The supplier is not what a line says: a validated line stays validated (line trigger).
-- Answer: one row per choice, in the order given, saying whether its line was written.
create function public.retain_material_request_line_suppliers(p_request_id uuid, p_choices jsonb)
returns table (line_id uuid, retained boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written_line_ids uuid[];
begin
  if p_choices is null or pg_catalog.jsonb_typeof(p_choices) <> 'array'
    or pg_catalog.jsonb_array_length(p_choices) not between 1 and 300
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_choices) as entry(choice)
      where pg_catalog.jsonb_typeof(entry.choice) <> 'object'
        or pg_catalog.jsonb_typeof(entry.choice -> 'line_id') <> 'string'
        or pg_catalog.jsonb_typeof(entry.choice -> 'supplier_id') <> 'string'
    )
    or (select count(distinct entry.choice ->> 'line_id') from pg_catalog.jsonb_array_elements(p_choices) as entry(choice))
      <> pg_catalog.jsonb_array_length(p_choices)
  then
    raise exception using errcode = '22023', message = 'MATERIAL_REQUEST_RETAIN_CHOICES_INVALID';
  end if;

  with choices as (
    select (entry.choice ->> 'line_id')::uuid as chosen_line_id,
      (entry.choice ->> 'supplier_id')::uuid as chosen_supplier_id
    from pg_catalog.jsonb_array_elements(p_choices) as entry(choice)
  ),
  written as (
    update public.material_request_lines line
    set supplier_id = choices.chosen_supplier_id
    from choices
    where line.id = choices.chosen_line_id
      and line.request_id = p_request_id
      and line.supplier_id is null
    returning line.id as written_line_id
  )
  select coalesce(pg_catalog.array_agg(written.written_line_id), '{}'::uuid[]) into written_line_ids from written;

  return query
  select (entry.choice ->> 'line_id')::uuid, (entry.choice ->> 'line_id')::uuid = any(written_line_ids)
  from pg_catalog.jsonb_array_elements(p_choices) with ordinality as entry(choice, choice_position)
  order by entry.choice_position;
end;
$$;

comment on function public.retain_material_request_line_suppliers(uuid, jsonb) is
  'TI-691: retains the suppliers chosen for several lines of a request ([{line_id, supplier_id}], 1 to 300, each line once: MATERIAL_REQUEST_RETAIN_CHOICES_INVALID) in one statement, all or nothing, writing only lines that still have no supplier and that the caller may change (security invoker, RLS). One row per choice: retained or not.';

revoke all on function public.retain_material_request_line_suppliers(uuid, jsonb) from public, anon;
grant execute on function public.retain_material_request_line_suppliers(uuid, jsonb) to authenticated;

commit;
