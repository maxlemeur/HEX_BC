import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { getTakeoffLevelCProcessingConfigForTenant, takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import { sealedMeasuringOrder } from "@/lib/takeoff/item-list-seal-server";
import { TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "@/lib/takeoff/launch-call-ledger";
import {
  describeTakeoffLaunchReason, splitTakeoffLaunchManifest, type TakeoffLaunchOrder, type TakeoffPlanLaunchManifest,
} from "@/lib/takeoff/launch-request";
import {
  countUnstoredPlanPages, databaseError, dispatchLaunchRequestJobs, launchError, logicalPlanKey, planPagesPastLimit,
  planSetCopiesSetAside, planUnitJobs, readPlansAnalysedBefore, relaunchManifest, sealedPlanSetId,
} from "@/lib/takeoff/launch-request-server";
import { posteReadingRefusal, postesAskedBy, sizePosteReadingManifest, type PosteReadingBounds } from "@/lib/takeoff/poste-reading-bounds";
import {
  createTakeoffPreparationSnapshot, TakeoffPreparationNotReadyError, type TakeoffExecutionSelection, type TakeoffPreparationSnapshot,
} from "@/lib/takeoff/preparation";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { takeoffVectorGroupCallsBound } from "@/lib/takeoff/vectors/worker-server";
import type { Json } from "@/types/database";

// Lot 4 PR 4b: the new measure of a selection of items from the table of items — its plan (for the preview and the
// admission), its admission (public.launch_takeoff_item_remeasure) and its receipt — on the launch's own planning
// (launch-request-server.ts: the relaunch's manifest, the plan set's copies, the units' jobs and their dispatch).

type Context = AuthenticatedTenantContext;

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
  predecessorJobId: string;
  listRevisionId: string;
  askedItemIds: string[];
  snapshot: TakeoffPreparationSnapshot;
  manifest: TakeoffPlanLaunchManifest;
  bounds: PosteReadingBounds;
};

export async function planTakeoffItemRemeasure(context: Context, input: {
  projectId: string; planKeys: readonly string[]; itemIds: readonly string[]; selection: TakeoffExecutionSelection | null;
}): Promise<{ plan: TakeoffItemRemeasurePlan } | { refusal: string; stale?: boolean }> {
  const service = createServiceRoleClient();
  const { data: record, error } = await service.from("takeoff_preparations").select("revision")
    .eq("tenant_id", context.tenantId).eq("project_id", input.projectId).maybeSingle();
  if (error) databaseError(error, "Impossible de lire la préparation du métré de l’affaire.");
  if (!record) return { refusal: "La préparation du métré de l’affaire n’est pas confirmée : confirmez-la avant une nouvelle mesure." };
  let confirmed: TakeoffPreparationSnapshot;
  try {
    confirmed = await assertConfirmedTakeoffPreparation({ context, estimateVersionId: null, projectId: input.projectId,
      preparationRevision: record.revision, level: "C", provider: "chatgpt" });
  } catch (caught) {
    if (caught instanceof TakeoffError) return { refusal: caught.message };
    throw caught;
  }
  const planSetId = sealedPlanSetId(confirmed);
  if (!planSetId) return { refusal: "La préparation confirmée ne retient aucun plan à lire." };
  const config = await getTakeoffLevelCProcessingConfigForTenant(context.tenantId, { supabase: service });
  const order = await sealedMeasuringOrder(service, { tenantId: context.tenantId, projectId: input.projectId, payerId: context.userId,
    perPlan: true });
  if ("blocked" in order || order.order.kind !== "item_list") {
    return { refusal: "Les postes ne sont pas encore lus contre la liste, plan par plan : aucune nouvelle mesure n’est possible." };
  }
  // The selection's plans, by their logical key, at their current copies in the confirmed preparation.
  const everyPlan = await relaunchManifest(service, context, planSetId, confirmed, config, "reread_plans", [], order.order);
  const copyOf = new Map(everyPlan.manifest.plans.map((plan) => [plan.logical_id.toLowerCase(), plan.plan_file_id]));
  const scope = input.planKeys.map((key) => copyOf.get(key.toLowerCase()));
  if (!scope.length || scope.some((id) => !id)) {
    return { refusal: "Un plan de la sélection ne fait plus partie de la préparation confirmée : rouvrez l’aperçu.", stale: true };
  }
  // The order seals the items asked by identifier, in their canonical order; they are read and sized in the list's.
  const asked = [...new Set(input.itemIds.map((id) => id.toLowerCase()))].sort();
  const askedItems = postesAskedBy(order.items, asked);
  if (!asked.length || !askedItems) {
    return { refusal: "Un poste de la sélection n’est plus dans la liste : rafraîchissez la sélection.", stale: true };
  }
  let snapshot: TakeoffPreparationSnapshot;
  try {
    snapshot = createTakeoffPreparationSnapshot({
      preparation: { ...confirmed.preparation, sources: confirmed.preparation.sources.map((source) =>
        source.kind === "plan" && source.active && !scope.includes(source.document_id) ? { ...source, active: false } : source) },
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
  const pastLimit = snapshot.preparation.sources.filter((source) => source.kind === "plan" && source.active
    && (source.page_count ?? countedPages.get(source.document_id) ?? 0) > config.maxPdfPages);
  if (pastLimit.length) return { refusal: planPagesPastLimit(pastLimit, config.maxPdfPages).message };
  // The order seals the latest revision, and the items asked; the other plans an earlier analysis read stay its.
  const sealed: TakeoffLaunchOrder = { ...order.order, list: { ...order.order.list, asked_item_ids: asked } };
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
  // The analysis it re-reads: the latest of its plans', else the affaire's latest.
  const latest = async (keys: string[] | null) => {
    let query = service.from("takeoff_jobs").select("id").eq("tenant_id", context.tenantId).eq("project_id", input.projectId);
    if (keys) query = query.in("launch_unit_key", keys);
    const { data, error: jobError } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
    if (jobError) databaseError(jobError, "Impossible de lire les analyses de l’affaire.");
    return data?.[0]?.id ?? null;
  };
  const predecessorJobId = await latest(sized.manifest.plans.map((plan) => `plan:${plan.plan_file_id.toLowerCase()}`)) ?? await latest(null);
  if (!predecessorJobId) return { refusal: "L’affaire n’a encore aucune analyse : lancez d’abord le métré de l’affaire." };
  return { plan: { planSetId, preparationRevision: confirmed.preparation_revision,
    planFileIds: sized.manifest.plans.map((plan) => plan.plan_file_id),
    planKeys: sized.manifest.plans.map((plan) => plan.logical_id), predecessorJobId, listRevisionId: order.order.list.revision_id,
    askedItemIds: asked, snapshot, manifest: sized.manifest, bounds: sized.bounds } };
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
    case "TAKEOFF_ITEM_REMEASURE_INVALID":
      throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
        message: "La demande de nouvelle mesure est invalide : rouvrez l’aperçu." });
    case "TAKEOFF_LAUNCH_SEAL_INVALID":
      throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
        message: "La préparation du métré ou la liste des postes a changé depuis l’aperçu : rouvrez-le avant de confirmer." });
  }
  launchError(error, "Impossible de lancer la nouvelle mesure.");
}

