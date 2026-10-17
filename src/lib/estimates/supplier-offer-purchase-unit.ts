// Purchase unit and packaging of a supplier offer (lot 2, sub-lot 2.9, P-18). Mirrors the SQL
// twins of migration M7. Contract: docs/testing/estimate-engine-v3-2.9.md.

export const SUPPLIER_OFFER_PURCHASE_ROUNDINGS = ["none", "ceil"] as const;
export type SupplierOfferPurchaseRounding = (typeof SUPPLIER_OFFER_PURCHASE_ROUNDINGS)[number];

export type SupplierOfferPurchaseUnit = {
  unit?: string | null;
  estimate_unit_code?: string | null;
  estimate_units_per_purchase_unit?: number | string | null;
  purchase_rounding?: string | null;
};

/** Red-first stub (2.9): no conversion yet. */
export function hasPurchaseUnitConversion(offer: SupplierOfferPurchaseUnit): boolean {
  void offer;
  return false;
}

/** The unit in which the offer prices an estimate line. */
export function offerEstimateUnit(offer: SupplierOfferPurchaseUnit): string | null {
  return offer.unit ?? null;
}

/** Offer price per estimate unit, in cents. */
export function offerEstimateUnitPriceCents(offer: SupplierOfferPurchaseUnit, purchaseUnitPriceCents: number): number {
  void offer;
  return purchaseUnitPriceCents;
}

/** Quantity ordered in the purchase unit; null when it is not a multiple of 0.001. */
export function purchaseQuantity(offer: SupplierOfferPurchaseUnit, estimateQuantity: number): number | null {
  void offer;
  return estimateQuantity;
}

/** Order price per purchase unit, in cents. */
export function purchaseUnitPriceCents(
  offer: SupplierOfferPurchaseUnit,
  offerPurchaseUnitPriceCents: number,
  lineUnitPriceCents: number,
): number {
  void offer;
  void offerPurchaseUnitPriceCents;
  return lineUnitPriceCents;
}
