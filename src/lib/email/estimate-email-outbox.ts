import { createHash, randomUUID } from "node:crypto";

import { Resend, type ErrorResponse } from "resend";

import {
  badRequest,
  conflict,
  forbidden,
  internalError,
  mapSupabaseError,
  notFound,
  type SupabaseErrorLike,
} from "@/lib/estimates/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type EstimateEmailDispatchStatus =
  | "preparing"
  | "queued"
  | "processing"
  | "sent"
  | "failed"
  | "unknown"
  | "delivered"
  | "bounced";

export type EstimateEmailDispatch = {
  id: string;
  tenant_id: string;
  version_id: string;
  recipient: string;
  cc: string[] | null;
  subject: string;
  body: string | null;
  status: EstimateEmailDispatchStatus;
  provider_id: string | null;
  sent_at: string | null;
  request_id: string;
  payload_hash: string;
  provider_payload_hash: string | null;
  idempotency_key: string;
  created_by: string | null;
  version_content_revision: number;
  from_address: string;
  html_body: string | null;
  text_body: string | null;
  document_path: string | null;
  document_sha256: string | null;
  attachment_filename: string | null;
  attempt_count: number;
  first_attempt_at: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
};

type RpcResult = {
  data: unknown;
  error: SupabaseErrorLike | null;
};

type RpcCaller = (
  functionName: string,
  args: Record<string, unknown>
) => PromiseLike<RpcResult>;

const RETRYABLE_RESEND_ERRORS = new Set<ErrorResponse["name"]>([
  "concurrent_idempotent_requests",
  "rate_limit_exceeded",
  "application_error",
  "internal_server_error",
]);
const AMBIGUOUS_RESEND_ERRORS = new Set<ErrorResponse["name"]>([
  "invalid_idempotent_request",
]);
const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000] as const;

function getRpcCaller(): RpcCaller {
  const client = createServiceRoleClient();
  return client.rpc.bind(client) as unknown as RpcCaller;
}

function parseDispatch(data: unknown): EstimateEmailDispatch {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (!candidate || typeof candidate !== "object") {
    throw internalError(
      "La base n'a pas renvoye le dispatch email attendu.",
      undefined,
      "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE"
    );
  }

  const row = candidate as Partial<EstimateEmailDispatch>;
  if (
    typeof row.id !== "string" ||
    typeof row.tenant_id !== "string" ||
    typeof row.version_id !== "string" ||
    typeof row.status !== "string"
  ) {
    throw internalError(
      "La base a renvoye un dispatch email incomplet.",
      undefined,
      "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE"
    );
  }

  return row as EstimateEmailDispatch;
}

function throwDispatchRpcError(
  error: SupabaseErrorLike,
  fallbackMessage: string
): never {
  const message = error.message ?? "";

  if (message.includes("ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST")) {
    throw conflict(
      "Cette tentative d'envoi est terminee. Relancez-la avec une nouvelle requete.",
      { code: error.code },
      "ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST"
    );
  }

  if (
    message.includes("ESTIMATE_VERSION_CONFLICT") ||
    message.includes("ESTIMATE_DRAFT_LOCK_REQUIRED") ||
    message.includes("ESTIMATE_EMAIL_DISPATCH_IN_PROGRESS") ||
    message.includes("ESTIMATE_EMAIL_DISPATCH_LEASED") ||
    message.includes("ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT") ||
    message.includes("STATE_CONFLICT") ||
    message.includes("LEASE_INVALID")
  ) {
    throw conflict(
      "Le workflow d'envoi a change. Rechargez le devis avant de reessayer.",
      { code: error.code },
      "ESTIMATE_EMAIL_DISPATCH_CONFLICT"
    );
  }

  if (
    message.includes("SERVICE_ROLE_REQUIRED") ||
    message.includes("FORBIDDEN") ||
    message.includes("STATUS_FORBIDDEN")
  ) {
    throw forbidden(
      "Acces a l'envoi du devis refuse.",
      { code: error.code },
      "ESTIMATE_EMAIL_DISPATCH_FORBIDDEN"
    );
  }

  if (message.includes("NOT_FOUND")) {
    throw notFound(
      "Dispatch email ou version de devis introuvable.",
      { code: error.code },
      "ESTIMATE_EMAIL_DISPATCH_NOT_FOUND"
    );
  }

  if (
    message.includes("INPUT_INVALID") ||
    message.includes("PAYLOAD_INVALID") ||
    message.includes("SEAL_")
  ) {
    throw badRequest(
      fallbackMessage,
      { code: error.code },
      "ESTIMATE_EMAIL_DISPATCH_INVALID"
    );
  }

  throw mapSupabaseError(error, fallbackMessage);
}

