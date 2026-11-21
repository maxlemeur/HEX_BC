import { describe, expect, it } from "vitest";

import {
  allotTakeoffVectorPages, buildTakeoffLaunchManifest, buildTakeoffPlanLaunchManifest, compareTakeoffPlansForDispatch, splitTakeoffRequestBudget,
  takeoffPlanUnitKey, takeoffPlanWeights, TAKEOFF_LAUNCH_MAX_UNITS,
} from "@/lib/takeoff/launch-request";
import {
  describeTakeoffCoverage, describeTakeoffRequestEnd, summarizeTakeoffCoverage, type TakeoffUnitState,
} from "@/lib/takeoff/launch-request-coverage";
import type { TakeoffPreparationSource } from "@/lib/takeoff/preparation";

// Fictional plans of one dossier: the identifiers sort in another order than the names a member reads.
const plan = (id: string, name: string, pages: number[], pageCount: number | null): TakeoffPreparationSource => ({
  document_id: id, document_name: name, kind: "plan", active: true, pages, page_count: pageCount, plan_set_id: "70000000-0000-4000-8000-000000000001",
  content_hash: `${id.slice(-1)}`.repeat(64), source_version: `v-${id}`, file_path: `fixture/${id}.pdf`, mime_type: "application/pdf",
} as unknown as TakeoffPreparationSource);
const reference = { document_id: "80000000-0000-4000-8000-000000000001", document_name: "CCTP.pdf", kind: "cctp", active: true, pages: [],
  content_hash: "c".repeat(64) } as unknown as TakeoffPreparationSource;

const sources = [
  plan("90000000-0000-4000-8000-00000000000a", "Plan 10 - Étage", [], 4),
  plan("90000000-0000-4000-8000-00000000000b", "plan 2 - RDC", [2, 7], 9),
  plan("90000000-0000-4000-8000-00000000000c", "Plan 2 - rdc", [], null),
  { ...plan("90000000-0000-4000-8000-00000000000d", "Coupe écartée", [], 1), active: false },
  reference,
];
const input = {
  intent: "initial" as const, sources, intakeDocumentByPlanFile: new Map(), omittedPlans: [], omittedReferences: [],
  preparationRevision: 3, budget: { tokens: 400_000, cost_cents: 2_500 },
};

describe("the manifest of one analysis per plan (format 2)", () => {
  it("records one unit per retained plan in the order a member reads them, ties broken by identifier", () => {
    const manifest = buildTakeoffPlanLaunchManifest(input);
    // « plan 2 » and « Plan 2 » are the same name without case or accent: the identifier decides; « 2 » comes before « 10 ».
    expect(manifest.units.map((unit) => [unit.ordinal, unit.key])).toEqual([
      [1, "plan:90000000-0000-4000-8000-00000000000b"],
      [2, "plan:90000000-0000-4000-8000-00000000000c"],
      [3, "plan:90000000-0000-4000-8000-00000000000a"],
    ]);
    expect(manifest.plans.map((entry) => entry.entry_key)).toEqual(manifest.units.map((unit) => unit.plans[0]));
    // The plan of pages 2 and 7 keeps them, 1-based; a reference is common context, never a unit.
    expect(manifest.units[0]).toMatchObject({ pages: [2, 7], page_count: 9 });
    expect(manifest.references.map((entry) => entry.document_id)).toEqual([reference.document_id]);
    expect(manifest).toMatchObject({ format_version: 2, dispatch: { order: "display_name", version: 1 },
      coverage: { plans_retained: 3 }, budget: input.budget });
  });

  it("does not depend on the order the dossier gave its plans", () => {
    const reversed = buildTakeoffPlanLaunchManifest({ ...input, sources: [...sources].reverse() });
    expect(reversed).toEqual(buildTakeoffPlanLaunchManifest(input));
  });

  it("shares the request's envelope by pages read and never leaves a unit without a positive balance", () => {
    const manifest = buildTakeoffPlanLaunchManifest(input);
    // Weights: 2 retained pages; a plan whose page count is unknown weighs as the mean of the others (3); 4 pages.
    expect(manifest.units.map((unit) => unit.budget)).toEqual([
      { tokens: 88_889, cost_cents: 556 }, { tokens: 133_334, cost_cents: 834 }, { tokens: 177_778, cost_cents: 1_112 },
    ]);
    // The dossier's sixty vector pages, in the recorded order, each plan at most its own pages.
    expect(manifest.units.map((unit) => unit.vector_pages)).toEqual([2, 3, 4]);
    expect(allotTakeoffVectorPages([40, 30, 5])).toEqual([40, 20, 0]);
    expect(takeoffPlanWeights([{ pages: [], page_count: null }, { pages: [], page_count: null }])).toEqual([1, 1]);
    const total = manifest.units.reduce((sum, unit) => sum + unit.budget.tokens, 0);
    expect(total).toBeGreaterThanOrEqual(input.budget.tokens);
    expect(total).toBeLessThan(input.budget.tokens + manifest.units.length);
    // Counter-example: a small envelope split by flooring would give a unit nothing at all.
    expect(splitTakeoffRequestBudget({ tokens: 10, cost_cents: 1 }, [1, 1, 1])).toEqual([
      { tokens: 4, cost_cents: 1 }, { tokens: 4, cost_cents: 1 }, { tokens: 4, cost_cents: 1 },
    ]);
    // A zero envelope stays zero: no call is paid (the rule of a grouped analysis).
    expect(splitTakeoffRequestBudget({ tokens: 400_000, cost_cents: 0 }, [3, 1]).map((share) => share.cost_cents)).toEqual([0, 0]);
  });

  it("refuses an empty request and one of more plans than a plan set may hold", () => {
    expect(() => buildTakeoffPlanLaunchManifest({ ...input, sources: [reference] })).toThrow();
    const many = Array.from({ length: TAKEOFF_LAUNCH_MAX_UNITS + 1 }, (_, index) =>
      plan(`90000000-0000-4000-8000-${String(index).padStart(12, "0")}`, `Plan ${index}`, [], 1));
    expect(() => buildTakeoffPlanLaunchManifest({ ...input, sources: many })).toThrow();
  });

  it("keeps the grouped format of lot 2 unchanged", () => {
    const grouped = buildTakeoffLaunchManifest(input);
    expect(grouped.format_version).toBe(1);
    expect(grouped.units).toEqual([{ key: "grouped", plans: [...grouped.plans.map((entry) => entry.entry_key)] }]);
    // Lot 2 sorts its plans by identifier.
    expect(grouped.plans.map((entry) => entry.entry_key.slice(-1))).toEqual(["a", "b", "c"]);
  });

  it("keys a unit by its plan copy, in the database's format", () => {
    expect(takeoffPlanUnitKey("90000000-0000-4000-8000-00000000000A")).toBe("plan:90000000-0000-4000-8000-00000000000a");
    expect(takeoffPlanUnitKey("90000000-0000-4000-8000-00000000000a")).toMatch(/^[a-z0-9][a-z0-9:_-]{0,119}$/);
    expect(compareTakeoffPlansForDispatch({ name: "Étage", entry_key: "b" }, { name: "etage", entry_key: "a" })).toBeGreaterThan(0);
  });
});

