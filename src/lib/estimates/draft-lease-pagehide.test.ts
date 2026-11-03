// @vitest-environment jsdom
// Failure case written before the fix (Codex review of PR #146, P2): a reload that reaches
// pagehide while its lease POST still awaits its response sends a keepalive DELETE for that
// version, but kept its identity. The reloaded document then reused it, and if it acquired or
// renewed the lease before the delayed DELETE arrived, that DELETE (scoped by version, user and
// session) deleted the new lease. Every identity released on pagehide must be retired, including
// one whose request is only in flight. The army journeys cannot hold the POST open across the
// departure, so this check does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_KEY_PREFIX = "__miaouffrageEstimateDraftLockSession:";
const VERSION_ID = "11111111-1111-4111-8111-111111111111";

function hidePage() {
  window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: false }));
}

beforeEach(() => {
  vi.resetModules();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("draft lease release on pagehide", () => {
  it("retires the identity of a lease request still in flight, so the reload gets a new one", async () => {
    const fetchMock = vi.fn((_path: string, init?: RequestInit) => (init?.method === "DELETE"
      ? Promise.resolve(new Response(JSON.stringify({ ok: true, data: { released: true } }), { status: 200, headers: { "content-type": "application/json" } }))
      : new Promise<Response>(() => undefined)));
    vi.stubGlobal("fetch", fetchMock);
    const { acquireEstimateDraftLock } = await import("@/lib/estimates/client");
    const { getEstimateDraftLockSessionId } = await import("@/lib/estimates/draft-lock-session-client");

    const identity = getEstimateDraftLockSessionId(VERSION_ID);
    expect(window.sessionStorage.getItem(`${SESSION_KEY_PREFIX}${VERSION_ID}`)).toBe(identity);
    void acquireEstimateDraftLock(VERSION_ID).catch(() => undefined);
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));

    hidePage();

    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE" && init.keepalive === true)).toBe(true));
    expect(window.sessionStorage.getItem(`${SESSION_KEY_PREFIX}${VERSION_ID}`)).not.toBe(identity);
  });
});
