import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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

  it("renders gauge with correct percentage", () => {
    render(
      <ConfidenceHeader globalConfidence={0.78} items={[makeItem()]} />
    );
    expect(screen.getByText("78%")).toBeDefined();
  });

  it("describes a high automatic score without claiming reliability", () => {
    render(
      <ConfidenceHeader globalConfidence={0.92} items={[makeItem()]} />
    );
    expect(screen.getAllByText(/Score d’extraction élevé/)).toHaveLength(2);
    expect(screen.queryByText("Extraction fiable")).toBeNull();
  });

  it("uses the shared 50% threshold for a medium score", () => {
    render(
      <ConfidenceHeader globalConfidence={0.5} items={[makeItem()]} />
    );
    expect(screen.getAllByText(/Score d’extraction moyen/)).toHaveLength(2);
  });

  it("shows a review requirement for a low score", () => {
    render(
      <ConfidenceHeader globalConfidence={0.45} items={[makeItem()]} />
    );
    expect(screen.getAllByText(/Score d’extraction faible/)).toHaveLength(2);
  });

  it("has accessible region role and aria-label", () => {
    render(
      <ConfidenceHeader globalConfidence={0.85} items={[makeItem()]} />
    );
    const region = screen.getByRole("region");
    expect(region.getAttribute("aria-label")).toBe(
      "Indicateurs de confiance du métré"
    );
  });

  it("buckets items correctly into high/medium/low", () => {
    const items = [
      makeItem({ id: "a1", confidence: 0.95 }), // high
      makeItem({ id: "a2", confidence: 0.85 }), // high
      makeItem({ id: "a3", confidence: 0.6 }),  // medium
      makeItem({ id: "a4", confidence: 0.3 }),  // low
      makeItem({ id: "a5", confidence: null }),  // low (null -> low)
    ];

    render(<ConfidenceHeader globalConfidence={0.8} items={items} />);

    // Distribution bar aria-label
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("aria-label")).toBe(
      "Distribution des items inclus : 2 à confiance élevée, 1 à confiance moyenne, 2 à confiance faible ou non évaluée"
    );
  });

  it("shows legend counts matching buckets", () => {
    const items = [
      makeItem({ id: "b1", confidence: 0.9 }),
      makeItem({ id: "b2", confidence: 0.65 }),
      makeItem({ id: "b3", confidence: 0.2 }),
    ];

    render(<ConfidenceHeader globalConfidence={0.75} items={items} />);

    expect(screen.getByText("Élevée")).toBeDefined();
    expect(screen.getByText("Moyenne")).toBeDefined();
    expect(screen.getByText("Faible ou non évaluée")).toBeDefined();
  });

  it("includes sr-only full description", () => {
    render(
      <ConfidenceHeader
        globalConfidence={0.78}
        items={[makeItem({ confidence: 0.9 })]}
      />
    );

    const srOnly = document.querySelector(".sr-only");
    expect(srOnly).not.toBeNull();
    expect(srOnly!.textContent).toContain("Confiance automatique : 78%");
    expect(srOnly!.textContent).toContain("1 preuves localisées");
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
