/**
 * Lot 2, sous-lot 2.4 - lecture stricte de l'entrée canonique du moteur v3.
 *
 * Toute entrée illisible est refusée par `ESTIMATE_V3_INPUT_INVALID`, jamais lue comme 0 ni
 * arrondie. Échelles : schéma vivant (quantité et coefficients de coût en `numeric(12,3)`,
 * majoration en `numeric(12,4)`) et conception §6.2 (heures par unité `numeric(12,4)`,
 * coefficients de vente `numeric(8,4)` dans ]0 ; 10]).
 */
import {
  columnBounds,
  type Decimal,
  DECIMAL_ONE,
  DECIMAL_ZERO,
  decimalFromInteger,
  type DecimalBounds,
  INTEGER_BOUNDS,
  parseDecimal,
} from "@/lib/estimates/engine-v3/decimal";
import { invalidInput } from "@/lib/estimates/engine-v3/errors";
import type { EstimateV3PricingStatus, EstimateV3RoundingMode } from "@/lib/estimates/engine-v3/types";

const QUANTITY_BOUNDS = columnBounds(12, 3);
const COST_COEFFICIENT_BOUNDS = columnBounds(12, 3);
const MAJORATION_BOUNDS = columnBounds(12, 4);
const HOURS_PER_UNIT_BOUNDS = columnBounds(12, 4);
const SALE_COEFFICIENT_BOUNDS: DecimalBounds = {
  scale: 4,
  max: decimalFromInteger(BigInt(10)),
  positive: true,
};
const BASIS_POINTS_BOUNDS: DecimalBounds = { scale: 0, max: decimalFromInteger(BigInt(10000)) };

