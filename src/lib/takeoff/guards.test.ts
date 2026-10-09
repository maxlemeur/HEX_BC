import { describe, expect, it } from "vitest";

import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  getTakeoffVerificationReadiness,
  MEDIUM_CONFIDENCE_CEILING,
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

  it("items at exactly medium ceiling are not in medium list", () => {
    const items = [
      makeItem("a", "At ceiling", {
        confidence: MEDIUM_CONFIDENCE_CEILING,
        is_verified: false,
      }),
    ];

    const result = checkApplyGuard(items);

    expect(result.passed).toBe(true);
    expect(result.blocked_items).toHaveLength(0);
    expect(result.medium_items).toHaveLength(0);
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

describe("getTakeoffVerificationReadiness", () => {
  it("explains both missing proof fields", () => {
    const result = getTakeoffVerificationReadiness({
      evidence: null,
      source_page: null,
    });

    expect(result.canVerify).toBe(false);
    expect(result.issues).toEqual(["missing_evidence", "missing_source_page"]);
    expect(result.message).toContain("Ajoutez une preuve");
  });
});
