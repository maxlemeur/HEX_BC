"use client";

import { useCallback } from "react";

import type { EstimateColumnId } from "@/hooks/useEstimateColumnWidths";
import { useEstimatePreferenceKey, useEstimatePreferenceStorage } from "@/hooks/useEstimatePreferenceStorage";

// Preserve the pinned designation and the meaningful cost/sale groups.
export const ESTIMATE_COLUMN_GROUPS: readonly (readonly EstimateColumnId[])[] = [
  ["designation"],
  ["quantity", "unit"],
  ["supply_price", "supply_type", "k_fo", "supplier"],
  ["labor_hours", "h_mo_majoration", "labor_role", "k_mo"],
  ["labor_hours_workshop", "labor_role_workshop", "k_mo_workshop"],
  ["labor_hours_site", "labor_role_site", "k_mo_site"],
  ["ds", "marge", "marque"],
  ["unit_price", "total_price"],
];

export const DEFAULT_ESTIMATE_COLUMN_ORDER = ESTIMATE_COLUMN_GROUPS.flat();

export const SPREADSHEET_ESTIMATE_COLUMN_IDS: Record<string, EstimateColumnId> = {
  title: "designation", quantity: "quantity", unit: "unit", unit_price: "supply_price",
  supply_type: "supply_type", k_fo: "k_fo", h_mo: "labor_hours",
  supplier: "supplier",
  h_mo_majoration: "h_mo_majoration", labor_role: "labor_role", k_mo: "k_mo",
  h_mo_atelier: "labor_hours_workshop", labor_role_atelier: "labor_role_workshop",
  k_mo_atelier: "k_mo_workshop", h_mo_chantier: "labor_hours_site",
  labor_role_chantier: "labor_role_site", k_mo_chantier: "k_mo_site",
  pu_ht: "unit_price", line_total_ht: "total_price",
};

export const ESTIMATE_COLUMN_LABELS: Record<EstimateColumnId, string> = {
  designation: "Désignation", quantity: "Quantité", unit: "Unité",
  supply_price: "Prix FO", supply_type: "Type FO", k_fo: "K FO",
  supplier: "Fournisseur",
  labor_hours: "Heures MO", h_mo_majoration: "Majoration MO",
  labor_role: "Type MO", k_mo: "K MO",
  labor_hours_workshop: "Heures atelier", labor_role_workshop: "Type MO atelier",
  k_mo_workshop: "K MO atelier", labor_hours_site: "Heures chantier",
  labor_role_site: "Type MO chantier", k_mo_site: "K MO chantier",
  ds: "Déboursé sec", marge: "Marge €", marque: "Marque %",
  unit_price: "Prix de vente unitaire", total_price: "Prix total",
};

export function normalizeEstimateColumnOrder(value: unknown): EstimateColumnId[] {
  const known = Array.isArray(value)
    ? [...new Set(value.filter((id): id is EstimateColumnId => DEFAULT_ESTIMATE_COLUMN_ORDER.includes(id)))]
    : [];
  return ESTIMATE_COLUMN_GROUPS.flatMap((group) => [
    ...known.filter((id) => group.includes(id)),
    ...group.filter((id) => !known.includes(id)),
  ]);
}

function parseOrder(raw: string | null) {
  try { return normalizeEstimateColumnOrder(JSON.parse(raw ?? "null")); }
  catch { return normalizeEstimateColumnOrder(null); }
}

export function useEstimateColumnOrder() {
  const key = useEstimatePreferenceKey("est-col-order-v1");
  const [order, setOrder] = useEstimatePreferenceStorage(key, parseOrder);
  const moveColumn = useCallback((id: EstimateColumnId, direction: -1 | 1) => {
    setOrder((current) => {
      const group = ESTIMATE_COLUMN_GROUPS.find((columns) => columns.includes(id));
      const index = current.indexOf(id);
      const target = current[index + direction];
      if (!group || !target || !group.includes(target)) return current;
      const next = [...current];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }, [setOrder]);
  return { order, moveColumn, resetColumnOrder: () => setOrder([...DEFAULT_ESTIMATE_COLUMN_ORDER]) };
}
