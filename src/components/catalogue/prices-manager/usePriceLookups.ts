"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { PriceBookLookupsStatus } from "@/components/catalogue/price-book-csv-import/types";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { PriceBookLookups } from "@/lib/catalogue/csv-import";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const LOOKUP_PAGE_SIZE = 1000;
// A page that never answers would block the import for good: past this wait it fails and can be retried.
const LOOKUP_PAGE_TIMEOUT_MS = 15_000;

type LookupRows<T> = {
  data: T[] | null;
  error: { message?: string | null } | null;
};

type RemoteLookups = PriceBookLookups;

async function fetchAllLookupRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<LookupRows<T>>,
  load: AbortController
) {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    // Raced, not only aborted: supabase-js awaits the session token before it starts the request.
    let timeout: number | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = window.setTimeout(() => {
        load.abort();
        reject(new Error("Les référentiels n’ont pas répondu à temps."));
      }, LOOKUP_PAGE_TIMEOUT_MS);
    });
    let page: LookupRows<T>;
    try {
      page = await Promise.race([fetchPage(offset, offset + LOOKUP_PAGE_SIZE - 1), timedOut]);
    } finally {
      window.clearTimeout(timeout);
    }
    const { data, error } = page;
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
  const [supplierOptions, setSupplierOptions] = useState<ComboboxOption[]>([]);
  const [productOptions, setProductOptions] = useState<ComboboxOption[]>([]);
  const [isSupplierLoading, setIsSupplierLoading] = useState(false);
  const [isProductLoading, setIsProductLoading] = useState(false);
  // Not ready until a load succeeds: an open import starts by loading its lookups, the server render included.
  const [importLookupsStatus, setImportLookupsStatus] = useState<PriceBookLookupsStatus>("loading");
  const supplierSequence = useRef(0);
  const productSequence = useRef(0);
  const importSequence = useRef(0);
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

  // Rejects on failure for callers that revalidate with the result; only the latest load sets the status.
  const fetchImportLookups = useCallback(async () => {
    const sequence = importSequence.current + 1;
    importSequence.current = sequence;
    const load = new AbortController();
    setImportLookupsStatus("loading");
    try {
      const [suppliers, products] = await Promise.all([
        fetchAllLookupRows<{ id: string; name: string }>(
          (from, to) =>
            supabase
              .from("suppliers")
              .select("id, name")
              .order("name")
              .range(from, to)
              .abortSignal(load.signal),
          load
        ),
        fetchAllLookupRows<{ id: string; designation: string; reference?: string | null }>(
          (from, to) =>
            supabase
              .from("products")
              .select("id, designation, reference")
              .order("designation")
              .range(from, to)
              .abortSignal(load.signal),
          load
        ),
      ]);
      const nextLookups = { suppliers, products };
      if (importSequence.current === sequence) {
        setLookups(nextLookups);
        setImportLookupsStatus("ready");
      }
      return nextLookups;
    } catch (error) {
      // The other table's pages are useless once one fails.
      load.abort();
      if (importSequence.current === sequence) setImportLookupsStatus("error");
      throw error;
    }
  }, [supabase]);

  // Opening the import and its retry action: the outcome is shown by the status.
  const loadImportLookups = useCallback(() => {
    void fetchImportLookups().catch((error: unknown) => console.error(error));
  }, [fetchImportLookups]);

  // Closing the import forgets its outcome: reopening must not flash a stale alert or readiness.
  const forgetImportLookups = useCallback(() => {
    importSequence.current += 1;
    setImportLookupsStatus("loading");
  }, []);

  useEffect(() => {
    if (!formOpen) return;
    void Promise.all([
      fetchRemoteOptions("supplier", "", selectedSupplierId),
      fetchRemoteOptions("product", "", selectedProductId),
    ]).catch((error: unknown) => console.error(error));
  }, [fetchRemoteOptions, formOpen, selectedProductId, selectedSupplierId]);

  useEffect(() => {
    if (!importOpen) return;
    loadImportLookups();
    return forgetImportLookups;
  }, [forgetImportLookups, importOpen, loadImportLookups]);

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
    importLookupsStatus,
    searchSuppliers,
    searchProducts,
    reloadLookups,
    retryImportLookups: loadImportLookups,
  };
}
