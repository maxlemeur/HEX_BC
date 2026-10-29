import "server-only";

import { z } from "zod";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { loadCanonicalFixedDiscountEvidence } from "@/lib/estimates/fixed-discount-evidence-server";
import { evaluateRules } from "@/lib/estimates/rules-engine";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { fetchAllTakeoffDpgfComparisonRows } from "@/lib/takeoff/dpgf-comparison-server";
import { getAuthenticatedTakeoffContext, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { buildTakeoffRiskRadarResponse } from "@/lib/takeoff/risk-radar";
import {
  buildTakeoffRiskAlertStatusUpdate,
  buildTakeoffRiskRadarProjectionPlan,
  prepareTakeoffRiskCandidates,
} from "@/lib/takeoff/risk-radar-preparation";
import {
  applyTakeoffRiskRadarProjectionPlan,
  assertActiveTakeoffRiskAlertExists,
  listActiveTakeoffRiskAlerts,
  listEstimateRiskItems,
  listExistingRiskAlertRecords,
  loadApplicableMinMarginThresholdBp,
  loadDismissedOutlierFlagsByItemId,
  loadEstimateRiskVersionContext,
  loadStaleSupplierPriceItemIds,
  persistTakeoffRiskAlertStatus,
} from "@/lib/takeoff/risk-radar-repository";
import { takeoffJobIdSchema, updateTakeoffRiskAlertStatusSchema, type TakeoffRiskRadarQuery } from "@/lib/takeoff/schemas";
import { assertTakeoffOperatorActionRole, parseWithSchema } from "@/lib/takeoff/server-helpers";
import type {
  TakeoffDpgfComparisonResponse,
  TakeoffRiskAlert,
  TakeoffRiskRadarResponse,
  UpdateTakeoffRiskAlertStatusInput,
  UpdateTakeoffRiskAlertStatusResponse,
} from "@/lib/takeoff/types";
import { assertTakeoffJobAccessibleForVersion } from "@/lib/takeoff/version-access-server";

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
    now: new Date(),
  });
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
  const { candidates, lotLabelById } = prepareTakeoffRiskCandidates({
    comparisonRows: input.comparisonRows,
    estimateItems,
    versionContext,
    projectId: input.projectId,
    dismissedOutlierFlagsByItemId,
    staleSupplierPriceItemIds,
    applicableMarginThresholdBp,
    hasMinMarginViolation: rulesEvaluation.violations.some((violation) => violation.rule_type === "min_margin"),
    missingPieces: intakeWorkspace.missingPieces,
  });

  const existingAlerts = await listExistingRiskAlertRecords({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    jobId: input.jobId,
  });
  const plan = buildTakeoffRiskRadarProjectionPlan({
    tenantId: input.tenantId,
    projectId: input.projectId,
    versionId: input.versionId,
    jobId: input.jobId,
    candidates,
    existingAlerts,
    now: new Date().toISOString(),
  });
  await applyTakeoffRiskRadarProjectionPlan({
    supabase: input.supabase,
    tenantId: input.tenantId,
    jobId: input.jobId,
    plan,
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
  await assertActiveTakeoffRiskAlertExists({
    supabase,
    tenantId,
    versionId: payload.version_id,
    jobId: normalizedJobId,
    alertId: normalizedAlertId,
  });
  const alert = await persistTakeoffRiskAlertStatus({
    supabase,
    tenantId,
    jobId: normalizedJobId,
    alertId: normalizedAlertId,
    payload: buildTakeoffRiskAlertStatusUpdate({
      payload,
      userId,
      now: new Date().toISOString(),
    }),
  });
  return { alert };
}
