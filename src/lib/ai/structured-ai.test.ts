import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers({ host: "127.0.0.1:3000" })) }));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn().mockResolvedValue({ userId: "user", tenantId: "tenant" }) }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ readChatGptStore: vi.fn().mockResolvedValue({ selectedId: "profile", profiles: [] }) }));
vi.mock("@/lib/ai/chatgpt-local-inference", () => ({ callLocalChatGptStructured: vi.fn() }));
vi.mock("@/lib/takeoff/gemini-client", () => ({ callGeminiStructured: vi.fn().mockResolvedValue({ data: { ok: true }, model: "gemini-model" }) }));
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";
import { callStructuredAi } from "@/lib/ai/structured-ai";

const options = { prompt: "test", schema: z.object({ ok: z.boolean() }) };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL", ""); vi.stubEnv("CI", ""); vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1"); });
afterEach(() => vi.unstubAllEnvs());
it("never falls back to the paid API after a selected ChatGPT connection fails", async () => {
  vi.mocked(callLocalChatGptStructured).mockRejectedValue(new Error("quota"));
  await expect(callStructuredAi(options)).rejects.toThrow("quota");
  expect(callGeminiStructured).not.toHaveBeenCalled();
});
it("uses the existing provider outside the local opt-in without accessing local identities", async () => {
  vi.stubEnv("NODE_ENV", "production");
  expect((await callStructuredAi(options)).provider).toBe("gemini");
  expect(getAuthenticatedContext).not.toHaveBeenCalled();
});
it("uses the verified workflow creator without consulting HTTP identity", async () => {
  vi.mocked(callLocalChatGptStructured).mockResolvedValue({ data: { ok: true } } as never);
  await callStructuredAi(options, { userId: "creator", tenantId: "work-tenant" });
  expect(callLocalChatGptStructured).toHaveBeenCalledWith({ userId: "creator", tenantId: "work-tenant" }, options);
  expect(getAuthenticatedContext).not.toHaveBeenCalled();
});
it("refuses a workflow with no active creator without paid-provider fallback", async () => {
  await expect(callStructuredAi(options, null)).rejects.toThrow("créateur");
  expect(callGeminiStructured).not.toHaveBeenCalled();
});
