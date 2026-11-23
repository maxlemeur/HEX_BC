import "server-only";

import { mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mapApplyTakeoffRpcError, type ApplyTakeoffRpcError } from "@/lib/takeoff/apply-errors";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import {
  itemSendConfirmRequestSchema,
  itemSendConfirmResponseSchema,
  type ItemSendConfirmRequest,
  type ItemSendConfirmResponse,
} from "@/lib/takeoff/item-send-contracts";
import type { ItemSendDecisionInvalidReason, ItemSendWritePlan } from "@/lib/takeoff/item-send-plan";
import {
  computeItemSendState,
  ITEM_SEND_INVALID_DECISION_MESSAGES,
  itemSendChoicesDigest,
  itemSendMemberMayWrite,
  itemSendPlanDigest,
  type Context,
} from "@/lib/takeoff/item-send-preview-server";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import type { Json } from "@/types/database";

// Lot 4, PR 5b: POST /api/takeoff/jobs/{jobId}/item-send/confirm — the send of one plan's answers by item, confirmed.
//
// The writer (public.send_takeoff_item_plan) is the server's: executable by the service role only, it takes the member
// this route authenticated as a parameter, and reads every right again after its waits. No member's session submits a
// plan: this route computes it again from the stored facts and the member's explicit choices (the destination, the
// breakdown, a line among those shown, « conserver la saisie », a page decision), exactly as the preview did
// (computeItemSendState), and confirms only the plan the member saw (its digest). A first draft is created from the payload
// « Créer un devis » prepares (prepareCanonicalEstimateCreation): its coefficients and its discount are the server's
// canonical creation settings, never a value of the request. SQL takes nothing from the plan that changes an amount: it
// reads each part again, derives the identity, what is replaced and the pages written, and binds what only the server
// computes (the mapping rules' projection, the first draft's settings) by comparison.

type Receipt = { id: string; job_id: string; project_id: string; actor_id: string; write_plan: unknown; result: unknown };

const conflict = (jobId: string, guard: string, message: string, retryable = false) => new TakeoffError({ status: 409,
  code: TakeoffErrorCode.CONFLICT, message, details: { guard }, retryable, jobId });
const refused = (jobId: string, guard: string, message: string, status: 403 | 422 = 422) => new TakeoffError({ status,
  code: status === 403 ? TakeoffErrorCode.FORBIDDEN : TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, message, details: { guard },
  retryable: false, jobId });

const NOTHING = "Rien n’a été écrit.";
const AGAIN = "Rouvrez l’aperçu puis confirmez de nouveau.";

/** Why the writer found the plan stale, in the member's words; nothing was written. */
const STALE_MESSAGES: Record<string, string> = {
  answers_changed: "Les réponses ou les décisions du tableau des postes ont changé depuis l’aperçu.",
  takeoff_changed: "Une ligne de ce métré a été corrigée depuis l’aperçu.",
  mapping_changed: "Une règle de correspondance a changé depuis l’aperçu.",
  estimate_changed: "Le devis a changé depuis l’aperçu.",
  destination_changed: "Le brouillon de destination a changé depuis l’aperçu (ou un autre a été créé).",
  dpgf_changed: "L’import du DPGF des lignes du devis a changé depuis l’aperçu.",
  creation_policy_changed: "Les réglages de création d’un devis de l’entreprise ont changé depuis l’aperçu.",
  list_changed: "La liste des postes de ce plan a changé depuis l’aperçu.",
  plan_changed: "Les pages de ce plan ont changé depuis l’aperçu.",
  pages_changed: "Une page de ce plan a été envoyée au devis par une autre analyse depuis l’aperçu.",
  earlier_send_changed: "Un envoi par poste précédent de ce devis a changé depuis l’aperçu.",
  earlier_part_elsewhere: "Ce plan a déjà alimenté ce poste sur une autre ligne du devis.",
  item_changed: "Un poste ou une de ses parts a changé depuis l’aperçu.",
  identity_conflict: "Une ligne du devis porte une autre identité quantitative que cette mesure.",
  line_changed: "Une ligne du devis a été modifiée depuis l’aperçu.",
  quantity_changed: "La quantité qu’écrirait l’envoi n’est plus celle de l’aperçu.",
  target_changed: "La ligne qui recevrait un poste a changé depuis l’aperçu.",
  target_claimed: "Une ligne du devis est déjà alimentée pour un autre poste.",
  target_unproven: "Une ligne du DPGF ne peut pas recevoir ce poste : rien ne prouve qu’elle vient de sa ligne du DPGF.",
  entry_suspended: "La quantité saisie sur une ligne est inférieure à la quantité retenue.",
  dpgf_reference_unread: "La quantité du DPGF d’une ligne a changé depuis l’aperçu.",
  page_contributions_changed: "Les pages qu’apporterait l’envoi ne sont plus celles de l’aperçu.",
  sections_changed: "Les sections du devis ont changé depuis l’aperçu.",
  copy_unread: "Une ligne de ce brouillon porte la marque d’un envoi par poste sans le détail de ses apports.",
};

