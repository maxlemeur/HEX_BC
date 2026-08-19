import { cache } from "react";

import { ESTIMATE_READINESS_CATEGORY_ORDER } from "@/lib/estimates/readiness";
import {
  getEstimateSendGating,
  getEstimateSupplierComparisons,
  listEstimateItems,
} from "@/lib/estimates/server";

type AffaireHubSendGating = Awaited<ReturnType<typeof getEstimateSendGating>>["gating"];
type AffaireHubSendGatingFlag = AffaireHubSendGating["blockingFlags"][number];

export type AffaireSubmissionReadinessStatus =
  | "blocked"
  | "warning"
  | "ready"
  | "unavailable";

export type AffaireSubmissionReadinessGroup = {
  category: (typeof ESTIMATE_READINESS_CATEGORY_ORDER)[number];
  blockers: AffaireHubSendGatingFlag[];
  alerts: AffaireHubSendGatingFlag[];
  blockerCount: number;
  alertCount: number;
};

export type AffaireSubmissionReadinessResult = {
  status: AffaireSubmissionReadinessStatus;
  blockers: AffaireHubSendGatingFlag[];
  alerts: AffaireHubSendGatingFlag[];
  groups: AffaireSubmissionReadinessGroup[];
  checkedAt: string | null;
  stalePriceDays: number | null;
  errorMessage: string | null;
};

export type AffaireHubFinishLineSummaryResult = {
  versionId: string;
  submissionReadiness?: AffaireSubmissionReadinessResult;
  readyToSend: {
    status: "ready" | "blocked" | "warning" | "waiting" | "unavailable";
    blockingFlags: AffaireHubSendGatingFlag[];
    warningFlags: AffaireHubSendGatingFlag[];
    checkedAt: string | null;
    stalePriceDays: number | null;
    errorMessage: string | null;
  };
  readyToOrder: {
    status: "ready" | "blocked" | "waiting" | "unavailable";
    orderableLinesCount: number;
    coveredLinesCount: number;
    ambiguousLinesCount: number;
    missingPriceLinesCount: number;
    staleLinesCount: number;
    errorMessage: string | null;
  };
};

export function buildAffaireSubmissionReadinessSnapshot(input: {
  blockingFlags: AffaireHubSendGatingFlag[];
  warningFlags: AffaireHubSendGatingFlag[];
  checkedAt: string | null;
  stalePriceDays: number | null;
  errorMessage: string | null;
}): AffaireSubmissionReadinessResult {
  const groups = ESTIMATE_READINESS_CATEGORY_ORDER.map((category) => {
    const blockers = input.blockingFlags.filter((flag) => flag.category === category);
    const alerts = input.warningFlags.filter((flag) => flag.category === category);
    return {
      category,
      blockers,
      alerts,
      blockerCount: blockers.length,
      alertCount: alerts.length,
    } satisfies AffaireSubmissionReadinessGroup;
  }).filter((group) => group.blockerCount > 0 || group.alertCount > 0);

  const status: AffaireSubmissionReadinessStatus =
    input.errorMessage
      ? "unavailable"
      : input.blockingFlags.length > 0
        ? "blocked"
        : input.warningFlags.length > 0
          ? "warning"
          : "ready";

  return {
    status,
    blockers: input.blockingFlags,
    alerts: input.warningFlags,
    groups,
    checkedAt: input.checkedAt,
    stalePriceDays: input.stalePriceDays,
    errorMessage: input.errorMessage,
  };
}

const SUPPLIER_COMPARISON_BATCH_SIZE = 200;

async function computeAffaireOrderReadiness(versionId: string) {
  const estimateItemsResult = await listEstimateItems(versionId);
  const orderableLineIds = estimateItemsResult.items
    .filter(
      (item) =>
        item.item_type === "line" &&
        (item.supply_type_id !== null || item.selected_supplier_price_id !== null)
    )
    .map((item) => item.id);

  if (orderableLineIds.length === 0) {
    return {
      status: "waiting" as const,
      orderableLinesCount: 0,
      coveredLinesCount: 0,
      ambiguousLinesCount: 0,
      missingPriceLinesCount: 0,
      staleLinesCount: 0,
      errorMessage: null,
    };
  }

  let coveredLinesCount = 0;
  let ambiguousLinesCount = 0;
  let missingPriceLinesCount = 0;
  let staleLinesCount = 0;

  for (
    let startIndex = 0;
    startIndex < orderableLineIds.length;
    startIndex += SUPPLIER_COMPARISON_BATCH_SIZE
  ) {
    const batchItemIds = orderableLineIds.slice(
      startIndex,
      startIndex + SUPPLIER_COMPARISON_BATCH_SIZE
    );
    const batch = await getEstimateSupplierComparisons(versionId, batchItemIds);
    coveredLinesCount += batch.coverage_summary.covered_items;
    ambiguousLinesCount += batch.coverage_summary.ambiguous_items;
    missingPriceLinesCount += batch.coverage_summary.no_price_items;
    staleLinesCount += batch.coverage_summary.stale_items;
  }

  const hasOrderBlockers =
    ambiguousLinesCount > 0 || missingPriceLinesCount > 0 || staleLinesCount > 0;

  return {
    status: hasOrderBlockers ? ("blocked" as const) : ("ready" as const),
    orderableLinesCount: orderableLineIds.length,
    coveredLinesCount,
    ambiguousLinesCount,
    missingPriceLinesCount,
    staleLinesCount,
    errorMessage: null,
  };
}

export const fetchAffaireHubFinishLineSummary = cache(
  async (versionId: string): Promise<AffaireHubFinishLineSummaryResult> => {
    const [sendResult, orderResult] = await Promise.allSettled([
      getEstimateSendGating(versionId),
      computeAffaireOrderReadiness(versionId),
    ]);

    const readyToSend =
      sendResult.status === "fulfilled"
        ? {
            status:
              sendResult.value.gating.blockingFlags.length > 0
                ? ("blocked" as const)
                : sendResult.value.gating.warningFlags.length > 0
                  ? ("warning" as const)
                  : ("ready" as const),
            blockingFlags: sendResult.value.gating.blockingFlags,
            warningFlags: sendResult.value.gating.warningFlags,
            checkedAt: sendResult.value.gating.checkedAt,
            stalePriceDays: sendResult.value.gating.stalePriceDays,
            errorMessage: null,
          }
        : {
            status: "unavailable" as const,
            blockingFlags: [],
            warningFlags: [],
            checkedAt: null,
            stalePriceDays: null,
            errorMessage: "Impossible de vérifier la sortie devis pour le moment.",
          };

    const readyToOrder =
      orderResult.status === "fulfilled"
        ? orderResult.value
        : {
            status: "unavailable" as const,
            orderableLinesCount: 0,
            coveredLinesCount: 0,
            ambiguousLinesCount: 0,
            missingPriceLinesCount: 0,
            staleLinesCount: 0,
            errorMessage: "Impossible d'evaluer la preparation commandes pour le moment.",
          };

    const submissionReadiness = buildAffaireSubmissionReadinessSnapshot({
      blockingFlags: readyToSend.blockingFlags,
      warningFlags: readyToSend.warningFlags,
      checkedAt: readyToSend.checkedAt,
      stalePriceDays: readyToSend.stalePriceDays,
      errorMessage: readyToSend.errorMessage,
    });

    return {
      versionId,
      submissionReadiness,
      readyToSend,
      readyToOrder,
    };
  }
);
