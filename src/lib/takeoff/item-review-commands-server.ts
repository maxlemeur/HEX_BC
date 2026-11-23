import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { readLocalChatGptSubscription, type LocalChatGptSubscriptionIssue } from "@/lib/ai/chatgpt-takeoff";
import { requireAffaireAccess, type AffaireAccess } from "@/lib/affaires/access-server";
import { conflict, forbidden, mapSupabaseError, unprocessableEntity } from "@/lib/http/api-response";
import { recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import { noteLength } from "@/lib/takeoff/rules/verification";
import { asRecord } from "@/lib/value-guards";
import type { Database } from "@/types/database";
import { quantityEntryError } from "./quantity-entry";
import { ITEM_INELIGIBILITIES, planItemReviewCommand, type ItemIneligibility, type ItemTableScope } from "./item-table";
import {
  ITEM_SET_ASIDE_NOTE,
  type ItemRemeasureCommand,
  type ItemRemeasurePreview,
  type ItemRemeasureResult,
  type ItemRemeasureSeen,
  type ItemReviewCommand,
  type ItemReviewResult,
} from "./item-table-contracts";
import { itemReviewerRight, loadItemLines } from "./item-table-server";
import { describePosteReadingBounds } from "./poste-reading-bounds-text";
import {
  launchTakeoffItemRemeasure,
  planTakeoffItemRemeasure,
  replayTakeoffItemRemeasure,
  type TakeoffItemRemeasurePlan,
  type TakeoffItemRemeasureTargets,
} from "./item-remeasure-server";
import { readAffaireTakeoffLaunchState } from "./launch-request-server";
import type { TakeoffExecutionSelection } from "./preparation";

/**
 * The one commands module of the table of items (lot 4): the bulk gestures (accept the measured items without anomaly,
 * set the selection aside, reinstate it), the complementary entry and the inclusion of an entered hypothesis, and the
 * preview of a new measure of the selection. A command names its targets (each current answer with its decision's
 * revision, the scope's entry with its revision); the server builds the lines again and sends the items it finds
 * eligible; the database (public.review_takeoff_items, in the member's session) answers the receipt of the same command
 * first, then compares every target again under its lock, re-checks each gesture's rules, and writes the decisions, the
 * entries, their effects on the answers' positive rows and the journal in one transaction. A stale selection writes
 * nothing and names its items. No gesture forces anything, ever.
 *
 * A new measure of a selection (lot 4 PR 4b) is a manual request of one analysis per plan that asks the selected items
 * only: its preview plans it (calls, budget) without writing, its confirmation plans it again, compares, and admits it
 * through public.launch_takeoff_item_remeasure, which compares the selection's readings again under its locks.
 */

type Client = SupabaseClient<Database>;

export const ITEM_REVIEW_STALE = "TAKEOFF_ITEM_REVIEW_STALE";

const FORBIDDEN = "Seul un opérateur du métré de l’affaire peut revoir les postes.";

async function requireReviewer(projectId: string): Promise<AffaireAccess> {
  const access = await requireAffaireAccess(projectId, "read");
  if (!await itemReviewerRight(access)) throw forbidden(FORBIDDEN, undefined, "TAKEOFF_ITEM_REVIEW_FORBIDDEN");
  return access;
}

function invalid(message: string): never {
  throw unprocessableEntity(message, undefined, "VALIDATION_ERROR");
}

/** What the request itself must hold before anything is read: one target per item, a value per item entered. */
function assertCommandShape(command: ItemReviewCommand) {
  const ids = command.targets.map(({ itemId }) => itemId.toLowerCase());
  if (new Set(ids).size !== ids.length) invalid("Un poste figure deux fois dans la sélection.");
  if (command.gesture === "accept_measured" && command.quantity_choice && (command.targets.length !== 1 || command.scope.kind !== "plan")) {
    throw unprocessableEntity("Choisissez la quantité pour un seul poste sur son plan.");
  }
  if (command.gesture === "set_aside") {
    const length = noteLength(command.note ?? "");
    if (command.reason === "other" && (length < ITEM_SET_ASIDE_NOTE.min || length > ITEM_SET_ASIDE_NOTE.max)) {
      invalid(`Le motif « Autre » s’accompagne d’une note (${ITEM_SET_ASIDE_NOTE.min} à ${ITEM_SET_ASIDE_NOTE.max} caractères).`);
    }
    if (length > ITEM_SET_ASIDE_NOTE.max) invalid(`La note tient en ${ITEM_SET_ASIDE_NOTE.max} caractères au plus.`);
  }
  if (command.gesture === "enter_quantity") {
    const valued = command.values.map(({ item_id }) => item_id.toLowerCase());
    if (new Set(valued).size !== valued.length || valued.length !== ids.length || valued.some((id) => !ids.includes(id))) {
      invalid("Chaque poste de la sélection reçoit sa propre valeur, saisie à part.");
    }
    const error = quantityEntryError(command.entry);
    if (error) invalid(error);
  }
}

function staleRefusal(stale: Array<{ itemId: string; label: string | null }>): never {
  throw conflict("Des postes de la sélection ont changé depuis son affichage : rien n’a été appliqué. Rafraîchissez la sélection.",
    { stale }, ITEM_REVIEW_STALE);
}

/** The refusals of public.review_takeoff_items, by their own code: a fixed French answer, never the database's text. */
function reviewFailure(error: { message?: string }): never {
  switch (error.message?.trim()) {
    case "TAKEOFF_ITEM_REVIEW_FORBIDDEN": throw forbidden(FORBIDDEN, undefined, "TAKEOFF_ITEM_REVIEW_FORBIDDEN");
    case "TAKEOFF_ITEM_REVIEW_INVALID": throw unprocessableEntity("Commande de revue invalide.", undefined, "VALIDATION_ERROR");
    case "TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT":
      throw conflict("Cette décision a déjà été envoyée avec un autre contenu : rechargez la page avant de recommencer.",
        undefined, "TAKEOFF_ITEM_REVIEW_INTENT_CONFLICT");
    default: throw mapSupabaseError(error as Parameters<typeof mapSupabaseError>[0], "Impossible d’enregistrer la décision sur les postes.");
  }
}

const isIneligibility = (value: unknown): value is ItemIneligibility => (ITEM_INELIGIBILITIES as readonly unknown[]).includes(value);

/**
 * A set aside or a reinstatement changed the exclusion of positive rows, which the rules read: their rules (and their
 * peers') wait for the server. The database names those jobs in its answer, kept in the command's receipt; the server
 * computes their rules again now, as a member's save of a row does (item-patch-server.ts), for the version of a job
 * sent, or else the job, and again on a replay of the same command, so that a refresh a stopped server owed is finished
 * without deciding anything twice. Best effort: a failed computation leaves them waiting, as it does there.
 */
async function refreshRulesOfJobs(access: AffaireAccess, jobIds: readonly string[]) {
  if (!jobIds.length) return;
  const { data, error } = await (access.context.supabase as unknown as Client).from("takeoff_jobs")
    .select("id, estimate_version_id, project_id").eq("tenant_id", access.context.tenantId).in("id", [...jobIds]);
  if (error) return;
  const tenantId = access.context.tenantId;
  const versions = [...new Set((data ?? []).flatMap(({ estimate_version_id }) => estimate_version_id ? [estimate_version_id] : []))];
  for (const estimateVersionId of versions.sort()) {
    await recomputeTakeoffRulesQuietly({ tenantId, estimateVersionId, context: "item_review" });
  }
  for (const job of [...(data ?? [])].sort((left, right) => left.id.localeCompare(right.id))) {
    if (job.estimate_version_id === null && job.project_id) {
      await recomputeTakeoffRulesQuietly({ tenantId, jobId: job.id, projectId: job.project_id, context: "item_review" });
    }
  }
}

/** A command's identifiers as the database writes and compares them as text (its targets against what it applies). */
function lowerIdentifiers(command: ItemReviewCommand): ItemReviewCommand {
  const targets = command.targets.map((target) => ({ ...target, itemId: target.itemId.toLowerCase(),
    answers: target.answers.map((answer) => ({ ...answer, answerId: answer.answerId.toLowerCase() })) }));
  return command.gesture === "enter_quantity"
    ? { ...command, targets, values: command.values.map((value) => ({ ...value, item_id: value.item_id.toLowerCase() })) }
    : { ...command, targets };
}

export async function runItemReviewCommand(projectId: string, received: ItemReviewCommand): Promise<ItemReviewResult> {
  assertCommandShape(received);
  const command = lowerIdentifiers(received);
  const access = await requireReviewer(projectId);
  const itemIds = command.targets.map(({ itemId }) => itemId);
  const { lines } = await loadItemLines(access, { scope: command.scope, itemIds });
  const labels = new Map(lines.map((line) => [line.itemId, line.label]));
  const plan = planItemReviewCommand(lines, command);
  // A stale selection still goes to the database, the same command already recorded answering what it answered; it goes
  // with every item to apply, never with none, so that the database records no command that applied nothing on a stale
  // selection: it answers the receipt of the same command, refuses the selection as stale (its predicate is the
  // planner's), or applies the whole selection it finds current and eligible under its lock.
  const apply = plan.kind === "planned" ? plan.apply.map(({ itemId }) => itemId) : itemIds;
  const skipped = plan.kind === "planned" ? plan.skipped.map(({ itemId, label, reason }) => ({ item_id: itemId, label, reason })) : [];
  const { data, error } = await (access.context.supabase as unknown as Client).rpc("review_takeoff_items", {
    p_tenant_id: access.context.tenantId, p_project_id: access.project.id,
    p_command: {
      command_version: command.command_version,
      intent_key: command.intent_key,
      gesture: command.gesture,
      scope: command.scope.kind === "plan" ? { kind: "plan", plan_logical_id: command.scope.planKey } : { kind: "affaire" },
      targets: command.targets.map((target) => ({ item_id: target.itemId, entry_revision: target.entryRevision,
        answers: target.answers.map((answer) => ({ answer_id: answer.answerId, decision_revision: answer.decisionRevision,
          entry_revision: answer.entryRevision, ...(answer.marksRevision !== undefined ? { marks_revision: answer.marksRevision } : {}) })) })),
      apply,
      skipped,
      ...(command.gesture === "accept_measured" && command.quantity_choice ? { quantity_choice: command.quantity_choice } : {}),
      ...(command.gesture === "set_aside" ? { reason: command.reason, ...(command.note?.trim() ? { note: command.note.trim() } : {}) } : {}),
      ...(command.gesture === "enter_quantity" ? { values: command.values, entry: command.entry } : {}),
    },
  });
  if (error) reviewFailure(error);
  const answer = asRecord(data) ?? {};
  if (answer.outcome === "stale") {
    const stale = Array.isArray(answer.stale) ? answer.stale.map(String) : itemIds;
    staleRefusal(stale.map((itemId) => ({ itemId, label: labels.get(itemId) ?? null })));
  }
  const applied = Array.isArray(answer.applied) ? answer.applied.map((entry) => {
    const row = asRecord(entry) ?? {};
    const itemId = String(row.item_id);
    return { itemId, label: labels.get(itemId) ?? "Poste", answers: Number(row.answers) || 0 };
  }) : [];
  const left = Array.isArray(answer.skipped) ? answer.skipped.flatMap((entry) => {
    const row = asRecord(entry) ?? {};
    return isIneligibility(row.reason) ? [{ itemId: String(row.item_id), label: String(row.label ?? "Poste"), reason: row.reason }] : [];
  }) : [];
  await refreshRulesOfJobs(access, Array.isArray(answer.rules_jobs) ? answer.rules_jobs.map(String) : []);
  return { outcome: answer.replayed === true ? "replayed" : "applied", applied, skipped: left };
}

const SUBSCRIPTION_REASONS: Record<LocalChatGptSubscriptionIssue, string> = {
  LOCAL_RUNTIME_REQUIRED: "Le forfait ChatGPT s’utilise dans MergeOne local, sur le Mac connecté.",
  HOST_NOT_AUTHORISED: "Cette adresse ne peut pas utiliser le forfait ChatGPT. Ouvrez MergeOne sur le Mac connecté.",
  CHATGPT_NOT_CONNECTED: "Connectez votre forfait ChatGPT dans Mon profil avant de demander une nouvelle mesure.",
  CHATGPT_ACCESS_REVOKED: "Reconnectez votre forfait ChatGPT dans Mon profil : la connexion a expiré ou le partage a été révoqué.",
  CHATGPT_MODEL_MISSING: "Choisissez un modèle ChatGPT dans Mon profil avant de demander une nouvelle mesure.",
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return "{" + Object.entries(value).filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : Number(left > right))
    .map(([key, entry]) => JSON.stringify(key) + ":" + canonical(entry)).join(",") + "}";
}

