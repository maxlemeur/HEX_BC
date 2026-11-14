import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("@/components/feedback/toast-provider", () => ({ useToast: () => toast }));
vi.mock("@/lib/takeoff/client", async (importActual) => ({
  ...await importActual<typeof import("@/lib/takeoff/client")>(),
  fetchTakeoffRiskRadar: vi.fn(() => new Promise(() => undefined)),
  saveTakeoffReviewDecision: vi.fn(async () => ({})),
}));

import TakeoffDpgfCompareView, { buildManualLinkCandidates } from "@/components/takeoff/TakeoffDpgfCompareView";
import { fetchTakeoffRiskRadar, saveTakeoffReviewDecision, type TakeoffRiskRadarResponse } from "@/lib/takeoff/client";
import type {
  TakeoffDpgfComparisonResponse, TakeoffDpgfComparisonRow, TakeoffDpgfComparisonView, TakeoffDpgfReviewDecision,
} from "@/lib/takeoff/types";
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
  vi.mocked(fetchTakeoffRiskRadar).mockImplementation(() => new Promise(() => undefined));
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

const applied = (line: TakeoffDpgfComparisonRow, decision: TakeoffDpgfReviewDecision, reason: string): TakeoffDpgfComparisonRow => ({
  ...line,
  applied_decision: {
    id: "44444444-4444-4444-8444-444444444444", tenant_id: "55555555-5555-4555-8555-555555555555", version_id: VERSION_ID,
    takeoff_job_id: JOB_ID, estimate_item_id: line.line_id, decision, reason, review_reference: `dpgf.xlsx row ${line.dpgf.position}`,
    line_label: line.line_label, line_position: line.dpgf.position, source_file_name: "dpgf.xlsx", source_page: 1,
    decided_at: "2026-11-13T10:00:00.000Z", updated_at: "2026-11-13T10:00:00.000Z", decided_by: null, quantity_snapshot: null,
    source: "current_version", carried_over_from_version_id: null, carried_over_from_version_number: null,
  },
});
/** The comparison as a refresh brings it back: new objects, the same lines unless `rows` says otherwise. */
const readAgain = (rows: TakeoffDpgfComparisonRow[] = COMPARISON.rows): TakeoffDpgfComparisonResponse => ({
  ...COMPARISON, rows: rows.map((line) => ({ ...line })), pagination: { ...COMPARISON.pagination, total: rows.length },
});
const view = (data: TakeoffDpgfComparisonResponse, currentView: TakeoffDpgfComparisonView = "all") => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <TakeoffDpgfCompareView data={data} currentView={currentView} onViewChange={() => undefined} onRefresh={() => undefined} />
  </SWRConfig>
);
const shownLine = () => within(screen.getByRole("complementary")).getByRole("heading", { level: 3 });
const typeOnPlafond = () => {
  fireEvent.click(screen.getByRole("button", { name: /Plafond suspendu/ }));
  fireEvent.click(screen.getByRole("button", { name: "Corriger manuellement" }));
  fireEvent.change(screen.getByLabelText("Justification humaine"), { target: { value: "Relevé sur site" } });
};

