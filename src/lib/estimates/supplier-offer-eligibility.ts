import type { SupplierOfferConditions } from "@/lib/estimates/supplier-offer-conditions";
import { isSupplierOfferPriceEligible, type SupplierOfferPrice } from "@/lib/estimates/supplier-offer-price";
import {
  conversionForLineUnit, hasPurchaseUnitConversion, offerEstimateUnit, purchaseQuantity,
} from "@/lib/estimates/supplier-offer-purchase-unit";
import { areSupplierUnitsCompatible } from "@/lib/estimates/supplier-offer-units";
import { isSupplierAlternativeCurrencyCompatible } from "@/lib/estimates/supplier-preselection";

export { areSupplierUnitsCompatible };

export function supplierOfferIneligibility(
  offer: SupplierOfferConditions & SupplierOfferPrice & { currency?: string | null },
  input: { currency: string; quantity?: number | null; unit?: string | null; today?: string },
): string | null {
  if (!isSupplierAlternativeCurrencyCompatible(offer, input.currency)) return "Conversion de devise requise";
  if (offer.is_active === false) return "Offre archivée";
  if (typeof offer.unit_price_cents !== "number" || !Number.isFinite(offer.unit_price_cents)) return "Prix de l'offre à vérifier";
  if (!isSupplierOfferPriceEligible(offer)) return "Offre à 0 € non marquée";
  // A converted offer (2.9) serves its estimate unit through the conversion and its purchase unit as is;
  // its minimum counts purchase units.
  const served = conversionForLineUnit(offer, input.unit);
  if (!areSupplierUnitsCompatible(input.unit, offerEstimateUnit(served))) return "Unité différente du devis";
  const ordered = typeof input.quantity === "number" && Number.isFinite(input.quantity)
    ? purchaseQuantity(served, input.quantity) : null;
  if (hasPurchaseUnitConversion(served) && typeof input.quantity === "number" && ordered === null) {
    return `Quantité non convertible en ${offer.unit || "unité d'achat"}`;
  }
  if (typeof offer.min_quantity === "number" && Number.isFinite(offer.min_quantity)) {
    if (ordered === null) return "Quantité du devis à préciser";
    if (ordered < offer.min_quantity) return `Minimum ${offer.min_quantity} ${offer.unit || "u"}`;
  }
  const now = new Date();
  const today = input.today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (offer.valid_from && offer.valid_from > today) return "Offre pas encore valable";
  if (offer.valid_to && offer.valid_to < today) return "Offre expirée";
  return null;
}
