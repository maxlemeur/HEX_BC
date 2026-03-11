"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";

import { fetchApi } from "@/components/catalogue/api";
import type { SupplierPrice } from "@/components/catalogue/types";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { priceFreshnessLevel } from "@/lib/catalogue/stale-prices";

type PricesListResponse = {
  items: SupplierPrice[];
};

export function useSupplierPricesList({
  supplierMap,
  productMap,
}: {
  supplierMap: Map<string, string>;
  productMap: Map<string, string>;
}) {
  const fetchPrices = useCallback(async () => {
    const data = await fetchApi<PricesListResponse>("/api/prices?limit=400");
    return data.items ?? [];
  }, []);

  const {
    data: rawItems = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<SupplierPrice[]>("supplier-prices", fetchPrices, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const enrichedItems = useMemo<EnrichedPrice[]>(() => {
    const now = new Date();
    return rawItems.map((item) => {
      const { level, ageDays } = priceFreshnessLevel(
        { updatedAt: item.updated_at ?? null, createdAt: item.created_at ?? null },
        now
      );

      return {
        ...item,
        _supplierName: supplierMap.get(item.supplier_id) ?? item.supplier_id,
        _productName:
          productMap.get(item.product_id ?? item.catalogue_item_id ?? "") ??
          item.product_id ??
          item.catalogue_item_id ??
          "",
        _freshnessLevel: level,
        _ageDays: ageDays,
      };
    });
  }, [productMap, rawItems, supplierMap]);

  const stats = useMemo(() => {
    const total = enrichedItems.length;
    const fresh = enrichedItems.filter((item) => item._freshnessLevel === "fresh").length;
    const stale = enrichedItems.filter((item) => item._freshnessLevel === "stale").length;
    const uniqueSuppliers = new Set(enrichedItems.map((item) => item.supplier_id)).size;
    return { total, fresh, stale, uniqueSuppliers };
  }, [enrichedItems]);

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    rawItems,
    enrichedItems,
    stats,
    loadError,
    isLoading,
    isValidating,
    refresh,
  };
}
