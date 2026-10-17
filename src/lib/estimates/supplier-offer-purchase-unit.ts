// Purchase unit and packaging of a supplier offer (lot 2, sub-lot 2.9, P-18). Mirrors the SQL twins
// private.purchase_quantity and private.purchase_unit_price_cents of migration
// 20261017172127_supplier_offer_purchase_unit.sql. Contract: docs/testing/estimate-engine-v3-2.9.md.
// Exact arithmetic: the factor (numeric(14,6)) is read in millionths and quantities in thousandths, so
// every division and half-up rounding works on integers.

export const SUPPLIER_OFFER_PURCHASE_ROUNDINGS = ["none", "ceil"] as const;
export type SupplierOfferPurchaseRounding = (typeof SUPPLIER_OFFER_PURCHASE_ROUNDINGS)[number];

export type SupplierOfferPurchaseUnit = {
  unit?: string | null;
  estimate_unit_code?: string | null;
  estimate_units_per_purchase_unit?: number | string | null;
  purchase_rounding?: string | null;
};

const MILLION = BigInt(1_000_000);
const THOUSAND = BigInt(1_000);

/** Decimal text or number to an exact integer count of 10^-scale units; null when not representable. */
function toScaledInteger(value: number | string, scale: number): bigint | null {
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(scale + 2) : "") : value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.slice(scale).replace(/0/g, "") !== "") return null;
  return BigInt(match[1] + fraction.slice(0, scale).padEnd(scale, "0"));
}

/** Half-up division of non-negative integers. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
}

function factorMillionths(offer: SupplierOfferPurchaseUnit): bigint | null {
  const raw = offer.estimate_units_per_purchase_unit;
  if (raw === null || raw === undefined || raw === "") return null;
  const factor = toScaledInteger(raw, 6);
  return factor !== null && factor > BigInt(0) ? factor : null;
}

export function hasPurchaseUnitConversion(offer: SupplierOfferPurchaseUnit): boolean {
  return Boolean(offer.estimate_unit_code?.trim()) && factorMillionths(offer) !== null;
}

/** The unit in which the offer prices an estimate line. */
export function offerEstimateUnit(offer: SupplierOfferPurchaseUnit): string | null {
  return hasPurchaseUnitConversion(offer) ? offer.estimate_unit_code!.trim() : offer.unit ?? null;
}

/** Offer price per estimate unit, in cents: 262,45 € a bar of 3 ml → 87,48 €. */
export function offerEstimateUnitPriceCents(offer: SupplierOfferPurchaseUnit, purchaseUnitPriceCents: number): number {
  const factor = hasPurchaseUnitConversion(offer) ? factorMillionths(offer) : null;
  if (factor === null || !Number.isSafeInteger(purchaseUnitPriceCents) || purchaseUnitPriceCents < 0) return purchaseUnitPriceCents;
  return Number(divideHalfUp(BigInt(purchaseUnitPriceCents) * MILLION, factor));
}

/** Quantity ordered in the purchase unit; null when it is not a multiple of 0.001. */
export function purchaseQuantity(offer: SupplierOfferPurchaseUnit, estimateQuantity: number): number | null {
  const factor = hasPurchaseUnitConversion(offer) ? factorMillionths(offer) : null;
  if (factor === null) return estimateQuantity;
  const thousandths = toScaledInteger(estimateQuantity, 3);
  if (thousandths === null || thousandths < BigInt(0)) return null;
  // quantity / factor = thousandths * 1000 / factorMillionths purchase units.
  const units = thousandths * THOUSAND;
  if (offer.purchase_rounding === "ceil") return Number((units + factor - BigInt(1)) / factor);
  const purchaseThousandths = units * THOUSAND;
  if (purchaseThousandths % factor !== BigInt(0)) return null;
  return Number(purchaseThousandths / factor) / 1000;
}

/** Order price per purchase unit: the offer price unless the line price was negotiated. */
export function purchaseUnitPriceCents(
  offer: SupplierOfferPurchaseUnit,
  offerPurchaseUnitPriceCents: number,
  lineUnitPriceCents: number,
): number {
  const factor = hasPurchaseUnitConversion(offer) ? factorMillionths(offer) : null;
  if (factor === null || !Number.isSafeInteger(lineUnitPriceCents) || lineUnitPriceCents < 0) return lineUnitPriceCents;
  if (lineUnitPriceCents === offerEstimateUnitPriceCents(offer, offerPurchaseUnitPriceCents)) return offerPurchaseUnitPriceCents;
  return Number(divideHalfUp(BigInt(lineUnitPriceCents) * factor, MILLION));
}
