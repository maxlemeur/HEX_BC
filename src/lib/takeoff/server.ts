import {
  TAKEOFF_DPGF_LINKS_SELECT,
  TAKEOFF_DPGF_REVIEW_DECISIONS_SELECT,
  getEstimateVersionNumbersById,
  hasTakeoffDpgfTargetLines,
  resolveDpgfUnitByRowIndex,
} from "@/lib/takeoff/dpgf-comparison-repository";
import {
  normalizeTakeoffDpgfManualLinkRows,
  buildTakeoffDpgfReviewDecisionRecord,
} from "@/lib/takeoff/dpgf-comparison-preparation";
import { fetchAllTakeoffDpgfComparisonRows, fetchDpgfTakeoffComparisonForContext } from "@/lib/takeoff/dpgf-comparison-server";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { refreshTakeoffLineEvidenceSnapshot } from "@/lib/takeoff/line-evidence-server";
export { fetchDpgfTakeoffComparison, fetchTakeoffDpgfSummaryForHub } from "@/lib/takeoff/dpgf-comparison-server";
export { fetchTakeoffLineEvidencePanel } from "@/lib/takeoff/line-evidence-server";

import {
  getAuthenticatedTakeoffContext,
  type AuthenticatedTakeoffContext,
  normalizeTakeoffJobSummaryRow,
  getTakeoffJobDetailByIdOrThrow,
  TAKEOFF_ITEMS_SELECT,
  normalizeTakeoffItemRow,
  type TakeoffItemRow,
} from "@/lib/takeoff/job-read-server";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { createHash, randomUUID } from "node:crypto";
import { listActiveTakeoffMappingRules } from "@/lib/takeoff/mapping-rules-server";
import { takeoffCompareDocumentKey } from "@/lib/takeoff/compare-document";
import {
  assertTakeoffOperatorActionRole,
  parseWithSchema,
  TAKEOFF_TENANT_ADMIN_ROLE,
} from "@/lib/takeoff/server-helpers";
import { toValidationIssues } from "@/lib/takeoff/validation-issues";
import { z } from "zod";
import type { Database } from "@/types/database";
import { bulkUpdateEstimateItems } from "@/lib/estimates/server";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { isPriceStale } from "@/lib/catalogue/stale-prices";
import { computeEstimateQualityFlagsByItemId } from "@/lib/estimate-quality";
import {
  forbidden,
  mapSupabaseError,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import { describeV3EntryRefusal } from "@/lib/estimates/assemblies-server";
import { detectEstimateOutliers } from "@/lib/estimates/outlier-detection";
import { evaluateRules } from "@/lib/estimates/rules-engine";
import { loadCanonicalFixedDiscountEvidence } from "@/lib/estimates/fixed-discount-evidence-server";
import { getStalePriceDaysForTenant } from "@/lib/feature-flags";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import {
  checkApplyGuard,
  getTakeoffVerificationReadiness,
} from "@/lib/takeoff/guards";
import {
  saveTakeoffDpgfManualLinkSchema,
  saveTakeoffReviewDecisionSchema,
  takeoffJobIdSchema,
  takeoffPreviewConversionResponseSchema,
  updateTakeoffRiskAlertStatusSchema,
  type CompareTakeoffJobsQuery,
  type TakeoffRiskRadarQuery,
} from "@/lib/takeoff/schemas";
import { parseApplyTakeoffPayload } from "@/lib/takeoff/query-parsers";
import {
  logTakeoffAuditEvent,
  takeoffAuditMetadataBuilders,
} from "@/lib/takeoff/audit";
import { getTakeoffLowConfidenceThresholdForTenant } from "@/lib/takeoff/feature-flags";
import { computeTakeoffMappingPreview } from "@/lib/takeoff/mapping-engine";
import {
  buildTakeoffDpgfReviewReference,
  hasBlockingTakeoffDpgfExceptions,
} from "@/lib/takeoff/dpgf-compare";
import {
  TAKEOFF_APPLY_SCOPES,
  type TakeoffApplyRequest,
  type TakeoffApplyResponse,
  type TakeoffApplyScope,
  type TakeoffApplyStrategy,
  type TakeoffApplySummary,
  type TakeoffMappingPreviewItem,
  type TakeoffPreviewConversionResponse,
  type TakeoffItemBatchPatchRequest,
  type TakeoffItemBatchPatchResponse,
  type TakeoffItemPatchResult,
  type TakeoffJobCompareResponse,
  type TakeoffDpgfComparisonResponse,
  type TakeoffDpgfComparisonSummary,
  type TakeoffDpgfReviewDecision,
  type SaveTakeoffDpgfManualLinkInput,
  type SaveTakeoffDpgfManualLinkResponse,
  type SaveTakeoffReviewDecisionInput,
  type SaveTakeoffReviewDecisionResponse,
  type TakeoffRiskAlert,
  type TakeoffRiskRadarResponse,
  type UpdateTakeoffRiskAlertStatusInput,
  type UpdateTakeoffRiskAlertStatusResponse,
} from "@/lib/takeoff/types";
import { TAKEOFF_COMPARE_DEFAULT_THRESHOLD, buildTakeoffDiff } from "@/lib/takeoff/diff";
import {
  buildTakeoffRiskCandidates,
  buildTakeoffRiskRadarResponse,
  normalizeRiskAlertRow,
} from "@/lib/takeoff/risk-radar";
import { getEstimateVersionProjectIdOrThrow, assertTakeoffJobAccessibleForVersion } from "@/lib/takeoff/version-access-server";
import { listAllTakeoffItemsByJobId } from "@/lib/takeoff/job-read-server";
export { getTakeoffPriceSuggestion, requestTakeoffPriceSuggestion, reviewTakeoffPriceSuggestion } from "@/lib/takeoff/price-suggestion-server";

export { createTakeoffJobFromFormData, createTakeoffJobFromPlanSet, hasAccessibleTakeoffJobForIdempotencyKey } from "@/lib/takeoff/job-creation-server";
export type { TakeoffJobCreateResponse } from "@/lib/takeoff/job-creation-input";

export {
  reconcileTakeoffJobNow,
  resubmitTakeoffJob,
  retryTakeoffJob,
  cancelTakeoffJob,
} from "@/lib/takeoff/job-actions-server";
export { listTakeoffJobs, getTakeoffJobDetails } from "./job-read-server";

export {
  compareTakeoffJobsQuerySchema,
  getTakeoffJobDetailsQuerySchema,
  listTakeoffJobsQuerySchema,
  takeoffApplyPayloadSchema,
  takeoffDpgfComparisonQuerySchema,
  takeoffJobIdSchema,
  takeoffLineEvidencePanelQuerySchema,
  takeoffPriceSuggestionQuerySchema,
  takeoffRiskRadarQuerySchema,
  type CompareTakeoffJobsQuery,
  type GetTakeoffJobDetailsQuery,
  type ListTakeoffJobsQuery,
  type RequestTakeoffPriceSuggestionPayload,
  type ReviewTakeoffPriceSuggestionPayload,
  type SaveTakeoffReviewDecisionPayload,
  type TakeoffDpgfComparisonQuery,
  type TakeoffLineEvidencePanelQuery,
  type TakeoffPriceSuggestionQuery,
  type TakeoffRiskRadarQuery,
} from "@/lib/takeoff/schemas";
export {
  parseApplyTakeoffPayload,
  parseCompareTakeoffJobsQuery,
  parseGetTakeoffJobDetailsQuery,
  parseListTakeoffJobsQuery,
  parseTakeoffDpgfComparisonQuery,
  parseTakeoffLineEvidencePanelQuery,
  parseTakeoffPriceSuggestionQuery,
  parseTakeoffRiskRadarQuery,
} from "@/lib/takeoff/query-parsers";
const ESTIMATE_RISK_ITEMS_SELECT = [
  "id",
  "parent_id",
  "item_type",
  // Lot 2, sous-lot 2.6b (G1) : une ligne v3 non chiffrée ne lève aucun drapeau de qualité (estimate-quality.ts).
  "pricing_status",
  "title",
  "description",
  "quantity",
  "category_id",
  "selected_supplier_price_id",
  "unit_price_ht_cents",
  "tax_rate_bp",
  "h_mo",
  "labor_role_id",
  "h_mo_atelier",
  "labor_role_atelier_id",
  "k_mo_atelier",
  "h_mo_chantier",
  "labor_role_chantier_id",
  "k_mo_chantier",
].join(", ");
const ESTIMATE_RISK_VERSION_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "status",
  "updated_at",
  "content_revision",
  "calc_engine_version",
  "calc_snapshot_content_revision",
  "calc_snapshot_context",
  "discount_amount_cents",
  "margin_bp",
  "margin_multiplier",
  "discount_bp",
  "total_ht_cents",
  "tax_rate_bp",
  "estimate_projects!inner(id, user_id, name, client_name)",
].join(", ");
const ESTIMATE_RISK_ALERTS_SELECT = [
  "id",
  "created_at",
  "updated_at",
  "tenant_id",
  "project_id",
  "version_id",
  "takeoff_job_id",
  "scope_type",
  "scope_ref",
  "scope_id",
  "scope_label",
  "cause_code",
  "severity",
  "status",
  "risk_score",
  "margin_bucket",
  "line_id",
  "lot_id",
  "reason_labels",
  "provenance",
  "metadata",
  "review_note",
  "reviewed_at",
  "reviewed_by",
  "is_active",
  "first_detected_at",
  "last_detected_at",
].join(", ");

