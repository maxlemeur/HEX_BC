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
  sha256,
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
  getEstimatePdfStatus,
} from "@/lib/estimates/pdf-generator";
import { buildEstimatePdfFilename } from "@/lib/estimates/reference";
import type { SendEstimateInput } from "@/lib/estimates/schemas";
import {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
  freezeEstimateV2SnapshotForSend,
  getEstimateSendGating,
  loadEstimateSealSource,
  verifyEstimateSeal,
} from "@/lib/estimates/server";
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
};

const DEFAULT_FALLBACK_PROJECT_NAME = "Votre projet";

function resolveProject(value: EstimateVersionForEmail["estimate_projects"]) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function resolvePortalUrl(versionId: string, requestUrl: string) {
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
      "Impossible de recuperer le PDF du devis pour l'email.",
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
}) {
  const template = EstimateEmailTemplate({
    ...input,
    companyName: COMPANY_INFO.name,
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
}) {
  if (!["draft", "sending"].includes(input.versionStatus)) {
    const pdfStatus = await getEstimatePdfStatus(input.versionId);
    const expectedHash =
      pdfStatus.status === "ready" ? pdfStatus.sha256_hash?.toLowerCase() : null;
    if (
      pdfStatus.status !== "ready" ||
      !expectedHash ||
      !/^[a-f0-9]{64}$/.test(expectedHash)
    ) {
      throw internalError(
        "Le PDF contractuel fige du devis envoye est indisponible.",
        { status: pdfStatus.status },
        "ESTIMATE_EMAIL_FROZEN_PDF_UNAVAILABLE"
      );
    }

    const pdfBuffer = await loadPdfBuffer(
      { document_path: pdfStatus.file_path },
      input.supabase
    );
    if (sha256(pdfBuffer) !== expectedHash) {
      throw internalError(
        "Le PDF contractuel fige ne correspond plus a son empreinte.",
        undefined,
        "ESTIMATE_EMAIL_PDF_HASH_MISMATCH"
      );
    }
    return {
      buffer: pdfBuffer,
      filePath: pdfStatus.file_path,
      sha256Hash: expectedHash,
    };
  }

  const generatedPdf = await generateEstimatePdfNow(input.versionId, {
    force: true,
    triggeredBy: "send",
    dispatchId: input.dispatchId,
  });
  const pdfBuffer = await loadPdfBuffer(
    { document_path: generatedPdf.file_path },
    input.supabase
  );
  const generatedHash = sha256(pdfBuffer);
  if (!generatedPdf.sha256_hash || generatedHash !== generatedPdf.sha256_hash) {
    throw internalError(
      "Le PDF genere ne correspond pas a son empreinte.",
      undefined,
      "ESTIMATE_EMAIL_PDF_HASH_MISMATCH"
    );
  }
  return {
    buffer: pdfBuffer,
    filePath: generatedPdf.file_path,
    sha256Hash: generatedHash,
  };
}

function isTerminalDelivery(status: EstimateEmailDispatch["status"]) {
  return status === "sent" || status === "delivered" || status === "bounced";
}

function assertDispatchMatchesSubmission(input: {
  dispatch: EstimateEmailDispatch;
  versionId: string;
  actorUserId: string;
  payload: SendEstimateInput;
  portalUrl: string;
}) {
  const submittedPayloadHash = canonicalJsonHash({
    contract: "estimate-email-initial-v1",
    versionId: input.versionId,
    from: input.dispatch.from_address,
    to: input.payload.to,
    cc: input.payload.cc ?? [],
    subject: input.payload.subject,
    message: input.payload.message,
    portalUrl: input.portalUrl,
  });
  if (
    input.dispatch.payload_hash !== submittedPayloadHash ||
    input.dispatch.created_by !== input.actorUserId
  ) {
    throw conflict(
      "Un envoi est deja reserve avec une enveloppe differente. Reprenez les memes destinataires et le meme message.",
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
  const portalUrl = resolvePortalUrl(input.versionId, input.requestUrl);
  const completedReplay = await findEstimateEmailDispatchByRequest({
    versionId: input.versionId,
    tenantId: context.tenantId,
    requestId: input.idempotencyKey,
  });
  if (completedReplay && isTerminalDelivery(completedReplay.status)) {
    assertDispatchMatchesSubmission({
      dispatch: completedReplay,
      versionId: input.versionId,
      actorUserId: context.userId,
      payload: input.payload,
      portalUrl,
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
      portalUrl,
    });
  }

  let verifiedSealHash: string | null = null;
  if (!dispatch) {
    if (versionStatus === "draft") {
      if (version.calc_engine_version === 2) {
        const frozen = await freezeEstimateV2SnapshotForSend(
          input.versionId,
          version.updated_at
        );
        version = { ...version, ...frozen };
      }
      const { gating } = await getEstimateSendGating(input.versionId);
      if (gating.blockingFlags.length > 0) {
        throw badRequest(
          "Envoi bloque: des anomalies bloquantes doivent etre corrigees avant validation.",
          { gating },
          "ESTIMATE_GATING_BLOCKED"
        );
      }
    } else if (versionStatus === "sent") {
      const seal = await verifyEstimateSeal(input.versionId);
      if (!seal.valid) {
        throw badRequest(
          "Envoi bloque: le scellement du devis n'est plus valide.",
          { seal },
          "ESTIMATE_SEAL_INVALID"
        );
      }
      verifiedSealHash = seal.computed_hash;
    } else if (versionStatus !== "sending") {
      throw forbidden(
        "Ce devis finalise ne peut plus etre envoye par email.",
        { status: versionStatus },
        "ESTIMATE_EMAIL_STATUS_FORBIDDEN"
      );
    }

    const fromAddress = getRequiredEnvVar("EMAIL_FROM");
    const requestPayloadHash = canonicalJsonHash({
      contract: "estimate-email-initial-v1",
      versionId: input.versionId,
      from: fromAddress,
      to: input.payload.to,
      cc: input.payload.cc ?? [],
      subject: input.payload.subject,
      message: input.payload.message,
      portalUrl,
    });
    dispatch = await reserveEstimateEmailDispatch({
      versionId: input.versionId,
      tenantId: context.tenantId,
      expectedUpdatedAt: version.updated_at,
      actorUserId: context.userId,
      requestId: input.idempotencyKey,
      payloadHash: requestPayloadHash,
      recipient: input.payload.to,
      cc: input.payload.cc,
      subject: input.payload.subject,
      body: input.payload.message,
      fromAddress,
    });
  }

  if (isTerminalDelivery(dispatch.status)) {
    return { message_id: dispatch.provider_id };
  }
  if (dispatch.status === "unknown") {
    throw conflict(
      "L'issue de cet envoi doit etre rapprochee avec le fournisseur avant toute reprise.",
      { dispatch_id: dispatch.id },
      "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
    );
  }

  let preparedPdfBuffer: Buffer | null = null;
  if (dispatch.status === "preparing") {
    try {
      const preparedPdf = await preparePdfForDispatch({
        versionId: input.versionId,
        versionStatus,
        dispatchId: dispatch.id,
        supabase: context.supabase,
      });
      preparedPdfBuffer = preparedPdf.buffer;

      const sealSource = await loadEstimateSealSource({
        supabase: context.supabase,
        tenantId: context.tenantId,
        versionId: input.versionId,
      });
      const sealHash =
        verifiedSealHash ??
        computeEstimateSealHash(buildCanonicalEstimateSealPayload(sealSource));
      const project = resolveProject(version.estimate_projects);
      const projectName = project?.name?.trim() || DEFAULT_FALLBACK_PROJECT_NAME;
      const currency = normalizeEstimateCurrency(version.currency) ?? "EUR";
      const totalTtcFormatted = formatCurrency(
        version.total_ttc_cents ?? 0,
        currency
      );
      const portalUrl = resolvePortalUrl(input.versionId, input.requestUrl);
      const { htmlBody, textBody } = await renderFrozenEmail({
        projectName,
        versionNumber: version.version_number,
        totalTtcFormatted,
        portalUrl,
        message: dispatch.body ?? "",
      });
      const attachmentFilename = buildEstimatePdfFilename({
        baseReference: project?.estimate_reference,
        versionNumber: version.version_number,
        fallback: projectName,
      });
      const providerPayloadHash = canonicalJsonHash({
        contract: "resend-estimate-email-v1",
        from: dispatch.from_address,
        to: dispatch.recipient,
        cc: dispatch.cc ?? [],
        subject: dispatch.subject,
        htmlBody,
        textBody,
        attachmentFilename,
        documentSha256: preparedPdf.sha256Hash,
      });

      dispatch = await prepareEstimateEmailDispatch({
        dispatchId: dispatch.id,
        tenantId: dispatch.tenant_id,
        actorUserId: context.userId,
        sealHash,
        providerPayloadHash,
        htmlBody,
        textBody,
        documentPath: preparedPdf.filePath,
        documentSha256: preparedPdf.sha256Hash,
        attachmentFilename,
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
          "La preparation de l'email a echoue et le brouillon n'a pas pu etre libere automatiquement.",
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
