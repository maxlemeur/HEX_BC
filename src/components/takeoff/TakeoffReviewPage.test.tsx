import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Mock next/navigation
const mockReplace = vi.fn();
const mockPush = vi.fn();
const ensureTakeoffApplyDraftLockMock = vi.hoisted(() => vi.fn());
const { useUiModeMock, setModeMock } = vi.hoisted(() => ({
  useUiModeMock: vi.fn(),
  setModeMock: vi.fn(),
}));
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/hooks/useUiMode", () => ({
  useUiMode: useUiModeMock,
}));

vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateItemsForVersion: vi.fn(),
  releaseEstimateDraftLock: vi.fn(),
}));

vi.mock("@/lib/takeoff/apply-draft-lock", () => ({
  ensureTakeoffApplyDraftLock: ensureTakeoffApplyDraftLockMock,
}));

// Mock client functions
vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffJob: vi.fn(),
  fetchTakeoffDpgfComparison: vi.fn(),
  fetchTakeoffJobCompare: vi.fn(),
  fetchAllTakeoffDpgfComparison: vi.fn(),
  listTakeoffJobs: vi.fn(),
  patchTakeoffItems: vi.fn(),
  applyTakeoffJob: vi.fn(),
  previewTakeoffConversion: vi.fn(),
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

