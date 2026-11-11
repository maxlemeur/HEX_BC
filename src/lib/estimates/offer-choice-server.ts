import "server-only";

import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { ApiError, badRequest, conflict, forbidden, internalError, notFound } from "@/lib/estimates/errors";
import { normalizeEstimateDraftLockSessionId } from "@/lib/estimates/lock-session";
import {
  estimateOfferChoiceReceiptSchema,
  type EstimateOfferChoiceInput,
  type EstimateOfferChoiceReceipt,
} from "@/lib/estimates/offer-choice";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  isTenantAdmin,
} from "@/lib/estimates/server-context";
import { assertVersionConcurrencyToken, normalizeConcurrencyToken } from "@/lib/estimates/version-concurrency";
import { getServiceRoleSupabaseClient } from "@/lib/estimates/version-workflow-client-server";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";

// TI-682, lot C, PR 4 (D10, D28): the declaration of a written reserve. The route checks what TypeScript can (tenant
// administrator, draft, engine 3, version token, draft lock of this page), then public.set_estimate_line_offer_choice
// checks it again with the line itself and writes it under the v3 writer contract. Never the batch, never the Data API.

export const OFFER_CHOICE_ADMIN_MESSAGE = "La réserve écrite dans l'offre est déclarée par un administrateur.";


/** The database's refusals, by their stable message, to the status and code the client reads. */
function mapOfferChoiceRpcError(error: { message?: string | null }): ApiError {
  const message = error.message ?? "";
  if (message.includes("ESTIMATE_OFFER_CHOICE_FORBIDDEN")) return forbidden(OFFER_CHOICE_ADMIN_MESSAGE, undefined, "ESTIMATE_OFFER_CHOICE_FORBIDDEN");
  if (message.includes("ESTIMATE_VERSION_READ_ONLY")) return forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
  if (message.includes("ESTIMATE_OFFER_CHOICE_ENGINE_NOT_SUPPORTED")) {
    return badRequest("La réserve écrite dans l'offre n'existe que pour un devis du moteur 3.", undefined, "ESTIMATE_OFFER_CHOICE_ENGINE_NOT_SUPPORTED");
  }
  if (message.includes("ESTIMATE_OFFER_CHOICE_STALE")) {
    return conflict("Le devis a changé. Rechargez-le avant de déclarer la réserve.", undefined, "VERSION_CONFLICT");
  }
  if (message.includes("ESTIMATE_OFFER_CHOICE_LOCK_REQUIRED")) {
    return conflict("Cette page doit détenir le verrou du devis pour déclarer une réserve.", undefined, "LOCK_REQUIRED");
  }
  if (message.includes("ESTIMATE_OFFER_CHOICE_LINE_REQUIRED")) {
    return notFound("Ligne introuvable dans cette version.", undefined, "ESTIMATE_OFFER_CHOICE_LINE_REQUIRED");
  }
  if (message.includes("ESTIMATE_OFFER_CHOICE_STATUS_MISMATCH")) {
    return conflict("Une réserve ne se déclare que sur une ligne « Non chiffrée ».", undefined, "ESTIMATE_OFFER_CHOICE_STATUS_MISMATCH");
  }
  if (message.includes("ESTIMATE_OFFER_CHOICE_INVALID")) {
    return badRequest("La réserve est incomplète ou invalide.", undefined, "ESTIMATE_OFFER_CHOICE_INVALID");
  }
  return internalError("Impossible d'enregistrer la réserve.");
}

export async function setEstimateLineOfferChoice(input: {
  versionId: string;
  itemId: string;
  choice: EstimateOfferChoiceInput | null;
  concurrencyToken: string | undefined;
  draftLockSessionId: string | null | undefined;
}): Promise<EstimateOfferChoiceReceipt> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  assertCanWriteEstimateWorkflows(context.tenantRole);
  if (!isTenantAdmin(context.tenantRole)) {
    throw forbidden(OFFER_CHOICE_ADMIN_MESSAGE, undefined, "ESTIMATE_OFFER_CHOICE_FORBIDDEN");
  }
  const { version } = await getVersionAccessOrThrow(supabase, input.versionId, context);
  assertVersionConcurrencyToken(version.updated_at, input.concurrencyToken);
  const expectedUpdatedAt = normalizeConcurrencyToken(input.concurrencyToken);
  if (!expectedUpdatedAt) throw badRequest("Jeton de concurrence manquant.");
  assertDraftStatus(version.status);
  if (resolveEstimateEngineVersion(version) !== 3) {
    throw badRequest("La réserve écrite dans l'offre n'existe que pour un devis du moteur 3.", undefined,
      "ESTIMATE_OFFER_CHOICE_ENGINE_NOT_SUPPORTED");
  }
  const draftLockSessionId = normalizeEstimateDraftLockSessionId(input.draftLockSessionId);
  if (!draftLockSessionId) {
    throw conflict("Cette page doit détenir le verrou du devis pour déclarer une réserve.", undefined, "LOCK_REQUIRED");
  }
  await assertDraftLockOwnedByCurrentUser({ supabase, tenantId, versionId: input.versionId, userId, draftLockSessionId });

  const { data, error } = await getServiceRoleSupabaseClient().rpc("set_estimate_line_offer_choice", {
    p_tenant_id: tenantId,
    p_version_id: input.versionId,
    p_item_id: input.itemId,
    p_actor_user_id: userId,
    // The RPC's jsonb argument: null withdraws the reserve.
    p_choice: (input.choice ?? null) as never,
    p_expected_updated_at: version.updated_at,
    p_draft_lock_session_id: draftLockSessionId,
  });
  if (error) throw mapOfferChoiceRpcError(error);
  const parsed = estimateOfferChoiceReceiptSchema.safeParse(data);
  if (!parsed.success || parsed.data.item.id.toLowerCase() !== input.itemId.toLowerCase()
    || parsed.data.version.id.toLowerCase() !== input.versionId.toLowerCase()) {
    throw internalError("La confirmation de la réserve est invalide. Relisez le devis.", undefined, "BATCH_OUTCOME_UNKNOWN");
  }
  return parsed.data;
}
