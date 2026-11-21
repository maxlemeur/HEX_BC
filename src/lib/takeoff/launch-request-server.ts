import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import { AFFAIRE_INTAKE_BUCKET } from "@/lib/affaires/intake";
import { findIntakePlansWithoutWorkingCopy, isEligiblePlanDocument, type PlanFileRow, type SyncDocument } from "@/lib/affaires/intake-plan-sync";
import { DOCUMENT_SELECT, normalizeDocumentRow } from "@/lib/affaires/intake-rows";
import { assertLocalChatGptHost, hasLocalChatGptPlanAccess, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getChatGptHostId, readChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { getConfirmedTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertTakeoffWorkerConfiguration } from "@/lib/takeoff/default-on-flags";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { getTakeoffLevelCProcessingConfigForTenant, isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { deriveDeterministicJobId } from "@/lib/takeoff/job-creation-input";
import { resolvePlanSetSourceFile } from "@/lib/takeoff/job-creation-repository";
import {
  buildTakeoffLaunchManifest, decideTakeoffLaunch, describeTakeoffLaunchReason, isTakeoffLaunchReason,
  TAKEOFF_AUTOMATIC_PAYER_NOTICE, TAKEOFF_GROUPED_UNIT_KEY,
  type TakeoffLaunchManifest, type TakeoffLaunchPiece, type TakeoffLaunchReason, type TakeoffLaunchRequestState,
  type TakeoffMandateIssue,
} from "@/lib/takeoff/launch-request";
import { runLocalTakeoffAttempts } from "@/lib/takeoff/local-dispatch";
import {
  createTakeoffPreparationSnapshot, evaluateTakeoffPreparation, TakeoffPreparationNotReadyError,
  type TakeoffExecutionSelection, type TakeoffPreparation, type TakeoffPreparationSnapshot,
} from "@/lib/takeoff/preparation";
import { getDeducedPlanCandidates, resolveDeducedPlanVersions } from "@/lib/takeoff/preparation-from-dossier";
import { classifyPreparationReferenceFormat } from "@/lib/takeoff/preparation-reference-loader";
import { assertPreparationProjectAccess } from "@/lib/takeoff/preparation-repository";
import { assertConfirmedTakeoffPreparation, loadPreparation } from "@/lib/takeoff/preparation-server";
import { readPlanTitleBlock } from "@/lib/takeoff/plan-revision-identity";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import { TAKEOFF_PAGE_TRIAGE_TEXT } from "@/lib/takeoff/page-triage-server";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { selectProjectImportPlanSet } from "@/lib/takeoff/default-import-plan-set";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import type { Database, Json } from "@/types/database";

type Service = SupabaseClient<Database>;
type Context = AuthenticatedTenantContext;

const MAX_REFERENCES = 20;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

function databaseError(error: { code?: string; message: string }, message: string): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, message);
}

/** The two cut-offs. Before the automatic start's, nothing of this module writes; an admission needs the notices' too. */
export async function readTakeoffLaunchActivation(service: Service = createServiceRoleClient()) {
  const { data, error } = await service.rpc("takeoff_launch_activation_state");
  if (error) databaseError(error, "Impossible de lire l’activation du démarrage automatique du métré.");
  const row = data?.[0];
  const now = Date.now();
  const active = (value: string | null | undefined) => Boolean(value && Date.parse(value) <= now);
  return { launchActive: active(row?.launch_active_from), completionActive: active(row?.completion_active_from),
    launchActiveFrom: row?.launch_active_from ?? null };
}

/**
 * The payer's subscription on this Mac: the selection that attests the mandate (opaque profile, model, effort, host), or
 * the reason it cannot. `host` is the address of the member's request at a gesture; the Mac's own loop has none.
 */
