import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assistant/threads-server", () => ({ readAssistantThread: vi.fn(), appendAssistantMessage: vi.fn() }));
vi.mock("@/lib/assistant/model", () => ({ createAssistantModel: vi.fn() }));
vi.mock("@/lib/assistant/tools", () => ({ buildAssistantTools: vi.fn(() => []) }));

import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { prepareAssistantReply, runAssistantReply, type AssistantStreamEvent } from "@/lib/assistant/conversation";
import type { AssistantModelRequest, CallAssistantModel } from "@/lib/assistant/loop";
import { createAssistantModel } from "@/lib/assistant/model";
import { appendAssistantMessage, readAssistantThread, type AssistantMessage } from "@/lib/assistant/threads-server";

const context = { userId: "user-1", tenantId: "tenant-1" };
const project = { id: "project-1", name: "Chaufferie", reference: null, client_name: null };
const thread = { id: "thread-1", projectId: "project-1", title: "Prix", updatedAt: "2026-11-12T10:00:00Z" };
const usage = { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 };
const message = (id: string, role: "user" | "assistant", content: string, status: AssistantMessage["status"] = "complete"): AssistantMessage =>
  ({ id, role, status, content, activity: [], errorCode: null, createdAt: "2026-11-12T10:00:00Z" });

function threadWith(messages: AssistantMessage[]) {
  vi.mocked(readAssistantThread).mockResolvedValue({ context, project, thread, messages } as never);
}
/** The model of one reply: what it was sent, and how it answers. */
function modelAnswering(callModel: CallAssistantModel) {
  const requests: AssistantModelRequest[] = [];
  vi.mocked(createAssistantModel).mockReturnValue({
    lastModel: () => "fixture-model",
    callModel: (request, onDelta, signal) => { requests.push(structuredClone(request)); return callModel(request, onDelta, signal); },
  });
  return requests;
}
async function reply(prepared: Awaited<ReturnType<typeof prepareAssistantReply>>, interrupted = new AbortController().signal) {
  const events: AssistantStreamEvent[] = [];
  await runAssistantReply(prepared, (event) => { events.push(event); }, interrupted);
  return events;
}

