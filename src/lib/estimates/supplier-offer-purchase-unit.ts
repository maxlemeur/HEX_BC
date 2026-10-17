// Purchase unit and packaging of a supplier offer (lot 2, sub-lot 2.9, P-18). Mirrors the SQL twins
// private.purchase_quantity and private.purchase_unit_price_cents of migration
// 20261017172127_supplier_offer_purchase_unit.sql. Contract: docs/testing/estimate-engine-v3-2.9.md.
// Exact arithmetic: the factor (numeric(14,6)) is read in millionths and quantities in thousandths, so
// every division and half-up rounding works on integers.
import { areSupplierUnitsCompatible } from "@/lib/estimates/supplier-offer-units";

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

/**
 * A converted offer serves both of its units (review of 2.9): a line written in the purchase unit
 * ("barre") is priced and ordered as such, without conversion; any other line goes through it.
 * SQL twin: private.purchase_conversion_factor (migration M7).
 */
export function conversionForLineUnit<T extends SupplierOfferPurchaseUnit>(offer: T, lineUnit: string | null | undefined): T {
  if (!hasPurchaseUnitConversion(offer) || !lineUnit?.trim() || !offer.unit?.trim()) return offer;
  if (!areSupplierUnitsCompatible(lineUnit, offer.unit) || areSupplierUnitsCompatible(lineUnit, offer.estimate_unit_code)) return offer;
  return { ...offer, estimate_unit_code: null, estimate_units_per_purchase_unit: null, purchase_rounding: null };
}

/** The unit and price an offer gives a line written in `lineUnit`. */
export function supplierPriceForLineUnit(
  offer: SupplierOfferPurchaseUnit,
  prices: { estimateUnitPriceCents: number; purchaseUnitPriceCents: number },
  lineUnit: string | null | undefined,
): { unit: string | null; priceCents: number } {
  if (hasPurchaseUnitConversion(offer) && !hasPurchaseUnitConversion(conversionForLineUnit(offer, lineUnit))) {
    return { unit: offer.unit ?? null, priceCents: prices.purchaseUnitPriceCents };
  }
  return { unit: offerEstimateUnit(offer), priceCents: prices.estimateUnitPriceCents };
}

/**
 * The unit and price a catalogue suggestion or a comparison alternative gives a line written in
 * `lineUnit`. A suggestion carries the estimate unit in `unit` and the purchase unit in
 * `purchase_unit`; a comparison alternative carries the purchase unit in `unit`.
 */
export function alternativePriceForLineUnit(
  alternative: SupplierOfferPurchaseUnit & {
    purchase_unit?: string | null;
    unit_price_cents?: number | null;
    adjusted_unit_price_cents: number;
    adjusted_purchase_unit_price_cents?: number | null;
  },
  lineUnit: string | null | undefined,
): { unit: string | null; priceCents: number } {
  return supplierPriceForLineUnit({
    unit: alternative.purchase_unit ?? alternative.unit,
    estimate_unit_code: alternative.estimate_unit_code,
    estimate_units_per_purchase_unit: alternative.estimate_units_per_purchase_unit,
    purchase_rounding: alternative.purchase_rounding,
  }, {
    estimateUnitPriceCents: alternative.adjusted_unit_price_cents,
    purchaseUnitPriceCents: alternative.adjusted_purchase_unit_price_cents ?? alternative.unit_price_cents ??
      alternative.adjusted_unit_price_cents,
  }, lineUnit);
}
