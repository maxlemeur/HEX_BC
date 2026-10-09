-- TI-537 / TI-536: comparable supplier offers propose a price; only a human
-- validation changes the catalogue reference. Existing estimate costs are untouched.
begin;

alter table public.products
  add column reference_quantity numeric(12,3) check (reference_quantity > 0),
  add column reference_transport_mode text check (reference_transport_mode in ('included', 'excluded')),
  add column reference_price_validation_id uuid;

-- Unknown legacy freight conditions stay unknown, rather than inventing a basis.
alter table public.supplier_pricebook
  add column transport_mode text check (transport_mode in ('included', 'excluded'));

create table public.supplier_pricebook_history (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  product_id uuid not null, offer_id uuid not null,
  changed_at timestamptz not null default now(), changed_by uuid references auth.users(id),
  operation text not null check (operation in ('UPDATE', 'DELETE')), previous_offer jsonb not null
);
create index supplier_pricebook_history_product_idx on public.supplier_pricebook_history(tenant_id, product_id, changed_at desc);
alter table public.supplier_pricebook_history enable row level security;
revoke all on public.supplier_pricebook_history from public, anon, authenticated;
grant select on public.supplier_pricebook_history to authenticated;
create policy "Active tenant members can read supplier price history"
  on public.supplier_pricebook_history for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_tenant_member(tenant_id)));
create function public.archive_supplier_pricebook_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    insert into public.supplier_pricebook_history(tenant_id, product_id, offer_id, changed_by, operation, previous_offer)
    values (old.tenant_id, old.product_id, old.id, auth.uid(), tg_op, to_jsonb(old));
  end if;
  return null;
end;
$$;
revoke all on function public.archive_supplier_pricebook_version() from public, anon, authenticated;
create trigger archive_supplier_pricebook_version after update or delete on public.supplier_pricebook
  for each row execute function public.archive_supplier_pricebook_version();

create function public.protect_supplier_price_transport() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.transport_mode is not null)
    or (tg_op = 'UPDATE' and new.transport_mode is distinct from old.transport_mode) then
    if auth.uid() is null or new.tenant_id is distinct from public.current_tenant_id()
      or not public.has_tenant_role(new.tenant_id, array['admin'::public.tenant_role]) then
      raise insufficient_privilege using message = 'Admin role required to set freight conditions.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_supplier_price_transport() from public, anon, authenticated;
create trigger protect_supplier_price_transport before insert or update on public.supplier_pricebook
  for each row execute function public.protect_supplier_price_transport();

create table public.product_reference_price_validations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id),
  previous_validation_id uuid references public.product_reference_price_validations(id),
  validated_by uuid not null references auth.users(id),
  validated_at timestamptz not null default now(),
  mode text not null check (mode in ('average', 'manual')),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity numeric(12,3) not null check (quantity > 0),
  unit text not null,
  currency text not null check (currency = 'EUR'),
  transport_mode text not null check (transport_mode in ('included', 'excluded')),
  justification text,
  proposal jsonb not null,
  check (mode <> 'manual' or nullif(btrim(justification), '') is not null)
);
create index product_reference_price_validations_product_idx
  on public.product_reference_price_validations(tenant_id, product_id, validated_at desc);
alter table public.products add constraint products_reference_price_validation_fkey
  foreign key (reference_price_validation_id) references public.product_reference_price_validations(id);
alter table public.product_reference_price_validations enable row level security;
revoke all on public.product_reference_price_validations from public, anon, authenticated;
grant select on public.product_reference_price_validations to authenticated;
create policy "Active tenant members can read price validations"
  on public.product_reference_price_validations for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_tenant_member(tenant_id)));

