import "server-only";

import { z } from "zod";

import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { runAssistantLoop, type AssistantEvent } from "@/lib/assistant/loop";
import { createAssistantModel } from "@/lib/assistant/model";
import { assistantScreenSchema, buildAssistantInstructions } from "@/lib/assistant/prompt";
import {
  appendAssistantMessage, readAssistantThread, type AssistantActivity, type AssistantMessage,
} from "@/lib/assistant/threads-server";
import { buildAssistantTools } from "@/lib/assistant/tools";
import { conflict } from "@/lib/estimates/errors";

export const assistantQuestionSchema = z.object({
  content: z.string().trim().min(1, "Écrivez votre question.").max(4000, "La question dépasse 4 000 caractères."),
  screen: assistantScreenSchema.nullish(),
  /** Answer this saved question again instead of asking a new one. It must still be the conversation's last question. */
  retryOf: z.string().uuid().optional(),
}).strict();

/** What the browser receives while an answer is written, then once it is saved. */
export type AssistantStreamEvent =
  | { type: "started"; question: AssistantMessage }
  | AssistantEvent
  | { type: "done"; message: AssistantMessage | null; error: { code: string; message: string } | null };

const TURN_TIMEOUT_MS = 180_000;
const HISTORY_MESSAGES = 24;
const HISTORY_CHARACTERS = 48_000;

type Prepared = Awaited<ReturnType<typeof prepareAssistantReply>>;

/**
 * Everything that can refuse a question, before any byte is streamed: the
 * conversation, the affaire, and the question itself, which is saved at once
 * so that it survives a failed answer.
 */
export async function prepareAssistantReply(threadId: string, payload: unknown) {
  const input = assistantQuestionSchema.parse(payload);
  const { context, project, thread, messages } = await readAssistantThread(threadId);
  if (input.retryOf) {
    // The question is already saved: answer it again, without the attempts that followed it. If another question
    // was asked since (a second tab), answering « the last one » would answer a question the member is not looking at.
    const index = messages.findLastIndex((message) => message.role === "user");
    const question = messages[index];
    if (!question || question.id !== input.retryOf) {
      throw conflict("Cette conversation a changé ailleurs. Elle a été rechargée : relancez depuis sa dernière question.",
        undefined, "ASSISTANT_RETRY_STALE");
    }
    return { context, project, thread, history: messages.slice(0, index), question, screen: input.screen ?? null };
  }
  const question = await appendAssistantMessage(context, {
    threadId: thread.id, role: "user", content: input.content, screen: input.screen ?? null,
  });
  return { context, project, thread, history: messages, question, screen: input.screen ?? null };
}

/** Earlier exchanges, most recent last, within what one request can carry. Tool results are not replayed: the model reads again. */
function historyInput(history: AssistantMessage[]) {
  const kept: Array<{ role: "user" | "assistant"; content: string }> = [];
  let characters = 0;
  for (const message of history.slice(-HISTORY_MESSAGES).reverse()) {
    if (!message.content.trim() || message.status === "failed") continue;
    characters += message.content.length;
    if (characters > HISTORY_CHARACTERS) break;
    kept.unshift({ role: message.role, content: message.content });
  }
  return kept;
}

function describeFailure(error: unknown) {
  if (error instanceof StructuredAiError) {
    // Which refusal, and the provider's status: the first thing needed when a real request is rejected.
    console.error("assistant_reply_failed", error.code, error.providerStatus ?? "no-status");
    return {
      code: error.code,
      // The shared message of a rejected request speaks of documents: here it is the assistant's request.
      message: error.code === "AI_REQUEST_REJECTED"
        ? "ChatGPT a refusé la demande de l’assistant. Vérifiez le modèle choisi dans Mon profil, puis réessayez."
        : error.message,
    };
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return { code: "AI_TIMEOUT", message: "La réponse a dépassé le délai autorisé. Réessayez avec une question plus ciblée." };
  }
  // The cause stays in the server log by its name only: no provider or database payload.
  console.error("assistant_reply_failed", error instanceof Error ? error.name : "unknown");
  return { code: "AI_FAILED", message: "L’assistant n’a pas pu répondre. Réessayez." };
}

/**
 * Writes the answer to a prepared question, emitting it as it comes, and saves
 * it however it ends: complete, interrupted by the member (what was written is
 * kept) or failed (the reason is told, nothing else is tried). It always ends
 * with one `done` event.
 */
export async function runAssistantReply(prepared: Prepared, emit: (event: AssistantStreamEvent) => void, interrupted: AbortSignal) {
  const { context, project, thread } = prepared;
  let written = "";
  let afterTool = false;
  const activity: AssistantActivity[] = [];
  const started = new Map<string, { name: string; activity: string }>();
  const forward = (event: AssistantEvent) => {
    if (event.type === "text") {
      // Text written after a read starts a new paragraph, here as in the saved answer.
      const delta = afterTool && written ? `\n\n${event.delta}` : event.delta;
      afterTool = false;
      written += delta;
      emit({ type: "text", delta });
      return;
    }
    if (event.type === "tool_started") started.set(event.callId, { name: event.name, activity: event.activity });
    if (event.type === "tool_finished") {
      const tool = started.get(event.callId);
      if (tool) activity.push({ ...tool, ok: event.ok });
      afterTool = true;
    }
    emit(event);
  };

  let outcome: Parameters<typeof appendAssistantMessage>[1] | null;
  let failure: { code: string; message: string } | null = null;
  let model: ReturnType<typeof createAssistantModel> | null = null;
  try {
    const tools = buildAssistantTools({ context, projectId: project.id });
    model = createAssistantModel({
      owner: { userId: context.userId, tenantId: context.tenantId }, tools,
      instructions: buildAssistantInstructions({
        project: { name: project.name, reference: project.reference, clientName: project.client_name },
        screen: prepared.screen, today: new Date().toISOString().slice(0, 10),
      }),
    });
    const result = await runAssistantLoop({
      input: [...historyInput(prepared.history), { role: "user", content: prepared.question.content }],
      tools, callModel: model.callModel, emit: forward,
      signal: AbortSignal.any([interrupted, AbortSignal.timeout(TURN_TIMEOUT_MS)]),
    });
    outcome = {
      threadId: thread.id, role: "assistant", status: "complete", content: written.trim() || result.text,
      activity: result.tools, model: model.lastModel(), tokenUsage: result.usage,
    };
  } catch (error) {
    failure = interrupted.aborted ? null : describeFailure(error);
    // Stopped before anything was written or read: there is nothing to keep.
    outcome = !failure && !written.trim() && activity.length === 0 ? null : {
      threadId: thread.id, role: "assistant", status: failure ? "failed" : "interrupted", content: written.trim(),
      activity, model: model?.lastModel() ?? null, errorCode: failure?.code ?? null,
    };
  }
  if (outcome === null) {
    emit({ type: "done", message: null, error: null });
    return;
  }
  try {
    emit({ type: "done", message: await appendAssistantMessage(context, outcome), error: failure });
  } catch {
    emit({ type: "done", message: null, error: failure ?? { code: "AI_NOT_SAVED", message: "La réponse n’a pas pu être enregistrée. Elle reste affichée jusqu’au rechargement." } });
  }
}
