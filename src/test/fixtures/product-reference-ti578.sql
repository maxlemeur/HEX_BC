create role anon;
create role authenticated;
create schema auth;
create type public.tenant_role as enum ('admin', 'engineer', 'viewer');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as
  $$ select nullif(current_setting('test.tenant_id', true), '')::uuid $$;
create function public.is_tenant_member(target uuid) returns boolean language sql stable as
  $$ select auth.uid() is not null and target = public.current_tenant_id() $$;
create function public.has_tenant_role(target uuid, roles public.tenant_role[]) returns boolean language sql stable as
  $$ select public.is_tenant_member(target) and current_setting('test.role', true)::public.tenant_role = any(roles) $$;
create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  reference text,
  designation text not null,
  is_active boolean not null default true
);
create unique index products_tenant_reference_key on public.products(tenant_id, reference) where reference is not null;
create function public.assign_tenant_id() returns trigger language plpgsql as $$
begin
  new.tenant_id := coalesce(new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;
create trigger set_products_tenant_id before insert or update on public.products
  for each row execute function public.assign_tenant_id();
alter table public.products enable row level security;
create policy product_read on public.products for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy product_insert on public.products for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]));
create policy product_update on public.products for update to authenticated
  using (public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  with check (public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]));
grant usage on schema auth to authenticated, anon;
grant select, insert, update on public.products to authenticated;
