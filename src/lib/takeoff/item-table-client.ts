import type { z } from "zod";

import { TakeoffApiError, TAKEOFF_READ_REQUEST_TIMEOUT_MS, TAKEOFF_WRITE_REQUEST_TIMEOUT_MS } from "@/lib/takeoff/client-http";
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
import { isRecord } from "@/lib/value-guards";

/** The screen's calls to the table of items of an affaire, each answer checked against its contract. */

const READ_FAILURE = "Impossible de lire les postes du métré.";
const WRITE_FAILURE = "Impossible d’enregistrer la décision sur les postes.";

async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>, failure: string, timeoutMs: number): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(timeoutMs), ...init,
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  } catch {
    // A network failure carries the browser's own (English) message: never shown as is.
    throw new TakeoffApiError(failure, 0, null, null);
  }
  const body = await response.json().catch(() => null) as unknown;
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!response.ok || !isRecord(body) || body.ok !== true) {
    const message = typeof error?.message === "string" && error.message.trim() ? error.message : failure;
    throw new TakeoffApiError(message, response.status, error?.details ?? null, typeof error?.code === "string" ? error.code : null);
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) throw new TakeoffApiError(failure, response.status, null, null);
  return parsed.data;
}

const base = (projectId: string) => `/api/affaires/${encodeURIComponent(projectId)}/takeoff/items`;

export function fetchItemTable(projectId: string, address: ItemTableAddress) {
  const params = withItemTableParams("", itemTableAddressParams(address));
  const query = params.toString();
  return call(`${base(projectId)}${query ? `?${query}` : ""}`, { method: "GET" }, itemTableResponseSchema, READ_FAILURE,
    TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

/** The review history of one item, newest first, by pages. */
export function fetchItemHistory(projectId: string, itemId: string, page: { offset: number; limit: number }) {
  return call(`${base(projectId)}/${encodeURIComponent(itemId)}/history?offset=${page.offset}&limit=${page.limit}`, { method: "GET" },
    itemHistoryResponseSchema, READ_FAILURE, TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

/** One item of the list outside any filter (a link of the radar, the detail of an item). */
export function fetchItemLine(projectId: string, itemId: string) {
  return call(`${base(projectId)}/${encodeURIComponent(itemId)}`, { method: "GET" }, itemTableLineResponseSchema, READ_FAILURE,
    TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

export function fetchFrozenItemSelection(projectId: string, scope: ItemTableScope,
  selection: { kind: "filter"; filter: ItemTableFilter } | { kind: "items"; itemIds: string[] }) {
  return call(`${base(projectId)}/selection`, { method: "POST", body: JSON.stringify({
    command_version: ITEM_REVIEW_COMMAND_VERSION, scope,
    selection: selection.kind === "filter" ? selection : { kind: "items", item_ids: selection.itemIds },
  }) }, itemSelectionResponseSchema, READ_FAILURE, TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}

export function sendItemReviewCommand(projectId: string, command: ItemReviewCommand) {
  return call(`${base(projectId)}/review`, { method: "POST", body: JSON.stringify(command) }, itemReviewResultSchema,
    WRITE_FAILURE, TAKEOFF_WRITE_REQUEST_TIMEOUT_MS);
}

/** The preview of a new measure of the selection, with what the member saw of it (the list revision, each line's readings). */
export function previewItemRemeasure(projectId: string, scope: ItemTableScope, itemIds: string[], seen: ItemRemeasureSeen, detail?: import("./item-table-contracts").ItemMeasureScope) {
  return call(`${base(projectId)}/remeasure/preview`, { method: "POST", body: JSON.stringify({
    command_version: ITEM_REVIEW_COMMAND_VERSION, scope, item_ids: itemIds, seen, detail,
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

export function fetchItemMeasureReadings(projectId: string, item: string, plan: string) {
  return call(`${base(projectId)}/remeasure?${new URLSearchParams({ item, plan })}`, { method: "GET", cache: "no-store" },
    itemMeasureReadingsSchema, "Impossible de lire la dernière mesure de ce poste.", TAKEOFF_READ_REQUEST_TIMEOUT_MS);
}
