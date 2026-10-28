import { buildTakeoffDpgfReviewReference } from "@/lib/takeoff/dpgf-compare";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import type {
  SaveTakeoffDpgfManualLinkInput,
  SaveTakeoffReviewDecisionInput,
  TakeoffDpgfReviewDecision,
} from "@/lib/takeoff/types";

export type TakeoffDpgfReviewTarget = {
  id: string;
  tenant_id: string;
  version_id: string;
  item_type: "section" | "line";
  source_provider: string | null;
  source_file_name: string | null;
};

export type TakeoffDpgfReviewDecisionTarget = TakeoffDpgfReviewTarget & {
  source_page: number | null;
  position: number;
  title: string;
  description: string | null;
  quantity: number | null;
};

export type TakeoffDpgfManualLinkItem = {
  id: string;
  tenant_id: string;
  job_id: string;
};

export type TakeoffDpgfDecisionCarryOver = {
  carried_over_from_version_id: string | null;
  carried_over_at: string | null;
};

export type TakeoffDpgfExistingDecision = TakeoffDpgfDecisionCarryOver & {
  decision?: TakeoffDpgfReviewDecision | null;
  reason?: string | null;
};

export type TakeoffDpgfSourceDecision = TakeoffDpgfDecisionCarryOver & {
  updated_at: string | null;
};

export function requireTakeoffDpgfReviewTarget<T extends TakeoffDpgfReviewTarget>(input: {
  estimateItem: T | null;
  estimateItemId: string;
  versionId: string;
  jobId: string;
}): T {
  const estimateItem = input.estimateItem;
  if (!estimateItem) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Ligne DPGF introuvable.",
      details: { estimate_item_id: input.estimateItemId },
      retryable: false,
      jobId: input.jobId,
    });
  }
  if (estimateItem.version_id !== input.versionId) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La ligne DPGF n'appartient pas à la version cible.",
      details: {
        version_id: input.versionId,
        estimate_item_version_id: estimateItem.version_id,
      },
      retryable: false,
      jobId: input.jobId,
    });
  }
  if (
    estimateItem.item_type !== "line" ||
    (estimateItem.source_provider !== "dpgf" && estimateItem.source_file_name === null)
  ) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La ligne cible n'est pas une ligne DPGF eligible.",
      details: { estimate_item_id: input.estimateItemId },
      retryable: false,
      jobId: input.jobId,
    });
  }
  return estimateItem;
}

/** The public schema validates the raw 0–50 IDs before this stable deduplication. */
export function getUniqueTakeoffDpgfManualLinkItemIds(itemIds: string[]): string[] {
  return [...new Set(itemIds)];
}

export function buildTakeoffDpgfManualLinkPlan(input: {
  jobId: string;
  userId: string | null;
  payload: SaveTakeoffDpgfManualLinkInput;
  takeoffItems: TakeoffDpgfManualLinkItem[];
}) {
  const itemIds = getUniqueTakeoffDpgfManualLinkItemIds(input.payload.takeoff_item_ids);
  const takeoffItemById = new Map(input.takeoffItems.map((item) => [item.id, item]));
  const missingItemId = itemIds.find((id) => !takeoffItemById.has(id));
  if (missingItemId) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Un item takeoff est introuvable.",
      details: { takeoff_item_id: missingItemId },
      retryable: false,
      jobId: input.jobId,
    });
  }
  const mismatchedItem = input.takeoffItems.find((item) => item.job_id !== input.jobId);
  if (mismatchedItem) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Un item takeoff ne correspond pas au job cible.",
      details: {
        takeoff_item_id: mismatchedItem.id,
        takeoff_job_id: mismatchedItem.job_id,
        expected_job_id: input.jobId,
      },
      retryable: false,
      jobId: input.jobId,
    });
  }
  return {
    rpcArgs: {
      p_version_id: input.payload.version_id,
      p_takeoff_job_id: input.jobId,
      p_estimate_item_id: input.payload.estimate_item_id,
      p_takeoff_item_ids: itemIds,
      p_linked_by: input.userId,
    },
    mutationErrorMessage: itemIds.length > 0
      ? "Impossible d'enregistrer les liens manuels DPGF."
      : "Impossible de supprimer les liens manuels DPGF.",
  };
}

export function buildTakeoffDpgfReviewTargetReference(input: {
  estimateItem: TakeoffDpgfReviewDecisionTarget;
  unitByRowIndex: Map<number, string | null>;
}): string {
  const item = input.estimateItem;
  return buildTakeoffDpgfReviewReference({
    sourceFileName: item.source_file_name,
    sourcePage: item.source_page,
    position: item.position,
    title: item.title,
    unit: typeof item.source_page === "number"
      ? input.unitByRowIndex.get(item.source_page) ?? null
      : null,
  });
}

export function buildTakeoffDpgfReviewDecisionPlan(input: {
  tenantId: string;
  userId: string | null;
  jobId: string;
  payload: SaveTakeoffReviewDecisionInput;
  estimateItem: TakeoffDpgfReviewDecisionTarget;
  reviewReference: string;
  decisionTimestamp: string;
  existingDecision: TakeoffDpgfExistingDecision | null;
  sourceDecision: TakeoffDpgfSourceDecision | null;
  linkedFromVersionId: string | null;
}) {
  const normalizedReason =
    typeof input.payload.reason === "string" && input.payload.reason.trim().length > 0
      ? input.payload.reason.trim()
      : null;
  let carryOver: TakeoffDpgfDecisionCarryOver | null = input.existingDecision;
  if (!carryOver && input.linkedFromVersionId && input.sourceDecision) {
    carryOver = {
      carried_over_from_version_id:
        input.sourceDecision.carried_over_from_version_id ?? input.linkedFromVersionId,
      carried_over_at:
        input.sourceDecision.carried_over_at ??
        input.sourceDecision.updated_at ??
        input.decisionTimestamp,
    };
  }
  return {
    upsertPayload: {
      tenant_id: input.tenantId,
      version_id: input.payload.version_id,
      takeoff_job_id: input.jobId,
      estimate_item_id: input.payload.estimate_item_id,
      review_reference: input.reviewReference,
      line_label: input.estimateItem.title,
      line_position: input.estimateItem.position,
      source_file_name: input.estimateItem.source_file_name,
      source_page: input.estimateItem.source_page,
      carried_over_from_version_id: carryOver?.carried_over_from_version_id ?? null,
      carried_over_at: carryOver?.carried_over_at ?? null,
      decision: input.payload.decision,
      reason: normalizedReason,
      decided_at: input.decisionTimestamp,
      updated_at: input.decisionTimestamp,
      decided_by: input.userId,
    },
    auditMetadata: {
      estimate_item_id: input.payload.estimate_item_id,
      review_reference: input.reviewReference,
      previous_decision: input.existingDecision?.decision ?? null,
      next_decision: input.payload.decision,
      previous_reason: input.existingDecision?.reason ?? null,
      next_reason: normalizedReason,
    },
  };
}
