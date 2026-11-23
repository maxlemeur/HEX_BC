import "server-only";

import { headers } from "next/headers";
import { z } from "zod";

import { assertLocalChatGptHost, hasLocalChatGptPlanAccess, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { callLocalChatGptStructured, LocalChatGptConnectionWithdrawnError } from "@/lib/ai/chatgpt-local-inference";
import { getChatGptHostId, readChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { assertTakeoffJobUsesLocalProvider, takeoffChatGptConnectionWithdrawn, TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { StructuredCall, StructuredCallOptions } from "@/lib/ai/structured-call";
import { chatGptPreferencesSchema, type ChatGptPreferences, type ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import type { TakeoffLevel, TakeoffProvider } from "@/lib/takeoff/types";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import type { TakeoffPaidCall, TakeoffPaidCallBranch, TakeoffPaidCallLedger } from "@/lib/takeoff/launch-call-ledger";
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

/** Why the member's ChatGPT subscription on this Mac cannot pay: what a launch request names when it waits. */
export type LocalChatGptSubscriptionIssue =
  | "LOCAL_RUNTIME_REQUIRED" | "HOST_NOT_AUTHORISED" | "CHATGPT_NOT_CONNECTED" | "CHATGPT_ACCESS_REVOKED" | "CHATGPT_MODEL_MISSING";
export type LocalChatGptSubscription =
  | { issue: LocalChatGptSubscriptionIssue; selection: null }
  | { issue: null; selection: TakeoffExecutionSelection & { authorizationId: string } };

/**
 * The member's ChatGPT subscription on this Mac, the one reader: the selection a paid call pins (opaque profile, model,
 * effort, Mac and the authorization of the current connection), or why it cannot pay. It never throws and never writes.
 * `host` is the address of the member's request at a gesture; the Mac's own loop has none.
 */
export async function readLocalChatGptSubscription(owner: ChatGptOwner, host?: string | null): Promise<LocalChatGptSubscription> {
  if (!isLocalChatGptEnabled()) return { issue: "LOCAL_RUNTIME_REQUIRED", selection: null };
  if (host !== undefined) {
    try {
      assertLocalChatGptHost(host);
    } catch {
      return { issue: "HOST_NOT_AUTHORISED", selection: null };
    }
  }
  let store: Awaited<ReturnType<typeof readChatGptStore>>;
  try {
    store = await readChatGptStore(owner);
  } catch {
    return { issue: "CHATGPT_ACCESS_REVOKED", selection: null };
  }
  if (!store.selectedId) return { issue: "CHATGPT_NOT_CONNECTED", selection: null };
  const profile = store.profiles.find((entry) => entry.id === store.selectedId);
  if (!profile || !hasLocalChatGptPlanAccess(profile) || !profile.authorizationId) return { issue: "CHATGPT_ACCESS_REVOKED", selection: null };
  if (!profile.model) return { issue: "CHATGPT_MODEL_MISSING", selection: null };
  return { issue: null, selection: { profileId: profile.id, model: profile.model, reasoningEffort: profile.reasoningEffort ?? null,
    hostId: await getChatGptHostId(), authorizationId: profile.authorizationId } };
}

/**
 * The one comparison of a pinned selection with the subscription in use: unchanged, changed (another profile, model,
 * effort or Mac) or withdrawn (disconnected, access lost, another connection: a reconnection never revives a pin; or a
 * pin written before authorizations existed, which names no connection to compare: it is never adopted).
 */
export function compareTakeoffSelection(pinned: unknown, actual: TakeoffExecutionSelection | null): "unchanged" | "changed" | "withdrawn" {
  if (!actual?.authorizationId) return "withdrawn";
  const parsed = takeoffExecutionSelectionSchema.safeParse(pinned);
  if (!parsed.success) return "changed";
  if (!parsed.data.authorizationId || parsed.data.authorizationId !== actual.authorizationId) return "withdrawn";
  return parsed.data.hostId === actual.hostId && parsed.data.profileId === actual.profileId && parsed.data.model === actual.model
    && (parsed.data.reasoningEffort ?? null) === (actual.reasoningEffort ?? null) ? "unchanged" : "changed";
}

const SUBSCRIPTION_MESSAGES: Record<LocalChatGptSubscriptionIssue, string> = {
  LOCAL_RUNTIME_REQUIRED: "Le forfait ChatGPT est disponible dans MergeOne local sur le Mac connecté.",
  HOST_NOT_AUTHORISED: "Cette adresse ne peut pas utiliser le forfait ChatGPT. Ouvrez MergeOne sur le Mac connecté.",
  CHATGPT_NOT_CONNECTED: "Connectez votre forfait ChatGPT dans Mon profil avant de lancer ce métré.",
  CHATGPT_ACCESS_REVOKED: "Reconnectez votre forfait ChatGPT dans Mon profil avant de lancer ce métré.",
  CHATGPT_MODEL_MISSING: "Choisissez un modèle ChatGPT dans Mon profil avant de lancer le métré.",
};

/** The subscription a launch pins, or a refusal in French: the throwing form of readLocalChatGptSubscription. */
export async function getTakeoffExecutionSelection(supabase: ServerSupabaseClient, owner: ChatGptOwner, requestedProvider: TakeoffProvider = "auto"): Promise<TakeoffExecutionSelection & { authorizationId: string }> {
  assertTakeoffProviderAvailable(parseTakeoffProvider(requestedProvider));
  if (!isLocalChatGptEnabled()) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false, message: SUBSCRIPTION_MESSAGES.LOCAL_RUNTIME_REQUIRED });
  }
  assertLocalChatGptHost((await headers()).get("host"));
  const subscription = await readLocalChatGptSubscription(owner);
  if (subscription.issue) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false, message: SUBSCRIPTION_MESSAGES[subscription.issue] });
  }
  // Refuse admission before uploading anything if the shared schema is old.
  const { error } = await supabase.from("takeoff_jobs")
    .select("execution_provider, execution_host_id").limit(0);
  if (error) throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
    message: "La mise à jour de la base pour les métrés ChatGPT doit être appliquée avant de lancer ce métré." });
  return subscription.selection;
}

