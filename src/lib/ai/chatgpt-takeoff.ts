import "server-only";

import { headers } from "next/headers";
import { z } from "zod";

import { assertLocalChatGptHost, hasLocalChatGptPlanAccess, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { getChatGptHostId, readChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { assertTakeoffJobUsesLocalProvider, TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { StructuredCall, StructuredCallOptions } from "@/lib/ai/structured-call";
import type { ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import type { TakeoffLevel, TakeoffProvider } from "@/lib/takeoff/types";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { takeoffExecutionSelectionSchema, type TakeoffExecutionSelection } from "@/lib/takeoff/preparation";
import { assertTakeoffWorkerConfiguration } from "@/lib/takeoff/default-on-flags";
import { DETAILED_TAKEOFF_PROCESSING } from "@/lib/takeoff/preparation-from-dossier";

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

export function requireDetailedTakeoffProcessing({ level, provider }: { level?: TakeoffLevel; provider?: TakeoffProvider }) {
  assertTakeoffProviderAvailable(provider ?? "auto");
  if (level !== DETAILED_TAKEOFF_PROCESSING.level || provider !== DETAILED_TAKEOFF_PROCESSING.provider) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.BAD_REQUEST, retryable: false, level,
      message: "Les nouveaux métrés utilisent l’analyse détaillée avec le forfait ChatGPT. Confirmez à nouveau la préparation." });
  }
  return DETAILED_TAKEOFF_PROCESSING;
}

export async function getTakeoffExecutionSelection(supabase: ServerSupabaseClient, owner: ChatGptOwner, requestedProvider: TakeoffProvider = "auto"): Promise<TakeoffExecutionSelection> {
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
  return { profileId: profile.id, model: profile.model, reasoningEffort: profile.reasoningEffort ?? null, hostId: await getChatGptHostId() };
}

export function assertPinnedTakeoffSelection(snapshot: unknown, userId: string, actual: TakeoffExecutionSelection) {
  if (!snapshot || typeof snapshot !== "object" || !("execution_selection" in snapshot)) return false;
  const parsed = takeoffExecutionSelectionSchema.safeParse(snapshot.execution_selection);
  if (!parsed.success || !("confirmed_by" in snapshot) || snapshot.confirmed_by !== userId ||
    parsed.data.hostId !== actual.hostId || parsed.data.profileId !== actual.profileId ||
    parsed.data.model !== actual.model || parsed.data.reasoningEffort !== actual.reasoningEffort) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Le compte, le modèle ou l’effort ChatGPT a changé depuis la confirmation. Préparez une nouvelle analyse avec votre forfait." });
  }
  return true;
}

export async function getConfirmedTakeoffExecutionOwner(supabase: ServerSupabaseClient, owner: ChatGptOwner, snapshot: unknown) {
  assertTakeoffWorkerConfiguration();
  const selected = await getTakeoffExecutionSelection(supabase, owner, "chatgpt");
  if (!assertPinnedTakeoffSelection(snapshot, owner.userId, selected)) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Confirmez à nouveau la préparation pour utiliser votre forfait ChatGPT." });
  }
  return { execution_provider: "chatgpt_local" as const, execution_host_id: selected.hostId };
}

export async function assertLocalTakeoffExecutionHost(job: TakeoffJobProcessingRow): Promise<string> {
  assertTakeoffJobUsesLocalProvider(job);
  if (!isLocalChatGptEnabled() || job.execution_host_id !== await getChatGptHostId()) {
    throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false, jobId: job.id,
      message: "Ce métré est réservé au forfait ChatGPT sur son Mac d’origine. Relancez-le depuis ce Mac." });
  }
  return job.execution_host_id;
}

/** Before requeueing, verify the persisted creator, plan and originating Mac. */
export async function assertLocalTakeoffResumeReady(supabase: ServerSupabaseClient, tenantId: string, job: {
  id?: string; execution_provider?: string | null; execution_host_id?: string | null; created_by?: string | null; preparation_snapshot?: unknown;
}) {
  assertTakeoffJobUsesLocalProvider(job);
  if (!job.created_by) throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
    message: "Le créateur du métré n’est plus disponible. Préparez une nouvelle analyse." });
  // Job and operator authorization precede this privileged, tenant-scoped read.
  const membership = await createServiceRoleClient().from("tenant_memberships").select("user_id, tenants!inner(is_active)")
    .eq("user_id", job.created_by).eq("tenant_id", tenantId).eq("tenants.is_active", true).maybeSingle();
  if (membership.error || !membership.data) throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
    message: "Le créateur n’a plus d’accès actif à cette affaire. Préparez une nouvelle analyse." });
  const selection = await getTakeoffExecutionSelection(supabase, { userId: job.created_by, tenantId }, "chatgpt");
  if (selection.hostId !== job.execution_host_id) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: "Relancez ce métré depuis le Mac d’origine avec le forfait ChatGPT du créateur connecté." });
  }
  let snapshot = job.preparation_snapshot;
  if (snapshot === undefined && job.id) {
    // Detail responses omit the private selection. Re-read it through the caller’s authorized client.
    const { data, error } = await supabase.from("takeoff_jobs").select("preparation_snapshot")
      .eq("tenant_id", tenantId).eq("id", job.id).maybeSingle();
    if (error || !data) throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Impossible de vérifier les réglages de cette analyse. Rechargez le métré avant de réessayer." });
    snapshot = data.preparation_snapshot;
  }
  assertPinnedTakeoffSelection(snapshot, job.created_by, selection);
}

export type LocalTakeoffProvider = {
  model: string;
  reasoningEffort?: ChatGptReasoningEffort | null;
  /** The profile, model and effort the job runs with: every request pins them (the vector reading's too, TI-704). */
  selection: { profileId: string; model: string; reasoningEffort: ChatGptReasoningEffort | null };
  useProfileForVectorGroups?: boolean;
  call: StructuredCall;
  /** The creator's active membership of the job's tenant, checked before each plan request (FORBIDDEN otherwise). */
  assertOwnerActive: () => Promise<void>;
};

export async function resolveLocalTakeoffProvider(supabase: ServerSupabaseClient, job: TakeoffJobProcessingRow): Promise<LocalTakeoffProvider> {
  const hostId = await assertLocalTakeoffExecutionHost(job);
  assertTakeoffWorkerConfiguration();
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
  const useProfileForVectorGroups = assertPinnedTakeoffSelection(job.preparation_snapshot, owner.userId, { ...selection, hostId });
  return {
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    selection,
    useProfileForVectorGroups,
    assertOwnerActive,
    call: async <T>(options: StructuredCallOptions<T>) => {
      await assertOwnerActive();
      try {
        return await callLocalChatGptStructured(owner, options, selection);
      } catch (error) {
        // Stop here: no automatic retry or raw provider data.
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
