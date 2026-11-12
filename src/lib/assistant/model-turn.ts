import "server-only";

import { z } from "zod";

import { chatGptIncompleteError, chatGptStreamEvents } from "@/lib/ai/chatgpt-local-inference";

/** What the browser may show before the turn is known to have succeeded. */
export type AssistantModelDelta = { type: "text"; delta: string };
export type AssistantToolCall = { callId: string; name: string; arguments: string };
export type AssistantTokenUsage = { inputTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number };
export type AssistantModelTurn = {
  text: string;
  toolCalls: AssistantToolCall[];
  /** The turn's output items as received: without server-side storage the next request sends them back. */
  replayItems: Record<string, unknown>[];
  usage: AssistantTokenUsage;
};

const usageSchema = z.object({
  input_tokens: z.number().default(0), output_tokens: z.number().default(0), total_tokens: z.number().default(0),
  output_tokens_details: z.object({ reasoning_tokens: z.number().default(0) }).optional(),
});
const toolCallSchema = z.object({ call_id: z.string().min(1), name: z.string().min(1), arguments: z.string() });
const messageSchema = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]) });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One answer of the model: its text, passed on as it arrives, and the tools it
 * asks for. Text already shown stays partial until this resolves; a stream that
 * fails or stops early rejects with the provider's fixed message.
 */
export async function readAssistantModelTurn(
  response: Response, onDelta: (delta: AssistantModelDelta) => void,
): Promise<AssistantModelTurn> {
  let completed: Record<string, unknown> | null = null;
  let streamedText = "";
  const finishedItems = new Map<number, Record<string, unknown>>();
  for await (const event of chatGptStreamEvents(response)) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      streamedText += event.delta;
      onDelta({ type: "text", delta: event.delta });
    }
    if (event.type === "response.output_item.done" && isRecord(event.item)) {
      finishedItems.set(event.output_index ?? finishedItems.size, event.item);
    }
    if (event.type === "response.completed") completed = event.response ?? null;
  }
  if (!completed || completed.status !== "completed") throw chatGptIncompleteError();

  // ChatGPT plan streams can leave `output` empty in the completed response:
  // the items finished during the stream are then the only record of the turn.
  const replayItems = finishedItems.size > 0
    ? [...finishedItems.entries()].sort(([left], [right]) => left - right).map(([, item]) => item)
    : (Array.isArray(completed.output) ? completed.output.filter(isRecord) : []);

  const toolCalls: AssistantToolCall[] = [];
  let finalText = "";
  for (const item of replayItems) {
    if (item.type === "function_call") {
      const call = toolCallSchema.safeParse(item);
      if (!call.success) throw chatGptIncompleteError();
      toolCalls.push({ callId: call.data.call_id, name: call.data.name, arguments: call.data.arguments });
    } else if (item.type === "message") {
      const message = messageSchema.safeParse(item);
      if (message.success) {
        finalText += message.data.content.filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
      }
    }
  }
  if (!streamedText && finalText) onDelta({ type: "text", delta: finalText });
  const text = streamedText || finalText;
  if (!text && toolCalls.length === 0) throw chatGptIncompleteError();

  const usage = usageSchema.parse(completed.usage ?? {});
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0;
  return {
    text, toolCalls, replayItems,
    usage: {
      inputTokens: usage.input_tokens, outputTokens: Math.max(0, usage.output_tokens - reasoningTokens),
      reasoningTokens, totalTokens: usage.total_tokens,
    },
  };
}
