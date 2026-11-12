import { describe, expect, it } from "vitest";

import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import type { PageAnchors } from "@/lib/takeoff/rules/registration";
import type { TakeoffRuleInputs, TakeoffRuleResult } from "@/lib/takeoff/rules/types";

// TI-682 (lot D, PR 3), characterisation written before any change: a takeoff run again on a page another takeoff of
// the version already measured. Every plan, label and quantity is fictional.

/** A fictional floor drawing: building lines and room texts, seen through a sheet shifted by (sx, sy). */
function sheet(sx: number, sy = 0): PageAnchors {
  const texts: Array<[string, number, number]> = ["Bureau 101", "Salle de réunion", "Local technique", "Circulation C2",
    "Sanitaires H", "Sanitaires F", "Archives"].map((text, index) => [text, 12 + index * 1.3 + sx, 4 + index * 0.9 + sy]);
  const lines = Array.from({ length: 30 }, (_, index): [number, number, number, number] =>
    [10 + sx, 2 + index * 0.7 + sy, 13 + (index % 5) + sx, 2 + index * 0.7 + sy]);
  return { version: 1, texts, lines };
}

function inputs(overrides: Partial<TakeoffRuleInputs> = {}): TakeoffRuleInputs {
  return { version: 1, source: "vector", kind: "network", network: "EF", material: "inox-316l", dn: "DN 22", non_observable: null,
    model_quantity: 5, ...overrides };
}

function page(key: string, overrides: Partial<RulePage> = {}): RulePage {
  return { key, job_id: key.split("#")[0], order: 0, level: "R+1", zone: "Z1", scale: { status: "format", reason: null },
    denominator: 50, anchors: sheet(0), ...overrides };
}

function run(id: string, pageKey: string, overrides: Partial<RuleLine> = {}): RuleLine {
  return { id, job_id: pageKey.split("#")[0], page_key: pageKey, designation: "EF Inox 316L DN 22", unit: "ml", quantity: 5,
    is_excluded: false, frozen: false, inputs: inputs(),
    geometry: { segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null }, ...overrides };
}

function zone(results: Map<string, TakeoffRuleResult[]>, id: string) {
  return results.get(id)?.find((entry) => entry.rule === "zone_overlap");
}

describe("a page measured again by a second takeoff (behaviour on origin/main, before the change)", () => {
  it("fails the second reading of the same drawing as a duplicate between zones, with the applied first reading as partner", () => {
    // M1 applied (frozen), M2 completed: each takeoff has its own vector page row for the same plan page.
    const pages = [page("m1#1", { order: 1 }), page("m2#1", { order: 10_001 })];
    const lines = [run("m1-ef", "m1#1", { frozen: true }), run("m2-ef", "m2#1")];
    const { results, transforms } = evaluateTakeoffRules({ pages, lines });
    expect(transforms.get("m2#1")?.slice(4)).toEqual([0, 0]);
    expect(zone(results, "m2-ef")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE",
      details: { overlap_m: 5, partners: [{ item_id: "m1-ef", job_id: "m1", resolved: false }] } });
    expect(zone(results, "m2-ef")?.reason).toContain("job appliqué");
  });

  it("fails a second reading that reads the run's DN otherwise as a copy read differently", () => {
    const pages = [page("m1#1", { order: 1 }), page("m2#1", { order: 10_001 })];
    const lines = [run("m1-ef", "m1#1", { frozen: true }),
      run("m2-ef", "m2#1", { designation: "EF Inox 316L DN 28", inputs: inputs({ dn: "DN 28" }) })];
    const { results } = evaluateTakeoffRules({ pages, lines });
    expect(zone(results, "m2-ef")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE",
      details: { partners: [{ item_id: "m1-ef", differs: ["dn"] }] } });
  });

  it("fails « zones non recalées » when the two readings of the page carry no anchors", () => {
    const pages = [page("m1#1", { order: 1, anchors: null }), page("m2#1", { order: 10_001, anchors: null })];
    const lines = [run("m1-ef", "m1#1", { frozen: true }), run("m2-ef", "m2#1")];
    const { results } = evaluateTakeoffRules({ pages, lines });
    expect(zone(results, "m2-ef")).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_UNREGISTERED" });
  });
});
