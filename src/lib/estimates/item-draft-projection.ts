import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import { badRequest, conflict, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { fetchEstimateVersionToken } from "@/lib/estimates/item-write-context";
import type { EstimateItemUpdate } from "@/lib/estimates/item-write-types";
import { assertDraftStatus, type AuthenticatedContext } from "@/lib/estimates/server-context";
import { assertVersionConcurrencyToken } from "@/lib/estimates/version-concurrency";
import type { EstimateItemRow } from "@/lib/estimates/version-read-server";
import {
  calculateEstimateBreakdownForItems,
  type EstimateTotalsVersionConfig,
} from "@/lib/estimates/version-totals";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import type { Json } from "@/types/database";

const STALE_BULK_UPDATE_ERROR_MESSAGE = "STALE_BULK_UPDATE_ITEMS";

/** Calculate the complete post-mutation draft before its atomic bulk write. */
export async function projectDraftMutation(input: {
  context: AuthenticatedContext;
  versionId: string;
  expectedUpdatedAt: string;
  projectUserId: string;
  updates: Array<EstimateItemUpdate & { id: string }>;
  requiredLineId?: string;
}) {
  const { supabase, tenantId } = input.context;
  assertCanWriteEstimateWorkflows(input.context.tenantRole);
  const { data: versionData, error: versionError } = await supabase
    .from("estimate_versions")
    .select("id, status, updated_at, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, rounding_mode, rounding_step_cents, calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents, contractor_role")
    .eq("tenant_id", tenantId)
    .eq("id", input.versionId)
    .single();
  if (versionError) {
    throw mapSupabaseError(versionError, "Impossible de recalculer les lignes du devis.");
  }
  if (!versionData) {
    throw notFound("Version de chiffrage introuvable.");
  }
  assertVersionConcurrencyToken(versionData.updated_at, input.expectedUpdatedAt);
  assertDraftStatus(versionData.status);

  const updatesById = new Map(input.updates.map((update) => [update.id, update]));
  if (updatesById.size !== input.updates.length) {
    throw badRequest("La liste de mise à jour contient des identifiants dupliqués.");
  }

  const items: EstimateItemRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("estimate_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("version_id", input.versionId)
      .eq("item_type", "line")
      .order("position", { ascending: true })
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) {
      throw mapSupabaseError(error, "Impossible de recalculer les lignes du devis.");
    }
    items.push(...((data ?? []) as EstimateItemRow[]));
    if (!data || data.length < pageSize) break;
  }
  const lineIds = new Set(items.map((item) => item.id));
  if (input.requiredLineId && !lineIds.has(input.requiredLineId)) {
    throw notFound("Ligne de chiffrage introuvable.");
  }
  const proposedItems = items
    .map((item) => ({ ...item, ...updatesById.get(item.id) }))
    .sort((left, right) =>
      left.position - right.position || left.id.localeCompare(right.id)
    ) as EstimateItemRecord[];
  const breakdown = await calculateEstimateBreakdownForItems({
    supabase,
    tenantId,
    projectUserId: input.projectUserId,
    version: versionData as EstimateTotalsVersionConfig,
    lineItems: proposedItems,
  });
  if (!breakdown.invariants.matchesFooter) {
    throw badRequest("Le calcul des lignes ne correspond pas au pied du devis.");
  }
  const projection = buildEstimateV2SnapshotProjection({ items: proposedItems, breakdown });
  return {
    updates: [
      ...input.updates.filter((update) => !lineIds.has(update.id)),
      ...projection.items.map((line) => ({
        ...updatesById.get(line.id),
        id: line.id,
        pu_ht_cents: line.snapshot_pu_ht_cents,
        line_total_ht_cents: line.line_total_ht_cents,
        line_tax_cents: line.line_tax_cents,
        line_total_ttc_cents: line.line_total_ttc_cents,
      })),
    ],
    versionPatch: {
      total_ht_cents: projection.totals.total_ht_cents,
      total_tax_cents: projection.totals.total_tax_cents,
      total_ttc_cents: projection.totals.total_ttc_cents,
    },
  };
}

/** Reconcile the proposed tiered draft with one existing atomic bulk write. */
export async function persistTieredDraftLineUpdate(input: {
  context: AuthenticatedContext;
  versionId: string;
  expectedUpdatedAt: string;
  projectUserId: string;
  itemId: string;
  payload: EstimateItemUpdate;
}) {
  const { supabase, tenantId } = input.context;
  const changedFields = { ...input.payload };
  delete changedFields.item_type;
  const projection = await projectDraftMutation({
    context: input.context,
    versionId: input.versionId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    projectUserId: input.projectUserId,
    updates: [{ ...changedFields, id: input.itemId }],
    requiredLineId: input.itemId,
  });
  const { error: writeError } = await supabase.rpc("bulk_update_estimate_items", {
    target_version_id: input.versionId,
    item_updates: projection.updates as Json,
    version_patch: projection.versionPatch,
    expected_version_updated_at: input.expectedUpdatedAt,
  });
  if (writeError) {
    if (writeError.message === STALE_BULK_UPDATE_ERROR_MESSAGE) {
      throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, undefined, "VERSION_CONFLICT");
    }
    throw mapSupabaseError(writeError, "Impossible d’enregistrer les lignes du devis.");
  }
  const { data: item, error: readError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", input.versionId)
    .eq("id", input.itemId)
    .single();
  if (readError) {
    throw mapSupabaseError(readError, "Impossible de relire la ligne enregistrée.");
  }
  if (!item) {
    throw notFound("Ligne enregistrée introuvable.");
  }
  return {
    item,
    version: await fetchEstimateVersionToken({ supabase, tenantId, versionId: input.versionId }),
  };
}
