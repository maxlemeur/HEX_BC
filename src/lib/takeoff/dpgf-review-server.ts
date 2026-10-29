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
  getEstimateVersionProjectIdOrThrow,
} from "@/lib/takeoff/version-access-server";
import { resolveDpgfUnitByRowIndex } from "@/lib/takeoff/dpgf-comparison-repository";
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
  const projectId = await getEstimateVersionProjectIdOrThrow({
    supabase,
    tenantId,
    versionId: payload.version_id,
  });
  const unitByRowIndex = typeof estimateItem.source_page === "number"
    ? await resolveDpgfUnitByRowIndex({
        supabase,
        tenantId,
        projectId,
        sourceFileName: estimateItem.source_file_name,
      })
    : new Map<number, string | null>();
  const reviewReference = buildTakeoffDpgfReviewTargetReference({ estimateItem, unitByRowIndex });
  const decisionTimestamp = new Date().toISOString();
  const linkedFromVersionId = accessibleJob.linked_from_version_id;
  const sourceDecision = !existingDecision && linkedFromVersionId
    ? await loadTakeoffDpgfSourceDecision({
        supabase,
        tenantId,
        jobId: normalizedJobId,
        sourceVersionId: linkedFromVersionId,
        reviewReference,
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
