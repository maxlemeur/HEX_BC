import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn().mockResolvedValue({ userId: "fixture-user", tenantId: "fixture-tenant" }) }));
vi.mock("@/lib/ai/chatgpt-local-auth", async (loadActual) => ({
  ...await loadActual<typeof import("@/lib/ai/chatgpt-local-auth")>(),
  relayLocalChatGptCallback: vi.fn().mockResolvedValue(null),
  finishLocalChatGptSignIn: vi.fn().mockResolvedValue(undefined),
}));
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { relayLocalChatGptCallback, finishLocalChatGptSignIn } from "@/lib/ai/chatgpt-local-auth";
import { ChatGptSignInError } from "@/lib/ai/chatgpt-sign-in-errors";
import { GET } from "@/app/auth/chatgpt/callback/route";

const request = () => new NextRequest("http://localhost:3000/auth/chatgpt/callback?code=fixture-code&state=fixture-state&client_id=agent_fixture", {
  headers: { host: "127.0.0.1:3000", cookie: "mergeone-chatgpt-transaction=fixture-state" },
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1"); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("CI", ""); vi.stubEnv("VERCEL", "");
  vi.stubEnv("PORT", ""); vi.stubEnv("MERGEONE_DEV_HOSTS", "");
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ userId: "fixture-user", tenantId: "fixture-tenant" } as never);
  vi.mocked(finishLocalChatGptSignIn).mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("reports a typed failure without leaking callback credentials or arbitrary exception text", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(finishLocalChatGptSignIn).mockRejectedValueOnce(new ChatGptSignInError("registration"));
  const response = await GET(request());
  const location = response.headers.get("location")!;
  expect(new URL(location).searchParams.get("chatgpt_error")).toBe("registration");
  expect(location).not.toContain("fixture-code"); expect(location).not.toContain("fixture-state");
  expect(log).toHaveBeenCalledWith("chatgpt.sign_in.failed", { reason: "registration" });
  vi.mocked(finishLocalChatGptSignIn).mockRejectedValueOnce(new Error("credential=do-not-disclose"));
  const unknown = await GET(request());
  expect(unknown.headers.get("location")).not.toContain("do-not-disclose");
  expect(log).toHaveBeenLastCalledWith("chatgpt.sign_in.failed", { reason: "unknown" });
});

it("keeps production and malformed-host callbacks disabled", async () => {
  vi.stubEnv("NODE_ENV", "production"); expect((await GET(request())).status).toBe(404);
  vi.stubEnv("NODE_ENV", "test");
  expect((await GET(new NextRequest("http://evil.test/auth/chatgpt/callback", { headers: { host: "user@evil.test" } }))).status).toBe(404);
  expect(getAuthenticatedContext).not.toHaveBeenCalled();
});

it("refuses an unlisted host or unexpected protocol before relaying the code", async () => {
  const cases: Array<Record<string, string>> = [
    { host: "192.168.1.42:3000" },
    { host: "mergeone.dev.test", "x-forwarded-proto": "https" },
    { host: "127.0.0.1:3000", "x-forwarded-proto": "javascript" },
    { host: "evil.test" },
  ];
  for (const headers of cases) {
    const response = await GET(new NextRequest("http://127.0.0.1:3000/auth/chatgpt/callback?code=fixture-code&state=fixture-state", { headers }));
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  }
  expect(relayLocalChatGptCallback).not.toHaveBeenCalled();
  expect(finishLocalChatGptSignIn).not.toHaveBeenCalled();
  expect(getAuthenticatedContext).not.toHaveBeenCalled();
});

it("does not redirect a relay target outside the allowlist", async () => {
  for (const target of ["http://192.168.1.42:3000/auth/chatgpt/callback?code=fixture-code&state=fixture-state", "https://mergeone.dev.test/auth/chatgpt/callback?code=fixture-code&state=fixture-state"]) {
    vi.mocked(relayLocalChatGptCallback).mockResolvedValueOnce(new URL(target));
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("location") ?? "").not.toContain("code=");
    expect(finishLocalChatGptSignIn).not.toHaveBeenCalled();
  }
});


it("preserves an HTTPS development origin through the callback and redirect", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("MERGEONE_CHATGPT_LOCAL", ""); vi.stubEnv("MERGEONE_DEV_HOSTS", "mergeone.dev.test");
  const response = await GET(new NextRequest("http://localhost:3000/auth/chatgpt/callback?code=fixture-code&state=fixture-state", {
    headers: { host: "mergeone.dev.test", "x-forwarded-proto": "https", cookie: "mergeone-chatgpt-transaction=fixture-state" },
  }));
  expect(response.headers.get("location")).toBe("https://mergeone.dev.test/dashboard/profile?chatgpt=connected");
  expect(vi.mocked(finishLocalChatGptSignIn).mock.calls[0][1].origin).toBe("https://mergeone.dev.test");
});


it("relays the loopback response without using a session or clearing the original browser cookie", async () => {
  const target = new URL("http://localhost:3000/auth/chatgpt/callback?code=fixture-code&state=fixture-state");
  vi.mocked(relayLocalChatGptCallback).mockResolvedValueOnce(target);
  const response = await GET(request());
  expect(response.headers.get("location")).toBe(target.toString());
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(getAuthenticatedContext).not.toHaveBeenCalled();
  expect(finishLocalChatGptSignIn).not.toHaveBeenCalled();
});
