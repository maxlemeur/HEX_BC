-- TI-711: the costing workbook import becomes a batch the office can review in bulk and undo.
-- No remote application is authorized here. The deployed application keeps calling
-- public.import_workbook_supplier_references unchanged. The two deployed writes replaced below are
-- public.save_supplier_catalog_item, which retries a conflicting pair deleted by undo, and
-- public.update_supplier_catalog_item, which reports a missing id when undo deletes it during an edit.
--
-- - public.supplier_aliases: a name the office's workbook uses for a catalogue supplier, compared by its key
--   (accent-free lowercase name with single spaces, computed by the application). One supplier per key in a
--   tenant. Same rights as public.product_aliases: read by the members, added by admins and engineers of the
--   active tenant, deleted by an admin or by its author, and never updated by a signed-in member.
-- - public.catalogue_import_batches: one row per confirmed import, written for members by the functions below.
-- - Server-writer exceptions: service_role keeps UPDATE on supplier_aliases, matching product_aliases, and
--   full DML on catalogue_import_batches. A server writer without a user can still restamp a product.
-- - products.import_batch_id, supplier_catalog_items.import_batch_id: what a batch created. An article is
--   stamped at insert only, with a batch of articles its author started and nobody has begun undoing
--   (PRODUCT_IMPORT_BATCH_INVALID).
-- - public.start_workbook_article_import: opens the batch the application then stamps on its inserts.
-- - public.import_workbook_supplier_reference_batch: public.import_workbook_supplier_references with a product
--   URL per row and a batch.
-- - public.review_supplier_references: validates or withdraws pending references in bulk.
-- - public.validate_draft_products, public.assign_products_supply_type: bulk edits of draft articles, as the
--   caller (RLS and the existing triggers keep the last word).
-- - public.undo_catalogue_import_batch: removes, page by page, what a batch created and nobody used since. A
--   draft is kept as soon as something names it: an estimate line, a material request line, a purchase order
--   line, a DPGF link, a usual name, a packaging. Those links are cleared or deleted with an article
--   (ON DELETE SET NULL or CASCADE): the undo must not take the office's work away with the draft.
--
-- Bulk review and undo of a reference batch lock existing references first (by article, then id), then their
-- articles (by id). Undo of an article batch walks articles by id, locking each article's removable references
-- before the article. Once it holds the article, it keeps any draft with an unlocked reference, so neither its
-- DELETE nor the foreign key check asks for a reference lock held by a writer waiting on that article.
--
-- Deleting an article checks every foreign key that references it. Three of them had no index led by the
-- article: estimate_items (tenant_id, product_id), product_reference_price_validations and
-- product_reference_price_withdrawals (tenant_id, product_id, …). Each deletion read those indexes whole; they
-- get an index on product_id here.
-- Regression: supabase/tests/database/workbook-import-review.test.sql and workbook-import-undo-race.test.sql.

begin;

do $preflight$
begin
  if to_regclass('public.products') is null
    or to_regclass('public.suppliers') is null
    or to_regclass('public.supplier_catalog_items') is null
    or to_regclass('public.supplier_pricebook') is null
    or to_regclass('public.product_aliases') is null
    or to_regprocedure('public.has_tenant_role(uuid, public.tenant_role[])') is null
    or to_regprocedure('public.is_tenant_member(uuid)') is null
    or to_regprocedure('public.current_tenant_id()') is null
    or to_regprocedure('public.can_edit_catalogue_record(uuid, uuid)') is null
    or to_regprocedure('public.import_workbook_supplier_references(uuid, jsonb)') is null
    or to_regprocedure('public.save_supplier_catalog_item(uuid, uuid, text, text, boolean)') is null
    or to_regprocedure('public.update_supplier_catalog_item(uuid, text, text)') is null
    or to_regprocedure('private.enforce_product_catalogue_status()') is null
  then
    raise exception 'TI711_IMPORT_REVIEW_PREREQUISITE_MISSING';
  end if;
  if to_regclass('public.supplier_aliases') is not null
    or to_regclass('public.catalogue_import_batches') is not null
  then
    raise exception 'TI711_IMPORT_REVIEW_PREFLIGHT: the tables of this migration already exist';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. Names the workbook uses for a supplier.
