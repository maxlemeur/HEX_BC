import type { SupabaseClient } from "@supabase/supabase-js";

import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import {
  isUnifiedEngine,
  requireEstimateEngineVersion,
  requireHistoricalEngine,
} from "@/lib/estimates/engine/capabilities";
import { badRequest, conflict, forbidden, internalError, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { calculateEstimateSnapshotForItems } from "@/lib/estimates/version-totals";
import type { Database, Json } from "@/types/database";

type Version = Database["public"]["Tables"]["estimate_versions"]["Row"];
type Item = Database["public"]["Tables"]["estimate_items"]["Row"];
type VersionPatch = Database["public"]["Tables"]["estimate_versions"]["Update"];
type Supabase = SupabaseClient<Database>;

/** Prepare from a complete, authorized draft; commit all settings and money once. */
export async function persistAtomicEstimateSettings(input: {
  supabase: Supabase;
  rpcClient: Supabase;
  tenantId: string;
  actorUserId: string;
  projectUserId: string;
  authorizedVersion: Pick<Version, "id" | "project_id" | "updated_at" | "content_revision" | "status">;
  expectedUpdatedAt: string;
  expectedContentRevision: number;
  draftLockSessionId: string;
  patch: VersionPatch;
}): Promise<{ version: Version; items: Item[] }> {
  const { supabase, tenantId, authorizedVersion } = input;
  const { data: version, error: readError } = await supabase.from("estimate_versions")
    .select("*").eq("tenant_id", tenantId).eq("id", authorizedVersion.id).single();
  if (readError) throw mapSupabaseError(readError, "Impossible de charger les paramètres du devis.");
  if (!version) throw notFound("Version de chiffrage introuvable.");
  // Lot 2, sous-lot 2.1 : les réglages d'une v3 ne sont jamais recalculés en v1 ni envoyés.
  const calcEngineVersion = requireHistoricalEngine(requireEstimateEngineVersion(version));
  if (version.project_id !== authorizedVersion.project_id || version.status !== "draft" ||
    version.updated_at !== authorizedVersion.updated_at || version.content_revision !== authorizedVersion.content_revision ||
    version.content_revision !== input.expectedContentRevision) {
    throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, undefined, "VERSION_CONFLICT");
  }
  const items = await readAllEstimateItems({ supabase, tenantId, versionId: version.id });
  const prospectiveVersion = { ...version, ...input.patch } as Version;
  if (prospectiveVersion.discount_amount_cents != null &&
    (!Number.isInteger(prospectiveVersion.discount_amount_cents) ||
      prospectiveVersion.discount_amount_cents < 0 || prospectiveVersion.discount_amount_cents > 2147483647 ||
      prospectiveVersion.discount_mode !== "simple" || prospectiveVersion.discount_steps.length > 0)) {
    throw badRequest("Une remise fixe valide requiert le mode simple et aucun palier.");
  }
  const isV2 = isUnifiedEngine(calcEngineVersion);
  const lineItems = items.filter((item) => item.item_type === "line")
    .map((item) => isV2 ? item : { ...item, tax_rate_bp: prospectiveVersion.tax_rate_bp });
  const { breakdown, dependencies } = await calculateEstimateSnapshotForItems({
    supabase, tenantId, projectUserId: input.projectUserId, version: prospectiveVersion,
    lineItems, captureDependencies: true,
  });
  if (!dependencies) throw internalError("Contexte de calcul indisponible.");
  const totals = {
    total_ht_cents: breakdown.totals.saleTotalCents,
    total_tax_cents: breakdown.totals.adjustedTaxCents,
    total_ttc_cents: breakdown.totals.roundedTtcCents,
    rounding_adjustment_cents: breakdown.totals.roundingAdjustmentCents,
  };
  const projections = isV2
    ? buildEstimateV2SnapshotProjection({ items: lineItems, breakdown }).items.map((line) => ({
      id: line.id, pu_ht_cents: line.snapshot_pu_ht_cents,
      line_total_ht_cents: line.line_total_ht_cents, line_tax_cents: line.line_tax_cents,
      line_total_ttc_cents: line.line_total_ttc_cents,
    }))
    : lineItems.map((item) => {
      const line = breakdown.lineById.get(item.id);
      if (!line) throw internalError("Projection de ligne indisponible.");
      return { id: item.id, pu_ht_cents: line.puNetHtCents,
        line_total_ht_cents: line.saleGrossCents, line_tax_cents: line.taxCents,
        line_total_ttc_cents: line.saleGrossCents + line.taxCents, tax_rate_bp: prospectiveVersion.tax_rate_bp };
    });
  await assertEstimateVersionUnchanged({ supabase, version });
  const { data, error } = await input.rpcClient.rpc("save_estimate_settings_atomic", {
    p_version_id: version.id, p_tenant_id: tenantId, p_actor_user_id: input.actorUserId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_expected_content_revision: input.expectedContentRevision,
    p_draft_lock_session_id: input.draftLockSessionId,
    p_settings_patch: { ...input.patch, margin_multiplier: breakdown.totals.appliedMarginMultiplier } as Json,
    p_line_projections: projections as Json, p_totals: totals,
    p_expected_dependencies: dependencies as unknown as Json,
  });
  if (error) {
    const message = error.message ?? "";
    const details = error.code ? { code: error.code } : undefined;
    if (message.includes("ESTIMATE_DRAFT_LOCK_REQUIRED")) {
      throw conflict("Un verrou actif de cette page est requis pour modifier le devis.", { lock: null }, "LOCK_REQUIRED");
    }
    if (message.includes("ESTIMATE_NOT_FOUND")) throw notFound("Version de chiffrage introuvable.", details);
    if (message.includes("ESTIMATE_READ_ONLY")) throw forbidden("Cette version est en lecture seule.", details, "READ_ONLY");
    if (message.includes("ESTIMATE_WRITE_FORBIDDEN") || message.includes("ESTIMATE_TENANT_INACTIVE")) {
      throw forbidden("Accès refusé.", details, "FORBIDDEN");
    }
    if (message.includes("CONTEXT_CHANGED")) {
      throw conflict("Le contexte de calcul a changé. Rechargez le devis avant d'enregistrer.", details, "CONTEXT_CHANGED");
    }
    if (message.includes("ESTIMATE_SETTINGS_INVALID_INPUT") || message.includes("ESTIMATE_SETTINGS_PROJECTION_MISMATCH")) {
      throw badRequest("Le calcul des paramètres du devis est invalide.", details);
    }
    if (message.includes("ESTIMATE_VERSION_CONFLICT") || error.code === "40001" || error.code === "55P03") {
      throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, details, "VERSION_CONFLICT");
    }
    throw mapSupabaseError(error, "Impossible de sauvegarder les paramètres du devis.");
  }
  const result = data as unknown as { version?: Version; items?: Item[] } | null;
  const returnedVersion = result?.version;
  const returnedItems = result?.items;
  const expectedIds = new Set(items.map((item) => item.id));
  if (!returnedVersion || returnedVersion.id !== version.id || returnedVersion.tenant_id !== tenantId ||
    returnedVersion.project_id !== version.project_id || returnedVersion.status !== "draft" ||
    typeof returnedVersion.updated_at !== "string" || !Number.isFinite(Date.parse(returnedVersion.updated_at)) ||
    !Number.isSafeInteger(returnedVersion.content_revision) || returnedVersion.content_revision < input.expectedContentRevision ||
    (Object.keys(totals) as Array<keyof typeof totals>).some((key) => returnedVersion[key] !== totals[key]) ||
    !Array.isArray(returnedItems) || returnedItems.length !== items.length ||
    new Set(returnedItems.map((item) => item.id)).size !== items.length ||
    returnedItems.some((item) => !expectedIds.has(item.id) || item.version_id !== version.id || item.tenant_id !== tenantId)) {
    throw internalError("La sauvegarde a répondu sans confirmation complète. Relisez le devis avant d'enregistrer à nouveau.");
  }
  return { version: returnedVersion, items: returnedItems };
}
