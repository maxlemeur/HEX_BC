import { ESTIMATE_QUALITY_FLAG_KEYS, ESTIMATE_QUALITY_FLAG_META } from "@/lib/estimate-quality";
import type { Database } from "@/types/database";

export const GATING_BLOCKING_FLAGS_KEY = "ESTIMATE_GATING_BLOCKING_FLAGS";
export const GATING_WARNING_FLAGS_KEY = "ESTIMATE_GATING_WARNING_FLAGS";

export const ESTIMATE_GATING_FLAG_KEYS = [
  ...ESTIMATE_QUALITY_FLAG_KEYS,
  "margin_not_configured",
  "total_exceeds_budget",
  "no_pdf_generated",
  "rule_violation",
  "critical_missing_pieces",
  "critical_open_questions",
  "client_missing_documents_required",
  "client_clarification_required",
  "missing_pieces_pending",
  "open_questions_pending",
  "version_zero_review_pending",
  "not_priced_unclassified",
  "priced_line_without_amount",
  "exclusion_without_reason",
  "offer_reserve_not_written",
  "offer_reserve_basis_conflict",
] as const;

/**
 * TI-682 (D25): flags no tenant setting can downgrade. A « Non chiffrée » line is a line still to classify: it is
 * priced, given the status the client reads (« Inclus », « Pour mémoire », « Hors lot », « Sans objet »), or left
 * « Non chiffrée » under a reserve written in the offer (offer-treatment.ts).
 */
export const ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS: readonly EstimateGatingFlagKey[] = ["not_priced_unclassified"];

export type EstimateGatingFlagKey = (typeof ESTIMATE_GATING_FLAG_KEYS)[number];

export type EstimateGatingSeverity = "blocking" | "warning";

export type EstimateGatingFlagMeta = {
  label: string;
  description: string;
};

export const ESTIMATE_GATING_FLAG_META: Record<
  EstimateGatingFlagKey,
  EstimateGatingFlagMeta
> = {
  ...ESTIMATE_QUALITY_FLAG_META,
  margin_not_configured: {
    label: "Marge par tranches non configurée",
    description:
      "Le mode de marge par tranches est actif mais aucune tranche n'est configurée pour cette organisation.",
  },
  total_exceeds_budget: {
    label: "Budget dépassé",
    description:
      "Le total HT du devis dépasse le plafond budgétaire configuré pour le projet.",
  },
  no_pdf_generated: {
    label: "PDF absent",
    description:
      "Aucun document PDF n'est généré pour cette version. Lancez une génération avant l'envoi.",
  },
  rule_violation: {
    label: "Règles métier non respectées",
    description:
      "Des règles métier (marge, remise, approbation) ne sont pas satisfaites.",
  },
  critical_missing_pieces: {
    label: "Documents critiques manquants",
    description:
      "Le registre affaire contient des pièces manquantes critiques encore ouvertes.",
  },
  critical_open_questions: {
    label: "Questions critiques ouvertes",
    description:
      "Le registre affaire contient des hypothèses ou pièces manquantes critiques encore ouvertes.",
  },
  client_missing_documents_required: {
    label: "Documents attendus du client",
    description:
      "Le registre affaire contient des pièces attendues du client avant l'envoi.",
  },
  client_clarification_required: {
    label: "Clarification client requise",
    description:
      "Le registre affaire contient des points à clarifier avec le client avant l'envoi.",
  },
  missing_pieces_pending: {
    label: "Documents manquants à traiter",
    description:
      "Des pièces manquantes non critiques restent ouvertes dans le registre affaire.",
  },
  open_questions_pending: {
    label: "Questions ouvertes à traiter",
    description:
      "Des hypothèses ou pièces manquantes non critiques restent ouvertes dans le registre affaire.",
  },
  version_zero_review_pending: {
    label: "V0 IA à revoir",
    description:
      "Une V0 assistée est encore active sur cette version. La revue humaine explicite doit être finalisée avant envoi.",
  },
  not_priced_unclassified: {
    label: "Lignes non chiffrées à classer",
    description:
      "Une ligne « Non chiffrée » ne part pas chez le client sans décision. Chiffrez-la, donnez-lui le statut qui convient (Inclus, Pour mémoire, Hors lot ou Sans objet), ou écrivez une réserve dans l’offre si le devis est privé ou si le règlement de consultation déclare les quantités indicatives.",
  },
  priced_line_without_amount: {
    label: "Lignes chiffrées à 0 €",
    description:
      "Une ligne « Chiffrée » sans prix ni heures partirait à 0 €. Chiffrez-la, ou donnez-lui le statut « Inclus » ou « Pour mémoire ».",
  },
  exclusion_without_reason: {
    label: "Exclusions sans motif interne",
    description:
      "Une ligne « Hors lot » ou « Sans objet » garde le motif de son exclusion. Le client lit le statut ; le motif reste interne. Renseignez-le dans « Motifs et réserves ».",
  },
  offer_reserve_not_written: {
    label: "Réserves à réécrire dans l’offre",
    description:
      "Le texte « Précisions et limites de prestation » ne correspond plus aux réserves des lignes : la phrase d’une réserve en a disparu, et le client ne la lirait pas, ou il garde la phrase d’une ligne dont le statut a changé. Ouvrez « Motifs et réserves » et enregistrez : le texte de l’offre est remis en accord.",
  },
  offer_reserve_basis_conflict: {
    label: "Réserves sur deux bases différentes",
    description:
      "Les réserves d’un même devis reposent sur une seule base : devis privé, ou quantités déclarées indicatives par le règlement de consultation. Alignez-les dans « Motifs et réserves ».",
  },
};

