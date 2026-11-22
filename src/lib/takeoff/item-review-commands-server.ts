import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { readLocalChatGptSubscription, type LocalChatGptSubscriptionIssue } from "@/lib/ai/chatgpt-takeoff";
import { requireAffaireAccess, type AffaireAccess } from "@/lib/affaires/access-server";
import { ApiError, conflict, forbidden, mapSupabaseError, unprocessableEntity } from "@/lib/http/api-response";
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
  type ItemReviewCommand,
  type ItemReviewResult,
} from "./item-table-contracts";
import { itemReviewerRight, loadItemLines } from "./item-table-server";
import { readAffaireTakeoffLaunchState } from "./launch-request-server";

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
 * The admission of a new measure is its own pull request (it extends the manual request of one analysis per plan):
 * until then `admitItemRemeasure` refuses, nothing admitted and nothing spent.
 */

type Client = SupabaseClient<Database>;

export const ITEM_REVIEW_UNAVAILABLE = "TAKEOFF_ITEM_REVIEW_UNAVAILABLE";
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

export async function runItemReviewCommand(projectId: string, command: ItemReviewCommand): Promise<ItemReviewResult> {
  assertCommandShape(command);
  const access = await requireReviewer(projectId);
  const itemIds = command.targets.map(({ itemId }) => itemId.toLowerCase());
  const { lines } = await loadItemLines(access, { scope: command.scope, itemIds });
  const labels = new Map(lines.map((line) => [line.itemId, line.label]));
  const plan = planItemReviewCommand(lines, { gesture: command.gesture, targets: command.targets });
  // A stale selection still goes to the database: the same command already recorded answers what it answered.
  const apply = plan.kind === "planned" ? plan.apply.map(({ itemId }) => itemId) : [];
  const skipped = plan.kind === "planned" ? plan.skipped.map(({ itemId, label, reason }) => ({ item_id: itemId, label, reason })) : [];
  const { data, error } = await (access.context.supabase as unknown as Client).rpc("review_takeoff_items", {
    p_tenant_id: access.context.tenantId, p_project_id: access.project.id,
    p_command: {
      command_version: command.command_version,
      intent_key: command.intent_key,
      gesture: command.gesture,
      scope: command.scope.kind === "plan" ? { kind: "plan", plan_logical_id: command.scope.planKey } : { kind: "affaire" },
      targets: command.targets.map((target) => ({ item_id: target.itemId, entry_revision: target.entryRevision,
        answers: target.answers.map((answer) => ({ answer_id: answer.answerId, decision_revision: answer.decisionRevision })) })),
      apply,
      skipped,
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
 * model and effort of their profile; the plans and items; those a new measure leaves out. The affaire's current confirmed
 * preparation gives its content when it is admitted; the member is not asked to confirm the brief again.
 */
async function remeasurePreview(input: { scope: ItemTableScope; itemIds: string[] }, access: AffaireAccess) {
  const { lines, plans: affairePlans } = await loadItemLines(access, { scope: input.scope, itemIds: input.itemIds, withPlans: true });
  const byId = new Map(lines.map((line) => [line.itemId, line]));
  const missing = input.itemIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw conflict("Des postes de la sélection ne sont plus dans la liste : rafraîchissez la sélection.",
      { stale: missing.map((itemId) => ({ itemId, label: null })) }, ITEM_REVIEW_STALE);
  }
  const selected = [...new Set(input.itemIds)].map((id) => byId.get(id)!);
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
  return {
    items,
    plans,
    payer,
    subscription: shown,
    running: launch.request?.state === "admitted",
    // What the member confirms: who pays, with which setting, which plans and which items.
    previewDigest: createHash("sha256").update(canonical({ contract: 1, scope: input.scope, payer: payer.memberId,
      subscription: shown, plans: plans.map(({ key }) => key), items: items.map(({ itemId }) => itemId) })).digest("hex"),
    skipped: selected.filter(({ eligibility }) => !eligibility.remeasure.eligible)
      .map(({ itemId, label, eligibility }) => ({ itemId, label, reason: eligibility.remeasure.reason! })),
  } satisfies ItemRemeasurePreview;
}

/** What a remeasure of the selection would ask, and who would pay: shown before its explicit confirmation. Reads only. */
export async function previewItemRemeasure(projectId: string, input: { scope: ItemTableScope; itemIds: string[] }) {
  const access = await requireReviewer(projectId);
  return remeasurePreview(input, access);
}

/**
 * A new manual request of the member who confirms, on their own subscription, for the items and plans the preview showed;
 * it may hold one item. Its admission is the next pull request's: refused here, nothing admitted, nothing spent.
 */
async function admitItemRemeasure(access: AffaireAccess, command: ItemRemeasureCommand,
  preview: Awaited<ReturnType<typeof remeasurePreview>>): Promise<ItemRemeasureResult> {
  void access;
  void command;
  void preview;
  throw new ApiError({ status: 503, code: ITEM_REVIEW_UNAVAILABLE,
    message: "La nouvelle mesure d’une sélection de postes n’est pas encore disponible : aucune analyse n’a été lancée." });
}

export async function runItemRemeasure(projectId: string, command: ItemRemeasureCommand): Promise<ItemRemeasureResult> {
  const access = await requireReviewer(projectId);
  const preview = await remeasurePreview({ scope: command.scope, itemIds: command.item_ids }, access);
  const shownPlans = preview.plans.map(({ key }) => key);
  if (preview.previewDigest !== command.preview_digest || shownPlans.join() !== command.plan_keys.join()) {
    throw conflict("Le payeur, le réglage, les plans ou les postes ont changé depuis l’aperçu : vérifiez-le de nouveau avant de confirmer.",
      undefined, ITEM_REVIEW_STALE);
  }
  if (preview.subscription.state === "unavailable") {
    throw unprocessableEntity(preview.subscription.reason, undefined, "AI_PROVIDER");
  }
  if (!preview.items.length) invalid("Aucun poste de la sélection ne peut être mesuré de nouveau.");
  return admitItemRemeasure(access, command, preview);
}
