import "server-only";

import { readAdmittedPlanRequests } from "./admitted-plan-readings-server";
import { attestBriefPlanChoice } from "./brief-plan-choice-server";
import { BRIEF_PLAN_CHANGED, sealedBriefPlansSchema, type BriefPlanSelection, type SealedBriefPlans } from "./brief-plan-choice";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import { getAffaireIntakeFileExtension } from "@/lib/affaires/intake";
import { findIntakePlansWithoutWorkingCopy, isSameIntakePlanGeneration, type PlanFileRow, type SyncDocument } from "@/lib/affaires/intake-plan-sync";
import { DOCUMENT_SELECT, normalizeDocumentRow } from "@/lib/affaires/intake-rows";
import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import {
  compareTakeoffSelection, getConfirmedTakeoffExecutionOwner, readLocalChatGptSubscription, type LocalChatGptSubscription,
} from "@/lib/ai/chatgpt-takeoff";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertTakeoffWorkerConfiguration } from "@/lib/takeoff/default-on-flags";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { getTakeoffLevelCProcessingConfigForTenant, takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import { takeoffJobInsertError } from "@/lib/takeoff/job-creation-server";
import { describeTakeoffLaunchAction, viewerLaunchAction, type TakeoffLaunchAction } from "@/lib/takeoff/operator-state";
import { deriveDeterministicJobId } from "@/lib/takeoff/job-creation-input";
import { resolvePlanSetSourceFile } from "@/lib/takeoff/job-creation-repository";
import {
  buildTakeoffLaunchManifest, decideTakeoffLaunch, describeTakeoffLaunchReason, isTakeoffLaunchReason, splitTakeoffLaunchManifest,
  TAKEOFF_AUTOMATIC_PAYER_NOTICE, TAKEOFF_GROUPED_UNIT_KEY,
  type AnyTakeoffLaunchManifest, type TakeoffLaunchManifest, type TakeoffLaunchOrder, type TakeoffLaunchPiece, type TakeoffLaunchReason,
  type TakeoffRelaunchChoice, describeTakeoffRelaunchWithoutPlans,
  type TakeoffLaunchRequestState, type TakeoffPlanLaunchManifest,
} from "@/lib/takeoff/launch-request";
import { runLocalTakeoffAttempts } from "@/lib/takeoff/local-dispatch";
import { isTakeoffPlanDispatchActive } from "@/lib/takeoff/local-dispatcher";
import {
  createTakeoffPreparationSnapshot, evaluateTakeoffPreparation, TakeoffPreparationNotReadyError,
  type TakeoffExecutionSelection, type TakeoffPreparation, type TakeoffPreparationSnapshot,
} from "@/lib/takeoff/preparation";
import { sealedMeasuringOrder } from "@/lib/takeoff/item-list-seal-server";
import { itemListReadingRefusalDetails, itemListReadingTooLarge, sealItemListReading } from "@/lib/takeoff/poste-reading-admission-server";
import type { Poste } from "@/lib/takeoff/poste-list";
import { readPosteReadingBoundsFacts, type PosteReadingBoundsFacts } from "@/lib/takeoff/poste-reading-bounds-text";
import { reopenDeducedPlanCandidates, resolveDeducedPlanVersions } from "@/lib/takeoff/preparation-from-dossier";
import { assertPreparationProjectAccess } from "@/lib/takeoff/preparation-repository";
import {
  assertConfirmedTakeoffPreparation, loadPreparation, PreparationPlanBudgetError, PreparationPlanSealError, sealPreparationSources,
} from "@/lib/takeoff/preparation-server";
import { getPlanSetMaxPdfPages } from "@/lib/takeoff/source-loader";
import { openPreparedPlan } from "@/lib/takeoff/preparation-source-loader";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { selectProjectImportPlanSet } from "@/lib/takeoff/default-import-plan-set";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import {
  isTakeoffSourceVisible, maskTakeoffDossierChange, maskTakeoffPieces,
} from "@/lib/takeoff/request-activity";
import {
  checkCurrentCommandCopies, currentPlanCopies, recordedCopySources, recordedPlanPieces, relaunchIdentities, type CurrentPlanCopies,
} from "@/lib/takeoff/relaunch-plan-copies-server";
import { readTakeoffVisibleSources } from "@/lib/takeoff/source-visibility-server";
import type { Database, Json } from "@/types/database";

type Service = SupabaseClient<Database>;
type Context = AuthenticatedTenantContext;

export function databaseError(error: { code?: string; message: string }, message: string): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, message);
}

/**
 * The named refusals of the launch functions, in French, mapped once for every caller; any other error is the database's
 * (`fallback` is its message).
 */
export function launchError(error: { code?: string; message: string }, fallback: string): never {
  const refusal = (status: 403 | 404 | 409 | 422, code: TakeoffErrorCode, message: string, retryable = false) =>
    new TakeoffError({ status, code, retryable, message });
  switch (error.message) {
    case "TAKEOFF_LAUNCH_INACTIVE":
      throw refusal(409, TakeoffErrorCode.CONFLICT, "Le démarrage automatique du métré n’est pas activé.");
    case "TAKEOFF_LAUNCH_MODULE_DISABLED":
      throw refusal(403, TakeoffErrorCode.FORBIDDEN, "Le module Takeoff est désactivé pour ce tenant.");
    case "TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE":
      throw refusal(403, TakeoffErrorCode.FORBIDDEN, "Votre rôle ne permet pas de prendre en charge le métré de cette affaire.");
    case "TAKEOFF_BRIEF_CONFIRMATION_FORBIDDEN":
      throw refusal(403, TakeoffErrorCode.FORBIDDEN, "Votre rôle ne permet pas de confirmer le brief de cette affaire.");
    case "TAKEOFF_LAUNCH_REQUEST_NOT_FOUND":
      throw refusal(404, TakeoffErrorCode.NOT_FOUND, "Aucun métré n’attend sa prise en charge sur cette affaire.");
    case "TAKEOFF_LAUNCH_INTENT_CONFLICT":
      throw refusal(409, TakeoffErrorCode.CONFLICT, "Cette commande a déjà été envoyée pour une autre analyse. Rechargez les options du métré.");
    case "TAKEOFF_LAUNCH_PLAN_COPY_STALE":
      throw refusal(422, TakeoffErrorCode.VALIDATION_ERROR, "Un plan a changé pendant le lancement. Actualisez les plans à lire.");
    case "TAKEOFF_LAUNCH_PREDECESSOR_REQUIRED":
    case "TAKEOFF_LAUNCH_PREDECESSOR_INVALID":
      throw refusal(422, TakeoffErrorCode.VALIDATION_ERROR, "L’analyse à relancer n’appartient pas à cette affaire.");
    case "TAKEOFF_LAUNCH_AUTOMATIC_PENDING":
      throw refusal(409, TakeoffErrorCode.CONFLICT,
        "Le métré automatique de l’affaire peut encore démarrer : prenez-le en charge depuis l’état du métré de l’affaire.");
    case "TAKEOFF_LAUNCH_ANALYSIS_EXISTS":
      throw refusal(409, TakeoffErrorCode.CONFLICT, "L’affaire a déjà une analyse : rechargez l’affaire pour relancer celle qu’elle montre.");
    case "TAKEOFF_JOB_ADMISSION_LIMIT":
      throw takeoffJobInsertError({ code: "23514", message: error.message }, "");
    case "TAKEOFF_LAUNCH_STOP_GROUPED":
      throw refusal(422, TakeoffErrorCode.VALIDATION_ERROR,
        "Cette analyse lit tous ses plans en une fois : annulez-la depuis son suivi plutôt que d’arrêter ses plans un par un.");
    // Lot 4: the list of items changed while the command was sealed (once the second order is activated).
    case "TAKEOFF_LAUNCH_DOSSIER_CHANGED":
      throw refusal(409, TakeoffErrorCode.CONFLICT, "La liste des postes a changé pendant la relance : relancez l’analyse.");
    // Lot 4: a plan read against the list must have its page count known at the seal, before any call is paid.
    case "TAKEOFF_LAUNCH_PLAN_PAGES_UNKNOWN":
      throw refusal(422, TakeoffErrorCode.VALIDATION_ERROR,
        "Le nombre de pages d’un plan n’a pas pu être lu : vérifiez que son PDF s’ouvre, puis relancez la lecture contre la liste des postes.");
  }
  // Two operations of one affaire that crossed in the database and were rolled back (a deadlock, a serialization
  // failure): nothing was recorded, the same command may be sent again.
  if (error.code === "40P01" || error.code === "40001") {
    throw new TakeoffError({ status: 503, code: TakeoffErrorCode.CONFLICT, retryable: true,
      message: "Le métré de l’affaire est occupé par une autre opération. Réessayez dans un instant." });
  }
  databaseError(error, fallback);
}

/** Whether both cut-offs are set, on the database's clock: before, nothing of this module writes. */
export async function isTakeoffLaunchActive(service: Service = createServiceRoleClient()) {
  const { data, error } = await service.rpc("takeoff_launch_is_active");
  if (error) databaseError(error, "Impossible de lire l’activation du démarrage automatique du métré.");
  return data === true;
}

function selectionParameters(subscription: LocalChatGptSubscription | { issue: "MANDATE_REQUIRED"; selection: null }) {
  return subscription.selection
    ? { p_host: subscription.selection.hostId, p_selection: subscription.selection as unknown as Json }
    : { p_blocked_reason: subscription.issue };
}

/** The member's subscription on this Mac when the one payer rule lets them pay on the affaire; never read otherwise. */
async function readPayerSubscription(service: Service, context: Context, projectId: string, host: string | null | undefined) {
  const { data: mayPay, error } = await service.rpc("takeoff_payer_may_launch", {
    p_tenant_id: context.tenantId, p_project_id: projectId, p_user_id: context.userId });
  if (error) databaseError(error, "Impossible de vérifier qui peut payer le métré de cette affaire.");
  if (mayPay !== true) return { issue: "MANDATE_REQUIRED" as const, selection: null };
  return readLocalChatGptSubscription({ userId: context.userId, tenantId: context.tenantId }, host);
}

type GestureRow = { request_id: string | null; state: string | null; reason_code: string | null; payer_id: string | null };

