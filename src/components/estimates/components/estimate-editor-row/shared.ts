"use client";

import { type KeyboardEvent } from "react";

import { type EstimateEditorRowItemPatch } from "@/components/estimates/context/EstimateEditorRowActionsContext";
import { type EstimateQualityFlagKey } from "@/lib/estimate-quality";
import {
  normalizeEstimateCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import type { EstimateLineTruth } from "@/lib/estimates/line-truth";
import {
  type SpreadsheetCell,
  type SpreadsheetNavigationResult,
} from "@/hooks/useSpreadsheetNavigation";
import type { Database } from "@/types/database";

export type { SpreadsheetCell, SpreadsheetNavigationResult };

export type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
  source_level?: string | null;
  source_version_number?: number | null;
  takeoff_level?: string | null;
  source_extracted_at?: string | null;
  source_extraction_date?: string | null;
  extraction_date?: string | null;
  extracted_at?: string | null;
  source_metadata?: unknown;
  line_truth?: EstimateLineTruth | null;
};

export type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
export type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];

export function formatLaborRoleOptionLabel(role: LaborRole) {
  const hourlyRate = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(role.hourly_rate_cents, 0) / 100);

  return `${role.name} — ${hourlyRate} €/h${
    !role.is_active ? " (inactif)" : ""
  }`;
}

export function getMissingLaborRateMessage(
  role: LaborRole | undefined,
  laborHours: number | null | undefined
) {
  if (!role || (laborHours ?? 0) <= 0 || role.hourly_rate_cents > 0) {
    return null;
  }

  return `Le taux horaire de ${role.name} est à 0 €/h : renseignez-le dans Paramétrage pour que h MO et K MO entrent dans le P.U.`;
}

export type LaborSplitItemFields = {
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
};

export type ItemPatch = EstimateEditorRowItemPatch & LaborSplitItemFields;

export type ColumnVisibilitySet = Set<
  "supply_type" | "k_fo" | "h_mo_majoration" | "labor_role" | "k_mo"
>;

export type SupplierAlternativeKind =
  | "best_price"
  | "most_recent"
  | "preferred_supplier";

export type SupplierAlternative = {
  kind: SupplierAlternativeKind;
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  unit_price_cents: number;
  adjusted_unit_price_cents: number;
  currency: string | null;
  supplier_reference: string | null;
  unit: string | null;
  updated_at: string | null;
  is_stale: boolean;
  catalogue_url: string | null;
};

export type CataloguePriceSuggestion = {
  supplier_price_id: string;
  product_id: string;
  product_designation: string;
  product_reference: string | null;
  product_category?: string | null;
  product_type?: string | null;
  product_material?: string | null;
  product_grade?: string | null;
  product_dimensions?: string | null;
  product_standard?: string | null;
  supplier_id: string;
  supplier_name: string;
  supplier_reference: string | null;
  unit: string | null;
  unit_price_cents: number;
  adjusted_unit_price_cents: number;
  currency: string | null;
  updated_at: string | null;
  is_stale: boolean;
  stale_days: number;
  relevance_score: number;
  has_material_index_adjustment: boolean;
  material_index_code: string | null;
  material_index_value: number | null;
  catalogue_url: string | null;
  supplier_offer_count?: number;
  alternatives: SupplierAlternative[];
};

type SuggestPricesResponse = {
  query: string;
  stale_price_days: number;
  suggestions: CataloguePriceSuggestion[];
};

export const CATALOGUE_SUGGESTIONS_DEBOUNCE_MS = 300;

export const SPREADSHEET_COLUMN_KEYS = {
  title: "title",
  quantity: "quantity",
  unit: "unit",
  unitPrice: "unit_price",
  supplyType: "supply_type",
  kFo: "k_fo",
  hMo: "h_mo",
  hMoAtelier: "h_mo_atelier",
  laborRoleAtelier: "labor_role_atelier",
  kMoAtelier: "k_mo_atelier",
  hMoChantier: "h_mo_chantier",
  laborRoleChantier: "labor_role_chantier",
  kMoChantier: "k_mo_chantier",
  hMoMajoration: "h_mo_majoration",
  laborRole: "labor_role",
  kMo: "k_mo",
  pu: "pu_ht",
  total: "line_total_ht",
} as const;