async function payerName(access: AffaireAccess) {
  const { data, error } = await (access.context.supabase as unknown as Client).from("profiles").select("full_name")
    .eq("id", access.context.userId).maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire le membre qui confirme.");
  return data?.full_name?.trim() || null;
}

/**
 * What a new measure of the selection asks and who pays: the member who confirms, on their own subscription, with the
 * model and effort of their profile; the plans and items; the paid calls and the budget the admission will take; those a
 * new measure leaves out. The affaire's current confirmed preparation gives its content when it is admitted; the member
 * is not asked to confirm the brief again. Its digest holds what the member confirms: the payer and the setting, the
 * plans, the items, the list's revision and each item's current readings on those plans, the calls and the budget, and
 * the preparation it was planned on (its revision, each plan's sealed copy, identity, bytes and pages).
 */
async function remeasurePreview(input: { scope: ItemTableScope; itemIds: string[]; seen: ItemRemeasureSeen }, access: AffaireAccess) {
  const { lines, plans: affairePlans, list } = await loadItemLines(access, { scope: input.scope, itemIds: input.itemIds, withPlans: true });
  const byId = new Map(lines.map((line) => [line.itemId, line]));
  const missing = input.itemIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw conflict("Des postes de la sélection ne sont plus dans la liste : rafraîchissez la sélection.",
      { stale: missing.map((itemId) => ({ itemId, label: null })) }, ITEM_REVIEW_STALE);
  }
  const selected = [...new Set(input.itemIds)].map((id) => byId.get(id)!);
  // What the member saw is what is measured again: a reading replaced since the line was shown (or the list revised) is
  // named, and nothing is admitted on it, never the reading the server finds now.
  const seenOnLines = seenAnswers(input.seen);
  const listMoved = (input.seen.list_revision_id ?? "").toLowerCase() !== (list?.revisionId ?? "").toLowerCase();
  const changed = selected.filter((line) => listMoved || seenOnLines.get(line.itemId.toLowerCase())?.join()
    !== line.targets.answers.map(({ answerId }) => answerId.toLowerCase()).sort().join());
  if (changed.length) staleRefusal(changed.map(({ itemId, label }) => ({ itemId, label })));
  const eligible = selected.filter(({ eligibility }) => eligibility.remeasure.eligible);
  const planKeys = new Set(eligible.flatMap(({ remeasurePlans }) => remeasurePlans));
  const names = new Map([...affairePlans.map(({ key, name }) => [key, name] as const),
    ...selected.flatMap(({ readings }) => readings.map(({ planKey, planName }) => [planKey, planName] as const))]);
  const plans = [...planKeys].map((key) => ({ key, name: names.get(key) ?? "Plan" }))
    .sort((left, right) => left.name.localeCompare(right.name, "fr", { numeric: true }));
  const [name, subscription, launch] = await Promise.all([
    payerName(access),
    readLocalChatGptSubscription({ userId: access.context.userId, tenantId: access.context.tenantId },
      (await headers()).get("host")),
    readAffaireTakeoffLaunchState(access.context, access.project.id),
  ]);
  const shown: ItemRemeasurePreview["subscription"] = subscription.issue
    ? { state: "unavailable", reason: SUBSCRIPTION_REASONS[subscription.issue] }
    : { state: "ready", model: subscription.selection.model, reasoningEffort: subscription.selection.reasoningEffort ?? null };
  const items = eligible.map(({ itemId, label }) => ({ itemId, label }));
  const payer = { memberId: access.context.userId, name };
  // What the request would read and reserve, planned as its admission plans it (nothing written).
  const planned = items.length && plans.length
    ? await planTakeoffItemRemeasure(access.context, { projectId: access.project.id, planKeys: plans.map(({ key }) => key),
      itemIds: items.map(({ itemId }) => itemId), selection: null })
    : null;
  const reading: ItemRemeasurePreview["reading"] = !planned ? { state: "refused", reason: "Aucun poste de la sélection ne peut être mesuré de nouveau." }
    : "refusal" in planned ? { state: "refused", reason: planned.refusal }
      : { state: "ready", summary: describePosteReadingBounds({ ...planned.plan.bounds, ok: true }), calls: planned.plan.bounds.calls,
        budgetTokens: planned.plan.manifest.budget.tokens };
  // Each item's answers as the member saw them (the same as stored now, compared above): what the database compares again
  // under its locks, and what identifies the confirmation.
  const targets = remeasureTargets(items.map(({ itemId }) => itemId), input.seen);
  return {
    preview: {
      items,
      plans,
      payer,
      subscription: shown,
      reading,
      running: launch.request?.state === "admitted",
      previewDigest: createHash("sha256").update(canonical({ contract: 3, scope: input.scope, payer: payer.memberId,
        subscription: shown, plans: plans.map(({ key }) => key), items: items.map(({ itemId }) => itemId),
        list: list?.revisionId ?? null, readings: targets,
        reading: reading.state === "ready" ? { calls: reading.calls, budgetTokens: reading.budgetTokens } : reading,
        // The preparation it was planned on: its revision and each plan as sealed (its copy, identity, bytes and pages).
        prepared: planned && "plan" in planned ? { revision: planned.plan.preparationRevision,
          plans: planned.plan.manifest.plans.map((plan) => [plan.plan_file_id, plan.logical_id, plan.content_sha256, plan.pages,
            plan.page_count]) } : null })).digest("hex"),
      skipped: selected.filter(({ eligibility }) => !eligibility.remeasure.eligible)
        .map(({ itemId, label, eligibility }) => ({ itemId, label, reason: eligibility.remeasure.reason! })),
    } satisfies ItemRemeasurePreview,
    targets,
    planned: planned && "plan" in planned ? planned.plan : null,
    selection: subscription.issue ? null : subscription.selection,
    labels: new Map(selected.map(({ itemId, label }) => [itemId.toLowerCase(), label])),
  };
}

