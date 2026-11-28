import { entryScopeResultSchema, type EntryScopeCommand } from "./entry-scope-contracts";
import { measureReviewSchema, retainedMeasureSchema, type retainCommandSchema } from "./measure-review-contracts";
import type { TakeoffPaymentChoice } from "./payment-choice";
import { findReceiptSchema, findsViewSchema, type FindCommand } from "./unlisted-finds";
import type { z } from "zod";

import {
  callTakeoffApi as call,
  TakeoffApiError,
  TAKEOFF_READ_REQUEST_TIMEOUT_MS,
  TAKEOFF_WRITE_REQUEST_TIMEOUT_MS,
} from "@/lib/takeoff/client-http";
import {
  ITEM_REVIEW_COMMAND_VERSION,
  itemRemeasurePreviewSchema,
  itemRemeasureResultSchema,
  itemMeasureReadingsSchema,
  itemReviewResultSchema,
  itemReviewStaleDetailsSchema,
  itemHistoryResponseSchema,
  itemSelectionResponseSchema,
  itemTableLineResponseSchema,
  itemTableResponseSchema,
  type ItemRemeasureCommand,
  type ItemRemeasureSeen,
  type ItemReviewCommand,
} from "@/lib/takeoff/item-table-contracts";
import type { ItemTableFilter, ItemTableScope } from "@/lib/takeoff/item-table";
import { itemTableAddressParams, withItemTableParams, type ItemTableAddress } from "@/lib/takeoff/item-table-query";

/** The screen's calls to the table of items of an affaire, each answer checked against its contract. */

const READ_FAILURE = "Impossible de lire les postes du métré.";
const WRITE_FAILURE = "Impossible d’enregistrer la décision sur les postes.";

const base = (projectId: string) => `/api/affaires/${encodeURIComponent(projectId)}/takeoff/items`;

export function fetchItemTable(projectId: string, address: ItemTableAddress, detail = false) {
  const params = withItemTableParams("", itemTableAddressParams(address));
  if (detail) params.set("detail", "1");
  const query = params.toString();
  return call(`${base(projectId)}${query ? `?${query}` : ""}`, { method: "GET" }, itemTableResponseSchema, READ_FAILURE,
    TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

const measurePath = (project: string, answer: string) => `${base(project)}/measures/${encodeURIComponent(answer)}`;

export function fetchMeasureReview(project: string, answer: string) {
  return call(measurePath(project, answer), { method: "GET", cache: "no-store" }, measureReviewSchema, READ_FAILURE,
    TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

export function sendMeasureRetention(project: string, answer: string, command: z.infer<typeof retainCommandSchema>) {
  return call(measurePath(project, answer), { method: "POST", body: JSON.stringify(command) }, retainedMeasureSchema,
    WRITE_FAILURE, TAKEOFF_WRITE_REQUEST_TIMEOUT_MS);
}

/** The review history of one item, newest first, by pages. */
export function fetchItemHistory(projectId: string, itemId: string, page: { offset: number; limit: number }) {
  return call(`${base(projectId)}/${encodeURIComponent(itemId)}/history?offset=${page.offset}&limit=${page.limit}`, { method: "GET" },
    itemHistoryResponseSchema, READ_FAILURE, TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

/** One item of the list outside any filter (a link of the radar, the detail of an item). */
export function fetchItemLine(projectId: string, itemId: string, detail = false) {
  return call(`${base(projectId)}/${encodeURIComponent(itemId)}${detail ? "?detail=1" : ""}`, { method: "GET" }, itemTableLineResponseSchema, READ_FAILURE,
    TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

export function fetchFrozenItemSelection(projectId: string, scope: ItemTableScope,
  selection: { kind: "filter"; filter: ItemTableFilter } | { kind: "items"; itemIds: string[] }, entryPlans = false) {
  return call(`${base(projectId)}/selection`, { method: "POST", body: JSON.stringify({
    command_version: ITEM_REVIEW_COMMAND_VERSION, scope, ...(entryPlans && { entry_plans: true }),
    selection: selection.kind === "filter" ? selection : { kind: "items", item_ids: selection.itemIds },
  }) }, itemSelectionResponseSchema, READ_FAILURE, TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

export function sendEntryScope(project: string, item: string, command: EntryScopeCommand) {
  return call(`${base(project)}/${encodeURIComponent(item)}/entry-scope`, { method: "POST", body: JSON.stringify(command) },
    entryScopeResultSchema, "Impossible de modifier la portée de la saisie.", TAKEOFF_WRITE_REQUEST_TIMEOUT_MS);
}

export function sendItemReviewCommand(projectId: string, command: ItemReviewCommand) {
  return call(`${base(projectId)}/review`, { method: "POST", body: JSON.stringify(command) }, itemReviewResultSchema,
    WRITE_FAILURE, TAKEOFF_WRITE_REQUEST_TIMEOUT_MS);
}

/** The preview of a new measure of the selection, with what the member saw of it (the list revision, each line's readings). */
export function previewItemRemeasure(projectId: string, scope: ItemTableScope, itemIds: string[], seen: ItemRemeasureSeen, detail?: import("./item-table-contracts").ItemMeasureScope, fromFinds?: true,
  paymentChoice?: TakeoffPaymentChoice) {
  return call(`${base(projectId)}/remeasure/preview`, { method: "POST", body: JSON.stringify({
    command_version: ITEM_REVIEW_COMMAND_VERSION, scope, item_ids: itemIds, seen, detail, from_finds: fromFinds, payment_choice: paymentChoice,
  }) }, itemRemeasurePreviewSchema, "Impossible de préparer la nouvelle mesure.", TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

export function sendItemRemeasure(projectId: string, command: ItemRemeasureCommand) {
  return call(`${base(projectId)}/remeasure`, { method: "POST", body: JSON.stringify(command) }, itemRemeasureResultSchema,
    "Impossible de demander la nouvelle mesure.", TAKEOFF_WRITE_REQUEST_TIMEOUT_MS);
}

/** The lines of a refusal that names what changed since the selection was frozen, or null for any other error. */
export function itemReviewStaleLines(error: unknown) {
  if (!(error instanceof TakeoffApiError) || error.status !== 409) return null;
  const parsed = itemReviewStaleDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data.stale : null;
}

export function fetchItemMeasureReadings(projectId: string, item: string, plan: string, receipt?: { jobId: string; requestId: string }) {
  return call(`${base(projectId)}/remeasure?${new URLSearchParams({ item, plan, ...receipt })}`, { method: "GET", cache: "no-store" },
    itemMeasureReadingsSchema, "Impossible de lire la dernière mesure de ce poste.", TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

export function fetchUnlistedFinds(projectId: string) {
  return call(`${base(projectId)}/finds`, { method: "GET", cache: "no-store" }, findsViewSchema, READ_FAILURE, TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}
export function sendFindDecision(projectId: string, command: FindCommand) {
  return call(`${base(projectId)}/finds`, { method: "POST", body: JSON.stringify(command) }, findReceiptSchema, WRITE_FAILURE, TAKEOFF_WRITE_REQUEST_TIMEOUT_MS);
}