function stale(jobId: string, reason: string | null) {
  return new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: true, jobId,
    message: `${(reason && STALE_MESSAGES[reason]) || "Le métré, le devis ou la liste ont changé depuis l’aperçu."} ${AGAIN} ${NOTHING}`,
    details: { guard: "item_send_preview_stale", reason } });
}

function detailOf(details: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(details ?? "") as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Every refusal of the writer, in the member's words; nothing was written. */
export function mapItemSendRpcError(error: ApplyTakeoffRpcError, jobId: string): TakeoffError {
  const detail = detailOf(error.details);
  const reason = typeof detail.reason === "string" ? detail.reason : null;
  switch (error.message) {
    case "TAKEOFF_ITEM_SEND_PREVIEW_STALE": return stale(jobId, reason);
    case "ESTIMATE_CALC_POLICY_CONTEXT_CHANGED": return stale(jobId, "creation_policy_changed");
    case "TAKEOFF_ITEM_SEND_REQUEST_CONFLICT":
      return conflict(jobId, "item_send_request_conflict", `Cette confirmation a déjà servi à un autre envoi. ${AGAIN}`);
    case "TAKEOFF_ITEM_SEND_ALREADY_SENT":
      return conflict(jobId, "item_send_already_sent", "Les postes de ce plan ont déjà été envoyés au devis.");
    case "TAKEOFF_ITEM_SEND_JOB_NOT_READY":
      return conflict(jobId, "item_send_not_ready", "La lecture de ce plan doit être terminée pour que ses postes soient envoyés au devis.");
    case "TAKEOFF_ITEM_SEND_NOT_ITEM_LIST":
      return conflict(jobId, "item_send_not_item_list", "Ce métré n’a pas été lu contre la liste des postes : envoyez-le au tableau de "
        + "chiffrage comme aujourd’hui.");
    case "TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE":
      return refused(jobId, "item_send_project_not_writable", "Seul le propriétaire de l’affaire ou un administrateur envoie ce métré, "
        + `et l’affaire ne doit pas être archivée. ${NOTHING}`, 403);
    case "TAKEOFF_ITEM_SEND_MODULE_DISABLED":
      return new TakeoffError({ status: 403, code: TakeoffErrorCode.TAKEOFF_MODULE_DISABLED, retryable: false, jobId,
        message: `Le module Takeoff est désactivé pour ce tenant. ${NOTHING}`, details: { guard: "item_send_module_disabled" } });
    case "TAKEOFF_ITEM_SEND_ENGINE_NOT_V3":
      return refused(jobId, "item_send_engine_not_v3", "L’envoi par poste n’écrit que dans un devis du moteur de calcul 3, sans "
        + `conversion. ${NOTHING}`);
    case "TAKEOFF_ITEM_SEND_DRAFT_LOCKED":
      return conflict(jobId, "item_send_draft_locked", "Ce brouillon est ouvert par un autre membre : l’envoi y sera possible quand il "
        + `l’aura libéré. ${NOTHING}`, true);
    case "TAKEOFF_ITEM_SEND_DRAFT_LOCK_REQUIRED":
      return conflict(jobId, "item_send_draft_lock_required", "Ouvrez ce brouillon dans l’éditeur de devis pour qu’il vous soit réservé, "
        + `puis confirmez de nouveau. ${NOTHING}`, true);
    case "TAKEOFF_ITEM_SEND_COPY_UNREAD":
      return refused(jobId, "item_send_copy_unread", "Une ligne de ce brouillon porte la marque d’un envoi par poste dont le détail "
        + `des apports est perdu : un nouvel envoi y compterait deux fois. Choisissez un autre brouillon. ${NOTHING}`);
    case "TAKEOFF_ITEM_SEND_DPGF_IMPORT_REQUIRED":
      return refused(jobId, "item_send_dpgf_import_required", "La liste des postes vient du DPGF, mais ce devis n’en contient aucune "
        + `ligne : confirmez d’abord l’import du DPGF depuis les documents de l’affaire. ${NOTHING}`);
    case "TAKEOFF_ITEM_SEND_PAGE_DECISION_REQUIRED":
      return refused(jobId, "item_send_page_decision_required", "Une page de ce plan est déjà au devis par une autre analyse : décidez "
        + `d’abord de cette page (remplacer ou garder les deux). ${NOTHING}`);
    case "TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID":
      return refused(jobId, "item_send_page_decision_invalid",
        `${ITEM_SEND_INVALID_DECISION_MESSAGES[(reason ?? "") as ItemSendDecisionInvalidReason] ?? "Cette décision de page n’est pas admise."} `
        + NOTHING);
    case "TAKEOFF_ITEM_SEND_QUANTITY_UNWRITABLE":
      return refused(jobId, "item_send_quantity_unwritable", "Le devis ne peut pas porter une quantité de cet envoi telle quelle (trois "
        + `décimales au plus, sous son plafond). ${NOTHING}`);
    case "TAKEOFF_ITEM_SEND_INVALID":
    case "TAKEOFF_ITEM_SEND_OVERRIDE_NOT_ADMITTED":
      // The server computed the plan; a refused shape is a fault of the server, never the member's.
      return new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId,
        message: `L’envoi par poste n’a pas pu être préparé. ${NOTHING}`, details: { guard: "item_send_plan_invalid" } });
    default:
      // A refusal of the guard of the applied job (its blocked rows, a lease, a right): its own member message.
      if (error.message?.startsWith("TAKEOFF_APPLY_")) return mapApplyTakeoffRpcError(error, { jobId });
      // A lock the send needs stayed held past its wait, or two writes crossed: nothing was written, try again.
      if (error.code === "55P03" || error.code === "40P01" || error.code === "40001") {
        return new TakeoffError({ status: 503, code: TakeoffErrorCode.CONFLICT, retryable: true, jobId,
          message: `Le devis est en cours de modification : réessayez dans un instant. ${NOTHING}`, details: { guard: "item_send_busy" } });
      }
      return toTakeoffError(mapSupabaseError(error as never, `L’envoi par poste a échoué. ${NOTHING}`),
        { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
  }
}

function responseOf(answer: unknown, jobId: string): ItemSendConfirmResponse {
  const parsed = itemSendConfirmResponseSchema.safeParse(answer && typeof answer === "object" ? {
    receipt_id: (answer as Record<string, unknown>).receipt_id, replayed: (answer as Record<string, unknown>).replayed,
    job_id: (answer as Record<string, unknown>).job_id, version_id: (answer as Record<string, unknown>).version_id,
    version_created: (answer as Record<string, unknown>).version_created, lines_written: (answer as Record<string, unknown>).lines_written,
    parts_written: (answer as Record<string, unknown>).parts_written, parts_replaced: (answer as Record<string, unknown>).parts_replaced,
    focus_item_id: (answer as Record<string, unknown>).focus_item_id ?? null,
  } : null);
  if (!parsed.success) {
    throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId,
      message: "Le reçu de l’envoi par poste est illisible.", details: { guard: "item_send_receipt_unreadable" } });
  }
  return parsed.data;
}

