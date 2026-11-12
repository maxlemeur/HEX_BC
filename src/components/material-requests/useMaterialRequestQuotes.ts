"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isEstimateApiError } from "@/lib/estimates/client-errors";
import {
  closeMaterialRequestQuote,
  createMaterialRequestQuote,
  fetchMaterialRequestQuotes,
  materialRequestErrorMessage,
  retainMaterialRequestQuote,
  updateMaterialRequestQuote,
} from "@/lib/material-requests/client";
import type { CreateQuoteInput, MaterialRequestQuote } from "@/lib/material-requests/quote-contracts";

import { uploadMaterialRequestQuoteFiles, type PhotoUploadStep } from "./photo-upload";
import type { MaterialRequestEditorApi, SaveResult } from "./useMaterialRequestEditor";

export type QuotesStatus = "loading" | "ready" | "error";

/** A price typed on the quote was refused and is still on screen: the quote is not retained on another one. */
export const QUOTE_PRICE_HELD =
  "Un prix saisi sur ce devis n’est pas enregistré : corrigez-le, ou appuyez sur Échap pour revenir au prix enregistré.";

export type MaterialRequestQuotesApi = {
  status: QuotesStatus;
  /** As the server answered them; the screen orders them itself. */
  items: MaterialRequestQuote[];
  retry: () => void;
  /** « Consultation envoyée »: the quote is recorded with the message the office copied. */
  createQuote: (input: CreateQuoteInput) => Promise<SaveResult>;
  savePrice: (quoteId: string, lineId: string, cents: number | null) => Promise<SaveResult>;
  /** The office dropped a price that could not be saved: the line holds the saved price again. */
  forgetPriceFailure: (quoteId: string, lineId: string) => void;
  /**
   * Lines of the quote whose last price was refused and is still on screen. A price on its way does not count:
   * a retain waits for its answer in the queue.
   */
  refusedPrices: (quoteId: string) => number;
  saveDetails: (quoteId: string, patch: { amount_ht_cents?: number | null; notes?: string | null }) => Promise<SaveResult>;
  markReceived: (quoteId: string) => Promise<SaveResult>;
  /** Prices the request's lines from the quote; the competing quotes are closed by the server. */
  retainQuote: (quoteId: string) => Promise<SaveResult>;
  closeQuote: (quoteId: string) => Promise<SaveResult>;
  /** Outside the queue of writes, as the request's photos: the quote stays editable while its files travel. */
  addFiles: (quoteId: string, files: readonly File[], onStep?: (progress: PhotoUploadStep) => void) => Promise<SaveResult>;
};

type PriceWrites = { pending: number; value: number | null };

/** The server changed or refused on a state the screen no longer matches: the list is read again. */
function isStale(error: unknown): boolean {
  return isEstimateApiError(error) && (error.status === 409 || error.status === 422 || error.status === 404);
}

/**
 * The quotes of one request (TI-691, delivery 2). Readers read them too; every write takes its turn in the
 * editor's queue, so that a quote is retained only after the prices and line changes made before it.
 */
