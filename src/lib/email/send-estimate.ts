import { render } from "@react-email/components";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { COMPANY_INFO } from "@/lib/company-info";
import {
  canonicalJsonHash,
  deliverEstimateEmailDispatch,
  failEstimateEmailDispatch,
  findActiveEstimateEmailDispatch,
  findEstimateEmailDispatchByRequest,
  prepareEstimateEmailDispatch,
  reserveEstimateEmailDispatch,
  type EstimateEmailDispatch,
} from "@/lib/email/estimate-email-outbox";
import { EstimateEmailTemplate } from "@/lib/email/templates/estimate";
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  internalError,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import {
  generateEstimatePdfNow,
} from "@/lib/estimates/pdf-generator";
import { loadVerifiedOfferDocument, type VerifiedOfferDocument } from "@/lib/estimates/offer-document";
import { sanitizeEstimateFilename } from "@/lib/estimates/reference";
import type { SendEstimateInput } from "@/lib/estimates/schemas";
import {
  freezeEstimateV2SnapshotForSend,
  getEstimateSendGating,
  normalizeConcurrencyToken,
} from "@/lib/estimates/server";
import { normalizeEstimateDraftLockSessionId } from "@/lib/estimates/lock-session";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { ESTIMATE_DOCUMENTS_BUCKET } from "@/lib/storage/buckets";
import type { Database } from "@/types/database";

type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateVersionForEmail = Pick<
  EstimateVersionRow,
  | "id"
  | "tenant_id"
  | "version_number"
  | "total_ttc_cents"
  | "currency"
  | "status"
  | "updated_at"
  | "content_revision"
  | "calc_engine_version"
> & {
  estimate_projects:
    | Pick<EstimateProjectRow, "name" | "estimate_reference">
    | Pick<EstimateProjectRow, "name" | "estimate_reference">[]
    | null;
};

type SendEstimateEmailInput = {
  versionId: string;
  payload: SendEstimateInput;
  requestUrl: string;
  idempotencyKey: string;
  concurrencyToken?: string | null;
  draftLockSessionId?: string | null;
};

function resolveLegacyPortalUrl(versionId: string, requestUrl: string) {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL?.trim();
  if (configuredBaseUrl) {
    try {
      const normalizedBaseUrl = configuredBaseUrl.endsWith("/")
        ? configuredBaseUrl
        : `${configuredBaseUrl}/`;
      return new URL(`estimates/${versionId}`, normalizedBaseUrl).toString();
    } catch {
      // Fallback handled below.
    }
  }

  return new URL(`/dashboard/estimates/${versionId}/print`, requestUrl).toString();
}

function resolvePortalOrigin(requestUrl: string) {
  try {
    const base = new URL(process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL?.trim() || requestUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error();
    return base.origin;
  } catch {
    throw internalError("Configuration du portail client invalide.", undefined, "OFFER_PORTAL_ORIGIN_INVALID");
  }
}

function hashSubmission(input: {
  versionId: string; from: string; to: string; cc: string[]; subject: string; message: string; portalOrigin: string;
}) {
  return canonicalJsonHash({ contract: "estimate-email-initial-v2", ...input });
}

function getRequiredEnvVar(name: "RESEND_API_KEY" | "EMAIL_FROM") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw internalError(`Configuration email manquante: ${name}.`);
  }
  return value;
}

async function loadVersionForEmail(versionId: string) {
  const context = await getAuthenticatedTenantContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);

  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, version_number, total_ttc_cents, currency, status, updated_at, content_revision, calc_engine_version, estimate_projects(name, estimate_reference)"
    )
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la version de devis.");
  }
  if (!data) {
    throw notFound("Version de devis introuvable.");
  }

  return {
    context,
    version: data as EstimateVersionForEmail,
  };
}

async function loadPdfBuffer(
  dispatch: Pick<EstimateEmailDispatch, "document_path">,
  supabase: Awaited<ReturnType<typeof getAuthenticatedTenantContext>>["supabase"]
) {
  if (!dispatch.document_path) {
    throw internalError("Chemin du PDF fige manquant.");
  }

  const { data, error } = await supabase.storage
    .from(ESTIMATE_DOCUMENTS_BUCKET)
    .download(dispatch.document_path);

  if (error || !data) {
    throw internalError(
      "Impossible de récupérer le PDF du devis pour l'email.",
      error
    );
  }

  return Buffer.from(await data.arrayBuffer());
}

async function renderFrozenEmail(input: {
  projectName: string;
  versionNumber: number;
  totalTtcFormatted: string;
  portalUrl: string;
  message: string;
  companyName: string;
  historicalCopy?: boolean;
}) {
  const template = EstimateEmailTemplate({
    ...input,
  });
  const [htmlBody, textBody] = await Promise.all([
    render(template),
    render(template, { plainText: true }),
  ]);
  return { htmlBody, textBody };
}

async function preparePdfForDispatch(input: {
  versionId: string;
  versionStatus: string;
  dispatchId: string;
  supabase: Awaited<ReturnType<typeof getAuthenticatedTenantContext>>["supabase"];
  tenantId: string;
}) {
  const preparingNew = ["draft", "sending"].includes(input.versionStatus);
  if (preparingNew) {
    await generateEstimatePdfNow(input.versionId, {
      force: true,
      triggeredBy: "send",
      dispatchId: input.dispatchId,
    });
  }
  return loadVerifiedOfferDocument({ supabase: input.supabase, tenantId: input.tenantId,
    versionId: input.versionId, requireSealed: !preparingNew });
}