describe("assistant conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(appendAssistantMessage).mockImplementation(async (_context, input) =>
      ({ ...message("saved", input.role, input.content, input.status ?? "complete"), activity: input.activity ?? [], errorCode: input.errorCode ?? null }));
  });

  it("saves a new question at once and answers it with the earlier exchanges, failed attempts left out", async () => {
    threadWith([
      message("m1", "user", "Quel est le total ?"), message("m2", "assistant", "", "failed"),
      message("m3", "assistant", "Le total est de 100,00 €."),
    ]);
    const requests = modelAnswering(async (_request, onDelta) => {
      onDelta({ type: "text", delta: "La TVA est de 20,00 €." });
      return { text: "La TVA est de 20,00 €.", toolCalls: [], replayItems: [], usage };
    });
    const prepared = await prepareAssistantReply("thread-1", { content: "  Et la TVA ?  " });
    expect(appendAssistantMessage).toHaveBeenCalledWith(context, { threadId: "thread-1", role: "user", content: "Et la TVA ?", screen: null });
    const events = await reply(prepared);
    expect(requests[0]?.input).toEqual([
      { role: "user", content: "Quel est le total ?" }, { role: "assistant", content: "Le total est de 100,00 €." },
      { role: "user", content: "Et la TVA ?" },
    ]);
    expect(appendAssistantMessage).toHaveBeenLastCalledWith(context, expect.objectContaining({
      role: "assistant", status: "complete", content: "La TVA est de 20,00 €.", model: "fixture-model", tokenUsage: usage,
    }));
    expect(events.at(-1)).toMatchObject({ type: "done", error: null, message: { status: "complete" } });
  });

  it("answers the last saved question again on retry, without saving it twice nor replaying its failed attempts", async () => {
    threadWith([
      message("m1", "user", "Quel est le total ?"), message("m2", "assistant", "Le total est de 100,00 €."),
      message("m3", "user", "Et la TVA ?"), message("m4", "assistant", "La TV", "interrupted"),
    ]);
    const prepared = await prepareAssistantReply("thread-1", { content: "ignoré : la question est déjà enregistrée", retry: true });
    expect(appendAssistantMessage).not.toHaveBeenCalled();
    expect(prepared.question).toMatchObject({ id: "m3", content: "Et la TVA ?" });
    expect(prepared.history.map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("refuses a retry in a conversation that holds no question", async () => {
    threadWith([]);
    await expect(prepareAssistantReply("thread-1", { content: "Relance", retry: true })).rejects.toThrow("Aucune question à relancer");
  });

  it("keeps what was written when the provider fails mid-answer, and tells the member why", async () => {
    threadWith([]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    modelAnswering(async (_request, onDelta) => {
      onDelta({ type: "text", delta: "Le total " });
      throw new StructuredAiError("AI_QUOTA", "Limite du forfait ChatGPT atteinte.", 429);
    });
    const events = await reply(await prepareAssistantReply("thread-1", { content: "Total ?" }));
    expect(appendAssistantMessage).toHaveBeenLastCalledWith(context, expect.objectContaining({
      role: "assistant", status: "failed", content: "Le total", errorCode: "AI_QUOTA",
    }));
    expect(events.at(-1)).toMatchObject({ type: "done", error: { code: "AI_QUOTA", message: "Limite du forfait ChatGPT atteinte." } });
    // The log names the refusal and its status, never the question or the answer.
    expect(error).toHaveBeenCalledWith("assistant_reply_failed", "AI_QUOTA", 429);
    error.mockRestore();
  });

  it("words a rejected request for the assistant, not for a document", async () => {
    threadWith([]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    modelAnswering(async () => { throw new StructuredAiError("AI_REQUEST_REJECTED", "ChatGPT a refusé le document ou le format demandé.", 400); });
    const events = await reply(await prepareAssistantReply("thread-1", { content: "Total ?" }));
    expect(events.at(-1)).toMatchObject({ error: { code: "AI_REQUEST_REJECTED", message: expect.stringContaining("demande de l’assistant") } });
    error.mockRestore();
  });

  it("saves an answer the member stopped as interrupted, with what was written, and reports no error", async () => {
    threadWith([]);
    const controller = new AbortController();
    modelAnswering(async (_request, onDelta, signal) => {
      onDelta({ type: "text", delta: "Le total est" });
      controller.abort();
      signal.throwIfAborted();
      throw new Error("unreachable");
    });
    const events = await reply(await prepareAssistantReply("thread-1", { content: "Total ?" }), controller.signal);
    expect(appendAssistantMessage).toHaveBeenLastCalledWith(context, expect.objectContaining({
      role: "assistant", status: "interrupted", content: "Le total est", errorCode: null,
    }));
    expect(events.at(-1)).toMatchObject({ type: "done", error: null, message: { status: "interrupted" } });
  });

  it("saves nothing for an answer stopped before a single word or read", async () => {
    threadWith([]);
    const controller = new AbortController();
    controller.abort();
    modelAnswering(async () => { throw new Error("never called"); });
    const prepared = await prepareAssistantReply("thread-1", { content: "Total ?" });
    vi.mocked(appendAssistantMessage).mockClear();
    const events = await reply(prepared, controller.signal);
    expect(appendAssistantMessage).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "done", message: null, error: null }]);
  });

  it("still ends the stream when the answer cannot be saved", async () => {
    threadWith([]);
    modelAnswering(async (_request, onDelta) => {
      onDelta({ type: "text", delta: "Réponse." });
      return { text: "Réponse.", toolCalls: [], replayItems: [], usage };
    });
    const prepared = await prepareAssistantReply("thread-1", { content: "Total ?" });
    vi.mocked(appendAssistantMessage).mockRejectedValue(new Error("row security"));
    const events = await reply(prepared);
    expect(events.at(-1)).toMatchObject({ type: "done", message: null, error: { code: "AI_NOT_SAVED" } });
  });
});
