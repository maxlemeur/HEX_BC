export type TreeConnectorMeta = {
  depth: number;
  isLastChild: boolean;
  ancestorLastChildFlags: boolean[];
  hasVisibleChildren: boolean;
};

export type TreeConnectorTone = "d0" | "d1";

export type TreeVerticalConnectorSegment = {
  axis: "vertical";
  column: number;
  from: "top" | "middle";
  to: "middle" | "bottom";
  tone: TreeConnectorTone;
};

export type TreeHorizontalConnectorSegment = {
  axis: "horizontal";
  column: number;
  tone: TreeConnectorTone;
};

export type TreeConnectorSegments = {
  verticalSegments: TreeVerticalConnectorSegment[];
  horizontalSegment: TreeHorizontalConnectorSegment | null;
};

function normalizeDepth(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function toneForColumn(column: number): TreeConnectorTone {
  return column === 0 ? "d0" : "d1";
}

/**
 * Builds visual connector segments for one tree row at any depth.
 * The caller controls column spacing in CSS through --tree-indent and --tree-offset.
 */
export function buildTreeConnectorSegments(meta: TreeConnectorMeta): TreeConnectorSegments {
  const depth = normalizeDepth(meta.depth);
  const ancestorLastChildFlags = meta.ancestorLastChildFlags ?? [];

  const verticalSegments: TreeVerticalConnectorSegment[] = [];

  // Keep ancestor trunks visible only when the path node beneath that trunk has following siblings.
  for (let column = 0; column < Math.max(depth - 1, 0); column += 1) {
    if (ancestorLastChildFlags[column + 1]) continue;
    verticalSegments.push({
      axis: "vertical",
      column,
      from: "top",
      to: "bottom",
      tone: toneForColumn(column),
    });
  }

  // Parent -> current node branch.
  if (depth > 0) {
    const parentColumn = depth - 1;
    verticalSegments.push({
      axis: "vertical",
      column: parentColumn,
      from: "top",
      to: meta.isLastChild ? "middle" : "bottom",
      tone: toneForColumn(parentColumn),
    });
  }

  // Current section trunk continuing to visible children.
  if (meta.hasVisibleChildren) {
    verticalSegments.push({
      axis: "vertical",
      column: depth,
      from: "middle",
      to: "bottom",
      tone: toneForColumn(depth),
    });
  }

  return {
    verticalSegments,
    horizontalSegment:
      depth > 0
        ? {
            axis: "horizontal",
            column: depth - 1,
            tone: toneForColumn(depth - 1),
          }
        : null,
  };
}
