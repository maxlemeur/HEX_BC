import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  createGridModel,
  getGridRangeBounds,
  GRID_RANGE_EDGE_BOTTOM,
  GRID_RANGE_EDGE_LEFT,
  GRID_RANGE_EDGE_RIGHT,
  GRID_RANGE_EDGE_TOP,
  parseGridCellId,
  resolveGridMove,
  toGridCellId,
  useGridNavigation,
  useGridRowSignature,
  type GridNavigationOptions,
  type GridNavigationResult,
  type GridSelection,
} from "@/hooks/useGridNavigation";
import type { SpreadsheetNavigationRow } from "@/hooks/useSpreadsheetNavigation";

const LINE_COLUMNS = ["title", "quantity", "unit", "k_fo", "total"];
const SECTION_COLUMNS = ["title"];
const READ_ONLY_COLUMNS = new Set(["total"]);

function createRows(lineCount = 5): SpreadsheetNavigationRow[] {
  return [
    { rowId: "S", columnKeys: SECTION_COLUMNS },
    ...Array.from({ length: lineCount }, (_, index) => ({
      rowId: `L${index + 1}`,
      columnKeys: LINE_COLUMNS,
    })),
  ];
}

type HarnessProps = {
  rows: SpreadsheetNavigationRow[];
  disabled?: boolean;
  mountedRowIds?: string[];
  onCommit?: (cellId: string, value: string) => void;
  onRowRender?: (rowId: string) => void;
  onNavigation?: (navigation: GridNavigationResult) => void;
  options?: Partial<GridNavigationOptions>;
};

function HarnessCell({
  navigation,
  rowId,
  columnKey,
  onCommit,
}: {
  navigation: GridNavigationResult;
  rowId: string;
  columnKey: string;
  onCommit?: (cellId: string, value: string) => void;
}) {
  const cell = { rowId, columnKey };
  const cellId = toGridCellId(cell);
  const editable = !READ_ONLY_COLUMNS.has(columnKey);
  const [value, setValue] = useState(`${rowId}-${columnKey}`);
  const cellProps = navigation.getCellProps(cell, { editable });
  const editorProps = navigation.getEditorProps<HTMLInputElement>(cell);

  return (
    <div
      {...cellProps}
      data-testid={`cell-${cellId}`}
      data-active={navigation.isCellActive(cell) ? "true" : undefined}
      data-editing={navigation.isCellEditing(cell) ? "true" : undefined}
      data-edges={navigation.getCellRangeEdges(cell)}
    >
      {editable ? (
        <input
          data-testid={`editor-${cellId}`}
          ref={editorProps.ref}
          tabIndex={editorProps.tabIndex}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onFocus={editorProps.onFocus}
          onBlur={(event) => {
            editorProps.onBlur(event);
            onCommit?.(cellId, event.currentTarget.value);
          }}
          onKeyDown={editorProps.onKeyDown}
        />
      ) : (
        <span>{value}</span>
      )}
    </div>
  );
}

function HarnessRow({
  navigation,
  row,
  onCommit,
  onRowRender,
}: {
  navigation: GridNavigationResult;
  row: SpreadsheetNavigationRow;
  onCommit?: (cellId: string, value: string) => void;
  onRowRender?: (rowId: string) => void;
}) {
  useGridRowSignature(navigation, row.rowId);
  onRowRender?.(row.rowId);

  return (
    <div data-testid={`row-${row.rowId}`}>
      {row.columnKeys.map((columnKey) => (
        <HarnessCell
          key={columnKey}
          navigation={navigation}
          rowId={row.rowId}
          columnKey={columnKey}
          onCommit={onCommit}
        />
      ))}
    </div>
  );
}

function Harness({
  rows,
  disabled,
  mountedRowIds,
  onCommit,
  onRowRender,
  onNavigation,
  options,
}: HarnessProps) {
  const navigation = useGridNavigation({ rows, disabled, ...options });
  onNavigation?.(navigation);
  const mounted = mountedRowIds ? new Set(mountedRowIds) : null;

  return (
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      {rows
        .filter((row) => !mounted || mounted.has(row.rowId))
        .map((row) => (
          <HarnessRow
            key={row.rowId}
            navigation={navigation}
            row={row}
            onCommit={onCommit}
            onRowRender={onRowRender}
          />
        ))}
    </div>
  );
}