export function getQualityFlagCellTarget(
  flag: EstimateQualityFlagKey,
  options: {
    isLaborSplitEnabled: boolean;
    isLaborRoleVisible: boolean;
  }
) {
  switch (flag) {
    case "missing_price":
      return SPREADSHEET_COLUMN_KEYS.unitPrice;
    case "missing_quantity":
      return SPREADSHEET_COLUMN_KEYS.quantity;
    case "missing_labor_time":
      return options.isLaborSplitEnabled
        ? SPREADSHEET_COLUMN_KEYS.hMoAtelier
        : SPREADSHEET_COLUMN_KEYS.hMo;
    case "missing_labor_role":
      if (options.isLaborSplitEnabled) {
        return SPREADSHEET_COLUMN_KEYS.laborRoleAtelier;
      }
      return options.isLaborRoleVisible
        ? SPREADSHEET_COLUMN_KEYS.laborRole
        : null;
    case "labor_split_incomplete":
      return options.isLaborSplitEnabled
        ? SPREADSHEET_COLUMN_KEYS.hMoAtelier
        : null;
    default:
      return null;
  }
}

const SECTION_SPREADSHEET_COLUMN_KEYS = [SPREADSHEET_COLUMN_KEYS.title];

const LINE_SPREADSHEET_COLUMN_KEYS = [
  SPREADSHEET_COLUMN_KEYS.title,
  SPREADSHEET_COLUMN_KEYS.quantity,
  SPREADSHEET_COLUMN_KEYS.unit,
  SPREADSHEET_COLUMN_KEYS.unitPrice,
  SPREADSHEET_COLUMN_KEYS.supplyType,
  SPREADSHEET_COLUMN_KEYS.kFo,
  SPREADSHEET_COLUMN_KEYS.hMo,
  SPREADSHEET_COLUMN_KEYS.hMoMajoration,
  SPREADSHEET_COLUMN_KEYS.laborRole,
  SPREADSHEET_COLUMN_KEYS.kMo,
  SPREADSHEET_COLUMN_KEYS.pu,
  SPREADSHEET_COLUMN_KEYS.total,
];

const LINE_SPREADSHEET_COLUMN_KEYS_LABOR_SPLIT = [
  SPREADSHEET_COLUMN_KEYS.title,
  SPREADSHEET_COLUMN_KEYS.quantity,
  SPREADSHEET_COLUMN_KEYS.unit,
  SPREADSHEET_COLUMN_KEYS.unitPrice,
  SPREADSHEET_COLUMN_KEYS.supplyType,
  SPREADSHEET_COLUMN_KEYS.kFo,
  SPREADSHEET_COLUMN_KEYS.hMoMajoration,
  SPREADSHEET_COLUMN_KEYS.hMoAtelier,
  SPREADSHEET_COLUMN_KEYS.laborRoleAtelier,
  SPREADSHEET_COLUMN_KEYS.kMoAtelier,
  SPREADSHEET_COLUMN_KEYS.hMoChantier,
  SPREADSHEET_COLUMN_KEYS.laborRoleChantier,
  SPREADSHEET_COLUMN_KEYS.kMoChantier,
  SPREADSHEET_COLUMN_KEYS.pu,
  SPREADSHEET_COLUMN_KEYS.total,
];

export function getSpreadsheetColumnKeys(
  itemType: EstimateItem["item_type"],
  isLaborSplitEnabled: boolean
) {
  return itemType === "section"
    ? SECTION_SPREADSHEET_COLUMN_KEYS
    : isLaborSplitEnabled
      ? LINE_SPREADSHEET_COLUMN_KEYS_LABOR_SPLIT
      : LINE_SPREADSHEET_COLUMN_KEYS;
}

export function toCellClassName(
  navigation: SpreadsheetNavigationResult,
  cell: SpreadsheetCell,
  baseClassName: string
) {
  const classNames = [baseClassName, "estimate-cell--focusable"];

  if (navigation.isCellActive(cell)) {
    classNames.push("estimate-cell--active");
  }

  if (navigation.isCellEditing(cell)) {
    classNames.push("estimate-cell--editing");
  }

  return classNames.join(" ");
}

export function toCellKeyDownHandler(
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    onKeyDown(event);
  };
}

