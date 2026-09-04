export const ESTIMATE_LINE_NATURES = [
  "supply_only",
  "supply_and_labor",
  "labor_only",
] as const;

export type EstimateLineNature = (typeof ESTIMATE_LINE_NATURES)[number];

export const ESTIMATE_LINE_NATURE_LABELS: Record<EstimateLineNature, string> = {
  supply_only: "Fournitures seules",
  supply_and_labor: "Fournitures + main-d’œuvre",
  labor_only: "Main-d’œuvre seule",
};

type LineNatureSource = {
  line_nature?: EstimateLineNature | null;
  unit_price_ht_cents?: number | null;
  supply_type_id?: string | null;
  selected_supplier_price_id?: string | null;
  h_mo?: number | null;
  h_mo_atelier?: number | null;
  h_mo_chantier?: number | null;
  labor_role_id?: string | null;
  labor_role_atelier_id?: string | null;
  labor_role_chantier_id?: string | null;
};

type LineNaturePatch = Partial<LineNatureSource>;

const SUPPLY_COMPONENT_KEYS = [
  "unit_price_ht_cents",
  "supply_type_id",
  "selected_supplier_price_id",
] as const;

const LABOR_COMPONENT_KEYS = [
  "h_mo",
  "h_mo_atelier",
  "h_mo_chantier",
  "labor_role_id",
  "labor_role_atelier_id",
  "labor_role_chantier_id",
] as const;

function isEstimateLineNature(value: unknown): value is EstimateLineNature {
  return ESTIMATE_LINE_NATURES.includes(value as EstimateLineNature);
}

function hasSupplyComponent(item: LineNatureSource) {
  return (
    (item.unit_price_ht_cents ?? 0) > 0 ||
    Boolean(item.supply_type_id) ||
    Boolean(item.selected_supplier_price_id)
  );
}

function hasLaborComponent(item: LineNatureSource) {
  return (
    (item.h_mo ?? 0) > 0 ||
    (item.h_mo_atelier ?? 0) > 0 ||
    (item.h_mo_chantier ?? 0) > 0 ||
    Boolean(item.labor_role_id) ||
    Boolean(item.labor_role_atelier_id) ||
    Boolean(item.labor_role_chantier_id)
  );
}

function patchTouchesAny(
  patch: LineNaturePatch,
  keys: readonly (keyof LineNatureSource)[],
) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
}

export function resolveEstimateLineNature(
  item: LineNatureSource,
): EstimateLineNature {
  if (isEstimateLineNature(item.line_nature)) {
    return item.line_nature;
  }

  const hasSupply = hasSupplyComponent(item);
  const hasLabor = hasLaborComponent(item);

  if (hasLabor && !hasSupply) {
    return "labor_only";
  }
  if (hasLabor) {
    return "supply_and_labor";
  }
  return "supply_only";
}

/**
 * Promotes a line when an edit introduces the component excluded by its
 * current nature. It deliberately never demotes a line: a missing value can
 * be temporary and the explicit nature remains the validation intent.
 */
export function resolvePromotedEstimateLineNature(
  current: LineNatureSource,
  patch: LineNaturePatch,
): EstimateLineNature {
  if (isEstimateLineNature(patch.line_nature)) {
    return patch.line_nature;
  }

  const currentNature = resolveEstimateLineNature(current);
  if (currentNature === "supply_and_labor") {
    return currentNature;
  }

  const next = { ...current, ...patch };
  if (
    currentNature === "supply_only" &&
    patchTouchesAny(patch, LABOR_COMPONENT_KEYS) &&
    hasLaborComponent(next)
  ) {
    return "supply_and_labor";
  }

  if (
    currentNature === "labor_only" &&
    patchTouchesAny(patch, SUPPLY_COMPONENT_KEYS) &&
    hasSupplyComponent(next)
  ) {
    return "supply_and_labor";
  }

  return currentNature;
}

export function lineNatureExpectsSupply(nature: EstimateLineNature) {
  return nature !== "labor_only";
}

export function lineNatureExpectsLabor(nature: EstimateLineNature) {
  return nature !== "supply_only";
}