const PRICING_STATUSES: ReadonlySet<string> = new Set<EstimateV3PricingStatus>([
  "priced",
  "included",
  "for_memory",
  "not_priced",
  "out_of_scope",
  "not_applicable",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type V3DiscountIntent =
  | { kind: "none" }
  | { kind: "amount"; requestedCents: bigint }
  | { kind: "rate"; rateBp: bigint };

export type NormalizedV3Params = {
  saleCoefficientFo: Decimal;
  saleCoefficientMo: Decimal;
  discount: V3DiscountIntent;
  discountAmountCents: bigint | null;
  discountBp: bigint;
  roundingMode: EstimateV3RoundingMode;
  roundingStepCents: bigint;
  reverseCharge: boolean;
  laborSplitEnabled: boolean;
};

export type NormalizedV3Line = {
  /** uuid en minuscules : clé de départage (ordre `uuid` PostgreSQL). */
  id: string;
  pricingStatus: EstimateV3PricingStatus;
  taxRateBp: bigint;
  quantity: Decimal;
  unitPriceCents: Decimal;
  kFo: Decimal;
  hoursPerUnit: Decimal | null;
  hoursAtelierPerUnit: Decimal | null;
  hoursChantierPerUnit: Decimal | null;
  majoration: Decimal;
  kMo: Decimal;
  /** Valeurs brutes (nulles possibles) : elles participent au déclenchement de la ventilation. */
  kMoAtelier: Decimal | null;
  kMoChantier: Decimal | null;
  laborRateCents: Decimal | null;
  laborRateAtelierCents: Decimal | null;
  laborRateChantierCents: Decimal | null;
};

export type NormalizedV3Input = { params: NormalizedV3Params; lines: NormalizedV3Line[] };

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalDecimal(bag: Bag, key: string, path: string, bounds: DecimalBounds): Decimal | null {
  const value = bag[key];
  if (value === null || value === undefined) return null;
  return parseDecimal(value, `${path}.${key}`, bounds);
}

function requiredDecimal(bag: Bag, key: string, path: string, bounds: DecimalBounds): Decimal {
  const value = optionalDecimal(bag, key, path, bounds);
  if (value === null) throw invalidInput(`${path}.${key}`, "valeur obligatoire");
  return value;
}

function requiredBoolean(bag: Bag, key: string, path: string): boolean {
  const value = bag[key];
  if (typeof value !== "boolean") throw invalidInput(`${path}.${key}`, "booléen attendu");
  return value;
}

/** Les huit clés du contrat canonique, exigées comme par le jumeau SQL (intégration 2.4 I-03). */
const PARAMS_KEYS = [
  "sale_coefficient_fo",
  "sale_coefficient_mo",
  "discount_amount_cents",
  "discount_bp",
  "rounding_mode",
  "rounding_step_cents",
  "reverse_charge",
  "labor_split_enabled",
] as const;

function normalizeParams(raw: unknown): NormalizedV3Params {
  if (!isBag(raw)) throw invalidInput("params", "objet attendu");
  const path = "params";
  const missing = PARAMS_KEYS.find((key) => !(key in raw));
  if (missing) throw invalidInput(`${path}.${missing}`, "clé de paramètre absente");
  const discountAmount = optionalDecimal(raw, "discount_amount_cents", path, INTEGER_BOUNDS);
  const discountBp = requiredDecimal(raw, "discount_bp", path, BASIS_POINTS_BOUNDS).units;
  if (discountAmount !== null && discountBp !== BigInt(0)) {
    throw invalidInput("params.discount_bp", "intention de remise double (montant et taux)");
  }
  const roundingMode = raw.rounding_mode;
  if (roundingMode !== "none" && roundingMode !== "down") {
    throw invalidInput("params.rounding_mode", "« none » ou « down » attendu");
  }
  const roundingStep = requiredDecimal(raw, "rounding_step_cents", path, {
    ...INTEGER_BOUNDS,
    positive: true,
  }).units;
  const discount: V3DiscountIntent =
    discountAmount !== null
      ? { kind: "amount", requestedCents: discountAmount.units }
      : discountBp > BigInt(0)
        ? { kind: "rate", rateBp: discountBp }
        : { kind: "none" };
  return {
    saleCoefficientFo: requiredDecimal(raw, "sale_coefficient_fo", path, SALE_COEFFICIENT_BOUNDS),
    saleCoefficientMo: requiredDecimal(raw, "sale_coefficient_mo", path, SALE_COEFFICIENT_BOUNDS),
    discount,
    discountAmountCents: discountAmount?.units ?? null,
    discountBp,
    roundingMode,
    roundingStepCents: roundingStep,
    reverseCharge: requiredBoolean(raw, "reverse_charge", path),
    laborSplitEnabled: requiredBoolean(raw, "labor_split_enabled", path),
  };
}

/** Identifiant d'élément (section ou ligne) : uuid, mis en minuscules ; parent nul ou uuid (I-02). */
function normalizeItemIdentity(raw: Bag, path: string): string {
  const id = typeof raw.id === "string" ? raw.id.toLowerCase() : "";
  if (!UUID_PATTERN.test(id)) throw invalidInput(`${path}.id`, "uuid attendu");
  const parent = raw.parent_id;
  if (
    parent !== null &&
    parent !== undefined &&
    (typeof parent !== "string" || !UUID_PATTERN.test(parent.toLowerCase()))
  ) {
    throw invalidInput(`${path}.parent_id`, "uuid ou null attendu");
  }
  return id;
}

function normalizeLine(raw: Bag, path: string, id: string): NormalizedV3Line {
  const status = raw.pricing_status;
  if (typeof status !== "string" || !PRICING_STATUSES.has(status)) {
    throw invalidInput(`${path}.pricing_status`, "statut de chiffrage inconnu");
  }
  const unitCode = raw.unit_code;
  if (unitCode !== null && unitCode !== undefined && typeof unitCode !== "string") {
    throw invalidInput(`${path}.unit_code`, "code d'unité attendu");
  }
  return {
    id,
    pricingStatus: status as EstimateV3PricingStatus,
    taxRateBp: requiredDecimal(raw, "tax_rate_bp", path, BASIS_POINTS_BOUNDS).units,
    quantity: optionalDecimal(raw, "quantity", path, QUANTITY_BOUNDS) ?? DECIMAL_ZERO,
    unitPriceCents: optionalDecimal(raw, "unit_price_ht_cents", path, INTEGER_BOUNDS) ?? DECIMAL_ZERO,
    kFo: optionalDecimal(raw, "k_fo", path, COST_COEFFICIENT_BOUNDS) ?? DECIMAL_ONE,
    hoursPerUnit: optionalDecimal(raw, "h_mo_per_unit", path, HOURS_PER_UNIT_BOUNDS),
    hoursAtelierPerUnit: optionalDecimal(raw, "h_mo_atelier_per_unit", path, HOURS_PER_UNIT_BOUNDS),
    hoursChantierPerUnit: optionalDecimal(raw, "h_mo_chantier_per_unit", path, HOURS_PER_UNIT_BOUNDS),
    majoration: optionalDecimal(raw, "h_mo_majoration", path, MAJORATION_BOUNDS) ?? DECIMAL_ONE,
    kMo: optionalDecimal(raw, "k_mo", path, COST_COEFFICIENT_BOUNDS) ?? DECIMAL_ONE,
    kMoAtelier: optionalDecimal(raw, "k_mo_atelier", path, COST_COEFFICIENT_BOUNDS),
    kMoChantier: optionalDecimal(raw, "k_mo_chantier", path, COST_COEFFICIENT_BOUNDS),
    laborRateCents: optionalDecimal(raw, "labor_rate_cents", path, INTEGER_BOUNDS),
    laborRateAtelierCents: optionalDecimal(raw, "labor_rate_atelier_cents", path, INTEGER_BOUNDS),
    laborRateChantierCents: optionalDecimal(raw, "labor_rate_chantier_cents", path, INTEGER_BOUNDS),
  };
}

/**
 * Valide l'entrée canonique. Une section est validée (identifiant, parent, unicité des
 * identifiants sur tous les éléments, comme le jumeau SQL : I-02) puis ignorée (aucun montant).
 */
export function normalizeEstimateV3Input(raw: unknown): NormalizedV3Input {
  if (!isBag(raw)) throw invalidInput("input", "objet { params, items } attendu");
  const params = normalizeParams(raw.params);
  if (!Array.isArray(raw.items)) throw invalidInput("items", "tableau attendu");
  const lines: NormalizedV3Line[] = [];
  const seen = new Set<string>();
  raw.items.forEach((item: unknown, index) => {
    const path = `items[${index}]`;
    if (!isBag(item)) throw invalidInput(path, "objet attendu");
    if (item.item_type !== "section" && item.item_type !== "line") {
      throw invalidInput(`${path}.item_type`, "« section » ou « line » attendu");
    }
    const id = normalizeItemIdentity(item, path);
    if (seen.has(id)) throw invalidInput(`${path}.id`, "identifiant d'élément en double");
    seen.add(id);
    if (item.item_type === "line") lines.push(normalizeLine(item, path, id));
  });
  return { params, lines };
}