describe("the coverage of a request", () => {
  const units = (states: TakeoffUnitState[]) => states.map((state) => ({ state }));

  it("counts each unit in exactly one state and words the progress in plans read", () => {
    const coverage = summarizeTakeoffCoverage(units(["succeeded", "running", "queued"]));
    expect(coverage).toEqual({ expected: 3, queued: 1, running: 1, succeeded: 1, failed: 0, canceled: 0, not_started: 0 });
    expect(describeTakeoffCoverage(coverage)).toBe("1 plan lu sur 3 · 1 en lecture · 1 en attente");
    expect(describeTakeoffCoverage(summarizeTakeoffCoverage(units(["succeeded", "failed", "succeeded"]))))
      .toBe("2 plans lus sur 3 · 1 en échec");
    expect(describeTakeoffCoverage(summarizeTakeoffCoverage(units(["canceled", "not_started", "not_started"]))))
      .toBe("0 plan lu sur 3 · 2 non démarrés · 1 arrêté");
  });

  it("tells the end of a request to its requester", () => {
    expect(describeTakeoffRequestEnd({ outcome: "partial", expected: 3, read: 2, failed: 1, notStarted: 0, canceled: 0, stopped: false }))
      .toBe("2 plans lus sur 3.");
    expect(describeTakeoffRequestEnd({ outcome: "partial", expected: 3, read: 1, failed: 0, notStarted: 0, canceled: 2, stopped: true }))
      .toBe("1 plan disponible, 2 arrêtés à votre demande.");
    expect(describeTakeoffRequestEnd({ outcome: "success", expected: 3, read: 3, failed: 0, notStarted: 0, canceled: 0, stopped: false }))
      .toBe("Les 3 plans de votre analyse ont été lus.");
    expect(describeTakeoffRequestEnd({ outcome: "failure", expected: 2, read: 0, failed: 1, notStarted: 1, canceled: 0, stopped: false }))
      .toBe("Aucun des 2 plans n’a pu être lu.");
  });

  // A plan that failed, or never started, before a member stopped the rest was not stopped at their request.
  it("tells the plans a member stopped apart from those that failed or never started before the stop", () => {
    expect(describeTakeoffRequestEnd({ outcome: "partial", expected: 3, read: 1, failed: 1, notStarted: 0, canceled: 1, stopped: true }))
      .toBe("1 plan disponible, 1 arrêté à votre demande, 1 en échec.");
    expect(describeTakeoffRequestEnd({ outcome: "partial", expected: 5, read: 2, failed: 0, notStarted: 1, canceled: 2, stopped: true }))
      .toBe("2 plans disponibles, 2 arrêtés à votre demande, 1 non démarré.");
  });
});