function cellNode(rowId: string, columnKey: string) {
  return screen.getByTestId(`cell-${rowId}::${columnKey}`);
}

function editorNode(rowId: string, columnKey: string) {
  return screen.getByTestId(`editor-${rowId}::${columnKey}`) as HTMLInputElement;
}

function activeCellId() {
  const nodes = document.querySelectorAll("[data-active='true']");
  expect(nodes.length).toBeLessThanOrEqual(1);
  return nodes[0]?.getAttribute("data-cell-id") ?? null;
}

function selectedCellIds() {
  return Array.from(document.querySelectorAll("[data-cell-id][aria-selected='true']")).map(
    (node) => node.getAttribute("data-cell-id")
  );
}

function focusedCellId() {
  return document.activeElement?.getAttribute("data-cell-id") ?? null;
}

function select(rowId: string, columnKey: string) {
  fireEvent.mouseDown(cellNode(rowId, columnKey), { button: 0 });
}

/** Presses a key on the focused element. Returns false when it was prevented. */
function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement;
  if (!target) throw new Error("No focused element");
  return fireEvent.keyDown(target, { key, ...init });
}

describe("createGridModel", () => {
  it("keeps the rows in order and merges the columns of every row", () => {
    const model = createGridModel([
      { rowId: "S", columnKeys: ["title"] },
      { rowId: "A", columnKeys: ["title", "quantity", "total"] },
      { rowId: "B", columnKeys: ["title", "quantity", "k_fo", "total"] },
    ]);

    expect(model.rowOrder).toEqual(["S", "A", "B"]);
    expect(model.columnOrder).toEqual(["title", "quantity", "k_fo", "total"]);
    expect(model.columnIndex.get("k_fo")).toBe(2);
  });

  it("ignores empty rows, blank keys and duplicate rows", () => {
    const model = createGridModel([
      { rowId: "A", columnKeys: ["title", "", "title", "quantity"] },
      { rowId: "empty", columnKeys: [] },
      { rowId: "A", columnKeys: ["title"] },
    ]);

    expect(model.rowOrder).toEqual(["A"]);
    expect(model.rowColumns[0]).toEqual(["title", "quantity"]);
  });

  it("shares one column list between the rows that received the same array", () => {
    const model = createGridModel(createRows(3));
    expect(model.rowColumns[1]).toBe(model.rowColumns[2]);
    expect(model.rowColumns[2]).toBe(model.rowColumns[3]);
  });
});

describe("cell ids", () => {
  it("round-trips row ids that contain the separator", () => {
    const cell = { rowId: "section::12", columnKey: "title" };
    expect(parseGridCellId(toGridCellId(cell))).toEqual(cell);
    expect(parseGridCellId("no-separator")).toBeNull();
  });
});

