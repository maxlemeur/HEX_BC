import { createElement, useEffect } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerPushMock = vi.hoisted(() => vi.fn());
const routerReplaceMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, replace: routerReplaceMock }),
  usePathname: () => "/dashboard/prices",
  useSearchParams: () => new URLSearchParams(),
}));

const fetchApiMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/catalogue/api", () => ({ fetchApi: fetchApiMock }));

const supplierRangeMock = vi.hoisted(() => vi.fn());
const productRangeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    from: (table: string) => ({
      select: () => ({
        order: () => ({
          range: (from: number, to: number) => ({
            abortSignal: () => (table === "suppliers" ? supplierRangeMock : productRangeMock)(from, to),
          }),
        }),
      }),
    }),
  }),
}));

const swrMock = vi.hoisted(() => vi.fn());
vi.mock("swr", () => ({ default: swrMock }));

const filterBarPropsSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/TableFilterBar", () => ({
  ServerTableFilterBar: (props: {
    onSearchChange: (value: string) => void;
    filters: Array<{ key: string }>;
    filterState: Record<string, unknown>;
  }) => {
    filterBarPropsSpy(props);
    useEffect(() => props.onSearchChange(""), [props]);
    return createElement("div", { "data-testid": "server-filter-bar" });
  },
}));

vi.mock("@/components/catalogue/PriceBookCsvImport", () => ({
  PriceBookCsvImport: () => createElement("div", { "data-testid": "csv-import" }),
}));
vi.mock("@/components/products/ProductPriceTemplateImport", () => ({
  ProductPriceTemplateImport: () => null,
}));
vi.mock("@/components/products/ProductReferencePricePanel", () => ({
  ProductReferencePricePanel: () => null,
}));

import { PricesManager } from "@/components/catalogue/PricesManager";

const item = {
  id: "price-1",
  supplier_id: "supplier-1",
  product_id: "product-1",
  catalogue_item_id: null,
  unit_price_cents: 1250,
  currency: "EUR",
  valid_from: null,
  valid_to: null,
  source: null,
  notes: null,
  created_at: "2026-02-20T10:00:00.000Z",
  updated_at: "2026-02-20T10:00:00.000Z",
  _supplierName: "Supplier One",
  _productName: "Cable",
  _freshnessLevel: "fresh",
  _ageDays: 4,
};

function setupSWR(overrides: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  swrMock.mockReturnValue({
    data: {
      items: [item],
      pagination: { page: 1, size: 25, totalItems: 51, totalPages: 3 },
      counters: { total: 80, fresh: 50, aging: 20, stale: 10, uniqueSuppliers: 4 },
    },
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate,
    ...overrides,
  });
  return mutate;
}

describe("PricesManager paginé", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSWR();
    fetchApiMock.mockResolvedValue({ suppliers: [], products: [] });
    supplierRangeMock.mockResolvedValue({ data: [], error: null });
    productRangeMock.mockResolvedValue({ data: [], error: null });
  });
  afterEach(cleanup);

  it("aligne la clé du filtre de fraîcheur sur l'état d'URL (filtre non mort)", () => {
    render(createElement(PricesManager));
    const props = filterBarPropsSpy.mock.calls.at(-1)?.[0] as {
      filters: Array<{ key: string }>;
      filterState: Record<string, unknown>;
    };
    const stateKeys = Object.keys(props.filterState);
    // Chaque filtre déclaré doit lire/écrire une clé présente dans filterState,
    // sinon la valeur active n'est jamais lue ni appliquée.
    for (const filter of props.filters) {
      expect(stateKeys).toContain(filter.key);
    }
    expect(props.filters.map((f) => f.key)).toContain("freshness");
  });

  it("changes server pages through the URL", async () => {
    const user = userEvent.setup();
    render(createElement(PricesManager));
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    expect(routerPushMock).toHaveBeenCalledWith(expect.stringContaining("page=2"), { scroll: false });
    expect(screen.queryByText(/Limite de 400 résultats/i)).not.toBeInTheDocument();
  });
});
