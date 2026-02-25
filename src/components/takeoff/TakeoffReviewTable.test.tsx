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

import TakeoffReviewTable from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

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

  it("renders items in the table", () => {
    render(
      <TakeoffReviewTable
        items={[makeReviewItem()]}
        {...defaultProps}
      />
    );

    expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
  });

  it("displays correct confidence badge colors", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, confidence: 0.9, designation: "High" }),
          makeReviewItem({ id: ITEM_ID_2, confidence: 0.3, designation: "Low" }),
        ]}
        {...defaultProps}
      />
    );

    const highBadge = screen.getByText("90%");
    expect(highBadge.getAttribute("data-variant")).toBe("success");

    const lowBadge = screen.getByText("30%");
    expect(lowBadge.getAttribute("data-variant")).toBe("error");
  });

  it("filters items by inclusion status", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, is_excluded: false, designation: "Included" }),
          makeReviewItem({
            id: ITEM_ID_2,
            is_excluded: true,
            designation: "Excluded",
            exclusion_reason: "test",
          }),
        ]}
        {...defaultProps}
      />
    );

    expect(screen.getByText("Included")).toBeDefined();

    // Find the inclusion filter select
    const allOptions = document.querySelectorAll("option");
    let inclusionSelect: HTMLSelectElement | null = null;
    for (const option of allOptions) {
      if (option.textContent?.trim() === "Exclues") {
        inclusionSelect = option.closest("select");
        break;
      }
    }
    expect(inclusionSelect).not.toBeNull();
    fireEvent.change(inclusionSelect!, { target: { value: "excluded" } });

    expect(screen.queryByText("Included")).toBeNull();
    expect(screen.getByText("Excluded")).toBeDefined();
  });

  it("sorts items by quantity", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, quantity: 50, designation: "Fifty" }),
          makeReviewItem({ id: ITEM_ID_2, quantity: 5, designation: "Five" }),
        ]}
        {...defaultProps}
      />
    );

    // Find the sort select
    const allOptions = document.querySelectorAll("option");
    let sortSelect: HTMLSelectElement | null = null;
    for (const option of allOptions) {
      if (option.textContent?.trim() === "Tri: Quantite") {
        sortSelect = option.closest("select");
        break;
      }
    }
    expect(sortSelect).not.toBeNull();
    fireEvent.change(sortSelect!, { target: { value: "quantity" } });

    const rows = screen.getAllByRole("row").slice(1);
    const firstDesignation = rows[0]?.textContent ?? "";
    expect(firstDesignation).toContain("Five");
  });

  it("shows bulk action bar when items are selected", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, designation: "Item 1" }),
          makeReviewItem({ id: ITEM_ID_2, designation: "Item 2" }),
        ]}
        {...defaultProps}
      />
    );

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);

    expect(screen.getByText(/selectionne\(s\)/)).toBeDefined();
  });

  it("calls onExcludeItems when exclude button clicked", () => {
    render(
      <TakeoffReviewTable
        items={[makeReviewItem()]}
        {...defaultProps}
      />
    );

    const excludeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.textContent === "Exclure"
    );
    expect(excludeButtons.length).toBeGreaterThan(0);
    fireEvent.click(excludeButtons[0]);

    expect(defaultProps.onExcludeItems).toHaveBeenCalledWith([ITEM_ID_1]);
  });

  it("calls onIncludeItems when include button clicked on excluded item", () => {
    render(
      <TakeoffReviewTable
        items={[makeReviewItem({ is_excluded: true, exclusion_reason: "test" })]}
        {...defaultProps}
      />
    );

    const includeButton = screen.getByRole("button", { name: /inclure/i });
    fireEvent.click(includeButton);

    expect(defaultProps.onIncludeItems).toHaveBeenCalledWith([ITEM_ID_1]);
  });

  it("shows page filter when items have multiple pages", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, source_page: 1 }),
          makeReviewItem({ id: ITEM_ID_2, source_page: 3 }),
        ]}
        {...defaultProps}
      />
    );

    // Page filter should appear
    const allOptions = document.querySelectorAll("option");
    let hasPageFilter = false;
    for (const option of allOptions) {
      if (option.textContent?.trim() === "Page 1") {
        hasPageFilter = true;
        break;
      }
    }
    expect(hasPageFilter).toBe(true);
  });

  it("shows table filter when items have table_index metadata", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, metadata: { table_index: 0 } }),
          makeReviewItem({ id: ITEM_ID_2, metadata: { table_index: 1 } }),
        ]}
        {...defaultProps}
      />
    );

    const allOptions = document.querySelectorAll("option");
    let hasTableFilter = false;
    for (const option of allOptions) {
      if (option.textContent?.trim() === "Table 1") {
        hasTableFilter = true;
        break;
      }
    }
    expect(hasTableFilter).toBe(true);
  });

  it("filters by confidence: high (>=80%)", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, confidence: 0.9, designation: "High" }),
          makeReviewItem({ id: ITEM_ID_2, confidence: 0.3, designation: "Low" }),
        ]}
        {...defaultProps}
      />
    );

    const allOptions = document.querySelectorAll("option");
    let confidenceSelect: HTMLSelectElement | null = null;
    for (const option of allOptions) {
      if (option.textContent?.includes("Fiable")) {
        confidenceSelect = option.closest("select");
        break;
      }
    }
    expect(confidenceSelect).not.toBeNull();
    fireEvent.change(confidenceSelect!, { target: { value: "high" } });

    expect(screen.getByText("High")).toBeDefined();
    expect(screen.queryByText("Low")).toBeNull();
  });

  it("filters by confidence: low (<50%)", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, confidence: 0.9, designation: "High" }),
          makeReviewItem({ id: ITEM_ID_2, confidence: 0.3, designation: "Low" }),
        ]}
        {...defaultProps}
      />
    );

    const allOptions = document.querySelectorAll("option");
    let confidenceSelect: HTMLSelectElement | null = null;
    for (const option of allOptions) {
      if (option.textContent?.includes("Problematique")) {
        confidenceSelect = option.closest("select");
        break;
      }
    }
    expect(confidenceSelect).not.toBeNull();
    fireEvent.change(confidenceSelect!, { target: { value: "low" } });

    expect(screen.queryByText("High")).toBeNull();
    expect(screen.getByText("Low")).toBeDefined();
  });

  it("filters by confidence: missing (null)", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, confidence: 0.9, designation: "Scored" }),
          makeReviewItem({ id: ITEM_ID_2, confidence: null, designation: "Unscored" }),
        ]}
        {...defaultProps}
      />
    );

    const allOptions = document.querySelectorAll("option");
    let confidenceSelect: HTMLSelectElement | null = null;
    for (const option of allOptions) {
      if (option.textContent?.includes("Non evaluee")) {
        confidenceSelect = option.closest("select");
        break;
      }
    }
    expect(confidenceSelect).not.toBeNull();
    fireEvent.change(confidenceSelect!, { target: { value: "missing" } });

    expect(screen.queryByText("Scored")).toBeNull();
    expect(screen.getByText("Unscored")).toBeDefined();
  });

  it("sorts by confidence", () => {
    render(
      <TakeoffReviewTable
        items={[
          makeReviewItem({ id: ITEM_ID_1, confidence: 0.9, designation: "High" }),
          makeReviewItem({ id: ITEM_ID_2, confidence: 0.3, designation: "Low" }),
        ]}
        {...defaultProps}
      />
    );

    const allOptions = document.querySelectorAll("option");
    let sortSelect: HTMLSelectElement | null = null;
    for (const option of allOptions) {
      if (option.textContent?.trim() === "Tri: Confiance") {
        sortSelect = option.closest("select");
        break;
      }
    }
    expect(sortSelect).not.toBeNull();
    fireEvent.change(sortSelect!, { target: { value: "confidence" } });

    const rows = screen.getAllByRole("row").slice(1);
    const firstRow = rows[0]?.textContent ?? "";
    expect(firstRow).toContain("Low");
  });

  it("renders clickable confidence badge when onOpenEvidencePanel provided", () => {
    const onOpenEvidencePanel = vi.fn();
    render(
      <TakeoffReviewTable
        items={[makeReviewItem()]}
        {...defaultProps}
        onOpenEvidencePanel={onOpenEvidencePanel}
      />
    );

    // Find the confidence button (wrapping the badge)
    const confidenceBtn = screen.getAllByRole("button").find(
      (btn) => btn.getAttribute("title")?.includes("Confiance")
    );
    expect(confidenceBtn).toBeDefined();
    fireEvent.click(confidenceBtn!);

    expect(onOpenEvidencePanel).toHaveBeenCalledWith(ITEM_ID_1);
  });

  it("renders simple badge when onOpenEvidencePanel not provided", () => {
    render(
      <TakeoffReviewTable
        items={[makeReviewItem()]}
        {...defaultProps}
      />
    );

    // No clickable confidence button
    const confidenceBtn = screen.getAllByRole("button").find(
      (btn) => btn.getAttribute("title")?.includes("Confiance")
    );
    expect(confidenceBtn).toBeUndefined();

    // Badge still renders
    expect(screen.getByText("85%")).toBeDefined();
  });
});
