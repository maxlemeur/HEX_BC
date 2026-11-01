import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/ai/chatgpt-local-auth", () => ({ getLocalChatGptCredential: vi.fn().mockResolvedValue({ accessToken: "fixture-secret", model: "account-model", profileId: "profile-a" }) }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ readChatGptStore: vi.fn(), saveChatGptStore: vi.fn(), withChatGptLock: vi.fn() }));
import { assertLocalChatGptOverride, callLocalChatGptStructured, readChatGptResponse } from "@/lib/ai/chatgpt-local-inference";
import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import { saveChatGptStore, withChatGptLock } from "@/lib/ai/chatgpt-local-store";
import { DEFAULT_CHATGPT_MODEL } from "@/lib/ai/chatgpt-model-preferences";

const owner = { userId: "user", tenantId: "tenant" };
const completed = { type: "response.completed", response: { status: "completed", output: [
  { type: "message", content: [{ type: "output_text", text: '{"amount":12}' }] },
], usage: { input_tokens: 10, output_tokens: 7, total_tokens: 17, output_tokens_details: { reasoning_tokens: 2 } } } };
function stream(events: unknown[], crlf = false) {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const encoded = new TextEncoder().encode(crlf ? text.replaceAll("\n", "\r\n") : text);
  return new Response(new ReadableStream({ start(controller) {
    // Exercise UTF-8 / SSE boundaries across arbitrary network chunks.
    for (let index = 0; index < encoded.length; index += 7) controller.enqueue(encoded.slice(index, index + 7));
    controller.close();
  } }));
}
afterEach(() => { vi.unstubAllGlobals(); });
describe("ChatGPT plan inference", () => {
  it("refuses a changed account or model before sending another takeoff chunk", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(callLocalChatGptStructured(owner, { prompt: "Extract", schema: z.object({ amount: z.number() }) },
      { profileId: "another-profile", model: "account-model" })).rejects.toThrow("a changé");
    await expect(callLocalChatGptStructured(owner, { prompt: "Extract", schema: z.object({ amount: z.number() }) },
      { profileId: "profile-a", model: "another-model" })).rejects.toThrow("a changé");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retains streamed output when the completed plan response carries no output items", async () => {
    const result = await readChatGptResponse(stream([
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: '{"amount":' },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "12}" },
      { type: "response.output_text.done", output_index: 0, content_index: 0, text: '{"amount":12}' },
      { ...completed, response: { ...completed.response, output: [] } },
    ]));
    expect(JSON.parse(result.text)).toEqual({ amount: 12 });
    expect(result.usage.total_tokens).toBe(17);
  });
  it("still rejects streamed text from an empty-output response that never completes", async () => {
    await expect(readChatGptResponse(stream([
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: '{"amount":12}' },
      { type: "response.output_text.done", output_index: 0, content_index: 0, text: '{"amount":12}' },
    ]))).rejects.toThrow();
  });
  it("accepts only a completed stream and reads token usage", async () => {
    const result = await readChatGptResponse(stream([{ type: "response.output_text.delta", delta: "partial" }, completed], true));
    expect(JSON.parse(result.text)).toEqual({ amount: 12 }); expect(result.usage.total_tokens).toBe(17);
  });
  it.each(["response.failed", "response.incomplete", "error"])("rejects terminal %s even after partial output", async (type) => {
    await expect(readChatGptResponse(stream([{ type: "response.output_text.delta", delta: '{"amount":12}' }, { type }]))).rejects.toThrow();
  });
  it("rejects an interrupted stream and explains a late usage limit", async () => {
    await expect(readChatGptResponse(stream([{ type: "response.output_text.delta", delta: "partial" }]))).rejects.toThrow();
    await expect(readChatGptResponse(stream([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }]))).rejects.toThrow("Limite du forfait");
  });
  it("uses the public API and selected model with inline files, no persisted response, and validates business output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stream([completed])); vi.stubGlobal("fetch", fetchMock);
    const result = await callLocalChatGptStructured(owner, { prompt: "Calculate", schema: z.object({ amount: z.number().positive() }), files: [{ data: "cGRm", mimeType: "application/pdf" }] });
    expect(result.data).toEqual({ amount: 12 }); expect(result.model).toBe("account-model"); expect(result.costCents).toBe(0);
    const [url, init] = fetchMock.mock.calls[0]; const body = JSON.parse(init.body);
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({ model: "account-model", store: false, stream: true });
    expect(body).not.toHaveProperty("temperature"); expect(body).not.toHaveProperty("max_output_tokens");
    expect(body.input[1].content[1]).toMatchObject({ type: "input_file", file_data: "data:application/pdf;base64,cGRm" });
    fetchMock.mockResolvedValue(stream([completed]));
    await expect(callLocalChatGptStructured(owner, { prompt: "Calculate", schema: z.object({ amount: z.literal(99) }) })).rejects.toThrow();
  });
  it("sends the persisted reasoning effort on the actual Responses request independently of Gemini settings", async () => {
    vi.mocked(getLocalChatGptCredential).mockResolvedValueOnce({ accessToken: "fixture-secret", profileId: "profile-a", model: "gpt-6.1-terra", reasoningEffort: "max" });
    const fetchMock = vi.fn().mockResolvedValue(stream([completed])); vi.stubGlobal("fetch", fetchMock);
    const result = await callLocalChatGptStructured(owner, { prompt: "Calculate", schema: z.object({ amount: z.number() }), thinkingLevel: "low" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: "gpt-6.1-terra", reasoning: { effort: "max" } });
    expect(result.reasoningEffort).toBe("max");
  });
  it("omits reasoning in automatic mode and refuses a changed effort before another chunk", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stream([completed])); vi.stubGlobal("fetch", fetchMock);
    await callLocalChatGptStructured(owner, { prompt: "Calculate", schema: z.object({ amount: z.number() }) });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("reasoning");
    vi.mocked(getLocalChatGptCredential).mockResolvedValueOnce({ accessToken: "fixture-secret", profileId: "profile-a", model: "account-model", reasoningEffort: "high" });
    await expect(callLocalChatGptStructured(owner, { prompt: "Chunk", schema: z.object({ amount: z.number() }) }, { profileId: "profile-a", model: "account-model", reasoningEffort: "medium" })).rejects.toThrow("niveau d’effort");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["text/plain", "text/csv"])("accepts intake text extracted from spreadsheets and emails (%s)", async (mimeType) => {
    const fetchMock = vi.fn().mockResolvedValue(stream([completed])); vi.stubGlobal("fetch", fetchMock);
    const contents = "Lot;Quantité\nCuivre;12";
    await callLocalChatGptStructured(owner, { prompt: "Classer", schema: z.object({ amount: z.number() }), files: [{ mimeType, data: Buffer.from(contents).toString("base64") }] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input[1].content[1]).toMatchObject({ type: "input_text" });
    expect(body.input[1].content[1].text).toContain("Cuivre;12");
  });
});

