import type { ItemDetailPlanUnavailable } from "@/lib/takeoff/item-detail-contracts";
import type { ItemDetailGesture } from "@/lib/takeoff/item-detail";
import { ITEM_INELIGIBILITY_LABELS } from "@/lib/takeoff/item-table-labels";
import type { ItemIneligibility } from "@/lib/takeoff/item-table";
import type { PdfPageFailure } from "@/lib/takeoff/pdf-page-geometry";
import { QUANTITY_ENTRY_CATEGORIES } from "@/lib/takeoff/quantity-entry";

/**
 * The words of the detail of an item, in French, that the table of items has no word for: the outcome of one plan's
 * answer, the gestures its keyboard asks for, why a plan or a page is not drawn, a refused resolution. Every other code
 * (states, decisions, reasons, anomalies, set-aside reasons, units of work) is worded by the table's own labels
 * (item-table-labels.ts), never repeated here.
 */

export const ITEM_DETAIL_OUTCOME_LABELS = { measured: "Mesuré", uncertain: "Incertain", not_found: "Non trouvé" } as const;

export const itemDetailIneligibilityLabel = (reason: ItemIneligibility | null) =>
  (reason ? ITEM_INELIGIBILITY_LABELS[reason] : null) ?? "ne s’applique pas";
export const itemDetailCategoryLabel = (category: string) =>
  (QUANTITY_ENTRY_CATEGORIES as Record<string, string>)[category] ?? "Saisie";

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
  copy_missing: "Le fichier de ce plan est introuvable dans le stockage.",
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
    case "TAKEOFF_ITEM_DETAIL_PLAN_RETRY": return "Le plan n’a pas pu être obtenu pour le moment : réessayez.";
    default:
      if (status === 401) return "Votre session a expiré : reconnectez-vous.";
      if (status === 403) return "Vous n’avez pas accès à ce plan.";
      if (status === 404) return "Ce plan est introuvable pour ce poste.";
      return "Le plan n’a pas pu être chargé. Réessayez.";
  }
}

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
export const formatItemDetailDate = (value: string) => dateFormat.format(new Date(value));
export const formatItemDetailPages = (pages: readonly number[]) => (pages.length ? pages.join(", ") : "—");
