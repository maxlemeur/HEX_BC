-- Preserve broad tenant read access where it already exists while restricting
-- shared-library and procurement mutations to admin/chiffreur roles.

drop policy if exists "Users can manage estimate assemblies" on public.estimate_assemblies;
drop policy if exists "Users can manage estimate assembly items" on public.estimate_assembly_items;

create policy "Tenant members can view estimate assemblies"
  on public.estimate_assemblies for select to authenticated
  using ((select public.is_tenant_member(tenant_id)));
create policy "Tenant writers can insert estimate assemblies"
  on public.estimate_assemblies for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
  );
create policy "Tenant writers can update estimate assemblies"
  on public.estimate_assemblies for update to authenticated
  using ((select public.has_tenant_role(
    tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  )))
  with check ((select public.has_tenant_role(
    tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  )));
create policy "Tenant writers can delete estimate assemblies"
  on public.estimate_assemblies for delete to authenticated
  using ((select public.has_tenant_role(
    tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  )));

create policy "Tenant members can view estimate assembly items"
  on public.estimate_assembly_items for select to authenticated
  using (exists (
    select 1 from public.estimate_assemblies a
    where a.id = estimate_assembly_items.assembly_id
      and a.tenant_id = estimate_assembly_items.tenant_id
      and (select public.is_tenant_member(a.tenant_id))
  ));
create policy "Tenant writers can insert estimate assembly items"
  on public.estimate_assembly_items for insert to authenticated
  with check (exists (
    select 1 from public.estimate_assemblies a
    where a.id = estimate_assembly_items.assembly_id
      and a.tenant_id = estimate_assembly_items.tenant_id
      and (select public.has_tenant_role(
        a.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
  ));
create policy "Tenant writers can update estimate assembly items"
  on public.estimate_assembly_items for update to authenticated
  using (exists (
    select 1 from public.estimate_assemblies a
    where a.id = estimate_assembly_items.assembly_id
      and a.tenant_id = estimate_assembly_items.tenant_id
      and (select public.has_tenant_role(
        a.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
  ))
  with check (exists (
    select 1 from public.estimate_assemblies a
    where a.id = estimate_assembly_items.assembly_id
      and a.tenant_id = estimate_assembly_items.tenant_id
      and (select public.has_tenant_role(
        a.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
  ));
create policy "Tenant writers can delete estimate assembly items"
  on public.estimate_assembly_items for delete to authenticated
  using (exists (
    select 1 from public.estimate_assemblies a
    where a.id = estimate_assembly_items.assembly_id
      and a.tenant_id = estimate_assembly_items.tenant_id
      and (select public.has_tenant_role(
        a.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
  ));

drop policy if exists "Users can insert own purchase orders" on public.purchase_orders;
drop policy if exists "Users can update own purchase orders" on public.purchase_orders;
drop policy if exists "Users can delete own purchase orders" on public.purchase_orders;

create policy "Users can insert own purchase orders"
  on public.purchase_orders for insert to authenticated
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );
create policy "Users can update own purchase orders"
  on public.purchase_orders for update to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );
create policy "Users can delete own purchase orders"
  on public.purchase_orders for delete to authenticated
  using (
    (select public.has_tenant_role(
      tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

drop policy if exists "Users can insert own purchase order items" on public.purchase_order_items;
drop policy if exists "Users can update own purchase order items" on public.purchase_order_items;
drop policy if exists "Users can delete own purchase order items" on public.purchase_order_items;

create policy "Users can insert own purchase order items"
  on public.purchase_order_items for insert to authenticated
  with check (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_items.purchase_order_id
      and po.tenant_id = purchase_order_items.tenant_id
      and (select public.has_tenant_role(
        po.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
      and (
        po.user_id = (select auth.uid())
        or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
      )
  ));
create policy "Users can update own purchase order items"
  on public.purchase_order_items for update to authenticated
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_items.purchase_order_id
      and po.tenant_id = purchase_order_items.tenant_id
      and (select public.has_tenant_role(
        po.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
      and (
        po.user_id = (select auth.uid())
        or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
      )
  ))
  with check (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_items.purchase_order_id
      and po.tenant_id = purchase_order_items.tenant_id
      and (select public.has_tenant_role(
        po.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
      and (
        po.user_id = (select auth.uid())
        or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
      )
  ));
create policy "Users can delete own purchase order items"
  on public.purchase_order_items for delete to authenticated
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_items.purchase_order_id
      and po.tenant_id = purchase_order_items.tenant_id
      and (select public.has_tenant_role(
        po.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
      and (
        po.user_id = (select auth.uid())
        or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
      )
  ));

drop policy if exists "Authenticated can access and manage devis" on public.purchase_order_devis;

create policy "Authorized users can view purchase order devis"
  on public.purchase_order_devis for select to authenticated
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_devis.purchase_order_id
      and po.tenant_id = purchase_order_devis.tenant_id
      and (select public.is_tenant_member(po.tenant_id))
      and (
        po.user_id = (select auth.uid())
        or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
      )
  ));
create policy "Authorized users can insert purchase order devis"
  on public.purchase_order_devis for insert to authenticated
  with check (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_devis.purchase_order_id
      and po.tenant_id = purchase_order_devis.tenant_id
      and po.status <> 'canceled'
      and purchase_order_devis.user_id = (select auth.uid())
      and (select public.has_tenant_role(
        po.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
      and (
        po.user_id = (select auth.uid())
        or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
      )
  ));
create policy "Authorized users can update purchase order devis"
  on public.purchase_order_devis for update to authenticated
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_devis.purchase_order_id
      and po.tenant_id = purchase_order_devis.tenant_id
      and po.status <> 'canceled'
      and (select public.has_tenant_role(
        po.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
      and (
        po.user_id = (select auth.uid())
        or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
      )
  ))
  with check (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_devis.purchase_order_id
      and po.tenant_id = purchase_order_devis.tenant_id
      and po.status <> 'canceled'
      and (select public.has_tenant_role(
        po.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
      and (
        po.user_id = (select auth.uid())
        or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
      )
  ));
create policy "Authorized users can delete purchase order devis"
  on public.purchase_order_devis for delete to authenticated
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_devis.purchase_order_id
      and po.tenant_id = purchase_order_devis.tenant_id
      and po.status <> 'canceled'
      and (select public.has_tenant_role(
        po.tenant_id,
        array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
      ))
      and (
        po.user_id = (select auth.uid())
        or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
      )
  ));

drop policy if exists "Authorized users can upload purchase order devis" on storage.objects;
drop policy if exists "Authorized users can delete purchase order devis" on storage.objects;

create policy "Authorized users can upload purchase order devis"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'devis'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 2
    and coalesce((storage.foldername(objects.name))[1], '') = 'purchase-orders'
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and exists (
      select 1 from public.purchase_orders po
      where po.id::text = coalesce((storage.foldername(objects.name))[2], '')
        and po.status <> 'canceled'
        and (select public.has_tenant_role(
          po.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Authorized users can delete purchase order devis"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'devis'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 2
    and coalesce((storage.foldername(objects.name))[1], '') = 'purchase-orders'
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and exists (
      select 1 from public.purchase_orders po
      where po.id::text = coalesce((storage.foldername(objects.name))[2], '')
        and po.status <> 'canceled'
        and (select public.has_tenant_role(
          po.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );
