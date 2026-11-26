import "server-only";

import { z } from "zod";
import { ApiKeyError, isApiKeyError } from "@/lib/ai/access/api-key-errors";
import { openAiApiKeyAccess, type ApiKeyStructuredFile, type PreparedApiKeyCall } from "@/lib/ai/access/openai-api";
import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { chatGptPreferencesSchema, type ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { AI_REQUEST_CEILINGS_NANO_USD } from "@/lib/ai/request-ceilings";
import { readAiRequestOptions, resolveAiRequest } from "@/lib/ai/request-settings-server";
import type { StructuredCallOptions } from "@/lib/ai/structured-call";
import { INTAKE_AI_BUDGET_STOP, type IntakeAiChoice, type IntakeAiOptions, type IntakePersonalAiReceipt } from "@/lib/affaires/intake-ai-settings";
import { isIntakeDecisionsSelected } from "@/lib/affaires/intake-decisions";
import { IntakePayerAccessLost, readSelectedIntakePlanConnection } from "@/lib/affaires/intake-payer-server";
import { INTAKE_TRANSCRIPTION_MODEL, INTAKE_TRANSCRIPTION_REASONING_EFFORT } from "@/lib/affaires/intake-transcription";
import { badRequest, internalError } from "@/lib/http/api-response";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AffaireIntakeLeaseUnavailableError } from "@/lib/workflows/affaire-intake-lifecycle";

const policy = { allowedSources: ["chatgpt_plan", "personal_api_key"] } as const;
const connectionSchema = z.object({ profileId: z.string().min(1), authorizationId: z.string().min(1) });
const selectionSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("rules_only") }),
  z.object({ source: z.literal("chatgpt_plan"), preferences: chatGptPreferencesSchema, connection: connectionSchema }),
  z.object({ source: z.literal("personal_api_key"), preferences: chatGptPreferencesSchema,
    connection: z.object({ id: z.string().min(1), version: z.number().int().positive() }) }),
]);
const batchSchema = z.object({
  id: z.uuid(), launch_id: z.uuid().nullable(), project_id: z.uuid(), tenant_id: z.uuid(), payer_id: z.uuid(),
  selection: selectionSchema, budget_stop_message: z.string().nullable(), finished_at: z.string().nullable(),
  ceiling_nano_usd: z.union([z.literal(0), z.literal(AI_REQUEST_CEILINGS_NANO_USD.documentBatch)]),
  remaining_nano_usd: z.number().int().nonnegative(),
});

export type IntakeAiSelection = z.infer<typeof selectionSchema>;
export type IntakeAiBatch = z.infer<typeof batchSchema>;
type Service = ReturnType<typeof createServiceRoleClient>;
type Stage = "classification" | "transcription" | "brief";
export type IntakeAiRunner = ReturnType<typeof createIntakeAiRunner>;

export class IntakeAiBudgetStopped extends Error {
  constructor(message = INTAKE_AI_BUDGET_STOP) { super(message); }
}

export async function readIntakeAiOptions(owner: ChatGptOwner): Promise<IntakeAiOptions> {
  const [{ defaultSource, options }, plan] = await Promise.all([
    readAiRequestOptions(owner, policy), readSelectedIntakePlanConnection(owner),
  ]);
  const key = options.personal_api_key;
  const planOption = options.chatgpt_plan;
  return {
    defaultSource,
    sources: {
      chatgpt_plan: planOption?.ok && plan
        ? { available: true, message: planOption.message, models: planOption.models, preferences: planOption.preferences }
        : { available: false, message: planOption?.ok ? "Reconnectez votre forfait ChatGPT dans Mon profil." : planOption?.message ?? "" },
      personal_api_key: key?.ok
        ? { available: true, message: key.message, models: key.models, preferences: key.preferences }
        : { available: false, message: key?.message ?? "" },
    },
    keyConnectionId: key?.ok ? key.connection?.id ?? null : null,
    decisionsSelected: isIntakeDecisionsSelected(),
  };
}

export async function resolveIntakeAiSelection(owner: ChatGptOwner, choice: IntakeAiChoice): Promise<IntakeAiSelection> {
  if (choice.source === "rules_only") return choice;
  // Pin the plan grant before resolving its available model options. A later
  // credential change leaves the recorded grant unavailable on this host.
  const planConnection = choice.source === "chatgpt_plan" ? await readSelectedIntakePlanConnection(owner) : null;
  if (choice.source === "chatgpt_plan" && !planConnection) throw badRequest("Reconnectez votre forfait ChatGPT dans Mon profil.");
  const resolved = await resolveAiRequest(planConnection ? { ...owner, connection: planConnection } : owner, policy, choice);
  if (!resolved.ok) throw badRequest(resolved.message);
  const connection = resolved.source === "personal_api_key" ? resolved.connection : planConnection;
  return selectionSchema.parse({ source: resolved.source, preferences: resolved.preferences, connection });
}

export async function readIntakeAiBatch(service: Service, batchId: string) {
  const { data, error } = await service.rpc("read_affaire_intake_ai_batch", { p_batch_id: batchId });
  if (error) throw internalError("Impossible de lire les réglages IA du lot.", error);
  return batchSchema.nullable().parse(data);
}

