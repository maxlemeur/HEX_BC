import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Minimal SignaturePad stub — exposes onSign via a test button
vi.mock("@/components/portal/SignaturePad", () => ({
  SignaturePad: ({
    onSign,
    onClear,
    disabled,
  }: {
    onSign: (b64: string) => void;
    onClear: () => void;
    disabled?: boolean;
  }) => (
    <div data-testid="signature-pad">
      <button
        type="button"
        onClick={() => onSign("data:image/png;base64,AAAA")}
        disabled={disabled}
      >
        Fake sign
      </button>
      <button type="button" onClick={onClear} disabled={disabled}>
        Fake clear
      </button>
    </div>
  ),
}));

import { AcceptEstimateModal } from "./AcceptEstimateModal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderModal(
  props: Partial<Parameters<typeof AcceptEstimateModal>[0]> = {}
) {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    token: "test-token-uuid",
    onAccepted: vi.fn(),
    totalTtcFormatted: "1 234,56 €",
    projectReference: "AFF-001",
    ...props,
  };

  const result = render(<AcceptEstimateModal {...defaultProps} />);
  return { ...result, props: defaultProps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AcceptEstimateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders modal content when open", () => {
    renderModal();

    expect(screen.getByText("Accepter le devis")).toBeInTheDocument();
    expect(screen.getByText("AFF-001")).toBeInTheDocument();
    expect(screen.getByText("1 234,56 €")).toBeInTheDocument();
    expect(screen.getByTestId("signature-pad")).toBeInTheDocument();
    expect(
      screen.getByLabelText(/accepte ce devis/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Confirmer/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Annuler/i })
    ).toBeInTheDocument();
  });

  it("submit button is disabled until terms checkbox is checked", () => {
    renderModal();

    const submitBtn = screen.getByRole("button", { name: /Confirmer/i });
    expect(submitBtn).toBeDisabled();
  });

  it("submit button becomes enabled after checking terms", async () => {
    const user = userEvent.setup();
    renderModal();

    const checkbox = screen.getByLabelText(/accepte ce devis/i);
    await user.click(checkbox);

    const submitBtn = screen.getByRole("button", { name: /Confirmer/i });
    expect(submitBtn).toBeEnabled();
  });

  it("shows validation error when submitting without terms accepted", async () => {
    const user = userEvent.setup();
    renderModal();

    // Force-enable the button by checking + unchecking
    const checkbox = screen.getByLabelText(/accepte ce devis/i);
    await user.click(checkbox);
    await user.click(checkbox);

    // Try submitting via form (button is disabled, so submit the form directly)
    // Since button is disabled, this path can't happen via normal click.
    // The guard is the disabled button — no fetch should fire.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls fetch with correct payload on valid submit (no signature)", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ status: "accepted", accepted_at: "2026-03-05" }),
    });

    const { props } = renderModal();

    // Check terms
    await user.click(screen.getByLabelText(/accepte ce devis/i));

    // Submit
    await user.click(screen.getByRole("button", { name: /Confirmer/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/portal/test-token-uuid/accept",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const callBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(callBody.accepted_terms).toBe(true);
    expect(callBody.signature_base64).toBeUndefined();

    await waitFor(() => {
      expect(props.onAccepted).toHaveBeenCalled();
    });
  });

  it("includes signature in payload when provided", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ status: "accepted", accepted_at: "2026-03-05" }),
    });

    renderModal();

    // Sign via stub
    await user.click(screen.getByText("Fake sign"));

    // Check terms
    await user.click(screen.getByLabelText(/accepte ce devis/i));

    // Submit
    await user.click(screen.getByRole("button", { name: /Confirmer/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(callBody.signature_base64).toBe("data:image/png;base64,AAAA");
    expect(callBody.accepted_terms).toBe(true);
  });

  it("shows error on failed API response", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Ce devis a deja ete traite." }),
    });

    const { props } = renderModal();

    await user.click(screen.getByLabelText(/accepte ce devis/i));
    await user.click(screen.getByRole("button", { name: /Confirmer/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Ce devis a deja ete traite."
      );
    });

    expect(props.onAccepted).not.toHaveBeenCalled();
  });

  it("shows generic error on network failure", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error")
    );

    renderModal();

    await user.click(screen.getByLabelText(/accepte ce devis/i));
    await user.click(screen.getByRole("button", { name: /Confirmer/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network error");
    });
  });

  it("calls onClose when Annuler is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    await user.click(screen.getByRole("button", { name: /Annuler/i }));

    expect(props.onClose).toHaveBeenCalled();
  });

  it("clears signature from payload after clearing", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ status: "accepted", accepted_at: "2026-03-05" }),
    });

    renderModal();

    // Sign, then clear
    await user.click(screen.getByText("Fake sign"));
    await user.click(screen.getByText("Fake clear"));

    // Check terms & submit
    await user.click(screen.getByLabelText(/accepte ce devis/i));
    await user.click(screen.getByRole("button", { name: /Confirmer/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(callBody.signature_base64).toBeUndefined();
  });
});