/** What a gesture leaves: the request, its state and its reason in French, and the gesture it now allows this member. */
export type TakeoffLaunchGestureResult = {
  requestId: string; state: TakeoffLaunchRequestState; reason: TakeoffLaunchReason | null; message: string | null;
  action: TakeoffLaunchAction; actionLabel: string | null;
};
async function gestureResult(service: Service, row: GestureRow, actorId: string, hasLocalRuntime: boolean): Promise<TakeoffLaunchGestureResult | null> {
  if (!row.request_id || !row.state) return null;
  const reason = isTakeoffLaunchReason(row.reason_code) ? row.reason_code : null;
  const { data: allowed, error } = await service.rpc("takeoff_launch_request_action", { p_request_id: row.request_id, p_actor: actorId });
  if (error) databaseError(error, "Impossible de lire le métré de l’affaire.");
  const action = viewerLaunchAction(allowed, hasLocalRuntime, row.state, row.reason_code);
  return { requestId: row.request_id, state: row.state as TakeoffLaunchRequestState, reason,
    message: reason ? describeTakeoffLaunchReason(reason) : null, action, actionLabel: describeTakeoffLaunchAction(action) };
}

/**
 * The confirmation of an affaire's brief through the server, in one commit: the member's right to confirm it, the
 * brief's compare-and-set on the revision the member saw, its event, the reservation of the affaire's automatic request
 * and the member's mandate. The mandate is payable only when the confirmation carries the payer notice it was shown
 * with (`notice`, from `readAutomaticTakeoffPayerNotice`); otherwise the brief is confirmed and the request waits for a
 * gesture. A replay, or the identical submission of a confirmation whose answer was lost, returns the request as it is.
 */
export async function confirmAffaireBriefWithTakeoff(input: {
  context: Context; projectId: string; expectedUpdatedAt: string; plans: BriefPlanSelection; notice: string | null; host: string | null;
}) {
  const { context } = input;
  const service = createServiceRoleClient();
  const [subscription, session] = await Promise.all([
    input.plans.length ? readPayerSubscription(service, context, input.projectId, input.host) : null,
    // The member's verified session claims: the database evaluates the released brief policy under them (none refuses).
    context.supabase.auth.getClaims().then(({ data, error }) => (error ? null : data?.claims ?? null), () => null),
  ]);
  const choice = await attestBriefPlanChoice(context, input.projectId, input.plans);
  if ("message" in choice) return { outcome: "choice_refused" as const, takeoff: null, ...choice };
  const { data, error } = await service.rpc("confirm_affaire_brief_plan_choice", {
    p_tenant_id: context.tenantId, p_project_id: input.projectId, p_actor: context.userId,
    // No notice: the brief is confirmed and engages nobody.
    p_expected_updated_at: input.expectedUpdatedAt, p_plans: choice.plans, p_notice: (subscription ? input.notice : null) as string,
    p_module_default: takeoffModuleDefault(), ...(subscription ? selectionParameters(subscription) : {}),
    p_actor_claims: session as unknown as Json,
  });
  if (error?.message === "TAKEOFF_BRIEF_PLAN_CHANGED" || error?.message === "TAKEOFF_LAUNCH_INACTIVE") {
    return { outcome: "choice_refused" as const, takeoff: null, code: error.message, message: error.message === "TAKEOFF_BRIEF_PLAN_CHANGED"
      ? BRIEF_PLAN_CHANGED : "Le lancement par plan est indisponible. Vous pouvez confirmer sans analyser." };
  }
  if (error?.message === "INTAKE_ANALYSIS_REQUIRED" || error?.message === "INTAKE_ANALYSIS_RUNNING") {
    return { outcome: "analysis_pending" as const, takeoff: null, message: error.message === "INTAKE_ANALYSIS_REQUIRED"
      ? (error.hint === "Lancez l’analyse ou retirez les pièces en attente avant de confirmer." ? error.hint : "Lancez l’analyse pour actualiser le brief avant de confirmer.")
      : "Attendez la fin de l’analyse du dossier avant de confirmer." };
  }
  if (error?.code === "P0002") return { outcome: "not_found" as const, takeoff: null };
  if (error) launchError(error, "Impossible de confirmer le brief affaire.");
  const row = ((data ?? []) as Array<GestureRow & { outcome: string }>)[0];
  if (!row || row.outcome === "conflict") return { outcome: "conflict" as const, takeoff: null };
  if (row.state === "evaluating") wakeTakeoffLaunchConsumer();
  return { outcome: row.outcome as "confirmed" | "replayed",
    takeoff: await gestureResult(service, row, context.userId, subscription?.issue !== "LOCAL_RUNTIME_REQUIRED") };
}

/**
 * « Reprendre avec mon forfait » / « Prendre en charge avec mon forfait »: an operator who may launch on the affaire takes
 * its waiting request on their own subscription, on this Mac, by an explicit gesture; they then receive its end. The
 * gesture names the revision of the mandate and the action the affaire's options showed (readAffaireTakeoffLaunchState):
 * when either moved, it is refused. A blocked mandate is never lifted by a later connection alone.
 */
export async function assumeTakeoffLaunchRequest(input: {
  context: Context; projectId: string; requestId: string; seenRevision: number; action: "take_on" | "resume"; host: string | null;
}) {
  const { context, projectId } = input;
  await assertPreparationProjectAccess(context, projectId, true);
  const service = createServiceRoleClient();
  const subscription = await readLocalChatGptSubscription({ userId: context.userId, tenantId: context.tenantId }, input.host);
  if (subscription.issue) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: describeTakeoffLaunchReason(subscription.issue) });
  }
  const { data, error } = await service.rpc("take_on_takeoff_launch_request", {
    p_tenant_id: context.tenantId, p_project_id: projectId, p_actor: context.userId, p_request_id: input.requestId,
    p_seen_revision: input.seenRevision, p_action: input.action, p_host: subscription.selection.hostId,
    p_selection: subscription.selection as unknown as Json, p_module_default: takeoffModuleDefault(),
  });
  if (error) launchError(error, "Impossible d’enregistrer qui paie le métré de cette affaire.");
  const row = ((data ?? []) as Array<GestureRow & { outcome: string }>)[0];
  if (!row || row.outcome === "moved") {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Le métré de cette affaire a changé depuis votre lecture. Actualisez avant de le prendre en charge." });
  }
  if (row.state === "evaluating") wakeTakeoffLaunchConsumer();
  return (await gestureResult(service, row, context.userId, true))!;
}

/**
 * The payer notice of the brief's confirmation, for the member whose subscription the analysis will use: its text and
 * the digest the confirmation carries back (the member, both cut-offs and the subscription and settings it was shown
 * with on this Mac). None when the member may not pay, before both cut-offs or with the module off. A read that fails
 * throws: it is never taken for « no notice ».
 */
export async function readAutomaticTakeoffPayerNotice(context: Context, project: { id: string }, host?: string | null) {
  const service = createServiceRoleClient();
  const subscription = await readPayerSubscription(service, context, project.id, host);
  if (subscription.issue === "MANDATE_REQUIRED") return null;
  const { data, error } = await service.rpc("takeoff_payer_notice", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_actor: context.userId,
    p_selection: (subscription.selection ?? null) as unknown as Json, p_module_default: takeoffModuleDefault(),
  });
  if (error) databaseError(error, "Impossible de vérifier quel forfait ChatGPT le métré utilisera.");
  if (typeof data !== "string") return null;
  return { message: TAKEOFF_AUTOMATIC_PAYER_NOTICE, digest: data };
}

/**
 * The one rule of the notice the confirmation dialog shows, read when it opens: only for a brief to confirm, read now
 * under the member's own session, then as readAutomaticTakeoffPayerNotice gives it. The dialog sends back the digest of
 * what it showed; a brief that reached the page after its render is read here, not taken from that render.
 */
export async function readBriefConfirmationPayerNotice(context: Context, project: { id: string }, host?: string | null) {
  const { data, error } = await context.supabase.from("affaire_briefs").select("status")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).maybeSingle();
  if (error) databaseError(error, "Impossible de lire le brief de l’affaire.");
  if ((data as { status?: string } | null)?.status !== "a_confirmer") return null;
  return readAutomaticTakeoffPayerNotice(context, project, host);
}

// The Mac's loop: evaluate the requests whose mandate it holds, then admit them.

type DossierPlanSet = { id: string; files: Array<PlanFileRow & { file_name: string }> };

async function readDossierPlanSet(service: Service, tenantId: string, projectId: string): Promise<DossierPlanSet | null> {
  const sets = await readAllRows(() => service.from("plan_sets")
    .select("id, estimate_version_id, name, metadata, updated_at, plan_files(count)" as never, { count: "exact" })
    .eq("tenant_id", tenantId).eq("project_id", projectId).order("id"));
  if (sets.error) databaseError(sets.error, "Impossible de lire les plans de l’affaire.");
  const chosen = selectProjectImportPlanSet(((sets.data ?? []) as unknown as Array<{ id: string; estimate_version_id: string | null; name: string;
    metadata: unknown; updated_at: string; plan_files?: Array<{ count: number }> }>)
    .map((set) => ({ ...set, file_count: set.plan_files?.[0]?.count ?? 0 })));
  if (!chosen) return null;
  return { id: chosen.id, files: await readPlanSetFiles(service, tenantId, chosen.id) };
}

async function readPlanSetFiles(service: Service, tenantId: string, planSetId: string) {
  const files = await readAllRows(() => service.from("plan_files").select("id, file_path, file_name, file_size_bytes, metadata", { count: "exact" })
    .eq("tenant_id", tenantId).eq("plan_set_id", planSetId).order("id"));
  if (files.error) databaseError(files.error, "Impossible de lire les plans de l’affaire.");
  return (files.data ?? []).map((file) => ({ ...file,
    metadata: (file.metadata && typeof file.metadata === "object" && !Array.isArray(file.metadata) ? file.metadata : {}) as Record<string, unknown> }));
}

/** The plan set a request sealed: that of the plans its sealed preparation reads (kept when its analysis is deleted). */
export function sealedPlanSetId(snapshot: unknown) {
  const sources = (snapshot as { preparation?: { sources?: unknown } } | null)?.preparation?.sources;
  const plan = (Array.isArray(sources) ? sources : []).find((source) => {
    const entry = source as { kind?: unknown; active?: unknown; plan_set_id?: unknown };
    return entry?.kind === "plan" && entry.active === true && typeof entry.plan_set_id === "string";
  }) as { plan_set_id: string } | undefined;
  return plan?.plan_set_id ?? null;
}

/**
 * The plan set a request sealed, with its copies; `dossier` when it is the dossier's import set, whose plans without a
 * working copy count. A request without a sealed preparation reads the dossier's.
 */
async function readRequestPlanSet(service: Service, tenantId: string, projectId: string, planSetId: string | null) {
  const dossier = await readDossierPlanSet(service, tenantId, projectId);
  if (!planSetId || planSetId === dossier?.id) return dossier ? { ...dossier, dossier: true } : null;
  return { id: planSetId, files: await readPlanSetFiles(service, tenantId, planSetId), dossier: false };
}

