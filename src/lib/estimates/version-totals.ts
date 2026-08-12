import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeEstimateTotals,
  computeInitialDiscountCents,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { loadMarginTiersForTotals } from "@/lib/estimates/margin-tiers-loader";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];

export type CalculatedEstimateTotals = {
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
};

export type EstimateTotalsVersionConfig = Pick<
  EstimateVersionRow,
  | "margin_multiplier"
  | "margin_mode"
  | "tax_rate_bp"
  | "discount_bp"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "rounding_mode"
  | "rounding_step_cents"
  | "contractor_role"
>;

function toArrayNumberOrNull(value: unknown): Array<number | null> | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) =>
    typeof entry === "number" && Number.isFinite(entry) ? entry : null
  );
}

export async function calculateEstimateTotalsForItems(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  version: EstimateTotalsVersionConfig;
  lineItems: EstimateItemRecord[];
}): Promise<CalculatedEstimateTotals> {
  const laborRoleIds = new Set<string>();
  input.lineItems.forEach((item) => {
    if (item.labor_role_id) laborRoleIds.add(item.labor_role_id);
    if (item.labor_role_atelier_id) laborRoleIds.add(item.labor_role_atelier_id);
    if (item.labor_role_chantier_id) laborRoleIds.add(item.labor_role_chantier_id);
  });

  const laborRatesById = new Map<string, number>();
  const uniqueRoleIds = Array.from(laborRoleIds);
  if (uniqueRoleIds.length > 0) {
    const { data, error } = await input.supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", input.projectUserId)
      .in("id", uniqueRoleIds);

    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de recalculer les totaux de la version cible."
      );
    }

    (data ?? []).forEach((role) => {
      laborRatesById.set(role.id, role.hourly_rate_cents);
    });
  }

  const marginTiers =
    input.version.margin_mode === "tiered"
      ? await loadMarginTiersForTotals({
          supabase: input.supabase,
          tenantId: input.tenantId,
        })
      : [];
  const isLaborSplitEnabled = await isFeatureEnabled(
    input.tenantId,
    "EST_031_LABOR_SPLIT",
    { supabase: input.supabase }
  );
  const discountSteps = toArrayNumberOrNull(input.version.discount_steps);
  const discountCents = computeInitialDiscountCents(
    {
      margin_multiplier: input.version.margin_multiplier ?? 1,
      margin_mode: input.version.margin_mode ?? "fixed",
      tax_rate_bp: input.version.tax_rate_bp,
      discount_bp: input.version.discount_bp ?? 0,
      discount_mode: input.version.discount_mode ?? "simple",
      discount_steps: discountSteps,
      global_coefficient: input.version.global_coefficient ?? 1,
    },
    input.lineItems,
    laborRatesById,
    isLaborSplitEnabled
  );

  const totals = computeEstimateTotals({
    lineItems: input.lineItems.map((item) => ({
      quantity: item.quantity ?? 0,
      unit_price_ht_cents: item.unit_price_ht_cents ?? 0,
      tax_rate_bp: item.tax_rate_bp ?? input.version.tax_rate_bp,
      k_fo: item.k_fo ?? 1,
      h_mo: item.h_mo ?? 0,
      h_mo_majoration: item.h_mo_majoration ?? 1,
      k_mo: item.k_mo ?? 1,
      h_mo_atelier: item.h_mo_atelier ?? null,
      k_mo_atelier: item.k_mo_atelier ?? null,
      labor_role_atelier_id: item.labor_role_atelier_id ?? null,
      h_mo_chantier: item.h_mo_chantier ?? null,
      k_mo_chantier: item.k_mo_chantier ?? null,
      labor_role_chantier_id: item.labor_role_chantier_id ?? null,
      pu_ht_cents: item.pu_ht_cents ?? 0,
      labor_role_hourly_rate_cents: item.labor_role_id
        ? (laborRatesById.get(item.labor_role_id) ?? 0)
        : 0,
      labor_role_atelier_hourly_rate_cents: item.labor_role_atelier_id
        ? (laborRatesById.get(item.labor_role_atelier_id) ?? 0)
        : 0,
      labor_role_chantier_hourly_rate_cents: item.labor_role_chantier_id
        ? (laborRatesById.get(item.labor_role_chantier_id) ?? 0)
        : 0,
    })),
    marginMultiplier: input.version.margin_multiplier ?? 1,
    marginMode: input.version.margin_mode ?? "fixed",
    marginTiers,
    isLaborSplitEnabled,
    discountCents,
    discountMode: input.version.discount_mode ?? "simple",
    discountStepsBp: discountSteps,
    globalCoefficient: input.version.global_coefficient ?? 1,
    taxRateBp: input.version.tax_rate_bp,
    roundingMode: input.version.rounding_mode,
    roundingStepCents: input.version.rounding_step_cents,
    vatReverseCharge: input.version.contractor_role === "subcontractor",
  });

  return {
    total_ht_cents: totals.saleTotalCents,
    total_tax_cents: totals.adjustedTaxCents,
    total_ttc_cents: totals.roundedTtcCents,
  };
}
