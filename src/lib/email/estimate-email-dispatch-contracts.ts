import { z } from "zod";
import { internalError } from "@/lib/estimates/errors";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const status = z.enum(["preparing", "queued", "processing", "sent", "failed", "unknown", "delivered", "bounced"]);
const identitySchema = z.object({ id: uuid, tenant_id: uuid, version_id: uuid, status });

// Legacy and notification rows have no transactional request. Their nullable
// fields remain null; never reconstruct an envelope from current live data.
const dispatchSchema = identitySchema.extend({
  recipient: z.string().min(1),
  cc: z.array(z.string()).nullable(),
  subject: z.string(),
  body: z.string().nullable(),
  provider_id: z.string().nullable(),
  sent_at: z.string().nullable(),
  request_id: uuid.nullable(),
  payload_hash: z.string().nullable(),
  provider_payload_hash: hash.nullable(),
  idempotency_key: z.string().nullable(),
  created_by: uuid.nullable(),
  version_content_revision: z.number().int().positive().nullable(),
  from_address: z.string().nullable(),
  request_contract_version: z.union([z.literal(1), z.literal(2)]),
  portal_url: z.string().nullable(),
  offer_identity_snapshot: z.json().nullable(),
  html_body: z.string().nullable(),
  text_body: z.string().nullable(),
  document_path: z.string().nullable(),
  document_sha256: hash.nullable(),
  attachment_filename: z.string().nullable(),
  attempt_count: z.number().int().nonnegative(),
  first_attempt_at: z.string().nullable(),
  lease_token: uuid.nullable(),
  lease_expires_at: z.string().nullable(),
  last_error_code: z.string().nullable(),
  last_error_message: z.string().nullable(),
  next_attempt_at: z.string().nullable().optional(),
}).passthrough().refine((row) => row.request_id === null || (
  hash.safeParse(row.payload_hash).success &&
  typeof row.idempotency_key === "string" && row.idempotency_key.trim().length > 0 && row.idempotency_key.trim().length <= 256 &&
  row.version_content_revision !== null &&
  typeof row.from_address === "string" && row.from_address.trim().length > 0
));

export type EstimateEmailDispatchStatus = z.infer<typeof status>;
export type EstimateEmailDispatch = z.infer<typeof dispatchSchema>;
type DispatchIdentity = z.infer<typeof identitySchema>;
type DispatchAffinity = { dispatchId?: string; tenantId?: string; versionId?: string; requestId?: string };

function invalidDispatch(): never {
  // Do not expose the stored envelope, recipient or portal capability in errors.
  throw internalError("La base a renvoye un dispatch email incomplet ou incoherent.", undefined,
    "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE");
}

function singleDispatch(data: unknown) {
  if (Array.isArray(data)) {
    if (data.length !== 1) invalidDispatch();
    return data[0];
  }
  return data;
}

function assertIdentity(row: DispatchIdentity, affinity: DispatchAffinity) {
  for (const [field, expected] of [
    ["id", affinity.dispatchId], ["tenant_id", affinity.tenantId], ["version_id", affinity.versionId],
  ] as const) {
    if (expected !== undefined && row[field].toLowerCase() !== expected.toLowerCase()) invalidDispatch();
  }
}

export function parseEstimateEmailDispatchIdentity(data: unknown, affinity: DispatchAffinity = {}): DispatchIdentity {
  const result = identitySchema.safeParse(singleDispatch(data));
  if (!result.success) invalidDispatch();
  assertIdentity(result.data, affinity);
  return result.data;
}

export function parseEstimateEmailDispatch(data: unknown, affinity: DispatchAffinity = {}): EstimateEmailDispatch {
  const result = dispatchSchema.safeParse(singleDispatch(data));
  if (!result.success) invalidDispatch();
  const row = result.data;
  assertIdentity(row, affinity);
  if (affinity.requestId !== undefined && row.request_id?.toLowerCase() !== affinity.requestId.toLowerCase()) invalidDispatch();
  return row;
}

const RPC_RETURN_STATUSES: Record<string, readonly EstimateEmailDispatchStatus[]> = {
  reserve_estimate_email_dispatch_with_session: ["preparing", "queued", "processing", "unknown", "sent", "delivered", "bounced"],
  prepare_estimate_email_dispatch: ["queued", "processing", "sent", "delivered", "bounced"],
  claim_estimate_email_dispatch: ["processing", "sent", "delivered", "bounced", "unknown"],
  complete_estimate_email_dispatch: ["sent", "delivered", "bounced"],
  fail_estimate_email_dispatch: ["failed"],
  defer_estimate_email_dispatch: ["queued", "unknown"],
  mark_estimate_email_dispatch_unknown: ["unknown"],
};

/** Validate only affinities guaranteed by the operation, including terminal replays. */
export function assertEstimateEmailRpcConfirmation(
  row: EstimateEmailDispatch,
  functionName: string,
  args: Record<string, unknown>
) {
  assertIdentity(row, {
    dispatchId: typeof args.p_dispatch_id === "string" ? args.p_dispatch_id : undefined,
    tenantId: typeof args.p_tenant_id === "string" ? args.p_tenant_id : undefined,
    versionId: typeof args.p_version_id === "string" ? args.p_version_id : undefined,
  });
  const allowed = RPC_RETURN_STATUSES[functionName];
  if (allowed && !allowed.includes(row.status)) invalidDispatch();
  if (functionName === "claim_estimate_email_dispatch" && row.status === "processing" &&
      (row.lease_token !== args.p_lease_token || row.lease_expires_at === null)) invalidDispatch();
  if (functionName === "reconcile_estimate_email_dispatch" && row.status !== args.p_resolution) invalidDispatch();
  if (functionName === "prepare_estimate_email_dispatch") {
    for (const field of ["provider_payload_hash", "html_body", "text_body", "document_path", "document_sha256", "attachment_filename"] as const) {
      if (row[field] !== args[`p_${field}`]) invalidDispatch();
    }
  }
  if ((functionName === "complete_estimate_email_dispatch" ||
      functionName === "reconcile_estimate_email_dispatch" && args.p_resolution === "sent") &&
      row.provider_id !== (typeof args.p_provider_id === "string" ? args.p_provider_id.trim() : null)) invalidDispatch();
  // A reservation can reuse an active dispatch with a different request_id.
  // Its tenant/version and immutable envelope, rather than its original key, bind it.
  if (functionName === "reserve_estimate_email_dispatch_with_session" && (
    row.created_by !== args.p_actor_user_id || row.payload_hash !== args.p_payload_hash ||
    row.recipient !== String(args.p_recipient).trim() || row.subject !== String(args.p_subject).trim() ||
    row.body !== args.p_body || row.from_address !== String(args.p_from_address).trim() ||
    JSON.stringify(row.cc) !== JSON.stringify(args.p_cc)
  )) invalidDispatch();
}
