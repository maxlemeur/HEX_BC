import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "src/app/dashboard/products/page.tsx"), "utf8");

describe("ProductsPage responsive list contract", () => {
  it("drives product pagination from the server and the URL", () => {
    expect(source).toContain("const PRODUCT_PAGE_SIZES = [25, 50, 100] as const");
    expect(source).toContain('view: "page"');
    expect(source).toContain("products.map");
    expect(source).toContain("{page} / {totalPages}");
    expect(source).toContain("keepPreviousData: true");
  });

  it("uses cards on compact viewports and the dense table on desktop", () => {
    expect(source).toContain('className="divide-y divide-[var(--slate-200)] xl:hidden"');
    expect(source).toContain('className="hidden overflow-x-auto xl:block"');
  });
});
