import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import { AFFAIRE_INTAKE_BUCKET, getAffaireIntakeFileExtension } from "@/lib/affaires/intake";
import { findIntakePlansWithoutWorkingCopy, isSameIntakePlanGeneration, type PlanFileRow, type SyncDocument } from "@/lib/affaires/intake-plan-sync";
import { DOCUMENT_SELECT, normalizeDocumentRow } from "@/lib/affaires/intake-rows";
import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import {
  compareTakeoffSelection, getConfirmedTakeoffExecutionOwner, readLocalChatGptSubscription, type LocalChatGptSubscription,
} from "@/lib/ai/chatgpt-takeoff";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
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
  buildTakeoffLaunchManifest, decideTakeoffLaunch, describeTakeoffLaunchReason, isTakeoffLaunchReason,
  TAKEOFF_AUTOMATIC_PAYER_NOTICE, TAKEOFF_GROUPED_UNIT_KEY,
  type TakeoffLaunchManifest, type TakeoffLaunchPiece, type TakeoffLaunchReason, type TakeoffLaunchRequestState,
} from "@/lib/takeoff/launch-request";
import { runLocalTakeoffAttempts } from "@/lib/takeoff/local-dispatch";
import {
  createTakeoffPreparationSnapshot, evaluateTakeoffPreparation, TakeoffPreparationNotReadyError,
  type TakeoffExecutionSelection, type TakeoffPreparation, type TakeoffPreparationSnapshot,
} from "@/lib/takeoff/preparation";
import { sealedMeasuringOrder } from "@/lib/takeoff/item-list-seal-server";
import { getDeducedPlanCandidates, resolveDeducedPlanVersions } from "@/lib/takeoff/preparation-from-dossier";
import { classifyPreparationReferenceFormat } from "@/lib/takeoff/preparation-reference-loader";
import { assertPreparationProjectAccess } from "@/lib/takeoff/preparation-repository";
import { assertConfirmedTakeoffPreparation, loadPreparation } from "@/lib/takeoff/preparation-server";
import { readPlanTitleBlock } from "@/lib/takeoff/plan-revision-identity";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import { TAKEOFF_PAGE_TRIAGE_TEXT } from "@/lib/takeoff/page-triage-server";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { selectProjectImportPlanSet } from "@/lib/takeoff/default-import-plan-set";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import type { Database, Json } from "@/types/database";

type Service = SupabaseClient<Database>;
type Context = AuthenticatedTenantContext;

const MAX_REFERENCES = 20;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

function databaseError(error: { code?: string; message: string }, message: string): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, message);
}

/**
 * The named refusals of the launch functions, in French, mapped once for every caller; any other error is the database's
 * (`fallback` is its message).
 */
function launchError(error: { code?: string; message: string }, fallback: string): never {
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
    case "TAKEOFF_LAUNCH_PREDECESSOR_REQUIRED":
    case "TAKEOFF_LAUNCH_PREDECESSOR_INVALID":
      throw refusal(422, TakeoffErrorCode.VALIDATION_ERROR, "L’analyse à relancer n’appartient pas à cette affaire.");
    case "TAKEOFF_JOB_ADMISSION_LIMIT":
      throw takeoffJobInsertError({ code: "23514", message: error.message }, "");
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
  context: Context; projectId: string; expectedUpdatedAt: string; notice: string | null; host: string | null;
}) {
  const { context } = input;
  const service = createServiceRoleClient();
  const [subscription, session] = await Promise.all([
    readPayerSubscription(service, context, input.projectId, input.host),
    // The member's verified session claims: the database evaluates the released brief policy under them (none refuses).
    context.supabase.auth.getClaims().then(({ data, error }) => (error ? null : data?.claims ?? null), () => null),
  ]);
  const { data, error } = await service.rpc("confirm_affaire_brief_takeoff", {
    p_tenant_id: context.tenantId, p_project_id: input.projectId, p_actor: context.userId,
    // No notice: the brief is confirmed and engages nobody.
    p_expected_updated_at: input.expectedUpdatedAt, p_notice: input.notice as string,
    p_module_default: takeoffModuleDefault(), ...selectionParameters(subscription),
    p_actor_claims: session as unknown as Json,
  });
  if (error?.code === "P0002") return { outcome: "not_found" as const, takeoff: null };
  if (error) launchError(error, "Impossible de confirmer le brief affaire.");
  const row = ((data ?? []) as Array<GestureRow & { outcome: string }>)[0];
  if (!row || row.outcome === "conflict") return { outcome: "conflict" as const, takeoff: null };
  if (row.state === "evaluating") wakeTakeoffLaunchConsumer();
  return { outcome: row.outcome as "confirmed" | "replayed",
    takeoff: await gestureResult(service, row, context.userId, subscription.issue !== "LOCAL_RUNTIME_REQUIRED") };
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
 * with on this Mac). None when the member may not pay, before both cut-offs or with the module off.
 */
