"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefCallback,
} from "react";

import type {
  SpreadsheetCell,
  SpreadsheetCellOptions,
  SpreadsheetCellProps,
  SpreadsheetEditorElement,
  SpreadsheetEditorProps,
  SpreadsheetNavigationResult,
  SpreadsheetNavigationRow,
} from "@/hooks/useSpreadsheetNavigation";

/**
 * Grid navigation for the estimate editor, following the spreadsheet contract
 * (Excel, WAI-ARIA APG "grid"): one active cell, a rectangular range anchored
 * on it, a "replace" mode when typing over a cell and an "edit" mode on F2 or
 * double-click.
 *
 * The state lives outside React. A move notifies the rows, and only the rows
 * whose signature changed render again: the row left, the row entered and the
 * rows of a range. The navigation object handed to the tree never changes.
 *
 * Written deviations from Excel:
 * - Up/Down/Enter skip the rows that do not have the column (section rows only
 *   have a title), so a column of values is entered without renaming sections.
 * - Ctrl+Up/Down go to the first/last row of the column, not to the edge of
 *   the current data region.
 * - Ctrl+A keeps selecting the lines of the estimate (editor shortcut).
 */

const CELL_ID_SEPARATOR = "::";
const DEFAULT_PAGE_SIZE = 10;

export const GRID_RANGE_EDGE_TOP = 1;
export const GRID_RANGE_EDGE_RIGHT = 2;
export const GRID_RANGE_EDGE_BOTTOM = 4;
export const GRID_RANGE_EDGE_LEFT = 8;

type GridCellElement = HTMLDivElement;

export type GridMove =
  | "left"
  | "right"
  | "up"
  | "down"
  | "rowStart"
  | "rowEnd"
  | "gridStart"
  | "gridEnd"
  | "edgeUp"
  | "edgeDown"
  | "pageUp"
  | "pageDown"
  | "next"
  | "previous";

export type GridEditMode = "replace" | "edit";

export type GridModel = {
  rowOrder: string[];
  rowIndexById: Map<string, number>;
  /** Column keys of each row, by row index. Rows share the same array. */
  rowColumns: string[][];
  /** Every column of the grid, in display order. */
  columnOrder: string[];
  columnIndex: Map<string, number>;
};

export type GridRangeBounds = {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
};

export type GridSelection = {
  active: SpreadsheetCell;
  isRange: boolean;
  /** Columns covered by the selection, in display order. */
  columnKeys: string[];
  /** Rows of the selection, top to bottom, with the cells they really have. */
  rows: Array<{ rowId: string; columnKeys: string[] }>;
};

export type GridNavigationOptions = {
  rows: SpreadsheetNavigationRow[];
  disabled?: boolean;
  onActiveCellNotMounted?: (cell: SpreadsheetCell) => void;
  /** Rows moved by Page Up / Page Down. */
  getPageSize?: () => number;
  /** Delete on the selection. Return false to leave the key to the page. */
  onClearSelection?: (selection: GridSelection) => boolean | void;
  /** Ctrl+D on the selection. */
  onFillDown?: (selection: GridSelection) => void;
  /** Return false to leave Shift+click to the row selection. */
  shouldExtendOnShiftClick?: () => boolean;
};

export type GridNavigationResult = SpreadsheetNavigationResult & {
  selectsOnClick: true;
  isCellSelected: (cell: SpreadsheetCell) => boolean;
  getCellRangeEdges: (cell: SpreadsheetCell) => number;
  subscribe: (listener: () => void) => () => void;
  getRowSignature: (rowId: string) => string;
  getActiveRowId: () => string | null;
  getSelection: () => GridSelection | null;
  selectCell: (cell: SpreadsheetCell, options?: { focus?: boolean }) => void;
  focusActiveCell: () => void;
  startEditing: (cell: SpreadsheetCell, mode?: GridEditMode) => boolean;
  collapseSelection: () => void;
};

export function toGridCellId(cell: SpreadsheetCell) {
  return `${cell.rowId}${CELL_ID_SEPARATOR}${cell.columnKey}`;
}

export function parseGridCellId(cellId: string): SpreadsheetCell | null {
  const index = cellId.lastIndexOf(CELL_ID_SEPARATOR);
  if (index <= 0) return null;
  return {
    rowId: cellId.slice(0, index),
    columnKey: cellId.slice(index + CELL_ID_SEPARATOR.length),
  };
}

function mergeColumnOrder(order: string[], columns: string[]) {
  let previousIndex = -1;
  for (const key of columns) {
    const existingIndex = order.indexOf(key);
    if (existingIndex >= 0) {
      previousIndex = existingIndex;
      continue;
    }
    previousIndex += 1;
    order.splice(previousIndex, 0, key);
  }
}

export function createGridModel(rows: SpreadsheetNavigationRow[]): GridModel {
  const rowOrder: string[] = [];
  const rowIndexById = new Map<string, number>();
  const rowColumns: string[][] = [];
  const columnOrder: string[] = [];
  // Thousands of rows share a handful of column lists: normalize each once.
  const normalized = new Map<string[], string[]>();

  for (const row of rows) {
    let columns = normalized.get(row.columnKeys);
    if (!columns) {
      columns = row.columnKeys.filter(
        (key, index, keys) => key.trim().length > 0 && keys.indexOf(key) === index
      );
      normalized.set(row.columnKeys, columns);
      mergeColumnOrder(columnOrder, columns);
    }
    if (columns.length === 0 || rowIndexById.has(row.rowId)) continue;
    rowIndexById.set(row.rowId, rowOrder.length);
    rowOrder.push(row.rowId);
    rowColumns.push(columns);
  }

  const columnIndex = new Map<string, number>();
  columnOrder.forEach((key, index) => columnIndex.set(key, index));

  return { rowOrder, rowIndexById, rowColumns, columnOrder, columnIndex };
}

