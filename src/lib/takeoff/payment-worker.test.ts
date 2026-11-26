import { expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import type { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { resolveTakeoffApiProvider } from "@/lib/takeoff/payment-worker";
import { LocalGroupsRequestError, LocalGroupsStop } from "@/lib/takeoff/vectors/group-local-model";

const mandate = {
  connectionId: "d5130000-0000-4000-8000-000000000001", connectionVersion: 1,
  model: "gpt-6.1-terra", reasoningEffort: "medium", maxTokens: 10_000, maxNanoUsd: 10_000,
};
vi.mock("@/lib/takeoff/payment-mandate-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/payment-mandate-server")>(),
  assertTakeoffApiConnection: async () => {},
  assertTakeoffPayer: async () => {},
  readTakeoffApiMandate: async () => mandate,
}));

const job = {
  id: "witness-job", tenant_id: "witness-tenant", project_id: "witness-affaire", created_by: "witness-member",
  preparation_snapshot: { execution_selection: {
    source: "personal_api_key", model: "personal_api_key", profileId: mandate.connectionId, reasoningEffort: null,
    hostId: "urn:uuid:d5130000-0000-8000-8000-000000000099", authorizationId: mandate.connectionId,
  } },
} as TakeoffJobProcessingRow;

it("waits for the first vector generation to settle, then prepares the second against the freed balance", async () => {
  const firstDispatched = Promise.withResolvers<void>();
  const secondCounted = Promise.withResolvers<void>();
  const overlapRefused = Promise.withResolvers<void>();
  const firstResponse = Promise.withResolvers<void>();
  let remaining = 10_000;
  let outstanding = false;
  const rpc = vi.fn(async (operation: string, args: { p_bound?: number }) => {
    if (operation === "settle_takeoff_api_call") {
      outstanding = false;
      remaining += 3_900;
      return { data: true };
    }
    const bound = args.p_bound ?? 0;
    if (bound > remaining) {
      expect(outstanding).toBe(true);
      overlapRefused.resolve();
      return { data: [{ reason: "CAPACITY_HELD" }] };
    }
    if (bound > 0) {
      outstanding = true;
      remaining -= bound;
    }
    return { data: [{ remaining_nano_usd: remaining, remaining_tokens: remaining, call_id: bound ? "call-id" : null }] };
  });
  const prepare = vi.fn(async (_owner: unknown, input: { prompt: string; allotmentNanoUsd: number }) => {
    if (input.prompt === "Premier groupe") await secondCounted.promise;
    else {
      secondCounted.resolve();
      await firstDispatched.promise;
    }
    return { prompt: input.prompt, boundNanoUsd: 5_100, inputTokens: 1_000, maxOutputTokens: 4_100 };
  });
  const dispatched: string[] = [];
  const execute = vi.fn(async (_owner: unknown, prepared: { prompt: string }, hooks: { reserveBeforeSend(): Promise<void> }) => {
    await hooks.reserveBeforeSend();
    dispatched.push(prepared.prompt);
    if (prepared.prompt === "Premier groupe") {
      firstDispatched.resolve();
      await firstResponse.promise;
    }
    return { data: { accepted: true }, model: mandate.model, durationMs: 1, costNanoUsd: 1_200,
      usage: { total: 1_200, input: 1_000, output: 200, reasoning: 0 } };
  });
  const provider = await resolveTakeoffApiProvider(job, () => "lease",
    { rpc } as unknown as ReturnType<typeof createServiceRoleClient>,
    { prepare, execute } as unknown as ReturnType<typeof openAiApiKeyAccess>);
  const schema = z.object({ accepted: z.boolean() });
  const first = provider.callApiVectorGroup!({ prompt: "Premier groupe", schema });
  const second = provider.callApiVectorGroup!({ prompt: "Deuxième groupe", schema });
  await overlapRefused.promise;
  expect(dispatched).toEqual(["Premier groupe"]);
  firstResponse.resolve();
  await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  expect(dispatched).toEqual(["Premier groupe", "Deuxième groupe"]);
  expect(prepare.mock.calls.map(([, input]) => input.allotmentNanoUsd)).toEqual([10_000, 10_000, 8_800]);
});

