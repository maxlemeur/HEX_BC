import "server-only";

import { z } from "zod";

import {
  getAuthenticatedTakeoffContext,
  listAllTakeoffItemsByJobId,
  type AuthenticatedTakeoffContext,
} from "@/lib/takeoff/job-read-server";
import {
  assertTakeoffJobAccessibleForVersion,
  getEstimateVersionProjectIdOrThrow,
} from "@/lib/takeoff/version-access-server";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  listTakeoffDpgfEstimateItems,
  listTakeoffDpgfManualLinks,
  listTakeoffDpgfReviewDecisions,
  resolveDpgfUnitByRowIndex,
  readDpgfMappedFacts,
} from "@/lib/takeoff/dpgf-comparison-repository";
import {
  normalizeDpgfComparisonEstimateItems,
  legacyMappedRowId,
  normalizeTakeoffComparisonItems,
} from "@/lib/takeoff/dpgf-comparison-preparation";

import { loadDpgfDecisionAncestors, resolveDpgfDecisionLineage } from "@/lib/takeoff/dpgf-decision-lineage-server";
import { loadDpgfTargetCompositions } from "@/lib/takeoff/dpgf-composition-server";
import { readTakeoffJobPagesAlreadyInEstimate } from "@/lib/takeoff/page-contributions-server";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

export type TakeoffDpgfComparisonAuth = Pick<
  AuthenticatedTakeoffContext,
  "supabase" | "tenantId"
> & { userId?: string | null };

