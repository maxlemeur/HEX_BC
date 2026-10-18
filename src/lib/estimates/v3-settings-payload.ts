/**
 * Lot 2, sous-lot 2.6 - cœur pur des réglages d'une v3 (conception D5, D6, D8, D11 ; contrat du §1.2 de
 * docs/testing/estimate-engine-v3-2.6.md). Sans React : lecture de la version, saisie champ par champ,
 * charge de sauvegarde, aperçu par le moteur pur de 2.4. Réexporté par `src/hooks/useEstimateV3Settings.ts`.
 *
 * Contrats tenus ici :
 * - une intention de remise est un montant **ou** un taux, jamais dérivée de l'autre (F12, D6) ;
 * - un coefficient de vente vidé ou invalide est refusé avec un message, jamais 0 ni repris en silence ;
 * - la charge n'a aucune clé v2 ni aucun total : le serveur recalcule (2.5) ;
 * - l'aperçu ne calcule jamais un montant ici : il passe par `computeEstimateV3Breakdown`.
 */
import {
  computeEstimateV3Breakdown,
  type EstimateV3Breakdown,
  type EstimateV3Input,
  type EstimateV3ItemInput,
  type EstimateV3PricingStatus,
} from "@/lib/estimates/engine-v3";
import { resolveMarginMultiplier, type MarginTier } from "@/lib/estimates/margin-tiers";
import { saleCoefficientSchema } from "@/lib/estimates/v3-schemas";
import { normalizeEstimateCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import { formatDecimalInput, parseAmountCents, parseCoefficient, parseRateBp } from "@/lib/numeric-input/parsers";
import { ESTIMATE_LINE_PRICING_STATUSES } from "@/lib/units/normalize";

/* ---------- Contrat du §1.2 ---------- */

export type EstimateV3DiscountIntent =
  | { kind: "none" }
  | { kind: "amount"; amount_cents: number }
  | { kind: "rate"; rate_bp: number };

export type EstimateV3ContractorRole = "principal" | "subcontractor";
export type EstimateV3SettingsRoundingMode = "none" | "down";

export type EstimateV3SettingsDraft = {
  title: string;
  date_devis: string;
  exclusions: string;
  validite_jours: number;
  currency: SupportedEstimateCurrency;
  contractor_role: EstimateV3ContractorRole;
  sale_coefficient_fo: number;
  sale_coefficient_mo: number;
  discount: EstimateV3DiscountIntent;
  tax_rate_bp: number;
  rounding_mode: EstimateV3SettingsRoundingMode;
  rounding_step_cents: number;
};

export type EstimateV3SettingsField = "sale_coefficient_fo" | "sale_coefficient_mo" | "discount_amount" | "discount_rate";

export type EstimateV3SettingsInputErrorCode =
  | "ESTIMATE_V3_SALE_COEFFICIENT_REQUIRED"
  | "ESTIMATE_V3_SALE_COEFFICIENT_INVALID"
  | "ESTIMATE_V3_DISCOUNT_INVALID";

export type EstimateV3SettingsInputError = {
  field: EstimateV3SettingsField;
  code: EstimateV3SettingsInputErrorCode;
  message: string;
};

export type EstimateV3SettingsInputResult = {
  draft: EstimateV3SettingsDraft;
  error: EstimateV3SettingsInputError | null;
};

export type EstimateV3SettingsPayload = {
  title: string | null;
  exclusions: string | null;
  date_devis: string;
  validite_jours: number;
  currency: SupportedEstimateCurrency;
  contractor_role: EstimateV3ContractorRole;
  sale_coefficient_fo: number;
  sale_coefficient_mo: number;
  discount_amount_cents: number | null;
  discount_bp: number;
  tax_rate_bp: number;
  rounding_mode: EstimateV3SettingsRoundingMode;
  rounding_step_cents: number;
  apply_tax_rate_to_lines?: true;
};

/** Colonnes de réglages d'une version lues par `readEstimateV3SettingsDraft` (ligne stockée ou relue). */
export type VersionSettingsColumns = {
  title: string | null;
  exclusions: string | null;
  date_devis: string;
  validite_jours: number;
  currency: string;
  contractor_role?: string | null;
  sale_coefficient_fo?: number | string | null;
  sale_coefficient_mo?: number | string | null;
  discount_amount_cents: number | null;
  discount_bp: number;
  tax_rate_bp: number;
  rounding_mode: string;
  rounding_step_cents: number;
};

/** Refus nommé d'une version illisible ou d'une charge construite autour d'une valeur invalide. */
export class EstimateV3SettingsError extends Error {
  readonly code: EstimateV3SettingsInputErrorCode;

  constructor(code: EstimateV3SettingsInputErrorCode, message: string) {
    super(message);
    this.name = "EstimateV3SettingsError";
    this.code = code;
  }
}

const MAX_DISCOUNT_AMOUNT_CENTS = 2_147_483_647;
const MAX_RATE_BP = 10_000;

const COEFFICIENT_LABELS: Record<"sale_coefficient_fo" | "sale_coefficient_mo", "FO" | "MO"> = {
  sale_coefficient_fo: "FO",
  sale_coefficient_mo: "MO",
};

function coefficientRequiredMessage(label: "FO" | "MO") {
  return `Coefficient de vente ${label} obligatoire : saisissez un nombre supérieur à 0 et au plus 10.`;
}

function coefficientInvalidMessage(label: "FO" | "MO") {
  return `Coefficient de vente ${label} invalide : nombre supérieur à 0 et au plus 10, 4 décimales au plus.`;
}

const DISCOUNT_AMOUNT_INVALID_MESSAGE = "Remise invalide : montant positif en euros, 2 décimales au plus.";
const DISCOUNT_RATE_INVALID_MESSAGE = "Remise invalide : pourcentage entre 0 et 100, 2 décimales au plus.";

/** Coefficient de vente `numeric(8,4)` dans ]0 ; 10] : la règle Zod de l'API (2.5), jamais une copie. */
export function isValidEstimateV3SaleCoefficient(value: unknown): value is number {
  return typeof value === "number" && saleCoefficientSchema.safeParse(value).success;
}

function isValidDiscountAmount(value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DISCOUNT_AMOUNT_CENTS;
}

function isValidRateBp(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_RATE_BP;
}

function readStoredCoefficient(value: number | string | null | undefined, field: "sale_coefficient_fo" | "sale_coefficient_mo") {
  const parsed = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  if (!isValidEstimateV3SaleCoefficient(parsed)) {
    throw new EstimateV3SettingsError(
      "ESTIMATE_V3_SALE_COEFFICIENT_INVALID",
      `Coefficient de vente ${COEFFICIENT_LABELS[field]} de la version illisible.`
    );
  }
  return parsed;
}

function readContractorRole(value: string | null | undefined): EstimateV3ContractorRole {
  return value === "subcontractor" ? "subcontractor" : "principal";
}

/** Lecture d'une version v3 : intention de remise exacte, coefficients tels que stockés. */
export function readEstimateV3SettingsDraft(version: VersionSettingsColumns): EstimateV3SettingsDraft {
  const roundingMode = version.rounding_mode;
  if (roundingMode !== "none" && roundingMode !== "down") {
    // CHECK de version v3 (D7) : un autre mode n'est jamais relu comme « aucun ».
    throw new Error(`Mode d'arrondi incompatible avec le moteur de calcul 3 : ${String(roundingMode)}.`);
  }
  let discount: EstimateV3DiscountIntent;
  if (version.discount_amount_cents !== null && version.discount_amount_cents !== undefined) {
    discount = { kind: "amount", amount_cents: Number(version.discount_amount_cents) };
  } else if (Number(version.discount_bp) > 0) {
    discount = { kind: "rate", rate_bp: Number(version.discount_bp) };
  } else {
    discount = { kind: "none" };
  }
  return {
    title: version.title ?? "",
    date_devis: version.date_devis,
    exclusions: version.exclusions ?? "",
    validite_jours: version.validite_jours,
    currency: normalizeEstimateCurrency(version.currency) ?? "EUR",
    contractor_role: readContractorRole(version.contractor_role),
    sale_coefficient_fo: readStoredCoefficient(version.sale_coefficient_fo, "sale_coefficient_fo"),
    sale_coefficient_mo: readStoredCoefficient(version.sale_coefficient_mo, "sale_coefficient_mo"),
    discount,
    tax_rate_bp: version.tax_rate_bp,
    rounding_mode: roundingMode,
    rounding_step_cents: version.rounding_step_cents,
  };
}

function refuse(
  draft: EstimateV3SettingsDraft,
  field: EstimateV3SettingsField,
  code: EstimateV3SettingsInputErrorCode,
  message: string
): EstimateV3SettingsInputResult {
  return { draft, error: { field, code, message } };
}

function applyCoefficient(
  draft: EstimateV3SettingsDraft,
  field: "sale_coefficient_fo" | "sale_coefficient_mo",
  raw: string
): EstimateV3SettingsInputResult {
  const label = COEFFICIENT_LABELS[field];
  if (raw.trim() === "") {
    return refuse(draft, field, "ESTIMATE_V3_SALE_COEFFICIENT_REQUIRED", coefficientRequiredMessage(label));
  }
  const value = parseCoefficient(raw);
  if (value === null || !isValidEstimateV3SaleCoefficient(value)) {
    return refuse(draft, field, "ESTIMATE_V3_SALE_COEFFICIENT_INVALID", coefficientInvalidMessage(label));
  }
  // Un coefficient ne touche jamais l'intention de remise (EUHIST).
  return { draft: draft[field] === value ? draft : { ...draft, [field]: value }, error: null };
}

function applyDiscount(
  draft: EstimateV3SettingsDraft,
  field: "discount_amount" | "discount_rate",
  raw: string
): EstimateV3SettingsInputResult {
  const kind = field === "discount_amount" ? "amount" : "rate";
  if (raw.trim() === "") {
    // Vider le champ de l'intention active la supprime ; vider l'autre champ (affiché vide) ne change rien.
    return { draft: draft.discount.kind === kind ? { ...draft, discount: { kind: "none" } } : draft, error: null };
  }
  if (kind === "amount") {
    const cents = parseAmountCents(raw);
    if (cents === null || !isValidDiscountAmount(cents)) {
      return refuse(draft, field, "ESTIMATE_V3_DISCOUNT_INVALID", DISCOUNT_AMOUNT_INVALID_MESSAGE);
    }
    return { draft: { ...draft, discount: { kind: "amount", amount_cents: cents } }, error: null };
  }
  const rateBp = parseRateBp(raw);
  if (rateBp === null || !isValidRateBp(rateBp)) {
    return refuse(draft, field, "ESTIMATE_V3_DISCOUNT_INVALID", DISCOUNT_RATE_INVALID_MESSAGE);
  }
  // Revue de 2.6 (F26-28) : un taux nul est l'absence de remise ; enregistré (`null`, 0 pb), il se relit `none`, et
  // un brouillon resté en `rate` 0 paraissait modifié après chaque sauvegarde (« Non sauvegardé » sans fin).
  return { draft: { ...draft, discount: rateBp === 0 ? { kind: "none" } : { kind: "rate", rate_bp: rateBp } }, error: null };
}

/** Saisie d'un champ : brouillon inchangé et erreur nommée en cas de refus, jamais 0 ni arrondi. */
export function applyEstimateV3SettingsInput(
  draft: EstimateV3SettingsDraft,
  field: EstimateV3SettingsField,
  raw: string
): EstimateV3SettingsInputResult {
  switch (field) {
    case "sale_coefficient_fo":
    case "sale_coefficient_mo":
      return applyCoefficient(draft, field, raw);
    case "discount_amount":
    case "discount_rate":
      return applyDiscount(draft, field, raw);
    default: {
      const unknownField: never = field;
      throw new Error(`Champ de réglage v3 inconnu : ${String(unknownField)}.`);
    }
  }
}

function trimmedOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function discountColumns(discount: EstimateV3DiscountIntent): { discount_amount_cents: number | null; discount_bp: number } {
  switch (discount.kind) {
    case "none":
      return { discount_amount_cents: null, discount_bp: 0 };
    case "amount":
      if (!isValidDiscountAmount(discount.amount_cents)) {
        throw new EstimateV3SettingsError("ESTIMATE_V3_DISCOUNT_INVALID", DISCOUNT_AMOUNT_INVALID_MESSAGE);
      }
      // Le montant **demandé** part tel quel : le plafond à l'assiette (CAP) est calculé, jamais écrit.
      return { discount_amount_cents: discount.amount_cents, discount_bp: 0 };
    case "rate":
      if (!isValidRateBp(discount.rate_bp)) {
        throw new EstimateV3SettingsError("ESTIMATE_V3_DISCOUNT_INVALID", DISCOUNT_RATE_INVALID_MESSAGE);
      }
      return { discount_amount_cents: null, discount_bp: discount.rate_bp };
    default: {
      const unknownDiscount: never = discount;
      throw new Error(`Intention de remise inconnue : ${JSON.stringify(unknownDiscount)}.`);
    }
  }
}

/**
 * Charge de `PATCH /api/estimates/{id}` d'une v3 : les 13 clés du contrat, plus `apply_tax_rate_to_lines`
 * après « Oui » (D8). Aucune clé v2, aucun total client, jamais un `discount_bp` dérivé d'un montant.
 */
export function buildEstimateV3SettingsPayload(
  draft: EstimateV3SettingsDraft,
  options: { applyTaxRateToLines: boolean }
): EstimateV3SettingsPayload {
  for (const field of ["sale_coefficient_fo", "sale_coefficient_mo"] as const) {
    if (!isValidEstimateV3SaleCoefficient(draft[field])) {
      throw new EstimateV3SettingsError("ESTIMATE_V3_SALE_COEFFICIENT_INVALID", coefficientInvalidMessage(COEFFICIENT_LABELS[field]));
    }
  }
  const payload: EstimateV3SettingsPayload = {
    title: trimmedOrNull(draft.title),
    exclusions: trimmedOrNull(draft.exclusions),
    date_devis: draft.date_devis,
    validite_jours: draft.validite_jours,
    currency: draft.currency,
    contractor_role: draft.contractor_role,
    sale_coefficient_fo: draft.sale_coefficient_fo,
    sale_coefficient_mo: draft.sale_coefficient_mo,
    ...discountColumns(draft.discount),
    tax_rate_bp: draft.tax_rate_bp,
    rounding_mode: draft.rounding_mode,
    rounding_step_cents: draft.rounding_step_cents,
  };
  if (options.applyTaxRateToLines) payload.apply_tax_rate_to_lines = true;
  return payload;
}

/* ---------- Extensions du hook (§1.3), hors contrat du §1.2 ---------- */

/** Saisie du taux par défaut des nouvelles lignes (« TVA par défaut des nouvelles lignes », D8). */
export type EstimateV3TaxRateInputError = {
  field: "tax_rate";
  code: "ESTIMATE_V3_TAX_RATE_INVALID";
  message: string;
};

export function applyEstimateV3TaxRateInput(
  draft: EstimateV3SettingsDraft,
  raw: string
): { draft: EstimateV3SettingsDraft; error: EstimateV3TaxRateInputError | null } {
  const rateBp = raw.trim() === "" ? null : parseRateBp(raw);
  if (rateBp === null) {
    return {
      draft,
      error: {
        field: "tax_rate",
        code: "ESTIMATE_V3_TAX_RATE_INVALID",
        message: raw.trim() === ""
          ? "TVA par défaut obligatoire : saisissez un pourcentage entre 0 et 100."
          : "TVA par défaut invalide : pourcentage entre 0 et 100, 2 décimales au plus.",
      },
    };
  }
  return { draft: draft.tax_rate_bp === rateBp ? draft : { ...draft, tax_rate_bp: rateBp }, error: null };
}

const COEFFICIENT_FORMAT = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
  useGrouping: false,
});

