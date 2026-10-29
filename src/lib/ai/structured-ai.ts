import "server-only";

import { headers } from "next/headers";

import { assertLocalChatGptHost, hasLocalChatGptPlanAccess, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import type { CallGeminiStructuredOptions, CallGeminiStructuredResult } from "@/lib/takeoff/gemini-client";

/** Durable intake passes its verified creator; takeoff resolves its own persisted job owner. */
export async function callStructuredAi<T>(options: CallGeminiStructuredOptions<T>, workflowOwner?: ChatGptOwner | null): Promise<CallGeminiStructuredResult<T> & { provider: "gemini" | "chatgpt" }> {
  if (isLocalChatGptEnabled()) {
    if (workflowOwner === null) throw new Error("Le créateur de l’import n’a plus d’accès actif au tenant.");
    if (workflowOwner === undefined) assertLocalChatGptHost((await headers()).get("host"));
    const owner = workflowOwner ?? await getAuthenticatedContext();
    const store = await readChatGptStore(owner);
    if (store.selectedId) {
      const profile = store.profiles.find((entry) => entry.id === store.selectedId);
      if (!profile || !hasLocalChatGptPlanAccess(profile)) throw new Error("Reconnectez votre forfait ChatGPT dans Mon profil.");
      // Once selected, a failure never silently switches to a paid API provider.
      if (options.deliveryMode === "batch") throw new Error("Le forfait ChatGPT utilise des requêtes en streaming, sans API batch.");
      return { ...await callLocalChatGptStructured(owner, options), provider: "chatgpt" };
    }
  }
  throw new Error("Connectez votre forfait ChatGPT dans MergeOne local pour utiliser l’assistance IA.");
}
