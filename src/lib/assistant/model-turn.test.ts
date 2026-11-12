import { describe, expect, it } from "vitest";

import { readAssistantModelTurn, type AssistantModelDelta } from "@/lib/assistant/model-turn";

const usage = { input_tokens: 40, output_tokens: 12, total_tokens: 52, output_tokens_details: { reasoning_tokens: 5 } };
const reasoningItem = { type: "reasoning", id: "rs_1", encrypted_content: "opaque", summary: [] };
const callItem = {
  type: "function_call", id: "fc_1", call_id: "call_1", name: "lire_devis", arguments: '{"versionId":"v-1"}', status: "completed",
};

function stream(events: unknown[], chunk = 7) {
  const encoded = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  return new Response(new ReadableStream({ start(controller) {
    // Events, UTF-8 sequences and JSON arguments all cross network chunks.
    for (let index = 0; index < encoded.length; index += chunk) controller.enqueue(encoded.slice(index, index + chunk));
    controller.close();
  } }));
}

async function read(events: unknown[]) {
  const deltas: AssistantModelDelta[] = [];
  const turn = await readAssistantModelTurn(stream(events), (delta) => { deltas.push(delta); });
  return { turn, deltas };
}

describe("assistant model turn", () => {
  it("passes text on as it arrives and returns the whole answer once the response completed", async () => {
    const { turn, deltas } = await read([
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Le prix unitaire " },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "vient du déboursé." },
      { type: "response.completed", response: { status: "completed", output: [], usage } },
    ]);
    expect(deltas).toEqual([{ type: "text", delta: "Le prix unitaire " }, { type: "text", delta: "vient du déboursé." }]);
    expect(turn.text).toBe("Le prix unitaire vient du déboursé.");
    expect(turn.toolCalls).toEqual([]);
    expect(turn.usage).toEqual({ inputTokens: 40, outputTokens: 7, reasoningTokens: 5, totalTokens: 52 });
  });

  it("rebuilds a tool call from its finished item when the completed plan response carries no output", async () => {
    const { turn, deltas } = await read([
      { type: "response.output_item.added", output_index: 0, item: { ...reasoningItem, encrypted_content: undefined } },
      { type: "response.output_item.done", output_index: 0, item: reasoningItem },
      { type: "response.output_item.added", output_index: 1, item: { ...callItem, arguments: "", status: "in_progress" } },
      { type: "response.function_call_arguments.delta", output_index: 1, item_id: "fc_1", delta: '{"versionId":' },
      { type: "response.function_call_arguments.done", output_index: 1, item_id: "fc_1", arguments: '{"versionId":"v-1"}' },
      { type: "response.output_item.done", output_index: 1, item: callItem },
      { type: "response.completed", response: { status: "completed", output: [], usage } },
    ]);
    expect(turn.toolCalls).toEqual([{ callId: "call_1", name: "lire_devis", arguments: '{"versionId":"v-1"}' }]);
    // Without server-side storage the next request must send these items back, reasoning first.
    expect(turn.replayItems).toEqual([reasoningItem, callItem]);
    expect(turn.text).toBe("");
    expect(deltas).toEqual([]);
  });

  it("orders several output items by their index, not by their arrival", async () => {
    const second = { ...callItem, id: "fc_2", call_id: "call_2", name: "lire_metre", arguments: "{}" };
    const { turn } = await read([
      { type: "response.output_item.done", output_index: 2, item: second },
      { type: "response.output_item.done", output_index: 1, item: callItem },
      { type: "response.completed", response: { status: "completed", output: [], usage } },
    ]);
    expect(turn.toolCalls.map((call) => call.callId)).toEqual(["call_1", "call_2"]);
  });

  it("uses the completed response's output when the stream carried no item event", async () => {
    const { turn } = await read([
      { type: "response.completed", response: { status: "completed", usage, output: [
        callItem, { type: "message", content: [{ type: "output_text", text: "Je consulte le devis." }] },
      ] } },
    ]);
    expect(turn.toolCalls).toEqual([{ callId: "call_1", name: "lire_devis", arguments: '{"versionId":"v-1"}' }]);
    expect(turn.text).toBe("Je consulte le devis.");
  });

  it("refuses a tool call without the identifier its result must answer", async () => {
    await expect(read([
      { type: "response.output_item.done", output_index: 0, item: { ...callItem, call_id: undefined } },
      { type: "response.completed", response: { status: "completed", output: [], usage } },
    ])).rejects.toThrow("ChatGPT n’a pas terminé la demande");
  });

  it("fails after partial text when the plan's allowance runs out mid-answer", async () => {
    const deltas: AssistantModelDelta[] = [];
    await expect(readAssistantModelTurn(stream([
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Le total " },
      { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } },
    ]), (delta) => { deltas.push(delta); })).rejects.toThrow("Limite du forfait");
    expect(deltas).toEqual([{ type: "text", delta: "Le total " }]);
  });

  it("fails when the stream stops before the response completed", async () => {
    await expect(read([
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Le total est" },
    ])).rejects.toThrow("ChatGPT n’a pas terminé la demande");
  });

  it("maps a refused request to the reconnect message without reading its body", async () => {
    await expect(readAssistantModelTurn(new Response("secret provider payload", { status: 401 }), () => undefined))
      .rejects.toThrow("Reconnectez votre compte");
  });
});