-- Latest *eligible* quote per supplier. Every exclusion remains inspectable.
create function public.product_reference_price_proposal(
  p_product_id uuid,
  p_quantity numeric default null,
  p_transport_mode text default null
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  product public.products%rowtype;
  quantity_value numeric;
  transport_value text;
  offers jsonb;
  result jsonb;
  offer_count integer;
  average_cents integer;
  minimum_cents integer;
  maximum_cents integer;
  zero_price_requires_review boolean;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Authentication required.'; end if;
  select * into product from public.products p
  where p.id = p_product_id and p.tenant_id = public.current_tenant_id();
  if not found then raise no_data_found using message = 'PRODUCT_NOT_FOUND'; end if;
  quantity_value := coalesce(p_quantity, product.reference_quantity);
  transport_value := coalesce(p_transport_mode, product.reference_transport_mode);
  if quantity_value is not null and (quantity_value <= 0 or quantity_value > 999999999.999 or quantity_value <> round(quantity_value, 3)) then
    raise invalid_parameter_value using message = 'Invalid reference quantity.';
  end if;
  if transport_value is not null and transport_value not in ('included', 'excluded') then
    raise invalid_parameter_value using message = 'Invalid freight basis.';
  end if;

  with classified as (
    select sp.id, sp.supplier_id, s.name as supplier_name,
      coalesce(nullif(btrim(sp.supplier_sku), ''), nullif(btrim(sci.supplier_sku), '')) as supplier_sku,
      sp.unit_price_cents, sp.unit, sp.currency, sp.min_quantity,
      sp.valid_from, sp.valid_to, sp.updated_at, sp.transport_mode,
      sp.source_import_id, sp.source_mapped_row_id, sp.notes,
      case
        when not sp.is_active or not s.is_active or sci.is_active = false then 'inactive'
        when coalesce(nullif(btrim(sp.supplier_sku), ''), nullif(btrim(sci.supplier_sku), '')) is null then 'missing_supplier_reference'
        when sp.valid_from > current_date then 'future'
        when sp.valid_to < current_date or current_date >= (sp.valid_from + interval '6 months')::date then 'expired'
        when quantity_value is null then 'missing_quantity'
        when sp.min_quantity > quantity_value then 'quantity'
        when lower(btrim(sp.unit)) <> lower(btrim(product.unit)) then 'unit'
        when upper(sp.currency) <> 'EUR' then 'currency'
        when transport_value is null or sp.transport_mode is null then 'missing_transport'
        when sp.transport_mode <> transport_value then 'transport'
        when sp.unit_price_cents = 0 then 'zero_price'
        else null
      end as exclusion
    from public.supplier_pricebook sp
    join public.suppliers s on s.id = sp.supplier_id and s.tenant_id = sp.tenant_id
    left join public.supplier_catalog_items sci on sci.id = sp.supplier_catalog_item_id
      and sci.tenant_id = sp.tenant_id and sci.product_id = sp.product_id and sci.supplier_id = sp.supplier_id
    where sp.product_id = product.id and sp.tenant_id = product.tenant_id
  ), ranked as (
    select c.*, row_number() over (
      partition by supplier_id, (exclusion is null)
      order by valid_from desc, updated_at desc, min_quantity desc, id desc
    ) as rank
    from classified c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'supplier_id', supplier_id, 'supplier_name', supplier_name,
    'supplier_sku', supplier_sku, 'unit_price_cents', unit_price_cents,
    'unit', unit, 'currency', currency, 'min_quantity', min_quantity,
    'valid_from', valid_from, 'valid_to', valid_to, 'updated_at', updated_at,
    'transport_mode', transport_mode, 'source_import_id', source_import_id,
    'source_mapped_row_id', source_mapped_row_id, 'notes', notes,
    'exclusion', coalesce(exclusion, case when rank > 1 then 'older_supplier_offer' end)
  ) order by supplier_name, valid_from desc, id), '[]'::jsonb) into offers from ranked;

  select count(*)::integer, round(avg((o->>'unit_price_cents')::numeric))::integer,
    min((o->>'unit_price_cents')::integer), max((o->>'unit_price_cents')::integer)
  into offer_count, average_cents, minimum_cents, maximum_cents
  from jsonb_array_elements(offers) o where o->>'exclusion' is null;
  -- TI-537 leaves zero-valued supplier offers undecided. Fail closed until they
  -- are reviewed; never silently treat zero as a missing value or divide by it.
  select exists(select 1 from jsonb_array_elements(offers) o where o->>'exclusion' = 'zero_price')
    into zero_price_requires_review;
  if zero_price_requires_review then average_cents := null; end if;

  result := jsonb_build_object(
    'product_id', product.id, 'designation', product.designation,
    'quantity', quantity_value, 'unit', product.unit, 'currency', 'EUR',
    'transport_mode', transport_value, 'as_of', current_date,
    'current_price_cents', case when product.reference_price_validation_id is not null then product.unit_price_cents else nullif(product.unit_price_cents, 0) end,
    'validation_id', product.reference_price_validation_id,
    'product_updated_at', product.updated_at,
    'offer_count', offer_count, 'proposed_price_cents', average_cents,
    'zero_price_requires_review', zero_price_requires_review,
    'minimum_cents', minimum_cents, 'maximum_cents', maximum_cents,
    'dispersion_percent', case when minimum_cents > 0 then
      (maximum_cents::numeric - minimum_cents) * 100 / minimum_cents end,
    'dispersion_alert', coalesce((maximum_cents::numeric - minimum_cents) * 100 > minimum_cents::numeric * 15, false),
    'offers', offers
  );
  return result || jsonb_build_object('fingerprint', md5(result::text));