async function readDossierDocuments(service: Service, tenantId: string, projectId: string) {
  const rows = await readAllRows(() => service.from("affaire_intake_documents").select(DOCUMENT_SELECT as never, { count: "exact" })
    .eq("tenant_id", tenantId).eq("project_id", projectId).is("deleted_at", null).order("id" as never));
  if (rows.error) databaseError(rows.error, "Impossible de lire le dossier de l’affaire.");
  return ((rows.data ?? []) as unknown[]).map(normalizeDocumentRow).filter((row) => row !== null);
}

type Sealed = { snapshot: TakeoffPreparationSnapshot; manifest: TakeoffLaunchManifest; sourceFile: Awaited<ReturnType<typeof resolvePlanSetSourceFile>>;
  /** The pages of each plan the sealing counted on its bytes. */
  pageCounts: ReadonlyMap<string, number>;
  /** The sealed list's items (none for the free extraction): what the bounds of the reading count. */
  items: readonly Poste[] };
type Refusal = { state: "not_eligible" | "blocked"; reason: TakeoffLaunchReason; pieces: TakeoffLaunchPiece[];
  /** Lot 4: the bounds of a reading against the list of items, when they refused it. */
  readingBounds?: PosteReadingBoundsFacts };

/**
 * The automatic snapshot: the preparation deduced from the dossier for its plan set, with the options the members saved
 * (never written over their draft), its pieces sealed as a member's confirmation seals them (`sealPreparationSources`):
 * a reference the worker would not read is left out and named in the coverage; a plan whose bytes cannot be read stops
 * the start and is named. `documents` are the dossier's rows the evaluation already read, with their recorded sizes.
 */
async function sealAutomaticSnapshot(service: Service, input: {
  tenantId: string; projectId: string; planSet: DossierPlanSet; payerId: string; selection: TakeoffExecutionSelection; jobId: string;
  /** One analysis per plan is active: the units are split per plan (and only then may a list of items be sealed). */
  perPlan: boolean;
  selectedPlans: SealedBriefPlans | null;
  documents: ReadonlyArray<{ id: string; size_bytes: number; upload_id: string | null }>;
  /** Plans of the dossier the analysis cannot read (not PDF): named in the coverage, never read. */
  unsupportedPlans: TakeoffLaunchPiece[];
}): Promise<Sealed | Refusal> {
  const loaded = await loadPreparation({ supabase: service, tenantId: input.tenantId }, input.projectId, input.planSet.id);
  const draft = structuredClone(loaded.draft) as TakeoffPreparation;
  // The automatic analysis reads the affaire without a version and sends nothing: analysis only, no reviewer.
  draft.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  // Every retained version of a plan is read again before the revision choices apply, as a confirmation does.
  reopenDeducedPlanCandidates(draft.sources);
  const { selectedPlans } = input;
  if (selectedPlans) {
    draft.sources = draft.sources.filter((source) => source.kind !== "plan" || Object.hasOwn(selectedPlans, source.document_id));
    const plans = draft.sources.filter((source) => source.kind === "plan");
    if (plans.length !== Object.keys(selectedPlans).length) return { state: "blocked", reason: "PLAN_COPY_MISSING", pieces: [] };
    for (const plan of plans) {
      plan.active = true;
      delete plan.alternate_of;
    }
  }
  const available = new Map(loaded.availableSources.map((source) => [source.document_id, source]));
  for (const source of draft.sources.filter((entry) => entry.active)) {
    // A file uploaded for a former launch is not part of the dossier.
    if (source.document_id.startsWith("upload:")) source.active = false;
    const current = available.get(source.document_id);
    // A piece that changed while the dossier was read: the next pass reads it again.
    if (current && (current.source_version !== source.source_version || current.kind !== source.kind)) {
      return { state: "blocked", reason: "SOURCE_UNREADABLE", pieces: [] };
    }
  }
  // A plan the analysis could not read (its copy missing or unreadable), or plans past its budget: named, and a dossier
  // change evaluates the request again.
  const planRefusal = (error: unknown): Refusal => {
    if (error instanceof PreparationPlanBudgetError) return { state: "blocked", reason: "PLAN_SET_TOO_LARGE", pieces: error.pieces };
    if (!(error instanceof PreparationPlanSealError)) throw error;
    return { state: "blocked", reason: error.reason === "too_large" ? "PLAN_SET_TOO_LARGE" : "PLAN_COPY_MISSING", pieces: [error.piece] };
  };
  let sealed: Awaited<ReturnType<typeof sealPreparationSources>>;
  try {
    sealed = await sealPreparationSources(draft, { supabase: service, affaire: { tenantId: input.tenantId, projectId: input.projectId },
      sources: loaded.availableSources,
      documents: new Map(input.documents.map((document) => [document.id, { size_bytes: document.size_bytes, upload_id: document.upload_id }])),
      onReferenceIssue: "omit" });
  } catch (error) {
    return planRefusal(error);
  }
  const resolved = resolveDeducedPlanVersions(draft);
  if (selectedPlans) {
    const changed = resolved.sources.filter((source) => source.kind === "plan" && (!source.active || source.content_hash !== selectedPlans[source.document_id].sha256));
    if (changed.length) return { state: "blocked", reason: "PREPARATION_NEEDS_REVIEW",
      pieces: changed.map((source) => ({ id: source.document_id, name: source.document_name })) };
  }
  const readiness = evaluateTakeoffPreparation(resolved);
  if (!readiness.can_launch) {
    const named = new Map(resolved.sources.map((source) => [source.document_id, source.document_name]));
    return { state: "blocked", reason: "PREPARATION_NEEDS_REVIEW", pieces: [...new Set(readiness.blockers
      .map((blocker) => blocker.source_document_id).filter((id): id is string => Boolean(id)))]
      .map((id) => ({ id, name: named.get(id) ?? id })) };
  }
  try {
    // Read plan by plan, the page limit of a reading is each plan's; a grouped analysis reads all the pages in one job.
    sealed.assertReadPlans(resolved, { maxPages: await getPlanSetMaxPdfPages({ supabase: service, tenantId: input.tenantId, level: "C" }),
      perPlan: input.perPlan });
  } catch (error) {
    return planRefusal(error);
  }
  let snapshot: TakeoffPreparationSnapshot;
  try {
    snapshot = createTakeoffPreparationSnapshot({ preparation: resolved, confirmedBy: input.payerId, confirmedAt: new Date().toISOString(),
      revision: loaded.revision ?? 1, executionSelection: input.selection });
  } catch (error) {
    if (error instanceof TakeoffPreparationNotReadyError) return { state: "blocked", reason: "PREPARATION_NEEDS_REVIEW", pieces: [] };
    throw error;
  }
  const plans = snapshot.preparation.sources.filter((source) => source.kind === "plan" && source.active);
  if (plans.length === 0) return { state: "not_eligible", reason: "NO_EXPLOITABLE_PLAN", pieces: [] };
  const config = await getTakeoffLevelCProcessingConfigForTenant(input.tenantId, { supabase: service });
  let sourceFile: Sealed["sourceFile"];
  try {
    sourceFile = await resolvePlanSetSourceFile({ supabase: service, tenantId: input.tenantId, planSetId: input.planSet.id,
      jobId: input.jobId, maxPages: config.maxPdfPages, selectedFileIds: plans.map((source) => source.document_id),
      pagesPerPlan: input.perPlan });
  } catch (error) {
    if (error instanceof TakeoffError && error.code === TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE) {
      return { state: "blocked", reason: "PLAN_SET_TOO_LARGE", pieces: plans.map((source) => ({ id: source.document_id, name: source.document_name })) };
    }
    throw error;
  }
  const intake = intakeDocumentsByPlanFile(input.planSet.files, await recordedPlanPieces(service, input.tenantId, input.planSet.id,
    input.planSet.files.map((file) => file.id)));
  const omittedPlans: TakeoffLaunchManifest["coverage"]["plans_omitted"] = [
    ...input.planSet.files.filter((file) => selectedPlans && !Object.hasOwn(selectedPlans, file.id))
      .map((file) => ({ id: file.id, name: getPlanFileDisplayName(file), reason: "not_selected" as const })),
    ...planSetCopiesSetAside(snapshot.preparation.sources, input.planSet.id),
    ...input.unsupportedPlans.map((plan) => ({ ...plan, reason: "unsupported_format" as const })),
  ];
  // Lot 4: the list of items the request seals, behind the second order's activation (the free extraction before it).
  const order = await sealedMeasuringOrder(service, { tenantId: input.tenantId, projectId: input.projectId, payerId: input.payerId,
    perPlan: input.perPlan });
  if ("blocked" in order) return { state: "blocked", reason: order.blocked, pieces: [] };
  const manifest = buildTakeoffLaunchManifest({ intent: "initial", sources: snapshot.preparation.sources, intakeDocumentByPlanFile: intake,
    omittedPlans, omittedReferences: sealed.omittedReferences, preparationRevision: snapshot.preparation_revision,
    budget: { tokens: config.maxTotalTokens, cost_cents: config.maxCostCents }, order: order.order });
  return { snapshot, manifest, sourceFile, pageCounts: sealed.planPageCounts, items: order.items };
}

/**
 * The pages of each plan a command reads whose row stores no count, counted on its bytes as the worker opens it (the
 * member's confirmation counted them, but a snapshot keeps the stored count). A plan whose bytes cannot be read or opened
 * refuses the command by name, as the automatic sealing refuses it: weighed as one page, a whole PDF would take a share
 * of the envelope it cannot be read with.
 */
export async function countUnstoredPlanPages(service: Service, sources: TakeoffPreparationSnapshot["preparation"]["sources"]) {
  const counted = new Map<string, number>();
  for (const source of sources) {
    if (source.kind !== "plan" || !source.active || source.page_count != null) continue;
    const piece = { id: source.document_id, name: source.document_name };
    if (!source.file_path) throw new PreparationPlanSealError(piece, "unreadable");
    const { data, error } = await service.storage.from(PLAN_FILES_BUCKET).download(source.file_path);
    if (error || !data) throw new PreparationPlanSealError(piece, "unreadable");
    let pages: number;
    try {
      pages = (await openPreparedPlan(new Uint8Array(await data.arrayBuffer()), [])).pdf.getPageCount();
    } catch {
      throw new PreparationPlanSealError(piece, "invalid");
    }
    counted.set(source.document_id, pages);
  }
  return counted;
}

