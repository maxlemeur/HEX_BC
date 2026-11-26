import "server-only";

import { z } from "zod";

import { isApiKeyError } from "@/lib/ai/access/api-key-errors";
import { chatGptReasoningEffortSchema } from "@/lib/ai/chatgpt-model-preferences";
import { readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { resolveAiRequest } from "@/lib/ai/request-settings-server";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { AssistantDocumentLedger } from "@/lib/assistant/document-citations";
import { runAssistantLoop, type AssistantEvent } from "@/lib/assistant/loop";
import { createAssistantModel, readAssistantPlanToken, type AssistantAccess } from "@/lib/assistant/model";
import { assistantScreenSchema, buildAssistantInstructions } from "@/lib/assistant/prompt";
import { ASSISTANT_AI_SOURCES } from "@/lib/assistant/request-settings";
import type { AssistantSourceLink } from "@/lib/assistant/session-context";
import {
  appendAssistantMessage, readAssistantThread, type AssistantActivity, type AssistantMessage,
} from "@/lib/assistant/threads-server";
import { buildAssistantTools } from "@/lib/assistant/tools";
import { conflict } from "@/lib/http/api-response";

export const assistantTurnSettingsSchema = z.object({
  source: z.enum(ASSISTANT_AI_SOURCES),
  model: z.string().min(1).max(120),
  effort: chatGptReasoningEffortSchema.nullable(),
  connectionId: z.string().uuid().optional(),
}).strict();

export const assistantQuestionSchema = z.object({
  content: z.string().trim().min(1, "Écrivez votre question.").max(4000, "La question dépasse 4 000 caractères."),
  screen: assistantScreenSchema.nullish(),
  /** Answer this saved question again instead of asking a new one. It must still be the conversation's last question. */
  retryOf: z.string().uuid().optional(),
  aiSettings: assistantTurnSettingsSchema.optional(),
}).strict();

/** What the browser receives while an answer is written, then once it is saved. */
export type AssistantStreamEvent =
  | { type: "started"; question: AssistantMessage }
  | AssistantEvent
  | { type: "done"; message: AssistantMessage | null; error: { code: string; message: string } | null;
      sources?: AssistantSourceLink[]; projectId?: string; workbookExclusion?: string };

export const ASSISTANT_TURN_TIMEOUT_MS = 180_000;
const HISTORY_MESSAGES = 24;
const HISTORY_CHARACTERS = 48_000;

type Prepared = Awaited<ReturnType<typeof prepareAssistantReply>>;

/**
 * Everything that can refuse a question, before any byte is streamed: the
 * conversation, the affaire, and the question itself, which is saved at once
 * so that it survives a failed answer.
 */
export async function prepareAssistantReply(threadId: string, payload: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const input = assistantQuestionSchema.parse(payload);
  const { context, project, thread, messages } = await readAssistantThread(threadId);
  const index = input.retryOf ? messages.findLastIndex((message) => message.role === "user") : -1;
  if (input.retryOf) {
    // The question is already saved: answer it again, without the attempts that followed it. If another question
    // was asked since (a second tab), answering « the last one » would answer a question the member is not looking at.
    if (messages[index]?.id !== input.retryOf) {
      throw conflict("Cette conversation a changé ailleurs. Elle a été rechargée : relancez depuis sa dernière question.",
        undefined, "ASSISTANT_RETRY_STALE");
    }
  }

  const access = await resolveAssistantAccess({ userId: context.userId, tenantId: context.tenantId }, input.aiSettings);
  signal?.throwIfAborted();
  const question = input.retryOf ? messages[index]! : await appendAssistantMessage(context, {
    threadId: thread.id, role: "user", content: input.content, screen: input.screen ?? null,
  });
  return { context, project, thread, history: input.retryOf ? messages.slice(0, index) : messages, question, screen: input.screen ?? null, access };
}

export async function resolveAssistantAccess(
  owner: ChatGptOwner, settings: z.infer<typeof assistantTurnSettingsSchema> | undefined,
): Promise<AssistantAccess> {
  if (settings?.source === "personal_api_key" && !settings.connectionId) {
    throw conflict("Rechargez l’assistant pour vérifier la clé API et le plafond avant l’envoi.", undefined, "ASSISTANT_AI_CONNECTION_CHANGED");
  }
  // Pin the plan grant before resolving its model catalogue, so an account changed
  // during validation cannot sign the message with a different subscription.
  const planStore = settings?.source === "personal_api_key" ? null : await readChatGptStore(owner).catch(() => null);
  const plan = planStore?.profiles.find((profile) => profile.id === planStore.selectedId);
  const planGrant = plan?.authorizationId ? { profileId: plan.id, authorizationId: plan.authorizationId } : null;
  const resolved = await resolveAiRequest(planGrant ? { ...owner, connection: planGrant } : owner,
    { allowedSources: ASSISTANT_AI_SOURCES }, {
      source: settings?.source, model: settings?.model, effort: settings?.effort,
      expectedConnectionId: settings?.connectionId,
    });
  if (!resolved.ok) {
    throw conflict(resolved.message, undefined, `ASSISTANT_AI_${resolved.reason.toUpperCase()}`);
  }
  if (resolved.source === "personal_api_key") {
    if (!settings?.connectionId || !resolved.connection) {
      throw conflict("Rechargez l’assistant pour vérifier la clé API et le plafond avant l’envoi.", undefined, "ASSISTANT_AI_CONNECTION_CHANGED");
    }
    return { source: resolved.source, preferences: resolved.preferences,
      connectionId: resolved.connection.id, connectionVersion: resolved.connection.version };
  } else {
    if (!planGrant) throw conflict("Connectez votre compte ChatGPT dans Mon profil.", undefined, "AI_AUTH_REQUIRED");
    await readAssistantPlanToken({ ...owner, connection: planGrant }).catch((error: unknown) => {
      if (error instanceof StructuredAiError) throw conflict(error.message, undefined, error.code);
      throw error;
    });
    return { source: resolved.source, preferences: resolved.preferences, connection: planGrant };
  }
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

export function describeAssistantFailure(error: unknown) {
  if (isApiKeyError(error)) {
    console.error("assistant_reply_failed", error.code, error.providerStatus ?? "no-status");
    const message = error.code === "AI_KEY_COUNT_UNAVAILABLE"
      ? "OpenAI n’a pas pu compter les jetons de l’appel suivant. L’assistant a arrêté la réponse pour respecter le plafond."
      : error.code === "AI_KEY_COST_UNKNOWN"
        ? "OpenAI a annoncé une consommation qui ne correspond pas au calcul avant l’envoi. L’assistant a arrêté la réponse."
        : error.message;
    return { code: error.code, message };
  }
  if (error instanceof StructuredAiError) {
    // Which refusal, and the provider's status: the first thing needed when a real request is rejected.
    console.error("assistant_reply_failed", error.code, error.providerStatus ?? "no-status");
    return {
      code: error.code,
      // The shared message of a rejected request speaks of documents: here it is the assistant's request.
      message: error.code === "AI_REQUEST_REJECTED"
        ? "ChatGPT a refusé la demande de l’assistant. Vérifiez le modèle choisi, puis réessayez."
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
  // The documents this answer reads. Each request's text has its citations checked against the pages seen by the
  // time that request succeeded: a page read later, or carried by a request that failed, cannot be cited by it.
  const documents = new AssistantDocumentLedger();
  let checked = "";
  let pending = "";
  const savedText = () => (checked + documents.resolveCitations(pending)).trim();
  const forward = (event: AssistantEvent) => {
    if (event.type === "model_turn_finished") {
      checked += documents.resolveCitations(pending);
      pending = "";
      return;
    }
    if (event.type === "text") {
      // Text written after a read starts a new paragraph, here as in the saved answer.
      const delta = afterTool && written ? `\n\n${event.delta}` : event.delta;
      afterTool = false;
      written += delta;
      pending += delta;
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
  const provenance = () => model?.dispatched() ? {
    model: prepared.access.preferences.model, reasoningEffort: prepared.access.preferences.reasoningEffort,
  } : {};
  try {
    const tools = buildAssistantTools({ context, projectId: project.id, documents });
    model = createAssistantModel({
      owner: { userId: context.userId, tenantId: context.tenantId }, access: prepared.access, tools,
      instructions: buildAssistantInstructions({
        project: { name: project.name, reference: project.reference, clientName: project.client_name },
        screen: prepared.screen, today: new Date().toISOString().slice(0, 10),
      }),
    });
    const result = await runAssistantLoop({
      input: [...historyInput(prepared.history), { role: "user", content: prepared.question.content }],
      tools, callModel: model.callModel, emit: forward, documents,
      signal: AbortSignal.any([interrupted, AbortSignal.timeout(ASSISTANT_TURN_TIMEOUT_MS)]),
    });
    outcome = {
      threadId: thread.id, role: "assistant", replyTo: prepared.question.id, status: "complete",
      content: savedText() || documents.resolveCitations(result.text),
      activity: result.tools, ...provenance(), tokenUsage: result.usage,
    };
  } catch (error) {
    const ceiling = !interrupted.aborted && isApiKeyError(error) && error.code === "AI_KEY_CEILING";
    failure = interrupted.aborted || ceiling ? null : describeAssistantFailure(error);
    // Stopped before anything was written or read: there is nothing to keep.
    outcome = !failure && !ceiling && !written.trim() && activity.length === 0 ? null : {
      threadId: thread.id, role: "assistant", replyTo: prepared.question.id, status: failure ? "failed" : "interrupted",
      content: savedText(),
      activity, ...provenance(), errorCode: ceiling ? "AI_KEY_CEILING" : failure?.code ?? null,
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
