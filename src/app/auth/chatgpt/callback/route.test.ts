import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn().mockResolvedValue({ userId: "fixture-user", tenantId: "fixture-tenant" }) }));
vi.mock("@/lib/ai/chatgpt-local-auth", async (loadActual) => ({
  ...await loadActual<typeof import("@/lib/ai/chatgpt-local-auth")>(),
  finishLocalChatGptSignIn: vi.fn().mockResolvedValue(undefined),
}));
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { finishLocalChatGptSignIn } from "@/lib/ai/chatgpt-local-auth";
import { ChatGptSignInError } from "@/lib/ai/chatgpt-sign-in-errors";
import { GET } from "@/app/auth/chatgpt/callback/route";

const request = () => new NextRequest("http://localhost:3000/auth/chatgpt/callback?code=fixture-code&state=fixture-state&client_id=agent_fixture", {
  headers: { host: "127.0.0.1:3000", cookie: "mergeone-chatgpt-transaction=fixture-state" },
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1"); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("CI", ""); vi.stubEnv("VERCEL", "");
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

it("keeps production and foreign-host callbacks disabled", async () => {
  vi.stubEnv("NODE_ENV", "production"); expect((await GET(request())).status).toBe(404);
  vi.stubEnv("NODE_ENV", "test");
  expect((await GET(new NextRequest("http://evil.test/auth/chatgpt/callback", { headers: { host: "evil.test" } }))).status).toBe(404);
  expect(getAuthenticatedContext).not.toHaveBeenCalled();
});
