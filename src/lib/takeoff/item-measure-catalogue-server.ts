import "server-only";

import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import { fetchSelectableLocalChatGptModels } from "@/lib/ai/chatgpt-local-inference";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { TakeoffExecutionSelection } from "@/lib/takeoff/preparation";

export async function readMeasureCatalogue(owner: ChatGptOwner, selection: TakeoffExecutionSelection) {
  try {
    const credential = await getLocalChatGptCredential(owner);
    if (!credential || credential.profileId !== selection.profileId || credential.authorizationId !== selection.authorizationId) {
      return { reason: "La connexion du forfait a changé. Reconnectez votre compte dans Mon profil." } as const;
    }
    const catalogue = await fetchSelectableLocalChatGptModels(credential);
    if (!catalogue.length) return { reason: "Aucun modèle n’est disponible sur votre forfait." } as const;
    return { models: catalogue.map(({ id, name, reasoningEfforts }) => ({ id, name, reasoningEfforts })) } as const;
  } catch (error) {
    return { reason: error instanceof StructuredAiError ? error.message : "Le catalogue des modèles de votre forfait est indisponible." } as const;
  }
}
