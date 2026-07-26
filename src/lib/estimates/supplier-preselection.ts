/**
 * Un prix fournisseur est-il utilisable tel quel dans un devis ?
 *
 * Injecter un montant libelle en devise etrangere sans conversion le ferait
 * passer pour un montant dans la devise du devis — une erreur monetaire
 * silencieuse de l'ordre de l'ecart de change. Tant qu'aucune conversion par
 * taux n'existe (`currency-rates.ts` n'a pas de helper `convertCents`),
 * l'arbitrage revient a l'acheteur.
 *
 * Une devise absente est consideree compatible : le catalogue historique ne la
 * renseignait pas, et la traiter comme incompatible bloquerait tout l'existant.
 *
 * Source unique : ce predicat sert la preselection automatique (serveur) ET la
 * selection manuelle depuis le panneau de comparaison (client). Les deux
 * chemins doivent refuser la meme chose — sans quoi bloquer l'un laisse
 * l'autre grand ouvert, ce qui etait le cas.
 */
export function isSupplierAlternativeCurrencyCompatible(
  alternative: { currency?: string | null },
  estimateCurrency: string
): boolean {
  const raw = alternative.currency?.trim().toUpperCase();
  if (!raw) return true;
  return raw === estimateCurrency.trim().toUpperCase();
}

export type EstimateSupplierComparisonAlternativeKind =
  | "best_price"
  | "most_recent"
  | "preferred_supplier"
  | "selected_current";

export type EstimateSupplierComparisonCoverageStatus =
  | "covered"
  | "ambiguous"
  | "no_price"
  | "stale";

export type EstimateSupplierComparisonRiskFlag =
  | "multiple_alternatives"
  | "selection_missing"
  | "selected_stale"
  | "selected_not_best_price";

export type EstimateSupplierComparisonAlternativeContract = {
  kind: EstimateSupplierComparisonAlternativeKind;
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
  is_selected: boolean;
};

export type EstimateSupplierPreselectionPatch = {
  unit_price_ht_cents: number;
  selected_supplier_price_id: string;
};

export type EstimateSupplierPreselectionProposalReason =
  | "single_clear_option";

export type EstimateSupplierPreselectionExceptionReason =
  | "divergence"
  | "stale"
  | "ambiguous"
  | "no_price"
  /**
   * Le(s) prix fournisseur disponibles sont libellés dans une autre devise que
   * le devis. On ne préselectionne jamais automatiquement dans ce cas : injecter
   * le montant tel quel le ferait passer pour un montant dans la devise du
   * devis (erreur monétaire silencieuse). L'arbitrage revient à l'acheteur.
   */
  | "currency_mismatch";

export type EstimateSupplierPreselectionProposal = {
  item_id: string;
  item_title: string;
  current_alternative: EstimateSupplierComparisonAlternativeContract | null;
  proposed_alternative: EstimateSupplierComparisonAlternativeContract;
  patch: EstimateSupplierPreselectionPatch;
  reason: EstimateSupplierPreselectionProposalReason;
  explanation: string;
  is_reversible: true;
};

export type EstimateSupplierPreselectionException = {
  item_id: string;
  item_title: string;
  reason: EstimateSupplierPreselectionExceptionReason;
  coverage_status: EstimateSupplierComparisonCoverageStatus;
  risk_flags: EstimateSupplierComparisonRiskFlag[];
  selected_alternative: EstimateSupplierComparisonAlternativeContract | null;
  alternatives: EstimateSupplierComparisonAlternativeContract[];
};

export type EstimateSupplierPreselectionSummary = {
  total_items: number;
  proposed_items: number;
  exception_items: number;
  already_selected_items: number;
  divergence_items: number;
  stale_items: number;
  ambiguous_items: number;
  no_price_items: number;
  currency_mismatch_items: number;
};

export type EstimateSupplierPreselectionReview = {
  summary: EstimateSupplierPreselectionSummary;
  proposals: EstimateSupplierPreselectionProposal[];
  exceptions: EstimateSupplierPreselectionException[];
};
