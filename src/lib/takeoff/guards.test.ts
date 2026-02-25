import { describe, expect, it } from "vitest";

import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
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
    evidence: null,
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
  it("passes when all low-confidence items are verified", () => {
    const items = [
      makeItem("a", "Item A", { confidence: 0.2, is_verified: true }),
      makeItem("b", "Item B", { confidence: 0.9, is_verified: false }),
    ];

    const result = checkApplyGuard(items);

    expect(result.passed).toBe(true);
    expect(result.blocked_items).toHaveLength(0);
  });

  it("fails with correct blocked items when unverified low-confidence items exist", () => {
    const items = [
      makeItem("a", "Cloison BA13", { confidence: 0.23, is_verified: false }),
      makeItem("b", "Faux-plafond", { confidence: 0.41, is_verified: false }),
      makeItem("c", "Item OK", { confidence: 0.85, is_verified: false }),
    ];

    const result = checkApplyGuard(items);

    expect(result.passed).toBe(false);
    expect(result.blocked_items).toHaveLength(2);
    expect(result.blocked_items.map((i) => i.item_id)).toEqual(["a", "b"]);
    expect(result.blocked_items[0].confidence).toBe(0.23);
    expect(result.blocked_items[0].designation).toBe("Cloison BA13");
  });

  it("ignores excluded items", () => {
    const items = [
      makeItem("a", "Excluded low", {
        confidence: 0.1,
        is_verified: false,
        is_excluded: true,
      }),
      makeItem("b", "Included high", { confidence: 0.9, is_verified: false }),
    ];

    const result = checkApplyGuard(items);

    expect(result.passed).toBe(true);
    expect(result.blocked_items).toHaveLength(0);
  });

  it("correctly identifies medium confidence items (not blocked)", () => {
    const items = [
      makeItem("a", "Medium item", { confidence: 0.6, is_verified: false }),
      makeItem("b", "Low item", { confidence: 0.3, is_verified: false }),
      makeItem("c", "High item", { confidence: 0.85, is_verified: false }),
    ];

    const result = checkApplyGuard(items);

    expect(result.passed).toBe(false);
    expect(result.blocked_items).toHaveLength(1);
    expect(result.blocked_items[0].item_id).toBe("b");
    expect(result.medium_items).toHaveLength(1);
    expect(result.medium_items[0].item_id).toBe("a");
    expect(result.medium_items[0].confidence).toBe(0.6);
  });

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

  it("passes when all items are excluded", () => {
    const items = [
      makeItem("a", "Excluded", { confidence: 0.1, is_excluded: true }),
      makeItem("b", "Also excluded", { confidence: null, is_excluded: true }),
    ];

    const result = checkApplyGuard(items);

    expect(result.passed).toBe(true);
    expect(result.blocked_items).toHaveLength(0);
    expect(result.medium_items).toHaveLength(0);
  });

  it("passes with empty items array", () => {
    const result = checkApplyGuard([]);

    expect(result.passed).toBe(true);
    expect(result.blocked_items).toHaveLength(0);
    expect(result.medium_items).toHaveLength(0);
  });

  it("returns threshold in result", () => {
    const result = checkApplyGuard([], 0.65);

    expect(result.threshold).toBe(0.65);
  });

  it("does not block verified low-confidence items", () => {
    const items = [
      makeItem("a", "Low but verified", {
        confidence: 0.1,
        is_verified: true,
      }),
      makeItem("b", "Medium unverified", {
        confidence: 0.6,
        is_verified: false,
      }),
    ];

    const result = checkApplyGuard(items);

    expect(result.passed).toBe(true);
    expect(result.blocked_items).toHaveLength(0);
    // Medium unverified is in medium_items, not blocked
    expect(result.medium_items).toHaveLength(1);
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

  it("correctly handles a mix of blocked, medium, verified, excluded, and high confidence items", () => {
    const items = [
      makeItem("blocked-1", "Low unverified", { confidence: 0.2, is_verified: false }),
      makeItem("blocked-2", "Null conf unverified", { confidence: null, is_verified: false }),
      makeItem("medium-1", "Medium unverified", { confidence: 0.55, is_verified: false }),
      makeItem("medium-2", "Medium unverified 2", { confidence: 0.79, is_verified: false }),
      makeItem("ok-verified", "Low but verified", { confidence: 0.1, is_verified: true }),
      makeItem("ok-high", "High conf", { confidence: 0.95, is_verified: false }),
      makeItem("ok-excluded", "Excluded low", { confidence: 0.05, is_excluded: true }),
    ];

    const result = checkApplyGuard(items);

    expect(result.passed).toBe(false);
    expect(result.blocked_items).toHaveLength(2);
    expect(result.blocked_items.map((i) => i.item_id).sort()).toEqual([
      "blocked-1",
      "blocked-2",
    ]);
    expect(result.medium_items).toHaveLength(2);
    expect(result.medium_items.map((i) => i.item_id).sort()).toEqual([
      "medium-1",
      "medium-2",
    ]);
  });
});
