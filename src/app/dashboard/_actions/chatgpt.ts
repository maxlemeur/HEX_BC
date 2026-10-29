"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";

import {
  assertLocalChatGptHost, beginLocalChatGptSignIn, CHATGPT_COOKIE,
  disconnectLocalChatGpt, getLocalChatGptState, isLocalChatGptEnabled, selectLocalChatGptProfile,
} from "@/lib/ai/chatgpt-local-auth";
import { callLocalChatGptStructured, listLocalChatGptModels, selectLocalChatGptModel, selectLocalChatGptPreferences } from "@/lib/ai/chatgpt-local-inference";
import { chatGptPreferencesSchema, type ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";

async function context() {
  const origin = assertLocalChatGptHost((await headers()).get("host"));
  const authenticated = await getAuthenticatedContext();
  return { origin, owner: { userId: authenticated.userId, tenantId: authenticated.tenantId } };
}

export async function loadChatGptConnection() {
  if (!isLocalChatGptEnabled()) return null;
  const { owner } = await context();
  return getLocalChatGptState(owner);
}

export async function connectChatGpt(profileId?: string) {
  const { origin, owner } = await context();
  const result = await beginLocalChatGptSignIn(owner, origin, profileId);
  (await cookies()).set(CHATGPT_COOKIE, result.state, {
    httpOnly: true, sameSite: "lax", secure: false, path: "/auth/chatgpt/callback", maxAge: 600,
  });
  return { url: result.url };
}

export async function chooseChatGptAccount(profileId: string) {
  const { owner } = await context();
  await selectLocalChatGptProfile(owner, z.uuid().parse(profileId));
}

export async function loadChatGptModels() {
  const { owner } = await context();
  return listLocalChatGptModels(owner);
}

export async function chooseChatGptModel(model: string) {
  const { owner } = await context();
  await selectLocalChatGptModel(owner, z.string().min(1).max(200).parse(model));
}

export async function chooseChatGptPreferences(input: ChatGptPreferences) {
  const { owner } = await context();
  return selectLocalChatGptPreferences(owner, chatGptPreferencesSchema.parse(input));
}

export async function disconnectChatGpt() {
  const { owner } = await context();
  return disconnectLocalChatGpt(owner);
}

export async function testChatGptConnection() {
  const { owner } = await context();
  const result = await callLocalChatGptStructured(owner, {
    prompt: 'Retourne exactement {"connection":"ok"}.',
    schema: z.object({ connection: z.literal("ok") }), maxRetries: 0,
  });
  return { success: result.data.connection === "ok", model: result.model, reasoningEffort: result.reasoningEffort };
}