-- ---------------------------------------------------------------------------
create table public.supplier_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  -- The name as the workbook writes it, trimmed by the trigger.
  alias text not null check (char_length(alias) between 1 and 255 and alias = btrim(alias)),
  -- What the import compares: the accent-free lowercase name with single spaces, computed by the application.
  alias_key text not null check (
    char_length(alias_key) between 1 and 255 and alias_key = lower(alias_key) and alias_key = btrim(alias_key)
  ),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint supplier_aliases_tenant_alias_key unique (tenant_id, alias_key)
);

comment on table public.supplier_aliases is
  'TI-711: names the office''s costing workbook uses for a catalogue supplier. One supplier per alias_key in a tenant; same tenant as the supplier; signed-in members cannot update aliases.';
comment on column public.supplier_aliases.alias_key is
  'Accent-free lowercase name with single spaces, computed by the application. The database only checks that it is not empty, lowercase and trimmed.';

create index supplier_aliases_supplier_idx on public.supplier_aliases (supplier_id);
create index supplier_aliases_created_by_idx on public.supplier_aliases (created_by);

-- The tenant is the supplier's, never the client's; the date is the database's, and a signed-in member is the
-- author. Runs as the caller: a supplier the caller cannot read is one that does not exist. The insert policy
-- then requires that tenant to be the caller's active one, so a supplier of another of their tenants is refused.
create function private.enforce_supplier_alias_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  supplier_tenant_id uuid;
begin
  select supplier.tenant_id into supplier_tenant_id
  from public.suppliers supplier where supplier.id = new.supplier_id;
  if supplier_tenant_id is null then
    raise exception using errcode = '23514', message = 'SUPPLIER_ALIAS_TENANT_MISMATCH';
  end if;
  new.tenant_id := supplier_tenant_id;
  new.alias := pg_catalog.btrim(new.alias);
  new.created_at := pg_catalog.now();
  if (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_supplier_alias_write() from public, anon, authenticated;

create trigger enforce_supplier_alias_write
  before insert on public.supplier_aliases
  for each row execute function private.enforce_supplier_alias_write();

alter table public.supplier_aliases enable row level security;
alter table public.supplier_aliases force row level security;

revoke all on public.supplier_aliases from public, anon, authenticated;
grant select, insert, delete on public.supplier_aliases to authenticated;
grant select, insert, update, delete on public.supplier_aliases to service_role;

create policy "Tenant members read supplier aliases"
  on public.supplier_aliases for select to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Catalogue editors add supplier aliases"
  on public.supplier_aliases for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
  );

create policy "Admins and authors delete supplier aliases"
  on public.supplier_aliases for delete to authenticated
  using (
    (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    or (created_by = (select auth.uid()) and (select public.is_tenant_member(tenant_id)))
  );

-- ---------------------------------------------------------------------------
-- 2. One row per confirmed import.
-- ---------------------------------------------------------------------------
create table public.catalogue_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  kind text not null check (kind in ('workbook_articles', 'workbook_supplier_references')),
  source_name text check (source_name is null or char_length(source_name) <= 255),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  undo_started_at timestamptz,
  undo_cursor uuid,
  undone_at timestamptz,
  undone_by uuid references auth.users(id) on delete set null,
  constraint catalogue_import_batches_undo_started_check check (undone_at is null or undo_started_at is not null),
  -- The articles and supplier references of a batch reference it with their tenant.
  constraint catalogue_import_batches_tenant_id_key unique (tenant_id, id)
);

comment on table public.catalogue_import_batches is
  'TI-711: one row per confirmed costing workbook import (articles, or supplier references). Member writes go through public.start_workbook_article_import, public.import_workbook_supplier_reference_batch and public.undo_catalogue_import_batch.';
comment on column public.catalogue_import_batches.undo_started_at is
  'Set on the first undo page. No more workbook articles can be added to the batch after this point.';
comment on column public.catalogue_import_batches.undo_cursor is
  'Last article or supplier reference examined by the undo, in id order.';
comment on column public.catalogue_import_batches.undone_at is
  'Set by public.undo_catalogue_import_batch once it has walked the whole batch. What it kept (validated articles, reviewed references, rows in use) still carries the batch.';

