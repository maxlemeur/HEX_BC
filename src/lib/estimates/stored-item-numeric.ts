import { badRequest } from "@/lib/estimates/errors";

type JsonDecimal = { coefficient: bigint; exponent: number };

function parseJsonDecimal(value: number): JsonDecimal {
  if (!Number.isFinite(value)) {
    throw badRequest("La valeur décimale doit être finie.");
  }
  const [coefficient, exponent = "0"] = Math.abs(value).toString().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  return {
    coefficient: BigInt(whole + fraction) * (value < 0 ? BigInt(-1) : BigInt(1)),
    exponent: Number(exponent) - fraction.length,
  };
}

function roundStoredDecimal(value: JsonDecimal, scale: 3 | 4): number {
  const negative = value.coefficient < BigInt(0);
  const digits = negative ? -value.coefficient : value.coefficient;
  const shift = value.exponent + scale;
  let stored: bigint;
  if (shift >= 0) {
    stored = digits * BigInt(10) ** BigInt(shift);
  } else {
    const divisor = BigInt(10) ** BigInt(-shift);
    stored = digits / divisor;
    if ((digits % divisor) * BigInt(2) >= divisor) stored += BigInt(1);
  }
  if (stored >= BigInt("1000000000000")) {
    throw badRequest("La valeur décimale dépasse la précision de stockage.");
  }
  // Avoid retaining negative zero after rounding a small negative value.
  return stored === BigInt(0) ? 0 : (negative ? -1 : 1) * Number(stored) / 10 ** scale;
}

/** Match numeric(12, scale) on the decimal representation sent in JSON. */
export function toStoredEstimateNumeric(value: number, scale: 3 | 4): number {
  return roundStoredDecimal(parseJsonDecimal(value), scale);
}

/** Round once after multiplying the JSON decimals, without a floating product. */
export function multiplyToStoredEstimateNumeric(left: number, right: number, scale: 3 | 4): number {
  const a = parseJsonDecimal(left);
  const b = parseJsonDecimal(right);
  return roundStoredDecimal({
    coefficient: a.coefficient * b.coefficient,
    exponent: a.exponent + b.exponent,
  }, scale);
}

const ITEM_DECIMAL_SCALES = {
  quantity: 3,
  k_fo: 3,
  h_mo: 3,
  k_mo: 3,
  h_mo_atelier: 3,
  k_mo_atelier: 3,
  h_mo_chantier: 3,
  k_mo_chantier: 3,
  h_mo_majoration: 4,
} as const;

export function normalizeStoredItemNumerics<T extends object>(item: T): T {
  const result = { ...item };
  for (const [field, scale] of Object.entries(ITEM_DECIMAL_SCALES)) {
    const value: unknown = Reflect.get(item, field);
    if (typeof value === "number") {
      Reflect.set(result, field, toStoredEstimateNumeric(value, scale));
    }
  }
  return result;
}
