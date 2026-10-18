import { act,renderHook,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const fetchApiMock = vi.hoisted(() => vi.fn());
const supplierRangeMock = vi.hoisted(() => vi.fn());
const productRangeMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() =>
  vi.fn<(table: string) => unknown>((table: string) => ({
    select: vi.fn(() => ({
      order: vi.fn(() => ({
        range: table === "suppliers" ? supplierRangeMock : productRangeMock,
      })),
    })),
  }))
);

vi.mock("@/components/catalogue/api", () => ({ fetchApi: fetchApiMock }));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ from: supabaseFromMock }),
}));

import { usePriceLookups } from "@/components/catalogue/prices-manager/usePriceLookups";

describe("usePriceLookups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchApiMock.mockImplementation(async (url: string) =>
      url.includes("kind=supplier")
        ? { suppliers: [{ id: "supplier-1", name: "Supplier One" }], products: [] }
        : {
            suppliers: [],
            products: [{ id: "product-1", designation: "Cable", reference: "REF-CABLE" }],
          }
    );
    supplierRangeMock.mockResolvedValue({
      data: [{ id: "supplier-1", name: "Supplier One" }],
      error: null,
    });
    productRangeMock.mockResolvedValue({
      data: [{ id: "product-1", designation: "Cable", reference: "REF-CABLE" }],
      error: null,
    });
  });

  it("uses the 50-result remote endpoint while the form is open", async () => {
    const { result } = renderHook(() =>
      usePriceLookups({ formOpen: true, importOpen: false })
    );

    await waitFor(() => expect(result.current.supplierOptions).toHaveLength(1));
    await waitFor(() => expect(result.current.productOptions).toHaveLength(1));
    expect(fetchApiMock).toHaveBeenCalledWith(expect.stringContaining("limit=50"));
    expect(supabaseFromMock).not.toHaveBeenCalled();

    act(() => result.current.searchProducts("câble"));
    await waitFor(() =>
      expect(fetchApiMock).toHaveBeenCalledWith(expect.stringContaining("q=c%C3%A2ble"))
    );
  });
});

type LookupPage = { data: unknown[] | null; error: { message: string } | null };

describe("usePriceLookups import lookups", () => {
  // One resolver per `from(table)` call, that is per lookup page, settled by the test.
  let pages: Record<string, Array<(page: LookupPage) => void>>;
  const rows = (data: unknown[]): LookupPage => ({ data, error: null });

  beforeEach(() => {
    pages = { suppliers: [], products: [] };
    supabaseFromMock.mockImplementation((table: string) => {
      const page = new Promise<LookupPage>((resolve) => pages[table].push(resolve));
      const query = {
        select: () => query,
        order: () => query,
        range: () => query,
        abortSignal: () => query,
        then: (onFulfilled: (value: LookupPage) => unknown, onRejected?: (reason: unknown) => unknown) =>
          page.then(onFulfilled, onRejected),
      };
      return query;
    });
  });

  afterEach(() => {
    supabaseFromMock.mockReset();
  });

  it("lets only the latest import lookup load settle the status and the lookups", async () => {
    const { result } = renderHook(() => usePriceLookups({ formOpen: false, importOpen: true }));
    await waitFor(() => expect(pages.suppliers).toHaveLength(1));
    let latest!: Promise<unknown>;
    act(() => {
      latest = result.current.reloadLookups();
    });
    expect(pages.suppliers).toHaveLength(2);

    // The superseded load settles first while the latest one is still reading.
    await act(async () => {
      pages.suppliers[0](rows([{ id: "supplier-a", name: "Supplier A" }]));
      pages.products[0](rows([]));
    });
    expect(result.current.importLookupsStatus).toBe("loading");
    expect(result.current.lookups.suppliers).toEqual([]);

    await act(async () => {
      pages.suppliers[1](rows([{ id: "supplier-b", name: "Supplier B" }]));
      pages.products[1](rows([]));
      await latest;
    });
    expect(result.current.importLookupsStatus).toBe("ready");
    expect(result.current.lookups.suppliers).toEqual([{ id: "supplier-b", name: "Supplier B" }]);

    // A superseded load that fails after the latest one succeeded leaves the lookups ready.
    let superseded!: Promise<unknown>;
    act(() => {
      superseded = result.current.reloadLookups();
      latest = result.current.reloadLookups();
    });
    await act(async () => {
      pages.suppliers[3](rows([{ id: "supplier-d", name: "Supplier D" }]));
      pages.products[3](rows([]));
      await latest;
    });
    await act(async () => {
      pages.suppliers[2]({ data: null, error: { message: "Stale lookup failure" } });
      pages.products[2](rows([]));
      await expect(superseded).rejects.toThrow("Stale lookup failure");
    });
    expect(result.current.importLookupsStatus).toBe("ready");
    expect(result.current.lookups.suppliers).toEqual([{ id: "supplier-d", name: "Supplier D" }]);
  });
});
