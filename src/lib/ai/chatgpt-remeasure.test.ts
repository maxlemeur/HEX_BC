import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { LocalChatGptConnectionWithdrawnError } from "./chatgpt-sign-in-errors";

const account = vi.hoisted(() => ({ model: "usual", authorizationId: "connection", revoked: false, write: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: () => true, hasLocalChatGptPlanAccess: () => true,
  getLocalChatGptCredential: async () => {
    if (account.revoked) throw new LocalChatGptConnectionWithdrawnError();
    return { accessToken: "fixture", authorizationId: account.authorizationId,
      profileId: "profile", model: account.model, reasoningEffort: "low" };
  },
}));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({
  saveChatGptStore: account.write,
  getChatGptHostId: async () => "host",
  readChatGptStore: async () => ({ selectedId: "profile", profiles: [{ id: "profile", model: account.model,
    reasoningEffort: "low", authorizationId: account.authorizationId }] }),
}));
import { readMeasureCatalogue } from "@/lib/takeoff/item-measure-catalogue-server";
import { resolveLocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import { localGroupsCall } from "@/lib/takeoff/vectors/group-local-model-server";
import { takeoffVectorLocalGroupsHook } from "@/lib/takeoff/vectors/worker-server";

afterEach(() => {
  account.revoked = false;
  account.model = "usual";
  account.authorizationId = "connection";
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([null, "high"] as const)("sends the confirmed model and effort %s for page, group and tile requests", async (effort) => {
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "chosen", display_name: "Chosen",
      visibility: "list", supported_reasoning_levels: ["high"] }] });
    requests.push(JSON.parse(String(init.body)));
    const answer = [{ quantity: 2 }, { groupes: [] }, { pins: [] }][requests.length - 1];
    return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] } })}\n\n`);
  });
  vi.stubEnv("MERGEONE_TAKEOFF_DECISIONS", "1");
  vi.stubEnv("MERGEONE_TAKEOFF_VECTORS", "1");
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { user_id: "member" } }) };
  const beforePaidCall = vi.fn(async (branch: string, key?: string) => ({ key: key ?? branch, reserved: true }));
  const ledger = { beforePaidCall, recordPaidUsage: vi.fn(), recordUnknownUsage: vi.fn() };
  const provider = await resolveLocalTakeoffProvider({ from: () => query } as never, {
    id: "job", created_by: "member", tenant_id: "tenant", execution_host_id: "host", execution_provider: "chatgpt_local",
    launch_request_id: "request", preparation_snapshot: { confirmed_by: "member", execution_selection: {
      profileId: "profile", hostId: "host", model: "previous-default", reasoningEffort: "medium", authorizationId: "connection" },
    remeasure_setting: { model: "chosen", reasoningEffort: effort } },
  } as never, { ledger });
  account.model = "edited-before-pdf";
  await provider.call({ prompt: "Mesurer", schema: z.object({ quantity: z.number() }) });
  const hook = takeoffVectorLocalGroupsHook({ jobId: "job", tenantId: "tenant", userId: "member", provider })!;
  const call = await localGroupsCall(hook.owner, hook.local!.selection, hook.local!.useProfile);
  account.model = "edited-before-group";
  await call({ prompt: "Classer", images: [] });
  account.model = "edited-before-tile";
  const tile = { prompt: "Localiser", takeoffTile: { page: 7, ordinal: 3 }, schema: z.object({ pins: z.array(z.number()) }) };
  await provider.call(tile);
  expect(beforePaidCall.mock.calls).toEqual([["pdf"], ["vector_group"], ["count_tile", "tile:7:3"]]);
  expect(ledger.recordPaidUsage).toHaveBeenCalledWith({ key: "tile:7:3", reserved: true }, { totalTokens: 7, costCents: 0, trusted: true });
  expect(account.write).not.toHaveBeenCalled();
  expect(requests.map((body) => [body.model, Object.hasOwn(body, "reasoning"), body.reasoning]))
    .toEqual(Array(3).fill(["chosen", effort !== null, effort ? { effort } : undefined]));
  account.authorizationId = "new-connection";
  const withdrawn = { details: { reason: "CHATGPT_ACCESS_REVOKED" } };
  await expect(provider.call({ prompt: "Mesurer", schema: z.object({}) })).rejects.toMatchObject(withdrawn);
  await expect(call({ prompt: "Classer", images: [] })).rejects.toMatchObject(withdrawn);
  account.revoked = true;
  await expect(provider.call({ prompt: "Mesurer", schema: z.object({}) })).rejects.toMatchObject(withdrawn);
  await expect(call({ prompt: "Classer", images: [] })).rejects.toMatchObject(withdrawn);
  await expect(provider.call(tile)).rejects.toMatchObject(withdrawn);
  expect(requests).toHaveLength(3);
  expect(account.write).not.toHaveBeenCalled();
});

it("reports an exhausted subscription from the catalogue before any model request", async () => {
  const requests = vi.fn(async () => Response.json({ error: { code: "insufficient_quota" } }, { status: 429 }));
  vi.stubGlobal("fetch", requests);
  const result = await readMeasureCatalogue({ userId: "member", tenantId: "tenant" },
    { profileId: "profile", hostId: "host", authorizationId: "connection", model: "usual", reasoningEffort: "low" });
  expect(result.reason).toMatch(/Limite du forfait ChatGPT atteinte/);
  expect(requests).toHaveBeenCalledTimes(1);
  expect(requests).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.any(Object));
});
