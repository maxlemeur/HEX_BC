/**
 * Lot 2, sous-lot 2.4 - types publics du moteur v3 (forme JSON canonique partagée avec le jumeau
 * SQL `private.estimate_v3_compute_items`). Noms de colonnes du schéma (snake_case, §6.2).
 */

/** Nombre JS (lu par `String(n)`) ou chaîne décimale exacte. */
export type V3Numeric = number | string;

export type EstimateV3PricingStatus =
  | "priced"
  | "included"
  | "for_memory"
  | "not_priced"
  | "out_of_scope"
  | "not_applicable";

export type EstimateV3RoundingMode = "none" | "down";

export type EstimateV3Params = {
  sale_coefficient_fo: V3Numeric;
  sale_coefficient_mo: V3Numeric;
  /** Intention en montant (exclusive d'un `discount_bp` non nul). */
  discount_amount_cents: V3Numeric | null;
  /** Intention en taux, 0 à 10 000. */
  discount_bp: V3Numeric;
  rounding_mode: EstimateV3RoundingMode;
  rounding_step_cents: V3Numeric;
  reverse_charge: boolean;
  labor_split_enabled: boolean;
};

export type EstimateV3ItemInput = {
  id: string;
  item_type: "section" | "line";
  parent_id: string | null;
  quantity: V3Numeric | null;
  unit_price_ht_cents: V3Numeric | null;
  k_fo: V3Numeric | null;
  /** TI-534 : provision FO de la ligne, `numeric(4,3)` ; absente ou nulle = 1 (comme le jumeau SQL). */
  fo_provision?: V3Numeric | null;
  h_mo_per_unit: V3Numeric | null;
  h_mo_atelier_per_unit: V3Numeric | null;
  h_mo_chantier_per_unit: V3Numeric | null;
  h_mo_majoration: V3Numeric | null;
  k_mo: V3Numeric | null;
  k_mo_atelier: V3Numeric | null;
  k_mo_chantier: V3Numeric | null;
  /** Taux horaire du rôle du propriétaire (centimes/h), verrouillé par l'appelant. */
  labor_rate_cents: V3Numeric | null;
  labor_rate_atelier_cents: V3Numeric | null;
  labor_rate_chantier_cents: V3Numeric | null;
  pricing_status: EstimateV3PricingStatus;
  tax_rate_bp: V3Numeric | null;
  unit_code: string | null;
};

export type EstimateV3Input = {
  params: EstimateV3Params;
  items: EstimateV3ItemInput[];
};

/** Ligne de sortie canonique (ordre des clés = contrat de parité). */
export type EstimateV3CanonicalLine = {
  id: string;
  pu_ht_cents: number | null;
  gross_ht_cents: number;
  gross_fo_ht_cents: number;
  gross_mo_ht_cents: number;
  gross_mo_atelier_ht_cents: number;
  gross_mo_chantier_ht_cents: number;
  cost_ht_cents: number;
  reduction_cents: number;
  /** Net de ligne. */
  line_total_ht_cents: number;
  snapshot_fo_ht_cents: number;
  snapshot_mo_ht_cents: number;
  snapshot_mo_atelier_ht_cents: number;
  snapshot_mo_chantier_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
  /** Heures de ligne dérivées, 3 décimales (`"39.820"`), nulles sans heures par unité. */
  h_mo: string | null;
  h_mo_atelier: string | null;
  h_mo_chantier: string | null;
};

export type EstimateV3TaxBreakdownRow = {
  rate_bp: number;
  base_cents: number;
  tax_cents: number;
};

export type EstimateV3CanonicalTotals = {
  gross_ht_cents: number;
  discount_applied_cents: number;
  commercial_rounding_cents: number;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  rounding_adjustment_cents: number;
  cost_subtotal_cents: number;
  /** N / Σ D à 6 décimales (`"1.243188"`) ; nul si indéterminé. */
  realized_sale_coefficient: string | null;
  tax_breakdown: EstimateV3TaxBreakdownRow[];
};

export type EstimateV3CanonicalOutput = {
  lines: EstimateV3CanonicalLine[];
  totals: EstimateV3CanonicalTotals;
};

export type EstimateV3LineResult = EstimateV3CanonicalLine & {
  pricing_status: EstimateV3PricingStatus;
  tax_rate_bp: number;
  /** Ventilation atelier/chantier effectivement appliquée à la ligne. */
  labor_split: boolean;
};

export type EstimateV3DiscountSummary = {
  kind: "none" | "amount" | "rate";
  requested_cents: number | null;
  rate_bp: number | null;
  base_cents: number;
  applied_cents: number;
};

export type EstimateV3CommercialRoundingSummary = {
  mode: EstimateV3RoundingMode;
  step_cents: number;
  applied_cents: number;
};

export type EstimateV3Warning =
  | { code: "ESTIMATE_V3_LINE_NOT_PRICED"; line_id: string; pricing_status: EstimateV3PricingStatus }
  | { code: "ESTIMATE_V3_LABOR_RATE_MISSING"; line_id: string };

/** Paramètres normalisés, rendus pour la projection (coefficients à 4 décimales). */
export type EstimateV3ResolvedParams = {
  sale_coefficient_fo: string;
  sale_coefficient_mo: string;
  discount_amount_cents: number | null;
  discount_bp: number;
  rounding_mode: EstimateV3RoundingMode;
  rounding_step_cents: number;
  reverse_charge: boolean;
  labor_split_enabled: boolean;
};

export type EstimateV3Breakdown = {
  engine: 3;
  params: EstimateV3ResolvedParams;
  lines: EstimateV3LineResult[];
  totals: EstimateV3CanonicalTotals;
  discount: EstimateV3DiscountSummary;
  commercial_rounding: EstimateV3CommercialRoundingSummary;
  warnings: EstimateV3Warning[];
};
