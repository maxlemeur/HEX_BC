import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  searchParams: new URLSearchParams("reviewMode=production&view=dpgf"),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.searchParams,
  usePathname: () => "/dashboard/estimates/version/takeoff/job/review",
}));
vi.mock("@/components/feedback/toast-provider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/components/UserContext", () => ({
  useUserContext: () => ({ profile: { tenant_role: "admin" } }),
  useOptionalUserContext: () => null,
}));
vi.mock("@/hooks/useFeatureFlag", () => ({ useFeatureFlag: () => ({ enabled: false, value: null }) }));
vi.mock("@/lib/takeoff/page-contributions-client", () => ({
  fetchTakeoffJobPageContributions: vi.fn(() => new Promise(() => undefined)),
  fetchLaunchPageContributions: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock("@/lib/takeoff/client", async (importActual) => ({
  ...await importActual<typeof import("@/lib/takeoff/client")>(),
  fetchTakeoffJob: vi.fn(),
  listTakeoffJobs: vi.fn(async () => ({ jobs: [], pagination: { limit: 100, offset: 0, total: 0 } })),
  fetchAllTakeoffDpgfComparison: vi.fn(),
  fetchTakeoffDpgfComparison: vi.fn(() => new Promise(() => undefined)),
  fetchTakeoffRiskRadar: vi.fn(() => new Promise(() => undefined)),
  saveTakeoffReviewDecision: vi.fn(async () => ({})),
}));

import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";
import { fetchAllTakeoffDpgfComparison, fetchTakeoffJob } from "@/lib/takeoff/client";
import type { TakeoffDpgfComparisonResponse, TakeoffDpgfComparisonRow, TakeoffJobDetailResponse } from "@/lib/takeoff/types";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

function row(lineId: string, label: string, position: number): TakeoffDpgfComparisonRow {
  return {
    line_id: lineId, line_label: label,
    dpgf: { estimate_item_id: lineId, title: label, description: null, quantity: 12, unit: "m2", source_page: 1, source_file_name: "dpgf.xlsx", position },
    linked_takeoff_items: [], dpgf_quantity: 12, takeoff_quantity: 12, quantity_unit: "m2", matching_score: 0.98, confidence_score: 0.93,
    review_status: "reliable_match", proofs: [], suggested_decision: "keep_takeoff", applied_decision: null, delta_absolute: 0,
    delta_percent: 0, is_exception: false, manual_link_count: 0, matched_by: "auto", risk: null,
  };
}
const comparison = (labelB: string): TakeoffDpgfComparisonResponse => ({
  version_id: VERSION_ID, job_id: JOB_ID, view: "all", threshold: 0.8,
  summary: { reliable_matches: 2, to_confirm: 0, significant_gaps: 0, forced_manual: 0, lines_without_proof: 0, unused_takeoff_items: 0, total_lines: 2 },
  rows: [row("33333333-3333-4333-8333-333333333331", "Cloison BA13", 1), row("33333333-3333-4333-8333-333333333332", labelB, 2)],
  manual_link_candidates: [], unused_takeoff_items: [], pagination: { page_size: 200, next_cursor: null, total: 2 },
});
const JOB = {
  job: { id: JOB_ID, estimate_version_id: VERSION_ID, source_file_name: null, plan_set_id: null, level: "A", status: "completed", version_number: 1 },
  result: { confidence: 0.84, tables: [] },
  items: { data: [], pagination: { limit: 200, offset: 0, total: 0 } },
} as unknown as TakeoffJobDetailResponse;

/**
 * Each read of the comparison waits until the test answers it. An aborted read fails as fetch does, unless
 * `answersOnceAborted`: its answer was already on its way, and still lands.
 */
function heldComparisonReads({ answersOnceAborted = false } = {}) {
  const pending: Array<{ resolve: (data: TakeoffDpgfComparisonResponse) => void }> = [];
  vi.mocked(fetchAllTakeoffDpgfComparison).mockImplementation((_jobId, _query, options) => new Promise((resolve, reject) => {
    const read = { resolve };
    pending.push(read);
    if (answersOnceAborted) return;
    options?.signal?.addEventListener("abort", () => {
      pending.splice(pending.indexOf(read), 1);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  }));
  return {
    count: () => pending.length,
    answerOldest: (data: TakeoffDpgfComparisonResponse) => pending.shift()?.resolve(data),
    answerNewest: (data: TakeoffDpgfComparisonResponse) => pending.pop()?.resolve(data),
    answerAll: (data: TakeoffDpgfComparisonResponse) => pending.splice(0).forEach((read) => read.resolve(data)),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// TI-721, written before the fix: « Rafraîchir » emptied the comparison, so the tab showed its loading state in place
// of the line being typed, and the emptied comparison started a second read beside the refresh's own. The read that
// answered last replaced the comparison shown again, and the decision typed meanwhile with it. Each read is held
// until the test answers it, in the order where the late one is the refresh's.
describe("TakeoffReviewPage, refreshing the DPGF comparison (TI-721)", () => {
  it("reads the comparison once and keeps the decision being typed, whatever the order of the answers", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(JOB);
    const reads = heldComparisonReads();
    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);
    await waitFor(() => expect(reads.count()).toBe(1));
    reads.answerAll(comparison("Plafond suspendu"));

    const reason = await screen.findByLabelText("Justification humaine");
    fireEvent.change(reason, { target: { value: "Relevé sur site" } });
    fireEvent.click(screen.getByRole("button", { name: "Rafraîchir" }));

    expect(screen.getByLabelText("Justification humaine")).toHaveValue("Relevé sur site");
    expect(screen.getByText(/actualisation…/)).toBeVisible();
    reads.answerNewest(comparison("Plafond suspendu, relu"));
    fireEvent.change(await screen.findByLabelText("Justification humaine"), { target: { value: "Relevé sur site, cote 2,40 m" } });
    reads.answerAll(comparison("Plafond suspendu, relu trop tard"));

    await screen.findByRole("button", { name: /Plafond suspendu, relu/ });
    expect(screen.getByLabelText("Justification humaine")).toHaveValue("Relevé sur site, cote 2,40 m");
    expect(screen.queryByText(/relu trop tard/)).toBeNull();
    expect(fetchAllTakeoffDpgfComparison).toHaveBeenCalledTimes(2);
  });

  it("shows the read asked for last, even when an earlier read answers after it", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(JOB);
    const reads = heldComparisonReads({ answersOnceAborted: true });
    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);
    await waitFor(() => expect(reads.count()).toBe(1));
    reads.answerAll(comparison("Plafond suspendu"));
    await screen.findByLabelText("Justification humaine");

    fireEvent.click(screen.getByRole("button", { name: "Rafraîchir" }));
    fireEvent.click(screen.getByRole("button", { name: "Rafraîchir" }));
    expect(reads.count()).toBe(2);
    reads.answerOldest(comparison("Plafond suspendu, première relecture"));
    await waitFor(() => expect(reads.count()).toBe(1));
    expect(screen.queryByRole("button", { name: /première relecture/ })).toBeNull();
    expect(screen.getByText(/actualisation…/)).toBeVisible();

    reads.answerNewest(comparison("Plafond suspendu, seconde relecture"));
    expect(await screen.findByRole("button", { name: /seconde relecture/ })).toBeVisible();
    await waitFor(() => expect(screen.queryByText(/actualisation…/)).toBeNull());
    expect(screen.queryByRole("button", { name: /première relecture/ })).toBeNull();
  });
});
