import { badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import type { Supabase } from "@/lib/estimates/item-write-types";
import {
  assertEstimateVersionUnchanged,
  readAllEstimateItems,
} from "@/lib/estimates/read-all-items-server";
import { resolveEmbeddedOne } from "@/lib/estimates/server-context";
import type { EstimateVersionRow } from "@/lib/estimates/version-list-server";
import {
  calculateEstimateTotalsForItems,
  type CalculatedEstimateTotals,
} from "@/lib/estimates/version-totals";

type EstimateRecalculationVersionOverrides = Partial<
  Pick<
    EstimateVersionRow,
    | "margin_multiplier"
    | "margin_mode"
    | "tax_rate_bp"
    | "discount_bp"

    | "discount_amount_cents"
    | "discount_mode"
    | "discount_steps"
    | "global_coefficient"
    | "rounding_mode"
    | "rounding_step_cents"
    | "contractor_role"
  >
>;

type RecalculateEstimateVersionTotalsInput = {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  persist?: boolean;
  versionOverrides?: EstimateRecalculationVersionOverrides;
};

export async function recalculateEstimateVersionTotals(
  input: RecalculateEstimateVersionTotalsInput & { persist: false }
): Promise<{ totals: CalculatedEstimateTotals }>;
export async function recalculateEstimateVersionTotals(
  input: RecalculateEstimateVersionTotalsInput
): Promise<{
  totals: CalculatedEstimateTotals;
  version: { id: string; updated_at: string };
}>;
export async function recalculateEstimateVersionTotals(
  input: RecalculateEstimateVersionTotalsInput
) {
  const { data: versionData, error: versionError } = await input.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, project_id, status, updated_at, content_revision, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, rounding_mode, rounding_step_cents, calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents, contractor_role, estimate_projects!inner(user_id)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .single();

  if (versionError || !versionData) {
    if (versionError) {
      throw mapSupabaseError(
        versionError,
        "Impossible de recalculer les totaux de la version cible."
      );
    }

    throw badRequest("Impossible de recalculer les totaux de la version cible.");
  }

  const versionRecord = versionData as Pick<
    EstimateVersionRow,
    | "id"
    | "tenant_id"
    | "project_id"
    | "status"
    | "updated_at"
    | "content_revision"
    | "margin_multiplier"
    | "margin_mode"
    | "tax_rate_bp"
    | "discount_bp"

    | "discount_amount_cents"
    | "discount_mode"
    | "discount_steps"
    | "global_coefficient"
    | "rounding_mode"
    | "rounding_step_cents"
    | "calc_engine_version"
    | "contractor_role"
  > & {
    estimate_projects: { user_id: string } | { user_id: string }[] | null;
  };
  const effectiveVersionRecord = {
    ...versionRecord,
    ...input.versionOverrides,
  };

  const project = resolveEmbeddedOne(effectiveVersionRecord.estimate_projects);
  if (!project) {
    throw badRequest("Impossible de recalculer les totaux de la version cible.");
  }

  const items = await readAllEstimateItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

  const totals = await calculateEstimateTotalsForItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectUserId: project.user_id,
    version: effectiveVersionRecord,
    lineItems: items.filter((item) => item.item_type === "line"),
  });

  await assertEstimateVersionUnchanged({
    supabase: input.supabase,
    version: versionRecord,
  });

  if (input.persist === false) {
    return { totals };
  }

  const { data: versionToken, error: updateVersionError } = await input.supabase
    .from("estimate_versions")
    .update({
      total_ht_cents: totals.total_ht_cents,
      total_tax_cents: totals.total_tax_cents,
      total_ttc_cents: totals.total_ttc_cents,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .select("id, updated_at")
    .single();

  if (updateVersionError || !versionToken) {
    if (updateVersionError) {
      throw mapSupabaseError(
        updateVersionError,
        "Impossible de recalculer les totaux de la version cible."
      );
    }

    throw badRequest("Impossible de recalculer les totaux de la version cible.");
  }

  return {
    totals,
    version: versionToken,
  };
}
