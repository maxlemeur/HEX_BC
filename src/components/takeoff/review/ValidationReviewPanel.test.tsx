import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ValidationReviewPanel } from "@/components/takeoff/review/ValidationReviewPanel";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "44444444-4444-4444-8444-444444444444",
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
    is_verified: true,
    verified_at: "2026-02-25T10:00:00.000Z",
    verified_by: "reviewer@example.com",
    created_at: "2026-02-25T09:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
    _dirty: false,
    _saving: false,
    _error: null,
    ...overrides,
  };
}

describe("ValidationReviewPanel", () => {
  it("does not claim the extraction is ready when every item is excluded", () => {
    render(
      <ValidationReviewPanel
        items={[makeItem({ is_excluded: true, exclusion_reason: "manual" })]}
        onApplyClick={vi.fn()}
        isApplyReady={false}
      />
    );

    expect(
      screen.getByText(
        "Tous les items sont exclus. Reintegrez au moins un item pour pouvoir appliquer l'extraction."
      )
    ).toBeDefined();
    expect(
      screen.queryByText(
        "Tous les items sont conformes. L'extraction est prete a etre appliquee."
      )
    ).toBeNull();
  });
});
