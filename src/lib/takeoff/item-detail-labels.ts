import type { ItemDetailPlanUnavailable } from "@/lib/takeoff/item-detail-contracts";
import type { ItemDetailGesture, ItemDetailLineDecision, ItemDetailState } from "@/lib/takeoff/item-detail";
import type { TakeoffUnitState } from "@/lib/takeoff/launch-request-coverage";
import { QUANTITY_ENTRY_CATEGORIES } from "@/lib/takeoff/quantity-entry";
import type { PdfPageFailure } from "@/lib/takeoff/pdf-page-geometry";

/**
 * The words of the detail of an item, in French: every code it shows has its label here, never on screen as is. The
 * states, decisions, reasons and anomalies are lot 4's words for its table (item-table-labels.ts on its branch), the same
 * text; once that table is on main the detail reads them from there.
 */

export const ITEM_DETAIL_STATE_LABELS: Record<ItemDetailState, string> = {
  to_measure: "À mesurer",
  reading: "En lecture",
  incomplete: "Lecture incomplète",
  failed: "Échec de lecture",
  measured: "Mesuré",
  uncertain: "Incertain",
  not_found: "Non trouvé",
};

export const ITEM_DETAIL_DECISION_LABELS: Record<ItemDetailLineDecision, string> = {
  pending: "À vérifier",
  accepted: "Accepté",
  set_aside: "Écarté",
  entered: "Saisi",
  none: "Rien à décider",
};

export const ITEM_DETAIL_OUTCOME_LABELS = { measured: "Mesuré", uncertain: "Incertain", not_found: "Non trouvé" } as const;

export const ITEM_DETAIL_UNIT_STATE_LABELS: Record<TakeoffUnitState, string> = {
  queued: "En attente de lecture",
  running: "En lecture",
  succeeded: "Lu",
  failed: "Lecture en échec",
  canceled: "Lecture arrêtée",
  not_started: "Non lu",
};

const SET_ASIDE_REASONS: Record<string, string> = {
  out_of_scope: "Hors périmètre",
  duplicate: "Doublon",
  reading_error: "Erreur de lecture",
  other: "Autre",
};

const ANOMALIES: Record<string, string> = {
  hypothesis: "Hypothèse",
  source_choice: "Source à choisir",
  low_confidence: "Confiance faible",
  missing_evidence: "Preuve localisée manquante",
  rule_failed: "Contrôle en échec",
  rules_stale: "Contrôles à recalculer",
  alert: "Alerte à trancher",
  page_decision: "Page déjà au devis : décision à prendre",
  unit_mismatch: "Unité différente de l’unité attendue",
};

const INELIGIBILITIES: Record<string, string> = {
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
};

export const itemDetailSetAsideLabel = (reason: string) => SET_ASIDE_REASONS[reason] ?? "Autre motif";
export const itemDetailAnomalyLabel = (anomaly: string) => ANOMALIES[anomaly] ?? "À vérifier";
export const itemDetailIneligibilityLabel = (reason: string | null) => (reason ? INELIGIBILITIES[reason] : null) ?? "ne s’applique pas";
export const itemDetailCategoryLabel = (category: string) =>
  (QUANTITY_ENTRY_CATEGORIES as Record<string, string>)[category] ?? "Saisie";

/** A reason code of a line, in French; a code the detail does not know is said generically. */
export function itemDetailReasonLabel(reason: string): string {
  if (reason.startsWith("anomaly:")) return itemDetailAnomalyLabel(reason.slice("anomaly:".length));
  if (reason.startsWith("answer_reason:")) return "Motif de la lecture";
  switch (reason) {
    case "dpgf_gap": return "Écart à la DPGF à vérifier";
    case "unit_conflict": return "Unités différentes selon les plans";
    case "hypothesis_to_include": return "Hypothèse saisie, à inclure";
    case "unreadable_pages": return "Pages illisibles";
    case "reading_ended": return "Un plan n’a pas répondu";
    default: return "À vérifier";
  }
}

/** The gestures the keyboard of the list may ask for, by their key; none forces, sends or spends. */
export const ITEM_DETAIL_GESTURE_LABELS: Record<Exclude<ItemDetailGesture, "reinstate" | "remeasure">, string> = {
  accept_measured: "Accepter",
  set_aside: "Écarter",
  include_entry: "Inclure l’hypothèse",
  enter_quantity: "Saisir une quantité",
};

export const ITEM_DETAIL_PLAN_UNAVAILABLE_LABELS: Record<ItemDetailPlanUnavailable, string> = {
  original_unavailable: "Plan d’origine indisponible : la copie lue par cette analyse n’est plus servie.",
  no_current_copy: "Le dossier n’a pas de copie actuelle de ce plan.",
  several_copies: "Plusieurs copies de ce plan sont actuelles : choisissez-la dans les plans de l’affaire.",
  generation_replaced: "Cette version du plan a été remplacée dans le dossier.",
  not_available_to_you: "Ce plan n’est pas accessible avec vos droits.",
};

export const ITEM_DETAIL_PAGE_FAILURE_LABELS: Record<PdfPageFailure, string> = {
  unavailable: "Le plan n’a pas d’adresse à afficher pour le moment.",
  load_failed: "Le plan n’a pas pu être ouvert.",
  page_missing: "Cette page n’existe pas sur ce plan.",
  render_failed: "La page n’a pas pu être affichée.",
};

/** A refusal of the plan's resolution, by its code: never the server's text. */
export function itemDetailPlanErrorLabel(code: string | null, status: number | null): string {
  switch (code) {
    case "TAKEOFF_ITEM_DETAIL_READING_NOT_FOUND": return "Cette lecture est introuvable sur cette affaire.";
    case "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND": return "Ce plan est introuvable pour ce poste.";
    case "TAKEOFF_ITEM_DETAIL_ADDRESS_INVALID": return "Ce lien ne désigne pas un plan de cette affaire.";
    default:
      if (status === 401) return "Votre session a expiré : reconnectez-vous.";
      if (status === 403) return "Vous n’avez pas accès à ce plan.";
      if (status === 404) return "Ce plan est introuvable pour ce poste.";
      return "Le plan n’a pas pu être chargé. Réessayez.";
  }
}

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
export const formatItemDetailQuantity = (quantity: number, unit: string | null) =>
  `${quantityFormat.format(quantity)}${unit ? ` ${unit}` : ""}`;
const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
export const formatItemDetailDate = (value: string) => dateFormat.format(new Date(value));
export const formatItemDetailPages = (pages: readonly number[]) => (pages.length ? pages.join(", ") : "—");
