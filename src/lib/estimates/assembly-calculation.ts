import type { SupabaseClient } from "@supabase/supabase-js";

import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import { isUnifiedEngine } from "@/lib/estimates/engine/capabilities";
import { ApiError, badRequest, conflict, internalError, mapSupabaseError } from "@/lib/estimates/errors";
import { calculateEstimateSnapshotForItems } from "@/lib/estimates/version-totals";
import type { Database, Json } from "@/types/database";

type ItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type Totals = { total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number };

/** Finalize the already materialized tree without replaying its insertion. */
export async function finalizeAssemblyCalculation(input: {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  projectUserId: string;
  versionId: string;
  draftLockSessionId: string;
  insertedItemIds: string[];
}): Promise<{ items: ItemRow[]; version: { id: string; updated_at: string }; totals: Totals }> {
  const { supabase, tenantId, versionId } = input;
  let financialState: "not_committed" | "unknown" = "not_committed";
  try {
    const { data: version, error: versionError } = await supabase
      .from("estimate_versions")
      .select("id, status, updated_at, content_revision, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, rounding_mode, rounding_step_cents, calc_engine_version, contractor_role")
      .eq("tenant_id", tenantId).eq("id", versionId).single();
    if (versionError) throw mapSupabaseError(versionError, "Impossible de charger le calcul du devis.");
    if (!version || version.status !== "draft") throw conflict("Le devis a changé. Rechargez pour vérifier l'ouvrage inséré.");

    const items: EstimateItemRecord[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("estimate_items").select("*")
        .eq("tenant_id", tenantId).eq("version_id", versionId).eq("item_type", "line")
        .order("position", { ascending: true }).order("id").range(offset, offset + pageSize - 1);
      if (error) throw mapSupabaseError(error, "Impossible de charger les lignes du devis.");
      items.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
    const { breakdown, dependencies } = await calculateEstimateSnapshotForItems({
      supabase, tenantId, projectUserId: input.projectUserId, version, lineItems: items, captureDependencies: true,
    });
    if (!dependencies) throw internalError("Contexte de calcul indisponible.");
    const totals: Totals = {
      total_ht_cents: breakdown.totals.saleTotalCents,
      total_tax_cents: breakdown.totals.adjustedTaxCents,
      total_ttc_cents: breakdown.totals.roundedTtcCents,
    };
    let updates: Array<{ id: string; pu_ht_cents: number; line_total_ht_cents: number; line_tax_cents: number; line_total_ttc_cents: number }>;
    if (isUnifiedEngine(resolveCalcEngineVersion(version))) {
      if (!breakdown.invariants.matchesFooter) throw badRequest("Le calcul des lignes ne correspond pas au pied du devis.");
      updates = buildEstimateV2SnapshotProjection({ items, breakdown }).items.map((line) => ({
        id: line.id, pu_ht_cents: line.snapshot_pu_ht_cents, line_total_ht_cents: line.line_total_ht_cents,
        line_tax_cents: line.line_tax_cents, line_total_ttc_cents: line.line_total_ttc_cents,
      }));
    } else {
      // Legacy drafts keep gross line values; their footer includes discounts.
      updates = items.map((item) => {
        const line = breakdown.lineById.get(item.id);
        if (!line) throw internalError("Projection de ligne indisponible.");
        return { id: item.id, pu_ht_cents: line.puNetHtCents, line_total_ht_cents: line.saleGrossCents,
          line_tax_cents: line.taxCents, line_total_ttc_cents: line.saleGrossCents + line.taxCents };
      });
    }
    const { data: current, error: readError } = await supabase.from("estimate_versions")
      .select("updated_at, content_revision, status").eq("tenant_id", tenantId).eq("id", versionId).single();
    if (readError) throw mapSupabaseError(readError, "Impossible de vérifier la version calculée.");
    if (!current || current.status !== "draft" || current.updated_at !== version.updated_at || current.content_revision !== version.content_revision) {
      throw conflict("Le devis a changé pendant le calcul.", undefined, "VERSION_CONFLICT");
    }

    financialState = "unknown";
    const { data, error } = await supabase.rpc("finalize_estimate_assembly_calculation", {
      p_version_id: versionId, p_expected_updated_at: version.updated_at, p_expected_content_revision: version.content_revision,
      p_draft_lock_session_id: input.draftLockSessionId, p_inserted_item_ids: input.insertedItemIds,
      p_item_updates: updates as Json, p_version_patch: totals, p_calculation_context: dependencies as Json,
    });
    if (error) {
      // A PostgreSQL error aborts this transaction, including its row updates.
      // A transport error does not establish whether the commit happened.
      if (/^[0-9A-Z]{5}$/.test(error.code ?? "")) financialState = "not_committed";
      throw mapSupabaseError(error, "Impossible de confirmer les totaux de l'ouvrage inséré.");
    }
    const result = data as unknown as { items?: ItemRow[]; version?: { id: string; updated_at: string }; totals?: Totals } | null;
    if (!result || result.version?.id !== versionId || typeof result.version.updated_at !== "string" ||
      !Number.isFinite(Date.parse(result.version.updated_at)) || !Array.isArray(result.items) ||
      result.items.length !== input.insertedItemIds.length || result.items.some((item, index) => item.id !== input.insertedItemIds[index] || item.version_id !== versionId) ||
      !result.totals || result.totals.total_ht_cents !== totals.total_ht_cents || result.totals.total_tax_cents !== totals.total_tax_cents ||
      result.totals.total_ttc_cents !== totals.total_ttc_cents) {
      throw internalError("La confirmation des totaux du devis est invalide.");
    }
    return { items: result.items, version: result.version, totals: result.totals };
  } catch {
    throw new ApiError({
      status: 409,
      code: "ESTIMATE_ASSEMBLY_INSERT_PERSISTED",
      message: "L'ouvrage a été inséré, mais ses totaux n'ont pas pu être confirmés. Relisez le devis avant toute nouvelle insertion.",
      details: { versionId, insertedItemIds: input.insertedItemIds, insertionState: "persisted", financialState, retryInsertionAllowed: false },
    });
  }
}
