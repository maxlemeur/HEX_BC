"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

import {
  CATALOGUE_SUGGESTIONS_DEBOUNCE_MS,
  type CataloguePriceSuggestion,
  type EstimateItem,
  type ItemPatch,
  type SupplierAlternative,
  fetchCatalogueSuggestions,
} from "@/components/estimates/components/estimate-editor-row/shared";
import { type SpreadsheetEditorProps } from "@/hooks/useSpreadsheetNavigation";

type UseCatalogueSuggestionsOptions = {
  versionId: string;
  item: EstimateItem;
  isReadOnly: boolean;
  titleEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
};

export function useCatalogueSuggestions({
  versionId,
  item,
  isReadOnly,
  titleEditorProps,
  onPatchItem,
}: UseCatalogueSuggestionsOptions) {
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [catalogueSuggestions, setCatalogueSuggestions] = useState<
    CataloguePriceSuggestion[]
  >([]);
  const [isCatalogueLoading, setIsCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [activeCatalogueSuggestionIndex, setActiveCatalogueSuggestionIndex] =
    useState(0);
  const catalogueBlurTimeoutRef = useRef<number | null>(null);
  const catalogueAbortRef = useRef<AbortController | null>(null);
  const catalogueListboxId = `estimate-catalogue-suggestions-${item.id}`;

  const clearCatalogueBlurTimeout = useCallback(() => {
    if (catalogueBlurTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(catalogueBlurTimeoutRef.current);
    catalogueBlurTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    if (item.item_type !== "line") {
      setCatalogueSuggestions([]);
      setCatalogueError(null);
      setIsCatalogueLoading(false);
      return;
    }

    if (!versionId || !isTitleFocused || isReadOnly) {
      setIsCatalogueLoading(false);
      setCatalogueError(null);
      if (!isTitleFocused) {
        setCatalogueSuggestions([]);
      }
      return;
    }

    const normalizedQuery = item.title.trim();
    if (normalizedQuery.length < 2) {
      setCatalogueSuggestions([]);
      setCatalogueError(null);
      setIsCatalogueLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (catalogueAbortRef.current) {
        catalogueAbortRef.current.abort();
      }

      const abortController = new AbortController();
      catalogueAbortRef.current = abortController;
      setIsCatalogueLoading(true);
      setCatalogueError(null);

      void fetchCatalogueSuggestions(
        versionId,
        normalizedQuery,
        abortController.signal
      )
        .then((suggestions) => {
          setCatalogueSuggestions(suggestions);
          setActiveCatalogueSuggestionIndex(0);
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) {
            return;
          }

          setCatalogueSuggestions([]);
          setCatalogueError(
            error instanceof Error
              ? error.message
              : "Impossible de charger les suggestions catalogue."
          );
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setIsCatalogueLoading(false);
          }
        });
    }, CATALOGUE_SUGGESTIONS_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      if (catalogueAbortRef.current) {
        catalogueAbortRef.current.abort();
      }
    };
  }, [isReadOnly, isTitleFocused, item.item_type, item.title, versionId]);

  useEffect(() => {
    setActiveCatalogueSuggestionIndex((previous) => {
      if (catalogueSuggestions.length === 0) {
        return 0;
      }

      return Math.min(previous, catalogueSuggestions.length - 1);
    });
  }, [catalogueSuggestions.length]);

  useEffect(() => {
    return () => {
      clearCatalogueBlurTimeout();
      if (catalogueAbortRef.current) {
        catalogueAbortRef.current.abort();
      }
    };
  }, [clearCatalogueBlurTimeout]);

  const showCatalogueSuggestions =
    item.item_type === "line" &&
    isTitleFocused &&
    (catalogueSuggestions.length > 0 ||
      isCatalogueLoading ||
      Boolean(catalogueError));

  const applyCatalogueSuggestion = useCallback(
    (suggestion: CataloguePriceSuggestion, alternative?: SupplierAlternative) => {
      if (isReadOnly || item.item_type !== "line") {
        return;
      }

      const selectedSupplierPriceId =
        alternative?.supplier_price_id ?? suggestion.supplier_price_id;
      const selectedDescription = suggestion.product_designation.trim();
      const selectedAdjustedUnitPrice =
        alternative?.adjusted_unit_price_cents ??
        suggestion.adjusted_unit_price_cents;

      const patch: ItemPatch = {
        title: selectedDescription,
        description: selectedDescription.length > 0 ? selectedDescription : null,
        unit_price_ht_cents: selectedAdjustedUnitPrice,
        selected_supplier_price_id: selectedSupplierPriceId,
      };

      onPatchItem(item.id, patch, { persist: true });
      setIsTitleFocused(false);
    },
    [isReadOnly, item.id, item.item_type, onPatchItem]
  );

  const handleLineTitleFocus = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      clearCatalogueBlurTimeout();
      setIsTitleFocused(true);
      titleEditorProps.onFocus(event);
    },
    [clearCatalogueBlurTimeout, titleEditorProps]
  );

  const handleLineTitleBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      titleEditorProps.onBlur(event);
      clearCatalogueBlurTimeout();
      catalogueBlurTimeoutRef.current = window.setTimeout(() => {
        setIsTitleFocused(false);
      }, 120);

      const nextTitle = event.target.value.trim() || "Nouvelle ligne";
      onPatchItem(item.id, { title: nextTitle }, { persist: true });
    },
    [clearCatalogueBlurTimeout, item.id, onPatchItem, titleEditorProps]
  );

  const handleLineTitleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (showCatalogueSuggestions && catalogueSuggestions.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveCatalogueSuggestionIndex((previous) =>
            Math.min(previous + 1, catalogueSuggestions.length - 1)
          );
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveCatalogueSuggestionIndex((previous) =>
            Math.max(previous - 1, 0)
          );
          return;
        }

        if (event.key === "Enter") {
          const activeSuggestion =
            catalogueSuggestions[activeCatalogueSuggestionIndex];
          if (activeSuggestion) {
            event.preventDefault();
            applyCatalogueSuggestion(activeSuggestion);
            return;
          }
        }
      }

      if (event.key === "Escape" && showCatalogueSuggestions) {
        event.preventDefault();
        setIsTitleFocused(false);
        return;
      }

      titleEditorProps.onKeyDown(event);
    },
    [
      activeCatalogueSuggestionIndex,
      applyCatalogueSuggestion,
      catalogueSuggestions,
      showCatalogueSuggestions,
      titleEditorProps,
    ]
  );

  return {
    catalogueSuggestions,
    isCatalogueLoading,
    catalogueError,
    activeCatalogueSuggestionIndex,
    catalogueListboxId,
    showCatalogueSuggestions,
    applyCatalogueSuggestion,
    clearCatalogueBlurTimeout,
    handleLineTitleFocus,
    handleLineTitleBlur,
    handleLineTitleKeyDown,
  };
}
