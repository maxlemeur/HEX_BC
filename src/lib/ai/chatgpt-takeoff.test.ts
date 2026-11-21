vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers({ host: "127.0.0.1:3000" })) }));
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/ai/chatgpt-local-store", () => ({ readChatGptStore: vi.fn(), getChatGptHostId: vi.fn().mockResolvedValue("urn:uuid:host") }));
vi.mock("@/lib/ai/chatgpt-local-inference", () => ({ callLocalChatGptStructured: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
import { readChatGptStore, getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { assertLocalTakeoffResumeReady, getTakeoffExecutionSelection, parseTakeoffProvider, resolveLocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";

const job = { id: "job", tenant_id: "tenant", project_id: "project", created_by: "creator", execution_provider: "chatgpt_local", execution_host_id: "urn:uuid:host" } as TakeoffJobProcessingRow;
// The creator's membership, then the job's affaire, as the per-call check reads them.
const maybeSingle = vi.fn();
const projectSingle = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const client = { from: vi.fn() };
const options = { prompt: "Extract", schema: z.object({ quantity: z.number() }) };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("CI", ""); vi.stubEnv("VERCEL", ""); vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1");
  const query = { select, eq, maybeSingle };
  const projectQuery = { select: () => projectQuery, eq: (...args: unknown[]) => { eq(...args); return projectQuery; }, maybeSingle: projectSingle };
  client.from.mockImplementation((table: string) => table === "estimate_projects" ? projectQuery : query);
  select.mockReturnValue(query); eq.mockReturnValue(query);
  maybeSingle.mockResolvedValue({ data: { user_id: "creator", role: "engineer" }, error: null });
  projectSingle.mockResolvedValue({ data: { user_id: "creator", is_archived: false }, error: null });
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile", profiles: [{ id: "profile", accessToken: "fixture-access", refreshToken: "fixture-refresh", scopes: ["chatgpt.tokens.use.direct"], authorizationId: "connexion", model: "chosen-model" }] } as never);
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
  expect(callLocalChatGptStructured).toHaveBeenCalledWith({ userId: "creator", tenantId: "tenant" }, options, { profileId: "profile", model: "chosen-model", reasoningEffort: null, authorizationId: "connexion", onUsage: undefined });
});
it("records each paid call's usage of a request's job under the lease the worker holds at that call", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [{ remaining_tokens: 10, remaining_cost_cents: 0 }], error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);
  vi.mocked(callLocalChatGptStructured).mockImplementation(async (_owner, _options, selection) => {
    await selection?.onUsage?.({ totalTokens: 42, costCents: 0 });
    return { data: { quantity: 12 } } as never;
  });
  // The row the provider is resolved from was read before the claim: its lease is not the one the job runs under.
  let lease: string | null = "lease-of-the-claim";
  const provider = await resolveLocalTakeoffProvider(client as never, { ...job, launch_request_id: "request", processing_lease_token: null }, () => lease);
  await provider.call(options);
  lease = "lease-after-a-new-claim";
  await provider.call(options);
  expect(rpc.mock.calls).toEqual([
    ["record_takeoff_launch_usage", { p_job_id: "job", p_lease_token: "lease-of-the-claim", p_call_key: "call:1", p_tokens: 42, p_cost_cents: 0 }],
    ["record_takeoff_launch_usage", { p_job_id: "job", p_lease_token: "lease-after-a-new-claim", p_call_key: "call:2", p_tokens: 42, p_cost_cents: 0 }],
  ]);
});
it("pins selected reasoning effort with the model on every takeoff chunk", async () => {
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile", profiles: [{ id: "profile", accessToken: "fixture-access", refreshToken: "fixture-refresh", scopes: ["chatgpt.tokens.use.direct"], authorizationId: "connexion", model: "gpt-6.1-terra", reasoningEffort: "high" }] } as never);
  const provider = await resolveLocalTakeoffProvider(client as never, job);
  await provider!.call(options);
  await provider!.call(options);
  expect(provider?.reasoningEffort).toBe("high");
  for (const call of vi.mocked(callLocalChatGptStructured).mock.calls) {
    expect(call[2]).toEqual({ profileId: "profile", model: "gpt-6.1-terra", reasoningEffort: "high", authorizationId: "connexion", onUsage: undefined });
  }
});
it("reads the attested selection after admission and refuses changed settings on a later attempt", async () => {
  const pinned = { ...job, preparation_snapshot: { confirmed_by: "creator", execution_selection: {
    hostId: "urn:uuid:host", profileId: "profile", model: "chosen-model", reasoningEffort: null,
  } } };
  const provider = await resolveLocalTakeoffProvider(client as never, pinned);
  expect(provider?.useProfileForVectorGroups).toBe(true);
  await provider!.call(options);
  expect(callLocalChatGptStructured).toHaveBeenCalledWith({ userId: "creator", tenantId: "tenant" }, options,
    { profileId: "profile", model: "chosen-model", reasoningEffort: null, authorizationId: "connexion", onUsage: undefined });
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile", profiles: [{ id: "profile", accessToken: "fixture-access", refreshToken: "fixture-refresh", scopes: ["chatgpt.tokens.use.direct"], authorizationId: "connexion", model: "chosen-model", reasoningEffort: "high" }] } as never);
  await expect(resolveLocalTakeoffProvider(client as never, pinned)).rejects.toMatchObject({ code: "AI_PROVIDER", retryable: false });
  expect(callLocalChatGptStructured).toHaveBeenCalledTimes(1);
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
// Who may still pay on the affaire, before each paid call of every job, is the execution scope's database check
// (execution-scope-server.test.ts, and private.takeoff_launch_payer_eligible in takeoff-launch-round-two.test.sql).
it("gives the vector requests the creator's membership check and the job's pinned selection (TI-704 option B)", async () => {
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile", profiles: [{ id: "profile", accessToken: "fixture-access", refreshToken: "fixture-refresh", scopes: ["chatgpt.tokens.use.direct"], authorizationId: "connexion", model: "gpt-6.1-terra", reasoningEffort: "high" }] } as never);
  const provider = await resolveLocalTakeoffProvider(client as never, job);
  expect(provider?.selection).toEqual({ profileId: "profile", model: "gpt-6.1-terra", reasoningEffort: "high", authorizationId: "connexion",
    onUsage: undefined });
  await expect(provider!.assertOwnerActive()).resolves.toBeUndefined();
  maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(provider!.assertOwnerActive()).rejects.toMatchObject({ code: "FORBIDDEN", retryable: false });
});
it("stops on a selected plan failure without raw provider details or automatic retries", async () => {
  const provider = await resolveLocalTakeoffProvider(client as never, job);
  vi.mocked(callLocalChatGptStructured).mockRejectedValue(new Error("Bearer private-provider-payload"));
  await expect(provider!.call(options)).rejects.toMatchObject({ code: "AI_PROVIDER", retryable: false, details: { provider: "chatgpt" } });
  await expect(provider!.call(options)).rejects.not.toThrow("private-provider-payload");
});
it("requires a chosen model without switching billing paths", async () => {
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profile", profiles: [{ id: "profile", accessToken: "fixture-access", refreshToken: "fixture-refresh", scopes: ["chatgpt.tokens.use.direct"], authorizationId: "connexion", model: null }] } as never);
  await expect(resolveLocalTakeoffProvider(client as never, job)).rejects.toMatchObject({ code: "AI_PROVIDER", retryable: false });
});
it("refuses a legacy Gemini job before reading its creator's access or plan, even with a connected plan", async () => {
  await expect(resolveLocalTakeoffProvider(client as never, { ...job, execution_provider: "gemini", execution_host_id: null }))
    .rejects.toMatchObject({ status: 422, code: "AI_PROVIDER", retryable: false });
  expect(client.from).not.toHaveBeenCalled();
  expect(readChatGptStore).not.toHaveBeenCalled();
});
it("refuses to resume a legacy Gemini job before reading its creator's membership, plan or host", async () => {
  await expect(assertLocalTakeoffResumeReady(client as never, "tenant", { execution_provider: "gemini", execution_host_id: null, created_by: "creator" }))
    .rejects.toMatchObject({ status: 422, code: "AI_PROVIDER", retryable: false, message: expect.stringContaining("Cet ancien métré") });
  expect(createServiceRoleClient).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
  expect(readChatGptStore).not.toHaveBeenCalled();
  expect(getChatGptHostId).not.toHaveBeenCalled();
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
  await expect(getTakeoffExecutionSelection(client as never, { userId: "creator", tenantId: "tenant" }, "gemini")).rejects.toMatchObject({ code: "AI_PROVIDER", retryable: false });
  expect(readChatGptStore).not.toHaveBeenCalled();
});
it("refuses an explicit ChatGPT choice when disconnected or outside the local runtime", async () => {
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: null, profiles: [] });
  await expect(getTakeoffExecutionSelection(client as never, { userId: "creator", tenantId: "tenant" }, "chatgpt")).rejects.toMatchObject({ code: "AI_PROVIDER" });
  vi.stubEnv("NODE_ENV", "production");
  await expect(getTakeoffExecutionSelection(client as never, { userId: "creator", tenantId: "tenant" }, "chatgpt")).rejects.toMatchObject({ code: "AI_PROVIDER" });
});
it("defaults omitted provider input and rejects malformed billing choices", () => {
  expect(parseTakeoffProvider(null)).toBe("auto");
  expect(() => parseTakeoffProvider("unknown")).toThrow();
  expect(() => parseTakeoffProvider("")).toThrow();
});