describe("resolveGridMove", () => {
  const model = createGridModel(createRows(12));
  const at = (rowId: string, columnKey: string) => ({ rowId, columnKey });

  it("moves one cell and stays put at the edges of the row", () => {
    expect(resolveGridMove(model, at("L3", "quantity"), "right")).toEqual(at("L3", "unit"));
    expect(resolveGridMove(model, at("L3", "quantity"), "left")).toEqual(at("L3", "title"));
    expect(resolveGridMove(model, at("L3", "total"), "right")).toEqual(at("L3", "total"));
    expect(resolveGridMove(model, at("L3", "title"), "left")).toEqual(at("L3", "title"));
  });

  it("moves in the column and skips the rows that do not have it", () => {
    expect(resolveGridMove(model, at("L3", "quantity"), "down")).toEqual(at("L4", "quantity"));
    expect(resolveGridMove(model, at("L3", "quantity"), "up")).toEqual(at("L2", "quantity"));
    // The section above only has a title.
    expect(resolveGridMove(model, at("L1", "quantity"), "up")).toEqual(at("L1", "quantity"));
    expect(resolveGridMove(model, at("L1", "title"), "up")).toEqual(at("S", "title"));
    expect(resolveGridMove(model, at("L12", "quantity"), "down")).toEqual(at("L12", "quantity"));

    const withSection = createGridModel([
      { rowId: "A", columnKeys: LINE_COLUMNS },
      { rowId: "S2", columnKeys: SECTION_COLUMNS },
      { rowId: "B", columnKeys: LINE_COLUMNS },
    ]);
    expect(resolveGridMove(withSection, at("A", "k_fo"), "down")).toEqual(at("B", "k_fo"));
    expect(resolveGridMove(withSection, at("B", "k_fo"), "up")).toEqual(at("A", "k_fo"));
  });

  it("jumps to the ends of the row, of the column and of the grid", () => {
    expect(resolveGridMove(model, at("L3", "unit"), "rowStart")).toEqual(at("L3", "title"));
    expect(resolveGridMove(model, at("L3", "unit"), "rowEnd")).toEqual(at("L3", "total"));
    expect(resolveGridMove(model, at("L5", "quantity"), "edgeDown")).toEqual(at("L12", "quantity"));
    expect(resolveGridMove(model, at("L5", "quantity"), "edgeUp")).toEqual(at("L1", "quantity"));
    expect(resolveGridMove(model, at("L3", "k_fo"), "gridStart")).toEqual(at("S", "title"));
    expect(resolveGridMove(model, at("L3", "k_fo"), "gridEnd")).toEqual(at("L12", "total"));
  });

  it("pages in the column and clamps to the grid", () => {
    expect(resolveGridMove(model, at("L2", "quantity"), "pageDown", 4)).toEqual(at("L6", "quantity"));
    expect(resolveGridMove(model, at("L6", "quantity"), "pageUp", 4)).toEqual(at("L2", "quantity"));
    expect(resolveGridMove(model, at("L10", "quantity"), "pageDown", 4)).toEqual(
      at("L12", "quantity")
    );
    // Clamped on the section row, which has no quantity: nearest line instead.
    expect(resolveGridMove(model, at("L3", "quantity"), "pageUp", 4)).toEqual(at("L1", "quantity"));
  });

  it("wraps Tab to the next row and Shift+Tab to the previous one", () => {
    expect(resolveGridMove(model, at("L3", "total"), "next")).toEqual(at("L4", "title"));
    expect(resolveGridMove(model, at("L3", "title"), "previous")).toEqual(at("L2", "total"));
    expect(resolveGridMove(model, at("L12", "total"), "next")).toEqual(at("L12", "total"));
    expect(resolveGridMove(model, at("S", "title"), "previous")).toEqual(at("S", "title"));
  });

  it("returns null for a cell that is not in the grid", () => {
    expect(resolveGridMove(model, at("ghost", "title"), "down")).toBeNull();
    expect(resolveGridMove(model, at("S", "quantity"), "down")).toBeNull();
  });
});

describe("getGridRangeBounds", () => {
  it("orders the corners whatever the direction of the selection", () => {
    const model = createGridModel(createRows(5));
    expect(
      getGridRangeBounds(
        model,
        { rowId: "L4", columnKey: "k_fo" },
        { rowId: "L2", columnKey: "quantity" }
      )
    ).toEqual({ rowStart: 2, rowEnd: 4, columnStart: 1, columnEnd: 3 });
  });
});

