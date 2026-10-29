import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/ai/chatgpt-local-auth", () => ({ getLocalChatGptCredential: vi.fn().mockResolvedValue({ accessToken: "fixture-secret", model: "account-model", profileId: "profile-a" }) }));
import { callLocalChatGptStructured, readChatGptResponse } from "@/lib/ai/chatgpt-local-inference";
import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";

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
