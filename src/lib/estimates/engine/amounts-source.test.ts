import { describe, expect, it } from "vitest";

import {
  hasFreshCalcSnapshot,
  resolveEstimateAmountsSource,
  resolveEstimateCostingSheetSource,
} from "@/lib/estimates/engine/amounts-source";

// Isolation justifiée : cette règle choisit, pour chaque surface (fiche, impression, PDF, exports,
// lecture d'API), entre les montants figés d'une version et un recalcul du jour. Une erreur ne se
// voit dans un parcours que sur la combinaison moteur × statut × gel qui la déclenche ; la table
// les parcourt toutes.

// Colonnes `bigint` : `content_revision` NOT NULL DEFAULT 1 CHECK (> 0),
// `calc_snapshot_content_revision` NULL CHECK (NULL ou > 0). La révision 0 n'existe pas en base.
const SNAPSHOTS = {
  fresh: { content_revision: 7, calc_snapshot_content_revision: 7 },
  stale: { content_revision: 8, calc_snapshot_content_revision: 7 },
  absent: { content_revision: 7, calc_snapshot_content_revision: null },
  "revision 0": { content_revision: 0, calc_snapshot_content_revision: 0 },
} as const;

type Snapshot = keyof typeof SNAPSHOTS;
type Row = readonly [1 | 2 | 3, string, Snapshot, "frozen" | "live"];

const NOT_DRAFT = ["sending", "sent", "accepted", "archived"] as const;
const ALL_SNAPSHOTS = Object.keys(SNAPSHOTS) as Snapshot[];

// Every status that is not a draft is read frozen, whatever the engine and the snapshot.
const notDraftRows = (engine: 1 | 2 | 3): Row[] =>
  NOT_DRAFT.flatMap((status) => ALL_SNAPSHOTS.map((snapshot): Row => [engine, status, snapshot, "frozen"]));

const AMOUNTS: Row[] = [
  [1, "draft", "fresh", "live"],
  [1, "draft", "stale", "live"],
  [1, "draft", "absent", "live"],
  [1, "draft", "revision 0", "live"],
  [2, "draft", "fresh", "frozen"],
  [2, "draft", "stale", "live"],
  [2, "draft", "absent", "live"],
  [2, "draft", "revision 0", "live"],
  [3, "draft", "fresh", "frozen"],
  [3, "draft", "stale", "live"],
  [3, "draft", "absent", "live"],
  [3, "draft", "revision 0", "live"],
  ...notDraftRows(1),
  ...notDraftRows(2),
  ...notDraftRows(3),
];

// The costing sheets of an engine-1 version are built from its inputs at every status.
const COSTING_SHEETS: Row[] = AMOUNTS.map(([engine, status, snapshot, source]): Row =>
  [engine, status, snapshot, engine === 1 ? "live" : source]);

describe("resolveEstimateAmountsSource", () => {
  it.each(AMOUNTS)("engine %i, %s, snapshot %s: %s", (engine, status, snapshot, expected) => {
    expect(resolveEstimateAmountsSource(engine, { status, ...SNAPSHOTS[snapshot] })).toBe(expected);
  });
});

describe("resolveEstimateCostingSheetSource", () => {
  it.each(COSTING_SHEETS)("engine %i, %s, snapshot %s: %s", (engine, status, snapshot, expected) => {
    expect(resolveEstimateCostingSheetSource(engine, { status, ...SNAPSHOTS[snapshot] })).toBe(expected);
  });
});

describe("hasFreshCalcSnapshot", () => {
  it("is fresh only when the snapshot revision is the current one", () => {
    expect(hasFreshCalcSnapshot(SNAPSHOTS.fresh)).toBe(true);
    expect(hasFreshCalcSnapshot(SNAPSHOTS.stale)).toBe(false);
    expect(hasFreshCalcSnapshot(SNAPSHOTS.absent)).toBe(false);
  });

  it.each([
    ["revision 0", { content_revision: 0, calc_snapshot_content_revision: 0 }],
    ["a negative revision", { content_revision: -1, calc_snapshot_content_revision: -1 }],
    ["a fractional revision", { content_revision: 1.5, calc_snapshot_content_revision: 1.5 }],
    ["an unsafe integer", { content_revision: 2 ** 53, calc_snapshot_content_revision: 2 ** 53 }],
    ["numeric strings", { content_revision: "7", calc_snapshot_content_revision: "7" }],
    ["a numeric string snapshot", { content_revision: 7, calc_snapshot_content_revision: "7" }],
    ["a missing current revision", { calc_snapshot_content_revision: 7 }],
  ])("refuses %s, which the bigint columns never hold", (_name, version) => {
    expect(hasFreshCalcSnapshot(version as never)).toBe(false);
  });
});
