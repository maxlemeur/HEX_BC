import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const swrMock = vi.hoisted(() => vi.fn());

vi.mock("swr", () => ({
  default: swrMock,
}));

const priceFreshnessLevelMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/catalogue/stale-prices", () => ({
  priceFreshnessLevel: priceFreshnessLevelMock,
}));

import { useSupplierPricesList } from "@/components/catalogue/prices-manager/useSupplierPricesList";

describe("useSupplierPricesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("configures SWR and enriches rows with names, freshness and stats", () => {
    const mutate = vi.fn();
    swrMock.mockReturnValue({
      data: [
        {
          id: "price-1",
          supplier_id: "supplier-1",
          product_id: "product-1",
          catalogue_item_id: null,
          unit_price_cents: 1250,
          currency: "EUR",
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-02-01T00:00:00.000Z",
        },
        {
          id: "price-2",
          supplier_id: "supplier-2",
          product_id: "product-2",
          catalogue_item_id: null,
          unit_price_cents: 7500,
          currency: "EUR",
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-02-01T00:00:00.000Z",
        },
      ],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate,
    });
    priceFreshnessLevelMock
      .mockReturnValueOnce({ level: "fresh", ageDays: 4 })
      .mockReturnValueOnce({ level: "stale", ageDays: 120 });

    const supplierMap = new Map([
      ["supplier-1", "Supplier One"],
      ["supplier-2", "Supplier Two"],
    ]);
    const productMap = new Map([
      ["product-1", "Cable"],
      ["product-2", "Switch"],
    ]);

    const { result } = renderHook(() =>
      useSupplierPricesList({
        supplierMap,
        productMap,
      })
    );

    expect(swrMock).toHaveBeenCalledWith(
      "supplier-prices",
      expect.any(Function),
      expect.objectContaining({
        refreshInterval: 30000,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
      })
    );
    expect(result.current.enrichedItems).toEqual([
      expect.objectContaining({
        _supplierName: "Supplier One",
        _productName: "Cable",
        _freshnessLevel: "fresh",
        _ageDays: 4,
      }),
      expect.objectContaining({
        _supplierName: "Supplier Two",
        _productName: "Switch",
        _freshnessLevel: "stale",
        _ageDays: 120,
      }),
    ]);
    expect(result.current.stats).toEqual({
      total: 2,
      fresh: 1,
      stale: 1,
      uniqueSuppliers: 2,
    });
  });

  it("refreshes the current SWR key through mutate", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    swrMock.mockReturnValue({
      data: [],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate,
    });
    priceFreshnessLevelMock.mockReturnValue({ level: "fresh", ageDays: 0 });

    const { result } = renderHook(() =>
      useSupplierPricesList({
        supplierMap: new Map(),
        productMap: new Map(),
      })
    );

    await result.current.refresh();

    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