/**
 * The admission (public.launch_takeoff_item_remeasure, with the server's client): one analysis per plan of the plan,
 * jobs derived from the command, and the targets the member saw (each item's current answers on those plans), which the
 * database compares under its locks. Its jobs are handed to the Mac once admitted.
 */
export async function launchTakeoffItemRemeasure(context: Context, input: {
  projectId: string; intentKey: string; plan: TakeoffItemRemeasurePlan; selection: TakeoffExecutionSelection;
  targets: Array<{ item_id: string; answers: string[] }>; host?: string | null;
}): Promise<TakeoffItemRemeasureAdmission> {
  const service = createServiceRoleClient();
  const { plan } = input;
  const units = await planUnitJobs(service, { tenantId: context.tenantId, planSetId: plan.planSetId,
    jobKey: `takeoff-item-remeasure:${input.projectId}:${input.intentKey}`, hostId: input.selection.hostId, manifest: plan.manifest });
  const { data, error } = await service.rpc("launch_takeoff_item_remeasure", {
    p_tenant_id: context.tenantId, p_project_id: input.projectId, p_actor: context.userId, p_intent_key: input.intentKey,
    p_predecessor_job_id: plan.predecessorJobId, p_host: input.selection.hostId,
    p_selection: plan.snapshot.execution_selection as unknown as Json, p_manifest: units.manifest as unknown as Json,
    p_snapshot: plan.snapshot as unknown as Json, p_jobs: units.jobs as unknown as Json, p_plan_set_id: plan.planSetId,
    p_preparation_revision: plan.preparationRevision, p_plan_file_ids: plan.planFileIds,
    p_targets: input.targets as unknown as Json, p_module_default: takeoffModuleDefault(),
  });
  if (error) remeasureError(error);
  const row = (data as Array<{ outcome: string; request_id: string | null; stale: string[] | null }> | null)?.[0];
  if (!row) throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false,
    message: "Impossible de lancer la nouvelle mesure." });
  if (row.outcome === "stale") return { outcome: "stale", stale: row.stale ?? [] };
  if (row.outcome === "admitted") await dispatchLaunchRequestJobs({ jobIds: units.jobs.map((job) => job.id), host: input.host ?? null });
  return { outcome: row.outcome as "admitted" | "replayed" | "already_running", requestId: row.request_id };
}

/** What a request admitted under a confirmation's key sealed: its payer, the items it asks, its plans and its effort. */
export type TakeoffItemRemeasureReceipt = {
  requestId: string; payerId: string | null; askedItemIds: string[]; planKeys: string[]; reasoningEffort: string | null;
};

/**
 * A confirmation already admitted under its key (a lost answer sent again): the request it admitted, with what it sealed,
 * so that the caller replays only the same confirmation (the database's digest, which holds the readings the member saw,
 * cannot be computed again once the request's own reading replaced them).
 */
export async function readTakeoffItemRemeasureReceipt(context: Context, input: { projectId: string; intentKey: string }):
  Promise<TakeoffItemRemeasureReceipt | null> {
  const service = createServiceRoleClient();
  const { data, error } = await service.from("takeoff_launch_requests").select("id, payer_id, manifest, mandate_selection")
    .eq("tenant_id", context.tenantId).eq("project_id", input.projectId).eq("intent_key", input.intentKey).maybeSingle();
  if (error) databaseError(error, "Impossible de lire la demande de nouvelle mesure.");
  if (!data) return null;
  const manifest = (data.manifest ?? {}) as { order?: { list?: { asked_item_ids?: unknown } }; plans?: Array<{ logical_id?: unknown }> };
  const asked = manifest.order?.list?.asked_item_ids;
  const selection = (data.mandate_selection ?? {}) as { reasoningEffort?: unknown };
  return {
    requestId: data.id, payerId: data.payer_id,
    askedItemIds: Array.isArray(asked) ? asked.filter((id): id is string => typeof id === "string") : [],
    planKeys: (manifest.plans ?? []).flatMap(({ logical_id: key }) => typeof key === "string" ? [key.toLowerCase()] : []),
    reasoningEffort: typeof selection.reasoningEffort === "string" ? selection.reasoningEffort : null,
  };
}