export function useMaterialRequestQuotes(editor: MaterialRequestEditorApi): MaterialRequestQuotesApi {
  const { projectId, requestId, queueWrite, mergeServerLines } = editor;
  const [status, setStatus] = useState<QuotesStatus>("loading");
  const [items, setItems] = useState<MaterialRequestQuote[]>([]);
  const [attempt, setAttempt] = useState(0);
  /**
   * Per quote and line: the price saves not answered yet, with the last value sent, and the lines whose last
   * save failed. Kept in refs because a retain queued behind a save reads that save's outcome at its own turn.
   */
  const pending = useRef(new Map<string, Map<string, PriceWrites>>());
  const failed = useRef(new Map<string, Set<string>>());
  const [refused, setRefused] = useState<ReadonlyMap<string, number>>(new Map());
  const leaving = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    leaving.current = controller;
    return () => controller.abort();
  }, [projectId, requestId]);

  /** The server's quote, with the prices still on their way shown as sent. */
  const overlay = useCallback((item: MaterialRequestQuote): MaterialRequestQuote => {
    const sending = pending.current.get(item.id);
    if (!sending) return item;
    return {
      ...item,
      lines: item.lines.map((line) => {
        const writes = sending.get(line.line_id);
        return writes && writes.pending > 0 ? { ...line, unit_price_ht_cents: writes.value } : line;
      }),
    };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    fetchMaterialRequestQuotes(projectId, requestId, abort.signal)
      .then((next) => {
        if (abort.signal.aborted) return;
        setItems(next.map(overlay));
        setStatus("ready");
      })
      .catch(() => {
        if (!abort.signal.aborted) setStatus("error");
      });
    return () => abort.abort();
  }, [projectId, requestId, attempt, overlay]);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((current) => current + 1);
  }, []);

  /**
   * Read again without a loading state, in the queue: an answer read before a write that follows it cannot
   * replace what that write answered. A failed read keeps what the screen shows.
   */
  const reload = useCallback(() => {
    queueWrite(() => fetchMaterialRequestQuotes(projectId, requestId)).then(
      (next) => setItems(next.map(overlay)),
      () => undefined,
    );
  }, [overlay, projectId, queueWrite, requestId]);

  const publish = useCallback(() => {
    const next = new Map<string, number>();
    for (const [quoteId, lines] of failed.current) {
      if (lines.size > 0) next.set(quoteId, lines.size);
    }
    setRefused(next);
  }, []);

  const upsert = useCallback(
    (item: MaterialRequestQuote) => {
      const shown = overlay(item);
      setItems((current) =>
        current.some((quote) => quote.id === item.id)
          ? current.map((quote) => (quote.id === item.id ? shown : quote))
          : [...current, shown],
      );
    },
    [overlay],
  );

  const holdsUnsavedPrice = useCallback(
    (quoteId: string) =>
      (failed.current.get(quoteId)?.size ?? 0) > 0
      || [...(pending.current.get(quoteId)?.values() ?? [])].some((writes) => writes.pending > 0),
    [],
  );

  const write = useCallback(
    async (call: () => Promise<MaterialRequestQuote>, fallback: string): Promise<SaveResult> => {
      try {
        upsert(await queueWrite(call));
        return { ok: true };
      } catch (error) {
        if (isStale(error)) reload();
        return { ok: false, message: materialRequestErrorMessage(error, fallback) };
      }
    },
    [queueWrite, reload, upsert],
  );

  const createQuote = useCallback(
    (input: CreateQuoteInput) =>
      write(() => createMaterialRequestQuote(projectId, requestId, input), "La consultation n’a pas pu être enregistrée."),
    [projectId, requestId, write],
  );

  const savePrice = useCallback(
    async (quoteId: string, lineId: string, cents: number | null): Promise<SaveResult> => {
      const byLine = pending.current.get(quoteId) ?? new Map<string, PriceWrites>();
      pending.current.set(quoteId, byLine);
      const writes = byLine.get(lineId) ?? { pending: 0, value: null };
      byLine.set(lineId, writes);
      writes.pending += 1;
      writes.value = cents;
      publish();
      // Shown at once: the retain gate counts the price typed, and the server's answer has the last word.
      setItems((current) =>
        current.map((quote) =>
          quote.id === quoteId
            ? {
                ...quote,
                lines: quote.lines.map((line) => (line.line_id === lineId ? { ...line, unit_price_ht_cents: cents } : line)),
              }
            : quote,
        ),
      );
      try {
        const item = await queueWrite(async () => {
          try {
            const saved = await updateMaterialRequestQuote(projectId, requestId, quoteId, {
              lines: [{ line_id: lineId, unit_price_ht_cents: cents }],
            });
            failed.current.get(quoteId)?.delete(lineId);
            return saved;
          } catch (error) {
            const lines = failed.current.get(quoteId) ?? new Set<string>();
            lines.add(lineId);
            failed.current.set(quoteId, lines);
            throw error;
          } finally {
            writes.pending -= 1;
          }
        });
        upsert(item);
        return { ok: true };
      } catch (error) {
        // The quote as the server holds it; the cell keeps the typed price with the reason.
        reload();
        return { ok: false, message: materialRequestErrorMessage(error, "Le prix n’a pas pu être enregistré.") };
      } finally {
        publish();
      }
    },
    [projectId, publish, queueWrite, reload, requestId, upsert],
  );

  const forgetPriceFailure = useCallback(
    (quoteId: string, lineId: string) => {
      failed.current.get(quoteId)?.delete(lineId);
      publish();
    },
    [publish],
  );

  const saveDetails = useCallback(
    (quoteId: string, patch: { amount_ht_cents?: number | null; notes?: string | null }) =>
      write(() => updateMaterialRequestQuote(projectId, requestId, quoteId, patch), "Le devis n’a pas pu être enregistré."),
    [projectId, requestId, write],
  );

  const markReceived = useCallback(
    (quoteId: string) =>
      write(
        () => updateMaterialRequestQuote(projectId, requestId, quoteId, { received: true }),
        "Le devis n’a pas pu être marqué reçu.",
      ),
    [projectId, requestId, write],
  );

  const retainQuote = useCallback(
    async (quoteId: string): Promise<SaveResult> => {
      // A refused price is on screen now; one on its way is answered before the retain's turn.
      if ((failed.current.get(quoteId)?.size ?? 0) > 0) return { ok: false, message: QUOTE_PRICE_HELD };
      try {
        // Read at its turn: every price saved before the gesture has answered by now.
        const outcome = await queueWrite(async () =>
          holdsUnsavedPrice(quoteId) ? null : retainMaterialRequestQuote(projectId, requestId, quoteId),
        );
        if (outcome === null) return { ok: false, message: QUOTE_PRICE_HELD };
        mergeServerLines(outcome.lines);
        const closed = new Set(outcome.closed_quote_ids);
        setItems((current) =>
          current.map((quote) => {
            if (quote.id === outcome.item.id) return outcome.item;
            if (!closed.has(quote.id)) return quote;
            return { ...quote, status: "closed", closed_at: quote.closed_at ?? outcome.item.retained_at };
          }),
        );
        // The closing dates as the server wrote them.
        reload();
        return { ok: true };
      } catch (error) {
        if (isStale(error)) reload();
        return { ok: false, message: materialRequestErrorMessage(error, "Le devis n’a pas pu être retenu.") };
      }
    },
    [holdsUnsavedPrice, mergeServerLines, projectId, queueWrite, reload, requestId],
  );

  const closeQuote = useCallback(
    (quoteId: string) =>
      write(() => closeMaterialRequestQuote(projectId, requestId, quoteId), "Le devis n’a pas pu être clos."),
    [projectId, requestId, write],
  );

  const addFiles = useCallback(
    async (quoteId: string, files: readonly File[], onStep?: (progress: PhotoUploadStep) => void): Promise<SaveResult> => {
      const result = await uploadMaterialRequestQuoteFiles({
        projectId,
        requestId,
        quoteId,
        files,
        onStep,
        signal: leaving.current?.signal,
      });
      if (!result.ok) return { ok: false, message: result.message };
      setItems((current) =>
        current.map((quote) => {
          if (quote.id !== quoteId) return quote;
          const known = new Set(quote.files.map((file) => file.id));
          return { ...quote, files: [...quote.files, ...result.files.filter((file) => !known.has(file.id))] };
        }),
      );
      return { ok: true };
    },
    [projectId, requestId],
  );

  const refusedPrices = useCallback((quoteId: string) => refused.get(quoteId) ?? 0, [refused]);

  return useMemo(
    () => ({
      status,
      items,
      retry,
      createQuote,
      savePrice,
      forgetPriceFailure,
      refusedPrices,
      saveDetails,
      markReceived,
      retainQuote,
      closeQuote,
      addFiles,
    }),
    [
      addFiles,
      closeQuote,
      createQuote,
      forgetPriceFailure,
      items,
      markReceived,
      retainQuote,
      retry,
      saveDetails,
      savePrice,
      status,
      refusedPrices,
    ],
  );
}