export function hasGridCell(model: GridModel, cell: SpreadsheetCell) {
  const rowIndex = model.rowIndexById.get(cell.rowId);
  if (rowIndex === undefined) return false;
  return model.rowColumns[rowIndex].includes(cell.columnKey);
}

function findRowWithColumn(
  model: GridModel,
  columnKey: string,
  from: number,
  to: number
): number {
  const step = from <= to ? 1 : -1;
  for (let index = from; step > 0 ? index <= to : index >= to; index += step) {
    if (model.rowColumns[index]?.includes(columnKey)) return index;
  }
  return -1;
}

/**
 * The cell reached from `cell` by `move`. Returns the same cell at an edge of
 * the grid, and null when the cell is not part of the model.
 */
export function resolveGridMove(
  model: GridModel,
  cell: SpreadsheetCell,
  move: GridMove,
  pageSize: number = DEFAULT_PAGE_SIZE
): SpreadsheetCell | null {
  const rowIndex = model.rowIndexById.get(cell.rowId);
  if (rowIndex === undefined) return null;
  const columns = model.rowColumns[rowIndex];
  const columnPosition = columns.indexOf(cell.columnKey);
  if (columnPosition < 0) return null;

  const lastRowIndex = model.rowOrder.length - 1;
  const at = (targetRowIndex: number, columnKey: string): SpreadsheetCell => ({
    rowId: model.rowOrder[targetRowIndex],
    columnKey,
  });
  const inColumn = (targetRowIndex: number) =>
    targetRowIndex < 0 ? cell : at(targetRowIndex, cell.columnKey);

  switch (move) {
    case "left":
      return columnPosition > 0 ? at(rowIndex, columns[columnPosition - 1]) : cell;
    case "right":
      return columnPosition < columns.length - 1
        ? at(rowIndex, columns[columnPosition + 1])
        : cell;
    case "rowStart":
      return at(rowIndex, columns[0]);
    case "rowEnd":
      return at(rowIndex, columns[columns.length - 1]);
    case "up":
      return rowIndex > 0
        ? inColumn(findRowWithColumn(model, cell.columnKey, rowIndex - 1, 0))
        : cell;
    case "down":
      return rowIndex < lastRowIndex
        ? inColumn(findRowWithColumn(model, cell.columnKey, rowIndex + 1, lastRowIndex))
        : cell;
    case "edgeUp":
      return inColumn(findRowWithColumn(model, cell.columnKey, 0, rowIndex));
    case "edgeDown":
      return inColumn(findRowWithColumn(model, cell.columnKey, lastRowIndex, rowIndex));
    case "pageUp":
    case "pageDown": {
      const direction = move === "pageDown" ? 1 : -1;
      const size = Math.max(1, Math.floor(pageSize));
      const targetIndex = Math.min(lastRowIndex, Math.max(0, rowIndex + direction * size));
      if (targetIndex === rowIndex) return cell;
      const edge = direction > 0 ? lastRowIndex : 0;
      const beyond = findRowWithColumn(model, cell.columnKey, targetIndex, edge);
      if (beyond >= 0) return at(beyond, cell.columnKey);
      return inColumn(
        findRowWithColumn(model, cell.columnKey, targetIndex, rowIndex + direction)
      );
    }
    case "gridStart":
      return at(0, model.rowColumns[0][0]);
    case "gridEnd": {
      const lastColumns = model.rowColumns[lastRowIndex];
      return at(lastRowIndex, lastColumns[lastColumns.length - 1]);
    }
    case "next": {
      if (columnPosition < columns.length - 1) {
        return at(rowIndex, columns[columnPosition + 1]);
      }
      return rowIndex < lastRowIndex ? at(rowIndex + 1, model.rowColumns[rowIndex + 1][0]) : cell;
    }
    case "previous": {
      if (columnPosition > 0) return at(rowIndex, columns[columnPosition - 1]);
      if (rowIndex === 0) return cell;
      const previousColumns = model.rowColumns[rowIndex - 1];
      return at(rowIndex - 1, previousColumns[previousColumns.length - 1]);
    }
    default:
      return cell;
  }
}

export function getGridRangeBounds(
  model: GridModel,
  anchor: SpreadsheetCell,
  extent: SpreadsheetCell
): GridRangeBounds | null {
  const anchorRow = model.rowIndexById.get(anchor.rowId);
  const extentRow = model.rowIndexById.get(extent.rowId);
  const anchorColumn = model.columnIndex.get(anchor.columnKey);
  const extentColumn = model.columnIndex.get(extent.columnKey);
  if (
    anchorRow === undefined ||
    extentRow === undefined ||
    anchorColumn === undefined ||
    extentColumn === undefined
  ) {
    return null;
  }
  return {
    rowStart: Math.min(anchorRow, extentRow),
    rowEnd: Math.max(anchorRow, extentRow),
    columnStart: Math.min(anchorColumn, extentColumn),
    columnEnd: Math.max(anchorColumn, extentColumn),
  };
}