/** Coefficient affiché dans son champ : « 1,30 », « 1,2345 ». */
export function formatEstimateV3Coefficient(value: number): string {
  return Number.isFinite(value) ? COEFFICIENT_FORMAT.format(value) : "";
}

/** Taux en points de base affiché en pourcentage fr-FR : 2 000 → « 20 », 550 → « 5,5 ». */
export function formatEstimateV3RatePercent(rateBp: number): string {
  return Number.isInteger(rateBp) ? formatDecimalInput(rateBp / 100) : "";
}

/** Montant en centimes affiché dans son champ, deux décimales, sans séparateur de milliers : « 1,01 ». */
export function formatEstimateV3AmountInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return "";
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/** Textes des deux champs de remise : seul celui de l'intention active est rempli. */
export function formatEstimateV3DiscountTexts(discount: EstimateV3DiscountIntent): { amount: string; rate: string } {
  return {
    amount: discount.kind === "amount" ? formatEstimateV3AmountInput(discount.amount_cents) : "",
    rate: discount.kind === "rate" ? formatEstimateV3RatePercent(discount.rate_bp) : "",
  };
}

/** Taux de ligne différents du nouveau taux par défaut : le dialogue de propagation ne s'ouvre que s'il y en a. */
export function countEstimateV3LinesWithOtherTaxRate(
  lines: ReadonlyArray<{ item_type: string; tax_rate_bp: number | null }>,
  rateBp: number,
  storedDefaultRateBp: number
): number {
  return lines.filter((line) => line.item_type === "line" && (line.tax_rate_bp ?? storedDefaultRateBp) !== rateBp).length;
}

