import type { SupabaseClient } from "@supabase/supabase-js";

import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import { requireEstimateEngineVersion, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { badRequest, conflict, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { toEstimateV3FrozenTotals, toEstimateV3ItemSnapshots } from "@/lib/estimates/v3-persistence";
import { calculateEstimateV3SnapshotForItems, type EstimateV3TotalsVersionConfig } from "@/lib/estimates/version-totals";
import type { Database, Json } from "@/types/database";

/**
 * Lot 2, sous-lot 2.5 - gel v3 (conception D12, D15, §6.5) par `public.freeze_estimate_v3_snapshot`,
 * jumelle de la RPC v2 (même signature). Le TS calcule par le moteur pur 2.4 ; PostgreSQL recalcule
 * le devis complet et refuse tout écart d'un centime (`ESTIMATE_V3_PROJECTION_MISMATCH`). Seul le
 * gel d'approbation est ouvert en 2.5 : l'émission v3 (envoi, document) arrive avec M5 (2.7).
 */

type Supabase = SupabaseClient<Database>;

/** Même forme que le résultat du gel v2 (`EstimateV2FreezeResult`). */
export type EstimateV3FreezeResult = {
  id: string;
  updated_at: string;
  content_revision?: number;
  total_ht_cents?: number;
  total_tax_cents?: number;
  total_ttc_cents?: number;
};

export type FreezeEstimateV3SnapshotInput = {
  supabase: Supabase;
  rpcClient: Supabase;
  tenantId: string;
  versionId: string;
  expectedUpdatedAt: string;
  expectedContentRevision: number;
  actorUserId: string;
  purpose: "approval";
};

/** Refus nommés du gel v3 (SQL, D9, D8) rendus en 400 avec leur code. */
const NAMED_FREEZE_ERRORS = [
  "ESTIMATE_V3_LABOR_ROLE_REQUIRED",
  "ESTIMATE_V3_UNIT_REQUIRED",
  "ESTIMATE_V3_TAX_RATE_NOT_ALLOWED",
  "ESTIMATE_V3_PROJECTION_MISMATCH",
] as const;

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function freezeEstimateV3Snapshot(
  input: FreezeEstimateV3SnapshotInput
): Promise<EstimateV3FreezeResult> {
  const { data: versionData, error: versionError } = await input.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, project_id, status, updated_at, content_revision, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, rounding_mode, rounding_step_cents, calc_engine_version, contractor_role, sale_coefficient_fo, sale_coefficient_mo, estimate_projects!inner(user_id)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .single();
  if (versionError) throw mapSupabaseError(versionError, "Impossible de figer le calcul de la version cible.");
  if (!versionData) throw notFound("Version de chiffrage introuvable.");
  if (!usesSaleCoefficients(requireEstimateEngineVersion(versionData))) {
    throw badRequest("Le gel v3 est réservé au moteur de calcul 3.");
  }
  const version = versionData as EstimateV3TotalsVersionConfig & {
    estimate_projects: { user_id: string } | { user_id: string }[] | null;
  };
  const project = resolveEmbeddedOne(version.estimate_projects);
  if (!project) throw badRequest("Impossible de figer le calcul de la version cible.");

  const items = await readAllEstimateItems(input);
  const lines = items.filter((item) => item.item_type === "line");
  const { breakdown, projection } = await calculateEstimateV3SnapshotForItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectUserId: project.user_id,
    version,
    lineItems: lines,
  });
  const missingRoles = breakdown.warnings.flatMap((warning) =>
    warning.code === "ESTIMATE_V3_LABOR_RATE_MISSING" ? [warning.line_id] : []);
  if (missingRoles.length > 0) {
    throw badRequest(
      "Un rôle de main-d'oeuvre est requis pour chaque ligne qui porte des heures avant le gel.",
      { item_ids: missingRoles },
      "ESTIMATE_LABOR_ROLE_REQUIRED"
    );
  }
  // Contrôles nommés au gel (D9, D8), relus par le SQL : unité d'une ligne chiffrée, taux autorisé.
  const missingUnits = breakdown.lines
    .filter((line) => line.pricing_status === "priced" && !lines.find((item) => item.id === line.id)?.unit_code)
    .map((line) => line.id);
  if (missingUnits.length > 0) {
    throw badRequest("Une unité est requise sur chaque ligne chiffrée avant le gel.", { item_ids: missingUnits },
      "ESTIMATE_V3_UNIT_REQUIRED");
  }
  const policy = await readTenantCalcPolicy(input.supabase, input.tenantId);
  const refusedRates = breakdown.lines.filter((line) => !policy.allowedTaxRatesBp.includes(line.tax_rate_bp))
    .map((line) => line.id);
  if (refusedRates.length > 0) {
    throw badRequest("Un taux de TVA de ligne n'est pas autorisé par l'entreprise.", { item_ids: refusedRates },
      "ESTIMATE_V3_TAX_RATE_NOT_ALLOWED");
  }
  await assertEstimateVersionUnchanged({ supabase: input.supabase, version: versionData });
  const { data, error } = await input.rpcClient.rpc("freeze_estimate_v3_snapshot", {
    p_version_id: input.versionId,
    p_tenant_id: input.tenantId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_expected_content_revision: input.expectedContentRevision,
    p_actor_user_id: input.actorUserId,
    p_purpose: input.purpose,
    p_calculation_context: projection.context as unknown as Json,
    p_item_snapshots: toEstimateV3ItemSnapshots(projection) as Json,
    p_version_totals: toEstimateV3FrozenTotals(projection) as Json,
  });
  if (error) {
    const named = NAMED_FREEZE_ERRORS.find((code) => error.message.includes(code));
    if (named) throw badRequest("Le gel v3 a été refusé par le contrôle du calcul.", { code: error.code }, named);
    if (error.message.includes("ESTIMATE_V3_CALCULATION_CONTEXT_CONFLICT")) {
      throw conflict("Le contexte de calcul a changé. Rechargez le devis avant de poursuivre.", { code: error.code }, "CONTEXT_CHANGED");
    }
    if (error.code === "40001" || error.code === "40P01" || error.message.includes("ESTIMATE_VERSION_CONFLICT")) {
      throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, { updated_at: input.expectedUpdatedAt }, "VERSION_CONFLICT");
    }
    throw mapSupabaseError(error, "Impossible de figer le calcul de la version cible.");
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, { updated_at: input.expectedUpdatedAt }, "VERSION_CONFLICT");
  }
  return row as EstimateV3FreezeResult;
}
