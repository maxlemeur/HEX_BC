-- Separate the shared product definition from supplier-specific catalogue
-- metadata and the time-varying supplier prices.

create table public.supplier_catalog_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  supplier_sku text check (supplier_sku is null or char_length(supplier_sku) <= 255),
  product_url text check (
    product_url is null
    or (
      char_length(product_url) <= 2000
      and product_url ~* '^https?://[^[:space:]]+$'
    )
  ),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  constraint supplier_catalog_items_tenant_supplier_product_key
    unique (tenant_id, supplier_id, product_id)
);

create trigger set_supplier_catalog_items_updated_at
  before update on public.supplier_catalog_items
  for each row execute procedure public.set_updated_at();

create index supplier_catalog_items_tenant_product_idx
  on public.supplier_catalog_items (tenant_id, product_id, supplier_id);

create index supplier_catalog_items_tenant_supplier_idx
  on public.supplier_catalog_items (tenant_id, supplier_id, product_id);

create index supplier_catalog_items_sku_search_trgm_idx
  on public.supplier_catalog_items using gin (
    public.catalogue_normalize_search(coalesce(supplier_sku, '')) extensions.gin_trgm_ops
  );

alter table public.supplier_catalog_items enable row level security;

revoke all on table public.supplier_catalog_items from anon, authenticated;
grant select on table public.supplier_catalog_items to authenticated;
grant select, insert, update, delete on table public.supplier_catalog_items to service_role;

create policy "Tenant members can view supplier catalogue items"
  on public.supplier_catalog_items
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

-- Fail before backfill if legacy data violates tenant ownership. The foreign
-- keys are not composite, so this check must be explicit.
do $$
begin
  if exists (
    select 1
    from public.supplier_pricebook sp
    join public.suppliers s on s.id = sp.supplier_id
    join public.products p on p.id = sp.product_id
    where sp.tenant_id is distinct from s.tenant_id
      or sp.tenant_id is distinct from p.tenant_id
  ) then
    raise check_violation using
      message = 'Supplier price tenant mismatch blocks supplier catalogue backfill.';
  end if;
end;
$$;

-- Choose one current supplier reference and URL for every existing
-- supplier/product pair. Historical supplier_sku values remain on the price
-- rows and are deliberately not rewritten.
with ranked_prices as (
  select
    sp.*,
    (
      sp.is_active
      and sp.valid_from <= current_date
      and (sp.valid_to is null or sp.valid_to >= current_date)
    ) as is_current,
    row_number() over (
      partition by sp.tenant_id, sp.supplier_id, sp.product_id
      order by
        (
          sp.is_active
          and sp.valid_from <= current_date
          and (sp.valid_to is null or sp.valid_to >= current_date)
        ) desc,
        sp.is_active desc,
        sp.valid_from desc,
        coalesce(sp.updated_at, sp.created_at) desc,
        sp.id desc
    ) as pair_rank
  from public.supplier_pricebook sp
),
pair_heads as (
  select * from ranked_prices where pair_rank = 1
)
insert into public.supplier_catalog_items (
  tenant_id,
  supplier_id,
  product_id,
  supplier_sku,
  product_url,
  is_active,
  created_by
)
select
  head.tenant_id,
  head.supplier_id,
  head.product_id,
  sku.supplier_sku,
  source.product_url,
  head.is_active,
  head.created_by
from pair_heads head
left join lateral (
  select left(nullif(btrim(candidate.supplier_sku), ''), 255) as supplier_sku
  from ranked_prices candidate
  where candidate.tenant_id = head.tenant_id
    and candidate.supplier_id = head.supplier_id
    and candidate.product_id = head.product_id
    and nullif(btrim(candidate.supplier_sku), '') is not null
  order by
    candidate.is_current desc,
    candidate.is_active desc,
    candidate.valid_from desc,
    coalesce(candidate.updated_at, candidate.created_at) desc,
    candidate.id desc
  limit 1
) sku on true
left join lateral (
  select extracted.product_url
  from ranked_prices candidate
  cross join lateral (
    select substring(
      candidate.notes
      from '^[Ss][Oo][Uu][Rr][Cc][Ee]:[[:space:]]*(https?://[^[:space:]\r\n]+)'
    ) as product_url
  ) extracted
  where candidate.tenant_id = head.tenant_id
    and candidate.supplier_id = head.supplier_id
    and candidate.product_id = head.product_id
    and extracted.product_url is not null
    and char_length(extracted.product_url) <= 2000
  order by
    candidate.is_current desc,
    candidate.is_active desc,
    candidate.valid_from desc,
    coalesce(candidate.updated_at, candidate.created_at) desc,
    candidate.id desc
  limit 1
) source on true;

