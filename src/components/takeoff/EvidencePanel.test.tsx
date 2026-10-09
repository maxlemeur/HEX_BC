import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

// Mock toast (required by TakeoffReviewTable import chain)
const mockToast = {
  push: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("@/components/ui-legacy/Toast", () => ({
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
    onUpdateSourcePage: vi.fn(),
    onMarkVerified: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
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
      screen.getByRole("link", { name: /ouvrir le document source/i })
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
      screen.queryByRole("link", { name: /ouvrir le document source/i })
    ).toBeNull();
  });

  it("does not steal focus when the reviewer starts entering the source page", () => {
    let scheduledFocus: FrameRequestCallback | null = null;
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        scheduledFocus = callback;
        return 1;
      });

    try {
      render(
        <EvidencePanel
          item={makeItem({ source_page: null })}
          {...defaultProps}
          requiresLocalizedProof
        />
      );

      const editButton = screen.getByRole("button", {
        name: /modifier la preuve et la page/i,
      });
      editButton.focus();
      fireEvent.click(editButton);

      const pageInput = screen.getByRole("spinbutton", { name: /page source/i });
      pageInput.focus();
      expect(scheduledFocus).not.toBeNull();
      (scheduledFocus as FrameRequestCallback | null)?.(0);

      expect(pageInput).toHaveFocus();
    } finally {
      requestAnimationFrameSpy.mockRestore();
    }
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

  it("blocks Level C validation when the textual proof is missing", () => {
    render(
      <EvidencePanel
        item={makeItem({ evidence: null })}
        {...defaultProps}
        requiresLocalizedProof
      />
    );

    expect(screen.getByText(/Validation impossible/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /valider cet item/i })).toBeDisabled();
  });

  it("blocks Level C validation when the source page is missing", () => {
    render(
      <EvidencePanel
        item={makeItem({ source_page: null })}
        {...defaultProps}
        requiresLocalizedProof
      />
    );

    expect(screen.getByText(/La page source est absente/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /valider cet item/i })).toBeDisabled();
  });

  it("lets the reviewer add the missing Level C source page", () => {
    render(
      <EvidencePanel
        item={makeItem({ source_page: null })}
        {...defaultProps}
        requiresLocalizedProof
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /modifier la preuve et la page/i })
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: /page source/i }), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sauvegarder/i }));

    expect(defaultProps.onUpdateSourcePage).toHaveBeenCalledWith(ITEM_ID, 7);
  });

  it("keeps the Level C proof editor open when the source page is invalid", () => {
    render(
      <EvidencePanel
        item={makeItem({ source_page: null })}
        {...defaultProps}
        requiresLocalizedProof
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /modifier la preuve et la page/i })
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: /page source/i }), {
      target: { value: "0" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/supérieur à 0/i);
    expect(screen.getByRole("button", { name: /sauvegarder/i })).toBeDisabled();
    expect(defaultProps.onUpdateSourcePage).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Preuve" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton", { name: /page source/i }), {
      target: { value: "7" },
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /sauvegarder/i })).not.toBeDisabled();
  });

  it("allows Level C validation only when proof and source page are present", () => {
    render(
      <EvidencePanel
        item={makeItem()}
        {...defaultProps}
        requiresLocalizedProof
      />
    );

    const button = screen.getByRole("button", { name: /valider cet item/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(defaultProps.onMarkVerified).toHaveBeenCalledWith(ITEM_ID);
  });

  it("does not present a stored Level C verification as valid when proof is gone", () => {
    render(
      <EvidencePanel
        item={makeItem({ evidence: null, is_verified: true })}
        {...defaultProps}
        requiresLocalizedProof
      />
    );

    expect(screen.getByText("Validation incomplète")).toBeInTheDocument();
    expect(screen.getByText(/Validation à reprendre/)).toBeInTheDocument();
  });
});
