import { itemDetailPlanViewSchema, type ItemDetailPlanRequest, type ItemDetailPlanView } from "@/lib/takeoff/item-detail-contracts";
import type { ItemDetailLine, ItemDetailQueuePage } from "@/lib/takeoff/item-detail";
import { TAKEOFF_ITEM_DETAIL_PARAMS as P } from "@/lib/takeoff/review-href";

/**
 * The one reader of the detail of an item (lot 5): the table's lines it shows come from the table of items (lot 4's
 * read, given by the caller, so that the detail reads the same pages, filter and order the table showed), the plans from
 * the detail's own resolution, which also signs a dossier copy for the member at that request.
 *
 * One reader per member and affaire: the detail starts from nothing when its reader changes (TakeoffItemDetail). It keeps
 * no resolution: a plan is resolved again each time it is opened, never per item shown on it, per page or per mark, and
 * nothing is polled. The PDF stays loaded by the identity of its bytes (usePdfPage), not by its resolution.
 */

export type ItemDetailQueueRequest = { kind: "page"; offset: number } | { kind: "focus"; itemId: string };

export type ItemDetailTableSource = {
  /** A page of the table as the address filters it: at an offset, or the page that holds an item (`focusFound`). */
  readQueue(request: ItemDetailQueueRequest): Promise<ItemDetailQueuePage & { focusFound: boolean }>;
  /** An item of the list outside the table's filter (a link of the radar): null when the list does not hold it. */
  readLine(itemId: string): Promise<{ line: ItemDetailLine; names: Record<string, string>; canReview: boolean } | null>;
};

export type ItemDetailReader = ItemDetailTableSource & {
  /** The plan to show, resolved again each time a plan is opened: a dossier copy is current when it is shown. */
  resolvePlan(request: ItemDetailPlanRequest): Promise<ItemDetailPlanView>;
};

/** A refused resolution: its code and status, worded on screen by item-detail-labels.ts, never by the server's text. */
export class ItemDetailPlanError extends Error {
  constructor(readonly code: string | null, readonly status: number | null) {
    super(code ?? "TAKEOFF_ITEM_DETAIL_PLAN_FAILED");
    this.name = "ItemDetailPlanError";
  }
}

const READ_TIMEOUT_MS = 10_000;

const planQuery = (request: ItemDetailPlanRequest) => {
  const query = new URLSearchParams();
  if (request.source) {
    query.set(P.sourceId, request.source.documentId);
    if (request.source.generation) query.set(P.generation, request.source.generation);
  } else {
    if (request.planKey) query.set(P.planKey, request.planKey);
    if (request.jobId) query.set(P.jobId, request.jobId);
  }
  return query;
};

async function readEnvelope(path: string): Promise<{ data: unknown } | { code: string | null; status: number | null }> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  } catch {
    return { code: null, status: null };
  }
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: { code?: unknown } } | null;
  if (!response.ok || body?.ok !== true) {
    return { code: typeof body?.error?.code === "string" ? body.error.code : null, status: response.status };
  }
  return { data: body.data };
}

export function createItemDetailReader(input: { projectId: string; table: ItemDetailTableSource }): ItemDetailReader {
  return {
    readQueue: (request) => input.table.readQueue(request),
    readLine: (itemId) => input.table.readLine(itemId),
    async resolvePlan(request) {
      const answer = await readEnvelope(`/api/affaires/${encodeURIComponent(input.projectId)}/takeoff/item-detail/plan?${planQuery(request)}`);
      if (!("data" in answer)) throw new ItemDetailPlanError(answer.code, answer.status);
      const parsed = itemDetailPlanViewSchema.safeParse(answer.data);
      if (!parsed.success) throw new ItemDetailPlanError(null, null);
      return parsed.data;
    },
  };
}
