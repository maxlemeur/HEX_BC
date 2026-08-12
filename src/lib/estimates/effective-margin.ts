import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";

export type EffectiveMarginVersion = {
  calc_engine_version?: number | null;
  margin_bp?: number | null;
  margin_multiplier?: number | null;
  margin_mode?: "fixed" | "tiered" | null;
  content_revision?: number | string | null;
  calc_snapshot_content_revision?: number | string | null;
  calc_snapshot_context?: unknown;
};

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

  if (resolveCalcEngineVersion(version) === 1) {
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