export async function readAutomaticTakeoffPayerNotice(context: Context, project: { id: string }, host?: string | null) {
  const service = createServiceRoleClient();
  const subscription = await readPayerSubscription(service, context, project.id, host);
  if (subscription.issue === "MANDATE_REQUIRED") return null;
  const { data, error } = await service.rpc("takeoff_payer_notice", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_actor: context.userId,
    p_selection: (subscription.selection ?? null) as unknown as Json, p_module_default: takeoffModuleDefault(),
  });
  if (error || typeof data !== "string") return null;
  return { message: TAKEOFF_AUTOMATIC_PAYER_NOTICE, digest: data };
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
  const files = await readAllRows(() => service.from("plan_files").select("id, file_path, file_name, file_size_bytes, metadata", { count: "exact" })
    .eq("tenant_id", tenantId).eq("plan_set_id", chosen.id).order("id"));
  if (files.error) databaseError(files.error, "Impossible de lire les plans de l’affaire.");
  return { id: chosen.id, files: (files.data ?? []).map((file) => ({ ...file,
    metadata: (file.metadata && typeof file.metadata === "object" && !Array.isArray(file.metadata) ? file.metadata : {}) as Record<string, unknown> })) };
}

async function readDossierDocuments(service: Service, tenantId: string, projectId: string) {
  const rows = await readAllRows(() => service.from("affaire_intake_documents").select(DOCUMENT_SELECT as never, { count: "exact" })
    .eq("tenant_id", tenantId).eq("project_id", projectId).is("deleted_at", null).order("id" as never));
  if (rows.error) databaseError(rows.error, "Impossible de lire le dossier de l’affaire.");
  return ((rows.data ?? []) as unknown[]).map(normalizeDocumentRow).filter((row) => row !== null);
}

type Sealed = { snapshot: TakeoffPreparationSnapshot; manifest: TakeoffLaunchManifest; sourceFile: Awaited<ReturnType<typeof resolvePlanSetSourceFile>> };
type Refusal = { state: "not_eligible" | "blocked"; reason: TakeoffLaunchReason; pieces: TakeoffLaunchPiece[] };

/**
 * The automatic snapshot: the preparation deduced from the dossier for its plan set, with the options the members saved
 * (never written over their draft), the bytes of every retained piece read and digested now. A reference that cannot be
 * read or used is left out and named in the coverage; a plan whose bytes cannot be read stops the start and is named.
 */
