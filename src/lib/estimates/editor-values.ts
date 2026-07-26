export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function toNullableFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Normalise une saisie numerique FR avant analyse.
 *
 * Retire ce qui n'est jamais porteur de valeur : unites et symboles, espaces
 * (y compris l'insecable U+00A0 et l'insecable etroite U+202F, que produisent
 * Excel et LibreOffice en francais), et apostrophes de milliers.
 *
 * Quand les DEUX separateurs sont presents, le dernier est le separateur
 * decimal : « 1.234,56 » et « 1,234.56 » sont alors non ambigus.
 *
 * ⚠️ T16 volontairement NON tranche : avec un seul type de separateur,
 * « 2.500 » et « 2,500 » restent lus 2,5 et non 2500. L'ambiguite (quantites
 * BTP a 3 decimales en tonnes/m³ contre milliers) est une decision PRODUIT,
 * documentee dans `HANDOFF-audit-backlog.md` §1.6 ; `parseClipboardNumber`
 * (lib/estimates/clipboard.ts) la tranche dans l'autre sens pour le collage en
 * masse. Ne pas aligner les deux sans avoir tranche — un test fige cet etat.
 */
export function normalizeNumericInput(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[−–—]/g, "-")
    .replace(/[^\d.,\-\s  '’`]/g, "")
    .replace(/[\s  ]/g, "")
    .replace(/['’`]/g, "");

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    return lastComma > lastDot
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  }

  return cleaned.replace(",", ".");
}

/**
 * Analyse une saisie numerique de cellule ou de champ (quantite, heures,
 * coefficients, seuils, montants). Repli sur `0`.
 *
 * Source unique : six implementations identiques coexistaient (grille, barre de
 * commandes, barre d'outils, selection, plus deux variantes nullables), toutes
 * avec le meme defaut — `replace(",", ".")` ne remplacant que la PREMIERE
 * virgule et ne retirant aucun separateur de milliers, un collage
 * « 1 234,56 » valait 1.
 */
export function parseNumberInput(value: string): number {
  const parsed = Number.parseFloat(normalizeNumericInput(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Comme `parseNumberInput`, mais `null` pour une saisie vide ou invalide. */
export function parseNullableNumberInput(value: string): number | null {
  const normalized = normalizeNumericInput(value);
  if (normalized === "") return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseNullableNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  return parseNullableNumberInput(value);
}
