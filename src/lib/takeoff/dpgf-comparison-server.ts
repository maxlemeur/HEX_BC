import "server-only";

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import type { TakeoffDpgfComparisonQuery } from "@/lib/takeoff/schemas";
import type { TakeoffDpgfComparisonResponse, TakeoffDpgfComparisonSummary } from "@/lib/takeoff/types";
import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import {
  loadTakeoffDpgfComparisonContext,
  type TakeoffDpgfComparisonContext,
} from "@/lib/takeoff/dpgf-comparison-context-server";
import {
  buildTakeoffDpgfComparison,
  TAKEOFF_DPGF_COMPARE_DEFAULT_PAGE_SIZE,
  TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE,
} from "@/lib/takeoff/dpgf-compare";
import { hydrateTakeoffDpgfComparisonSummary } from "@/lib/takeoff/dpgf-comparison-preparation";
import { buildSupplierPriceEvidenceByEstimateItemId, syncAndHydrateTakeoffLineProofs } from "@/lib/takeoff/line-evidence-server";

type HydrationContext = TakeoffDpgfComparisonContext & {
  supplierPriceByEstimateItemId: Awaited<ReturnType<typeof buildSupplierPriceEvidenceByEstimateItemId>>;
};

async function addSupplierPriceEvidence(context: TakeoffDpgfComparisonContext): Promise<HydrationContext> {
  return {
    ...context,
    supplierPriceByEstimateItemId: await buildSupplierPriceEvidenceByEstimateItemId({
      supabase: context.supabase,
      tenantId: context.tenantId,
      estimateItems: context.estimateItems,
    }),
  };
}

async function buildAndHydrateTakeoffDpgfComparison(
  context: HydrationContext,
  input: TakeoffDpgfComparisonQuery
): Promise<TakeoffDpgfComparisonResponse> {
  const comparison = buildTakeoffDpgfComparison({
    ...context.comparisonInput,
    threshold: input.threshold,
    cursor: input.cursor ?? null,
    pageSize: input.page_size ?? TAKEOFF_DPGF_COMPARE_DEFAULT_PAGE_SIZE,
    view: input.view,
  });
  const hydratedRows = await syncAndHydrateTakeoffLineProofs({
    supabase: context.supabase,
    tenantId: context.tenantId,
    userId: context.userId,
    projectId: context.projectId,
    versionId: context.comparisonInput.versionId,
    jobId: context.comparisonInput.jobId,
    rows: comparison.rows,
    supplierPriceByEstimateItemId: context.supplierPriceByEstimateItemId,
  });
  return hydrateTakeoffDpgfComparisonSummary(comparison, hydratedRows);
}

export async function fetchDpgfTakeoffComparisonForContext(
  context: TakeoffDpgfComparisonContext,
  input: TakeoffDpgfComparisonQuery
): Promise<TakeoffDpgfComparisonResponse> {
  return buildAndHydrateTakeoffDpgfComparison(await addSupplierPriceEvidence(context), input);
}

export async function fetchDpgfTakeoffComparison(
  jobId: string,
  input: TakeoffDpgfComparisonQuery
): Promise<TakeoffDpgfComparisonResponse> {
  const context = await loadTakeoffDpgfComparisonContext({ jobId, versionId: input.version_id });
  return fetchDpgfTakeoffComparisonForContext(context, input);
}

export async function fetchAllTakeoffDpgfComparisonRows(input: {
  context: TakeoffDpgfComparisonContext;
  threshold?: number;
}) {
  // Keep the authorized source snapshot within this request. Reloading all sources
  // for every 200-line page makes the radar quadratic in database reads.
  const context = await addSupplierPriceEvidence(input.context);
  const { jobId, versionId } = context.comparisonInput;
  const rows: TakeoffDpgfComparisonResponse["rows"] = [];
  let cursor: string | undefined;
  let response: TakeoffDpgfComparisonResponse | null = null;
  const seenCursors = new Set<string>();

  while (true) {
    response = await buildAndHydrateTakeoffDpgfComparison(context, {
      version_id: versionId,
      cursor,
      page_size: TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE,
      view: "all",
      threshold: input.threshold,
    });
    rows.push(...response.rows);

    const nextCursor = response.pagination.next_cursor;
    if (!nextCursor) {
      break;
    }

    if (seenCursors.has(nextCursor)) {
      throw new TakeoffError({
        status: 500,
        code: TakeoffErrorCode.INTERNAL_ERROR,
        message: "Pagination incoherente pendant le recalcul du radar de risque.",
        details: {
          job_id: jobId,
          version_id: versionId,
          cursor: nextCursor,
        },
        retryable: false,
        jobId: jobId,
      });
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  if (!response) {
    throw new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "Impossible de recalculer la comparaison DPGF complète.",
      details: {
        job_id: jobId,
        version_id: versionId,
      },
      retryable: false,
      jobId: jobId,
    });
  }

  return {
    ...response,
    rows,
    pagination: {
      ...response.pagination,
      next_cursor: null,
      total: rows.length,
    },
  };
}

export async function fetchTakeoffDpgfSummaryForHub(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
  versionId: string;
  projectId: string;
}): Promise<TakeoffDpgfComparisonSummary> {
  const context = await loadTakeoffDpgfComparisonContext({
    auth: input,
    jobId: input.jobId,
    versionId: input.versionId,
    projectId: input.projectId,
  });
  return buildTakeoffDpgfComparison({
    ...context.comparisonInput,
    pageSize: 1,
  }).summary;
}
