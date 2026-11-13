import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PastePreviewRow } from "@/components/estimates/PastePreviewDialog";
import {
  PASTE_PREVIEW_VIRTUALIZE_FROM_ROWS,
  PastePreviewRowsTable,
  estimatePastePreviewRowHeight,
} from "@/components/estimates/PastePreviewRowsTable";
import type { UseVirtualListOptions } from "@/hooks/useVirtualList";

// The paste preview mounts only a window of rows from 50 rows up. These tests
// drive that window directly (the virtualizer is mocked, as in
// useEstimateDndVirtualization.test.ts): which rows are in the DOM, the spacer
// rows around them, the table semantics a screen reader reads, the focused row
// pin, and the small-paste DOM that legacy-clipboard-parity reads cell by cell.
// The real virtualizer runs in PastePreviewRowsTable.virtual.test.tsx.

const mockUseVirtualList = vi.fn();
vi.mock("@/hooks/useVirtualList", () => ({
  useVirtualList: (input: unknown) => mockUseVirtualList(input),
}));

const HEADER = 97;
const ROW = 64;
const BDC_COLUMNS = ["Désignation", "Quantité", "Unité", "Prix unitaire HT", "Type FO", "K FO", "h/u", "K MO", "Majoration MO (%)"];

type MockItem = { index: number; key: number; start: number; size: number; end: number; lane: number };

function item(index: number): MockItem {
  const start = HEADER + ROW * index;
  return { index, key: index, start, size: ROW, end: start + ROW, lane: 0 };
}

function windowOf(from: number, count: number): MockItem[] {
  return Array.from({ length: count }, (_, offset) => item(from + offset));
}

function makeRows(count: number, overrides: (index: number) => Partial<PastePreviewRow> = () => ({})): PastePreviewRow[] {
  return Array.from({ length: count }, (_, index) => {
    const lineNumber = index + 2;
    return {
      id: `${lineNumber}-${index}`,
      rowNumber: lineNumber,
      include: true,
      values: Object.fromEntries(BDC_COLUMNS.map((column, columnIndex) => [column, `${column} ${lineNumber}:${columnIndex}`])),
      invalidReasons: [],
      ...overrides(index),
    };
  });
}

let virtualState: { isVirtualized: boolean; items: MockItem[]; totalSize?: number };
const remeasure = vi.fn();
const measureElement = vi.fn();
const scrollToIndex = vi.fn();

function lastInput(): UseVirtualListOptions & Record<string, unknown> {
  return mockUseVirtualList.mock.calls.at(-1)![0];
}

function bodyRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"));
}

function describeBody(container: HTMLElement) {
  return bodyRows(container).map((row) => row.getAttribute("aria-hidden") === "true"
    ? `spacer:${row.querySelector("td")!.style.height}`
    : `row:${row.getAttribute("data-index")}`);
}

type TableProps = Parameters<typeof PastePreviewRowsTable>[0];

function renderTable(rows: PastePreviewRow[], props: Partial<TableProps> = {}) {
  const onToggleRow = vi.fn();
  const mapping = props.measurementKey ?? [];
  const tableProps: TableProps = {
    rows,
    sourceColumns: BDC_COLUMNS,
    wideColumns: new Set(["Désignation"]),
    showsInterpretation: false,
    onToggleRow,
    measurementKey: mapping,
    ...props,
  };
  const view = render(
    <div>
      <PastePreviewRowsTable {...tableProps} />
      <button type="button">Après le tableau</button>
    </div>
  );
  return { ...view, onToggleRow, tableProps };
}

