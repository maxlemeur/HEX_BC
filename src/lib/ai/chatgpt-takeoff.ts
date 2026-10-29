import "server-only";

import { headers } from "next/headers";
import { z } from "zod";

import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { getChatGptHostId, readChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import type { CallGeminiStructuredOptions, CallGeminiStructuredResult } from "@/lib/takeoff/gemini-client";
import type { ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import type { TakeoffProvider } from "@/lib/takeoff/types";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";

export function parseTakeoffProvider(value: unknown): TakeoffProvider {
  const parsed = z.enum(["auto", "chatgpt", "gemini"]).safeParse(value ?? "auto");
  if (!parsed.success) throw new TakeoffError({ code: TakeoffErrorCode.BAD_REQUEST, retryable: false,
    message: "Choisissez un fournisseur de métré valide." });
  return parsed.data;
}

export async function getTakeoffExecutionOwner(supabase: ServerSupabaseClient, owner: ChatGptOwner, requestedProvider: TakeoffProvider = "auto") {
  const provider = parseTakeoffProvider(requestedProvider);
  if (provider === "gemini") return {};
  if (!isLocalChatGptEnabled()) {
    if (provider === "chatgpt") throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Le forfait ChatGPT est disponible dans MergeOne local sur le Mac connecté." });
    return {};
  }
  assertLocalChatGptHost((await headers()).get("host"));
  const store = await readChatGptStore(owner);
  if (!store.selectedId) {
    if (provider === "chatgpt") throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Connectez votre forfait ChatGPT dans Mon profil avant de lancer ce métré." });
    return {};
  }
  if (!store.profiles.find((profile) => profile.id === store.selectedId)?.model) {
    throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Choisissez un modèle ChatGPT dans Mon profil avant de lancer le métré." });
  }
  // Refuse admission before uploading anything if the shared schema is old.
  const { error } = await supabase.from("takeoff_jobs")
    .select("execution_provider, execution_host_id").limit(0);
  if (error) throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
    message: "La mise à jour de la base pour les métrés ChatGPT doit être appliquée avant de lancer ce métré." });
  return { execution_provider: "chatgpt_local" as const, execution_host_id: await getChatGptHostId() };
}

export async function assertLocalTakeoffExecutionHost(job: TakeoffJobProcessingRow) {
  if (job.execution_provider !== "chatgpt_local") return null;
  if (!isLocalChatGptEnabled() || job.execution_host_id !== await getChatGptHostId()) {
    throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false, jobId: job.id,
      message: "Ce métré est réservé au forfait ChatGPT sur son Mac d’origine. Relancez-le depuis ce Mac." });
  }
  return job.execution_host_id;
}

type LocalTakeoffProvider = {
  model: string;
  reasoningEffort?: ChatGptReasoningEffort | null;
  call: <T>(options: CallGeminiStructuredOptions<T>) => Promise<CallGeminiStructuredResult<T>>;
};

export async function resolveLocalTakeoffProvider(supabase: ServerSupabaseClient, job: TakeoffJobProcessingRow): Promise<LocalTakeoffProvider | null> {
  if (job.execution_provider !== "chatgpt_local") return null;
  await assertLocalTakeoffExecutionHost(job);
  // The persisted job supplies ownership, never the triggering HTTP session.
  const owner: ChatGptOwner = { userId: job.created_by ?? "", tenantId: job.tenant_id };
  async function assertOwnerActive() {
    const { data, error } = owner.userId ? await supabase.from("tenant_memberships")
      .select("user_id, tenants!inner(is_active)").eq("user_id", owner.userId)
      .eq("tenant_id", owner.tenantId).eq("tenants.is_active", true).maybeSingle()
      : { data: null, error: null };
    if (error || !data) throw new TakeoffError({
      code: TakeoffErrorCode.FORBIDDEN, retryable: false, jobId: job.id,
      message: "Le créateur du métré n’a plus d’accès actif au tenant.",
    });
  }
  await assertOwnerActive();
  const store = await readChatGptStore(owner);
  if (!store.selectedId) throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false, jobId: job.id,
    message: "Reconnectez le forfait ChatGPT du créateur de ce métré dans Mon profil." });
  const profile = store.profiles.find((entry) => entry.id === store.selectedId);
  if (!profile?.model) throw new TakeoffError({
    code: TakeoffErrorCode.AI_PROVIDER, retryable: false, jobId: job.id,
    message: "Choisissez un modèle ChatGPT dans Mon profil avant de lancer le métré.",
  });
  const selection = { profileId: profile.id, model: profile.model, reasoningEffort: profile.reasoningEffort ?? null };
  return {
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    call: async <T>(options: CallGeminiStructuredOptions<T>) => {
      await assertOwnerActive();
      try {
        return await callLocalChatGptStructured(owner, options, selection);
      } catch (error) {
        // Stop here: no Gemini escalation, automatic retry, or raw provider data.
        throw new TakeoffError({
          code: error instanceof z.ZodError || error instanceof SyntaxError
            ? TakeoffErrorCode.AI_SCHEMA : TakeoffErrorCode.AI_PROVIDER,
          retryable: false, jobId: job.id,
          message: error instanceof Error && error.message.startsWith("Limite du forfait ChatGPT")
            ? "Limite du forfait ChatGPT atteinte. Consultez Gérer ma consommation dans Mon profil."
            : "Le métré ChatGPT a échoué. Vérifiez le compte, le modèle, le niveau d’effort et la connexion dans Mon profil, puis relancez le métré.",
          details: { provider: "chatgpt" },
        });
      }
    },
  };
}
