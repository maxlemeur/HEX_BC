import { describe,expect,it } from "vitest";

import {
createMultiSelectState,
getOrderedSelectedIds,
pruneSelection,
reduceMultiSelectState,
selectRange
} from "@/hooks/useMultiSelect";

describe("useMultiSelect helpers", () => {

  it("selectRange returns an empty selection when one bound is missing", () => {
    expect(Array.from(selectRange(["row-1", "row-2"], "row-1", "missing"))).toEqual(
      []
    );
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