/** Why a job's pinned connection cannot pay: the revocation reason a launch request names (CHATGPT_ACCESS_REVOKED). */
const connectionWithdrawn = takeoffChatGptConnectionWithdrawn;

export function assertPinnedTakeoffSelection(snapshot: unknown, userId: string, actual: TakeoffExecutionSelection) {
  if (!snapshot || typeof snapshot !== "object" || !("execution_selection" in snapshot)) return false;
  const comparison = compareTakeoffSelection(snapshot.execution_selection, actual);
  if (comparison === "withdrawn" && "confirmed_by" in snapshot && snapshot.confirmed_by === userId) throw connectionWithdrawn();
  if (!("confirmed_by" in snapshot) || snapshot.confirmed_by !== userId || comparison !== "unchanged") {
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

/** A job runs on its creator's subscription: only they may make it start (a resubmission, a pending replay). */
export function assertTakeoffJobStarter(job: { id?: string; created_by?: string | null }, userId: string) {
  if (job.created_by !== userId) {
    throw new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false, jobId: job.id,
      message: "Seule la personne qui a lancé cette analyse peut la démarrer avec son forfait. Préparez une nouvelle analyse avec votre forfait." });
  }
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

type PaidSelection = { remeasureSetting?: ChatGptPreferences; profileId: string; model: string; reasoningEffort: ChatGptReasoningEffort | null; authorizationId?: string | null;
  beforeSend?: () => Promise<TakeoffPaidCall>; onUsage?: (usage: { totalTokens: number; costCents: number; trusted: boolean }, call: unknown) => Promise<void>;
  onUnknownUsage?: (call: unknown) => Promise<void> };

export type LocalTakeoffProvider = {
  model: string;
  reasoningEffort?: ChatGptReasoningEffort | null;
  /**
   * The profile, model and effort the job runs with: every request pins them (the vector reading's too, TI-704), with
   * the ledger of its paid calls (launch-call-ledger.ts): a reading of the PDF reserves under `selection`, a question on
   * the vector groups under `groupsSelection`.
   */
  selection: PaidSelection;
  groupsSelection?: PaidSelection;
  useProfileForVectorGroups?: boolean;
  call: StructuredCall;
  /** The creator's active membership of the job's tenant, checked before each plan request (FORBIDDEN otherwise). */
  assertOwnerActive: () => Promise<void>;
};

/**
 * The provider of one attempt of a job. `lease` reads the processing lease the worker holds at each paid call: the
 * provider is resolved before the claim, so the row it is given carries the lease of an earlier attempt or none.
 * `ledger` is the job's right to pay (its module, the payer rule) and, for a launch request's job, the reservation and
 * the settlement of each paid call (launch-call-ledger.ts), once its credential is in hand, immediately before the
 * request is sent.
 */
export async function resolveLocalTakeoffProvider(supabase: ServerSupabaseClient, job: TakeoffJobProcessingRow,
  hooks: { lease?: () => string | null; ledger?: TakeoffPaidCallLedger } = {}): Promise<LocalTakeoffProvider> {
  const hostId = await assertLocalTakeoffExecutionHost(job);
  assertTakeoffWorkerConfiguration();
  // The persisted job supplies ownership, never the triggering HTTP session.
  const owner: ChatGptOwner = { userId: job.created_by ?? "", tenantId: job.tenant_id };
  // The creator's active membership of the job's tenant; who may pay on the affaire is checked by each paid call, just
  // before it is sent (`beforePaidCall`, from the execution scope, execution-scope-server.ts), for every job.
  async function assertOwnerActive() {
    const { data, error } = owner.userId ? await supabase.from("tenant_memberships")
      .select("user_id, tenants!inner(is_active)").eq("user_id", owner.userId)
      .eq("tenant_id", owner.tenantId).eq("tenants.is_active", true).maybeSingle()
      : { data: null, error: null };
    if (error || !data) throw new TakeoffError({ code: TakeoffErrorCode.FORBIDDEN, retryable: false, jobId: job.id,
      message: "Le créateur du métré n’a plus d’accès actif au tenant." });
  }
  await assertOwnerActive();
  const subscription = await readLocalChatGptSubscription(owner);
  if (subscription.issue === "CHATGPT_MODEL_MISSING") throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
    jobId: job.id, message: "Choisissez un modèle ChatGPT dans Mon profil avant de lancer le métré." });
  if (subscription.issue) throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, retryable: false, jobId: job.id,
    message: "Reconnectez le forfait ChatGPT du créateur de ce métré dans Mon profil." });
  const current = subscription.selection;
  const useProfileForVectorGroups = assertPinnedTakeoffSelection(job.preparation_snapshot, owner.userId, { ...current, hostId });
  // Every paid call (a chunk, a vector group) runs under the connection the job pinned, compared with the credential of
  // that call; a job that pinned none (queued before connections had one) is refused, never run on the current one. A
  // launch request's job reserves each call in its request's ledger and settles it with the usage of its response.
  const pinned = takeoffExecutionSelectionSchema.safeParse((job.preparation_snapshot as { execution_selection?: unknown } | null)?.execution_selection);
  if (!pinned.success || !pinned.data.authorizationId) throw connectionWithdrawn(job.id);
  const { ledger } = hooks;
  const paidSelection = (branch: TakeoffPaidCallBranch): PaidSelection => ({
    profileId: current.profileId, model: current.model, reasoningEffort: current.reasoningEffort ?? null,
    authorizationId: pinned.data.authorizationId,
    ...(ledger ? {
      beforeSend: () => ledger.beforePaidCall(branch),
      onUsage: (usage: { totalTokens: number; costCents: number; trusted: boolean }, call: unknown) => ledger.recordPaidUsage(call as TakeoffPaidCall, usage),
      onUnknownUsage: (call: unknown) => ledger.recordUnknownUsage(call as TakeoffPaidCall),
    } : {}),
  });
  const snapshot = job.preparation_snapshot;
  const setting = job.launch_request_id && snapshot && typeof snapshot === "object" && "remeasure_setting" in snapshot
    ? chatGptPreferencesSchema.parse(snapshot.remeasure_setting) : undefined;
  const selection = paidSelection("pdf");
  return {
    model: setting?.model ?? selection.model,
    reasoningEffort: setting ? setting.reasoningEffort : selection.reasoningEffort,
    selection,
    groupsSelection: { ...paidSelection("vector_group"), ...(setting && { remeasureSetting: setting }) },
    useProfileForVectorGroups,
    assertOwnerActive,
    call: async <T>(options: StructuredCallOptions<T>) => {
      await assertOwnerActive();
      try {
        return setting ? await callLocalChatGptStructured(owner, options, selection, setting)
          : await callLocalChatGptStructured(owner, options, selection);
      } catch (error) {
        // The job's own refusals keep their name: its right to pay, a usage its ledger could not record.
        if (error instanceof TakeoffError) throw error;
        if (error instanceof LocalChatGptConnectionWithdrawnError) throw connectionWithdrawn(job.id);
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
