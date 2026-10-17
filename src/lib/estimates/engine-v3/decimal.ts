/**
 * Lot 2, sous-lot 2.4 - décimal exact du moteur v3 (conception D13).
 *
 * Un `Decimal` vaut `units / 10^scale`, avec `units >= 0` : le moteur v3 n'admet aucune valeur
 * négative (D13 ne définit le demi supérieur que pour des valeurs positives). Aucune opération
 * flottante sur un montant : les nombres JS sont lus par leur écriture la plus courte (`String`).
 */
import { amountOverflow, invalidInput } from "@/lib/estimates/engine-v3/errors";

export type Decimal = { readonly units: bigint; readonly scale: number };

export const ZERO = BigInt(0);
export const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

/** Plus grand entier PostgreSQL (`integer`) : au-delà, `ESTIMATE_AMOUNT_OVERFLOW`. */
export const INT32_MAX = BigInt(2147483647);

const POWERS: bigint[] = [ONE];

export function pow10(scale: number): bigint {
  while (POWERS.length <= scale) POWERS.push(POWERS[POWERS.length - 1] * TEN);
  return POWERS[scale];
}

export const DECIMAL_ZERO: Decimal = { units: ZERO, scale: 0 };
export const DECIMAL_ONE: Decimal = { units: ONE, scale: 0 };

export function decimalFromInteger(value: bigint): Decimal {
  return { units: value, scale: 0 };
}

export function multiply(left: Decimal, right: Decimal): Decimal {
  return { units: left.units * right.units, scale: left.scale + right.scale };
}

/** Unités de `value` à l'échelle `scale >= value.scale` (exact). */
export function unitsAtScale(value: Decimal, scale: number): bigint {
  return value.units * pow10(scale - value.scale);
}

export function add(left: Decimal, right: Decimal): Decimal {
  const scale = Math.max(left.scale, right.scale);
  return { units: unitsAtScale(left, scale) + unitsAtScale(right, scale), scale };
}

export function compare(left: Decimal, right: Decimal): number {
  const scale = Math.max(left.scale, right.scale);
  const a = unitsAtScale(left, scale);
  const b = unitsAtScale(right, scale);
  return a === b ? 0 : a < b ? -1 : 1;
}

/** ⌊(2·numerator + denominator) / (2·denominator)⌋ : demi supérieur, opérandes positifs. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (TWO * numerator + denominator) / (TWO * denominator);
}

/** ⌈x⌋ = ⌊x + 1/2⌋, pour x >= 0 (= `round(numeric)` PostgreSQL, `ARRONDI` Excel). */
export function roundHalfUp(value: Decimal): bigint {
  return divideHalfUp(value.units, pow10(value.scale));
}

/** Unités à l'échelle `scale`, arrondies au demi supérieur. */
export function roundHalfUpToScale(value: Decimal, scale: number): bigint {
  if (value.scale <= scale) return unitsAtScale(value, scale);
  return divideHalfUp(value.units, pow10(value.scale - scale));
}

/** Écriture à échelle fixe (`"39.820"`, `"1.243188"`). */
export function formatScaled(units: bigint, scale: number): string {
  if (scale === 0) return units.toString();
  const digits = units.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
}

/** Centimes vérifiés : au-delà de 2 147 483 647, `ESTIMATE_AMOUNT_OVERFLOW`. */
export function toCents(value: bigint, field: string): number {
  if (value > INT32_MAX) throw amountOverflow(field);
  return Number(value);
}

/** Chaîne décimale de l'éditeur : chiffres, point décimal facultatif, ni signe ni exposant. */
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/** Grammaire d'un nombre JSON et de `String(n)` d'un nombre JS fini : signe et exposant permis. */
const NUMBER_LITERAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Au-delà de 20 chiffres entiers, toute valeur dépasse les bornes des colonnes (< 10^12). */
const MAX_INTEGER_DIGITS = 20;

/**
 * Littéral numérique JSON gardé tel qu'écrit dans le texte (accès à la source de `JSON.parse`) :
 * il est lu en décimal exact, comme `jsonb` le lit en `numeric`, jamais à travers un double.
 */
