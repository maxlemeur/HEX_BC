import { resolveEstimateEngineVersionForDisplay } from "@/lib/estimates/calc-engine-version";
import { isLegacyEngine, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { computeEstimateV3NetMarginBp } from "@/lib/estimates/engine-v3";
import type { V3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server";

export type EffectiveMarginVersion = {
  calc_engine_version?: number | null;
  margin_bp?: number | null;
  margin_multiplier?: number | null;
  margin_mode?: "fixed" | "tiered" | null;
  content_revision?: number | string | null;
  calc_snapshot_content_revision?: number | string | null;
  calc_snapshot_context?: unknown;
  /** Moteur 3 : HT net et identité, comparés à la preuve vivante (D5). */
  total_ht_cents?: number | null;
  id?: string;
  tenant_id?: string;
  project_id?: string;
  status?: string;
  updated_at?: string;
};

const MAX_CENTS = 2_147_483_647;

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CENTS;
}

function evidenceMatches(version: EffectiveMarginVersion, evidence: V3MarginEvidence): boolean {
  const currentRevision = Number(version.content_revision);
  return evidence.source === "authenticated_live" && version.status === "draft" &&
    Number.isSafeInteger(currentRevision) && evidence.version.content_revision === currentRevision &&
    (["id", "tenant_id", "project_id", "status", "updated_at"] as const).every((key) =>
      typeof version[key] === "string" && version[key] === evidence.version[key]) &&
    evidence.net_ht_cents === version.total_ht_cents && isCents(evidence.cost_subtotal_cents);
}

/**
 * Lot 2, sous-lot 2.5 - marque nette v3 (D5, F20) : ⌈(HT − Σ D) × 10 000 / HT⌋ depuis une preuve
 * vivante liée à la révision courante, sinon depuis un gel v3 frais (`cost_subtotal_cents` du
 * contexte, jamais `effective_margin_multiplier`). Sans l'une ni l'autre, ou HT nul : `null`
 * (« indisponible »), jamais 0.
 */
export function resolveV3NetMarginBp(
  version: EffectiveMarginVersion,
  evidence?: V3MarginEvidence | null
): number | null {
  const netHtCents = version.total_ht_cents;
  if (!isCents(netHtCents)) return null;
  if (evidence && evidenceMatches(version, evidence)) {
    return computeEstimateV3NetMarginBp({ total_ht_cents: netHtCents, cost_subtotal_cents: evidence.cost_subtotal_cents });
  }
  const costSubtotalCents = readFreshV3CostSubtotalCents(version);
  if (costSubtotalCents === null) return null;
  return computeEstimateV3NetMarginBp({ total_ht_cents: netHtCents, cost_subtotal_cents: costSubtotalCents });
}

/** Déboursé Σ D d'un gel v3 frais (lié à la révision courante), sinon `null`. */
export function readFreshV3CostSubtotalCents(version: EffectiveMarginVersion): number | null {
  if (!hasFreshSnapshot(version)) return null;
  const context = version.calc_snapshot_context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const frozen = context as Record<string, unknown>;
  const costSubtotalCents = frozen.cost_subtotal_cents;
  return frozen.engine === 3 && isCents(costSubtotalCents) ? costSubtotalCents : null;
}

function toPositiveMultiplier(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 100
    ? value
    : null;
}

function readSnapshotMultiplier(context: unknown): number | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return null;
  }

  return toPositiveMultiplier(
    (context as Record<string, unknown>).effective_margin_multiplier
  );
}

function multiplierToBasisPoints(multiplier: number): number {
  return Math.max(0, Math.round((1 - 1 / multiplier) * 10_000));
}

function hasFreshSnapshot(version: EffectiveMarginVersion): boolean {
  const contentRevision = Number(version.content_revision);
  const snapshotRevision = Number(version.calc_snapshot_content_revision);
  return (
    Number.isSafeInteger(contentRevision) &&
    contentRevision > 0 &&
    snapshotRevision === contentRevision
  );
}

/**
 * Résout la marge réellement appliquée derrière une interface unique.
 *
 * - v1 conserve `margin_bp`, avec le coefficient historique comme repli ;
 * - v2 privilégie le coefficient figé par le moteur dans le snapshot ;
 * - un brouillon v2 fixed sans snapshot reste lisible via son coefficient ;
 * - un v2 tiered sans coefficient figé reste volontairement indéterminé : son
 *   coefficient configuré n'est pas le palier réellement appliqué.
 */
export function resolveEffectiveMarginBp(
  version: EffectiveMarginVersion
): number | null {
  const storedMarginBp =
    typeof version.margin_bp === "number" &&
    Number.isFinite(version.margin_bp) &&
    version.margin_bp >= 0
      ? version.margin_bp
      : null;
  const configuredMultiplier = toPositiveMultiplier(version.margin_multiplier);

  // Lot 2, sous-lot 2.5 : une v3 rend sa marque nette depuis un gel frais, jamais un multiplicateur.
  const calcEngineVersion = resolveEstimateEngineVersionForDisplay(version);
  if (calcEngineVersion === null) return null;
  if (usesSaleCoefficients(calcEngineVersion)) return resolveV3NetMarginBp(version);
  if (isLegacyEngine(calcEngineVersion)) {
    if (storedMarginBp !== null) return storedMarginBp;
    return configuredMultiplier === null
      ? null
      : multiplierToBasisPoints(configuredMultiplier);
  }

  const snapshotMultiplier = hasFreshSnapshot(version)
    ? readSnapshotMultiplier(version.calc_snapshot_context)
    : null;
  if (snapshotMultiplier !== null) {
    return multiplierToBasisPoints(snapshotMultiplier);
  }
  if (version.margin_mode === "tiered") return null;

  const effectiveMultiplier = configuredMultiplier;
  return effectiveMultiplier === null
    ? storedMarginBp
    : multiplierToBasisPoints(effectiveMultiplier);
}
