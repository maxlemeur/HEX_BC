"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { assertAssistantRequest, isAssistantEnabled } from "@/lib/assistant/model";
import {
  createAssistantThread, deleteAssistantThread, listAssistantThreads, readAssistantThread,
  type AssistantMessage, type AssistantThread,
} from "@/lib/assistant/threads-server";
import { ApiError } from "@/lib/estimates/errors";

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
