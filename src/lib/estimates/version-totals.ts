import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeEstimateBreakdown,
  computeInitialDiscountCents,
  hasActiveLaborSplitPayload,
  type EstimateBreakdown,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import { isUnifiedEngine } from "@/lib/estimates/engine/capabilities";
import { badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import { loadMarginTiersForTotals } from "@/lib/estimates/margin-tiers-loader";
import { getMarginTiers } from "@/lib/estimates/margin-tiers";
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
> &
  Partial<Pick<EstimateVersionRow, "calc_engine_version" | "discount_amount_cents">>;

export type EstimateCalculationSnapshotContext = {
  effective_margin_multiplier: number;
  labor_split_enabled: boolean;
  labor_roles: Array<{ id: string; hourly_rate_cents: number }>;
  margin_tiers: Array<{ threshold_cents: number; multiplier: number }>;
  fixed_discount?: {
    requested_cents: number;
    base_cents: number;
    applied_cents: number;
  };
};

// Raw mutable inputs for a guarded write, separate from the publication context.
export type EstimateCalculationDependencies = {
  labor_roles: Array<{
    id: string;
    tenant_id: string;
    user_id: string;
    hourly_rate_cents: number;
  }>;
  margin_tiers: Array<{
    id: string;
    threshold_cents: number;
    multiplier: number;
    position: number;
  }>;
  labor_split_flag: { id: string; enabled: boolean } | null;
};

type ResolvedEstimateCalculationContext = {
  laborRatesById: Map<string, number>;
  marginTiers: Awaited<ReturnType<typeof loadMarginTiersForTotals>>;
  isLaborSplitEnabled: boolean;
  snapshot: Omit<
    EstimateCalculationSnapshotContext,
    "effective_margin_multiplier"
  >;
  dependencies?: EstimateCalculationDependencies;
};

type MissingLaborRoleAssignment = {
  item_id: string;
  hours_field: "h_mo" | "h_mo_atelier" | "h_mo_chantier";
  role_field:
    | "labor_role_id"
    | "labor_role_atelier_id"
    | "labor_role_chantier_id";
};

function hasPositiveHours(value: number | null | undefined): boolean {
  return Number.isFinite(value ?? Number.NaN) && (value ?? 0) > 0;
}

function hasLaborRoleId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function assertCompleteV2PublicationLaborAssignments(input: {
  lineItems: EstimateItemRecord[];
  isLaborSplitEnabled: boolean;
}) {
  const missingAssignments: MissingLaborRoleAssignment[] = [];

  input.lineItems.forEach((item) => {
    if (item.item_type !== "line") return;

    const shouldUseLaborSplit =
      input.isLaborSplitEnabled && hasActiveLaborSplitPayload(item);
    if (!shouldUseLaborSplit) {
      if (
        hasPositiveHours(item.h_mo) &&
        !hasLaborRoleId(item.labor_role_id)
      ) {
        missingAssignments.push({
          item_id: item.id,
          hours_field: "h_mo",
          role_field: "labor_role_id",
        });
      }
      return;
    }

    if (
      hasPositiveHours(item.h_mo_atelier) &&
      !hasLaborRoleId(item.labor_role_atelier_id)
    ) {
      missingAssignments.push({
        item_id: item.id,
        hours_field: "h_mo_atelier",
        role_field: "labor_role_atelier_id",
      });
    }
    if (
      hasPositiveHours(item.h_mo_chantier) &&
      !hasLaborRoleId(item.labor_role_chantier_id)
    ) {
      missingAssignments.push({
        item_id: item.id,
        hours_field: "h_mo_chantier",
        role_field: "labor_role_chantier_id",
      });
    }
  });

  if (missingAssignments.length > 0) {
    throw badRequest(
      "Un rôle de main-d'oeuvre est requis pour chaque composante horaire avant publication.",
      { missing_assignments: missingAssignments },
      "ESTIMATE_LABOR_ROLE_REQUIRED"
    );
  }
}

function toArrayNumberOrNull(value: unknown): Array<number | null> | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) =>
    typeof entry === "number" && Number.isFinite(entry) ? entry : null
  );
}

