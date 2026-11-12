-- TI-690: the duplicate-reference check of public.assign_product_internal_reference() read the company's
-- whole catalogue for every inserted article (lower(btrim(p.reference)) cannot use an index). Importing the
-- costing workbook (~2,600 articles in statements of 500 rows) took about 4 s per statement locally and grew
-- with the catalogue, close to the 8 s statement ceiling once the company holds a few thousand articles.
--
-- The check now reads products.reference_normalized, the generated column nullif(lower(btrim(reference)), '')
-- that the unique index products_tenant_reference_normalized_key (tenant_id, reference_normalized) covers:
-- the same comparison (a non-empty reference, case and outer spaces aside), through the index. Everything
-- else is copied unchanged from 20261002155954_product_internal_reference_auto.sql, including the advisory
-- lock, the ART- numbering of an empty reference and the PRODUCT_REFERENCE_CONFLICT error.
-- No remote application is authorized here.

begin;

create or replace function public.assign_product_internal_reference()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_number bigint;
  number_text text;
begin
  -- This trigger runs after set_products_tenant_id. RLS still governs the write.
  if new.tenant_id is null then
    raise insufficient_privilege using message = 'Tenant required.';
  end if;
  if auth.uid() is not null and (
    new.tenant_id is distinct from public.current_tenant_id()
    or not public.is_tenant_member(new.tenant_id)
  ) then
    raise insufficient_privilege using message = 'Tenant access denied.';
  end if;

  if tg_op = 'UPDATE' then
    -- A form submitting an empty reference must not renumber an existing item.
    if nullif(btrim(new.reference), '') is null then
      new.reference := old.reference;
    end if;
    if new.reference is not distinct from old.reference
      and new.tenant_id is not distinct from old.tenant_id then
      return new;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('product-internal-reference:' || new.tenant_id::text, 0)
  );
  if tg_op = 'INSERT' and nullif(btrim(new.reference), '') is null then
    select coalesce(max(substring(btrim(p.reference) from '(?i)^ART-([0-9]{6,12})$')::bigint), 0) + 1
      into next_number from public.products p where p.tenant_id = new.tenant_id;
    number_text := next_number::text;
    new.reference := 'ART-' || lpad(number_text, greatest(6, length(number_text)), '0');
  end if;

  if nullif(btrim(new.reference), '') is not null and exists (
    select 1 from public.products p
    where p.tenant_id = new.tenant_id and p.id is distinct from new.id
      and p.reference_normalized = lower(btrim(new.reference))
  ) then
    raise unique_violation using message = 'PRODUCT_REFERENCE_CONFLICT';
  end if;
  return new;
end;
$$;

commit;
