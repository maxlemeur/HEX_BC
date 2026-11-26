import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { countMarkPageFrames } from "./count-mark-geometry-server";
import { readPlanBytes } from "./plan-location-server";
import { countMarkSchedule, MARK_SCOPE_REFUSAL, type CountMarkSchedule } from "./count-mark-schedule";

import { TAKEOFF_NANO_USD_PER_CENT } from "./payment-choice";
import type { TakeoffApiMandate } from "./payment-mandate-server";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { getTakeoffLevelCProcessingConfigForTenant, takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import { sealedMeasuringOrder } from "@/lib/takeoff/item-list-seal-server";
import { TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "@/lib/takeoff/launch-call-ledger";
import { isTakeoffPlanDispatchActive } from "@/lib/takeoff/local-dispatcher";
import {
  describeTakeoffLaunchReason, splitTakeoffLaunchManifest, type TakeoffLaunchOrder, type TakeoffPlanLaunchManifest,
} from "@/lib/takeoff/launch-request";
import {
  countUnstoredPlanPages, databaseError, dispatchLaunchRequestJobs, launchError, logicalPlanKey, planPagesPastLimit,
  planSetCopiesSetAside, planUnitJobs, readPlansAnalysedBefore, relaunchManifest, sealedPlanSetId,
} from "@/lib/takeoff/launch-request-server";
import { POSTE_READING_BUDGET_MARGIN, posteReadingRefusal, postesAskedBy, sizePosteReadingManifest, type PosteReadingBounds } from "@/lib/takeoff/poste-reading-bounds";
import {
  createTakeoffPreparationSnapshot, TakeoffPreparationNotReadyError, takeoffExecutionSelectionSchema, type TakeoffExecutionSelection,
  type TakeoffPreparationSnapshot,
} from "@/lib/takeoff/preparation";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { takeoffVectorGroupCallsBound } from "@/lib/takeoff/vectors/worker-server";
import type { ItemMeasureScope } from "./item-table-contracts";
import type { Json } from "@/types/database";

// Lot 4 PR 4b: the new measure of a selection of items from the table of items — its plan (for the preview and the
// admission), its admission (public.launch_takeoff_item_remeasure) and its receipt — on the launch's own planning
// (launch-request-server.ts: the relaunch's manifest, the plan set's copies, the units' jobs and their dispatch).

type Context = AuthenticatedTenantContext;
const FRAME_CONFLICT = "La géométrie des repères existants diffère de celle du PDF. Vérifiez la copie ou désactivez les propositions.";

/**
 * Lot 4 PR 4b: a new measure of a selection of items, planned for its preview and again for its admission. The affaire's
 * current confirmed preparation (whoever confirmed it) gives its content, restricted to the plans of the selection (one
 * analysis per plan, each its current copy); the member who confirms is its payer, on their own subscription, with the
 * setting of the dialog sealed in its selection. Its order seals the list's latest revision with the items asked, and
 * its budget is sized on those items alone, in the sealed list's order as the worker reads them (postesAskedBy), by
 * #467's rule (paid calls × the ledger's estimate × its margin, the ceilings per plan and per request, the page limit per
 * plan). It re-reads the latest analysis of its plans.
 */
export type TakeoffItemRemeasurePlan = {
  planSetId: string;
  preparationRevision: number;
  /** The plans' current copies, in the manifest's order, and their logical keys (the table's). */
  planFileIds: string[];
  planKeys: string[];
  predecessorJobId: string | null;
  listRevisionId: string;
  askedItemIds: string[];
  snapshot: TakeoffPreparationSnapshot;
  manifest: TakeoffPlanLaunchManifest;
  bounds: PosteReadingBounds;
  markSchedule?: CountMarkSchedule;
  markFrames?: Awaited<ReturnType<typeof countMarkPageFrames>>;
};

async function readMeasurePreparation(context: Context, projectId: string) {
  const service = createServiceRoleClient();
  // The admission is refused unless one analysis per plan is active: the preview says so, never offers it.
  if (!await isTakeoffPlanDispatchActive(service)) {
    return { refusal: "La nouvelle mesure d’une sélection n’est pas encore ouverte : la lecture plan par plan n’est pas activée sur cette affaire." };
  }
  const { data: record, error } = await service.from("takeoff_preparations").select("revision")
    .eq("tenant_id", context.tenantId).eq("project_id", projectId).maybeSingle();
  if (error) databaseError(error, "Impossible de lire la préparation du métré de l’affaire.");
  if (!record) return { refusal: "La préparation du métré de l’affaire n’est pas confirmée : confirmez-la avant une nouvelle mesure." };
  let confirmed: TakeoffPreparationSnapshot;
  try {
    confirmed = await assertConfirmedTakeoffPreparation({ context, estimateVersionId: null, projectId,
      preparationRevision: record.revision, level: "C", provider: "chatgpt" });
  } catch (caught) {
    if (caught instanceof TakeoffError) return { refusal: caught.message };
    throw caught;
  }
  const planSetId = sealedPlanSetId(confirmed);
  if (!planSetId) return { refusal: "La préparation confirmée ne retient aucun plan à lire." };
  const config = await getTakeoffLevelCProcessingConfigForTenant(context.tenantId, { supabase: service });
  const order = await sealedMeasuringOrder(service, { tenantId: context.tenantId, projectId, payerId: context.userId,
    perPlan: true });
  if ("blocked" in order || order.order.kind !== "item_list") {
    return { refusal: "Les postes ne sont pas encore lus contre la liste, plan par plan : aucune nouvelle mesure n’est possible." };
  }
  // The selection's plans, by their logical key, at their current copies in the confirmed preparation.
  const everyPlan = await relaunchManifest(service, context, planSetId, confirmed, config, "reread_plans", [], order.order);
  return { confirmed, planSetId, service, config, order: order.order, items: order.items, everyPlan };
}

/** Called by the detail for an operator looking at an existing item-list revision. */
export async function readFirstMeasurePlans(context: Context, projectId: string) {
  const prepared = await readMeasurePreparation(context, projectId);
  return prepared.everyPlan?.manifest.plans.map(({ logical_id: key, name }) => ({ key, name, location: null })) ?? [];
}

export async function planTakeoffItemRemeasure(context: Context, input: {
  projectId: string; planKeys: readonly string[]; itemIds: readonly string[]; detail?: ItemMeasureScope; selection: TakeoffExecutionSelection | null; apiMandate?: TakeoffApiMandate;
}): Promise<{ plan: TakeoffItemRemeasurePlan } | { refusal: string; stale?: boolean; changedCopy?: boolean }> {
  const prepared = await readMeasurePreparation(context, input.projectId);
  if (!prepared.everyPlan) return { refusal: prepared.refusal };
  const { confirmed, planSetId, service, order, items, everyPlan } = prepared;
  const config = input.apiMandate ? { ...prepared.config, maxTotalTokens: input.apiMandate.maxTokens,
    maxCostCents: input.apiMandate.maxNanoUsd / TAKEOFF_NANO_USD_PER_CENT } : prepared.config;
  const copyOf = new Map(everyPlan.manifest.plans.map((plan) => [plan.logical_id.toLowerCase(), plan.plan_file_id]));
  const scope = input.planKeys.map((key) => copyOf.get(key.toLowerCase()));
  if (!scope.length || scope.some((id) => !id)) {
    return { refusal: "Un plan de la sélection ne fait plus partie de la préparation confirmée : rouvrez l’aperçu.", stale: true };
  }
  // The order seals the items asked by identifier, in their canonical order; they are read and sized in the list's.
  const asked = [...new Set(input.itemIds.map((id) => id.toLowerCase()))].sort();
  const askedItems = postesAskedBy(items, asked);
  if (!asked.length || !askedItems) {
    return { refusal: "Un poste de la sélection n’est plus dans la liste : rafraîchissez la sélection.", stale: true };
  }
  const detail = input.detail;
  const file = everyPlan.manifest.plans.find((p) => p.plan_file_id === scope[0]);
  if (detail && (!file || scope.length !== 1 || asked.length !== 1 || detail.fileId !== file.plan_file_id
    || (detail.contentSha256 && detail.contentSha256 !== file.content_sha256)
    || (detail.generation && file.generation !== detail.generation))) {
    return { refusal: "Le document a changé. Rouvrez le poste sur le plan actuel et relisez le récapitulatif.", stale: true, changedCopy: true };
  }
  if (detail?.page && file && (file.pages.length ? !file.pages.includes(detail.page)
    : file.page_count !== null && detail.page > file.page_count)) {
    return { refusal: "La page affichée ne fait pas partie des pages admises de ce plan." };
  }
  let snapshot: TakeoffPreparationSnapshot;
  try {
    snapshot = createTakeoffPreparationSnapshot({
      preparation: { ...confirmed.preparation, sources: confirmed.preparation.sources.map((source) =>
        source.kind !== "plan" || !source.active ? source : !scope.includes(source.document_id) ? { ...source, active: false }
          : detail?.page ? { ...source, pages: [detail.page] } : source) },
      confirmedBy: context.userId, confirmedAt: new Date().toISOString(), revision: confirmed.preparation_revision,
      ...(input.selection ? { executionSelection: input.selection } : {}),
    });
  } catch (caught) {
    if (caught instanceof TakeoffPreparationNotReadyError) {
      return { refusal: "Ces plans ne peuvent pas être lus seuls avec la préparation confirmée : revoyez les options du métré." };
    }
    throw caught;
  }
  const countedPages = await countUnstoredPlanPages(service, snapshot.preparation.sources);
  if (detail?.page && file && !file.pages.length && detail.page > (file.page_count ?? countedPages.get(file.plan_file_id) ?? 0)) {
    return { refusal: "La page affichée ne fait pas partie des pages admises de ce plan." };
  }
  const pastLimit = snapshot.preparation.sources.filter((source) => source.kind === "plan" && source.active
    && (source.page_count ?? countedPages.get(source.document_id) ?? 0) > config.maxPdfPages);
  if (pastLimit.length) return { refusal: planPagesPastLimit(pastLimit, config.maxPdfPages).message };
  // The order seals the latest revision, and the items asked; the other plans an earlier analysis read stay its.
  const sealed: TakeoffLaunchOrder = { ...order, list: { ...order.list, asked_item_ids: asked } };
  const { manifest: grouped, held } = await relaunchManifest(service, context, planSetId, snapshot, config, "reread_plans",
    planSetCopiesSetAside(confirmed.preparation.sources, planSetId), sealed);
  const reading = new Set(grouped.plans.map((plan) => logicalPlanKey({ id: plan.plan_file_id, intake_document_id: plan.intake_document_id })));
  const omitted = new Map(grouped.coverage.plans_omitted.map((plan) => [plan.id, plan]));
  for (const plan of await readPlansAnalysedBefore(service, context.tenantId, input.projectId)) {
    if (scope.includes(plan.id) || reading.has(logicalPlanKey(plan)) || !held(plan) || omitted.has(plan.id)) continue;
    omitted.set(plan.id, { ...plan, reason: "not_requested" });
  }
  const split = splitTakeoffLaunchManifest({ ...grouped, coverage: { ...grouped.coverage, plans_omitted: [...omitted.values()] } },
    countedPages);
  const sized = sizePosteReadingManifest(split, config, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, askedItems, takeoffVectorGroupCallsBound);
  if (!sized.bounds) return { refusal: "La lecture de ces postes n’a pas pu être bornée : rouvrez l’aperçu." };
  const tooLarge = posteReadingRefusal(sized.bounds);
  if (tooLarge) return { refusal: describeTakeoffLaunchReason(tooLarge.reason, tooLarge.pieces, sized.bounds) };
  let markSchedule: CountMarkSchedule | undefined;
  let markFrames: TakeoffItemRemeasurePlan["markFrames"];
  if (detail?.proposeMarks) {
    const piece = sized.manifest.plans[0];
    const count = piece.pages.length || piece.page_count || countedPages.get(piece.plan_file_id);
    if (!count || count > 6) return { refusal: MARK_SCOPE_REFUSAL };
    const pages = piece.pages.length ? [...piece.pages].sort((a,b) => a-b) : Array.from({ length: count }, (_,i) => i+1);
    const { data: stored, error: fileError } = await service.from("plan_files")
      .select("id,plan_set_id,file_path,file_name,file_size_bytes").eq("tenant_id",context.tenantId)
      .eq("plan_set_id",planSetId).eq("id",piece.plan_file_id).maybeSingle();
    if (fileError) databaseError(fileError, "Impossible de lire le plan confirmé.");
    const bytes = stored && (await readPlanBytes(context.tenantId, stored)).bytes;
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== piece.content_sha256) {
      return { refusal: "Le document a changé ou est indisponible. Rouvrez le poste et vérifiez sa copie.", stale: true, changedCopy: true };
    }
    markFrames = await countMarkPageFrames(bytes, pages).catch(() => undefined);
    if (!markFrames) return { refusal: "La géométrie d’une page est inconnue pour cette copie. Choisissez une page connue ou désactivez les propositions." };
    const { data: existing, error } = await service.from("takeoff_count_pages")
      .select("page,geometry_version,view_box,rotation,user_unit,width,height")
      .eq("tenant_id",context.tenantId).eq("project_id",input.projectId).eq("plan_logical_id",piece.logical_id)
      .eq("plan_content_sha256",piece.content_sha256).in("page",pages);
    if (error) databaseError(error, "Impossible de lire la géométrie enregistrée pour ce plan.");
    for (const { page, geometry } of markFrames) {
      const row = existing.find((entry) => entry.page === page);
      if (!row) continue;
      const { page: storedPage, geometry_version: version, ...frame } = row;
      if (storedPage === page && !isDeepStrictEqual({ version, ...frame }, geometry)) return { refusal: FRAME_CONFLICT };
    }
    const unit = sized.manifest.units[0];
    unit.paid_vector_groups = takeoffVectorGroupCallsBound(unit.vector_pages) > 0;
    try {
      markSchedule = countMarkSchedule(markFrames.map(({ page, geometry }) => ({ page, width_points: geometry.width })), sized.bounds.calls);
    } catch {
      return { refusal: MARK_SCOPE_REFUSAL };
    }
    const estimate = markSchedule.total_calls * TAKEOFF_PAID_CALL_ESTIMATE_TOKENS;
    if (estimate > config.maxTotalTokens) return { refusal: "Les lectures et les propositions dépassent le budget du métré. Choisissez la page affichée seule ou désactivez les propositions." };
    const tokens = Math.min(config.maxTotalTokens, estimate * POSTE_READING_BUDGET_MARGIN);
    sized.manifest.budget = { ...sized.manifest.budget, tokens };
    sized.manifest.units[0].budget = { ...sized.manifest.units[0].budget, tokens };
  }
  // The analysis it re-reads: the latest of its plans', else the affaire's latest.
  const latest = async (keys: string[] | null) => {
    // A page published beside an indivisible reading cannot be the predecessor of the next measure.
    let query = service.from("takeoff_jobs")
      .select("id,comparison:takeoff_item_answer_publications(answers:takeoff_item_answers!inner(id))")
      .eq("tenant_id", context.tenantId).eq("project_id", input.projectId)
      .eq("comparison.answers.comparison_only", true).is("comparison", null);
    if (keys) query = query.in("launch_unit_key", keys);
    const { data, error: jobError } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
    if (jobError) databaseError(jobError, "Impossible de lire les analyses de l’affaire.");
    return data?.[0]?.id ?? null;
  };
  const predecessorJobId = await latest(sized.manifest.plans.map((plan) => `plan:${plan.plan_file_id.toLowerCase()}`)) ?? await latest(null);
  if (!predecessorJobId && !detail) return { refusal: "L’affaire n’a encore aucune analyse : lancez d’abord le métré de l’affaire." };
  return { plan: { ...(markSchedule && { markSchedule, markFrames }), planSetId, preparationRevision: confirmed.preparation_revision,
    planFileIds: sized.manifest.plans.map((plan) => plan.plan_file_id),
    planKeys: sized.manifest.plans.map((plan) => plan.logical_id), predecessorJobId, listRevisionId: order.list.revision_id,
    askedItemIds: asked, snapshot, manifest: { ...sized.manifest, intent: predecessorJobId ? "reread_plans" : "initial" }, bounds: sized.bounds } };
}

/** The answer of the admission: admitted, replayed or kept for later, or stale with the items whose reading changed. */
export type TakeoffItemRemeasureAdmission =
  | { outcome: "admitted" | "replayed" | "already_running"; requestId: string | null }
  | { outcome: "stale"; stale: string[] };

/** The refusals of public.launch_takeoff_item_remeasure in French; the others are a launch's. */
function remeasureError(error: { code?: string; message: string }): never {
  switch (error.message) {
    case "TAKEOFF_ITEM_REMEASURE_INACTIVE":
      throw new TakeoffError({ status: 503, code: TakeoffErrorCode.CONFLICT, retryable: false,
        message: "La nouvelle mesure d’une sélection de postes n’est pas encore ouverte : aucune analyse n’a été lancée." });
    case "TAKEOFF_MARKS_PAGE_GEOMETRY_CONFLICT":
      throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false, message: FRAME_CONFLICT });
    case "TAKEOFF_MARKS_GEOMETRY_UNKNOWN":
      throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
        message: "La géométrie d’une page est inconnue pour cette copie. Choisissez une page connue ou désactivez les propositions." });
    case "TAKEOFF_MARKS_SCOPE_INVALID":
      throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
        message: "Les pages ou le nombre d’appels ont changé. Rouvrez le récapitulatif." });
    case "TAKEOFF_ITEM_REMEASURE_INVALID":
      throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
        message: "La demande de nouvelle mesure est invalide : rouvrez l’aperçu." });
    case "TAKEOFF_LAUNCH_SEAL_INVALID":
      throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
        message: "La préparation du métré ou la liste des postes a changé depuis l’aperçu : rouvrez-le avant de confirmer." });
    case "TAKEOFF_ITEM_REMEASURE_PREPARATION_BUSY":
      throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: true,
        message: "La préparation du métré de l’affaire est en cours de modification : rien n’a été lancé. Réessayez dans un instant." });
    case "TAKEOFF_ITEM_REMEASURE_AFFAIRE_NOT_FOUND":
      throw new TakeoffError({ status: 404, code: TakeoffErrorCode.NOT_FOUND, retryable: false,
        message: "Cette affaire n’existe plus : aucune nouvelle mesure n’a été lancée." });
  }
  launchError(error, "Impossible de lancer la nouvelle mesure.");
}

