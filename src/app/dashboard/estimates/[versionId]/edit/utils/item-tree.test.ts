import { describe, expect, it } from "vitest";

import type { Database } from "@/types/database";

import {
  applyOptimisticTemplateInsertion,
  buildSiblingOrderByParent,
  collectSubtreeItemIds,
  createTopLevelItemIdsTracker,
  sortItemsForTreeRecreation,
} from "./item-tree";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

function item(input: {
  id: string;
  parent_id?: string | null;
  position: number;
  item_type: "section" | "line";
}) {
  return {
    id: input.id,
    parent_id: input.parent_id ?? null,
    position: input.position,
    item_type: input.item_type,
  } as EstimateItem;
}

describe("item-tree subtree traversal", () => {
  it("collects a complete multi-level subtree without including unrelated branches", () => {
    const snapshot = [
      item({ id: "root", item_type: "section", position: 1 }),
      item({ id: "chapter", parent_id: "root", item_type: "section", position: 1 }),
      item({ id: "root-line", parent_id: "root", item_type: "line", position: 2 }),
      item({
        id: "subchapter",
        parent_id: "chapter",
        item_type: "section",
        position: 1,
      }),
      item({
        id: "nested-line",
        parent_id: "subchapter",
        item_type: "line",
        position: 1,
      }),
      item({ id: "other-root", item_type: "section", position: 2 }),
      item({
        id: "other-line",
        parent_id: "other-root",
        item_type: "line",
        position: 1,
      }),
    ];

    expect([...collectSubtreeItemIds(snapshot, "root")].sort()).toEqual([
      "chapter",
      "nested-line",
      "root",
      "root-line",
      "subchapter",
    ]);
  });

  it("terminates safely when corrupted input contains a parent cycle", () => {
    const snapshot = [
      item({ id: "cycle-a", parent_id: "cycle-c", item_type: "section", position: 1 }),
      item({ id: "cycle-b", parent_id: "cycle-a", item_type: "section", position: 1 }),
      item({ id: "cycle-c", parent_id: "cycle-b", item_type: "section", position: 1 }),
      item({ id: "outside", item_type: "line", position: 1 }),
    ];

    expect([...collectSubtreeItemIds(snapshot, "cycle-a")].sort()).toEqual([
      "cycle-a",
      "cycle-b",
      "cycle-c",
    ]);
  });
});

describe("item-tree sibling ordering", () => {
  it("builds an independent position order for every parent without mutating input", () => {
    const snapshot = [
      item({ id: "root-2", item_type: "section", position: 2 }),
      item({ id: "a-3", parent_id: "parent-a", item_type: "line", position: 3 }),
      item({ id: "b-1", parent_id: "parent-b", item_type: "line", position: 1 }),
      item({ id: "root-1", item_type: "section", position: 1 }),
      item({ id: "a-1", parent_id: "parent-a", item_type: "line", position: 1 }),
      item({ id: "b-2", parent_id: "parent-b", item_type: "line", position: 2 }),
      item({ id: "a-2", parent_id: "parent-a", item_type: "line", position: 2 }),
    ];
    const originalOrder = snapshot.map((entry) => entry.id);

    const orderByParent = buildSiblingOrderByParent(snapshot);

    expect(orderByParent.get(null)).toEqual(["root-1", "root-2"]);
    expect(orderByParent.get("parent-a")).toEqual(["a-1", "a-2", "a-3"]);
    expect(orderByParent.get("parent-b")).toEqual(["b-1", "b-2"]);
    expect(snapshot.map((entry) => entry.id)).toEqual(originalOrder);
  });
});