export async function readLocalTakeoffMandate(owner: ChatGptOwner, host?: string | null): Promise<
  { issue: TakeoffMandateIssue; selection: null } | { issue: null; selection: TakeoffExecutionSelection }> {
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
  if (!profile || !hasLocalChatGptPlanAccess(profile)) return { issue: "CHATGPT_ACCESS_REVOKED", selection: null };
  if (!profile.model) return { issue: "CHATGPT_MODEL_MISSING", selection: null };
  return { issue: null, selection: { profileId: profile.id, model: profile.model, reasoningEffort: profile.reasoningEffort ?? null,
    hostId: await getChatGptHostId() } };
}

function sameSelection(left: unknown, right: TakeoffExecutionSelection) {
  const stored = left as Partial<TakeoffExecutionSelection> | null;
  return Boolean(stored) && stored!.profileId === right.profileId && stored!.model === right.model
    && (stored!.reasoningEffort ?? null) === right.reasoningEffort && stored!.hostId === right.hostId;
}

type MandateRow = { request_id: string; state: string; reason_code: string | null; payer_id: string | null };

async function recordMandate(service: Service, input: {
  tenantId: string; projectId: string; actorId: string; mode: "confirmation" | "take_over"; requestId?: string;
  mandate: Awaited<ReturnType<typeof readLocalTakeoffMandate>> | { issue: "MANDATE_REQUIRED"; selection: null };
}) {
  const { data, error } = await service.rpc("record_takeoff_launch_mandate", {
    p_tenant_id: input.tenantId, p_project_id: input.projectId, p_actor: input.actorId, p_mode: input.mode,
    ...(input.mandate.selection
      ? { p_host: input.mandate.selection.hostId, p_selection: input.mandate.selection as unknown as Json }
      : { p_blocked_reason: input.mandate.issue }),
    ...(input.requestId ? { p_request_id: input.requestId } : {}),
  });
  if (error?.message === "TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE") {
    throw new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false,
      message: "Votre rôle ne permet pas de prendre en charge le métré de cette affaire." });
  }
  if (error?.message === "TAKEOFF_LAUNCH_REQUEST_NOT_FOUND") {
    throw new TakeoffError({ status: 404, code: TakeoffErrorCode.NOT_FOUND, retryable: false,
      message: "Aucun métré n’attend sa prise en charge sur cette affaire." });
  }
  if (error) databaseError(error, "Impossible d’enregistrer qui paie le métré de cette affaire.");
  return ((data ?? []) as MandateRow[])[0] ?? null;
}

/** What a gesture leaves: the request, its state and its reason, in French. */
export type TakeoffLaunchGestureResult = {
  requestId: string; state: TakeoffLaunchRequestState; reason: TakeoffLaunchReason | null; message: string | null;
};
function gestureResult(row: MandateRow): TakeoffLaunchGestureResult {
  const reason = isTakeoffLaunchReason(row.reason_code) ? row.reason_code : null;
  return { requestId: row.request_id, state: row.state as TakeoffLaunchRequestState, reason,
    message: reason ? describeTakeoffLaunchReason(reason) : null };
}

/**
 * After the brief's confirmation committed: the affaire's one automatic request is reserved and the confirmer is recorded
 * as its payer, on this Mac and with the selection of Mon profil, or the reason why not (a reader who confirms does not
 * pay; another address or the hosted application cannot hold a mandate). Nothing happens before the owner's activation,
 * or when the brief was not confirmed by this member (the database reads the brief again under the request's lock).
 */
export async function recordAutomaticTakeoffMandate(input: { context: Context; projectId: string; host: string | null }) {
  const { context, projectId } = input;
  const service = createServiceRoleClient();
  if (!(await readTakeoffLaunchActivation(service)).launchActive) return null;
  if (!(await isTakeoffEnabled(context.tenantId, { supabase: service }))) return null;
  const operator = context.tenantRole === "admin" || context.tenantRole === "engineer";
  const mandate = operator
    ? await readLocalTakeoffMandate({ userId: context.userId, tenantId: context.tenantId }, input.host)
    : { issue: "MANDATE_REQUIRED" as const, selection: null };
  const row = await recordMandate(service, { tenantId: context.tenantId, projectId, actorId: context.userId, mode: "confirmation", mandate });
  if (!row) return null;
  if (row.state === "evaluating") wakeTakeoffLaunchConsumer();
  return gestureResult(row);
}