/** Each item's answers as its line showed them, by item, in their order. */
function seenAnswers(seen: ItemRemeasureSeen) {
  return new Map(seen.targets.map((target) => [target.itemId.toLowerCase(),
    target.answers.map(({ answerId }) => answerId.toLowerCase()).sort()]));
}

/** The targets of a confirmation: each item measured again with its answers as the member saw them. */
function remeasureTargets(itemIds: readonly string[], seen: ItemRemeasureSeen): TakeoffItemRemeasureTargets {
  const shown = seenAnswers(seen);
  return [...new Set(itemIds.map((id) => id.toLowerCase()))].sort()
    .map((itemId) => ({ item_id: itemId, answers: shown.get(itemId) ?? [] }));
}

/** The plan made for the admission is the plan the member confirmed: same revisions, scope, items, calls and budget. */
function samePlan(confirmed: TakeoffItemRemeasurePlan, admitted: TakeoffItemRemeasurePlan) {
  const identity = (plan: TakeoffItemRemeasurePlan) => JSON.stringify([plan.preparationRevision, plan.listRevisionId, plan.planSetId,
    [...plan.planFileIds].sort(), [...plan.planKeys].sort(), plan.askedItemIds, plan.bounds.calls, plan.manifest.budget.tokens,
    plan.manifest.budget.cost_cents]);
  return identity(confirmed) === identity(admitted);
}

