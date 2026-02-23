import { describe, expect, it } from "vitest";

import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";

describe("computeEstimateItemNumbering", () => {
  it("computes hierarchical numbering for mixed section/line trees", () => {
    const numberingById = computeEstimateItemNumbering([
      { id: "section-1", parent_id: null, position: 1 },
      { id: "line-1", parent_id: "section-1", position: 1 },
      { id: "section-1-1", parent_id: "section-1", position: 2 },
      { id: "line-1-1", parent_id: "section-1-1", position: 1 },
      { id: "section-2", parent_id: null, position: 2 },
      { id: "line-root", parent_id: null, position: 3 },
    ]);

    expect(numberingById).toMatchObject({
      "section-1": "1",
      "line-1": "1.1",
      "section-1-1": "1.2",
      "line-1-1": "1.2.1",
      "section-2": "2",
      "line-root": "3",
    });
  });

  it("treats orphan nodes as roots and keeps deterministic order", () => {
    const numberingById = computeEstimateItemNumbering([
      { id: "orphan-b", parent_id: "missing-parent", position: 1 },
      { id: "root-a", parent_id: null, position: 1 },
      { id: "orphan-a", parent_id: "missing-parent", position: 1 },
      { id: "root-b", parent_id: null, position: 2 },
    ]);

    expect(numberingById).toMatchObject({
      "orphan-a": "3",
      "orphan-b": "4",
      "root-a": "1",
      "root-b": "2",
    });
  });
});