// Ways the bench override (TI-660) and the usage of a schema failure could go
// wrong, written before the code (AGENTS.md):
// - an override naming a model the account does not list is sent anyway;
// - an override effort the listed model does not support is sent anyway;
// - validating an override lists the models of a profile without model, and
//   listLocalChatGptModels then writes DEFAULT_CHATGPT_MODEL into the profile;
// - an override is taken as a selection: a changed profile is no longer refused;
// - the request or the result keeps the profile's model or effort instead of the
//   override's (automatic effort must omit `reasoning`);
// - validating or sending an override writes the ChatGPT store;
// - a schema failure (ZodError) or an unparseable answer (SyntaxError) loses the
//   tokens it consumed, or comes back as another error type once usage is attached.
const catalog = { models: [
  { slug: "account-model", display_name: "Account", visibility: "list", supported_reasoning_levels: ["low", "high"] },
  { slug: "other-model", display_name: "Other", visibility: "list", supported_reasoning_levels: [{ effort: "medium" }] },
  { slug: "hidden-model", display_name: "Hidden", visibility: "hide", supported_reasoning_levels: ["low"] },
] };
function routedFetch(answer: unknown[] = [completed]) {
  return vi.fn<(url: string, init?: { body?: string }) => Promise<Response>>(async (url) => (url.endsWith("/models")
    ? new Response(JSON.stringify(catalog), { status: 200 })
    : stream(answer)));
}
const selection = { profileId: "profile-a", model: "account-model", reasoningEffort: null };
const amount = z.object({ amount: z.number() });
describe("ChatGPT override of the profile's model and effort", () => {
  it.each([
    ["an unlisted model", { model: "unknown-model", reasoningEffort: null }],
    ["a hidden model", { model: "hidden-model", reasoningEffort: null }],
    ["an effort the model does not support", { model: "other-model", reasoningEffort: "high" as const }],
  ])("refuses %s before sending anything", async (_case, override) => {
    const fetchMock = routedFetch(); vi.stubGlobal("fetch", fetchMock);
    await expect(callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, selection, override)).rejects.toThrow("pas disponible");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://api.openai.com/v1/models"]);
    expect(saveChatGptStore).not.toHaveBeenCalled();
  });
  it("refuses a profile without model before listing the models, so nothing is written", async () => {
    vi.mocked(getLocalChatGptCredential).mockResolvedValueOnce({ accessToken: "fixture-secret", profileId: "profile-a", model: null, reasoningEffort: null });
    const fetchMock = routedFetch(); vi.stubGlobal("fetch", fetchMock);
    await expect(callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, undefined, { model: "other-model", reasoningEffort: null })).rejects.toThrow("Choisissez un modèle");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(withChatGptLock).not.toHaveBeenCalled();
    expect(saveChatGptStore).not.toHaveBeenCalled();
  });
  it("still refuses a changed profile when an override is given", async () => {
    const fetchMock = routedFetch(); vi.stubGlobal("fetch", fetchMock);
    await expect(callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount },
      { profileId: "profile-a", model: "account-model", reasoningEffort: "low" }, { model: "other-model", reasoningEffort: null })).rejects.toThrow("a changé");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends and reports the override's model and effort, never writing the profile", async () => {
    const fetchMock = routedFetch(); vi.stubGlobal("fetch", fetchMock);
    const result = await callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, selection, { model: "other-model", reasoningEffort: "medium" });
    const body = JSON.parse(fetchMock.mock.calls[1][1]?.body ?? "");
    expect(body).toMatchObject({ model: "other-model", reasoning: { effort: "medium" } });
    expect([result.model, result.reasoningEffort]).toEqual(["other-model", "medium"]);
    fetchMock.mockClear();
    const automatic = await callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, selection, { model: "account-model", reasoningEffort: null });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body ?? "")).not.toHaveProperty("reasoning");
    expect(automatic.reasoningEffort).toBeNull();
    expect(withChatGptLock).not.toHaveBeenCalled();
    expect(saveChatGptStore).not.toHaveBeenCalled();
  });
  it("attaches the consumed usage to a schema failure without changing its type", async () => {
    vi.stubGlobal("fetch", routedFetch());
    const zodFailure = await callLocalChatGptStructured(owner, { prompt: "Extract", schema: z.object({ amount: z.literal(99) }) }).catch((error: unknown) => error);
    expect(zodFailure).toBeInstanceOf(z.ZodError);
    expect(zodFailure).toMatchObject({ usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2, totalTokens: 17 } });
    const text = { ...completed, response: { ...completed.response, output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }] } };
    vi.stubGlobal("fetch", routedFetch([text]));
    const syntaxFailure = await callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }).catch((error: unknown) => error);
    expect(syntaxFailure).toBeInstanceOf(SyntaxError);
    expect(syntaxFailure).toMatchObject({ usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2, totalTokens: 17 } });
  });
});