/** A command whose plans, each read by its own analysis, pass the page limit of a reading: named. */
export function planPagesPastLimit(plans: ReadonlyArray<{ document_id: string; document_name: string }>, maxPages: number) {
  const names = plans.map((plan) => `« ${plan.document_name} »`).join(", ");
  return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, retryable: false,
    message: plans.length === 1
      ? `Le plan ${names} dépasse les ${maxPages} pages qu’une analyse lit : retirez-le de la préparation ou réduisez-le, puis relancez.`
      : `Les plans ${names} dépassent chacun les ${maxPages} pages qu’une analyse lit : retirez-les de la préparation ou réduisez-les, puis relancez.`,
    details: { pieces: plans.map((plan) => ({ id: plan.document_id, name: plan.document_name })), max_pdf_pages: maxPages } });
}

/** The plan set's copies a preparation does not read: a revision the members set aside, or an identical copy of a plan it reads. */
export function planSetCopiesSetAside(sources: TakeoffPreparationSnapshot["preparation"]["sources"], planSetId: string):
  TakeoffLaunchManifest["coverage"]["plans_omitted"] {
  const read = sources.filter((source) => source.kind === "plan" && source.active);
  return sources.filter((source) => source.kind === "plan" && !source.active && !source.selected_in_plan_set && source.plan_set_id === planSetId)
    .map((source) => ({ id: source.document_id, name: source.document_name,
      reason: (source.alternate_of && read.some((plan) => plan.content_hash && plan.content_hash === source.content_hash)
        ? "identical_copy" : "alternate") as "alternate" | "identical_copy" }));
}

/** A plan's logical identity across its copies: its dossier piece, or the copy itself for a plan uploaded to the plan set. */
export function logicalPlanKey(plan: { id: string; intake_document_id: string | null }) {
  return plan.intake_document_id ? `piece:${plan.intake_document_id}` : `copy:${plan.id}`;
}

type PlanReadBefore = { id: string; name: string; intake_document_id: string | null; generation: string | null };

/**
 * The last successful reading of each plan the affaire's analyses read, whichever request read it: the plans whose unit
 * a request actually read (every plan of a grouped analysis whose one unit was read), and those a request set aside in
 * turn as read before it, each with the dossier piece and generation sealed with it. A plan is one logical plan across
 * its copies (its recorded dossier piece): its latest successful reading is kept, never an older copy beside it. A plan
 * whose latest reading did not succeed (its unit failed, was cancelled, or never started), or that a later analysis did
 * not read at all, keeps the reading of an earlier request; one never read is not among them. Every analysed request of
 * the affaire is read, with its units' jobs, in one statement (one more per thousand requests), and each unit's state is
 * derived from its job by the rule the database applies (deriveTakeoffRequestUnits, held to private.takeoff_unit_state
 * by unit-state-parity.test.ts). A command that does not name them leaves them to the analysis that read them.
 */
export async function readPlansAnalysedBefore(service: Service, tenantId: string, projectId: string): Promise<PlanReadBefore[]> {
  const requests = await readAdmittedPlanRequests(service, tenantId, projectId);
  const readings: PlanReadBefore[] = [];
  const keep = (plan: PlanReadBefore) => { readings.push(plan); };
  for (const { manifest, units } of requests) {
    const succeeded = (units?.units ?? []).filter((unit) => unit.state === "succeeded");
    const wasRead = (planFileId: string) => (units?.format === "per_plan"
      ? succeeded.some((unit) => unit.planFileId === planFileId.toLowerCase()) : succeeded.length > 0);
    for (const plan of manifest.plans) {
      if (wasRead(plan.plan_file_id)) {
        keep({ id: plan.plan_file_id, name: plan.name, intake_document_id: plan.intake_document_id ?? null, generation: plan.generation ?? null });
      }
    }
    for (const plan of manifest.coverage?.plans_omitted ?? []) {
      if (plan.reason !== "not_requested") continue;
      keep({ id: plan.id, name: plan.name, intake_document_id: plan.intake_document_id ?? null, generation: plan.generation ?? null });
    }
  }
  // Each copy's identity is the source the database recorded for it, as for a new manifest: an upload whose metadata
  // named a piece (and whose manifest, sealed before, says so) is its own plan. A copy gone before its source was
  // recorded keeps the identity its manifest sealed.
  const recorded = await recordedCopySources(service, tenantId, projectId, readings.map(({ id }) => id));
  const known = new Map<string, PlanReadBefore>();
  for (const reading of readings) {
    const source = recorded.get(reading.id.toLowerCase());
    const plan = source ? { ...reading, intake_document_id: source.kind === "intake_document" ? source.id : null } : reading;
    const key = logicalPlanKey(plan);
    if (!known.has(key)) known.set(key, plan);
  }
  return [...known.values()];
}

/** A request this Mac's claim returned, with what its evaluation needs: the mandate's selection and its payer's right. */
type ClaimedRequest = { request_id: string; tenant_id: string; project_id: string; origin: string; payer_id: string; mark: number;
  mandate_selection: unknown; payer_eligible: boolean };

async function recordEvaluation(service: Service, claim: ClaimedRequest, token: string, refusal: Refusal | null) {
  const { error } = await service.rpc("record_takeoff_launch_evaluation", {
    p_request_id: claim.request_id, p_token: token, p_mark: claim.mark,
    p_state: refusal?.state ?? "evaluating",
    ...(refusal ? { p_reason: refusal.reason, p_details: itemListReadingRefusalDetails(refusal) as unknown as Json } : {}),
  });
  if (error) databaseError(error, "Impossible d’enregistrer l’évaluation du métré.");
}

/** The outcome of one request's evaluation on this Mac. */
export type TakeoffLaunchEvaluation = { requestId: string; outcome: "admitted" | "replayed" | "stale" | "lost" | "not_eligible" | "blocked"; jobId: string | null; reason: TakeoffLaunchReason | null };

async function evaluateClaimedRequest(service: Service, claim: ClaimedRequest, token: string, hostId: string): Promise<TakeoffLaunchEvaluation> {
  const refuse = async (refusal: Refusal): Promise<TakeoffLaunchEvaluation> => {
    await recordEvaluation(service, claim, token, refusal);
    return { requestId: claim.request_id, outcome: refusal.state, jobId: null, reason: refusal.reason };
  };
  // The claim returned only requests of this Mac's mandates, of a tenant whose module is on (checked again at admission).
  const subscription = await readLocalChatGptSubscription({ userId: claim.payer_id, tenantId: claim.tenant_id });
  const comparison = compareTakeoffSelection(claim.mandate_selection, subscription.selection);
  const [brief, documents, planSet, reservation] = await Promise.all([
    service.from("affaire_briefs").select("status").eq("tenant_id", claim.tenant_id).eq("project_id", claim.project_id).maybeSingle(),
    readDossierDocuments(service, claim.tenant_id, claim.project_id),
    readDossierPlanSet(service, claim.tenant_id, claim.project_id),
    service.from("takeoff_launch_requests").select("selected_plans").eq("id", claim.request_id)
      .eq("tenant_id", claim.tenant_id).eq("project_id", claim.project_id).eq("evaluation_lease_token", token).maybeSingle(),
  ]);
  if (brief.error) databaseError(brief.error, "Impossible de lire le brief de l’affaire.");
  const mandate = subscription;
  if (reservation.error) databaseError(reservation.error, "Impossible de vérifier les plans demandés.");
  if (!reservation.data) return { requestId: claim.request_id, outcome: "lost", jobId: null, reason: null };
  const selectedPlans = reservation.data.selected_plans === null ? null : sealedBriefPlansSchema.parse(reservation.data.selected_plans);
  const files = (planSet?.files ?? []).filter((file) => !selectedPlans || Object.hasOwn(selectedPlans, file.id));
  if (selectedPlans && (!files.length || files.length !== Object.keys(selectedPlans).length)) {
    return refuse({ state: "blocked", reason: "PLAN_COPY_MISSING", pieces: [] });
  }
  const withoutCopy = selectedPlans ? [] : findIntakePlansWithoutWorkingCopy(documents as unknown as SyncDocument[], files);
  const decision = decideTakeoffLaunch({
    documents: documents.map((document) => ({ fileName: document.file_name, uploadStatus: document.upload_status,
      classificationStatus: document.classification_status, detectedCategory: document.document_kind, documentKind: document.document_kind,
      confidence: document.confidence ?? 0, issues: [...document.issues, ...(document.rejection_reason ? [document.rejection_reason] : [])] })),
    briefStatus: brief.data?.status ?? null,
    plansWithCopy: files.filter((file) => file.metadata.source === "affaire-intake").length,
    plansWithoutCopy: withoutCopy.map((document) => ({ id: document.id, name: document.file_name })),
    otherPlans: files.filter((file) => file.metadata.source !== "affaire-intake").length,
    payerEligible: claim.payer_eligible,
    // A withdrawn connection (a disconnection, a lost access, a reconnection) first, whatever the dossier's state.
    mandateIssue: comparison === "withdrawn" ? "CHATGPT_ACCESS_REVOKED" : mandate.issue
      ?? (comparison === "changed" ? "CHATGPT_SELECTION_CHANGED" : null),
  });
  if (decision.state !== "ready") return refuse(decision);
  // The cheap checks before any download: another request of the affaire runs.
  const { data: running, error: runningError } = await service.from("takeoff_launch_requests").select("id")
    .eq("tenant_id", claim.tenant_id).eq("project_id", claim.project_id).eq("state", "admitted").limit(1);
  if (runningError) databaseError(runningError, "Impossible de lire les métrés de l’affaire.");
  if ((running ?? []).length > 0) return refuse({ state: "blocked", reason: "ANOTHER_ANALYSIS_RUNNING", pieces: [] });
  assertTakeoffWorkerConfiguration();
  const jobId = deriveDeterministicJobId(claim.tenant_id, `takeoff-request:${claim.request_id}:${TAKEOFF_GROUPED_UNIT_KEY}`);
  // One read of the activation decides both the units and the measuring order they may seal.
  const perPlan = await isTakeoffPlanDispatchActive(service);
  if (selectedPlans && !perPlan) return refuse({ state: "blocked", reason: "TAKEOFF_DISABLED", pieces: [] });
  const sealed = await sealAutomaticSnapshot(service, { tenantId: claim.tenant_id, projectId: claim.project_id, planSet: planSet!,
    payerId: claim.payer_id, selection: mandate.selection!, jobId, documents, perPlan, selectedPlans,
    unsupportedPlans: selectedPlans ? [] : documents.filter((document) => document.document_kind === "plans" && document.upload_status === "uploaded"
      && document.classification_status === "classified" && document.mime_type?.toLowerCase() !== "application/pdf"
      && getAffaireIntakeFileExtension(document.file_name) !== "pdf")
      .map((document) => ({ id: document.id, name: document.file_name })) });
  if ("reason" in sealed) return refuse(sealed);
  // Once the owner activated one analysis per plan, the same seal is admitted as one unit per plan, each with its job.
  const split = perPlan ? splitTakeoffLaunchManifest(sealed.manifest, sealed.pageCounts) : null;
  // Lot 4: a reading against the list of items within its bounds only (never sampled), its budget sized from its calls.
  const chunking = () => getTakeoffLevelCProcessingConfigForTenant(claim.tenant_id, { supabase: service });
  const ofUnits = split ? await sealItemListReading(split, chunking, sealed.items) : null;
  const grouped = split ? null : await sealItemListReading(sealed.manifest, chunking, sealed.items);
  const tooLarge = ofUnits?.refusal ?? grouped?.refusal;
  if (tooLarge) return refuse(tooLarge);
  const units = ofUnits ? await planUnitJobs(service, { tenantId: claim.tenant_id, planSetId: planSet!.id,
    jobKey: `takeoff-request:${claim.request_id}`, manifest: ofUnits.manifest, hostId }) : null;
  const { data, error: admitError } = await service.rpc("admit_takeoff_launch_request", {
    p_request_id: claim.request_id, p_token: token, p_mark: claim.mark,
    p_manifest: (units?.manifest ?? grouped?.manifest ?? sealed.manifest) as unknown as Json, p_snapshot: sealed.snapshot as unknown as Json,
    p_job: units ? units.jobs as unknown as Json : launchJobPayload(jobId, planSet!.id, sealed.sourceFile, hostId),
    p_module_default: takeoffModuleDefault(),
  });
  if (admitError?.message === "TAKEOFF_BRIEF_PLAN_CHANGED") return refuse({ state: "blocked", reason: "PREPARATION_NEEDS_REVIEW", pieces: [] });
  if (admitError) launchError(admitError, "Impossible d’admettre le métré automatique.");
  const admitted = data?.[0];
  const outcome = (admitted?.outcome ?? "lost") as TakeoffLaunchEvaluation["outcome"];
  const reason = isTakeoffLaunchReason(admitted?.reason_code) ? admitted!.reason_code as TakeoffLaunchReason : null;
  if (outcome === "admitted" && admitted?.job_id) {
    await dispatchLaunchRequestJobs({ jobIds: units ? units.jobs.map((job) => job.id) : [admitted.job_id] });
  }
  return { requestId: claim.request_id, outcome, jobId: admitted?.job_id ?? null, reason };
}

