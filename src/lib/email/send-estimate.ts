import { COMPANY_INFO } from "@/lib/company-info";
import {
  failEstimateEmailDispatch, findActiveEstimateEmailDispatch,
  findEstimateEmailDispatchByRequest, prepareEstimateEmailDispatch, reserveEstimateEmailDispatch,
} from "@/lib/email/estimate-email-dispatch-repository";
import { deliverEstimateEmailDispatch } from "@/lib/email/estimate-email-delivery";
import type { EstimateEmailReceipt } from "@/lib/email/send-estimate-contract";
import { getRequiredEnvVar, loadVersionForEmail } from "@/lib/email/send-estimate-context-server";
import { loadPdfBuffer, preparePdfForDispatch, renderEstimateDispatchDocument } from "@/lib/email/send-estimate-document";
import { assertDispatchMatchesSubmission, canRearmUnfrozenEmailRequest, hashSubmission, isTerminalDelivery, resolvePortalOrigin } from "@/lib/email/send-estimate-plan";
import { ApiError, badRequest, conflict, forbidden, internalError } from "@/lib/estimates/errors";
import { loadVerifiedOfferDocument, type VerifiedOfferDocument } from "@/lib/estimates/offer-document";
import type { SendEstimateInput } from "@/lib/estimates/schemas";
import { freezeEstimateV2SnapshotForSend, getEstimateSendGating } from "@/lib/estimates/version-lifecycle-server";
import { normalizeConcurrencyToken } from "@/lib/estimates/version-concurrency";
import { engineFreezesSnapshot, requireEstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import { normalizeEstimateDraftLockSessionId } from "@/lib/estimates/lock-session";

type SendEstimateEmailInput = {
  versionId: string;
  payload: SendEstimateInput;
  requestUrl: string;
  idempotencyKey: string;
  concurrencyToken?: string | null;
  draftLockSessionId?: string | null;
};

export async function sendEstimateEmail(input: SendEstimateEmailInput): Promise<EstimateEmailReceipt> {
  const loaded = await loadVersionForEmail(input.versionId);
  const { context } = loaded;
  let version = loaded.version;
  // Lot 2, sous-lots 2.1 puis 2.7 : le moteur est lu strictement avant la configuration d'envoi,
  // toute relecture, tout gel, toute réservation et toute livraison ; une v3 s'émet sous le
  // contrat client 2 (gel de document v3, charge 6, marqueur 5).
  const engine = requireEstimateEngineVersion(version);
  const apiKey = getRequiredEnvVar("RESEND_API_KEY");
  const versionStatus = String(version.status);
  const completedReplay = await findEstimateEmailDispatchByRequest({
    tenantId: context.tenantId,
    requestId: input.idempotencyKey,
  });
  if (completedReplay && completedReplay.version_id !== input.versionId) {
    throw conflict(
      "Cette clé d'envoi appartient à une autre version. Préparez un nouvel envoi depuis le devis affiché.",
      undefined,
      "ESTIMATE_EMAIL_DISPATCH_CONFLICT"
    );
  }
  if (completedReplay && isTerminalDelivery(completedReplay.status)) {
    assertDispatchMatchesSubmission({
      dispatch: completedReplay,
      versionId: input.versionId,
      actorUserId: context.userId,
      payload: input.payload,
      requestUrl: input.requestUrl,
      configuredPortalBaseUrl: process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL?.trim(),
    });
    return { message_id: completedReplay.provider_id, version_id: input.versionId, request_id: input.idempotencyKey };
  }
  let dispatch = await findActiveEstimateEmailDispatch({
    versionId: input.versionId,
    tenantId: context.tenantId,
  });

  if (dispatch) {
    assertDispatchMatchesSubmission({
      dispatch,
      versionId: input.versionId,
      actorUserId: context.userId,
      payload: input.payload,
      requestUrl: input.requestUrl,
      configuredPortalBaseUrl: process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL?.trim(),
    });
  }

  let verifiedOffer: VerifiedOfferDocument | null = null;
  if (!dispatch) {
    const portalOrigin = resolvePortalOrigin(input.requestUrl, process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL?.trim());
    const fromAddress = getRequiredEnvVar("EMAIL_FROM");
    const requestPayloadHash = hashSubmission({
      versionId: input.versionId, from: fromAddress, to: input.payload.to,
      cc: input.payload.cc ?? [], subject: input.payload.subject,
      message: input.payload.message, portalOrigin,
    });
    const rearmingUnfrozenRequest = canRearmUnfrozenEmailRequest({
      completedReplay, requestPayloadHash, versionId: input.versionId,
      actorUserId: context.userId, payload: input.payload,
    });
    const needsDraftAuthority = versionStatus === "draft" && (!completedReplay || rearmingUnfrozenRequest);
    const draftLockSessionId = normalizeEstimateDraftLockSessionId(input.draftLockSessionId);
    let reservationUpdatedAt = version.updated_at;
    if (needsDraftAuthority) {
      const originalUpdatedAt = normalizeConcurrencyToken(input.concurrencyToken);
      if (!originalUpdatedAt || !Number.isFinite(Date.parse(originalUpdatedAt))) {
        throw badRequest("Relisez le devis avant de préparer un nouvel envoi.", undefined, "IF_MATCH_REQUIRED");
      }
      if (!draftLockSessionId) {
        throw conflict("Cette page doit détenir le verrou du devis avant l'envoi.", undefined, "LOCK_REQUIRED");
      }
      reservationUpdatedAt = originalUpdatedAt;
      if (engineFreezesSnapshot(engine)) {
        const frozen = await freezeEstimateV2SnapshotForSend(
          input.versionId,
          originalUpdatedAt,
          { draftLockSessionId }
        );
        version = { ...version, ...frozen };
        reservationUpdatedAt = frozen.updated_at;
      }
      const { gating } = await getEstimateSendGating(input.versionId);
      if (gating.blockingFlags.length > 0) {
        throw badRequest(
          "Envoi bloque: des anomalies bloquantes doivent être corrigees avant validation.",
          { gating },
          "ESTIMATE_GATING_BLOCKED"
        );
      }
    } else if (versionStatus === "sent") {
      verifiedOffer = await loadVerifiedOfferDocument({ supabase: context.supabase,
        tenantId: context.tenantId, versionId: input.versionId });
    } else if (versionStatus !== "sending" && versionStatus !== "draft") {
      throw forbidden(
        "Ce devis finalise ne peut plus être envoyé par email.",
        { status: versionStatus },
        "ESTIMATE_EMAIL_STATUS_FORBIDDEN"
      );
    }

    dispatch = await reserveEstimateEmailDispatch({
      versionId: input.versionId,
      tenantId: context.tenantId,
      expectedUpdatedAt: reservationUpdatedAt,
      actorUserId: context.userId,
      requestId: input.idempotencyKey,
      payloadHash: requestPayloadHash,
      recipient: input.payload.to,
      cc: input.payload.cc,
      subject: input.payload.subject,
      body: input.payload.message,
      fromAddress,
      portalOrigin,
      companySnapshot: COMPANY_INFO,
      draftLockSessionId,
    });
  }

  if (isTerminalDelivery(dispatch.status)) {
    return { message_id: dispatch.provider_id, version_id: input.versionId, request_id: input.idempotencyKey };
  }
  if (dispatch.status === "unknown") {
    throw conflict(
      "L'issue de cet envoi doit être rapprochee avec le fournisseur avant toute reprise.",
      { dispatch_id: dispatch.id },
      "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
    );
  }

  let preparedPdfBuffer: Buffer | null = null;
  if (dispatch.status === "preparing") {
    try {
      const preparedPdf = verifiedOffer ?? await preparePdfForDispatch({
        versionId: input.versionId,
        versionStatus,
        dispatchId: dispatch.id,
        supabase: context.supabase,
        tenantId: context.tenantId,
      });
      preparedPdfBuffer = preparedPdf.buffer;

      const { htmlBody, textBody, attachmentFilename, providerPayloadHash } =
        await renderEstimateDispatchDocument(dispatch, preparedPdf);

      dispatch = await prepareEstimateEmailDispatch({
        dispatchId: dispatch.id,
        tenantId: dispatch.tenant_id,
        actorUserId: context.userId,
        sealHash: preparedPdf.sealHash,
        providerPayloadHash,
        htmlBody,
        textBody,
        documentPath: preparedPdf.proof.filePath,
        documentSha256: preparedPdf.proof.sha256Hash,
        attachmentFilename,
        expectedDocumentContract: preparedPdf.proof,
        sealPayloadVersion: preparedPdf.sealPayloadVersion,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "ESTIMATE_PDF_GENERATION_SUPERSEDED" ||
          error.code === "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE")
      ) {
        // A malformed RPC receipt can follow a committed preparation. Preserve
        // that outcome for an idempotent read/retry instead of compensating it.
        throw error;
      }

      try {
        await failEstimateEmailDispatch({
          dispatchId: dispatch.id,
          tenantId: dispatch.tenant_id,
          actorUserId: context.userId,
          errorCode: "ESTIMATE_EMAIL_PREPARATION_FAILED",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch (rollbackError) {
        throw internalError(
          "La préparation de l'email a echoue et le brouillon n'a pas pu être libere automatiquement.",
          { preparation_error: error, rollback_error: rollbackError },
          "ESTIMATE_EMAIL_PREPARATION_ROLLBACK_FAILED"
        );
      }
      throw error;
    }
  }

  const result = await deliverEstimateEmailDispatch({
    dispatch,
    actorUserId: context.userId,
    apiKey,
    loadPdfBuffer: preparedPdfBuffer
      ? async () => preparedPdfBuffer!
      : async () => loadPdfBuffer(dispatch, context.supabase),
  });

  return {
    message_id: result.providerId,
    version_id: input.versionId,
    request_id: input.idempotencyKey,
  };
}