it.each([
  ["AI_KEY_REQUEST_REJECTED", "request"],
  ["AI_KEY_UNREACHABLE", "request"],
  ["AI_KEY_RATE_LIMITED", "groups"],
  ["AI_KEY_REFUSED", "job"],
  ["AI_KEY_CHANGED", "job"],
  ["AI_KEY_MODEL_FORBIDDEN", "job"],
  ["AI_KEY_SPEND_LIMIT", "job"],
] as const)("settles %s at zero and stops the appropriate scope", async (code, scope) => {
  const rpc = vi.fn(async (operation: string) => operation === "settle_takeoff_api_call" ? { data: true } : {
    data: [{ remaining_nano_usd: 10_000, remaining_tokens: 10_000, call_id: "fictional-call" }],
  });
  const execute = vi.fn(async (_owner: unknown, _prepared: unknown, { reserveBeforeSend }: { reserveBeforeSend(): Promise<void> }) => {
    await reserveBeforeSend();
    return { data: { accepted: true }, model: mandate.model, durationMs: 1, costNanoUsd: 90,
      usage: { total: 110, input: 100, output: 10, reasoning: 0 } };
  }).mockImplementationOnce(async (_owner, _prepared, { reserveBeforeSend }) => {
    await reserveBeforeSend();
    throw new ApiKeyError(code, { costNanoUsd: 0 });
  });
  const access = { prepare: async () => ({ boundNanoUsd: 200, inputTokens: 100, maxOutputTokens: 300 }), execute };
  const provider = await resolveTakeoffApiProvider(job, () => "lease",
    { rpc } as unknown as ReturnType<typeof createServiceRoleClient>, access as unknown as ReturnType<typeof openAiApiKeyAccess>);
  const input = { prompt: "Classe les groupes", schema: z.object({ accepted: z.boolean() }) };
  const first = provider.callApiVectorGroup!(input);
  if (scope === "request") {
    await expect(first).rejects.toBeInstanceOf(LocalGroupsRequestError);
    await expect(first).rejects.toMatchObject({ totalTokens: 0 });
    await expect(provider.callApiVectorGroup!(input)).resolves.toMatchObject({ data: { accepted: true } });
  } else if (scope === "groups") {
    await expect(first).rejects.toBeInstanceOf(LocalGroupsStop);
    await expect(first).rejects.toMatchObject({ reason: "local_quota" });
    await expect(provider.callApiVectorGroup!(input)).rejects.toBeInstanceOf(LocalGroupsStop);
    expect(execute).toHaveBeenCalledTimes(1);
  } else {
    await expect(first).rejects.toMatchObject({ code: "AI_PROVIDER" });
  }
  expect(rpc).toHaveBeenCalledWith("settle_takeoff_api_call", expect.objectContaining({ p_cost: 0, p_tokens: 0 }));
  const pdf = provider.call({ ...input, prompt: "Lis le PDF" });
  if (scope === "job") {
    await expect(pdf).rejects.toMatchObject({ code: "AI_PROVIDER" });
    expect(execute).toHaveBeenCalledTimes(1);
  } else {
    await expect(pdf).resolves.toMatchObject({ data: { accepted: true } });
  }
});

it.each(["invalid schema", "truncated output"])("settles a vector group with %s and leaves future reads available", async (failure) => {
  const rpc = vi.fn(async (operation: string) => operation === "settle_takeoff_api_call" ? { data: true } : {
    data: [{ remaining_nano_usd: 10_000, remaining_tokens: 10_000, call_id: "vector-call" }],
  });
  const usage = { total: 110, input: 100, output: 10, reasoning: 0, cachedInput: 0, cacheWrite: 0, cacheWrite12h: 0 };
  const answer = { usage, costNanoUsd: 90, model: mandate.model, durationMs: 1 };
  const execute = vi.fn(async (_owner: unknown, _prepared: unknown, { reserveBeforeSend }: { reserveBeforeSend(): Promise<void> }):
    Promise<typeof answer & { data: { accepted: boolean } | null; schemaError: SyntaxError | null }> => {
    await reserveBeforeSend();
    return { ...answer, data: { accepted: true }, schemaError: null };
  }).mockImplementationOnce(async (_owner, _prepared, { reserveBeforeSend }) => {
    await reserveBeforeSend();
    if (failure === "truncated output") throw new ApiKeyError("AI_KEY_OUTPUT_LIMIT", answer);
    return { ...answer, data: null, schemaError: new SyntaxError("Fictional invalid JSON") };
  });
  const access = { prepare: async () => ({ boundNanoUsd: 200, inputTokens: 100, maxOutputTokens: 300 }), execute };
  const provider = await resolveTakeoffApiProvider(job, () => "lease",
    { rpc } as unknown as ReturnType<typeof createServiceRoleClient>, access as unknown as ReturnType<typeof openAiApiKeyAccess>);
  const input = { prompt: "Classe les groupes", schema: z.object({ accepted: z.boolean() }) };
  const failedGroup = provider.callApiVectorGroup!(input);
  await expect(failedGroup).rejects.toBeInstanceOf(LocalGroupsRequestError);
  await expect(failedGroup).rejects.toMatchObject({ totalTokens: 110 });
  await expect(provider.callApiVectorGroup!(input)).resolves.toMatchObject({ data: { accepted: true } });
  const settlements = rpc.mock.calls.filter(([operation]) => operation === "settle_takeoff_api_call");
  expect(settlements).toEqual(Array.from({ length: 2 }, () => ["settle_takeoff_api_call", expect.objectContaining({
    p_call_id: "vector-call", p_lease_token: "lease", p_cost: 90, p_tokens: 110,
  })]));
});