function isTerminalDelivery(status: EstimateEmailDispatch["status"]) {
  return status === "sent" || status === "delivered" || status === "bounced";
}

function assertDispatchMatchesSubmission(input: {
  dispatch: EstimateEmailDispatch;
  versionId: string;
  actorUserId: string;
  payload: SendEstimateInput;
  requestUrl: string;
}) {
  const submittedPayloadHash = input.dispatch.request_contract_version === 2
    ? hashSubmission({ versionId: input.versionId, from: input.dispatch.from_address, to: input.payload.to,
      cc: input.payload.cc ?? [], subject: input.payload.subject, message: input.payload.message,
      portalOrigin: input.dispatch.portal_url ? new URL(input.dispatch.portal_url).origin : "" })
    : canonicalJsonHash({
    contract: "estimate-email-initial-v1",
    versionId: input.versionId,
    from: input.dispatch.from_address,
    to: input.payload.to,
    cc: input.payload.cc ?? [],
    subject: input.payload.subject,
    message: input.payload.message,
    portalUrl: resolveLegacyPortalUrl(input.versionId, input.requestUrl),
  });
  if (
    input.dispatch.payload_hash !== submittedPayloadHash ||
    input.dispatch.created_by !== input.actorUserId ||
    input.dispatch.recipient !== input.payload.to ||
    JSON.stringify(input.dispatch.cc ?? []) !== JSON.stringify(input.payload.cc ?? []) ||
    input.dispatch.subject !== input.payload.subject || input.dispatch.body !== input.payload.message
  ) {
    throw conflict(
      "Un envoi est déjà réservé avec une enveloppe différente. Reprenez les mêmes destinataires et le même message.",
      { dispatch_id: input.dispatch.id },
      "ESTIMATE_EMAIL_DISPATCH_CONFLICT"
    );
  }
}

export async function sendEstimateEmail(input: SendEstimateEmailInput) {
  const apiKey = getRequiredEnvVar("RESEND_API_KEY");
  const loaded = await loadVersionForEmail(input.versionId);
  const { context } = loaded;
  let version = loaded.version;
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
    });
    return { message_id: completedReplay.provider_id };
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
    });
  }

  let verifiedOffer: VerifiedOfferDocument | null = null;
  if (!dispatch) {
    const portalOrigin = resolvePortalOrigin(input.requestUrl);
    const fromAddress = getRequiredEnvVar("EMAIL_FROM");
    const requestPayloadHash = hashSubmission({
      versionId: input.versionId, from: fromAddress, to: input.payload.to,
      cc: input.payload.cc ?? [], subject: input.payload.subject,
      message: input.payload.message, portalOrigin,
    });
    const hasFrozenPayload = completedReplay !== null && completedReplay !== undefined &&
      /^[0-9a-f]{64}$/.test(completedReplay.provider_payload_hash ?? "") &&
      (completedReplay.html_body?.length ?? 0) > 0 && (completedReplay.text_body?.length ?? 0) > 0 &&
      completedReplay.document_path !== null && /^[0-9a-f]{64}$/.test(completedReplay.document_sha256 ?? "") &&
      completedReplay.attachment_filename !== null;
    const rearmingUnfrozenRequest = completedReplay?.status === "failed" &&
      completedReplay.request_contract_version === 2 && !hasFrozenPayload &&
      completedReplay.version_id === input.versionId && completedReplay.created_by === context.userId &&
      completedReplay.payload_hash === requestPayloadHash && completedReplay.recipient === input.payload.to.trim() &&
      JSON.stringify(completedReplay.cc ?? null) === JSON.stringify(input.payload.cc ?? null) &&
      completedReplay.subject === input.payload.subject.trim() && completedReplay.body === input.payload.message;
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
      if (version.calc_engine_version === 2) {
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
    return { message_id: dispatch.provider_id };
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

      const captured = preparedPdf.proof.clientContractSnapshot;
      const projectName = captured?.project.name ?? "Devis émis";
      const currency = normalizeEstimateCurrency(captured?.version.currency ?? preparedPdf.version.currency) ?? "EUR";
      const totalTtcFormatted = formatCurrency(
        captured?.totals.payableTtcCents ?? preparedPdf.version.total_ttc_cents,
        currency
      );
      const portalUrl = dispatch.portal_url;
      if (dispatch.request_contract_version !== 2 || !portalUrl) {
        throw conflict("Cette ancienne préparation nécessite une reprise contrôlée.", undefined, "ESTIMATE_EMAIL_LEGACY_PREPARATION_REQUIRES_RECOVERY");
      }
      const { htmlBody, textBody } = await renderFrozenEmail({
        projectName,
        versionNumber: captured?.version.number ?? preparedPdf.version.version_number,
        totalTtcFormatted,
        portalUrl,
        message: dispatch.body ?? "",
        companyName: captured?.company.name ?? "Votre interlocuteur",
        historicalCopy: captured === null,
      });
      // Client1 stores the complete reference, including Vn exactly once.
      const attachmentFilename = `${sanitizeEstimateFilename(captured?.project.estimateReference ?? projectName) || "devis"}.pdf`;
      const providerPayloadHash = canonicalJsonHash({
        contract: "resend-estimate-email-v1",
        from: dispatch.from_address,
        to: dispatch.recipient,
        cc: dispatch.cc ?? [],
        subject: dispatch.subject,
        htmlBody,
        textBody,
        attachmentFilename,
        documentSha256: preparedPdf.proof.sha256Hash,
      });

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
        error.code === "ESTIMATE_PDF_GENERATION_SUPERSEDED"
      ) {
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
  };
}
