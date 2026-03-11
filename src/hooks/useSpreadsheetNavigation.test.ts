import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import {
  createSpreadsheetNavigationModel,
  isSpreadsheetCellEditable,
  resolveSpreadsheetKeyCommand,
  resolveSpreadsheetNextCellId,
  resolveSpreadsheetPointerCommand,
  useSpreadsheetNavigation,
} from "@/hooks/useSpreadsheetNavigation";

function NavigationHarness({
  rows,
}: {
  rows: Array<{ rowId: string; columnKeys: string[] }>;
}) {
  const navigation = useSpreadsheetNavigation({ rows });

  return createElement(
    "div",
    null,
    createElement("input", { "data-testid": "outside-editor" }),
    ...rows.map((row) => {
      const cell = { rowId: row.rowId, columnKey: row.columnKeys[0] ?? "title" };
      const cellProps = navigation.getCellProps(cell);
      const editorProps = navigation.getEditorProps<HTMLInputElement>(cell);

      return createElement(
        "div",
        {
          key: row.rowId,
          ...cellProps,
          "data-testid": `cell-${row.rowId}`,
        },
        createElement("input", {
          "data-testid": `editor-${row.rowId}`,
          ref: editorProps.ref,
          tabIndex: editorProps.tabIndex,
          onFocus: editorProps.onFocus,
          onBlur: editorProps.onBlur,
          onKeyDown: editorProps.onKeyDown,
        })
      );
    })
  );
}

