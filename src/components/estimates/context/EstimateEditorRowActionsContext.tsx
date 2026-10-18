"use client";

import { createContext, useContext, type ReactNode } from "react";

import { type MultiSelectItemInteraction } from "@/hooks/useMultiSelect";
import { type EstimateOutlierFlagKey } from "@/lib/estimates/outlier-detection";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type LaborSplitItemFields = {
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
};

export type EstimateEditorRowItemPatch = Partial<
  Pick<
    EstimateItem,
    | "title"
    | "aid"
    | "line_nature"
    | "description"
    | "quantity"
    | "unit_price_ht_cents"
    | "tax_rate_bp"
    | "k_fo"
    | "h_mo"
    | "h_mo_majoration"
    | "k_mo"
    | "pu_ht_cents"
    | "labor_role_id"
    | "category_id"
    | "supply_type_id"
    | "product_id"
    | "selected_supplier_price_id"
    // Lot 2, sous-lot 2.6 : saisies d'une ligne v3 (D4, D9), jamais leurs totaux dérivés.
    | "unit_code" | "pricing_status" | "h_mo_per_unit" | "h_mo_atelier_per_unit" | "h_mo_chantier_per_unit"
  >
> &
  LaborSplitItemFields;

export type EstimateEditorRowActionsContextValue = {
  onDeleteItem: (itemId: string) => void;
  onOpenSupplierComparisonPanel: (itemId: string) => void;
  onOpenArticle: (itemId: string) => void;
  onAssociateArticle: (itemId: string) => void;
  onOpenSupplierComparisonContextMenu: (
    itemId: string,
    position: { x: number; y: number }
  ) => void;
  onOpenSectionContextMenu: (
    sectionId: string,
    position: { x: number; y: number }
  ) => void;
  onPatchItem: (
    itemId: string,
    patch: EstimateEditorRowItemPatch,
    options?: { persist?: boolean }
  ) => void;
  onUnitChange: (itemId: string, value: string) => void;
  onUnitCommit: (itemId: string) => void;
  onAddLine: (parentId: string | null) => void;
  onAddSection: (parentId: string | null) => void;
  onConvertLineToSection: (lineId: string) => void;
  onToggleOutlierDismiss: (
    itemId: string,
    flagKey: EstimateOutlierFlagKey,
    dismissed: boolean
  ) => void;
  onLineSelectionInteraction: (interaction: MultiSelectItemInteraction) => void;
};

const EstimateEditorRowActionsContext =
  createContext<EstimateEditorRowActionsContextValue | null>(null);

type EstimateEditorRowActionsProviderProps = {
  value: EstimateEditorRowActionsContextValue;
  children: ReactNode;
};

export function EstimateEditorRowActionsProvider({
  value,
  children,
}: EstimateEditorRowActionsProviderProps) {
  return (
    <EstimateEditorRowActionsContext.Provider value={value}>
      {children}
    </EstimateEditorRowActionsContext.Provider>
  );
}

export function useEstimateEditorRowActions() {
  const context = useContext(EstimateEditorRowActionsContext);
  if (!context) {
    throw new Error(
      "Estimate row actions context is unavailable outside provider."
    );
  }
  return context;
}