alter table public.supplier_pricebook
  add column supplier_catalog_item_id uuid
  references public.supplier_catalog_items(id) on delete restrict;

update public.supplier_pricebook sp
set supplier_catalog_item_id = item.id
from public.supplier_catalog_items item
where item.tenant_id = sp.tenant_id
  and item.supplier_id = sp.supplier_id
  and item.product_id = sp.product_id
  and sp.supplier_catalog_item_id is null;

alter table public.supplier_pricebook
  alter column supplier_catalog_item_id set not null;

create index supplier_pricebook_catalog_item_valid_idx
  on public.supplier_pricebook (
    tenant_id,
    supplier_catalog_item_id,
    valid_from desc,
    updated_at desc
  );

drop index if exists public.supplier_pricebook_unique_window_idx;
create unique index supplier_pricebook_unique_window_idx
  on public.supplier_pricebook (
    tenant_id,
    supplier_catalog_item_id,
    currency,
    valid_from,
    min_quantity
  );

create or replace function public.set_supplier_catalog_item_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  supplier_tenant_id uuid;
  product_tenant_id uuid;
begin
  select s.tenant_id into supplier_tenant_id
  from public.suppliers s where s.id = new.supplier_id;

  select p.tenant_id into product_tenant_id
  from public.products p where p.id = new.product_id;

  if supplier_tenant_id is null or product_tenant_id is null then
    raise foreign_key_violation using message = 'Supplier or product not found.';
  end if;

  if supplier_tenant_id is distinct from product_tenant_id then
    raise check_violation using message = 'Supplier and product must belong to the same tenant.';
  end if;

  if new.tenant_id is not null and new.tenant_id is distinct from supplier_tenant_id then
    raise check_violation using message = 'Supplier catalogue item tenant mismatch.';
  end if;

  new.tenant_id := supplier_tenant_id;
  new.supplier_sku := nullif(btrim(new.supplier_sku), '');
  new.product_url := nullif(btrim(new.product_url), '');
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  return new;
end;
$$;

create trigger set_supplier_catalog_items_scope
  before insert or update on public.supplier_catalog_items
  for each row execute procedure public.set_supplier_catalog_item_scope();

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

create trigger sync_supplier_price_catalog_item
  before insert or update on public.supplier_pricebook
  for each row execute procedure public.sync_supplier_price_catalog_item();

