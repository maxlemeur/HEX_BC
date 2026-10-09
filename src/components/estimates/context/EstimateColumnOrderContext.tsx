"use client";

import { Children, Fragment, cloneElement, createContext, isValidElement, useContext, type ReactNode } from "react";

import { DEFAULT_ESTIMATE_COLUMN_ORDER, SPREADSHEET_ESTIMATE_COLUMN_IDS } from "@/hooks/useEstimateColumnOrder";
import type { EstimateColumnId } from "@/hooks/useEstimateColumnWidths";

export const EstimateColumnOrderContext = createContext<readonly EstimateColumnId[]>(DEFAULT_ESTIMATE_COLUMN_ORDER);

function flatten(children: ReactNode, prefix = ""): ReactNode[] {
  return Children.toArray(children).flatMap((child, index) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flatten(child.props.children, `${prefix}${index}:`)
      : [isValidElement(child) ? cloneElement(child, { key: `${prefix}${child.key ?? index}` }) : child],
  );
}

/** Reorder DOM cells, not just their visual CSS position, for screen readers. */
export function EstimateOrderedCells({ children }: { children: ReactNode }) {
  const order = useContext(EstimateColumnOrderContext);
  const result: ReactNode[] = [];
  let run: { child: ReactNode; index: number }[] = [];
  const flush = () => {
    result.push(...run.sort((a, b) => a.index - b.index).map(({ child }) => child));
    run = [];
  };
  for (const child of flatten(children)) {
    const id = isValidElement<{ columnId?: EstimateColumnId; "data-estimate-column"?: EstimateColumnId; cell?: { columnKey: string } }>(child)
      ? child.props.columnId ?? child.props["data-estimate-column"] ?? (child.props.cell ? SPREADSHEET_ESTIMATE_COLUMN_IDS[child.props.cell.columnKey] : undefined)
      : undefined;
    const index = id ? order.indexOf(id) : -1;
    if (index >= 0) run.push({ child, index });
    else { flush(); result.push(child); }
  }
  flush();
  return result;
}
