import "server-only";

import { randomUUID } from "node:crypto";
import { forbidden } from "@/lib/estimates/errors";
import { bulkUpdateEstimateItems } from "@/lib/estimates/item-bulk-server";
import {
  getAuthenticatedTakeoffContext,
  getTakeoffJobDetailByIdOrThrow,
  normalizeTakeoffJobSummaryRow,
  type AuthenticatedTakeoffContext,
} from "@/lib/takeoff/job-read-server";
import { buildTakeoffAtomicMappingPlan, normalizeTakeoffApplySummary } from "@/lib/takeoff/apply-preparation";
import { mapApplyTakeoffRpcError } from "@/lib/takeoff/apply-errors";
import {
  invokeApplyTakeoffRpc,
  issueTakeoffDpgfApplyAuthorization,
  listTakeoffApplyGuardItems,
  loadTakeoffApplyConcurrencyToken,
  logTakeoffMappingApplyAuditEvents,
  revokeTakeoffDpgfApplyAuthorization,
} from "@/lib/takeoff/apply-repository";
import { buildTakeoffMappingPreviewForJob } from "@/lib/takeoff/mapping-preview-server";
import { hasTakeoffDpgfTargetLines } from "@/lib/takeoff/dpgf-comparison-repository";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { fetchDpgfTakeoffComparisonForContext } from "@/lib/takeoff/dpgf-comparison-server";
import { hasBlockingTakeoffDpgfExceptions } from "@/lib/takeoff/dpgf-compare";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { checkApplyGuard } from "@/lib/takeoff/guards";
import { getTakeoffLowConfidenceThresholdForTenant } from "@/lib/takeoff/feature-flags";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { parseApplyTakeoffPayload } from "@/lib/takeoff/query-parsers";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema, TAKEOFF_TENANT_ADMIN_ROLE } from "@/lib/takeoff/server-helpers";
import type { TakeoffApplyResponse } from "@/lib/takeoff/types";

function assertTakeoffApplyOverrideAdminRole(tenantRole: string) {
  if (tenantRole === TAKEOFF_TENANT_ADMIN_ROLE) return;

  throw forbidden(
    "Seul un administrateur peut forcer l'application des items non vérifiés."
  );
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
      const guardItems = await listTakeoffApplyGuardItems({
        supabase,
        tenantId,
        jobId: normalizedJobId,
      });
      const guardResult = checkApplyGuard(guardItems, lowConfidenceThreshold);

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

    const concurrencyToken = await loadTakeoffApplyConcurrencyToken({
      supabase,
      tenantId,
      estimateVersionId: jobRow.estimate_version_id,
    });
    // An empty bulk mutation retains estimate authorization, draft lock and OCC checks.
    await bulkUpdateEstimateItems(jobRow.estimate_version_id, [], concurrencyToken);

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
          authorizationToken: randomUUID(),
          nowMs: Date.now(),
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
