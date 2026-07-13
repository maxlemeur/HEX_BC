import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchApiMock = vi.hoisted(() => vi.fn());
const supplierRangeMock = vi.hoisted(() => vi.fn());
const productRangeMock = vi.hoisted(() => vi.fn());
const supabaseFromMock = vi.hoisted(() =>
  vi.fn((table: string) => ({
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

  it("loads the complete references only when the import is opened", async () => {
    const { result } = renderHook(() =>
      usePriceLookups({ formOpen: false, importOpen: true })
    );
    await waitFor(() => expect(result.current.lookups.products).toHaveLength(1));
    expect(supabaseFromMock).toHaveBeenCalledWith("suppliers");
    expect(supabaseFromMock).toHaveBeenCalledWith("products");
  });
});
