import "server-only";

import { z } from "zod";

import { requireAffaireProjectReadAccess } from "@/lib/affaires/intake-server";
import { isAssistantEnabled } from "@/lib/assistant/model";
import type { AssistantTokenUsage } from "@/lib/assistant/model-turn";
import type { AssistantScreen } from "@/lib/assistant/prompt";
import { inConversationOrder } from "@/lib/assistant/thread-order";
import { mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server-context";

export type AssistantThread = { id: string; projectId: string; title: string; updatedAt: string };
export type AssistantActivity = { name: string; activity: string; ok: boolean };
export type AssistantMessage = {
  id: string; role: "user" | "assistant"; status: "complete" | "interrupted" | "failed";
  content: string; activity: AssistantActivity[]; errorCode: string | null; createdAt: string;
};

const THREAD_COLUMNS = "id, project_id, title, updated_at";
const MESSAGE_COLUMNS = "id, role, reply_to, status, content, activity, error_code, created_at";
/** The most recent messages read back; an answer whose question is older is left out with it. */
const MESSAGES_SHOWN = 200;
const activitySchema = z.array(z.object({ name: z.string(), activity: z.string(), ok: z.boolean() })).catch([]);

type Access = Awaited<ReturnType<typeof requireAffaireProjectReadAccess>>;
type ThreadRow = { id: string; project_id: string; title: string; updated_at: string };
type MessageRow = {
  id: string; role: "user" | "assistant"; reply_to: string | null; status: "complete" | "interrupted" | "failed";
  content: string; activity: unknown; error_code: string | null; created_at: string;
};

function toThread(row: ThreadRow): AssistantThread {
  return { id: row.id, projectId: row.project_id, title: row.title, updatedAt: row.updated_at };
}
function toMessage(row: MessageRow): AssistantMessage {
  return {
    id: row.id, role: row.role, status: row.status, content: row.content,
    activity: activitySchema.parse(row.activity), errorCode: row.error_code, createdAt: row.created_at,
  };
}

/** Where the assistant is switched off it does not exist: same answer as an unknown address. */
function assertAssistantEnabled() {
  if (!isAssistantEnabled()) throw notFound("Assistant indisponible.");
}

/** The affaire a conversation is about, read with the member's own rights (owner, admin or director). */
export async function requireAssistantProject(projectId: string): Promise<Access> {
  assertAssistantEnabled();
  return requireAffaireProjectReadAccess(projectId);
}

export async function listAssistantThreads(projectId: string): Promise<AssistantThread[]> {
  const { context, project } = await requireAssistantProject(projectId);
  const { data, error } = await context.supabase.from("assistant_threads").select(THREAD_COLUMNS)
    .eq("tenant_id", context.tenantId).eq("user_id", context.userId).eq("project_id", project.id)
    .order("updated_at", { ascending: false }).limit(50);
  if (error) throw mapSupabaseError(error, "Impossible de lire vos conversations.");
  return data.map(toThread);
}

export async function createAssistantThread(projectId: string, title: string): Promise<AssistantThread> {
  const { context, project } = await requireAssistantProject(projectId);
  const { data, error } = await context.supabase.from("assistant_threads")
    .insert({ project_id: project.id, tenant_id: context.tenantId, user_id: context.userId, title })
    .select(THREAD_COLUMNS).single();
  if (error) throw mapSupabaseError(error, "Impossible d’ouvrir la conversation.");
  return toThread(data);
}

/**
 * A conversation of the caller with its latest messages, each question followed
 * by its answers. Row security already hides other members' conversations; the
 * affaire is read again so that an archived or withdrawn affaire closes its
 * conversations.
 */
export async function readAssistantThread(threadId: string): Promise<Access & { thread: AssistantThread; messages: AssistantMessage[] }> {
  assertAssistantEnabled();
  const caller = await getAuthenticatedContext();
  const thread = await caller.supabase.from("assistant_threads").select(THREAD_COLUMNS)
    .eq("id", threadId).eq("tenant_id", caller.tenantId).eq("user_id", caller.userId).maybeSingle();
  if (thread.error) throw mapSupabaseError(thread.error, "Impossible de lire la conversation.");
  if (!thread.data) throw notFound("Conversation introuvable.");
  const access = await requireAffaireProjectReadAccess(thread.data.project_id);
  const messages = await access.context.supabase.from("assistant_messages").select(MESSAGE_COLUMNS)
    .eq("thread_id", threadId).eq("tenant_id", caller.tenantId).eq("user_id", caller.userId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(MESSAGES_SHOWN);
  if (messages.error) throw mapSupabaseError(messages.error, "Impossible de lire la conversation.");
  const saved = messages.data.reverse();
  return { ...access, thread: toThread(thread.data), messages: inConversationOrder(saved).map(toMessage) };
}

export async function deleteAssistantThread(threadId: string): Promise<void> {
  assertAssistantEnabled();
  const caller = await getAuthenticatedContext();
  const { data, error } = await caller.supabase.from("assistant_threads").delete()
    .eq("id", threadId).eq("tenant_id", caller.tenantId).eq("user_id", caller.userId).select("id");
  if (error) throw mapSupabaseError(error, "Impossible de supprimer la conversation.");
  if (data.length === 0) throw notFound("Conversation introuvable.");
}

type MessageInput = {
  threadId: string; status?: AssistantMessage["status"]; content: string;
  activity?: AssistantActivity[]; screen?: AssistantScreen | null; model?: string | null;
  tokenUsage?: AssistantTokenUsage | null; errorCode?: string | null;
};

/** Saves a question, or an answer with the question it replies to. */
export async function appendAssistantMessage(context: Access["context"], input: MessageInput & (
  { role: "user"; replyTo?: never } | { role: "assistant"; replyTo: string }
)): Promise<AssistantMessage> {
  const { data, error } = await context.supabase.from("assistant_messages").insert({
    thread_id: input.threadId, tenant_id: context.tenantId, user_id: context.userId, role: input.role,
    reply_to: input.role === "assistant" ? input.replyTo : null,
    status: input.status ?? "complete", content: input.content, activity: input.activity ?? [],
    screen_context: input.screen ?? null, model: input.model ?? null, token_usage: input.tokenUsage ?? null,
    error_code: input.errorCode ?? null,
  }).select(MESSAGE_COLUMNS).single();
  if (error) throw mapSupabaseError(error, "Impossible d’enregistrer le message.");
  return toMessage(data);
}
