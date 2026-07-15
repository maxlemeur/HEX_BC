import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readMigration(filename: string) {
  return fs.readFileSync(
    path.resolve(process.cwd(), "supabase/migrations", filename),
    "utf8",
  );
}

const schemaSql = readMigration(
  "20260714181641_add_supplier_catalog_items.sql",
);
const writeRpcSql = readMigration(
  "20260714181702_add_supplier_catalog_price_rpcs.sql",
);
const pageRpcSql = readMigration(
  "20260714181718_expose_supplier_catalog_metadata.sql",
);

describe("supplier catalogue schema regressions", () => {
  it("keeps one supplier catalogue item per tenant, supplier and product", () => {
    expect(schemaSql).toMatch(/create table public\.supplier_catalog_items/i);
    expect(schemaSql).toMatch(/unique \(tenant_id, supplier_id, product_id\)/i);
    expect(schemaSql).toMatch(
      /add column supplier_catalog_item_id uuid[\s\S]*alter column supplier_catalog_item_id set not null/i,
    );
    expect(schemaSql).toMatch(
      /tenant_id,\s*supplier_catalog_item_id,\s*currency,\s*valid_from,\s*min_quantity/i,
    );
  });

  it("backfills one current fiche while preserving historical price rows", () => {
    expect(schemaSql).toMatch(
      /row_number\(\) over \([\s\S]*partition by sp\.tenant_id, sp\.supplier_id, sp\.product_id/i,
    );
    expect(schemaSql).toMatch(
      /candidate\.is_current desc,[\s\S]*candidate\.valid_from desc,[\s\S]*candidate\.id desc/i,
    );
    expect(schemaSql).toMatch(
      /from '\^\[Ss\]\[Oo\]\[Uu\]\[Rr\]\[Cc\]\[Ee\]:\[\[:space:\]\]\*\(https\?[^']+'/i,
    );
    expect(schemaSql).not.toMatch(
      /update public\.supplier_pricebook[\s\S]*set supplier_sku/i,
    );
    expect(schemaSql).toMatch(
      /Supplier price tenant mismatch blocks supplier catalogue backfill/i,
    );
    expect(schemaSql.indexOf("Supplier price tenant mismatch")).toBeLessThan(
      schemaSql.indexOf("with ranked_prices"),
    );
  });

  it("validates import provenance inside the active tenant", () => {
    for (const sql of [schemaSql, writeRpcSql]) {
      expect(sql).toMatch(
        /from public\.dpgf_imports source_import[\s\S]*source_import\.tenant_id = target_tenant_id/i,
      );
      expect(sql).toMatch(
        /from public\.dpgf_rows_mapped mapped_row[\s\S]*mapped_row\.tenant_id = target_tenant_id/i,
      );
      expect(sql).toMatch(
        /mapped_row\.import_id = \(.*source_import_id.*\)::uuid/i,
      );
    }
  });

  it("restricts direct writes and exposes tenant-scoped reads", () => {
    expect(schemaSql).toMatch(/enable row level security/i);
    expect(schemaSql).toMatch(
      /using \(\(select public\.is_tenant_member\(tenant_id\)\)\)/i,
    );
    expect(schemaSql).toMatch(
      /revoke all on table public\.supplier_catalog_items from anon, authenticated/i,
    );
    expect(schemaSql).toMatch(
      /grant select on table public\.supplier_catalog_items to authenticated/i,
    );
    expect(schemaSql).not.toMatch(
      /grant (?:insert|update|delete)[^;]*supplier_catalog_items to authenticated/i,
    );
  });

  it("uses narrow transactional RPCs with tenant roles and a fixed search path", () => {
    expect(writeRpcSql).toMatch(
      /create or replace function public\.create_supplier_catalog_price\(payload jsonb\)[\s\S]*security definer[\s\S]*set search_path = ''/i,
    );
    expect(writeRpcSql).toMatch(
      /array\['admin'::public\.tenant_role, 'engineer'::public\.tenant_role\]/i,
    );
    expect(writeRpcSql).toMatch(
      /on conflict \(tenant_id, supplier_id, product_id\)/i,
    );
    expect(writeRpcSql).toMatch(/SUPPLIER_CATALOG_REFERENCE_CONFLICT/);
    expect(writeRpcSql).toMatch(/SUPPLIER_CATALOG_URL_CONFLICT/);
    expect(writeRpcSql).toMatch(
      /revoke execute on function public\.create_supplier_catalog_price\(jsonb\) from public, anon/i,
    );
  });

  it("serves current supplier metadata from the unique fiche", () => {
    expect(pageRpcSql).toMatch(
      /join public\.supplier_catalog_items item on item\.id = sp\.supplier_catalog_item_id/i,
    );
    expect(pageRpcSql).toMatch(/item\.supplier_sku/);
    expect(pageRpcSql).toMatch(/item\.product_url/);
  });
});
