import { describe, expect, it } from "vitest";

import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";

describe("computeEstimateItemNumbering", () => {
  it("computes hierarchical numbering for mixed section/line trees", () => {
    const numberingById = computeEstimateItemNumbering([
      { id: "section-1", parent_id: null, position: 1, item_type: "section" },
      { id: "line-1-0", parent_id: "section-1", position: 1, item_type: "line" },
      { id: "section-1-1", parent_id: "section-1", position: 2, item_type: "section" },
      { id: "line-1-1", parent_id: "section-1-1", position: 1, item_type: "line" },
      { id: "line-1-2", parent_id: "section-1-1", position: 2, item_type: "line" },
      { id: "section-1-2", parent_id: "section-1", position: 3, item_type: "section" },
      { id: "line-1-2-1", parent_id: "section-1-2", position: 1, item_type: "line" },
      { id: "section-2", parent_id: null, position: 2, item_type: "section" },
    ]);

    expect(numberingById).toMatchObject({
      "section-1": "01",
      "line-1-0": "01.1",
      "section-1-1": "01.2",
      "line-1-1": "01.2.1",
      "line-1-2": "01.2.2",
      "section-1-2": "01.3",
      "line-1-2-1": "01.3.1",
      "section-2": "02",
    });
  });

  it("treats orphan nodes as roots and keeps deterministic order", () => {
    const numberingById = computeEstimateItemNumbering([
      { id: "orphan-b", parent_id: "missing-parent", position: 1, item_type: "section" },
      { id: "root-a", parent_id: null, position: 1, item_type: "section" },
      { id: "orphan-a", parent_id: "missing-parent", position: 1, item_type: "line" },
      { id: "root-b", parent_id: null, position: 2, item_type: "section" },
    ]);

    expect(numberingById).toMatchObject({
      "root-a": "01",
      "root-b": "02",
      "orphan-a": "03",
      "orphan-b": "04",
    });
  });
});
