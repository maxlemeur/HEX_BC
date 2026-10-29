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
import { TakeoffTableView } from "@/components/takeoff/TakeoffTableView";
import type { TakeoffTable } from "@/lib/takeoff/types";

const ITEM_ID_1 = "44444444-4444-4444-8444-444444444444";
const ITEM_ID_2 = "55555555-5555-4555-8555-555555555555";

function makeReviewItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: ITEM_ID_1,
    designation: "Carrelage 30x30",
    quantity: 25.5,
    unit: "m2",
    confidence: 0.85,
    evidence: "ligne 3",
    source_file_name: "plan.pdf",
    source_page: 1,
    metadata: { category: "finitions", table_index: 0, row_index: 0 },
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

function makeTable(overrides: Partial<TakeoffTable> = {}): TakeoffTable {
  return {
    page: 1,
    title: "Schedule Finitions R+1",
    headers: ["Designation", "Quantité", "Unité"],
    rows: [
      { row_index: 0, cells: ["Carrelage 30x30", "25.5", "m2"] },
      { row_index: 1, cells: ["Parquet chene", "18.0", "m2"] },
    ],
    ...overrides,
  };
}

describe("TakeoffTableView", () => {
  const defaultProps = {
    onUpdateItem: vi.fn(),
    onExcludeItems: vi.fn(),
    onIncludeItems: vi.fn(),
    onSyncToItems: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps legacy items without table metadata visible by falling back to page/row order", () => {
    render(
      <TakeoffTableView
        tables={[makeTable()]}
        items={[
          makeReviewItem({
            id: ITEM_ID_1,
            designation: "Legacy ligne 1",
            metadata: { category: "legacy" },
            source_page: 1,
          }),
          makeReviewItem({
            id: ITEM_ID_2,
            designation: "Legacy ligne 2",
            metadata: { category: "legacy" },
            source_page: 1,
          }),
        ]}
        {...defaultProps}
      />
    );

    expect(screen.getByText("2 lignes")).toBeDefined();
    expect(screen.getByLabelText("Designation - Legacy ligne 1")).toBeDefined();
    expect(screen.getByLabelText("Designation - Legacy ligne 2")).toBeDefined();
  });

  it("maps quantity column by header even when order is different", () => {
    render(
      <TakeoffTableView
        tables={[
          makeTable({
            headers: ["Designation", "Unité", "Quantité"],
            rows: [{ row_index: 0, cells: ["Carrelage 30x30", "m2", "25.5"] }],
          }),
        ]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
        ]}
        {...defaultProps}
      />
    );

    const quantityInput = screen.getByLabelText("Quantité");
    fireEvent.change(quantityInput, {
      target: { value: "42.75" },
    });
    fireEvent.blur(quantityInput);

    expect(defaultProps.onUpdateItem).toHaveBeenCalledWith(
      ITEM_ID_1,
      "quantity",
      42.75
    );
  });

  it("does not overwrite detected unit mapping when quantity fallback is missing", () => {
    render(
      <TakeoffTableView
        tables={[
          makeTable({
            headers: ["Designation", "Unité", "Prix"],
            rows: [{ row_index: 0, cells: ["Carrelage 30x30", "m2", "18.5"] }],
          }),
        ]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
        ]}
        {...defaultProps}
      />
    );

    const unitInput = screen.getByLabelText("Unité");
    fireEvent.change(unitInput, { target: { value: "m3" } });
    fireEvent.blur(unitInput);

    expect(defaultProps.onUpdateItem).toHaveBeenCalledWith(ITEM_ID_1, "unit", "m3");
    expect(defaultProps.onUpdateItem).not.toHaveBeenCalledWith(
      ITEM_ID_1,
      "quantity",
      expect.any(Number)
    );
  });
});