describe("useGridNavigation", () => {
  it("starts on the first cell with a single tab stop", () => {
    render(<Harness rows={createRows()} />);

    expect(activeCellId()).toBe("S::title");
    const tabStops = Array.from(document.querySelectorAll<HTMLElement>("[data-cell-id]")).filter(
      (node) => node.tabIndex === 0
    );
    expect(tabStops.map((node) => node.dataset.cellId)).toEqual(["S::title"]);
  });

  it("selects on a click without opening the editor", () => {
    render(<Harness rows={createRows()} />);

    select("L3", "quantity");

    expect(activeCellId()).toBe("L3::quantity");
    expect(focusedCellId()).toBe("L3::quantity");
    expect(document.activeElement).toBe(cellNode("L3", "quantity"));
    expect(document.querySelector("[data-editing='true']")).toBeNull();
  });

  it("leaves the press to a control inside the cell", () => {
    render(<Harness rows={createRows()} />);
    select("L2", "quantity");

    const notPrevented = fireEvent.mouseDown(editorNode("L3", "quantity"), { button: 0 });
    // The harness editor is a plain text input registered as the cell editor:
    // the cell takes the press and selects, the editor does not open.
    expect(notPrevented).toBe(false);
    expect(activeCellId()).toBe("L3::quantity");
    expect(document.querySelector("[data-editing='true']")).toBeNull();
  });

  it("moves with the arrows and stops at the edges", () => {
    render(<Harness rows={createRows()} />);
    select("L3", "quantity");

    press("ArrowDown");
    expect(activeCellId()).toBe("L4::quantity");
    expect(focusedCellId()).toBe("L4::quantity");
    press("ArrowUp");
    press("ArrowRight");
    expect(activeCellId()).toBe("L3::unit");
    press("ArrowLeft");
    press("ArrowLeft");
    press("ArrowLeft");
    expect(activeCellId()).toBe("L3::title");

    select("L3", "total");
    press("ArrowRight");
    expect(activeCellId()).toBe("L3::total");

    select("L1", "quantity");
    press("ArrowUp");
    expect(activeCellId()).toBe("L1::quantity");
    select("L5", "quantity");
    press("ArrowDown");
    expect(activeCellId()).toBe("L5::quantity");
  });

  it("moves with Tab, Enter, Home, End and the Ctrl jumps", () => {
    render(<Harness rows={createRows()} />);
    select("L3", "quantity");

    expect(press("Tab")).toBe(false);
    expect(activeCellId()).toBe("L3::unit");
    press("Tab", { shiftKey: true });
    expect(activeCellId()).toBe("L3::quantity");

    press("Enter");
    expect(activeCellId()).toBe("L4::quantity");
    press("Enter", { shiftKey: true });
    expect(activeCellId()).toBe("L3::quantity");

    press("End");
    expect(activeCellId()).toBe("L3::total");
    press("Tab");
    expect(activeCellId()).toBe("L4::title");
    press("End");
    press("Home");
    expect(activeCellId()).toBe("L4::title");

    select("L3", "k_fo");
    press("ArrowDown", { ctrlKey: true });
    expect(activeCellId()).toBe("L5::k_fo");
    press("ArrowUp", { ctrlKey: true });
    expect(activeCellId()).toBe("L1::k_fo");
    press("ArrowRight", { ctrlKey: true });
    expect(activeCellId()).toBe("L1::total");
    press("ArrowLeft", { ctrlKey: true });
    expect(activeCellId()).toBe("L1::title");
    press("End", { ctrlKey: true });
    expect(activeCellId()).toBe("L5::total");
    press("Home", { ctrlKey: true });
    expect(activeCellId()).toBe("S::title");
  });

  it("lets Tab leave the grid from its last cell", () => {
    render(<Harness rows={createRows()} />);
    select("L5", "total");

    expect(press("Tab")).toBe(true);
    expect(activeCellId()).toBe("L5::total");
  });

  it("pages by the size given by the editor", () => {
    render(<Harness rows={createRows(12)} options={{ getPageSize: () => 4 }} />);
    select("L2", "quantity");

    press("PageDown");
    expect(activeCellId()).toBe("L6::quantity");
    press("PageUp");
    expect(activeCellId()).toBe("L2::quantity");
  });

  it("extends a range with Shift+arrows and keeps the active cell", () => {
    render(<Harness rows={createRows()} />);
    select("L2", "k_fo");

    press("ArrowDown", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });

    expect(activeCellId()).toBe("L2::k_fo");
    expect(focusedCellId()).toBe("L2::k_fo");
    expect(selectedCellIds()).toEqual(["L2::k_fo", "L3::k_fo", "L4::k_fo"]);
    expect(Number(cellNode("L2", "k_fo").dataset.edges) & GRID_RANGE_EDGE_TOP).toBeTruthy();
    expect(Number(cellNode("L3", "k_fo").dataset.edges) & GRID_RANGE_EDGE_TOP).toBeFalsy();
    expect(Number(cellNode("L4", "k_fo").dataset.edges) & GRID_RANGE_EDGE_BOTTOM).toBeTruthy();
    expect(Number(cellNode("L3", "k_fo").dataset.edges) & GRID_RANGE_EDGE_LEFT).toBeTruthy();
    expect(Number(cellNode("L3", "k_fo").dataset.edges) & GRID_RANGE_EDGE_RIGHT).toBeTruthy();

    press("ArrowUp", { shiftKey: true });
    expect(selectedCellIds()).toEqual(["L2::k_fo", "L3::k_fo"]);

    press("ArrowDown");
    expect(activeCellId()).toBe("L3::k_fo");
    expect(selectedCellIds()).toEqual([]);
  });

  it("collapses the range on Escape and leaves Escape alone otherwise", () => {
    render(<Harness rows={createRows()} />);
    select("L2", "k_fo");

    expect(press("Escape")).toBe(true);
    press("ArrowRight", { shiftKey: true });
    expect(selectedCellIds()).toHaveLength(2);
    expect(press("Escape")).toBe(false);
    expect(selectedCellIds()).toEqual([]);
    expect(activeCellId()).toBe("L2::k_fo");
  });

  it("extends a range with Shift+click and by dragging", () => {
    render(<Harness rows={createRows()} />);
    select("L2", "quantity");

    fireEvent.mouseDown(cellNode("L5", "unit"), { button: 0, shiftKey: true });
    expect(activeCellId()).toBe("L2::quantity");
    expect(focusedCellId()).toBe("L2::quantity");
    expect(selectedCellIds()).toHaveLength(8);

    select("L2", "quantity");
    expect(selectedCellIds()).toEqual([]);
    fireEvent.mouseEnter(cellNode("L3", "quantity"), { buttons: 1 });
    fireEvent.mouseEnter(cellNode("L4", "quantity"), { buttons: 1 });
    expect(selectedCellIds()).toEqual(["L2::quantity", "L3::quantity", "L4::quantity"]);

    fireEvent.mouseUp(window);
    fireEvent.mouseEnter(cellNode("L5", "quantity"), { buttons: 1 });
    expect(selectedCellIds()).toHaveLength(3);
  });

  it("leaves Shift+click to the row selection when the editor says so", () => {
    render(<Harness rows={createRows()} options={{ shouldExtendOnShiftClick: () => false }} />);
    select("L2", "quantity");

    const notPrevented = fireEvent.mouseDown(cellNode("L4", "quantity"), {
      button: 0,
      shiftKey: true,
    });
    expect(notPrevented).toBe(true);
    expect(selectedCellIds()).toEqual([]);
  });

  it("leaves Ctrl+click to the row selection", () => {
    render(<Harness rows={createRows()} />);
    select("L2", "quantity");

    const notPrevented = fireEvent.mouseDown(cellNode("L4", "quantity"), {
      button: 0,
      ctrlKey: true,
    });
    expect(notPrevented).toBe(true);
    expect(activeCellId()).toBe("L2::quantity");
  });

  it("opens the editor with its text selected when a character is typed", () => {
    render(<Harness rows={createRows()} />);
    select("L3", "quantity");

    // Not prevented: the browser types the character over the selection.
    expect(press("7")).toBe(true);

    const editor = editorNode("L3", "quantity");
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe(editor.value.length);
    expect(cellNode("L3", "quantity").dataset.editing).toBe("true");
  });

  it("commits and moves down on Enter from the editor", () => {
    const onCommit = vi.fn();
    render(<Harness rows={createRows()} onCommit={onCommit} />);
    select("L3", "quantity");
    press("7");
    fireEvent.change(editorNode("L3", "quantity"), { target: { value: "77" } });

    expect(press("Enter")).toBe(false);

    expect(onCommit).toHaveBeenCalledWith("L3::quantity", "77");
    expect(activeCellId()).toBe("L4::quantity");
    expect(document.activeElement).toBe(cellNode("L4", "quantity"));
    expect(document.querySelector("[data-editing='true']")).toBeNull();
  });

  it("commits and moves with Tab and with the arrows after typing", () => {
    const onCommit = vi.fn();
    render(<Harness rows={createRows()} onCommit={onCommit} />);

    select("L3", "quantity");
    press("5");
    fireEvent.change(editorNode("L3", "quantity"), { target: { value: "55" } });
    press("Tab");
    expect(onCommit).toHaveBeenLastCalledWith("L3::quantity", "55");
    expect(activeCellId()).toBe("L3::unit");

    select("L4", "quantity");
    press("4");
    fireEvent.change(editorNode("L4", "quantity"), { target: { value: "44" } });
    expect(press("ArrowRight")).toBe(false);
    expect(onCommit).toHaveBeenLastCalledWith("L4::quantity", "44");
    expect(activeCellId()).toBe("L4::unit");
    expect(document.activeElement).toBe(cellNode("L4", "unit"));
  });

  it("keeps the arrows for the caret after F2 or a double-click", () => {
    render(<Harness rows={createRows()} />);
    select("L3", "quantity");

    expect(press("F2")).toBe(false);
    const editor = editorNode("L3", "quantity");
    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(editor.value.length);
    expect(press("ArrowLeft")).toBe(true);
    expect(press("ArrowRight")).toBe(true);
    expect(activeCellId()).toBe("L3::quantity");
    expect(cellNode("L3", "quantity").dataset.editing).toBe("true");

    select("L4", "unit");
    fireEvent.doubleClick(cellNode("L4", "unit"));
    expect(document.activeElement).toBe(editorNode("L4", "unit"));
    expect(press("ArrowLeft")).toBe(true);
    expect(cellNode("L4", "unit").dataset.editing).toBe("true");
  });

  it("restores the value and returns to the cell on Escape", () => {
    render(<Harness rows={createRows()} />);
    select("L3", "quantity");
    press("9");
    const editor = editorNode("L3", "quantity");
    fireEvent.change(editor, { target: { value: "99" } });

    expect(press("Escape")).toBe(false);

    expect(editor.value).toBe("L3-quantity");
    expect(document.activeElement).toBe(cellNode("L3", "quantity"));
    expect(activeCellId()).toBe("L3::quantity");
    expect(document.querySelector("[data-editing='true']")).toBeNull();
  });

  it("undoes the typing in the editor before leaving Ctrl+Z to the page", () => {
    render(<Harness rows={createRows()} />);
    select("L3", "quantity");
    press("F2");
    const editor = editorNode("L3", "quantity");
    fireEvent.change(editor, { target: { value: "changed" } });

    expect(press("z", { ctrlKey: true })).toBe(false);
    expect(editor.value).toBe("L3-quantity");
    expect(press("z", { ctrlKey: true })).toBe(true);
  });

  it("does not edit a computed cell", () => {
    render(<Harness rows={createRows()} />);
    select("L3", "total");

    press("7");
    press("F2");
    fireEvent.doubleClick(cellNode("L3", "total"));

    expect(document.activeElement).toBe(cellNode("L3", "total"));
    expect(document.querySelector("[data-editing='true']")).toBeNull();
  });

  it("hands Delete and Ctrl+D to the editor with the selection", () => {
    const cleared: GridSelection[] = [];
    const filled: GridSelection[] = [];
    render(
      <Harness
        rows={createRows()}
        options={{
          onClearSelection: (selection) => {
            cleared.push(selection);
          },
          onFillDown: (selection) => {
            filled.push(selection);
          },
        }}
      />
    );
    select("L2", "unit");
    press("ArrowDown", { shiftKey: true });
    press("ArrowRight", { shiftKey: true });

    expect(press("Delete")).toBe(false);
    expect(press("d", { ctrlKey: true })).toBe(false);

    const expected: GridSelection = {
      active: { rowId: "L2", columnKey: "unit" },
      isRange: true,
      columnKeys: ["unit", "k_fo"],
      rows: [
        { rowId: "L2", columnKeys: ["unit", "k_fo"] },
        { rowId: "L3", columnKeys: ["unit", "k_fo"] },
      ],
    };
    expect(cleared).toEqual([expected]);
    expect(filled).toEqual([expected]);
  });

  it("leaves Delete to the page when the editor declines it", () => {
    render(<Harness rows={createRows()} options={{ onClearSelection: () => false }} />);
    select("L2", "unit");

    expect(press("Delete")).toBe(true);
  });

  it("renders again only the rows a move touches", () => {
    const renders = new Map<string, number>();
    const onRowRender = (rowId: string) => renders.set(rowId, (renders.get(rowId) ?? 0) + 1);
    render(<Harness rows={createRows()} onRowRender={onRowRender} />);
    select("L2", "quantity");
    renders.clear();

    press("ArrowDown");

    expect(Array.from(renders.keys()).sort()).toEqual(["L2", "L3"]);

    renders.clear();
    press("ArrowRight");
    expect(Array.from(renders.keys())).toEqual(["L3"]);

    renders.clear();
    press("ArrowDown", { shiftKey: true });
    expect(Array.from(renders.keys()).sort()).toEqual(["L3", "L4"]);
  });

  it("hands the same navigation object to every render", () => {
    const seen = new Set<GridNavigationResult>();
    const { rerender } = render(
      <Harness rows={createRows()} onNavigation={(navigation) => seen.add(navigation)} />
    );
    select("L2", "quantity");
    press("ArrowDown");
    rerender(<Harness rows={createRows(3)} onNavigation={(navigation) => seen.add(navigation)} />);

    expect(seen.size).toBe(1);
  });

  it("stays at the same place when the active row is removed", () => {
    const rows = createRows();
    const { rerender } = render(<Harness rows={rows} />);
    select("L3", "k_fo");

    rerender(<Harness rows={rows.filter((row) => row.rowId !== "L3")} />);
    expect(activeCellId()).toBe("L4::k_fo");

    rerender(<Harness rows={rows.filter((row) => row.rowId !== "L3" && row.rowId !== "L5")} />);
    expect(activeCellId()).toBe("L4::k_fo");
    rerender(<Harness rows={rows.slice(0, 3)} />);
    expect(activeCellId()).toBe("L2::k_fo");
  });

  it("has no active cell while disabled", () => {
    const rows = createRows();
    const { rerender } = render(<Harness rows={rows} disabled />);

    expect(activeCellId()).toBeNull();
    expect(document.querySelector("[data-cell-id][tabindex='0']")).toBeNull();
    fireEvent.mouseDown(cellNode("L2", "quantity"), { button: 0 });
    expect(activeCellId()).toBeNull();

    rerender(<Harness rows={rows} />);
    expect(activeCellId()).toBe("S::title");
  });

  it("asks for a row that is not rendered and focuses it when it arrives", async () => {
    const rows = createRows(12);
    const onActiveCellNotMounted = vi.fn();
    const { rerender } = render(
      <Harness
        rows={rows}
        mountedRowIds={["S", "L1", "L2", "L3"]}
        options={{ onActiveCellNotMounted }}
      />
    );
    select("L2", "quantity");

    press("ArrowDown", { ctrlKey: true });
    expect(onActiveCellNotMounted).toHaveBeenCalledWith({ rowId: "L12", columnKey: "quantity" });

    rerender(
      <Harness
        rows={rows}
        mountedRowIds={["L10", "L11", "L12"]}
        options={{ onActiveCellNotMounted }}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(activeCellId()).toBe("L12::quantity");
    expect(document.activeElement).toBe(cellNode("L12", "quantity"));
  });

  it("follows the focus when an editor is focused directly", () => {
    render(<Harness rows={createRows()} />);
    select("L2", "quantity");

    act(() => {
      editorNode("L4", "unit").focus();
    });

    expect(activeCellId()).toBe("L4::unit");
    expect(cellNode("L4", "unit").dataset.editing).toBe("true");

    act(() => {
      (screen.getByTestId("outside") as HTMLButtonElement).focus();
    });
    expect(document.querySelector("[data-editing='true']")).toBeNull();
    expect(activeCellId()).toBe("L4::unit");
  });

  it("selects and edits through the navigation object", () => {
    let navigation: GridNavigationResult | null = null;
    render(
      <Harness
        rows={createRows()}
        onNavigation={(value) => {
          navigation = value;
        }}
      />
    );

    act(() => {
      navigation?.selectCell({ rowId: "L3", columnKey: "unit" });
    });
    expect(activeCellId()).toBe("L3::unit");
    expect(document.activeElement).toBe(cellNode("L3", "unit"));

    let started = false;
    act(() => {
      started = navigation?.startEditing({ rowId: "L4", columnKey: "quantity" }) ?? false;
    });
    expect(started).toBe(true);
    expect(document.activeElement).toBe(editorNode("L4", "quantity"));
    expect(navigation!.getActiveRowId()).toBe("L4");
  });
});
