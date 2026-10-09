-- TI-578: references are allocated at INSERT time, under the same tenant lock
-- for manual and automatic references. Existing products are never renumbered.
create function public.suggest_product_reference()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tenant_id uuid := public.current_tenant_id();
  next_number bigint;
  number_text text;
begin
  if auth.uid() is null or target_tenant_id is null
    or not public.has_tenant_role(target_tenant_id, array['admin'::public.tenant_role]) then
    raise insufficient_privilege using message = 'Catalogue administrator required.';
  end if;
  select coalesce(max(substring(btrim(p.reference) from '(?i)^ART-([0-9]{6,12})$')::bigint), 0) + 1
    into next_number from public.products p where p.tenant_id = target_tenant_id;
  number_text := next_number::text;
  return 'ART-' || lpad(number_text, greatest(6, length(number_text)), '0');
end;
$$;

revoke all on function public.suggest_product_reference() from public, anon;
grant execute on function public.suggest_product_reference() to authenticated;

create function public.assign_product_internal_reference()
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
      and lower(btrim(p.reference)) = lower(btrim(new.reference))
  ) then
    raise unique_violation using message = 'PRODUCT_REFERENCE_CONFLICT';
  end if;
  return new;
end;
$$;

revoke all on function public.assign_product_internal_reference() from public, anon, authenticated;
create trigger zz_assign_product_internal_reference
  before insert or update of reference, tenant_id on public.products
  for each row execute function public.assign_product_internal_reference();