async function callDispatchRpc(
  functionName: string,
  args: Record<string, unknown>,
  fallbackMessage: string
) {
  const { data, error } = await getRpcCaller()(functionName, args);
  if (error) {
    throwDispatchRpcError(error, fallbackMessage);
  }
  return parseDispatch(data);
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex").toLowerCase();
}

export function canonicalJsonHash(value: unknown) {
  return sha256(JSON.stringify(value));
}

export function classifyResendFailure(error: ErrorResponse) {
  if (AMBIGUOUS_RESEND_ERRORS.has(error.name)) return "unknown" as const;
  if (RETRYABLE_RESEND_ERRORS.has(error.name)) return "retry" as const;
  return "failed" as const;
}

export async function findActiveEstimateEmailDispatch(input: {
  versionId: string;
  tenantId: string;
}) {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("estimate_emails")
    .select("*")
    .eq("version_id", input.versionId)
    .eq("tenant_id", input.tenantId)
    .eq("type", "initial")
    .in("status", ["preparing", "queued", "processing", "unknown"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de reprendre l'envoi email en cours."
    );
  }
  return data ? parseDispatch(data) : null;
}

export async function findEstimateEmailDispatchByRequest(input: {
  versionId: string;
  tenantId: string;
  requestId: string;
}) {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("estimate_emails")
    .select("*")
    .eq("version_id", input.versionId)
    .eq("tenant_id", input.tenantId)
    .eq("request_id", input.requestId)
    .eq("type", "initial")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de rejouer la demande email idempotente."
    );
  }
  return data ? parseDispatch(data) : null;
}

export async function reserveEstimateEmailDispatch(input: {
  versionId: string;
  tenantId: string;
  expectedUpdatedAt: string;
  actorUserId: string;
  requestId: string;
  payloadHash: string;
  recipient: string;
  cc?: string[];
  subject: string;
  body: string;
  fromAddress: string;
}) {
  return callDispatchRpc(
    "reserve_estimate_email_dispatch",
    {
      p_version_id: input.versionId,
      p_tenant_id: input.tenantId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_actor_user_id: input.actorUserId,
      p_request_id: input.requestId,
      p_payload_hash: input.payloadHash,
      p_recipient: input.recipient,
      p_cc: input.cc ?? null,
      p_subject: input.subject,
      p_body: input.body,
      p_from_address: input.fromAddress,
    },
    "Impossible de reserver l'envoi du devis."
  );
}

export async function prepareEstimateEmailDispatch(input: {
  dispatchId: string;
  tenantId: string;
  actorUserId: string;
  sealHash: string;
  providerPayloadHash: string;
  htmlBody: string;
  textBody: string;
  documentPath: string;
  documentSha256: string;
  attachmentFilename: string;
}) {
  return callDispatchRpc(
    "prepare_estimate_email_dispatch",
    {
      p_dispatch_id: input.dispatchId,
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_seal_hash: input.sealHash,
      p_provider_payload_hash: input.providerPayloadHash,
      p_html_body: input.htmlBody,
      p_text_body: input.textBody,
      p_document_path: input.documentPath,
      p_document_sha256: input.documentSha256,
      p_attachment_filename: input.attachmentFilename,
    },
    "Impossible de figer le contenu de l'email."
  );
}

export async function claimEstimateEmailDispatch(input: {
  dispatchId: string;
  tenantId: string;
  actorUserId: string;
  leaseToken: string;
}) {
  return callDispatchRpc(
    "claim_estimate_email_dispatch",
    {
      p_dispatch_id: input.dispatchId,
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_lease_token: input.leaseToken,
      p_lease_seconds: 120,
    },
    "Impossible de verrouiller l'envoi du devis."
  );
}