describe("item-tree recreation ordering", () => {
  it("sorts shuffled items parent-first across multiple levels and parents", () => {
    const snapshot = [
      item({ id: "grandchild-b", parent_id: "child-b", item_type: "line", position: 1 }),
      item({ id: "child-b", parent_id: "root-b", item_type: "section", position: 2 }),
      item({ id: "root-b", item_type: "section", position: 2 }),
      item({ id: "child-a-2", parent_id: "root-a", item_type: "line", position: 2 }),
      item({ id: "root-a", item_type: "section", position: 1 }),
      item({ id: "child-a-1", parent_id: "root-a", item_type: "line", position: 1 }),
      item({ id: "grandchild-a", parent_id: "child-b", item_type: "line", position: 2 }),
    ];

    expect(sortItemsForTreeRecreation(snapshot).map((entry) => entry.id)).toEqual([
      "root-a",
      "root-b",
      "child-a-1",
      "child-a-2",
      "child-b",
      "grandchild-b",
      "grandchild-a",
    ]);
  });

  it("treats an orphan as a recreation root while preserving its parent id", () => {
    const orphan = item({
      id: "orphan",
      parent_id: "missing-parent",
      item_type: "line",
      position: 9,
    });
    const snapshot = [
      item({ id: "child", parent_id: "root", item_type: "line", position: 1 }),
      orphan,
      item({ id: "root", item_type: "section", position: 1 }),
    ];

    const sorted = sortItemsForTreeRecreation(snapshot);

    expect(sorted.map((entry) => entry.id)).toEqual(["root", "orphan", "child"]);
    expect(sorted[1]?.parent_id).toBe("missing-parent");
  });
});

describe("item-tree template insertion regressions", () => {
  it("shifts siblings by the number of inserted root items", () => {
    const snapshot = [
      item({ id: "a", item_type: "section", position: 1 }),
      item({ id: "b", item_type: "section", position: 2 }),
      item({ id: "c", item_type: "section", position: 3 }),
      item({ id: "other-parent", parent_id: "p1", item_type: "section", position: 2 }),
    ];
    const inserted = [
      item({ id: "r1", item_type: "section", position: 2 }),
      item({ id: "r1-line", parent_id: "r1", item_type: "line", position: 1 }),
      item({ id: "r2", item_type: "section", position: 3 }),
    ];

    const next = applyOptimisticTemplateInsertion(snapshot, inserted);
    const byId = new Map(next.map((entry) => [entry.id, entry]));

    expect(byId.get("a")?.position).toBe(1);
    expect(byId.get("b")?.position).toBe(4);
    expect(byId.get("c")?.position).toBe(5);
    expect(byId.get("other-parent")?.position).toBe(2);
  });

  it("only shifts siblings under the insertion parent", () => {
    const snapshot = [
      item({ id: "p-child-1", parent_id: "p", item_type: "line", position: 1 }),
      item({ id: "p-child-2", parent_id: "p", item_type: "line", position: 2 }),
      item({ id: "root-1", item_type: "section", position: 1 }),
      item({ id: "root-2", item_type: "section", position: 2 }),
    ];
    const inserted = [
      item({ id: "new-1", parent_id: "p", item_type: "section", position: 2 }),
      item({ id: "new-2", parent_id: "p", item_type: "section", position: 3 }),
    ];

    const next = applyOptimisticTemplateInsertion(snapshot, inserted);
    const byId = new Map(next.map((entry) => [entry.id, entry]));

    expect(byId.get("p-child-1")?.position).toBe(1);
    expect(byId.get("p-child-2")?.position).toBe(4);
    expect(byId.get("root-1")?.position).toBe(1);
    expect(byId.get("root-2")?.position).toBe(2);
  });

  it("refreshes tracked root ids after redo recreation", () => {
    const firstInsert = [
      item({ id: "old-root", item_type: "section", position: 2 }),
      item({ id: "old-line", parent_id: "old-root", item_type: "line", position: 1 }),
    ];
    const tracker = createTopLevelItemIdsTracker(firstInsert);

    expect(tracker.getCurrent()).toEqual(["old-root"]);

    const recreated = [
      item({ id: "new-root-a", item_type: "section", position: 2 }),
      item({ id: "new-line-a", parent_id: "new-root-a", item_type: "line", position: 1 }),
      item({ id: "new-root-b", item_type: "section", position: 3 }),
    ];
    tracker.replace(recreated);

    expect(tracker.getCurrent()).toEqual(["new-root-a", "new-root-b"]);
    expect(tracker.getCurrent()).not.toContain("old-root");
  });
});
