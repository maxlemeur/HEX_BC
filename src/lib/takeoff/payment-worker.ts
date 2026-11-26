import "server-only";

import { setTimeout as delay } from "node:timers/promises";
import { isApiKeyError } from "@/lib/ai/access/api-key-errors";
import { openAiApiKeyAccess, type ApiKeyStructuredFile } from "@/lib/ai/access/openai-api";
import type { LocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import type { StructuredCall, StructuredCallFile, StructuredCallOptions } from "@/lib/ai/structured-call";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TAKEOFF_C_TIMEOUT_MS_DEFAULT } from "@/lib/takeoff/constants";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { takeoffPaymentRefusal } from "@/lib/takeoff/launch-call-ledger";
import { TAKEOFF_NANO_USD_PER_CENT } from "@/lib/takeoff/payment-choice";
import { assertTakeoffApiConnection, assertTakeoffPayer, readTakeoffApiMandate, TAKEOFF_API_CONNECTION_CHANGED,
  takeoffPaymentError } from "@/lib/takeoff/payment-mandate-server";
import { takeoffExecutionSelectionSchema } from "@/lib/takeoff/preparation";

class ReprepareApiCall extends Error {
  constructor(readonly waitForSettlement: boolean) {
    super("The takeoff call needs a new budget bound");
  }
}

function apiInput(prompt: string, attachments: StructuredCallFile[]) {
  const files: ApiKeyStructuredFile[] = [];
  for (const file of attachments) {
    switch (file.mimeType) {
      case "text/plain":
      case "text/csv":
        prompt += `\n\nContenu du document (${file.mimeType}) :\n${Buffer.from(file.data, "base64").toString("utf8")}`;
        break;
      case "application/pdf":
      case "image/jpeg":
      case "image/png":
      case "image/webp":
        files.push({ data: file.data, mimeType: file.mimeType, ...(file.detail ? { detail: file.detail } : {}) });
        break;
      default:
        throw takeoffPaymentError("Ce format de pièce ne peut pas être envoyé par le métré avec la clé API OpenAI.");
    }
  }
  return { prompt, files };
}

