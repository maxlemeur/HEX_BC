"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type Ref,
} from "react";

import { Badge } from "@/components/ui/badge";
import { useVirtualList } from "@/hooks/useVirtualList";
import { cn } from "@/lib/utils";
import type { PastePreviewCellValue, PastePreviewRow } from "@/components/estimates/PastePreviewDialog";

/**
 * From this many rows the preview mounts only the rows around the visible part
 * of its scroll region. Opening a 2,161-row preview with every row mounted was
 * one task of about 300 ms: the commit of ~57k elements, then Base UI's focus
 * manager forcing their style and layout and walking them for tabbables. Below
 * the threshold the table keeps its plain DOM, one `<tr>` per row.
 */
export const PASTE_PREVIEW_VIRTUALIZE_FROM_ROWS = 50;

const SCROLL_REGION_HEIGHT = 430;
const OVERSCAN = 8;

// Row height before measurement, with the fixed column widths below.
const ROW_HEIGHT_INVALID = 120;
const ROW_HEIGHT_WITH_NOTE = 80;
const ROW_HEIGHT = 64;

// Fixed widths (rem) once virtualized: with the automatic table layout the
// columns would follow the mounted rows and move while scrolling.
const COLUMN_WIDTH = { toggle: 4, line: 4, source: 9, wideSource: 20, interpretation: 14, status: 7, reasons: 18 } as const;

export function estimatePastePreviewRowHeight(row: PastePreviewRow): number {
  if (row.invalidReasons.some((reason) => reason.trim().length > 0)) return ROW_HEIGHT_INVALID;
  if ((row.interpretation?.length ?? 0) > 0) return ROW_HEIGHT_WITH_NOTE;
  return ROW_HEIGHT;
}