function isEditorElement(value: unknown): value is SpreadsheetEditorElement {
  return (
    value instanceof HTMLInputElement ||
    value instanceof HTMLSelectElement ||
    value instanceof HTMLTextAreaElement
  );
}

function isTextEditor(
  editor: SpreadsheetEditorElement
): editor is HTMLInputElement | HTMLTextAreaElement {
  return editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement;
}

function writeEditorValue(editor: SpreadsheetEditorElement, value: string) {
  if (editor.value === value) return;

  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value");
  descriptor?.set?.call(editor, value);
  if (!descriptor?.set) {
    editor.value = value;
  }

  const eventName = editor instanceof HTMLSelectElement ? "change" : "input";
  editor.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function selectEditorText(editor: SpreadsheetEditorElement) {
  if (!isTextEditor(editor)) return;
  try {
    editor.select();
  } catch {
    // Some input types (e.g. number) do not support text selection.
  }
}

function setEditorCursorToEnd(editor: SpreadsheetEditorElement) {
  if (!isTextEditor(editor)) return;
  try {
    const position = editor.value.length;
    editor.setSelectionRange(position, position);
  } catch {
    // Some input types (e.g. number) do not expose caret positioning.
  }
}

const NATIVE_POINTER_ROLES = new Set([
  "button",
  "checkbox",
  "link",
  "listbox",
  "menu",
  "menuitem",
  "option",
  "radio",
  "switch",
  "tab",
]);

function isFocusLost() {
  const active = document.activeElement;
  return !active || active === document.body;
}

type GridEngine = {
  navigation: GridNavigationResult;
  setOptions: (options: GridNavigationOptions) => void;
  setModel: (model: GridModel, disabled: boolean) => void;
  connect: () => () => void;
};

const EMPTY_MODEL = createGridModel([]);

export function createGridEngine(): GridEngine {
  let model = EMPTY_MODEL;
  let options: GridNavigationOptions = { rows: [] };
  let disabled = false;

  let activeId: string | null = null;
  let activeCell: SpreadsheetCell | null = null;
  let extentId: string | null = null;
  let editingId: string | null = null;
  let editingCell: SpreadsheetCell | null = null;
  let editMode: GridEditMode = "edit";
  let pendingEditMode: GridEditMode | null = null;
  let editInitialValue: string | null = null;

  let rangeBounds: GridRangeBounds | null | undefined;
  let pendingFocusId: string | null = null;
  let dragging = false;
  let lastPointerType = "mouse";
  let refocusTimer: ReturnType<typeof setTimeout> | null = null;

  const listeners = new Set<() => void>();
  const signatures = new Map<string, string>();
  const cells = new Map<string, GridCellElement>();
  const editors = new Map<string, SpreadsheetEditorElement>();
  const nonEditable = new Set<string>();
  const cellRefs = new Map<string, RefCallback<GridCellElement>>();
  const editorPropsCache = new Map<string, SpreadsheetEditorProps<SpreadsheetEditorElement>>();

  function emit() {
    signatures.clear();
    rangeBounds = undefined;
    listeners.forEach((listener) => listener());
  }

  function getBounds(): GridRangeBounds | null {
    if (rangeBounds !== undefined) return rangeBounds;
    const extent = extentId ? parseGridCellId(extentId) : null;
    rangeBounds = activeCell && extent ? getGridRangeBounds(model, activeCell, extent) : null;
    return rangeBounds;
  }

  function setActive(cellId: string | null) {
    activeId = cellId;
    activeCell = cellId ? parseGridCellId(cellId) : null;
  }

  function setEditing(cellId: string | null) {
    editingId = cellId;
    editingCell = cellId ? parseGridCellId(cellId) : null;
  }

  function isInModel(cellId: string) {
    const cell = parseGridCellId(cellId);
    return cell !== null && hasGridCell(model, cell);
  }

  // --- reads -------------------------------------------------------------

  function getRowSignature(rowId: string): string {
    const cached = signatures.get(rowId);
    if (cached !== undefined) return cached;

    let signature = "";
    if (activeCell?.rowId === rowId) {
      signature += `a:${activeCell.columnKey}${disabled ? ":off" : ""}`;
    }
    if (editingCell?.rowId === rowId) {
      signature += `|e:${editingCell.columnKey}`;
    }
    const bounds = getBounds();
    if (bounds) {
      const rowIndex = model.rowIndexById.get(rowId);
      if (rowIndex !== undefined && rowIndex >= bounds.rowStart && rowIndex <= bounds.rowEnd) {
        signature += `|s:${bounds.columnStart}-${bounds.columnEnd}:${
          rowIndex === bounds.rowStart ? "t" : ""
        }${rowIndex === bounds.rowEnd ? "b" : ""}`;
      }
    }

    signatures.set(rowId, signature);
    return signature;
  }

  function getCellRangeEdges(cell: SpreadsheetCell): number {
    const bounds = getBounds();
    if (!bounds) return 0;
    const rowIndex = model.rowIndexById.get(cell.rowId);
    const columnIndex = model.columnIndex.get(cell.columnKey);
    if (
      rowIndex === undefined ||
      columnIndex === undefined ||
      rowIndex < bounds.rowStart ||
      rowIndex > bounds.rowEnd ||
      columnIndex < bounds.columnStart ||
      columnIndex > bounds.columnEnd
    ) {
      return 0;
    }
    // A selected cell always carries at least one bit, so 0 means "outside".
    let edges = 16;
    if (rowIndex === bounds.rowStart) edges |= GRID_RANGE_EDGE_TOP;
    if (rowIndex === bounds.rowEnd) edges |= GRID_RANGE_EDGE_BOTTOM;
    if (columnIndex === bounds.columnStart) edges |= GRID_RANGE_EDGE_LEFT;
    if (columnIndex === bounds.columnEnd) edges |= GRID_RANGE_EDGE_RIGHT;
    return edges;
  }

  function isCellSelected(cell: SpreadsheetCell) {
    return getCellRangeEdges(cell) !== 0;
  }

  function getSelection(): GridSelection | null {
    if (!activeCell || !hasGridCell(model, activeCell)) return null;
    const bounds = getBounds();
    if (!bounds) {
      return {
        active: activeCell,
        isRange: false,
        columnKeys: [activeCell.columnKey],
        rows: [{ rowId: activeCell.rowId, columnKeys: [activeCell.columnKey] }],
      };
    }

    const columnKeys = model.columnOrder.slice(bounds.columnStart, bounds.columnEnd + 1);
    const wanted = new Set(columnKeys);
    const rows: GridSelection["rows"] = [];
    for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
      const rowColumnKeys = model.rowColumns[rowIndex].filter((key) => wanted.has(key));
      if (rowColumnKeys.length === 0) continue;
      rows.push({ rowId: model.rowOrder[rowIndex], columnKeys: rowColumnKeys });
    }
    return { active: activeCell, isRange: true, columnKeys, rows };
  }

  // --- focus -------------------------------------------------------------

  function reveal(node: HTMLElement) {
    if (typeof node.scrollIntoView !== "function") return;
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
    revealFromUnderFrozenColumn(node);
  }

  function focusCell(cellId: string, { scroll = true }: { scroll?: boolean } = {}) {
    const node = cells.get(cellId);
    if (!node) {
      const cell = parseGridCellId(cellId);
      if (!cell || !hasGridCell(model, cell)) return;
      // The row is not rendered (virtualized): ask for it, focus when it lands.
      pendingFocusId = cellId;
      options.onActiveCellNotMounted?.(cell);
      return;
    }
    pendingFocusId = null;
    if (document.activeElement !== node) {
      node.focus({ preventScroll: true });
    }
    if (scroll) reveal(node);
  }

  function honourPendingFocus(cellId: string, node: GridCellElement) {
    queueMicrotask(() => {
      if (pendingFocusId !== cellId || activeId !== cellId || !node.isConnected) return;
      pendingFocusId = null;
      const active = document.activeElement;
      const focusIsOurs =
        isFocusLost() || (active instanceof Element && active.closest("[data-cell-id]") !== null);
      if (!focusIsOurs) return;
      node.focus({ preventScroll: true });
      reveal(node);
    });
  }

  function scheduleRefocus() {
    if (refocusTimer !== null) clearTimeout(refocusTimer);
    // Deferred: a native focus change in progress shows the body as focused
    // for an instant, and must not be taken for lost focus (TI-668).
    refocusTimer = setTimeout(() => {
      refocusTimer = null;
      if (disabled || !activeId || editingId || !isFocusLost()) return;
      const node = cells.get(activeId);
      node?.focus({ preventScroll: true });
    }, 0);
  }

  // --- state changes -----------------------------------------------------

  function activate(cellId: string, { focus = false }: { focus?: boolean } = {}) {
    const changed = activeId !== cellId || extentId !== null;
    if (changed) {
      setActive(cellId);
      extentId = null;
      pendingFocusId = null;
      emit();
    }
    if (focus) focusCell(cellId);
  }

  function setExtent(cellId: string) {
    const next = cellId === activeId ? null : cellId;
    if (next === extentId) return;
    extentId = next;
    emit();
  }

  function collapseSelection() {
    if (extentId === null) return;
    extentId = null;
    emit();
  }

  function beginEditing(cellId: string, editor: SpreadsheetEditorElement) {
    if (editingId === cellId) return;
    setEditing(cellId);
    editInitialValue = editor.value;
    editMode = pendingEditMode ?? "edit";
    pendingEditMode = null;
    setActive(cellId);
    extentId = null;
    pendingFocusId = null;
    emit();
  }

  function endEditing() {
    if (editingId === null) return;
    setEditing(null);
    editInitialValue = null;
    editMode = "edit";
    emit();
  }

  function startEditingById(cellId: string, mode: GridEditMode): boolean {
    if (disabled || nonEditable.has(cellId)) return false;
    const editor = editors.get(cellId);
    if (!editor || editor.disabled) return false;
    if (isTextEditor(editor) && editor.readOnly) return false;

    if (editingId !== cellId) {
      pendingEditMode = mode;
      editor.focus({ preventScroll: true });
      pendingEditMode = null;
      if (document.activeElement !== editor) return false;
      // The focus handler normally did it; this covers an editor that already
      // held focus without the cell knowing.
      if (editingId !== cellId) {
        pendingEditMode = mode;
        beginEditing(cellId, editor);
      }
    }
    editMode = mode;
    if (mode === "replace") {
      selectEditorText(editor);
    } else {
      setEditorCursorToEnd(editor);
    }
    return true;
  }

  function pageSize() {
    return options.getPageSize?.() ?? DEFAULT_PAGE_SIZE;
  }

  /** Moves the active cell, or the far corner of the range when extending. */
  function move(direction: GridMove, extend: boolean): boolean {
    if (!activeId || !activeCell) return false;

    if (extend) {
      const from = extentId ? parseGridCellId(extentId) : activeCell;
      const target = from ? resolveGridMove(model, from, direction, pageSize()) : null;
      if (!target) return false;
      const targetId = toGridCellId(target);
      setExtent(targetId);
      const node = cells.get(targetId);
      if (node) {
        reveal(node);
      } else {
        options.onActiveCellNotMounted?.(target);
      }
      return true;
    }

    const target = resolveGridMove(model, activeCell, direction, pageSize());
    if (!target) return false;
    const targetId = toGridCellId(target);
    const moved = targetId !== activeId || extentId !== null;
    activate(targetId, { focus: true });
    return moved;
  }

  /** Leaves the editor of `cellId` (its blur commits) and moves from there. */
  function moveFromEditor(cellId: string, editor: SpreadsheetEditorElement, direction: GridMove) {
    const cell = parseGridCellId(cellId);
    const target = cell ? resolveGridMove(model, cell, direction, pageSize()) : null;
    const targetId = target ? toGridCellId(target) : cellId;
    if (!cells.has(targetId)) {
      // Commit now: the target row has to be scrolled in before it gets focus.
      editor.blur();
    }
    activate(targetId, { focus: true });
  }

  function cancelEditing(cellId: string, editor: SpreadsheetEditorElement) {
    if (editInitialValue !== null && editingId === cellId) {
      writeEditorValue(editor, editInitialValue);
    }
    const node = cells.get(cellId);
    if (node) {
      node.focus({ preventScroll: true });
    } else {
      editor.blur();
    }
  }

  // --- pointer -----------------------------------------------------------

  /**
   * True when the press belongs to a control inside the cell (button, link,
   * checkbox, an input that is not the cell editor, a list editor): the
   * browser handles it and the cell follows the focus.
   */
  function isNativePointerTarget(target: Element, node: GridCellElement, cellId: string) {
    const editor = editors.get(cellId);
    for (let element: Element | null = target; element && element !== node; element = element.parentElement) {
      if (element === editor) {
        return (
          element instanceof HTMLSelectElement ||
          element.getAttribute("data-grid-editor-click") === "open"
        );
      }
      const tag = element.tagName;
      if (
        tag === "BUTTON" ||
        tag === "A" ||
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        tag === "LABEL" ||
        tag === "SUMMARY"
      ) {
        return true;
      }
      const role = element.getAttribute("role");
      if (role && NATIVE_POINTER_ROLES.has(role)) return true;
      if (element instanceof HTMLElement && element.isContentEditable) return true;
      if (element.hasAttribute("data-grid-native-pointer")) return true;
    }
    return false;
  }

  function stopDragging() {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener("mouseup", stopDragging, true);
  }

  function readCell(event: { currentTarget: GridCellElement; target: EventTarget }) {
    const node = event.currentTarget;
    const cellId = node.dataset.cellId;
    if (!cellId) return null;
    const target = event.target;
    // React events bubble through portals: a popover opened from the cell is
    // not the cell.
    if (!(target instanceof Node) || !node.contains(target)) return null;
    return { node, cellId, target };
  }

  function handleCellFocus(event: FocusEvent<GridCellElement>) {
    if (disabled) return;
    const context = readCell(event);
    if (!context) return;
    const { node, cellId, target } = context;

    if (target !== node && isEditorElement(target) && editors.get(cellId) === target) {
      beginEditing(cellId, target);
      return;
    }
    if (activeId !== cellId) {
      activate(cellId);
    }
  }

  function handleCellBlur(event: FocusEvent<GridCellElement>) {
    const context = readCell(event);
    if (!context) return;
    if (editingId === context.cellId && editors.get(context.cellId) === context.target) {
      endEditing();
    }
  }

  function handleCellMouseDown(event: MouseEvent<GridCellElement>) {
    if (disabled || event.button !== 0) return;
    const context = readCell(event);
    if (!context) return;
    const { node, cellId, target } = context;
    if (!(target instanceof Element)) return;

    // Ctrl/Cmd+click stays the row selection of the editor.
    if (event.ctrlKey || event.metaKey) return;

    const nativeTarget = isNativePointerTarget(target, node, cellId);

    if (event.shiftKey) {
      if (nativeTarget || !activeId || !isInModel(cellId) || !isInModel(activeId)) return;
      if (options.shouldExtendOnShiftClick?.() === false) return;
      event.preventDefault();
      event.stopPropagation();
      const anchorId = activeId;
      if (editingId !== null || document.activeElement !== cells.get(anchorId)) {
        // Commit the editor, and keep the keyboard on the anchor of the range.
        focusCell(anchorId, { scroll: false });
      }
      setExtent(cellId);
      return;
    }

    // Touch and pen: a tap edits, so the virtual keyboard opens.
    if (lastPointerType !== "mouse") return;
    // Already editing here: the press places the caret.
    if (editingId === cellId) return;
    if (nativeTarget) return;

    event.preventDefault();
    activate(cellId, { focus: true });
    if (isInModel(cellId)) {
      dragging = true;
      window.addEventListener("mouseup", stopDragging, true);
    }
  }

  function handleCellMouseEnter(event: MouseEvent<GridCellElement>) {
    if (!dragging) return;
    if ((event.buttons & 1) === 0) {
      stopDragging();
      return;
    }
    const cellId = event.currentTarget.dataset.cellId;
    if (!cellId || disabled || !activeId || !isInModel(cellId)) return;
    setExtent(cellId);
  }

  function handleCellDoubleClick(event: MouseEvent<GridCellElement>) {
    if (disabled) return;
    const context = readCell(event);
    if (!context) return;
    const { node, cellId, target } = context;
    if (editingId === cellId) return;
    if (target instanceof Element && isNativePointerTarget(target, node, cellId)) return;
    startEditingById(cellId, "edit");
  }

  function handleCellClick() {
    // Selection happens on mouse down, like a spreadsheet.
  }

  // --- keyboard ----------------------------------------------------------

  function isComposing(event: KeyboardEvent<Element>) {
    return event.nativeEvent.isComposing || event.keyCode === 229;
  }

  function resolveMoveKey(event: KeyboardEvent<Element>): GridMove | null {
    const jump = event.ctrlKey || event.metaKey;
    switch (event.key) {
      case "ArrowUp":
        return jump ? "edgeUp" : "up";
      case "ArrowDown":
        return jump ? "edgeDown" : "down";
      case "ArrowLeft":
        return jump ? "rowStart" : "left";
      case "ArrowRight":
        return jump ? "rowEnd" : "right";
      case "Home":
        return jump ? "gridStart" : "rowStart";
      case "End":
        return jump ? "gridEnd" : "rowEnd";
      case "PageUp":
        return "pageUp";
      case "PageDown":
        return "pageDown";
      default:
        return null;
    }
  }

  function isTypingKey(event: KeyboardEvent<Element>) {
    if (event.key === "Dead") return !event.ctrlKey && !event.metaKey;
    if (event.key.length !== 1) return false;
    if (event.metaKey) return false;
    if (!event.ctrlKey) return true;
    // AltGr reads as Ctrl+Alt on Windows keyboards (French layouts: @ # { [ |).
    return event.altKey || event.getModifierState("AltGraph");
  }

  function handleCellKeyDown(event: KeyboardEvent<GridCellElement>) {
    if (disabled || event.target !== event.currentTarget || isComposing(event)) return;
    const cellId = event.currentTarget.dataset.cellId;
    if (!cellId) return;
    if (activeId !== cellId) activate(cellId);

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (startEditingById(cellId, "edit")) {
          editors.get(cellId)?.click();
        }
        return;
      }
      if (!isTypingKey(event)) return;
    }

    const moveKey = resolveMoveKey(event);
    if (moveKey) {
      event.preventDefault();
      move(moveKey, event.shiftKey);
      return;
    }

    const command = event.ctrlKey || event.metaKey;
    switch (event.key) {
      case "Tab": {
        if (command) return;
        // At the very first or last cell, Tab leaves the grid as usual.
        if (move(event.shiftKey ? "previous" : "next", false)) event.preventDefault();
        return;
      }
      case "Enter": {
        if (command) return;
        event.preventDefault();
        move(event.shiftKey ? "up" : "down", false);
        return;
      }
      case "F2": {
        event.preventDefault();
        startEditingById(cellId, "edit");
        return;
      }
      case "Escape": {
        if (extentId === null) return;
        event.preventDefault();
        collapseSelection();
        return;
      }
      case "Delete": {
        if (command || event.shiftKey) return;
        const selection = getSelection();
        if (!selection || !options.onClearSelection) return;
        if (options.onClearSelection(selection) !== false) event.preventDefault();
        return;
      }
      case "Backspace": {
        if (command) return;
        // The browser then deletes the selected text: the cell opens empty.
        if (!startEditingById(cellId, "replace")) event.preventDefault();
        return;
      }
      default:
        break;
    }

    if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") {
      // Never let the browser bookmark the page from a cell.
      event.preventDefault();
      const selection = getSelection();
      if (selection) options.onFillDown?.(selection);
      return;
    }

    if (isTypingKey(event)) {
      // Not prevented on purpose: the browser types the key into the editor
      // that just took focus with its text selected. Dead keys and input
      // methods keep working.
      const started = startEditingById(cellId, "replace");
      if (!started && event.key === " ") event.preventDefault();
    }
  }

  function handleEditorFocus(event: FocusEvent<SpreadsheetEditorElement>) {
    if (disabled) return;
    const editor = event.currentTarget;
    const cellId = editor.closest<HTMLElement>("[data-cell-id]")?.dataset.cellId;
    if (!cellId || editors.get(cellId) !== editor) return;
    beginEditing(cellId, editor);
  }

  function handleEditorBlur(event: FocusEvent<SpreadsheetEditorElement>) {
    const editor = event.currentTarget;
    const cellId = editor.closest<HTMLElement>("[data-cell-id]")?.dataset.cellId;
    if (cellId && editingId === cellId) endEditing();
  }

  function handleEditorKeyDown(event: KeyboardEvent<SpreadsheetEditorElement>) {
    if (disabled || isComposing(event)) return;
    const editor = event.currentTarget;
    const cellId = editor.closest<HTMLElement>("[data-cell-id]")?.dataset.cellId;
    if (!cellId) return;
    const command = event.ctrlKey || event.metaKey;

    switch (event.key) {
      case "Escape": {
        event.preventDefault();
        cancelEditing(cellId, editor);
        return;
      }
      case "Enter": {
        if (command || event.altKey) return;
        event.preventDefault();
        moveFromEditor(cellId, editor, event.shiftKey ? "up" : "down");
        return;
      }
      case "Tab": {
        if (command || event.altKey) return;
        event.preventDefault();
        moveFromEditor(cellId, editor, event.shiftKey ? "previous" : "next");
        return;
      }
      case "F2": {
        event.preventDefault();
        editMode = editMode === "edit" ? "replace" : "edit";
        return;
      }
      default:
        break;
    }

    if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
      // Undo inside the editor first; the page undo runs once it is unchanged.
      if (editInitialValue !== null && editingId === cellId && editor.value !== editInitialValue) {
        event.preventDefault();
        writeEditorValue(editor, editInitialValue);
        selectEditorText(editor);
      }
      return;
    }

    // Typing over a cell: the arrows commit and move, like a spreadsheet.
    // After F2 or a double-click they move the caret.
    if (
      editMode === "replace" &&
      editingId === cellId &&
      isTextEditor(editor) &&
      !command &&
      !event.altKey &&
      !event.shiftKey
    ) {
      const direction =
        event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "ArrowLeft"
              ? "left"
              : event.key === "ArrowRight"
                ? "right"
                : null;
      if (direction) {
        event.preventDefault();
        moveFromEditor(cellId, editor, direction);
      }
    }
  }

  // --- props -------------------------------------------------------------

  function getCellRef(cellId: string): RefCallback<GridCellElement> {
    const cached = cellRefs.get(cellId);
    if (cached) return cached;
    const ref: RefCallback<GridCellElement> = (node) => {
      if (node) {
        cells.set(cellId, node);
        cellRefs.set(cellId, ref);
        if (pendingFocusId === cellId) honourPendingFocus(cellId, node);
        return;
      }
      cells.delete(cellId);
      if (cellRefs.get(cellId) === ref) cellRefs.delete(cellId);
    };
    cellRefs.set(cellId, ref);
    return ref;
  }

  function getCellProps(
    cell: SpreadsheetCell,
    cellOptions?: SpreadsheetCellOptions
  ): SpreadsheetCellProps {
    const cellId = toGridCellId(cell);
    if (cellOptions?.editable === false) {
      nonEditable.add(cellId);
    } else {
      nonEditable.delete(cellId);
    }
    return {
      ref: getCellRef(cellId),
      role: "gridcell",
      tabIndex: !disabled && activeId === cellId ? 0 : -1,
      onFocus: handleCellFocus,
      onBlur: handleCellBlur,
      onKeyDown: handleCellKeyDown,
      onMouseDown: handleCellMouseDown,
      onMouseEnter: handleCellMouseEnter,
      onClick: handleCellClick,
      onDoubleClick: handleCellDoubleClick,
      "aria-selected": isCellSelected(cell) ? true : undefined,
      "data-testid": "estimate-cell",
      "data-cell-id": cellId,
      "data-cell-row-id": cell.rowId,
      "data-cell-column-key": cell.columnKey,
    };
  }

  function getEditorProps<T extends SpreadsheetEditorElement>(
    cell: SpreadsheetCell
  ): SpreadsheetEditorProps<T> {
    const cellId = toGridCellId(cell);
    let props = editorPropsCache.get(cellId);
    if (!props) {
      const ref: RefCallback<SpreadsheetEditorElement> = (node) => {
        if (node) {
          editors.set(cellId, node);
          return;
        }
        editors.delete(cellId);
        if (!cells.has(cellId)) editorPropsCache.delete(cellId);
      };
      props = {
        ref,
        tabIndex: -1,
        onFocus: handleEditorFocus,
        onBlur: handleEditorBlur,
        onKeyDown: handleEditorKeyDown,
      };
      editorPropsCache.set(cellId, props);
    }
    return props as unknown as SpreadsheetEditorProps<T>;
  }

  // --- engine ------------------------------------------------------------

  function setModel(nextModel: GridModel, nextDisabled: boolean) {
    const previousModel = model;
    const previousActive = activeCell;
    const wasDisabled = disabled;
    model = nextModel;
    disabled = nextDisabled;

    if (disabled || model.rowOrder.length === 0) {
      const changed =
        activeId !== null || editingId !== null || extentId !== null || wasDisabled !== disabled;
      setActive(null);
      setEditing(null);
      extentId = null;
      pendingFocusId = null;
      editInitialValue = null;
      stopDragging();
      if (changed || previousModel !== model) emit();
      return;
    }

    let nextActiveId = activeId;
    if (!activeCell || !hasGridCell(model, activeCell)) {
      nextActiveId = null;
      // A removed row: stay at the same place in the grid.
      const previousRowIndex = previousActive
        ? previousModel.rowIndexById.get(previousActive.rowId)
        : undefined;
      if (previousActive && previousRowIndex !== undefined) {
        const lastRowIndex = model.rowOrder.length - 1;
        const start = Math.min(previousRowIndex, lastRowIndex);
        let rowIndex = findRowWithColumn(model, previousActive.columnKey, start, lastRowIndex);
        if (rowIndex < 0) rowIndex = findRowWithColumn(model, previousActive.columnKey, start, 0);
        nextActiveId =
          rowIndex >= 0
            ? toGridCellId({ rowId: model.rowOrder[rowIndex], columnKey: previousActive.columnKey })
            : toGridCellId({ rowId: model.rowOrder[start], columnKey: model.rowColumns[start][0] });
      }
      if (!nextActiveId) {
        // Enabled again (draft lease, undo/redo, settings save): the cell that
        // still holds DOM focus stays active, otherwise the first cell.
        const focusedId =
          document.activeElement?.closest("[data-cell-id]")?.getAttribute("data-cell-id") ?? null;
        nextActiveId =
          focusedId && isInModel(focusedId)
            ? focusedId
            : toGridCellId({ rowId: model.rowOrder[0], columnKey: model.rowColumns[0][0] });
      }
    }

    if (nextActiveId !== activeId) {
      setActive(nextActiveId);
      extentId = null;
    } else if (extentId && !isInModel(extentId)) {
      extentId = null;
    }
    if (editingId && !isInModel(editingId)) {
      setEditing(null);
      editInitialValue = null;
    }
    if (pendingFocusId && pendingFocusId !== activeId) pendingFocusId = null;

    // Row indexes and column spans may have shifted: every signature is stale.
    emit();
    scheduleRefocus();
  }

  function connect() {
    const recordPointer = (event: PointerEvent) => {
      lastPointerType = event.pointerType || "mouse";
    };
    document.addEventListener("pointerdown", recordPointer, true);
    return () => {
      document.removeEventListener("pointerdown", recordPointer, true);
      stopDragging();
      if (refocusTimer !== null) {
        clearTimeout(refocusTimer);
        refocusTimer = null;
      }
    };
  }

  const navigation: GridNavigationResult = {
    selectsOnClick: true,
    get activeCell() {
      return activeCell;
    },
    get editingCell() {
      return editingCell;
    },
    isCellActive: (cell) =>
      activeCell !== null &&
      activeCell.rowId === cell.rowId &&
      activeCell.columnKey === cell.columnKey,
    isCellEditing: (cell) =>
      editingCell !== null &&
      editingCell.rowId === cell.rowId &&
      editingCell.columnKey === cell.columnKey,
    isCellSelected,
    getCellRangeEdges,
    getCellProps,
    getEditorProps,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getRowSignature,
    getActiveRowId: () => activeCell?.rowId ?? null,
    getSelection,
    selectCell: (cell, selectOptions) => {
      if (disabled) return;
      activate(toGridCellId(cell), { focus: selectOptions?.focus !== false });
    },
    focusActiveCell: () => {
      if (disabled || !activeId) return;
      focusCell(activeId);
    },
    startEditing: (cell, mode = "edit") => {
      const cellId = toGridCellId(cell);
      if (activeId !== cellId) activate(cellId);
      return startEditingById(cellId, mode);
    },
    collapseSelection,
  };

  return {
    navigation,
    setOptions: (nextOptions) => {
      options = nextOptions;
    },
    setModel,
    connect,
  };
}

