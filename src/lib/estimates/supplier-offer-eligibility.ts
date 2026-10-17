import type { SupplierOfferConditions } from "@/lib/estimates/supplier-offer-conditions";
import { isSupplierOfferPriceEligible, type SupplierOfferPrice } from "@/lib/estimates/supplier-offer-price";
import { offerEstimateUnit, purchaseQuantity } from "@/lib/estimates/supplier-offer-purchase-unit";
import { isSupplierAlternativeCurrencyCompatible } from "@/lib/estimates/supplier-preselection";
import { measurementUnitToken, normalizeMeasurementUnit } from "@/lib/units/normalize";

// Sub-lot 2.9 (D9, point 30 of estimate-engine-v3-2.4.md): units resolve through the shared referential
// for every engine ("m.l." and "m" = ml, "Pce" = u, "forfait" = fft; no millilitre, P-08); a unit outside
// it ("barre") compares by its spelling token. SQL twin: private.purchase_unit_token.
function normalizedUnit(value: string) {
  return normalizeMeasurementUnit(value).unitCode ?? measurementUnitToken(value);
}

/** True when either unit is blank or both name the same unit (P-08, D9). */
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
  // A converted offer (2.9) serves its estimate unit; its minimum counts purchase units.
  if (!areSupplierUnitsCompatible(input.unit, offerEstimateUnit(offer))) return "Unité différente du devis";
  if (typeof offer.min_quantity === "number" && Number.isFinite(offer.min_quantity)) {
    if (typeof input.quantity !== "number" || !Number.isFinite(input.quantity)) return "Quantité du devis à préciser";
    const ordered = purchaseQuantity(offer, input.quantity);
    if (ordered === null) return `Quantité non convertible en ${offer.unit || "unité d'achat"}`;
    if (ordered < offer.min_quantity) return `Minimum ${offer.min_quantity} ${offer.unit || "u"}`;
  }
  const now = new Date();
  const today = input.today ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (offer.valid_from && offer.valid_from > today) return "Offre pas encore valable";
  if (offer.valid_to && offer.valid_to < today) return "Offre expirée";
  return null;
}