/**
 * The setting this confirmation seals: the profile's, as it is. The Mac reads a request with its payer's profile and
 * refuses one sealed with another effort (resolveLocalTakeoffProvider), so an effort for this request alone is not offered
 * yet: a confirmation naming one is refused here, before anything is replayed, planned or written.
 */
function sealedSelection(selection: TakeoffExecutionSelection, setting: ItemRemeasureCommand["setting"]): TakeoffExecutionSelection {
  if (setting?.reasoning_effort && setting.reasoning_effort !== (selection.reasoningEffort ?? null)) {
    invalid("Cette demande utilise le réglage de Mon profil : un autre effort pour elle seule n’est pas encore possible. Rouvrez l’aperçu et confirmez avec le réglage de Mon profil.");
  }
  return selection;
}

/** What a remeasure of the selection would ask, and who would pay: shown before its explicit confirmation. Reads only. */
export async function previewItemRemeasure(projectId: string, input: { scope: ItemTableScope; itemIds: string[]; seen: ItemRemeasureSeen }) {
  const access = await requireReviewer(projectId);
  return (await remeasurePreview(input, access)).preview;
}

/**
 * A new manual request of the member who confirms, on their own subscription, for the items and plans the preview showed;
 * it may hold one item. The same confirmation sent again answers the request it admitted. Otherwise the preview is made
 * again and must be the one confirmed (payer, setting, plans, items, readings, calls and budget); the request is planned
 * with the profile's setting as it is (sealedSelection), and the database compares the readings once more under its locks.
 */
