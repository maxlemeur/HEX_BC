import "server-only";

import type { z } from "zod";
import { ApiKeyError, isApiKeyError } from "@/lib/ai/access/api-key-errors";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import { readAiRequestOptions, resolveAiRequest } from "@/lib/ai/request-settings-server";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import type { StructuredCallOptions } from "@/lib/ai/structured-call";
import { ESTIMATE_DRAFT_AI_CHOICE_REQUIRED, type EstimateDraftAiRequest } from "@/lib/estimates/schemas";
import { badRequest, conflict } from "@/lib/http/api-error";
import { isRecord } from "@/lib/value-guards";

const policy = { allowedSources: ["chatgpt_plan", "personal_api_key"] } as const;
const ceiling = AI_REQUEST_CEILINGS_NANO_USD.generationOrDocument;
type Owner = { tenantId: string; userId: string };
type Step = "structure" | "lots";
const outputTokens = {
  structure: { min: 4_096, cap: 8_192 },
  lots: { min: 8_192, cap: 16_384 },
} satisfies Record<Step, { min: number; cap: number }>;

export function parseEstimateDraftGenerationBody<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  if (
    isRecord(payload) && !Object.hasOwn(payload, "ai") &&
    result.error.issues.every(({ path }) => path.length === 1 && path[0] === "ai")
  ) {
    const { code, message } = ESTIMATE_DRAFT_AI_CHOICE_REQUIRED;
    throw badRequest(message, undefined, code);
  }
  throw result.error;
}

export async function readEstimateDraftAiOptions(owner: Owner) {
  const { defaultSource, options } = await readAiRequestOptions(owner, policy);
  const toOption = (option: typeof options.chatgpt_plan) => ({
    available: option?.ok === true,
    message: option?.message ?? "Source indisponible.",
    models: option?.ok ? option.models : [],
    preferences: option?.ok ? option.preferences : null,
  });
  return {
    defaultSource,
    sources: {
      chatgpt_plan: toOption(options.chatgpt_plan),
      personal_api_key: toOption(options.personal_api_key),
    },
    keyConnectionId: options.personal_api_key?.ok ? options.personal_api_key.connection?.id ?? null : null,
  };
}

/** One resolved choice and one budget, owned by the outer generation. Calls are sequential. */
export async function resolveEstimateDraftAi(owner: Owner, request: EstimateDraftAiRequest) {
  if (request.source === "fallback") return null;

  const selection = await resolveAiRequest(owner, policy, request);
  if (!selection.ok) {
    throw conflict(selection.message, undefined, `ESTIMATE_DRAFT_AI_${selection.reason.toUpperCase()}`);
  }

  const { source, preferences, connection } = selection;
  let spentNanoUsd = 0;
  async function generate<T>(
    step: Step,
    options: StructuredCallOptions<T>,
    requireExecution: () => Promise<void>,
  ) {
    await requireExecution();
    if (source === "chatgpt_plan") {
      return callStructuredAi({ ...options, context: { ...options.context, tenantId: owner.tenantId } }, owner, preferences);
    }
    if (!connection) throw conflict("La clé API sélectionnée est indisponible.", undefined, "AI_KEY_MISSING");

    const { prompt, schema, context } = options;
    const allotmentNanoUsd = ceiling - spentNanoUsd;
    try {
      if (allotmentNanoUsd <= 0) throw new ApiKeyError("AI_KEY_CEILING");
      const adapter = openAiApiKeyAccess();
      const prepared = await adapter.prepare(owner, {
        ...preferences,
        expectedVersion: connection.version,
        prompt,
        schema,
        files: [],
        allotmentNanoUsd,
        minOutputTokens: outputTokens[step].min,
        outputCap: outputTokens[step].cap,
      });
      await requireExecution();
      const result = await adapter.execute<T>(owner, prepared, { timeoutMs: 120_000 });
      if (result.costNanoUsd === null) throw new ApiKeyError("AI_KEY_COST_UNKNOWN");
      spentNanoUsd += result.costNanoUsd;
      if (result.costNanoUsd > prepared.boundNanoUsd || spentNanoUsd > ceiling) {
        throw new ApiKeyError("AI_KEY_CEILING_EXCEEDED", { detail: {
          ceiling: formatUsdCeiling(ceiling),
          cost: formatUsdCeiling(spentNanoUsd),
        } });
      }
      if (result.refused) {
        throw conflict("Le modèle a refusé cette demande.", undefined, "ESTIMATE_DRAFT_AI_MODEL_REFUSED");
      }
      return {
        data: result.data,
        model: result.model,
        promptVersion: context?.promptVersion ?? "",
        tokenCount: result.usage.total,
        costCents: Math.round(result.costNanoUsd / 10_000_000),
        durationMs: result.durationMs,
      };
    } catch (error) {
      if (!isApiKeyError(error)) throw error;
      const message = error.code === "AI_KEY_CEILING" && step === "lots"
        ? `Le plafond de ${formatUsdCeiling(ceiling)} pour toute la V0 ne permet pas de générer les lots et les lignes. Cette étape n’a pas été lancée. Choisissez moins de lots ou un modèle moins coûteux.`
        : error.message;
      throw conflict(message, undefined, error.code);
    }
  }

  return {
    source,
    preferences,
    generate,
    get spentNanoUsd() { return connection ? spentNanoUsd : null; },
  };
}

export type EstimateDraftAiGeneration = Awaited<ReturnType<typeof resolveEstimateDraftAi>>;
