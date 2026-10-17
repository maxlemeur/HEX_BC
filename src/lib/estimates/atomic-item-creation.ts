import type { SupabaseClient } from "@supabase/supabase-js";

import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import { resolveCalcEngineVersion, resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { isUnifiedEngine, usesPerUnitLabor } from "@/lib/estimates/engine/capabilities";
import { badRequest, conflict, internalError, mapSupabaseError } from "@/lib/estimates/errors";
import {
  assertHistoricalItemHasNoV3Columns,
  normalizeV3ItemWrite,
  toEstimateV3LineProjections,
  toEstimateV3VersionTotals,
} from "@/lib/estimates/v3-persistence";
import {
  calculateEstimateSnapshotForItems,
  calculateEstimateV3SnapshotForItems,
} from "@/lib/estimates/version-totals";
import type { Database, Json } from "@/types/database";

type ItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type ItemInsert = Database["public"]["Tables"]["estimate_items"]["Insert"];
export type AtomicEstimateItemInsert = Omit<ItemInsert, "tenant_id" | "version_id"> & {
  id: string;
  position: number;
  title: string;
  h_mo_majoration?: number | null;
};

/** Calculate a prospective draft, then persist it with its item in one transaction. */
export async function persistAtomicEstimateItem(input: {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  projectUserId: string;
  versionId: string;
  expectedUpdatedAt: string;
  draftLockSessionId: string;
  item: AtomicEstimateItemInsert;
}): Promise<{ item: ItemRow; version: { id: string; updated_at: string } }> {
  const { supabase, tenantId, versionId } = input;
  const { data: version, error: versionError } = await supabase
    .from("estimate_versions")
    .select("id, updated_at, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, rounding_mode, rounding_step_cents, calc_engine_version, contractor_role, sale_coefficient_fo, sale_coefficient_mo")
    .eq("tenant_id", tenantId)
    .eq("id", versionId)
    .single();
  if (versionError) throw mapSupabaseError(versionError, "Impossible de charger le calcul du devis.");
  if (!version || version.updated_at !== input.expectedUpdatedAt) {
    throw conflict("Le devis a changé. Rechargez avant de créer la ligne.", undefined, "VERSION_CONFLICT");
  }

  const items: EstimateItemRecord[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("estimate_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("version_id", versionId)
      .eq("item_type", "line")
      .order("position", { ascending: true })
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw mapSupabaseError(error, "Impossible de charger les lignes du devis.");
    items.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  // Lot 2, sous-lot 2.5 : une v3 a ses propres colonnes et son moteur ; une v1/v2 n'en porte aucune.
  if (usesPerUnitLabor(resolveEstimateEngineVersion(version))) {
    return persistAtomicEstimateV3Item({ ...input, version, lines: items });
  }
  assertHistoricalItemHasNoV3Columns(input.item);
  if (input.item.item_type === "line") {
    items.push({
      ...input.item,
      parent_id: input.item.parent_id ?? null,
      description: input.item.description ?? null,
      labor_role_id: input.item.labor_role_id ?? null,
      category_id: input.item.category_id ?? null,
      quantity: input.item.quantity ?? 1,
      unit_price_ht_cents: input.item.unit_price_ht_cents ?? 0,
      tax_rate_bp: input.item.tax_rate_bp ?? version.tax_rate_bp,
      k_fo: input.item.k_fo ?? 1,
      h_mo: input.item.h_mo ?? 0,
      k_mo: input.item.k_mo ?? 1,
      pu_ht_cents: 0,
      line_total_ht_cents: null,
      line_tax_cents: null,
      line_total_ttc_cents: null,
    });
  }
  items.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const { breakdown, dependencies } = await calculateEstimateSnapshotForItems({
    supabase,
    tenantId,
    projectUserId: input.projectUserId,
    version,
    lineItems: items,
    captureDependencies: true,
  });
  if (!dependencies) throw internalError("Contexte de calcul indisponible.");

  let item = input.item;
  let updates: Array<{
    id: string;
    pu_ht_cents: number;
    line_total_ht_cents: number;
    line_tax_cents: number;
    line_total_ttc_cents: number;
  }> = [];
  const totals = {
    total_ht_cents: breakdown.totals.saleTotalCents,
    total_tax_cents: breakdown.totals.adjustedTaxCents,
    total_ttc_cents: breakdown.totals.roundedTtcCents,
  };
  if (isUnifiedEngine(resolveCalcEngineVersion(version))) {
    if (!breakdown.invariants.matchesFooter) {
      throw badRequest("Le calcul des lignes ne correspond pas au pied du devis.");
    }
    const projection = buildEstimateV2SnapshotProjection({ items, breakdown });
    updates = projection.items.map((line) => ({
      id: line.id,
      pu_ht_cents: line.snapshot_pu_ht_cents,
      line_total_ht_cents: line.line_total_ht_cents,
      line_tax_cents: line.line_tax_cents,
      line_total_ttc_cents: line.line_total_ttc_cents,
    }));
    // The INSERT must satisfy line constraints before the bulk projection runs.
    const created = updates.find((line) => line.id === item.id);
    if (created) item = { ...item, ...created };
  } else if (item.item_type === "line") {
    // V1 stores gross lines; global discounts and rounding remain in the footer.
    const line = breakdown.lineById.get(item.id);
    if (!line) throw internalError("Projection de la nouvelle ligne indisponible.");
    item = {
      ...item,
      pu_ht_cents: line.puNetHtCents,
      line_total_ht_cents: line.saleGrossCents,
      line_tax_cents: line.taxCents,
      line_total_ttc_cents: line.saleGrossCents + line.taxCents,
    };
  }
  const { data, error } = await supabase.rpc("atomic_create_estimate_item", {
    p_version_id: versionId,
    p_item: item as Json,
    p_item_updates: updates as Json,
    p_version_patch: totals,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_draft_lock_session_id: input.draftLockSessionId,
    p_calculation_context: dependencies as Json,
  });
  if (error) throwAtomicCreationError(error);
  return readAtomicCreationResponse(data, item.id, versionId);
}

function readAtomicCreationResponse(data: unknown, itemId: string, versionId: string) {
  const saved = data as { item?: ItemRow; version?: { id: string; updated_at: string } } | null;
  if (saved?.item?.id !== itemId || saved.version?.id !== versionId || !saved.version.updated_at) {
    throw internalError("Réponse de création du devis invalide.");
  }
  return { item: saved.item, version: saved.version };
}

function throwAtomicCreationError(error: { code: string; message: string }): never {
  if (error.code === "40001") {
    throw conflict("Le devis ou ses paramètres de calcul ont changé. Rechargez avant de réessayer.", undefined, "VERSION_CONFLICT");
  }
  if (error.message === "ESTIMATE_CREATE_LOCK_REQUIRED") {
    throw conflict("Un verrou actif de cette page est requis pour créer une ligne.", undefined, "LOCK_REQUIRED");
  }
  throw mapSupabaseError(error, "Impossible de créer la ligne et ses totaux.");
}

/**
 * Lot 2, sous-lot 2.5 - création d'un élément dans une v3 (D4, D7, D8, D12) : heures par unité
 * seulement, unité normalisée, taux de ligne explicite, projections nettes de toutes les lignes
 * et les six totaux v3, contrôlés par `estimate_v3_assert_draft` dans la même transaction.
 */
async function persistAtomicEstimateV3Item(input: Parameters<typeof persistAtomicEstimateItem>[0] & {
  version: Parameters<typeof calculateEstimateV3SnapshotForItems>[0]["version"] & { id: string };
  lines: EstimateItemRecord[];
}): Promise<{ item: ItemRow; version: { id: string; updated_at: string } }> {
  const { supabase, tenantId, versionId, version } = input;
  let item: AtomicEstimateItemInsert = normalizeV3ItemWrite(input.item, input.item.item_type);
  const lines = [...input.lines];
  if (item.item_type === "line") {
    lines.push({
      ...item,
      parent_id: item.parent_id ?? null,
      description: item.description ?? null,
      labor_role_id: item.labor_role_id ?? null,
      category_id: item.category_id ?? null,
      quantity: item.quantity ?? 1,
      unit_price_ht_cents: item.unit_price_ht_cents ?? 0,
      tax_rate_bp: item.tax_rate_bp ?? version.tax_rate_bp,
      k_fo: item.k_fo ?? 1,
      h_mo: null,
      k_mo: item.k_mo ?? 1,
      pu_ht_cents: null,
      line_total_ht_cents: null,
      line_tax_cents: null,
      line_total_ttc_cents: null,
    });
  }
  lines.sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const { breakdown, dependencies } = await calculateEstimateV3SnapshotForItems({
    supabase,
    tenantId,
    projectUserId: input.projectUserId,
    version,
    lineItems: lines,
    captureDependencies: true,
  });
  if (!dependencies) throw internalError("Contexte de calcul indisponible.");
  const updates = toEstimateV3LineProjections(breakdown);
  const created = updates.find((line) => line.id === item.id);
  if (created) {
    item = { ...item, ...created, tax_rate_bp: item.tax_rate_bp ?? version.tax_rate_bp };
  }
  const { data, error } = await supabase.rpc("atomic_create_estimate_item", {
    p_version_id: versionId,
    p_item: item as Json,
    p_item_updates: updates as Json,
    p_version_patch: toEstimateV3VersionTotals(breakdown),
    p_expected_updated_at: input.expectedUpdatedAt,
    p_draft_lock_session_id: input.draftLockSessionId,
    p_calculation_context: dependencies as Json,
  });
  if (error) throwAtomicCreationError(error);
  return readAtomicCreationResponse(data, item.id, versionId);
}
