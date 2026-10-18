import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EstimateItem,
  PrepareEstimateDocumentV3Input,
} from "@/components/estimate-document/prepare-estimate-document-data";
import { requireEstimateEngineVersion, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { badRequest, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { calculateEstimateV3SnapshotForItems, type EstimateV3TotalsVersionConfig } from "@/lib/estimates/version-totals";
import type { Database } from "@/types/database";

/**
 * Lot 2, sous-lot 2.7 - source du document d'une v3 hors émission (aperçu d'impression, exports ;
 * conception D7, D8, D14). Une version émise, ou un brouillon dont le gel décrit la révision
 * courante, est relue sur son gel, sans recalcul. Un brouillon modifié depuis son dernier gel est
 * présenté par le moteur pur appliqué en mémoire aux colonnes figées : c'est exactement le calcul
 * que le gel écrirait (PostgreSQL le recontrôle au gel), et rien n'est écrit. L'émission (PDF,
 * envoi) fige toujours d'abord (`v3-document-snapshot-server.ts`).
 */

type Supabase = SupabaseClient<Database>;
type VersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];

export type EstimateV3DocumentSource = {
  /** Ligne de version (colonnes figées réelles, ou aperçu pour un brouillon modifié). */
  version: VersionRow & PrepareEstimateDocumentV3Input["version"];
  items: EstimateItem[];
  /** Vrai si les montants sont ceux du gel stocké (version émise ou gel à jour). */
  frozen: boolean;
};

/** Le gel v3 décrit la révision courante, ou la version n'est plus un brouillon. */
export function isEstimateV3DocumentFrozen(version: {
  status: string;
  content_revision: number;
  calc_snapshot_content_revision: number | null;
}): boolean {
  return version.status !== "draft"
    || (Number.isInteger(version.calc_snapshot_content_revision)
      && version.calc_snapshot_content_revision === version.content_revision);
}

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function loadEstimateV3DocumentSource(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}): Promise<EstimateV3DocumentSource> {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("*, estimate_projects!inner(user_id)")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .single();
  if (error) throw mapSupabaseError(error, "Impossible de charger la version.");
  if (!data) throw notFound("Version de chiffrage introuvable.");
  if (!usesSaleCoefficients(requireEstimateEngineVersion(data))) {
    throw badRequest("Le document v3 est réservé au moteur de calcul 3.");
  }
  const { estimate_projects: embedded, ...row } = data as VersionRow & {
    estimate_projects: { user_id: string } | { user_id: string }[] | null;
  };
  const stored = {
    ...row,
    gross_ht_cents: row.gross_ht_cents ?? null,
    discount_applied_cents: row.discount_applied_cents ?? null,
    commercial_rounding_cents: row.commercial_rounding_cents ?? null,
  };
  const items = await readAllEstimateItems(input);
  if (isEstimateV3DocumentFrozen(stored)) {
    await assertEstimateVersionUnchanged({ supabase: input.supabase, version: data });
    return { version: stored, items, frozen: true };
  }
  const project = resolveEmbeddedOne(embedded);
  if (!project) throw notFound("Version de chiffrage introuvable.");
  const { breakdown, projection } = await calculateEstimateV3SnapshotForItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectUserId: project.user_id,
    version: stored as unknown as EstimateV3TotalsVersionConfig,
    lineItems: items.filter((item) => item.item_type === "line"),
  });
  // Même refus que le gel (D12) : un document ne montre jamais une MO calculée sans taux horaire.
  const missingRoles = breakdown.warnings.flatMap((warning) =>
    warning.code === "ESTIMATE_V3_LABOR_RATE_MISSING" ? [warning.line_id] : []);
  if (missingRoles.length > 0) {
    throw badRequest(
      "Un rôle de main-d'oeuvre est requis pour chaque ligne qui porte des heures.",
      { item_ids: missingRoles },
      "ESTIMATE_LABOR_ROLE_REQUIRED"
    );
  }
  // Même refus nommé que le gel (D9, `prepareEstimateV3FreezeArguments`) : une ligne chiffrée sans
  // unité ne peut pas être figée, donc pas présentée (revue 2.7 : le préparateur levait sinon
  // ESTIMATE_V3_STORED_INCOHERENT pendant le rendu de l'aperçu et des exports).
  const unitById = new Map(items.map((item) => [item.id, item.unit_code ?? null]));
  const missingUnits = breakdown.lines
    .filter((line) => line.pricing_status === "priced" && !unitById.get(line.id))
    .map((line) => line.id);
  if (missingUnits.length > 0) {
    throw badRequest("Une unité est requise sur chaque ligne chiffrée avant le gel.", { item_ids: missingUnits },
      "ESTIMATE_V3_UNIT_REQUIRED");
  }
  const projected = new Map(projection.items.map((entry) => [entry.id, entry]));
  const previewItems = items.map((item) => {
    const line = item.item_type === "line" ? projected.get(item.id) : undefined;
    if (!line) return item;
    return {
      ...item,
      pu_ht_cents: line.pu_ht_cents,
      snapshot_pu_ht_cents: line.snapshot_pu_ht_cents,
      snapshot_gross_ht_cents: line.snapshot_gross_ht_cents,
      snapshot_gross_fo_ht_cents: line.snapshot_gross_fo_ht_cents,
      line_total_ht_cents: line.line_total_ht_cents,
      line_tax_cents: line.line_tax_cents,
      line_total_ttc_cents: line.line_total_ttc_cents,
      snapshot_fo_ht_cents: line.snapshot_fo_ht_cents,
      snapshot_mo_ht_cents: line.snapshot_mo_ht_cents,
      snapshot_mo_atelier_ht_cents: line.snapshot_mo_atelier_ht_cents,
      snapshot_mo_chantier_ht_cents: line.snapshot_mo_chantier_ht_cents,
    };
  });
  const totals = projection.version;
  await assertEstimateVersionUnchanged({ supabase: input.supabase, version: data });
  return {
    version: {
      ...stored,
      gross_ht_cents: totals.gross_ht_cents,
      discount_applied_cents: totals.discount_applied_cents,
      commercial_rounding_cents: totals.commercial_rounding_cents,
      total_ht_cents: totals.total_ht_cents,
      total_tax_cents: totals.total_tax_cents,
      total_ttc_cents: totals.total_ttc_cents,
      rounding_adjustment_cents: 0,
      calc_snapshot_context: projection.context as unknown as VersionRow["calc_snapshot_context"],
    },
    items: previewItems,
    frozen: false,
  };
}