export async function completeEstimateEmailDispatch(input: {
  dispatchId: string;
  tenantId: string;
  actorUserId: string;
  leaseToken: string;
  providerId: string;
}) {
  return callDispatchRpc(
    "complete_estimate_email_dispatch",
    {
      p_dispatch_id: input.dispatchId,
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_lease_token: input.leaseToken,
      p_provider_id: input.providerId,
      p_sent_at: new Date().toISOString(),
    },
    "L'email a ete accepte par le fournisseur, mais sa confirmation n'a pas pu etre enregistree."
  );
}

export async function failEstimateEmailDispatch(input: {
  dispatchId: string;
  tenantId: string;
  actorUserId: string;
  leaseToken?: string;
  errorCode: string;
  errorMessage: string;
}) {
  return callDispatchRpc(
    "fail_estimate_email_dispatch",
    {
      p_dispatch_id: input.dispatchId,
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_lease_token: input.leaseToken ?? null,
      p_error_code: input.errorCode,
      p_error_message: input.errorMessage,
    },
    "Impossible d'enregistrer l'echec de l'envoi."
  );
}

export async function deferEstimateEmailDispatch(input: {
  dispatchId: string;
  tenantId: string;
  actorUserId: string;
  leaseToken: string;
  errorCode: string;
  errorMessage: string;
}) {
  return callDispatchRpc(
    "defer_estimate_email_dispatch",
    {
      p_dispatch_id: input.dispatchId,
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_lease_token: input.leaseToken,
      p_error_code: input.errorCode,
      p_error_message: input.errorMessage,
    },
    "Impossible de planifier la reprise de l'envoi."
  );
}

export async function markEstimateEmailDispatchUnknown(input: {
  dispatchId: string;
  tenantId: string;
  actorUserId: string;
  leaseToken: string;
  errorCode: string;
  errorMessage: string;
}) {
  return callDispatchRpc(
    "mark_estimate_email_dispatch_unknown",
    {
      p_dispatch_id: input.dispatchId,
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_lease_token: input.leaseToken,
      p_error_code: input.errorCode,
      p_error_message: input.errorMessage,
    },
    "Impossible de geler l'envoi dont l'issue est inconnue."
  );
}

