import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import TakeoffReviewTable from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

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

// D13, the « Avec anomalies » filter of the review grid against the apply guard. Ways it fails, written before the fix:
// - a line a failed rule blocks (confidence high, proof present) is missing from « Avec anomalies »: the filter ignores
//   the rules the application and the targeted review stop it on;
// - the low confidence is read at a fixed 0,5 instead of the tenant's threshold: a line the guard blocks at 0,6 under
//   a 0,7 threshold is « sans anomalie », and a line at 0,4 the guard lets through under a 0,3 threshold is flagged.

const DN_FAILURE = { rule: "dn_network", status: "fail", code: "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION", version: 2,
  acceptable: true, reason: "Gamme eau potable et pose intérieure à justifier." } as TakeoffRuleResult;

let nextLine = 0;
function reviewLine(designation: string, overrides: Partial<ReviewItem> = {}): ReviewItem {
  nextLine += 1;
  return { ...ITEM, id: `22222222-2222-4222-8222-${String(nextLine).padStart(12, "0")}`, designation, ...overrides };
}

function renderFiltered(items: ReviewItem[], guard: { confidenceThreshold: number; jobLevel: string }, anomaly: string) {
  render(<TakeoffReviewTable items={items} onUpdateItem={vi.fn()} onExcludeItems={vi.fn()} onIncludeItems={vi.fn()} {...guard} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Anomalies" }), { target: { value: anomaly } });
  return (designation: string) => screen.queryByRole("checkbox", { name: `Sélectionner ${designation}` }) !== null;
}

describe("TakeoffReviewTable anomaly filter", () => {
  it("lists under « Avec anomalies » a line a failed rule blocks, and only there", () => {
    const blocked = reviewLine("EF PEHD DN 32", { confidence: 0.95, rule_results: [DN_FAILURE] });
    const clean = reviewLine("EF cuivre DN 22", { confidence: 0.95 });
    const guard = { confidenceThreshold: 0.5, jobLevel: "B" };

    const withAnomalies = renderFiltered([blocked, clean], guard, "with_anomalies");
    expect(withAnomalies(blocked.designation)).toBe(true);
    expect(withAnomalies(clean.designation)).toBe(false);
    expect(screen.getByRole("button", { name: `1 anomalie pour ${blocked.designation} : voir le détail` })).toBeTruthy();
    cleanup();

    const withoutAnomalies = renderFiltered([blocked, clean], guard, "without_anomalies");
    expect(withoutAnomalies(blocked.designation)).toBe(false);
    expect(withoutAnomalies(clean.designation)).toBe(true);
  });

  it("reads a low confidence at the tenant's threshold, as the apply guard does", () => {
    const belowTenant = reviewLine("EF cuivre DN 28", { confidence: 0.6 });
    expect(renderFiltered([belowTenant], { confidenceThreshold: 0.7, jobLevel: "C" }, "with_anomalies")(belowTenant.designation))
      .toBe(true);
    cleanup();

    const aboveTenant = reviewLine("EF cuivre DN 35", { confidence: 0.4 });
    expect(renderFiltered([aboveTenant], { confidenceThreshold: 0.3, jobLevel: "C" }, "without_anomalies")(aboveTenant.designation))
      .toBe(true);
  });

  it("keeps a line whose rules are to compute again under « Avec anomalies »", () => {
    const stale = reviewLine("EF cuivre DN 42", { rules_stale: true });
    expect(renderFiltered([stale], { confidenceThreshold: 0.5, jobLevel: "B" }, "with_anomalies")(stale.designation)).toBe(true);
  });
});
