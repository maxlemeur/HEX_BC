import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20260825200420_link_estimate_items_to_products.sql",
  ),
  "utf8",
);

describe("estimate item product association migration", () => {
  it("adds a nullable product link and forbids cross-tenant associations", () => {
    expect(migrationSql).toMatch(/add column if not exists product_id uuid/i);
    expect(migrationSql).toMatch(/references public\.products\(id\)[\s\S]*on delete set null/i);
    expect(migrationSql).toMatch(/ESTIMATE_ITEM_PRODUCT_TENANT_MISMATCH/i);
    expect(migrationSql).toMatch(/product\.tenant_id = new\.tenant_id/i);
  });

  it("persists the association through atomic bulk saves and duplication", () => {
    expect(migrationSql).toMatch(/rename to bulk_update_estimate_items_without_product_id/i);
    expect(migrationSql).toMatch(/requested\.payload \? 'product_id'/i);
    expect(migrationSql).toMatch(/rename to duplicate_estimate_version_without_product_id/i);
    expect(migrationSql).toMatch(/set product_id = source\.product_id/i);
  });
});