async function sealAutomaticSnapshot(service: Service, input: {
  tenantId: string; projectId: string; planSet: DossierPlanSet; payerId: string; selection: TakeoffExecutionSelection; jobId: string;
  /** Plans of the dossier the analysis cannot read (not PDF): named in the coverage, never read. */
  unsupportedPlans: TakeoffLaunchPiece[];
}): Promise<Sealed | Refusal> {
  const loaded = await loadPreparation({ supabase: service, tenantId: input.tenantId }, input.projectId, input.planSet.id);
  const draft = structuredClone(loaded.draft) as TakeoffPreparation;
  // The automatic analysis reads the affaire without a version and sends nothing: analysis only, no reviewer.
  draft.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  // Every retained version of a plan is read again before the revision choices apply, as a confirmation does.
  for (const source of getDeducedPlanCandidates(draft.sources)) {
    source.active = true;
    source.pages = source.pages_before_deduplication ?? source.pages;
    delete source.pages_before_deduplication;
    delete source.alternate_of;
  }
  const omittedReferences: TakeoffLaunchManifest["coverage"]["references_omitted"] = [];
  const available = new Map(loaded.availableSources.map((source) => [source.document_id, source]));
  let references = 0;
  let referenceBytes = 0;
  for (const source of draft.sources.filter((entry) => entry.active)) {
    // A file uploaded for a former launch is not part of the dossier.
    if (source.document_id.startsWith("upload:")) {
      source.active = false;
      continue;
    }
    const current = available.get(source.document_id);
    // A piece that changed while the dossier was read: the next pass reads it again.
    if (current && (current.source_version !== source.source_version || current.kind !== source.kind)) {
      return { state: "blocked", reason: "SOURCE_UNREADABLE", pieces: [] };
    }
    if (!current?.file_path) {
      // No stored copy to read (a reference linked from Google Drive, a piece gone from the dossier).
      if (source.kind === "plan") return { state: "blocked", reason: "PLAN_COPY_MISSING", pieces: [{ id: source.document_id, name: source.document_name }] };
      source.active = false;
      omittedReferences.push({ id: source.document_id, name: source.document_name, reason: "unreadable" });
      continue;
    }
    if (source.kind !== "plan") {
      const unsupported = !classifyPreparationReferenceFormat({ file_name: source.document_name, mime_type: source.mime_type });
      if (unsupported || references >= MAX_REFERENCES) {
        source.active = false;
        omittedReferences.push({ id: source.document_id, name: source.document_name, reason: unsupported ? "unsupported_format" : "limit" });
        continue;
      }
    }
    const { data, error } = await service.storage.from(source.plan_set_id ? PLAN_FILES_BUCKET : AFFAIRE_INTAKE_BUCKET).download(current.file_path);
    if (error || !data) {
      if (source.kind === "plan") return { state: "blocked", reason: "PLAN_COPY_MISSING", pieces: [{ id: source.document_id, name: source.document_name }] };
      source.active = false;
      omittedReferences.push({ id: source.document_id, name: source.document_name, reason: "unreadable" });
      continue;
    }
    if (source.kind !== "plan") {
      if (referenceBytes + data.size > MAX_REFERENCE_BYTES) {
        source.active = false;
        omittedReferences.push({ id: source.document_id, name: source.document_name, reason: "limit" });
        continue;
      }
      referenceBytes += data.size;
      references += 1;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const previousHash = source.content_hash;
    source.content_hash = createHash("sha256").update(bytes).digest("hex");
    if (source.kind === "plan") {
      // The title block's index, as a confirmation reads it; a page that cannot be rendered leaves it unread.
      try {
        const document = await renderPdfPages(bytes, { ...TAKEOFF_PAGE_TRIAGE_TEXT, pages: [source.pages[0] ?? 1] });
        source.plan_identity = readPlanTitleBlock(document.pages[0]?.regionText ?? "");
      } catch {
        source.plan_identity = null;
      }
      const sameBytes = !previousHash || previousHash === source.content_hash;
      if (!sameBytes) delete source.revision_reading_settled;
      const reading = source.plan_identity?.revision ?? null;
      const settled = Boolean(reading && source.revision && source.revision_reading_settled === reading);
      source.revision = settled ? source.revision : current.revision ?? (sameBytes ? source.revision : null) ?? reading;
    }
  }
  const resolved = resolveDeducedPlanVersions(draft);
  const readiness = evaluateTakeoffPreparation(resolved);
  if (!readiness.can_launch) {
    const named = new Map(resolved.sources.map((source) => [source.document_id, source.document_name]));
    return { state: "blocked", reason: "PREPARATION_NEEDS_REVIEW", pieces: [...new Set(readiness.blockers
      .map((blocker) => blocker.source_document_id).filter((id): id is string => Boolean(id)))]
      .map((id) => ({ id, name: named.get(id) ?? id })) };
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
      jobId: input.jobId, maxPages: config.maxPdfPages, selectedFileIds: plans.map((source) => source.document_id) });
  } catch (error) {
    if (error instanceof TakeoffError && error.code === TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE) {
      return { state: "blocked", reason: "PLAN_SET_TOO_LARGE", pieces: [] };
    }
    throw error;
  }
  const intake = intakeDocumentsByPlanFile(input.planSet.files);
  const omittedPlans: TakeoffLaunchManifest["coverage"]["plans_omitted"] = [
    ...snapshot.preparation.sources.filter((source) => source.kind === "plan" && !source.active && source.plan_set_id === input.planSet.id)
      .map((source) => ({ id: source.document_id, name: source.document_name,
        reason: (source.alternate_of && plans.some((plan) => plan.content_hash && plan.content_hash === source.content_hash) ? "identical_copy" : "alternate") as "alternate" | "identical_copy" })),
    ...input.unsupportedPlans.map((plan) => ({ ...plan, reason: "unsupported_format" as const })),
  ];
  // Lot 4: the list of items the request seals, behind the second order's activation (the free extraction before it).
  const order = await sealedMeasuringOrder(service, { tenantId: input.tenantId, projectId: input.projectId, payerId: input.payerId });
  if ("blocked" in order) return { state: "blocked", reason: order.blocked, pieces: [] };
  const manifest = buildTakeoffLaunchManifest({ intent: "initial", sources: snapshot.preparation.sources, intakeDocumentByPlanFile: intake,
    omittedPlans, omittedReferences, preparationRevision: snapshot.preparation_revision,
    budget: { tokens: config.maxTotalTokens, cost_cents: config.maxCostCents }, order: order.order });
  return { snapshot, manifest, sourceFile };
}

