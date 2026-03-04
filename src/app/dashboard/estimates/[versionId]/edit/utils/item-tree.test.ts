import { describe, expect, it } from "vitest";

import type { Database } from "@/types/database";

import {
  applyOptimisticTemplateInsertion,
  createTopLevelItemIdsTracker,
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
