import { formatDecimalInput } from "@/lib/numeric-input/parsers";

import type { SupplierBaseRow } from "./supplier-base-contract";

const MAX_PRICE_CENTS = BigInt(2_147_483_647);
const ZERO = BigInt(0);
const TEN = BigInt(10);
const LOT_SIZE = 100;

type Decimal = { text: string; coefficient: bigint; scale: number };
type ParsedPrice = NonNullable<SupplierBaseRow["price"]> & { issue: "inexact_price" | "price_cents_overflow" | null };

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
    text: `${whole}.${fraction.padEnd(2, "0")}`,
    coefficient: BigInt(whole + fraction),
    scale: fraction.length,
  };
}

function asCents(decimal: Decimal, factor: number) {
  const numerator = decimal.coefficient * BigInt(100 * factor);
  const denominator = TEN ** BigInt(decimal.scale);
  return numerator % denominator === ZERO ? numerator / denominator : null;
}

export function readSupplierBasePrice(value: unknown, pricePer: 1 | 100): ParsedPrice | null {
  const decimal = readDecimal(value);
  if (!decimal) return null;
  const cents = asCents(decimal, 1);
  const lotCents = pricePer === 1 && cents === null ? asCents(decimal, LOT_SIZE) : null;
  const candidateCents = cents ?? lotCents;
  const outOfRange = candidateCents !== null && candidateCents > MAX_PRICE_CENTS;
  return {
    decimal: decimal.text,
    per: pricePer,
    unit_price_cents: pricePer === 1 && cents !== null && !outOfRange ? Number(cents) : null,
    lot_price: lotCents !== null && !outOfRange ? { units: LOT_SIZE, amount_cents: Number(lotCents) } : null,
    issue: candidateCents === null ? "inexact_price" : outOfRange ? "price_cents_overflow" : null,
  };
}

/** Compare the cached pack price with the source price and quantity, including a cent-rounded pack formula. */
export function packagingPriceIssue(priceText: string, pricePer: 1 | 100, quantityValue: number, packPriceValue: unknown) {
  const price = readDecimal(priceText);
  const quantity = readDecimal(quantityValue);
  const packPrice = readDecimal(packPriceValue);
  if (!price || !quantity || !packPrice) return "invalid_packaging_price" as const;

  const numerator = price.coefficient * quantity.coefficient;
  const denominator = TEN ** BigInt(price.scale + quantity.scale) * BigInt(pricePer);
  const packScale = TEN ** BigInt(packPrice.scale);
  if (numerator * packScale === packPrice.coefficient * denominator) return null;
  const expectedRoundedCents = (numerator * BigInt(200) + denominator) / (denominator * BigInt(2));
  if (expectedRoundedCents * packScale === packPrice.coefficient * BigInt(100)) return null;
  return "packaging_price_mismatch" as const;
}
