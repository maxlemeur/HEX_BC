import { packagingUnitLabel } from "@/lib/catalogue/packagings";
import { formatDecimalInput } from "@/lib/numeric-input/parsers";
import { measurementUnitToken, normalizeMeasurementUnit } from "@/lib/units/normalize";

/**
 * The usual packaging of a request line's article (TI-690/TI-691, the owner's request of 2026-11-22): the office is
 * offered to round the line up to whole packagings (« 14 ml » of a tube sold by « Barre » of 6 ml: « 3 barres de 6 ml
 * = 18 ml »), and a supplier message template may write {conditionnement} (« 3 barres de 6 ml »). Nothing is rounded
 * without the office's click, and nothing new is stored: the rounding is the line's quantity, written as by hand.
 *
 * It applies to a line linked to an article whose usual packaging is in the line's unit, compared through the shared
 * unit referential (« ml », « m.l. », « ML » and « m » are the same unit; a unit outside it compares by its spelling),
 * as the supplier offers compare theirs. Arithmetic in exact thousandths: quantities have three decimals at most.
 * Pure: no network, no clock.
 */

export type MaterialRequestUsualPackaging = {
  /** « Barre », as the catalogue writes it. */
  label: string;
  /** Units of the article in one packaging, in `unit` (three decimals at most). */
  quantity: number;
  /** The article's unit, which the packaging keeps (product_packagings.unit). */
  unit: string;
};

export type PackagingRounding = {
  /** Whole packagings that hold the line's quantity. */
  count: number;
  /** count × the packaging's quantity: what the line would ask for. */
  quantity: number;
};

/** The largest quantity a request line accepts (materialRequestLineInputSchema, numeric(12,3)). */
const LINE_QUANTITY_MAX_THOUSANDTHS = BigInt(1_000_000_000);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const THOUSAND = BigInt(1000);

/**
 * The unit as the shared referential reads it (private.normalize_unit's TypeScript twin), else its spelling token: the
 * rule the supplier offers compare units by (estimates/supplier-offer-units.ts, SQL private.purchase_unit_token).
 */
function comparableUnit(value: string): string {
  return normalizeMeasurementUnit(value).unitCode ?? measurementUnitToken(value);
}

/** A decimal with three decimals at most as integer thousandths; null for anything else. */
function toThousandths(value: number | string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(6) : "") : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? "";
  if (/[1-9]/.test(fraction.slice(3))) return null;
  const units = BigInt(`${match[2]}${fraction.slice(0, 3).padEnd(3, "0")}`);
  return match[1] ? -units : units;
}

function fromThousandths(value: bigint): number {
  const fraction = (value % THOUSAND).toString().padStart(3, "0");
  return Number(`${value / THOUSAND}.${fraction}`);
}

/** The line's quantity and the packaging's, both positive, in thousandths; null when either is not. */
function operands(quantity: number | null, packaging: MaterialRequestUsualPackaging) {
  const line = toThousandths(quantity);
  const pack = toThousandths(packaging.quantity);
  if (line === null || pack === null || line <= ZERO || pack <= ZERO) return null;
  return { line, pack };
}

/** The article's usual packaging when it applies to the line: the line is in the packaging's unit. */
export function applicableUsualPackaging(
  line: { unit: string | null },
  packaging: MaterialRequestUsualPackaging | null | undefined,
): MaterialRequestUsualPackaging | null {
  if (!packaging || !line.unit?.trim() || !packaging.unit.trim()) return null;
  return comparableUnit(line.unit) === comparableUnit(packaging.unit) ? packaging : null;
}

/**
 * Packagings needed (ceil of the quantity over the packaging's) and the quantity they hold. Null when there is nothing
 * to offer: the quantity is unknown, zero or negative, already a whole number of packagings, or the rounding would
 * pass the largest quantity a line accepts.
 */
export function packagingRounding(
  quantity: number | null,
  packaging: MaterialRequestUsualPackaging,
): PackagingRounding | null {
  const read = operands(quantity, packaging);
  if (!read || read.line % read.pack === ZERO) return null;
  const count = (read.line + read.pack - ONE) / read.pack;
  const rounded = count * read.pack;
  if (rounded > LINE_QUANTITY_MAX_THOUSANDTHS) return null;
  return { count: Number(count), quantity: fromThousandths(rounded) };
}

/** How many packagings an exact multiple is; null for any other quantity. */
export function exactPackagingCount(
  quantity: number | null,
  packaging: MaterialRequestUsualPackaging,
): number | null {
  const read = operands(quantity, packaging);
  if (!read || read.line % read.pack !== ZERO) return null;
  return Number(read.line / read.pack);
}

/** The label in lowercase, with an « s » past one unless it already ends in s, x or z (« barres », « faisceaux »). */
export function pluralPackagingLabel(label: string, count: number): string {
  const lower = label.replace(/\s+/g, " ").trim().toLocaleLowerCase("fr-FR");
  return count > 1 && !/[sxz]$/.test(lower) ? `${lower}s` : lower;
}

/** « 3 barres de 6 ml », « 1 touret de 100 ml ». */
export function packagingCountText(count: number, packaging: MaterialRequestUsualPackaging): string {
  const unit = packagingUnitLabel(packaging.unit);
  return `${count} ${pluralPackagingLabel(packaging.label, count)} de ${formatDecimalInput(packaging.quantity)}${unit ? ` ${unit}` : ""}`;
}

/**
 * {conditionnement} of a line: its whole packagings when its quantity is an exact multiple of the usual packaging, in
 * that packaging's unit; null otherwise, so that an optional part around it vanishes.
 */
export function usualPackagingConditionnement(
  line: { quantity: number | null; unit: string | null },
  packaging: MaterialRequestUsualPackaging | null | undefined,
): string | null {
  const applicable = applicableUsualPackaging(line, packaging);
  if (!applicable) return null;
  const count = exactPackagingCount(line.quantity, applicable);
  return count === null ? null : packagingCountText(count, applicable);
}
