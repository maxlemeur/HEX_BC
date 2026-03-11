import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createSupabaseBrowserClientMock,
  supabaseFromMock,
  supplierRangeMock,
  productRangeMock,
} = vi.hoisted(() => {
  const supplierRange = vi.fn();
  const productRange = vi.fn();
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      order: vi.fn(() => ({
        range: table === "suppliers" ? supplierRange : productRange,
      })),
    })),
  }));

  return {
    createSupabaseBrowserClientMock: vi.fn(() => ({ from })),
    supabaseFromMock: from,
    supplierRangeMock: supplierRange,
    productRangeMock: productRange,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: createSupabaseBrowserClientMock,
}));

import { usePriceLookups } from "@/components/catalogue/prices-manager/usePriceLookups";

describe("usePriceLookups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supplierRangeMock.mockResolvedValue({
      data: [{ id: "supplier-1", name: "Supplier One" }],
      error: null,
    });
    productRangeMock.mockResolvedValue({
      data: [{ id: "product-1", designation: "Cable", reference: "REF-CABLE" }],
      error: null,
    });
  });

  it("loads suppliers and products and exposes maps and options", async () => {
    const { result } = renderHook(() => usePriceLookups());

    await waitFor(() => {
      expect(result.current.lookups.suppliers).toHaveLength(1);
      expect(result.current.lookups.products).toHaveLength(1);
    });

    expect(supabaseFromMock).toHaveBeenCalledWith("suppliers");
    expect(supabaseFromMock).toHaveBeenCalledWith("products");
    expect(supplierRangeMock).toHaveBeenCalledWith(0, 999);
    expect(productRangeMock).toHaveBeenCalledWith(0, 999);
    expect(result.current.supplierMap.get("supplier-1")).toBe("Supplier One");
    expect(result.current.productMap.get("product-1")).toBe("Cable");
    expect(result.current.supplierOptions).toEqual([
      { value: "supplier-1", label: "Supplier One" },
    ]);
    expect(result.current.productOptions).toEqual([
      { value: "product-1", label: "Cable", keywords: ["REF-CABLE"] },
    ]);
  });

  it("requests second pages when the first page reaches the page size", async () => {
    supplierRangeMock
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, (_, index) => ({
          id: `supplier-${index}`,
          name: `Supplier ${index}`,
        })),
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });
    productRangeMock
      .mockResolvedValueOnce({
        data: Array.from({ length: 1000 }, (_, index) => ({
          id: `product-${index}`,
          designation: `Product ${index}`,
          reference: `REF-${index}`,
        })),
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });

    renderHook(() => usePriceLookups());

    await waitFor(() => {
      expect(supplierRangeMock).toHaveBeenCalledWith(1000, 1999);
      expect(productRangeMock).toHaveBeenCalledWith(1000, 1999);
    });
  });
});