function toHexSha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function assertTakeoffApplyOverrideAdminRole(tenantRole: string) {
  if (tenantRole === TAKEOFF_TENANT_ADMIN_ROLE) return;

  throw forbidden(
    "Seul un administrateur peut forcer l'application des items non vérifiés."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTakeoffApplyScope(value: unknown): value is TakeoffApplyScope {
  return (
    typeof value === "string" &&
    (TAKEOFF_APPLY_SCOPES as readonly string[]).includes(value)
  );
}

type ApplyTakeoffRpcError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type ApplyTakeoffRpcArgs = {
  job_id: string;
  strategy: TakeoffApplyStrategy;
  target_section_id: string | null;
  mapping_plan: TakeoffAtomicMappingPlanItem[];
  dpgf_authorization_token?: string | null;
};

type TakeoffAtomicMappingPlanItem = {
  item_id: string;
  source_order: number;
  rule_id: string | null;
  action: TakeoffMappingPreviewItem["action"];
  designation: string;
  unit_price_cents: number | null;
  category_id: string | null;
  assembly_id: string | null;
};

function buildTakeoffAtomicMappingPlan(
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

async function invokeApplyTakeoffRpc(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  args: ApplyTakeoffRpcArgs;
}) {
  if (input.args.dpgf_authorization_token) {
    return input.supabase.rpc(
      "apply_takeoff_job_guarded_atomic" as never,
      {
        p_job_id: input.args.job_id,
        p_strategy: input.args.strategy,
        p_target_section_id: input.args.target_section_id,
        p_mapping_plan: input.args.mapping_plan,
        p_dpgf_authorization_token: input.args.dpgf_authorization_token,
      } as never
    );
  }

  return input.supabase.rpc(
    "apply_takeoff_job_guarded_atomic" as never,
    {
      p_job_id: input.args.job_id,
      p_strategy: input.args.strategy,
      p_target_section_id: input.args.target_section_id,
      p_mapping_plan: input.args.mapping_plan,
    } as never
  );
}

async function issueTakeoffDpgfApplyAuthorization(input: {
  tenantId: string;
  userId: string;
  jobId: string;
  estimateVersionId: string;
  summary: TakeoffDpgfComparisonSummary;
}) {
  const authorizationToken = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const serviceRoleClient = createServiceRoleClient();
  const { error } = await serviceRoleClient
    .from("takeoff_apply_authorizations" as never)
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      job_id: input.jobId,
      estimate_version_id: input.estimateVersionId,
      authorization_token_hash: toHexSha256(authorizationToken),
      review_summary: input.summary,
      expires_at: expiresAt,
    } as never);

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de sécuriser l’autorisation d’application après la revue DPGF."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return authorizationToken;
}

