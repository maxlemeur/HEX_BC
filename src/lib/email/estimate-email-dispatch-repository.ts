import "server-only";

import {
  badRequest, conflict, forbidden, internalError, mapSupabaseError, notFound,
  type SupabaseErrorLike,
} from "@/lib/estimates/errors";
import type { ClientContract1, DocumentProof1 } from "@/lib/estimates/offer-contract";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  parseEstimateEmailDispatch,
  parseEstimateEmailDispatchIdentity,
  assertEstimateEmailRpcConfirmation,
  type EstimateEmailDispatch,
} from "@/lib/email/estimate-email-dispatch-contracts";

type DueEmailBatch = { dispatches: EstimateEmailDispatch[]; blocked: number };

type RpcResult = {
  data: unknown;
  error: SupabaseErrorLike | null;
};

type RpcCaller = (
  functionName: string,
  args: Record<string, unknown>
) => PromiseLike<RpcResult>;

function getRpcCaller(): RpcCaller {
  const client = createServiceRoleClient();
  return client.rpc.bind(client) as unknown as RpcCaller;
}

function throwDispatchRpcError(
  error: SupabaseErrorLike,
  fallbackMessage: string
): never {
  const message = error.message ?? "";

  if (message.includes("ESTIMATE_DRAFT_LOCK_REQUIRED")) {
    throw conflict(
      "Cette page doit détenir le verrou du devis avant l'envoi.",
      { code: error.code },
      "LOCK_REQUIRED"
    );
  }

  if (message.includes("ESTIMATE_VERSION_CONFLICT")) {
    throw conflict(
      "Le devis a changé. Fermez l'envoi et relisez la version avant de réessayer.",
      { code: error.code },
      "VERSION_CONFLICT"
    );
  }

  if (message.includes("ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST")) {
    throw conflict(
      "Cette tentative d'envoi est terminée. Relancez-la avec une nouvelle requête.",
      { code: error.code },
      "ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST"
    );
  }

  if (
    message.includes("ESTIMATE_EMAIL_DISPATCH_IN_PROGRESS") ||
    message.includes("ESTIMATE_EMAIL_DISPATCH_LEASED") ||
    message.includes("ESTIMATE_EMAIL_IDEMPOTENCY_CONFLICT") ||
    message.includes("STATE_CONFLICT") ||
    message.includes("LEASE_INVALID")
  ) {
    throw conflict(
      "Le workflow d'envoi a change. Rechargez le devis avant de réessayer.",
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
      "Accès à l'envoi du devis refusé.",
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
  const dispatch = parseEstimateEmailDispatch(data);
  assertEstimateEmailRpcConfirmation(dispatch, functionName, args);
  return dispatch;
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
  return data ? parseEstimateEmailDispatch(data, { tenantId: input.tenantId, versionId: input.versionId }) : null;
}

export async function findEstimateEmailDispatchByRequest(input: {
  tenantId: string;
  requestId: string;
}) {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("estimate_emails")
    .select("*")
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
  return data ? parseEstimateEmailDispatch(data, { tenantId: input.tenantId, requestId: input.requestId }) : null;
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
  portalOrigin: string;
  companySnapshot: ClientContract1["company"];
  draftLockSessionId?: string | null;
}) {
  return callDispatchRpc(
    "reserve_estimate_email_dispatch_with_session",
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
      p_portal_origin: input.portalOrigin,
      p_company_snapshot: input.companySnapshot,
      p_draft_lock_session_id: input.draftLockSessionId ?? null,
    },
    "Impossible de réserver l'envoi du devis."
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
  expectedDocumentContract: DocumentProof1;
  sealPayloadVersion: 1 | 2 | 3 | 4 | 5;
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
      p_expected_document_contract: input.expectedDocumentContract,
      p_seal_payload_version: input.sealPayloadVersion,
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
    "L'email a été accepté par le fournisseur, mais sa confirmation n'a pas pu être enregistrée."
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
    "Impossible d'enregistrer l'échec de l'envoi."
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

export async function reconcileEstimateEmailDispatch(input: {
  dispatchId: string;
  resolution: "sent" | "failed";
  actorUserId: string;
  providerId?: string | null;
  note?: string | null;
}) {
  return callDispatchRpc(
    "reconcile_estimate_email_dispatch",
    {
      p_dispatch_id: input.dispatchId,
      p_resolution: input.resolution,
      p_actor_user_id: input.actorUserId,
      p_provider_id: input.providerId ?? null,
      p_note: input.note ?? null,
    },
    "Impossible de rapprocher le dispatch email."
  );
}

export async function listProblematicEstimateEmailDispatches(input: {
  versionId: string;
  tenantId: string;
}) {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("estimate_emails")
    .select("*")
    .eq("version_id", input.versionId)
    .eq("tenant_id", input.tenantId)
    .in("status", ["unknown", "failed"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les envois email en échec."
    );
  }

  return (data ?? []).map((row) => parseEstimateEmailDispatch(row, { tenantId: input.tenantId, versionId: input.versionId }));
}

export async function getEstimateEmailDispatchForReconciliation(
  dispatchId: string
): Promise<Pick<
  EstimateEmailDispatch,
  "id" | "tenant_id" | "version_id" | "status"
> | null> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .from("estimate_emails")
    .select("id, tenant_id, version_id, status")
    .eq("id", dispatchId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'envoi email.");
  }

  return data ? parseEstimateEmailDispatchIdentity(data, { dispatchId }) : null;
}

export async function listDueEstimateEmailDispatches(now: Date): Promise<DueEmailBatch> {
  const client = createServiceRoleClient();
  const { data, error } = await client
    .rpc("list_due_estimate_email_dispatches", { p_now: now.toISOString(), p_limit: 25 });

  if (error) {
    throw mapSupabaseError(error, "Impossible de lister l'outbox email.");
  }

  if (!data || typeof data !== "object" || Array.isArray(data) ||
    !Array.isArray(data.dispatches) || !Number.isSafeInteger(data.blocked) ||
    typeof data.blocked !== "number" || data.blocked < 0) {
    throw internalError("Réponse de sélection outbox invalide.", undefined, "ESTIMATE_EMAIL_OUTBOX_INVALID_RESPONSE");
  }
  return { dispatches: data.dispatches.map((row) => parseEstimateEmailDispatch(row)), blocked: data.blocked };
}
