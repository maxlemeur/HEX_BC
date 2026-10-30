import { cache } from "react";

import { ESTIMATE_READINESS_CATEGORY_ORDER } from "@/lib/estimates/readiness";
import { getEstimateSendGating } from "@/lib/estimates/server";
import { getEstimatePurchaseOrderReadinessCounts } from "@/lib/estimates/purchase-order-drafts";
import {
  buildPurchaseOrderReadiness,
  type PurchaseOrderReadiness,
} from "@/lib/estimates/purchase-order-readiness";

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
  readyToOrder: PurchaseOrderReadiness;
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

async function computeAffaireOrderReadiness(versionId: string) {
  const summary = await getEstimatePurchaseOrderReadinessCounts(versionId);
  return buildPurchaseOrderReadiness({
    totalSupplierLines: summary.total_supplier_lines,
    draftableLines: summary.draftable_lines,
    transferredLines: summary.transferred_lines,
    blockedLines: summary.blocked_lines,
  });
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

    const readyToOrder: PurchaseOrderReadiness =
      orderResult.status === "fulfilled"
        ? orderResult.value
        : {
            status: "unavailable" as const,
            counts: null,
            errorMessage: "Préparation indisponible. Rechargez pour vérifier les lignes.",
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
