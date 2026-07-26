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

  it("renders nothing when globalConfidence is null", () => {
    const { container } = render(
      <ConfidenceHeader globalConfidence={null} items={[makeItem()]} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders gauge with correct percentage", () => {
    render(
      <ConfidenceHeader globalConfidence={0.78} items={[makeItem()]} />
    );
    expect(screen.getByText("78%")).toBeDefined();
  });

  it("shows 'Extraction fiable' for high confidence (>=85%)", () => {
    render(
      <ConfidenceHeader globalConfidence={0.92} items={[makeItem()]} />
    );
    expect(screen.getByText("Extraction fiable")).toBeDefined();
  });

  it("shows 'Qualite correcte' for medium confidence (60-84%)", () => {
    render(
      <ConfidenceHeader globalConfidence={0.72} items={[makeItem()]} />
    );
    // Text appears in visible label and sr-only
    expect(
      screen.getAllByText(/Qualite correcte/).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Qualite insuffisante' for low confidence (<60%)", () => {
    render(
      <ConfidenceHeader globalConfidence={0.45} items={[makeItem()]} />
    );
    expect(
      screen.getAllByText(/Qualite insuffisante/).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("has accessible region role and aria-label", () => {
    render(
      <ConfidenceHeader globalConfidence={0.85} items={[makeItem()]} />
    );
    const region = screen.getByRole("region");
    expect(region.getAttribute("aria-label")).toBe(
      "Confiance globale de l'extraction"
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
      "Distribution: 2 fiable, 1 a verifier, 2 problematique"
    );
  });

  it("shows legend counts matching buckets", () => {
    const items = [
      makeItem({ id: "b1", confidence: 0.9 }),
      makeItem({ id: "b2", confidence: 0.65 }),
      makeItem({ id: "b3", confidence: 0.2 }),
    ];

    render(<ConfidenceHeader globalConfidence={0.75} items={items} />);

    expect(screen.getByText("Fiable")).toBeDefined();
    expect(screen.getByText("À vérifier")).toBeDefined();
    expect(screen.getByText("Problematique")).toBeDefined();
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
    expect(srOnly!.textContent).toContain("Confiance globale: 78%");
  });
});