describe("useSpreadsheetNavigation helpers", () => {
  it("builds a model with unique non-empty columns only", () => {
    const model = createSpreadsheetNavigationModel([
      { rowId: "row-1", columnKeys: ["title", "", "title", "quantity"] },
      { rowId: "row-2", columnKeys: [] },
    ]);

    expect(model.flatIds).toEqual(["row-1::title", "row-1::quantity"]);
    expect(model.rowOrder).toEqual(["row-1"]);
  });

  it("wraps on Tab and Shift+Tab", () => {
    const model = createSpreadsheetNavigationModel([
      { rowId: "row-1", columnKeys: ["title", "quantity"] },
      { rowId: "row-2", columnKeys: ["title", "quantity"] },
    ]);

    expect(resolveSpreadsheetNextCellId(model, "row-2::quantity", "next")).toBe(
      "row-1::title"
    );
    expect(resolveSpreadsheetNextCellId(model, "row-1::title", "previous")).toBe(
      "row-2::quantity"
    );
  });

  it("moves vertically with wrap and skips rows without the same column", () => {
    const model = createSpreadsheetNavigationModel([
      { rowId: "row-1", columnKeys: ["title", "quantity"] },
      { rowId: "row-2", columnKeys: ["title"] },
      { rowId: "row-3", columnKeys: ["title", "quantity"] },
    ]);

    expect(resolveSpreadsheetNextCellId(model, "row-1::quantity", "down")).toBe(
      "row-3::quantity"
    );
    expect(resolveSpreadsheetNextCellId(model, "row-3::quantity", "down")).toBe(
      "row-1::quantity"
    );
    expect(resolveSpreadsheetNextCellId(model, "row-1::quantity", "up")).toBe(
      "row-3::quantity"
    );
  });

  it("falls back to first cell when current cell is unknown", () => {
    const model = createSpreadsheetNavigationModel([
      { rowId: "row-1", columnKeys: ["title"] },
      { rowId: "row-2", columnKeys: ["title"] },
    ]);

    expect(resolveSpreadsheetNextCellId(model, "missing::cell", "next")).toBe(
      "row-1::title"
    );
  });

  it("returns null when moving in an empty navigation model", () => {
    const model = createSpreadsheetNavigationModel([]);

    expect(resolveSpreadsheetNextCellId(model, "row-1::title", "next")).toBeNull();
  });

  it("keeps same cell when moving vertically in a single-row model", () => {
    const model = createSpreadsheetNavigationModel([
      { rowId: "row-1", columnKeys: ["title", "quantity"] },
    ]);

    expect(resolveSpreadsheetNextCellId(model, "row-1::title", "down")).toBe(
      "row-1::title"
    );
    expect(resolveSpreadsheetNextCellId(model, "row-1::title", "up")).toBe(
      "row-1::title"
    );
  });

  it("keeps stable handlers and API references when rows are unchanged", () => {
    const rows = [{ rowId: "row-1", columnKeys: ["title", "quantity"] }];
    const { result, rerender } = renderHook(() =>
      useSpreadsheetNavigation({
        rows,
      })
    );

    const first = result.current;
    rerender();
    const second = result.current;

    expect(second).toBe(first);
    expect(second.getCellProps).toBe(first.getCellProps);
    expect(second.getEditorProps).toBe(first.getEditorProps);
    expect(second.isCellActive).toBe(first.isCellActive);
    expect(second.isCellEditing).toBe(first.isCellEditing);
  });

  it("does not steal focus from another editor when rows change", async () => {
    const { rerender } = render(
      createElement(NavigationHarness, {
        rows: [{ rowId: "row-1", columnKeys: ["title"] }],
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("cell-row-1")).toHaveFocus();
    });

    const outsideEditor = screen.getByTestId("outside-editor");
    outsideEditor.focus();
    expect(outsideEditor).toHaveFocus();

    rerender(
      createElement(NavigationHarness, {
        rows: [
          { rowId: "row-1", columnKeys: ["title"] },
          { rowId: "row-2", columnKeys: ["title"] },
        ],
      })
    );

    await waitFor(() => {
      expect(outsideEditor).toHaveFocus();
    });
  });

  it("starts editing on single click for editable cell container", () => {
    expect(
      resolveSpreadsheetPointerCommand({
        action: "single-click",
        disabled: false,
        editable: true,
        isCellTarget: true,
      })
    ).toEqual({
      setActive: true,
      startEditing: true,
      selectAll: false,
    });
  });

  it("keeps double-click select-all behavior for editable cells", () => {
    expect(
      resolveSpreadsheetPointerCommand({
        action: "double-click",
        disabled: false,
        editable: true,
        isCellTarget: false,
      })
    ).toEqual({
      setActive: true,
      startEditing: true,
      selectAll: true,
    });
  });

  it("prevents pointer-triggered editing for read-only cells", () => {
    expect(
      resolveSpreadsheetPointerCommand({
        action: "single-click",
        disabled: false,
        editable: false,
        isCellTarget: true,
      })
    ).toEqual({
      setActive: true,
      startEditing: false,
      selectAll: false,
    });
  });

  it("never starts editing when navigation is disabled", () => {
    expect(
      resolveSpreadsheetPointerCommand({
        action: "double-click",
        disabled: true,
        editable: true,
        isCellTarget: true,
      })
    ).toEqual({
      setActive: false,
      startEditing: false,
      selectAll: false,
    });
  });

  it("resolves keyboard navigation commands without regressions", () => {
    expect(
      resolveSpreadsheetKeyCommand({
        key: "Tab",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        fromEditor: false,
        editable: true,
      })
    ).toEqual({ type: "move", direction: "next", blurEditor: false });

    expect(
      resolveSpreadsheetKeyCommand({
        key: "Tab",
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        fromEditor: false,
        editable: true,
      })
    ).toEqual({ type: "move", direction: "previous", blurEditor: false });

    expect(
      resolveSpreadsheetKeyCommand({
        key: "Enter",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        fromEditor: true,
        editable: true,
      })
    ).toEqual({ type: "move", direction: "down", blurEditor: true });

    expect(
      resolveSpreadsheetKeyCommand({
        key: "ArrowLeft",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        fromEditor: true,
        editable: true,
      })
    ).toBeNull();
  });

  it("supports escape in editor mode and ignores unknown keys", () => {
    expect(
      resolveSpreadsheetKeyCommand({
        key: "Escape",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        fromEditor: true,
        editable: true,
      })
    ).toEqual({ type: "escape-editor" });

    expect(
      resolveSpreadsheetKeyCommand({
        key: "Dead",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        fromEditor: false,
        editable: true,
      })
    ).toBeNull();
  });

  it("starts editing with F2 only for editable cells", () => {
    expect(
      resolveSpreadsheetKeyCommand({
        key: "F2",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        fromEditor: false,
        editable: true,
      })
    ).toEqual({ type: "start-editing", selectAll: true });

    expect(
      resolveSpreadsheetKeyCommand({
        key: "F2",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        fromEditor: false,
        editable: false,
      })
    ).toBeNull();
  });

  it("opens edit and replaces value when typing a character on active cell", () => {
    expect(
      resolveSpreadsheetKeyCommand({
        key: "x",
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        fromEditor: false,
        editable: true,
      })
    ).toEqual({ type: "replace-and-edit", value: "x" });

    expect(
      resolveSpreadsheetKeyCommand({
        key: "x",
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        fromEditor: false,
        editable: true,
      })
    ).toBeNull();
  });

  it("supports local undo shortcut in editor mode", () => {
    expect(
      resolveSpreadsheetKeyCommand({
        key: "z",
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        fromEditor: true,
        editable: true,
      })
    ).toEqual({ type: "undo-editor" });

    expect(
      resolveSpreadsheetKeyCommand({
        key: "Z",
        shiftKey: false,
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        fromEditor: true,
        editable: true,
      })
    ).toEqual({ type: "undo-editor" });

    expect(
      resolveSpreadsheetKeyCommand({
        key: "z",
        shiftKey: true,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        fromEditor: true,
        editable: true,
      })
    ).toBeNull();
  });

  it("treats editable option as true by default", () => {
    expect(isSpreadsheetCellEditable()).toBe(true);
    expect(isSpreadsheetCellEditable({ editable: true })).toBe(true);
    expect(isSpreadsheetCellEditable({ editable: false })).toBe(false);
  });
});
