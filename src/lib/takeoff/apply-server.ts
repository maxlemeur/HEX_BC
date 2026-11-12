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
  loadTakeoffQuantityComparisonStamp,
  listTakeoffApplyGuardItems,
  listTakeoffRulePartnerExclusions,
  loadTakeoffApplyConcurrencyToken,
  logTakeoffMappingApplyAuditEvents,
  revokeTakeoffDpgfApplyAuthorization,
} from "@/lib/takeoff/apply-repository";
import { buildTakeoffMappingPreviewForJob } from "@/lib/takeoff/mapping-preview-server";
import { hasTakeoffDpgfTargetLines } from "@/lib/takeoff/dpgf-comparison-repository";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { fetchAllTakeoffDpgfComparisonRows } from "@/lib/takeoff/dpgf-comparison-server";
import { buildDpgfApplyQuantityPolicy } from "@/lib/takeoff/dpgf-apply-quantities";
import { dpgfApplyCompositions } from "@/lib/takeoff/dpgf-composition-server";
import { hasBlockingTakeoffDpgfExceptions } from "@/lib/takeoff/dpgf-compare";
import { excludeDpgfOutOfScope } from "@/lib/takeoff/apply-plan-exclusions";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { checkApplyGuard, type GuardBlockedItem } from "@/lib/takeoff/guards";
import { FORCE_MESSAGES, forcedItemError, packForcedItems, type ForcedEntry } from "@/lib/takeoff/force-reasons";
import { failurePartners, isLineId, leftOutByPartners } from "@/lib/takeoff/rules/partner-exclusions";
import { recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import { getTakeoffLowConfidenceThresholdForTenant } from "@/lib/takeoff/feature-flags";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { parseApplyTakeoffPayload } from "@/lib/takeoff/query-parsers";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema, TAKEOFF_TENANT_ADMIN_ROLE } from "@/lib/takeoff/server-helpers";
import type { TakeoffApplyRequest, TakeoffApplyResponse } from "@/lib/takeoff/types";

/**
 * A blocked item as the guard error carries it: the error details keep four levels (sanitizeUnknown), so the failed
 * rules are flattened into their codes and reasons, in one order.
 */
function blockedItemDetails({ rule_failures: failures, ...item }: GuardBlockedItem) {
  return failures ? { ...item, rule_codes: failures.map((failure) => failure.code), rule_reasons: failures.map((failure) => failure.reason) } : item;
}

/**
 * TI-686 D10 (H7): the override's entry of each blocked line, checked against the line as the guard read it; the entries
 * of lines that do not block are left out, the lines sorted and each justification stored once. A blocked line without
 * an entry, or whose entry does not hold, refuses the override before any audit (422, guard « override_reasons »).
 */
function forcedOverride(blocked: readonly GuardBlockedItem[], payload: TakeoffApplyRequest, jobId: string) {
  const justifications = payload.forced_justifications ?? [];
  const entries = new Map((payload.forced_items ?? []).map((entry) => [entry.item_id.toLowerCase(), entry]));
  const missing_item_ids: string[] = [];
  const invalid_items: Array<{ item_id: string; error: string }> = [];
  const forced: ForcedEntry[] = [];
  for (const line of blocked) {
    const entry = entries.get(line.item_id.toLowerCase());
    if (!entry) {
      missing_item_ids.push(line.item_id);
      continue;
    }
    const error = forcedItemError(line, entry, justifications);
    if (error) {
      invalid_items.push({ item_id: line.item_id, error });
      continue;
    }
    forced.push({ item_id: line.item_id, reason_code: entry.reason_code, false_positive_rules: entry.false_positive_rules,
      justification: justifications[entry.justification_index] });
  }
  if (missing_item_ids.length > 0 || invalid_items.length > 0) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: FORCE_MESSAGES.overrideReasons,
      details: { guard: "override_reasons", missing_item_ids, invalid_items },
      retryable: false,
      jobId,
    });
  }
  return packForcedItems(forced);
}

