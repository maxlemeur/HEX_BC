import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getAuthenticatedTenantContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  sourceReferenceActivationSchema,
  sourceReferenceAttestationSchema,
  sourceReferenceConfirmationInputSchema,
  sourceReferenceConfirmationResultSchema,
  sourceReferencePreparationInputSchema,
  sourceReferencePreparationResultSchema,
  sourceReferenceReservationSchema,
  sourceReferenceReviewInputSchema,
  type SourceReferenceCopy,
  type SourceReferenceReview,
} from "@/lib/estimates/source-reference-contracts";
import { mapSourceReferenceRpcError, normalizeSourceReferenceError, sourceReferenceError, type SourceReferenceDeadline } from "@/lib/estimates/source-reference-http";
import { inspectSourceReferencePdf, type InspectedSourceReferencePdf } from "@/lib/estimates/source-reference-pdf";
import { readSourceReferenceReview } from "@/lib/estimates/source-reference-review";
import { createSourceReferenceStorage } from "@/lib/estimates/source-reference-storage";

type PdfFacts = { sha256: string; byteSize: number; pageCount: number };
type VerifiedCopy = Extract<SourceReferenceCopy, { state: "verified" }>;
type ConfirmationInput = z.output<typeof sourceReferenceConfirmationInputSchema>;

function identity(versionId: string, copyId?: string) {
  const parsed = sourceReferenceReviewInputSchema.safeParse({ versionId, copyId });
  if (!parsed.success) throw sourceReferenceError("SOURCE_REVIEW_INVALID_INPUT");
  return parsed.data;
}
async function context(budget: SourceReferenceDeadline) {
  return budget.wait(getAuthenticatedTenantContext());
}
function assertWriter(auth: AuthenticatedTenantContext) {
  if (!["admin", "engineer"].includes(auth.tenantRole)) throw sourceReferenceError("SOURCE_REVIEW_WRITE_FORBIDDEN");
}
function selected(review: SourceReferenceReview): VerifiedCopy {
  if (!review.selectedCopy || review.selectedCopy.state !== "verified") throw sourceReferenceError("SOURCE_REVIEW_COPY_NOT_VERIFIED");
  return review.selectedCopy;
}
function facts(pdf: InspectedSourceReferencePdf): PdfFacts {
  return { sha256: createHash("sha256").update(new Uint8Array(pdf.bytes)).digest("hex"), byteSize: pdf.byteSize, pageCount: pdf.pageCount };
}
function assertFacts(actual: PdfFacts, expected: PdfFacts) {
  if (actual.sha256 !== expected.sha256 || actual.byteSize !== expected.byteSize || actual.pageCount !== expected.pageCount) throw sourceReferenceError("SOURCE_REVIEW_SOURCE_UNAVAILABLE");
}
function scope(auth: AuthenticatedTenantContext, review: SourceReferenceReview, copyId: string) {
  return {
    actorId: auth.userId.toLowerCase(), tenantId: auth.tenantId.toLowerCase(),
    projectId: review.projectId, versionId: review.versionId, copyId,
    destinationLocator: { bucket: "estimate-source-references", path: `${auth.tenantId.toLowerCase()}/${review.projectId}/${review.versionId}/${copyId}/reference.pdf` },
  };
}
async function inspect(bytes: ArrayBuffer, budget: SourceReferenceDeadline, conserved: boolean) {
  try {
    // The worker promise joins terminate(). Racing it against a timer would
    // return while the CPU worker still exists.
    const result = await inspectSourceReferencePdf(bytes, { signal: budget.signal });
    budget.check();
    return result;
  }
  catch (error) { throw normalizeSourceReferenceError(error, conserved); }
}
async function conservedPdf(auth: AuthenticatedTenantContext, review: SourceReferenceReview, purpose: "read" | "confirm", budget: SourceReferenceDeadline) {
  const copy = selected(review);
  try {
    const storage = await budget.wait(createSourceReferenceStorage({ context: auth, authorization: { ...scope(auth, review, copy.copyId), purpose }, signal: budget.signal }));
    const pdf = await inspect(await budget.wait(storage.readCopy()), budget, true);
    assertFacts(facts(pdf), copy);
    return pdf;
  } catch (error) { throw normalizeSourceReferenceError(error, true); }
}

