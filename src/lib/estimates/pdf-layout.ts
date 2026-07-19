export type EstimatePdfPreset =
  | "client_detailed"
  | "decision_summary"
  | "fo_mo";

export type EstimatePdfDetailLevel = 1 | 2 | 3 | 4 | "lines";

export type EstimatePdfPriceMode =
  | "total_only"
  | "unit_and_total"
  | "fo_mo_and_total";

export type EstimatePdfDensity = "compact" | "standard" | "comfortable";

export type EstimatePdfConditionsPlacement = "auto" | "new_page";

export type EstimatePdfLayoutOptions = {
  preset: EstimatePdfPreset;
  detailLevel: EstimatePdfDetailLevel;
  priceMode: EstimatePdfPriceMode;
  density: EstimatePdfDensity;
  showNumbering: boolean;
  showSectionSubtotals: boolean;
  conditionsPlacement: EstimatePdfConditionsPlacement;
  includeTerms: boolean;
};

export type EstimateTermsPolicy = "optional" | "default" | "required";

export type EstimatePdfTermsConfiguration = {
  available: boolean;
  policy: EstimateTermsPolicy;
  title: string | null;
  version: number | null;
};

export type EstimatePdfLayoutConfiguration = {
  lineCount: number;
  sectionCountsByLevel: Record<"1" | "2" | "3" | "4", number>;
  hasConditions: boolean;
  terms: EstimatePdfTermsConfiguration;
};

export const ESTIMATE_PDF_LAYOUT_STORAGE_VERSION = 1;

export const ESTIMATE_PDF_PRESETS: Record<
  EstimatePdfPreset,
  EstimatePdfLayoutOptions
> = {
  client_detailed: {
    preset: "client_detailed",
    detailLevel: "lines",
    priceMode: "unit_and_total",
    density: "standard",
    showNumbering: true,
    showSectionSubtotals: true,
    conditionsPlacement: "auto",
    includeTerms: false,
  },
  decision_summary: {
    preset: "decision_summary",
    detailLevel: 2,
    priceMode: "total_only",
    density: "compact",
    showNumbering: true,
    showSectionSubtotals: true,
    conditionsPlacement: "auto",
    includeTerms: false,
  },
  fo_mo: {
    preset: "fo_mo",
    detailLevel: "lines",
    priceMode: "fo_mo_and_total",
    density: "standard",
    showNumbering: true,
    showSectionSubtotals: true,
    conditionsPlacement: "auto",
    includeTerms: false,
  },
};

export const DEFAULT_ESTIMATE_PDF_LAYOUT: EstimatePdfLayoutOptions = {
  ...ESTIMATE_PDF_PRESETS.client_detailed,
};

