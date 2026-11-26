"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { readAiRequestOptions } from "@/lib/ai/request-settings-server";
import { assertAssistantRequest, isAssistantEnabled } from "@/lib/assistant/model";
import { ASSISTANT_AI_SOURCES, type AssistantAiOptions } from "@/lib/assistant/request-settings";
import {
  createAssistantThread, deleteAssistantThread, listAssistantThreads, readAssistantThread, requireAssistantProject,
  type AssistantMessage, type AssistantThread,
} from "@/lib/assistant/threads-server";
import { ApiError } from "@/lib/http/api-response";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

const id = z.string().uuid();
const titleSchema = z.string().trim().min(1).max(4000);

/** A refusal worded for the member is passed on; anything else gets one fixed sentence. */
async function result<T>(read: () => Promise<T>): Promise<Result<T>> {
  try {
    assertAssistantRequest((await headers()).get("host"));
    return { ok: true, data: await read() };
  } catch (error) {
    if (!(error instanceof ApiError) && !(error instanceof z.ZodError)) {
      console.error("assistant_action_failed", error instanceof Error ? error.name : "unknown");
    }
    return { ok: false, message: error instanceof ApiError ? error.message : "L’assistant est momentanément indisponible." };
  }
}

/** A conversation is named after its first question, cut at a word. */
function threadTitle(question: string) {
  const line = question.replace(/\s+/g, " ").trim();
  if (line.length <= 80) return line;
  const cut = line.slice(0, 80);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 80)}…`;
}

export async function loadAssistantThreads(projectId: string): Promise<Result<AssistantThread[]>> {
  if (!isAssistantEnabled()) return { ok: true, data: [] };
  return result(() => listAssistantThreads(id.parse(projectId)));
}

export async function loadAssistantAiOptions(projectId: string): Promise<Result<AssistantAiOptions>> {
  return result(async () => {
    const { context: { userId, tenantId } } = await requireAssistantProject(id.parse(projectId));
    const { defaultSource, options } = await readAiRequestOptions({ userId, tenantId }, { allowedSources: ASSISTANT_AI_SOURCES });
    const sources: AssistantAiOptions["sources"] = {};
    for (const source of ASSISTANT_AI_SOURCES) {
      const option = options[source];
      if (!option) continue;
      sources[source] = option.ok
        ? { available: true, message: option.message, models: option.models, preferences: option.preferences }
        : { available: false, message: option.message };
    }
    const key = options.personal_api_key;
    return { defaultSource, sources, keyConnectionId: key?.ok ? key.connection?.id ?? null : null };
  });
}

export async function loadAssistantThread(threadId: string): Promise<Result<{ thread: AssistantThread; messages: AssistantMessage[] }>> {
  return result(async () => {
    const { thread, messages } = await readAssistantThread(id.parse(threadId));
    return { thread, messages };
  });
}

export async function startAssistantThread(projectId: string, firstQuestion: string): Promise<Result<AssistantThread>> {
  return result(() => createAssistantThread(id.parse(projectId), threadTitle(titleSchema.parse(firstQuestion))));
}

export async function removeAssistantThread(threadId: string): Promise<Result<null>> {
  return result(async () => {
    await deleteAssistantThread(id.parse(threadId));
    return null;
  });
}