/**
 * « Reprendre avec mon forfait » / « Prendre en charge avec mon forfait »: an operator who may launch on the affaire takes
 * its waiting request on their own subscription, on this Mac, by an explicit gesture; they then receive its end. A
 * blocked mandate is never lifted by a later connection alone.
 */
export async function assumeTakeoffLaunchRequest(input: { context: Context; projectId: string; requestId?: string; host: string | null }) {
  const { context, projectId } = input;
  await assertPreparationProjectAccess(context, projectId, true);
  const service = createServiceRoleClient();
  if (!(await readTakeoffLaunchActivation(service)).launchActive) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Le démarrage automatique du métré n’est pas activé." });
  }
  const mandate = await readLocalTakeoffMandate({ userId: context.userId, tenantId: context.tenantId }, input.host);
  if (mandate.issue) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false,
      message: describeTakeoffLaunchReason(mandate.issue) });
  }
  const row = await recordMandate(service, { tenantId: context.tenantId, projectId, actorId: context.userId, mode: "take_over",
    requestId: input.requestId, mandate });
  if (!row) throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
    message: "Le démarrage automatique du métré n’est pas activé." });
  if (row.state === "evaluating") wakeTakeoffLaunchConsumer();
  return gestureResult(row);
}

/** The notice of who pays, for the brief's confirmation: shown to the member whose subscription the analysis will use. */
export async function readAutomaticTakeoffPayerNotice(context: Context, project: { id: string; user_id: string }) {
  const operator = context.tenantRole === "admin" || (context.tenantRole === "engineer" && project.user_id === context.userId);
  if (!operator) return null;
  const service = createServiceRoleClient();
  if (!(await readTakeoffLaunchActivation(service)).launchActive) return null;
  if (!(await isTakeoffEnabled(context.tenantId, { supabase: service }))) return null;
  return TAKEOFF_AUTOMATIC_PAYER_NOTICE;
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

async function isPayerEligible(service: Service, tenantId: string, projectId: string, payerId: string) {
  const [membership, project] = await Promise.all([
    service.from("tenant_memberships").select("role, tenants!inner(is_active)").eq("tenant_id", tenantId).eq("user_id", payerId)
      .eq("tenants.is_active", true).maybeSingle(),
    service.from("estimate_projects").select("user_id, is_archived").eq("tenant_id", tenantId).eq("id", projectId).maybeSingle(),
  ]);
  if (membership.error) databaseError(membership.error, "Impossible de vérifier qui paie le métré.");
  if (project.error) databaseError(project.error, "Impossible de vérifier qui paie le métré.");
  const role = membership.data?.role;
  return Boolean(project.data && !project.data.is_archived && (role === "admin" || (role === "engineer" && project.data.user_id === payerId)));
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
  const intake = new Map(input.planSet.files.flatMap((file) => typeof file.metadata.intake_document_id === "string"
    ? [[file.id, { intakeDocumentId: file.metadata.intake_document_id,
      generation: typeof file.metadata.intake_generation === "string" ? file.metadata.intake_generation : null }] as const] : []));
  const omittedPlans: TakeoffLaunchManifest["coverage"]["plans_omitted"] = [
    ...snapshot.preparation.sources.filter((source) => source.kind === "plan" && !source.active && source.plan_set_id === input.planSet.id)
      .map((source) => ({ id: source.document_id, name: source.document_name,
        reason: (source.alternate_of && plans.some((plan) => plan.content_hash && plan.content_hash === source.content_hash) ? "identical_copy" : "alternate") as "alternate" | "identical_copy" })),
    ...input.unsupportedPlans.map((plan) => ({ ...plan, reason: "unsupported_format" as const })),
  ];
  const manifest = buildTakeoffLaunchManifest({ intent: "initial", sources: snapshot.preparation.sources, intakeDocumentByPlanFile: intake,
    omittedPlans, omittedReferences, preparationRevision: snapshot.preparation_revision });
  return { snapshot, manifest, sourceFile };
}

type ClaimedRequest = { request_id: string; tenant_id: string; project_id: string; origin: string; payer_id: string; mark: number };

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
  const { data: request, error } = await service.from("takeoff_launch_requests")
    .select("id, origin, payer_id, execution_host_id, mandate_selection").eq("id", claim.request_id).maybeSingle();
  if (error) databaseError(error, "Impossible de lire la demande de métré.");
  if (!request?.payer_id || request.execution_host_id !== hostId) return refuse({ state: "blocked", reason: "MANDATE_REQUIRED", pieces: [] });
  const [takeoffEnabled, brief, documents, planSet, payerEligible] = await Promise.all([
    isTakeoffEnabled(claim.tenant_id, { supabase: service }),
    service.from("affaire_briefs").select("status").eq("tenant_id", claim.tenant_id).eq("project_id", claim.project_id).maybeSingle(),
    readDossierDocuments(service, claim.tenant_id, claim.project_id),
    readDossierPlanSet(service, claim.tenant_id, claim.project_id),
    isPayerEligible(service, claim.tenant_id, claim.project_id, request.payer_id),
  ]);
  if (brief.error) databaseError(brief.error, "Impossible de lire le brief de l’affaire.");
  const mandate = await readLocalTakeoffMandate({ userId: request.payer_id, tenantId: claim.tenant_id });
  const files = planSet?.files ?? [];
  const withoutCopy = findIntakePlansWithoutWorkingCopy(documents as unknown as SyncDocument[], files);
  const decision = decideTakeoffLaunch({
    takeoffEnabled,
    documents: documents.map((document) => ({ fileName: document.file_name, uploadStatus: document.upload_status,
      classificationStatus: document.classification_status, detectedCategory: document.document_kind, documentKind: document.document_kind,
      confidence: document.confidence ?? 0, issues: [...document.issues, ...(document.rejection_reason ? [document.rejection_reason] : [])] })),
    briefStatus: brief.data?.status ?? null,
    plansWithCopy: files.filter((file) => file.metadata.source === "affaire-intake").length,
    plansWithoutCopy: withoutCopy.map((document) => ({ id: document.id, name: document.file_name })),
    otherPlans: files.filter((file) => file.metadata.source !== "affaire-intake").length,
    payerEligible,
    mandateIssue: mandate.issue ?? (sameSelection(request.mandate_selection, mandate.selection) ? null : "CHATGPT_SELECTION_CHANGED"),
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
    payerId: request.payer_id, selection: mandate.selection!, jobId,
    unsupportedPlans: documents.filter((document) => document.document_kind === "plans" && document.upload_status === "uploaded"
      && document.classification_status === "classified" && !isEligiblePlanDocument(document as unknown as SyncDocument))
      .map((document) => ({ id: document.id, name: document.file_name })) });
  if ("reason" in sealed) return refuse(sealed);
  const { data, error: admitError } = await service.rpc("admit_takeoff_launch_request", {
    p_request_id: claim.request_id, p_token: token, p_mark: claim.mark,
    p_manifest: sealed.manifest as unknown as Json, p_snapshot: sealed.snapshot as unknown as Json,
    p_job: { id: jobId, plan_set_id: planSet!.id, source_file_name: sealed.sourceFile.sourceFileName,
      source_file_type: sealed.sourceFile.sourceFileType, source_file_size_bytes: sealed.sourceFile.sourceFileSizeBytes,
      prompt_version: getTakeoffPromptVersion("C"), execution_host_id: hostId } as unknown as Json,
  });
  if (admitError) databaseError(admitError, "Impossible d’admettre le métré automatique.");
  const admitted = data?.[0];
  const outcome = (admitted?.outcome ?? "lost") as TakeoffLaunchEvaluation["outcome"];
  const reason = isTakeoffLaunchReason(admitted?.reason_code) ? admitted!.reason_code as TakeoffLaunchReason : null;
  if ((outcome === "admitted" || outcome === "replayed") && admitted?.job_id) {
    // The job has its creation record: the Mac's retry loop would also take it; its lease keeps one run.
    void runLocalTakeoffAttempts({ jobId: admitted.job_id, correlationId: randomUUID(), trigger: "create" });
  }
  return { requestId: claim.request_id, outcome, jobId: admitted?.job_id ?? null, reason };
}