// Owner decision of 2026-11-27: a request paid by a personal key has no token ceiling. Its dollar ceiling is its only bound.
it("bounds a call by the dollars the request has left, never by tokens, and records the tokens it used", async () => {
  const reservations: Array<{ p_bound?: number; p_tokens?: number; p_exhausted?: boolean }> = [];
  const rpc = vi.fn(async (operation: string, args: { p_bound?: number; p_tokens?: number; p_exhausted?: boolean }) => {
    if (operation === "settle_takeoff_api_call") return { data: true };
    reservations.push({ p_bound: args.p_bound, p_tokens: args.p_tokens, p_exhausted: args.p_exhausted });
    // The ledger of a mandate without a token ceiling reports none; one sealed with the former ceiling reports a number.
    return { data: [{ remaining_nano_usd: 10_000, remaining_tokens: reservations.length % 2 ? null : 1, call_id: args.p_bound ? "call-id" : null }] };
  });
  const prepare = vi.fn(async (_owner: unknown, input: Record<string, unknown>) => {
    expect(input).not.toHaveProperty("maxTotalTokens");
    return { boundNanoUsd: 5_000, inputTokens: 1_000, maxOutputTokens: 4_000 };
  });
  // The provider counts more tokens than the call's own estimate, within the dollars it reserved: the request goes on.
  const execute = vi.fn(async (_owner: unknown, _prepared: unknown, { reserveBeforeSend }: { reserveBeforeSend(): Promise<void> }) => {
    await reserveBeforeSend();
    return { data: { accepted: true }, model: mandate.model, durationMs: 1, costNanoUsd: 4_900,
      usage: { total: 9_000, input: 8_000, output: 1_000, reasoning: 0 } };
  });
  const provider = await resolveTakeoffApiProvider(job, () => "lease",
    { rpc } as unknown as ReturnType<typeof createServiceRoleClient>,
    { prepare, execute } as unknown as ReturnType<typeof openAiApiKeyAccess>);
  const input = { prompt: "Lis le PDF", schema: z.object({ accepted: z.boolean() }) };
  await expect(provider.call(input)).resolves.toMatchObject({ data: { accepted: true }, tokenCount: 9_000 });
  await expect(provider.call(input)).resolves.toMatchObject({ data: { accepted: true } });
  expect(prepare.mock.calls.map(([, sent]) => sent.allotmentNanoUsd)).toEqual([10_000, 10_000]);
  // Each call reserves its dollar bound; its token estimate is recorded with it.
  expect(reservations.filter(({ p_bound }) => p_bound)).toEqual(Array(2).fill({ p_bound: 5_000, p_tokens: 5_000, p_exhausted: false }));
  expect(rpc).toHaveBeenCalledWith("settle_takeoff_api_call", expect.objectContaining({ p_cost: 4_900, p_tokens: 9_000 }));
});

it("stops at the dollar ceiling with its message, and sends nothing after the refusal", async () => {
  let remaining = 10_000;
  const reservations: Array<{ p_bound?: number; p_tokens?: number; p_exhausted?: boolean }> = [];
  const rpc = vi.fn(async (operation: string, args: { p_bound?: number; p_tokens?: number; p_exhausted?: boolean }) => {
    if (operation === "settle_takeoff_api_call") {
      remaining = 10_000 - 6_000;
      return { data: true };
    }
    reservations.push({ p_bound: args.p_bound, p_tokens: args.p_tokens, p_exhausted: args.p_exhausted });
    if (args.p_exhausted) return { data: [{ reason: "BUDGET_EXHAUSTED", remaining_nano_usd: remaining, remaining_tokens: null, call_id: null }] };
    return { data: [{ remaining_nano_usd: remaining, remaining_tokens: null, call_id: args.p_bound ? "call-id" : null }] };
  });
  // The second call's input alone costs more than the 4,000 nano-dollars left.
  const prepare = vi.fn(async (_owner: unknown, input: { allotmentNanoUsd: number }) => {
    if (input.allotmentNanoUsd < 5_000) throw new ApiKeyError("AI_KEY_CEILING");
    return { boundNanoUsd: 7_000, inputTokens: 1_000, maxOutputTokens: 4_000 };
  });
  const execute = vi.fn(async (_owner: unknown, _prepared: unknown, { reserveBeforeSend }: { reserveBeforeSend(): Promise<void> }) => {
    await reserveBeforeSend();
    return { data: { accepted: true }, model: mandate.model, durationMs: 1, costNanoUsd: 6_000,
      usage: { total: 1_200, input: 1_000, output: 200, reasoning: 0 } };
  });
  const provider = await resolveTakeoffApiProvider(job, () => "lease",
    { rpc } as unknown as ReturnType<typeof createServiceRoleClient>,
    { prepare, execute } as unknown as ReturnType<typeof openAiApiKeyAccess>);
  const input = { prompt: "Lis le PDF", schema: z.object({ accepted: z.boolean() }) };
  await expect(provider.call(input)).resolves.toMatchObject({ data: { accepted: true } });
  const refused = { code: "TAKEOFF_REQUEST_BUDGET_EXHAUSTED", retryable: false,
    message: "Le plafond en dollars de cette demande avec la clé API OpenAI est atteint. Les résultats déjà enregistrés sont conservés." };
  await expect(provider.call(input)).rejects.toMatchObject(refused);
  // The ledger is told what the preparation saw in dollars: no token number takes part in its decision.
  expect(reservations.at(-1)).toEqual({ p_bound: 4_000, p_tokens: undefined, p_exhausted: true });
  const [ledgerCalls, counted] = [rpc.mock.calls.length, prepare.mock.calls.length];
  await expect(provider.call(input)).rejects.toMatchObject(refused);
  await expect(provider.callApiVectorGroup!(input)).rejects.toMatchObject(refused);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledTimes(ledgerCalls);
  expect(prepare).toHaveBeenCalledTimes(counted);
});

