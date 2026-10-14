import "server-only";

import { z } from "zod";

import {
  readActiveTenantMembership,
  readAuthenticatedUser,
} from "@/lib/auth/tenant-context";
import { ApiError, type SupabaseErrorLike } from "@/lib/estimates/errors";
import {
  sourceReferenceActivationSchema,
  sourceReferenceConfirmationReceiptSchema,
  sourceReferenceHistoryEntrySchema,
  sourceReferencePendingCopySchema,
  sourceReferenceReviewInputSchema,
  sourceReferenceReviewSchema,
  sourceReferenceVerifiedCopySchema,
  type SourceReferenceReview,
  type SourceReferenceReviewInput,
} from "@/lib/estimates/source-reference-contracts";

const pending = sourceReferencePendingCopySchema.shape;
const verified = sourceReferenceVerifiedCopySchema.shape;
const history = sourceReferenceHistoryEntrySchema.shape;
const activation = sourceReferenceActivationSchema.shape;
const request = sourceReferenceConfirmationReceiptSchema.shape.canonicalRequest.shape;

const rpcCopyIdentity = {
  copy_id: verified.copyId,
  file_name: verified.fileName,
  created_at: verified.createdAt,
};
const rpcCopySchema = z.discriminatedUnion("state", [
  z.strictObject({ ...rpcCopyIdentity, state: pending.state, sha256: pending.sha256, byte_size: pending.byteSize, page_count: pending.pageCount, verified_at: pending.verifiedAt }),
  z.strictObject({ ...rpcCopyIdentity, state: verified.state, sha256: verified.sha256, byte_size: verified.byteSize, page_count: verified.pageCount, verified_at: verified.verifiedAt }),
]);
const rpcReviewSchema = z.strictObject({
  version_id: sourceReferenceReviewSchema.shape.versionId,
  project_id: sourceReferenceReviewSchema.shape.projectId,
  revision: sourceReferenceReviewSchema.shape.revision,
  active_reference: rpcCopySchema.nullable(),
  selected_copy: rpcCopySchema.nullable(),
  history: z.array(z.strictObject({
    id: history.id, copy_id: history.copyId, previous_copy_id: history.previousCopyId,
    revision: history.revision, reason: history.reason, actor_id: history.actorId,
    actor_name: history.actorName, occurred_at: history.occurredAt,
  })).max(100),
  next_before_revision: sourceReferenceReviewSchema.shape.nextBeforeRevision,
  confirmation_receipt: z.strictObject({
    canonical_request: z.strictObject({
      actor_id: request.actorId, version_id: request.versionId, copy_id: request.copyId,
      expected_revision: request.expectedRevision, idempotency_key: request.idempotencyKey,
      reviewed_sha256: request.reviewedSha256, reason: request.reason,
    }),
    activation: z.strictObject({ id: activation.id, copy_id: activation.copyId, revision: activation.revision }),
  }).nullable(),
});

export function invalidSourceReferenceInput() {
  return new ApiError({ status: 400, code: "SOURCE_REVIEW_INVALID_INPUT", message: "Paramètres de revue documentaire invalides." });
}

function accessDenied() {
  return new ApiError({ status: 404, code: "SOURCE_REVIEW_ACCESS_DENIED", message: "Revue documentaire inaccessible." });
}

function unavailable() {
  return new ApiError({ status: 503, code: "SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE", message: "La revue documentaire est temporairement indisponible. Réessayez." });
}

function invalidResult() {
  console.error("Source reference review returned an invalid or unexpected result.");
  return new ApiError({ status: 500, code: "INTERNAL_ERROR", message: "Impossible de lire la revue documentaire." });
}

function mapReadError(error: SupabaseErrorLike) {
  if (error.code === "42501" && error.message === "SOURCE_REVIEW_ACCESS_DENIED") return accessDenied();
  if (error.code === "22023" && error.message === "SOURCE_REVIEW_INVALID_INPUT") return invalidSourceReferenceInput();
  if (error.code === "" || /^08/.test(error.code) || ["PGRST000", "PGRST001", "PGRST002", "PGRST003", "PGRST202", "53300", "57014", "57P01", "57P02", "57P03"].includes(error.code)) return unavailable();
  // Unknown SQL messages, details, hints and locators never become HTTP data.
  return invalidResult();
}

function projectCopy(copy: z.infer<typeof rpcCopySchema> | null) {
  if (!copy) return null;
  return {
    copyId: copy.copy_id, fileName: copy.file_name, createdAt: copy.created_at,
    state: copy.state, sha256: copy.sha256, byteSize: copy.byte_size,
    pageCount: copy.page_count, verifiedAt: copy.verified_at,
  };
}