export async function runItemRemeasure(projectId: string, command: ItemRemeasureCommand): Promise<ItemRemeasureResult> {
  // The member's right first (requireReviewer: the right to launch on the affaire), a replay included.
  const access = await requireReviewer(projectId);
  const confirmation = { preview_digest: command.preview_digest, setting: command.setting };
  // A lost answer sent again: replayed by what the member confirmed alone, before anything is planned (the items it
  // admitted read « En lecture » since); another confirmation under the key is the database's conflict.
  const subscription = await readLocalChatGptSubscription({ userId: access.context.userId, tenantId: access.context.tenantId },
    (await headers()).get("host"));
  if (!subscription.issue && command.seen.list_revision_id) {
    const replayed = await replayTakeoffItemRemeasure(access.context, { projectId: access.project.id, intentKey: command.intent_key,
      planKeys: command.plan_keys, listRevisionId: command.seen.list_revision_id, targets: remeasureTargets(command.item_ids, command.seen),
      selection: sealedSelection(subscription.selection, command.setting), confirmation });
    if (replayed) return replayed;
  }
  const { preview, targets, selection, labels, planned: confirmed } = await remeasurePreview({ scope: command.scope,
    itemIds: command.item_ids, seen: command.seen }, access);
  const shownPlans = preview.plans.map(({ key }) => key);
  if (preview.previewDigest !== command.preview_digest || shownPlans.join() !== command.plan_keys.join()) {
    throw conflict("Le payeur, le réglage, les plans, les postes ou leurs lectures ont changé depuis l’aperçu : vérifiez-le de nouveau avant de confirmer.",
      undefined, ITEM_REVIEW_STALE);
  }
  if (preview.subscription.state === "unavailable" || !selection) {
    throw unprocessableEntity(preview.subscription.state === "unavailable" ? preview.subscription.reason
      : "Votre forfait ChatGPT n’est pas disponible sur ce Mac.", undefined, "AI_PROVIDER");
  }
  if (!preview.items.length) invalid("Aucun poste de la sélection ne peut être mesuré de nouveau.");
  if (preview.reading.state === "refused" || !confirmed) {
    invalid(preview.reading.state === "refused" ? preview.reading.reason : "Aucun poste de la sélection ne peut être mesuré de nouveau.");
  }
  // The profile's setting, sealed in the request's selection as it is (another effort was refused above); the profile is not changed.
  const sealed = sealedSelection(selection, command.setting);
  const planned = await planTakeoffItemRemeasure(access.context, { projectId: access.project.id, planKeys: shownPlans,
    itemIds: preview.items.map(({ itemId }) => itemId), selection: sealed });
  const items = preview.items.map(({ itemId, label }) => ({ itemId, label }));
  if ("refusal" in planned) {
    if (planned.stale) staleRefusal(items);
    invalid(planned.refusal);
  }
  // What is admitted is what was confirmed: a plan made since on other revisions, plans, calls or budget is stale.
  if (!samePlan(confirmed, planned.plan)) staleRefusal(items);
  const answer = await launchTakeoffItemRemeasure(access.context, { projectId: access.project.id, intentKey: command.intent_key,
    plan: planned.plan, selection: sealed, targets, confirmation, host: (await headers()).get("host") });
  if (answer.outcome === "stale") {
    staleRefusal(answer.stale.map((itemId) => ({ itemId, label: labels.get(itemId.toLowerCase()) ?? null })));
  }
  return { outcome: answer.outcome, requestId: answer.requestId };
}
