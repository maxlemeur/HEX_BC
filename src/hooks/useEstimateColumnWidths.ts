"use client";

import { useCallback, useState } from "react";

export type EstimateColumnId =
  | "designation"
  | "quantity"
  | "unit"
  | "supply_price"
  | "supply_type"
  | "k_fo"
  | "labor_hours"
  | "h_mo_majoration"
  | "labor_hours_workshop"
  | "labor_role_workshop"
  | "k_mo_workshop"
  | "labor_hours_site"
  | "labor_role_site"
  | "k_mo_site"
  | "labor_role"
  | "k_mo"
  | "ds"
  | "marge"
  | "marque"
  | "unit_price"
  | "total_price";

export type EstimateColumnWidths = Partial<Record<EstimateColumnId, number>>;

const STORAGE_KEY = "est-col-widths-v1";
const COLUMN_IDS = new Set<EstimateColumnId>([
  "designation",
  "quantity",
  "unit",
  "supply_price",
  "supply_type",
  "k_fo",
  "labor_hours",
  "h_mo_majoration",
  "labor_hours_workshop",
  "labor_role_workshop",
  "k_mo_workshop",
  "labor_hours_site",
  "labor_role_site",
  "k_mo_site",
  "labor_role",
  "k_mo",
  "ds",
  "marge",
  "marque",
  "unit_price",
  "total_price",
]);

export function getEstimateColumnWidthBounds(columnId: EstimateColumnId) {
  if (columnId === "designation") {
    return { min: 220, max: 640 } as const;
  }
  return { min: 48, max: 320 } as const;
}

export function clampEstimateColumnWidth(
  columnId: EstimateColumnId,
  width: number,
) {
  const { min, max } = getEstimateColumnWidthBounds(columnId);
  return Math.round(Math.min(max, Math.max(min, width)));
}

export function parseEstimateColumnWidths(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([columnId, width]) => {
        if (
          !COLUMN_IDS.has(columnId as EstimateColumnId) ||
          typeof width !== "number" ||
          !Number.isFinite(width)
        ) {
          return [];
        }
        return [
          [
            columnId,
            clampEstimateColumnWidth(columnId as EstimateColumnId, width),
          ],
        ];
      }),
    ) as EstimateColumnWidths;
  } catch {
    return {};
  }
}

function loadColumnWidths() {
  if (typeof window === "undefined") return {};
  try {
    return parseEstimateColumnWidths(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function saveColumnWidths(widths: EstimateColumnWidths) {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(widths).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Les préférences de largeur restent facultatives si le stockage est bloqué.
  }
}

export function useEstimateColumnWidths() {
  const [widths, setWidths] = useState<EstimateColumnWidths>(loadColumnWidths);

  const setColumnWidth = useCallback(
    (columnId: EstimateColumnId, width: number) => {
      setWidths((current) => {
        const next = {
          ...current,
          [columnId]: clampEstimateColumnWidth(columnId, width),
        };
        saveColumnWidths(next);
        return next;
      });
    },
    [],
  );

  const resetColumnWidth = useCallback((columnId: EstimateColumnId) => {
    setWidths((current) => {
      if (current[columnId] === undefined) return current;
      const next = { ...current };
      delete next[columnId];
      saveColumnWidths(next);
      return next;
    });
  }, []);

  return { widths, setColumnWidth, resetColumnWidth };
}