beforeEach(() => {
  mockUseVirtualList.mockReset();
  remeasure.mockReset();
  measureElement.mockReset();
  scrollToIndex.mockReset();
  virtualState = { isVirtualized: true, items: windowOf(0, 10) };
  mockUseVirtualList.mockImplementation((input: UseVirtualListOptions) => {
    const isVirtualized = Boolean(input.enabled) && virtualState.isVirtualized;
    return {
      scrollRef: createRef<HTMLDivElement>(),
      isVirtualized,
      virtualItems: isVirtualized ? virtualState.items : [],
      totalSize: isVirtualized ? virtualState.totalSize ?? HEADER + ROW * input.count : 0,
      measureElement,
      remeasure,
      scrollToIndex,
    };
  });
  // The header height becomes the virtualizer's paddingStart.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.tagName === "THEAD" ? HEADER : 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PastePreviewRowsTable", () => {
  it("mounts only the window of a 2,161-row paste and asks for a layout-measured virtualizer", () => {
    const { container } = renderTable(makeRows(2161));
    expect(screen.getAllByTestId("paste-preview-row-include-checkbox")).toHaveLength(10);
    expect(screen.queryByLabelText("Inclure la ligne 1500")).toBeNull();
    expect(screen.getByLabelText("Inclure la ligne 2")).toBeTruthy();
    const input = lastInput();
    expect(input).toMatchObject({ count: 2161, enabled: true, measure: "layout", overscan: 8, paddingStart: HEADER });
    expect((input.initialRect as { height: number }).height).toBe(430);
    expect(container.querySelector("[data-testid=paste-preview-rows-table]")?.hasAttribute("data-virtualized")).toBe(true);
  });

  it("keeps today's DOM below the threshold: one tr per row, source cells from td 2 in mapping order", () => {
    const count = PASTE_PREVIEW_VIRTUALIZE_FROM_ROWS - 1;
    const rows = makeRows(count);
    const { container } = renderTable(rows);
    expect(lastInput().enabled).toBe(false);
    const trs = bodyRows(container);
    expect(trs).toHaveLength(count);
    expect(trs.some((row) => row.hasAttribute("aria-hidden"))).toBe(false);
    trs.forEach((tr, index) => {
      const cells = Array.from(tr.querySelectorAll("td"));
      expect(cells[0].querySelector("input[type=checkbox]")?.getAttribute("aria-label")).toBe(`Inclure la ligne ${index + 2}`);
      expect(cells[1].textContent).toBe(String(index + 2));
      expect(cells.slice(2, 2 + BDC_COLUMNS.length).map((cell) => cell.textContent))
        .toEqual(BDC_COLUMNS.map((column) => rows[index].values[column]));
    });
    expect(container.querySelector("colgroup")).toBeNull();
    expect(container.querySelector("table")?.className).not.toContain("table-fixed");
    const region = container.querySelector("[data-testid=paste-preview-rows-table]")!;
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-labelledby")).toBe("paste-preview-rows-title");
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.className).toContain("table-scroll");
    expect(region.className).toContain("max-h-[430px]");
    expect(region.hasAttribute("data-virtualized")).toBe(false);
    expect(container.querySelector("thead th")?.tagName).toBe("TH");
    expect(trs[0].querySelectorAll("th")).toHaveLength(0);
  });

  it("fills the unmounted rows with aria-hidden spacers, never with an empty one", () => {
    virtualState.items = windowOf(1000, 10);
    const first = renderTable(makeRows(2161));
    const spacers = screen.getAllByTestId("paste-preview-rows-spacer");
    expect(spacers).toHaveLength(2);
    const headerCells = first.container.querySelectorAll("thead th").length;
    for (const spacer of spacers) {
      expect(spacer.getAttribute("aria-hidden")).toBe("true");
      const cells = spacer.querySelectorAll("td");
      expect(cells).toHaveLength(1);
      expect(cells[0].colSpan).toBe(headerCells);
      expect(cells[0].style.padding).toBe("0px");
    }
    const total = HEADER + ROW * 2161;
    expect(describeBody(first.container)).toEqual([
      `spacer:${ROW * 1000}px`,
      ...windowOf(1000, 10).map((entry) => `row:${entry.index}`),
      `spacer:${total - item(1009).end}px`,
    ]);
    first.unmount();

    virtualState.items = windowOf(0, 10);
    virtualState.totalSize = item(9).end;
    const exact = renderTable(makeRows(60));
    expect(screen.queryAllByTestId("paste-preview-rows-spacer")).toHaveLength(0);
    expect(bodyRows(exact.container)).toHaveLength(10);
    exact.unmount();

    virtualState.items = [item(3), ...windowOf(1000, 10)];
    virtualState.totalSize = undefined;
    const pinned = renderTable(makeRows(2161));
    expect(describeBody(pinned.container)).toEqual([
      `spacer:${ROW * 3}px`,
      "row:3",
      `spacer:${item(1000).start - item(3).end}px`,
      ...windowOf(1000, 10).map((entry) => `row:${entry.index}`),
      `spacer:${total - item(1009).end}px`,
    ]);
  });

  it("states the full row count and each mounted row's position", () => {
    virtualState.items = windowOf(1000, 10);
    const { container } = renderTable(makeRows(2161));
    expect(container.querySelector("table")?.getAttribute("aria-rowcount")).toBe("2162");
    expect(container.querySelector("thead tr")?.getAttribute("aria-rowindex")).toBe("1");
    const rows = bodyRows(container).filter((row) => !row.hasAttribute("aria-hidden"));
    expect(rows.map((row) => row.getAttribute("aria-rowindex")))
      .toEqual(Array.from({ length: 10 }, (_, offset) => String(1002 + offset)));
    expect(rows.map((row) => row.getAttribute("data-index")))
      .toEqual(Array.from({ length: 10 }, (_, offset) => String(1000 + offset)));
  });

  it("pins the row that holds focus, and releases it only when focus leaves the rows", () => {
    renderTable(makeRows(2161));
    const getPinnedIndex = lastInput().getPinnedIndex!;
    expect(getPinnedIndex()).toBeNull();
    const checkbox = screen.getByLabelText("Inclure la ligne 5");
    act(() => checkbox.focus());
    expect(getPinnedIndex()).toBe(3);
    // A window blur has no related target: the row keeps its pin.
    fireEvent.focusOut(checkbox, { relatedTarget: null });
    expect(getPinnedIndex()).toBe(3);
    act(() => screen.getByRole("button", { name: "Après le tableau" }).focus());
    expect(getPinnedIndex()).toBeNull();
  });

  it("toggles a row far from the top with its own id", () => {
    virtualState.items = windowOf(1000, 10);
    const rows = makeRows(2161);
    const { onToggleRow } = renderTable(rows);
    fireEvent.click(screen.getByLabelText(`Inclure la ligne ${rows[1000].rowNumber}`));
    expect(onToggleRow).toHaveBeenCalledTimes(1);
    expect(onToggleRow).toHaveBeenCalledWith(rows[1000].id, false);
  });

  it("re-measures the mounted rows after a mapping change, not after a toggle", () => {
    const rows = makeRows(2161);
    const mapping = [{ sourceColumn: "Quantité" }];
    const view = renderTable(rows, { measurementKey: mapping });
    expect(remeasure).not.toHaveBeenCalled();
    const toggled = rows.map((row, index) => (index === 4 ? { ...row, include: false } : row));
    view.rerender(
      <div>
        <PastePreviewRowsTable {...view.tableProps} rows={toggled} measurementKey={mapping} />
      </div>
    );
    expect(remeasure).not.toHaveBeenCalled();
    view.rerender(
      <div>
        <PastePreviewRowsTable {...view.tableProps} rows={toggled} measurementKey={[...mapping]} />
      </div>
    );
    expect(remeasure).toHaveBeenCalledTimes(1);
  });

  it("fixes the column widths only when virtualized, with a wide designation column", () => {
    const rows = makeRows(2161, () => ({ interpretation: [] }));
    const { container } = renderTable(rows, { showsInterpretation: true });
    const table = container.querySelector("table")!;
    expect(table.className).toContain("table-fixed");
    const cols = Array.from(container.querySelectorAll("colgroup col")) as HTMLTableColElement[];
    expect(cols).toHaveLength(2 + BDC_COLUMNS.length + 1 + 2);
    expect(cols).toHaveLength(container.querySelectorAll("thead th").length);
    expect(cols[2].style.width).toBe("20rem");
    expect(cols[3].style.width).toBe("9rem");
    expect(table.style.minWidth).not.toBe("");
  });

  it("keeps the end in view and scrolls to the last row through the virtualizer on End", () => {
    renderTable(makeRows(2161));
    // Rows measured at the end must not push the last row below the fold.
    expect(lastInput()).toMatchObject({ anchorTo: "end" });
    const region = screen.getByTestId("paste-preview-rows-table");
    // fireEvent returns false when the handler prevented the browser's own End.
    expect(fireEvent.keyDown(region, { key: "End" })).toBe(false);
    expect(scrollToIndex).toHaveBeenLastCalledWith(2160);
    expect(fireEvent.keyDown(screen.getByLabelText("Inclure la ligne 3"), { key: "End" })).toBe(false);
    expect(scrollToIndex).toHaveBeenCalledTimes(2);
    // Other keys and modified End stay with the browser.
    expect(fireEvent.keyDown(region, { key: "End", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(region, { key: "End", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(region, { key: "Home" })).toBe(true);
    expect(scrollToIndex).toHaveBeenCalledTimes(2);
  });

  it("leaves End to the browser below the threshold", () => {
    renderTable(makeRows(PASTE_PREVIEW_VIRTUALIZE_FROM_ROWS - 1));
    expect(fireEvent.keyDown(screen.getByTestId("paste-preview-rows-table"), { key: "End" })).toBe(true);
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("estimates a row's height from its data", () => {
    const [row] = makeRows(1);
    // Calibrated in Chrome (see the constants): invalid 77, with a note 68, plain 58.
    expect(estimatePastePreviewRowHeight(row)).toBe(58);
    expect(estimatePastePreviewRowHeight({ ...row, invalidReasons: ["  "] })).toBe(58);
    expect(estimatePastePreviewRowHeight({ ...row, interpretation: [] })).toBe(58);
    expect(estimatePastePreviewRowHeight({ ...row, interpretation: ["Unité ml"] })).toBe(68);
    expect(estimatePastePreviewRowHeight({ ...row, invalidReasons: ["Quantité : Nombre invalide"] })).toBe(77);
    expect(estimatePastePreviewRowHeight({ ...row, invalidReasons: ["Quantité : Nombre invalide"], interpretation: ["Unité ml"] })).toBe(77);
  });

  it("writes each note, reason and test id once", () => {
    const rows = makeRows(2161, (index) => index === 1 ? { invalidReasons: ["Quantité : Nombre invalide", " "] }
      : index === 2 ? { interpretation: ["h/u 1,991"] } : { interpretation: [] });
    const { container } = renderTable(rows, { showsInterpretation: true });
    expect(screen.getAllByTestId("paste-preview-row-invalid-reason")).toHaveLength(1);
    expect(screen.getAllByText("h/u 1,991")).toHaveLength(1);
    expect(screen.getAllByText("Quantité : Nombre invalide")).toHaveLength(1);
    expect(within(container).getAllByTestId("paste-preview-rows-table")).toHaveLength(1);
    expect(container.querySelector("[title]")).toBeNull();
  });
});