/** One pass of this Mac's loop: the requests whose mandate it prepared and that wait for an evaluation. */
export async function evaluateTakeoffLaunchRequests(input: { hostId?: string; limit?: number } = {}): Promise<TakeoffLaunchEvaluation[]> {
  if (!isLocalChatGptEnabled()) return [];
  const service = createServiceRoleClient();
  const hostId = input.hostId ?? await getChatGptHostId();
  const token = randomUUID();
  const { data, error } = await service.rpc("claim_takeoff_launch_evaluations", { p_host_id: hostId, p_token: token, p_limit: input.limit ?? 5 });
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

export type TakeoffRelaunchResult = { outcome: "admitted" | "replayed" | "already_running"; requestId: string; jobId: string | null };

/**
 * A manual request created, sealed and admitted in one commit from the member's confirmed preparation; its end goes to
 * that member. The intent key survives a double click and a replay; the same key with other content is a conflict.
 * While another request of the affaire runs, the command returns that one and creates nothing.
 */
export async function launchTakeoffRelaunch(input: {
  context: Context; projectId: string; planSetId: string; preparationRevision: number; intentKey: string;
  predecessorJobId?: string | null;
}): Promise<TakeoffRelaunchResult> {
  const { context } = input;
  await assertPreparationProjectAccess(context, input.projectId, true);
  const service = createServiceRoleClient();
  const activation = await readTakeoffLaunchActivation(service);
  if (!activation.launchActive || !activation.completionActive) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Les demandes de métré ne sont pas encore activées. Lancez l’analyse depuis la préparation." });
  }
  const snapshot = await assertConfirmedTakeoffPreparation({ context, estimateVersionId: null, projectId: input.projectId,
    preparationRevision: input.preparationRevision, planSetId: input.planSetId, level: "C", provider: "chatgpt" });
  // The confirmer's own subscription, as pinned at the confirmation, on this Mac.
  const owner = await getConfirmedTakeoffExecutionOwner(context.supabase, context, snapshot);
  const selection = snapshot.execution_selection!;
  const jobId = deriveDeterministicJobId(context.tenantId,
    `takeoff-request-command:${input.projectId.toLowerCase()}:${input.intentKey.toLowerCase()}:${TAKEOFF_GROUPED_UNIT_KEY}`);
  const config = await getTakeoffLevelCProcessingConfigForTenant(context.tenantId, { supabase: service });
  const plans = snapshot.preparation.sources.filter((source) => source.active && source.kind === "plan");
  const sourceFile = await resolvePlanSetSourceFile({ supabase: context.supabase, tenantId: context.tenantId, planSetId: input.planSetId,
    jobId, maxPages: config.maxPdfPages, selectedFileIds: plans.map((source) => source.document_id) });
  const files = await readAllRows(() => context.supabase.from("plan_files").select("id, metadata", { count: "exact" })
    .eq("tenant_id", context.tenantId).eq("plan_set_id", input.planSetId).order("id"));
  if (files.error) databaseError(files.error, "Impossible de lire les plans de l’affaire.");
  const intake = new Map((files.data ?? []).flatMap((file) => {
    const metadata = (file.metadata ?? {}) as Record<string, unknown>;
    return typeof metadata.intake_document_id === "string" ? [[file.id, { intakeDocumentId: metadata.intake_document_id,
      generation: typeof metadata.intake_generation === "string" ? metadata.intake_generation : null }] as const] : [];
  }));
  const manifest = buildTakeoffLaunchManifest({ intent: "reread_plans", sources: snapshot.preparation.sources, intakeDocumentByPlanFile: intake,
    omittedPlans: [], omittedReferences: [], preparationRevision: snapshot.preparation_revision });
  const { data, error } = await service.rpc("launch_manual_takeoff_request", {
    p_tenant_id: context.tenantId, p_project_id: input.projectId, p_actor: context.userId, p_intent_key: input.intentKey.toLowerCase(),
    p_intent: "reread_plans", p_predecessor_job_id: input.predecessorJobId ?? (null as never), p_host: owner.execution_host_id,
    p_selection: selection as unknown as Json, p_manifest: manifest as unknown as Json, p_snapshot: snapshot as unknown as Json,
    p_job: { id: jobId, plan_set_id: input.planSetId, source_file_name: sourceFile.sourceFileName, source_file_type: sourceFile.sourceFileType,
      source_file_size_bytes: sourceFile.sourceFileSizeBytes, prompt_version: getTakeoffPromptVersion("C"),
      execution_host_id: owner.execution_host_id } as unknown as Json,
  });
  if (error?.message === "TAKEOFF_LAUNCH_INTENT_CONFLICT") {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Cette commande a déjà été envoyée pour une autre analyse. Rechargez les options du métré." });
  }
  if (error?.message === "TAKEOFF_JOB_ADMISSION_LIMIT") {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.TAKEOFF_JOB_ADMISSION_LIMIT, retryable: true,
      message: "Trop d’analyses de métré en cours ou lancées récemment sur ce forfait. Réessayez plus tard." });
  }
  if (error) databaseError(error, "Impossible de relancer le métré.");
  const row = data?.[0];
  if (!row) throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, message: "Impossible de relancer le métré." });
  if ((row.outcome === "admitted" || row.outcome === "replayed") && row.job_id) {
    const { data: job } = await service.from("takeoff_jobs").select("status").eq("id", row.job_id).maybeSingle();
    if (job?.status === "pending") {
      const triggered = await triggerTakeoffJobProcessing({ jobId: row.job_id, trigger: "create" });
      await persistTakeoffDispatchOutcome({ jobId: row.job_id, trigger: "create", result: triggered });
    }
  }
  return { outcome: row.outcome as TakeoffRelaunchResult["outcome"], requestId: row.request_id, jobId: row.job_id };
}

