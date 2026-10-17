/**
 * Lot 2, sous-lot 2.4 - remise exacte et arrondi commercial (conception §4, étapes 7 à 9 ; D6, D7).
 *
 * Intention exclusive : montant M → R = min(M, G) ; taux bp → R = min(⌈G × bp / 10 000⌋, G) ;
 * aucune → 0. Aucun taux n'est dérivé d'un montant (ni l'inverse). Arrondi commercial en mode
 * `down`, pas s : A = (G − R) mod s, traité comme une remise HT (il réduit la base de TVA).
 */
import { divideHalfUp, ZERO } from "@/lib/estimates/engine-v3/decimal";
import type { V3DiscountIntent } from "@/lib/estimates/engine-v3/input";
import type { EstimateV3RoundingMode } from "@/lib/estimates/engine-v3/types";

const BASIS_POINTS = BigInt(10000);

export function computeDiscountApplied(gross: bigint, intent: V3DiscountIntent): bigint {
  switch (intent.kind) {
    case "none":
      return ZERO;
    case "amount":
      return intent.requestedCents < gross ? intent.requestedCents : gross;
    case "rate": {
      const computed = divideHalfUp(gross * intent.rateBp, BASIS_POINTS);
      return computed < gross ? computed : gross;
    }
  }
}

export function computeCommercialRounding(
  afterDiscount: bigint,
  mode: EstimateV3RoundingMode,
  stepCents: bigint
): bigint {
  return mode === "down" ? afterDiscount % stepCents : ZERO;
}
