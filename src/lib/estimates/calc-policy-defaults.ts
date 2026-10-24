/**
 * Lot 3.2, entrée 5 (P-13) - défauts de calcul qu'un administrateur règle pour son entreprise : coefficients de vente
 * FO et MO des nouveaux devis v3 et taux de TVA autorisés au gel d'une v3. Le moteur des nouvelles versions n'en fait
 * pas partie : il reste réglé par l'équipe (`set_tenant_calc_policy`, service_role).
 *
 * Pur, partagé par l'écran et l'action serveur : la même saisie texte est relue côté serveur, jamais une copie des
 * règles. Les bornes sont celles de `public.set_tenant_calc_policy` (coefficient `numeric(8,4)` dans ]0 ; 10],
 * taux en points de base dans [0 ; 10 000], motif de 5 à 500 caractères).
 */
import {
  formatEstimateV3Coefficient,
  formatEstimateV3RatePercent,
  isValidEstimateV3SaleCoefficient,
} from "@/lib/estimates/v3-settings-payload";
import { parseCoefficient, parseRateBp } from "@/lib/numeric-input/parsers";

/** Saisie de l'écran « Calcul des devis », telle que tapée. */
export type TenantCalcDefaultsForm = {
  saleCoefficientFo: string;
  saleCoefficientMo: string;
  allowedTaxRates: string;
  changeReason: string;
};

export type TenantCalcDefaultsField = keyof TenantCalcDefaultsForm;

export type TenantCalcDefaultsValues = {
  defaultSaleCoefficientFo: number;
  defaultSaleCoefficientMo: number;
  allowedTaxRatesBp: number[];
  changeReason: string;
};

export type TenantCalcDefaultsFieldErrors = Partial<Record<TenantCalcDefaultsField, string>>;

export type TenantCalcDefaultsParseResult =
  | { ok: true; values: TenantCalcDefaultsValues }
  | { ok: false; errors: TenantCalcDefaultsFieldErrors };

const TAX_RATE_SEPARATOR = ";";
const CHANGE_REASON_MIN_LENGTH = 5;
const CHANGE_REASON_MAX_LENGTH = 500;

const TAX_RATES_REQUIRED_MESSAGE = "Taux de TVA obligatoires : au moins un pourcentage entre 0 et 100.";
const CHANGE_REASON_MESSAGE = "Motif obligatoire : 5 à 500 caractères, gardés dans le journal des réglages.";

function coefficientMessage(label: "FO" | "MO", empty: boolean) {
  return empty
    ? `Coefficient de vente ${label} obligatoire : saisissez un nombre supérieur à 0 et au plus 10.`
    : `Coefficient de vente ${label} invalide : nombre supérieur à 0 et au plus 10, 4 décimales au plus.`;
}

function parseSaleCoefficient(raw: string, label: "FO" | "MO"): number | string {
  if (raw.trim() === "") return coefficientMessage(label, true);
  const value = parseCoefficient(raw);
  return value !== null && isValidEstimateV3SaleCoefficient(value) ? value : coefficientMessage(label, false);
}

function parseTaxRates(raw: string): number[] | string {
  const parts = raw.split(TAX_RATE_SEPARATOR).map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length === 0) return TAX_RATES_REQUIRED_MESSAGE;
  const rates: number[] = [];
  for (const part of parts) {
    const rate = parseRateBp(part);
    if (rate === null) {
      return `Taux de TVA invalide : « ${part} ». Pourcentages entre 0 et 100, 2 décimales au plus, séparés par « ; ».`;
    }
    if (rates.includes(rate)) return `Taux de TVA en double : ${formatEstimateV3RatePercent(rate)} %.`;
    rates.push(rate);
  }
  return rates;
}

/** Relit la saisie ; chaque champ refusé reçoit son message, rien n'est corrigé en silence. */
export function parseTenantCalcDefaultsForm(form: TenantCalcDefaultsForm): TenantCalcDefaultsParseResult {
  const errors: TenantCalcDefaultsFieldErrors = {};
  const fo = parseSaleCoefficient(form.saleCoefficientFo, "FO");
  const mo = parseSaleCoefficient(form.saleCoefficientMo, "MO");
  const rates = parseTaxRates(form.allowedTaxRates);
  const changeReason = form.changeReason.trim();
  // En caractères, comme `char_length` côté SQL (un emoji compte pour un).
  const changeReasonLength = [...changeReason].length;
  if (typeof fo === "string") errors.saleCoefficientFo = fo;
  if (typeof mo === "string") errors.saleCoefficientMo = mo;
  if (typeof rates === "string") errors.allowedTaxRates = rates;
  if (changeReasonLength < CHANGE_REASON_MIN_LENGTH || changeReasonLength > CHANGE_REASON_MAX_LENGTH) {
    errors.changeReason = CHANGE_REASON_MESSAGE;
  }
  if (typeof fo === "string" || typeof mo === "string" || typeof rates === "string" || errors.changeReason) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    values: { defaultSaleCoefficientFo: fo, defaultSaleCoefficientMo: mo, allowedTaxRatesBp: rates, changeReason },
  };
}

/** Champs de l'écran pour une politique lue ; un coefficient absent (politique 2 explicite) laisse son champ vide. */
export function formatTenantCalcDefaults(policy: {
  defaultSaleCoefficientFo: number | null;
  defaultSaleCoefficientMo: number | null;
  allowedTaxRatesBp: readonly number[];
}): Omit<TenantCalcDefaultsForm, "changeReason"> {
  return {
    saleCoefficientFo: policy.defaultSaleCoefficientFo === null ? "" : formatEstimateV3Coefficient(policy.defaultSaleCoefficientFo),
    saleCoefficientMo: policy.defaultSaleCoefficientMo === null ? "" : formatEstimateV3Coefficient(policy.defaultSaleCoefficientMo),
    allowedTaxRates: policy.allowedTaxRatesBp.map(formatEstimateV3RatePercent).join(` ${TAX_RATE_SEPARATOR} `),
  };
}