/** A request this Mac's claim returned, with what its evaluation needs: the mandate's selection and its payer's right. */
type ClaimedRequest = { request_id: string; tenant_id: string; project_id: string; origin: string; payer_id: string; mark: number;
  mandate_selection: unknown; payer_eligible: boolean };

async function recordEvaluation(service: Service, claim: ClaimedRequest, token: string, refusal: Refusal | null) {
  const { error } = await service.rpc("record_takeoff_launch_evaluation", {
    p_request_id: claim.request_id, p_token: token, p_mark: claim.mark,
    p_state: refusal?.state ?? "evaluating", ...(refusal ? { p_reason: refusal.reason, p_details: { pieces: refusal.pieces } as unknown as Json } : {}),
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
  const [brief, documents, planSet] = await Promise.all([
    service.from("affaire_briefs").select("status").eq("tenant_id", claim.tenant_id).eq("project_id", claim.project_id).maybeSingle(),
    readDossierDocuments(service, claim.tenant_id, claim.project_id),
    readDossierPlanSet(service, claim.tenant_id, claim.project_id),
  ]);
  if (brief.error) databaseError(brief.error, "Impossible de lire le brief de l’affaire.");
  const mandate = subscription;
  const files = planSet?.files ?? [];
  const withoutCopy = findIntakePlansWithoutWorkingCopy(documents as unknown as SyncDocument[], files);
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
  const sealed = await sealAutomaticSnapshot(service, { tenantId: claim.tenant_id, projectId: claim.project_id, planSet: planSet!,
    payerId: claim.payer_id, selection: mandate.selection!, jobId,
    unsupportedPlans: documents.filter((document) => document.document_kind === "plans" && document.upload_status === "uploaded"
      && document.classification_status === "classified" && document.mime_type?.toLowerCase() !== "application/pdf"
      && getAffaireIntakeFileExtension(document.file_name) !== "pdf")
      .map((document) => ({ id: document.id, name: document.file_name })) });
  if ("reason" in sealed) return refuse(sealed);
  const { data, error: admitError } = await service.rpc("admit_takeoff_launch_request", {
    p_request_id: claim.request_id, p_token: token, p_mark: claim.mark,
    p_manifest: sealed.manifest as unknown as Json, p_snapshot: sealed.snapshot as unknown as Json,
    p_job: launchJobPayload(jobId, planSet!.id, sealed.sourceFile, hostId), p_module_default: takeoffModuleDefault(),
  });
  if (admitError) launchError(admitError, "Impossible d’admettre le métré automatique.");
  const admitted = data?.[0];
  const outcome = (admitted?.outcome ?? "lost") as TakeoffLaunchEvaluation["outcome"];
  const reason = isTakeoffLaunchReason(admitted?.reason_code) ? admitted!.reason_code as TakeoffLaunchReason : null;
  if (outcome === "admitted" && admitted?.job_id) await dispatchLaunchRequestJob({ jobId: admitted.job_id });
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

/** The dossier piece and generation behind each working copy of a plan set (its metadata from the plan sync). */
function intakeDocumentsByPlanFile(files: Array<{ id: string; metadata: unknown }>) {
  return new Map(files.flatMap((file) => {
    const metadata = (file.metadata ?? {}) as Record<string, unknown>;
    return typeof metadata.intake_document_id === "string" ? [[file.id, { intakeDocumentId: metadata.intake_document_id,
      generation: typeof metadata.intake_generation === "string" ? metadata.intake_generation : null }] as const] : [];
  }));
}

/**
 * The start of a request's job on this Mac, for both admissions: from a gesture (its address checked) or from the
 * Mac's own loop (no request): it runs after the response when there is one, at once otherwise, and its dispatch is
 * recorded either way (the activity shows it).
 */
async function dispatchLaunchRequestJob(input: { jobId: string; host?: string | null }) {
  if (input.host !== undefined) assertLocalChatGptHost(input.host);
  const correlationId = randomUUID();
  const run = () => runLocalTakeoffAttempts({ jobId: input.jobId, correlationId, trigger: "create" });
  try {
    after(run);
  } catch {
    void run();
  }
  await persistTakeoffDispatchOutcome({ jobId: input.jobId, trigger: "create",
    result: { triggered: true, correlationId, statusCode: 202, outcome: "accepted" } });
}

export type TakeoffRelaunchResult = { outcome: "admitted" | "replayed" | "already_running"; requestId: string; jobId: string | null };

/**
 * A manual request created, sealed and admitted in one commit from the member's confirmed preparation, naming the
 * analysis it replaces; its end goes to that member. The intent key is answered first: a double click or a replay gets
 * what the command answered (its job, or the analysis that was running then), whatever changed since; the same key for
 * another command is a conflict. While another request of the affaire runs, the command is recorded as refused.
 */
export async function launchTakeoffRelaunch(input: {
  context: Context; projectId: string; planSetId: string; preparationRevision: number; intentKey: string;
  predecessorJobId: string; host?: string | null;
}): Promise<TakeoffRelaunchResult> {
  const { context } = input;
  await assertPreparationProjectAccess(context, input.projectId, true);
  const service = createServiceRoleClient();
  // The command's identity, answered first: a double click or a replay gets its receipt whatever changed since.
  const command = { p_tenant_id: context.tenantId, p_project_id: input.projectId, p_actor: context.userId,
    p_intent_key: input.intentKey, p_intent: "reread_plans", p_predecessor_job_id: input.predecessorJobId,
    p_plan_set_id: input.planSetId, p_preparation_revision: input.preparationRevision };
  const { data: replayed, error: replayError } = await service.rpc("replay_manual_takeoff_request", command);
  if (replayError) launchError(replayError, "Impossible de relancer le métré.");
  const recorded = replayed?.[0];
  if (recorded) {
    return { outcome: recorded.outcome as TakeoffRelaunchResult["outcome"], requestId: recorded.request_id, jobId: recorded.job_id };
  }
  const snapshot = await assertConfirmedTakeoffPreparation({ context, estimateVersionId: null, projectId: input.projectId,
    preparationRevision: input.preparationRevision, planSetId: input.planSetId, level: "C", provider: "chatgpt" });
  // The member's own subscription, as pinned at the confirmation of the preparation (its connection included), and the
  // same on this Mac now.
  const owner = await getConfirmedTakeoffExecutionOwner(context.supabase, context, snapshot);
  const selection = snapshot.execution_selection;
  if (!selection?.authorizationId) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Confirmez à nouveau la préparation pour utiliser votre forfait ChatGPT." });
  }
  const jobId = deriveDeterministicJobId(context.tenantId,
    `takeoff-request-command:${input.projectId}:${input.intentKey}:${TAKEOFF_GROUPED_UNIT_KEY}`);
  const config = await getTakeoffLevelCProcessingConfigForTenant(context.tenantId, { supabase: service });
  const plans = snapshot.preparation.sources.filter((source) => source.active && source.kind === "plan");
  const sourceFile = await resolvePlanSetSourceFile({ supabase: context.supabase, tenantId: context.tenantId, planSetId: input.planSetId,
    jobId, maxPages: config.maxPdfPages, selectedFileIds: plans.map((source) => source.document_id) });
  const files = await readAllRows(() => context.supabase.from("plan_files").select("id, metadata", { count: "exact" })
    .eq("tenant_id", context.tenantId).eq("plan_set_id", input.planSetId).order("id"));
  if (files.error) databaseError(files.error, "Impossible de lire les plans de l’affaire.");
  // Lot 4: the list of items the command seals, behind the second order's activation (the free extraction before it).
  const order = await sealedMeasuringOrder(service, { tenantId: context.tenantId, projectId: input.projectId,
    payerId: context.userId });
  if ("blocked" in order) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "La liste des postes est à préparer : importez ou choisissez la DPGF de l’affaire, puis relancez." });
  }
  const manifest = buildTakeoffLaunchManifest({ intent: "reread_plans", sources: snapshot.preparation.sources,
    intakeDocumentByPlanFile: intakeDocumentsByPlanFile(files.data ?? []),
    omittedPlans: [], omittedReferences: [], preparationRevision: snapshot.preparation_revision,
    budget: { tokens: config.maxTotalTokens, cost_cents: config.maxCostCents }, order: order.order });
  const { data, error } = await service.rpc("launch_manual_takeoff_request", {
    ...command, p_host: owner.execution_host_id, p_selection: selection as unknown as Json,
    p_manifest: manifest as unknown as Json, p_snapshot: snapshot as unknown as Json,
    p_job: launchJobPayload(jobId, input.planSetId, sourceFile, owner.execution_host_id),
    p_module_default: takeoffModuleDefault(),
  });
  if (error) launchError(error, "Impossible de relancer le métré.");
  const row = data?.[0];
  if (!row) throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, message: "Impossible de relancer le métré." });
  if (row.outcome === "admitted" && row.job_id) await dispatchLaunchRequestJob({ jobId: row.job_id, host: input.host ?? null });
  return { outcome: row.outcome as TakeoffRelaunchResult["outcome"], requestId: row.request_id, jobId: row.job_id };
}