export async function prepareSourceReference(version: string, input: z.output<typeof sourceReferencePreparationInputSchema>, budget: SourceReferenceDeadline) {
  const { versionId } = identity(version);
  const auth = await context(budget);
  const review = await budget.wait(readSourceReferenceReview({ versionId }, { signal: budget.signal }));
  assertWriter(auth);
  budget.check();
  const reservationResult = await budget.wait(auth.supabase.rpc("reserve_estimate_source_reference_copy", {
    p_version_id: versionId, p_document_id: input.documentId,
    p_expected_review_revision: input.expectedRevision, p_preparation_key: input.preparationKey,
  }).abortSignal(budget.signal));
  if (reservationResult.error) throw mapSourceReferenceRpcError(reservationResult.error);
  const reservation = sourceReferenceReservationSchema.safeParse(reservationResult.data);
  if (!reservation.success || reservation.data.version_id !== versionId) throw sourceReferenceError("INTERNAL_ERROR");
  const ticket = reservation.data;
  const storage = await budget.wait(createSourceReferenceStorage({
    context: auth, signal: budget.signal,
    authorization: {
      ...scope(auth, review, ticket.copy_id), purpose: "prepare", documentId: input.documentId,
      uploadId: ticket.source_locator.path.split("/")[2], reservation: ticket,
      destinationLocator: ticket.destination_locator,
    },
  }));
  let conservedBytes: ArrayBuffer | null;
  try { conservedBytes = await budget.wait(storage.readCopy()); }
  catch (error) { throw normalizeSourceReferenceError(error, true); }
  let expected: PdfFacts | undefined;
  if (conservedBytes === null) {
    // The temporary original buffer is released before reading back the copy.
    const upload = async () => {
      const original = await inspect(await budget.wait(storage.readSource()), budget, false);
      const originalFacts = facts(original);
      const outcome = await budget.wait(storage.uploadCopy(original));
      return outcome === "created" ? originalFacts : undefined;
    };
    expected = await upload();
    try { conservedBytes = await budget.wait(storage.readCopy()); }
    catch (error) { throw normalizeSourceReferenceError(error, true); }
    if (conservedBytes === null) throw sourceReferenceError("SOURCE_REVIEW_SOURCE_UNAVAILABLE");
  }
  const conserved = await inspect(conservedBytes, budget, true);
  const actual = facts(conserved);
  if (expected) assertFacts(actual, expected);
  const beforeComplete = await budget.wait(readSourceReferenceReview({ versionId, copyId: ticket.copy_id }, { signal: budget.signal }));
  if (!beforeComplete.selectedCopy) throw sourceReferenceError("INTERNAL_ERROR");
  if (beforeComplete.selectedCopy.state === "verified") assertFacts(actual, beforeComplete.selectedCopy);
  budget.check();
  const completion = await budget.wait(createServiceRoleClient().rpc("complete_estimate_source_reference_copy", {
    p_copy_id: ticket.copy_id, p_sha256: actual.sha256, p_byte_size: actual.byteSize, p_page_count: actual.pageCount,
  }).abortSignal(budget.signal));
  if (completion.error) throw mapSourceReferenceRpcError(completion.error);
  const attestation = sourceReferenceAttestationSchema.safeParse(completion.data);
  if (!attestation.success || attestation.data.copy_id !== ticket.copy_id) throw sourceReferenceError("INTERNAL_ERROR");
  assertFacts(actual, { sha256: attestation.data.sha256, byteSize: attestation.data.byte_size, pageCount: attestation.data.page_count });
  const after = await budget.wait(readSourceReferenceReview({ versionId, copyId: ticket.copy_id }, { signal: budget.signal }));
  const copy = selected(after);
  assertFacts(actual, copy);
  return sourceReferencePreparationResultSchema.parse({ versionId, reviewRevision: after.revision, copy, replayed: ticket.replayed });
}

