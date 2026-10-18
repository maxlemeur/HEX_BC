"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SupplierComparisonAlternative } from "@/components/estimates/SupplierComparisonPanel";
import { useEstimateV3Grid } from "@/components/estimates/v3/V3LineCells";
import type { Database } from "@/types/database";
import { supplierOfferIneligibility } from "@/lib/estimates/supplier-offer-eligibility";
import { alternativePriceForLineUnit } from "@/lib/estimates/supplier-offer-purchase-unit";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

type SupplierComparisonContextMenuState = {
  itemId: string;
  x: number;
  y: number;
};

type SupplierComparisonPatch = {
  /** v1/v2 only: the unit of a v3 line is its referential unit_code (sub-lot 2.6, F26-20). */
  description?: string | null;
  unit_price_ht_cents: number;
  selected_supplier_price_id: string | null;
};

export type SupplierComparisonResult = {
  item_id: string;
  stale_price_days?: number | null;
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
  // Lot 2, sub-lot 2.6 (F26-20): the unit of a v3 line is its referential unit_code, never description
  // (empty on a v3 line); v1/v2 keep description. Every offer is judged and priced in that unit.
  const isV3 = useEstimateV3Grid() !== null;
  const activeSupplierComparisonUnit = activeSupplierComparisonItem
    ? (isV3 ? activeSupplierComparisonItem.unit_code : activeSupplierComparisonItem.description)
    : null;

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
      if (supplierOfferIneligibility(alternative, {
        currency: estimateCurrency,
        quantity: activeSupplierComparisonItem.quantity,
        unit: activeSupplierComparisonUnit,
      })) {
        return;
      }

      // 2.9: a converted offer serves the line in the unit it is written in: per metre through the
      // conversion, per bar for a line already in bars; the line never takes the other unit by surprise.
      const linePrice = alternativePriceForLineUnit(alternative, activeSupplierComparisonUnit);
      const selectedUnit = linePrice.unit?.trim() || activeSupplierComparisonUnit;
      onPatchItemWithSuggestionTracking(
        activeSupplierComparisonItem.id,
        {
          // A v3 line keeps its unit_code; only its PR FO and the offer change.
          ...(isV3 ? {} : { description: selectedUnit || null }),
          unit_price_ht_cents: linePrice.priceCents,
          selected_supplier_price_id: alternative.supplier_price_id,
        },
        { persist: true }
      );
      setSupplierComparisonPanelItemId(null);
    },
    [
      activeSupplierComparisonItem,
      activeSupplierComparisonUnit,
      estimateCurrency,
      isReadOnly,
      isV3,
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
    activeSupplierComparisonUnit,
    activeSupplierComparison,
    supplierComparisonByItemId,
    bestSupplierPriceIdByItemId,
    isSupplierComparisonLoading,
    supplierComparisonError,
    handleSelectSupplierComparisonAlternative,
  };
}

export type UseEstimateSupplierComparisonResult = ReturnType<
  typeof useEstimateSupplierComparison
>;