export async function resolveTakeoffApiProvider(job: TakeoffJobProcessingRow, lease: () => string | null,
  service = createServiceRoleClient(), access = openAiApiKeyAccess()): Promise<LocalTakeoffProvider> {
  const pinned = takeoffExecutionSelectionSchema.safeParse((job.preparation_snapshot as { execution_selection?: unknown } | null)?.execution_selection);
  if (!pinned.success || pinned.data.source !== "personal_api_key" || !job.project_id || !job.created_by) {
    throw takeoffPaymentError("Le mandat de paiement de ce métré est incomplet.", job.id);
  }
  const owner = { tenantId: job.tenant_id, projectId: job.project_id, userId: job.created_by };
  const assertOwnerActive = () => assertTakeoffPayer(service, owner);
  await assertOwnerActive();
  const mandate = await readTakeoffApiMandate(service, owner, pinned.data);
  await assertTakeoffApiConnection(owner, mandate);
  const stopForBudget = () => new TakeoffError({
    status: 422, code: TakeoffErrorCode.TAKEOFF_REQUEST_BUDGET_EXHAUSTED, retryable: false, jobId: job.id,
    message: "Le budget de ce métré avec la clé API OpenAI est épuisé. Les résultats déjà enregistrés sont conservés.",
  });
  const stopForLedger = () => new TakeoffError({
    status: 409, code: TakeoffErrorCode.TAKEOFF_USAGE_UNRECORDED, retryable: false, jobId: job.id,
    message: "Impossible de vérifier le registre des dépenses de ce métré. Aucun autre appel ne sera envoyé.",
  });
  const inFlight = new Set<Promise<void>>();
  let halted: TakeoffError | undefined;
  const paid = (lane: "pdf" | "vector_group"): StructuredCall => async <T>(options: StructuredCallOptions<T>) => {
    if (halted) throw halted;
    const token = lease();
    if (!token) throw stopForLedger();
    const tile = options.takeoffTile;
    const branch = tile ? "count_tile" : lane;
    const tileKey = tile ? `tile:${tile.page}:${tile.ordinal}` : undefined;
    const args = { p_job_id: job.id, p_tenant_id: owner.tenantId, p_project_id: owner.projectId,
      p_payer_id: owner.userId, p_lease_token: token };
    async function reserve(bound?: number, tokens?: number, exhausted = false) {
      if (halted) throw halted;
      options.signal?.throwIfAborted();
      const { data, error } = await service.rpc("reserve_takeoff_api_call", {
        ...args, p_module_default: takeoffModuleDefault(), p_branch: branch, p_bound: bound, p_tokens: tokens, p_exhausted: exhausted,
        p_tile_key: tileKey,
      });
      const row = data?.[0];
      if (error || !row) throw stopForLedger();
      if (row.reason === "CAPACITY_HELD" || row.reason === "REPREPARE") {
        throw new ReprepareApiCall(row.reason === "CAPACITY_HELD");
      }
      if (row.reason === "BUDGET_EXHAUSTED") throw stopForBudget();
      if (row.reason === "TILE_ALREADY_ATTEMPTED") throw new TakeoffError({
        code: TakeoffErrorCode.TAKEOFF_USAGE_UNRECORDED, retryable: false, jobId: job.id,
        message: "Cette tuile a déjà été envoyée. Elle ne sera pas facturée une deuxième fois.",
        details: { tileAttempted: true },
      });
      if (row.reason) throw takeoffPaymentRefusal(job.id, row.reason);
      return row;
    }
    let callId: string | null = null;
    let endCall: (() => void) | undefined;
    async function settle(cost: number | null, tokens: number | null) {
      if (!callId) return;
      const { data, error } = await service.rpc("settle_takeoff_api_call", {
        ...args, p_call_id: callId, p_cost: cost ?? undefined, p_tokens: tokens ?? undefined,
      });
      if (error || data !== true) throw stopForLedger();
      callId = null;
    }
    async function send() {
      const input = apiInput(options.prompt, options.files ?? []);
      for (;;) {
        try {
          const balance = await reserve();
          const prepared = await access.prepare(owner, {
            model: mandate.model, reasoningEffort: mandate.reasoningEffort, expectedVersion: mandate.connectionVersion,
            expectedConnectionId: mandate.connectionId, schema: options.schema,
            ...input, allotmentNanoUsd: balance.remaining_nano_usd, maxTotalTokens: balance.remaining_tokens,
            outputCap: branch === "vector_group" ? 4_096 : 32_768, minOutputTokens: branch === "vector_group" ? 256 : 1_024,
            signal: options.signal,
          }).catch(async (error: unknown) => {
            if (isApiKeyError(error) && error.code === "AI_KEY_CEILING") {
              await reserve(balance.remaining_nano_usd, balance.remaining_tokens, true);
            }
            throw error;
          });
          const answer = await access.execute<T>(owner, prepared, {
            timeoutMs: options.timeoutMs ?? TAKEOFF_C_TIMEOUT_MS_DEFAULT, signal: options.signal,
            beforeSend: async () => {
              await options.beforeSend?.();
              callId = (await reserve(prepared.boundNanoUsd, prepared.inputTokens + prepared.maxOutputTokens)).call_id;
              if (!callId) throw stopForLedger();
              const done = new Promise<void>((resolve) => { endCall = resolve; });
              inFlight.add(done);
              void done.then(() => inFlight.delete(done));
            },
          });
          return { answer, prepared };
        } catch (error) {
          if (!(error instanceof ReprepareApiCall)) throw error;
          if (error.waitForSettlement) {
            if (inFlight.size > 0) await Promise.race(inFlight);
            else await delay(250, undefined, { signal: options.signal });
          }
        }
      }
    }
    try {
      const { answer, prepared } = await send();
      const totalTokens = Math.max(answer.usage.total, answer.usage.input + answer.usage.output);
      await settle(answer.costNanoUsd, totalTokens);
      if (answer.costNanoUsd === null) throw stopForLedger();
      if (answer.costNanoUsd > prepared.boundNanoUsd || totalTokens > prepared.inputTokens + prepared.maxOutputTokens) {
        throw stopForBudget();
      }
      if (answer.schemaError) throw new TakeoffError({
        code: TakeoffErrorCode.AI_SCHEMA, retryable: false, jobId: job.id,
        message: "La réponse OpenAI n’a pas le format attendu pour le métré.",
      });
      const tokenUsage = { inputTokens: answer.usage.input, reasoningTokens: answer.usage.reasoning,
        outputTokens: Math.max(0, answer.usage.output - answer.usage.reasoning), totalTokens };
      return { data: answer.data, model: answer.model, durationMs: answer.durationMs, tokenUsage,
        tokenCount: tokenUsage.totalTokens, costCents: Math.floor(answer.costNanoUsd / TAKEOFF_NANO_USD_PER_CENT),
        promptVersion: options.context?.promptVersion ?? job.prompt_version ?? "" };
    } catch (error) {
      if (tile && error instanceof TakeoffError && (error.details as { tileAttempted?: boolean } | null)?.tileAttempted) throw error;
      const apiError = isApiKeyError(error) ? error : null;
      const usage = apiError?.usage;
      const tokens = usage ? Math.max(usage.total, usage.input + usage.output) : apiError?.costNanoUsd === 0 ? 0 : null;
      try {
        await settle(apiError?.costNanoUsd ?? null, tokens);
      } catch {
        halted = stopForLedger();
        throw halted;
      }
      halted = error instanceof TakeoffError ? error : takeoffPaymentError(apiError?.code === "AI_KEY_CHANGED" || apiError?.code === "AI_KEY_MISSING"
          ? TAKEOFF_API_CONNECTION_CHANGED : apiError?.message ?? "L’appel OpenAI du métré a été interrompu.", job.id);
      throw halted;
    } finally {
      endCall?.();
    }
  };
  return {
    model: mandate.model, reasoningEffort: mandate.reasoningEffort,
    selection: { ...pinned.data, model: mandate.model, reasoningEffort: mandate.reasoningEffort },
    assertOwnerActive, call: paid("pdf"), callApiVectorGroup: paid("vector_group"),
  };
}
