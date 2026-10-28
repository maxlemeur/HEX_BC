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
} from "@/lib/takeoff/dpgf-comparison-repository";
import {
  carryTakeoffDpgfReviewDecisions,
  normalizeDpgfComparisonEstimateItems,
  normalizeTakeoffComparisonItems,
} from "@/lib/takeoff/dpgf-comparison-preparation";

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
  const carriedReviewDecisionsPromise = linkedFromVersionId
    ? listTakeoffDpgfReviewDecisions({
        supabase,
        tenantId,
        versionId: linkedFromVersionId,
        jobId,
      }).then((decisions) =>
        carryTakeoffDpgfReviewDecisions({
          decisions,
          linkedFromVersionId,
          linkedFromVersionNumber: accessibleJob.linked_from_version_number ?? null,
        })
      )
    : Promise.resolve([]);

  const [takeoffItems, allEstimateItems, manualLinks, reviewDecisions, carriedReviewDecisions, projectId] =
    await Promise.all([
      listAllTakeoffItemsByJobId({ supabase, tenantId, jobId }),
      listTakeoffDpgfEstimateItems({ supabase, tenantId, versionId }),
      listTakeoffDpgfManualLinks({ supabase, tenantId, versionId, jobId }),
      listTakeoffDpgfReviewDecisions({ supabase, tenantId, versionId, jobId }),
      carriedReviewDecisionsPromise,
      input.projectId ?? getEstimateVersionProjectIdOrThrow({ supabase, tenantId, versionId }),
    ]);

  // A line panel must resolve its own source file, even if another DPGF file
  // appears first in the version. Validate the selection before reading its import.
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
  const dominantSourceFileName =
    estimateItems.find((item) => item.source_file_name)?.source_file_name ?? null;
  const unitByRowIndex = estimateItems.length > 0
    ? await resolveDpgfUnitByRowIndex({
        supabase,
        tenantId,
        projectId,
        sourceFileName: dominantSourceFileName,
      })
    : new Map<number, string | null>();
  const dpgfLines = normalizeDpgfComparisonEstimateItems({ rows: estimateItems, unitByRowIndex });
  assertSelectedLinesExist(new Set(dpgfLines.map((line) => line.estimate_item_id)));

  return {
    supabase,
    tenantId,
    userId,
    projectId,
    estimateItems,
    comparisonInput: {
      versionId,
      jobId,
      dpgfLines,
      takeoffLines: normalizeTakeoffComparisonItems(takeoffItems),
      manualLinks,
      reviewDecisions,
      carriedReviewDecisions,
    },
  };
}

export type TakeoffDpgfComparisonContext = Awaited<
  ReturnType<typeof loadTakeoffDpgfComparisonContext>
>;