/** One pass of this Mac's loop: the requests whose mandate it prepared and that wait for an evaluation. */
export async function evaluateTakeoffLaunchRequests(): Promise<TakeoffLaunchEvaluation[]> {
  if (!isLocalChatGptEnabled()) return [];
  const service = createServiceRoleClient();
  const hostId = await getChatGptHostId();
  const token = randomUUID();
  const { data, error } = await service.rpc("claim_takeoff_launch_evaluations", { p_host_id: hostId, p_token: token, p_limit: 5,
    p_module_default: takeoffModuleDefault() });
  if (error) databaseError(error, "Impossible de lire les métrés à démarrer.");
  const results: TakeoffLaunchEvaluation[] = [];
  for (const claim of (data ?? []) as ClaimedRequest[]) {
    try {
      results.push(await evaluateClaimedRequest(service, claim, token, hostId));
    } catch (cause) {
      // The lease is given back and the next pass evaluates it again; the third failure in a row blocks it, visibly.
      console.error("takeoff.launch_request.evaluation_failed", { requestId: claim.request_id,
        code: cause instanceof TakeoffError ? cause.code : (cause as { code?: string })?.code ?? null });
      const { error: failureError } = await service.rpc("record_takeoff_launch_evaluation_failure", { p_request_id: claim.request_id, p_token: token });
      if (failureError) console.error("takeoff.launch_request.failure_unrecorded", { requestId: claim.request_id });
    }
  }
  return results;
}

/**
 * A pass of this Mac's loop right after a gesture that may let a request start (a confirmation, a take-over), as a
 * launch hands its job to `after`: the gesture's own consequence, run once the response is sent. The periodic loop
 * (launch-request-consumer.ts) takes the requests no gesture woke. Two passes at once are kept apart by their leases.
 */
export function wakeTakeoffLaunchConsumer() {
  if (!isLocalChatGptEnabled()) return;
  const pass = () => evaluateTakeoffLaunchRequests().then(() => undefined, () => {
    console.error("takeoff.launch_request.pass_failed");
  });
  try {
    after(pass);
  } catch {
    // Outside a request (a script, a test): run it now.
    void pass();
  }
}

// An explicit command: a relaunch from the takeoff's options, on the subscription of the member who clicks.

/** The job a request admits: its unit's plan set and source, on the Mac of the mandate. */
function launchJobPayload(jobId: string, planSetId: string, sourceFile: Awaited<ReturnType<typeof resolvePlanSetSourceFile>>, hostId: string) {
  return { id: jobId, plan_set_id: planSetId, source_file_name: sourceFile.sourceFileName, source_file_type: sourceFile.sourceFileType,
    source_file_size_bytes: sourceFile.sourceFileSizeBytes, prompt_version: getTakeoffPromptVersion("C"), execution_host_id: hostId } as unknown as Json;
}

/**
 * The jobs of a request of plans, one per unit in the recorded order: an identifier derived from the request (or the
 * command) and the unit, never from a name, a page or a digest alone; the plan's own source. The dossier's limits were
 * checked on all its plans when the request was sealed; each plan is checked again here on its own.
 */
export async function planUnitJobs(service: Service, input: {
  tenantId: string; planSetId: string; jobKey: string; manifest: TakeoffPlanLaunchManifest; hostId: string;
}) {
  const config = await getTakeoffLevelCProcessingConfigForTenant(input.tenantId, { supabase: service });
  const jobs: Array<{ id: string; launch_unit_key: string } & Record<string, unknown>> = [];
  for (const unit of input.manifest.units) {
    const id = deriveDeterministicJobId(input.tenantId, `${input.jobKey}:${unit.key}`);
    const sourceFile = await resolvePlanSetSourceFile({ supabase: service, tenantId: input.tenantId, planSetId: input.planSetId,
      jobId: id, maxPages: config.maxPdfPages, selectedFileIds: unit.plans });
    jobs.push({ ...(launchJobPayload(id, input.planSetId, sourceFile, input.hostId) as Record<string, unknown>), id, launch_unit_key: unit.key });
  }
  return { manifest: input.manifest, jobs };
}

/**
 * The dossier piece and generation behind each working copy of a plan set: its recorded piece (`recordedPlanPieces`) and
 * the generation its metadata from the plan sync names.
 */
function intakeDocumentsByPlanFile(files: Array<{ id: string; metadata: unknown }>, pieces: ReadonlyMap<string, string>) {
  return new Map(files.flatMap((file) => {
    const piece = pieces.get(file.id.toLowerCase());
    const metadata = (file.metadata ?? {}) as Record<string, unknown>;
    return piece ? [[file.id, { intakeDocumentId: piece,
      generation: typeof metadata.intake_generation === "string" ? metadata.intake_generation : null }] as const] : [];
  }));
}

/**
 * The start of a request's jobs on this Mac, for both admissions: from a gesture (its address checked) or from the
 * Mac's own loop (no request): it runs after the response when there is one, at once otherwise, and the dispatch of each
 * job is recorded either way (the activity shows it). A request of plans hands its units to the Mac's dispatcher, which
 * reads them one at a time in their recorded order.
 */
export async function dispatchLaunchRequestJobs(input: { jobIds: string[]; host?: string | null }) {
  if (input.host !== undefined) assertLocalChatGptHost(input.host);
  const correlationId = randomUUID();
  const run = () => runLocalTakeoffAttempts({ jobId: input.jobIds[0], correlationId, trigger: "create" });
  try {
    after(run);
  } catch {
    void run();
  }
  for (const jobId of input.jobIds) {
    await persistTakeoffDispatchOutcome({ jobId, trigger: "create",
      result: { triggered: true, correlationId, statusCode: 202, outcome: "accepted" } });
  }
}

/**
 * `already_running` names the analysis that runs: a request's, or one launched outside any request before the activation
 * (no `requestId` then). `plans_to_choose` records nothing: a plan of the analysis it replaces has no working copy now,
 * and the member chooses which of its other plans to read (`choice`), by a command that names them.
 */
export type TakeoffRelaunchResult = {
  outcome: "admitted" | "replayed" | "already_running" | "plans_to_choose"; requestId: string | null; jobId: string | null;
  choice?: TakeoffRelaunchChoice;
};


/**
 * A manual request created, sealed and admitted in one commit from the member's confirmed preparation, naming the
 * analysis it replaces (none for the affaire's first analysis: its intent is then « initial »); its end goes to that
 * member. The intent key is answered first: a double click or a replay gets
 * what the command answered (its job, or the analysis that was running then), whatever changed since; the same key for
 * another command is a conflict. While another request of the affaire runs, the command is recorded as refused.
 * Once the owner activated one analysis per plan, the command reads only the plans it names (`planFileIds`), by default
 * the plan of the analysis it replaces, each as its own unit; a plan added to the dossier after the analysis is read by
 * a command that names it and the analysis it extends; the first analysis of an affaire, launched without naming any
 * plan, reads every plan its preparation retains. The receipt is read first, whatever the activation now: the database
 * answers it under either identity the command can have had, and decides the order of its refusals.
 */