function projectReview(value: z.infer<typeof rpcReviewSchema>) {
  const receipt = value.confirmation_receipt;
  return {
    versionId: value.version_id,
    projectId: value.project_id,
    revision: value.revision,
    activeReference: projectCopy(value.active_reference),
    selectedCopy: projectCopy(value.selected_copy),
    history: value.history.map((event) => ({
      id: event.id, copyId: event.copy_id, previousCopyId: event.previous_copy_id,
      revision: event.revision, reason: event.reason, actorId: event.actor_id,
      actorName: event.actor_name, occurredAt: event.occurred_at,
    })),
    nextBeforeRevision: value.next_before_revision,
    confirmationReceipt: receipt ? {
      canonicalRequest: {
        actorId: receipt.canonical_request.actor_id,
        versionId: receipt.canonical_request.version_id,
        copyId: receipt.canonical_request.copy_id,
        expectedRevision: receipt.canonical_request.expected_revision,
        idempotencyKey: receipt.canonical_request.idempotency_key,
        reviewedSha256: receipt.canonical_request.reviewed_sha256,
        reason: receipt.canonical_request.reason,
      },
      activation: { id: receipt.activation.id, copyId: receipt.activation.copy_id, revision: receipt.activation.revision },
    } : null,
  };
}

function assertQueryMatchesReview(
  input: z.output<typeof sourceReferenceReviewInputSchema>,
  review: SourceReferenceReview
) {
  if (review.versionId !== input.versionId || (review.selectedCopy?.copyId ?? undefined) !== input.copyId) throw invalidResult();
  if (review.confirmationReceipt && review.confirmationReceipt.canonicalRequest.idempotencyKey !== input.confirmationKey) throw invalidResult();

  // Confirmations form a contiguous append-only revision history. A bounded
  // page cannot silently omit an event, cross its cursor or invent a next page.
  const firstRevision = Math.min(review.revision, input.cursor === undefined ? review.revision : input.cursor - 1);
  const expectedCount = Math.min(firstRevision, input.limit);
  if (review.history.length !== expectedCount || review.history.some((event, index) => event.revision !== firstRevision - index)) throw invalidResult();
  const last = review.history.at(-1);
  if (review.nextBeforeRevision !== (last && last.revision > 1 ? last.revision : null)) throw invalidResult();
  const currentEvent = review.history.find((event) => event.revision === review.revision);
  if (currentEvent && currentEvent.copyId !== review.activeReference?.copyId) throw invalidResult();
  if (review.activeReference?.copyId === review.selectedCopy?.copyId && JSON.stringify(review.activeReference) !== JSON.stringify(review.selectedCopy)) throw invalidResult();

  const receipt = review.confirmationReceipt;
  const receiptEvent = receipt && review.history.find((event) => event.revision === receipt.activation.revision);
  if (receiptEvent && receipt && (
    receiptEvent.id !== receipt.activation.id || receiptEvent.copyId !== receipt.activation.copyId ||
    receiptEvent.actorId !== receipt.canonicalRequest.actorId || receiptEvent.reason !== receipt.canonicalRequest.reason
  )) throw invalidResult();
}

export async function readSourceReferenceReview(input: SourceReferenceReviewInput, options: { signal?: AbortSignal } = {}): Promise<SourceReferenceReview> {
  options.signal?.throwIfAborted();
  const parsedInput = sourceReferenceReviewInputSchema.safeParse(input);
  if (!parsedInput.success) throw invalidSourceReferenceInput();

  // Use the canonical getUser and active-membership lookups, then let the
  // dedicated RPC enforce owner/admin/director access. The editor's owner-only
  // accessor would incorrectly exclude a director here.
  const { supabase, user, error: authError } = await readAuthenticatedUser();
  if (authError || !user) throw new ApiError({ status: 401, code: "UNAUTHORIZED", message: "Authentification requise." });
  const { membership, error: membershipError } = await readActiveTenantMembership(supabase, user.id);
  if (membershipError) throw mapReadError(membershipError);
  if (!membership?.tenant_id || !membership.role) throw accessDenied();

  const query = parsedInput.data;
  const rpc = supabase.rpc("get_estimate_source_review", {
    p_version_id: query.versionId,
    p_copy_id: query.copyId ?? null,
    p_before_revision: query.cursor ?? null,
    p_limit: query.limit,
    p_confirmation_key: query.confirmationKey ?? null,
  });
  const { data, error } = await (options.signal ? rpc.abortSignal(options.signal) : rpc);
  options.signal?.throwIfAborted();
  if (error) throw mapReadError(error);
  const parsedRpc = rpcReviewSchema.safeParse(data);
  if (!parsedRpc.success) throw invalidResult();
  const parsedReview = sourceReferenceReviewSchema.safeParse(projectReview(parsedRpc.data));
  if (!parsedReview.success) throw invalidResult();
  assertQueryMatchesReview(query, parsedReview.data);
  return parsedReview.data;
}