async function resolveEstimateCalculationContext(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  version: EstimateTotalsVersionConfig;
  lineItems: EstimateItemRecord[];
  captureDependencies?: boolean;
}): Promise<ResolvedEstimateCalculationContext> {
  if (input.version.discount_amount_cents != null &&
    (!Number.isInteger(input.version.discount_amount_cents) || input.version.discount_amount_cents < 0 ||
      input.version.discount_amount_cents > 2147483647 || input.version.discount_mode !== "simple" ||
      (input.version.discount_steps?.length ?? 0) > 0)) {
    throw badRequest("Une remise fixe valide requiert le mode simple et aucun palier.");
  }
  const dependencies: EstimateCalculationDependencies | undefined =
    input.captureDependencies
      ? { labor_roles: [], margin_tiers: [], labor_split_flag: null }
      : undefined;
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
      .select("id, tenant_id, user_id, hourly_rate_cents")
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
    if (dependencies) {
      dependencies.labor_roles = [...(data ?? [])].sort((left, right) =>
        left.id.localeCompare(right.id)
      );
    }

    if (isUnifiedEngine(resolveCalcEngineVersion(input.version))) {
      const missingRoleIds = uniqueRoleIds.filter(
        (roleId) => !laborRatesById.has(roleId)
      );
      if (missingRoleIds.length > 0) {
        throw badRequest(
          "Certains rôles de main-d'oeuvre ne correspondent pas au proprietaire du projet.",
          { missing_role_ids: missingRoleIds.sort() },
          "ESTIMATE_LABOR_ROLE_OWNER_MISMATCH"
        );
      }
    }
  }

  let loadedMarginTiers: ResolvedEstimateCalculationContext["marginTiers"] = [];
  if (input.version.margin_mode === "tiered") {
    if (dependencies) {
      const { data, error } = await input.supabase
        .from("margin_tiers")
        .select("id, threshold_cents, multiplier, position")
        .eq("tenant_id", input.tenantId)
        .order("threshold_cents", { ascending: true })
        .order("position", { ascending: true })
        .order("id", { ascending: true });
      if (error) {
        throw mapSupabaseError(error, "Impossible de charger les tranches de marge.");
      }
      dependencies.margin_tiers = data ?? [];
      loadedMarginTiers = dependencies.margin_tiers;
    } else {
      loadedMarginTiers = await loadMarginTiersForTotals({
        supabase: input.supabase,
        tenantId: input.tenantId,
      });
    }
  }
  const marginTiers =
    input.version.margin_mode === "tiered" && loadedMarginTiers.length === 0
      ? getMarginTiers()
      : loadedMarginTiers;
  let isLaborSplitEnabled: boolean;
  if (dependencies) {
    const { data, error } = await input.supabase
      .from("feature_flags")
      .select("id, enabled")
      .eq("tenant_id", input.tenantId)
      .eq("flag_key", "EST_031_LABOR_SPLIT")
      .maybeSingle();
    if (error) {
      throw mapSupabaseError(error, "Impossible de charger le réglage de ventilation de main-d'œuvre.");
    }
    dependencies.labor_split_flag = data;
    isLaborSplitEnabled = data?.enabled === true;
  } else {
    isLaborSplitEnabled = await isFeatureEnabled(
      input.tenantId,
      "EST_031_LABOR_SPLIT",
      { supabase: input.supabase }
    );
  }
  return {
    laborRatesById,
    marginTiers,
    isLaborSplitEnabled,
    ...(dependencies ? { dependencies } : {}),
    snapshot: {
      labor_split_enabled: isLaborSplitEnabled,
      labor_roles: uniqueRoleIds
        .sort((left, right) => left.localeCompare(right))
        .map((id) => ({
          id,
          hourly_rate_cents: laborRatesById.get(id) ?? 0,
        })),
      margin_tiers: marginTiers.map((tier) => ({
        threshold_cents: tier.threshold_cents,
        multiplier: tier.multiplier,
      })),
    },
  };
}

export async function calculateEstimateBreakdownForItems(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  version: EstimateTotalsVersionConfig;
  lineItems: EstimateItemRecord[];
}): Promise<EstimateBreakdown> {
  const { laborRatesById, marginTiers, isLaborSplitEnabled } =
    await resolveEstimateCalculationContext(input);
  const discountSteps = toArrayNumberOrNull(input.version.discount_steps);
  const normalizedDiscountSteps = (discountSteps ?? []).filter(
    (step): step is number => step !== null
  );
  const calcEngineVersion = resolveCalcEngineVersion(input.version);
  const discountCents = computeInitialDiscountCents(
    {
      margin_multiplier: input.version.margin_multiplier ?? 1,
      margin_mode: input.version.margin_mode ?? "fixed",
      tax_rate_bp: input.version.tax_rate_bp,
      discount_bp: input.version.discount_bp ?? 0,
      discount_amount_cents: input.version.discount_amount_cents ?? null,
      discount_mode: input.version.discount_mode ?? "simple",
      discount_steps: discountSteps,
      global_coefficient: input.version.global_coefficient ?? 1,
    },
    input.lineItems,
    laborRatesById,
    isLaborSplitEnabled,
    laborRatesById,
    laborRatesById,
    { calcEngineVersion, marginTiers }
  );

  return computeEstimateBreakdown({
    items: input.lineItems,
    marginMultiplier: input.version.margin_multiplier ?? 1,
    marginMode: input.version.margin_mode ?? "fixed",
    marginTiers,
    isLaborSplitEnabled,
    discountCents,
    discountMode: input.version.discount_mode ?? "simple",
    discountStepsBp: normalizedDiscountSteps,
    globalCoefficient: input.version.global_coefficient ?? 1,
    taxRateBp: input.version.tax_rate_bp,
    roundingMode: input.version.rounding_mode,
    roundingStepCents: input.version.rounding_step_cents,
    vatReverseCharge: input.version.contractor_role === "subcontractor",
    calcEngineVersion,
    laborRateById: laborRatesById,
    laborRateAtelierById: laborRatesById,
    laborRateChantierById: laborRatesById,
  });
}