create index catalogue_import_batches_tenant_created_idx
  on public.catalogue_import_batches (tenant_id, created_at desc);
create index catalogue_import_batches_created_by_idx
  on public.catalogue_import_batches (created_by);
create index catalogue_import_batches_undone_by_idx
  on public.catalogue_import_batches (undone_by)
  where undone_by is not null;

-- Not forced: the rows are written by the security definer functions of this migration, as the table's owner.
alter table public.catalogue_import_batches enable row level security;

revoke all on public.catalogue_import_batches from public, anon, authenticated;
grant select on public.catalogue_import_batches to authenticated;
grant select, insert, update, delete on public.catalogue_import_batches to service_role;

create policy "Tenant members read catalogue import batches"
  on public.catalogue_import_batches for select to authenticated
  using ((select public.is_tenant_member(tenant_id)));

-- ---------------------------------------------------------------------------
-- 3. What a batch created.
-- ---------------------------------------------------------------------------
alter table public.products
  add column import_batch_id uuid,
  add constraint products_import_batch_fkey
    foreign key (tenant_id, import_batch_id)
    references public.catalogue_import_batches (tenant_id, id);

alter table public.supplier_catalog_items
  add column import_batch_id uuid,
  add constraint supplier_catalog_items_import_batch_fkey
    foreign key (tenant_id, import_batch_id)
    references public.catalogue_import_batches (tenant_id, id);

comment on column public.products.import_batch_id is
  'TI-711: the workbook import that created the article (null: any other path). Set at insert only, with a batch of articles the author started and nobody has begun undoing (PRODUCT_IMPORT_BATCH_INVALID).';
comment on column public.supplier_catalog_items.import_batch_id is
  'TI-711: the workbook import that created the supplier reference (null: any other path). Written by public.import_workbook_supplier_reference_batch only.';

-- Also the index of the foreign key (an id is unique across tenants), and the order the undo walks a batch in.
create index products_import_batch_idx
  on public.products (import_batch_id, id)
  where import_batch_id is not null;
create index supplier_catalog_items_import_batch_idx
  on public.supplier_catalog_items (import_batch_id, id)
  where import_batch_id is not null;

-- The review queue: the references a tenant still has to review, newest first.
create index supplier_catalog_items_review_queue_idx
  on public.supplier_catalog_items (tenant_id, created_at desc)
  where reference_needs_review;

-- A deleted article is looked up in every table that references it: by the article alone.
create index estimate_items_product_id_idx
  on public.estimate_items (product_id)
  where product_id is not null;
create index product_reference_price_validations_product_id_idx
  on public.product_reference_price_validations (product_id);
create index product_reference_price_withdrawals_product_id_idx
  on public.product_reference_price_withdrawals (product_id);

-- Security definer for one reason: the batch row is read under a share lock, which a member holding SELECT
-- only cannot take. The first undo page waits for any in-flight chunk to commit before it reads the articles.
-- One primary key lookup per stamped article; the two triggers
-- below do not fire for any other write.
create function private.enforce_product_import_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- A server writer without a user (service role, a migration) keeps the right to restamp.
    if (select auth.uid()) is not null then
      raise exception using errcode = '23514', message = 'PRODUCT_IMPORT_BATCH_INVALID';
    end if;
    return new;
  end if;

  perform 1
  from public.catalogue_import_batches batch
  where batch.id = new.import_batch_id
    and batch.kind = 'workbook_articles'
    and batch.created_by = (select auth.uid())
    and batch.undo_started_at is null
  for share;
  if not found then
    raise exception using errcode = '23514', message = 'PRODUCT_IMPORT_BATCH_INVALID';
  end if;
  -- products_import_batch_fkey enforces that the article and batch have the same tenant.
  return new;
end;
$$;

revoke all on function private.enforce_product_import_batch() from public, anon, authenticated;

-- Named to fire after set_products_tenant_id: the batch is checked against the assigned tenant.
create trigger validate_product_import_batch_insert
  before insert on public.products
  for each row when (new.import_batch_id is not null)
  execute function private.enforce_product_import_batch();
create trigger validate_product_import_batch_update
  before update on public.products
  for each row when (new.import_batch_id is distinct from old.import_batch_id)
  execute function private.enforce_product_import_batch();

