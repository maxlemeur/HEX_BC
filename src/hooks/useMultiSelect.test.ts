import { describe, expect, it } from "vitest";

import {
  clearSelection,
  createMultiSelectState,
  getOrderedSelectedIds,
  pruneSelection,
  reduceMultiSelectState,
  selectAll,
  selectRange,
  toggleItemSelection,
} from "@/hooks/useMultiSelect";

describe("useMultiSelect helpers", () => {
  it("toggleItemSelection supports Set, array and map inputs", () => {
    expect(Array.from(toggleItemSelection(new Set(["row-1"]), "row-2"))).toEqual([
      "row-1",
      "row-2",
    ]);
    expect(Array.from(toggleItemSelection(["row-1", "row-2"], "row-2"))).toEqual([
      "row-1",
    ]);
    expect(
      Array.from(
        toggleItemSelection(
          new Map([
            ["row-1", true],
            ["row-2", false],
          ]),
          "row-3"
        )
      )
    ).toEqual(["row-1", "row-3"]);
  });

  it("selectRange returns an inclusive range in both directions", () => {
    const visibleIds = ["row-1", "row-2", "row-3", "row-4"];

    expect(Array.from(selectRange(visibleIds, "row-2", "row-4"))).toEqual([
      "row-2",
      "row-3",
      "row-4",
    ]);
    expect(Array.from(selectRange(visibleIds, "row-4", "row-2"))).toEqual([
      "row-2",
      "row-3",
      "row-4",
    ]);
  });

  it("selectRange returns an empty selection when one bound is missing", () => {
    expect(Array.from(selectRange(["row-1", "row-2"], "row-1", "missing"))).toEqual(
      []
    );
  });

  it("selectAll deduplicates while preserving first occurrence order", () => {
    expect(Array.from(selectAll(["row-2", "row-1", "row-2"]))).toEqual([
      "row-2",
      "row-1",
    ]);
  });

  it("clearSelection always returns an empty Set", () => {
    expect(Array.from(clearSelection())).toEqual([]);
  });

  it("pruneSelection keeps only visible ids in visible order", () => {
    expect(
      Array.from(
        pruneSelection(
          {
            "row-1": false,
            "row-2": true,
            "row-3": true,
            "row-5": true,
          },
          ["row-3", "row-4", "row-2", "row-1"]
        )
      )
    ).toEqual(["row-3", "row-2"]);
  });
});

describe("useMultiSelect reducer behavior", () => {
  it("handles simple selection and updates anchor", () => {
    const visibleIds = ["row-1", "row-2", "row-3"];
    const state = reduceMultiSelectState(createMultiSelectState(), {
      type: "selectItem",
      id: "row-2",
      visibleIds,
    });

    expect(Array.from(state.selected)).toEqual(["row-2"]);
    expect(state.anchorId).toBe("row-2");
  });

  it("handles ctrl/meta toggles and keeps anchor on the last interacted item", () => {
    const visibleIds = ["row-1", "row-2", "row-3"];

    const afterFirst = reduceMultiSelectState(createMultiSelectState(), {
      type: "selectItem",
      id: "row-1",
      visibleIds,
    });
    const afterCtrl = reduceMultiSelectState(afterFirst, {
      type: "selectItem",
      id: "row-3",
      visibleIds,
      ctrlKey: true,
    });
    const afterMeta = reduceMultiSelectState(afterCtrl, {
      type: "selectItem",
      id: "row-1",
      visibleIds,
      metaKey: true,
    });

    expect(Array.from(afterCtrl.selected)).toEqual(["row-1", "row-3"]);
    expect(afterCtrl.anchorId).toBe("row-3");
    expect(Array.from(afterMeta.selected)).toEqual(["row-3"]);
    expect(afterMeta.anchorId).toBe("row-1");
  });

  it("handles shift range selection from anchor", () => {
    const visibleIds = ["row-1", "row-2", "row-3", "row-4"];

    const anchored = reduceMultiSelectState(createMultiSelectState(), {
      type: "selectItem",
      id: "row-2",
      visibleIds,
    });
    const ranged = reduceMultiSelectState(anchored, {
      type: "selectItem",
      id: "row-4",
      visibleIds,
      shiftKey: true,
    });

    expect(Array.from(ranged.selected)).toEqual(["row-2", "row-3", "row-4"]);
    expect(ranged.anchorId).toBe("row-2");
  });

  it("falls back to simple selection when shift is used without a valid anchor", () => {
    const visibleIds = ["row-1", "row-2", "row-3"];
    const stateWithoutAnchor = createMultiSelectState({
      selected: ["row-1"],
      anchorId: null,
    });

    const state = reduceMultiSelectState(stateWithoutAnchor, {
      type: "selectItem",
      id: "row-3",
      visibleIds,
      shiftKey: true,
    });

    expect(Array.from(state.selected)).toEqual(["row-3"]);
    expect(state.anchorId).toBe("row-3");
  });

  it("supports selectAll and clear actions used by the hook API", () => {
    const afterSelectAll = reduceMultiSelectState(createMultiSelectState(), {
      type: "selectAll",
      ids: ["row-3", "row-1", "row-2"],
    });
    const afterClear = reduceMultiSelectState(afterSelectAll, { type: "clear" });

    expect(Array.from(afterSelectAll.selected)).toEqual(["row-3", "row-1", "row-2"]);
    expect(afterSelectAll.anchorId).toBe("row-3");
    expect(Array.from(afterClear.selected)).toEqual([]);
    expect(afterClear.anchorId).toBeNull();
  });

  it("prunes selection and keeps selectedIds ordered by visible ids", () => {
    const initial = createMultiSelectState({
      selected: ["row-4", "row-2", "row-1"],
      anchorId: "row-4",
    });
    const visibleIds = ["row-2", "row-3", "row-1"];

    const pruned = reduceMultiSelectState(initial, {
      type: "prune",
      visibleIds,
    });

    expect(Array.from(pruned.selected)).toEqual(["row-2", "row-1"]);
    expect(pruned.anchorId).toBeNull();
    expect(getOrderedSelectedIds(pruned.selected, visibleIds)).toEqual([
      "row-2",
      "row-1",
    ]);
  });
});