end;
$$;
revoke all on function public.product_reference_price_proposal(uuid, numeric, text) from public, anon;
grant execute on function public.product_reference_price_proposal(uuid, numeric, text) to authenticated;

-- Serialise supplier changes and a human validation on the same product.
-- This closes the gap between inspecting offers and recording the decision.
create function public.lock_supplier_reference_product() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform 1 from public.products where id = new.product_id and tenant_id = new.tenant_id for update;
    return new;
  elsif tg_op = 'DELETE' then
    perform 1 from public.products where id = old.product_id and tenant_id = old.tenant_id for update;
    return old;
  end if;
  perform 1 from public.products
    where (id = old.product_id and tenant_id = old.tenant_id)
       or (id = new.product_id and tenant_id = new.tenant_id)
    order by id for update;
  return new;
end;
$$;
revoke all on function public.lock_supplier_reference_product() from public, anon, authenticated;
create trigger lock_supplier_reference_product
  before insert or update or delete on public.supplier_pricebook
  for each row execute function public.lock_supplier_reference_product();

-- The same internal lock is needed for reference/active-state changes to the
-- supplier article, and for supplier activation. No data or extra DML rights are exposed.
create trigger lock_supplier_catalog_reference_product
  before update or delete on public.supplier_catalog_items
  for each row execute function public.lock_supplier_reference_product();
create function public.lock_supplier_reference_products() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.products p
    where p.tenant_id = old.tenant_id and p.id in (
      select sp.product_id from public.supplier_pricebook sp
      where sp.supplier_id = old.id and sp.tenant_id = old.tenant_id
    ) order by p.id for update;
  return new;
end;
$$;
revoke all on function public.lock_supplier_reference_products() from public, anon, authenticated;
create trigger lock_supplier_reference_products before update of is_active, name on public.suppliers
  for each row execute function public.lock_supplier_reference_products();

