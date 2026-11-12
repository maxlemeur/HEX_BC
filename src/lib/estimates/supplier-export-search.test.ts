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

  /** `count` validated articles, the last one titled `lastTitle`, then `drafts` draft articles, the last one titled `draftTitle`. */
  function clientWithProducts(count: number, lastTitle: string, options: { drafts?: number; draftTitle?: string } = {}) {
    const pages: Array<{ table: string; start: number; end: number; tenant: string | null }> = [];
    const drafts = options.drafts ?? 0;
    const client = {
      from: (table: string) => {
        let tenant: string | null = null;
        const filters: Array<[string, unknown]> = [];
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            if (column === "tenant_id") tenant = String(value);
            else filters.push([column, value]);
            return query;
          },
          order: () => query,
          range: async (start: number, end: number) => {
            pages.push({ table, start, end, tenant });
            const rows: Array<Record<string, unknown>> = table === "products" ? [
              ...Array.from({ length: count }, (_, index) => ({
                id: `product-${index}`, designation: index === count - 1 ? lastTitle : `Catalogue ${index}`, reference: null,
                is_active: true, catalogue_status: "validated",
              })),
              ...Array.from({ length: drafts }, (_, index) => ({
                id: `draft-${index}`, designation: index === drafts - 1 ? (options.draftTitle ?? "Brouillon") : `Brouillon ${index}`,
                reference: null, is_active: true, catalogue_status: "draft",
              })),
            ] : table === "suppliers" ? [{ id: "supplier", name: "Fournisseur témoin" }]
              : [{ id: "offer", supplier_sku: "SKU-01", is_active: true }];
            // The filters apply to the stored row; the projection returns only the indexed columns.
            const all = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
            return {
              data: all.slice(start, Math.min(end + 1, start + 1000)).map((row) =>
                Object.fromEntries(Object.entries(row).filter(([column]) => column !== "is_active" && column !== "catalogue_status"))),
              count: all.length,
              error: null,
            };
          },
        };
        return query;
      },
    };
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({ supabase: client, tenantId: "owned-tenant" } as never);
    return pages;
  }

  // TI-690: the export compares a line only with validated articles (suggestEstimateCataloguePrices without
  // drafts), so a draft's words can never be the line's match. Counted, the ~2,600 drafts of the costing
  // workbook would push the company past the cap and cost it the index.
  it("indexes validated articles only: a draft's words are no candidate, a validated article's still are", async () => {
    clientWithProducts(2, "Écrou M12", { drafts: 1, draftTitle: "Vanne fictive 0042" });
    const search = await loadSupplierExportSearch();
    expect(mayMatchSupplierExportSearch(search, "ecrou m12")).toBe(true);
    expect(mayMatchSupplierExportSearch(search, "Vanne fictive 0042")).toBe(false);
  });

  it("computes the cap on validated articles only", async () => {
    clientWithProducts(1000, "Écrou M12", { drafts: 2600 });
    const kept = await loadSupplierExportSearch();
    expect(kept).not.toBeNull();
    expect(mayMatchSupplierExportSearch(kept, "ecrou m12")).toBe(true);

    clientWithProducts(2001, "Écrou M12", { drafts: 10 });
    expect(await loadSupplierExportSearch()).toBeNull();
  });

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
