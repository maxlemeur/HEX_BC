"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isEstimateApiError } from "@/lib/estimates/client-errors";
import {
  createMaterialRequestOrders,
  fetchMaterialRequestOrders,
  materialRequestErrorMessage,
  type MaterialRequestOrder,
  type MaterialRequestOrderLink,
} from "@/lib/material-requests/client";
import type {
  MaterialRequestCreatedOrder,
  MaterialRequestOrdersSummary,
} from "@/lib/material-requests/order-contracts";

import type { MaterialRequestEditorApi } from "./useMaterialRequestEditor";

export type OrdersStatus = "loading" | "ready" | "error";

/** The answer of a creation never came: the drafts may exist, and the next click sends the same key. */
export const ORDERS_ANSWER_LOST =
  "La réponse n’est pas arrivée : les brouillons ont peut-être été créés. Réessayez, rien ne sera créé deux fois.";

export type MaterialRequestOrdersApi = {
  /** `error`: the last read failed; the summary read before it, if any, is still shown. */
  status: OrdersStatus;
  summary: MaterialRequestOrdersSummary | null;
  /** The summary is read again after a creation or a change of the lines: nothing is created meanwhile. */
  refreshing: boolean;
  retry: () => void;
  /** The purchase order a line of the request went into, once it is ordered. */
  orderedLine: (lineId: string) => MaterialRequestOrderLink | null;
  creating: boolean;
  createError: string | null;
  /**
   * One creation at a time, in the queue of the request's writes. Its key is kept until the server answers: a
   * click after an answer that never came sends it again, and the server creates nothing twice.
   */
  createDrafts: () => Promise<void>;
};

/** No answer, or one that does not say what happened: the server may have created the drafts. */
function outcomeUnknown(error: unknown): boolean {
  if (!isEstimateApiError(error)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

/**
 * The drafts the creation answered, listed at once after those already known (oldest first, as the server lists
 * them). A draft known keeps its status as read; a new one is a draft until the summary is read again.
 */
function mergeOrders(known: readonly MaterialRequestOrder[], created: readonly MaterialRequestCreatedOrder[]): MaterialRequestOrder[] {
  const incoming = new Map(created.map((order) => [order.id, order]));
  return [
    ...known.map((order) => {
      const answered = incoming.get(order.id);
      return answered ? { ...order, ...answered } : order;
    }),
    ...created
      .filter((order) => !known.some((entry) => entry.id === order.id))
      // Made by the caller (a replay answers only its author or an admin): it may open them.
      .map((order) => ({ ...order, status: "draft", can_open: true })),
  ];
}

/** What decides whether a line can be ordered: a change of one of these reads the summary again. */
function readinessSignature(lines: MaterialRequestEditorApi["data"]["lines"]): string {
  return lines.map((line) => `${line.id}:${line.status}:${line.supplier_id ?? ""}:${line.price_quote_id ?? ""}`).join("|");
}

/**
 * The purchase orders of one request (TI-691, delivery 3a): what is ready to order, why the rest is not, and the
 * drafts made. Readers read it too; only the office creates.
 */
export function useMaterialRequestOrders(editor: MaterialRequestEditorApi): MaterialRequestOrdersApi {
  const { projectId, requestId, queueWrite } = editor;
  const [summary, setSummary] = useState<MaterialRequestOrdersSummary | null>(null);
  const [status, setStatus] = useState<OrdersStatus>("loading");
  const [version, setVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** The key of a creation not answered yet; null once the server said what it did. */
  const pendingKey = useRef<string | null>(null);
  const sending = useRef(false);
  const signature = useMemo(() => readinessSignature(editor.data.lines), [editor.data.lines]);

  useEffect(() => {
    const abort = new AbortController();
    fetchMaterialRequestOrders(projectId, requestId, abort.signal)
      .then((next) => {
        if (abort.signal.aborted) return;
        setSummary(next);
        setStatus("ready");
        setRefreshing(false);
        // Nothing left to order after a creation whose answer was lost: it went through.
        if (pendingKey.current !== null && !sending.current && next.ready_line_ids.length === 0) {
          pendingKey.current = null;
          setCreateError(null);
        }
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setStatus("error");
        setRefreshing(false);
      });
    return () => abort.abort();
  }, [projectId, requestId, version, signature]);

  const retry = useCallback(() => {
    setStatus("loading");
    setVersion((current) => current + 1);
  }, []);

  const readAgain = useCallback(() => {
    setRefreshing(true);
    setVersion((current) => current + 1);
  }, []);

  const createDrafts = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    setCreating(true);
    setCreateError(null);
    const key = pendingKey.current ?? crypto.randomUUID();
    pendingKey.current = key;
    try {
      // After the line changes made before the click: what is ordered is what the table shows.
      const { orders: created } = await queueWrite(() => createMaterialRequestOrders(projectId, requestId, key));
      pendingKey.current = null;
      setSummary((current) => (current ? { ...current, orders: mergeOrders(current.orders, created) } : current));
    } catch (error) {
      if (outcomeUnknown(error)) {
        setCreateError(ORDERS_ANSWER_LOST);
      } else {
        // The server answered: nothing was created under this key, and the next creation is a new one.
        pendingKey.current = null;
        setCreateError(`Non créé : ${materialRequestErrorMessage(error, "les brouillons de commande n’ont pas pu être créés.")}`);
      }
    } finally {
      sending.current = false;
      setCreating(false);
      readAgain();
    }
  }, [projectId, queueWrite, readAgain, requestId]);

  const ordered = useMemo(
    () => new Map((summary?.ordered ?? []).map((entry) => [entry.line_id, entry])),
    [summary],
  );
  const orderedLine = useCallback((lineId: string) => ordered.get(lineId) ?? null, [ordered]);

  return useMemo(
    () => ({ status, summary, refreshing, retry, orderedLine, creating, createError, createDrafts }),
    [createDrafts, createError, creating, orderedLine, refreshing, retry, status, summary],
  );
}