export async function readSourceReferenceContent(version: string, copy: string, budget: SourceReferenceDeadline) {
  const { versionId, copyId } = identity(version, copy);
  const auth = await context(budget);
  const review = await budget.wait(readSourceReferenceReview({ versionId, copyId }, { signal: budget.signal }));
  const pdf = await conservedPdf(auth, review, "read", budget);
  const after = await budget.wait(readSourceReferenceReview({ versionId, copyId }, { signal: budget.signal }));
  const verified = selected(after);
  assertFacts(facts(pdf), verified);
  budget.check();
  return { bytes: pdf.bytes, copy: verified };
}

function hasMatchingReceipt(review: SourceReferenceReview, auth: AuthenticatedTenantContext, input: ConfirmationInput) {
  const receipt = review.confirmationReceipt;
  if (!receipt) return false;
  const request = receipt.canonicalRequest;
  if (request.actorId !== auth.userId.toLowerCase() || request.versionId !== review.versionId ||
      request.copyId !== input.copyId || request.expectedRevision !== input.expectedRevision ||
      request.idempotencyKey !== input.idempotencyKey || request.reviewedSha256 !== input.reviewedSha256 || request.reason !== input.reason) {
    throw sourceReferenceError("SOURCE_REVIEW_IDEMPOTENCY_CONFLICT");
  }
  return true;
}
const rpcConfirmationSchema = z.strictObject({
  activation: z.strictObject({ id: sourceReferenceActivationSchema.shape.id, copy_id: sourceReferenceActivationSchema.shape.copyId, revision: sourceReferenceActivationSchema.shape.revision }),
  current_revision: sourceReferenceConfirmationResultSchema.shape.currentRevision,
  current_copy_id: sourceReferenceConfirmationResultSchema.shape.currentCopyId,
  replayed: z.boolean(),
});

export async function confirmSourceReference(version: string, input: ConfirmationInput, budget: SourceReferenceDeadline) {
  const { versionId } = identity(version);
  const auth = await context(budget);
  const lookup = () => budget.wait(readSourceReferenceReview({ versionId, confirmationKey: input.idempotencyKey }, { signal: budget.signal }));
  const receiptReview = await lookup();
  assertWriter(auth);
  if (!hasMatchingReceipt(receiptReview, auth, input)) {
    try {
      const review = await budget.wait(readSourceReferenceReview({ versionId, copyId: input.copyId }, { signal: budget.signal }));
      if (selected(review).sha256 !== input.reviewedSha256) throw sourceReferenceError("SOURCE_REVIEW_STALE");
      await conservedPdf(auth, review, "confirm", budget);
    } catch (error) {
      const failure = normalizeSourceReferenceError(error, true);
      // A concurrent identical request may have committed while its file became
      // unavailable. Recover the exact receipt once; never turn failed reads into absence.
      if (!["SOURCE_REVIEW_SOURCE_UNAVAILABLE", "SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE"].includes(failure.code)) throw failure;
      budget.check();
      if (!hasMatchingReceipt(await lookup(), auth, input)) throw failure;
    }
  }
  budget.check();
  const response = await budget.wait(createServiceRoleClient().rpc("confirm_estimate_source_reference", {
    p_actor_user_id: auth.userId, p_version_id: versionId, p_copy_id: input.copyId,
    p_expected_review_revision: input.expectedRevision, p_idempotency_key: input.idempotencyKey,
    p_reviewed_sha256: input.reviewedSha256, p_reason: input.reason,
  }).abortSignal(budget.signal));
  if (response.error) throw mapSourceReferenceRpcError(response.error);
  const raw = rpcConfirmationSchema.safeParse(response.data);
  if (!raw.success) throw sourceReferenceError("INTERNAL_ERROR");
  const value = raw.data;
  const result = sourceReferenceConfirmationResultSchema.safeParse({
    activation: { id: value.activation.id, copyId: value.activation.copy_id, revision: value.activation.revision },
    currentRevision: value.current_revision, currentCopyId: value.current_copy_id, replayed: value.replayed,
  });
  if (!result.success || result.data.activation.copyId !== input.copyId || result.data.activation.revision !== input.expectedRevision + 1) throw sourceReferenceError("INTERNAL_ERROR");
  budget.check();
  return result.data;
}
