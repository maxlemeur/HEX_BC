import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import {
  ESTIMATE_QUALITY_FLAG_META,
  type EstimateQualityFlagCounts,
  type EstimateQualityFlagsByItemId,
} from "@/lib/estimate-quality";
import type { ExportColumn } from "@/lib/export";
import {
  readLaborSplitFields,
  type EstimateItem,
  type EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import {
  isRecord,
  toNonEmptyString,
  toNullableFiniteNumber,
} from "@/lib/estimates/editor-values";
import {
  formatCurrency,
  normalizeEstimateCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";

export const DEFAULT_ESTIMATE_CURRENCY: SupportedEstimateCurrency = "EUR";

export type EstimateRecapExportRow = {
  project_name: string;
  version_id: string;
  version_number: number;
  status: EstimateVersionRow["status"];
  date_devis: string;
  validite_jours: number;
  margin_multiplier: number;
  discount_cents: number;
  discount_bp: number;
  tax_rate_bp: number;
  rounding_mode: EstimateVersionRow["rounding_mode"];
  rounding_step_cents: number;
  sale_subtotal_cents: number;
  sale_total_cents: number;
  tax_cents: number;
  ttc_cents: number;
  quality_lines_count: number;
  quality_flags_count: number;
};

export type EstimateLineExportRow = {
  section_path: string;
  designation: string;
  quality_flags: string;
  unit: string;
  quantity: number | "";
  unit_price_ht_cents: number | "";
  supply_type: string;
  supplier_1: string;
  supplier_2: string;
  supplier_3: string;
  k_fo: number | "";
  h_mo: number | "";
  h_mo_majoration_pct: number | "";
  labor_role: string;
  k_mo: number | "";
  h_mo_atelier: number | "";
  labor_role_atelier: string;
  k_mo_atelier: number | "";
  h_mo_chantier: number | "";
  labor_role_chantier: string;
  k_mo_chantier: number | "";
  pu_ht_cents: number | "";
  line_total_ht_cents: number | "";
  tax_rate_bp: number | "";
  line_total_ttc_cents: number | "";
};

export type SupplierComparisonAlternative = {
  supplier_name: string;
  adjusted_unit_price_cents: number | null;
  unit_price_cents: number | null;
  currency: string | null;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
};

export type SupplierComparisonsByItemId = Map<
  string,
  SupplierComparisonAlternative[]
>;

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function resolveItemTitle(
  value: string | null | undefined,
  fallback: string
): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function resolveEstimateCurrency(
  value: string | null | undefined
): SupportedEstimateCurrency {
  return normalizeEstimateCurrency(value) ?? DEFAULT_ESTIMATE_CURRENCY;
}

export function buildEstimateExportFilename(input: {
  projectName: string;
  versionNumber?: number | null;
  date?: Date;
}): string {
  const dateLabel = (input.date ?? new Date()).toISOString().split("T")[0];
  const namePart = input.projectName.trim() || "chiffrage";
  const versionLabel =
    input.versionNumber === null || input.versionNumber === undefined
      ? ""
      : `V${input.versionNumber}`;
  const raw = [namePart, versionLabel, dateLabel].filter(Boolean).join("_");
  const sanitized = sanitizeFilename(raw);
  return sanitized || `chiffrage_${dateLabel}`;
}

export function buildEstimateRecapRow(input: {
  projectName: string;
  version: EstimateVersionRow | null;
  settings: EstimateSettingsState | null;
  totals: EstimateTotals | null;
  qualityCounts: EstimateQualityFlagCounts;
}): EstimateRecapExportRow | null {
  const { version, settings, totals } = input;
  if (!version || !settings || !totals) return null;

  const discountBase = totals.saleSubtotalCents;
  const discountBp =
    discountBase > 0
      ? Math.round((totals.discountCents / discountBase) * 10000)
      : 0;

  return {
    project_name: input.projectName || "Chiffrage",
    version_id: version.id,
    version_number: version.version_number,
    status: version.status,
    date_devis: settings.date_devis,
    validite_jours: settings.validite_jours,
    margin_multiplier: totals.appliedMarginMultiplier,
    discount_cents: totals.discountCents,
    discount_bp: discountBp,
    tax_rate_bp: settings.tax_rate_bp,
    rounding_mode: settings.rounding_mode,
    rounding_step_cents: settings.rounding_step_cents,
    sale_subtotal_cents: totals.saleSubtotalCents,
    sale_total_cents: totals.saleTotalCents,
    tax_cents: totals.adjustedTaxCents,
    ttc_cents: totals.roundedTtcCents,
    quality_lines_count: input.qualityCounts.linesWithAnomaliesCount,
    quality_flags_count: input.qualityCounts.totalFlagsCount,
  };
}

function formatSupplierComparisonDate(value: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeSupplierComparisonAlternative(
  value: unknown
): SupplierComparisonAlternative | null {
  if (!isRecord(value)) return null;

  return {
    supplier_name:
      toNonEmptyString(value.supplier_name) ??
      toNonEmptyString(value.name) ??
      "Fournisseur",
    adjusted_unit_price_cents: toNullableFiniteNumber(
      value.adjusted_unit_price_cents
    ),
    unit_price_cents: toNullableFiniteNumber(value.unit_price_cents),
    currency: toNonEmptyString(value.currency),
    supplier_reference:
      toNonEmptyString(value.supplier_reference) ??
      toNonEmptyString(value.reference),
    catalogue_url:
      toNonEmptyString(value.catalogue_url) ?? toNonEmptyString(value.url),
    updated_at:
      toNonEmptyString(value.updated_at) ?? toNonEmptyString(value.date),
  };
}

function normalizeSupplierComparisonAlternatives(
  value: unknown
): SupplierComparisonAlternative[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeSupplierComparisonAlternative(entry))
    .filter((entry): entry is SupplierComparisonAlternative => entry !== null)
    .slice(0, 3);
}

function readSupplierComparisonEntry(
  entry: unknown,
  fallbackItemId?: string
): { itemId: string; alternatives: SupplierComparisonAlternative[] } | null {
  if (!isRecord(entry)) return null;

  const itemId =
    toNonEmptyString(entry.item_id) ??
    toNonEmptyString(entry.itemId) ??
    toNonEmptyString(entry.estimate_item_id) ??
    fallbackItemId ??
    null;

  if (!itemId) return null;

  const alternatives =
    [
      normalizeSupplierComparisonAlternatives(entry.alternatives),
      normalizeSupplierComparisonAlternatives(entry.suppliers),
      normalizeSupplierComparisonAlternatives(entry.options),
    ].find((candidate) => candidate.length > 0) ?? [];

  if (alternatives.length === 0) return null;
  return { itemId, alternatives };
}

export function normalizeSupplierComparisonsByItemId(
  payload: unknown
): SupplierComparisonsByItemId {
  const map: SupplierComparisonsByItemId = new Map();

  const pushEntry = (entry: unknown, fallbackItemId?: string) => {
    const parsed = readSupplierComparisonEntry(entry, fallbackItemId);
    if (!parsed) return;
    map.set(parsed.itemId, parsed.alternatives);
  };

  const readContainer = (container: unknown) => {
    if (Array.isArray(container)) {
      container.forEach((entry) => pushEntry(entry));
      return;
    }

    if (!isRecord(container)) return;

    if (
      toNonEmptyString(container.item_id) ||
      toNonEmptyString(container.itemId) ||
      toNonEmptyString(container.estimate_item_id)
    ) {
      pushEntry(container);
    }

    const arrayKeys = ["comparisons", "items", "lines", "results", "data"];
    arrayKeys.forEach((key) => {
      if (Array.isArray(container[key])) {
        (container[key] as unknown[]).forEach((entry) => pushEntry(entry));
      }
    });

    Object.entries(container).forEach(([itemId, value]) => {
      pushEntry(value, itemId);
    });
  };

  readContainer(payload);
  if (isRecord(payload)) {
    readContainer(payload.data);
  }

  return map;
}

function formatSupplierAlternativeCompact(
  alternative: SupplierComparisonAlternative | undefined,
  estimateCurrency: SupportedEstimateCurrency
): string {
  if (!alternative) return "";

  const unitPriceCents =
    alternative.adjusted_unit_price_cents ?? alternative.unit_price_cents;
  const currency = resolveEstimateCurrency(
    alternative.currency ?? estimateCurrency
  );
  const priceLabel =
    unitPriceCents === null ? "-" : formatCurrency(unitPriceCents, currency);
  const supplierReference =
    toNonEmptyString(alternative.supplier_reference) ?? "-";
  const catalogueUrl = toNonEmptyString(alternative.catalogue_url) ?? "-";
  const updatedAt = formatSupplierComparisonDate(alternative.updated_at);

  return `${alternative.supplier_name} | ${priceLabel} | ${supplierReference} | ${catalogueUrl} | ${updatedAt}`;
}

export function buildSectionPathResolver(
  items: EstimateItem[]
): (item: EstimateItem) => string {
  const byId = new Map<string, EstimateItem>();
  items.forEach((item) => {
    byId.set(item.id, item);
  });

  const cache = new Map<string, string>();

  return (item: EstimateItem) => {
    if (item.item_type !== "line") return "";
    const cached = cache.get(item.id);
    if (cached !== undefined) return cached;

    const parts: string[] = [];
    let currentParentId = item.parent_id;
    while (currentParentId) {
      const parent = byId.get(currentParentId);
      if (!parent) break;
      if (parent.item_type === "section") {
        parts.push(resolveItemTitle(parent.title, "Sans titre"));
      }
      currentParentId = parent.parent_id;
    }

    const path = parts.reverse().join(" > ");
    cache.set(item.id, path);
    return path;
  };
}

export function buildEstimateLineExportRows(input: {
  items: EstimateItem[];
  currency: SupportedEstimateCurrency;
  supplyTypeById: ReadonlyMap<string, { name: string }>;
  laborRoleById: ReadonlyMap<string, { name: string }>;
  qualityFlagsByItemId: EstimateQualityFlagsByItemId;
  supplierComparisonsByItemId?: SupplierComparisonsByItemId;
}): EstimateLineExportRow[] {
  const resolveSectionPath = buildSectionPathResolver(input.items);
  const comparisonsByItemId =
    input.supplierComparisonsByItemId ?? new Map();

  return input.items
    .filter((item) => item.item_type === "line")
    .map((item) => {
      const splitFields = readLaborSplitFields(item);
      const supplyTypeLabel = item.supply_type_id
        ? input.supplyTypeById.get(item.supply_type_id)?.name ?? ""
        : "";
      const laborLabel = item.labor_role_id
        ? input.laborRoleById.get(item.labor_role_id)?.name ?? ""
        : "";
      const laborAtelierLabel = splitFields.labor_role_atelier_id
        ? input.laborRoleById.get(splitFields.labor_role_atelier_id)?.name ?? ""
        : "";
      const laborChantierLabel = splitFields.labor_role_chantier_id
        ? input.laborRoleById.get(splitFields.labor_role_chantier_id)?.name ?? ""
        : "";
      const qualityFlagsLabel = (input.qualityFlagsByItemId[item.id] ?? [])
        .map((flag) => ESTIMATE_QUALITY_FLAG_META[flag].label)
        .join(" | ");
      const supplierAlternatives = comparisonsByItemId.get(item.id) ?? [];

      return {
        section_path: resolveSectionPath(item),
        designation: resolveItemTitle(item.title, "Sans titre"),
        quality_flags: qualityFlagsLabel,
        unit: item.description?.trim() ?? "",
        quantity: item.quantity ?? "",
        unit_price_ht_cents: item.unit_price_ht_cents ?? "",
        supply_type: supplyTypeLabel,
        supplier_1: formatSupplierAlternativeCompact(
          supplierAlternatives[0],
          input.currency
        ),
        supplier_2: formatSupplierAlternativeCompact(
          supplierAlternatives[1],
          input.currency
        ),
        supplier_3: formatSupplierAlternativeCompact(
          supplierAlternatives[2],
          input.currency
        ),
        k_fo: item.k_fo ?? "",
        h_mo: item.h_mo ?? "",
        h_mo_majoration_pct:
          item.h_mo_majoration === null ||
          item.h_mo_majoration === undefined
            ? ""
            : Math.round(item.h_mo_majoration * 10000) / 100,
        labor_role: laborLabel,
        k_mo: item.k_mo ?? "",
        h_mo_atelier: splitFields.h_mo_atelier ?? "",
        labor_role_atelier: laborAtelierLabel,
        k_mo_atelier: splitFields.k_mo_atelier ?? "",
        h_mo_chantier: splitFields.h_mo_chantier ?? "",
        labor_role_chantier: laborChantierLabel,
        k_mo_chantier: splitFields.k_mo_chantier ?? "",
        pu_ht_cents: item.pu_ht_cents ?? "",
        line_total_ht_cents: item.line_total_ht_cents ?? "",
        tax_rate_bp: item.tax_rate_bp ?? "",
        line_total_ttc_cents: item.line_total_ttc_cents ?? "",
      };
    });
}

const LINE_EXPORT_COLUMNS: ExportColumn<EstimateLineExportRow>[] = [
  { key: "section_path", header: "Chemin chapitre" },
  { key: "designation", header: "Designation" },
  { key: "quality_flags", header: "Flags qualite" },
  { key: "unit", header: "Unite" },
  { key: "quantity", header: "Quantité" },
  {
    key: "unit_price_ht_cents",
    header: "Prix unitaire HT (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  { key: "supply_type", header: "Type FO" },
  { key: "supplier_1", header: "Fournisseur 1" },
  { key: "supplier_2", header: "Fournisseur 2" },
  { key: "supplier_3", header: "Fournisseur 3" },
  { key: "k_fo", header: "K FO" },
  { key: "h_mo", header: "h MO" },
  { key: "h_mo_majoration_pct", header: "Majoration MO (%)" },
  { key: "labor_role", header: "Role MO" },
  { key: "k_mo", header: "K MO" },
  {
    key: "pu_ht_cents",
    header: "PU HT (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  {
    key: "line_total_ht_cents",
    header: "Total HT (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  {
    key: "tax_rate_bp",
    header: "TVA (%)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  {
    key: "line_total_ttc_cents",
    header: "Total TTC (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
];

const LINE_EXPORT_COLUMNS_WITH_LABOR_SPLIT: ExportColumn<EstimateLineExportRow>[] = [
  ...LINE_EXPORT_COLUMNS,
  { key: "h_mo_atelier", header: "h MO atelier" },
  { key: "labor_role_atelier", header: "Role MO atelier" },
  { key: "k_mo_atelier", header: "K MO atelier" },
  { key: "h_mo_chantier", header: "h MO chantier" },
  { key: "labor_role_chantier", header: "Role MO chantier" },
  { key: "k_mo_chantier", header: "K MO chantier" },
];

export function getEstimateLineExportColumns(
  isLaborSplitEnabled: boolean
): ExportColumn<EstimateLineExportRow>[] {
  return isLaborSplitEnabled
    ? LINE_EXPORT_COLUMNS_WITH_LABOR_SPLIT
    : LINE_EXPORT_COLUMNS;
}