/**
 * The receipt of a send under an intention key, as the member reads it (its policy is the affaire's readers'): a send's
 * only, never a copy's (a copy of a draft carries its receipts under no intention key).
 */
async function readReceipt(ctx: Context, requestId: string, jobId: string): Promise<Receipt | null> {
  const { data, error } = await ctx.supabase.from("takeoff_item_send_receipts" as never)
    .select("id, job_id, project_id, actor_id, write_plan, result" as never).eq("tenant_id" as never, ctx.tenantId as never)
    .eq("request_id" as never, requestId as never).eq("command_kind" as never, "send" as never).maybeSingle();
  if (error) {
    throw toTakeoffError(mapSupabaseError(error, "Impossible de vérifier l’envoi déjà confirmé."),
      { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
  }
  return (data ?? null) as Receipt | null;
}

/**
 * The same intention key answers its receipt only to its author, still allowed to write the affaire, for the same job,
 * the same choices and the same plan (a lost answer sent again): the right first, then anything else is a conflict.
 */
async function replayOf(ctx: Context, receipt: Receipt, jobId: string, request: ItemSendConfirmRequest): Promise<ItemSendConfirmResponse> {
  if (!await itemSendMemberMayWrite(ctx, receipt.project_id, jobId)) {
    throw refused(jobId, "item_send_project_not_writable", "Seul le propriétaire de l’affaire ou un administrateur envoie ce métré, "
      + `et l’affaire ne doit pas être archivée. ${NOTHING}`, 403);
  }
  const plan = receipt.write_plan as ItemSendWritePlan;
  if (receipt.actor_id.toLowerCase() !== ctx.userId.toLowerCase() || receipt.job_id.toLowerCase() !== jobId.toLowerCase()
    || plan.choices_sha256 !== itemSendChoicesDigest(request) || itemSendPlanDigest(plan) !== request.plan_digest) {
    throw conflict(jobId, "item_send_request_conflict", `Cette confirmation a déjà servi à un autre envoi. ${AGAIN}`);
  }
  return responseOf({ ...(receipt.result as Record<string, unknown>), receipt_id: receipt.id, replayed: true }, jobId);
}

export async function confirmTakeoffItemSend(jobId: string, body: unknown): Promise<ItemSendConfirmResponse> {
  const context = await getAuthenticatedTakeoffContext();
  const ctx: Context = { ...context, tenantRole: context.tenantRole ?? "" };
  const normalizedJobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const request: ItemSendConfirmRequest = parseWithSchema(itemSendConfirmRequestSchema, body,
    "Confirmation d’envoi par poste invalide.");
  return confirmItemSendFor(ctx, normalizedJobId, request);
}

/** The confirmation for an authenticated member (the route's, and the server tests'). */
export async function confirmItemSendFor(ctx: Context, jobId: string, request: ItemSendConfirmRequest): Promise<ItemSendConfirmResponse> {
  const committed = await readReceipt(ctx, request.request_id, jobId);
  if (committed) return replayOf(ctx, committed, jobId, request);

  // The plan again, from the stored facts and the member's choices only: what the request may name is a choice among
  // those the preview offered, never a quantity, a part, a page, a setting or a price.
  const state = await computeItemSendState(ctx, jobId, { destination: request.destination, breakdown: request.breakdown,
    resolutions: request.resolutions, page_decisions: request.page_decisions });
  if (!state.writePlan) {
    if (state.blocker === "already_sent") {
      // Committed meanwhile under this key (a lost answer sent again while the first one ran): its receipt.
      const meanwhile = await readReceipt(ctx, request.request_id, jobId);
      if (meanwhile) return replayOf(ctx, meanwhile, jobId, request);
    }
    const response = state.response;
    if (response.blocked?.reason === "read_only") {
      throw refused(jobId, "item_send_read_only", `${response.blocked.message} ${NOTHING}`, 403);
    }
    if (response.blocked?.reason === "already_sent") throw conflict(jobId, "item_send_already_sent", response.blocked.message);
    // The preview the member confirmed could be confirmed: what blocks now (an item set aside, a line to choose, a page
    // decision no longer admitted, a draft changed) moved since. The preview is to be read again; nothing is written.
    const why = response.blocked?.message ?? response.invalid_page_decisions[0]?.message ?? response.to_resolve[0]?.message ?? null;
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: true, jobId,
      message: `${why ? `${why} ` : ""}${AGAIN} ${NOTHING}`, details: { guard: "item_send_preview_stale",
        reason: response.blocked?.reason ?? (response.invalid_page_decisions.length > 0 ? "page_decision_invalid" : "to_resolve") } });
  }
  // Only the plan the member saw: another plan computed now (a fact moved since the preview) is never written.
  if (itemSendPlanDigest(state.writePlan) !== request.plan_digest) throw stale(jobId, null);

  const { data, error } = await createServiceRoleClient().rpc("send_takeoff_item_plan" as never, {
    p_tenant_id: ctx.tenantId,
    p_actor_id: ctx.userId,
    p_module_default: takeoffModuleDefault(),
    p_request: { request_id: request.request_id, plan: state.writePlan,
      ...(state.versionPayload ? { version_payload: state.versionPayload } : {}) } as unknown as Json,
  } as never);
  if (error) throw mapItemSendRpcError(error as ApplyTakeoffRpcError, jobId);
  return responseOf(data, jobId);
}
