import { describe, expect, it } from "vitest";

import type { ApplyGuardItem } from "@/lib/takeoff/guards";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import { acceptanceOf, targetedReviewLines, zoneOverlapGuidance } from "@/lib/takeoff/targeted-review";

// TI-664 L5c, what the targeted review offers on a line. Ways it fails, written before the code:
// - F1: it lists a line the apply guard neither blocks nor finds uncertain, or misses one it does (an excluded line, a
//   verified line whose failure V settles, a level B line's confidence, a stale line, a non-observable line verified);
// - F5: it offers V on a line V cannot settle (a quantity to enter, results to compute again), or on a level C line
//   without its localized proof, which the server refuses;
// - F10: in a group of three lines or more it offers a reduction, which never settles a group, or offers to remove a
//   line that other lines do not draw entirely (its own length would leave the takeoff);
// - F11: the pair's reduction is wrong: subtracted twice, negative, or off the stored thousandth.

type Line = ApplyGuardItem & { quantity: number; metadata: Record<string, unknown> };

let next = 0;
function line(overrides: Partial<Line> = {}): Line {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    designation: `Ligne ${next}`, confidence: 0.9, evidence: "Plan R+1", source_page: 1, is_verified: false, is_excluded: false,
    quantity: 5, metadata: {}, rule_results: [], rules_stale: false, ...overrides,
  };
}

function rule(overrides: Partial<TakeoffRuleResult>): TakeoffRuleResult {
  return { rule: "dn_network", status: "fail", code: "DN_NETWORK_NETWORK_MISSING", version: 1, acceptable: true,
    reason: "Réseau non lu.", ...overrides } as TakeoffRuleResult;
}

const duplicate = (details: TakeoffRuleResult["details"]) => rule({ rule: "zone_overlap", code: "ZONE_OVERLAP_DUPLICATE", version: 101,
  reason: "Tronçon compté aussi sur une autre page.", details });
const partner = (overrides: Record<string, unknown> = {}) => ({ item_id: "11111111-1111-4111-8111-111111111111",
  job_id: "22222222-2222-4222-8222-222222222222", zone: "Z2", designation: "EF Inox 316L DN 22", overlap_m: 1, resolved: false, ...overrides });

describe("targetedReviewLines", () => {
  it("lists exactly the guard's rejected then uncertain lines", () => {
    const rejected = line({ rule_results: [rule({})] });
    const uncertain = line({ confidence: 0.6 });
    const excluded = line({ rule_results: [rule({})], is_excluded: true, exclusion_reason: "Doublon" });
    const settledByV = line({ rule_results: [rule({})], is_verified: true });
    const toEnter = line({ rule_results: [rule({ rule: "non_observable", code: "NON_OBSERVABLE_TO_ENTER", acceptable: false })], is_verified: true });
    const stale = line({ rules_stale: true });
    const clean = line();
    const lowNoProof = line({ confidence: 0.3, evidence: null });
    const items = [uncertain, rejected, excluded, settledByV, toEnter, stale, clean, lowNoProof];

    const review = targetedReviewLines(items, 0.5, "C");
    expect(review.lines.map((entry) => [entry.item.id, entry.tier])).toEqual([
      [rejected.id, "rejected"], [toEnter.id, "rejected"], [stale.id, "rejected"], [lowNoProof.id, "rejected"],
      [uncertain.id, "uncertain"],
    ]);
    expect(review.lines.find((entry) => entry.item.id === toEnter.id)?.reasons).toEqual(["rule_failed"]);
    expect(review.lines.find((entry) => entry.item.id === lowNoProof.id)?.reasons).toEqual(["low_confidence", "missing_evidence"]);
    expect(review.guard.passed).toBe(false);
  });

  it("reads a level B job as the guard does: its rules only", () => {
    const failed = line({ rule_results: [rule({})] });
    const low = line({ confidence: 0.2, evidence: null });
    const review = targetedReviewLines([failed, low], 0.5, "B");
    expect(review.lines.map((entry) => [entry.item.id, entry.tier])).toEqual([[failed.id, "rejected"]]);
  });
});