function assertTakeoffApplyOverrideAdminRole(tenantRole: string) {
  if (tenantRole === TAKEOFF_TENANT_ADMIN_ROLE) return;

  throw forbidden(
    "Seul un administrateur peut forcer l'application des lignes bloquées."
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

    // Guard, on every level (TI-664): the fixed rules' results, computed again first so that a line edited without
    // the review holds its current results; on level C also low confidence, proof and page. The lines the mapping
    // plan skips or folds into an assembly are excluded by the RPC before the trigger counts: here too.
    await recomputeTakeoffRulesQuietly({ tenantId, estimateVersionId: jobRow.estimate_version_id, context: "apply" });
    const quantityComparisonStamp = hasDpgfTargetLines ? await loadTakeoffQuantityComparisonStamp(tenantId, jobRow.estimate_version_id) : undefined;
    const comparisonContext = hasDpgfTargetLines ? await loadTakeoffDpgfComparisonContext({
      auth: { supabase, tenantId, userId }, jobId: normalizedJobId, versionId: jobRow.estimate_version_id,
    }) : null;
    excludeDpgfOutOfScope(mappingPreview, comparisonContext);
    {
      const lowConfidenceThreshold = await getTakeoffLowConfidenceThresholdForTenant(
        tenantId,
        { supabase }
      );
      const plannedExclusions = new Set(mappingPreview.items
        .filter((item) => item.action === "skip" || item.action === "apply_assembly").map((item) => item.item_id));
      const guardItems = (await listTakeoffApplyGuardItems({
        supabase,
        tenantId,
        jobId: normalizedJobId,
      })).map((item) => (plannedExclusions.has(item.id) ? { ...item, is_excluded: true } : item));
      // A cross-line failure no longer blocks once all its partners are left out (TI-677): the job's own lines with
      // the plan's exclusions, the partners of other jobs as the database holds them now (as the trigger reads them).
      // Only line ids reach the query (any other stored value keeps its failure blocking), read lower case as stored.
      const ownIds = new Set(guardItems.map((item) => item.id.toLowerCase()));
      const outsidePartners = [...new Set(guardItems.flatMap((item) => (item.is_excluded ? [] : item.rule_results ?? [])
        .flatMap((result) => (result.status === "fail" ? failurePartners(result)?.ids ?? [] : []))
        .filter(isLineId).map((id) => id.toLowerCase()).filter((id) => !ownIds.has(id))))];
      const partnerExclusions = outsidePartners.length > 0
        ? await listTakeoffRulePartnerExclusions({ supabase, tenantId, itemIds: outsidePartners }) : undefined;
      const guardResult = checkApplyGuard(guardItems, lowConfidenceThreshold,
        { level: jobRow.level, partnerExclusions, leftOut: leftOutByPartners });

      if (!guardResult.passed) {
        if (payload.override === true) {
          assertTakeoffApplyOverrideAdminRole(tenantRole);
          const forced = forcedOverride(guardResult.blocked_items, payload, normalizedJobId);

          // Bound to each lifted line's state (TI-677 PR D): the trigger refuses the override once one of them changed.
          const states = new Map(guardItems.map((item) => [item.id, item.override_state]));
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
              blocked_items_state: guardResult.blocked_items.flatMap((i) => {
                const state = states.get(i.item_id);
                return state ? [state] : [];
              }),
              ...forced,
            }),
            mode: "fail-hard",
          });
        } else {
          throw new TakeoffError({
            code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
            status: 422,
            details: {
              blocked_items: guardResult.blocked_items.map(blockedItemDetails),
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
      if (comparisonContext) {
        const dpgfComparison = await fetchAllTakeoffDpgfComparisonRows({ context: comparisonContext });

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
          quantityPolicy: buildDpgfApplyQuantityPolicy(comparisonContext, dpgfComparison.rows),
          // TI-682 D4: the version 1 policies the application keeps when it sums or takes a page out.
          compositions: dpgfApplyCompositions(comparisonContext.compositions),
          quantitySources: comparisonContext.takeoffItems.map(item => ({ id: item.id, updated_at: item.updated_at,
            quantity: item.quantity, designation: item.designation, unit: item.unit, is_excluded: item.is_excluded })),
          quantityComparisonStamp,
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
          // TI-682 lot D: the estimator's decision for each page another takeoff already brought (replace its earlier
          // measure, or keep both with a reason). They travel with the application and are recorded in its own
          // transaction: a request never applies decisions another request recorded meanwhile. Always sent, none
          // included: no decision of an earlier attempt is left behind, and the guard refuses a page already in the estimate.
          page_decisions: payload.page_decisions ?? [],
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

    // Mapping exclusions invalidated the other completed jobs in the transaction. Refresh them after commit,
    // before another review opens; an interrupted computation leaves their stored stale guard intact.
    await recomputeTakeoffRulesQuietly({ tenantId, estimateVersionId: jobRow.estimate_version_id, context: "applied" });

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
