import { act,cleanup,render,screen,waitFor } from "@testing-library/react";
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
import { ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE } from "@/lib/email/send-estimate-contract";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_VERSION_ID = "22222222-2222-4222-8222-222222222222";
function successfulSend(messageId: string | null = "email-1") {
  return (url: RequestInfo | URL, options?: RequestInit) => Promise.resolve({
    ok: true,
    json: async () => ({ ok: true, data: {
      version_id: String(url).split("/").at(-2),
      request_id: new Headers(options?.headers).get("Idempotency-Key"),
      message_id: messageId,
    } }),
  } as Response);
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderModal(props: Partial<Parameters<typeof SendEstimateModal>[0]> = {}) {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    versionId: VERSION_ID,
    // These retained tests cover the form and request replay for an already sent
    // offer. Draft lease ownership is asserted through real HTTP by OF00/OF0L.
    versionStatus: "sent" as const,
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

  it.each([
    ["empty response", null],
    ["failure envelope", { ok: false, error: { message: "Unconfirmed" } }],
    ["missing receipt", { ok: true }],
    ["bare receipt", { message_id: "email-1" }],
  ])("does not confirm a successful HTTP status with %s", async (_label, body) => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);
    const { props } = renderModal({ defaultRecipient: "client@test.com" });

    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    await screen.findByRole("alert");
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(props.onSent).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage.length).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores a late confirmation after navigating from A to B and back to A", async () => {
    const user = userEvent.setup();
    let resolveResponse!: (response: Response) => void;
    vi.mocked(global.fetch).mockReturnValueOnce(new Promise((resolve) => { resolveResponse = resolve; }));
    const { props, rerender } = renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    rerender(<SendEstimateModal {...props} versionId={OTHER_VERSION_ID} />);
    rerender(<SendEstimateModal {...props} />);

    const [url, options] = vi.mocked(global.fetch).mock.calls[0];
    await act(async () => resolveResponse(await successfulSend()(url, options)));

    expect(mockToast.success).not.toHaveBeenCalled();
    expect(props.onSent).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage.length).toBe(1);
  });

  it.each(["close and reopen", "unmount"])("ignores a confirmation whose JSON arrives after %s", async (navigation) => {
    const user = userEvent.setup();
    let resolveBody!: (value: unknown) => void;
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => new Promise((resolve) => { resolveBody = resolve; }),
    } as Response);
    const { props, rerender, unmount } = renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    if (navigation === "unmount") unmount();
    else {
      rerender(<SendEstimateModal {...props} open={false} />);
      rerender(<SendEstimateModal {...props} />);
    }
    const requestId = new Headers(vi.mocked(global.fetch).mock.calls[0][1]?.headers).get("Idempotency-Key");
    await act(async () => resolveBody({ ok: true, data: {
      version_id: VERSION_ID, request_id: requestId, message_id: null,
    } }));

    expect(mockToast.success).not.toHaveBeenCalled();
    expect(props.onSent).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(globalThis.sessionStorage.length).toBe(1);
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it("does not let an old named rejection clear the pending request in a reopened dialog", async () => {
    const user = userEvent.setup();
    let resolveBody!: (value: unknown) => void;
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false, json: () => new Promise((resolve) => { resolveBody = resolve; }),
    } as Response).mockImplementationOnce(successfulSend(null));
    const { props, rerender } = renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    rerender(<SendEstimateModal {...props} open={false} />);
    rerender(<SendEstimateModal {...props} />);
    await act(async () => resolveBody({ ok: false, error: {
      code: "ESTIMATE_EMAIL_PROVIDER_REJECTED", message: "Old rejection",
    } }));

    expect(screen.queryByText("Old rejection")).not.toBeInTheDocument();
    expect(screen.getByText(ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE)).toBeInTheDocument();
    expect(globalThis.sessionStorage.length).toBe(1);
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await waitFor(() => expect(props.onSent).toHaveBeenCalledOnce());
    const calls = vi.mocked(global.fetch).mock.calls;
    expect(new Headers(calls[1][1]?.headers).get("Idempotency-Key"))
      .toBe(new Headers(calls[0][1]?.headers).get("Idempotency-Key"));
  });

  it("confirms a valid historical replay with no provider identifier", async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch).mockImplementationOnce(successfulSend(null));
    const { props } = renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await waitFor(() => expect(props.onSent).toHaveBeenCalledOnce());
    expect(mockToast.success).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(globalThis.sessionStorage.length).toBe(0);
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

  it("keeps an unsent email draft when cancelling and reopening the same version", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderModal();
    await user.type(screen.getByLabelText(/Destinataire/), "prepared@test.com");
    await user.clear(screen.getByLabelText(/Objet/));
    await user.type(screen.getByLabelText(/Objet/), "Prepared subject");
    await user.click(screen.getByRole("button", { name: /Annuler/ }));
    rerender(<SendEstimateModal {...props} open={false} />);
    rerender(<SendEstimateModal {...props} />);
    expect(screen.getByLabelText(/Destinataire/)).toHaveValue("prepared@test.com");
    expect(screen.getByLabelText(/Objet/)).toHaveValue("Prepared subject");
    expect(screen.getByLabelText(/Objet/)).toBeEnabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("parses CC emails separated by commas", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(successfulSend("e1"));

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
      .mockImplementationOnce(successfulSend("email-1"));

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

  it("keeps the attempted payload and request key frozen after an ambiguous response", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Temporary provider failure" }),
      })
      .mockImplementationOnce(successfulSend("email-2"));

    renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await screen.findByText("Temporary provider failure");

    const subjectInput = screen.getByLabelText(/Objet/);
    expect(subjectInput).toBeDisabled();
    await user.type(subjectInput, " modifie");
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const firstHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]
      .headers as Record<string, string>;
    const secondHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1]
      .headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(
      firstHeaders["Idempotency-Key"]
    );
    const calls = vi.mocked(global.fetch).mock.calls;
    expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledOnce());
  });

  it("rotates the idempotency key after a deterministic provider rejection", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            ok: false,
            error: {
              code: "ESTIMATE_EMAIL_PROVIDER_REJECTED",
              message: "Recipient rejected",
            },
          }),
      })
      .mockImplementationOnce(successfulSend("email-corrected"));

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
            ok: false,
            error: {
              code: "ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST",
              message: "A new request is required",
            },
          }),
      })
      .mockImplementationOnce(successfulSend("email-fresh"));

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
      .mockImplementationOnce(successfulSend("email-1"));

    const firstRender = renderModal({ defaultRecipient: "client@test.com" });
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await screen.findByText("Network response lost");
    await user.click(screen.getByRole("button", { name: /Annuler/ }));
    expect(globalThis.sessionStorage.length).toBe(1);
    firstRender.unmount();

    renderModal({ defaultRecipient: "someone-else@test.com", defaultSubject: "Changed default" });
    expect(screen.getByLabelText(/Destinataire/)).toHaveValue("client@test.com");
    expect(screen.getByLabelText(/Objet/)).toHaveValue("Devis - Mon Projet");
    expect(screen.getByLabelText(/Objet/)).toBeDisabled();
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
