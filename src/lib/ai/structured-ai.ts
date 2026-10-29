import "server-only";

import { headers } from "next/headers";

import {
  assertLocalChatGptHost,
  hasLocalChatGptPlanAccess,
  isLocalChatGptEnabled,
} from "@/lib/ai/chatgpt-local-auth";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import type {
  CallGeminiStructuredOptions,
  CallGeminiStructuredResult,
} from "@/lib/takeoff/gemini-client";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";

export type StructuredAiAvailability = { available: boolean; message: string };

/** Read-only preflight: no inference, credential renewal or provider request. */
export async function getStructuredAiAvailability(
  owner: ChatGptOwner,
): Promise<StructuredAiAvailability> {
  if (!isLocalChatGptEnabled())
    return {
      available: false,
      message:
        "L’analyse IA est indisponible sur cette instance. Utilisez MergeOne avec la connexion ChatGPT locale activée.",
    };
  try {
    const store = await readChatGptStore(owner);
    const profile = store.profiles.find(
      (entry) => entry.id === store.selectedId,
    );
    if (!profile)
      return {
        available: false,
        message:
          "Connectez votre forfait ChatGPT dans Mon profil pour analyser les documents.",
      };
    if (!hasLocalChatGptPlanAccess(profile))
      return {
        available: false,
        message:
          "Reconnectez votre forfait ChatGPT dans Mon profil pour autoriser l’analyse.",
      };
    if (!profile.model)
      return {
        available: false,
        message:
          "Choisissez un modèle ChatGPT dans Mon profil avant de relancer l’analyse.",
      };
    return {
      available: true,
      message:
        "Connexion ChatGPT configurée. Sa disponibilité sera vérifiée lors de l’analyse.",
    };
  } catch {
    return {
      available: false,
      message:
        "La connexion ChatGPT locale ne peut pas être lue. Reconnectez le compte dans Mon profil.",
    };
  }
}

/** Durable intake passes its verified creator; takeoff resolves its own persisted job owner. */
export async function callStructuredAi<T>(
  options: CallGeminiStructuredOptions<T>,
  workflowOwner?: ChatGptOwner | null,
): Promise<CallGeminiStructuredResult<T> & { provider: "gemini" | "chatgpt" }> {
  if (isLocalChatGptEnabled()) {
    if (workflowOwner === null)
      throw new StructuredAiError(
        "AI_OWNER_INACTIVE",
        "Le créateur de l’import n’a plus d’accès actif au tenant.",
      );
    if (workflowOwner === undefined)
      assertLocalChatGptHost((await headers()).get("host"));
    const owner = workflowOwner ?? (await getAuthenticatedContext());
    const availability = await getStructuredAiAvailability(owner);
    if (!availability.available)
      throw new StructuredAiError("AI_NOT_CONFIGURED", availability.message);
    const store = await readChatGptStore(owner);
    if (store.selectedId) {
      const profile = store.profiles.find(
        (entry) => entry.id === store.selectedId,
      );
      if (!profile || !hasLocalChatGptPlanAccess(profile))
        throw new StructuredAiError(
          "AI_AUTH_REQUIRED",
          "Reconnectez votre forfait ChatGPT dans Mon profil.",
        );
      // Once selected, a failure never silently switches to a paid API provider.
      if (options.deliveryMode === "batch")
        throw new Error(
          "Le forfait ChatGPT utilise des requêtes en streaming, sans API batch.",
        );
      return {
        ...(await callLocalChatGptStructured(owner, options)),
        provider: "chatgpt",
      };
    }
  }
  throw new StructuredAiError(
    "AI_LOCAL_DISABLED",
    "L’analyse IA est indisponible sur cette instance. Utilisez MergeOne avec la connexion ChatGPT locale activée.",
  );
}
