import { expect, it, vi } from "vitest";
import { z } from "zod";

import type { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { resolveTakeoffApiProvider } from "@/lib/takeoff/payment-worker";

const mandate = {
  connectionId: "d5130000-0000-4000-8000-000000000001", connectionVersion: 1,
  model: "gpt-6.1-terra", reasoningEffort: "medium", maxTokens: 10_000, maxNanoUsd: 10_000,
};
vi.mock("@/lib/takeoff/payment-mandate-server", () => ({
  assertTakeoffApiConnection: async () => {},
  assertTakeoffPayer: async () => {},
  readTakeoffApiMandate: async () => mandate,
}));

it("waits for the first vector generation to settle, then prepares the second against the freed balance", async () => {
  const job = {
    id: "witness-job", tenant_id: "witness-tenant", project_id: "witness-affaire", created_by: "witness-member",
    preparation_snapshot: { execution_selection: {
      source: "personal_api_key", model: "personal_api_key", profileId: mandate.connectionId, reasoningEffort: null,
      hostId: "urn:uuid:d5130000-0000-4000-8000-000000000099", authorizationId: mandate.connectionId,
    } },
  } as TakeoffJobProcessingRow;
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
