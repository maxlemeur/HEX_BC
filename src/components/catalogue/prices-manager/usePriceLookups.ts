"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { SearchableSelectOption } from "@/components/ui/SearchableSelect";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PriceBookLookups } from "@/lib/catalogue/csv-import";

const LOOKUP_PAGE_SIZE = 1000;

type LookupRows<T> = {
  data: T[] | null;
  error: { message?: string | null } | null;
};

async function fetchAllLookupRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<LookupRows<T>>
) {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await fetchPage(offset, offset + LOOKUP_PAGE_SIZE - 1);
    if (error) {
      throw new Error(error.message ?? "Impossible de charger les referentiels.");
    }

    const pageRows = data ?? [];
    allRows.push(...pageRows);

    if (pageRows.length < LOOKUP_PAGE_SIZE) {
      return allRows;
    }

    offset += LOOKUP_PAGE_SIZE;
  }
}

export function usePriceLookups() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [lookups, setLookups] = useState<PriceBookLookups>({
    suppliers: [],
    products: [],
  });

  const supplierMap = useMemo(
    () => new Map(lookups.suppliers.map((supplier) => [supplier.id, supplier.name])),
    [lookups.suppliers]
  );
  const productMap = useMemo(
    () => new Map(lookups.products.map((product) => [product.id, product.designation])),
    [lookups.products]
  );

  const supplierOptions = useMemo<SearchableSelectOption[]>(
    () => lookups.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
    [lookups.suppliers]
  );
  const productOptions = useMemo<SearchableSelectOption[]>(
    () =>
      lookups.products.map((product) => ({
        value: product.id,
        label: product.designation,
        keywords: [product.reference ?? ""].filter(Boolean),
      })),
    [lookups.products]
  );

  const fetchLookups = useCallback(async () => {
    const [suppliers, products] = await Promise.all([
      fetchAllLookupRows<{ id: string; name: string }>((from, to) =>
        supabase.from("suppliers").select("id, name").order("name").range(from, to)
      ),
      fetchAllLookupRows<{ id: string; designation: string; reference?: string | null }>(
        (from, to) =>
          supabase
            .from("products")
            .select("id, designation, reference")
            .order("designation")
            .range(from, to)
      ),
    ]);

    return { suppliers, products };
  }, [supabase]);

  const reloadLookups = useCallback(async () => {
    const nextLookups = await fetchLookups();
    setLookups(nextLookups);
    return nextLookups;
  }, [fetchLookups]);

  useEffect(() => {
    let cancelled = false;

    void fetchLookups()
      .then((nextLookups) => {
        if (!cancelled) {
          setLookups(nextLookups);
        }
      })
      .catch((error: unknown) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchLookups]);

  return {
    lookups,
    supplierMap,
    productMap,
    supplierOptions,
    productOptions,
    reloadLookups,
  };
}
