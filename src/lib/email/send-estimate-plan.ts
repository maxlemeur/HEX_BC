import { conflict, internalError } from "@/lib/estimates/errors";
import type { SendEstimateInput } from "@/lib/estimates/schemas";
import type { EstimateEmailDispatch } from "@/lib/email/estimate-email-dispatch-contracts";
import { canonicalJsonHash } from "@/lib/email/estimate-email-hash";

function resolveLegacyPortalUrl(versionId: string, requestUrl: string, configuredBaseUrl?: string) {
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

export function resolvePortalOrigin(requestUrl: string, configuredBaseUrl?: string) {
  try {
    const base = new URL(configuredBaseUrl?.trim() || requestUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error();
    return base.origin;
  } catch {
    throw internalError("Configuration du portail client invalide.", undefined, "OFFER_PORTAL_ORIGIN_INVALID");
  }
}

export function hashSubmission(input: {
  versionId: string; from: string; to: string; cc: string[]; subject: string; message: string; portalOrigin: string;
}) {
  return canonicalJsonHash({ contract: "estimate-email-initial-v2", ...input });
}

export function isTerminalDelivery(status: EstimateEmailDispatch["status"]) {
  return status === "sent" || status === "delivered" || status === "bounced";
}

export function assertDispatchMatchesSubmission(input: {
  dispatch: EstimateEmailDispatch;
  versionId: string;
  actorUserId: string;
  payload: SendEstimateInput;
  requestUrl: string;
  configuredPortalBaseUrl?: string;
}) {
  if (input.dispatch.from_address === null) {
    throw conflict("Enveloppe email historique indisponible.", undefined, "ESTIMATE_EMAIL_DISPATCH_CONFLICT");
  }
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
    portalUrl: resolveLegacyPortalUrl(input.versionId, input.requestUrl, input.configuredPortalBaseUrl),
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

export function canRearmUnfrozenEmailRequest(input: {
  completedReplay: EstimateEmailDispatch | null;
  requestPayloadHash: string;
  versionId: string;
  actorUserId: string;
  payload: SendEstimateInput;
}) {
  const hasFrozenPayload = input.completedReplay !== null && input.completedReplay !== undefined &&
    /^[0-9a-f]{64}$/.test(input.completedReplay.provider_payload_hash ?? "") &&
    (input.completedReplay.html_body?.length ?? 0) > 0 && (input.completedReplay.text_body?.length ?? 0) > 0 &&
    input.completedReplay.document_path !== null && /^[0-9a-f]{64}$/.test(input.completedReplay.document_sha256 ?? "") &&
    input.completedReplay.attachment_filename !== null;
  return input.completedReplay?.status === "failed" &&
    input.completedReplay.request_contract_version === 2 && !hasFrozenPayload &&
    input.completedReplay.version_id === input.versionId && input.completedReplay.created_by === input.actorUserId &&
    input.completedReplay.payload_hash === input.requestPayloadHash && input.completedReplay.recipient === input.payload.to.trim() &&
    JSON.stringify(input.completedReplay.cc ?? null) === JSON.stringify(input.payload.cc ?? null) &&
    input.completedReplay.subject === input.payload.subject.trim() && input.completedReplay.body === input.payload.message;
}
