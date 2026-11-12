import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PastePreviewRow } from "@/components/estimates/PastePreviewDialog";
import { PastePreviewRowsTable } from "@/components/estimates/PastePreviewRowsTable";

// The real virtualizer behind the paste preview: a 430 px region with 64 px
// rows. jsdom has no layout, so the region height and the row height are
// stubbed; rows are measured from their layout box, not their bounding rect.

const ROW = 64;
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