/** Load one authorized snapshot. Callers retain it only for their current request. */
export async function loadTakeoffDpgfComparisonContext(input: {
  jobId: string;
  versionId: string;
  auth?: TakeoffDpgfComparisonAuth;
  projectId?: string;
  estimateItemIds?: string[];
}) {
  const { supabase, tenantId, userId = null } =
    input.auth ?? (await getAuthenticatedTakeoffContext());
  const jobId = parseWithSchema(
    takeoffJobIdSchema,
    input.jobId,
    "Identifiant job invalide."
  );
  const versionId = parseWithSchema(
    z.string().uuid("version_id invalide."),
    input.versionId,
    "version_id invalide."
  );
  const accessibleJob = await assertTakeoffJobAccessibleForVersion({
    supabase,
    tenantId,
    versionId,
    jobId,
  });
  const linkedFromVersionId = accessibleJob.linked_from_version_id;
  const [takeoffItems, allEstimateItems, manualLinks, storedDecisions, projectId] =
    await Promise.all([
      listAllTakeoffItemsByJobId({ supabase, tenantId, jobId }),
      listTakeoffDpgfEstimateItems({ supabase, tenantId, versionId }),
      listTakeoffDpgfManualLinks({ supabase, tenantId, versionId, jobId }),
      listTakeoffDpgfReviewDecisions({ supabase, tenantId, versionId, jobId }),
      input.projectId ?? getEstimateVersionProjectIdOrThrow({ supabase, tenantId, versionId }),
    ]);

  // Validate the selected lines before resolving their documentary provenance.
  const selectedIds = input.estimateItemIds ? new Set(input.estimateItemIds) : null;
  const estimateItems = selectedIds
    ? allEstimateItems.filter((item) => selectedIds.has(item.id))
    : allEstimateItems;
  const assertSelectedLinesExist = (presentIds: Set<string>) => {
    const missingId = selectedIds
      ? [...selectedIds].find((id) => !presentIds.has(id))
      : undefined;
    if (missingId) {
      throw new TakeoffError({
        status: 404,
        code: TakeoffErrorCode.NOT_FOUND,
        message: "Ligne DPGF introuvable.",
        details: { estimate_item_id: missingId },
        retryable: false,
        jobId,
      });
    }
  };
  assertSelectedLinesExist(new Set(estimateItems.map((item) => item.id)));
  // Match against the entire version even when refreshing a single line's
  // evidence: a second row can own the same takeoff candidate or source page.
  const ancestors = await loadDpgfDecisionAncestors({
    supabase, tenantId, projectId, jobId, versionId, linkedFromVersionId, currentDecisions: storedDecisions,
  });
  const documentaryItems = [...allEstimateItems, ...[...ancestors.values()].flatMap(version => version.items)];
  const legacyFiles = new Set(documentaryItems.filter(item => item.source_provider === "dpgf" &&
    item.source_metadata?.dpgf_source_unit === undefined && !legacyMappedRowId(item) &&
    item.source_page !== null && !item.source_file_name?.toLowerCase().endsWith(".pdf"))
    .map(item => item.source_file_name));
  const legacyUnits = new Map<string | null, Map<number, string | null>>();
  for (const sourceFileName of legacyFiles) {
    legacyUnits.set(sourceFileName, await resolveDpgfUnitByRowIndex({ supabase, tenantId, projectId, sourceFileName }));
  }
  const mappedIds = documentaryItems.map(legacyMappedRowId).filter((id): id is string => id !== null);
  const mappedFacts = await readDpgfMappedFacts({ supabase, tenantId, projectId, mappedIds });
  const dpgfLines = normalizeDpgfComparisonEstimateItems({ rows: allEstimateItems, legacyUnits, mappedFacts });
  assertSelectedLinesExist(new Set(dpgfLines.map((line) => line.estimate_item_id)));
  const versions = new Map([...ancestors].map(([id, ancestor]) => [id, {
    lines: normalizeDpgfComparisonEstimateItems({ rows: ancestor.items, legacyUnits, mappedFacts }),
    decisions: ancestor.decisions,
  }]));
  versions.set(versionId, { lines: dpgfLines, decisions: storedDecisions });
  const { reviewDecisions, carriedReviewDecisions } = resolveDpgfDecisionLineage({
    versions, versionId, linkedFromVersionId,
    linkedFromVersionNumber: accessibleJob.linked_from_version_number ?? null,
  });
  // TI-682 D4: what each DPGF target holds of the takeoffs applied, the earlier lines on pages this takeoff reads again,
  // and the duplicates the zone rules found between this takeoff's lines and others.
  const compositions = await loadDpgfTargetCompositions({ supabase, tenantId }, allEstimateItems
    .filter((item) => item.item_type === "line" && item.source_provider === "dpgf")
    .map((item) => ({ id: item.id, updated_at: item.updated_at, source_metadata: item.source_metadata ?? null })));
  // Only a target that keeps another takeoff's measure has pages this takeoff may read again.
  const fedByAnother = [...compositions.targets.values()].some((target) => target.contributions.some((part) => part.job_id !== jobId));
  const readAgainItemIds = new Set(fedByAnother
    ? (await readTakeoffJobPagesAlreadyInEstimate({ supabase, tenantId }, jobId, versionId)).pages
      .flatMap((page) => page.earlier.flatMap((earlier) => earlier.takeoff_item_ids))
    : []);
  const overlapPartners = new Map(takeoffItems.map((item) => [item.id, ((item.rule_results ?? []) as TakeoffRuleResult[])
    .filter((result) => result.status === "fail" && result.code === "ZONE_OVERLAP_DUPLICATE")
    .flatMap((result) => result.details?.partners ?? [])
    .map((partner) => ({ item_id: partner.item_id, job_id: partner.job_id, overlap_m: partner.overlap_m, resolved: partner.resolved }))]));

  return {
    supabase,
    tenantId,
    userId,
    projectId,
    estimateItems,
    takeoffItems,
    compositions,
    comparisonInput: {
      versionId,
      jobId,
      dpgfLines,
      takeoffLines: normalizeTakeoffComparisonItems(takeoffItems),
      manualLinks,
      reviewDecisions,
      carriedReviewDecisions,
      dpgfCompositions: compositions,
      readAgainItemIds,
      overlapPartners,
    },
  };
}

export type TakeoffDpgfComparisonContext = Awaited<
  ReturnType<typeof loadTakeoffDpgfComparisonContext>
>;
