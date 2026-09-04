"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SupplierComparisonAlternative } from "@/components/estimates/SupplierComparisonPanel";
import type { Database } from "@/types/database";
import { isSupplierAlternativeCurrencyCompatible } from "@/lib/estimates/supplier-preselection";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

type SupplierComparisonContextMenuState = {
  itemId: string;
  x: number;
  y: number;
};

type SupplierComparisonPatch = {
  description: string | null;
  unit_price_ht_cents: number;
  selected_supplier_price_id: string | null;
};

export type SupplierComparisonResult = {
  item_id: string;
  best_supplier_price_id: string | null;
  selected_supplier_price_id: string | null;
  alternatives: SupplierComparisonAlternative[];
};

type UseEstimateSupplierComparisonParams = {
  versionId: string;
  /** Devise du devis : un prix libelle dans une autre devise n est pas injectable. */
  estimateCurrency: string;
  itemById: Map<string, EstimateItem>;
  isReadOnly: boolean;
  fetchSupplierComparison: (
    versionId: string,
    itemId: string,
    signal: AbortSignal
  ) => Promise<SupplierComparisonResult>;
  onPatchItemWithSuggestionTracking: (
    itemId: string,
    patch: SupplierComparisonPatch,
    options?: { persist?: boolean }
  ) => void;
};

