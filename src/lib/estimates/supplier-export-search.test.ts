import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedTenantContext: vi.fn() }));

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { loadSupplierExportSearch, mayMatchSupplierExportSearch } from "@/lib/estimates/supplier-export-search";

// Precode isolation gap: the real volume journey catches missing rows and latency,
// but its negative titles cannot expose a false exclusion at a Unicode boundary,
// on a catalogue page after row 1,000, or when the bounded inventory overflows.
describe("conservative catalogue preflight for estimate exports", () => {
  it("retains case-insensitive, accent and compatibility candidates", () => {
    const search = { ascii: ["ecrou m12", "strasse", "isolation"], unicode: ["tube ø 18"] };
    for (const query of ["Ecrou M12", "STRASSE", "ISOLATION", "tube 18", "Écrou M12", "A%_(),'"]) {
      expect(mayMatchSupplierExportSearch(search, query), query).toBe(true);
    }
    expect(mayMatchSupplierExportSearch(search, "Ligne fictive 0001")).toBe(false);
    expect(mayMatchSupplierExportSearch(search, "Réserve fictive 0001")).toBe(false);
    expect(mayMatchSupplierExportSearch(search, "tube")).toBe(true);
    // SQL removes punctuation but never the literal digit fragments: keep a
    // possible 12_3 -> 123 match, including a non-ASCII designation.
    expect(mayMatchSupplierExportSearch({ ascii: ["reserve 123"], unicode: [] }, "Réserve 12_3")).toBe(true);
  });

  it("never excludes a query when the inventory is incomplete", () => {
    expect(mayMatchSupplierExportSearch(null, "Ligne fictive 1036")).toBe(true);
  });

  function clientWithProducts(count: number, lastTitle: string) {
    const pages: Array<{ table: string; start: number; end: number; tenant: string | null }> = [];
    const client = {
      from: (table: string) => {
        let tenant: string | null = null;
        const query = {
          select: () => query,
          eq: (column: string, value: string) => { if (column === "tenant_id") tenant = value; return query; },
          order: () => query,
          range: async (start: number, end: number) => {
            pages.push({ table, start, end, tenant });
            const all = table === "products" ? Array.from({ length: count }, (_, index) => ({
              id: `product-${index}`, designation: index === count - 1 ? lastTitle : `Catalogue ${index}`, reference: null,
            })) : table === "suppliers" ? [{ id: "supplier", name: "Fournisseur témoin" }]
              : [{ id: "offer", supplier_sku: "SKU-01" }];
            return { data: all.slice(start, Math.min(end + 1, start + 1000)), count: all.length, error: null };
          },
        };
        return query;
      },
    };
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({ supabase: client, tenantId: "owned-tenant" } as never);
    return pages;
  }

  it("keeps a candidate beyond the provider's 1,000-row page and scopes every read", async () => {
    const pages = clientWithProducts(1255, "ÉCROU M12");
    const search = await loadSupplierExportSearch();
    expect(mayMatchSupplierExportSearch(search, "ecrou m12")).toBe(true);
    expect(mayMatchSupplierExportSearch(search, "Ligne fictive 0001")).toBe(false);
    expect(pages.filter(page => page.table === "products").map(page => page.start)).toEqual([0, 500, 1000]);
    expect(pages.every(page => page.tenant === "owned-tenant")).toBe(true);
  });

  it("falls back instead of treating a truncated large catalogue as empty", async () => {
    clientWithProducts(2001, "Ligne fictive 1036");
    const search = await loadSupplierExportSearch();
    expect(search).toBeNull();
    expect(mayMatchSupplierExportSearch(search, "Ligne fictive 1036")).toBe(true);
  });

  it("folds unusual Unicode conservatively and retains SKU-only and supplier-only matches", async () => {
    clientWithProducts(1, "İSOLATION Straße ŒUVRE Ø 18");
    const search = await loadSupplierExportSearch();
    for (const query of ["isolation", "strasse", "oeuvre", "article 18", "SKU-01", "Fournisseur témoin"]) {
      expect(mayMatchSupplierExportSearch(search, query), query).toBe(true);
    }
    expect(mayMatchSupplierExportSearch(search, "Ligne fictive 0001")).toBe(false);
  });
});