export async function launchTakeoffRelaunch(input: {
  context: Context; projectId: string; planSetId: string; preparationRevision: number; intentKey: string;
  predecessorJobId: string | null; planFileIds?: string[] | null; host?: string | null;
}): Promise<TakeoffRelaunchResult> {
  const { context } = input;
  await assertPreparationProjectAccess(context, input.projectId, true);
  // The address of the gesture first: its job is started on this Mac right after the admission commits, and an address
  // that cannot use the subscription must not leave an admitted request with an undispatched job.
  if (input.host !== undefined) {
    try {
      assertLocalChatGptHost(input.host);
    } catch {
      throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
        message: describeTakeoffLaunchReason("HOST_NOT_AUTHORISED") });
    }
  }
  const service = createServiceRoleClient();
  const intent: TakeoffLaunchManifest["intent"] = input.predecessorJobId ? "reread_plans" : "initial";
  const command = { p_tenant_id: context.tenantId, p_project_id: input.projectId, p_actor: context.userId,
    p_intent_key: input.intentKey, p_intent: intent,
    // None for a first analysis (the database's arguments carry no nullability in their generated type).
    p_predecessor_job_id: (input.predecessorJobId ?? null) as string,
    p_plan_set_id: input.planSetId, p_preparation_revision: input.preparationRevision };
  // The command's receipt first, before any read of the plan set: a double click or a replay gets what it answered
  // whatever changed since, the activation included. A command naming its plans has one identity, scoped to them; one
  // naming none, M4's or the one scoped to the plans of the analysis it replaces (derived here, not named). It is looked
  // up under the copies that analysis read; when another identity holds the key, under each identity the same command
  // can have had since (the copies the dossier's replacements of those plans went through). Another selection of plans
  // under the same key is a conflict.
  const commandPlans = await relaunchCommandPlans(service, input);
  const replay = (planFileIds: string[] | null) => service.rpc("replay_manual_takeoff_plan_request",
    { ...command, p_plan_file_ids: planFileIds as string[], p_plans_named: Boolean(input.planFileIds?.length) });
  let { data: replayed, error: replayError } = await replay(commandPlans.ids);
  if (replayError?.message === "TAKEOFF_LAUNCH_INTENT_CONFLICT" && commandPlans.derived) {
    for (const identity of await relaunchIdentities(service, context.tenantId, input.planSetId, commandPlans.ids!)) {
      const answer = await replay(identity);
      if (answer.error?.message === "TAKEOFF_LAUNCH_INTENT_CONFLICT") continue;
      ({ data: replayed, error: replayError } = answer);
      break;
    }
  }
  if (replayError) launchError(replayError, "Impossible de relancer le métré.");
  const recorded = (replayed as Array<{ outcome: string; request_id: string; job_id: string | null }> | null)?.[0];
  if (recorded) {
    return { outcome: recorded.outcome as TakeoffRelaunchResult["outcome"], requestId: recorded.request_id, jobId: recorded.job_id };
  }
  if (await isTakeoffPlanDispatchActive(service)) {
    // No receipt: the plans of the analysis it replaces are read at their current copies.
    const current = commandPlans.derived
      ? await currentPlanCopies(service, context, input.projectId, input.planSetId, commandPlans.ids!) : null;
    return launchTakeoffPlanCommand(service, input, command, current?.scope ?? commandPlans.ids, current, commandPlans.names);
  }
  // Plans are named one by one only by one analysis per plan.
  if (input.planFileIds?.length) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
      message: "Une analyse groupée lit tous les plans de sa préparation : relancez-la sans choisir de plans." });
  }
  const { snapshot, owner, config } = await relaunchSeal(service, input);
  const jobId = deriveDeterministicJobId(context.tenantId,
    `takeoff-request-command:${input.projectId}:${input.intentKey}:${TAKEOFF_GROUPED_UNIT_KEY}`);
  const plans = snapshot.preparation.sources.filter((source) => source.active && source.kind === "plan");
  const sourceFile = await resolvePlanSetSourceFile({ supabase: context.supabase, tenantId: context.tenantId, planSetId: input.planSetId,
    jobId, maxPages: config.maxPdfPages, selectedFileIds: plans.map((source) => source.document_id) });
  // A grouped command (one analysis per plan not active): the free extraction.
  const order = await relaunchOrder(service, context, input.projectId, false);
  const relaunched = await relaunchManifest(service, context, input.planSetId, snapshot, config, intent,
    planSetCopiesSetAside(snapshot.preparation.sources, input.planSetId), order.order);
  const { manifest, refusal: tooLarge } = await sealItemListReading(relaunched.manifest, async () => config, order.items);
  if (tooLarge) throw itemListReadingTooLarge(tooLarge);
  const { data, error } = await service.rpc("launch_manual_takeoff_request", {
    ...command, p_host: owner.execution_host_id, p_selection: snapshot.execution_selection as unknown as Json,
    p_manifest: manifest as unknown as Json, p_snapshot: snapshot as unknown as Json,
    p_job: launchJobPayload(jobId, input.planSetId, sourceFile, owner.execution_host_id),
    p_module_default: takeoffModuleDefault(),
  });
  if (error?.message === "TAKEOFF_LAUNCH_PLAN_COPY_STALE") {
    await checkCurrentCommandCopies(service, input, plans.map((plan) => plan.document_id), snapshot);
  }
  if (error) launchError(error, "Impossible de relancer le métré.");
  const row = data?.[0];
  if (!row) throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, message: "Impossible de relancer le métré." });
  if (row.outcome === "admitted" && row.job_id) await dispatchLaunchRequestJobs({ jobIds: [row.job_id], host: input.host ?? null });
  return { outcome: row.outcome as TakeoffRelaunchResult["outcome"], requestId: row.request_id, jobId: row.job_id };
}

type RelaunchInput = Parameters<typeof launchTakeoffRelaunch>[0];

/** The member's confirmed preparation of the plan set and their own subscription, as pinned at that confirmation. */
async function relaunchSeal(service: Service, input: RelaunchInput) {
  const { context } = input;
  const snapshot = await assertConfirmedTakeoffPreparation({ context, estimateVersionId: null, projectId: input.projectId,
    preparationRevision: input.preparationRevision, planSetId: input.planSetId, level: "C", provider: "chatgpt" });
  // The member's own subscription, as pinned at the confirmation of the preparation (its connection included), and the
  // same on this Mac now.
  const owner = await getConfirmedTakeoffExecutionOwner(context.supabase, context, snapshot);
  if (!snapshot.execution_selection?.authorizationId) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Confirmez à nouveau la préparation pour utiliser votre forfait ChatGPT." });
  }
  const config = await getTakeoffLevelCProcessingConfigForTenant(context.tenantId, { supabase: service });
  return { snapshot, owner, config };
}

/**
 * The manifest of a member's command, with the plans it does not read (`omittedPlans`): the plan set's copies set aside,
 * and for a command of one analysis per plan, the plans an earlier analysis read that it does not name.
 */
/**
 * The measuring order a member's command seals (lot 4): the list of items behind the second order's activation, the free
 * extraction before it; a list still to prepare refuses the command.
 */
async function relaunchOrder(service: Service, context: Context, projectId: string, perPlan: boolean) {
  const order = await sealedMeasuringOrder(service, { tenantId: context.tenantId, projectId, payerId: context.userId, perPlan });
  if ("blocked" in order) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "La liste des postes est à préparer : importez ou choisissez la DPGF de l’affaire, puis relancez." });
  }
  return order;
}

export async function relaunchManifest(service: Service, context: Context, planSetId: string, snapshot: TakeoffPreparationSnapshot,
  config: { maxTotalTokens: number; maxCostCents: number }, intent: TakeoffLaunchManifest["intent"],
  omittedPlans: TakeoffLaunchManifest["coverage"]["plans_omitted"], order: TakeoffLaunchOrder) {
  const files = await readAllRows(() => context.supabase.from("plan_files").select("id, metadata", { count: "exact" })
    .eq("tenant_id", context.tenantId).eq("plan_set_id", planSetId).order("id"));
  if (files.error) databaseError(files.error, "Impossible de lire les plans de l’affaire.");
  const pieces = await recordedPlanPieces(service, context.tenantId, planSetId, (files.data ?? []).map((file) => file.id));
  const fileIds = new Set((files.data ?? []).map((file) => file.id.toLowerCase()));
  const heldPieces = new Set(pieces.values());
  return {
    manifest: buildTakeoffLaunchManifest({ intent, sources: snapshot.preparation.sources,
      intakeDocumentByPlanFile: intakeDocumentsByPlanFile(files.data ?? [], pieces),
      omittedPlans, omittedReferences: [], preparationRevision: snapshot.preparation_revision,
      budget: { tokens: config.maxTotalTokens, cost_cents: config.maxCostCents }, order }),
    /** Whether a plan is one of the plan set now: its copy, or a copy of its dossier piece. */
    held: (plan: { id: string; intake_document_id: string | null }) => fileIds.has(plan.id.toLowerCase())
      || Boolean(plan.intake_document_id && heldPieces.has(plan.intake_document_id.toLowerCase())),
  };
}

/**
 * The plans a command's identity names (`ids`): those it names, else the plans the analysis it replaces read (its unit's
 * plan, or every plan of a grouped analysis, inside a request or not), as that analysis read them (`derived`); none for
 * a first analysis that names no plan (it reads every plan of its preparation), or for an analysis that names no plan of
 * the affaire. Read from the analysis alone, before any read of the plan set: the command's receipt is looked up with
 * them. `names`: each plan of that analysis as it named it.
 */
async function relaunchCommandPlans(service: Service, input: RelaunchInput): Promise<{
  ids: string[] | null; derived: boolean; names: Map<string, string>;
}> {
  const names = new Map<string, string>();
  if (input.planFileIds?.length) return { ids: [...new Set(input.planFileIds.map((id) => id.toLowerCase()))].sort(), derived: false, names };
  if (!input.predecessorJobId) return { ids: null, derived: false, names };
  const { data: predecessor, error } = await service.from("takeoff_jobs").select("launch_unit_key, preparation_snapshot")
    .eq("tenant_id", input.context.tenantId).eq("project_id", input.projectId).eq("id", input.predecessorJobId!).maybeSingle();
  if (error) databaseError(error, "Impossible de lire l’analyse à relancer.");
  const sources = ((predecessor?.preparation_snapshot as { preparation?: { sources?: Array<{ document_id?: unknown;
    document_name?: unknown; kind?: unknown; active?: unknown }> } } | null)?.preparation?.sources ?? []);
  for (const source of sources) {
    if (typeof source.document_id === "string" && typeof source.document_name === "string") {
      names.set(source.document_id.toLowerCase(), source.document_name);
    }
  }
  const key = predecessor?.launch_unit_key;
  const read = key?.startsWith("plan:") ? [key.slice("plan:".length)]
    : sources.flatMap((source) => source.active === true && source.kind === "plan" && typeof source.document_id === "string"
      && !source.document_id.startsWith("upload:") ? [source.document_id] : []);
  if (!read.length) return { ids: null, derived: false, names };
  return { ids: [...new Set(read.map((id) => id.toLowerCase()))].sort(), derived: true, names };
}

/**
 * A command of one analysis per plan, after its receipt was looked up (none): the plans it names (`scope`), or every plan
 * its preparation retains for a first analysis that names none. A command names the analysis it replaces or extends (a
 * plan added to the dossier since included); without one it is the affaire's first analysis. The database decides its
 * refusals, in its own order (an automatic start that can still begin, then an affaire that has an analysis).
 */
