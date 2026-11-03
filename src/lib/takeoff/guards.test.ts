import { describe, expect, it } from "vitest";

import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
} from "@/lib/takeoff/guards";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

function makeItem(
  id: string,
  designation: string,
  overrides: Partial<TakeoffJobItem> = {}
): TakeoffJobItem {
  return {
    id,
    designation,
    quantity: 1,
    unit: "u",
    confidence: 0.9,
    evidence: "Repère A3 sur le plan",
    source_file_name: "plan-a.pdf",
    source_page: 1,
    metadata: {},
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-02-25T10:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
    ...overrides,
  };
}

describe("checkApplyGuard", () => {

  it("threshold is configurable", () => {
    const items = [
      makeItem("a", "Item A", { confidence: 0.6, is_verified: false }),
    ];

    // With default threshold (0.5) → medium, not blocked
    const defaultResult = checkApplyGuard(items, DEFAULT_LOW_CONFIDENCE_THRESHOLD);
    expect(defaultResult.passed).toBe(true);
    expect(defaultResult.medium_items).toHaveLength(1);

    // With higher threshold (0.7) → blocked
    const strictResult = checkApplyGuard(items, 0.7);
    expect(strictResult.passed).toBe(false);
    expect(strictResult.blocked_items).toHaveLength(1);
    expect(strictResult.blocked_items[0].item_id).toBe("a");
  });

  it("treats null confidence as low-confidence (blocked)", () => {
    const items = [
      makeItem("a", "Null confidence", { confidence: null, is_verified: false }),
    ];

    const result = checkApplyGuard(items);

    expect(result.passed).toBe(false);
    expect(result.blocked_items).toHaveLength(1);
    expect(result.blocked_items[0].confidence).toBeNull();
  });

  it("items at exactly threshold boundary are medium, not blocked", () => {
    const items = [
      makeItem("a", "At threshold", {
        confidence: DEFAULT_LOW_CONFIDENCE_THRESHOLD,
        is_verified: false,
      }),
    ];

    const result = checkApplyGuard(items);

    // confidence === threshold → not blocked (< threshold required)
    expect(result.passed).toBe(true);
    expect(result.blocked_items).toHaveLength(0);
    expect(result.medium_items).toHaveLength(1);
  });

  it("blocks an included item when its textual proof is missing", () => {
    const result = checkApplyGuard([
      makeItem("missing-evidence", "Item sans preuve", {
        confidence: 0.95,
        evidence: "   ",
        is_verified: true,
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.blocked_items[0]).toEqual(
      expect.objectContaining({
        item_id: "missing-evidence",
        reasons: ["missing_evidence"],
      })
    );
  });

  it("blocks an included item when its source page is missing", () => {
    const result = checkApplyGuard([
      makeItem("missing-page", "Item sans page", {
        confidence: 0.95,
        source_page: null,
      }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.blocked_items[0].reasons).toEqual(["missing_source_page"]);
  });
});

// TI-664: the fixed rules block a line exactly as the database trigger counts it (takeoff_item_rule_blocked,
// supabase/tests/database/takeoff-quantity-rules.test.sql runs the same cases in SQL). Ways it could differ, written
// before the code: a rule failure ignored on a level B job, or the existing reasons applied there; a verified line
// still blocked by an acceptable failure, or a quantity to enter released by a verification; stale results ignored;
// a passed rule blocking; an excluded line blocking; a job without level read otherwise than as level C.
describe("checkApplyGuard with rule results", () => {
  const duplicate = { rule: "zone_overlap" as const, status: "fail" as const, code: "ZONE_OVERLAP_DUPLICATE" as const, version: 101,
    acceptable: true, reason: "Tronçon compté aussi en Z2." };
  const toEnter = { rule: "non_observable" as const, status: "fail" as const, code: "NON_OBSERVABLE_TO_ENTER" as const, version: 1,
    acceptable: false, reason: "Quantité à saisir." };
  const entered = { ...toEnter, status: "pass" as const, code: "NON_OBSERVABLE_ENTERED" as const };

  it("blocks a failed rule on a level B job, without the level C reasons", () => {
    const result = checkApplyGuard([
      makeItem("rule", "EF inox DN 22", { rule_results: [duplicate] }),
      makeItem("low", "Vanne", { confidence: 0.2, evidence: null, source_page: null }),
    ], DEFAULT_LOW_CONFIDENCE_THRESHOLD, { level: "B" });
    expect(result.blocked_items.map((item) => [item.item_id, item.reasons])).toEqual([["rule", ["rule_failed"]]]);
    expect(result.blocked_items[0].rule_failures).toEqual([{ rule: "zone_overlap", code: "ZONE_OVERLAP_DUPLICATE",
      reason: "Tronçon compté aussi en Z2.", acceptable: true }]);
    expect(result.medium_items).toEqual([]);
  });

  it("lets a verification settle an acceptable failure only, and blocks stale results", () => {
    const result = checkApplyGuard([
      makeItem("verified", "EF inox DN 22", { is_verified: true, rule_results: [duplicate] }),
      makeItem("enter", "Soudures", { is_verified: true, rule_results: [toEnter] }),
      makeItem("entered", "Soudures", { rule_results: [entered] }),
      makeItem("stale", "EF inox DN 22", { rule_results: [], rules_stale: true }),
      makeItem("excluded", "EF inox DN 22", { is_excluded: true, rule_results: [duplicate], rules_stale: true }),
    ], DEFAULT_LOW_CONFIDENCE_THRESHOLD, { level: "B" });
    expect(result.blocked_items.map((item) => [item.item_id, item.reasons])).toEqual([["enter", ["rule_failed"]], ["stale", ["rules_stale"]]]);
  });

  it("adds the rule reasons to the level C reasons, a job without level being read as level C", () => {
    const items = [makeItem("both", "EF inox DN 22", { confidence: 0.2, rule_results: [duplicate] })];
    expect(checkApplyGuard(items).blocked_items[0].reasons).toEqual(["low_confidence", "rule_failed"]);
    expect(checkApplyGuard(items, DEFAULT_LOW_CONFIDENCE_THRESHOLD, { level: "C" }).blocked_items[0].reasons)
      .toEqual(["low_confidence", "rule_failed"]);
  });
});
