import type { SupabaseClient } from "@supabase/supabase-js";

import { buildEstimateV2SnapshotProjection } from "@/lib/estimate-v2-snapshot";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import {
  assertNever,
  isUnifiedEngine,
  requireEstimateEngineVersion,
  type EstimateEngineVersion,
} from "@/lib/estimates/engine/capabilities";
import { badRequest, conflict, forbidden, internalError, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { assertEstimateV3VersionShape, toEstimateV3VersionTotals } from "@/lib/estimates/v3-persistence";
import {
  calculateEstimateSnapshotForItems,
  calculateEstimateV3SnapshotForItems,
  type EstimateCalculationDependencies,
} from "@/lib/estimates/version-totals";
import type { Database, Json } from "@/types/database";

type Version = Database["public"]["Tables"]["estimate_versions"]["Row"];
type Item = Database["public"]["Tables"]["estimate_items"]["Row"];
type VersionPatch = Database["public"]["Tables"]["estimate_versions"]["Update"];
type Supabase = SupabaseClient<Database>;

type PreparedSettings = {
  settingsPatch: Record<string, unknown>;
  projections: Array<Record<string, unknown>>;
  totals: Record<string, number>;
  dependencies: EstimateCalculationDependencies;
};

/** Réglages réservés au moteur 3 (D5, D8) : refusés par leur nom sur une v1/v2. */
const V3_SETTINGS_KEYS = ["sale_coefficient_fo", "sale_coefficient_mo"] as const;

type PrepareInput = {
  supabase: Supabase;
  tenantId: string;
  projectUserId: string;
  version: Version;
  items: Item[];
  patch: VersionPatch;
  applyTaxRateToLines: boolean;
};

/** v1/v2 : préparation inchangée (moteur historique, projection v2 ou lignes brutes v1). */
async function prepareHistoricalSettings(input: PrepareInput & { calcEngineVersion: 1 | 2 }): Promise<PreparedSettings> {
  const { supabase, tenantId, version, items } = input;
  const v3Keys = V3_SETTINGS_KEYS.filter((key) => input.patch[key] !== undefined);
  if (v3Keys.length > 0 || input.applyTaxRateToLines) {
    throw badRequest("Ces réglages sont réservés au moteur de calcul 3.",
      { fields: input.applyTaxRateToLines ? [...v3Keys, "apply_tax_rate_to_lines"] : v3Keys },
      "ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED");
  }
  const prospectiveVersion = { ...version, ...input.patch } as Version;
  if (prospectiveVersion.discount_amount_cents != null &&
    (!Number.isInteger(prospectiveVersion.discount_amount_cents) ||
      prospectiveVersion.discount_amount_cents < 0 || prospectiveVersion.discount_amount_cents > 2147483647 ||
      prospectiveVersion.discount_mode !== "simple" || prospectiveVersion.discount_steps.length > 0)) {
    throw badRequest("Une remise fixe valide requiert le mode simple et aucun palier.");
  }
  const isV2 = isUnifiedEngine(input.calcEngineVersion);
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
  return {
    settingsPatch: { ...input.patch, margin_multiplier: breakdown.totals.appliedMarginMultiplier },
    projections, totals, dependencies,
  };
}

/**
 * Lot 2, sous-lot 2.5 - réglages d'une v3 (D5 à D8) : coefficients de vente, intention de remise
 * telle que saisie (jamais dérivée de l'autre : deux intentions sont refusées), taux par défaut
 * éventuellement appliqué à toutes les lignes dans la même transaction, aucun barème. Projections
 * de ligne avec leur taux, sept totaux, dépendances (rôles du propriétaire, ventilation).
 */
async function prepareV3Settings(input: PrepareInput): Promise<PreparedSettings> {
  const prospectiveVersion = { ...input.version, ...input.patch } as Version;
  assertEstimateV3VersionShape(prospectiveVersion);
  const lineItems = input.items.filter((item) => item.item_type === "line")
    .map((item) => input.applyTaxRateToLines ? { ...item, tax_rate_bp: prospectiveVersion.tax_rate_bp } : item);
  const { breakdown, dependencies } = await calculateEstimateV3SnapshotForItems({
    supabase: input.supabase, tenantId: input.tenantId, projectUserId: input.projectUserId,
    version: prospectiveVersion, lineItems, captureDependencies: true,
  });
  if (!dependencies) throw internalError("Contexte de calcul indisponible.");
  const totals = toEstimateV3VersionTotals(breakdown);
  return {
    settingsPatch: { ...input.patch, ...(input.applyTaxRateToLines ? { apply_tax_rate_to_lines: true } : {}) },
    projections: breakdown.lines.map((line) => ({
      id: line.id, pu_ht_cents: line.pu_ht_cents, line_total_ht_cents: line.line_total_ht_cents,
      line_tax_cents: line.line_tax_cents, line_total_ttc_cents: line.line_total_ttc_cents, tax_rate_bp: line.tax_rate_bp,
    })),
    totals: {
      total_ht_cents: totals.total_ht_cents,
      total_tax_cents: totals.total_tax_cents,
      total_ttc_cents: totals.total_ttc_cents,
      rounding_adjustment_cents: 0,
      gross_ht_cents: totals.gross_ht_cents,
      discount_applied_cents: totals.discount_applied_cents,
      commercial_rounding_cents: totals.commercial_rounding_cents,
    },
    dependencies,
  };
}

function prepareSettings(engine: EstimateEngineVersion, input: PrepareInput): Promise<PreparedSettings> {
  switch (engine) {
    case 1:
    case 2:
      return prepareHistoricalSettings({ ...input, calcEngineVersion: engine });
    case 3:
      return prepareV3Settings(input);
    default:
      return assertNever(engine);
  }
}

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
  /** Moteur 3 (D8) : le taux de la version devient celui de toutes les lignes. */
  applyTaxRateToLines?: boolean;
}): Promise<{ version: Version; items: Item[] }> {
  const { supabase, tenantId, authorizedVersion } = input;
  const { data: version, error: readError } = await supabase.from("estimate_versions")
    .select("*").eq("tenant_id", tenantId).eq("id", authorizedVersion.id).single();
  if (readError) throw mapSupabaseError(readError, "Impossible de charger les paramètres du devis.");
  if (!version) throw notFound("Version de chiffrage introuvable.");
  // Lot 2, sous-lot 2.5 : aiguillage à trois branches ; une v3 n'est jamais recalculée en v1/v2.
  const engine = requireEstimateEngineVersion(version);
  if (version.project_id !== authorizedVersion.project_id || version.status !== "draft" ||
    version.updated_at !== authorizedVersion.updated_at || version.content_revision !== authorizedVersion.content_revision ||
    version.content_revision !== input.expectedContentRevision) {
    throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, undefined, "VERSION_CONFLICT");
  }
  const items = await readAllEstimateItems({ supabase, tenantId, versionId: version.id });
  const { settingsPatch, projections, totals, dependencies } = await prepareSettings(engine, {
    supabase, tenantId, projectUserId: input.projectUserId, version, items, patch: input.patch,
    applyTaxRateToLines: input.applyTaxRateToLines === true,
  });
  await assertEstimateVersionUnchanged({ supabase, version });
  const { data, error } = await input.rpcClient.rpc("save_estimate_settings_atomic", {
    p_version_id: version.id, p_tenant_id: tenantId, p_actor_user_id: input.actorUserId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_expected_content_revision: input.expectedContentRevision,
    p_draft_lock_session_id: input.draftLockSessionId,
    p_settings_patch: settingsPatch as Json,
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
    if (message.includes("ESTIMATE_SETTINGS_INVALID_INPUT") || message.includes("ESTIMATE_SETTINGS_PROJECTION_MISMATCH") ||
      message.includes("ESTIMATE_V3_PROJECTION_MISMATCH")) {
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
    Object.keys(totals).some((key) => (returnedVersion as Record<string, unknown>)[key] !== totals[key]) ||
    !Array.isArray(returnedItems) || returnedItems.length !== items.length ||
    new Set(returnedItems.map((item) => item.id)).size !== items.length ||
    returnedItems.some((item) => !expectedIds.has(item.id) || item.version_id !== version.id || item.tenant_id !== tenantId)) {
    throw internalError("La sauvegarde a répondu sans confirmation complète. Relisez le devis avant d'enregistrer à nouveau.");
  }
  return { version: returnedVersion, items: returnedItems };
}
