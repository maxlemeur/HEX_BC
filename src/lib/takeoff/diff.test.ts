import { describe, expect, it } from "vitest";

import { buildTakeoffDiff } from "@/lib/takeoff/diff";
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

describe("buildTakeoffDiff", () => {
  it("classifies added/removed/changed/unchanged and returns deltas", () => {
    const baseItems = [
      makeItem("b-1", "Tube PVC 100", {
        quantity: 12,
        unit: "ml",
        source_page: 3,
      }),
      makeItem("b-2", "Cable U1000", {
        quantity: 8,
        unit: "ml",
        source_page: 4,
      }),
      makeItem("b-3", "Gaine ICTA", {
        quantity: 4,
        unit: "ml",
        source_page: 5,
      }),
    ];

    const otherItems = [
      makeItem("o-1", "tube pvc 100", {
        quantity: 12,
        unit: "ml",
        source_page: 3,
      }),
      makeItem("o-2", "Cable U1000", {
        quantity: 9,
        unit: "ml",
        source_page: 4,
      }),
      makeItem("o-4", "Vis autoforeuse", {
        quantity: 100,
        unit: "u",
        source_page: 9,
      }),
    ];

    const diff = buildTakeoffDiff({
      baseItems,
      otherItems,
      threshold: 0.8,
    });

    expect(diff.summary).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      unchanged: 1,
      total_base: 3,
      total_other: 3,
    });

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.delta.map((entry) => entry.field)).toContain("quantity");
    expect(diff.added[0]?.other_item.id).toBe("o-4");
    expect(diff.removed[0]?.base_item.id).toBe("b-3");
    expect(diff.unchanged[0]?.base_item.id).toBe("b-1");
  });

  it("respects threshold configuration", () => {
    const baseItems = [makeItem("b-1", "Fenetre PVC")];
    const otherItems = [makeItem("o-1", "Fenetre PVD")];

    const strict = buildTakeoffDiff({
      baseItems,
      otherItems,
      threshold: 0.95,
    });

    const loose = buildTakeoffDiff({
      baseItems,
      otherItems,
      threshold: 0.7,
    });

    expect(strict.summary.unchanged + strict.summary.changed).toBe(0);
    expect(strict.summary.added).toBe(1);
    expect(strict.summary.removed).toBe(1);

    expect(loose.summary.unchanged + loose.summary.changed).toBe(1);
  });

  it("can match with secondary designation+source_page strategy", () => {
    const baseItems = [
      makeItem("b-1", "aaa", {
        source_page: 12,
      }),
    ];
    const otherItems = [
      makeItem("o-1", "bbb", {
        source_page: 12,
      }),
    ];

    const diff = buildTakeoffDiff({
      baseItems,
      otherItems,
      threshold: 0.5,
    });

    expect(diff.summary.changed + diff.summary.unchanged).toBe(1);
    const matched = diff.changed[0] ?? diff.unchanged[0];
    expect(matched?.match_strategy).toBe("designation_plus_page_fuzzy");
  });

  it("keeps one-to-one matching in collision scenarios", () => {
    const baseItems = [
      makeItem("b-1", "prise murale simple", { source_page: 1 }),
      makeItem("b-2", "prise murale double", { source_page: 2 }),
    ];

    const otherItems = [
      makeItem("o-1", "prise mural simple", { source_page: 1 }),
      makeItem("o-2", "prise mural double", { source_page: 2 }),
    ];

    const diff = buildTakeoffDiff({
      baseItems,
      otherItems,
      threshold: 0.75,
    });

    expect(diff.summary.changed + diff.summary.unchanged).toBe(2);

    const matchedIds = [
      ...diff.changed.map((entry) => entry.other_item.id),
      ...diff.unchanged.map((entry) => entry.other_item.id),
    ];

    expect(new Set(matchedIds).size).toBe(2);
  });

  it("handles larger datasets without exploding", () => {
    const baseItems: TakeoffJobItem[] = [];
    const otherItems: TakeoffJobItem[] = [];

    for (let index = 0; index < 350; index += 1) {
      baseItems.push(
        makeItem(`b-${index}`, `ligne cable ${index}`, {
          quantity: index + 1,
          source_page: (index % 30) + 1,
        })
      );

      otherItems.push(
        makeItem(`o-${index}`, `ligne câble ${index}`, {
          quantity: index + 1,
          source_page: (index % 30) + 1,
        })
      );
    }

    const startedAt = Date.now();
    const diff = buildTakeoffDiff({
      baseItems,
      otherItems,
      threshold: 0.8,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(diff.summary.total_base).toBe(350);
    expect(diff.summary.total_other).toBe(350);
    expect(diff.summary.added).toBe(0);
    expect(diff.summary.removed).toBe(0);
    expect(diff.summary.changed + diff.summary.unchanged).toBe(350);
    expect(elapsedMs).toBeLessThan(5000);
  });
});
