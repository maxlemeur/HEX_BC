import "server-only";

import { createHash } from "node:crypto";

import { headers } from "next/headers";

import { readLocalChatGptSubscription, type LocalChatGptSubscriptionIssue } from "@/lib/ai/chatgpt-takeoff";
import { requireAffaireAccess, type AffaireAccess } from "@/lib/affaires/access-server";
import { ApiError, conflict, forbidden, mapSupabaseError, unprocessableEntity } from "@/lib/http/api-response";
import { noteLength } from "@/lib/takeoff/rules/verification";
import { quantityEntryError } from "./quantity-entry";
import { planItemReviewCommand, type ItemReviewPlan, type ItemTableScope } from "./item-table";
import {
  ITEM_SET_ASIDE_NOTE,
  type ItemRemeasureCommand,
  type ItemRemeasurePreview,
  type ItemRemeasureResult,
  type ItemReviewCommand,
  type ItemReviewResult,
} from "./item-table-contracts";
import { itemReviewerRight, loadItemTable } from "./item-table-server";
import { readAffaireTakeoffLaunchState } from "./launch-request-server";

/**
 * The one commands module of the table of items (lot 4): the three bulk gestures (accept the measured items without
 * anomaly, set the selection aside, ask the AI to measure it again), the complementary entry, the reinstatement of what
 * was set aside and the inclusion of an entered hypothesis. A command names its targets, each answer with its revision
 * and its decision's: the table is built again from what is stored now, a stale selection applies nothing and names its
 * lines, and only the eligible lines are written. No gesture forces anything, ever.
 *
 * The decisions are written in `writeItemReviewDecisions` alone, and a remeasure is admitted in `admitItemRemeasure`
 * alone. Until the review decisions exist in the database (migration B2 of lot 4) and the manual request of one analysis
 * per plan takes a selection of items, both refuse: nothing is written.
 */

export const ITEM_REVIEW_UNAVAILABLE = "TAKEOFF_ITEM_REVIEW_UNAVAILABLE";
export const ITEM_REVIEW_STALE = "TAKEOFF_ITEM_REVIEW_STALE";

async function requireReviewer(projectId: string): Promise<AffaireAccess> {
  const access = await requireAffaireAccess(projectId, "read");
  if (!await itemReviewerRight(access)) {
    throw forbidden("Seul un opérateur du métré de l’affaire peut revoir les postes.", undefined, "TAKEOFF_ITEM_REVIEW_FORBIDDEN");
  }
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

function staleRefusal(plan: Extract<ItemReviewPlan, { kind: "stale" }>): never {
  throw conflict("Des postes de la sélection ont changé depuis son affichage : rien n’a été appliqué. Rafraîchissez la sélection.",
    { stale: plan.stale }, ITEM_REVIEW_STALE);
}

/**
 * Writes the decisions of one command in one transaction, under the intention key, with its journal per line. The
 * review decisions are not stored yet: refused, nothing is written.
 */
async function writeItemReviewDecisions(access: AffaireAccess, command: ItemReviewCommand,
  plan: Extract<ItemReviewPlan, { kind: "planned" }>): Promise<ItemReviewResult> {
  void access;
  void command;
  void plan;
  throw new ApiError({ status: 503, code: ITEM_REVIEW_UNAVAILABLE,
    message: "La revue des postes n’est pas encore disponible : rien n’a été enregistré." });
}

export async function runItemReviewCommand(projectId: string, command: ItemReviewCommand): Promise<ItemReviewResult> {
  assertCommandShape(command);
  const access = await requireReviewer(projectId);
  const { view } = await loadItemTable(projectId, command.scope, {}, access);
  const plan = planItemReviewCommand(view, { gesture: command.gesture, targets: command.targets });
  if (plan.kind === "stale") staleRefusal(plan);
  if (!plan.apply.length) {
    return { outcome: "applied", applied: [], skipped: plan.skipped };
  }
  return writeItemReviewDecisions(access, command, plan);
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
  const { data, error } = await access.context.supabase.from("profiles").select("full_name").eq("id", access.context.userId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de lire le membre qui confirme.");
  return data?.full_name?.trim() || null;
}

async function remeasurePreview(projectId: string, input: { scope: ItemTableScope; itemIds: string[] }, access: AffaireAccess) {
  const { view, facts } = await loadItemTable(projectId, input.scope, {}, access);
  const byId = new Map(view.lines.map((line) => [line.itemId, line]));
  const missing = input.itemIds.filter((id) => !byId.has(id));
  if (missing.length) {
    throw conflict("Des postes de la sélection ne sont plus dans la liste : rafraîchissez la sélection.",
      { stale: missing.map((itemId) => ({ itemId, label: null })) }, ITEM_REVIEW_STALE);
  }
  const lines = [...new Set(input.itemIds)].map((id) => byId.get(id)!);
  const eligible = lines.filter(({ eligibility }) => eligibility.remeasure.eligible);
  const planKeys = new Set(eligible.flatMap(({ remeasurePlans }) => remeasurePlans));
  const plans = facts.plans.filter(({ key }) => planKeys.has(key)).map(({ key, name }) => ({ key, name }));
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
    skipped: lines.filter(({ eligibility }) => !eligibility.remeasure.eligible)
      .map(({ itemId, label, eligibility }) => ({ itemId, label, reason: eligibility.remeasure.reason! })),
  } satisfies ItemRemeasurePreview;
}

/** What a remeasure of the selection would ask, and who would pay: shown before its explicit confirmation. Reads only. */
export async function previewItemRemeasure(projectId: string, input: { scope: ItemTableScope; itemIds: string[] }) {
  const access = await requireReviewer(projectId);
  return remeasurePreview(projectId, input, access);
}

/**
 * A new manual request of the member who confirms, on their own subscription, for the items and plans the preview showed;
 * it may hold one item. The manual request of one analysis per plan does not take a selection of items yet: refused,
 * nothing is admitted and nothing is spent.
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
  const preview = await remeasurePreview(projectId, { scope: command.scope, itemIds: command.item_ids }, access);
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
