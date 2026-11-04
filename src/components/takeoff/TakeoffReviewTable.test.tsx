import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import TakeoffReviewTable from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

// TI-664 L5c, the row shortcuts of the review grid (E exclude, V verify, P proof) against direct entry in its cells.
// Ways it fails, written before the fix:
// - E on a focused designation cell both types « e » into the cell (direct entry) and opens the exclusion: the
//   designation becomes « e » and the line is excluded;
// - V on a focused cell types « v » and verifies the line;
// - a letter typed in a cell already being edited excludes or verifies the line;
// - a digit on the quantity cell is taken as a shortcut instead of starting its entry.

const ITEM: ReviewItem = {
  id: "11111111-1111-4111-8111-111111111111",
  designation: "EF Inox 316L DN 22",
  quantity: 5,
  unit: "ml",
  confidence: 0.9,
  evidence: "Plan R+1 Z1",
  source_file_name: "plan-zones-R+1-Z1.pdf",
  source_page: 1,
  metadata: {},
  is_excluded: false,
  exclusion_reason: null,
  is_verified: false,
  verified_at: null,
  verified_by: null,
  created_at: "2026-11-04T10:00:00.000Z",
  updated_at: "2026-11-04T10:00:00.000Z",
  _dirty: false,
  _saving: false,
  _error: null,
};

function renderTable() {
  const handlers = { onUpdateItem: vi.fn(), onExcludeItems: vi.fn(), onIncludeItems: vi.fn(), onOpenEvidencePanel: vi.fn() };
  const view = render(<TakeoffReviewTable items={[ITEM]} {...handlers} />);
  const cell = (column: string) => view.container.querySelector<HTMLElement>(`[data-cell-column-key="${column}"]`)!;
  return { ...handlers, cell };
}

afterEach(() => cleanup());

describe("TakeoffReviewTable row shortcuts", () => {
  it("E on a focused cell excludes the line without typing into it", () => {
    const table = renderTable();
    const designation = table.cell("designation");
    act(() => designation.focus());
    fireEvent.keyDown(designation, { key: "e" });

    expect(table.onExcludeItems).toHaveBeenCalledTimes(1);
    expect(table.onExcludeItems).toHaveBeenCalledWith([ITEM.id]);
    expect(table.onUpdateItem).not.toHaveBeenCalled();
  });

  it("V on a focused cell verifies the line without typing into it", () => {
    const table = renderTable();
    const designation = table.cell("designation");
    act(() => designation.focus());
    fireEvent.keyDown(designation, { key: "V" });

    expect(table.onUpdateItem).toHaveBeenCalledTimes(1);
    expect(table.onUpdateItem).toHaveBeenCalledWith(ITEM.id, "is_verified", true);
  });

  it("a letter typed while a cell is edited stays in the cell", () => {
    const table = renderTable();
    const designation = table.cell("designation");
    act(() => designation.focus());
    fireEvent.keyDown(designation, { key: "F2" });
    const editor = designation.querySelector("input")!;
    expect(document.activeElement).toBe(editor);
    fireEvent.keyDown(editor, { key: "e" });

    expect(table.onExcludeItems).not.toHaveBeenCalled();
    expect(table.onUpdateItem).not.toHaveBeenCalledWith(ITEM.id, "is_verified", expect.anything());
  });

  it("a digit on the quantity cell starts its direct entry", () => {
    const table = renderTable();
    const quantity = table.cell("quantity");
    act(() => quantity.focus());
    fireEvent.keyDown(quantity, { key: "4" });

    expect(table.onExcludeItems).not.toHaveBeenCalled();
    expect(table.onUpdateItem).toHaveBeenCalledWith(ITEM.id, "quantity", 4);
  });
});
