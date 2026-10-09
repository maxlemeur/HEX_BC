import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

// Mock toast
const mockToast = {
  push: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => mockToast,
}));

import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import TakeoffReviewTable from "@/components/takeoff/TakeoffReviewTable";

const ITEM_ID_1 = "44444444-4444-4444-8444-444444444444";
const ITEM_ID_2 = "55555555-5555-4555-8555-555555555555";

function makeReviewItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
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
    _dirty: false,
    _saving: false,
    _error: null,
    ...overrides,
  };
}

describe("TakeoffReviewTable (controlled)", () => {
  const defaultProps = {
    onUpdateItem: vi.fn(),
    onExcludeItems: vi.fn(),
    onIncludeItems: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps null confidence rows last when sorting confidence descending", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, confidence: 0.9, designation: "High" }),
          makeReviewItem({ id: ITEM_ID_2, confidence: null, designation: "Unscored" }),
          makeReviewItem({
            id: "66666666-6666-4666-8666-666666666666",
            confidence: 0.3,
            designation: "Low",
          }),
        ]}
        {...defaultProps}
      />
    );

    fireEvent.click(screen.getByTitle("Croissant"));

    const rows = screen.getAllByRole("row").slice(1);
    const firstRow = rows[0]?.textContent ?? "";
    const lastRow = rows[rows.length - 1]?.textContent ?? "";

    expect(firstRow).toContain("High");
    expect(lastRow).toContain("Unscored");
  });
});
