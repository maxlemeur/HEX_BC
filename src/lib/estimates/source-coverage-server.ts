import "server-only";

import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { getAuthenticatedTenantContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { type SupabaseErrorLike } from "@/lib/estimates/errors";
import {
  coverageCanonicalRequestSchema, coverageCitationVerificationSchema,
  coverageDecisionMutationSchema, coverageDimensionMutationSchema,
  coverageMutationResultSchema, coveragePreviewSchema, coverageQuerySchema,
  coverageRequirementMutationSchema, coverageTargetsQuerySchema, coverageTargetsSchema,
  coverageWorkspaceSchema, type CoverageCitationVerification, type CoverageDecisionMutation,
  type CoverageDimensionMutation, type CoverageReceipt, type CoverageRequirementMutation,
  type CoverageWorkspace,
} from "@/lib/estimates/source-coverage-contracts";
import { coverageError, mapCoverageRpcError, normalizeCoverageError } from "@/lib/estimates/source-coverage-http";
import { type SourceReferenceDeadline } from "@/lib/estimates/source-reference-http";
import { readSourceReferenceContent } from "@/lib/estimates/source-reference-orchestration";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type CanonicalRequest = z.infer<typeof coverageCanonicalRequestSchema>;
type RpcResponse = { data: unknown; error: SupabaseErrorLike | null };
type RpcRequest = PromiseLike<RpcResponse> & { abortSignal(signal: AbortSignal): PromiseLike<RpcResponse> };
type ReadOptions = { signal?: AbortSignal };

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw coverageError("SOURCE_COVERAGE_INVALID_INPUT");
  return parsed.data;
}
function identity(value: string) { return parse(z.string().uuid(), value).toLowerCase(); }
async function rpc<T extends z.ZodType>(request: RpcRequest, schema: T, signal: AbortSignal): Promise<z.output<T>> {
  signal.throwIfAborted();
  const { data, error } = await request.abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw mapCoverageRpcError(error);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw coverageError("INTERNAL_ERROR");
  return parsed.data;
}
async function readWithContext(auth: AuthenticatedTenantContext, versionId: string, input: z.output<typeof coverageQuerySchema>, signal: AbortSignal): Promise<CoverageWorkspace> {
  const review = await rpc(auth.supabase.rpc("get_estimate_source_coverage", {
    p_version_id: versionId, p_requirement_id: input.requirementId ?? null,
    p_after_id: input.afterId ?? null, p_limit: input.limit,
    p_before_event: input.beforeEvent ?? null, p_operation_key: input.operationKey ?? null,
  }), coverageWorkspaceSchema, signal);
  if (review.versionId !== versionId || (review.selectedRequirement?.id ?? undefined) !== input.requirementId ||
      (review.receipt && (review.receipt.canonicalRequest.versionId !== versionId ||
        review.receipt.canonicalRequest.actorId !== auth.userId || review.receipt.canonicalRequest.request.operationKey !== input.operationKey))) {
    throw coverageError("INTERNAL_ERROR");
  }
  if (review.requirements.length > input.limit ||
      review.requirements.some((item, index) => (input.afterId !== undefined && item.id <= input.afterId) || (index > 0 && item.id <= review.requirements[index - 1].id)) ||
      (review.nextAfterId !== null && review.nextAfterId !== review.requirements.at(-1)?.id) ||
      review.history.some((event) => input.beforeEvent !== undefined && event.sequence >= input.beforeEvent) ||
      (review.nextBeforeEvent !== null && review.nextBeforeEvent !== review.history.at(-1)?.sequence)) throw coverageError("INTERNAL_ERROR");
  return review;
}

export async function readSourceCoverage(version: string, query: z.input<typeof coverageQuerySchema> = {}, options: ReadOptions = {}) {
  const versionId = identity(version), input = parse(coverageQuerySchema, query);
  const signal = options.signal ?? AbortSignal.timeout(15_000);
  signal.throwIfAborted();
  const auth = await getAuthenticatedTenantContext();
  return readWithContext(auth, versionId, input, signal);
}

