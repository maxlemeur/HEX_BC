"use client";

import { useCallback } from "react";
import useSWR from "swr";

import { fetchApi } from "@/components/catalogue/api";
import type { SupplierPricesPage } from "@/components/catalogue/prices-manager/types";

export function useSupplierPricesList({
  queryString,
}: {
  queryString: string;
}) {
  const fetchPrices = useCallback(
    (url: string) => fetchApi<SupplierPricesPage>(url),
    []
  );

  const {
    data,
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<SupplierPricesPage>(
    `/api/prices?${queryString}`,
    fetchPrices,
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    }
  );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    data,
    items: data?.items ?? [],
    pagination: data?.pagination ?? null,
    stats: data?.counters ?? {
      total: 0,
      fresh: 0,
      aging: 0,
      stale: 0,
      uniqueSuppliers: 0,
    },
    loadError,
    isLoading,
    isValidating,
    refresh,
  };
}
