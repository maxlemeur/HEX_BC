import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};

vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => mockToast,
}));

import { SendEstimateModal } from "@/components/estimates/SendEstimateModal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderModal(props: Partial<Parameters<typeof SendEstimateModal>[0]> = {}) {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    versionId: "version-123",
    defaultSubject: "Devis - Mon Projet",
    defaultRecipient: "",
    onSent: vi.fn(),
    ...props,
  };

  const result = render(<SendEstimateModal {...defaultProps} />);
  return { ...result, props: defaultProps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SendEstimateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    globalThis.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    globalThis.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows error on invalid CC email", async () => {
    const user = userEvent.setup();
    renderModal();

    const toInput = screen.getByLabelText(/Destinataire/);
    await user.type(toInput, "valid@test.com");

    const ccInput = screen.getByLabelText(/CC/);
    await user.type(ccInput, "bad-email");

    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Adresse CC invalide : bad-email"
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("parses CC emails separated by commas", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ email_id: "e1" }),
    });

    renderModal();

    const toInput = screen.getByLabelText(/Destinataire/);
    await user.type(toInput, "main@test.com");

    const ccInput = screen.getByLabelText(/CC/);
    await user.type(ccInput, "cc1@test.com, cc2@test.com");

    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(callBody.cc).toEqual(["cc1@test.com", "cc2@test.com"]);
  });

  it("reuses the same idempotency key when the same submission is retried", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Temporary provider failure" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message_id: "email-1" }),
      });

    renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await screen.findByText("Temporary provider failure");
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const firstHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    const secondHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1]
      .headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
  });

  it("rotates the idempotency key after the attempted payload is edited", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Temporary provider failure" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message_id: "email-2" }),
      });

    renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await screen.findByText("Temporary provider failure");

    const subjectInput = screen.getByLabelText(/Objet/);
    await user.type(subjectInput, " modifie");
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const firstHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    const secondHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1]
      .headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).not.toBe(
      firstHeaders["Idempotency-Key"]
    );
  });

  it("rotates the idempotency key after a deterministic provider rejection", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: "ESTIMATE_EMAIL_PROVIDER_REJECTED",
              message: "Recipient rejected",
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message_id: "email-corrected" }),
      });

    renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await screen.findByText("Recipient rejected");
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const firstHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    const secondHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1]
      .headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).not.toBe(
      firstHeaders["Idempotency-Key"]
    );
  });

  it("rotates a persisted key when the frozen failed dispatch requires a new request", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Network response lost" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: "ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST",
              message: "A new request is required",
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message_id: "email-fresh" }),
      });

    const firstRender = renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await screen.findByText("Network response lost");
    await user.click(screen.getByRole("button", { name: /Annuler/ }));
    firstRender.unmount();

    renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await screen.findByText("A new request is required");
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    const firstHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    const secondHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1]
      .headers as Record<string, string>;
    const thirdHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[2][1]
      .headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
    expect(thirdHeaders["Idempotency-Key"]).not.toBe(
      firstHeaders["Idempotency-Key"]
    );
  });

  it("recovers an unconfirmed idempotency key after closing and reopening", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Network response lost" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message_id: "email-1" }),
      });

    const firstRender = renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await screen.findByText("Network response lost");
    await user.click(screen.getByRole("button", { name: /Annuler/ }));
    expect(globalThis.sessionStorage.length).toBe(1);
    firstRender.unmount();

    renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const firstHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    const secondHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1]
      .headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
    await waitFor(() => expect(globalThis.sessionStorage.length).toBe(0));
  });
});
