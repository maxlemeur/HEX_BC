import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Mock client functions
vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffJob: vi.fn(),
  patchTakeoffItems: vi.fn(),
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

import TakeoffReviewTable from "@/components/takeoff/TakeoffReviewTable";
import { fetchTakeoffJob, patchTakeoffItems } from "@/lib/takeoff/client";
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

function makeMockResponse(items: TakeoffJobItem[]): TakeoffJobDetailResponse {
  return {
    job: {
      id: JOB_ID,
      estimate_version_id: VERSION_ID,
      status: "completed",
      level: "A",
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
    result: null,
    items: {
      data: items,
      pagination: { limit: 50, offset: 0, total: items.length },
    },
  };
}

/**
 * Find a <select> element by looking for the one that contains a specific
 * <option> text. This is more robust than `getAllByRole("combobox")` which
 * may not work consistently across jsdom versions.
 */
function getSelectByOptionText(optionText: string): HTMLSelectElement {
  const allOptions = document.querySelectorAll("option");
  for (const option of allOptions) {
    if (option.textContent?.trim() === optionText) {
      const select = option.closest("select");
      if (select) return select;
    }
  }
  throw new Error(`No <select> found containing option "${optionText}"`);
}

describe("TakeoffReviewTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders table with items after loading", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()])
    );

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    // Should show loading first
    expect(screen.getByText("Chargement...")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });
  });

  it("displays correct confidence badge colors", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([
        makeItem({ id: ITEM_ID_1, confidence: 0.9, designation: "High" }),
        makeItem({ id: ITEM_ID_2, confidence: 0.3, designation: "Low" }),
      ])
    );

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("90%")).toBeDefined();
      expect(screen.getByText("30%")).toBeDefined();
    });

    // Check badge variants
    const highBadge = screen.getByText("90%");
    expect(highBadge.getAttribute("data-variant")).toBe("success");

    const lowBadge = screen.getByText("30%");
    expect(lowBadge.getAttribute("data-variant")).toBe("error");
  });

  it("filters items by inclusion status", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([
        makeItem({ id: ITEM_ID_1, is_excluded: false, designation: "Included" }),
        makeItem({
          id: ITEM_ID_2,
          is_excluded: true,
          designation: "Excluded",
          exclusion_reason: "test",
        }),
      ])
    );

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Included")).toBeDefined();
    });

    // Find the inclusion filter select by looking for the one with "Exclues" option
    const inclusionSelect = getSelectByOptionText("Exclues");
    fireEvent.change(inclusionSelect, { target: { value: "excluded" } });

    expect(screen.queryByText("Included")).toBeNull();
    expect(screen.getByText("Excluded")).toBeDefined();
  });

  it("sorts items by quantity", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([
        makeItem({ id: ITEM_ID_1, quantity: 50, designation: "Fifty" }),
        makeItem({ id: ITEM_ID_2, quantity: 5, designation: "Five" }),
      ])
    );

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Fifty")).toBeDefined();
    });

    // Find the sort select by looking for the one with "Tri: Quantite" option
    const sortSelect = getSelectByOptionText("Tri: Quantite");
    fireEvent.change(sortSelect, { target: { value: "quantity" } });

    // After sorting by quantity asc, "Five" (5) should come before "Fifty" (50)
    const rows = screen.getAllByRole("row").slice(1); // Skip header
    const firstDesignation = rows[0]?.textContent ?? "";
    expect(firstDesignation).toContain("Five");
  });

  it("shows apply button disabled when no included items", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([
        makeItem({ id: ITEM_ID_1, is_excluded: true, exclusion_reason: "test" }),
      ])
    );

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

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

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      const applyBtn = screen.getByRole("button", {
        name: /appliquer au chiffrage/i,
      });
      expect(applyBtn.getAttribute("disabled")).toBeNull();
    });
  });

  it("displays summary stats correctly", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([
        makeItem({ id: ITEM_ID_1, is_excluded: false, is_verified: true }),
        makeItem({ id: ITEM_ID_2, is_excluded: true, exclusion_reason: "dup" }),
      ])
    );

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Total")).toBeDefined();
    });
  });

  it("shows error state when fetch fails", async () => {
    vi.mocked(fetchTakeoffJob).mockRejectedValue(new Error("Network error"));

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(
        screen.getByText("Impossible de charger les items.")
      ).toBeDefined();
    });
  });

  it("shows bulk action bar when items are selected", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([
        makeItem({ id: ITEM_ID_1, designation: "Item 1" }),
        makeItem({ id: ITEM_ID_2, designation: "Item 2" }),
      ])
    );

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Item 1")).toBeDefined();
    });

    // Select first item checkbox (index 0 is select-all header checkbox)
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);

    expect(screen.getByText(/selectionne\(s\)/)).toBeDefined();
  });

  it("opens exclusion modal when Exclure action button is clicked", async () => {
    vi.mocked(fetchTakeoffJob).mockResolvedValue(
      makeMockResponse([makeItem()])
    );

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    // Find the row-level "Exclure" action button (plain <button>, not <Button>)
    // It's the only button with exact text "Exclure" when no bulk selection is active
    const excludeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.textContent === "Exclure"
    );
    expect(excludeButtons.length).toBeGreaterThan(0);
    fireEvent.click(excludeButtons[0]);

    // Modal should open
    await waitFor(() => {
      expect(screen.getByText("Exclure 1 item")).toBeDefined();
    });
  });

  it("triggers auto-save after editing and debounce", async () => {
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

    render(<TakeoffReviewTable jobId={JOB_ID} versionId={VERSION_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
    });

    // The EditableCell always renders an <input> in the DOM (hidden when not editing).
    // Find the designation input via its aria-label.
    const designationInput = screen.getByLabelText("Designation") as HTMLInputElement;

    // Focus the input to enter edit mode, then change and blur
    fireEvent.focus(designationInput);
    fireEvent.change(designationInput, { target: { value: "Updated" } });
    fireEvent.blur(designationInput);

    // Wait for auto-save debounce to complete (500ms)
    await waitFor(
      () => {
        expect(patchTakeoffItems).toHaveBeenCalled();
      },
      { timeout: 2000 }
    );
  });
});
