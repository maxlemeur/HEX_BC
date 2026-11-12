export type OwnedPurchaseOrder = {
  orderId: string;
  projectId: string;
  versionId: string;
  /** Recorded in the evidence when the journey knows it; the guard does not read it. */
  tenantId?: string;
};

// The purchase editor's own read (src/app/dashboard/orders/[id]/edit/page.tsx), as supabase-js sends it: since
// TI-691 it also reads the affaire, the delivery mode and, per line, its kind, lot, imputation and request line.
const ORDER_COLUMNS = "id,reference,order_date,expected_delivery_date,notes,supplier_id,delivery_site_id,status,source_estimate_version_id,edit_revision,project_id,delivery_mode,estimate_projects(name,site_address),purchase_order_items(id,product_id,reference,source_estimate_item_id,source_selected_supplier_price_id,is_source_linked,designation,quantity,unit,price_unit,unit_price_ht_cents,tax_rate_bp,position,line_kind,price_per,imputation,overhead_category,material_request_line_id,material_request_lines(position,request_id,material_requests(project_id,requested_on)))";

function exactQuery(url: URL, expected: Record<string, string>) {
  const entries = [...url.searchParams];
  return entries.length === Object.keys(expected).length && entries.every(([key, value]) =>
    url.searchParams.getAll(key).length === 1 && value === expected[key]);
}

// Used only behind the common guard's allowlisted loopback-origin check.
// The register is filled after the returned draft ID is verified through RLS.
export function allowsOwnedPurchaseRead(
  url: URL,
  method: string,
  estimates: Array<{ projectId: string; versionId: string }>,
  orders: OwnedPurchaseOrder[],
) {
  // The hub needs this exact lookup before creating the order. Keep its older
  // exception bounded too, so it cannot admit another purchase-editor query.
  if (method === "GET" && url.pathname === "/rest/v1/delivery_sites" && estimates.length > 0 &&
      exactQuery(url, { select: "id,name,project_code,address,postal_code,city,contact_name,contact_phone,updated_at",
        is_active: "eq.true", order: "name.asc" })) return true;
  const owned = orders.filter(order => estimates.some(estimate =>
    estimate.projectId === order.projectId && estimate.versionId === order.versionId));
  if (!owned.length) return false;
  if (method === "HEAD" && url.pathname === "/rest/v1/purchase_order_items") {
    return owned.some(order => exactQuery(url, { select: "id", purchase_order_id: `eq.${order.orderId}` }));
  }
  if (method !== "GET") return false;
  if (url.pathname === "/rest/v1/purchase_orders") {
    return owned.some(order => [ORDER_COLUMNS, "edit_revision"].some(select =>
      exactQuery(url, { select, id: `eq.${order.orderId}` })));
  }
  if (url.pathname === "/rest/v1/suppliers") {
    return exactQuery(url, { select: "id,name,address,postal_code,city,contact_name,phone,email",
      is_active: "eq.true", order: "name.asc" });
  }
  if (url.pathname === "/rest/v1/delivery_sites") {
    return exactQuery(url, { select: "id,name,project_code,address,postal_code,city,contact_name,contact_phone",
      is_active: "eq.true", order: "name.asc" });
  }
  return false;
}
