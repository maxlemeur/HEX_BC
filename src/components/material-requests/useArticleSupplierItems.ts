"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { fetchArticleSuppliers } from "@/lib/catalogue/supplier-items-client";
import type { ArticleSupplierItem } from "@/lib/material-requests/supplier-contracts";

/**
 * The suppliers of the articles named (TI-691), each read once for the page view: a line that has a
 * supplier shows the article's reference there. An article whose read failed shows no reference; its
 * line still shows its supplier.
 */
export function useArticleSupplierItems(productIds: readonly string[]): ReadonlyMap<string, ArticleSupplierItem[]> {
  const [items, setItems] = useState<ReadonlyMap<string, ArticleSupplierItem[]>>(new Map());
  /** Answered, successfully or not: never asked again for this page view. */
  const settled = useRef(new Set<string>());
  const key = useMemo(() => [...new Set(productIds)].sort().join(","), [productIds]);

  useEffect(() => {
    const missing = key ? key.split(",").filter((id) => !settled.current.has(id)) : [];
    if (missing.length === 0) return;
    // A change of the list meanwhile aborts these reads; the next run asks again for what is not settled.
    const abort = new AbortController();
    for (const id of missing) {
      fetchArticleSuppliers(id, abort.signal)
        .then((answer) => {
          if (abort.signal.aborted) return;
          settled.current.add(id);
          setItems((current) => new Map(current).set(id, answer.items));
        })
        .catch(() => {
          if (!abort.signal.aborted) settled.current.add(id);
        });
    }
    return () => abort.abort();
  }, [key]);

  return items;
}

/** The article's reference at the line's supplier, while that supplier is still one of the article's. */
export function supplierItemOf(
  items: ReadonlyMap<string, ArticleSupplierItem[]>,
  productId: string | null,
  supplierId: string | null,
): ArticleSupplierItem | null {
  if (!productId || !supplierId) return null;
  return items.get(productId)?.find((item) => item.supplier_id === supplierId && item.is_active) ?? null;
}