-- A direct catalogue/import write must not silently overwrite a reference.
create function public.protect_product_reference_price() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.reference_price_validation_id is not null then
      raise exception 'REFERENCE_PRICE_VALIDATION_REQUIRED' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.unit_price_cents is not distinct from old.unit_price_cents
    and new.reference_price_validation_id is not distinct from old.reference_price_validation_id
    and new.reference_quantity is not distinct from old.reference_quantity
    and new.reference_transport_mode is not distinct from old.reference_transport_mode
    and (old.reference_price_validation_id is null or new.unit is not distinct from old.unit) then return new; end if;
  if new.reference_price_validation_id is null
    or new.reference_price_validation_id is not distinct from old.reference_price_validation_id
    or not exists (
      select 1 from public.product_reference_price_validations v
      where v.id = new.reference_price_validation_id and v.product_id = new.id and v.tenant_id = new.tenant_id
        and v.unit_price_cents = new.unit_price_cents and v.quantity = new.reference_quantity
        and v.unit = new.unit
        and v.transport_mode = new.reference_transport_mode
        and v.previous_validation_id is not distinct from old.reference_price_validation_id
        and v.validated_by = auth.uid() and v.validated_at = transaction_timestamp()
    ) then raise exception 'REFERENCE_PRICE_VALIDATION_REQUIRED' using errcode = 'P0001'; end if;
  return new;
end;
$$;
revoke all on function public.protect_product_reference_price() from public, anon, authenticated;
create trigger protect_product_reference_price before insert or update on public.products
  for each row execute function public.protect_product_reference_price();

