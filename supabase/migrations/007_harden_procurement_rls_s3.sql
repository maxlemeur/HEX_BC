-- Migration S3: harden procurement RLS policies with least privilege.

create or replace function public.is_admin_user()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

drop policy if exists "Authenticated can access suppliers" on public.suppliers;
drop policy if exists "Authenticated can access delivery sites" on public.delivery_sites;
drop policy if exists "Authenticated can access products" on public.products;
drop policy if exists "Authenticated can access purchase orders" on public.purchase_orders;
drop policy if exists "Authenticated can access purchase order items" on public.purchase_order_items;

create policy "Authenticated can view suppliers"
  on public.suppliers
  for select
  to authenticated
  using (true);

create policy "Admins can insert suppliers"
  on public.suppliers
  for insert
  to authenticated
  with check ((select public.is_admin_user()));

create policy "Admins can update suppliers"
  on public.suppliers
  for update
  to authenticated
  using ((select public.is_admin_user()))
  with check ((select public.is_admin_user()));

create policy "Admins can delete suppliers"
  on public.suppliers
  for delete
  to authenticated
  using ((select public.is_admin_user()));

create policy "Authenticated can view delivery sites"
  on public.delivery_sites
  for select
  to authenticated
  using (true);

create policy "Admins can insert delivery sites"
  on public.delivery_sites
  for insert
  to authenticated
  with check ((select public.is_admin_user()));

create policy "Admins can update delivery sites"
  on public.delivery_sites
  for update
  to authenticated
  using ((select public.is_admin_user()))
  with check ((select public.is_admin_user()));

create policy "Admins can delete delivery sites"
  on public.delivery_sites
  for delete
  to authenticated
  using ((select public.is_admin_user()));

create policy "Authenticated can view products"
  on public.products
  for select
  to authenticated
  using (true);

create policy "Admins can insert products"
  on public.products
  for insert
  to authenticated
  with check ((select public.is_admin_user()));

create policy "Admins can update products"
  on public.products
  for update
  to authenticated
  using ((select public.is_admin_user()))
  with check ((select public.is_admin_user()));

create policy "Admins can delete products"
  on public.products
  for delete
  to authenticated
  using ((select public.is_admin_user()));

create policy "Users can view own purchase orders"
  on public.purchase_orders
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  );

create policy "Users can insert own purchase orders"
  on public.purchase_orders
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  );

create policy "Users can update own purchase orders"
  on public.purchase_orders
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  )
  with check (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  );

create policy "Users can delete own purchase orders"
  on public.purchase_orders
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  );

create policy "Users can view own purchase order items"
  on public.purchase_order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  );

create policy "Users can insert own purchase order items"
  on public.purchase_order_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  );

create policy "Users can update own purchase order items"
  on public.purchase_order_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  )
  with check (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  );

create policy "Users can delete own purchase order items"
  on public.purchase_order_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  );
