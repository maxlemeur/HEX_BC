import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("does not claim the extraction is ready when every item is excluded", () => {
    render(
      <ValidationReviewPanel
        items={[makeItem({ is_excluded: true, exclusion_reason: "manual" })]}
      />
    );

    expect(
      screen.getByText(
        "Tous les items sont exclus. Reintegrez au moins un item pour pouvoir appliquer l'extraction."
      )
    ).toBeDefined();
    expect(
      screen.queryByText(
        "Tous les items sont conformes. La revue peut passer a l'etape suivante."
      )
    ).toBeNull();
  });

  it("prioritizes proof and source exceptions before the rest", () => {
    render(
      <ValidationReviewPanel
        items={[
          makeItem({
            id: "priority-1",
            designation: "Cloison BA13",
            confidence: 0.42,
            evidence: null,
            source_page: null,
            is_verified: false,
          }),
          makeItem({
            id: "secondary-1",
            designation: "Peinture",
            confidence: 0.91,
            evidence: "OK",
            is_verified: false,
          }),
        ]}
        dpgfSummary={{
          reliable_matches: 3,
          to_confirm: 1,
          significant_gaps: 0,
          forced_manual: 1,
          lines_without_proof: 2,
          unused_takeoff_items: 1,
          total_lines: 5,
        }}
      />
    );

    expect(
      screen.getByText("Traitez d'abord les exceptions qui peuvent biaiser le chiffrage")
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "A traiter d'abord" })
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Source incomplete" })
    ).toBeDefined();
    expect(screen.getByText("Rapprochement DPGF")).toBeDefined();
    expect(screen.getByText("Cloison BA13")).toBeDefined();
    expect(screen.getByText("Aucune preuve textuelle n'est renseignee pour cet item.")).toBeDefined();
  });

  it("surfaces human actions and async state explicitly", () => {
    const openEvidencePanel = vi.fn();
    const verifyItem = vi.fn();
    const excludeItem = vi.fn();

    render(
      <ValidationReviewPanel
        items={[
          makeItem({
            id: "action-1",
            designation: "Faux plafond",
            confidence: 0.34,
            evidence: null,
            source_file_name: null,
            source_page: null,
            is_verified: false,
            _saving: true,
          }),
        ]}
        hasDirtyOrSaving
        onOpenEvidencePanel={openEvidencePanel}
        onVerifyItem={verifyItem}
        onExcludeItem={excludeItem}
      />
    );

    expect(
      screen.getByText(
        "Sauvegarde automatique en cours. Les decisions seront confirmees dans quelques instants."
      )
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Ajouter une preuve" }));
    fireEvent.click(screen.getByRole("button", { name: "Valider cet item" }));
    fireEvent.click(screen.getByRole("button", { name: "Exclure" }));

    expect(openEvidencePanel).toHaveBeenCalledWith("action-1");
    expect(verifyItem).toHaveBeenCalledWith("action-1");
    expect(excludeItem).toHaveBeenCalledWith("action-1");
    expect(screen.getByText("Sauvegarde en cours...")).toBeDefined();
  });

  it("does not flag file-backed items as missing source context when the page anchor is absent", () => {
    render(
      <ValidationReviewPanel
        items={[
          makeItem({
            id: "file-only-source",
            confidence: 0.42,
            source_page: null,
            is_verified: false,
          }),
        ]}
      />
    );

    expect(screen.getByText("file.csv")).toBeDefined();
    expect(screen.queryByText("Source ou page manquante")).toBeNull();
  });

  it("keeps excluded items visible so they can be reintegrated immediately", () => {
    const includeItem = vi.fn();

    render(
      <ValidationReviewPanel
        items={[
          makeItem({
            id: "excluded-1",
            designation: "Gaine technique",
            is_excluded: true,
            exclusion_reason: "doublon",
          }),
        ]}
        onIncludeItem={includeItem}
      />
    );

    expect(screen.getByText("Items exclus")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reintegrer" }));
    expect(includeItem).toHaveBeenCalledWith("excluded-1");
  });
});
