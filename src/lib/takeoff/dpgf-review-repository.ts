import "server-only";

import { z } from "zod";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import {
  TAKEOFF_DPGF_LINKS_SELECT,
  TAKEOFF_DPGF_REVIEW_DECISIONS_SELECT,
  getEstimateVersionNumbersById,
} from "@/lib/takeoff/dpgf-comparison-repository";
import { buildTakeoffDpgfReviewDecisionRecord } from "@/lib/takeoff/dpgf-comparison-preparation";
import {
  requireTakeoffDpgfReviewTarget,
  type buildTakeoffDpgfManualLinkPlan,
  type buildTakeoffDpgfReviewDecisionPlan,
  type TakeoffDpgfExistingDecision,
  type TakeoffDpgfManualLinkItem,
  type TakeoffDpgfReviewDecisionTarget,
  type TakeoffDpgfReviewTarget,
  type TakeoffDpgfSourceDecision,
} from "@/lib/takeoff/dpgf-review-preparation";

type ReviewScope = {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
  estimateItemId: string;
};

function throwReviewReadError(
  error: Parameters<typeof mapSupabaseError>[0] | null,
  message: string,
  jobId: string
) {
  if (error) {
    throw toTakeoffError(mapSupabaseError(error, message), {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      retryable: false,
      jobId,
    });
  }
}

export async function loadTakeoffDpgfManualLinkTargets(
  input: ReviewScope & { takeoffItemIds: string[] }
) {
  const [estimateItemRow, takeoffItemRows] = await Promise.all([
    input.supabase
      .from("estimate_items" as never)
      .select("id, tenant_id, version_id, item_type, source_provider, source_file_name" as never)
      .eq("tenant_id" as never, input.tenantId as never)
      .eq("id" as never, input.estimateItemId as never)
      .maybeSingle(),
    input.takeoffItemIds.length > 0
      ? input.supabase
          .from("takeoff_items" as never)
          .select("id, tenant_id, job_id" as never)
          .eq("tenant_id" as never, input.tenantId as never)
          .in("id" as never, input.takeoffItemIds as never)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Keep the line/version/eligibility failure ahead of the parallel items failure.
  throwReviewReadError(estimateItemRow.error, "Impossible de charger la ligne DPGF.", input.jobId);
  requireTakeoffDpgfReviewTarget({
    ...input,
    estimateItem: estimateItemRow.data as TakeoffDpgfReviewTarget | null,
  });
  throwReviewReadError(takeoffItemRows.error, "Impossible de charger les items takeoff.", input.jobId);
  return ((takeoffItemRows.data ?? []) as TakeoffDpgfManualLinkItem[]).filter(Boolean);
}

export async function saveTakeoffDpgfManualLinkPlan(input: ReviewScope & {
  plan: ReturnType<typeof buildTakeoffDpgfManualLinkPlan>;
}): Promise<unknown[]> {
  const { data: savedLinkIds, error: saveError } = await input.supabase.rpc(
    "save_takeoff_dpgf_manual_links" as never,
    input.plan.rpcArgs as never
  );
  throwReviewReadError(saveError, input.plan.mutationErrorMessage, input.jobId);
  parseWithSchema(
    z.array(z.string().uuid()),
    savedLinkIds ?? [],
    "La réponse save_takeoff_dpgf_manual_links est invalide."
  );

  const { data, error } = await input.supabase
    .from("takeoff_dpgf_links" as never)
    .select(TAKEOFF_DPGF_LINKS_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .eq("estimate_item_id" as never, input.estimateItemId as never)
    .order("created_at" as never, { ascending: true })
    .order("id" as never, { ascending: true });
  throwReviewReadError(error, "Impossible de recharger les liens manuels DPGF.", input.jobId);
  // Normalize after evidence refresh, as in the public mutation's original order.
  return (data ?? []) as unknown[];
}

export async function loadTakeoffDpgfReviewDecisionTarget(input: ReviewScope) {
  const [estimateItemRow, existingDecisionRow] = await Promise.all([
    input.supabase
      .from("estimate_items" as never)
      .select(
        "id, tenant_id, version_id, item_type, source_provider, source_file_name, source_page, position, title, description, quantity" as never
      )
      .eq("tenant_id" as never, input.tenantId as never)
      .eq("id" as never, input.estimateItemId as never)
      .maybeSingle(),
    input.supabase
      .from("takeoff_dpgf_review_decisions" as never)
      .select(TAKEOFF_DPGF_REVIEW_DECISIONS_SELECT as never)
      .eq("tenant_id" as never, input.tenantId as never)
      .eq("version_id" as never, input.versionId as never)
      .eq("takeoff_job_id" as never, input.jobId as never)
      .eq("estimate_item_id" as never, input.estimateItemId as never)
      .maybeSingle(),
  ]);

  throwReviewReadError(estimateItemRow.error, "Impossible de charger la ligne DPGF.", input.jobId);
  const estimateItem = requireTakeoffDpgfReviewTarget({
    ...input,
    estimateItem: estimateItemRow.data as TakeoffDpgfReviewDecisionTarget | null,
  });
  throwReviewReadError(
    existingDecisionRow.error,
    "Impossible de charger la décision DPGF existante.",
    input.jobId
  );
  return {
    estimateItem,
    existingDecision: (existingDecisionRow.data ?? null) as TakeoffDpgfExistingDecision | null,
  };
}

export async function loadTakeoffDpgfSourceDecision(input: {
  supabase: ReviewScope["supabase"];
  tenantId: string;
  jobId: string;
  sourceVersionId: string;
  reviewReference: string;
}): Promise<TakeoffDpgfSourceDecision | null> {
  const { data, error } = await input.supabase
    .from("takeoff_dpgf_review_decisions" as never)
    .select("carried_over_from_version_id, carried_over_at, updated_at" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.sourceVersionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .eq("review_reference" as never, input.reviewReference as never)
    .order("updated_at" as never, { ascending: false })
    .maybeSingle();
  throwReviewReadError(error, "Impossible de charger la décision DPGF source.", input.jobId);
  return (data ?? null) as TakeoffDpgfSourceDecision | null;
}

export async function saveTakeoffDpgfReviewDecisionPlan(input: {
  supabase: ReviewScope["supabase"];
  tenantId: string;
  jobId: string;
  plan: ReturnType<typeof buildTakeoffDpgfReviewDecisionPlan>;
}) {
  const { data, error } = await input.supabase
    .from("takeoff_dpgf_review_decisions" as never)
    .upsert(input.plan.upsertPayload as never, {
      onConflict: "tenant_id,version_id,takeoff_job_id,estimate_item_id",
    })
    .select(TAKEOFF_DPGF_REVIEW_DECISIONS_SELECT as never)
    .single();
  throwReviewReadError(error, "Impossible d'enregistrer la décision DPGF.", input.jobId);

  const savedRow = data as unknown;
  const carriedOverVersionId =
    typeof savedRow === "object" && savedRow !== null && !Array.isArray(savedRow) &&
    "carried_over_from_version_id" in savedRow &&
    typeof savedRow.carried_over_from_version_id === "string"
      ? savedRow.carried_over_from_version_id
      : null;
  const carriedOverVersionNumberById = await getEstimateVersionNumbersById({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionIds: carriedOverVersionId ? [carriedOverVersionId] : [],
  });
  return buildTakeoffDpgfReviewDecisionRecord({
    row: savedRow,
    carriedOverVersionNumberById,
  });
}
