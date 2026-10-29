vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers({ host: "127.0.0.1:3000" })) }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/ai/chatgpt-local-store", () => ({ readChatGptStore: vi.fn(), getChatGptHostId: vi.fn().mockResolvedValue("urn:uuid:host") }));
vi.mock("@/lib/ai/chatgpt-local-inference", () => ({ callLocalChatGptStructured: vi.fn() }));
import { readChatGptStore, getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { getTakeoffExecutionOwner, parseTakeoffProvider, resolveLocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";

const job = { id: "job", tenant_id: "tenant", created_by: "creator", execution_provider: "chatgpt_local", execution_host_id: "urn:uuid:host" } as TakeoffJobProcessingRow;
const maybeSingle = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const client = { from: vi.fn() };
const options = { prompt: "Extract", schema: z.object({ quantity: z.number() }) };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("CI", ""); vi.stubEnv("VERCEL", ""); vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1");
  const query = { select, eq, maybeSingle };
  client.from.mockReturnValue(query); select.mockReturnValue(query); eq.mockReturnValue(query);
  maybeSingle.mockResolvedValue({ data: { user_id: "creator" }, error: null });
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile", profiles: [{ id: "profile", model: "chosen-model" }] } as never);
  vi.mocked(callLocalChatGptStructured).mockResolvedValue({ data: { quantity: 12 } } as never);
});
afterEach(() => vi.unstubAllEnvs());

it("binds the plan to the persisted creator and active job tenant, rechecking access per call", async () => {
  const provider = await resolveLocalTakeoffProvider(client as never, job);
  expect(provider?.model).toBe("chosen-model");
  expect(await provider!.call(options)).toMatchObject({ data: { quantity: 12 } });
  expect(readChatGptStore).toHaveBeenCalledWith({ userId: "creator", tenantId: "tenant" });
  expect(eq.mock.calls).toEqual(expect.arrayContaining([["user_id", "creator"], ["tenant_id", "tenant"], ["tenants.is_active", true]]));
  expect(maybeSingle).toHaveBeenCalledTimes(2);
  expect(callLocalChatGptStructured).toHaveBeenCalledWith({ userId: "creator", tenantId: "tenant" }, options, { profileId: "profile", model: "chosen-model", reasoningEffort: null });
});
it("pins selected reasoning effort with the model on every takeoff chunk", async () => {
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile", profiles: [{ id: "profile", model: "gpt-6.1-terra", reasoningEffort: "high" }] } as never);
  const provider = await resolveLocalTakeoffProvider(client as never, job);
  await provider!.call(options);
  await provider!.call(options);
  expect(provider?.reasoningEffort).toBe("high");
  for (const call of vi.mocked(callLocalChatGptStructured).mock.calls) {
    expect(call[2]).toEqual({ profileId: "profile", model: "gpt-6.1-terra", reasoningEffort: "high" });
  }
});
it.each([null, "creator"])("refuses missing or revoked creator %s without reading another account", async (created_by) => {
  maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(resolveLocalTakeoffProvider(client as never, { ...job, created_by })).rejects.toMatchObject({ code: "FORBIDDEN", retryable: false });
  expect(readChatGptStore).not.toHaveBeenCalled(); expect(callLocalChatGptStructured).not.toHaveBeenCalled();
});
it("stops a running job when creator membership is revoked", async () => {
  const provider = await resolveLocalTakeoffProvider(client as never, job);
  maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(provider!.call(options)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(callLocalChatGptStructured).not.toHaveBeenCalled();
});
it("stops on a selected plan failure without raw provider details or automatic retries", async () => {
  const provider = await resolveLocalTakeoffProvider(client as never, job);
  vi.mocked(callLocalChatGptStructured).mockRejectedValue(new Error("Bearer private-provider-payload"));
  await expect(provider!.call(options)).rejects.toMatchObject({ code: "AI_PROVIDER", retryable: false, details: { provider: "chatgpt" } });
  await expect(provider!.call(options)).rejects.not.toThrow("private-provider-payload");
});
it("requires a chosen model without switching billing paths", async () => {
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile", profiles: [{ id: "profile", model: null }] } as never);
  await expect(resolveLocalTakeoffProvider(client as never, job)).rejects.toMatchObject({ code: "AI_PROVIDER", retryable: false });
});
it("keeps legacy Gemini jobs on Gemini, even with a connected plan", async () => {
  expect(await resolveLocalTakeoffProvider(client as never, { ...job, execution_provider: "gemini" })).toBeNull();
  expect(readChatGptStore).not.toHaveBeenCalled();
});
it("never falls back when the reserved plan is disconnected", async () => {
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: null, profiles: [] });
  await expect(resolveLocalTakeoffProvider(client as never, job)).rejects.toMatchObject({ code: "AI_PROVIDER", retryable: false });
});
it("refuses a different host and production before loading credentials", async () => {
  vi.mocked(getChatGptHostId).mockResolvedValueOnce("urn:uuid:other-host");
  await expect(resolveLocalTakeoffProvider(client as never, job)).rejects.toMatchObject({ code: "AI_PROVIDER" });
  vi.stubEnv("NODE_ENV", "production");
  await expect(resolveLocalTakeoffProvider(client as never, job)).rejects.toMatchObject({ code: "AI_PROVIDER" });
  expect(readChatGptStore).not.toHaveBeenCalled();
});

it("rejects an explicit obsolete Gemini choice even with a connected local plan", async () => {
  vi.stubEnv("NODE_ENV", "development");
  await expect(getTakeoffExecutionOwner(client as never, { userId: "creator", tenantId: "tenant" }, "gemini")).rejects.toMatchObject({ code: "AI_PROVIDER", retryable: false });
  expect(readChatGptStore).not.toHaveBeenCalled();
});
it("refuses an explicit ChatGPT choice when disconnected or outside the local runtime", async () => {
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: null, profiles: [] });
  await expect(getTakeoffExecutionOwner(client as never, { userId: "creator", tenantId: "tenant" }, "chatgpt")).rejects.toMatchObject({ code: "AI_PROVIDER" });
  vi.stubEnv("NODE_ENV", "production");
  await expect(getTakeoffExecutionOwner(client as never, { userId: "creator", tenantId: "tenant" }, "chatgpt")).rejects.toMatchObject({ code: "AI_PROVIDER" });
});
it("defaults omitted provider input and rejects malformed billing choices", () => {
  expect(parseTakeoffProvider(null)).toBe("auto");
  expect(() => parseTakeoffProvider("unknown")).toThrow();
  expect(() => parseTakeoffProvider("")).toThrow();
});