create function public.validate_product_reference_price(
  p_product_id uuid, p_quantity numeric, p_transport_mode text,
  p_fingerprint text, p_manual_price_cents integer default null,
  p_justification text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  tenant_id_value uuid := public.current_tenant_id();
  actor_id uuid := auth.uid();
  product public.products%rowtype;
  proposal_value jsonb;
  validation_id_value uuid;
  price_value integer;
begin
  if actor_id is null or tenant_id_value is null or not public.has_tenant_role(
    tenant_id_value, array['admin'::public.tenant_role]
  ) then raise insufficient_privilege using message = 'Admin role required.'; end if;
  select * into product from public.products p
    where p.id = p_product_id and p.tenant_id = tenant_id_value for update;
  if not found then raise no_data_found using message = 'PRODUCT_NOT_FOUND'; end if;
  proposal_value := public.product_reference_price_proposal(p_product_id, p_quantity, p_transport_mode);
  if p_fingerprint is distinct from proposal_value->>'fingerprint' then
    raise exception 'REFERENCE_PRICE_PROPOSAL_CHANGED' using errcode = 'P0001';
  end if;
  if proposal_value->>'quantity' is null or proposal_value->>'transport_mode' is null then
    raise invalid_parameter_value using message = 'Reference quantity and freight basis are required.';
  end if;
  if p_manual_price_cents is not null and (p_manual_price_cents < 0 or nullif(btrim(p_justification), '') is null) then
    raise invalid_parameter_value using message = 'A manual price requires a justification.';
  end if;
  price_value := coalesce(p_manual_price_cents, (proposal_value->>'proposed_price_cents')::integer);
  if price_value is null then raise invalid_parameter_value using message = 'No comparable offer.'; end if;
  insert into public.product_reference_price_validations (
    tenant_id, product_id, previous_validation_id, validated_by, mode,
    unit_price_cents, quantity, unit, currency, transport_mode, justification, proposal
  ) values (
    tenant_id_value, product.id, product.reference_price_validation_id, actor_id,
    case when p_manual_price_cents is null then 'average' else 'manual' end,
    price_value, (proposal_value->>'quantity')::numeric, product.unit, 'EUR',
    proposal_value->>'transport_mode', nullif(btrim(p_justification), ''), proposal_value
  ) returning id into validation_id_value;
  update public.products set unit_price_cents = price_value,
    reference_quantity = (proposal_value->>'quantity')::numeric,
    reference_transport_mode = proposal_value->>'transport_mode',
    reference_price_validation_id = validation_id_value,
    reference_price_source_order_id = null, reference_price_source_item_id = null,
    reference_price_source_date = null
  where id = product.id and tenant_id = tenant_id_value;
  return jsonb_build_object('validation_id', validation_id_value, 'unit_price_cents', price_value);
end;
$$;
revoke all on function public.validate_product_reference_price(uuid, numeric, text, text, integer, text) from public, anon;
grant execute on function public.validate_product_reference_price(uuid, numeric, text, text, integer, text) to authenticated;

-- Confirmed purchases remain history; they no longer rewrite a human reference.
drop trigger if exists refresh_reference_prices_after_order_insert on public.purchase_orders;
drop trigger if exists refresh_reference_prices_after_order_update on public.purchase_orders;
drop trigger if exists refresh_reference_prices_after_order_item_insert on public.purchase_order_items;
drop trigger if exists refresh_reference_prices_after_order_item_update on public.purchase_order_items;
drop trigger if exists refresh_reference_prices_after_order_item_delete on public.purchase_order_items;
revoke all on function public.refresh_product_reference_prices(uuid, uuid[]) from public, anon, authenticated;
drop trigger if exists track_manual_product_reference_price on public.products;

-- Expose the validated basis in the existing catalogue page, keeping pagination and sorting.
drop function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer);
create function public.catalogue_products_page(
  p_q text default null,
  p_materials text[] default '{}'::text[],
  p_categories text[] default '{}'::text[],
  p_units text[] default '{}'::text[],
  p_price_statuses text[] default '{}'::text[],
  p_statuses text[] default '{}'::text[],
  p_sort text default 'designation',
  p_dir text default 'asc',
  p_page integer default 1,
  p_size integer default 25
)
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  reference text,
  designation text,
  unit_price_cents integer,
  is_active boolean,
  category text,
  product_type text,
  material text,
  grade text,
  dimensions text,
  standard text,
  unit text,
  reference_quantity numeric,
  reference_transport_mode text,
  reference_price_validation_id uuid,
  reference_price_source_order_id uuid,
  reference_price_source_order_reference text,
  reference_price_source_supplier_name text,
  reference_price_source_date date,
  supplier_price_count bigint,
  best_supplier_price_cents integer,
  best_supplier_name text,
  best_supplier_price_updated_at timestamptz,
  price_status text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with enriched as (
    select
      product.id,
      product.created_at,
      product.updated_at,
      product.reference,
      product.designation,
      product.unit_price_cents,
      product.is_active,
      product.category,
      product.product_type,
      product.material,
      product.grade,
      product.dimensions,
      product.standard,
      product.unit,
      product.reference_quantity,
      product.reference_transport_mode,
      product.reference_price_validation_id,
      product.reference_price_source_order_id,
      reference_order.reference as reference_price_source_order_reference,
      reference_supplier.name as reference_price_source_supplier_name,
      product.reference_price_source_date,
      coalesce(best_price.price_count, 0)::bigint as supplier_price_count,
      best_price.unit_price_cents as best_supplier_price_cents,
      best_price.supplier_name as best_supplier_name,
      best_price.price_updated_at as best_supplier_price_updated_at,
      case
        when best_price.id is null then 'none'
        when current_date - best_price.price_updated_at::date <= 30 then 'fresh'
        when current_date - best_price.price_updated_at::date <= 90 then 'aging'
        else 'stale'
      end as price_status
    from public.products product
    left join public.purchase_orders reference_order
      on reference_order.id = product.reference_price_source_order_id
      and reference_order.tenant_id = product.tenant_id
    left join public.suppliers reference_supplier
      on reference_supplier.id = reference_order.supplier_id
      and reference_supplier.tenant_id = product.tenant_id
    left join lateral (
      select
        supplier_price.id,
        supplier_price.unit_price_cents,
        supplier.name as supplier_name,
        coalesce(supplier_price.updated_at, supplier_price.created_at) as price_updated_at,
        count(*) over ()::bigint as price_count
      from public.supplier_pricebook supplier_price
      join public.suppliers supplier on supplier.id = supplier_price.supplier_id
      where supplier_price.product_id = product.id
        and supplier_price.is_active
        and supplier_price.valid_from <= current_date
        and (supplier_price.valid_to is null or supplier_price.valid_to >= current_date)
      order by supplier_price.unit_price_cents asc, supplier_price.updated_at desc, supplier_price.id asc
      limit 1
    ) best_price on true
  ),
  filtered as (
    select enriched.*
    from enriched
    where (
      nullif(btrim(p_q), '') is null
      or public.catalogue_normalize_search(
        coalesce(enriched.reference, '') || ' ' ||
        coalesce(enriched.designation, '') || ' ' ||
        coalesce(enriched.category, '') || ' ' ||
        coalesce(enriched.product_type, '') || ' ' ||
        coalesce(enriched.material, '') || ' ' ||
        coalesce(enriched.grade, '') || ' ' ||
        coalesce(enriched.dimensions, '') || ' ' ||
        coalesce(enriched.standard, '')
      ) like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
    )
      and (cardinality(p_materials) = 0 or coalesce(enriched.material, '') = any(p_materials))
      and (cardinality(p_categories) = 0 or coalesce(enriched.category, '') = any(p_categories))
      and (cardinality(p_units) = 0 or coalesce(enriched.unit, '') = any(p_units))
      and (cardinality(p_price_statuses) = 0 or enriched.price_status = any(p_price_statuses))
      and (
        cardinality(p_statuses) = 0
        or (enriched.is_active and 'active' = any(p_statuses))
        or (not enriched.is_active and 'archived' = any(p_statuses))
      )
  )
  select
    filtered.id,
    filtered.created_at,
    filtered.updated_at,
    filtered.reference,
    filtered.designation,
    filtered.unit_price_cents,
    filtered.is_active,
    filtered.category,
    filtered.product_type,
    filtered.material,
    filtered.grade,
    filtered.dimensions,
    filtered.standard,
    filtered.unit,
    filtered.reference_quantity,
    filtered.reference_transport_mode,
    filtered.reference_price_validation_id,
    filtered.reference_price_source_order_id,
    filtered.reference_price_source_order_reference,
    filtered.reference_price_source_supplier_name,
    filtered.reference_price_source_date,
    filtered.supplier_price_count,
    filtered.best_supplier_price_cents,
    filtered.best_supplier_name,
    filtered.best_supplier_price_updated_at,
    filtered.price_status,
    count(*) over ()::bigint as total_count
  from filtered
  order by
    case when p_sort = 'designation' and p_dir = 'asc' then lower(filtered.designation) end asc,
    case when p_sort = 'designation' and p_dir = 'desc' then lower(filtered.designation) end desc,
    case when p_sort = 'material' and p_dir = 'asc' then lower(filtered.material) end asc nulls last,
    case when p_sort = 'material' and p_dir = 'desc' then lower(filtered.material) end desc nulls last,
    case when p_sort = 'unit_price_cents' and p_dir = 'asc' then filtered.unit_price_cents end asc,
    case when p_sort = 'unit_price_cents' and p_dir = 'desc' then filtered.unit_price_cents end desc,
    case when p_sort = 'best_supplier_price_cents' and p_dir = 'asc' then filtered.best_supplier_price_cents end asc nulls last,
    case when p_sort = 'best_supplier_price_cents' and p_dir = 'desc' then filtered.best_supplier_price_cents end desc nulls last,
    case when p_sort = 'updated_at' and p_dir = 'asc' then filtered.updated_at end asc,
    case when p_sort = 'updated_at' and p_dir = 'desc' then filtered.updated_at end desc,
    filtered.id asc
  offset (greatest(p_page, 1) - 1) * least(greatest(p_size, 1), 100)
  limit least(greatest(p_size, 1), 100);
$$;

revoke execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer) from public, anon;

grant execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer) to authenticated;

commit;
