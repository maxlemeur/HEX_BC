import {
  formatDecimalInput,
  parseDecimalInput,
  parseMajorationCoefficient,
  parseMajorationPercent,
} from "@/lib/numeric-input/parsers";

/**
 * Convention unique de majoration MO (P-11, validée le 16/10/2026) : l'utilisateur saisit
 * « Majoration MO (%) », 100 = neutre ; la base stocke le coefficient `h_mo_majoration`
 * (1 = neutre, numeric(12,4)). Grille, action groupée, copie, collage et export la lisent ici, sur
 * les parseurs D11 de `parsers.ts`. Un coefficient hors [0 ; 10] est refusé ; un vide vaut « non
 * renseigné », jamais ×0.
 */
export const MAJORATION_PERCENT_HEADER = "Majoration MO (%)";
export const MAJORATION_COEFFICIENT_HEADER = "Majoration MO (coef)";

export const MAJORATION_PERCENT_ERROR =
  "Majoration MO : saisissez un pourcentage entre 0 et 1 000, deux décimales au plus (100 = neutre).";
export const MAJORATION_COEFFICIENT_ERROR =
  "Majoration MO : le coefficient doit être compris entre 0 et 10, quatre décimales au plus (1 = neutre).";

/** `number` : la grammaire refuse la saisie ; `range` : lisible, mais hors bornes ou trop précise. */
export type MajorationReading =
  | { status: "empty" }
  | { status: "valid"; coefficient: number }
  | { status: "invalid"; error: "number" | "range" };

function readWith(
  input: unknown,
  parse: (input: unknown) => number | null,
  admitsPercentSign: boolean,
): MajorationReading {
  if (input === null || input === undefined || (typeof input === "string" && input.trim() === "")) {
    return { status: "empty" };
  }
  const text = admitsPercentSign && typeof input === "string" ? input.trim().replace(/\s*%$/, "") : input;
  if (parseDecimalInput(text) === null) return { status: "invalid", error: "number" };
  const coefficient = parse(input);
  return coefficient === null ? { status: "invalid", error: "range" } : { status: "valid", coefficient };
}

/** « 112,5 », « 112,5 % » ou 112.5 (nombre natif) → coefficient 1,125. */
export function readMajorationPercent(input: unknown): MajorationReading {
  return readWith(input, parseMajorationPercent, true);
}

/** « 1,15 » ou 1.15 sous un en-tête déclaré coefficient : pris brut, borné à [0 ; 10]. */
export function readMajorationCoefficient(input: unknown): MajorationReading {
  return readWith(input, parseMajorationCoefficient, false);
}

/** Saisie « Majoration MO (%) » → coefficient stocké, ou `null` (vide, illisible ou hors bornes). */
export function majorationPercentToCoefficient(input: unknown): number | null {
  const reading = readMajorationPercent(input);
  return reading.status === "valid" ? reading.coefficient : null;
}

/** Coefficient stocké (quatre décimales) → pourcentage affiché : 1,125 → 112,5. */
export function majorationCoefficientToPercent(coefficient: number): number {
  return Math.round(coefficient * 10000) / 100;
}

/** Pourcentage écrit avec une virgule décimale, relu à l'identique par la grammaire de saisie. */
export function formatMajorationPercent(coefficient: number | null | undefined): string {
  if (typeof coefficient !== "number" || !Number.isFinite(coefficient)) return "";
  return formatDecimalInput(majorationCoefficientToPercent(coefficient));
}

/** Coefficient affiché avant application : 1,5 → « ×1,5 ». */
export function formatMajorationCoefficient(coefficient: number): string {
  return `×${formatDecimalInput(Math.round(coefficient * 10000) / 10000)}`;
}
