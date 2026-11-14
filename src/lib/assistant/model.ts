import "server-only";

import { z } from "zod";

import { assertLocalChatGptHost, getLocalChatGptCredential, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import type { ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import type { AssistantTool, CallAssistantModel } from "@/lib/assistant/loop";
import { readAssistantModelTurn } from "@/lib/assistant/model-turn";
import { notFound } from "@/lib/estimates/errors";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODEL_CALL_TIMEOUT_MS = 120_000;

/** The assistant exists only where it was switched on and where a ChatGPT plan can be linked (local MergeOne). */
export function isAssistantEnabled() {
  return process.env.MERGEONE_ASSISTANT === "1" && isLocalChatGptEnabled();
}

/**
 * Refuses a request that does not reach local MergeOne on 127.0.0.1, like the
 * other uses of the member's ChatGPT plan. Where the assistant is off it does
 * not exist: same answer as an unknown address.
 */
export function assertAssistantRequest(host: string | null) {
  if (!isAssistantEnabled()) throw notFound("Assistant indisponible.");
  try {
    assertLocalChatGptHost(host);
  } catch {
    throw notFound("Assistant indisponible.");
  }
}

/**
 * What a request to the model is signed and addressed with. The member's ChatGPT
 * plan is the only source today; an API key held by the company is the second
 * one planned, and reaches the same Responses API with the same request.
 */
export type AssistantAccess = {
  source: "chatgpt_plan";
  accessToken: string;
  model: string;
  reasoningEffort: ChatGptReasoningEffort | null;
};

export async function resolveAssistantAccess(owner: ChatGptOwner): Promise<AssistantAccess> {
  let credential: Awaited<ReturnType<typeof getLocalChatGptCredential>>;
  try {
    credential = await getLocalChatGptCredential(owner);
  } catch {
    throw new StructuredAiError("AI_AUTH_REQUIRED", "L’accès au forfait ChatGPT n’est plus valide. Reconnectez votre compte dans Mon profil.");
  }
  if (!credential) throw new StructuredAiError("AI_AUTH_REQUIRED", "Connectez votre compte ChatGPT dans Mon profil pour utiliser l’assistant.");
  if (!credential.model) throw new StructuredAiError("AI_NOT_CONFIGURED", "Choisissez un modèle ChatGPT dans Mon profil pour utiliser l’assistant.");
  return {
    source: "chatgpt_plan", accessToken: credential.accessToken, model: credential.model,
    reasoningEffort: credential.reasoningEffort ?? null,
  };
}

/**
 * The model of one user turn. Access is resolved before every request: a turn
 * can outlive a short-lived token, and the profile's model can change meanwhile.
 */
export function createAssistantModel(options: {
  owner: ChatGptOwner; instructions: string; tools: AssistantTool[];
}): { callModel: CallAssistantModel; lastModel(): string | null } {
  const tools = options.tools.map((tool) => ({
    type: "function", name: tool.name, description: tool.description,
    parameters: z.toJSONSchema(tool.input, { unrepresentable: "any" }),
    // Arguments are validated here, by each tool's schema: the model may omit optional ones.
    strict: false,
  }));
  let lastModel: string | null = null;
  return {
    lastModel: () => lastModel,
    callModel: async (request, onDelta, signal) => {
      const access = await resolveAssistantAccess(options.owner);
      lastModel = access.model;
      const response = await fetch(RESPONSES_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${access.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: access.model, store: false, stream: true,
          ...(access.reasoningEffort === null ? {} : { reasoning: { effort: access.reasoningEffort } }),
          // Nothing is stored at the provider: reasoning comes back encrypted and is replayed with the tool results.
          include: ["reasoning.encrypted_content"],
          // The loop's closing words on the last request go with the rules, never among what was read.
          instructions: request.finalInstruction ? `${options.instructions}\n\n${request.finalInstruction}` : options.instructions,
          input: request.input,
          tools,
          tool_choice: request.toolsAllowed ? "auto" : "none",
          parallel_tool_calls: false,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS)]),
        cache: "no-store",
      });
      return readAssistantModelTurn(response, onDelta);
    },
  };
}