-- ---------------------------------------------------------------------------
-- 4. Opening a batch of articles. The application then inserts the articles itself, under RLS, with the id.
-- ---------------------------------------------------------------------------
create function public.start_workbook_article_import(p_tenant_id uuid, p_source_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  active_tenant_id uuid := public.current_tenant_id();
  created_batch_id uuid;
begin
  if actor_id is null or active_tenant_id is null or p_tenant_id is distinct from active_tenant_id
    or not public.has_tenant_role(active_tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])
  then
    raise exception using errcode = '42501', message = 'CATALOGUE_IMPORT_EDITORS_ONLY';
  end if;

  insert into public.catalogue_import_batches as batch (tenant_id, kind, source_name, created_by)
  values (
    active_tenant_id, 'workbook_articles',
    nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(p_source_name), 255)), ''), actor_id
  )
  returning batch.id into created_batch_id;
  return created_batch_id;
end;
$$;

revoke all on function public.start_workbook_article_import(uuid, text) from public, anon;
grant execute on function public.start_workbook_article_import(uuid, text) to authenticated;

comment on function public.start_workbook_article_import(uuid, text) is
  'TI-711: opens a batch of workbook articles for an admin or an engineer when the supplied tenant is still the active tenant (CATALOGUE_IMPORT_EDITORS_ONLY), and returns its id. The caller inserts the articles with that tenant and batch id.';

