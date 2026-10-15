import { describe, expect, it } from "vitest";

import { allowsOwnedPurchaseRead, type OwnedPurchaseOrder } from "../../e2e/army/critical/owned-purchase-reads";

const owned = {
  orderId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  versionId: "33333333-3333-4333-8333-333333333333",
  tenantId: "44444444-4444-4444-8444-444444444444",
};
const foreignId = "55555555-5555-4555-8555-555555555555";
const orderColumns = "id,reference,order_date,expected_delivery_date,notes,supplier_id,delivery_site_id,status,source_estimate_version_id,edit_revision,purchase_order_items(id,product_id,reference,source_estimate_item_id,source_selected_supplier_price_id,is_source_linked,designation,quantity,unit,price_unit,unit_price_ht_cents,tax_rate_bp,position)";
const requests = [
  { table: "purchase_orders", method: "GET", query: { select: orderColumns, id: `eq.${owned.orderId}` } },
  { table: "purchase_orders", method: "GET", query: { select: "edit_revision", id: `eq.${owned.orderId}` } },
  { table: "purchase_order_items", method: "HEAD", query: { select: "id", purchase_order_id: `eq.${owned.orderId}` } },
  { table: "suppliers", method: "GET", query: { select: "id,name,address,postal_code,city,contact_name,phone,email", is_active: "eq.true", order: "name.asc" } },
  { table: "delivery_sites", method: "GET", query: { select: "id,name,project_code,address,postal_code,city,contact_name,contact_phone", is_active: "eq.true", order: "name.asc" } },
];
function urlFor(index: number) {
  const request = requests[index];
  const url = new URL(`http://127.0.0.1:54321/rest/v1/${request.table}`);
  for (const [key, value] of Object.entries(request.query)) if (value !== undefined) url.searchParams.set(key, value);
  return url;
}
function allowed(url: URL, method = "GET", orders: OwnedPurchaseOrder[] = [owned]) {
  return allowsOwnedPurchaseRead(url, method, [owned], orders);
}

describe("Army owned purchase editor read boundary", () => {
  it.each(requests.map((request, index) => ({ ...request, index })))("admits the exact $method $table read ($index)", ({ method, index }) => {
    expect(allowed(urlFor(index), method)).toBe(true);
  });
  it("rejects unregistered orders and an order linked to a different project/version", () => {
    for (let index = 0; index < requests.length; index += 1) {
      expect(allowed(urlFor(index), requests[index].method, [])).toBe(false);
      expect(allowed(urlFor(index), requests[index].method, [{ ...owned, versionId: foreignId }])).toBe(false);
      expect(allowed(urlFor(index), requests[index].method, [{ ...owned, projectId: foreignId }])).toBe(false);
    }
  });
  it.each([0, 1, 2])("rejects foreign or missing order filters for read %i", (index) => {
    const url = urlFor(index);
    const key = index === 2 ? "purchase_order_id" : "id";
    url.searchParams.set(key, `eq.${foreignId}`);
    expect(allowed(url, requests[index].method)).toBe(false);
    url.searchParams.delete(key);
    expect(allowed(url, requests[index].method)).toBe(false);
  });
  it("rejects duplicate parameters, OR filters, extra projections and unbounded lookups", () => {
    for (let index = 0; index < requests.length; index += 1) {
      for (const [key, value] of urlFor(index).searchParams) {
        const duplicate = urlFor(index); duplicate.searchParams.append(key, value);
        expect(allowed(duplicate, requests[index].method)).toBe(false);
      }
      const injected = urlFor(index); injected.searchParams.set("or", `(id.eq.${owned.orderId},id.eq.${foreignId})`);
      expect(allowed(injected, requests[index].method)).toBe(false);
      const expanded = urlFor(index); expanded.searchParams.set("select", `${expanded.searchParams.get("select")},*`);
      expect(allowed(expanded, requests[index].method)).toBe(false);
    }
    for (const index of [3, 4]) {
      const unbounded = urlFor(index); unbounded.searchParams.delete("is_active");
      expect(allowed(unbounded)).toBe(false);
    }
  });
  it.each(["POST", "PATCH", "PUT", "DELETE", "OPTIONS"])("rejects %s even for the owned identity", (method) => {
    for (let index = 0; index < requests.length; index += 1) expect(allowed(urlFor(index), method)).toBe(false);
  });
  it("does not expose the items body or arbitrary REST resources", () => {
    expect(allowed(urlFor(2), "GET")).toBe(false);
    const url = urlFor(0); url.pathname = "/rest/v1/profiles";
    expect(allowed(url)).toBe(false);
  });
  it("bounds the existing hub site lookup before any purchase order exists", () => {
    const hub = urlFor(4);
    hub.searchParams.set("select", `${hub.searchParams.get("select")},updated_at`);
    expect(allowed(hub, "GET", [])).toBe(true);
    expect(allowsOwnedPurchaseRead(hub, "GET", [], [])).toBe(false);
    const duplicate = new URL(hub); duplicate.searchParams.append("is_active", "eq.false");
    expect(allowed(duplicate, "GET", [])).toBe(false);
    const injected = new URL(hub); injected.searchParams.set("or", "(is_active.eq.false)");
    expect(allowed(injected, "GET", [])).toBe(false);
    const expanded = new URL(hub); expanded.searchParams.set("select", "*");
    expect(allowed(expanded, "GET", [])).toBe(false);
    expect(allowed(hub, "POST", [])).toBe(false);
  });
});
