import type { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { computeV3MarginAnalysis } from "@/lib/affaires/margin-analysis-v3";
import type { AffaireHubMarginV3Notice, MarginVersionPoint } from "@/lib/affaires/server";
import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import { resolveEstimateEngineVersionForDisplay } from "@/lib/estimates/calc-engine-version";
import { readFreshV3CostSubtotalCents } from "@/lib/estimates/effective-margin";
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { mapSupabaseError } from "@/lib/estimates/errors";
import type { EstimateV3LineRecord } from "@/lib/estimates/v3-persistence";
import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { Database } from "@/types/database";

/*
 * Analyse de marge du hub : évolution par version et lectures partagées avec la version courante. Sorti de
 * `server.ts` au lot 3.2 (entrée 4, D-d), quand l'évolution s'est mise à lire les v3 antérieures.
 */

type AffaireContext = Awaited<ReturnType<typeof getAuthenticatedContext>>;
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];

function toSafeInteger(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export type MarginAnalysisVersionRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "total_ht_cents"
  | "margin_multiplier"
  | "margin_mode"
  | "tax_rate_bp"
  | "discount_bp"
  | "discount_amount_cents"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "updated_at"
  | "calc_engine_version"
  | "rounding_mode"
  | "rounding_step_cents"
  | "contractor_role"
  | "sale_coefficient_fo"
  | "sale_coefficient_mo"
  | "content_revision"
  | "calc_snapshot_content_revision"
  | "calc_snapshot_context"
>;

/** Vente HT et déboursé d'une v3, d'où son point de l'évolution. */
type V3MarginEvolutionTotals = { saleCents: number; costCents: number };

export function buildMarginVersionEvolution(
  versions: MarginAnalysisVersionRow[],
  v3Totals: ReadonlyMap<string, V3MarginEvolutionTotals>
): MarginVersionPoint[] {
  // Lot 3.2 (entrée 4, D-d) : une v3 est tracée à sa marge sur déboursé, la mesure de « Marge globale » (coefficient
  // réalisé − 1), qui prolonge le multiplicateur v2 ; sans déboursé calculable, elle est nommée par l'avis, jamais
  // tracée à 0 %. Un moteur illisible reste absent.
  return versions.flatMap((v) => {
    const engine = resolveEstimateEngineVersionForDisplay(v);
    if (engine === null) return [];
    const point = {
      versionNumber: toSafeInteger(v.version_number),
      versionId: v.id,
      status: v.status,
      totalHtCents: toSafeInteger(v.total_ht_cents),
    };
    if (usesSaleCoefficients(engine)) {
      const totals = v3Totals.get(v.id);
      if (!totals || totals.costCents <= 0) return [];
      return [{
        ...point,
        marginMultiplier: totals.saleCents / totals.costCents,
        marginPercent: ((totals.saleCents - totals.costCents) / totals.costCents) * 100,
      }];
    }
    const mm = Number.isFinite(v.margin_multiplier) ? v.margin_multiplier : 1;
    return [{ ...point, marginMultiplier: mm, marginPercent: (mm - 1) * 100 }];
  });
}

/**
 * Sous-lot 2.10a (A16, D-d), revu au lot 3.2 : les v3 sans point (aucun déboursé calculable : vierge, entrée
 * illisible, émise sans gel frais) sont nommées à l'utilisateur, jamais retirées sans le dire. Rendu aussi quand
 * l'analyse ne se calcule pas (revue Codex de la PR #57), pour la seule version courante : `null` sans telle v3.
 */
export function marginEvolutionV3Notice(
  versions: MarginAnalysisVersionRow[],
  v3Totals: ReadonlyMap<string, V3MarginEvolutionTotals> = new Map()
): AffaireHubMarginV3Notice | null {
  const versionNumbers = versions
    .filter((v) => {
      const engine = resolveEstimateEngineVersionForDisplay(v);
      if (engine === null || !usesSaleCoefficients(engine)) return false;
      return (v3Totals.get(v.id)?.costCents ?? 0) <= 0;
    })
    .map((v) => toSafeInteger(v.version_number));
  return versionNumbers.length > 0 ? { versionEvolutionUnavailableV3: versionNumbers } : null;
}

export type MarginAnalysisItem = EstimateItemRecord & EstimateV3LineRecord;

/** Lignes lues par l'analyse de marge, version courante comme brouillons v3 de l'évolution. */
export const MARGIN_ANALYSIS_ITEM_COLUMNS =
  "id, version_id, parent_id, item_type, position, title, description, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, h_mo_atelier, k_mo_atelier, labor_role_atelier_id, h_mo_chantier, k_mo_chantier, labor_role_chantier_id, pu_ht_cents, labor_role_id, category_id, supply_type_id, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, unit_code, pricing_status, h_mo_per_unit, h_mo_atelier_per_unit, h_mo_chantier_per_unit";

/** Taux horaires des rôles des lignes (MO, atelier, chantier). */
export async function readMarginLaborRates(context: AffaireContext, items: readonly MarginAnalysisItem[]) {
  const laborRoleIds = new Set<string>();
  for (const item of items) {
    if (item.labor_role_id) laborRoleIds.add(item.labor_role_id);
    if (item.labor_role_atelier_id) laborRoleIds.add(item.labor_role_atelier_id);
    if (item.labor_role_chantier_id) laborRoleIds.add(item.labor_role_chantier_id);
  }

  const laborRateById = new Map<string, number>();
  if (laborRoleIds.size > 0) {
    const { data: rolesData, error: rolesError } = await context.supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .eq("tenant_id", context.tenantId)
      .in("id", [...laborRoleIds]);

    if (rolesError) {
      throw mapSupabaseError(rolesError, "Impossible de charger les rôles main d'oeuvre.");
    }

    for (const role of rolesData ?? []) {
      laborRateById.set(role.id, role.hourly_rate_cents ?? 0);
    }
  }
  return laborRateById;
}

/**
 * Lot 3.2 (entrée 4, D-d) : vente et déboursé des v3 de l'évolution autres que la version courante. Un gel v3 frais
 * fait foi ; un brouillon sans gel est calculé en direct par la façade, comme la version courante ; une v3 émise sans
 * gel frais reste sans point (jamais de tarif vivant pour une version émise).
 */
export async function readMarginEvolutionV3Totals(input: {
  context: AffaireContext;
  versions: MarginAnalysisVersionRow[];
  currentVersionId: string;
  laborSplitEnabled: boolean;
}): Promise<Map<string, V3MarginEvolutionTotals>> {
  const totals = new Map<string, V3MarginEvolutionTotals>();
  const liveDrafts: MarginAnalysisVersionRow[] = [];
  for (const version of input.versions) {
    const engine = resolveEstimateEngineVersionForDisplay(version);
    if (version.id === input.currentVersionId || engine === null || !usesSaleCoefficients(engine)) continue;
    const frozenCostCents = readFreshV3CostSubtotalCents(version);
    if (frozenCostCents !== null) {
      totals.set(version.id, { saleCents: toSafeInteger(version.total_ht_cents), costCents: frozenCostCents });
    } else if (version.status === "draft") {
      liveDrafts.push(version);
    }
  }
  if (liveDrafts.length === 0) return totals;

  // Un brouillon antérieur illisible, ou modifié pendant sa lecture, n'a pas de point : l'avis le nomme et la carte
  // de la version courante reste rendue (elle ne lisait aucune autre version avant le lot 3.2).
  try {
    const { data, error } = await readAllRowsInChunks(liveDrafts.map((version) => version.id), (versionIds) =>
      input.context.supabase
        .from("estimate_items")
        .select(MARGIN_ANALYSIS_ITEM_COLUMNS, { count: "exact" })
        .eq("tenant_id", input.context.tenantId)
        .in("version_id", versionIds));
    if (error) return totals;
    const items = (data ?? []) as Array<MarginAnalysisItem & { version_id: string }>;
    const laborRatesById = await readMarginLaborRates(input.context, items);
    for (const version of liveDrafts) {
      try {
        const analysis = computeV3MarginAnalysis({
          version,
          items: items.filter((item) => item.version_id === version.id),
          laborRatesById,
          laborSplitEnabled: input.laborSplitEnabled,
        });
        if (analysis) totals.set(version.id, { saleCents: analysis.global.saleCents, costCents: analysis.global.costCents });
      } catch {
        // Réglages v3 refusés par la façade : version sans point, nommée par l'avis.
      }
    }
  } catch {
    // Lecture incomplète ou rôles illisibles : les brouillons restent sans point, nommés par l'avis.
  }
  return totals;
}
