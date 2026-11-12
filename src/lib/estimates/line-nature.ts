export const ESTIMATE_LINE_NATURES = [
  "supply_only",
  "supply_and_labor",
  "labor_only",
  "pose_only",
] as const;

/**
 * TI-539 : mots validés de la mention, dans l'éditeur et sur le devis imprimé. « POSE SEULE » est une
 * prestation de pose dont la fourniture n'est pas due : son coût de fourniture nul est voulu, et sa
 * main-d'œuvre reste facturée. Elle peut porter une petite fourniture nécessaire à la pose (supportage ;
 * réponse de Maxime du 11/11/2026). C'est un choix explicite de l'utilisateur : aucune création, aucun import
 * ni aucune saisie ne la déduit d'un prix vide ou nul (une ligne sans fourniture déduite reste
 * « Main-d'œuvre seule », qui n'imprime rien).
 */
export const POSE_ONLY_MENTION = "POSE SEULE";

export type EstimateLineNature = (typeof ESTIMATE_LINE_NATURES)[number];

export const ESTIMATE_LINE_NATURE_LABELS: Record<EstimateLineNature, string> = {
  supply_only: "Fournitures seules",
  supply_and_labor: "Fournitures + pose",
  labor_only: "Pose",
  pose_only: POSE_ONLY_MENTION,
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
 * Désignation imprimée d'une ligne POSE SEULE (aperçu, PDF, portail). La mention suit la désignation sans tiret
 * long, comme dans les devis de Maxime (« Ballon ECS 30 litres POSE SEULE », sa réponse du 11/11/2026) ; un titre
 * qui la porte déjà ne la répète pas.
 */
export function poseOnlyDesignation(title: string): string {
  return /\bpose\s+seule\b/i.test(title) ? title : `${title} ${POSE_ONLY_MENTION}`;
}

/** Vrai pour une ligne que l'utilisateur a explicitement notée POSE SEULE (TI-539). */
export function isPoseOnlyLine(item: {
  item_type?: string | null;
  line_nature?: EstimateLineNature | null;
}) {
  return item.item_type !== "section" && item.line_nature === "pose_only";
}

/**
 * Natures offered by a line's select. The POSE SEULE mention is carried by the engine-3 client contract only:
 * on another engine it would show on the preview and be absent from the issued PDF, so it is not offered there.
 * A line that already carries it keeps the option.
 */
export function selectableEstimateLineNatures(input: {
  printsPoseOnly: boolean;
  current: EstimateLineNature;
}): readonly EstimateLineNature[] {
  if (input.printsPoseOnly) return ESTIMATE_LINE_NATURES.filter((nature) => nature !== "labor_only");
  return ESTIMATE_LINE_NATURES.filter(
    (nature) => nature !== "pose_only" || input.printsPoseOnly || input.current === "pose_only",
  );
}

/**
 * Promotes a line when an edit introduces the component excluded by its
 * current nature. It deliberately never demotes a line: a missing value can
 * be temporary and the explicit nature remains the validation intent.
 * POSE SEULE is never promoted: a supply value entered on it is a small supply
 * needed for the fitting (supports), and the line keeps its nature.
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
  return nature !== "labor_only" && nature !== "pose_only";
}

export function lineNatureExpectsLabor(nature: EstimateLineNature) {
  return nature !== "supply_only";
}
