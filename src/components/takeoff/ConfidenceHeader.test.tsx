import { cleanup,render,screen } from "@testing-library/react";
import { afterEach,describe,expect,it } from "vitest";

import { ConfidenceHeader } from "@/components/takeoff/ConfidenceHeader";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    designation: "Tube PVC",
    quantity: 10,
    unit: "ml",
    confidence: 0.85,
    evidence: "ligne 3",
    source_file_name: "file.csv",
    source_page: 1,
    metadata: {},
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

describe("ConfidenceHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows an explicit non-evaluated state when global confidence is null", () => {
    render(
      <ConfidenceHeader globalConfidence={null} items={[makeItem()]} />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText(/Score global non calculé/)).toHaveLength(2);
  });

  it("excludes intentionally discarded items from trust indicators", () => {
    render(
      <ConfidenceHeader
        globalConfidence={0.9}
        items={[
          makeItem({ id: "included", is_verified: true }),
          makeItem({
            id: "excluded",
            is_excluded: true,
            confidence: 0.1,
            evidence: null,
            source_page: null,
          }),
        ]}
      />
    );

    expect(screen.getAllByText("1/1")).toHaveLength(2);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Distribution des items inclus : 1 à confiance élevée, 0 à confiance moyenne, 0 à confiance faible ou non évaluée"
    );
  });

  it("does not count a proof-ready verified low-confidence item as pending", () => {
    render(
      <ConfidenceHeader
        globalConfidence={0.45}
        items={[
          makeItem({
            confidence: 0.2,
            is_verified: true,
          }),
        ]}
      />
    );

    const pendingMetric = screen.getByText("À traiter").closest("div");
    expect(pendingMetric).not.toBeNull();
    expect(pendingMetric).toHaveTextContent("0");
  });
});
