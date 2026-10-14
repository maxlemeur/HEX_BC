import type { SupabaseClient } from "@supabase/supabase-js";

import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import { badRequest, conflict, internalError, mapSupabaseError } from "@/lib/estimates/errors";
import { calculateEstimateSnapshotForItems } from "@/lib/estimates/version-totals";
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
    .select("id, updated_at, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, rounding_mode, rounding_step_cents, calc_engine_version, contractor_role")
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
  if (resolveCalcEngineVersion(version) === 2) {
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
  if (error) {
    if (error.code === "40001") {
      throw conflict("Le devis ou ses paramètres de calcul ont changé. Rechargez avant de réessayer.", undefined, "VERSION_CONFLICT");
    }
    if (error.message === "ESTIMATE_CREATE_LOCK_REQUIRED") {
      throw conflict("Un verrou actif de cette page est requis pour créer une ligne.", undefined, "LOCK_REQUIRED");
    }
    throw mapSupabaseError(error, "Impossible de créer la ligne et ses totaux.");
  }
  const saved = data as unknown as { item?: ItemRow; version?: { id: string; updated_at: string } } | null;
  if (saved?.item?.id !== item.id || saved.version?.id !== versionId || !saved.version.updated_at) {
    throw internalError("Réponse de création du devis invalide.");
  }
  return { item: saved.item, version: saved.version };
}