async function launchTakeoffPlanCommand(service: Service, input: RelaunchInput,
  command: Record<string, unknown>, named: string[] | null, current: CurrentPlanCopies | null = null,
  names: ReadonlyMap<string, string> = new Map()): Promise<TakeoffRelaunchResult> {
  const { context } = input;
  if (input.predecessorJobId && !named) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
      message: "L’analyse à relancer n’appartient pas à cette affaire, ou ne nomme aucun plan : choisissez les plans à lire." });
  }
  const intent = command.p_intent as TakeoffLaunchManifest["intent"];
  // Only the plans named are read: the member's confirmed preparation of the plan set, the other plans set aside.
  const { snapshot: confirmed, owner, config } = await relaunchSeal(service, input);
  const scope = named ?? confirmed.preparation.sources.filter((source) => source.active && source.kind === "plan")
    .map((source) => source.document_id).sort();
  const active = new Set(confirmed.preparation.sources.filter((source) => source.active && source.kind === "plan").map((source) => source.document_id));
  const missing = scope.filter((id) => !active.has(id));
  // A plan of the analysis it replaces with no working copy now cannot be confirmed with it: that analysis is not
  // relaunched as it was. Another of its plans missing from the confirmed preparation is asked to be confirmed first (the
  // member is never offered fewer plans without being told why). Then the member is told which plan has no copy and why,
  // by name, and chooses which of its other plans to read (a command that names them: another scope, under its own
  // identity); never asked to confirm the options with a plan that has no copy.
  const withoutCopy = current?.withoutCopy ?? [];
  if (missing.length > 0) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
      message: "Ce plan ne fait pas partie de la préparation confirmée : confirmez les options du métré avec ce plan, puis relancez." });
  }
  if (withoutCopy.length > 0) {
    const visible = await readTakeoffVisibleSources({ supabase: context.supabase, tenantId: context.tenantId, projectId: input.projectId,
      ids: withoutCopy.flatMap(({ id, piece }) => [id, piece]) });
    const named = withoutCopy.map(({ id, piece, removed }, index) => ({
      name: isTakeoffSourceVisible(visible, id, piece) ? names.get(id) ?? `Plan ${index + 1}` : `Plan ${index + 1}`,
      reason: removed ? "removed" as const : "copy_missing" as const }));
    const remaining = scope;
    if (remaining.length === 0) {
      throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
        message: describeTakeoffRelaunchWithoutPlans(named) });
    }
    const confirmedName = new Map(confirmed.preparation.sources.map((source) => [source.document_id, source.document_name]));
    return { outcome: "plans_to_choose", requestId: null, jobId: null, choice: { withoutCopy: named,
      remaining: remaining.map((id) => ({ id, name: confirmedName.get(id) ?? names.get(id) ?? "Plan" })) } };
  }
  let snapshot: TakeoffPreparationSnapshot;
  try {
    snapshot = createTakeoffPreparationSnapshot({
      preparation: { ...confirmed.preparation, sources: confirmed.preparation.sources.map((source) =>
        source.kind === "plan" && source.active && !scope.includes(source.document_id) ? { ...source, active: false } : source) },
      confirmedBy: confirmed.confirmed_by, confirmedAt: confirmed.confirmed_at, revision: confirmed.preparation_revision,
      executionSelection: confirmed.execution_selection,
    });
  } catch (error) {
    if (error instanceof TakeoffPreparationNotReadyError) {
      throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
        message: "Ces plans ne peuvent pas être lus seuls avec la préparation confirmée : revoyez les options du métré." });
    }
    throw error;
  }
  // Read plan by plan, each plan within the page limit of a reading now, on its stored count or its pages counted on its
  // bytes (the count its sizing weighs): a plan past it is named.
  const countedPages = await countUnstoredPlanPages(service, snapshot.preparation.sources);
  const pastLimit = snapshot.preparation.sources.filter((source) => source.kind === "plan" && source.active
    && (source.page_count ?? countedPages.get(source.document_id) ?? 0) > config.maxPdfPages);
  if (pastLimit.length) throw planPagesPastLimit(pastLimit, config.maxPdfPages);
  // The dossier's limits on every plan the command reads, before its units (each is checked again on its own): read plan
  // by plan, the page limit is each plan's.
  const jobKey = `takeoff-request-command:${input.projectId}:${input.intentKey}`;
  await resolvePlanSetSourceFile({ supabase: service, tenantId: context.tenantId, planSetId: input.planSetId,
    jobId: deriveDeterministicJobId(context.tenantId, `${jobKey}:scope`), maxPages: config.maxPdfPages, selectedFileIds: scope,
    pagesPerPlan: true });
  // Not read by this command: the plan set's copies set aside, and the plans an earlier analysis read (they stay its),
  // except the plans it reads again, at any copy (a plan of the dossier replaced since is read at its new copy).
  // A plan read before is one of the plan set now (a plan whose copy and piece left it is not left out by this command,
  // and its removal is not told again); a revision the member set aside in the confirmed preparation stays set aside.
  const order = await relaunchOrder(service, context, input.projectId, true);
  const { manifest: grouped, held } = await relaunchManifest(service, context, input.planSetId, snapshot, config, intent,
    planSetCopiesSetAside(confirmed.preparation.sources, input.planSetId), order.order);
  const reading = new Set(grouped.plans.map((plan) => logicalPlanKey({ id: plan.plan_file_id, intake_document_id: plan.intake_document_id })));
  const omitted = new Map(grouped.coverage.plans_omitted.map((plan) => [plan.id, plan]));
  for (const plan of await readPlansAnalysedBefore(service, context.tenantId, input.projectId)) {
    if (scope.includes(plan.id) || reading.has(logicalPlanKey(plan)) || !held(plan) || omitted.has(plan.id)) continue;
    omitted.set(plan.id, { ...plan, reason: "not_requested" });
  }
  // Keep recognised plans outside a named selection visible. A relaunch's preparation marks the active
  // plans the member left unticked; earlier successful readings keep their own coverage above.
  if (named && (!input.predecessorJobId || input.planFileIds?.length)) {
    for (const source of confirmed.preparation.sources) {
      if (source.kind === "plan" && source.plan_set_id === input.planSetId && !scope.includes(source.document_id)
        && (!input.predecessorJobId || source.selected_in_plan_set === true)
        && !omitted.has(source.document_id)) {
        omitted.set(source.document_id, { id: source.document_id, name: source.document_name, reason: "not_selected" });
      }
    }
  }
  const { manifest: split, refusal: tooLarge } = await sealItemListReading(splitTakeoffLaunchManifest({ ...grouped,
    coverage: { ...grouped.coverage, plans_omitted: [...omitted.values()] } }, countedPages), async () => config, order.items);
  if (tooLarge) throw itemListReadingTooLarge(tooLarge);
  const units = await planUnitJobs(service, { tenantId: context.tenantId, planSetId: input.planSetId, jobKey,
    hostId: owner.execution_host_id, manifest: split });
  const admission = { ...command, p_host: owner.execution_host_id, p_selection: snapshot.execution_selection as unknown as Json,
    p_manifest: units.manifest as unknown as Json, p_snapshot: snapshot as unknown as Json, p_module_default: takeoffModuleDefault() };
  const checkCopies = () => checkCurrentCommandCopies(service, input, scope, confirmed);
  // A new named relaunch can only spend on the exact copies the member selected.
  // Replay was resolved first and an older unnamed command can still resolve its replacement copies.
  if (input.predecessorJobId && input.planFileIds?.length) {
    await checkCopies();
  }
  // A first analysis that names no plan keeps M4's identity (every plan of the preparation), its units as its jobs; a
  // command naming plans, its own.
  const { data, error } = named
    ? await service.rpc("launch_manual_takeoff_plan_request", { ...admission, p_plan_file_ids: named, p_jobs: units.jobs as unknown as Json } as never)
    : await service.rpc("launch_manual_takeoff_request", { ...admission, p_job: units.jobs as unknown as Json } as never);
  if (error?.message === "TAKEOFF_LAUNCH_PLAN_COPY_STALE") await checkCopies();
  if (error) launchError(error, "Impossible de relancer le métré.");
  const row = (data as Array<{ outcome: string; request_id: string; job_id: string | null }> | null)?.[0];
  if (!row) throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, message: "Impossible de relancer le métré." });
  if (row.outcome === "admitted" && row.job_id) {
    await dispatchLaunchRequestJobs({ jobIds: units.jobs.map((job) => job.id), host: input.host ?? null });
  }
  return { outcome: row.outcome as TakeoffRelaunchResult["outcome"], requestId: row.request_id, jobId: row.job_id };
}

/**
 * « Arrêter le reste du métré »: an operator who may launch on the affaire stops the plans of its running request not
 * read yet; the plans read stay, and the request ends on that (its requester is told when some plan was read).
 */
export async function stopTakeoffLaunchRequest(input: { context: Context; projectId: string; requestId: string }) {
  const { context } = input;
  await assertPreparationProjectAccess(context, input.projectId, true);
  const { data, error } = await createServiceRoleClient().rpc("stop_takeoff_launch_request", {
    p_tenant_id: context.tenantId, p_project_id: input.projectId, p_actor: context.userId, p_request_id: input.requestId,
  } as never);
  if (error) launchError(error, "Impossible d’arrêter le métré.");
  const row = (data as Array<{ outcome: string; request_state: string; canceled_units: number }> | null)?.[0];
  if (!row) throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, message: "Impossible d’arrêter le métré." });
  return { outcome: row.outcome as "stopped" | "not_running", state: row.request_state as TakeoffLaunchRequestState,
    canceledUnits: row.canceled_units };
}

// What the affaire shows: the state of its latest request, its reason and the gesture it allows, to its readers.

export type AffaireTakeoffLaunchView = {
  /** The owner set both cut-offs. */
  active: boolean;
  /**
   * A dossier confirmed with no request: confirmed before the activation (every confirmation since reserves its request in
   * its own transaction), so it is not armed: its last job, or the options of the takeoff.
   */
  confirmedWithoutRequest: boolean;
  request: null | {
    id: string; origin: "automatic" | "manual"; state: TakeoffLaunchRequestState;
    /** The revision of its mandate: a gesture names it, and is refused when it moved. */
    mandateRevision: number;
    reason: TakeoffLaunchReason | null; message: string | null; pieces: TakeoffLaunchPiece[];
    /** Lot 4: the bounds of a reading against the list of items, when they refused the request. */
    readingBounds: PosteReadingBoundsFacts | null;
    hasPayer: boolean; payerIsViewer: boolean;
    createdAt: string; admittedAt: string | null; closedAt: string | null;
    outcome: "success" | "failure" | "canceled" | "partial" | null;
    /** The job of its first unit: its grouped unit (lot 2), or its first plan (lot 3, readTakeoffLaunchRequestUnits lists them all). */
    jobId: string | null;
    /** Each unit in one state: read, failed, cancelled, or closed before its start (lot 3). */
    units: { expected: number | null; succeeded: number; failed: number; canceled: number; notStarted: number };
    action: TakeoffLaunchAction;
    actionLabel: string | null;
  };
  /** « Dossier modifié depuis l’analyse »: plans added, replaced or removed since the latest admitted request sealed its own. */
  dossierChangedSinceAnalysis: null | { added: TakeoffLaunchPiece[]; replaced: TakeoffLaunchPiece[]; removed: TakeoffLaunchPiece[] };
};