export async function canRunIntakeAiBatch(batch: IntakeAiBatch) {
  const { selection } = batch;
  if (selection.source === "rules_only" || batch.budget_stop_message) return true;
  if (!isLocalChatGptEnabled()) return false;
  const owner = { userId: batch.payer_id, tenantId: batch.tenant_id };
  if (selection.source === "personal_api_key") return openAiApiKeyAccess().hasConnection(owner, selection.connection);
  const connection = await readSelectedIntakePlanConnection(owner);
  return connection?.profileId === selection.connection.profileId && connection.authorizationId === selection.connection.authorizationId;
}

function apiInput<T>(options: StructuredCallOptions<T>) {
  const files: ApiKeyStructuredFile[] = [];
  let prompt = options.prompt;
  for (const file of options.files ?? []) {
    switch (file.mimeType) {
      case "text/plain":
      case "text/csv":
        prompt += `\n\nContenu du document (${file.mimeType}) :\n${Buffer.from(file.data, "base64").toString("utf8")}`;
        break;
      case "application/pdf":
      case "image/png":
      case "image/jpeg":
      case "image/webp":
        files.push({ data: file.data, mimeType: file.mimeType, ...(file.detail ? { detail: file.detail } : {}) });
        break;
      default:
        throw new ApiKeyError("AI_KEY_REQUEST_REJECTED");
    }
  }
  return { prompt, files };
}

export function createIntakeAiRunner(service: Service, batch: IntakeAiBatch, leaseToken: string | null) {
  const { selection } = batch;
  const owner = { userId: batch.payer_id, tenantId: batch.tenant_id };
  return {
    source: selection.source,
    async run<T>(stage: Stage, options: StructuredCallOptions<T>): Promise<{ data: T; receipt: IntakePersonalAiReceipt }> {
      if (selection.source === "rules_only") throw new Error("Ce lot utilise le classement sans source personnelle.");
      const preferences: ChatGptPreferences = stage === "transcription"
        ? { model: INTAKE_TRANSCRIPTION_MODEL, reasoningEffort: INTAKE_TRANSCRIPTION_REASONING_EFFORT }
        : selection.preferences;
      const { model, reasoningEffort } = preferences;
      if (selection.source === "chatgpt_plan") {
        const answer = await callLocalChatGptStructured({ ...owner, connection: selection.connection },
          options, undefined, preferences, { allowUnselectedModel: true });
        return { data: answer.data, receipt: { source: selection.source, model: answer.model, reasoningEffort: answer.reasoningEffort } };
      }

      const latest = await readIntakeAiBatch(service, batch.id);
      if (!latest || latest.finished_at) throw new IntakeAiLedgerError("Ce lot IA n’est plus disponible.");
      if (latest.budget_stop_message) throw new IntakeAiBudgetStopped(latest.budget_stop_message);
      const reserve = async (bound: number | null) => {
        const { data, error } = await service.rpc("reserve_affaire_intake_ai_call", {
          p_batch_id: batch.id, p_lease_token: leaseToken, p_stage: stage, p_model: model, p_effort: reasoningEffort, p_bound: bound,
        });
        if (error?.message === "INTAKE_LEASE_LOST") throw new AffaireIntakeLeaseUnavailableError(batch.id);
        if (error?.message === "INTAKE_LAUNCH_FORBIDDEN") throw new IntakePayerAccessLost();
        if (error) throw new IntakeAiLedgerError("Impossible de réserver le budget IA.", { cause: error });
        if (!data) throw new IntakeAiBudgetStopped();
        return data;
      };
      if (latest.remaining_nano_usd === 0) {
        await options.beforeSend?.();
        await reserve(null);
      }
      // The adapter sanitizes provider failures. Preserve the caller's own
      // cancellation, rights and budget errors across that boundary.
      let gateFailure: unknown;
      const gate = (callback: () => Promise<void>) => async () => {
        try { await callback(); } catch (error) { gateFailure = error; throw error; }
      };
      const api = openAiApiKeyAccess();
      let prepared: PreparedApiKeyCall;
      try {
        prepared = await api.prepare(owner, {
          ...apiInput(options), schema: options.schema, model, reasoningEffort,
          expectedVersion: selection.connection.version, expectedConnectionId: selection.connection.id,
          allotmentNanoUsd: latest.remaining_nano_usd, outputCap: 12_288,
          minOutputTokens: 2_048, signal: options.signal,
          beforeSend: gate(async () => { await options.beforeSend?.(); }),
        });
      } catch (error) {
        if (gateFailure) throw gateFailure;
        if (isApiKeyError(error) && error.code === "AI_KEY_CEILING") await reserve(null);
        throw error;
      }
      let callId: string | undefined;
      try {
        const answer = await api.execute<T>(owner, prepared, {
          timeoutMs: options.timeoutMs ?? 120_000, signal: options.signal,
          beforeSend: gate(async () => {
            await options.beforeSend?.();
            callId = await reserve(prepared.boundNanoUsd);
          }),
        });
        if (!callId) throw new IntakeAiLedgerError("Réservation IA manquante.");
        const { error } = await service.rpc("settle_affaire_intake_ai_call", {
          p_call_id: callId, p_model: answer.model, p_cost: answer.costNanoUsd,
        });
        if (error) throw new IntakeAiLedgerError("Impossible d’enregistrer le reçu IA.", { cause: error });
        if (answer.schemaError) throw answer.schemaError;
        return { data: answer.data, receipt: { source: selection.source, model: answer.model, reasoningEffort } };
      } catch (error) {
        throw gateFailure ?? error;
      }
    },
  };
}

export class IntakeAiLedgerError extends Error {}
