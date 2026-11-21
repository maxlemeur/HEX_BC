import type { EditorEstimateItem } from "@/lib/estimates/editor-items";
import { describeOfferChoice, readOfferProvisionalQuantity, readOfferReserve } from "@/lib/estimates/offer-choice";
import { composeProvisionalQuantityMention } from "@/lib/estimates/provisional-quantity";
import { ESTIMATE_V3_PRICING_STATUS_OPTIONS } from "@/lib/estimates/v3-editor";
import type { EstimateSendGatingResponse } from "@/lib/estimates/version-lifecycle-client";

/**
 * TI-682, lot C: the lines the offer's choices name, written from the editor's current lines: in the precisions
 * (reserved lines, provisional quantity sentences) and in the send window (status reasons, reserves).
 */

/** A line the send window names by its title and status (TI-682 lot C: lines excluded without a reason). */
export type EstimateSendGatingLine = { id: string; title: string; statusLabel: string };

/** A reserved line, by its title and its reserve's basis and reason (TI-682 lot C, PR 4: internal, for the issuer). */
export type EstimateSendGatingReserveLine = { id: string; title: string; description: string };

/** Titres des lignes « Non chiffrée » réservées, pour le paragraphe des précisions (insertion éditable). */
export function listReservedLineTitles(items: readonly EditorEstimateItem[]) {
  return items
    .filter((item) => readOfferReserve(item) !== null)
    .map((item) => item.title?.trim() || "Sans titre");
}

/** TI-682, lot C, PR 5 : les phrases des quantités provisionnelles, écrites d'après les lignes actuelles. */
export function listProvisionalQuantityMentions(items: readonly EditorEstimateItem[]) {
  return items.flatMap((item) => {
    const provisional = readOfferProvisionalQuantity(item);
    const mention = provisional ? composeProvisionalQuantityMention(item, provisional) : null;
    return mention ? [mention] : [];
  });
}

/**
 * TI-682, lot C : les lignes exclues après « Non chiffrée » sans motif interne, nommées dans la fenêtre d'envoi, où
 * leur motif se saisit sur place (enregistré par le lot, puis l'envoi est contrôlé de nouveau).
 */
export function describeStatusReasonLines(
  items: readonly EditorEstimateItem[],
  itemIds: readonly string[]
): EstimateSendGatingLine[] {
  return itemIds.map((itemId) => {
    const item = items.find((candidate) => candidate.id === itemId);
    return {
      id: itemId,
      title: item?.title?.trim() || "Sans titre",
      statusLabel: ESTIMATE_V3_PRICING_STATUS_OPTIONS.find((option) => option.value === item?.pricing_status)?.label ?? "",
    };
  });
}

/**
 * TI-682, lot C, PR 4 : les lignes réservées, nommées dans la fenêtre d'envoi avec leur base ; les précisions s'ouvrent
 * depuis la fenêtre pour y insérer le paragraphe des réserves.
 */
export function collectReserveItemIds(sendGating: EstimateSendGatingResponse | null) {
  return [...new Set((sendGating ? [...sendGating.blockingFlags, ...sendGating.warningFlags] : [])
    .filter((flag) => flag.key === "offer_reserve_declared" || flag.key === "offer_limits_required"
      || flag.key === "provisional_quantity_mention_missing" || flag.key === "takeoff_hypothesis_without_mention"
      || flag.key === "offer_choice_unreadable")
    .flatMap((flag) => flag.itemIds))];
}

/** PR 5 : une quantité provisionnelle se lit par la phrase que les précisions doivent porter. */
export function describeReserveLines(
  items: readonly EditorEstimateItem[],
  itemIds: readonly string[]
): EstimateSendGatingReserveLine[] {
  return itemIds.map((itemId) => {
    const item = items.find((candidate) => candidate.id === itemId);
    const reserve = item ? readOfferReserve(item) : null;
    const provisional = item ? readOfferProvisionalQuantity(item) : null;
    const mention = item && provisional ? composeProvisionalQuantityMention(item, provisional) : null;
    const description = reserve ? describeOfferChoice(reserve)
      : provisional ? (mention ?? "La ligne n'a pas de quantité : la phrase ne peut pas être écrite.") : "";
    return { id: itemId, title: item?.title?.trim() || "Sans titre", description };
  });
}