export function useGridNavigation(options: GridNavigationOptions): GridNavigationResult {
  const [engine] = useState(createGridEngine);
  const model = useMemo(() => createGridModel(options.rows), [options.rows]);
  const disabled = Boolean(options.disabled);

  useLayoutEffect(() => {
    engine.setOptions(options);
  });

  useLayoutEffect(() => {
    engine.setModel(model, disabled);
  }, [engine, model, disabled]);

  useEffect(() => engine.connect(), [engine]);

  return engine.navigation;
}

type GridStoreLike = {
  subscribe?: (listener: () => void) => () => void;
  getRowSignature?: (rowId: string) => string;
  getActiveRowId?: () => string | null;
};

const subscribeToNothing = () => () => {};
const getEmptySignature = () => "";
const getNoRowId = () => null;

/**
 * Subscribes a row to the cells it shows: the row renders again only when its
 * active cell, its edited cell or its part of the selected range changes.
 */
export function useGridRowSignature(navigation: GridStoreLike, rowId: string): string {
  const getRowSignature = navigation.getRowSignature;
  return useSyncExternalStore(
    navigation.subscribe ?? subscribeToNothing,
    getRowSignature ? () => getRowSignature(rowId) : getEmptySignature,
    getEmptySignature
  );
}

/** The row of the active cell, for what follows it (breadcrumb, insertion). */
export function useGridActiveRowId(navigation: GridStoreLike): string | null {
  return useSyncExternalStore(
    navigation.subscribe ?? subscribeToNothing,
    navigation.getActiveRowId ?? getNoRowId,
    getNoRowId
  );
}

/**
 * `scrollIntoView` counts a cell lying under the frozen first column as visible:
 * scroll the grid sideways by what the frozen cell still covers.
 */
function revealFromUnderFrozenColumn(node: HTMLElement) {
  const frozen = node.closest('[role="row"]')?.firstElementChild;
  if (!(frozen instanceof HTMLElement) || frozen === node || frozen.contains(node)) return;
  if (getComputedStyle(frozen).position !== "sticky") return;
  const overlap = frozen.getBoundingClientRect().right - node.getBoundingClientRect().left;
  if (overlap <= 0) return;
  let scroller: HTMLElement | null = node.parentElement;
  while (scroller && scroller.scrollWidth <= scroller.clientWidth) scroller = scroller.parentElement;
  if (scroller) scroller.scrollLeft -= overlap;
}
