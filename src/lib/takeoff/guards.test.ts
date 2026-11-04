import { describe, expect, it } from "vitest";

import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  getTakeoffVerificationReadiness,
  parseLowConfidenceThreshold,
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

// The apply trigger and the verification trigger read a blank proof with PostgreSQL btrim(), which strips spaces only;
// JS trim() also strips tabs, line breaks and U+00A0, so a proof of « \t » blocked in TS and not in SQL (TI-664 L5b
// review): both sides now read the same blank proof.
describe("blank proof read as the database reads it", () => {
  it("counts a proof of spaces as missing, and a proof of other whitespace as the database does", () => {
    expect(getTakeoffVerificationReadiness({ evidence: "   ", source_page: 1 }).issues).toContain("missing_evidence");
    expect(getTakeoffVerificationReadiness({ evidence: null, source_page: 1 }).issues).toContain("missing_evidence");
    for (const evidence of ["\t", "\n", "   "]) {
      expect(getTakeoffVerificationReadiness({ evidence, source_page: 1 }).issues, JSON.stringify(evidence)).not.toContain("missing_evidence");
    }
  });
});

// The low confidence threshold of a tenant (flag TAKEOFF_LOW_CONFIDENCE_THRESHOLD) read the same way in TS and in the
// apply trigger (TI-677, review of L5b). Before: Number() read « 0x1 » as 1 where SQL fell back to 0.5, rounded
// « 0.70000000000000001 » to 0.7 where SQL kept every digit (a 0.7 line blocked in SQL only, and an admin override
// whose audit carried 0.7 never matched), and JS trimmed a tab SQL kept. Both now read one bounded decimal grammar,
// trimmed like JS trim(), then the threshold rounded up to the 1e-4 confidences are stored at (numeric(5,4)): the same
// lines block. The same cases run in pgTAP against takeoff_low_confidence_threshold (takeoff-rule-bounds.test.sql).
const LOW_CONFIDENCE_THRESHOLD_CASES: Array<[string | null, number]> = [
  [null, 0.5], ["", 0.5], ["   ", 0.5], ["0.7", 0.7], [" 0.7 ", 0.7], ["\t0.7\n", 0.7], ["\u00a00.7", 0.7],
  ["0x1", 0.5], ["0b1", 0.5], ["0.70000000000000001", 0.7001], ["0.123456789012345678901", 0.1235], ["7e-1", 0.7],
  ["7E-1", 0.7], ["1e-400", 0.0001], ["1e-1000", 0.5], [".5", 0.5], ["1.", 1], ["+0.65", 0.65], ["-0", 0],
  ["-0.00001", 0.5], ["1", 1], ["1.00001", 0.5], ["Infinity", 0.5], ["NaN", 0.5], ["0,7", 0.5], ["1_0", 0.5],
  ["0.6500", 0.65], ["0.00001", 0.0001], [`0.${"0".repeat(120)}1`, 0.5],
];

describe("low confidence threshold read as the apply trigger reads it", () => {
  it.each(LOW_CONFIDENCE_THRESHOLD_CASES)("reads %j as %d", (raw, expected) => {
    expect(parseLowConfidenceThreshold(raw)).toBe(expected);
  });

  it("blocks the lines the trigger blocks for a threshold of more than 17 digits, and none for a hexadecimal one", () => {
    const items = [makeItem("at-0.7", "Vanne", { confidence: 0.7 }), makeItem("at-0.6", "Vanne", { confidence: 0.6 })];
    expect(checkApplyGuard(items, parseLowConfidenceThreshold("0.70000000000000001")).blocked_items.map((item) => item.item_id))
      .toEqual(["at-0.7", "at-0.6"]);
    expect(checkApplyGuard(items, parseLowConfidenceThreshold("0x1")).blocked_items).toEqual([]);
  });
});
