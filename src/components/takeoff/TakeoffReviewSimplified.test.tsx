import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

import { TakeoffReviewSimplified } from "@/components/takeoff/TakeoffReviewSimplified";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

const ITEM_ID_1 = "44444444-4444-4444-8444-444444444444";
const ITEM_ID_2 = "55555555-5555-4555-8555-555555555555";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
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

describe("TakeoffReviewSimplified", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps an item pending until exclusion is confirmed", async () => {
    const onExcludeItems = vi.fn();
    const onIncludeItems = vi.fn();
    const onApplyClick = vi.fn();
    const item = makeItem();
    const { rerender } = render(
      <TakeoffReviewSimplified
        items={[item]}
        onExcludeItems={onExcludeItems}
        onIncludeItems={onIncludeItems}
        onApplyClick={onApplyClick}
        isApplyReady
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Rejeter" }));

    expect(onExcludeItems).toHaveBeenCalledWith([ITEM_ID_1]);
    expect(screen.getByText("Progression : 0/1 items revus")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rejete" })).toBeNull();

    rerender(
      <TakeoffReviewSimplified
        items={[
          makeItem({
            is_excluded: true,
            exclusion_reason: "Doublon",
          }),
        ]}
        onExcludeItems={onExcludeItems}
        onIncludeItems={onIncludeItems}
        onApplyClick={onApplyClick}
        isApplyReady
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Rejete" })).toBeInTheDocument();
    });
    expect(screen.getByText("Progression : 1/1 items revus")).toBeInTheDocument();
  });

  it("re-includes previously excluded rows when accepting all", async () => {
    const onExcludeItems = vi.fn();
    const onIncludeItems = vi.fn();
    const onApplyClick = vi.fn();
    const includedItem = makeItem({ id: ITEM_ID_1 });
    const excludedItem = makeItem({
      id: ITEM_ID_2,
      designation: "Vis",
      is_excluded: true,
      exclusion_reason: "Doublon",
    });
    const { rerender } = render(
      <TakeoffReviewSimplified
        items={[includedItem, excludedItem]}
        onExcludeItems={onExcludeItems}
        onIncludeItems={onIncludeItems}
        onApplyClick={onApplyClick}
        isApplyReady
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Tout accepter/ }));

    expect(onIncludeItems).toHaveBeenCalledWith([ITEM_ID_2]);
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "2 items acceptes",
      })
    );

    rerender(
      <TakeoffReviewSimplified
        items={[
          includedItem,
          makeItem({
            id: ITEM_ID_2,
            designation: "Vis",
            is_excluded: false,
            exclusion_reason: null,
          }),
        ]}
        onExcludeItems={onExcludeItems}
        onIncludeItems={onIncludeItems}
        onApplyClick={onApplyClick}
        isApplyReady
      />
    );

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Accepte" })).toHaveLength(2);
    });
    expect(screen.getByText("2 item(s) pret(s) a appliquer")).toBeInTheDocument();
  });
});
