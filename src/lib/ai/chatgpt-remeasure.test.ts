import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: () => true, hasLocalChatGptPlanAccess: () => true,
  getLocalChatGptCredential: async () => ({ accessToken: "fixture", authorizationId: "connection",
    profileId: "profile", model: "usual", reasoningEffort: "low" }),
}));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({
  getChatGptHostId: async () => "host",
  readChatGptStore: async () => ({ selectedId: "profile", profiles: [{ id: "profile", model: "usual",
    reasoningEffort: "low", authorizationId: "connection" }] }),
}));
import { readMeasureCatalogue } from "@/lib/takeoff/item-measure-catalogue-server";
import { resolveLocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import { localGroupsCall } from "@/lib/takeoff/vectors/group-local-model-server";
import { takeoffVectorLocalGroupsHook } from "@/lib/takeoff/vectors/worker-server";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([null, "high"] as const)("sends the confirmed model and effort %s for both page and group requests", async (effort) => {
  const requests: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("/models")) return Response.json({ models: [{ slug: "chosen", display_name: "Chosen",
      visibility: "list", supported_reasoning_levels: ["high"] }] });
    requests.push(JSON.parse(String(init.body)));
    const answer = requests.length === 1 ? { quantity: 2 } : { groupes: [] };
    return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] } })}\n\n`);
  });
  vi.stubEnv("MERGEONE_TAKEOFF_DECISIONS", "1");
  vi.stubEnv("MERGEONE_TAKEOFF_VECTORS", "1");
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { user_id: "member" } }) };
  const provider = await resolveLocalTakeoffProvider({ from: () => query } as never, {
    id: "job", created_by: "member", tenant_id: "tenant", execution_host_id: "host", execution_provider: "chatgpt_local",
    launch_request_id: "request", preparation_snapshot: { confirmed_by: "member", execution_selection: {
      profileId: "profile", hostId: "host", model: "usual", reasoningEffort: "low", authorizationId: "connection" },
    remeasure_setting: { model: "chosen", reasoningEffort: effort } },
  } as never);
  await provider.call({ prompt: "Mesurer", schema: z.object({ quantity: z.number() }) });
  const hook = takeoffVectorLocalGroupsHook({ jobId: "job", tenantId: "tenant", userId: "member", provider })!;
  const call = await localGroupsCall(hook.owner, hook.local!.selection, hook.local!.useProfile);
  await call({ prompt: "Classer", images: [] });
  expect(requests.map((body) => [body.model, Object.hasOwn(body, "reasoning"), body.reasoning]))
    .toEqual(Array(2).fill(["chosen", effort !== null, effort ? { effort } : undefined]));
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
