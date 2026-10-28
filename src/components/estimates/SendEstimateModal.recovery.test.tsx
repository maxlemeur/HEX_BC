import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchEstimateEditorData: vi.fn(),
  fetchEstimateSendGating: vi.fn(),
  lockOwned: true,
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/ui-legacy/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/hooks/useDraftLock", () => ({
  useDraftLock: () => ({ isOwnedByCurrentUser: mocks.lockOwned, isLockedByOther: false, error: null }),
}));
vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateEditorData: mocks.fetchEstimateEditorData,
  fetchEstimateSendGating: mocks.fetchEstimateSendGating,
}));
vi.mock("@/components/estimates/EstimatePdfDownloadButton", () => ({
  EstimatePdfDownloadButton: () => <button type="button">Préparer PDF</button>,
}));

import { SendEstimateModal } from "@/components/estimates/SendEstimateModal";
import { readPendingEstimateEmail } from "@/lib/email/pending-estimate-email";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const OLD = "2026-10-28T12:00:00.000Z";
const NEW = "2026-10-28T12:01:00.000Z";

function props(updatedAt = OLD) {
  return { open: true, onClose: vi.fn(), versionId: VERSION_ID, versionStatus: "draft" as const,
    versionUpdatedAt: updatedAt, defaultRecipient: "client@example.com", defaultSubject: "Devis", onSent: vi.fn() };
}

function receipt(url: RequestInfo | URL, init?: RequestInit) {
  return Response.json({ ok: true, data: { version_id: String(url).split("/").at(-2),
    request_id: new Headers(init?.headers).get("Idempotency-Key"), message_id: "email-1" } });
}

describe("draft email recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.lockOwned = true;
    global.fetch = vi.fn();
    mocks.fetchEstimateSendGating.mockResolvedValue({ blockingFlags: [], warningFlags: [] });
    mocks.fetchEstimateEditorData.mockResolvedValue({ version: { id: VERSION_ID, status: "draft", updated_at: NEW } });
  });
  afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

  it("reuses the same request after conflict, explicit review and reopening with a fresh version", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: false, error: {
      code: "VERSION_CONFLICT", message: "Le devis a changé.",
    } }, { status: 409 })).mockImplementationOnce(async (url, init) => receipt(url, init));
    const initial = props();
    const first = render(<SendEstimateModal {...initial} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByText(/Fermez.*relisez/i);
    const original = readPendingEstimateEmail(VERSION_ID);
    expect(original).toMatchObject({ concurrencyToken: OLD, requiresDraftReview: true });
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
    first.rerender(<SendEstimateModal {...props(NEW)} />);
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
    first.unmount();

    const second = render(<SendEstimateModal {...props()} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(mocks.fetchEstimateEditorData).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
    expect(readPendingEstimateEmail(VERSION_ID)).toEqual(original);
    second.rerender(<SendEstimateModal {...props()} open={false} />);
    const refreshed = props(NEW);
    second.rerender(<SendEstimateModal {...refreshed} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(refreshed.onSent).toHaveBeenCalledOnce());
    expect(mocks.fetchEstimateEditorData).toHaveBeenCalledWith(VERSION_ID);
    const [firstCall, secondCall] = vi.mocked(fetch).mock.calls;
    expect(new Headers(firstCall[1]?.headers).get("If-Match")).toBe(OLD);
    expect(new Headers(secondCall[1]?.headers).get("If-Match")).toBe(NEW);
    expect(new Headers(secondCall[1]?.headers).get("Idempotency-Key")).toBe(original?.requestId);
    expect(secondCall[1]?.body).toBe(firstCall[1]?.body);
    expect(readPendingEstimateEmail(VERSION_ID)).toBeNull();
  });

  it("does not change the pending request when the reread no longer matches the reopened draft", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: false, error: {
      code: "VERSION_CONFLICT", message: "Le devis a changé.",
    } }, { status: 409 }));
    const first = render(<SendEstimateModal {...props()} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByText(/Fermez.*relisez/i);
    const pending = readPendingEstimateEmail(VERSION_ID);
    first.unmount();
    mocks.fetchEstimateEditorData.mockResolvedValue({ version: { id: VERSION_ID, status: "draft", updated_at: "2026-10-28T12:02:00.000Z" } });
    render(<SendEstimateModal {...props(NEW)} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByText(/Fermez.*relisez/i);
    expect(fetch).toHaveBeenCalledOnce();
    expect(readPendingEstimateEmail(VERSION_ID)).toEqual(pending);
  });

  it("requires the draft lock before resuming a reviewed conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: false, error: {
      code: "VERSION_CONFLICT", message: "Le devis a changé.",
    } }, { status: 409 }));
    const first = render(<SendEstimateModal {...props()} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByText(/Fermez.*relisez/i);
    first.unmount();
    mocks.lockOwned = false;
    render(<SendEstimateModal {...props(NEW)} />);
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts a reread version whose timestamp changed within one millisecond", async () => {
    const user = userEvent.setup();
    const before = "2026-10-28T12:00:00.123456Z";
    const after = "2026-10-28T12:00:00.123789Z";
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: false, error: {
      code: "VERSION_CONFLICT", message: "Le devis a changé.",
    } }, { status: 409 })).mockImplementationOnce(async (url, init) => receipt(url, init));
    const first = render(<SendEstimateModal {...props(before)} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByText(/Fermez.*relisez/i);
    const id = readPendingEstimateEmail(VERSION_ID)?.requestId;
    first.unmount();
    mocks.fetchEstimateEditorData.mockResolvedValue({ version: { id: VERSION_ID, status: "draft", updated_at: after } });
    const refreshed = props(after);
    render(<SendEstimateModal {...refreshed} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(refreshed.onSent).toHaveBeenCalledOnce());
    const headers = new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers);
    expect(headers.get("If-Match")).toBe(after);
    expect(headers.get("Idempotency-Key")).toBe(id);
  });

  it("can retry the same reviewed token after an aborted transaction", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: false, error: {
      code: "VERSION_CONFLICT", message: "Le devis a changé.",
    } }, { status: 409 })).mockImplementationOnce(async (url, init) => receipt(url, init));
    const initial = props();
    const first = render(<SendEstimateModal {...initial} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByText(/Fermez.*relisez/i);
    const id = readPendingEstimateEmail(VERSION_ID)?.requestId;
    first.unmount();
    mocks.fetchEstimateEditorData.mockResolvedValue({ version: { id: VERSION_ID, status: "draft", updated_at: OLD } });
    const reread = props();
    render(<SendEstimateModal {...reread} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(reread.onSent).toHaveBeenCalledOnce());
    const headers = new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers);
    expect(headers.get("If-Match")).toBe(OLD);
    expect(headers.get("Idempotency-Key")).toBe(id);
  });

  it("does not refresh the token or identity after an ambiguous network failure alone", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network"))
      .mockImplementationOnce(async (url, init) => receipt(url, init));
    const first = render(<SendEstimateModal {...props()} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await screen.findByRole("alert");
    const pending = readPendingEstimateEmail(VERSION_ID);
    first.unmount();
    const refreshed = props(NEW);
    render(<SendEstimateModal {...refreshed} />);
    await user.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(refreshed.onSent).toHaveBeenCalledOnce());
    const secondCall = vi.mocked(fetch).mock.calls[1];
    expect(new Headers(secondCall[1]?.headers).get("If-Match")).toBe(OLD);
    expect(new Headers(secondCall[1]?.headers).get("Idempotency-Key")).toBe(pending?.requestId);
    expect(mocks.fetchEstimateEditorData).not.toHaveBeenCalled();
  });
});
