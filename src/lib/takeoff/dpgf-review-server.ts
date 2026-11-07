import "server-only";

import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import {
  assertTakeoffOperatorActionRole,
  parseWithSchema,
} from "@/lib/takeoff/server-helpers";
import {
  saveTakeoffDpgfManualLinkSchema,
  saveTakeoffReviewDecisionSchema,
  takeoffJobIdSchema,
} from "@/lib/takeoff/schemas";
import {
  assertTakeoffJobAccessibleForVersion,
} from "@/lib/takeoff/version-access-server";
import { computeTakeoffDpgfRows } from "@/lib/takeoff/dpgf-compare";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { canRetainDpgfQuantity } from "@/lib/takeoff/dpgf-review-guards";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { normalizeTakeoffDpgfManualLinkRows } from "@/lib/takeoff/dpgf-comparison-preparation";
import { refreshTakeoffLineEvidenceSnapshot } from "@/lib/takeoff/line-evidence-server";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import {
  buildTakeoffDpgfManualLinkPlan,
  buildTakeoffDpgfReviewDecisionPlan,
  buildTakeoffDpgfReviewTargetReference,
  getUniqueTakeoffDpgfManualLinkItemIds,
} from "@/lib/takeoff/dpgf-review-preparation";
import {
  loadTakeoffDpgfManualLinkTargets,
  loadTakeoffDpgfReviewDecisionTarget,
  loadTakeoffDpgfSourceDecision,
  saveTakeoffDpgfManualLinkPlan,
  saveTakeoffDpgfReviewDecisionPlan,
} from "@/lib/takeoff/dpgf-review-repository";
import type {
  SaveTakeoffDpgfManualLinkInput,
  SaveTakeoffDpgfManualLinkResponse,
  SaveTakeoffReviewDecisionInput,
  SaveTakeoffReviewDecisionResponse,
} from "@/lib/takeoff/types";

export async function saveTakeoffDpgfManualLink(
  jobId: string,
  input: SaveTakeoffDpgfManualLinkInput
): Promise<SaveTakeoffDpgfManualLinkResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const normalizedJobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const payload = parseWithSchema(
    saveTakeoffDpgfManualLinkSchema,
    input,
    "Payload de lien manuel DPGF invalide."
  );
  const scope = {
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
    estimateItemId: payload.estimate_item_id,
  };
  await assertTakeoffJobAccessibleForVersion(scope);
  const takeoffItems = await loadTakeoffDpgfManualLinkTargets({
    ...scope,
    takeoffItemIds: getUniqueTakeoffDpgfManualLinkItemIds(payload.takeoff_item_ids),
  });
  const plan = buildTakeoffDpgfManualLinkPlan({
    jobId: normalizedJobId,
    userId,
    payload,
    takeoffItems,
  });
  const rows = await saveTakeoffDpgfManualLinkPlan({ ...scope, plan });
  await refreshTakeoffLineEvidenceSnapshot({
    supabase,
    tenantId,
    userId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
    estimateItemIds: [payload.estimate_item_id],
  });
  return { links: normalizeTakeoffDpgfManualLinkRows(rows) };
}

export async function saveTakeoffReviewDecision(
  jobId: string,
  input: SaveTakeoffReviewDecisionInput
): Promise<SaveTakeoffReviewDecisionResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const normalizedJobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const payload = parseWithSchema(
    saveTakeoffReviewDecisionSchema,
    input,
    "Payload de décision DPGF invalide."
  );
  const scope = {
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
    estimateItemId: payload.estimate_item_id,
  };
  const accessibleJob = await assertTakeoffJobAccessibleForVersion(scope);
  const { estimateItem, existingDecision } = await loadTakeoffDpgfReviewDecisionTarget(scope);
  const context = await loadTakeoffDpgfComparisonContext({ jobId: normalizedJobId, versionId: scope.versionId,
    auth: { supabase, tenantId, userId } });
  const row = computeTakeoffDpgfRows(context.comparisonInput).rows.find(item => item.line_id === scope.estimateItemId);
  if (!row || !canRetainDpgfQuantity(payload.decision, row.dpgf_quantity, row.takeoff_quantity)) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "La quantité à retenir est indisponible. Vérifiez la ligne avant de décider.", jobId: normalizedJobId });
  }
  const reviewReference = buildTakeoffDpgfReviewTargetReference({ estimateItem, unit: row.dpgf.unit });
  const decisionTimestamp = new Date().toISOString();
  const linkedFromVersionId = accessibleJob.linked_from_version_id;
  const sameDecisionLine = row.applied_decision?.version_id === scope.versionId;
  const sourceDecision = !sameDecisionLine && linkedFromVersionId && row.applied_decision?.source === "carried_over"
    ? await loadTakeoffDpgfSourceDecision({
        supabase,
        tenantId,
        jobId: normalizedJobId,
        sourceVersionId: linkedFromVersionId,
        sourceEstimateItemId: row.applied_decision.estimate_item_id,
        reviewReference: row.applied_decision.review_reference,
      })
    : null;
  const plan = buildTakeoffDpgfReviewDecisionPlan({
    tenantId,
    userId,
    jobId: normalizedJobId,
    payload,
    estimateItem,
    reviewReference,
    decisionTimestamp,
    existingDecision,
    sameDecisionLine,
    sourceDecision,
    linkedFromVersionId,
  });
  const decision = await saveTakeoffDpgfReviewDecisionPlan({
    supabase,
    tenantId,
    jobId: normalizedJobId,
    plan,
  });
  await logTakeoffAuditEvent({
    supabase,
    tenantId,
    userId,
    jobId: normalizedJobId,
    estimateVersionId: payload.version_id,
    action: "takeoff.dpgf.review_decision",
    metadata: takeoffAuditMetadataBuilders["takeoff.dpgf.review_decision"](plan.auditMetadata),
    tableName: "takeoff_dpgf_review_decisions",
    mode: "non-blocking",
  });
  await refreshTakeoffLineEvidenceSnapshot({
    supabase,
    tenantId,
    userId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
    estimateItemIds: [payload.estimate_item_id],
  });
  return { decision };
}