export async function readSourceCoverageTargets(version: string, query: z.input<typeof coverageTargetsQuerySchema>, options: ReadOptions = {}) {
  const versionId = identity(version), input = parse(coverageTargetsQuerySchema, query);
  const signal = options.signal ?? AbortSignal.timeout(15_000);
  signal.throwIfAborted();
  const auth = await getAuthenticatedTenantContext();
  return rpc(auth.supabase.rpc("get_estimate_source_coverage_targets", {
    p_version_id: versionId, p_kind: input.kind, p_search: input.search,
    p_after_id: input.afterId ?? null, p_limit: input.limit,
  }), coverageTargetsSchema, signal);
}

export async function previewSourceCoverageDecision(version: string, requirement: string, options: ReadOptions = {}) {
  const versionId = identity(version), requirementId = identity(requirement);
  const signal = options.signal ?? AbortSignal.timeout(15_000);
  signal.throwIfAborted();
  const auth = await getAuthenticatedTenantContext();
  const preview = await rpc(auth.supabase.rpc("preview_estimate_source_coverage_decision", {
    p_version_id: versionId, p_requirement_id: requirementId,
  }), coveragePreviewSchema, signal);
  if (preview.requirementId !== requirementId) throw coverageError("INTERNAL_ERROR");
  return preview;
}

function assertReceipt(receipt: CoverageReceipt, canonical: CanonicalRequest) {
  if (!isDeepStrictEqual(receipt.canonicalRequest, canonical)) throw coverageError("SOURCE_COVERAGE_IDEMPOTENCY_CONFLICT");
  const entityId = canonical.kind === "dimension" ? canonical.request.dimensionId : canonical.request.requirementId;
  if (receipt.entityId !== entityId) throw coverageError("INTERNAL_ERROR");
}
async function mutationResult(request: RpcRequest, canonical: CanonicalRequest, budget: SourceReferenceDeadline) {
  const result = await rpc(request, coverageMutationResultSchema, budget.signal);
  assertReceipt(result.receipt, canonical);
  if (result.currentRevision < result.receipt.entityRevision) throw coverageError("INTERNAL_ERROR");
  budget.check();
  return result;
}

export async function mutateSourceCoverageDimension(version: string, request: CoverageDimensionMutation, budget: SourceReferenceDeadline) {
  const versionId = identity(version), input = parse(coverageDimensionMutationSchema, request);
  const auth = await budget.wait(getAuthenticatedTenantContext());
  const canonical: CanonicalRequest = { versionId, actorId: auth.userId, kind: "dimension", request: input };
  return mutationResult(auth.supabase.rpc("mutate_estimate_source_coverage_dimension", {
    p_version_id: versionId, p_dimension_id: input.dimensionId, p_expected_revision: input.expectedRevision,
    p_operation_key: input.operationKey, p_operation: input.operation,
    p_payload: input.operation === "archive" ? { reason: input.reason } : input.payload,
  }), canonical, budget);
}

export async function mutateSourceCoverageRequirement(version: string, request: CoverageRequirementMutation, budget: SourceReferenceDeadline) {
  const versionId = identity(version), input = parse(coverageRequirementMutationSchema, request);
  const auth = await budget.wait(getAuthenticatedTenantContext());
  const canonical: CanonicalRequest = { versionId, actorId: auth.userId, kind: "requirement", request: input };
  return mutationResult(auth.supabase.rpc("mutate_estimate_source_requirement", {
    p_version_id: versionId, p_requirement_id: input.requirementId, p_expected_revision: input.expectedRevision,
    p_expected_reference_revision: input.expectedReferenceRevision, p_operation_key: input.operationKey,
    p_operation: input.operation, p_payload: "payload" in input ? input.payload : { reason: input.reason },
  }), canonical, budget);
}

