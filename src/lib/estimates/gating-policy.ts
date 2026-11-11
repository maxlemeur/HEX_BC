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
  "excluded_without_reason",
] as const;

/**
 * TI-682 (D25): flags no tenant setting can downgrade and no administrator can force. A « Non chiffrée » line is a
 * line still to classify: it is priced, or given the status the client reads (« Inclus », « Pour mémoire », « Hors
 * lot », « Sans objet »). Lot C (D11): a line so classified after « Non chiffrée » says why, internally.
 */
export const ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS: readonly EstimateGatingFlagKey[] = [
  "not_priced_unclassified",
  "excluded_without_reason",
];

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
      "Une ligne « Non chiffrée » ne part pas chez le client sans décision. Chiffrez-la, ou donnez-lui le statut qui convient : Inclus, Pour mémoire, Hors lot ou Sans objet.",
  },
  priced_line_without_amount: {
    label: "Lignes chiffrées à 0 €",
    description:
      "Une ligne « Chiffrée » sans prix ni heures partirait à 0 €. Chiffrez-la, ou donnez-lui le statut « Inclus » ou « Pour mémoire ».",
  },
  excluded_without_reason: {
    label: "Motif interne d'exclusion à saisir",
    description:
      "Une prestation laissée « Non chiffrée » puis classée Inclus, Pour mémoire, Hors lot ou Sans objet dit pourquoi avant l'envoi. Ce motif reste interne : le client ne le lit jamais.",
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
  excluded_without_reason: "blocking",
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
