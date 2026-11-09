import { cleanup,fireEvent,render,screen,within } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";

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
  afterEach(() => {
    cleanup();
  });

  it("asks for proof control before validating a proof-ready Level C item", () => {
    const openEvidencePanel = vi.fn();

    render(
      <ValidationReviewPanel
        items={[
          makeItem({
            id: "level-c-ready",
            confidence: 0.42,
            is_verified: false,
          }),
        ]}
        requiresLocalizedProof
        onOpenEvidencePanel={openEvidencePanel}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Contrôler et valider" }));
    expect(openEvidencePanel).toHaveBeenCalledWith("level-c-ready");
  });

  // D13, D18f: the filter selects unverified lines with evidence and a confidence under 0,8 or none. No hypothesis (in
  // the D12 sense) exists yet, and the lines it selects are not all of medium confidence: it is « Confiance à confirmer ».
  it("names « Confiance à confirmer » the filter of unverified lines with evidence and confidence under 0,8 or none", () => {
    render(
      <ValidationReviewPanel
        items={[
          makeItem({ id: "medium", designation: "Tube cuivre 22", confidence: 0.6, is_verified: false }),
          makeItem({ id: "unknown", designation: "Tube cuivre 28", confidence: null, is_verified: false }),
          makeItem({ id: "missing-page", designation: "Tube PVC 110", source_page: null, is_verified: false }),
        ]}
        requiresLocalizedProof
      />
    );

    expect(screen.queryByText(/Hypothèse/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Confiance moyenne" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confiance à confirmer" }));
    expect(screen.getByText("Tube cuivre 22")).toBeTruthy();
    expect(screen.getByText("Tube cuivre 28")).toBeTruthy();
    expect(screen.queryByText("Tube PVC 110")).toBeNull();
  });

  // D18f, written before the fix: a line showed its score badge beside « Confiance faible » and « Confiance moyenne »
  // (0,42), or « Confiance inconnue » beside « Confiance moyenne » (no confidence): contradictory badges on one line.
  it("shows one confidence badge per line: faible under the low threshold, else inconnue, else moyenne", () => {
    render(
      <ValidationReviewPanel
        items={[
          makeItem({ id: "low", designation: "Tube cuivre 14", confidence: 0.42, is_verified: false }),
          makeItem({ id: "low-no-proof", designation: "Tube cuivre 12", confidence: 0.3, evidence: null, is_verified: false }),
          makeItem({ id: "unknown", designation: "Tube cuivre 16", confidence: null, is_verified: false }),
          makeItem({ id: "medium", designation: "Tube cuivre 18", confidence: 0.6, is_verified: false }),
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Tous les signaux" }));

    const confidenceBadges = (designation: string) =>
      within(screen.getByRole("article", { name: designation })).getAllByText(/^Confiance/).map((badge) => badge.textContent);
    expect(confidenceBadges("Tube cuivre 14")).toEqual(["Confiance faible"]);
    expect(confidenceBadges("Tube cuivre 12")).toEqual(["Confiance faible"]);
    expect(confidenceBadges("Tube cuivre 16")).toEqual(["Confiance inconnue"]);
    expect(confidenceBadges("Tube cuivre 18")).toEqual(["Confiance moyenne"]);
  });
});