export async function calculateEstimateSnapshotForItems(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  version: EstimateTotalsVersionConfig;
  lineItems: EstimateItemRecord[];
  requireCompleteLaborRoleAssignments?: boolean;
  captureDependencies?: boolean;
}): Promise<{
  breakdown: EstimateBreakdown;
  context: EstimateCalculationSnapshotContext;
  dependencies?: EstimateCalculationDependencies;
}> {
  const resolved = await resolveEstimateCalculationContext(input);
  const discountSteps = toArrayNumberOrNull(input.version.discount_steps);
  const normalizedDiscountSteps = (discountSteps ?? []).filter(
    (step): step is number => step !== null
  );
  const calcEngineVersion = resolveCalcEngineVersion(input.version);
  if (
    isUnifiedEngine(calcEngineVersion) &&
    input.requireCompleteLaborRoleAssignments === true
  ) {
    assertCompleteV2PublicationLaborAssignments({
      lineItems: input.lineItems,
      isLaborSplitEnabled: resolved.isLaborSplitEnabled,
    });
  }
  const discountCents = computeInitialDiscountCents(
    {
      margin_multiplier: input.version.margin_multiplier ?? 1,
      margin_mode: input.version.margin_mode ?? "fixed",
      tax_rate_bp: input.version.tax_rate_bp,
      discount_bp: input.version.discount_bp ?? 0,
      discount_amount_cents: input.version.discount_amount_cents ?? null,
      discount_mode: input.version.discount_mode ?? "simple",
      discount_steps: discountSteps,
      global_coefficient: input.version.global_coefficient ?? 1,
    },
    input.lineItems,
    resolved.laborRatesById,
    resolved.isLaborSplitEnabled,
    resolved.laborRatesById,
    resolved.laborRatesById,
    { calcEngineVersion, marginTiers: resolved.marginTiers }
  );
  const breakdown = computeEstimateBreakdown({
    items: input.lineItems,
    marginMultiplier: input.version.margin_multiplier ?? 1,
    marginMode: input.version.margin_mode ?? "fixed",
    marginTiers: resolved.marginTiers,
    isLaborSplitEnabled: resolved.isLaborSplitEnabled,
    discountCents,
    discountMode: input.version.discount_mode ?? "simple",
    discountStepsBp: normalizedDiscountSteps,
    globalCoefficient: input.version.global_coefficient ?? 1,
    taxRateBp: input.version.tax_rate_bp,
    roundingMode: input.version.rounding_mode,
    roundingStepCents: input.version.rounding_step_cents,
    vatReverseCharge: input.version.contractor_role === "subcontractor",
    calcEngineVersion,
    laborRateById: resolved.laborRatesById,
    laborRateAtelierById: resolved.laborRatesById,
    laborRateChantierById: resolved.laborRatesById,
  });
  return {
    breakdown,
    ...(resolved.dependencies ? { dependencies: resolved.dependencies } : {}),
    context: {
      ...resolved.snapshot,
      effective_margin_multiplier: breakdown.totals.appliedMarginMultiplier,
      ...(input.version.discount_amount_cents != null ? {
        fixed_discount: {
          requested_cents: input.version.discount_amount_cents,
          base_cents: breakdown.totals.saleSubtotalCents,
          applied_cents: breakdown.totals.discountCents,
        },
      } : {}),
    },
  };
}

export async function calculateEstimateTotalsForItems(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  version: EstimateTotalsVersionConfig;
  lineItems: EstimateItemRecord[];
}): Promise<CalculatedEstimateTotals> {
  const totals = (await calculateEstimateBreakdownForItems(input)).totals;

  return {
    total_ht_cents: totals.saleTotalCents,
    total_tax_cents: totals.adjustedTaxCents,
    total_ttc_cents: totals.roundedTtcCents,
  };
}
