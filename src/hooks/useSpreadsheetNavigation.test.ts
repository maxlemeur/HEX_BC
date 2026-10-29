import {
fireEvent,
render,
screen,
waitFor,
} from "@testing-library/react";
import { createElement, type FocusEvent } from "react";
import { describe,expect,it } from "vitest";

import { EstimateLineNatureSelect } from "@/components/estimates/components/estimate-editor-row/EstimateLineNatureSelect";
import type { EstimateItem } from "@/components/estimates/components/estimate-editor-row/shared";
import {
createSpreadsheetNavigationModel,
resolveSpreadsheetNextCellId,
useSpreadsheetNavigation
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

// V3E01 (docs/testing/v3e01-labour-role-lost.md). A deferred render can commit
// a new navigation model whose focus effect runs while the active cell's editor
// already has focus but its editing state has not rendered yet. This editor is
// registered as the cell's editor and does not report its focus, which holds
// that state long enough to rebuild the rows.
function PendingEditorFocusHarness({
  rows,
}: {
  rows: Array<{ rowId: string; columnKeys: string[] }>;
}) {
  const navigation = useSpreadsheetNavigation({ rows });

  return createElement(
    "div",
    null,
    ...rows.map((row) => {
      const cell = { rowId: row.rowId, columnKey: row.columnKeys[0] ?? "labor_role" };
      const editorProps = navigation.getEditorProps<HTMLInputElement>(cell);

      return createElement(
        "div",
        {
          key: row.rowId,
          ...navigation.getCellProps(cell),
          "data-testid": `cell-${row.rowId}`,
        },
        createElement("input", {
          "data-testid": `editor-${row.rowId}`,
          ref: editorProps.ref,
          tabIndex: editorProps.tabIndex,
          onFocus: (event: FocusEvent<HTMLInputElement>) => event.stopPropagation(),
        })
      );
    })
  );
}

function LineNatureNavigationHarness() {
  const cell = { rowId: "line-1", columnKey: "title" };
  const navigation = useSpreadsheetNavigation({
    rows: [{ rowId: cell.rowId, columnKeys: [cell.columnKey] }],
  });
  const cellProps = navigation.getCellProps(cell);
  const editorProps = navigation.getEditorProps<HTMLInputElement>(cell);
  const item = {
    id: cell.rowId,
    title: "Tuyau DN 100 acier",
    line_nature: "supply_only",
  } as EstimateItem;

  return createElement(
    "div",
    {
      ...cellProps,
      "data-testid": "line-title-cell",
    },
    createElement("input", {
      "data-testid": "line-title-editor",
      value: item.title,
      readOnly: true,
      ref: editorProps.ref,
      tabIndex: editorProps.tabIndex,
      onFocus: editorProps.onFocus,
      onBlur: editorProps.onBlur,
      onKeyDown: editorProps.onKeyDown,
    }),
    createElement(EstimateLineNatureSelect, {
      item,
      isReadOnly: false,
      onPatchItem: () => undefined,
    }),
  );
}

describe("useSpreadsheetNavigation helpers", () => {

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

  it("keeps focus on the active cell's editor when a pending render rebuilds the rows (V3E01)", async () => {
    const rows = [{ rowId: "row-1", columnKeys: ["labor_role"] }];
    const { rerender } = render(createElement(PendingEditorFocusHarness, { rows }));

    await waitFor(() => {
      expect(screen.getByTestId("cell-row-1")).toHaveFocus();
    });

    const editor = screen.getByTestId("editor-row-1");
    editor.focus();
    expect(editor).toHaveFocus();

    // Same rows, new array: the deferred quality render rebuilds the model.
    rerender(createElement(PendingEditorFocusHarness, { rows: [...rows] }));

    expect(editor).toHaveFocus();
  });

  it("keeps F2 bound to the free-text designation after using line nature", async () => {
    render(createElement(LineNatureNavigationHarness));

    const titleCell = screen.getByTestId("line-title-cell");
    const titleEditor = screen.getByTestId("line-title-editor");
    const natureSelect = screen.getByRole("combobox", {
      name: "Fournitures — nature de ligne pour Tuyau DN 100 acier",
    });

    titleCell.focus();
    expect(titleCell).toHaveFocus();
    natureSelect.focus();
    expect(natureSelect).toHaveFocus();

    titleCell.focus();
    fireEvent.keyDown(titleCell, { key: "F2" });

    expect(titleEditor).toHaveFocus();
    expect(natureSelect).not.toHaveFocus();
  });
});
