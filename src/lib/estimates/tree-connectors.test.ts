import { describe, expect, it } from "vitest";

import { buildTreeConnectorSegments } from "@/lib/estimates/tree-connectors";

describe("buildTreeConnectorSegments", () => {
  it("builds root section child trunk when children are visible", () => {
    expect(
      buildTreeConnectorSegments({
        depth: 0,
        isLastChild: false,
        ancestorLastChildFlags: [],
        hasVisibleChildren: true,
      })
    ).toEqual({
      verticalSegments: [
        {
          axis: "vertical",
          column: 0,
          from: "middle",
          to: "bottom",
          tone: "d0",
        },
      ],
      horizontalSegment: null,
    });
  });

  it("builds a leaf branch for a last child line", () => {
    expect(
      buildTreeConnectorSegments({
        depth: 1,
        isLastChild: true,
        ancestorLastChildFlags: [false],
        hasVisibleChildren: false,
      })
    ).toEqual({
      verticalSegments: [
        {
          axis: "vertical",
          column: 0,
          from: "top",
          to: "middle",
          tone: "d0",
        },
      ],
      horizontalSegment: {
        axis: "horizontal",
        column: 0,
        tone: "d0",
      },
    });
  });

  it("builds branch and child trunk for a last-child section", () => {
    expect(
      buildTreeConnectorSegments({
        depth: 1,
        isLastChild: true,
        ancestorLastChildFlags: [false],
        hasVisibleChildren: true,
      })
    ).toEqual({
      verticalSegments: [
        {
          axis: "vertical",
          column: 0,
          from: "top",
          to: "middle",
          tone: "d0",
        },
        {
          axis: "vertical",
          column: 1,
          from: "middle",
          to: "bottom",
          tone: "d1",
        },
      ],
      horizontalSegment: {
        axis: "horizontal",
        column: 0,
        tone: "d0",
      },
    });
  });

  it("supports mixed ancestor last-child flags at depth 4", () => {
    expect(
      buildTreeConnectorSegments({
        depth: 4,
        isLastChild: false,
        ancestorLastChildFlags: [false, true, false, true],
        hasVisibleChildren: false,
      })
    ).toEqual({
      verticalSegments: [
        {
          axis: "vertical",
          column: 0,
          from: "top",
          to: "bottom",
          tone: "d0",
        },
        {
          axis: "vertical",
          column: 2,
          from: "top",
          to: "bottom",
          tone: "d1",
        },
        {
          axis: "vertical",
          column: 3,
          from: "top",
          to: "bottom",
          tone: "d1",
        },
      ],
      horizontalSegment: {
        axis: "horizontal",
        column: 3,
        tone: "d1",
      },
    });
  });
});
