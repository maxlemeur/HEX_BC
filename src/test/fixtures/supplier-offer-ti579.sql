create table public.suppliers (
  id uuid primary key, tenant_id uuid not null, is_active boolean not null default true
);
create table public.supplier_catalog_items (
  id uuid primary key, tenant_id uuid not null,
  supplier_id uuid not null references public.suppliers(id),
  product_id uuid not null references public.products(id),
  supplier_sku text, product_url text, is_active boolean not null default true
);
create table public.supplier_pricebook (
  id uuid primary key, tenant_id uuid not null,
  supplier_catalog_item_id uuid not null references public.supplier_catalog_items(id),
  supplier_id uuid not null references public.suppliers(id),
  product_id uuid not null references public.products(id),
  unit text not null default 'u', min_quantity numeric not null default 1 check (min_quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  currency text not null default 'EUR', valid_from date, valid_to date,
  is_active boolean not null default true, notes text,
  transport_mode text check (transport_mode in ('included', 'excluded')),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
alter table public.supplier_catalog_items enable row level security;
alter table public.supplier_pricebook enable row level security;
create policy sci_read on public.supplier_catalog_items for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy offer_read on public.supplier_pricebook for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy offer_update on public.supplier_pricebook for update to authenticated
  using (public.has_tenant_role(tenant_id, array['admin'::public.tenant_role,'engineer'::public.tenant_role]))
  with check (public.has_tenant_role(tenant_id, array['admin'::public.tenant_role,'engineer'::public.tenant_role]));
-- Canonical 20260714181641: authenticated has SELECT only on shared metadata.
grant select on public.supplier_catalog_items to authenticated;
grant select,update on public.supplier_pricebook to authenticated;

-- Exact freight authorization boundary from 20260906145000. Definer editing
-- must not bypass the auth.uid/tenant/admin checks of this invoker trigger.
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
