import type { SupabaseClient } from "@supabase/supabase-js";

import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import {
  calculateEstimateSnapshotForItems,
  type EstimateTotalsVersionConfig,
} from "@/lib/estimates/version-totals";
import type { Database } from "@/types/database";

import { badRequest, conflict, mapSupabaseError, notFound } from "./errors";

type Supabase = SupabaseClient<Database>;
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];

export type EstimateV2FreezeResult = {
  id: string;
  updated_at: string;
  content_revision?: number;
  total_ht_cents?: number;
  total_tax_cents?: number;
  total_ttc_cents?: number;
};

export type EstimateV2SnapshotPurpose = "send" | "approval";

type FreezeEstimateV2SnapshotInput = {
  supabase: Supabase;
  rpcClient: Supabase;
  tenantId: string;
  versionId: string;
  expectedUpdatedAt: string;
  expectedContentRevision: number;
  actorUserId: string;
  purpose: EstimateV2SnapshotPurpose;
};

const VERSION_CONFLICT_ERROR_MESSAGE =
  "Version modifiee par un autre utilisateur";

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Module serveur profond du gel v2 : charge le contexte, calcule la projection,
 * verifie la reconciliation et franchit le seam RPC avec un CAS unique.
 */
export async function freezeEstimateV2Snapshot(
  input: FreezeEstimateV2SnapshotInput
): Promise<EstimateV2FreezeResult> {
  const { data: versionData, error: versionError } = await input.supabase
    .from("estimate_versions")
    .select(
      "id, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_mode, discount_steps, global_coefficient, rounding_mode, rounding_step_cents, calc_engine_version, contractor_role, estimate_projects!inner(user_id)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .single();
  if (versionError || !versionData) {
    if (versionError) {
      throw mapSupabaseError(
        versionError,
        "Impossible de figer le calcul de la version cible."
      );
    }
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = versionData as EstimateTotalsVersionConfig & {
    estimate_projects: { user_id: string } | { user_id: string }[] | null;
  };
  if (resolveCalcEngineVersion(version) !== 2) {
    throw badRequest("Le gel du snapshot est reserve au moteur de calcul v2.");
  }
  const project = resolveEmbeddedOne(version.estimate_projects);
  if (!project) {
    throw badRequest("Impossible de figer le calcul de la version cible.");
  }

  const { data: itemsData, error: itemsError } = await input.supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (itemsError) {
    throw mapSupabaseError(
      itemsError,
      "Impossible de figer les lignes de la version cible."
    );
  }

  const items = (itemsData ?? []) as EstimateItemRow[];
  const calculatedSnapshot = await calculateEstimateSnapshotForItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectUserId: project.user_id,
    version,
    lineItems: items,
    requireCompleteLaborRoleAssignments: true,
  });
  const { breakdown } = calculatedSnapshot;
  if (!breakdown.invariants.matchesFooter) {
    throw badRequest(
      "Le moteur v2 ne peut pas produire un snapshot reconcilie.",
      breakdown.invariants,
      "ESTIMATE_TOTALS_OUT_OF_SYNC"
    );
  }
  const projection = buildEstimateV2SnapshotProjection({ items, breakdown });
  const { data, error } = await input.rpcClient.rpc(
    "freeze_estimate_v2_snapshot",
    {
      p_version_id: input.versionId,
      p_tenant_id: input.tenantId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_expected_content_revision: input.expectedContentRevision,
      p_actor_user_id: input.actorUserId,
      p_purpose: input.purpose,
      p_calculation_context: calculatedSnapshot.context,
      p_item_snapshots: projection.items,
      p_version_totals: projection.totals,
    }
  );
  if (error) {
    if (
      error.code === "40001" ||
      error.code === "40P01" ||
      error.message.includes("ESTIMATE_VERSION_CONFLICT")
    ) {
      throw conflict(
        VERSION_CONFLICT_ERROR_MESSAGE,
        { updated_at: input.expectedUpdatedAt },
        "VERSION_CONFLICT"
      );
    }
    throw mapSupabaseError(
      error,
      "Impossible de figer le calcul de la version cible."
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw conflict(
      VERSION_CONFLICT_ERROR_MESSAGE,
      { updated_at: input.expectedUpdatedAt },
      "VERSION_CONFLICT"
    );
  }
  return row as EstimateV2FreezeResult;
}