async function revokeTakeoffDpgfApplyAuthorization(input: {
  authorizationToken: string;
  jobId: string;
}) {
  try {
    const serviceRoleClient = createServiceRoleClient();
    const { error } = await serviceRoleClient
      .from("takeoff_apply_authorizations" as never)
      .delete()
      .eq("job_id" as never, input.jobId as never)
      .eq(
        "authorization_token_hash" as never,
        toHexSha256(input.authorizationToken) as never
      );

    if (error) {
      console.error("Takeoff DPGF apply authorization cleanup failed", {
        jobId: input.jobId,
        code: error.code ?? null,
      });
    }
  } catch (error) {
    console.error("Takeoff DPGF apply authorization cleanup failed", {
      jobId: input.jobId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

type TakeoffV3UnresolvedUnit = {
  takeoff_item_id: string | null;
  designation: string;
  unit: string | null;
};

const takeoffV3UnresolvedUnitsDetailSchema = z.object({
  items: z.array(
    z.object({
      takeoff_item_id: z.string().nullable().optional(),
      designation: z.string().nullable().optional(),
      unit: z.string().nullable().optional(),
    })
  ),
});

/** Les items dont l'unité n'a pas de code dans le référentiel, tels que la migration M2 les nomme (détail JSON). */
function parseTakeoffV3UnresolvedUnits(detail: string | null | undefined): TakeoffV3UnresolvedUnit[] {
  if (!detail) return [];
  try {
    const parsed = takeoffV3UnresolvedUnitsDetailSchema.safeParse(JSON.parse(detail));
    if (!parsed.success) return [];
    return parsed.data.items.map((item) => ({
      takeoff_item_id: item.takeoff_item_id ?? null,
      designation: item.designation?.trim() || "Item sans désignation",
      unit: item.unit ?? null,
    }));
  } catch {
    return [];
  }
}

const TAKEOFF_V3_UNRESOLVED_UNITS_NAMED = 5;

function takeoffV3UnresolvedUnitsMessage(items: TakeoffV3UnresolvedUnit[]) {
  const advice =
    "Corrigez l’unité dans la revue (par exemple ml, m2, u, ens ou PM) ou excluez l’item, puis appliquez à nouveau.";
  if (items.length === 0) {
    return `Une unité du métré est inconnue du devis moteur 3. ${advice}`;
  }
  const named = items
    .slice(0, TAKEOFF_V3_UNRESOLVED_UNITS_NAMED)
    .map((item) => `« ${item.designation} » (${item.unit?.trim() ? item.unit.trim() : "sans unité"})`)
    .join(", ");
  const others = items.length - TAKEOFF_V3_UNRESOLVED_UNITS_NAMED;
  const more = others > 0 ? ` et ${others} autre${others > 1 ? "s" : ""}` : "";
  return `Unité inconnue du devis moteur 3 pour ${named}${more}. ${advice}`;
}

function mapApplyTakeoffRpcError(
  error: ApplyTakeoffRpcError,
  input: { jobId: string }
): TakeoffError {
  const normalized = [
    error.code ?? "",
    error.message ?? "",
    error.details ?? "",
    error.hint ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const details = {
    rpc: {
      code: error.code ?? null,
      message: error.message ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    },
  };

  if (error.code === "PGRST202") {
    return new TakeoffError({
      status: 503,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "L’application atomique du métré n’est pas encore disponible. Réessayez après la mise à jour du service.",
      details: {
        ...details,
        guard: "atomic_apply_unavailable",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  // Métré M2 v0.1 : refus nommés de l'application à un brouillon du moteur 3.
  if (error.message === "TAKEOFF_V3_UNIT_UNRESOLVED") {
    const items = parseTakeoffV3UnresolvedUnits(error.details);
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: takeoffV3UnresolvedUnitsMessage(items),
      details: {
        ...details,
        guard: "v3_unit_unresolved",
        items,
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.message === "TAKEOFF_TARGET_VERSION_DRAFT_REQUIRED") {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Ce devis n’est plus un brouillon : le métré ne peut plus s’y appliquer. Créez un brouillon depuis cette version, puis relancez le métré sur ce brouillon.",
      details: {
        ...details,
        guard: "target_version_draft_required",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  const v3EntryRefusal = describeV3EntryRefusal(error);
  if (v3EntryRefusal) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: v3EntryRefusal.message,
      details: {
        ...details,
        guard: "v3_entry_refusal",
        refusal: v3EntryRefusal.code,
        title: v3EntryRefusal.title,
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.message === "ESTIMATE_V3_WRITER_NOT_SUPPORTED") {
    return new TakeoffError({
      status: 503,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "L’application du métré à un devis moteur 3 n’est pas encore disponible. Réessayez après la mise à jour du service.",
      details: {
        ...details,
        guard: "v3_apply_unavailable",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  // Refus du moteur 3 au calcul des lignes : rien n'est appliqué, la revue reste corrigeable.
  if (error.message === "ESTIMATE_V3_INPUT_INVALID" || error.message === "ESTIMATE_AMOUNT_OVERFLOW") {
    const overflow = error.message === "ESTIMATE_AMOUNT_OVERFLOW";
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: overflow
        ? "Avec ce métré, un montant du devis moteur 3 dépasserait la limite autorisée : rien n’a été appliqué. Vérifiez les quantités dans la revue, puis appliquez à nouveau."
        : "Une quantité ou un prix du métré ne peut pas être chiffré par le devis moteur 3 (valeur négative, illisible ou trop précise) : rien n’a été appliqué. Corrigez-le dans la revue, puis appliquez à nouveau.",
      details: {
        ...details,
        guard: overflow ? "v3_amount_overflow" : "v3_input_invalid",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.message === "ESTIMATE_V3_PROJECTION_MISMATCH") {
    return new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "Le calcul moteur 3 du devis ne concorde pas après ce métré : rien n’a été appliqué. Signalez-le avant d’appliquer à nouveau.",
      details: {
        ...details,
        guard: "v3_projection_mismatch",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.code === "57014") {
    return new TakeoffError({
      status: 503,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "L’application du métré a pris trop de temps et a été annulée : rien n’a été appliqué. Réessayez dans un instant.",
      details: {
        ...details,
        guard: "statement_timeout",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  if (normalized.includes("takeoff_root_replace_disabled")) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message:
        "Le remplacement complet du devis est désactivé : choisissez une section pour limiter l’application et protéger le chiffrage existant.",
      details: {
        ...details,
        guard: "root_replace_disabled",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    normalized.includes("takeoff_atomic_mapping_plan") ||
    normalized.includes("takeoff_atomic_line_mapping_failed")
  ) {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Le métré ou le devis a changé depuis l’aperçu. Rechargez la revue avant d’appliquer.",
      details: {
        ...details,
        guard: "atomic_mapping_stale",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  if (
    normalized.includes("takeoff_dpgf_apply_authorization_required") ||
    normalized.includes("takeoff_dpgf_apply_authorization_invalid")
  ) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
      message:
        "La validation DPGF a expiré ou n’est plus valable. Relancez l’application pour recalculer les contrôles.",
      details: {
        ...details,
        guard: "dpgf_authorization",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "PGRST116" ||
    normalized.includes("not found") ||
    normalized.includes("introuvable")
  ) {
    return new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
      message: "Job takeoff introuvable.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "P0001" ||
    error.code === "23505" ||
    normalized.includes("conflict") ||
    normalized.includes("already applied") ||
    normalized.includes("deja applique") ||
    normalized.includes("lock")
  ) {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Conflit lors de l'application du job takeoff.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "22P02" ||
    error.code === "23503" ||
    error.code === "23514" ||
    normalized.includes("validation") ||
    normalized.includes("invalid") ||
    normalized.includes("invalide") ||
    normalized.includes("uuid")
  ) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: "Le payload d'application takeoff est invalide.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  return new TakeoffError({
    status: 500,
    code: TakeoffErrorCode.INTERNAL_ERROR,
    message: "Erreur interne lors de l'application du job takeoff.",
    details,
    retryable: false,
    jobId: input.jobId,
  });
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

function normalizeTakeoffApplySummary(input: {
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

type EstimateRiskItemRow = {
  id: string;
  parent_id: string | null;
  item_type: string;
  pricing_status: string | null;
  title: string;
  description: string | null;
  quantity: number | null;
  category_id: string | null;
  selected_supplier_price_id: string | null;
  unit_price_ht_cents: number | null;
  tax_rate_bp: number | null;
  h_mo: number | null;
  labor_role_id: string | null;
  h_mo_atelier: number | null;
  labor_role_atelier_id: string | null;
  k_mo_atelier: number | null;
  h_mo_chantier: number | null;
  labor_role_chantier_id: string | null;
  k_mo_chantier: number | null;
};

type EstimateRiskVersionContext = {
  id: string;
  tenant_id: string;
  project_id: string;
  status: string;
  updated_at: string;
  content_revision: number;
  calc_engine_version: number | null;
  calc_snapshot_content_revision: number | null;
  calc_snapshot_context: Database["public"]["Tables"]["estimate_versions"]["Row"]["calc_snapshot_context"];
  discount_amount_cents: number | null;
  project_user_id: string;
  margin_bp: number | null;
  margin_multiplier: number | null;
  discount_bp: number | null;
  total_ht_cents: number | null;
  tax_rate_bp: number | null;
  project_name: string;
  client_name: string | null;
};

type ExistingRiskAlertRecord = TakeoffRiskAlert & {
  is_active: boolean;
  scope_ref: string;
};

function resolveEmbeddedProjectRecord(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((entry) => isRecord(entry)) ?? null;
  }

  return isRecord(value) ? value : null;
}

function hasRiskLaborSplitPayload(item: EstimateRiskItemRow) {
  return (
    item.h_mo_atelier !== null ||
    item.labor_role_atelier_id !== null ||
    item.h_mo_chantier !== null ||
    item.labor_role_chantier_id !== null ||
    ((item.k_mo_atelier ?? 1) !== 1) ||
    ((item.k_mo_chantier ?? 1) !== 1)
  );
}

function buildDismissedOutlierFlagsByItemId(
  rows: Array<{ item_id: string; flag_key: "price_outlier" | "quantity_outlier" }>
) {
  const result: Record<string, Array<"price_outlier" | "quantity_outlier">> = {};

  for (const row of rows) {
    const current = result[row.item_id] ?? [];
    if (current.includes(row.flag_key)) {
      continue;
    }

    result[row.item_id] = [...current, row.flag_key];
  }

  return result;
}

function buildRiskAlertIdentityKey(input: {
  scope_type: string;
  scope_ref: string;
  cause_code: string;
}) {
  return `${input.scope_type}:${input.scope_ref}:${input.cause_code}`;
}

async function listEstimateRiskItems(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
}) {
  // One access check per statement, not one per item: supabase/migrations/20261024130000_read_estimate_version_items.sql.
  // PostgREST orders a function's rows by the selected columns only: position and created_at are selected for the order.
  const { data, error } = await readAllRows(() => input.supabase
    .rpc("read_estimate_version_items" as never,
      { p_tenant_id: input.tenantId, p_version_id: input.versionId } as never, { count: "exact", get: true })
    .select(`${ESTIMATE_RISK_ITEMS_SELECT}, position, created_at` as never)
    .order("position" as never, { ascending: true })
    .order("created_at" as never, { ascending: true })
    .order("id" as never, { ascending: true }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les items de risque de la version."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return (data ?? []) as EstimateRiskItemRow[];
}

async function loadEstimateRiskVersionContext(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
}): Promise<EstimateRiskVersionContext> {
  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select(ESTIMATE_RISK_VERSION_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.versionId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger le contexte de risque de la version."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  if (!data || !isRecord(data)) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version cible introuvable.",
      details: {
        version_id: input.versionId,
      },
      retryable: false,
    });
  }

  const versionRow = data as Record<string, unknown>;
  const embeddedProject = resolveEmbeddedProjectRecord(versionRow.estimate_projects);
  if (!embeddedProject) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Projet de la version introuvable.",
      details: {
        version_id: input.versionId,
      },
      retryable: false,
    });
  }

  return {
    id: typeof versionRow.id === "string" ? versionRow.id : input.versionId,
    tenant_id: typeof versionRow.tenant_id === "string" ? versionRow.tenant_id : "",
    status: typeof versionRow.status === "string" ? versionRow.status : "",
    updated_at: typeof versionRow.updated_at === "string" ? versionRow.updated_at : "",
    content_revision: typeof versionRow.content_revision === "number" ? versionRow.content_revision : 0,
    calc_engine_version: typeof versionRow.calc_engine_version === "number" ? versionRow.calc_engine_version : null,
    calc_snapshot_content_revision: typeof versionRow.calc_snapshot_content_revision === "number" ? versionRow.calc_snapshot_content_revision : null,
    calc_snapshot_context: (versionRow.calc_snapshot_context ?? null) as EstimateRiskVersionContext["calc_snapshot_context"],
    discount_amount_cents: typeof versionRow.discount_amount_cents === "number" ? versionRow.discount_amount_cents : null,
    project_user_id: typeof embeddedProject.user_id === "string" ? embeddedProject.user_id : "",
    project_id:
      typeof versionRow.project_id === "string"
        ? versionRow.project_id
        : (typeof embeddedProject.id === "string" ? embeddedProject.id : ""),
    margin_bp:
      typeof versionRow.margin_bp === "number" ? versionRow.margin_bp : null,
    margin_multiplier:
      typeof versionRow.margin_multiplier === "number"
        ? versionRow.margin_multiplier
        : null,
    discount_bp:
      typeof versionRow.discount_bp === "number" ? versionRow.discount_bp : null,
    total_ht_cents:
      typeof versionRow.total_ht_cents === "number"
        ? versionRow.total_ht_cents
        : null,
    tax_rate_bp:
      typeof versionRow.tax_rate_bp === "number" ? versionRow.tax_rate_bp : null,
    project_name:
      typeof embeddedProject.name === "string" && embeddedProject.name.trim().length > 0
        ? embeddedProject.name
        : "Affaire",
    client_name:
      typeof embeddedProject.client_name === "string" ? embeddedProject.client_name : null,
  };
}

async function loadDismissedOutlierFlagsByItemId(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("estimate_item_outlier_dismissals" as never)
    .select("item_id, flag_key, id" as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .order("dismissed_at" as never, { ascending: true }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les outliers dismiss."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return buildDismissedOutlierFlagsByItemId(
    ((data ?? []) as Array<{ item_id: string; flag_key: "price_outlier" | "quantity_outlier" }>)
      .filter(
        (row) =>
          row.flag_key === "price_outlier" || row.flag_key === "quantity_outlier"
      )
  );
}

async function loadStaleSupplierPriceItemIds(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  items: EstimateRiskItemRow[];
}) {
  const stalePriceDays = await getStalePriceDaysForTenant(input.tenantId, {
    supabase: input.supabase as never,
  });
  const selectedSupplierPriceIds = Array.from(
    new Set(
      input.items
        .filter((item) => item.item_type === "line")
        .map((item) => item.selected_supplier_price_id)
        .filter((priceId): priceId is string => typeof priceId === "string" && priceId.length > 0)
    )
  );

  if (selectedSupplierPriceIds.length === 0) {
    return new Set<string>();
  }

  const { data, error } = await readAllRowsInChunks(selectedSupplierPriceIds, (pageIds) => input.supabase
    .from("supplier_pricebook" as never)
    .select("id, updated_at, created_at" as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .in("id" as never, pageIds as never));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les prix fournisseurs sélectionnés."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const stalePriceIds = new Set(
    ((data ?? []) as Array<{ id: string; updated_at: string | null; created_at: string | null }>)
      .filter((price) =>
        isPriceStale(
          {
            updatedAt: price.updated_at,
            createdAt: price.created_at,
          },
          stalePriceDays
        )
      )
      .map((price) => price.id)
  );

  return new Set(
    input.items
      .filter((item) => item.item_type === "line")
      .filter((item) => {
        const selectedSupplierPriceId = item.selected_supplier_price_id ?? null;
        return selectedSupplierPriceId ? stalePriceIds.has(selectedSupplierPriceId) : false;
      })
      .map((item) => item.id)
  );
}

async function loadApplicableMinMarginThresholdBp(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  projectId: string;
  categoryIds: Set<string>;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("estimate_rules" as never)
    .select("scope_type, scope_id, threshold_value, id" as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("is_active" as never, true as never)
    .eq("rule_type" as never, "min_margin" as never));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les seuils de marge applicables."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const thresholds = ((data ?? []) as Array<{
    scope_type: "global" | "category" | "client";
    scope_id: string | null;
    threshold_value: number;
  }>)
    .filter((rule) => {
      if (rule.scope_type === "global") {
        return true;
      }

      if (rule.scope_type === "category") {
        return typeof rule.scope_id === "string" && input.categoryIds.has(rule.scope_id);
      }

      if (rule.scope_type === "client") {
        return typeof rule.scope_id === "string" && rule.scope_id === input.projectId;
      }

      return false;
    })
    .map((rule) => rule.threshold_value)
    .filter((value) => Number.isFinite(value));

  if (thresholds.length === 0) {
    return null;
  }

  return Math.max(...thresholds);
}

async function listActiveTakeoffRiskAlerts(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("estimate_risk_alerts" as never)
    .select(ESTIMATE_RISK_ALERTS_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .eq("is_active" as never, true as never)
    .order("updated_at" as never, { ascending: false })
    .order("id" as never, { ascending: false }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les alertes de risque actives."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => normalizeRiskAlertRow(row))
    .filter((row): row is TakeoffRiskAlert => row !== null);
}

async function listExistingRiskAlertRecords(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("estimate_risk_alerts" as never)
    .select(ESTIMATE_RISK_ALERTS_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .order("updated_at" as never, { ascending: false })
    .order("id" as never, { ascending: false }));

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger la projection existante du radar de risque."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  const records = ((data ?? []) as Record<string, unknown>[])
    .map((row) => {
      const normalized = normalizeRiskAlertRow(row);
      if (!normalized || typeof row.scope_ref !== "string") {
        return null;
      }

      return {
        ...normalized,
        is_active: row.is_active === true,
        scope_ref: row.scope_ref,
      } satisfies ExistingRiskAlertRecord;
    })
    .filter((row): row is ExistingRiskAlertRecord => row !== null);

  const recordsByKey = new Map<string, ExistingRiskAlertRecord>();
  for (const record of records) {
    const key = buildRiskAlertIdentityKey({
      scope_type: record.scope_type,
      scope_ref: record.scope_ref,
      cause_code: record.cause_code,
    });
    if (!recordsByKey.has(key)) {
      recordsByKey.set(key, record);
    }
  }

  return Array.from(recordsByKey.values());
}

async function syncTakeoffRiskRadarProjection(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
  projectId: string;
  comparisonRows: TakeoffDpgfComparisonResponse["rows"];
}) {
  const [versionContext, estimateItems, dismissedOutlierFlagsByItemId, intakeWorkspace] =
    await Promise.all([
      loadEstimateRiskVersionContext({
        supabase: input.supabase,
        tenantId: input.tenantId,
        versionId: input.versionId,
      }),
      listEstimateRiskItems({
        supabase: input.supabase,
        tenantId: input.tenantId,
        versionId: input.versionId,
      }),
      loadDismissedOutlierFlagsByItemId({
        supabase: input.supabase,
        tenantId: input.tenantId,
        versionId: input.versionId,
      }),
      fetchAffaireIntakeWorkspace(input.projectId).catch(() => ({
        projectId: input.projectId,
        uploadId: null,
        documents: [],
        missingPieces: [],
        briefDraft: null,
      })),
    ]);

  const staleSupplierPriceItemIds = await loadStaleSupplierPriceItemIds({
    supabase: input.supabase,
    tenantId: input.tenantId,
    items: estimateItems,
  });
  const hasAtLeastOneSplitLine = estimateItems.some(
    (item) => item.item_type === "line" && hasRiskLaborSplitPayload(item)
  );
  const outlierFlagsByItemId = detectEstimateOutliers({
    items: estimateItems as never,
  });
  const qualityFlagsByItemId = computeEstimateQualityFlagsByItemId(
    estimateItems as never,
    {
      outlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      staleSupplierPriceItemIds,
      isLaborSplitEnabled: hasAtLeastOneSplitLine,
    }
  );
  const categoryIds = new Set(
    estimateItems
      .filter((item) => item.item_type === "line")
      .map((item) => item.category_id)
      .filter((categoryId): categoryId is string => typeof categoryId === "string")
  );
  const applicableMarginThresholdBp = await loadApplicableMinMarginThresholdBp({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    categoryIds,
  });
  const fixedDiscountEvidence = await loadCanonicalFixedDiscountEvidence({
    supabase: input.supabase, tenantId: input.tenantId,
    projectUserId: versionContext.project_user_id, authorizedVersion: versionContext,
  });
  const rulesEvaluation = await evaluateRules({
    supabase: input.supabase as never,
    tenantId: input.tenantId,
    fixedDiscountEvidence,
    version: {
      id: versionContext.id,
      project_id: versionContext.project_id,
      total_ht_cents: versionContext.total_ht_cents ?? 0,
      margin_bp: versionContext.margin_bp,
      margin_multiplier: versionContext.margin_multiplier,
      discount_bp: versionContext.discount_bp,
      discount_amount_cents: versionContext.discount_amount_cents,
      tenant_id: versionContext.tenant_id,
      status: versionContext.status,
      updated_at: versionContext.updated_at,
      calc_engine_version: versionContext.calc_engine_version,
      content_revision: versionContext.content_revision,
      calc_snapshot_content_revision: versionContext.calc_snapshot_content_revision,
      calc_snapshot_context: versionContext.calc_snapshot_context,
    },
    project: {
      id: input.projectId,
      client_name: versionContext.client_name,
    },
    items: estimateItems
      .filter((item) => item.item_type === "line")
      .map((item) => ({
        id: item.id,
        category_id: item.category_id,
        item_type: item.item_type as "line" | "section",
      })),
  });
  const minMarginViolation =
    rulesEvaluation.violations.find((violation) => violation.rule_type === "min_margin") ?? null;

  const marginThresholdBp =
    applicableMarginThresholdBp ?? (versionContext.margin_bp !== null ? 1000 : null);
  const shouldRaiseMarginAlert =
    minMarginViolation !== null ||
    (applicableMarginThresholdBp === null &&
      versionContext.margin_bp !== null &&
      versionContext.margin_bp < 1000);
  const { candidates, lotLabelById } = buildTakeoffRiskCandidates({
    comparisonRows: input.comparisonRows,
    estimateItems,
    projectId: input.projectId,
    projectLabel: versionContext.project_name,
    qualityFlagsByItemId,
    versionTaxRateBp: versionContext.tax_rate_bp,
    marginThresholdBp: shouldRaiseMarginAlert ? marginThresholdBp : applicableMarginThresholdBp,
    versionMarginBp: versionContext.margin_bp,
    missingPieces: intakeWorkspace.missingPieces,
  });
  const filteredCandidates = shouldRaiseMarginAlert
    ? candidates
    : candidates.filter((candidate) => candidate.cause_code !== "insufficient_margin");

  const existingAlerts = await listExistingRiskAlertRecords({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    jobId: input.jobId,
  });
  const existingByKey = new Map(
    existingAlerts.map((alert) => [
      buildRiskAlertIdentityKey({
        scope_type: alert.scope_type,
        scope_ref: alert.scope_ref,
        cause_code: alert.cause_code,
      }),
      alert,
    ])
  );
  const now = new Date().toISOString();
  const nextKeys = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];

  for (const candidate of filteredCandidates) {
    const key = buildRiskAlertIdentityKey({
      scope_type: candidate.scope_type,
      scope_ref: candidate.scope_ref,
      cause_code: candidate.cause_code,
    });
    nextKeys.add(key);

    const existing = existingByKey.get(key) ?? null;
    const basePayload = {
      tenant_id: input.tenantId,
      project_id: input.projectId,
      version_id: input.versionId,
      takeoff_job_id: input.jobId,
      scope_type: candidate.scope_type,
      scope_ref: candidate.scope_ref,
      scope_id: candidate.scope_id,
      scope_label: candidate.scope_label,
      cause_code: candidate.cause_code,
      severity: candidate.severity,
      risk_score: candidate.risk_score,
      margin_bucket: candidate.margin_bucket,
      line_id: candidate.line_id,
      lot_id: candidate.lot_id,
      reason_labels: candidate.reason_labels,
      provenance: candidate.provenance,
      metadata: candidate.metadata,
      is_active: true,
      last_detected_at: now,
      updated_at: now,
    } satisfies Record<string, unknown>;

    if (existing) {
      updates.push({
        id: existing.alert_id,
        payload: {
          ...basePayload,
          status: existing.status,
          review_note: existing.review_note,
          reviewed_at: existing.reviewed_at,
          reviewed_by: existing.reviewed_by,
        },
      });
      continue;
    }

    inserts.push({
      ...basePayload,
      status: "to_process",
      review_note: null,
      reviewed_at: null,
      reviewed_by: null,
      first_detected_at: now,
    });
  }

  const staleAlertIds = existingAlerts
    .filter((alert) => {
      if (!alert.is_active) {
        return false;
      }
      const key = buildRiskAlertIdentityKey({
        scope_type: alert.scope_type,
        scope_ref: alert.scope_ref,
        cause_code: alert.cause_code,
      });
      return !nextKeys.has(key);
    })
    .map((alert) => alert.alert_id);

  await Promise.all([
    ...updates.map(({ id, payload }) =>
      input.supabase
        .from("estimate_risk_alerts" as never)
        .update(payload as never)
        .eq("tenant_id" as never, input.tenantId as never)
        .eq("id" as never, id as never)
    ),
    inserts.length > 0
      ? input.supabase.from("estimate_risk_alerts" as never).insert(inserts as never)
      : Promise.resolve({ error: null }),
    staleAlertIds.length > 0
      ? input.supabase
          .from("estimate_risk_alerts" as never)
          .update({
            is_active: false,
            last_detected_at: now,
            updated_at: now,
          } as never)
          .eq("tenant_id" as never, input.tenantId as never)
          .in("id" as never, staleAlertIds as never)
      : Promise.resolve({ error: null }),
  ]).then((results) => {
    for (const result of results) {
      if (result && "error" in result && result.error) {
        throw toTakeoffError(
          mapSupabaseError(result.error, "Impossible de synchroniser le radar de risque."),
          {
            fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
            retryable: false,
            jobId: input.jobId,
          }
        );
      }
    }
  });

  const alerts = await listActiveTakeoffRiskAlerts({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    jobId: input.jobId,
  });

  return {
    alerts,
    lotLabelById,
    projectLabel: versionContext.project_name,
  };
}

export async function compareTakeoffJobs(
  baseJobId: string,
  input: CompareTakeoffJobsQuery
): Promise<TakeoffJobCompareResponse> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const normalizedBaseJobId = parseWithSchema(
    takeoffJobIdSchema,
    baseJobId,
    "Identifiant job invalide."
  );
  const normalizedOtherJobId = parseWithSchema(
    takeoffJobIdSchema,
    input.with,
    "Paramètre with invalide."
  );
  const threshold = input.threshold ?? TAKEOFF_COMPARE_DEFAULT_THRESHOLD;

  if (normalizedBaseJobId === normalizedOtherJobId) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La comparaison doit cibler deux jobs différents.",
      details: {
        base_job_id: normalizedBaseJobId,
        other_job_id: normalizedOtherJobId,
      },
      retryable: false,
      jobId: normalizedBaseJobId,
    });
  }

  const [baseJob, otherJob] = await Promise.all([
    getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedBaseJobId,
    }),
    getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedOtherJobId,
    }),
  ]);

  const baseDocumentKey = takeoffCompareDocumentKey(baseJob);
  const otherDocumentKey = takeoffCompareDocumentKey(otherJob);

  if (
    baseJob.estimate_version_id !== otherJob.estimate_version_id ||
    !baseDocumentKey ||
    !otherDocumentKey ||
    baseDocumentKey !== otherDocumentKey
  ) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Les jobs sélectionnés ne correspondent pas au même document (version + fichier source).",
      details: {
        base_job_id: normalizedBaseJobId,
        other_job_id: normalizedOtherJobId,
        base_estimate_version_id: baseJob.estimate_version_id,
        other_estimate_version_id: otherJob.estimate_version_id,
        base_source_file_name: baseJob.source_file_name,
        other_source_file_name: otherJob.source_file_name,
      },
      retryable: false,
      jobId: normalizedBaseJobId,
    });
  }

  const [baseItems, otherItems] = await Promise.all([
    listAllTakeoffItemsByJobId({
      supabase,
      tenantId,
      jobId: normalizedBaseJobId,
    }),
    listAllTakeoffItemsByJobId({
      supabase,
      tenantId,
      jobId: normalizedOtherJobId,
    }),
  ]);

  const diff = buildTakeoffDiff({
    baseItems,
    otherItems,
    threshold,
  });

  return {
    base_job_id: normalizedBaseJobId,
    other_job_id: normalizedOtherJobId,
    threshold: diff.threshold,
    summary: diff.summary,
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    unchanged: diff.unchanged,
  };
}

export async function fetchTakeoffRiskRadar(
  jobId: string,
  input: TakeoffRiskRadarQuery
): Promise<TakeoffRiskRadarResponse> {
  const context = await loadTakeoffDpgfComparisonContext({
    jobId,
    versionId: input.version_id,
  });
  const { supabase, tenantId, projectId } = context;
  const { jobId: normalizedJobId, versionId: normalizedVersionId } = context.comparisonInput;
  const fullComparison = await fetchAllTakeoffDpgfComparisonRows({ context });
  const { alerts, lotLabelById, projectLabel } = await syncTakeoffRiskRadarProjection({
    supabase,
    tenantId,
    versionId: normalizedVersionId,
    jobId: normalizedJobId,
    projectId,
    comparisonRows: fullComparison.rows,
  });

  return buildTakeoffRiskRadarResponse({
    versionId: normalizedVersionId,
    jobId: normalizedJobId,
    alerts,
    projectId,
    projectLabel,
    lotLabelById,
    filters: {
      severity: input.severity ?? null,
      status: input.status ?? null,
      scope: input.scope ?? null,
      lot_id: input.lot_id ?? null,
    },
  });
}

export async function fetchTakeoffActiveRiskAlerts(
  jobId: string,
  input: Pick<TakeoffRiskRadarQuery, "version_id">
): Promise<TakeoffRiskAlert[]> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const normalizedVersionId = parseWithSchema(
    z.string().uuid("version_id invalide."),
    input.version_id,
    "version_id invalide."
  );

  await assertTakeoffJobAccessibleForVersion({
    supabase,
    tenantId,
    versionId: normalizedVersionId,
    jobId: normalizedJobId,
  });

  return listActiveTakeoffRiskAlerts({
    supabase,
    tenantId,
    versionId: normalizedVersionId,
    jobId: normalizedJobId,
  });
}

export async function saveTakeoffDpgfManualLink(
  jobId: string,
  input: SaveTakeoffDpgfManualLinkInput
): Promise<SaveTakeoffDpgfManualLinkResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const payload = parseWithSchema(
    saveTakeoffDpgfManualLinkSchema,
    input,
    "Payload de lien manuel DPGF invalide."
  );

  await assertTakeoffJobAccessibleForVersion({
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
  });

  const uniqueTakeoffItemIds = [...new Set(payload.takeoff_item_ids)];
  const [estimateItemRow, takeoffItemRows] = await Promise.all([
    supabase
      .from("estimate_items" as never)
      .select(
        "id, tenant_id, version_id, item_type, source_provider, source_file_name" as never
      )
      .eq("tenant_id" as never, tenantId as never)
      .eq("id" as never, payload.estimate_item_id as never)
      .maybeSingle(),
    uniqueTakeoffItemIds.length > 0
      ? supabase
          .from("takeoff_items" as never)
          .select("id, tenant_id, job_id" as never)
          .eq("tenant_id" as never, tenantId as never)
          .in("id" as never, uniqueTakeoffItemIds as never)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (estimateItemRow.error) {
    throw toTakeoffError(
      mapSupabaseError(estimateItemRow.error, "Impossible de charger la ligne DPGF."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  if (!estimateItemRow.data) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Ligne DPGF introuvable.",
      details: {
        estimate_item_id: payload.estimate_item_id,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const estimateItem = estimateItemRow.data as {
    id: string;
    tenant_id: string;
    version_id: string;
    item_type: "section" | "line";
    source_provider: string | null;
    source_file_name: string | null;
  };

  if (estimateItem.version_id !== payload.version_id) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La ligne DPGF n'appartient pas à la version cible.",
      details: {
        version_id: payload.version_id,
        estimate_item_version_id: estimateItem.version_id,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  if (
    estimateItem.item_type !== "line" ||
    (estimateItem.source_provider !== "dpgf" &&
      estimateItem.source_file_name === null)
  ) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La ligne cible n'est pas une ligne DPGF eligible.",
      details: {
        estimate_item_id: payload.estimate_item_id,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  if (takeoffItemRows.error) {
    throw toTakeoffError(
      mapSupabaseError(takeoffItemRows.error, "Impossible de charger les items takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  const takeoffItems = ((takeoffItemRows.data ?? []) as Array<{
    id: string;
    tenant_id: string;
    job_id: string;
  }>).filter(Boolean);
  const takeoffItemById = new Map(takeoffItems.map((item) => [item.id, item] as const));
  const missingTakeoffItemId = uniqueTakeoffItemIds.find(
    (takeoffItemId) => !takeoffItemById.has(takeoffItemId)
  );

  if (missingTakeoffItemId) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Un item takeoff est introuvable.",
      details: {
        takeoff_item_id: missingTakeoffItemId,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const mismatchedTakeoffItem = takeoffItems.find(
    (takeoffItem) => takeoffItem.job_id !== normalizedJobId
  );
  if (mismatchedTakeoffItem) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Un item takeoff ne correspond pas au job cible.",
      details: {
        takeoff_item_id: mismatchedTakeoffItem.id,
        takeoff_job_id: mismatchedTakeoffItem.job_id,
        expected_job_id: normalizedJobId,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const mutationErrorMessage =
    uniqueTakeoffItemIds.length > 0
      ? "Impossible d'enregistrer les liens manuels DPGF."
      : "Impossible de supprimer les liens manuels DPGF.";

  const { data: savedLinkIds, error: saveError } = await supabase.rpc(
    "save_takeoff_dpgf_manual_links" as never,
    {
      p_version_id: payload.version_id,
      p_takeoff_job_id: normalizedJobId,
      p_estimate_item_id: payload.estimate_item_id,
      p_takeoff_item_ids: uniqueTakeoffItemIds,
      p_linked_by: userId,
    } as never
  );

  if (saveError) {
    throw toTakeoffError(
      mapSupabaseError(saveError, mutationErrorMessage),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  parseWithSchema(
    z.array(z.string().uuid()),
    savedLinkIds ?? [],
    "La réponse save_takeoff_dpgf_manual_links est invalide."
  );

  const { data, error } = await supabase
    .from("takeoff_dpgf_links" as never)
    .select(TAKEOFF_DPGF_LINKS_SELECT as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("version_id" as never, payload.version_id as never)
    .eq("takeoff_job_id" as never, normalizedJobId as never)
    .eq("estimate_item_id" as never, payload.estimate_item_id as never)
    .order("created_at" as never, { ascending: true })
    .order("id" as never, { ascending: true });

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de recharger les liens manuels DPGF."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  await refreshTakeoffLineEvidenceSnapshot({
    supabase,
    tenantId,
    userId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
    estimateItemIds: [payload.estimate_item_id],
  });

  return {
    links: normalizeTakeoffDpgfManualLinkRows((data ?? []) as unknown[]),
  };
}

export async function saveTakeoffReviewDecision(
  jobId: string,
  input: SaveTakeoffReviewDecisionInput
): Promise<SaveTakeoffReviewDecisionResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const payload = parseWithSchema(
    saveTakeoffReviewDecisionSchema,
    input,
    "Payload de décision DPGF invalide."
  );

  const accessibleJob = await assertTakeoffJobAccessibleForVersion({
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
  });

  const [estimateItemRow, existingDecisionRow] = await Promise.all([
    supabase
      .from("estimate_items" as never)
      .select(
        "id, tenant_id, version_id, item_type, source_provider, source_file_name, source_page, position, title, description, quantity" as never
      )
      .eq("tenant_id" as never, tenantId as never)
      .eq("id" as never, payload.estimate_item_id as never)
      .maybeSingle(),
    supabase
      .from("takeoff_dpgf_review_decisions" as never)
      .select(TAKEOFF_DPGF_REVIEW_DECISIONS_SELECT as never)
      .eq("tenant_id" as never, tenantId as never)
      .eq("version_id" as never, payload.version_id as never)
      .eq("takeoff_job_id" as never, normalizedJobId as never)
      .eq("estimate_item_id" as never, payload.estimate_item_id as never)
      .maybeSingle(),
  ]);

  if (estimateItemRow.error) {
    throw toTakeoffError(
      mapSupabaseError(estimateItemRow.error, "Impossible de charger la ligne DPGF."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  if (!estimateItemRow.data) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Ligne DPGF introuvable.",
      details: {
        estimate_item_id: payload.estimate_item_id,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const estimateItem = estimateItemRow.data as {
    id: string;
    tenant_id: string;
    version_id: string;
    item_type: "section" | "line";
    source_provider: string | null;
    source_file_name: string | null;
    source_page: number | null;
    position: number;
    title: string;
    description: string | null;
    quantity: number | null;
  };

  if (estimateItem.version_id !== payload.version_id) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La ligne DPGF n'appartient pas à la version cible.",
      details: {
        version_id: payload.version_id,
        estimate_item_version_id: estimateItem.version_id,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  if (
    estimateItem.item_type !== "line" ||
    (estimateItem.source_provider !== "dpgf" &&
      estimateItem.source_file_name === null)
  ) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La ligne cible n'est pas une ligne DPGF eligible.",
      details: {
        estimate_item_id: payload.estimate_item_id,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  if (existingDecisionRow.error) {
    throw toTakeoffError(
      mapSupabaseError(
        existingDecisionRow.error,
        "Impossible de charger la décision DPGF existante."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  const existingDecision = (existingDecisionRow.data ?? null) as
    | {
        decision?: TakeoffDpgfReviewDecision | null;
        reason?: string | null;
        carried_over_from_version_id: string | null;
        carried_over_at: string | null;
      }
    | null;

  const normalizedReason =
    typeof payload.reason === "string" && payload.reason.trim().length > 0
      ? payload.reason.trim()
      : null;
  const projectId = await getEstimateVersionProjectIdOrThrow({
    supabase,
    tenantId,
    versionId: payload.version_id,
  });
  const dpgfUnitByRowIndex =
    typeof estimateItem.source_page === "number"
      ? await resolveDpgfUnitByRowIndex({
          supabase,
          tenantId,
          projectId,
          sourceFileName: estimateItem.source_file_name,
        })
      : new Map<number, string | null>();
  const reviewReference = buildTakeoffDpgfReviewReference({
    sourceFileName: estimateItem.source_file_name,
    sourcePage: estimateItem.source_page,
    position: estimateItem.position,
    title: estimateItem.title,
    unit:
      typeof estimateItem.source_page === "number"
        ? dpgfUnitByRowIndex.get(estimateItem.source_page) ?? null
        : null,
  });
  const decisionTimestamp = new Date().toISOString();
  let inheritedCarryOverDecision:
    | {
        carried_over_from_version_id: string | null;
        carried_over_at: string | null;
      }
    | null = existingDecision;

  if (!inheritedCarryOverDecision && accessibleJob.linked_from_version_id) {
    const sourceDecisionRow = await supabase
      .from("takeoff_dpgf_review_decisions" as never)
      .select(
        "carried_over_from_version_id, carried_over_at, updated_at" as never
      )
      .eq("tenant_id" as never, tenantId as never)
      .eq("version_id" as never, accessibleJob.linked_from_version_id as never)
      .eq("takeoff_job_id" as never, normalizedJobId as never)
      .eq("review_reference" as never, reviewReference as never)
      .order("updated_at" as never, { ascending: false })
      .maybeSingle();

    if (sourceDecisionRow.error) {
      throw toTakeoffError(
        mapSupabaseError(
          sourceDecisionRow.error,
          "Impossible de charger la décision DPGF source."
        ),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: normalizedJobId,
        }
      );
    }

    if (sourceDecisionRow.data) {
      const sourceDecision = sourceDecisionRow.data as {
        carried_over_from_version_id: string | null;
        carried_over_at: string | null;
        updated_at: string | null;
      };

      inheritedCarryOverDecision = {
        carried_over_from_version_id:
          sourceDecision.carried_over_from_version_id ??
          accessibleJob.linked_from_version_id,
        carried_over_at:
          sourceDecision.carried_over_at ??
          sourceDecision.updated_at ??
          decisionTimestamp,
      };
    }
  }

  const upsertPayload = {
    tenant_id: tenantId,
    version_id: payload.version_id,
    takeoff_job_id: normalizedJobId,
    estimate_item_id: payload.estimate_item_id,
    review_reference: reviewReference,
    line_label: estimateItem.title,
    line_position: estimateItem.position,
    source_file_name: estimateItem.source_file_name,
    source_page: estimateItem.source_page,
    carried_over_from_version_id:
      inheritedCarryOverDecision?.carried_over_from_version_id ?? null,
    carried_over_at: inheritedCarryOverDecision?.carried_over_at ?? null,
    decision: payload.decision,
    reason: normalizedReason,
    decided_at: decisionTimestamp,
    updated_at: decisionTimestamp,
    decided_by: userId,
  };

  const { data, error } = await supabase
    .from("takeoff_dpgf_review_decisions" as never)
    .upsert(upsertPayload as never, {
      onConflict: "tenant_id,version_id,takeoff_job_id,estimate_item_id",
    })
    .select(TAKEOFF_DPGF_REVIEW_DECISIONS_SELECT as never)
    .single();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible d'enregistrer la décision DPGF."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  const savedDecisionRow = data as unknown;
  const carriedOverVersionId =
    isRecord(savedDecisionRow) &&
    typeof savedDecisionRow.carried_over_from_version_id === "string"
      ? savedDecisionRow.carried_over_from_version_id
      : null;
  const carriedOverVersionNumberById = await getEstimateVersionNumbersById({
    supabase,
    tenantId,
    versionIds: carriedOverVersionId ? [carriedOverVersionId] : [],
  });
  const decision = buildTakeoffDpgfReviewDecisionRecord({
    row: savedDecisionRow,
    carriedOverVersionNumberById,
  });

  await logTakeoffAuditEvent({
    supabase,
    tenantId,
    userId,
    jobId: normalizedJobId,
    estimateVersionId: payload.version_id,
    action: "takeoff.dpgf.review_decision",
    metadata: takeoffAuditMetadataBuilders["takeoff.dpgf.review_decision"]({
      estimate_item_id: payload.estimate_item_id,
      review_reference: reviewReference,
      previous_decision: existingDecision?.decision ?? null,
      next_decision: payload.decision,
      previous_reason: existingDecision?.reason ?? null,
      next_reason: normalizedReason,
    }),
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

  return {
    decision,
  };
}

export async function updateTakeoffRiskAlertStatus(
  jobId: string,
  alertId: string,
  input: UpdateTakeoffRiskAlertStatusInput
): Promise<UpdateTakeoffRiskAlertStatusResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const normalizedAlertId = parseWithSchema(
    z.string().uuid("alert_id invalide."),
    alertId,
    "alert_id invalide."
  );
  const payload = parseWithSchema(
    updateTakeoffRiskAlertStatusSchema,
    input,
    "Payload de statut risque invalide."
  );

  await assertTakeoffJobAccessibleForVersion({
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
  });

  const { data: alertRow, error: alertError } = await supabase
    .from("estimate_risk_alerts" as never)
    .select(ESTIMATE_RISK_ALERTS_SELECT as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, normalizedAlertId as never)
    .eq("version_id" as never, payload.version_id as never)
    .eq("takeoff_job_id" as never, normalizedJobId as never)
    .eq("is_active" as never, true as never)
    .maybeSingle();

  if (alertError) {
    throw toTakeoffError(
      mapSupabaseError(alertError, "Impossible de charger l'alerte de risque."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  if (!alertRow) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Alerte de risque introuvable.",
      details: {
        alert_id: normalizedAlertId,
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const now = new Date().toISOString();
  const normalizedReviewNote =
    payload.status === "to_process"
      ? null
      : payload.review_note?.trim().length
        ? payload.review_note.trim()
        : null;
  const { data, error } = await supabase
    .from("estimate_risk_alerts" as never)
    .update(
      {
        status: payload.status,
        review_note: normalizedReviewNote,
        reviewed_at: payload.status === "to_process" ? null : now,
        reviewed_by: payload.status === "to_process" ? null : userId,
        updated_at: now,
      } as never
    )
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, normalizedAlertId as never)
    .select(ESTIMATE_RISK_ALERTS_SELECT as never)
    .single();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de mettre à jour l'alerte de risque."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: normalizedJobId,
      }
    );
  }

  const alert = normalizeRiskAlertRow((data ?? null) as Record<string, unknown>);
  if (!alert) {
    throw unprocessableEntity(
      "Alerte de risque invalide en base après mise à jour.",
      {
        alert_id: normalizedAlertId,
      },
      "VALIDATION_ERROR"
    );
  }

  return {
    alert,
  };
}

async function buildTakeoffMappingPreviewForJob(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  jobId: string;
  request: TakeoffApplyRequest;
}): Promise<TakeoffPreviewConversionResponse> {
  const [items, rules] = await Promise.all([
    listAllTakeoffItemsByJobId({
      supabase: input.supabase,
      tenantId: input.tenantId,
      jobId: input.jobId,
    }),
    listActiveTakeoffMappingRules({
      supabase: input.supabase,
      tenantId: input.tenantId,
    }),
  ]);

  const preview = computeTakeoffMappingPreview({
    items,
    rules,
    overrides: input.request.overrides,
  });

  return parseWithSchema(
    takeoffPreviewConversionResponseSchema,
    {
      job_id: input.jobId,
      strategy: input.request.strategy,
      target_section_id: input.request.target_section_id ?? null,
      summary: preview.summary,
      items: preview.items,
    },
    "Preview de conversion mapping invalide."
  );
}

export async function previewTakeoffJobConversion(
  jobId: string,
  body: unknown
): Promise<TakeoffPreviewConversionResponse> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const request = parseApplyTakeoffPayload(body);
  const jobRow = await getTakeoffJobDetailByIdOrThrow({
    supabase,
    tenantId,
    jobId: normalizedJobId,
  });

  if (jobRow.status !== "completed") {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job doit être en statut completed pour calculer une preview.",
      details: {
        current_status: jobRow.status,
        allowed_statuses: ["completed"],
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  return buildTakeoffMappingPreviewForJob({
    supabase,
    tenantId,
    jobId: normalizedJobId,
    request,
  });
}

async function assertTakeoffApplyDraftLockOwnership(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  estimateVersionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select("id, updated_at" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.estimateVersionId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de vérifier le verrou brouillon de la version cible."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const row = (data ?? null) as { id: string; updated_at: string | null } | null;
  if (!row) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version de chiffrage introuvable.",
      details: {
        estimate_version_id: input.estimateVersionId,
      },
      retryable: false,
    });
  }

  const concurrencyToken = row.updated_at;
  if (!concurrencyToken) {
    throw new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "Jeton de concurrence introuvable pour la version de chiffrage.",
      details: {
        estimate_version_id: input.estimateVersionId,
      },
      retryable: false,
    });
  }

  await bulkUpdateEstimateItems(input.estimateVersionId, [], concurrencyToken);
}

async function logTakeoffMappingApplyAuditEvents(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  userId: string;
  jobId: string;
  estimateVersionId: string;
  previewItems: TakeoffMappingPreviewItem[];
  estimateLineByItemId: Map<string, string | null>;
}) {
  for (const previewItem of input.previewItems) {
    if (previewItem.action === "none" || previewItem.original.is_excluded) {
      continue;
    }

    await logTakeoffAuditEvent({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      jobId: input.jobId,
      estimateVersionId: input.estimateVersionId,
      action: "takeoff.mapping.applied",
      metadata: takeoffAuditMetadataBuilders["takeoff.mapping.applied"]({
        job_id: input.jobId,
        item_id: previewItem.item_id,
        rule_id: previewItem.rule_id,
        action: previewItem.action,
        estimate_item_id: input.estimateLineByItemId.get(previewItem.item_id) ?? null,
      }),
      tableName: "takeoff_items",
      mode: "non-blocking",
    });
  }
}

export async function applyTakeoffJob(
  jobId: string,
  body: unknown
): Promise<TakeoffApplyResponse> {
  let normalizedJobId: string | undefined;
  let auditContext:
    | {
        supabase: AuthenticatedTakeoffContext["supabase"];
        tenantId: string;
        userId: string;
        estimateVersionId: string;
      }
    | undefined;

  try {
    const { supabase, tenantId, userId, tenantRole } =
      await getAuthenticatedTakeoffContext();
    normalizedJobId = parseWithSchema(
      takeoffJobIdSchema,
      jobId,
      "Identifiant job invalide."
    );
    const payload = parseApplyTakeoffPayload(body);

    if (payload.strategy === "replace" && !payload.target_section_id) {
      throw new TakeoffError({
        status: 422,
        code: TakeoffErrorCode.VALIDATION_ERROR,
        message:
          "Le remplacement complet du devis est désactivé : choisissez une section pour limiter l’application et protéger le chiffrage existant.",
        details: {
          guard: "root_replace_disabled",
          strategy: payload.strategy,
          target_section_id: null,
        },
        retryable: false,
        jobId: normalizedJobId,
      });
    }

    const jobRow = await getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedJobId,
    });

    auditContext = {
      supabase,
      tenantId,
      userId,
      estimateVersionId: jobRow.estimate_version_id,
    };

    if (jobRow.status !== "completed") {
      throw new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "Le job doit être en statut completed pour être appliqué.",
        details: {
          current_status: jobRow.status,
          allowed_statuses: ["completed"],
        },
        retryable: false,
        jobId: normalizedJobId,
      });
    }

    const hasDpgfTargetLines = await hasTakeoffDpgfTargetLines({
      supabase,
      tenantId,
      versionId: jobRow.estimate_version_id,
    });

    const mappingPreview = await buildTakeoffMappingPreviewForJob({
      supabase,
      tenantId,
      jobId: normalizedJobId,
      request: payload,
    });

    // Guard: Level C requires low-confidence items to be verified
    if (jobRow.level === "C") {
      const lowConfidenceThreshold = await getTakeoffLowConfidenceThresholdForTenant(
        tenantId,
        { supabase }
      );
      const { data: guardItems, error: guardItemsError } = await readAllRows(() => supabase
        .from("takeoff_items" as never)
        .select(
          "id, designation, confidence, evidence, source_page, is_verified, is_excluded" as never,
          { count: "exact" }
        )
        .eq("tenant_id" as never, tenantId as never)
        .eq("job_id" as never, normalizedJobId as never));

      if (guardItemsError) {
        throw toTakeoffError(
          mapSupabaseError(guardItemsError, "Impossible de vérifier les items pour le guard."),
          { jobId: normalizedJobId }
        );
      }

      const guardResult = checkApplyGuard(
        guardItems as Array<{
          id: string;
          designation: string;
          confidence: number | null;
          evidence: string | null;
          source_page: number | null;
          is_verified: boolean;
          is_excluded: boolean;
        }>,
        lowConfidenceThreshold
      );

      if (!guardResult.passed) {
        if (payload.override === true) {
          assertTakeoffApplyOverrideAdminRole(tenantRole);
          const overrideJustification = payload.override_justification?.trim();

          if (!overrideJustification) {
            throw new TakeoffError({
              status: 422,
              code: TakeoffErrorCode.BAD_REQUEST,
              message:
                "override_justification est obligatoire pour un override admin.",
              retryable: false,
              jobId: normalizedJobId,
            });
          }

          await logTakeoffAuditEvent({
            supabase,
            tenantId,
            userId,
            jobId: normalizedJobId,
            estimateVersionId: jobRow.estimate_version_id,
            action: "takeoff.apply.override",
            metadata: takeoffAuditMetadataBuilders["takeoff.apply.override"]({
              estimate_version_id: jobRow.estimate_version_id,
              threshold: guardResult.threshold,
              blocked_item_ids: guardResult.blocked_items.map((i) => i.item_id),
              blocked_items_count: guardResult.blocked_items.length,
              justification: overrideJustification,
            }),
            mode: "fail-hard",
          });
        } else {
          throw new TakeoffError({
            code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
            status: 422,
            details: {
              blocked_items: guardResult.blocked_items,
              medium_items: guardResult.medium_items,
              threshold: guardResult.threshold,
            },
            retryable: false,
            jobId: normalizedJobId,
          });
        }
      }
    }

    await logTakeoffAuditEvent({
      supabase,
      tenantId,
      userId,
      jobId: normalizedJobId,
      estimateVersionId: jobRow.estimate_version_id,
      action: "takeoff.apply.started",
      metadata: takeoffAuditMetadataBuilders["takeoff.apply.started"]({
        estimate_version_id: jobRow.estimate_version_id,
        selected_items_count: mappingPreview.summary.included_count,
      }),
      mode: "non-blocking",
    });

    await assertTakeoffApplyDraftLockOwnership({
      supabase,
      tenantId,
      estimateVersionId: jobRow.estimate_version_id,
    });

    let dpgfAuthorizationToken: string | null = null;
    let rpcData: unknown;

    try {
      if (hasDpgfTargetLines) {
        const comparisonContext = await loadTakeoffDpgfComparisonContext({
          auth: { supabase, tenantId, userId },
          jobId: normalizedJobId,
          versionId: jobRow.estimate_version_id,
        });
        const dpgfComparison = await fetchDpgfTakeoffComparisonForContext(comparisonContext, {
          version_id: jobRow.estimate_version_id,
          page_size: 1,
          view: "all",
        });

        if (hasBlockingTakeoffDpgfExceptions(dpgfComparison.summary)) {
          throw new TakeoffError({
            code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
            status: 422,
            message:
              "Le rapprochement DPGF contient encore des écarts ou des preuves à traiter. Revenez à la revue avant d’appliquer le métré.",
            details: {
              guard: "dpgf_comparison",
              dpgf_summary: dpgfComparison.summary,
            },
            retryable: false,
            jobId: normalizedJobId,
          });
        }

        dpgfAuthorizationToken = await issueTakeoffDpgfApplyAuthorization({
          tenantId,
          userId,
          jobId: normalizedJobId,
          estimateVersionId: jobRow.estimate_version_id,
          summary: dpgfComparison.summary,
        });
      }

      const rpcAttempt = await invokeApplyTakeoffRpc({
        supabase,
        args: {
          job_id: normalizedJobId,
          strategy: payload.strategy,
          target_section_id: payload.target_section_id ?? null,
          mapping_plan: buildTakeoffAtomicMappingPlan(mappingPreview.items),
          dpgf_authorization_token: dpgfAuthorizationToken,
        },
      });

      if (rpcAttempt.error) {
        throw mapApplyTakeoffRpcError(rpcAttempt.error, {
          jobId: normalizedJobId,
        });
      }

      rpcData = rpcAttempt.data;
    } catch (error) {
      if (dpgfAuthorizationToken) {
        await revokeTakeoffDpgfApplyAuthorization({
          authorizationToken: dpgfAuthorizationToken,
          jobId: normalizedJobId,
        });
      }
      throw error;
    }

    const summary = normalizeTakeoffApplySummary({
      rpcData,
      request: payload,
      jobId: normalizedJobId,
    });

    const hasAuditableMappingTransformations = mappingPreview.items.some(
      (item) => !item.original.is_excluded && item.action !== "none"
    );
    if (hasAuditableMappingTransformations) {
      const estimateLineByItemId = new Map(
        summary.item_links.map((link) => [
          link.takeoff_item_id,
          link.estimate_item_id,
        ])
      );
      await logTakeoffMappingApplyAuditEvents({
        supabase,
        tenantId,
        userId,
        jobId: normalizedJobId,
        estimateVersionId: jobRow.estimate_version_id,
        previewItems: mappingPreview.items,
        estimateLineByItemId,
      });
    }

    const updatedJobRow = await getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedJobId,
    });

    if (updatedJobRow.status !== "applied") {
      throw new TakeoffError({
        status: 500,
        code: TakeoffErrorCode.INTERNAL_ERROR,
        message: "Le job takeoff n'est pas dans le statut attendu après apply.",
        details: {
          expected_status: "applied",
          current_status: updatedJobRow.status,
        },
        retryable: false,
        jobId: normalizedJobId,
      });
    }

    await logTakeoffAuditEvent({
      supabase,
      tenantId,
      userId,
      jobId: normalizedJobId,
      estimateVersionId: jobRow.estimate_version_id,
      action: "takeoff.apply.completed",
      metadata: takeoffAuditMetadataBuilders["takeoff.apply.completed"]({
        estimate_version_id: jobRow.estimate_version_id,
        applied_items_count: summary.created_count + summary.updated_count,
        excluded_items_count: summary.ignored_count,
      }),
      mode: "non-blocking",
    });

    return {
      job: normalizeTakeoffJobSummaryRow(updatedJobRow, tenantRole),
      summary,
    };
  } catch (error) {
    const mappedError = toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      fallbackMessage: "Impossible d'appliquer le job takeoff.",
      jobId: normalizedJobId,
    });

    if (auditContext && normalizedJobId) {
      await logTakeoffAuditEvent({
        supabase: auditContext.supabase,
        tenantId: auditContext.tenantId,
        userId: auditContext.userId,
        jobId: normalizedJobId,
        estimateVersionId: auditContext.estimateVersionId,
        action: "takeoff.apply.failed",
        metadata: takeoffAuditMetadataBuilders["takeoff.apply.failed"]({
          estimate_version_id: auditContext.estimateVersionId,
          error_code:
            typeof mappedError.code === "string" ? mappedError.code : null,
          error_message: mappedError.message,
          retryable: mappedError.retryable,
        }),
        mode: "non-blocking",
      });
    }

    throw mappedError;
  }
}

const TAKEOFF_ITEM_BATCH_MAX = 100;

const takeoffItemPatchFieldSchema = z
  .object({
    designation: z.string().trim().min(1, "designation ne peut pas être vide.").max(500).optional(),
    quantity: z.number().finite().positive("quantity doit être > 0.").optional(),
    unit: z.string().trim().min(1, "unit ne peut pas être vide.").max(64).optional(),
    source_page: z.number().int().positive("source_page doit être > 0.").nullable().optional(),
    is_excluded: z.boolean().optional(),
    exclusion_reason: z.string().trim().min(1).max(500).nullable().optional(),
    is_verified: z.boolean().optional(),
    evidence: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (fields) => Object.keys(fields).length > 0,
    { message: "Au moins un champ de mise à jour est requis." }
  )
  .refine(
    (fields) => {
      if (fields.is_excluded === true && !fields.exclusion_reason) {
        return false;
      }
      return true;
    },
    { message: "exclusion_reason est obligatoire quand is_excluded = true." }
  );

export const takeoffItemBatchPatchSchema = z
  .object({
    items: z
      .array(
        z.object({
          item_id: z.string().uuid("item_id invalide."),
          updated_at: z.string().min(1, "updated_at est requis."),
          fields: takeoffItemPatchFieldSchema,
        })
      )
      .min(1, "Au moins un item est requis.")
      .max(TAKEOFF_ITEM_BATCH_MAX, `Maximum ${TAKEOFF_ITEM_BATCH_MAX} items par batch.`),
  })
  .strict();

export async function batchUpdateTakeoffItems(
  jobId: string,
  body: unknown
): Promise<TakeoffItemBatchPatchResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const normalizedJobId = parseWithSchema(
    takeoffJobIdSchema,
    jobId,
    "Identifiant job invalide."
  );
  const request = parseWithSchema(
    takeoffItemBatchPatchSchema,
    body,
    "Payload de mise à jour invalide."
  ) as TakeoffItemBatchPatchRequest;

  // Verify job exists, same tenant, status completed
  const jobRow = await getTakeoffJobDetailByIdOrThrow({
    supabase,
    tenantId,
    jobId: normalizedJobId,
  });

  if (jobRow.status !== "completed") {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job doit être en statut completed pour modifier les items.",
      details: {
        current_status: jobRow.status,
        allowed_statuses: ["completed"],
      },
      retryable: false,
      jobId: normalizedJobId,
    });
  }

  const results: TakeoffItemPatchResult[] = [];

  for (const entry of request.items) {
    try {
      // Fetch current item
      const { data: currentItem, error: fetchError } = await supabase
        .from("takeoff_items" as never)
        .select(TAKEOFF_ITEMS_SELECT as never)
        .eq("id" as never, entry.item_id as never)
        .eq("job_id" as never, normalizedJobId as never)
        .eq("tenant_id" as never, tenantId as never)
        .maybeSingle();

      if (fetchError) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Impossible de charger l'item.",
        });
        continue;
      }

      if (!currentItem) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Item introuvable.",
        });
        continue;
      }

      const typedItem = currentItem as TakeoffItemRow;

      // OCC check
      if (typedItem.updated_at !== entry.updated_at) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Conflit de concurrence: l'item a été modifié depuis votre dernière lecture.",
        });
        continue;
      }

      if (jobRow.level === "C" && entry.fields.is_verified === true) {
        const verificationReadiness = getTakeoffVerificationReadiness({
          evidence:
            entry.fields.evidence !== undefined
              ? entry.fields.evidence
              : typedItem.evidence,
          source_page:
            entry.fields.source_page !== undefined
              ? entry.fields.source_page
              : typedItem.source_page,
        });

        if (!verificationReadiness.canVerify) {
          results.push({
            item_id: entry.item_id,
            success: false,
            error:
              verificationReadiness.message ??
              "Une preuve localisée est requise avant validation.",
          });
          continue;
        }
      }

      // Build update payload
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      const auditFields: Array<{
        field: string;
        previous: unknown;
        next: unknown;
      }> = [];

      if (entry.fields.designation !== undefined) {
        auditFields.push({
          field: "designation",
          previous: typedItem.designation,
          next: entry.fields.designation,
        });
        updatePayload.designation = entry.fields.designation;
      }

      if (entry.fields.quantity !== undefined) {
        auditFields.push({
          field: "quantity",
          previous: typedItem.quantity,
          next: entry.fields.quantity,
        });
        updatePayload.quantity = entry.fields.quantity;
      }

      if (entry.fields.unit !== undefined) {
        auditFields.push({
          field: "unit",
          previous: typedItem.unit,
          next: entry.fields.unit,
        });
        updatePayload.unit = entry.fields.unit;
      }

      if (entry.fields.source_page !== undefined) {
        auditFields.push({
          field: "source_page",
          previous: typedItem.source_page,
          next: entry.fields.source_page,
        });
        updatePayload.source_page = entry.fields.source_page;
      }

      if (entry.fields.is_excluded !== undefined) {
        auditFields.push({
          field: "is_excluded",
          previous: typedItem.is_excluded,
          next: entry.fields.is_excluded,
        });
        updatePayload.is_excluded = entry.fields.is_excluded;

        if (entry.fields.is_excluded) {
          updatePayload.exclusion_reason =
            entry.fields.exclusion_reason ?? null;
        } else {
          updatePayload.exclusion_reason = null;
        }
      } else if (entry.fields.exclusion_reason !== undefined) {
        updatePayload.exclusion_reason = entry.fields.exclusion_reason;
      }

      if (entry.fields.is_verified !== undefined) {
        auditFields.push({
          field: "is_verified",
          previous: typedItem.is_verified,
          next: entry.fields.is_verified,
        });
        updatePayload.is_verified = entry.fields.is_verified;

        if (entry.fields.is_verified) {
          updatePayload.verified_at = new Date().toISOString();
          updatePayload.verified_by = userId;
        } else {
          updatePayload.verified_at = null;
          updatePayload.verified_by = null;
        }
      }

      if (entry.fields.evidence !== undefined) {
        auditFields.push({
          field: "evidence",
          previous: typedItem.evidence,
          next: entry.fields.evidence,
        });
        updatePayload.evidence = entry.fields.evidence;
      }

      const editsVerifiedContent = (
        [
          "designation",
          "quantity",
          "unit",
          "source_page",
          "is_excluded",
          "exclusion_reason",
          "evidence",
        ] as const
      ).some((field) => entry.fields[field] !== undefined);
      if (
        typedItem.is_verified &&
        editsVerifiedContent &&
        entry.fields.is_verified === undefined
      ) {
        auditFields.push({
          field: "is_verified",
          previous: true,
          next: false,
        });
        updatePayload.is_verified = false;
        updatePayload.verified_at = null;
        updatePayload.verified_by = null;
      }

      // Execute update
      const { data: updatedData, error: updateError } = await supabase
        .from("takeoff_items" as never)
        .update(updatePayload as never)
        .eq("id" as never, entry.item_id as never)
        .eq("job_id" as never, normalizedJobId as never)
        .eq("tenant_id" as never, tenantId as never)
        .eq("updated_at" as never, entry.updated_at as never)
        .select(TAKEOFF_ITEMS_SELECT as never)
        .maybeSingle();

      if (updateError) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Impossible de mettre à jour l'item.",
        });
        continue;
      }

      if (!updatedData) {
        results.push({
          item_id: entry.item_id,
          success: false,
          error: "Conflit de concurrence: l'item a été modifié depuis votre dernière lecture.",
        });
        continue;
      }

      const updatedItem = normalizeTakeoffItemRow(updatedData as TakeoffItemRow);

      await Promise.all(
        auditFields.map((audit) => {
          if (audit.field === "is_excluded" && audit.next === true) {
            return logTakeoffAuditEvent({
              supabase,
              tenantId,
              userId,
              jobId: normalizedJobId,
              estimateVersionId: jobRow.estimate_version_id,
              action: "takeoff.item.excluded",
              metadata: takeoffAuditMetadataBuilders["takeoff.item.excluded"]({
                item_id: entry.item_id,
                reason: entry.fields.exclusion_reason ?? null,
              }),
              tableName: "takeoff_items",
              mode: "non-blocking",
            });
          }

          return logTakeoffAuditEvent({
            supabase,
            tenantId,
            userId,
            jobId: normalizedJobId,
            estimateVersionId: jobRow.estimate_version_id,
            action: "takeoff.item.modified",
            metadata: takeoffAuditMetadataBuilders["takeoff.item.modified"]({
              item_id: entry.item_id,
              field: audit.field,
              previous_value: audit.previous as null,
              next_value: audit.next as null,
            }),
            tableName: "takeoff_items",
            mode: "non-blocking",
          });
        })
      );

      results.push({
        item_id: entry.item_id,
        success: true,
        item: updatedItem,
      });
    } catch {
      results.push({
        item_id: entry.item_id,
        success: false,
        error: "Erreur interne lors de la mise à jour de l'item.",
      });
    }
  }

  return {
    results,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
  };
}

export {
  createTakeoffMappingRule,
  deleteTakeoffMappingRule,
  listTakeoffMappingRules,
  updateTakeoffMappingRule,
} from "@/lib/takeoff/mapping-rules-server";
