"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { SearchableSelectOption } from "@/components/ui/SearchableSelect";
import type { PriceBookLookups } from "@/lib/catalogue/csv-import";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const LOOKUP_PAGE_SIZE = 1000;

type LookupRows<T> = {
  data: T[] | null;
  error: { message?: string | null } | null;
};

type RemoteLookups = PriceBookLookups;

async function fetchAllLookupRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<LookupRows<T>>
) {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await fetchPage(offset, offset + LOOKUP_PAGE_SIZE - 1);
    if (error) throw new Error(error.message ?? "Impossible de charger les référentiels.");
    const pageRows = data ?? [];
    allRows.push(...pageRows);
    if (pageRows.length < LOOKUP_PAGE_SIZE) return allRows;
    offset += LOOKUP_PAGE_SIZE;
  }
}

export function usePriceLookups({
  formOpen,
  importOpen,
  selectedSupplierId = null,
  selectedProductId = null,
}: {
  formOpen: boolean;
  importOpen: boolean;
  selectedSupplierId?: string | null;
  selectedProductId?: string | null;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [lookups, setLookups] = useState<PriceBookLookups>({ suppliers: [], products: [] });
  const [supplierOptions, setSupplierOptions] = useState<SearchableSelectOption[]>([]);
  const [productOptions, setProductOptions] = useState<SearchableSelectOption[]>([]);
  const [isSupplierLoading, setIsSupplierLoading] = useState(false);
  const [isProductLoading, setIsProductLoading] = useState(false);
  const [isImportLookupsLoading, setIsImportLookupsLoading] = useState(false);
  const supplierSequence = useRef(0);
  const productSequence = useRef(0);
  const supplierTimer = useRef<number | null>(null);
  const productTimer = useRef<number | null>(null);

  const fetchRemoteOptions = useCallback(
    async (kind: "supplier" | "product", query: string, selectedId: string | null) => {
      const sequenceRef = kind === "supplier" ? supplierSequence : productSequence;
      const sequence = sequenceRef.current + 1;
      sequenceRef.current = sequence;
      if (kind === "supplier") setIsSupplierLoading(true);
      else setIsProductLoading(true);

      try {
        const params = new URLSearchParams({ kind, q: query, limit: "50" });
        if (selectedId) params.set("selected_id", selectedId);
        const response = await fetchApi<RemoteLookups>(`/api/prices/lookups?${params.toString()}`);
        if (sequenceRef.current !== sequence) return;

        if (kind === "supplier") {
          setSupplierOptions(
            response.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))
          );
        } else {
          setProductOptions(
            response.products.map((product) => ({
              value: product.id,
              label: product.designation,
              keywords: [product.reference ?? ""].filter(Boolean),
            }))
          );
        }
      } finally {
        if (sequenceRef.current === sequence) {
          if (kind === "supplier") setIsSupplierLoading(false);
          else setIsProductLoading(false);
        }
      }
    },
    []
  );

  const searchSuppliers = useCallback(
    (query: string) => {
      if (supplierTimer.current !== null) window.clearTimeout(supplierTimer.current);
      supplierTimer.current = window.setTimeout(() => {
        void fetchRemoteOptions("supplier", query, selectedSupplierId);
      }, 250);
    },
    [fetchRemoteOptions, selectedSupplierId]
  );

  const searchProducts = useCallback(
    (query: string) => {
      if (productTimer.current !== null) window.clearTimeout(productTimer.current);
      productTimer.current = window.setTimeout(() => {
        void fetchRemoteOptions("product", query, selectedProductId);
      }, 250);
    },
    [fetchRemoteOptions, selectedProductId]
  );

  const fetchImportLookups = useCallback(async () => {
    setIsImportLookupsLoading(true);
    try {
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
      const nextLookups = { suppliers, products };
      setLookups(nextLookups);
      return nextLookups;
    } finally {
      setIsImportLookupsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!formOpen) return;
    void Promise.all([
      fetchRemoteOptions("supplier", "", selectedSupplierId),
      fetchRemoteOptions("product", "", selectedProductId),
    ]).catch((error: unknown) => console.error(error));
  }, [fetchRemoteOptions, formOpen, selectedProductId, selectedSupplierId]);

  useEffect(() => {
    if (!importOpen) return;
    void fetchImportLookups().catch((error: unknown) => console.error(error));
  }, [fetchImportLookups, importOpen]);

  useEffect(
    () => () => {
      if (supplierTimer.current !== null) window.clearTimeout(supplierTimer.current);
      if (productTimer.current !== null) window.clearTimeout(productTimer.current);
    },
    []
  );

  const reloadLookups = useCallback(async () => {
    if (importOpen) return fetchImportLookups();
    if (formOpen) {
      await Promise.all([
        fetchRemoteOptions("supplier", "", selectedSupplierId),
        fetchRemoteOptions("product", "", selectedProductId),
      ]);
    }
    return undefined;
  }, [
    fetchImportLookups,
    fetchRemoteOptions,
    formOpen,
    importOpen,
    selectedProductId,
    selectedSupplierId,
  ]);

  return {
    lookups,
    supplierOptions,
    productOptions,
    isSupplierLoading,
    isProductLoading,
    isImportLookupsLoading,
    searchSuppliers,
    searchProducts,
    reloadLookups,
  };
}