const PRESETS = new Set<EstimatePdfPreset>([
  "client_detailed",
  "decision_summary",
  "fo_mo",
]);
const PRICE_MODES = new Set<EstimatePdfPriceMode>([
  "total_only",
  "unit_and_total",
  "fo_mo_and_total",
]);
const DENSITIES = new Set<EstimatePdfDensity>([
  "compact",
  "standard",
  "comfortable",
]);
const CONDITIONS_PLACEMENTS = new Set<EstimatePdfConditionsPlacement>([
  "auto",
  "new_page",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}

function normalizeDetailLevel(
  value: unknown,
  fallback: EstimatePdfDetailLevel
): EstimatePdfDetailLevel {
  if (value === "lines" || value === "all") return "lines";
  const numericValue =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return numericValue === 1 ||
    numericValue === 2 ||
    numericValue === 3 ||
    numericValue === 4
    ? numericValue
    : fallback;
}

export function normalizeEstimatePdfLayoutOptions(
  value: unknown,
  fallback: EstimatePdfLayoutOptions = DEFAULT_ESTIMATE_PDF_LAYOUT
): EstimatePdfLayoutOptions {
  if (!isRecord(value)) return { ...fallback };

  const preset = PRESETS.has(value.preset as EstimatePdfPreset)
    ? (value.preset as EstimatePdfPreset)
    : fallback.preset;
  const priceMode = PRICE_MODES.has(value.priceMode as EstimatePdfPriceMode)
    ? (value.priceMode as EstimatePdfPriceMode)
    : fallback.priceMode;
  const density = DENSITIES.has(value.density as EstimatePdfDensity)
    ? (value.density as EstimatePdfDensity)
    : fallback.density;
  const conditionsPlacement = CONDITIONS_PLACEMENTS.has(
    value.conditionsPlacement as EstimatePdfConditionsPlacement
  )
    ? (value.conditionsPlacement as EstimatePdfConditionsPlacement)
    : fallback.conditionsPlacement;

  return {
    preset,
    detailLevel: normalizeDetailLevel(value.detailLevel, fallback.detailLevel),
    priceMode,
    density,
    showNumbering: normalizeBoolean(
      value.showNumbering,
      fallback.showNumbering
    ),
    showSectionSubtotals: normalizeBoolean(
      value.showSectionSubtotals,
      fallback.showSectionSubtotals
    ),
    conditionsPlacement,
    includeTerms: normalizeBoolean(value.includeTerms, fallback.includeTerms),
  };
}

export function applyEstimateTermsPolicy(
  layout: EstimatePdfLayoutOptions,
  terms: EstimatePdfTermsConfiguration
): EstimatePdfLayoutOptions {
  if (!terms.available) {
    return { ...layout, includeTerms: false };
  }
  if (terms.policy === "required") {
    return { ...layout, includeTerms: true };
  }
  return layout;
}

type SearchParamValue = string | string[] | undefined;

export function parseEstimatePdfLayoutSearchParams(
  searchParams: Record<string, SearchParamValue>
): EstimatePdfLayoutOptions {
  const first = (value: SearchParamValue) =>
    Array.isArray(value) ? value[0] : value;
  const presetRaw = first(searchParams.preset);
  const preset = PRESETS.has(presetRaw as EstimatePdfPreset)
    ? (presetRaw as EstimatePdfPreset)
    : DEFAULT_ESTIMATE_PDF_LAYOUT.preset;
  const presetDefaults = ESTIMATE_PDF_PRESETS[preset];
  const legacyMaxLevel = first(searchParams.max_level);
  const detailLevel = first(searchParams.detail_level) ?? legacyMaxLevel;

  return normalizeEstimatePdfLayoutOptions(
    {
      preset,
      detailLevel,
      priceMode: first(searchParams.price_mode),
      density: first(searchParams.density),
      showNumbering: first(searchParams.numbering),
      showSectionSubtotals: first(searchParams.subtotals),
      conditionsPlacement: first(searchParams.conditions),
      includeTerms: first(searchParams.terms),
    },
    presetDefaults
  );
}

export function writeEstimatePdfLayoutSearchParams(
  layout: EstimatePdfLayoutOptions,
  target = new URLSearchParams()
) {
  target.set("preset", layout.preset);
  target.set("detail_level", String(layout.detailLevel));
  target.set("price_mode", layout.priceMode);
  target.set("density", layout.density);
  target.set("numbering", layout.showNumbering ? "1" : "0");
  target.set("subtotals", layout.showSectionSubtotals ? "1" : "0");
  target.set("conditions", layout.conditionsPlacement);
  target.set("terms", layout.includeTerms ? "1" : "0");
  target.delete("max_level");
  return target;
}

export function estimateEstimatePdfPageCount(
  layout: EstimatePdfLayoutOptions,
  configuration: EstimatePdfLayoutConfiguration | null
) {
  if (!configuration) return null;

  const sectionCount = Object.entries(
    configuration.sectionCountsByLevel
  ).reduce((total, [level, count]) => {
    if (layout.detailLevel === "lines") return total + count;
    return Number(level) <= layout.detailLevel ? total + count : total;
  }, 0);
  const visibleRows =
    sectionCount +
    (layout.detailLevel === "lines" ? configuration.lineCount : 0);
  const rowsPerPage =
    layout.density === "compact"
      ? 42
      : layout.density === "comfortable"
        ? 27
        : 34;
  const quotePages = Math.max(1, Math.ceil((visibleRows + 13) / rowsPerPage));
  const conditionsPages =
    configuration.hasConditions && layout.conditionsPlacement === "new_page"
      ? 1
      : 0;
  const termsPages = layout.includeTerms && configuration.terms.available ? 1 : 0;

  return quotePages + conditionsPages + termsPages;
}

export function describeEstimatePdfLayout(layout: EstimatePdfLayoutOptions) {
  const detailLabel =
    layout.detailLevel === "lines"
      ? "lignes detaillees"
      : `chapitres jusqu'au niveau ${layout.detailLevel}`;
  const priceLabel =
    layout.priceMode === "total_only"
      ? "total HT"
      : layout.priceMode === "fo_mo_and_total"
        ? "FO, MO et total HT"
        : "prix unitaire et total HT";
  return `${detailLabel}, ${priceLabel}, densite ${layout.density}`;
}
