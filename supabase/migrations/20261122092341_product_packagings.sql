-- Sale packagings of a catalogue article (« conditionnements de vente »). No remote application is authorized here.
--
-- An article is sold by the bar of 6 m, the reel of 100 m, the box of 10: each packaging is a label (free text,
-- « Barre », « Touret », « Boîte »…) and a quantity expressed in the article's unit (Barre = 6 for an article in ml).
-- At most one packaging of an article is the usual one (is_usual): marking another one moves the mark. The list
-- keeps the order in which packagings were added (position, then id).
--
-- Informative only: nothing here changes a quantity, a price, an estimate, a purchase order or a material request,
-- and the purchase unit of a supplier offer (supplier_pricebook.estimate_unit_code /
-- estimate_units_per_purchase_unit, 20261017172127_supplier_offer_purchase_unit.sql) is untouched.
--
-- - The unit: a packaging carries its article's unit, copied by the trigger, and references the article through
--   (product_id, tenant_id, unit) -> products (id, tenant_id, unit), ON UPDATE RESTRICT: the unit of an article
--   that has packagings cannot change (« 6 ml » never silently reads « 6 u »); its packagings are removed first.
--   An article without a unit (a draft with a blank unit) gets none (PRODUCT_PACKAGING_UNIT_REQUIRED). Deleting
--   the article deletes its packagings.
-- - The tenant is the article's, never the client's; the author, the dates, the label key and the position are the
--   database's (precedent: public.product_aliases, 20261112101124_material_request_articles.sql). Article and tenant
--   of a packaging never change (PRODUCT_PACKAGING_SCOPE_IMMUTABLE). The author's profile going sets it to null.
-- - Read by the members of the tenant, like products (public.is_tenant_member: never a suspended tenant). Added,
--   changed and removed in the caller's active tenant only, by exactly those who may change the article: the
--   policies apply public.can_edit_catalogue_record to the article, as the products update policy does (TI-689,
--   20261112004040_catalogue_engineer_rights.sql).
-- - No two packagings of an article share a label key (spaces trimmed and collapsed, case and accents folded by
--   public.catalogue_normalize_search) and a quantity.
-- - Adding a packaging, or marking one usual, locks the article row first: positions and the usual mark are
--   decided one writer at a time, and the statement that moves the mark clears the former one, so a move that fails
--   keeps it. The partial unique index stays the backstop.
-- Regression: supabase/tests/database/product-packagings.test.sql, product-packagings-usual-race.test.sql.

begin;

do $preflight$
begin
  if to_regclass('public.products') is null
    or to_regclass('public.profiles') is null
    or to_regprocedure('public.can_edit_catalogue_record(uuid, uuid)') is null
    or to_regprocedure('public.is_tenant_member(uuid)') is null
    or to_regprocedure('public.current_tenant_id()') is null
    or to_regprocedure('public.catalogue_normalize_search(text)') is null
  then
    raise exception 'PRODUCT_PACKAGINGS_PREREQUISITE_MISSING';
  end if;
  if to_regclass('public.product_packagings') is not null then
    raise exception 'PRODUCT_PACKAGINGS_PREFLIGHT: public.product_packagings already exists';
  end if;
  if exists (select 1 from pg_constraint where conname = 'products_id_tenant_unit_key') then
    raise exception 'PRODUCT_PACKAGINGS_PREFLIGHT: products_id_tenant_unit_key already exists';
  end if;
end;
$preflight$;

-- What a packaging references: an article with its tenant and its unit. id alone is the primary key, so this key
-- holds every row as it is.
alter table public.products
  add constraint products_id_tenant_unit_key unique (id, tenant_id, unit);

create table public.product_packagings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_id uuid not null,
  -- The article's unit, copied by the trigger; the quantity is expressed in it.
  unit text not null check (char_length(btrim(unit)) > 0),
  -- « Barre », « Touret », « Couronne »… as the office writes it, spaces trimmed and collapsed by the trigger.
  label text not null check (char_length(label) between 1 and 80),
  -- What makes two labels the same: the label with case and accents folded, computed by the trigger.
  label_key text not null check (char_length(label_key) between 1 and 160),
  -- How many units of the article one packaging holds, in its unit.
  quantity numeric(14, 3) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  is_usual boolean not null default false,
  -- Order of the list: one more than the article's last, given by the trigger.
  position integer not null check (position > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_packagings_article_unit_fkey foreign key (product_id, tenant_id, unit)
    references public.products (id, tenant_id, unit) on update restrict on delete cascade
);

comment on table public.product_packagings is
  'Sale packagings of a catalogue article: a label and a quantity in the article''s unit, at most one usual. Same tenant and unit as the article (the unit of an article with packagings cannot change); informative only (no quantity, price or order reads them).';
comment on column public.product_packagings.unit is
  'The article''s unit (products.unit) when the packaging was added, copied by the trigger; the foreign key keeps it equal to the article''s.';
