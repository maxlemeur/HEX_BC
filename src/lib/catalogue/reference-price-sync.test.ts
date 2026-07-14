import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260714090000_sync_reference_price_from_confirmed_orders.sql",
  ),
  "utf8",
);

describe("product reference price synchronization migration", () => {
  it("keeps the manual price as a fallback", () => {
    expect(migration).toContain("manual_reference_price_cents");
    expect(migration).toContain(
      "coalesce(latest_purchase.unit_price_ht_cents, product.manual_reference_price_cents)",
    );
    expect(migration).toContain("track_manual_product_reference_price");
    expect(migration).toContain("before insert on public.products");
  });

  it("uses only validated purchases from the same tenant", () => {
    expect(migration).toContain(
      "purchase_order.status in ('confirmed', 'received')",
    );
    expect(migration).toContain("purchase_order.tenant_id = item.tenant_id");
    expect(migration).toContain("purchase_order.tenant_id = p_tenant_id");
    expect(migration).toContain("product.tenant_id = p_tenant_id");
  });

  it("refreshes after order and order-item changes", () => {
    expect(migration).toContain(
      "after update of status, order_date on public.purchase_orders",
    );
    expect(migration).toContain("after insert on public.purchase_order_items");
    expect(migration).toContain("after delete on public.purchase_order_items");
    expect(migration).toContain("reference_price_source_order_reference");
    expect(migration).toContain("reference_price_source_supplier_name");
  });
});
