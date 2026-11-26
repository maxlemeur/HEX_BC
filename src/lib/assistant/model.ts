import "server-only";

import { z } from "zod";

import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { assertLocalChatGptHost, getLocalChatGptCredential, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import type { ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import type { AssistantTool, CallAssistantModel } from "@/lib/assistant/loop";
import { readAssistantModelTurn, readAssistantTurnEvents } from "@/lib/assistant/model-turn";
import { ASSISTANT_KEY_CEILING } from "@/lib/assistant/request-settings";
import { notFound } from "@/lib/http/api-response";

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

/** The payer and parameters resolved for this message, before its tool loop. */
export type AssistantAccess = { preferences: ChatGptPreferences } & (
  | { source: "chatgpt_plan"; accessToken: string }
  | { source: "personal_api_key"; connectionVersion: number }
);

export async function readAssistantPlanToken(owner: ChatGptOwner): Promise<string> {
  let credential: Awaited<ReturnType<typeof getLocalChatGptCredential>>;
  try {
    credential = await getLocalChatGptCredential(owner);
  } catch {
    throw new StructuredAiError("AI_AUTH_REQUIRED", "L’accès au forfait ChatGPT n’est plus valide. Reconnectez votre compte dans Mon profil.");
  }
  if (!credential) throw new StructuredAiError("AI_AUTH_REQUIRED", "Connectez votre compte ChatGPT dans Mon profil pour utiliser l’assistant.");
  return credential.accessToken;
}

/** One model and one API key budget for all the sequential turns of a message. */
export function createAssistantModel(options: {
  owner: ChatGptOwner; access: AssistantAccess; instructions: string; tools: AssistantTool[];
}): { callModel: CallAssistantModel; dispatched(): boolean } {
  const access = { ...options.access };
  const { model, reasoningEffort } = access.preferences;
  const tools = options.tools.map((tool) => ({
    type: "function" as const, name: tool.name, description: tool.description,
    parameters: z.toJSONSchema(tool.input, { unrepresentable: "any" }),
    // Arguments are validated here, by each tool's schema: the model may omit optional ones.
    strict: false as const,
  }));
  let dispatched = false;
  let remainingNanoUsd = ASSISTANT_KEY_CEILING as number;
  return {
    dispatched: () => dispatched,
    callModel: async (request, onDelta, signal) => {
      signal.throwIfAborted();
      // Keep the rules at the start of the input so the provider can cache them.
      const input = [
        { role: "developer", content: options.instructions },
        ...request.input,
        ...(request.finalInstruction ? [{ role: "developer", content: request.finalInstruction }] : []),
      ];
      const toolChoice = request.toolsAllowed ? "auto" : "none";
      if (access.source === "personal_api_key") {
        const turn = await openAiApiKeyAccess().streamToolTurn(options.owner, {
          expectedVersion: access.connectionVersion, model, reasoningEffort, input, tools, toolChoice,
          allotmentNanoUsd: remainingNanoUsd, outputCap: 4096, minOutputTokens: 256,
          timeoutMs: MODEL_CALL_TIMEOUT_MS, signal, onDispatch: () => { dispatched = true; },
        }, (events) => readAssistantTurnEvents(events, onDelta));
        remainingNanoUsd -= turn.spentBoundNanoUsd;
        return turn.result;
      }
      dispatched = true;
      const response = await fetch(RESPONSES_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${access.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          model, store: false, stream: true,
          ...(reasoningEffort === null ? {} : { reasoning: { effort: reasoningEffort } }),
          // Nothing is stored at the provider: reasoning comes back encrypted and is replayed with the tool results.
          include: ["reasoning.encrypted_content"],
          input, tools, tool_choice: toolChoice,
          parallel_tool_calls: false,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS)]),
        cache: "no-store",
        redirect: "error",
      });
      return readAssistantModelTurn(response, onDelta);
    },
  };
}
