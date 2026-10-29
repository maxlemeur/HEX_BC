import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

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