/**
 * Repère du barème **de l'entreprise** (D5) : le multiplicateur du palier atteint par le déboursé, à titre
 * indicatif. Sans barème d'entreprise, aucun repère : le barème codé en dur n'est jamais montré en v3.
 */
export function resolveEstimateV3MarginTierHint(
  tiers: readonly MarginTier[] | null | undefined,
  costSubtotalCents: number
): { multiplier: number } | null {
  if (!tiers || tiers.length === 0 || !Number.isFinite(costSubtotalCents)) return null;
  return { multiplier: resolveMarginMultiplier(costSubtotalCents, [...tiers]) };
}

/* ---------- Aperçu par le moteur pur (§1.3 ; mêmes entrées que `buildEstimateV3Input` de 2.5) ---------- */

type Numeric = number | string | null | undefined;

/** Ligne de l'éditeur telle que le moteur v3 la lit (colonnes d'`estimate_items`). */
export type EstimateV3PreviewLine = {
  id: string;
  item_type: string;
  position?: number;
  parent_id?: string | null;
  quantity: Numeric;
  unit_price_ht_cents: Numeric;
  tax_rate_bp: number | null;
  k_fo: Numeric;
  h_mo_majoration?: Numeric;
  k_mo: Numeric;
  k_mo_atelier?: Numeric;
  k_mo_chantier?: Numeric;
  labor_role_id: string | null;
  labor_role_atelier_id?: string | null;
  labor_role_chantier_id?: string | null;
  unit_code?: string | null;
  pricing_status?: string | null;
  h_mo_per_unit?: Numeric;
  h_mo_atelier_per_unit?: Numeric;
  h_mo_chantier_per_unit?: Numeric;
};

