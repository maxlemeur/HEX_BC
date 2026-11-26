import { expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import type { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { resolveTakeoffApiProvider } from "@/lib/takeoff/payment-worker";
import { LocalGroupsRequestError } from "@/lib/takeoff/vectors/group-local-model";

const mandate = {
  connectionId: "d5130000-0000-4000-8000-000000000001", connectionVersion: 1,
  model: "gpt-6.1-terra", reasoningEffort: "medium", maxTokens: 10_000, maxNanoUsd: 10_000,
};
vi.mock("@/lib/takeoff/payment-mandate-server", () => ({
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
  const execute = vi.fn(async (_owner: unknown, prepared: { prompt: string }, hooks: { beforeSend(): Promise<void> }) => {
    await hooks.beforeSend();
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

it.each(["invalid schema", "truncated output"])("settles a vector group with %s and leaves future reads available", async (failure) => {
  const rpc = vi.fn(async (operation: string) => operation === "settle_takeoff_api_call" ? { data: true } : {
    data: [{ remaining_nano_usd: 10_000, remaining_tokens: 10_000, call_id: "vector-call" }],
  });
  const usage = { total: 110, input: 100, output: 10, reasoning: 0, cachedInput: 0, cacheWrite: 0, cacheWrite12h: 0 };
  const answer = { usage, costNanoUsd: 90, model: mandate.model, durationMs: 1 };
  const execute = vi.fn(async (_owner: unknown, _prepared: unknown, { beforeSend }: { beforeSend(): Promise<void> }):
    Promise<typeof answer & { data: { accepted: boolean } | null; schemaError: SyntaxError | null }> => {
    await beforeSend();
    return { ...answer, data: { accepted: true }, schemaError: null };
  }).mockImplementationOnce(async (_owner, _prepared, { beforeSend }) => {
    await beforeSend();
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