// What the affaire shows: the state of its latest request, its reason and the gesture it allows, to its readers.

export type AffaireTakeoffLaunchView = {
  /** The owner set both cut-offs. */
  active: boolean;
  /**
   * A dossier confirmed with no request: confirmed before the activation (every confirmation since reserves its request in
   * its own transaction), so it is not armed: its last job, or the options of the takeoff.
   */
  confirmedBeforeActivation: boolean;
  request: null | {
    id: string; origin: "automatic" | "manual"; state: TakeoffLaunchRequestState;
    /** The revision of its mandate: a gesture names it, and is refused when it moved. */
    mandateRevision: number;
    reason: TakeoffLaunchReason | null; message: string | null; pieces: TakeoffLaunchPiece[];
    hasPayer: boolean; payerIsViewer: boolean;
    createdAt: string; admittedAt: string | null; closedAt: string | null;
    outcome: "success" | "failure" | "canceled" | "partial" | null;
    /** The job of its grouped unit (lot 2); lot 3 lists one job per plan. */
    jobId: string | null;
    units: { expected: number | null; succeeded: number; failed: number; canceled: number };
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
  units_expected: number | null; units_succeeded: number; units_failed: number; units_canceled: number;
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
      .select("id, origin, state, reason_code, reason_details, payer_id, mandate_revision, created_at, updated_at, admitted_at, closed_at, outcome, units_expected, units_succeeded, units_failed, units_canceled")
      .eq("tenant_id", context.tenantId).eq("project_id", projectId)
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
    return { active, confirmedBeforeActivation: active && brief.data?.status === "confirme", request: null, dossierChangedSinceAnalysis: null };
  }

  const reason = isTakeoffLaunchReason(latest.reason_code) ? latest.reason_code : null;
  const details = (latest.reason_details ?? {}) as { pieces?: unknown };
  const pieces = Array.isArray(details.pieces) ? details.pieces.flatMap((piece) => {
    const entry = piece as { id?: unknown; name?: unknown };
    return typeof entry?.id === "string" && typeof entry.name === "string" ? [{ id: entry.id, name: entry.name }] : [];
  }) : [];
  const [allowed, jobs, dossierChangedSinceAnalysis] = await Promise.all([
    service.rpc("takeoff_launch_request_action", { p_request_id: latest.id, p_actor: context.userId }),
    latest.admitted_at ? context.supabase.from("takeoff_jobs").select("id")
      .eq("tenant_id", context.tenantId).eq("launch_request_id", latest.id).order("launch_unit_key").limit(1)
      : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
    latest.admitted_at ? readDossierChangeSinceAnalysis(service, context.tenantId, projectId, latest.id) : Promise.resolve(null),
  ]);
  if (allowed.error) databaseError(allowed.error, "Impossible de lire le métré de l’affaire.");
  if (jobs.error) databaseError(jobs.error, "Impossible de lire l’analyse du métré.");
  const action = viewerLaunchAction(allowed.data, Boolean(viewers(projectId).executionHostId), latest.state, latest.reason_code);

  return {
    active, confirmedBeforeActivation: false,
    request: {
      id: latest.id, origin: latest.origin === "manual" ? "manual" : "automatic", state: latest.state as TakeoffLaunchRequestState,
      mandateRevision: latest.mandate_revision,
      reason, pieces,
      message: reason ? describeTakeoffLaunchReason(reason, pieces)
        : latest.state === "superseded" ? describeTakeoffLaunchReason("SUPERSEDED") : null,
      hasPayer: latest.payer_id !== null, payerIsViewer: latest.payer_id === context.userId,
      createdAt: latest.created_at, admittedAt: latest.admitted_at, closedAt: latest.closed_at,
      outcome: latest.outcome as NonNullable<AffaireTakeoffLaunchView["request"]>["outcome"],
      jobId: jobs.data?.[0]?.id ?? null,
      units: { expected: latest.units_expected, succeeded: latest.units_succeeded, failed: latest.units_failed, canceled: latest.units_canceled },
      action, actionLabel: describeTakeoffLaunchAction(action),
    },
    dossierChangedSinceAnalysis,
  };
}

