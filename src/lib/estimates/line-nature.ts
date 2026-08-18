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

function isEstimateLineNature(value: unknown): value is EstimateLineNature {
  return ESTIMATE_LINE_NATURES.includes(value as EstimateLineNature);
}

export function resolveEstimateLineNature(
  item: LineNatureSource,
): EstimateLineNature {
  if (isEstimateLineNature(item.line_nature)) {
    return item.line_nature;
  }

  const hasSupply =
    (item.unit_price_ht_cents ?? 0) > 0 ||
    Boolean(item.supply_type_id) ||
    Boolean(item.selected_supplier_price_id);
  const hasLabor =
    (item.h_mo ?? 0) > 0 ||
    (item.h_mo_atelier ?? 0) > 0 ||
    (item.h_mo_chantier ?? 0) > 0 ||
    Boolean(item.labor_role_id) ||
    Boolean(item.labor_role_atelier_id) ||
    Boolean(item.labor_role_chantier_id);

  if (hasLabor && !hasSupply) {
    return "labor_only";
  }
  if (hasLabor) {
    return "supply_and_labor";
  }
  return "supply_only";
}

export function lineNatureExpectsSupply(nature: EstimateLineNature) {
  return nature !== "labor_only";
}

export function lineNatureExpectsLabor(nature: EstimateLineNature) {
  return nature !== "supply_only";
}
