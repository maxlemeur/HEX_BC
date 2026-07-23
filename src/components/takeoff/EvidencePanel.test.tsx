import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Mock toast (required by TakeoffReviewTable import chain)
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

import { EvidencePanel } from "@/components/takeoff/EvidencePanel";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

const ITEM_ID = "44444444-4444-4444-8444-444444444444";

function makeItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: ITEM_ID,
    designation: "Tube PVC 100mm",
    quantity: 12,
    unit: "ml",
    confidence: 0.85,
    evidence: "Extrait page 3, ligne 12: tube PVC diametre 100",
    source_file_name: "plan.pdf",
    source_page: 3,
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

describe("EvidencePanel", () => {
  const defaultProps = {
    itemIndex: 2,
    totalItems: 10,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onUpdateEvidence: vi.fn(),
    onMarkVerified: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders dialog with correct aria attributes", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe(
      "Evidence item: Tube PVC 100mm"
    );
  });

  it("piège le focus clavier dans le tiroir (Shift+Tab depuis le tiroir revient au dernier élément)", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);

    const dialog = screen.getByRole("dialog");
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
    );
    expect(focusable.length).toBeGreaterThan(0);
    const last = focusable[focusable.length - 1];

    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("shows item counter", () => {
    render(
      <EvidencePanel
        item={makeItem()}
        {...defaultProps}
        itemIndex={2}
        totalItems={10}
      />
    );
    expect(screen.getByText("3/10")).toBeDefined();
  });

  it("displays designation", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);
    expect(screen.getByText("Tube PVC 100mm")).toBeDefined();
  });

  it("displays confidence badge and label for high confidence", () => {
    render(
      <EvidencePanel item={makeItem({ confidence: 0.92 })} {...defaultProps} />
    );
    expect(screen.getByText("92%")).toBeDefined();
    expect(screen.getByText("Fiable")).toBeDefined();
  });

  it("displays 'A verifier' for medium confidence", () => {
    render(
      <EvidencePanel item={makeItem({ confidence: 0.65 })} {...defaultProps} />
    );
    expect(screen.getByText("65%")).toBeDefined();
    expect(screen.getByText("A verifier")).toBeDefined();
  });

  it("displays 'Problematique' for low confidence", () => {
    render(
      <EvidencePanel item={makeItem({ confidence: 0.3 })} {...defaultProps} />
    );
    expect(screen.getByText("30%")).toBeDefined();
    expect(screen.getByText("Problematique")).toBeDefined();
  });

  it("displays 'Non evaluee' for null confidence", () => {
    render(
      <EvidencePanel item={makeItem({ confidence: null })} {...defaultProps} />
    );
    expect(screen.getByText("-")).toBeDefined();
    expect(screen.getByText("Non evaluee")).toBeDefined();
  });

  it("displays source file and page", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);
    expect(screen.getByText("plan.pdf")).toBeDefined();
    expect(screen.getByText("page 3")).toBeDefined();
  });

  it("displays signed document link from metadata with page anchor", () => {
    render(
      <EvidencePanel
        item={makeItem({
          metadata: {
            category: "tuyauterie",
            signed_document_url: "https://files.example.com/plan.pdf?token=abc",
          },
          source_page: 3,
        })}
        {...defaultProps}
      />
    );

    const link = screen.getByRole("link", { name: /ouvrir document signe/i });
    expect(link.getAttribute("href")).toBe(
      "https://files.example.com/plan.pdf?token=abc#page=3"
    );
  });

  it("displays signed document link even when source file/page are absent", () => {
    render(
      <EvidencePanel
        item={makeItem({
          source_file_name: null,
          source_page: null,
          metadata: {
            category: "tuyauterie",
            signed_document_url: "https://files.example.com/plan.pdf",
          },
        })}
        {...defaultProps}
      />
    );

    expect(
      screen.getByRole("link", { name: /ouvrir document signe/i })
    ).toBeDefined();
  });

  it("does not render signed document link for unsafe urls", () => {
    render(
      <EvidencePanel
        item={makeItem({
          metadata: {
            category: "tuyauterie",
            signed_document_url: "javascript:alert('x')",
          },
        })}
        {...defaultProps}
      />
    );

    expect(
      screen.queryByRole("link", { name: /ouvrir document signe/i })
    ).toBeNull();
  });

  it("displays evidence text when present", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);
    expect(
      screen.getByText("Extrait page 3, ligne 12: tube PVC diametre 100")
    ).toBeDefined();
  });

  it("shows 'Aucune evidence' when evidence is null", () => {
    render(
      <EvidencePanel item={makeItem({ evidence: null })} {...defaultProps} />
    );
    expect(
      screen.getByText("Aucune evidence disponible.")
    ).toBeDefined();
  });

  it("shows anomalies when item has low confidence", () => {
    render(
      <EvidencePanel
        item={makeItem({ confidence: 0.3, evidence: null })}
        {...defaultProps}
      />
    );
    expect(screen.getByText("Anomalies detectees")).toBeDefined();
  });

  it("does not show anomalies box for healthy item", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);
    expect(screen.queryByText("Anomalies detectees")).toBeNull();
  });

  it("shows 'Marquer verifie' button when not verified", () => {
    render(
      <EvidencePanel
        item={makeItem({ is_verified: false })}
        {...defaultProps}
      />
    );
    expect(
      screen.getByRole("button", { name: /marquer verifie/i })
    ).toBeDefined();
  });

  it("shows 'Verifie' badge when verified", () => {
    render(
      <EvidencePanel
        item={makeItem({ is_verified: true })}
        {...defaultProps}
      />
    );
    expect(screen.getByText("Verifie")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /marquer verifie/i })
    ).toBeNull();
  });

  it("calls onMarkVerified when button clicked", () => {
    render(
      <EvidencePanel
        item={makeItem({ is_verified: false })}
        {...defaultProps}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /marquer verifie/i })
    );
    expect(defaultProps.onMarkVerified).toHaveBeenCalledWith(ITEM_ID);
  });

  it("calls onClose when close button clicked", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("calls onClose when overlay clicked", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);
    // Overlay is the first child with aria-hidden
    const overlay = document.querySelector("[aria-hidden='true']");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("calls onNavigate prev/next via nav buttons", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Item precedent" }));
    expect(defaultProps.onNavigate).toHaveBeenCalledWith("prev");

    fireEvent.click(screen.getByRole("button", { name: "Item suivant" }));
    expect(defaultProps.onNavigate).toHaveBeenCalledWith("next");
  });

  it("disables prev button at first item", () => {
    render(
      <EvidencePanel
        item={makeItem()}
        {...defaultProps}
        itemIndex={0}
        totalItems={5}
      />
    );
    const prevBtn = screen.getByRole("button", { name: "Item precedent" });
    expect(prevBtn.getAttribute("disabled")).not.toBeNull();
  });

  it("disables next button at last item", () => {
    render(
      <EvidencePanel
        item={makeItem()}
        {...defaultProps}
        itemIndex={4}
        totalItems={5}
      />
    );
    const nextBtn = screen.getByRole("button", { name: "Item suivant" });
    expect(nextBtn.getAttribute("disabled")).not.toBeNull();
  });

  it("handles keyboard Escape to close", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("handles keyboard ArrowLeft/ArrowRight to navigate", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(defaultProps.onNavigate).toHaveBeenCalledWith("prev");

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(defaultProps.onNavigate).toHaveBeenCalledWith("next");
  });

  it("enters edit mode when 'Modifier' clicked", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);

    fireEvent.click(screen.getByText("Modifier"));

    // Textarea should appear
    expect(
      screen.getByPlaceholderText("Saisir l'evidence extraite...")
    ).toBeDefined();
    // Save/Cancel buttons
    expect(
      screen.getByRole("button", { name: /sauvegarder/i })
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /annuler/i })
    ).toBeDefined();
  });

  it("saves evidence on 'Sauvegarder' click", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);

    fireEvent.click(screen.getByText("Modifier"));
    const textarea = screen.getByPlaceholderText(
      "Saisir l'evidence extraite..."
    );
    fireEvent.change(textarea, { target: { value: "Nouvelle evidence" } });
    fireEvent.click(
      screen.getByRole("button", { name: /sauvegarder/i })
    );

    expect(defaultProps.onUpdateEvidence).toHaveBeenCalledWith(
      ITEM_ID,
      "Nouvelle evidence"
    );
  });

  it("saves null when evidence is emptied", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);

    fireEvent.click(screen.getByText("Modifier"));
    const textarea = screen.getByPlaceholderText(
      "Saisir l'evidence extraite..."
    );
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(
      screen.getByRole("button", { name: /sauvegarder/i })
    );

    expect(defaultProps.onUpdateEvidence).toHaveBeenCalledWith(ITEM_ID, null);
  });

  it("cancels edit mode on 'Annuler' click", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);

    fireEvent.click(screen.getByText("Modifier"));
    const textarea = screen.getByPlaceholderText(
      "Saisir l'evidence extraite..."
    );
    fireEvent.change(textarea, { target: { value: "Changed" } });
    fireEvent.click(
      screen.getByRole("button", { name: /annuler/i })
    );

    // Should exit edit mode, original evidence visible again
    expect(
      screen.getByText("Extrait page 3, ligne 12: tube PVC diametre 100")
    ).toBeDefined();
    expect(defaultProps.onUpdateEvidence).not.toHaveBeenCalled();
  });

  it("does not navigate via keyboard while editing", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);

    fireEvent.click(screen.getByText("Modifier"));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });

    expect(defaultProps.onClose).not.toHaveBeenCalled();
    expect(defaultProps.onNavigate).not.toHaveBeenCalled();
  });

  it("shows char counter in edit mode", () => {
    render(<EvidencePanel item={makeItem()} {...defaultProps} />);

    fireEvent.click(screen.getByText("Modifier"));
    // The existing evidence length is shown
    expect(screen.getByText(/\/2000/)).toBeDefined();
  });
});
