import "server-only";

import { headers } from "next/headers";
import { z } from "zod";

import { assertLocalChatGptHost, hasLocalChatGptPlanAccess, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { getChatGptHostId, readChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { assertTakeoffJobUsesLocalProvider, TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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

export function assertTakeoffProviderAvailable(provider: TakeoffProvider) {
  if (provider === "gemini") throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
    message: "Cet ancien fournisseur n’est plus disponible. Choisissez le forfait ChatGPT local et confirmez à nouveau la préparation." });
}

export async function getTakeoffExecutionOwner(supabase: ServerSupabaseClient, owner: ChatGptOwner, requestedProvider: TakeoffProvider = "auto"): Promise<{
  execution_provider?: never; execution_host_id?: never;
} | { execution_provider: "chatgpt_local"; execution_host_id: string }> {
  assertTakeoffProviderAvailable(parseTakeoffProvider(requestedProvider));
  if (!isLocalChatGptEnabled()) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Le forfait ChatGPT est disponible dans MergeOne local sur le Mac connecté." });
  }
  assertLocalChatGptHost((await headers()).get("host"));
  const store = await readChatGptStore(owner);
  if (!store.selectedId) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Connectez votre forfait ChatGPT dans Mon profil avant de lancer ce métré." });
  }
  const profile = store.profiles.find((entry) => entry.id === store.selectedId);
  if (!profile || !hasLocalChatGptPlanAccess(profile)) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Reconnectez votre forfait ChatGPT dans Mon profil avant de lancer ce métré." });
  }
  if (!profile.model) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
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

/** Before requeueing, verify the persisted creator, plan and originating Mac. */
export async function assertLocalTakeoffResumeReady(supabase: ServerSupabaseClient, tenantId: string, job: {
  execution_provider?: string | null; execution_host_id?: string | null; created_by?: string | null;
}) {
  assertTakeoffJobUsesLocalProvider(job);
  if (job.execution_provider !== "chatgpt_local") return;
  if (!job.created_by) throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
    message: "Le créateur du métré n’est plus disponible. Préparez une nouvelle analyse." });
  // Job and operator authorization precede this privileged, tenant-scoped read.
  const membership = await createServiceRoleClient().from("tenant_memberships").select("user_id, tenants!inner(is_active)")
    .eq("user_id", job.created_by).eq("tenant_id", tenantId).eq("tenants.is_active", true).maybeSingle();
  if (membership.error || !membership.data) throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
    message: "Le créateur n’a plus d’accès actif à cette affaire. Préparez une nouvelle analyse." });
  const owner = await getTakeoffExecutionOwner(supabase, { userId: job.created_by, tenantId }, "chatgpt");
  if (!owner.execution_host_id || owner.execution_host_id !== job.execution_host_id) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Relancez ce métré depuis le Mac d’origine avec le forfait ChatGPT du créateur connecté." });
  }
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
