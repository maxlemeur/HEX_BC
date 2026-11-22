import { ITEM_AGGREGATE_STATES, type ItemAggregateState } from "./item-answer-aggregation";
import type { ItemAnswerAnomaly, ItemIneligibility, ItemLineDecision, ItemSetAsideReason } from "./item-table";
import type { TakeoffUnitState } from "./launch-request-coverage";
import { describePosteStatus } from "./poste-aggregation";

/** The words of the table of items, in French: every code its contract carries has its label here, never on screen as is. */

/** The item's state, in the reading's words (describePosteStatus). */
export const ITEM_STATE_LABELS = Object.fromEntries(ITEM_AGGREGATE_STATES.map((state) => [state, describePosteStatus(state)])) as
  Record<ItemAggregateState, string>;

export const ITEM_DECISION_LABELS: Record<ItemLineDecision, string> = {
  pending: "À vérifier",
  accepted: "Accepté",
  set_aside: "Écarté",
  entered: "Saisi",
  none: "Rien à décider",
};

export const ITEM_SET_ASIDE_REASON_LABELS: Record<ItemSetAsideReason, string> = {
  out_of_scope: "Hors périmètre",
  duplicate: "Doublon",
  reading_error: "Erreur de lecture",
  other: "Autre",
};

export const ITEM_ANOMALY_LABELS: Record<ItemAnswerAnomaly, string> = {
  hypothesis: "Hypothèse",
  low_confidence: "Confiance faible",
  missing_evidence: "Preuve localisée manquante",
  rule_failed: "Contrôle en échec",
  rules_stale: "Contrôles à recalculer",
  alert: "Alerte à trancher",
  unit_mismatch: "Unité différente de l’unité attendue",
};

/** Why a gesture leaves a line out, as the confirmation lists it. */
export const ITEM_INELIGIBILITY_LABELS: Record<ItemIneligibility, string> = {
  not_measured: "pas mesuré",
  coverage_incomplete: "des plans restent à lire",
  anomaly: "à vérifier ligne à ligne",
  dpgf_gap: "écart à la DPGF à vérifier",
  unit_conflict: "unités différentes selon les plans",
  already_decided: "déjà décidé",
  entered: "quantité saisie",
  no_answer: "aucune lecture à écarter",
  already_set_aside: "déjà écarté",
  not_set_aside: "pas écarté",
  not_entry_state: "ni non trouvé ni incertain",
  no_entry_to_include: "aucune hypothèse à inclure",
  reading: "en lecture",
  no_plan: "aucun plan à lire",
  sent: "plan déjà envoyé au devis",
};

export const ITEM_UNIT_STATE_LABELS: Record<TakeoffUnitState, string> = {
  queued: "En attente de lecture",
  running: "En lecture",
  succeeded: "Lu",
  failed: "Lecture en échec",
  canceled: "Lecture arrêtée",
  not_started: "Non lu",
};

/** A reason code of a line (item-table.ts), in French; a code of the reading the table does not know is said generically. */
export function itemReasonLabel(reason: string): string {
  if (reason.startsWith("anomaly:")) {
    return ITEM_ANOMALY_LABELS[reason.slice("anomaly:".length) as ItemAnswerAnomaly] ?? "À vérifier";
  }
  if (reason.startsWith("answer_reason:")) return "Motif de la lecture";
  switch (reason) {
    case "dpgf_gap": return "Écart à la DPGF à vérifier";
    case "unit_conflict": return "Unités différentes selon les plans";
    case "hypothesis_to_include": return "Hypothèse saisie, à inclure";
    case "unreadable_pages": return "Pages illisibles";
    case "reading_ended": return "Un plan n’a pas répondu";
    case "sent": return "Plan déjà envoyé au devis";
    default: return "À vérifier";
  }
}

/** A reason that keeps the line out of the bulk acceptance: said in orange, the colour of what blocks. */
export function itemReasonBlocks(reason: string): boolean {
  return reason.startsWith("anomaly:") || reason === "dpgf_gap" || reason === "unit_conflict";
}

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
export const formatItemQuantity = (quantity: number, unit: string | null) =>
  `${quantityFormat.format(quantity)}${unit ? ` ${unit}` : ""}`;

const percentFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2, signDisplay: "exceptZero" });
export const formatItemPercent = (percent: number) => `${percentFormat.format(percent)} %`;

export const formatItemCount = (count: number, one: string, many: string) =>
  `${new Intl.NumberFormat("fr-FR").format(count)} ${count > 1 ? many : one}`;