const DEFAULT_GATING_SEVERITY_BY_FLAG: Record<
  EstimateGatingFlagKey,
  EstimateGatingSeverity
> = {
  missing_price: "blocking",
  missing_quantity: "blocking",
  missing_labor_time: "warning",
  missing_labor_role: "warning",
  line_nature_mismatch: "blocking",
  price_outlier: "warning",
  quantity_outlier: "warning",
  supplier_price_outdated: "warning",
  labor_split_incomplete: "warning",
  margin_not_configured: "blocking",
  total_exceeds_budget: "blocking",
  no_pdf_generated: "blocking",
  rule_violation: "blocking",
  critical_missing_pieces: "blocking",
  critical_open_questions: "blocking",
  client_missing_documents_required: "blocking",
  client_clarification_required: "blocking",
  missing_pieces_pending: "warning",
  open_questions_pending: "warning",
  version_zero_review_pending: "blocking",
  not_priced_unclassified: "blocking",
  priced_line_without_amount: "blocking",
  // The reason is internal: its absence is shown before sending and a tenant can make it blocking.
  exclusion_without_reason: "warning",
  offer_reserve_not_written: "blocking",
  offer_reserve_basis_conflict: "blocking",
};

function parseFlagOverride(value: string | null): Set<string> {
  return new Set(value?.toLowerCase().split(/[,;\s]+/).filter(Boolean));
}

export function resolveSeverityByFlag(input: {
  blockingOverride: string | null;
  warningOverride: string | null;
}): Record<EstimateGatingFlagKey, EstimateGatingSeverity> {
  const blocking = parseFlagOverride(input.blockingOverride);
  const warnings = parseFlagOverride(input.warningOverride);
  const severities = {} as Record<EstimateGatingFlagKey, EstimateGatingSeverity>;
  for (const key of ESTIMATE_GATING_FLAG_KEYS) {
    if (blocking.has(key) || ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS.includes(key)) severities[key] = "blocking";
    else if (warnings.has(key)) severities[key] = "warning";
    else severities[key] = DEFAULT_GATING_SEVERITY_BY_FLAG[key];
  }
  return severities;
}

type LaborSplitFields = Pick<
  Database["public"]["Tables"]["estimate_items"]["Row"],
  | "h_mo_atelier"
  | "labor_role_atelier_id"
  | "h_mo_chantier"
  | "labor_role_chantier_id"
  | "k_mo_atelier"
  | "k_mo_chantier"
>;

// The gate treats an explicitly stored zero-hour split differently from an absent split.
export function hasStoredLaborSplit(item: LaborSplitFields) {
  return (
    item.h_mo_atelier != null ||
    item.labor_role_atelier_id != null ||
    item.h_mo_chantier != null ||
    item.labor_role_chantier_id != null ||
    (item.k_mo_atelier ?? 1) !== 1 ||
    (item.k_mo_chantier ?? 1) !== 1
  );
}
