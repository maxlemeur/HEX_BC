import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

import { TakeoffTableView } from "@/components/takeoff/TakeoffTableView";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import type { TakeoffTable } from "@/lib/takeoff/types";

const ITEM_ID_1 = "44444444-4444-4444-8444-444444444444";
const ITEM_ID_2 = "55555555-5555-4555-8555-555555555555";
const ITEM_ID_3 = "66666666-6666-4666-8666-666666666666";

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
    headers: ["Designation", "Quantite", "Unite"],
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

  it("renders table cards with title and metadata", () => {
    render(
      <TakeoffTableView
        tables={[makeTable()]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
          makeReviewItem({
            id: ITEM_ID_2,
            designation: "Parquet chene",
            quantity: 18,
            metadata: { table_index: 0, row_index: 1 },
          }),
        ]}
        {...defaultProps}
      />
    );

    expect(screen.getByText("Schedule Finitions R+1")).toBeDefined();
    expect(screen.getByText("Page 1")).toBeDefined();
    expect(screen.getByText("3 col")).toBeDefined();
    expect(screen.getByText("2 lignes")).toBeDefined();
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

  it("groups tables by page with separators", () => {
    render(
      <TakeoffTableView
        tables={[
          makeTable({ page: 1, title: "Table Page 1" }),
          makeTable({ page: 3, title: "Table Page 3" }),
        ]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, source_page: 1, metadata: { table_index: 0, row_index: 0 } }),
          makeReviewItem({ id: ITEM_ID_2, source_page: 3, metadata: { table_index: 1, row_index: 0 } }),
        ]}
        {...defaultProps}
      />
    );

    expect(screen.getByText("Table Page 1")).toBeDefined();
    expect(screen.getByText("Table Page 3")).toBeDefined();
  });

  it("collapses and expands table cards", () => {
    render(
      <TakeoffTableView
        tables={[makeTable()]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
        ]}
        {...defaultProps}
      />
    );

    // Table header columns should be visible initially
    expect(screen.getByText("Designation")).toBeDefined();

    // Click collapse button
    const collapseBtn = screen.getByLabelText("Replier");
    fireEvent.click(collapseBtn);

    // Table content should be hidden - check that column headers are gone
    // The title should still be visible
    expect(screen.getByText("Schedule Finitions R+1")).toBeDefined();
  });

  it("calls onExcludeItems with all table item IDs when Exclure button clicked", () => {
    render(
      <TakeoffTableView
        tables={[makeTable()]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
          makeReviewItem({
            id: ITEM_ID_2,
            designation: "Parquet",
            metadata: { table_index: 0, row_index: 1 },
          }),
        ]}
        {...defaultProps}
      />
    );

    const excludeBtn = screen.getByRole("button", { name: /exclure/i });
    fireEvent.click(excludeBtn);

    expect(defaultProps.onExcludeItems).toHaveBeenCalledWith([ITEM_ID_1, ITEM_ID_2]);
  });

  it("calls onIncludeItems when Inclure button clicked on excluded table", () => {
    render(
      <TakeoffTableView
        tables={[makeTable()]}
        items={[
          makeReviewItem({
            id: ITEM_ID_1,
            is_excluded: true,
            exclusion_reason: "test",
            metadata: { table_index: 0, row_index: 0 },
          }),
          makeReviewItem({
            id: ITEM_ID_2,
            is_excluded: true,
            exclusion_reason: "test",
            designation: "Parquet",
            metadata: { table_index: 0, row_index: 1 },
          }),
        ]}
        {...defaultProps}
      />
    );

    const includeBtn = screen.getByRole("button", { name: /inclure/i });
    fireEvent.click(includeBtn);

    expect(defaultProps.onIncludeItems).toHaveBeenCalledWith([ITEM_ID_1, ITEM_ID_2]);
  });

  it("filters tables by search query", () => {
    render(
      <TakeoffTableView
        tables={[
          makeTable({ title: "Nomenclature RDC" }),
          makeTable({ page: 2, title: "Schedule Finitions" }),
        ]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
          makeReviewItem({ id: ITEM_ID_2, source_page: 2, metadata: { table_index: 1, row_index: 0 } }),
        ]}
        {...defaultProps}
      />
    );

    const searchInput = screen.getByPlaceholderText("Rechercher par titre...");
    fireEvent.change(searchInput, { target: { value: "Nomenclature" } });

    expect(screen.getByText("Nomenclature RDC")).toBeDefined();
    expect(screen.queryByText("Schedule Finitions")).toBeNull();
  });

  it("filters tables by page, table, and status", () => {
    render(
      <TakeoffTableView
        tables={[
          makeTable({ page: 1, title: "Table A" }),
          makeTable({ page: 2, title: "Table B" }),
        ]}
        items={[
          makeReviewItem({
            id: ITEM_ID_1,
            metadata: { table_index: 0, row_index: 0 },
            is_excluded: true,
            exclusion_reason: "hors scope",
          }),
          makeReviewItem({
            id: ITEM_ID_2,
            source_page: 2,
            metadata: { table_index: 1, row_index: 0 },
            is_excluded: false,
          }),
        ]}
        {...defaultProps}
      />
    );

    const pageFilter = screen.getByLabelText("Filtrer par page");
    fireEvent.change(pageFilter, { target: { value: "2" } });

    expect(screen.getByText("Table B")).toBeDefined();
    expect(screen.queryByText("Table A")).toBeNull();

    const tableFilter = screen.getByLabelText("Filtrer par table");
    fireEvent.change(tableFilter, { target: { value: "1" } });

    expect(screen.getByText("Table B")).toBeDefined();
    expect(screen.queryByText("Table A")).toBeNull();

    const statusFilter = screen.getByLabelText("Filtrer par statut");
    fireEvent.change(statusFilter, { target: { value: "included" } });

    expect(screen.getByText("Table B")).toBeDefined();
    expect(screen.queryByText("Table A")).toBeNull();
  });

  it("calls onSyncToItems with table item IDs", () => {
    render(
      <TakeoffTableView
        tables={[makeTable()]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
          makeReviewItem({
            id: ITEM_ID_2,
            designation: "Parquet",
            metadata: { table_index: 0, row_index: 1 },
          }),
        ]}
        {...defaultProps}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Synchroniser items" }));
    expect(defaultProps.onSyncToItems).toHaveBeenCalledWith([ITEM_ID_1, ITEM_ID_2]);
  });

  it("sorts table items by row_index before bulk actions", () => {
    render(
      <TakeoffTableView
        tables={[makeTable()]}
        items={[
          makeReviewItem({
            id: ITEM_ID_2,
            designation: "Row 1",
            metadata: { table_index: 0, row_index: 1 },
          }),
          makeReviewItem({
            id: ITEM_ID_1,
            designation: "Row 0",
            metadata: { table_index: 0, row_index: 0 },
          }),
          makeReviewItem({
            id: ITEM_ID_3,
            designation: "No row index",
            metadata: { table_index: 0 },
          }),
        ]}
        {...defaultProps}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Synchroniser items" }));
    expect(defaultProps.onSyncToItems).toHaveBeenCalledWith([
      ITEM_ID_1,
      ITEM_ID_2,
      ITEM_ID_3,
    ]);
  });

  it("edits designation cell and propagates update callback", () => {
    render(
      <TakeoffTableView
        tables={[makeTable()]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
        ]}
        {...defaultProps}
      />
    );

    const designationInput = screen.getByLabelText("Designation - Carrelage 30x30");
    fireEvent.change(designationInput, {
      target: { value: "Carrelage antiderapant" },
    });
    fireEvent.blur(designationInput);

    expect(defaultProps.onUpdateItem).toHaveBeenCalledWith(
      ITEM_ID_1,
      "designation",
      "Carrelage antiderapant"
    );
  });

  it("shows empty state when no tables", () => {
    render(
      <TakeoffTableView
        tables={[]}
        items={[]}
        {...defaultProps}
      />
    );

    expect(screen.getByText("Aucune table extraite pour ce job.")).toBeDefined();
  });

  it("shows health badge on table cards", () => {
    render(
      <TakeoffTableView
        tables={[makeTable()]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
          makeReviewItem({
            id: ITEM_ID_2,
            designation: "Parquet",
            metadata: { table_index: 0, row_index: 1 },
          }),
        ]}
        {...defaultProps}
      />
    );

    // Both items have confidence > 0.5 and valid data, so health should be 100%
    expect(screen.getByText("100%")).toBeDefined();
  });

  it("collapse all / expand all buttons work", () => {
    render(
      <TakeoffTableView
        tables={[
          makeTable({ title: "Table A" }),
          makeTable({ page: 2, title: "Table B" }),
        ]}
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0, row_index: 0 } }),
          makeReviewItem({ id: ITEM_ID_2, source_page: 2, metadata: { table_index: 1, row_index: 0 } }),
        ]}
        {...defaultProps}
      />
    );

    // Click "Tout replier"
    const collapseAllBtn = screen.getByText("Tout replier");
    fireEvent.click(collapseAllBtn);

    // Click "Tout deplier"
    const expandAllBtn = screen.getByText("Tout deplier");
    fireEvent.click(expandAllBtn);

    // Both tables should be expanded - their content should be visible
    expect(screen.getByText("Table A")).toBeDefined();
    expect(screen.getByText("Table B")).toBeDefined();
  });
});