/**
 * The plans of the dossier against the plans the request sealed (read by the server after the access check): its plan
 * set's copies, and every plan classified in the dossier since that has no working copy (it is named, never invisible).
 */
async function readDossierChangeSinceAnalysis(service: Service, tenantId: string, projectId: string, requestId: string) {
  const [{ data: request, error }, planSet, documents] = await Promise.all([
    service.from("takeoff_launch_requests").select("manifest").eq("id", requestId).eq("tenant_id", tenantId).maybeSingle(),
    readDossierPlanSet(service, tenantId, projectId),
    readDossierDocuments(service, tenantId, projectId),
  ]);
  if (error) databaseError(error, "Impossible de lire le métré de l’affaire.");
  return describeDossierChangeSinceAnalysis(request?.manifest as TakeoffLaunchManifest | null, planSet?.files ?? [], documents);
}

/** The dossier's plans and pieces against a request's sealed manifest: what was added, replaced or removed since. */
export function describeDossierChangeSinceAnalysis(manifest: TakeoffLaunchManifest | null,
  current: Array<PlanFileRow & { file_name: string }>,
  documents: Array<{ id: string; file_name: string; plan_copy_generation?: string | null }>) {
  if (!manifest || !Array.isArray(manifest.plans)) return null;
  const sealed = new Map(manifest.plans.map((plan) => [plan.plan_file_id, plan]));
  const omitted = new Set((manifest.coverage?.plans_omitted ?? []).map((plan) => plan.id));
  const currentIds = new Set(current.map((file) => file.id));
  const nameOf = (file: { file_name: string; metadata: Record<string, unknown> }) => getPlanFileDisplayName(file);
  const sealedDocuments = new Set(manifest.plans.flatMap((plan) => plan.intake_document_id ? [plan.intake_document_id] : []));
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
  const replaced = manifest.plans.flatMap((plan) => {
    const document = plan.intake_document_id ? documentsById.get(plan.intake_document_id) : undefined;
    if (!document) return [];
    const copy = currentById.get(plan.plan_file_id);
    const stale = copy ? !isSameIntakePlanGeneration(copy, document as unknown as SyncDocument)
      : plan.generation !== null && (document.plan_copy_generation ?? null) !== plan.generation;
    return stale ? [{ id: document.id, name: document.file_name }] : [];
  });
  const removed = manifest.plans.filter((plan) => !currentIds.has(plan.plan_file_id)).map((plan) => ({ id: plan.plan_file_id, name: plan.name }));
  return added.length || replaced.length || removed.length ? { added, replaced, removed } : null;
}

/** The notice of who pays for the affaire's page: nothing for a reader, nothing before the activation, never an error. */
export async function readAffaireAutomaticTakeoffPayerNotice(projectId: string) {
  try {
    const { requireAffaireAccess } = await import("@/lib/affaires/access-server");
    const [{ context, project }, { headers }] = await Promise.all([requireAffaireAccess(projectId, "read"), import("next/headers")]);
    return await readAutomaticTakeoffPayerNotice(context, project, (await headers()).get("host"));
  } catch {
    return null;
  }
}
