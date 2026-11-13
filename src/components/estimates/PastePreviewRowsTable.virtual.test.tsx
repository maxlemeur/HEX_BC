import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PastePreviewRow } from "@/components/estimates/PastePreviewDialog";
import { PastePreviewRowsTable, estimatePastePreviewRowHeight } from "@/components/estimates/PastePreviewRowsTable";

// The real virtualizer behind the paste preview: a 430 px region whose rows
// measure what they are estimated at. jsdom has no layout, so the region
// height and the row height are stubbed; rows are measured from their layout
// box, not their bounding rect.

const COLUMNS = ["Désignation", "Quantité", "Unité"];

function makeRows(count: number): PastePreviewRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${index + 2}-${index}`,
    rowNumber: index + 2,
    include: true,
    values: { Désignation: `Ligne ${index + 2}`, Quantité: String(index + 2), Unité: "u" },
    invalidReasons: [],
  }));
}

const ROW = estimatePastePreviewRowHeight(makeRows(1)[0]);

function mountedRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr:not([aria-hidden])"));
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(430);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(ROW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PastePreviewRowsTable with the real virtualizer", () => {
  it("mounts a bounded window, follows the scroll and keeps the focused row mounted", () => {
    const { container } = render(
      <PastePreviewRowsTable
        rows={makeRows(2161)}
        sourceColumns={COLUMNS}
        wideColumns={new Set(["Désignation"])}
        showsInterpretation={false}
        onToggleRow={vi.fn()}
        measurementKey={[]}
      />
    );
    const firstWindow = mountedRows(container);
    expect(firstWindow.length).toBeGreaterThanOrEqual(1);
    expect(firstWindow.length).toBeLessThanOrEqual(40);

    const focused = screen.getByLabelText("Inclure la ligne 4");
    act(() => focused.focus());
    expect(document.activeElement).toBe(focused);

    const region = screen.getByTestId("paste-preview-rows-table");
    act(() => {
      region.scrollTop = ROW * 1000;
      region.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByLabelText("Inclure la ligne 1002")).toBeTruthy();
    expect(focused.isConnected).toBe(true);
    expect(document.activeElement).toBe(focused);
    const rows = mountedRows(container);
    expect(rows.length).toBeLessThanOrEqual(41);
    const positions = rows.map((row) => Number(row.getAttribute("aria-rowindex")));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(positions[0]).toBe(4);
  });
});

// Rows that measure taller than their estimate, as the faithful OPTIMA rows
// with an interpretation note do in Chrome: 64 px rows against 58 px estimates,
// under a 40 px header, in a 430 px region.
describe("PastePreviewRowsTable when measured rows differ from their estimate", () => {
  const MEASURED = ROW + 6;
  const HEADER = 40;
  const REGION = 430;

  // jsdom's ResizeObserver never calls back. This one delivers border-box
  // entries for every observed element on demand, as a browser does after the
  // layout that follows a scroll; virtual-core measures rows from them even
  // while the list is scrolling.
  const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>();
  class DeliveringResizeObserver {
    private readonly entry: { callback: ResizeObserverCallback; targets: Set<Element> };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: new Set() };
      observers.add(this.entry);
    }
    observe(target: Element) { this.entry.targets.add(target); }
    unobserve(target: Element) { this.entry.targets.delete(target); }
    disconnect() { observers.delete(this.entry); }
  }
  function deliverResize() {
    act(() => {
      for (const { callback, targets } of [...observers]) {
        const entries = [...targets].filter((target) => target.isConnected).map((target) => {
          const blockSize = (target as HTMLElement).offsetHeight;
          return { target, borderBoxSize: [{ blockSize, inlineSize: 0 }] } as unknown as ResizeObserverEntry;
        });
        if (entries.length > 0) callback(entries, {} as ResizeObserver);
      }
    });
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (this.tagName === "TR") return MEASURED;
      if (this.tagName === "THEAD") return HEADER;
      return REGION;
    });
    vi.stubGlobal("ResizeObserver", DeliveringResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    observers.clear();
  });

  function renderTable(measurementKey: unknown = []) {
    const props = {
      rows: makeRows(2161),
      sourceColumns: COLUMNS,
      wideColumns: new Set(["Désignation"]),
      showsInterpretation: false,
      onToggleRow: vi.fn(),
    };
    const view = render(<PastePreviewRowsTable {...props} measurementKey={measurementKey} />);
    const region = screen.getByTestId("paste-preview-rows-table");
    // jsdom has no scrollTo and no scroll height: the virtualizer's scroll
    // writes land on scrollTop, and the scroll height is the DOM's layout, or
    // the virtualizer would hold its corrections as if overscrolled.
    Object.defineProperty(region, "scrollTo", {
      configurable: true,
      value: ({ top }: ScrollToOptions) => { if (typeof top === "number") region.scrollTop = top; },
    });
    Object.defineProperty(region, "scrollHeight", { configurable: true, get: () => layout(view.container).total });
    return { ...view, region, rerenderWith: (key: unknown) => view.rerender(<PastePreviewRowsTable {...props} measurementKey={key} />) };
  }

  function scrollRegion(region: HTMLElement, top: number) {
    act(() => {
      region.scrollTop = top;
      region.dispatchEvent(new Event("scroll"));
    });
    // The rows mounted by the scroll are measured, which can mount more.
    deliverResize();
    deliverResize();
  }

  // The layout the DOM describes: the header, then each spacer at its inline
  // height and each mounted row at its measured height.
  function layout(container: HTMLElement) {
    let y = HEADER;
    const rows: Array<{ index: number; start: number }> = [];
    for (const tr of container.querySelectorAll<HTMLTableRowElement>("tbody > tr")) {
      if (tr.getAttribute("aria-hidden") === "true") {
        y += Number.parseFloat(tr.querySelector("td")?.style.height ?? "0");
        continue;
      }
      rows.push({ index: Number(tr.getAttribute("data-index")), start: y });
      y += MEASURED;
    }
    return { rows, total: y };
  }

  function rowAtTop(container: HTMLElement, region: HTMLElement) {
    const row = layout(container).rows.find((candidate) =>
      region.scrollTop >= candidate.start && region.scrollTop < candidate.start + MEASURED);
    return row ? { index: row.index, within: region.scrollTop - row.start } : null;
  }

  it("keeps the rows in view in place when a mapping change re-measures every row", () => {
    const { container, region, rerenderWith } = renderTable();
    // Scroll down step by step, so the rows above the viewport are all measured.
    for (let top = 300; top <= 6600; top += 300) scrollRegion(region, top);
    const before = rowAtTop(container, region);
    expect(before).not.toBeNull();
    expect(before!.index).toBeGreaterThan(90);

    rerenderWith([]);
    deliverResize();

    expect(rowAtTop(container, region)).toEqual(before);
  });

  it("stays at the end when the rows mounted there measure taller than estimated", () => {
    const { container, region } = renderTable();
    // As End does: to the bottom of what the DOM lays out at that moment.
    scrollRegion(region, region.scrollHeight - REGION);

    const { rows, total } = layout(container);
    expect(rows.at(-1)?.index).toBe(2160);
    expect(region.scrollTop).toBe(total - REGION);
  });
});
