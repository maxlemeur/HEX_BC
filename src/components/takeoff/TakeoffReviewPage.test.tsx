import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Mock next/navigation
const mockReplace = vi.fn();
const mockPush = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

// Mock client functions
vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffJob: vi.fn(),
  fetchTakeoffJobCompare: vi.fn(),
  listTakeoffJobs: vi.fn(),
  patchTakeoffItems: vi.fn(),
  applyTakeoffJob: vi.fn(),
  isTakeoffApiError: vi.fn(() => false),
}));

// Mock toast
const mockToast = {
  push: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => mockToast,
}));

import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";
import {
  fetchTakeoffJob,
  fetchTakeoffJobCompare,
  listTakeoffJobs,
  patchTakeoffItems,
} from "@/lib/takeoff/client";
import type { TakeoffJobDetailResponse, TakeoffJobItem } from "@/lib/takeoff/types";

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "77777777-7777-4777-8777-777777777777";
const ITEM_ID_1 = "44444444-4444-4444-8444-444444444444";
const ITEM_ID_2 = "55555555-5555-4555-8555-555555555555";

function makeItem(overrides: Partial<TakeoffJobItem> = {}): TakeoffJobItem {
  return {
    id: ITEM_ID_1,
    designation: "Tube PVC 100mm",
    quantity: 12,
    unit: "ml",
    confidence: 0.85,
    evidence: "ligne 3",
    source_file_name: "file.csv",
    source_page: 1,
    metadata: { category: "tuyauterie" },
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-02-25T09:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
    ...overrides,
  };
}

function makeMockResponse(
  items: TakeoffJobItem[],
  overrides: { level?: string; tables?: unknown[] } = {}
): TakeoffJobDetailResponse {
  return {
    job: {
      id: JOB_ID,
      estimate_version_id: VERSION_ID,
      status: "completed",
      level: overrides.level ?? "A",
      source_file_name: "niveau-a.csv",
      source_file_type: "text/csv",
      source_file_size_bytes: 100,
      prompt_version: "1.0",
      schema_version: null,
      model: null,
      thinking_level: null,
      media_resolution: null,
      retry_count: 0,
      error_code: null,
      error_message: null,
      next_retry_at: null,
      last_error_at: null,
      started_at: "2026-02-25T09:00:00.000Z",
      completed_at: "2026-02-25T10:00:00.000Z",
      created_at: "2026-02-25T09:00:00.000Z",
      updated_at: "2026-02-25T10:00:00.000Z",
      metrics: { token_count: null, cost_cents: null, duration_ms: null },
    },
    result: overrides.tables
      ? {
          id: "result-id",
          extracted_json: null,
          warnings: [],
          tables: overrides.tables,
          provider_meta: {},
          raw_response: null,
          confidence: null,
          token_count: null,
          cost_cents: null,
          duration_ms: null,
          created_at: "2026-02-25T09:00:00.000Z",
          updated_at: "2026-02-25T10:00:00.000Z",
        }
      : null,
    items: {
      data: items,
      pagination: { limit: 50, offset: 0, total: items.length },
    },
  };
}

