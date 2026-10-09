import { cleanup,fireEvent,render,screen } from "@testing-library/react";
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
        "Tous les items sont conformes. La revue peut passer a l'étape suivante."
      )
    ).toBeNull();
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

  it("forces Level C verification through the localized proof review", () => {
    const openEvidencePanel = vi.fn();
    const verifyItem = vi.fn();

    render(
      <ValidationReviewPanel
        items={[
          makeItem({
            id: "level-c-missing-page",
            confidence: 0.42,
            source_page: null,
            is_verified: false,
          }),
        ]}
        requiresLocalizedProof
        onOpenEvidencePanel={openEvidencePanel}
        onVerifyItem={verifyItem}
      />
    );

    expect(
      screen.queryByRole("button", { name: "Valider cet item" })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Localiser la source" }));
    expect(openEvidencePanel).toHaveBeenCalledWith("level-c-missing-page");
    expect(verifyItem).not.toHaveBeenCalled();
    expect(screen.getByText("Preuves localisées")).toBeInTheDocument();
    expect(screen.getByText("0 %")).toBeInTheDocument();
    expect(screen.getByText("Source ou page manquante")).toBeInTheDocument();
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

  it("closes a low-confidence exception once its localized proof is verified", () => {
    render(
      <ValidationReviewPanel
        items={[
          makeItem({
            id: "level-c-verified-low",
            confidence: 0.35,
            is_verified: true,
          }),
        ]}
        requiresLocalizedProof
        canOpenApplyWizard
      />
    );

    expect(
      screen.getByText(
        "Tous les items sont conformes. La revue peut passer a l'étape suivante."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Faible à vérifier")).toBeInTheDocument();
    expect(screen.queryByText("Confiance faible", { selector: "span" })).toBeNull();
  });
});