// Found in review of the bench override (TI-660), written before their fix:
// - a 429, 401 or 403 of the model listing that validates an override comes back
//   as AI_PROVIDER_FAILED, which the bench counts and goes on calling;
// - the override is validated again on every chunk: one more listing and one
//   more credential read inside the time the bench measures;
// - the override check reads the credential a second time, and writes
//   DEFAULT_CHATGPT_MODEL into a selected profile that has no model by then;
// - an in-stream rate limit or quota code comes back as AI_PROVIDER_FAILED;
// - an invalid override is a ZodError, which the bench takes for a schema
//   failure of the answer instead of an unavailable couple.
function credentialOnce(profileId: string, times = 1, model: string | null = "account-model") {
  for (let index = 0; index < times; index += 1) {
    vi.mocked(getLocalChatGptCredential).mockResolvedValueOnce({ accessToken: "fixture-secret", profileId, model, reasoningEffort: null });
  }
}
function paths(fetchMock: { mock: { calls: Array<[string, ...unknown[]]> } }) {
  return fetchMock.mock.calls.map(([url]) => new URL(url).pathname);
}
describe("ChatGPT override check against the account's models", () => {
  it.each([[429, "AI_RATE_LIMIT"], [401, "AI_AUTH_REQUIRED"], [403, "AI_AUTH_REQUIRED"]])("stops on a %i of the model listing with %s, before any request", async (status, code) => {
    credentialOnce(`profile-listing-${status}`);
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/models") ? new Response("", { status }) : stream([completed])));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, undefined, { model: "other-model", reasoningEffort: null }))
      .rejects.toMatchObject({ code });
    expect(paths(fetchMock)).toEqual(["/v1/models"]);
  });
  it("lists the models once per checked couple of a run, not on every chunk", async () => {
    credentialOnce("profile-once", 3);
    const fetchMock = routedFetch(); vi.stubGlobal("fetch", fetchMock);
    const checked = await assertLocalChatGptOverride(owner, { accessToken: "fixture-secret", profileId: "profile-once" },
      { model: "other-model", reasoningEffort: "medium" });
    const reads = vi.mocked(getLocalChatGptCredential).mock.calls.length;
    for (let chunk = 0; chunk < 3; chunk += 1) {
      await callLocalChatGptStructured(owner, { prompt: "Chunk", schema: amount }, undefined, checked);
    }
    expect(paths(fetchMock)).toEqual(["/v1/models", "/v1/responses", "/v1/responses", "/v1/responses"]);
    // One credential read (and lock) per chunk, as for the profile's couple.
    expect(vi.mocked(getLocalChatGptCredential).mock.calls.length - reads).toBe(3);
  });
  it("never writes the store, even when the selected profile has lost its model since the credential was read", async () => {
    credentialOnce("profile-race");
    // Any later read sees the profile without model, as after a new sign-in selected in between.
    vi.mocked(getLocalChatGptCredential).mockResolvedValue({ accessToken: "fixture-secret", profileId: "profile-race", model: null, reasoningEffort: null });
    const withDefault = { models: [...catalog.models, { slug: DEFAULT_CHATGPT_MODEL, display_name: "Default", visibility: "list" }] };
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/models") ? new Response(JSON.stringify(withDefault), { status: 200 }) : stream([completed])));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, undefined, { model: "other-model", reasoningEffort: null });
    } finally {
      vi.mocked(getLocalChatGptCredential).mockResolvedValue({ accessToken: "fixture-secret", model: "account-model", reasoningEffort: null, profileId: "profile-a" });
    }
    expect(withChatGptLock).not.toHaveBeenCalled();
    expect(saveChatGptStore).not.toHaveBeenCalled();
  });
  it("refuses an invalid override as unavailable, not as a schema failure", async () => {
    const fetchMock = routedFetch(); vi.stubGlobal("fetch", fetchMock);
    const error = await callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, selection, { model: " ", reasoningEffort: null })
      .catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(z.ZodError);
    expect(error).toMatchObject({ message: expect.stringContaining("pas disponible") });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([["rate_limit_exceeded", "AI_RATE_LIMIT"], ["insufficient_quota", "AI_QUOTA"]])("maps the in-stream code %s to %s", async (providerCode, code) => {
    await expect(readChatGptResponse(stream([{ type: "response.failed", response: { error: { code: providerCode } } }]))).rejects.toMatchObject({ code });
    await expect(readChatGptResponse(stream([{ type: "error", code: providerCode }]))).rejects.toMatchObject({ code });
  });
});