async function prepareVerifiedMutation(version: string, canonicalRequest: CoverageCitationVerification | CoverageDecisionMutation, kind: "citation" | "decision", budget: SourceReferenceDeadline) {
  const versionId = identity(version);
  const auth = await budget.wait(getAuthenticatedTenantContext());
  const canonical = parse(coverageCanonicalRequestSchema, { versionId, actorId: auth.userId, kind, request: canonicalRequest });
  const lookup = () => readWithContext(auth, versionId, {
    requirementId: canonicalRequest.requirementId, operationKey: canonicalRequest.operationKey, limit: 20,
  }, budget.signal);
  const workspace = await lookup();
  // Authorization is established before creating a privileged client. SQL
  // rechecks the actor and dependencies under locks at the actual commit.
  if (!["admin", "engineer"].includes(auth.tenantRole)) throw coverageError("SOURCE_COVERAGE_WRITE_FORBIDDEN");
  if (workspace.receipt) {
    assertReceipt(workspace.receipt, canonical);
    return { auth, canonical, versionId };
  }
  if (!workspace.canWrite) throw coverageError("SOURCE_COVERAGE_WRITE_FORBIDDEN");
  if (workspace.referenceRevision !== canonicalRequest.expectedReferenceRevision ||
      workspace.selectedRequirement?.revision !== canonicalRequest.expectedRequirementRevision) throw coverageError("SOURCE_COVERAGE_STALE");
  const copyId = workspace.activeCopyId;
  if (!copyId) throw coverageError("SOURCE_COVERAGE_SOURCE_UNAVAILABLE");
  if (kind === "citation") {
    const input = canonicalRequest as CoverageCitationVerification;
    const citation = workspace.selectedRequirement?.citations.find((entry) => entry.id === input.citationId);
    if (!citation || citation.copyId !== copyId) throw coverageError("SOURCE_COVERAGE_CITATION_NOT_VERIFIED");
  }
  try {
    // Await termination of the real parser worker. Do not race this whole
    // promise against a timer; it already observes the shared deadline signal.
    const pdf = await readSourceReferenceContent(versionId, copyId, budget);
    if (kind === "citation") {
      const input = canonicalRequest as CoverageCitationVerification;
      const citation = workspace.selectedRequirement!.citations.find((entry) => entry.id === input.citationId)!;
      if (pdf.copy.sha256 !== input.reviewedSha256 || citation.page > pdf.copy.pageCount) throw coverageError("SOURCE_COVERAGE_STALE");
    }
    budget.check();
  } catch (error) {
    const failure = normalizeCoverageError(error);
    if (["SOURCE_COVERAGE_SOURCE_UNAVAILABLE", "SOURCE_COVERAGE_TEMPORARILY_UNAVAILABLE"].includes(failure.code) && !budget.signal.aborted) {
      const after = await lookup();
      if (after.receipt) {
        assertReceipt(after.receipt, canonical);
        return { auth, canonical, versionId };
      }
    }
    throw failure;
  }
  return { auth, canonical, versionId };
}

export async function verifySourceCoverageCitation(version: string, request: CoverageCitationVerification, budget: SourceReferenceDeadline) {
  const input = parse(coverageCitationVerificationSchema, request);
  const { auth, canonical, versionId } = await prepareVerifiedMutation(version, input, "citation", budget);
  budget.check();
  return mutationResult(createServiceRoleClient().rpc("verify_estimate_source_requirement_citation", {
    p_actor_user_id: auth.userId, p_version_id: versionId, p_requirement_id: input.requirementId,
    p_citation_id: input.citationId, p_expected_requirement_revision: input.expectedRequirementRevision,
    p_expected_reference_revision: input.expectedReferenceRevision, p_reviewed_sha256: input.reviewedSha256,
    p_operation_key: input.operationKey,
  }), canonical, budget);
}

export async function decideSourceCoverageRequirement(version: string, request: CoverageDecisionMutation, budget: SourceReferenceDeadline) {
  const input = parse(coverageDecisionMutationSchema, request);
  const { auth, canonical, versionId } = await prepareVerifiedMutation(version, input, "decision", budget);
  budget.check();
  return mutationResult(createServiceRoleClient().rpc("decide_estimate_source_requirement", {
    p_actor_user_id: auth.userId, p_version_id: versionId, p_requirement_id: input.requirementId,
    p_expected_requirement_revision: input.expectedRequirementRevision,
    p_expected_reference_revision: input.expectedReferenceRevision,
    p_expected_content_revision: input.expectedContentRevision, p_reviewed_fingerprint: input.reviewedFingerprint,
    p_operation_key: input.operationKey, p_decision: input.decision,
  }), canonical, budget);
}
