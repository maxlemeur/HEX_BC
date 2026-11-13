import { z } from "zod";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  type ApiError,
  type SupabaseErrorLike,
  badRequest,
  conflict,
  forbidden,
  internalError,
  notFound,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import { getAccessiblePurchaseOrderOrNull } from "@/lib/purchase-orders";

import type {
  ConfirmPurchaseOrderData,
  PurchaseOrderConfirmed,
  PurchaseOrderReceived,
  ReceivePurchaseOrderData,
} from "./lifecycle-contracts";

/**
 * Confirming and receiving an order of an affaire (TI-691, delivery 3b-1). Both database functions are SECURITY
 * DEFINER and check the rights themselves (an admin or engineer of the active tenant who is the order's author or an
 * admin); the order is read here first, through its own policy, so that an order the caller cannot read answers 404.
 * Only the refusals named here reach the screen, each with a sentence; never another database message.
 */

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int();
const confirmedSchema = z.object({
  id: uuid, status: z.literal("confirmed"), edit_revision: z.number().int().min(0), order_date: date,
  // The column holds text: AAAA-MM-JJ, or « TBD » for a delivery still to be determined.
  expected_delivery_date: z.string().nullable(), total_ht_cents: cents, total_tax_cents: cents, total_ttc_cents: cents,
});
const receivedSchema = z.object({ id: uuid, status: z.literal("received"), edit_revision: z.number().int().min(0) });

const NOT_FOUND = "Bon de commande introuvable.";

type Action = "confirm" | "receive";

function lifecycleRefusal(error: SupabaseErrorLike, action: Action): ApiError {
  switch (error.message) {
    case "PURCHASE_ORDER_ACCESS_DENIED":
    case "PURCHASE_ORDER_AUTH_REQUIRED":
      return forbidden(action === "confirm"
        ? "Seuls l’auteur du bon et les administrateurs peuvent le confirmer."
        : "Seuls l’auteur du bon et les administrateurs peuvent enregistrer sa réception.");
    case "PURCHASE_ORDER_AFFAIRE_ONLY":
      return unprocessableEntity(action === "confirm"
        ? "Seul un bon de commande d’une affaire se confirme ainsi : changez le statut de ce bon."
        : "Seul un bon de commande d’une affaire se reçoit ainsi : changez le statut de ce bon.",
      undefined, error.message);
    case "PURCHASE_ORDER_CONFIRMATION_NOT_DRAFT":
      return conflict("Ce bon n’est plus un brouillon : rechargez la page.", undefined, error.message);
    case "PURCHASE_ORDER_REVISION_REQUIRED":
    case "PURCHASE_ORDER_REVISION_CONFLICT":
      return conflict(action === "confirm"
        ? "Ce bon a été modifié entre-temps : rechargez la page, puis confirmez de nouveau."
        : "Ce bon a été modifié entre-temps : rechargez la page, puis enregistrez de nouveau la réception.",
      undefined, "PURCHASE_ORDER_REVISION_CONFLICT");
    case "PURCHASE_ORDER_CONFIRMATION_DATE_INVALID":
      return unprocessableEntity("La commande ne peut pas être passée dans le futur, ni livrée avant d’être passée.",
        undefined, error.message);
    case "PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED":
      return unprocessableEntity(
        "Joignez la confirmation du fournisseur (bon, e-mail ou capture) pour confirmer la commande.", undefined, error.message);
    case "PURCHASE_ORDER_ITEMS_INVALID":
      return conflict("Une ligne n’appartient plus à ce bon : rechargez la page.", undefined, error.message);
    case "PURCHASE_ORDER_CONFIRMATION_EMPTY":
      return unprocessableEntity("Ce bon n’a aucun article à commander.", undefined, error.message);
    case "PURCHASE_ORDER_TOTAL_NEGATIVE":
      return unprocessableEntity("Les remises dépassent le montant des articles : vérifiez les prix.", undefined, error.message);
    case "PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE":
      return unprocessableEntity(
        "Le montant d’une ligne dépasse la capacité d’une commande : vérifiez sa quantité et son prix.", undefined, error.message);
    case "PURCHASE_ORDER_RECEPTION_NOT_CONFIRMED":
      return conflict("Seul un bon confirmé peut être reçu : rechargez la page.", undefined, error.message);
    case "PURCHASE_ORDER_RECEPTION_DATE_INVALID":
      return unprocessableEntity("La réception se date entre le jour de la commande et aujourd’hui.", undefined, error.message);
    case "PURCHASE_ORDER_INPUT_INVALID":
      return badRequest(action === "confirm"
        ? "Les prix ou les dates de la confirmation sont invalides."
        : "La date ou la note de la réception est invalide.");
    default:
      if (error.code === "40001" || error.code === "40P01") {
        return conflict("Une autre modification de ce bon était en cours : réessayez.", undefined,
          "PURCHASE_ORDER_REVISION_CONFLICT");
      }
      return internalError(action === "confirm"
        ? "La commande n’a pas pu être confirmée. Réessayez."
        : "La réception n’a pas pu être enregistrée. Réessayez.");
  }
}

async function requireReadableOrder(orderId: string) {
  const context = await getAuthenticatedTenantContext();
  const order = await getAccessiblePurchaseOrderOrNull<{ id: string }>(context.supabase, orderId, "id");
  if (!order) throw notFound(NOT_FOUND);
  return context;
}

/** Records that a draft of an affaire was ordered, with its real prices and its proof: the draft becomes confirmed. */
export async function confirmPurchaseOrder(orderId: string, input: ConfirmPurchaseOrderData): Promise<PurchaseOrderConfirmed> {
  const context = await requireReadableOrder(orderId);
  const { data, error } = await context.supabase.rpc("confirm_material_request_purchase_order", {
    p_order_id: orderId,
    p_expected_revision: input.expected_revision,
    p_confirmation: {
      ordered_on: input.ordered_on,
      // Left out, the draft keeps its delivery date; null clears it.
      ...(input.expected_delivery_date !== undefined ? { expected_delivery_date: input.expected_delivery_date } : {}),
      supplier_reference: input.supplier_reference,
      document_id: input.document_id,
      lines: input.lines,
    },
  });
  if (error) throw lifecycleRefusal(error, "confirm");
  const parsed = confirmedSchema.safeParse(data);
  if (!parsed.success) throw internalError("Réponse de confirmation invalide : rechargez le bon avant de réessayer.");
  return parsed.data;
}

/** Records the reception of a whole confirmed order of an affaire: it becomes received. */
export async function receivePurchaseOrder(orderId: string, input: ReceivePurchaseOrderData): Promise<PurchaseOrderReceived> {
  const context = await requireReadableOrder(orderId);
  const { data, error } = await context.supabase.rpc("receive_material_request_purchase_order", {
    p_order_id: orderId,
    p_expected_revision: input.expected_revision,
    p_reception: { received_on: input.received_on, note: input.note },
  });
  if (error) throw lifecycleRefusal(error, "receive");
  const parsed = receivedSchema.safeParse(data);
  if (!parsed.success) throw internalError("Réponse de réception invalide : rechargez le bon avant de réessayer.");
  return parsed.data;
}
