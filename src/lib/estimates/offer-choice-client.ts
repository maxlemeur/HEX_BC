import { z } from "zod";
import { requestJson } from "@/lib/estimates/client-requests";
import { estimateOfferChoiceReceiptSchema, type EstimateOfferChoiceInput, type EstimateOfferChoiceReceipt } from "@/lib/estimates/offer-choice";

/**
 * TI-682, lot C, PR 4: an administrator declares (or withdraws, null) the written reserve of a « Non chiffrée » line.
 * Queued with the editor's writes (version token, draft lock); the answer carries the line's choice and the new token.
 */
export async function setEstimateLineOfferChoice(
  versionId: string,
  itemId: string,
  choice: EstimateOfferChoiceInput | null,
  versionToken: string,
): Promise<EstimateOfferChoiceReceipt> {
  return requestJson(
    `/api/estimates/${versionId}/items/${itemId}/offer-choice`,
    {
      method: choice ? "PUT" : "DELETE",
      headers: { "Content-Type": "application/json", "If-Match": versionToken },
      ...(choice ? { body: JSON.stringify(choice) } : {}),
    },
    "Impossible d'enregistrer la réserve ou la quantité provisionnelle.",
    (value) => {
      const receipt = estimateOfferChoiceReceiptSchema.parse(value);
      if (receipt.item.id.toLowerCase() !== itemId.toLowerCase() || receipt.version.id.toLowerCase() !== versionId.toLowerCase()) {
        throw new Error("La confirmation appartient à une autre ligne.");
      }
      return receipt;
    },
    { mutation: { versionId, structural: false } }
  );
}

/** TI-682, lot C, PR 5: what « Établie sur » of a provisional quantity starts from (the takeoff line's note). */
export async function readEstimateLineOfferChoiceSuggestion(versionId: string, itemId: string): Promise<string | null> {
  const suggestion = await requestJson(
    `/api/estimates/${versionId}/items/${itemId}/offer-choice`,
    { method: "GET" },
    "Impossible de lire la note du métré.",
    (value) => z.object({ established_on: z.string().nullable() }).parse(value),
  );
  return suggestion.established_on;
}
