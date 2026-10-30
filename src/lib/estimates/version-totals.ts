import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeEstimateBreakdown,
  computeInitialDiscountCents,
  hasActiveLaborSplitPayload,
  type EstimateBreakdown,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import { resolveCalcEngineVersion, resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { engineFreezesSnapshot, isUnifiedEngine } from "@/lib/estimates/engine/capabilities";
import { computeVersionBreakdown } from "@/lib/estimates/engine/compute";
import {
  type EstimateV3Breakdown,
  type EstimateV3SnapshotProjection,
  projectEstimateV3Snapshot,
} from "@/lib/estimates/engine-v3";
import { badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import { loadMarginTiersForTotals } from "@/lib/estimates/margin-tiers-loader";
import { getMarginTiers } from "@/lib/estimates/margin-tiers";
import {
  buildEstimateV3Input,
  type EstimateV3LineRecord,
  type EstimateV3VersionConfig,
  toEstimateV3ApiError,
} from "@/lib/estimates/v3-persistence";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { startConcurrentRead } from "@/lib/supabase/concurrent-read";
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
  // The three reads are independent: start them together, then check them in
  // their former order so the first reported error does not change.
  const laborRolesPromise = uniqueRoleIds.length > 0
    ? startConcurrentRead(readAllRowsInChunks(uniqueRoleIds, (pageIds) => input.supabase
      .from("labor_roles")
      .select("id, tenant_id, user_id, hourly_rate_cents", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .eq("user_id", input.projectUserId)
      .in("id", pageIds)))
    : null;
  const marginTiersPromise = input.version.margin_mode !== "tiered"
    ? null
    : dependencies
      ? startConcurrentRead(readAllRows(() => input.supabase
        .from("margin_tiers")
        .select("id, threshold_cents, multiplier, position", { count: "exact" })
        .eq("tenant_id", input.tenantId)
        .order("threshold_cents", { ascending: true })
        .order("position", { ascending: true })
        .order("id", { ascending: true })))
      : startConcurrentRead(loadMarginTiersForTotals({
        supabase: input.supabase,
        tenantId: input.tenantId,
      }));
  const laborSplitPromise = dependencies
    ? startConcurrentRead(input.supabase
      .from("feature_flags")
      .select("id, enabled")
      .eq("tenant_id", input.tenantId)
      .eq("flag_key", "EST_031_LABOR_SPLIT")
      .maybeSingle())
    : startConcurrentRead(isFeatureEnabled(
      input.tenantId,
      "EST_031_LABOR_SPLIT",
      { supabase: input.supabase }
    ));

  if (laborRolesPromise) {
    const { data, error } = await laborRolesPromise;

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

    // Moteurs qui figent (2 et 3) : les rôles doivent appartenir au propriétaire (v1/v2 inchangés).
    if (engineFreezesSnapshot(resolveEstimateEngineVersion(input.version))) {
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
  if (marginTiersPromise) {
    const tiers = await marginTiersPromise;
    if (Array.isArray(tiers)) {
      loadedMarginTiers = tiers;
    } else {
      if (tiers.error) {
        throw mapSupabaseError(tiers.error, "Impossible de charger les tranches de marge.");
      }
      if (dependencies) dependencies.margin_tiers = tiers.data ?? [];
      loadedMarginTiers = tiers.data ?? [];
    }
  }
  const marginTiers =
    input.version.margin_mode === "tiered" && loadedMarginTiers.length === 0
      ? getMarginTiers()
      : loadedMarginTiers;
  let isLaborSplitEnabled: boolean;
  const laborSplit = await laborSplitPromise;
  if (typeof laborSplit === "boolean") {
    isLaborSplitEnabled = laborSplit;
  } else {
    if (laborSplit.error) {
      throw mapSupabaseError(laborSplit.error, "Impossible de charger le réglage de ventilation de main-d'œuvre.");
    }
    if (dependencies) dependencies.labor_split_flag = laborSplit.data;
    isLaborSplitEnabled = laborSplit.data?.enabled === true;
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

/** Réglages v3 d'une version, avec les colonnes historiques lues par le contexte de calcul. */
export type EstimateV3TotalsVersionConfig = EstimateTotalsVersionConfig & EstimateV3VersionConfig;

export type EstimateV3CalculationResult = {
  breakdown: EstimateV3Breakdown;
  projection: EstimateV3SnapshotProjection;
  dependencies?: EstimateCalculationDependencies;
};

/**
 * Lot 2, sous-lot 2.5 - calcul v3 d'une version (conception D5 à D8, §6.5) : aucun barème, les
 * deux coefficients de vente, les taux horaires des rôles du propriétaire, la ventilation de
 * l'entreprise, puis la façade `computeVersionBreakdown` (moteur pur 2.4). La projection porte
 * les colonnes et le contexte figé v3 (`labor_roles` par `id` croissant, comme le gel v2).
 */
export async function calculateEstimateV3SnapshotForItems(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  version: EstimateV3TotalsVersionConfig;
  lineItems: Array<EstimateItemRecord & EstimateV3LineRecord>;
  captureDependencies?: boolean;
}): Promise<EstimateV3CalculationResult> {
  // La v3 n'a jamais de barème : le contexte est lu en marge fixe (CHECK de forme v3).
  const resolved = await resolveEstimateCalculationContext({
    ...input,
    version: { ...input.version, margin_mode: "fixed" },
  });
  let breakdown: EstimateV3Breakdown;
  try {
    breakdown = computeVersionBreakdown({
      calcEngineVersion: 3,
      v3: buildEstimateV3Input({
        version: input.version,
        lines: input.lineItems,
        laborRatesById: resolved.laborRatesById,
        laborSplitEnabled: resolved.isLaborSplitEnabled,
      }),
    });
  } catch (error) {
    throw toEstimateV3ApiError(error);
  }
  return {
    breakdown,
    projection: projectEstimateV3Snapshot(breakdown, { laborRoles: resolved.snapshot.labor_roles }),
    ...(resolved.dependencies
      ? { dependencies: { ...resolved.dependencies, margin_tiers: [] } }
      : {}),
  };
}
