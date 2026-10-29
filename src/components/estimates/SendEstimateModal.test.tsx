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
