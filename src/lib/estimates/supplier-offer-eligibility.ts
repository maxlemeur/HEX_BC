import type { SupplierOfferConditions } from "@/lib/estimates/supplier-offer-conditions";
import { isSupplierAlternativeCurrencyCompatible } from "@/lib/estimates/supplier-preselection";

function normalizedUnit(value: string) {
  const unit = value.trim().toLowerCase();
  return unit === "ml" ? "m" : unit;
}

export function supplierOfferIneligibility(
  offer: SupplierOfferConditions & { currency?: string | null },
  input: { currency: string; quantity?: number | null; unit?: string | null; today?: string },
): string | null {
  if (!isSupplierAlternativeCurrencyCompatible(offer, input.currency)) return "Conversion de devise requise";
  if (offer.is_active === false) return "Offre archivée";
  if (input.unit?.trim() && offer.unit?.trim() && normalizedUnit(input.unit) !== normalizedUnit(offer.unit)) {
    return "Unité différente du devis";
  }
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