describe("acceptanceOf", () => {
  it("lets V settle an acceptable failure or an uncertain line", () => {
    expect(acceptanceOf(line({ rule_results: [rule({})] }), "C")).toEqual({ enabled: true, reason: null });
    expect(acceptanceOf(line({ confidence: 0.6 }), "C")).toEqual({ enabled: true, reason: null });
  });

  it("never offers V for a quantity to enter, nor for results to compute again", () => {
    const toEnter = acceptanceOf(line({ rule_results: [rule({ rule: "non_observable", code: "NON_OBSERVABLE_TO_ENTER", acceptable: false })] }), "B");
    expect(toEnter.enabled).toBe(false);
    expect(toEnter.reason).toMatch(/saisi/);
    const stale = acceptanceOf(line({ rules_stale: true }), "B");
    expect(stale.enabled).toBe(false);
    expect(stale.reason).toMatch(/recalcul/);
  });

  it("keeps V for the acceptable failures of a line that also has a quantity to enter", () => {
    const both = line({ rule_results: [rule({}), rule({ rule: "non_observable", code: "NON_OBSERVABLE_TO_ENTER", acceptable: false })] });
    expect(acceptanceOf(both, "B").enabled).toBe(true);
  });

  it("refuses V on a level C line without its localized proof, as the server does", () => {
    const noProof = acceptanceOf(line({ rule_results: [rule({})], evidence: "  " }), "C");
    expect(noProof).toEqual({ enabled: false, reason: "Ajoutez une preuve avant de valider cet item." });
    expect(acceptanceOf(line({ rule_results: [rule({})], evidence: null }), "B").enabled).toBe(true);
  });

  it("does not accept a line already verified again", () => {
    expect(acceptanceOf(line({ is_verified: true, rule_results: [rule({ rule: "non_observable", code: "NON_OBSERVABLE_TO_ENTER", acceptable: false })] }), "C").enabled)
      .toBe(false);
  });
});

describe("zoneOverlapGuidance", () => {
  it("removes the length a pair still counts twice from this line", () => {
    const guidance = zoneOverlapGuidance(line({ quantity: 5, rule_results: [duplicate({ overlap_m: 1, partners: [partner()] })] }));
    expect(guidance).toMatchObject({ kind: "pair", overlap_m: 1, reduce_to: 4, remove_line: false, partners: [partner()] });
  });

  it("rounds the reduction to the stored thousandth and never below it", () => {
    expect(zoneOverlapGuidance(line({ quantity: 5.0004, rule_results: [duplicate({ overlap_m: 1.0001, partners: [partner()] })] })))
      .toMatchObject({ reduce_to: 4 });
    expect(zoneOverlapGuidance(line({ quantity: 1, rule_results: [duplicate({ overlap_m: 1, partners: [partner()] })] })))
      .toMatchObject({ kind: "pair", reduce_to: null, remove_line: true });
    expect(zoneOverlapGuidance(line({ quantity: 0.8, rule_results: [duplicate({ overlap_m: 1, partners: [partner()] })] })))
      .toMatchObject({ reduce_to: null, remove_line: true });
  });

  it("never offers a reduction in a group: it removes a line entirely drawn by the others, or leaves V", () => {
    const measured = { rule_inputs: { version: 1, source: "vector", kind: "network", network: "EF", material: "inox", dn: "DN 22",
      non_observable: null, model_quantity: 3 } };
    const entire = zoneOverlapGuidance(line({ quantity: 3, metadata: measured,
      rule_results: [duplicate({ overlap_m: 2.995, group_size: 3, partners: [partner(), partner({ zone: "Z3", overlap_m: 2 })] })] }));
    expect(entire).toMatchObject({ kind: "group", group_size: 3, reduce_to: null, remove_line: true });
    // Reduced by hand to the shared length: the group still decides on the measured line, never on its quantity.
    const partial = zoneOverlapGuidance(line({ quantity: 1, metadata: measured,
      rule_results: [duplicate({ overlap_m: 1, group_size: 4, partners: [partner()] })] }));
    expect(partial).toMatchObject({ kind: "group", group_size: 4, reduce_to: null, remove_line: false, own_m: 2 });
  });

  it("reads a pair settled, registered nowhere, or no duplicate at all", () => {
    expect(zoneOverlapGuidance(line({ rule_results: [rule({ rule: "zone_overlap", status: "pass", code: "ZONE_OVERLAP_RESOLVED",
      details: { partners: [partner({ resolved: true })] } })] }))).toMatchObject({ kind: "resolved", partners: [partner({ resolved: true })] });
    expect(zoneOverlapGuidance(line({ rule_results: [rule({ rule: "zone_overlap", code: "ZONE_OVERLAP_UNREGISTERED", details: { level: "R+1" } })] })))
      .toMatchObject({ kind: "unregistered", reduce_to: null, remove_line: false });
    expect(zoneOverlapGuidance(line({ rule_results: [rule({})] }))).toBeNull();
  });
});
