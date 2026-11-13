import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/feedback/toast-provider", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/takeoff/client", async (importActual) => ({
  ...await importActual<typeof import("@/lib/takeoff/client")>(),
  fetchTakeoffRiskRadar: vi.fn(() => new Promise(() => undefined)),
  saveTakeoffReviewDecision: vi.fn(async () => ({})),
}));

import TakeoffDpgfCompareView, { buildManualLinkCandidates } from "@/components/takeoff/TakeoffDpgfCompareView";
import { saveTakeoffReviewDecision } from "@/lib/takeoff/client";
import type { TakeoffDpgfComparisonResponse, TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";
import { beforePassiveEffectsOf } from "@/test/before-passive-effects";

describe("buildManualLinkCandidates", () => {
  it("keeps already matched takeoff items available for manual reassignment", () => {
    const row = {
      line_id: "line-a",
      line_label: "Cloison BA13",
      linked_takeoff_items: [
        {
          item_id: "item-a",
          designation: "Cloison BA13 zone A",
          quantity: 4,
          unit: "m2",
          source_page: 3,
          source_file_name: "plans.pdf",
          confidence: 0.91,
          evidence: "Zone A",
          metadata: {},
        },
      ],
    };
    const rows = [
      {
        ...row,
      },
      {
        line_id: "line-b",
        line_label: "Cloison BA13 reserve",
        linked_takeoff_items: [
          {
            item_id: "item-b",
            designation: "Cloison BA13 zone B",
            quantity: 6,
            unit: "m2",
            source_page: 4,
            source_file_name: "plans.pdf",
            confidence: 0.87,
            evidence: "Zone B",
            metadata: {},
          },
        ],
      },
    ] as const;

    const candidates = buildManualLinkCandidates({
      row: row as never,
      rows: rows as never,
      manualLinkCandidates: [
        {
          item_id: "item-a",
          designation: "Cloison BA13 zone A",
          quantity: 4,
          unit: "m2",
          source_file_name: "plans.pdf",
          source_page: 3,
          confidence_score: 0.91,
          evidence: "Zone A",
        },
        {
          item_id: "item-b",
          designation: "Cloison BA13 zone B",
          quantity: 6,
          unit: "m2",
          source_file_name: "plans.pdf",
          source_page: 4,
          confidence_score: 0.87,
          evidence: "Zone B",
        },
        {
          item_id: "item-c",
          designation: "Cloison BA13 zone C",
          quantity: 2,
          unit: "m2",
          source_file_name: "plans.pdf",
          source_page: 5,
          confidence_score: 0.7,
          evidence: "Zone C",
        },
      ],
    });

    expect(candidates.map((candidate) => candidate.item_id)).toEqual([
      "item-a",
      "item-b",
      "item-c",
    ]);
    expect(candidates[1]).toMatchObject({
      item_id: "item-b",
      linked_line_label: "Cloison BA13 reserve",
      is_current: false,
    });
  });
});

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

function row(lineId: string, label: string, position: number, suggested: TakeoffDpgfComparisonRow["suggested_decision"]): TakeoffDpgfComparisonRow {
  return {
    line_id: lineId, line_label: label,
    dpgf: { estimate_item_id: lineId, title: label, description: null, quantity: 12, unit: "m2", source_page: 1, source_file_name: "dpgf.xlsx", position },
    linked_takeoff_items: [], dpgf_quantity: 12, takeoff_quantity: 12, quantity_unit: "m2", matching_score: 0.98, confidence_score: 0.93,
    review_status: "reliable_match", proofs: [], suggested_decision: suggested, applied_decision: null, delta_absolute: 0, delta_percent: 0,
    is_exception: false, manual_link_count: 0, matched_by: "auto", risk: null,
  };
}
const ROW_A = row("33333333-3333-4333-8333-333333333331", "Cloison BA13", 1, "keep_takeoff");
const ROW_B = row("33333333-3333-4333-8333-333333333332", "Plafond suspendu", 2, "keep_dpgf");
const COMPARISON: TakeoffDpgfComparisonResponse = {
  version_id: VERSION_ID, job_id: JOB_ID, view: "all", threshold: 0.8,
  summary: { reliable_matches: 2, to_confirm: 0, significant_gaps: 0, forced_manual: 0, lines_without_proof: 0, unused_takeoff_items: 0, total_lines: 2 },
  rows: [ROW_A, ROW_B], manual_link_candidates: [], unused_takeoff_items: [], pagination: { page_size: 200, next_cursor: null, total: 2 },
};

/** The comparison as the review page shows it: the view mounts with the answer of its fetch. */
function ArrivingComparison({ arrival }: Readonly<{ arrival: Promise<TakeoffDpgfComparisonResponse> }>) {
  const [data, setData] = useState<TakeoffDpgfComparisonResponse | null>(null);
  useEffect(() => {
    void arrival.then(setData);
  }, [arrival]);
  return data ? <TakeoffDpgfCompareView data={data} currentView="all" onViewChange={() => undefined} onRefresh={() => undefined} /> : null;
}

const decided = (line: TakeoffDpgfComparisonRow, decision: string, reason: string | null = null) =>
  expect(saveTakeoffReviewDecision).toHaveBeenLastCalledWith(JOB_ID, { version_id: VERSION_ID, estimate_item_id: line.line_id, decision, reason });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// TI-719, written before the fix: the decision of the line shown was pre-filled in an effect, which runs after the
// view is shown with its answer. A decision picked in between was replaced by the suggested one, and saved as such.
// beforePassiveEffectsOf replays that ordering on every run.
describe("TakeoffDpgfCompareView, the decision of the line shown (TI-719)", () => {
  it("keeps a decision picked as soon as the comparison is shown instead of the suggested one", async () => {
    let arrive: (data: TakeoffDpgfComparisonResponse) => void = () => undefined;
    const arrival = new Promise<TakeoffDpgfComparisonResponse>((resolve) => { arrive = resolve; });
    render(<ArrivingComparison arrival={arrival} />);

    const picked = beforePassiveEffectsOf(() => screen.queryByRole("button", { name: "Hors périmètre" }) !== null,
      () => fireEvent.click(screen.getByRole("button", { name: "Hors périmètre" })));
    arrive(COMPARISON);
    await picked.done();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));

    await waitFor(() => decided(ROW_A, "out_of_scope"));
  });

  it("pre-fills the suggested decision of each line shown, and forgets what was typed for the previous one", async () => {
    render(<ArrivingComparison arrival={Promise.resolve(COMPARISON)} />);
    fireEvent.click(await screen.findByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => decided(ROW_A, "keep_takeoff"));

    fireEvent.click(screen.getByRole("button", { name: "Corriger manuellement" }));
    fireEvent.change(screen.getByLabelText("Justification humaine"), { target: { value: "Relevé sur site" } });
    fireEvent.click(screen.getByRole("button", { name: /Plafond suspendu/ }));
    expect(screen.getByLabelText("Justification humaine")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => decided(ROW_B, "keep_dpgf"));
  });
});
