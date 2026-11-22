import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The comparison of two readings stays at its address for every job (lot 4, the entries, review-link.ts). The second
// reading of #501, written before the fix: on it an operator could deselect a contribution and « Appliquer la
// sélection », which sends an exclusion — today's gesture, kept as it is for a first-format job; for a job read against
// the affaire's list the comparison is a read of history: no selection, no apply, and it says where to act (its rows are
// corrected in the targeted review and its items decided in the table). Fictional ids.

const navigation = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
  searchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.searchParams,
  usePathname: () => "/dashboard/affaires/project/takeoff/job/review",
}));
vi.mock("@/components/feedback/toast-provider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/auth/user-context", () => ({
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
  fetchTakeoffJobCompare: vi.fn(),
  patchTakeoffItems: vi.fn(),
  listTakeoffJobs: vi.fn(async () => ({ jobs: [], pagination: { limit: 100, offset: 0, total: 0 } })),
  fetchAllTakeoffDpgfComparison: vi.fn(() => new Promise(() => undefined)),
  fetchTakeoffDpgfComparison: vi.fn(() => new Promise(() => undefined)),
  fetchTakeoffRiskRadar: vi.fn(() => new Promise(() => undefined)),
  saveTakeoffReviewDecision: vi.fn(async () => ({})),
}));

import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";
import { buildTakeoffDiff } from "@/lib/takeoff/diff";
import { fetchTakeoffJob, fetchTakeoffJobCompare, patchTakeoffItems } from "@/lib/takeoff/client";
import { takeoffItemRow } from "@/lib/takeoff/metre-m3.test-utils";
import type { TakeoffJobDetailResponse, TakeoffJobItem } from "@/lib/takeoff/types";

const PROJECT = "10000000-0000-4000-8000-000000000001";
const JOB = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const base = takeoffItemRow() as TakeoffJobItem;
const other = takeoffItemRow({ id: "88888888-8888-4888-8888-888888888888", quantity: 14 }) as TakeoffJobItem;

beforeEach(() => {
  navigation.searchParams = new URLSearchParams(`versionId=${VERSION}&reviewMode=production&view=compare&compareWith=${OTHER}`);
  vi.mocked(fetchTakeoffJob).mockResolvedValue({
    job: { id: JOB, estimate_version_id: VERSION, source_file_name: null, plan_set_id: null, level: "C", status: "completed", version_number: 1 },
    result: { confidence: 0.84, tables: [] },
    items: { data: [base], pagination: { limit: 200, offset: 0, total: 1 } },
  } as unknown as TakeoffJobDetailResponse);
  vi.mocked(fetchTakeoffJobCompare).mockResolvedValue({ base_job_id: JOB, other_job_id: OTHER,
    ...buildTakeoffDiff({ baseItems: [base], otherItems: [other], threshold: 0.8 }) });
  vi.mocked(patchTakeoffItems).mockResolvedValue({ results: [], failed: 0, succeeded: 0 } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the comparison of two readings", () => {
  it("keeps today's selection and apply for a first-format reading", async () => {
    render(<TakeoffReviewPage projectId={PROJECT} jobId={JOB} versionId={VERSION} canEdit />);
    await screen.findByRole("heading", { name: "Résumé des changements" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Tout sélectionner (visible)" }));
    fireEvent.click(screen.getByRole("button", { name: "Appliquer la sélection" }));
    await waitFor(() => expect(patchTakeoffItems).toHaveBeenCalledTimes(1));
  });

  it("is read only for a reading of the affaire's list, and says where to act", async () => {
    render(<TakeoffReviewPage projectId={PROJECT} jobId={JOB} versionId={VERSION} canEdit readsItemList />);
    await screen.findByRole("heading", { name: "Résumé des changements" });
    expect(screen.queryAllByRole("checkbox", { name: /^(Sélection|Tout sélectionner \(visible\))$/ })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Appliquer la sélection" })).toBeNull();
    const note = screen.getByRole("note", { name: /lue contre la liste des postes/ });
    expect(note).toHaveTextContent("se consulte sans rien modifier");
    expect(screen.getByRole("link", { name: "la revue ciblée" }))
      .toHaveAttribute("href", `/dashboard/affaires/${PROJECT}/takeoff/${JOB}/review/targeted?versionId=${VERSION}`);
    expect(screen.getByRole("link", { name: "le tableau des postes" })).toHaveAttribute("href", `/dashboard/affaires/${PROJECT}/takeoff`);
    expect(patchTakeoffItems).not.toHaveBeenCalled();
  });
});