// TI-721, written before the fix: what a reviewer types for the line shown was replaced by the line's values each time
// the comparison was read again (a new row object), and by the first line when the risk radar opened an unlisted line.
describe("TakeoffDpgfCompareView, the decision being typed (TI-721)", () => {
  it("keeps the decision being typed when the comparison is read again, and shows the decision the line has now", async () => {
    const { rerender } = render(view(COMPARISON));
    typeOnPlafond();

    rerender(view(readAgain([ROW_A, applied(ROW_B, "keep_dpgf", "Validé par le bureau d'études")])));

    expect(shownLine()).toHaveTextContent("Plafond suspendu");
    expect(screen.getByLabelText("Justification humaine")).toHaveValue("Relevé sur site");
    const refreshed = screen.getByRole("status", { name: "Ligne actualisée pendant votre saisie" });
    expect(refreshed).toHaveTextContent("Décision appliquée : Garder DPGF — « Validé par le bureau d'études »");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => decided(ROW_B, "manual_fix", "Relevé sur site"));
    // Saved, the decision typed is the line's own: nothing is left to compare it with.
    await waitFor(() => expect(screen.queryByRole("status", { name: "Ligne actualisée pendant votre saisie" })).toBeNull());
  });

  it("lets the reviewer take the decision the line read again holds instead of the one typed", async () => {
    const { rerender } = render(view(COMPARISON));
    typeOnPlafond();
    rerender(view(readAgain([ROW_A, applied(ROW_B, "keep_dpgf", "Validé par le bureau d'études")])));

    const refreshed = screen.getByRole("status", { name: "Ligne actualisée pendant votre saisie" });
    fireEvent.click(within(refreshed).getByRole("button", { name: "Utiliser la décision appliquée" }));

    expect(screen.getByLabelText("Justification humaine")).toHaveValue("Validé par le bureau d'études");
    expect(screen.queryByRole("status", { name: "Ligne actualisée pendant votre saisie" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => decided(ROW_B, "keep_dpgf", "Validé par le bureau d'études"));
  });

  it("takes the decision a line read again holds when nothing was typed for it", async () => {
    const { rerender } = render(view(COMPARISON));
    fireEvent.click(screen.getByRole("button", { name: /Plafond suspendu/ }));

    rerender(view(readAgain([ROW_A, applied(ROW_B, "out_of_scope", "Lot exclu du marché")])));

    expect(screen.getByLabelText("Justification humaine")).toHaveValue("Lot exclu du marché");
    expect(screen.queryByRole("status", { name: "Ligne actualisée pendant votre saisie" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => decided(ROW_B, "out_of_scope", "Lot exclu du marché"));

    // Nothing typed: a line the comparison no longer lists gives way to the first line, as before.
    rerender(view(readAgain([ROW_A])));
    expect(shownLine()).toHaveTextContent("Cloison BA13");
  });

  it("keeps the line being typed shown when the comparison read again no longer lists it", async () => {
    const { rerender } = render(view(COMPARISON, "exceptions_only"));
    typeOnPlafond();

    rerender(view(readAgain([ROW_A]), "exceptions_only"));

    expect(shownLine()).toHaveTextContent("Plafond suspendu");
    expect(screen.getByLabelText("Justification humaine")).toHaveValue("Relevé sur site");
    expect(screen.getByRole("status", { name: "Ligne absente de la comparaison actualisée" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => decided(ROW_B, "manual_fix", "Relevé sur site"));

    // Picking a listed line leaves it, as picking any other line does.
    fireEvent.click(screen.getByRole("button", { name: /Cloison BA13/ }));
    expect(shownLine()).toHaveTextContent("Cloison BA13");
    expect(screen.getByLabelText("Justification humaine")).toHaveValue("");
  });

  it("keeps a line being edited shown when the edit is back to what the line held", () => {
    const { rerender } = render(view(COMPARISON, "exceptions_only"));
    fireEvent.click(screen.getByRole("button", { name: /Plafond suspendu/ }));
    fireEvent.change(screen.getByLabelText("Justification humaine"), { target: { value: "R" } });
    fireEvent.change(screen.getByLabelText("Justification humaine"), { target: { value: "" } });

    rerender(view(readAgain([ROW_A]), "exceptions_only"));

    expect(shownLine()).toHaveTextContent("Plafond suspendu");
    expect(screen.getByRole("status", { name: "Ligne absente de la comparaison actualisée" })).toBeVisible();
  });

  it("keeps the line shown and its decision when the risk radar opens a line the comparison does not list", async () => {
    const unlistedLineId = "33333333-3333-4333-8333-333333333339";
    vi.mocked(fetchTakeoffRiskRadar).mockResolvedValue(riskRadarWithAlertOn(unlistedLineId));
    render(view(COMPARISON, "exceptions_only"));
    typeOnPlafond();

    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir la ligne" }));

    expect(shownLine()).toHaveTextContent("Plafond suspendu");
    expect(screen.getByLabelText("Justification humaine")).toHaveValue("Relevé sur site");
    expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ title: "Ligne hors de la vue affichée" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => decided(ROW_B, "manual_fix", "Relevé sur site"));
  });

  it("pre-fills the decision already applied to the line and its reason, over the suggested one", async () => {
    render(view(readAgain([ROW_A, applied(ROW_B, "manual_fix", "Relevé sur site")])));
    fireEvent.click(screen.getByRole("button", { name: /Plafond suspendu/ }));

    expect(screen.getByLabelText("Justification humaine")).toHaveValue("Relevé sur site");
    expect(screen.getByText("Vous devrez saisir la quantité corrigée manuellement.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la décision" }));
    await waitFor(() => decided(ROW_B, "manual_fix", "Relevé sur site"));
  });
});

function riskRadarWithAlertOn(lineId: string): TakeoffRiskRadarResponse {
  const at = "2026-11-13T10:00:00.000Z";
  return {
    version_id: VERSION_ID, job_id: JOB_ID,
    summary: { to_process_count: 1, assumed_count: 0, false_positive_count: 0, critical_count: 0, warning_count: 1, info_count: 0,
      top_causes: ["TVA incohérente"], project_score: 40, project_severity: "warning" },
    project: { scope_type: "project", scope_id: null, scope_label: "Projet", score: 40, severity: "warning", open_alerts_count: 1,
      critical_alerts_count: 0, top_causes: ["TVA incohérente"] },
    lots: [],
    items: [{
      alert_id: "66666666-6666-4666-8666-666666666666", takeoff_job_id: JOB_ID, scope_type: "line", scope_id: lineId,
      scope_label: "Peinture des boiseries", line_id: lineId, lot_id: null, cause_code: "vat_inconsistency",
      cause_label: "TVA incohérente", severity: "warning", risk_score: 40, status: "to_process", margin_bucket: "unknown",
      reason_labels: ["TVA ligne 5,5 % différente de la TVA version 20 %."], provenance: [], review_note: null,
      reviewed_at: null, reviewed_by: null, created_at: at, updated_at: at, metadata: {},
    }],
  };
}
