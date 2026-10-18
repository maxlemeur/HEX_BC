import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import type { EstimateLinePricingStatus } from "@/lib/units/normalize";

/**
 * Lot 2, sous-lot 2.7 - présentation d'un document v3 (conception D7, D8, D14 ; §14 « 2.7 ») :
 * libellés de statut, taux et lignes du pied v3, partagés par le document client (HTML du portail
 * et PDF), l'aperçu d'impression et les exports. Module pur, sans React : aucun montant n'est
 * calculé ici, seulement mis en forme depuis le gel ou le contrat client 2.
 */

/** Libellés imprimés d'un statut de ligne (mêmes mots que la grille v3). */
export const ESTIMATE_V3_STATUS_DOCUMENT_LABELS: Readonly<Record<EstimateLinePricingStatus, string>> = {
  priced: "Chiffrée",
  included: "Inclus",
  for_memory: "Pour mémoire",
  not_priced: "Non chiffrée",
  out_of_scope: "Hors lot",
  not_applicable: "Sans objet",
};

const RATE_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Taux en points de base imprimé en pourcentage français (550 → « 5,5 »). */
export function formatEstimateV3Rate(rateBp: number): string {
  return RATE_FORMAT.format(rateBp / 100);
}

/** Pied d'un document v3, indépendant de sa source (gel relu ou contrat client 2). */
export type EstimateV3DocumentFooter = {
  grossHtCents: number;
  discountCents: number;
  /** Taux de l'intention de remise, nul pour un montant ou sans remise. */
  discountRateBp: number | null;
  commercialRoundingCents: number;
  netHtCents: number;
  taxByRate: ReadonlyArray<{ rateBp: number; baseHtCents: number; taxCents: number }>;
  taxCents: number;
  payableTtcCents: number;
  reverseCharge: boolean;
};

export type EstimateV3FooterRow = {
  key: string;
  label: string;
  cents: number;
  /** Montant soustrait du brut (remise, arrondi commercial) : imprimé avec un signe moins. */
  deduction: boolean;
  emphasis: "net" | "payable" | "detail";
};

/**
 * Lignes du pied v3 dans l'ordre imprimé : brut, remise commerciale, arrondi commercial, HT net,
 * TVA de chaque taux sur sa base nette, total de TVA (plusieurs taux), TTC. En autoliquidation,
 * aucune ligne de TVA ni de TTC : la mention légale les remplace.
 */
export function buildEstimateV3FooterRows(
  footer: EstimateV3DocumentFooter,
  currency: SupportedEstimateCurrency
): EstimateV3FooterRow[] {
  const rows: EstimateV3FooterRow[] = [
    { key: "gross", label: "Total HT brut", cents: footer.grossHtCents, deduction: false, emphasis: "detail" },
  ];
  if (footer.discountCents > 0) {
    rows.push({ key: "discount", deduction: true, emphasis: "detail", cents: footer.discountCents,
      label: footer.discountRateBp === null ? "Remise commerciale" : `Remise commerciale (${formatEstimateV3Rate(footer.discountRateBp)} %)` });
  }
  if (footer.commercialRoundingCents > 0) {
    rows.push({ key: "rounding", label: "Arrondi commercial", cents: footer.commercialRoundingCents, deduction: true, emphasis: "detail" });
  }
  rows.push({ key: "net", label: "Total HT net", cents: footer.netHtCents, deduction: false, emphasis: "net" });
  if (footer.reverseCharge) return rows;
  for (const rate of footer.taxByRate) {
    rows.push({ key: `tax-${rate.rateBp}`, deduction: false, emphasis: "detail", cents: rate.taxCents,
      label: `TVA ${formatEstimateV3Rate(rate.rateBp)} % sur ${formatCurrency(rate.baseHtCents, currency)}` });
  }
  if (footer.taxByRate.length > 1) {
    rows.push({ key: "tax", label: "Total TVA", cents: footer.taxCents, deduction: false, emphasis: "detail" });
  }
  rows.push({ key: "payable", label: "Total TTC", cents: footer.payableTtcCents, deduction: false, emphasis: "payable" });
  return rows;
}

/** Montant d'une ligne de pied ; `minus` permet le trait d'union là où U+2212 n'est pas encodable. */
export function formatEstimateV3FooterAmount(
  row: Pick<EstimateV3FooterRow, "cents" | "deduction">,
  currency: SupportedEstimateCurrency,
  minus = "−"
): string {
  return `${row.deduction ? minus : ""}${formatCurrency(row.cents, currency)}`;
}

/** Taux imprimés en en-tête d'un document v3 (« 10 % · 20 % »), vide en autoliquidation. */
export function describeEstimateV3Rates(footer: Pick<EstimateV3DocumentFooter, "taxByRate" | "reverseCharge">): string {
  if (footer.reverseCharge) return "Autoliquidation";
  return footer.taxByRate.map((rate) => `${formatEstimateV3Rate(rate.rateBp)} %`).join(" · ");
}

/** Pied imprimé d'une copie commerciale v3 (contrat client 2), sans recalcul. */
export function footerFromClientContract2(totals: {
  grossHtCents: number;
  commercialDiscountCents: number;
  discountIntent: { kind: "none" | "amount" } | { kind: "rate"; rateBp: number };
  commercialRoundingCents: number;
  netHtCents: number;
  taxByRate: ReadonlyArray<{ rateBp: number; baseHtCents: number; taxCents: number }>;
  taxCents: number;
  payableTtcCents: number;
  reverseCharge: boolean;
}): EstimateV3DocumentFooter {
  return {
    grossHtCents: totals.grossHtCents,
    discountCents: totals.commercialDiscountCents,
    discountRateBp: totals.discountIntent.kind === "rate" ? totals.discountIntent.rateBp : null,
    commercialRoundingCents: totals.commercialRoundingCents,
    netHtCents: totals.netHtCents,
    taxByRate: totals.taxByRate,
    taxCents: totals.taxCents,
    payableTtcCents: totals.payableTtcCents,
    reverseCharge: totals.reverseCharge,
  };
}

/** Pied imprimé d'une v3 relue sur son gel (`prepareEstimateV3DocumentData`), sans recalcul. */
export function footerFromStoredV3Document(totals: {
  grossHtCents: number;
  discount: { rateBp: number | null; appliedCents: number };
  commercialRoundingCents: number;
  netHtCents: number;
  taxByRate: ReadonlyArray<{ rateBp: number; baseHtCents: number; taxCents: number }>;
  taxCents: number;
  payableTtcCents: number;
  reverseCharge: boolean;
}): EstimateV3DocumentFooter {
  return {
    grossHtCents: totals.grossHtCents,
    discountCents: totals.discount.appliedCents,
    discountRateBp: totals.discount.rateBp,
    commercialRoundingCents: totals.commercialRoundingCents,
    netHtCents: totals.netHtCents,
    taxByRate: totals.taxByRate,
    taxCents: totals.taxCents,
    payableTtcCents: totals.payableTtcCents,
    reverseCharge: totals.reverseCharge,
  };
}