export type EstimateV3PreviewLaborRole = { id: string; hourly_rate_cents: number };

const PRICING_STATUSES: ReadonlySet<string> = new Set(ESTIMATE_LINE_PRICING_STATUSES);
/** Identité serveur : une ligne en cours de création (identifiant provisoire) n'existe pas encore pour le serveur. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toNumeric(value: Numeric): number | string | null {
  return value === null || value === undefined ? null : value;
}

function pricingStatusOf(value: string | null | undefined): EstimateV3PricingStatus {
  const status = value ?? "priced";
  if (!PRICING_STATUSES.has(status)) throw new Error(`Statut de chiffrage de ligne inconnu : ${status}.`);
  return status as EstimateV3PricingStatus;
}

/**
 * Entrée du moteur pour l'aperçu : champ par champ celle du serveur (`buildEstimateV3Input`,
 * `v3-persistence.ts`), avec les réglages du brouillon comme version prospective (`settings-atomic.ts`) et le
 * taux horaire de chaque rôle du propriétaire pour la MO, l'atelier et le chantier (`version-totals.ts`).
 * Une ligne en cours de création (identifiant provisoire) reste hors de l'aperçu jusqu'à sa confirmation,
 * comme au serveur qui ne la connaît pas encore ; lignes dans l'ordre des positions puis des identifiants.
 */