-- ---------------------------------------------------------------------------
-- 5. Supplier references of a workbook, as a batch. Body from public.import_workbook_supplier_references
--    (20261117193734); the product URL, the batch row and its stamp are new.
-- ---------------------------------------------------------------------------
create function public.import_workbook_supplier_reference_batch(
  p_tenant_id uuid,
  p_rows jsonb,
  p_source_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  active_tenant_id uuid := public.current_tenant_id();
  created_batch_id uuid;
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
  -- One unusable address refuses the batch: it was confirmed as a whole.
  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_rows) as candidate (product_url text)
    where nullif(pg_catalog.btrim(candidate.product_url), '') is not null
      and (
        pg_catalog.char_length(pg_catalog.btrim(candidate.product_url)) > 2000
        or pg_catalog.btrim(candidate.product_url) !~* '^https?://[^[:space:]]+$'
      )
  ) then
    raise exception using errcode = '22023', message = 'WORKBOOK_SUPPLIER_REFERENCES_INVALID';
  end if;

  insert into public.catalogue_import_batches as batch (tenant_id, kind, source_name, created_by)
  values (
    active_tenant_id, 'workbook_supplier_references',
    nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(p_source_name), 255)), ''), actor_id
  )
  returning batch.id into created_batch_id;

  with candidates as materialized (
    select product.id as product_id, supplier.id as supplier_id,
      nullif(pg_catalog.btrim(candidate.supplier_sku), '') as supplier_sku,
      nullif(pg_catalog.btrim(candidate.product_url), '') as product_url
    from pg_catalog.jsonb_to_recordset(p_rows) as candidate (
      product_id uuid, product_reference text, supplier_id uuid, supplier_name text, supplier_sku text,
      product_url text
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
    tenant_id, product_id, supplier_id, supplier_sku, product_url, is_active, reference_needs_review, created_by,
    import_batch_id
  )
  select active_tenant_id, product_id, supplier_id, supplier_sku, product_url, false, true, actor_id,
    created_batch_id
  from candidates
  order by product_id, supplier_id
  on conflict on constraint supplier_catalog_items_tenant_supplier_product_key do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count <> pg_catalog.jsonb_array_length(p_rows) then
    raise exception using errcode = 'P0001', message = 'WORKBOOK_SUPPLIER_REFERENCES_CHANGED';
  end if;
  return pg_catalog.jsonb_build_object('batch_id', created_batch_id, 'imported', inserted_count);
end;
$$;

revoke all on function public.import_workbook_supplier_reference_batch(uuid, jsonb, text) from public, anon;
grant execute on function public.import_workbook_supplier_reference_batch(uuid, jsonb, text) to authenticated;

comment on function public.import_workbook_supplier_reference_batch(uuid, jsonb, text) is
  'TI-711: public.import_workbook_supplier_references as an undoable batch. Atomically inserts pending, inactive supplier references (with their product URL) for editable active articles and active suppliers in the team currently selected, stamped with a new batch; returns {batch_id, imported}. Existing supplier items and prices are kept as stored.';

-- ---------------------------------------------------------------------------
-- 6. Reviewing pending references in bulk. Security definer: authenticated only reads supplier_catalog_items.
-- ---------------------------------------------------------------------------
create function public.review_supplier_references(p_item_ids uuid[], p_validate boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  active_tenant_id uuid := public.current_tenant_id();
  item_ids uuid[];
  editable_authors uuid[];
  unattributed_editable boolean;
  target_ids uuid[];
  withdrawn_product_ids uuid[];
  withdrawn_supplier_ids uuid[];
  reviewed_count integer;
begin
  if actor_id is null or active_tenant_id is null
    or not public.has_tenant_role(active_tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])
  then
    raise exception using errcode = '42501', message = 'SUPPLIER_CATALOG_ITEM_EDITORS_ONLY';
  end if;
  if p_validate is null or p_item_ids is null
    or coalesce(pg_catalog.cardinality(p_item_ids), 0) not between 1 and 5000
    or pg_catalog.array_position(p_item_ids, null) is not null
  then
    raise exception using errcode = '22023', message = 'SUPPLIER_REFERENCE_REVIEW_INVALID';
  end if;
  item_ids := array(select distinct given.id from pg_catalog.unnest(p_item_ids) as given (id));

  -- public.can_edit_catalogue_record answers by tenant and author: asked once per author of the articles
  -- concerned, never once per reference. Beside a join, the planner is free to evaluate it on every pair it
  -- compares (5 000 references did not finish in a minute that way).
  with authors as materialized (
    select distinct product.created_by
    from public.supplier_catalog_items item
    join public.products product on product.id = item.product_id and product.tenant_id = item.tenant_id
    where item.id = any(item_ids)
      and item.tenant_id = active_tenant_id
      and item.reference_needs_review
  )
  select coalesce(pg_catalog.array_agg(authors.created_by) filter (where authors.created_by is not null), '{}'::uuid[]),
    coalesce(pg_catalog.bool_or(authors.created_by is null), false)
  into editable_authors, unattributed_editable
  from authors
  where public.can_edit_catalogue_record(active_tenant_id, authors.created_by);

  -- The pending references of the active tenant whose article the caller may edit, held in one order.
  select coalesce(pg_catalog.array_agg(locked.id), '{}'::uuid[]) into target_ids
  from (
    select item.id
    from public.supplier_catalog_items item
    join public.products product on product.id = item.product_id and product.tenant_id = item.tenant_id
    where item.id = any(item_ids)
      and item.tenant_id = active_tenant_id
      and item.reference_needs_review
      and (
        product.created_by = any(editable_authors)
        or (product.created_by is null and unattributed_editable)
      )
    order by item.product_id, item.id
    for update of item
  ) locked;

  -- Then their articles, which the trigger of each updated reference would otherwise take in scan order.
  perform 1
  from public.products product
  where product.id in (
    select item.product_id from public.supplier_catalog_items item where item.id = any(target_ids)
  )
  order by product.id
  for update of product;

  -- Validated: usable, its reference and address kept. Withdrawn: as public.save_supplier_catalog_item
  -- withdraws a pending reference, its unverified reference and address discarded.
  with reviewed as (
    update public.supplier_catalog_items item
    set is_active = p_validate,
        reference_needs_review = false,
        supplier_sku = case when p_validate then item.supplier_sku end,
        product_url = case when p_validate then item.product_url end
    from public.products product, public.suppliers supplier
    where item.id = any(target_ids)
      and item.reference_needs_review
      and product.id = item.product_id
      and supplier.id = item.supplier_id
      and (not p_validate or (product.is_active and supplier.is_active))
    returning item.product_id, item.supplier_id
  )
  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.array_agg(reviewed.product_id), '{}'::uuid[]),
    coalesce(pg_catalog.array_agg(reviewed.supplier_id), '{}'::uuid[])
  into reviewed_count, withdrawn_product_ids, withdrawn_supplier_ids
  from reviewed;

  if not p_validate and reviewed_count > 0 then
    update public.products product
    set preferred_supplier_id = null
    from unnest(withdrawn_product_ids, withdrawn_supplier_ids) as withdrawn (product_id, supplier_id)
    where product.id = withdrawn.product_id
      and product.tenant_id = active_tenant_id
      and product.preferred_supplier_id = withdrawn.supplier_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'reviewed', reviewed_count,
    'skipped', pg_catalog.cardinality(item_ids) - reviewed_count
  );