-- Keep bulk imports compatible while creating/reusing the unique supplier
-- catalogue item and rejecting contradictory supplier metadata.
create or replace function public.bulk_create_supplier_prices(
  price_rows jsonb,
  target_tenant_id uuid default public.current_tenant_id()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  item jsonb;
  supplier_id_value uuid;
  product_id_value uuid;
  supplier_sku_value text;
  product_url_value text;
  catalog_item public.supplier_catalog_items%rowtype;
  inserted_count integer := 0;
  current_insert_count integer := 0;
begin
  if actor_id is null or target_tenant_id is null then
    raise insufficient_privilege using message = 'Authentication required.';
  end if;

  if not public.has_tenant_role(
    target_tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  ) then
    raise insufficient_privilege using message = 'Admin or engineer role required.';
  end if;

  if coalesce(jsonb_typeof(price_rows), '') <> 'array' then
    raise invalid_parameter_value using message = 'price_rows must be a JSON array.';
  end if;

  for item in select value from jsonb_array_elements(price_rows)
  loop
    supplier_id_value := (item->>'supplier_id')::uuid;
    product_id_value := (item->>'product_id')::uuid;
    supplier_sku_value := nullif(btrim(item->>'supplier_sku'), '');
    product_url_value := nullif(btrim(item->>'product_url'), '');

    if not exists (
      select 1 from public.suppliers s
      where s.id = supplier_id_value and s.tenant_id = target_tenant_id
    ) or not exists (
      select 1 from public.products p
      where p.id = product_id_value and p.tenant_id = target_tenant_id
    ) then
      raise invalid_parameter_value using message = 'Supplier or product not found in active tenant.';
    end if;

    if nullif(item->>'source_import_id', '') is not null
      and not exists (
        select 1
        from public.dpgf_imports source_import
        where source_import.id = (item->>'source_import_id')::uuid
          and source_import.tenant_id = target_tenant_id
      ) then
      raise invalid_parameter_value using
        message = 'Source import not found in active tenant.';
    end if;

    if nullif(item->>'source_mapped_row_id', '') is not null
      and not exists (
        select 1
        from public.dpgf_rows_mapped mapped_row
        where mapped_row.id = (item->>'source_mapped_row_id')::uuid
          and mapped_row.tenant_id = target_tenant_id
          and (
            nullif(item->>'source_import_id', '') is null
            or mapped_row.import_id = (item->>'source_import_id')::uuid
          )
      ) then
      raise invalid_parameter_value using
        message = 'Source mapped row not found in active tenant or import.';
    end if;

    if product_url_value is not null and product_url_value !~* '^https?://[^[:space:]]+$' then
      raise invalid_parameter_value using message = 'Product URL must use HTTP or HTTPS.';
    end if;

    insert into public.supplier_catalog_items (
      tenant_id, supplier_id, product_id, supplier_sku, product_url, is_active, created_by
    ) values (
      target_tenant_id, supplier_id_value, product_id_value,
      supplier_sku_value, product_url_value, true, actor_id
    )
    on conflict (tenant_id, supplier_id, product_id)
    do update set is_active = true;

    select existing_item.* into catalog_item
    from public.supplier_catalog_items existing_item
    where existing_item.tenant_id = target_tenant_id
      and existing_item.supplier_id = supplier_id_value
      and existing_item.product_id = product_id_value
    for update;

    if catalog_item.supplier_sku is not null
      and supplier_sku_value is not null
      and lower(catalog_item.supplier_sku) is distinct from lower(supplier_sku_value) then
      raise exception 'SUPPLIER_CATALOG_REFERENCE_CONFLICT' using errcode = 'P0001';
    end if;

    if catalog_item.product_url is not null
      and product_url_value is not null
      and catalog_item.product_url is distinct from product_url_value then
      raise exception 'SUPPLIER_CATALOG_URL_CONFLICT' using errcode = 'P0001';
    end if;

    update public.supplier_catalog_items existing_item
    set
      supplier_sku = coalesce(existing_item.supplier_sku, supplier_sku_value),
      product_url = coalesce(existing_item.product_url, product_url_value),
      is_active = true
    where existing_item.id = catalog_item.id
    returning existing_item.* into catalog_item;

    insert into public.supplier_pricebook (
      tenant_id, supplier_catalog_item_id, supplier_id, product_id, supplier_sku,
      unit, min_quantity, unit_price_cents, currency, valid_from, valid_to,
      is_active, source_import_id, source_mapped_row_id, created_by, notes
    ) values (
      target_tenant_id,
      catalog_item.id,
      supplier_id_value,
      product_id_value,
      catalog_item.supplier_sku,
      coalesce(nullif(item->>'unit', ''), 'u'),
      coalesce(nullif(item->>'min_quantity', '')::numeric(12,3), 1),
      (item->>'unit_price_cents')::integer,
      upper(coalesce(nullif(item->>'currency', ''), 'EUR')),
      coalesce(nullif(item->>'valid_from', '')::date, current_date),
      nullif(item->>'valid_to', '')::date,
      coalesce(nullif(item->>'is_active', '')::boolean, true),
      nullif(item->>'source_import_id', '')::uuid,
      nullif(item->>'source_mapped_row_id', '')::uuid,
      actor_id,
      nullif(item->>'notes', '')
    )
    on conflict (
      tenant_id, supplier_catalog_item_id, currency, valid_from, min_quantity
    ) do nothing;

    get diagnostics current_insert_count = row_count;
    inserted_count := inserted_count + current_insert_count;
  end loop;

  return inserted_count;
end;
$$;

revoke execute on function public.bulk_create_supplier_prices(jsonb, uuid) from public, anon;
grant execute on function public.bulk_create_supplier_prices(jsonb, uuid) to authenticated;
