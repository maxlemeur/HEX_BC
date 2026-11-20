/**
 * Where the amounts of a version come from: its frozen amounts (stored columns of the version and
 * its lines) or a calculation from its inputs and the tenant's current settings (hourly rates,
 * margin tiers, labor split flag). Every surface that shows a version's amounts asks this module:
 * the detail and print pages, the PDF and the XLSX export read `resolveEstimateAmountsSource`; the
 * BDC and DPGF exports and their export context read `resolveEstimateCostingSheetSource`.
 *
 * Pure module: no Next or Supabase dependency, also read by the editor in the browser.
 */

import { engineFreezesSnapshot, type EstimateEngineVersion } from "@/lib/estimates/engine/capabilities";

export type EstimateAmountsSource = "frozen" | "live";

type RevisionColumns = {
  content_revision?: number | null;
  calc_snapshot_content_revision?: number | null;
};

export type EstimateAmountsSourceVersion = RevisionColumns & { status: string };

/**
 * The frozen amounts describe the current revision. Both columns are `bigint` read as JSON numbers;
 * `content_revision` is NOT NULL DEFAULT 1 CHECK (> 0) and `calc_snapshot_content_revision` is NULL
 * until the first freeze, CHECK (> 0) after. Any other value is not a revision of the version.
 */
export function hasFreshCalcSnapshot(version: RevisionColumns): boolean {
  const snapshotRevision = version.calc_snapshot_content_revision;
  return typeof snapshotRevision === "number" &&
    Number.isSafeInteger(snapshotRevision) &&
    snapshotRevision > 0 &&
    snapshotRevision === version.content_revision;
}

/**
 * A version that is no longer a draft is read from its frozen amounts, whatever its engine: an
 * issued estimate never changes with today's rates or flags. A draft of engine 2 or 3 is read from
 * its snapshot while it describes the current revision (a review freezes it before approval);
 * otherwise, and always for an engine-1 draft, its amounts are calculated live.
 */
export function resolveEstimateAmountsSource(
  engine: EstimateEngineVersion,
  version: EstimateAmountsSourceVersion
): EstimateAmountsSource {
  if (version.status !== "draft") return "frozen";
  return engineFreezesSnapshot(engine) && hasFreshCalcSnapshot(version) ? "frozen" : "live";
}

/**
 * Named exception for the costing sheets (BDC and DPGF exports). They list a line's inputs and its
 * costs, not its sale amounts: the BDC writes q × PU FO × K FO and h × K × hourly rate, and the DPGF
 * is re-imported as inputs. An engine-1 version stores neither its costs nor the hourly rates it was
 * priced with, so its costing sheets are built from its inputs (read-only once it is sent) at every
 * status. Engines 2 and 3 follow `resolveEstimateAmountsSource`.
 */
export function resolveEstimateCostingSheetSource(
  engine: EstimateEngineVersion,
  version: EstimateAmountsSourceVersion
): EstimateAmountsSource {
  return engine === 1 ? "live" : resolveEstimateAmountsSource(engine, version);
}
