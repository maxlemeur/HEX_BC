"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { CatalogueItem } from "@/components/catalogue/types";
import { fetchCatalogueSuggestions } from "@/components/estimates/components/estimate-editor-row/shared";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CataloguePriceSuggestion } from "@/lib/estimates/catalogue-suggestions";
import { formatCurrency } from "@/lib/money";
import type { SupportedEstimateCurrency } from "@/lib/money";

type EstimateArticleSheetMode = "view" | "associate";

type EstimateArticleSheetProps = {
  isOpen: boolean;
  mode: EstimateArticleSheetMode;
  versionId: string;
  lineTitle: string;
  productId: string | null;
  currency: SupportedEstimateCurrency;
  isReadOnly: boolean;
  onClose: () => void;
  onAssociate: (suggestion: CataloguePriceSuggestion) => void;
  onDetach: () => void;
};

type CatalogueListResponse = {
  items: CatalogueItem[];
};

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function ProductDetails({ product }: { product: CatalogueItem }) {
  const details = [
    ["Référence", optionalText(product.reference)],
    ["Unité", optionalText(product.unit)],
    ["Catégorie", optionalText(product.category)],
    ["Type", optionalText(product.product_type)],
    ["Matière", optionalText(product.material)],
    ["Nuance", optionalText(product.grade)],
    ["Dimensions", optionalText(product.dimensions)],
    ["Norme", optionalText(product.standard)],
  ].filter((entry): entry is [string, string] => entry[1] !== null);

  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="font-medium text-foreground">{product.designation}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Prix de référence : {formatCurrency(product.unit_price_cents ?? 0, "EUR")}
        </p>
        {product.is_active === false ? (
          <p className="mt-2 text-sm text-amber-700">Article archivé</p>
        ) : null}
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-3 text-sm">
        {details.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function EstimateArticleSheet({
  isOpen,
  mode,
  versionId,
  lineTitle,
  productId,
  currency,
  isReadOnly,
  onClose,
  onAssociate,
  onDetach,
}: EstimateArticleSheetProps) {
  const [query, setQuery] = useState(lineTitle);
  const [suggestions, setSuggestions] = useState<CataloguePriceSuggestion[]>([]);
  const [product, setProduct] = useState<CatalogueItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery(lineTitle);
    setSuggestions([]);
    setProduct(null);
    setError(null);
  }, [isOpen, lineTitle, mode, productId]);

  useEffect(() => {
    if (!isOpen || mode !== "view" || !productId) return;
    const abortController = new AbortController();
    setIsLoading(true);
    setError(null);

    void fetchApi<CatalogueListResponse>(
      `/api/catalogue?id=${encodeURIComponent(productId)}&include_inactive=true&limit=1`,
      { signal: abortController.signal },
    )
      .then((data) => {
        if (abortController.signal.aborted) return;
        const nextProduct = data.items[0] ?? null;
        setProduct(nextProduct);
        if (!nextProduct) setError("Article introuvable ou inaccessible.");
      })
      .catch((loadError) => {
        if (abortController.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Impossible de charger la fiche article.",
        );
      })
      .finally(() => {
        if (!abortController.signal.aborted) setIsLoading(false);
      });

    return () => abortController.abort();
  }, [isOpen, mode, productId]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!isOpen || mode !== "associate" || trimmedQuery.length < 2) {
      setSuggestions([]);
      return;
    }

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      setError(null);
      void fetchCatalogueSuggestions(versionId, trimmedQuery, abortController.signal)
        .then((data) => {
          if (!abortController.signal.aborted) setSuggestions(data);
        })
        .catch((loadError) => {
          if (abortController.signal.aborted) return;
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de rechercher les articles.",
          );
        })
        .finally(() => {
          if (!abortController.signal.aborted) setIsLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [isOpen, mode, query, versionId]);

  const title = mode === "view" ? "Fiche article" : "Associer ou remplacer l’article";
  const description = useMemo(
    () =>
      mode === "view"
        ? `Article associé à la ligne « ${lineTitle} ».`
        : "Recherchez un article du catalogue. Sa désignation et son prix deviennent l’instantané de la ligne.",
    [lineTitle, mode],
  );

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        {mode === "view" ? (
          <>
            {isLoading ? <p className="px-4 text-sm text-muted-foreground">Chargement…</p> : null}
            {error ? <p className="px-4 text-sm text-destructive">{error}</p> : null}
            {product ? <ProductDetails product={product} /> : null}
            {!isReadOnly && productId ? (
              <div className="mt-auto border-t p-4">
                <button
                  type="button"
                  className="text-sm font-medium text-destructive hover:underline"
                  onClick={onDetach}
                >
                  Dissocier l’article de la ligne
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-6">
            <label className="space-y-1">
              <span className="text-sm font-medium">Rechercher dans le catalogue</span>
              <input
                autoFocus
                className="h-10 w-full rounded-md border bg-background px-3 outline-none focus:border-primary"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Désignation ou référence"
              />
            </label>
            {isLoading ? <p className="text-sm text-muted-foreground">Recherche…</p> : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {!isLoading && !error && query.trim().length >= 2 && suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun article trouvé.</p>
            ) : null}
            <div className="min-h-0 overflow-y-auto rounded-md border">
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion.product_id}
                  className="flex w-full items-start justify-between gap-3 border-b p-3 text-left last:border-b-0 hover:bg-muted/50 focus:bg-muted/50"
                  onClick={() => onAssociate(suggestion)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {suggestion.product_designation}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {suggestion.product_reference ?? "Sans référence"}
                      {suggestion.supplier_name ? ` · ${suggestion.supplier_name}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium">
                    {formatCurrency(suggestion.adjusted_unit_price_cents, currency)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