// What the affaire shows: the state of its latest request, its reason and the gesture it allows, to its readers.

export type AffaireTakeoffLaunchView = {
  /** The owner turned the automatic start on. */
  active: boolean;
  /** A dossier confirmed before the activation is not armed: its last job, or the options of the takeoff. */
  confirmedBeforeActivation: boolean;
  /**
   * A dossier confirmed after the activation whose confirmation recorded no request (the call after its commit failed):
   * shown as not started, and taken on by an operator's gesture, never left silent.
   */
  confirmedWithoutRequest: null | { message: string; action: import("@/lib/takeoff/operator-state").TakeoffLaunchAction; actionLabel: string | null };
  request: null | {
    id: string; origin: "automatic" | "manual"; state: TakeoffLaunchRequestState;
    reason: TakeoffLaunchReason | null; message: string | null; pieces: TakeoffLaunchPiece[];
    hasPayer: boolean; payerIsViewer: boolean;
    createdAt: string; admittedAt: string | null; closedAt: string | null;
    outcome: "success" | "failure" | "canceled" | "partial" | null;
    /** The job of its grouped unit (lot 2); lot 3 lists one job per plan. */
    jobId: string | null;
    units: { expected: number | null; succeeded: number; failed: number; canceled: number };
    action: import("@/lib/takeoff/operator-state").TakeoffLaunchAction;
    actionLabel: string | null;
  };
  /** « Dossier modifié depuis l’analyse »: plans added, replaced or removed since the latest admitted request sealed its own. */
  dossierChangedSinceAnalysis: null | { added: TakeoffLaunchPiece[]; replaced: TakeoffLaunchPiece[]; removed: TakeoffLaunchPiece[] };
};