export class JsonNumberLiteral {
  constructor(readonly source: string) {}
}

/**
 * `editor` : entrée typée de l'éditeur (nombres JS et chaînes décimales exactes) ;
 * `canonical` : contrat JSON partagé avec le jumeau SQL (nombres JSON seulement).
 */
export type DecimalReadMode = "editor" | "canonical";

/**
 * Valeur exacte d'une écriture décimale, exposant développé en entier exact. Les zéros de tête et
 * de queue ne comptent pas (`min_scale` PostgreSQL) ; un zéro signé (« -0 ») vaut 0 comme en
 * `numeric`. Refus (`ESTIMATE_V3_INPUT_INVALID`) : écriture illisible, valeur négative, plus de
 * `maxScale` décimales, plus de 20 chiffres entiers.
 */
export function decimalFromLiteral(text: string, field: string, maxScale: number): Decimal {
  const match = NUMBER_LITERAL_PATTERN.exec(text);
  if (!match) throw invalidInput(field, `écriture décimale illisible « ${text} »`);
  const [, sign, whole, fraction = "", exponentText = "0"] = match;
  const significant = `${whole}${fraction}`.replace(/^0+/, "");
  const digits = significant.replace(/0+$/, "");
  if (digits === "") return DECIMAL_ZERO;
  if (sign === "-") throw invalidInput(field, "valeur négative refusée");
  // Valeur = digits × 10^exponent (un exposant démesuré donne ±Infinity : refusé ci-dessous).
  const exponent = Number(exponentText) - fraction.length + (significant.length - digits.length);
  if (exponent >= 0) {
    if (digits.length + exponent > MAX_INTEGER_DIGITS) throw invalidInput(field, "valeur hors limite");
    return { units: BigInt(digits) * pow10(exponent), scale: 0 };
  }
  if (-exponent > maxScale) throw invalidInput(field, `plus de ${maxScale} décimale(s)`);
  return { units: BigInt(digits), scale: -exponent };
}

export type DecimalBounds = {
  /** Nombre maximal de décimales (échelle de la colonne). */
  scale: number;
  /** Borne supérieure incluse. */
  max: Decimal;
  /** Refuse 0 (coefficients de vente : ]0 ; 10]). */
  positive?: boolean;
};

/**
 * Lit un nombre JS (écriture la plus courte, `String`), un littéral JSON à sa source ou, pour
 * l'éditeur seulement, une chaîne décimale. Refuse (`ESTIMATE_V3_INPUT_INVALID`) : valeur non
 * finie, négative, plus de décimales que l'échelle, valeur hors bornes, chaîne sur le chemin
 * canonique. Les zéros finaux ne comptent pas comme décimales.
 */
export function parseDecimal(
  value: unknown,
  field: string,
  bounds: DecimalBounds,
  mode: DecimalReadMode = "editor"
): Decimal {
  let parsed: Decimal;
  if (value instanceof JsonNumberLiteral) {
    parsed = decimalFromLiteral(value.source, field, bounds.scale);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidInput(field, "valeur non finie");
    parsed = decimalFromLiteral(String(value), field, bounds.scale);
  } else if (typeof value === "string" && mode === "editor") {
    if (value.startsWith("-")) throw invalidInput(field, "valeur négative refusée");
    if (!DECIMAL_PATTERN.test(value)) throw invalidInput(field, `écriture décimale illisible « ${value} »`);
    parsed = decimalFromLiteral(value, field, bounds.scale);
  } else {
    throw invalidInput(field, mode === "canonical" ? "nombre JSON attendu" : "nombre attendu");
  }
  if (compare(parsed, bounds.max) > 0) throw invalidInput(field, "valeur hors limite");
  if (bounds.positive && parsed.units === ZERO) throw invalidInput(field, "valeur nulle refusée");
  return parsed;
}

/** Bornes des colonnes du schéma vivant (`numeric(p,s)` : valeur < 10^(p−s)). */
export function columnBounds(precision: number, scale: number): DecimalBounds {
  return { scale, max: { units: pow10(precision) - ONE, scale } };
}

export const INTEGER_BOUNDS: DecimalBounds = { scale: 0, max: decimalFromInteger(INT32_MAX) };
