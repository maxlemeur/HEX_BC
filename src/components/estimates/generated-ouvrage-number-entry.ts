import { MAX_CENTS } from "@/lib/estimate-calculations";
import { toStoredEstimateNumeric } from "@/lib/estimates/stored-item-numeric";
import { formatCentsInput, parseCurrencyToCents } from "@/lib/money";

import type { GeneratedOuvrageSubdetailEditorComponent } from "./generated-ouvrage-types";

export const GENERATED_OUVRAGE_NUMERIC_FIELDS = [
  "quantity", "unitCostHtCents", "lossCoeffBp", "yieldValue",
] as const;

export type GeneratedOuvrageNumericField = typeof GENERATED_OUVRAGE_NUMERIC_FIELDS[number];
export type GeneratedOuvrageNumericDraft = Record<GeneratedOuvrageNumericField, string>;

export function formatGeneratedOuvrageNumber(
  field: GeneratedOuvrageNumericField,
  value: number | null
): string {
  if (value === null) return "";
  if (field === "unitCostHtCents") return formatCentsInput(value).replace(".", ",");
  if (field === "lossCoeffBp") return String(value / 100).replace(".", ",");
  return String(value);
}

export function generatedOuvrageNumericDraft(
  component: Pick<GeneratedOuvrageSubdetailEditorComponent, GeneratedOuvrageNumericField>
): GeneratedOuvrageNumericDraft {
  return Object.fromEntries(GENERATED_OUVRAGE_NUMERIC_FIELDS.map((field) => [
    field, formatGeneratedOuvrageNumber(field, component[field]),
  ])) as GeneratedOuvrageNumericDraft;
}

export function parseGeneratedOuvrageNumber(
  field: GeneratedOuvrageNumericField,
  text: string
): { value: number | null } | { error: string } {
  const input = text.trim();
  if (field === "yieldValue" && input === "") return { value: null };
  if (field === "unitCostHtCents") {
    const amount = (/^(?:EUR|€)/i.test(input)
      ? input.replace(/^(?:EUR|€)\s*/i, "")
      : input.replace(/\s*(?:EUR|€)$/i, "")).trim();
    const completeAmount = /^(?:\d+(?:[.,]\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?)$/;
    const value = completeAmount.test(amount) ? parseCurrencyToCents(input, "EUR") : null;
    return value !== null && Number.isInteger(value) && value >= 0 && value <= MAX_CENTS
      ? { value }
      : { error: "Saisissez un montant valide entre 0 et 21 474 836,47 €." };
  }
  const grammar = field === "lossCoeffBp" ? /^\d+(?:[.,]\d{1,2})?$/ : /^\d+(?:[.,]\d+)?$/;
  if (!grammar.test(input)) return { error: "Saisissez un nombre décimal valide avec un point ou une virgule." };
  const number = Number(input.replace(",", "."));
  if (!Number.isFinite(number)) return { error: "Saisissez un nombre fini." };
  if (field === "lossCoeffBp") {
    const value = Math.round(number * 100);
    return Number.isInteger(value) && value >= 0 && value <= 100000
      ? { value }
      : { error: "Saisissez un pourcentage entre 0 et 1 000 %." };
  }
  try {
    const value = toStoredEstimateNumeric(number, 3);
    if (field === "yieldValue" && value <= 0) return { error: "Le rendement saisi doit être strictement positif." };
    return { value };
  } catch {
    return { error: "Quantité ou rendement invalide (maximum 999999999.999)." };
  }
}
