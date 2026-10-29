import { createHash } from "node:crypto";
import { z } from "zod";

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { toValidationIssues } from "@/lib/takeoff/validation-issues";
import {
  TAKEOFF_APPLY_SCOPES,
  type TakeoffApplyRequest,
  type TakeoffApplyScope,
  type TakeoffApplyStrategy,
  type TakeoffApplySummary,
  type TakeoffDpgfComparisonSummary,
  type TakeoffMappingPreviewItem,
} from "@/lib/takeoff/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTakeoffApplyScope(value: unknown): value is TakeoffApplyScope {
  return (
    typeof value === "string" &&
    (TAKEOFF_APPLY_SCOPES as readonly string[]).includes(value)
  );
}

export type ApplyTakeoffRpcArgs = {
  job_id: string;
  strategy: TakeoffApplyStrategy;
  target_section_id: string | null;
  mapping_plan: TakeoffAtomicMappingPlanItem[];
  dpgf_authorization_token?: string | null;
};

export type TakeoffAtomicMappingPlanItem = {
  item_id: string;
  source_order: number;
  rule_id: string | null;
  action: TakeoffMappingPreviewItem["action"];
  designation: string;
  unit_price_cents: number | null;
  category_id: string | null;
  assembly_id: string | null;
};

export function buildTakeoffAtomicMappingPlan(
  previewItems: TakeoffMappingPreviewItem[]
): TakeoffAtomicMappingPlanItem[] {
  return previewItems.map((item) => ({
    item_id: item.item_id,
    source_order: item.source_order,
    rule_id: item.rule_id,
    action: item.action,
    designation: item.transformed.designation,
    unit_price_cents:
      item.action === "set_price"
        ? item.transformed.unit_price_cents
        : null,
    category_id:
      item.action === "set_category" ? item.transformed.category_id : null,
    assembly_id:
      item.action === "apply_assembly" ? item.transformed.assembly_id : null,
  }));
}

const takeoffApplyRpcSummarySchema = z
  .object({
    strategy: z.string().optional(),
    scope: z.string().optional(),
    created_items_count: z.number().int().nonnegative().optional(),
    updated_items_count: z.number().int().nonnegative().optional(),
    ignored_items_count: z.number().int().nonnegative().optional(),
    created_item_ids: z.array(z.string()).optional(),
    created_count: z.number().int().nonnegative().optional(),
    updated_count: z.number().int().nonnegative().optional(),
    ignored_count: z.number().int().nonnegative().optional(),
    created_ids: z.array(z.string()).optional(),
    item_links: z
      .array(
        z.object({
          takeoff_item_id: z.string().uuid(),
          estimate_item_id: z.string().uuid(),
        })
      )
      .optional(),
  })
  .passthrough();

export function normalizeTakeoffApplySummary(input: {
  rpcData: unknown;
  request: TakeoffApplyRequest;
  jobId: string;
}): TakeoffApplySummary {
  const rpcRow = Array.isArray(input.rpcData) ? input.rpcData[0] : input.rpcData;
  const summarySource =
    isRecord(rpcRow) && isRecord(rpcRow.summary) ? rpcRow.summary : rpcRow;
  const parsed = takeoffApplyRpcSummarySchema.safeParse(
    isRecord(summarySource) ? summarySource : {}
  );

  if (!parsed.success) {
    throw new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "La réponse apply_takeoff_job est invalide.",
      details: {
        issues: toValidationIssues(parsed.error),
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  const row = parsed.data;
  const createdItemsCount = row.created_items_count ?? row.created_count ?? 0;
  const updatedItemsCount = row.updated_items_count ?? row.updated_count ?? 0;
  const ignoredItemsCount = row.ignored_items_count ?? row.ignored_count ?? 0;

  return {
    scope: isTakeoffApplyScope(row.scope)
      ? row.scope
      : input.request.target_section_id
        ? "section"
        : "version",
    created_count: createdItemsCount,
    updated_count: updatedItemsCount,
    ignored_count: ignoredItemsCount,
    created_ids: row.created_ids ?? row.created_item_ids ?? [],
    item_links: row.item_links ?? [],
  };
}

export function hashTakeoffApplyAuthorizationToken(authorizationToken: string) {
  return createHash("sha256").update(authorizationToken).digest("hex");
}

export function buildTakeoffDpgfApplyAuthorizationRecord(input: {
  tenantId: string;
  userId: string;
  jobId: string;
  estimateVersionId: string;
  summary: TakeoffDpgfComparisonSummary;
  authorizationToken: string;
  nowMs: number;
}) {
  return {
    tenant_id: input.tenantId,
    user_id: input.userId,
    job_id: input.jobId,
    estimate_version_id: input.estimateVersionId,
    authorization_token_hash: hashTakeoffApplyAuthorizationToken(input.authorizationToken),
    review_summary: input.summary,
    expires_at: new Date(input.nowMs + 5 * 60 * 1000).toISOString(),
  };
}