export function useEstimateSupplierComparison({
  versionId,
  estimateCurrency,
  itemById,
  isReadOnly,
  fetchSupplierComparison,
  onPatchItemWithSuggestionTracking,
}: UseEstimateSupplierComparisonParams) {
  const [supplierComparisonMenu, setSupplierComparisonMenu] =
    useState<SupplierComparisonContextMenuState | null>(null);
  const [supplierComparisonPanelItemId, setSupplierComparisonPanelItemId] =
    useState<string | null>(null);
  const [supplierComparisonByItemId, setSupplierComparisonByItemId] = useState<
    Record<string, SupplierComparisonResult>
  >({});
  const [bestSupplierPriceIdByItemId, setBestSupplierPriceIdByItemId] = useState<
    Record<string, string | null>
  >({});
  const [isSupplierComparisonLoading, setIsSupplierComparisonLoading] = useState(false);
  const [supplierComparisonError, setSupplierComparisonError] = useState<string | null>(
    null
  );
  const supplierComparisonAbortRef = useRef<AbortController | null>(null);

  const closeSupplierComparisonContextMenu = useCallback(() => {
    setSupplierComparisonMenu(null);
  }, []);

  const loadSupplierComparison = useCallback(
    async (itemId: string) => {
      if (!versionId) {
        setSupplierComparisonError("Version de devis invalide.");
        return;
      }

      if (supplierComparisonAbortRef.current) {
        supplierComparisonAbortRef.current.abort();
      }

      const abortController = new AbortController();
      supplierComparisonAbortRef.current = abortController;

      setIsSupplierComparisonLoading(true);
      setSupplierComparisonError(null);

      try {
        const comparison = await fetchSupplierComparison(
          versionId,
          itemId,
          abortController.signal
        );

        if (abortController.signal.aborted) return;

        setSupplierComparisonByItemId((prev) => ({
          ...prev,
          [itemId]: comparison,
        }));
        setBestSupplierPriceIdByItemId((prev) => ({
          ...prev,
          [itemId]: comparison.best_supplier_price_id,
        }));
      } catch (error) {
        if (abortController.signal.aborted) return;

        setSupplierComparisonError(
          error instanceof Error
            ? error.message
            : "Impossible de charger la comparaison fournisseurs."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsSupplierComparisonLoading(false);
        }
      }
    },
    [fetchSupplierComparison, versionId]
  );

  const openSupplierComparisonPanel = useCallback(
    (itemId: string) => {
      const item = itemById.get(itemId);
      if (!item || item.item_type !== "line") return;

      setSupplierComparisonPanelItemId(itemId);
      setSupplierComparisonError(null);
      void loadSupplierComparison(itemId);
    },
    [itemById, loadSupplierComparison]
  );

  const handleOpenSupplierComparisonContextMenu = useCallback(
    (itemId: string, position: { x: number; y: number }) => {
      const item = itemById.get(itemId);
      if (!item || item.item_type !== "line") return;

      const menuWidth = 240;
      const menuHeight = 288;
      const x = Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8));
      const y = Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8));

      setSupplierComparisonMenu({
        itemId,
        x,
        y,
      });
    },
    [itemById]
  );

  const handleCloseSupplierComparisonPanel = useCallback(() => {
    setSupplierComparisonPanelItemId(null);
    setSupplierComparisonError(null);
    setIsSupplierComparisonLoading(false);
    if (supplierComparisonAbortRef.current) {
      supplierComparisonAbortRef.current.abort();
      supplierComparisonAbortRef.current = null;
    }
  }, []);

  const activeSupplierComparisonItem = useMemo(() => {
    if (!supplierComparisonPanelItemId) return null;
    const item = itemById.get(supplierComparisonPanelItemId);
    return item && item.item_type === "line" ? item : null;
  }, [itemById, supplierComparisonPanelItemId]);

  const activeSupplierComparison = useMemo(() => {
    if (!supplierComparisonPanelItemId) return null;
    return supplierComparisonByItemId[supplierComparisonPanelItemId] ?? null;
  }, [supplierComparisonByItemId, supplierComparisonPanelItemId]);

  const handleSelectSupplierComparisonAlternative = useCallback(
    (alternative: SupplierComparisonAlternative) => {
      if (isReadOnly || !activeSupplierComparisonItem) return;
      // Filet de securite : le panneau desactive deja ces options, mais injecter
      // un montant en devise etrangere le ferait passer pour un montant dans la
      // devise du devis — erreur monetaire silencieuse. Meme predicat que la
      // preselection automatique.
      if (!isSupplierAlternativeCurrencyCompatible(alternative, estimateCurrency)) {
        return;
      }

      const selectedDescription = (alternative.product_designation ?? "").trim();
      onPatchItemWithSuggestionTracking(
        activeSupplierComparisonItem.id,
        {
          description: selectedDescription.length > 0 ? selectedDescription : null,
          unit_price_ht_cents: alternative.adjusted_unit_price_cents,
          selected_supplier_price_id: alternative.supplier_price_id,
        },
        { persist: true }
      );
      setSupplierComparisonPanelItemId(null);
    },
    [
      activeSupplierComparisonItem,
      estimateCurrency,
      isReadOnly,
      onPatchItemWithSuggestionTracking,
    ]
  );

  useEffect(() => {
    return () => {
      if (supplierComparisonAbortRef.current) {
        supplierComparisonAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!supplierComparisonMenu) return;

    const closeMenu = () => setSupplierComparisonMenu(null);
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".estimate-supplier-comparison-context-menu")
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, { capture: true, passive: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, { capture: true } as EventListenerOptions);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [supplierComparisonMenu]);

  useEffect(() => {
    if (!supplierComparisonPanelItemId) return;
    const item = itemById.get(supplierComparisonPanelItemId);
    if (!item || item.item_type !== "line") {
      setSupplierComparisonPanelItemId(null);
    }
  }, [itemById, supplierComparisonPanelItemId]);

  return {
    supplierComparisonMenu,
    closeSupplierComparisonContextMenu,
    handleOpenSupplierComparisonContextMenu,
    openSupplierComparisonPanel,
    handleCloseSupplierComparisonPanel,
    activeSupplierComparisonItem,
    activeSupplierComparison,
    bestSupplierPriceIdByItemId,
    isSupplierComparisonLoading,
    supplierComparisonError,
    handleSelectSupplierComparisonAlternative,
  };
}

export type UseEstimateSupplierComparisonResult = ReturnType<
  typeof useEstimateSupplierComparison
>;
