import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/assistant/threads-server", () => ({ readAssistantThread: vi.fn(), appendAssistantMessage: vi.fn() }));
vi.mock("@/lib/assistant/model", () => ({ createAssistantModel: vi.fn() }));
vi.mock("@/lib/assistant/tools", () => ({ buildAssistantTools: vi.fn(() => []) }));

import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { prepareAssistantReply, runAssistantReply, type AssistantStreamEvent } from "@/lib/assistant/conversation";
import type { AssistantDocumentLedger } from "@/lib/assistant/document-citations";
import type { AssistantModelRequest, CallAssistantModel } from "@/lib/assistant/loop";
import { buildAssistantTools } from "@/lib/assistant/tools";
import { createAssistantModel } from "@/lib/assistant/model";
import { inConversationOrder } from "@/lib/assistant/thread-order";
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

  const QUESTION = "0b9d6c1e-3f4a-4c2b-9d7e-1a2b3c4d5e6f";

  it("saves an answer whose document citations name only the pages it read, under the document's own name", async () => {
    threadWith([]);
    const cctp = "11111111-1111-4111-8111-111111111111";
    vi.mocked(buildAssistantTools).mockImplementationOnce((scope) => [{
      name: "lire_piece", description: "Lit une pièce.", activity: "Lecture d’une pièce du dossier", input: z.object({}).passthrough(),
      run: async () => {
        (scope.documents as AssistantDocumentLedger).recordRead({ documentId: cctp, fileName: "CCTP.pdf", pagesTotal: 8, from: 1, to: 3, pages: 3, bytes: 10 });
        return { pages_lues: { de: 1, a: 3 } };
      },
    }]);
    const answer = `Le CCTP impose du cuivre [[doc:${cctp}/2|art. 4]] ; la robinetterie est en [[doc:${cctp}/7|art. 9]].`;
    let calls = 0;
    modelAnswering(async (_request, onDelta) => {
      calls += 1;
      if (calls === 1) return { text: "", toolCalls: [{ callId: "c1", name: "lire_piece", arguments: "{}" }], replayItems: [], usage };
      onDelta({ type: "text", delta: answer });
      return { text: answer, toolCalls: [], replayItems: [], usage };
    });
    const events = await reply(await prepareAssistantReply("thread-1", { content: "Que dit le CCTP sur le cuivre ?" }));
    const saved = `Le CCTP impose du cuivre [[doc:${cctp}/2|CCTP.pdf, p. 2]] ; la robinetterie est en art. 9 (source non vérifiée).`;
    expect(appendAssistantMessage).toHaveBeenLastCalledWith(context, expect.objectContaining({ role: "assistant", status: "complete", content: saved }));
    expect(events.at(-1)).toMatchObject({ type: "done", message: { content: saved } });
  });

  describe("a page counts only for what the model wrote after a request that carried it succeeded", () => {
    const cctp = "11111111-1111-4111-8111-111111111111";
    function readTool() {
      vi.mocked(buildAssistantTools).mockImplementationOnce((scope) => [{
        name: "lire_piece", description: "Lit une pièce.", activity: "Lecture d’une pièce du dossier", input: z.object({}).passthrough(),
        run: async () => {
          (scope.documents as AssistantDocumentLedger).recordRead({ documentId: cctp, fileName: "CCTP.pdf", pagesTotal: 8, from: 1, to: 3, pages: 3, bytes: 10 });
          return { pages_lues: { de: 1, a: 3 } };
        },
      }]);
    }

    it("keeps as text a citation written before the read that fetched its page", async () => {
      threadWith([]);
      readTool();
      let calls = 0;
      modelAnswering(async (_request, onDelta) => {
        calls += 1;
        const text = calls === 1 ? `Le CCTP dit [[doc:${cctp}/2|art. 4]].` : `Je confirme [[doc:${cctp}/2|art. 4]].`;
        onDelta({ type: "text", delta: text });
        return calls === 1
          ? { text, toolCalls: [{ callId: "c1", name: "lire_piece", arguments: "{}" }], replayItems: [], usage }
          : { text, toolCalls: [], replayItems: [], usage };
      });
      await reply(await prepareAssistantReply("thread-1", { content: "Que dit le CCTP ?" }));
      expect(appendAssistantMessage).toHaveBeenLastCalledWith(context, expect.objectContaining({
        status: "complete", content: `Le CCTP dit art. 4 (source non vérifiée).\n\nJe confirme [[doc:${cctp}/2|CCTP.pdf, p. 2]].`,
      }));
    });

    it("keeps as text a citation of a page whose request failed", async () => {
      threadWith([]);
      readTool();
      let calls = 0;
      modelAnswering(async (_request, onDelta) => {
        calls += 1;
        if (calls === 1) return { text: "", toolCalls: [{ callId: "c1", name: "lire_piece", arguments: "{}" }], replayItems: [], usage };
        onDelta({ type: "text", delta: `Le CCTP dit [[doc:${cctp}/2|art. 4]]` });
        throw new StructuredAiError("AI_REQUEST_REJECTED", "refusé", 400);
      });
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await reply(await prepareAssistantReply("thread-1", { content: "Que dit le CCTP ?" }));
      expect(appendAssistantMessage).toHaveBeenLastCalledWith(context, expect.objectContaining({
        status: "failed", content: "Le CCTP dit art. 4 (source non vérifiée)",
      }));
    });
  });

  it("answers the question being retried again, without saving it twice nor replaying its failed attempts", async () => {
    threadWith([
      message("m1", "user", "Quel est le total ?"), message("m2", "assistant", "Le total est de 100,00 €."),
      message(QUESTION, "user", "Et la TVA ?"), message("m4", "assistant", "La TV", "interrupted"),
    ]);
    const prepared = await prepareAssistantReply("thread-1", { content: "Et la TVA ?", retryOf: QUESTION });
    expect(appendAssistantMessage).not.toHaveBeenCalled();
    expect(prepared.question).toMatchObject({ id: QUESTION, content: "Et la TVA ?" });
    expect(prepared.history.map((entry) => entry.id)).toEqual(["m1", "m2"]);
  });

  it("refuses a retry when another question was asked since, instead of answering that other question", async () => {
    // Asked from a second tab after the first one failed.
    threadWith([message(QUESTION, "user", "Et la TVA ?"), message("m5", "user", "Et la remise ?")]);
    await expect(prepareAssistantReply("thread-1", { content: "Et la TVA ?", retryOf: QUESTION }))
      .rejects.toMatchObject({ status: 409, code: "ASSISTANT_RETRY_STALE" });
    threadWith([]);
    await expect(prepareAssistantReply("thread-1", { content: "Et la TVA ?", retryOf: QUESTION }))
      .rejects.toMatchObject({ status: 409, code: "ASSISTANT_RETRY_STALE" });
    expect(appendAssistantMessage).not.toHaveBeenCalled();
  });

  it("saves the answer linked to the question it answers, whether new or retried", async () => {
    const answered = async () => ({ text: "Réponse.", toolCalls: [], replayItems: [], usage });
    threadWith([]);
    modelAnswering(answered);
    await reply(await prepareAssistantReply("thread-1", { content: "Total ?" }));
    expect(appendAssistantMessage).toHaveBeenLastCalledWith(context, expect.objectContaining({ role: "assistant", replyTo: "saved" }));
    threadWith([message(QUESTION, "user", "Et la TVA ?"), message("m2", "assistant", "", "failed")]);
    modelAnswering(answered);
    await reply(await prepareAssistantReply("thread-1", { content: "Et la TVA ?", retryOf: QUESTION }));
    expect(appendAssistantMessage).toHaveBeenLastCalledWith(context, expect.objectContaining({ role: "assistant", replyTo: QUESTION }));
  });

  it("sends the model each earlier answer after its own question when a second tab's answer was saved first", async () => {
    // Saved in this order: question A, question B from a second tab, answer B, then answer A.
    const saved = [
      { id: "qa", role: "user" as const, reply_to: null, content: "Quel est le total ?" },
      { id: "qb", role: "user" as const, reply_to: null, content: "Quelle est la remise ?" },
      { id: "rb", role: "assistant" as const, reply_to: "qb", content: "La remise est de 5 %." },
      { id: "ra", role: "assistant" as const, reply_to: "qa", content: "Le total est de 100,00 €." },
    ];
    threadWith(inConversationOrder(saved).map((row) => message(row.id, row.role, row.content)));
    const requests = modelAnswering(async () => ({ text: "20,00 €.", toolCalls: [], replayItems: [], usage }));
    await reply(await prepareAssistantReply("thread-1", { content: "Et la TVA ?" }));
    expect(requests[0]?.input).toEqual([
      { role: "user", content: "Quel est le total ?" }, { role: "assistant", content: "Le total est de 100,00 €." },
      { role: "user", content: "Quelle est la remise ?" }, { role: "assistant", content: "La remise est de 5 %." },
      { role: "user", content: "Et la TVA ?" },
    ]);
  });

  it("retries the last question with every earlier exchange in order, its own attempts left out", async () => {
    // Question A failed, was retried, and question B was asked and answered in a second tab before the retry ended.
    const saved = [
      { id: "qa", role: "user" as const, reply_to: null, content: "Quel est le total ?", status: "complete" as const },
      { id: "ra1", role: "assistant" as const, reply_to: "qa", content: "", status: "failed" as const },
      { id: QUESTION, role: "user" as const, reply_to: null, content: "Quelle est la remise ?", status: "complete" as const },
      { id: "rb", role: "assistant" as const, reply_to: QUESTION, content: "La remi", status: "interrupted" as const },
      { id: "ra2", role: "assistant" as const, reply_to: "qa", content: "Le total est de 100,00 €.", status: "complete" as const },
    ];
    threadWith(inConversationOrder(saved).map((row) => message(row.id, row.role, row.content, row.status)));
    const requests = modelAnswering(async () => ({ text: "5 %.", toolCalls: [], replayItems: [], usage }));
    const prepared = await prepareAssistantReply("thread-1", { content: "Quelle est la remise ?", retryOf: QUESTION });
    expect(prepared.history.map((entry) => entry.id)).toEqual(["qa", "ra1", "ra2"]);
    await reply(prepared);
    expect(requests[0]?.input).toEqual([
      { role: "user", content: "Quel est le total ?" }, { role: "assistant", content: "Le total est de 100,00 €." },
      { role: "user", content: "Quelle est la remise ?" },
    ]);
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
  it("saves a failed answer, with Réessayer, when the forced last request only asks for a tool", async () => {
    threadWith([]);
    vi.mocked(buildAssistantTools).mockImplementationOnce((scope) => [{
      name: "lire_piece", description: "Lit une pièce.", activity: "Lecture d’une pièce du dossier", input: z.object({}).passthrough(),
      run: async () => {
        (scope.documents as AssistantDocumentLedger).recordRead({ documentId: "11111111-1111-4111-8111-111111111111", fileName: "a.pdf", pagesTotal: 99, from: 1, to: 30, pages: 30, bytes: 10 });
        return { pages_lues: { de: 1, a: 30 } };
      },
    }]);
    const call = { text: "", toolCalls: [{ callId: "c1", name: "lire_piece", arguments: "{}" }], replayItems: [], usage };
    const requests = modelAnswering(async () => call);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const events = await reply(await prepareAssistantReply("thread-1", { content: "Que dit le CCTP ?" }));
    // The reading budget is spent: the second request is the last one and offers no tool.
    expect(requests.map((request) => request.toolsAllowed)).toEqual([true, false]);
    expect(appendAssistantMessage).toHaveBeenLastCalledWith(context, expect.objectContaining({
      role: "assistant", status: "failed", errorCode: "AI_PROVIDER_FAILED",
    }));
    expect(events.at(-1)).toMatchObject({ type: "done", error: { code: "AI_PROVIDER_FAILED" } });
  });
});