function normalizeCellValue(value: PastePreviewCellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

type PastePreviewRowViewProps = {
  row: PastePreviewRow;
  index: number;
  sourceColumns: string[];
  showsInterpretation: boolean;
  onToggleRow: (rowId: string, include: boolean) => void;
  rowRef?: Ref<HTMLTableRowElement>;
};

function PastePreviewRowView({
  row,
  index,
  sourceColumns,
  showsInterpretation,
  onToggleRow,
  rowRef,
}: Readonly<PastePreviewRowViewProps>) {
  const invalidReasons = row.invalidReasons.filter(
    (reason) => reason.trim().length > 0
  );
  const isInvalid = invalidReasons.length > 0;

  return (
    <tr
      ref={rowRef}
      className={row.include ? undefined : "opacity-75"}
      data-index={index}
      aria-rowindex={index + 2}
    >
      <td>
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={row.include}
          onChange={(event) =>
            onToggleRow(row.id, event.target.checked)
          }
          aria-label={`Inclure la ligne ${row.rowNumber}`}
          data-testid="paste-preview-row-include-checkbox"
        />
      </td>
      <td className="tabular-nums">{row.rowNumber}</td>
      {sourceColumns.map((column) => (
        <td key={`${row.id}:${column}`}>
          {normalizeCellValue(row.values[column])}
        </td>
      ))}
      {showsInterpretation ? (
        <td data-testid="paste-preview-row-interpretation">
          {(row.interpretation ?? []).map((note) => (
            <span key={`${row.id}:${note}`} className="block text-xs">{note}</span>
          ))}
        </td>
      ) : null}
      <td>
        {!row.include ? (
          <Badge variant="neutral" size="sm" dot>Exclue</Badge>
        ) : isInvalid ? (
          <Badge variant="danger" size="sm" dot>Invalide</Badge>
        ) : (
          <Badge variant="success" size="sm" dot>Valide</Badge>
        )}
      </td>
      <td>
        {invalidReasons.length === 0 ? (
          <span className="text-xs text-muted-foreground">-</span>
        ) : (
          <div className="space-y-1">
            {invalidReasons.map((reason, reasonIndex) => (
              <p
                key={`${row.id}:invalid:${reasonIndex}`}
                className="text-xs text-danger"
                data-testid="paste-preview-row-invalid-reason"
              >
                {reason}
              </p>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

function SpacerRow({ height, columnCount }: Readonly<{ height: number; columnCount: number }>) {
  return (
    <tr aria-hidden="true" data-testid="paste-preview-rows-spacer">
      {/* Inline padding and border beat the table's cell rules in @layer legacy. */}
      <td colSpan={columnCount} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );
}

export type PastePreviewRowsTableProps = {
  rows: PastePreviewRow[];
  sourceColumns: string[];
  /** Source columns given the wide width once virtualized (the designation). */
  wideColumns: ReadonlySet<string>;
  showsInterpretation: boolean;
  onToggleRow: (rowId: string, include: boolean) => void;
  /**
   * Changes when the rows' content may change height (the dialog's mapping,
   * which turns rows valid or invalid). Stable across include toggles.
   */
  measurementKey: unknown;
};

export function PastePreviewRowsTable({
  rows,
  sourceColumns,
  wideColumns,
  showsInterpretation,
  onToggleRow,
  measurementKey,
}: Readonly<PastePreviewRowsTableProps>) {
  const virtualize = rows.length >= PASTE_PREVIEW_VIRTUALIZE_FROM_ROWS;
  const focusedIndexRef = useRef<number | null>(null);
  const getPinnedIndex = useCallback(() => focusedIndexRef.current, []);
  const theadRef = useRef<HTMLTableSectionElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  // The header scrolls with the rows inside the region: its height is the
  // offset of the first row.
  useLayoutEffect(() => {
    const thead = theadRef.current;
    if (!virtualize || !thead) return;
    const read = () => setHeaderHeight(thead.offsetHeight);
    read();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(read);
    observer.observe(thead);
    return () => observer.disconnect();
  }, [virtualize]);

  const {
    scrollRef,
    isVirtualized,
    virtualItems,
    totalSize,
    measureElement,
    remeasure,
  } = useVirtualList<HTMLTableRowElement>({
    count: rows.length,
    enabled: virtualize,
    estimateSize: (index) => {
      const row = rows[index];
      return row ? estimatePastePreviewRowHeight(row) : ROW_HEIGHT;
    },
    overscan: OVERSCAN,
    paddingStart: headerHeight,
    initialRect: { width: 0, height: SCROLL_REGION_HEIGHT },
    measure: "layout",
    getPinnedIndex,
  });

  // A mapping change can turn hundreds of rows valid or invalid and change
  // their heights; an include toggle does not.
  const measuredFor = useRef({ measurementKey, showsInterpretation });
  useLayoutEffect(() => {
    const previous = measuredFor.current;
    if (previous.measurementKey === measurementKey && previous.showsInterpretation === showsInterpretation) return;
    measuredFor.current = { measurementKey, showsInterpretation };
    remeasure();
  }, [measurementKey, showsInterpretation, remeasure]);

  const handleFocus = useCallback((event: FocusEvent<HTMLTableSectionElement>) => {
    const row = event.target instanceof Element ? event.target.closest("tr[data-index]") : null;
    const index = row ? Number(row.getAttribute("data-index")) : Number.NaN;
    focusedIndexRef.current = Number.isInteger(index) ? index : null;
  }, []);
  const handleBlur = useCallback((event: FocusEvent<HTMLTableSectionElement>) => {
    // A window blur has no related target: keep the row so focus can return to it.
    const next = event.relatedTarget;
    if (next instanceof Element && !event.currentTarget.contains(next)) {
      focusedIndexRef.current = null;
    }
  }, []);

  const columnCount = 2 + sourceColumns.length + (showsInterpretation ? 1 : 0) + 2;
  const columnWidths = isVirtualized
    ? [
      COLUMN_WIDTH.toggle,
      COLUMN_WIDTH.line,
      ...sourceColumns.map((column) => wideColumns.has(column) ? COLUMN_WIDTH.wideSource : COLUMN_WIDTH.source),
      ...(showsInterpretation ? [COLUMN_WIDTH.interpretation] : []),
      COLUMN_WIDTH.status,
      COLUMN_WIDTH.reasons,
    ]
    : null;

  const rowView = (index: number, rowRef?: Ref<HTMLTableRowElement>) => {
    const row = rows[index];
    return (
      <PastePreviewRowView
        key={row.id}
        row={row}
        index={index}
        sourceColumns={sourceColumns}
        showsInterpretation={showsInterpretation}
        onToggleRow={onToggleRow}
        rowRef={rowRef}
      />
    );
  };

  let body;
  if (!isVirtualized) {
    body = rows.map((_, index) => rowView(index));
  } else {
    body = [];
    let cursor = headerHeight;
    for (const item of virtualItems) {
      const gap = item.start - cursor;
      if (gap > 0) body.push(<SpacerRow key={`spacer-before-${item.key}`} height={gap} columnCount={columnCount} />);
      body.push(rowView(item.index, measureElement));
      cursor = item.end;
    }
    const tail = totalSize - cursor;
    if (tail > 0) body.push(<SpacerRow key="spacer-end" height={tail} columnCount={columnCount} />);
  }

  return (
    <div
      ref={scrollRef}
      className="table-scroll max-h-[430px]"
      data-testid="paste-preview-rows-table"
      role="region"
      aria-labelledby="paste-preview-rows-title"
      tabIndex={0}
      style={isVirtualized ? { overflowAnchor: "none" } : undefined}
      data-virtualized={isVirtualized ? "" : undefined}
    >
      <table
        className={cn("data-table", isVirtualized && "table-fixed [&_td]:break-words [&_th]:break-words")}
        aria-rowcount={rows.length + 1}
        style={columnWidths ? { minWidth: `${columnWidths.reduce((sum, width) => sum + width, 0)}rem` } : undefined}
      >
        {columnWidths ? (
          <colgroup>
            {columnWidths.map((width, index) => <col key={index} style={{ width: `${width}rem` }} />)}
          </colgroup>
        ) : null}
        <thead ref={theadRef}>
          <tr aria-rowindex={1}>
            <th className="w-16">Inclure</th>
            <th className="w-16">#</th>
            {sourceColumns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            {showsInterpretation ? <th>Valeurs écrites (moteur 3)</th> : null}
            <th>État</th>
            <th>Raisons invalides</th>
          </tr>
        </thead>
        <tbody onFocus={handleFocus} onBlur={handleBlur}>
          {body}
        </tbody>
      </table>
    </div>
  );
}
