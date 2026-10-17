// A7 (lot 2, sub-lot 2.2): an offer at 0 € prices nothing unless it is explicitly marked
// "included" or "free". Mirrors public.supplier_offer_price_eligible
// (supabase/migrations/20261017093407_supplier_offer_zero_price_policy.sql).

export const SUPPLIER_OFFER_ZERO_PRICE_KINDS = ["included", "free"] as const;
export const SUPPLIER_OFFER_ZERO_PRICE_KIND_ERROR = "Le marquage « Inclus » ou « Gratuit » exige un prix à 0 €.";
export type SupplierOfferZeroPriceKind = (typeof SUPPLIER_OFFER_ZERO_PRICE_KINDS)[number];

export type SupplierOfferPrice = {
  unit_price_cents?: number | null;
  zero_price_kind?: string | null;
};

/** False when the price is unknown: a missing price never makes an offer usable. */
export function isSupplierOfferPriceEligible(offer: SupplierOfferPrice): boolean {
  const cents = offer.unit_price_cents;
  return (typeof cents === "number" && Number.isFinite(cents) && cents > 0) ||
    (offer.zero_price_kind !== null && offer.zero_price_kind !== undefined);
}

export function supplierOfferZeroPriceLabel(kind: string | null | undefined): string | null {
  if (kind === "included") return "Inclus";
  if (kind === "free") return "Gratuit";
  return null;
}
