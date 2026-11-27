import { formatDecimalInput } from "@/lib/numeric-input/parsers";

import type { SupplierBaseRow } from "./supplier-base-contract";

const MAX_PRICE_CENTS = BigInt(2_147_483_647);
const ZERO = BigInt(0);
const TEN = BigInt(10);
const LOT_SIZE = 100;

type Decimal = { coefficient: bigint; scale: number };
type Price = NonNullable<SupplierBaseRow["price"]>;
type ParsedPrice = { price: Price; issue: "zero_price" | "inexact_price" | "price_cents_overflow" | null };

function readDecimal(value: unknown): Decimal | null {
  // Excel numbers have 15 significant digits. Strip floating-point noise before comparing exact digits.
  const written = typeof value === "number" && Number.isFinite(value)
    ? formatDecimalInput(Number(value.toPrecision(15))).replace(",", ".")
    : typeof value === "string" ? value.trim().replace(",", ".") : "";
  const parts = /^\+?(\d+)(?:\.(\d+))?$/u.exec(written);
  if (!parts) return null;
  const whole = parts[1].replace(/^0+(?=\d)/u, "");
  const fraction = (parts[2] ?? "").replace(/0+$/u, "");
  return {
    coefficient: BigInt(whole + fraction),
    scale: fraction.length,
  };
}

function asCents(decimal: Decimal, factor: number) {
  const numerator = decimal.coefficient * BigInt(100 * factor);
  const denominator = TEN ** BigInt(decimal.scale);
  return numerator % denominator === ZERO ? numerator / denominator : null;
}

function decimalText(coefficient: bigint, scale: number) {
  const digits = coefficient.toString().padStart(scale + 1, "0");
  const point = digits.length - scale;
  const fraction = digits.slice(point).replace(/0+$/u, "");
  return `${digits.slice(0, point)}.${fraction.padEnd(2, "0")}`;
}

export function readSupplierBasePrice(value: number, pricePer: 1 | 100): ParsedPrice | null {
  const decimal = readDecimal(value);
  if (!decimal) return null;
  const cents = asCents(decimal, 1);
  const origin = pricePer === LOT_SIZE ? "supplier" : cents === null ? "converted" : "unit";
  const candidateCents = origin === "converted" ? asCents(decimal, LOT_SIZE) : cents;
  const outOfRange = candidateCents !== null && candidateCents > MAX_PRICE_CENTS;
  return {
    price: {
      unit_decimal: decimalText(decimal.coefficient, decimal.scale + (origin === "supplier" ? 2 : 0)),
      per: origin === "unit" ? 1 : LOT_SIZE,
      amount_cents: candidateCents !== null && !outOfRange ? Number(candidateCents) : null,
      origin,
    },
    issue: candidateCents === null ? "inexact_price" : outOfRange ? "price_cents_overflow" : candidateCents === ZERO ? "zero_price" : null,
  };
}

export function sameSupplierBaseUnitPrice(unitDecimal: string, catalogueCents: number, unitsPerPurchase: number) {
  const workbook = readDecimal(unitDecimal);
  const quantity = readDecimal(unitsPerPurchase);
  if (!workbook || !quantity) return false;
  return workbook.coefficient * quantity.coefficient * BigInt(100)
    === BigInt(catalogueCents) * TEN ** BigInt(workbook.scale + quantity.scale);
}

/** Compare the cached pack price with the source price and quantity, including a cent-rounded pack formula. */
export function packagingPriceIssue(priceText: string, quantityValue: number, packPriceValue: unknown) {
  const price = readDecimal(priceText);
  const quantity = readDecimal(quantityValue);
  const packPrice = readDecimal(packPriceValue);
  if (!price || !quantity || !packPrice) return "invalid_packaging_price" as const;

  const numerator = price.coefficient * quantity.coefficient;
  const denominator = TEN ** BigInt(price.scale + quantity.scale);
  const packScale = TEN ** BigInt(packPrice.scale);
  if (numerator * packScale === packPrice.coefficient * denominator) return null;
  const expectedRoundedCents = (numerator * BigInt(200) + denominator) / (denominator * BigInt(2));
  if (expectedRoundedCents * packScale === packPrice.coefficient * BigInt(100)) return null;
  return "packaging_price_mismatch" as const;
}
