import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/products/page.tsx"),
  "utf8",
);

describe("ProductsPage responsive list contract", () => {
  it("drives product pagination from the server and the URL", () => {
    expect(source).toContain(
      "const PRODUCT_PAGE_SIZES = [25, 50, 100] as const",
    );
    expect(source).toContain('view: "page"');
    expect(source).toContain("products.map");
    expect(source).toContain("{page} / {totalPages}");
    expect(source).toContain("keepPreviousData: true");
  });

  it("keeps the product list primary on every viewport", () => {
    expect(source).toContain("<ServerTableFilterBar");
    expect(source).toContain("compact");
    expect(source).toContain(
      'className="data-table product-catalogue-table table-fixed md:table-auto"',
    );
    expect(source).toContain('className="hidden min-[700px]:table-cell"');
  });

  it("moves catalogue context and secondary actions into the overflow menu", () => {
    expect(source).toContain("Ouvrir les actions du catalogue");
    expect(source).toContain("État du catalogue");
    expect(source).toContain("Règle de prix actuelle");
    expect(source).toContain("Importer produits et tarifs");
    expect(source).not.toContain("Indicateurs du catalogue");
  });

  it("shows where the effective reference price comes from", () => {
    expect(source).toContain("Dernier achat confirmé");
    expect(source).toContain("Saisie interne");
    expect(source).toContain("_referencePriceSourceOrderReference");
    expect(source).toContain("_referencePriceSourceSupplierName");
    expect(source).toContain("_referencePriceSourceDate");
  });
});