export function buildEstimateV3PreviewInput(input: {
  draft: EstimateV3SettingsDraft;
  lines: readonly EstimateV3PreviewLine[];
  laborRoles: readonly EstimateV3PreviewLaborRole[];
  laborSplitEnabled: boolean;
}): EstimateV3Input {
  const { draft } = input;
  const rates = new Map(input.laborRoles.map((role) => [role.id, role.hourly_rate_cents]));
  const rateOf = (roleId: string | null | undefined) => (roleId ? rates.get(roleId) ?? null : null);
  const items: EstimateV3ItemInput[] = input.lines
    .filter((line) => line.item_type === "line" && UUID_PATTERN.test(line.id))
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0) || left.id.localeCompare(right.id))
    .map((line) => ({
      id: line.id,
      item_type: "line",
      parent_id: line.parent_id && UUID_PATTERN.test(line.parent_id) ? line.parent_id : null,
      quantity: toNumeric(line.quantity),
      unit_price_ht_cents: toNumeric(line.unit_price_ht_cents),
      k_fo: toNumeric(line.k_fo),
      h_mo_per_unit: toNumeric(line.h_mo_per_unit),
      h_mo_atelier_per_unit: toNumeric(line.h_mo_atelier_per_unit),
      h_mo_chantier_per_unit: toNumeric(line.h_mo_chantier_per_unit),
      h_mo_majoration: toNumeric(line.h_mo_majoration),
      k_mo: toNumeric(line.k_mo),
      k_mo_atelier: toNumeric(line.k_mo_atelier),
      k_mo_chantier: toNumeric(line.k_mo_chantier),
      labor_rate_cents: rateOf(line.labor_role_id),
      labor_rate_atelier_cents: rateOf(line.labor_role_atelier_id),
      labor_rate_chantier_cents: rateOf(line.labor_role_chantier_id),
      pricing_status: pricingStatusOf(line.pricing_status),
      tax_rate_bp: line.tax_rate_bp ?? draft.tax_rate_bp,
      unit_code: line.unit_code ?? null,
    }));
  const discount = discountColumns(draft.discount);
  return {
    params: {
      sale_coefficient_fo: draft.sale_coefficient_fo,
      sale_coefficient_mo: draft.sale_coefficient_mo,
      discount_amount_cents: discount.discount_amount_cents,
      discount_bp: discount.discount_bp,
      rounding_mode: draft.rounding_mode,
      rounding_step_cents: draft.rounding_step_cents,
      reverse_charge: draft.contractor_role === "subcontractor",
      labor_split_enabled: input.laborSplitEnabled,
    },
    items,
  };
}

export type EstimateV3SettingsPreview =
  | { breakdown: EstimateV3Breakdown; error: null }
  | { breakdown: null; error: string };

/** Aperçu v3 du brouillon : calculé par le moteur pur, jamais envoyé comme total (le serveur recalcule). */
export function computeEstimateV3SettingsPreview(input: Parameters<typeof buildEstimateV3PreviewInput>[0]): EstimateV3SettingsPreview {
  try {
    return { breakdown: computeEstimateV3Breakdown(buildEstimateV3PreviewInput(input)), error: null };
  } catch (error) {
    return { breakdown: null, error: error instanceof Error ? error.message : "Aperçu du moteur de calcul 3 indisponible." };
  }
}