/**
 * The admission (public.launch_takeoff_item_remeasure, with the server's client): one analysis per plan of the plan,
 * jobs derived from the command, and the targets the member saw (each item's current answers on those plans), which the
 * database compares under its locks. Its jobs are handed to the Mac once admitted.
 */
/** What the member confirmed besides the readings: the preview confirmed (its digest) and the setting chosen for it. */
export type TakeoffItemRemeasureConfirmation = { preview_digest: string; count_marks?: CountMarkSchedule; page?: number | null; shown_sha256?: string; setting: { model?: string; reasoning_effort: string | null } | null };
export type TakeoffItemRemeasureTargets = Array<{ item_id: string; answers: string[] }>;

/** The setting a confirmation seals, as the request's snapshot and the database's digest hold it. */
function sealedSelectionValue(selection: TakeoffExecutionSelection) {
  return takeoffExecutionSelectionSchema.parse(selection) as unknown as Json;
}

export async function launchTakeoffItemRemeasure(context: Context, input: {
  projectId: string; intentKey: string; plan: TakeoffItemRemeasurePlan; selection: TakeoffExecutionSelection;
  targets: TakeoffItemRemeasureTargets; confirmation: TakeoffItemRemeasureConfirmation; host?: string | null;
}): Promise<TakeoffItemRemeasureAdmission> {
  const service = createServiceRoleClient();
  const { plan } = input;
  const units = await planUnitJobs(service, { tenantId: context.tenantId, planSetId: plan.planSetId,
    jobKey: `takeoff-item-remeasure:${input.projectId}:${input.intentKey}`, hostId: input.selection.hostId, manifest: plan.manifest });
  if (plan.markFrames) {
    const file = plan.manifest.plans[0];
    const attested = await service.rpc("attest_takeoff_count_mark_pages", {
      p_tenant: context.tenantId, p_project: input.projectId, p_file: file.plan_file_id,
      p_logical: file.logical_id, p_hash: file.content_sha256!, p_frames: plan.markFrames as unknown as Json,
    });
    if (attested.error) remeasureError(attested.error);
  }
  const { data, error } = await service.rpc("launch_takeoff_item_remeasure", {
    p_tenant_id: context.tenantId, p_project_id: input.projectId, p_actor: context.userId, p_intent_key: input.intentKey,
    p_predecessor_job_id: plan.predecessorJobId as string, p_host: input.selection.hostId,
    p_selection: sealedSelectionValue(input.selection), p_manifest: units.manifest as unknown as Json,
    p_snapshot: plan.snapshot as unknown as Json, p_jobs: units.jobs as unknown as Json, p_plan_set_id: plan.planSetId,
    p_preparation_revision: plan.preparationRevision, p_plan_file_ids: plan.planFileIds,
    p_targets: input.targets as unknown as Json, p_confirmation: input.confirmation as unknown as Json,
    p_module_default: takeoffModuleDefault(),
  });
  if (error) remeasureError(error);
  const row = (data as Array<{ outcome: string; request_id: string | null; stale: string[] | null }> | null)?.[0];
  if (!row) throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false,
    message: "Impossible de lancer la nouvelle mesure." });
  if (row.outcome === "stale") return { outcome: "stale", stale: row.stale ?? [] };
  if (row.outcome === "admitted") await dispatchLaunchRequestJobs({ jobIds: units.jobs.map((job) => job.id), host: input.host ?? null });
  return { outcome: row.outcome as "admitted" | "replayed" | "already_running", requestId: row.request_id };
}

