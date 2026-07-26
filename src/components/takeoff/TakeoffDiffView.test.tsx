import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import TakeoffDiffView from "@/components/takeoff/TakeoffDiffView";
import type { TakeoffJobCompareResponse, TakeoffJobItem } from "@/lib/takeoff/types";

function makeItem(id: string, designation: string, sourcePage = 1): TakeoffJobItem {
  return {
    id,
    designation,
    quantity: 1,
    unit: "u",
    confidence: 0.9,
    evidence: null,
    source_file_name: "plan-a.pdf",
    source_page: sourcePage,
    metadata: {},
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-02-25T10:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
  };
}

function buildCompareResponse(): TakeoffJobCompareResponse {
  const base1 = makeItem("b-1", "Cable U1000", 3);
  const base2 = makeItem("b-2", "Tube PVC", 5);
  const other1 = makeItem("o-1", "Cable U1000", 3);
  const other2 = makeItem("o-2", "Tube PVC Orange", 5);
  const other3 = makeItem("o-3", "Vis autoforeuse", 7);

  return {
    base_job_id: "11111111-1111-4111-8111-111111111111",
    other_job_id: "22222222-2222-4222-8222-222222222222",
    threshold: 0.8,
    summary: {
      added: 1,
      removed: 0,
      changed: 1,
      unchanged: 1,
      total_base: 2,
      total_other: 3,
    },
    added: [
      {
        key: "added:o-3",
        change_type: "added",
        other_item: other3,
      },
    ],
    removed: [],
    changed: [
      {
        key: "changed:b-2:o-2",
        change_type: "changed",
        base_item: base2,
        other_item: other2,
        match_score: 0.91,
        match_strategy: "designation_fuzzy",
        delta: [
          {
            field: "designation",
            label: "Désignation",
            kind: "text",
            before_value: "Tube PVC",
            after_value: "Tube PVC Orange",
          },
        ],
      },
    ],
    unchanged: [
      {
        key: "unchanged:b-1:o-1",
        change_type: "unchanged",
        base_item: base1,
        other_item: other1,
        match_score: 1,
        match_strategy: "designation_fuzzy",
      },
    ],
  };
}

describe("TakeoffDiffView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders summary and supports filtering", () => {
    render(
      <TakeoffDiffView
        compare={buildCompareResponse()}
        onApplySelection={() => {
          // no-op
        }}
      />
    );

    expect(screen.getByText("Resume des changements")).toBeDefined();
    expect(screen.getByText("Ajouts")).toBeDefined();
    expect(screen.getByText("Modifications")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Filtre"), {
      target: { value: "added" },
    });

    expect(screen.getAllByText("Vis autoforeuse").length).toBeGreaterThan(0);
  });

  it("toggles mode and applies selected items", () => {
    const onApplySelection = vi.fn();

    render(
      <TakeoffDiffView
        compare={buildCompareResponse()}
        onApplySelection={onApplySelection}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Cote a cote" })[0]);
    expect(screen.getAllByText("Extraction de comparaison").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Appliquer la selection" }));

    expect(onApplySelection).toHaveBeenCalledTimes(1);
    const selectedIds = onApplySelection.mock.calls[0]?.[0] as string[];
    expect(selectedIds).toContain("b-1");
    expect(selectedIds).toContain("b-2");
  });
});