describe("TakeoffReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    vi.mocked(listTakeoffJobs).mockResolvedValue({
      jobs: [],
      counters: {
        total: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        canceled: 0,
      },
      pagination: {
        limit: 20,
        offset: 0,
        total: 0,
      },
    });
    vi.mocked(fetchTakeoffJobCompare).mockResolvedValue({
      base_job_id: JOB_ID,
      other_job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      threshold: 0.8,
      summary: {
        added: 0,
        removed: 0,
        changed: 0,
        unchanged: 0,
        total_base: 0,
        total_other: 0,
      },
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads and renders items from API", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()])
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    expect(screen.getByText("Chargement...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });
  });

  it("shows error state when fetch fails", async () => {
    vi.mocked(fetchTakeoffJob).mockRejectedValue(new Error("Network error"));

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(
        screen.getByText("Impossible de charger les items.")
      ).toBeDefined();
    });
  });

  it("shows summary stats bar", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([
        makeItem({ id: ITEM_ID_1, is_excluded: false, is_verified: true }),
        makeItem({ id: ITEM_ID_2, is_excluded: true, exclusion_reason: "dup" }),
      ])
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Total")).toBeDefined();
    });
  });

  it("shows tab bar when tables exist", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse(
        [makeItem({ metadata: { table_index: 0, row_index: 0 } })],
        {
          level: "B",
          tables: [
            {
              page: 1,
              title: "Nomenclature",
              headers: ["Designation", "Qte"],
              rows: [{ row_index: 0, cells: ["Tube PVC 100mm", "12"] }],
            },
          ],
        }
      )
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getAllByText("Tables").length).toBeGreaterThan(0);
    });

    // Items tab should show count
    const itemsTab = screen.getByText(/Items \(1\)/);
    expect(itemsTab).toBeDefined();
  });

  it("switches from tables tab to items tab via query param update", async () => {
    mockSearchParams = new URLSearchParams("view=tables");
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse(
        [makeItem({ metadata: { table_index: 0, row_index: 0 } })],
        {
          level: "B",
          tables: [
            {
              page: 1,
              title: "Nomenclature",
              headers: ["Designation", "Qte"],
              rows: [{ row_index: 0, cells: ["Tube PVC 100mm", "12"] }],
            },
          ],
        }
      )
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Rechercher par titre...")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Items (1)" }));

    expect(mockReplace).toHaveBeenCalledWith("?view=items", { scroll: false });
  });

  it("does not show tab bar when no tables", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()])
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    // Tab bar should not appear - no "Items (" tab button
    expect(screen.queryByText(/Items \(\d+\)/)).toBeNull();
  });

  it("shows apply button disabled when no included items", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([
        makeItem({ id: ITEM_ID_1, is_excluded: true, exclusion_reason: "test" }),
      ])
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /appliquer au chiffrage/i })
      ).toBeDefined();
    });

    const applyBtn = screen.getByRole("button", {
      name: /appliquer au chiffrage/i,
    });
    expect(applyBtn.getAttribute("disabled")).not.toBeNull();
  });

  it("shows apply button enabled when items are ready", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()])
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      const applyBtn = screen.getByRole("button", {
        name: /appliquer au chiffrage/i,
      });
      expect(applyBtn.getAttribute("disabled")).toBeNull();
    });
  });

  it("sync action in tables view navigates to items and shows toast", async () => {
    mockSearchParams = new URLSearchParams("view=tables");
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse(
        [makeItem({ metadata: { table_index: 0, row_index: 0 } })],
        {
          level: "B",
          tables: [
            {
              page: 1,
              title: "Nomenclature",
              headers: ["Designation", "Qte"],
              rows: [{ row_index: 0, cells: ["Tube PVC 100mm", "12"] }],
            },
          ],
        }
      )
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Synchroniser items" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Synchroniser items" }));

    expect(mockReplace).toHaveBeenLastCalledWith("?view=items", { scroll: false });
    expect(mockToast.info).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Synchronisation vers items",
      })
    );
  });

  it("triggers auto-save after editing", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()])
    );
    vi.mocked(patchTakeoffItems).mockResolvedValue({
      results: [
        {
          item_id: ITEM_ID_1,
          success: true,
          item: makeItem({ designation: "Updated" }),
        },
      ],
      succeeded: 1,
      failed: 0,
    });

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    const designationInput = screen.getByLabelText("Designation") as HTMLInputElement;
    fireEvent.focus(designationInput);
    fireEvent.change(designationInput, { target: { value: "Updated" } });
    fireEvent.blur(designationInput);

    await waitFor(
      () => {
        expect(patchTakeoffItems).toHaveBeenCalled();
      },
      { timeout: 2000 }
    );
  });

  it("shows tables count in stats bar for Level B", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse(
        [
          makeItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
          makeItem({ id: ITEM_ID_2, metadata: { table_index: 1, row_index: 0 } }),
        ],
        {
          level: "B",
          tables: [
            {
              page: 1,
              title: "Table 1",
              headers: ["Designation", "Qte"],
              rows: [{ row_index: 0, cells: ["Item A", "10"] }],
            },
            {
              page: 2,
              title: "Table 2",
              headers: ["Designation", "Qte"],
              rows: [{ row_index: 0, cells: ["Item B", "20"] }],
            },
          ],
        }
      )
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getAllByText("Tables").length).toBeGreaterThan(0);
    });

    // Stats bar should show "2" next to "Tables"
    // The stats bar renders: <span>2</span> <span>Tables</span>
    const tablesLabels = screen.getAllByText("Tables");
    // Find the one in the stats bar (sibling of "2")
    const statsTablesLabel = tablesLabels.find((el) => {
      const parent = el.parentElement;
      return parent && parent.querySelector("span")?.textContent === "2";
    });
    expect(statsTablesLabel).toBeDefined();
  });

  it("opens exclusion modal when excluding from item view", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()])
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    const excludeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.textContent === "Exclure"
    );
    expect(excludeButtons.length).toBeGreaterThan(0);
    fireEvent.click(excludeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Exclure 1 item")).toBeDefined();
    });
  });

  it("loads compare tab and renders diff view", async () => {
    mockSearchParams = new URLSearchParams(
      "view=compare&compareWith=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&threshold=0.8"
    );

    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()], { level: "A" })
    );
    vi.mocked(listTakeoffJobs).mockResolvedValue({
      jobs: [
        {
          ...makeMockResponse([makeItem()]).job,
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          source_file_name: "niveau-a.csv",
          status: "completed",
        },
      ],
      counters: {
        total: 1,
        processing: 0,
        completed: 1,
        failed: 0,
        canceled: 0,
      },
      pagination: {
        limit: 20,
        offset: 0,
        total: 1,
      },
    });
    vi.mocked(fetchTakeoffJobCompare).mockResolvedValue({
      base_job_id: JOB_ID,
      other_job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      threshold: 0.8,
      summary: {
        added: 1,
        removed: 0,
        changed: 0,
        unchanged: 1,
        total_base: 1,
        total_other: 2,
      },
      added: [
        {
          key: "added:1",
          change_type: "added",
          other_item: makeItem({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            designation: "Vis",
          }),
        },
      ],
      removed: [],
      changed: [],
      unchanged: [
        {
          key: "unchanged:1",
          change_type: "unchanged",
          base_item: makeItem(),
          other_item: makeItem({
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          }),
          match_score: 1,
          match_strategy: "designation_fuzzy",
        },
      ],
    });

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Resume des changements")).toBeDefined();
    });
    expect(fetchTakeoffJobCompare).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        withJobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      })
    );
  });
});
