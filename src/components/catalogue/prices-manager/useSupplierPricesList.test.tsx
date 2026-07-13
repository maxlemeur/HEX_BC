import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const swrMock = vi.hoisted(() => vi.fn());
const fetchApiMock = vi.hoisted(() => vi.fn());

vi.mock("swr", () => ({ default: swrMock }));
vi.mock("@/components/catalogue/api", () => ({ fetchApi: fetchApiMock }));

import { useSupplierPricesList } from "@/components/catalogue/prices-manager/useSupplierPricesList";

const pageData = {
  items: [
    {
      id: "price-1",
      supplier_id: "supplier-1",
      product_id: "product-1",
      unit_price_cents: 1250,
      _supplierName: "Supplier One",
      _productName: "Cable",
      _freshnessLevel: "fresh" as const,
      _ageDays: 4,
    },
  ],
  pagination: { page: 1, size: 25 as const, totalItems: 51, totalPages: 3 },
  counters: { total: 80, fresh: 50, aging: 20, stale: 10, uniqueSuppliers: 4 },
};

describe("useSupplierPricesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrMock.mockReturnValue({
      data: pageData,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    });
  });

  it("keeps the paginated API response and previous data during validation", async () => {
    const queryString = "view=page&page=1&size=25&sort=updated_at&dir=desc";
    const { result } = renderHook(() => useSupplierPricesList({ queryString }));

    expect(swrMock).toHaveBeenCalledWith(
      `/api/prices?${queryString}`,
      expect.any(Function),
      expect.objectContaining({ keepPreviousData: true })
    );
    expect(result.current.items[0]).toMatchObject({
      _supplierName: "Supplier One",
      _productName: "Cable",
    });
    expect(result.current.pagination?.totalPages).toBe(3);
    expect(result.current.stats.total).toBe(80);

    const fetcher = swrMock.mock.calls[0]?.[1] as (url: string) => Promise<unknown>;
    await fetcher(`/api/prices?${queryString}`);
    expect(fetchApiMock).toHaveBeenCalledWith(`/api/prices?${queryString}`);
  });

  it("refreshes the current page through SWR mutate", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    swrMock.mockReturnValue({ ...swrMock(), mutate });
    const { result } = renderHook(() => useSupplierPricesList({ queryString: "view=page" }));
    await result.current.refresh();
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