vi.mock("@/components/UserContext", () => ({
  useUserContext: () => ({
    userEmail: "admin@example.com",
    tenantId: "22222222-2222-4222-8222-222222222222",
    profile: {
      role: "admin",
      tenant_role: "admin",
    },
    setProfile: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({
    enabled: false,
    value: null,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import TakeoffReviewPage from "@/components/takeoff/TakeoffReviewPage";
import {
  fetchEstimateItemsForVersion,
  releaseEstimateDraftLock,
} from "@/lib/estimates/client";
import {
  applyTakeoffJob,
  fetchAllTakeoffDpgfComparison,
  fetchTakeoffDpgfComparison,
  fetchTakeoffJob,
  fetchTakeoffJobCompare,
  listTakeoffJobs,
  patchTakeoffItems,
  previewTakeoffConversion,
} from "@/lib/takeoff/client";
import type {
  TakeoffDpgfComparisonResponse,
  TakeoffJobDetailResponse,
  TakeoffJobItem,
} from "@/lib/takeoff/types";

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "77777777-7777-4777-8777-777777777777";
const ITEM_ID_1 = "44444444-4444-4444-8444-444444444444";
const ITEM_ID_2 = "55555555-5555-4555-8555-555555555555";
const PREVIEW_RESPONSE = {
  job_id: JOB_ID,
  strategy: "append" as const,
  target_section_id: null,
  summary: {
    total_count: 1,
    included_count: 1,
    transformed_count: 1,
    overridden_count: 0,
    excluded_by_mapping_count: 0,
    assembly_insertions_count: 0,
  },
  items: [
    {
      item_id: ITEM_ID_1,
      source_order: 0,
      rule_id: "88888888-8888-4888-8888-888888888888",
      rule_name: "Rule set_price",
      action: "set_price" as const,
      action_params: {
        unit_price_cents: 420,
      },
      applied_by: "rule" as const,
      original: {
        designation: "Tube PVC 100mm",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: null,
        assembly_id: null,
      },
      transformed: {
        designation: "Tube PVC 100mm",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: 420,
        assembly_id: null,
      },
    },
  ],
};

function mockUiMode(mode: "expert" | "simplified") {
  useUiModeMock.mockReturnValue({
    mode,
    isExpert: mode === "expert",
    isSimplified: mode === "simplified",
    setMode: setModeMock,
  });
}

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
      processing_strategy: "sync" as const,
      provider_batch_id: null,
      provider_batch_state: null,
      provider_batch_updated_at: null,
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

function makeDpgfComparisonResponse(
  summaryOverrides: Partial<TakeoffDpgfComparisonResponse["summary"]> = {}
): TakeoffDpgfComparisonResponse {
  return {
    version_id: VERSION_ID,
    job_id: JOB_ID,
    view: "all",
    threshold: 0.8,
    summary: {
      reliable_matches: 0,
      to_confirm: 1,
      significant_gaps: 1,
      forced_manual: 1,
      lines_without_proof: 2,
      unused_takeoff_items: 1,
      total_lines: 3,
      ...summaryOverrides,
    },
    rows: [],
    manual_link_candidates: [],
    unused_takeoff_items: [],
    pagination: {
      page_size: 1,
      next_cursor: "next",
      total: 3,
    },
  };
}

describe("TakeoffReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureTakeoffApplyDraftLockMock.mockResolvedValue({
      acquired: true,
      shouldRelease: false,
      errorMessage: null,
    });
    vi.mocked(releaseEstimateDraftLock).mockResolvedValue(true as never);
    mockSearchParams = new URLSearchParams();
    mockUiMode("expert");
    vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([
      {
        id: "99999999-9999-4999-8999-111111111111",
        parent_id: null,
        item_type: "section",
        position: 1,
        title: "Section A",
      },
    ] as never);
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
    vi.mocked(fetchTakeoffDpgfComparison).mockResolvedValue(makeDpgfComparisonResponse());
    vi.mocked(fetchAllTakeoffDpgfComparison).mockResolvedValue({
      ...makeDpgfComparisonResponse(),
      pagination: {
        page_size: 200,
        next_cursor: null,
        total: 0,
      },
    });
    vi.mocked(previewTakeoffConversion).mockResolvedValue(PREVIEW_RESPONSE);
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
              headers: ["Désignation", "Qte"],
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
              headers: ["Désignation", "Qte"],
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

  it("keeps the production tables deep link when a simplified user opens assisted mode", async () => {
    mockUiMode("simplified");
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
              headers: ["Désignation", "Qte"],
              rows: [{ row_index: 0, cells: ["Tube PVC 100mm", "12"] }],
            },
          ],
        }
      )
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    // Mode switch shows Assiste as selected (default for simplified users)
    expect(
      screen.getByRole("tab", { name: /Assiste/ })
    ).toBeDefined();
    expect(screen.queryByPlaceholderText("Rechercher par titre...")).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does not show a tables tab when no tables exist", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()])
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    expect(screen.queryByRole("tab", { name: "Tables" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Items (1)" })).toBeDefined();
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
    vi.mocked(fetchTakeoffDpgfComparison).mockResolvedValue(
      makeDpgfComparisonResponse({
        to_confirm: 0,
        significant_gaps: 0,
        forced_manual: 0,
        lines_without_proof: 0,
        unused_takeoff_items: 0,
      })
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      const applyBtn = screen.getByRole("button", {
        name: /appliquer au chiffrage/i,
      });
      expect(applyBtn.getAttribute("disabled")).toBeNull();
      expect(fetchTakeoffDpgfComparison).toHaveBeenCalled();
    });
  });

  it("describes a missing Level C page as incomplete proof, not low confidence", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse(
        [makeItem({ confidence: 0.95, evidence: "repère A3", source_page: null })],
        { level: "C" }
      )
    );
    vi.mocked(fetchTakeoffDpgfComparison).mockResolvedValue(
      makeDpgfComparisonResponse({
        to_confirm: 0,
        significant_gaps: 0,
        forced_manual: 0,
        lines_without_proof: 0,
        unused_takeoff_items: 0,
      })
    );

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(
        screen.getByText(/complétez les preuves localisées ou la validation humaine/i)
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/faible confiance doivent/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: /appliquer au chiffrage/i })
    ).toBeDisabled();
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
              headers: ["Désignation", "Qte"],
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

    const designationInput = screen.getByLabelText("Désignation") as HTMLInputElement;
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

  it("invalidates human verification when reviewed content changes", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem({ is_verified: true })])
    );
    vi.mocked(patchTakeoffItems).mockResolvedValue({
      results: [
        {
          item_id: ITEM_ID_1,
          success: true,
          item: makeItem({ designation: "Updated", is_verified: false }),
        },
      ],
      succeeded: 1,
      failed: 0,
    });

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    const designationInput = (await screen.findByLabelText(
      "Désignation"
    )) as HTMLInputElement;
    fireEvent.change(designationInput, { target: { value: "Updated" } });
    fireEvent.blur(designationInput);

    await waitFor(
      () => {
        expect(patchTakeoffItems).toHaveBeenCalledWith(
          JOB_ID,
          expect.objectContaining({
            items: [
              expect.objectContaining({
                fields: expect.objectContaining({
                  designation: "Updated",
                  is_verified: false,
                }),
              }),
            ],
          })
        );
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
              headers: ["Désignation", "Qte"],
              rows: [{ row_index: 0, cells: ["Item A", "10"] }],
            },
            {
              page: 2,
              title: "Table 2",
              headers: ["Désignation", "Qte"],
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

  it("keeps the production compare deep link when a simplified user opens assisted mode", async () => {
    mockUiMode("simplified");
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
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    // Mode switch shows Assiste as selected (default for simplified users)
    expect(
      screen.getByRole("tab", { name: /Assiste/ })
    ).toBeDefined();
    expect(screen.queryByText("Resume des changements")).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("switches review mode via mode switch without persisting the profile mode", async () => {
    mockUiMode("simplified");
    vi.mocked(fetchTakeoffJob).mockResolvedValue(makeMockResponse([makeItem()]));

    render(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    // Mode switch should show all three modes
    const assistedRadio = screen.getByRole("tab", { name: /Assiste/ });
    const productionRadio = screen.getByRole("tab", { name: /Production/ });
    const validationRadio = screen.getByRole("tab", { name: /Validation/ });

    expect(assistedRadio).toBeDefined();
    expect(productionRadio).toBeDefined();
    expect(validationRadio).toBeDefined();

    // Assiste should be selected by default (simplified user)
    expect(assistedRadio.getAttribute("aria-selected")).toBe("true");

    // Click Production
    fireEvent.click(productionRadio);

    // Should update URL, not global mode
    expect(setModeMock).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("reviewMode=production"),
      { scroll: false }
    );
  });

  it("defaults to the validation review in affaire context and links back to the activity center", async () => {
    mockUiMode("simplified");
    vi.mocked(fetchTakeoffJob).mockResolvedValue(makeMockResponse([makeItem()]));

    render(
      <TakeoffReviewPage
        jobId={JOB_ID}
        versionId={VERSION_ID}
        projectId="99999999-9999-4999-8999-999999999999"
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText("Traitez d'abord les exceptions qui peuvent biaiser le chiffrage")
      ).toBeDefined();
    });

    expect(
      screen.getByRole("tab", { name: /Validation/ }).getAttribute("aria-selected")
    ).toBe("true");
    expect(
      screen.getByRole("link", { name: "Centre d'activité métrés" })
    ).toHaveAttribute(
      "href",
      "/dashboard/affaires/99999999-9999-4999-8999-999999999999/takeoff"
    );
    expect(fetchTakeoffDpgfComparison).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        version_id: VERSION_ID,
        page_size: 1,
      }),
      expect.anything()
    );
    expect(fetchAllTakeoffDpgfComparison).not.toHaveBeenCalled();
  });

  it("opens the controlled apply wizard from validation and stays in affaire context after success", async () => {
    ensureTakeoffApplyDraftLockMock.mockResolvedValue({
      acquired: true,
      shouldRelease: true,
      errorMessage: null,
    });
    vi.mocked(fetchTakeoffJob).mockResolvedValue(makeMockResponse([makeItem()]));
    vi.mocked(fetchTakeoffDpgfComparison).mockResolvedValue(
      makeDpgfComparisonResponse({
        to_confirm: 0,
        significant_gaps: 0,
        forced_manual: 0,
        lines_without_proof: 0,
        unused_takeoff_items: 0,
      })
    );
    vi.mocked(applyTakeoffJob).mockResolvedValue({
      job: makeMockResponse([makeItem()]).job,
      summary: {
        scope: "section",
        created_count: 1,
        updated_count: 0,
        ignored_count: 0,
        created_ids: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        item_links: [],
      },
    });

    render(
      <TakeoffReviewPage
        jobId={JOB_ID}
        versionId={VERSION_ID}
        projectId="99999999-9999-4999-8999-999999999999"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ouvrir l'apply controle" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Ouvrir l'apply controle" }));

    await waitFor(() => {
      expect(screen.getByText("Cible d'application")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("radio", { name: /Fusionner avec l'existant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(screen.getByText("Provenance visible avant confirmation")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'application" }));

    await waitFor(() => {
      expect(applyTakeoffJob).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({
          strategy: "merge",
        })
      );
    });

    expect(mockPush).not.toHaveBeenCalledWith(`/dashboard/estimates/${VERSION_ID}/takeoff/${JOB_ID}`);
    await waitFor(() => {
      expect(screen.getByText("Apply controle confirme")).toBeDefined();
      expect(screen.getByRole("link", { name: "Ouvrir le chiffrage" })).toHaveAttribute(
        "href",
        `/dashboard/estimates/${VERSION_ID}`
      );
      expect(screen.getByRole("button", { name: "Ouvrir l'apply controle" })).toBeDisabled();
      expect(releaseEstimateDraftLock).toHaveBeenCalledWith(VERSION_ID);
    });
  });

  it("blocks controlled apply from validation while DPGF exceptions remain unresolved", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(makeMockResponse([makeItem()]));

    render(
      <TakeoffReviewPage
        jobId={JOB_ID}
        versionId={VERSION_ID}
        projectId="99999999-9999-4999-8999-999999999999"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ouvrir l'apply controle" })).toBeDefined();
    });

    const applyButton = screen.getByRole("button", { name: "Ouvrir l'apply controle" });
    expect(applyButton).toBeDisabled();
    expect(
      screen.getAllByText(
        "Des rapprochements DPGF restent a trancher. Ouvrez la revue detaillee pour finaliser les liens manuels."
      ).length
    ).toBeGreaterThan(0);

    fireEvent.click(applyButton);

    expect(screen.queryByText("Cible d'application")).not.toBeInTheDocument();
  });

  it("allows controlled apply when the target version has no DPGF lines", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(makeMockResponse([makeItem()]));
    vi.mocked(fetchTakeoffDpgfComparison).mockResolvedValue(
      makeDpgfComparisonResponse({
        reliable_matches: 0,
        to_confirm: 0,
        significant_gaps: 0,
        forced_manual: 0,
        lines_without_proof: 0,
        unused_takeoff_items: 1,
        total_lines: 0,
      })
    );

    render(
      <TakeoffReviewPage
        jobId={JOB_ID}
        versionId={VERSION_ID}
        projectId="99999999-9999-4999-8999-999999999999"
      />
    );

    const applyButton = await screen.findByRole("button", {
      name: "Ouvrir l'apply controle",
    });

    await waitFor(() => {
      expect(applyButton).toBeEnabled();
    });
    expect(
      screen.getByText("aucune ligne DPGF cible, ajout au chiffrage possible")
    ).toBeInTheDocument();
  });

  it("preserves the production tab when switching away and back", async () => {
    mockSearchParams = new URLSearchParams(
      "reviewMode=production&view=compare&compareWith=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&threshold=0.8"
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

    const { rerender } = render(
      <TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />
    );

    await waitFor(() => {
      expect(screen.getByText("Resume des changements")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: /Assiste/ }));

    expect(mockReplace).toHaveBeenLastCalledWith(
      "?reviewMode=assisted&view=compare&compareWith=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&threshold=0.8",
      { scroll: false }
    );

    mockSearchParams = new URLSearchParams(
      "reviewMode=assisted&view=compare&compareWith=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&threshold=0.8"
    );
    rerender(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("tab", { name: /Production/ }));

    expect(mockReplace).toHaveBeenLastCalledWith(
      "?view=compare&compareWith=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&threshold=0.8",
      { scroll: false }
    );
  });

  it("persists assisted review progress across mode switches", async () => {
    mockUiMode("simplified");
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()])
    );

    const { rerender } = render(
      <TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />
    );

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Accepter" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Accepte" })).toBeDefined();
    });

    mockSearchParams = new URLSearchParams("reviewMode=production");
    rerender(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Items (1)" })).toBeDefined();
    });

    mockSearchParams = new URLSearchParams();
    rerender(<TakeoffReviewPage jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Accepte" })).toBeDefined();
    });
  });
});