function assertFrozenProviderPayload(dispatch: EstimateEmailDispatch) {
  if (
    !dispatch.html_body ||
    !dispatch.text_body ||
    !dispatch.document_path ||
    !dispatch.document_sha256 ||
    !dispatch.attachment_filename ||
    !dispatch.idempotency_key
  ) {
    throw internalError(
      "Le contenu du dispatch email n'est pas complet.",
      undefined,
      "ESTIMATE_EMAIL_PAYLOAD_NOT_PREPARED"
    );
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function deliverEstimateEmailDispatch(input: {
  dispatch: EstimateEmailDispatch;
  actorUserId: string;
  apiKey: string;
  loadPdfBuffer: () => Promise<Buffer>;
  retryDelaysMs?: readonly number[];
}) {
  assertFrozenProviderPayload(input.dispatch);
  const leaseToken = randomUUID();
  const claimed = await claimEstimateEmailDispatch({
    dispatchId: input.dispatch.id,
    tenantId: input.dispatch.tenant_id,
    actorUserId: input.actorUserId,
    leaseToken,
  });

  if (claimed.status === "unknown") {
    throw conflict(
      "L'issue de cet envoi doit etre rapprochee avec le fournisseur avant toute reprise.",
      { dispatch_id: claimed.id },
      "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
    );
  }
  if (["sent", "delivered", "bounced"].includes(claimed.status)) {
    return { providerId: claimed.provider_id };
  }

  assertFrozenProviderPayload(claimed);
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await input.loadPdfBuffer();
    if (sha256(pdfBuffer) !== claimed.document_sha256) {
      throw new Error("The frozen estimate PDF hash no longer matches storage.");
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unable to load the frozen estimate PDF.";
    if (claimed.attempt_count <= 1) {
      await failEstimateEmailDispatch({
        dispatchId: claimed.id,
        tenantId: claimed.tenant_id,
        actorUserId: input.actorUserId,
        leaseToken,
        errorCode: "ESTIMATE_EMAIL_PDF_UNAVAILABLE",
        errorMessage,
      });
    } else {
      await markEstimateEmailDispatchUnknown({
        dispatchId: claimed.id,
        tenantId: claimed.tenant_id,
        actorUserId: input.actorUserId,
        leaseToken,
        errorCode: "ESTIMATE_EMAIL_PDF_MISMATCH_AFTER_ATTEMPT",
        errorMessage,
      });
    }
    throw internalError(
      "Impossible de verifier le PDF fige avant l'envoi.",
      { dispatch_id: claimed.id },
      claimed.attempt_count <= 1
        ? "ESTIMATE_EMAIL_PDF_UNAVAILABLE"
        : "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
    );
  }

  const retryDelays = input.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const resend = new Resend(input.apiKey);
  let lastFailure: ErrorResponse | Error | null = null;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      const { data, error } = await resend.emails.send(
        {
          from: claimed.from_address,
          to: claimed.recipient,
          cc: claimed.cc ?? undefined,
          subject: claimed.subject,
          html: claimed.html_body!,
          text: claimed.text_body!,
          attachments: [
            {
              filename: claimed.attachment_filename!,
              content: pdfBuffer,
            },
          ],
        },
        { idempotencyKey: claimed.idempotency_key }
      );

      if (data?.id) {
        await completeEstimateEmailDispatch({
          dispatchId: claimed.id,
          tenantId: claimed.tenant_id,
          actorUserId: input.actorUserId,
          leaseToken,
          providerId: data.id,
        });
        return { providerId: data.id };
      }

      if (error) {
        const disposition = classifyResendFailure(error);
        if (disposition === "unknown") {
          await markEstimateEmailDispatchUnknown({
            dispatchId: claimed.id,
            tenantId: claimed.tenant_id,
            actorUserId: input.actorUserId,
            leaseToken,
            errorCode: error.name,
            errorMessage: error.message,
          });
          throw conflict(
            "Le fournisseur refuse de rejouer cette cle avec certitude; rapprochement requis.",
            { dispatch_id: claimed.id },
            "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
          );
        }

        if (disposition === "failed") {
          await failEstimateEmailDispatch({
            dispatchId: claimed.id,
            tenantId: claimed.tenant_id,
            actorUserId: input.actorUserId,
            leaseToken,
            errorCode: error.name,
            errorMessage: error.message,
          });
          throw internalError(
            "Erreur lors de l'envoi de l'email.",
            { provider_error: error.name },
            "ESTIMATE_EMAIL_PROVIDER_REJECTED"
          );
        }

        lastFailure = error;
      } else {
        lastFailure = new Error("Resend returned neither data nor error.");
      }
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
      ) {
        throw error;
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "ESTIMATE_EMAIL_PROVIDER_REJECTED"
      ) {
        throw error;
      }
      lastFailure = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < retryDelays.length) {
      await delay(retryDelays[attempt]);
    }
  }

  const failureCode =
    lastFailure && "name" in lastFailure ? lastFailure.name : "EMAIL_PROVIDER_UNAVAILABLE";
  const failureMessage =
    lastFailure instanceof Error
      ? lastFailure.message
      : (lastFailure?.message ?? "Email provider unavailable.");
  const deferred = await deferEstimateEmailDispatch({
    dispatchId: claimed.id,
    tenantId: claimed.tenant_id,
    actorUserId: input.actorUserId,
    leaseToken,
    errorCode: failureCode,
    errorMessage: failureMessage,
  });

  if (deferred.status === "unknown") {
    throw conflict(
      "La fenetre de rejeu automatique est expiree; rapprochement fournisseur requis.",
      { dispatch_id: deferred.id },
      "ESTIMATE_EMAIL_DELIVERY_UNKNOWN"
    );
  }

  throw internalError(
    "Le fournisseur email est temporairement indisponible. Reessayez avec la meme demande.",
    { dispatch_id: deferred.id },
    "ESTIMATE_EMAIL_RETRYABLE"
  );
}