// Found in the second review, written before its fix:
// - a successful override check is kept for the life of the process: in a
//   long-running server (TI-661), a model or effort the account no longer lists
//   goes straight to /responses instead of being refused as unavailable;
// - a couple checked for one profile is trusted for another profile.
describe("ChatGPT override check scope", () => {
  it("checks a plain override again on every call, so a model the account stopped listing is refused", async () => {
    credentialOnce("profile-relist", 2);
    let listed = catalog;
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/models") ? new Response(JSON.stringify(listed), { status: 200 }) : stream([completed])));
    vi.stubGlobal("fetch", fetchMock);
    const override = { model: "other-model", reasoningEffort: "medium" as const };
    await callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, undefined, override);
    listed = { models: catalog.models.filter((model) => model.slug !== "other-model") };
    await expect(callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, undefined, override)).rejects.toThrow("pas disponible");
    expect(paths(fetchMock)).toEqual(["/v1/models", "/v1/responses", "/v1/models"]);
  });
  it("trusts a checked couple only for the owner and profile it was checked for", async () => {
    const fetchMock = routedFetch(); vi.stubGlobal("fetch", fetchMock);
    const checked = await assertLocalChatGptOverride(owner, { accessToken: "fixture-secret", profileId: "profile-checked" },
      { model: "other-model", reasoningEffort: "medium" });
    credentialOnce("profile-checked");
    await callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, undefined, checked);
    credentialOnce("profile-other");
    await callLocalChatGptStructured(owner, { prompt: "Extract", schema: amount }, undefined, checked);
    credentialOnce("profile-checked");
    await callLocalChatGptStructured({ userId: "user", tenantId: "other-tenant" }, { prompt: "Extract", schema: amount }, undefined, checked);
    expect(paths(fetchMock)).toEqual(["/v1/models", "/v1/responses", "/v1/models", "/v1/responses", "/v1/models", "/v1/responses"]);
  });
});