comment on column public.product_packagings.quantity is
  'Units of the article in one packaging, expressed in unit. Greater than zero.';
comment on column public.product_packagings.is_usual is
  'The usual packaging of the article (at most one; marking another one moves the mark).';

-- The positions of an article, also the index of its foreign key (first column).
create unique index product_packagings_product_position_key on public.product_packagings (product_id, position);
create unique index product_packagings_label_key_quantity_key on public.product_packagings (product_id, label_key, quantity);
create unique index product_packagings_one_usual_idx on public.product_packagings (product_id) where is_usual;
create index product_packagings_tenant_idx on public.product_packagings (tenant_id);
create index product_packagings_created_by_idx on public.product_packagings (created_by);

-- Runs as the caller: an article the caller cannot read is one that does not exist; the policies then decide
-- whether the caller may change that article. The article row is locked (for no key update: the caller may change
-- it, or the policies refuse the write anyway) before a position is given or the usual mark is taken.
create function private.enforce_product_packaging_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  article record;
begin
  if tg_op = 'INSERT' then
    select product.tenant_id, product.unit into article from public.products product where product.id = new.product_id;
    if not found then
      raise exception using errcode = '23514', message = 'PRODUCT_PACKAGING_PRODUCT_NOT_FOUND';
    end if;
    if pg_catalog.btrim(coalesce(article.unit, '')) = '' then
      raise exception using errcode = '23514', message = 'PRODUCT_PACKAGING_UNIT_REQUIRED';
    end if;
    perform 1 from public.products product where product.id = new.product_id for no key update;
    new.tenant_id := article.tenant_id;
    new.unit := article.unit;
    new.position := coalesce(
      (select max(other.position) from public.product_packagings other where other.product_id = new.product_id), 0) + 1;
    new.created_at := now();
    -- A signed-in member is the author; a server writer without a user (service_role, a migration) may name one.
    if (select auth.uid()) is not null then
      new.created_by := (select auth.uid());
    end if;
  else
    if new.tenant_id is distinct from old.tenant_id or new.product_id is distinct from old.product_id then
      raise exception using errcode = '23514', message = 'PRODUCT_PACKAGING_SCOPE_IMMUTABLE';
    end if;
    new.unit := old.unit;
    new.position := old.position;
    -- The author stays, except when their profile goes: the foreign key's ON DELETE SET NULL runs below the
    -- caller's statement (trigger depth 2) and clears it.
    if new.created_by is not null or pg_catalog.pg_trigger_depth() = 1 then
      new.created_by := old.created_by;
    end if;
    new.created_at := old.created_at;
    if new.is_usual and not old.is_usual then
      perform 1 from public.products product where product.id = new.product_id for no key update;
    end if;
  end if;

  new.label := pg_catalog.btrim(pg_catalog.regexp_replace(new.label, '\s+', ' ', 'g'));
  new.label_key := public.catalogue_normalize_search(new.label);
  new.updated_at := now();

  -- Marking a packaging usual takes the mark from the others of its article, in the same statement: if the write
  -- fails, the former mark stays.
  if new.is_usual and (tg_op = 'INSERT' or not old.is_usual) then
    update public.product_packagings other
    set is_usual = false
    where other.product_id = new.product_id and other.is_usual and other.id <> new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_product_packaging_write() from public, anon, authenticated;

create trigger enforce_product_packaging_write
  before insert or update on public.product_packagings
  for each row execute function private.enforce_product_packaging_write();

alter table public.product_packagings enable row level security;
alter table public.product_packagings force row level security;

revoke all on public.product_packagings from public, anon, authenticated;
grant select, insert, update, delete on public.product_packagings to authenticated;
grant select, insert, update, delete on public.product_packagings to service_role;

create policy "Tenant members read product packagings"
  on public.product_packagings for select to authenticated
  using ((select public.is_tenant_member(tenant_id)));

-- In the active tenant, the rule of the products update policy applied to the packaging's article.
create policy "Article editors add product packagings"
  on public.product_packagings for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.products product
      where product.id = product_packagings.product_id
        and product.tenant_id = product_packagings.tenant_id
        and public.can_edit_catalogue_record(product.tenant_id, product.created_by)
    )
  );

create policy "Article editors change product packagings"
  on public.product_packagings for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.products product
      where product.id = product_packagings.product_id
        and product.tenant_id = product_packagings.tenant_id
        and public.can_edit_catalogue_record(product.tenant_id, product.created_by)
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.products product
      where product.id = product_packagings.product_id
        and product.tenant_id = product_packagings.tenant_id
        and public.can_edit_catalogue_record(product.tenant_id, product.created_by)
    )
  );

create policy "Article editors remove product packagings"
  on public.product_packagings for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.products product
      where product.id = product_packagings.product_id
        and product.tenant_id = product_packagings.tenant_id
        and public.can_edit_catalogue_record(product.tenant_id, product.created_by)
    )
  );

commit;
