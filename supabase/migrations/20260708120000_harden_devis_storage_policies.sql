-- Harden the private devis bucket so direct Storage API access mirrors
-- purchase-order authorization instead of bucket-wide authenticated access.

drop policy if exists "Authenticated users can upload devis" on storage.objects;
drop policy if exists "Authenticated users can view devis" on storage.objects;
drop policy if exists "Authenticated users can update devis" on storage.objects;
drop policy if exists "Authenticated users can delete devis" on storage.objects;

drop policy if exists "Authorized users can upload purchase order devis" on storage.objects;
drop policy if exists "Authorized users can view purchase order devis" on storage.objects;
drop policy if exists "Authorized users can delete purchase order devis" on storage.objects;

create policy "Authorized users can upload purchase order devis"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'devis'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 2
    and coalesce((storage.foldername(objects.name))[1], '') = 'purchase-orders'
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and exists (
      select 1
      from public.purchase_orders po
      where po.id::text = coalesce((storage.foldername(objects.name))[2], '')
        and po.status <> 'canceled'
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Authorized users can view purchase order devis"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'devis'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 2
    and coalesce((storage.foldername(objects.name))[1], '') = 'purchase-orders'
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and exists (
      select 1
      from public.purchase_order_devis pod
      join public.purchase_orders po on po.id = pod.purchase_order_id
      where pod.storage_path = objects.name
        and po.tenant_id = pod.tenant_id
        and po.id::text = coalesce((storage.foldername(objects.name))[2], '')
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Authorized users can delete purchase order devis"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'devis'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 2
    and coalesce((storage.foldername(objects.name))[1], '') = 'purchase-orders'
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and (
      exists (
        select 1
        from public.purchase_order_devis pod
        join public.purchase_orders po on po.id = pod.purchase_order_id
        where pod.storage_path = objects.name
          and po.tenant_id = pod.tenant_id
          and po.id::text = coalesce((storage.foldername(objects.name))[2], '')
          and po.status <> 'canceled'
          and (select public.is_tenant_member(po.tenant_id))
          and (
            po.user_id = (select auth.uid())
            or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
          )
      )
      or (
        not exists (
          select 1
          from public.purchase_order_devis pod
          where pod.storage_path = objects.name
        )
        and exists (
          select 1
          from public.purchase_orders po
          where po.id::text = coalesce((storage.foldername(objects.name))[2], '')
            and po.status <> 'canceled'
            and (select public.is_tenant_member(po.tenant_id))
            and (
              po.user_id = (select auth.uid())
              or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
            )
        )
      )
    )
  );
