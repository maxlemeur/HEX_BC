import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveEstimateEngineVersionForDisplay } from "@/lib/estimates/calc-engine-version";
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { ApiError, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { toEstimateV3VersionTotals } from "@/lib/estimates/v3-persistence";
import { calculateEstimateV3SnapshotForItems, type EstimateV3TotalsVersionConfig } from "@/lib/estimates/version-totals";
import type { Database } from "@/types/database";

/**
 * Lot 2, sous-lot 2.5 - preuve vivante de marque nette v3 (conception D5, F20, T-MARG) pour la
 * règle `min_margin` et la Direction, sur le modèle de `fixed-discount-evidence-server.ts` :
 * calculée côté serveur par le moteur pur, liée à l'identité et à la révision courantes de la
 * version, et seulement si le calcul vivant retrouve exactement les montants stockés. Sans
 * preuve, la marque est « indisponible », jamais 0 (`resolveV3NetMarginBp`).
 */

type Supabase = SupabaseClient<Database>;

export type V3MarginEvidence = {
  source: "authenticated_live";
  version: { id: string; tenant_id: string; project_id: string; status: string; content_revision: number; updated_at: string };
  /** HT net N, égal à `version.total_ht_cents`. */
  net_ht_cents: number;
  /** Déboursé Σ D (§4.5). */
  cost_subtotal_cents: number;
};

type AuthorizedVersion = {
  id: string;
  project_id: string;
  status: string;
  updated_at: string;
  content_revision: number;
  total_ht_cents: number;
  calc_engine_version?: number | null;
};

/** Appelée après le contrôle d'accès ; n'écrit rien et ne lit jamais de tarif vivant pour une v3 émise. */
export async function loadV3MarginEvidence(input: {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  authorizedVersion: AuthorizedVersion;
}): Promise<V3MarginEvidence | null> {
  const engine = resolveEstimateEngineVersionForDisplay(input.authorizedVersion);
  if (engine === null || !usesSaleCoefficients(engine) || input.authorizedVersion.status !== "draft") return null;
  const version = input.authorizedVersion;
  return loadV3MarginEvidenceForRevision(input.supabase, input.tenantId, input.projectUserId,
    version.id, version.project_id, version.status, version.updated_at, version.content_revision, version.total_ht_cents);
}

/**
 * Le calcul vivant d'une révision (plusieurs centaines de ms sur un gros devis) se fait une fois par
 * rendu : le résumé du hub, les signaux Direction et les règles d'approbation lisent la même révision.
 * Toute écriture change `updated_at`, donc la clé : une version modifiée est recalculée.
 */
const loadV3MarginEvidenceForRevision = cache(async (
  supabase: Supabase,
  tenantId: string,
  projectUserId: string,
  versionId: string,
  projectId: string,
  status: string,
  updatedAt: string,
  contentRevision: number,
  totalHtCents: number,
): Promise<V3MarginEvidence | null> => {
  const input = {
    supabase, tenantId, projectUserId,
    authorizedVersion: {
      id: versionId, project_id: projectId, status, updated_at: updatedAt,
      content_revision: contentRevision, total_ht_cents: totalHtCents,
    },
  };
  const { data, error } = await input.supabase.from("estimate_versions").select("*")
    .eq("tenant_id", input.tenantId).eq("id", input.authorizedVersion.id).single();
  if (error) throw mapSupabaseError(error, "Impossible de charger la preuve de marge.");
  if (!data) throw notFound("Version de chiffrage introuvable.");
  const version = data;
  // Version relue différente de celle autorisée (projection d'approbation, écriture concurrente) :
  // aucune preuve, la marque retombe sur le gel frais ou devient indisponible.
  if (version.tenant_id !== input.tenantId || (["id", "project_id", "status", "updated_at", "content_revision",
    "total_ht_cents"] as const).some((key) => input.authorizedVersion[key] !== version[key])) return null;
  const items = await readAllEstimateItems({ supabase: input.supabase, tenantId: input.tenantId, versionId: version.id });
  const { breakdown } = await calculateEstimateV3SnapshotForItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectUserId: input.projectUserId,
    version: version as EstimateV3TotalsVersionConfig,
    lineItems: items.filter((item) => item.item_type === "line"),
  });
  try {
    await assertEstimateVersionUnchanged({ supabase: input.supabase, version });
  } catch (error) {
    // Écriture concurrente pendant le calcul : la preuve décrirait une autre révision.
    if (error instanceof ApiError && error.code === "VERSION_CONFLICT") return null;
    throw error;
  }
  // Une preuve n'est donnée que pour les montants stockés : un taux horaire changé depuis la
  // dernière sauvegarde rend la marque indisponible au lieu d'en inventer une autre.
  const live = toEstimateV3VersionTotals(breakdown);
  const stored = version as Record<string, unknown>;
  if ((Object.keys(live) as Array<keyof typeof live>).some((key) => stored[key] !== live[key])) return null;
  return {
    source: "authenticated_live",
    version: {
      id: version.id, tenant_id: version.tenant_id, project_id: version.project_id,
      status: version.status, content_revision: version.content_revision, updated_at: version.updated_at,
    },
    net_ht_cents: version.total_ht_cents,
    cost_subtotal_cents: breakdown.totals.cost_subtotal_cents,
  };
});