it("stops the request when a call costs more than the dollars it reserved", async () => {
  const rpc = vi.fn(async (operation: string, args: { p_bound?: number }) => operation === "settle_takeoff_api_call" ? { data: true }
    : { data: [{ remaining_nano_usd: 10_000, remaining_tokens: null, call_id: args.p_bound ? "call-id" : null }] });
  const access = { prepare: async () => ({ boundNanoUsd: 5_000, inputTokens: 1_000, maxOutputTokens: 4_000 }),
    execute: vi.fn(async (_owner: unknown, _prepared: unknown, { reserveBeforeSend }: { reserveBeforeSend(): Promise<void> }) => {
      await reserveBeforeSend();
      return { data: { accepted: true }, model: mandate.model, durationMs: 1, costNanoUsd: 5_001,
        usage: { total: 1_200, input: 1_000, output: 200, reasoning: 0 } };
    }) };
  const provider = await resolveTakeoffApiProvider(job, () => "lease",
    { rpc } as unknown as ReturnType<typeof createServiceRoleClient>, access as unknown as ReturnType<typeof openAiApiKeyAccess>);
  const input = { prompt: "Lis le PDF", schema: z.object({ accepted: z.boolean() }) };
  await expect(provider.call(input)).rejects.toMatchObject({ code: "TAKEOFF_REQUEST_BUDGET_EXHAUSTED" });
  expect(rpc).toHaveBeenCalledWith("settle_takeoff_api_call", expect.objectContaining({ p_cost: 5_001, p_tokens: 1_200 }));
  await expect(provider.call(input)).rejects.toMatchObject({ code: "TAKEOFF_REQUEST_BUDGET_EXHAUSTED" });
  expect(access.execute).toHaveBeenCalledTimes(1);
});

// A ledger older than the dollar-only rule still refuses on a mandate's token number and asks for a new preparation. With
// the dollars the call asked for still available, preparing again cannot change the answer: the request stops, nothing sent.
it("stops instead of preparing again when the ledger refuses a bound the dollars left can hold", async () => {
  const rpc = vi.fn(async (_operation: string, args: { p_bound?: number }) => args.p_bound
    ? { data: [{ reason: "REPREPARE", remaining_nano_usd: 10_000, remaining_tokens: 1, call_id: null }] }
    : { data: [{ remaining_nano_usd: 10_000, remaining_tokens: 1, call_id: null }] });
  const prepare = vi.fn(async () => ({ boundNanoUsd: 5_000, inputTokens: 1_000, maxOutputTokens: 4_000 }));
  const sent = vi.fn();
  const execute = vi.fn(async (_owner: unknown, _prepared: unknown, { reserveBeforeSend }: { reserveBeforeSend(): Promise<void> }) => {
    await reserveBeforeSend();
    sent();
    return { data: { accepted: true }, model: mandate.model, durationMs: 1, costNanoUsd: 1, usage: { total: 1, input: 1, output: 0, reasoning: 0 } };
  });
  const provider = await resolveTakeoffApiProvider(job, () => "lease",
    { rpc } as unknown as ReturnType<typeof createServiceRoleClient>,
    { prepare, execute } as unknown as ReturnType<typeof openAiApiKeyAccess>);
  await expect(provider.call({ prompt: "Lis le PDF", schema: z.object({ accepted: z.boolean() }) })).rejects.toMatchObject({
    code: "TAKEOFF_USAGE_UNRECORDED", message: expect.stringContaining("Aucun autre appel ne sera envoyé") });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(sent).not.toHaveBeenCalled();
});
