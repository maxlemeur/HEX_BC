-- Add missing foreign-key indexes and consolidate overlapping permissive RLS policies.

create index if not exists dpgf_catalogue_links_material_index_id_idx
  on public.dpgf_catalogue_links (material_index_id);
create index if not exists dpgf_catalogue_links_product_id_idx
  on public.dpgf_catalogue_links (product_id);
create index if not exists dpgf_catalogue_links_supplier_price_id_idx
  on public.dpgf_catalogue_links (supplier_price_id);

create index if not exists estimate_approvals_approved_by_idx
  on public.estimate_approvals (approved_by);
create index if not exists estimate_approvals_requested_by_idx
  on public.estimate_approvals (requested_by);

create index if not exists estimate_assemblies_created_by_idx
  on public.estimate_assemblies (created_by);

create index if not exists estimate_documents_generated_by_idx
  on public.estimate_documents (generated_by);

create index if not exists estimate_item_outlier_dismissals_dismissed_by_idx
  on public.estimate_item_outlier_dismissals (dismissed_by);

create index if not exists estimate_template_items_labor_role_atelier_id_idx
  on public.estimate_template_items (labor_role_atelier_id);
create index if not exists estimate_template_items_labor_role_chantier_id_idx
  on public.estimate_template_items (labor_role_chantier_id);
create index if not exists estimate_template_items_supply_type_id_idx
  on public.estimate_template_items (supply_type_id);

create index if not exists estimate_version_events_created_by_idx
  on public.estimate_version_events (created_by);

create index if not exists material_indices_created_by_idx
  on public.material_indices (created_by);

create index if not exists suggestion_corrections_user_id_idx
  on public.suggestion_corrections (user_id);

create index if not exists suggestion_learning_reviews_decided_by_idx
  on public.suggestion_learning_reviews (decided_by);

create index if not exists supplier_pricebook_created_by_idx
  on public.supplier_pricebook (created_by);
create index if not exists supplier_pricebook_source_import_id_idx
  on public.supplier_pricebook (source_import_id);
create index if not exists supplier_pricebook_source_mapped_row_id_idx
  on public.supplier_pricebook (source_mapped_row_id);

create index if not exists tenants_created_by_idx
  on public.tenants (created_by);

-- Merge overlapping permissive ALL policies into one equivalent policy to reduce per-row policy checks.
drop policy if exists "Authenticated can access devis" on public.purchase_order_devis;
drop policy if exists "Users can manage purchase order devis" on public.purchase_order_devis;

create policy "Authenticated can access and manage devis"
on public.purchase_order_devis
as permissive
for all
to authenticated
using (
  (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_devis.purchase_order_id
        and po.tenant_id = purchase_order_devis.tenant_id
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  or (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_devis.purchase_order_id
        and po.user_id = (select auth.uid())
    )
  )
)
with check (
  (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_devis.purchase_order_id
        and po.tenant_id = purchase_order_devis.tenant_id
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  or (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_devis.purchase_order_id
        and po.user_id = (select auth.uid())
    )
  )
);