type RequestRow = {
  id: string; origin: string; state: string; reason_code: string | null; reason_details: unknown; payer_id: string | null;
  mandate_revision: number;
  created_at: string; updated_at: string; admitted_at: string | null; closed_at: string | null; outcome: string | null;
  units_expected: number | null; units_succeeded: number; units_failed: number; units_canceled: number; units_not_started: number;
};

/**
 * Reading never spends: it reads the requests the member may read and the plans of the dossier, nothing else. The
 * request shown is the affaire's latest execution, never hidden by an automatic start set aside for it.
 */
export async function readAffaireTakeoffLaunchState(context: Context, projectId: string): Promise<AffaireTakeoffLaunchView> {
  await assertPreparationProjectAccess(context, projectId);
  const service = createServiceRoleClient();
  const [active, requests, brief, viewers] = await Promise.all([
    isTakeoffLaunchActive(service),
    context.supabase.from("takeoff_launch_requests")
      .select("id, origin, state, reason_code, reason_details, payer_id, mandate_revision, created_at, updated_at, admitted_at, closed_at, outcome, units_expected, units_succeeded, units_failed, units_canceled, units_not_started")
      .eq("tenant_id", context.tenantId).eq("project_id", projectId)
      .or("reason_code.is.null,reason_code.neq.ANALYSIS_NOT_REQUESTED")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(5),
    context.supabase.from("affaire_briefs").select("status").eq("tenant_id", context.tenantId).eq("project_id", projectId).maybeSingle(),
    import("@/lib/takeoff/resume-viewer-server").then(({ readTakeoffResumeViewers }) => readTakeoffResumeViewers({
      supabase: context.supabase, tenantId: context.tenantId, member: context, projectIds: [projectId] })),
  ]);
  if (requests.error) databaseError(requests.error, "Impossible de lire le métré de l’affaire.");
  if (brief.error) databaseError(brief.error, "Impossible de lire le brief de l’affaire.");
  const rows = (requests.data ?? []) as RequestRow[];
  const latest = rows.find((row) => row.state !== "superseded") ?? rows[0] ?? null;
  if (!latest) {
    return { active, confirmedWithoutRequest: brief.data?.status === "confirme", request: null, dossierChangedSinceAnalysis: null };
  }

  const reason = isTakeoffLaunchReason(latest.reason_code) ? latest.reason_code : null;
  const details = (latest.reason_details ?? {}) as { pieces?: unknown; reading_bounds?: unknown };
  const readingBounds = readPosteReadingBoundsFacts(details.reading_bounds);
  const named = Array.isArray(details.pieces) ? details.pieces.flatMap((piece) => {
    const entry = piece as { id?: unknown; name?: unknown };
    return typeof entry?.id === "string" && typeof entry.name === "string" ? [{ id: entry.id, name: entry.name }] : [];
  }) : [];
  // A piece is named only to a member who may read it.
  const pieces = named.length ? maskTakeoffPieces(named, await readTakeoffVisibleSources({ supabase: context.supabase,
    tenantId: context.tenantId, projectId, ids: named.map((piece) => piece.id) })) : named;
  const [allowed, jobs, dossierChangedSinceAnalysis] = await Promise.all([
    service.rpc("takeoff_launch_request_action", { p_request_id: latest.id, p_actor: context.userId }),
    // Its first unit by its place in the recorded order (a unit's key is a plan copy's identifier, not the members' order).
    latest.admitted_at ? service.rpc("read_takeoff_launch_request_units", { p_tenant_id: context.tenantId, p_project_id: projectId,
      p_request_id: latest.id })
      : Promise.resolve({ data: null, error: null }),
    latest.admitted_at ? readDossierChangeSinceAnalysis(context, projectId, latest.id) : Promise.resolve(null),
  ]);
  if (allowed.error) databaseError(allowed.error, "Impossible de lire le métré de l’affaire.");
  if (jobs.error) databaseError(jobs.error, "Impossible de lire l’analyse du métré.");
  const action = viewerLaunchAction(allowed.data, Boolean(viewers(projectId).executionHostId), latest.state, latest.reason_code);

  return {
    active, confirmedWithoutRequest: false,
    request: {
      id: latest.id, origin: latest.origin === "manual" ? "manual" : "automatic", state: latest.state as TakeoffLaunchRequestState,
      mandateRevision: latest.mandate_revision,
      reason, pieces, readingBounds,
      message: reason ? describeTakeoffLaunchReason(reason, pieces, readingBounds)
        : latest.state === "superseded" ? describeTakeoffLaunchReason("SUPERSEDED") : null,
      hasPayer: latest.payer_id !== null, payerIsViewer: latest.payer_id === context.userId,
      createdAt: latest.created_at, admittedAt: latest.admitted_at, closedAt: latest.closed_at,
      outcome: latest.outcome as NonNullable<AffaireTakeoffLaunchView["request"]>["outcome"],
      jobId: ((jobs.data as { units?: Array<{ job_id?: string }> } | null)?.units?.[0]?.job_id) ?? null,
      units: { expected: latest.units_expected, succeeded: latest.units_succeeded, failed: latest.units_failed, canceled: latest.units_canceled,
        notStarted: latest.units_not_started },
      action, actionLabel: describeTakeoffLaunchAction(action),
    },
    dossierChangedSinceAnalysis,
  };
}

/**
 * The plans of the dossier against the plans the request sealed (read by the server after the access check): its plan
 * set's copies, and every plan classified in the dossier since that has no working copy (it is listed, never invisible).
 * Each is named only to the member who may read its source, by the plan files' and dossier pieces' own policies
 * evaluated for that member (`member`: their session); anyone else reads « Plan N ». The plan set compared is the one
 * the request sealed: a relaunch on another set than the dossier's is compared with that set alone.
 */
export async function readDossierChangeSinceAnalysis(member: Pick<Context, "supabase" | "tenantId">, projectId: string,
  requestId: string) {
  const service = createServiceRoleClient();
  const { tenantId } = member;
  const [{ data: request, error }, documents] = await Promise.all([
    service.from("takeoff_launch_requests").select("manifest, preparation_snapshot").eq("id", requestId).eq("tenant_id", tenantId).maybeSingle(),
    readDossierDocuments(service, tenantId, projectId),
  ]);
  if (error) databaseError(error, "Impossible de lire le métré de l’affaire.");
  const planSet = await readRequestPlanSet(service, tenantId, projectId, sealedPlanSetId(request?.preparation_snapshot));
  const change = describeDossierChangeSinceAnalysis(request?.manifest as AnyTakeoffLaunchManifest | null, planSet?.files ?? [],
    planSet?.dossier === false ? [] : documents);
  if (!change) return null;
  const visible = await readTakeoffVisibleSources({ supabase: member.supabase, tenantId, projectId,
    ids: [...change.added, ...change.replaced, ...change.removed].map((piece) => piece.id) });
  return maskTakeoffDossierChange(change, visible);
}

/** The dossier's plans and pieces against a request's sealed manifest: what was added, replaced or removed since. */
export function describeDossierChangeSinceAnalysis(manifest: AnyTakeoffLaunchManifest | null,
  current: Array<PlanFileRow & { file_name: string }>,
  documents: Array<{ id: string; file_name: string; plan_copy_generation?: string | null }>) {
  if (!manifest || !Array.isArray(manifest.plans)) return null;
  // The plans a command did not name are compared as the plans it read: the analysis that read them stays.
  const setAside = (manifest.coverage?.plans_omitted ?? []).filter((plan) => plan.reason === "not_requested")
    .map((plan) => ({ plan_file_id: plan.id, name: plan.name, intake_document_id: plan.intake_document_id ?? null,
      generation: plan.generation ?? null }));
  const known: Array<{ plan_file_id: string; name: string; intake_document_id: string | null; generation: string | null }> = [
    ...manifest.plans, ...setAside];
  const sealed = new Map(known.map((plan) => [plan.plan_file_id, plan]));
  const omitted = new Set((manifest.coverage?.plans_omitted ?? []).map((plan) => plan.id));
  const currentIds = new Set(current.map((file) => file.id));
  const nameOf = (file: { file_name: string; metadata: Record<string, unknown> }) => getPlanFileDisplayName(file);
  const sealedDocuments = new Set(known.flatMap((plan) => plan.intake_document_id ? [plan.intake_document_id] : []));
  const added = [
    ...current.filter((file) => !sealed.has(file.id) && !omitted.has(file.id)).map((file) => ({ id: file.id, name: nameOf(file) })),
    ...findIntakePlansWithoutWorkingCopy(documents as unknown as SyncDocument[], current)
      .filter((document) => !sealedDocuments.has(document.id) && !omitted.has(document.id))
      .map((document) => ({ id: document.id, name: document.file_name })),
  ];
  // A dossier piece sealed at one generation and now at another, whether or not its old copy is still in the set: the
  // sealed copy still there is compared with the piece by the dossier sync's own rule (a copy made before generations were
  // recorded included); a sealed copy gone, by the generation sealed with it.
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const currentById = new Map(current.map((file) => [file.id, file]));
  const replaced = known.flatMap((plan) => {
    const document = plan.intake_document_id ? documentsById.get(plan.intake_document_id) : undefined;
    if (!document) return [];
    const copy = currentById.get(plan.plan_file_id);
    const stale = copy ? !isSameIntakePlanGeneration(copy, document as unknown as SyncDocument)
      : plan.generation !== null && (document.plan_copy_generation ?? null) !== plan.generation;
    return stale ? [{ id: document.id, name: document.file_name }] : [];
  });
  const removed = known.filter((plan) => !currentIds.has(plan.plan_file_id)).map((plan) => ({ id: plan.plan_file_id, name: plan.name }));
  return added.length || replaced.length || removed.length ? { added, replaced, removed } : null;
}