type RequestRow = {
  id: string; origin: string; state: string; reason_code: string | null; reason_details: unknown; payer_id: string | null;
  created_at: string; updated_at: string; admitted_at: string | null; closed_at: string | null; outcome: string | null;
  units_expected: number | null; units_succeeded: number; units_failed: number; units_canceled: number;
};

/** Reading never spends: it reads the requests the member may read and the plans of the dossier, nothing else. */
export async function readAffaireTakeoffLaunchState(context: Context, projectId: string): Promise<AffaireTakeoffLaunchView> {
  await assertPreparationProjectAccess(context, projectId);
  const service = createServiceRoleClient();
  const [activation, requests, brief, viewers] = await Promise.all([
    readTakeoffLaunchActivation(service),
    context.supabase.from("takeoff_launch_requests")
      .select("id, origin, state, reason_code, reason_details, payer_id, created_at, updated_at, admitted_at, closed_at, outcome, units_expected, units_succeeded, units_failed, units_canceled")
      .eq("tenant_id", context.tenantId).eq("project_id", projectId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
    context.supabase.from("affaire_briefs").select("status, confirmed_at").eq("tenant_id", context.tenantId).eq("project_id", projectId).maybeSingle(),
    import("@/lib/takeoff/resume-viewer-server").then(({ readTakeoffResumeViewers }) => readTakeoffResumeViewers({
      supabase: context.supabase, tenantId: context.tenantId, member: context, projectIds: [projectId] })),
  ]);
  if (requests.error) databaseError(requests.error, "Impossible de lire le métré de l’affaire.");
  if (brief.error) databaseError(brief.error, "Impossible de lire le brief de l’affaire.");
  const latest = (requests.data?.[0] ?? null) as RequestRow | null;
  const confirmedBeforeActivation = Boolean(activation.launchActiveFrom && brief.data?.status === "confirme" && brief.data.confirmed_at
    && Date.parse(brief.data.confirmed_at) < Date.parse(activation.launchActiveFrom));
  const { resolveTakeoffLaunchDecision, describeTakeoffLaunchAction } = await import("@/lib/takeoff/operator-state");
  if (!latest) {
    const confirmedAfterActivation = activation.launchActive && brief.data?.status === "confirme" && !confirmedBeforeActivation;
    const { action } = resolveTakeoffLaunchDecision({ state: "blocked", reasonCode: "MANDATE_REQUIRED", payerId: null, viewer: viewers(projectId) });
    return { active: activation.launchActive, confirmedBeforeActivation, request: null, dossierChangedSinceAnalysis: null,
      confirmedWithoutRequest: confirmedAfterActivation
        ? { message: describeTakeoffLaunchReason("MANDATE_REQUIRED"), action, actionLabel: describeTakeoffLaunchAction(action) } : null };
  }

  const reason = isTakeoffLaunchReason(latest.reason_code) ? latest.reason_code : null;
  const details = (latest.reason_details ?? {}) as { pieces?: unknown };
  const pieces = Array.isArray(details.pieces) ? details.pieces.flatMap((piece) => {
    const entry = piece as { id?: unknown; name?: unknown };
    return typeof entry?.id === "string" && typeof entry.name === "string" ? [{ id: entry.id, name: entry.name }] : [];
  }) : [];
  const { action } = resolveTakeoffLaunchDecision({ state: latest.state, reasonCode: latest.reason_code, payerId: latest.payer_id,
    updatedAt: latest.updated_at, viewer: viewers(projectId) });
  const { data: jobs, error: jobError } = latest.admitted_at ? await context.supabase.from("takeoff_jobs").select("id")
    .eq("tenant_id", context.tenantId).eq("launch_request_id", latest.id).order("launch_unit_key").limit(1)
    : { data: [] as Array<{ id: string }>, error: null };
  if (jobError) databaseError(jobError, "Impossible de lire l’analyse du métré.");

  return {
    active: activation.launchActive, confirmedBeforeActivation, confirmedWithoutRequest: null,
    request: {
      id: latest.id, origin: latest.origin === "manual" ? "manual" : "automatic", state: latest.state as TakeoffLaunchRequestState,
      reason, message: reason ? describeTakeoffLaunchReason(reason, pieces) : null, pieces,
      hasPayer: latest.payer_id !== null, payerIsViewer: latest.payer_id === context.userId,
      createdAt: latest.created_at, admittedAt: latest.admitted_at, closedAt: latest.closed_at,
      outcome: latest.outcome as NonNullable<AffaireTakeoffLaunchView["request"]>["outcome"],
      jobId: jobs?.[0]?.id ?? null,
      units: { expected: latest.units_expected, succeeded: latest.units_succeeded, failed: latest.units_failed, canceled: latest.units_canceled },
      action, actionLabel: describeTakeoffLaunchAction(action),
    },
    dossierChangedSinceAnalysis: latest.admitted_at ? await readDossierChangeSinceAnalysis(service, context.tenantId, projectId, latest.id) : null,
  };
}

/** The plans of the dossier's plan set against the plans the request sealed (read by the server after the access check). */
async function readDossierChangeSinceAnalysis(service: Service, tenantId: string, projectId: string, requestId: string) {
  const [{ data: request, error }, planSet] = await Promise.all([
    service.from("takeoff_launch_requests").select("manifest").eq("id", requestId).eq("tenant_id", tenantId).maybeSingle(),
    readDossierPlanSet(service, tenantId, projectId),
  ]);
  if (error) databaseError(error, "Impossible de lire le métré de l’affaire.");
  const manifest = request?.manifest as TakeoffLaunchManifest | null;
  if (!manifest || !Array.isArray(manifest.plans)) return null;
  const sealed = new Map(manifest.plans.map((plan) => [plan.plan_file_id, plan]));
  const omitted = new Set((manifest.coverage?.plans_omitted ?? []).map((plan) => plan.id));
  const current = planSet?.files ?? [];
  const currentIds = new Set(current.map((file) => file.id));
  const nameOf = (file: { file_name: string; metadata: Record<string, unknown> }) => getPlanFileDisplayName(file);
  const added = current.filter((file) => !sealed.has(file.id) && !omitted.has(file.id)).map((file) => ({ id: file.id, name: nameOf(file) }));
  const replaced = current.filter((file) => {
    const plan = sealed.get(file.id);
    const generation = typeof file.metadata.intake_generation === "string" ? file.metadata.intake_generation : null;
    return plan && plan.intake_document_id && generation !== plan.generation;
  }).map((file) => ({ id: file.id, name: nameOf(file) }));
  const removed = manifest.plans.filter((plan) => !currentIds.has(plan.plan_file_id)).map((plan) => ({ id: plan.plan_file_id, name: plan.name }));
  return added.length || replaced.length || removed.length ? { added, replaced, removed } : null;
}

/** The notice of who pays for the affaire's page: nothing for a reader, nothing before the activation, never an error. */
export async function readAffaireAutomaticTakeoffPayerNotice(projectId: string) {
  try {
    const { requireAffaireAccess } = await import("@/lib/affaires/access-server");
    const { context, project } = await requireAffaireAccess(projectId, "read");
    return await readAutomaticTakeoffPayerNotice(context, project);
  } catch {
    return null;
  }
}