export function formatCentsInput(cents: number | null) {
  if (!Number.isFinite(cents ?? NaN)) return "";
  return ((cents ?? 0) / 100).toFixed(2);
}

export function parseNumberInput(value: string) {
  const normalized = value.replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Comme parseNumberInput mais renvoie `null` pour une saisie vide ou invalide,
 * afin de distinguer un vrai « 0 » d'un champ effacé. Utilisé par les cellules
 * de coefficient (K FO / K MO) pour retomber sur une valeur neutre plutôt que
 * d'enregistrer 0 (qui annulerait le coût fourniture / main-d'œuvre).
 */
export function parseDecimalDraft(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatMajorationPercentInput(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return "100";
  const percent = (value ?? 1) * 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
}

export function parseMajorationPercentToCoefficient(value: string) {
  return Math.max(parseNumberInput(value) / 100, 0);
}

export function normalizeAidInput(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function formatNumberDisplay(
  value: number,
  options?: { minDecimals?: number; maxDecimals?: number }
) {
  const minDecimals = options?.minDecimals ?? 0;
  const maxDecimals = options?.maxDecimals ?? minDecimals;
  const formatter = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  });
  return formatter.format(value);
}

export function formatCompactDate(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  return date.toLocaleDateString("fr-FR");
}

export function toAlternativeKindLabel(kind: SupplierAlternativeKind) {
  switch (kind) {
    case "best_price":
      return "Meilleur prix";
    case "most_recent":
      return "Plus recent";
    case "preferred_supplier":
      return "Fournisseur prefere";
    default:
      return kind;
  }
}

export function resolveDisplayCurrency(
  value: string | null | undefined,
  fallback: SupportedEstimateCurrency
) {
  return normalizeEstimateCurrency(value) ?? fallback;
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readSourceMetadataText(item: EstimateItem, keys: string[]) {
  const itemRecord = item as Record<string, unknown>;

  for (const key of keys) {
    const directValue = toNonEmptyString(itemRecord[key]);
    if (directValue) {
      return directValue;
    }
  }

  const sourceMetadata = itemRecord.source_metadata;
  if (
    typeof sourceMetadata === "object" &&
    sourceMetadata !== null &&
    !Array.isArray(sourceMetadata)
  ) {
    const metadataRecord = sourceMetadata as Record<string, unknown>;
    for (const key of keys) {
      const metadataValue = toNonEmptyString(metadataRecord[key]);
      if (metadataValue) {
        return metadataValue;
      }
    }
  }

  return null;
}

export function readLaborSplitFields(
  source: EstimateItem | Record<string, unknown>
): Required<LaborSplitItemFields> {
  const record = source as Record<string, unknown>;
  return {
    h_mo_atelier: toFiniteNumber(record.h_mo_atelier, 0),
    k_mo_atelier: toFiniteNumber(record.k_mo_atelier, 1),
    labor_role_atelier_id: toNonEmptyString(record.labor_role_atelier_id),
    h_mo_chantier: toFiniteNumber(record.h_mo_chantier, 0),
    k_mo_chantier: toFiniteNumber(record.k_mo_chantier, 1),
    labor_role_chantier_id: toNonEmptyString(record.labor_role_chantier_id),
  };
}

function resolveApiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const nestedError =
    typeof record.error === "object" &&
    record.error !== null &&
    !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : null;

  if (typeof nestedError?.message === "string" && nestedError.message.trim().length > 0) {
    return nestedError.message;
  }

  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message;
  }

  return fallback;
}

export async function fetchCatalogueSuggestions(
  versionId: string,
  query: string,
  signal: AbortSignal
): Promise<CataloguePriceSuggestion[]> {
  const response = await fetch(
    `/api/estimates/${versionId}/suggest-prices?q=${encodeURIComponent(query)}`,
    {
      method: "GET",
      cache: "no-store",
      signal,
    }
  );

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      resolveApiErrorMessage(payload, "Impossible de charger les suggestions catalogue.")
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const envelope = payload as {
    ok?: boolean;
    data?: SuggestPricesResponse;
  };
  const suggestions =
    envelope.ok && Array.isArray(envelope.data?.suggestions)
      ? envelope.data.suggestions
      : [];

  return suggestions.slice(0, 10);
}
