import type { SupplierOfferConditions } from "@/lib/estimates/supplier-offer-conditions";
import { isSupplierOfferPriceEligible, type SupplierOfferPrice } from "@/lib/estimates/supplier-offer-price";
import { isSupplierAlternativeCurrencyCompatible } from "@/lib/estimates/supplier-preselection";

// P-08: "ml" is the linear metre whatever its case ("ML" in a DPGF), equal to "m"; the
// millilitre is not part of the unit referential. Kept on purpose for every engine: the shared
// normaliser of sub-lot 2.4 (src/lib/units) replaces it, together with its SQL twin
// private.purchase_unit_token, only in sub-lot 2.9 (purchase unit carried by the offer, D9).
function normalizedUnit(value: string) {
  const unit = value.trim().toLowerCase();
  return unit === "ml" ? "m" : unit;
}

/** True when either unit is blank or both name the same unit (P-08). */
export function areSupplierUnitsCompatible(lineUnit: string | null | undefined, offerUnit: string | null | undefined) {
  return !lineUnit?.trim() || !offerUnit?.trim() || normalizedUnit(lineUnit) === normalizedUnit(offerUnit);
}

export function supplierOfferIneligibility(
  offer: SupplierOfferConditions & SupplierOfferPrice & { currency?: string | null },
  input: { currency: string; quantity?: number | null; unit?: string | null; today?: string },
): string | null {
  if (!isSupplierAlternativeCurrencyCompatible(offer, input.currency)) return "Conversion de devise requise";
  if (offer.is_active === false) return "Offre archivée";
  if (typeof offer.unit_price_cents !== "number" || !Number.isFinite(offer.unit_price_cents)) return "Prix de l'offre à vérifier";
  if (!isSupplierOfferPriceEligible(offer)) return "Offre à 0 € non marquée";
  if (!areSupplierUnitsCompatible(input.unit, offer.unit)) return "Unité différente du devis";
  if (typeof offer.min_quantity === "number" && Number.isFinite(offer.min_quantity)) {
    if (typeof input.quantity !== "number" || !Number.isFinite(input.quantity)) return "Quantité du devis à préciser";
    if (input.quantity < offer.min_quantity) return `Minimum ${offer.min_quantity} ${offer.unit || "u"}`;
  }
  const now = new Date();
  const today = input.today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (offer.valid_from && offer.valid_from > today) return "Offre pas encore valable";
  if (offer.valid_to && offer.valid_to < today) return "Offre expirée";
  return null;
}