end;
$$;

revoke all on function public.review_supplier_references(uuid[], boolean) from public, anon;
grant execute on function public.review_supplier_references(uuid[], boolean) to authenticated;

comment on function public.review_supplier_references(uuid[], boolean) is
  'TI-711: an admin or an engineer of the team currently selected reviews up to 5 000 pending supplier references of articles they may edit. Validating activates a reference whose article and supplier are active, and keeps its reference and address; withdrawing deactivates it, discards them and clears the article''s preferred supplier when it was that supplier. Anything else is skipped; returns {reviewed, skipped}.';

-- ---------------------------------------------------------------------------
-- 7. Bulk edits of draft articles, as the caller.
-- ---------------------------------------------------------------------------
create function public.validate_draft_products(p_product_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  active_tenant_id uuid := public.current_tenant_id();
  product_ids uuid[];
  complete_ids uuid[];
  validated_count integer;
  incomplete_count integer;
begin
  if actor_id is null or active_tenant_id is null
    or not public.has_tenant_role(active_tenant_id, array['admin'::public.tenant_role])
  then
    raise exception using errcode = '42501', message = 'PRODUCT_VALIDATION_ADMIN_ONLY';
  end if;
  if p_product_ids is null
    or coalesce(pg_catalog.cardinality(p_product_ids), 0) not between 1 and 5000
    or pg_catalog.array_position(p_product_ids, null) is not null
  then
    raise exception using errcode = '22023', message = 'PRODUCT_BULK_INVALID';
  end if;
  product_ids := array(select distinct given.id from pg_catalog.unnest(p_product_ids) as given (id));

  -- The rule of private.enforce_product_catalogue_status, read on the rows once they are held (in id order):
  -- the update validates only what that trigger accepts, so one incomplete draft does not refuse the others.
  select coalesce(pg_catalog.array_agg(locked.id) filter (where locked.complete), '{}'::uuid[]),
    (pg_catalog.count(*) filter (where not locked.complete))::integer
  into complete_ids, incomplete_count
  from (
    select product.id,
      (
        nullif(pg_catalog.btrim(coalesce(product.product_type, '')), '') is not null
        and nullif(pg_catalog.btrim(coalesce(product.material, '')), '') is not null
        and nullif(pg_catalog.btrim(coalesce(product.unit, '')), '') is not null
        and product.supply_type_id is not null
      ) as complete
    from public.products product
    where product.id = any(product_ids)
      and product.tenant_id = active_tenant_id
      and product.catalogue_status = 'draft'
      and product.is_active
    order by product.id
    for update of product
  ) locked;

  -- By id, never through a join: the row policies are then evaluated on these articles only.
  update public.products product
  set catalogue_status = 'validated'
  where product.id = any(complete_ids);
  get diagnostics validated_count = row_count;

  return pg_catalog.jsonb_build_object(
    'validated', validated_count,
    'incomplete', incomplete_count,
    'skipped', pg_catalog.cardinality(product_ids) - validated_count - incomplete_count
  );
end;
$$;

revoke all on function public.validate_draft_products(uuid[]) from public, anon;
grant execute on function public.validate_draft_products(uuid[]) to authenticated;

comment on function public.validate_draft_products(uuid[]) is
  'TI-711: an admin of the team currently selected (PRODUCT_VALIDATION_ADMIN_ONLY) validates up to 5 000 active draft articles that carry a type, a material, a unit and a supply type. Returns {validated, incomplete, skipped}: incomplete counts the active drafts left as they are, skipped every other id.';

create function public.assign_products_supply_type(p_product_ids uuid[], p_supply_type_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  active_tenant_id uuid := public.current_tenant_id();
  product_ids uuid[];
  editable_authors uuid[];
  unattributed_editable boolean;
  target_ids uuid[];
  changed_count integer;
begin
  if actor_id is null or active_tenant_id is null
    or not public.has_tenant_role(active_tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])
  then
    raise exception using errcode = '42501', message = 'CATALOGUE_IMPORT_EDITORS_ONLY';
  end if;
  if p_product_ids is null
    or coalesce(pg_catalog.cardinality(p_product_ids), 0) not between 1 and 5000
    or pg_catalog.array_position(p_product_ids, null) is not null
  then
    raise exception using errcode = '22023', message = 'PRODUCT_BULK_INVALID';
  end if;
  if p_supply_type_id is null or not exists (
    select 1 from public.supply_types supply_type
    where supply_type.id = p_supply_type_id and supply_type.tenant_id = active_tenant_id
  ) then
    raise exception using errcode = '23514', message = 'PRODUCT_SUPPLY_TYPE_INVALID';
  end if;
  product_ids := array(select distinct given.id from pg_catalog.unnest(p_product_ids) as given (id));

  -- public.can_edit_catalogue_record answers by tenant and author: asked once per author, not once per article.
  with authors as materialized (
    select distinct product.created_by
    from public.products product
    where product.id = any(product_ids)
      and product.tenant_id = active_tenant_id
      and product.supply_type_id is distinct from p_supply_type_id
  )
  select coalesce(pg_catalog.array_agg(authors.created_by) filter (where authors.created_by is not null), '{}'::uuid[]),
    coalesce(pg_catalog.bool_or(authors.created_by is null), false)
  into editable_authors, unattributed_editable
  from authors
  where public.can_edit_catalogue_record(active_tenant_id, authors.created_by);

  select coalesce(pg_catalog.array_agg(locked.id), '{}'::uuid[]) into target_ids
  from (
    select product.id
    from public.products product
    where product.id = any(product_ids)
      and product.tenant_id = active_tenant_id
      and product.supply_type_id is distinct from p_supply_type_id
      and (
        product.created_by = any(editable_authors)
        or (product.created_by is null and unattributed_editable)
      )
    order by product.id
    for update of product
  ) locked;

  -- By id, never through a join: the row policies are then evaluated on these articles only.
  update public.products product
  set supply_type_id = p_supply_type_id
  where product.id = any(target_ids);
  get diagnostics changed_count = row_count;

  return changed_count;
end;
$$;

revoke all on function public.assign_products_supply_type(uuid[], uuid) from public, anon;
grant execute on function public.assign_products_supply_type(uuid[], uuid) to authenticated;

comment on function public.assign_products_supply_type(uuid[], uuid) is
  'TI-711: an admin or an engineer of the team currently selected (CATALOGUE_IMPORT_EDITORS_ONLY) gives a supply type of that team (PRODUCT_SUPPLY_TYPE_INVALID) to up to 5 000 articles they may edit. Returns the number of articles changed.';

-- ---------------------------------------------------------------------------
-- 8. Undoing a batch, a page at a time.
-- ---------------------------------------------------------------------------
create function public.undo_catalogue_import_batch(
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

  -- Serialize undo pages and wait for any in-flight article chunk. Authorize against the locked row.
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
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'CATALOGUE_IMPORT_UNDO_INVALID';
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
      where item.import_batch_id = batch.id
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
        where item.import_batch_id = batch.id and item.id > last_id
      );
    end if;
  else
    for candidate_id in
      select product.id
      from public.products product
      where product.import_batch_id = batch.id
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
        if found and not exists (
          select 1 from public.supplier_catalog_items item
          where item.product_id = candidate_id and not (item.id = any(removable_ids))
        ) then
          delete from public.supplier_catalog_items item where item.id = any(removable_ids);
          delete from public.products product where product.id = candidate_id;
          deleted_count := deleted_count + 1;
        else
          kept_count := kept_count + 1;
        end if;
      exception
        -- Keep the draft if a constraint still protects it (for example, a validated reference price).
        -- PostgreSQL 18 reports ON DELETE RESTRICT with its own code.
        when foreign_key_violation or restrict_violation then
          kept_count := kept_count + 1;
      end;
    end loop;

    if last_id is not null then
      has_more := exists (
        select 1 from public.products product
        where product.import_batch_id = batch.id and product.id > last_id
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

revoke all on function public.undo_catalogue_import_batch(uuid, integer) from public, anon;
grant execute on function public.undo_catalogue_import_batch(uuid, integer) to authenticated;

comment on function public.undo_catalogue_import_batch(uuid, integer) is
  'TI-711: an admin of the team currently selected, or an engineer who authored the batch (CATALOGUE_IMPORT_UNDO_FORBIDDEN), examines up to p_limit (1 to 500) rows per page in id order from the batch cursor. Only unused draft articles and pending, unpriced references whose article the caller may edit are removed. The first page closes the batch to new articles. Returns {deleted, kept, done}; done stamps the batch as undone, and an undone batch returns zero counts with done true.';

-- ---------------------------------------------------------------------------
-- 9. Keep the deployed save compatible with undo physically removing pending references.
--    Based on 20261117193734. CREATE OR REPLACE preserves the existing grants.
-- ---------------------------------------------------------------------------
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

  -- Undo can delete a pending pair after the conflict check. Retry under a new snapshot if the update misses.
  for attempt in 1..3 loop
    insert into public.supplier_catalog_items as item (
      tenant_id, supplier_id, product_id, supplier_sku, product_url, is_active, created_by
    ) values (
      active_tenant_id, p_supplier_id, p_product_id, normalized_sku, normalized_url, p_is_active, actor_id
    )
    on conflict on constraint supplier_catalog_items_tenant_supplier_product_key do nothing
    returning item.* into saved;
    created := found;
    exit when created;

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
    exit when found;
  end loop;
  if saved.id is null then
    raise exception using errcode = '40001', message = 'SUPPLIER_CATALOG_ITEM_SAVE_RETRY';
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
  'TI-691: adds or changes an article''s reference (1-255 characters, trimmed) and/or http(s) address at a supplier, without a price, and returns the item id. Null keeps the stored value, blank clears it; an active item keeps one of them (SUPPLIER_CATALOG_ITEM_IDENTIFIER_REQUIRED), a withdrawn one need not. Caller: admin or engineer of the active tenant who may change the article (SUPPLIER_CATALOG_ITEM_EDITORS_ONLY, SUPPLIER_CATALOG_ITEM_PRODUCT_LOCKED); article and supplier of the active tenant (..._NOT_FOUND). p_is_active false withdraws the supplier from the article and clears the article''s exception when it names that supplier. A conflicting pair deleted during save is retried; SQLSTATE 40001 (SUPPLIER_CATALOG_ITEM_SAVE_RETRY) asks the caller to retry after repeated concurrent deletes.';

-- ---------------------------------------------------------------------------
-- 10. A deployed edit by id must report a pending reference removed by undo.
--     Based on 20260714181702. CREATE OR REPLACE preserves the existing grants.
-- ---------------------------------------------------------------------------
create or replace function public.update_supplier_catalog_item(
  p_item_id uuid,
  p_supplier_sku text,
  p_product_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  normalized_sku text := nullif(btrim(p_supplier_sku), '');
  normalized_url text := nullif(btrim(p_product_url), '');
  updated_item public.supplier_catalog_items%rowtype;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required.';
  end if;

  select item.tenant_id into target_tenant_id
  from public.supplier_catalog_items item
  where item.id = p_item_id;

  if target_tenant_id is null then
    raise no_data_found using message = 'Supplier catalogue item not found.';
  end if;

  if not public.has_tenant_role(
    target_tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  ) then
    raise insufficient_privilege using message = 'Admin or engineer role required.';
  end if;

  if normalized_url is not null and normalized_url !~* '^https?://[^[:space:]]+$' then
    raise invalid_parameter_value using message = 'Product URL must use HTTP or HTTPS.';
  end if;

  update public.supplier_catalog_items item
  set supplier_sku = normalized_sku, product_url = normalized_url
  where item.id = p_item_id
  returning item.* into updated_item;
  if not found then
    raise no_data_found using message = 'Supplier catalogue item not found.';
  end if;

  return to_jsonb(updated_item);
end;
$$;

commit;