/**
 * The replay of a lost answer (public.replay_takeoff_item_remeasure): the receipt of exactly this confirmation, by what the
 * member confirmed alone (the payer, the plans, the list revision and the readings seen, the sealed setting, the preview
 * and the setting chosen), before anything is planned; null when its key answered nothing yet. Another confirmation
 * under the key is the database's conflict.
 */
export async function replayTakeoffItemRemeasure(context: Context, input: {
  projectId: string; intentKey: string; planKeys: readonly string[]; listRevisionId: string; targets: TakeoffItemRemeasureTargets;
  selection: TakeoffExecutionSelection; confirmation: TakeoffItemRemeasureConfirmation;
}): Promise<{ outcome: "replayed" | "already_running"; requestId: string | null } | null> {
  const { data, error } = await createServiceRoleClient().rpc("replay_takeoff_item_remeasure", {
    p_tenant_id: context.tenantId, p_project_id: input.projectId, p_actor: context.userId, p_intent_key: input.intentKey,
    p_plan_keys: input.planKeys.map((key) => key.toLowerCase()), p_list_revision_id: input.listRevisionId,
    p_targets: input.targets as unknown as Json, p_selection: sealedSelectionValue(input.selection),
    p_confirmation: input.confirmation as unknown as Json,
  });
  if (error) remeasureError(error);
  const row = (data as Array<{ outcome: string; request_id: string | null }> | null)?.[0];
  return row ? { outcome: row.outcome as "replayed" | "already_running", requestId: row.request_id } : null;
}
