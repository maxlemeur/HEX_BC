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
import {
  MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN,
  type CreateQuoteInput,
  type MaterialRequestPricePer,
  type MaterialRequestQuote,
  type MaterialRequestQuoteRetained,
} from "@/lib/material-requests/quote-contracts";

import { uploadMaterialRequestQuoteFiles, type PhotoUploadStep } from "./photo-upload";
import type { MaterialRequestEditorApi, SaveResult } from "./useMaterialRequestEditor";

export type QuotesStatus = "loading" | "ready" | "error";

/** A price typed on the quote was refused and is still on screen: the quote is not retained on another one. */
export const QUOTE_PRICE_HELD =
  "Un prix saisi sur ce devis n’est pas enregistré : corrigez-le, ou appuyez sur Échap pour revenir au prix enregistré.";

/**
 * A quote is retained only on validated lines: what is bought is what was checked. « La ligne 2 n’est pas validée :
 * validez-la avant de retenir ce devis. », or the plural.
 */
export function linesNotValidated(positions: readonly number[]): string {
  if (positions.length === 1) {
    return `La ligne ${positions[0]} n’est pas validée : validez-la avant de retenir ce devis.`;
  }
  const named = `${positions.slice(0, -1).join(", ")} et ${positions[positions.length - 1]}`;
  return `Les lignes ${named} ne sont pas validées : validez-les avant de retenir ce devis.`;
}

/** A price on screen cannot be read: a retain would apply the saved price, not the one shown. */
export const QUOTE_PRICE_UNREADABLE = "Un prix saisi sur ce devis n’est pas lisible : corrigez-le, ou appuyez sur Échap.";

/**
 * The server refused a consultation because this supplier already has one in progress (requested or received) for
 * this request, for these lines or for others: one at a time per supplier.
 */
export function supplierAlreadyConsulted(supplierName: string, forOtherLines = false): string {
  const which = forOtherLines ? "pour d’autres lignes de cette demande" : "pour cette demande";
  return `${supplierName} a déjà une consultation en cours ${which} : retenez ou fermez d’abord son devis (« Clore »), puis consultez-le de nouveau.`;
}

export type QuoteCreationResult = { ok: true; quoteId: string } | Extract<SaveResult, { ok: false }>;

export type MaterialRequestQuotesApi = {
  status: QuotesStatus;
  /** As the server answered them; the screen orders them itself. */
  items: MaterialRequestQuote[];
  retry: () => void;
  /** « Consultation envoyée »: the quote is recorded with the message the office copied. */
  createQuote: (input: CreateQuoteInput, supplierName: string) => Promise<QuoteCreationResult>;
  /** The price of one line, in cents for `per` units: the two are always sent together. */
  savePrice: (quoteId: string, lineId: string, cents: number | null, per: MaterialRequestPricePer) => Promise<SaveResult>;
  /** The office dropped a price that could not be saved: the line holds the saved price again. */
  forgetPriceFailure: (quoteId: string, lineId: string) => void;
  /**
   * Lines of the quote whose last price was refused and is still on screen. A price on its way does not count:
   * a retain waits for its answer in the queue.
   */
  refusedPrices: (quoteId: string) => number;
  /**
   * The price field of a line shows text that cannot be read (« 12,505 »): nothing is sent, and the quote is not
   * retained while it is so. Told again when the text is corrected or given up, and when the field goes away.
   */
  setPriceUnreadable: (quoteId: string, lineId: string, unreadable: boolean) => void;
  /** Lines of the quote whose price field cannot be read, by id. */
  unreadablePrices: (quoteId: string) => readonly string[];
  saveDetails: (quoteId: string, patch: { amount_ht_cents?: number | null; notes?: string | null }) => Promise<SaveResult>;
  markReceived: (quoteId: string) => Promise<SaveResult>;
  /**
   * Prices the request's lines from the quote; the competing quotes are closed by the server. Refused, here and at
   * its turn in the queue, while a price is unsaved or unreadable or one of `lineIds` is not validated.
   */
  retainQuote: (quoteId: string, lineIds: readonly string[]) => Promise<SaveResult>;
  closeQuote: (quoteId: string) => Promise<SaveResult>;
  /** Outside the queue of writes, as the request's photos: the quote stays editable while its files travel. */
  addFiles: (quoteId: string, files: readonly File[], onStep?: (progress: PhotoUploadStep) => void) => Promise<SaveResult>;
};

type PriceWrites = { pending: number; value: number | null; per: MaterialRequestPricePer };

/** At its turn in the queue, a retain is either held back, with why, or sent and answered. */
type RetainTurn = { held: string } | { retained: MaterialRequestQuoteRetained };

/** The server changed or refused on a state the screen no longer matches: the list is read again. */
function isStale(error: unknown): boolean {
  return isEstimateApiError(error) && (error.status === 409 || error.status === 422 || error.status === 404);
}

/**
 * The quotes of one request (TI-691, delivery 2). Readers read them too; every write takes its turn in the
 * editor's queue, so that a quote is retained only after the prices and line changes made before it.
 */
export function useMaterialRequestQuotes(editor: MaterialRequestEditorApi): MaterialRequestQuotesApi {
  const { projectId, requestId, queueWrite, mergeServerLines, unvalidatedPositions } = editor;
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
  const unreadable = useRef(new Map<string, Set<string>>());
  const [unreadableShown, setUnreadableShown] = useState<ReadonlyMap<string, readonly string[]>>(new Map());
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
        return writes && writes.pending > 0 ? { ...line, unit_price_ht_cents: writes.value, price_per: writes.per } : line;
      }),
    };
  }, []);

  // In the queue of writes, as every later read: a consultation recorded while it travels is answered after it,
  // so a late answer cannot take it off the screen.
  useEffect(() => {
    const abort = new AbortController();
    queueWrite(() => fetchMaterialRequestQuotes(projectId, requestId, abort.signal))
      .then((next) => {
        if (abort.signal.aborted) return;
        setItems(next.map(overlay));
        setStatus("ready");
      })
      .catch(() => {
        if (!abort.signal.aborted) setStatus("error");
      });
    return () => abort.abort();
  }, [projectId, requestId, attempt, overlay, queueWrite]);

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

  const holdsUnreadablePrice = useCallback((quoteId: string) => (unreadable.current.get(quoteId)?.size ?? 0) > 0, []);

  const setPriceUnreadable = useCallback((quoteId: string, lineId: string, flag: boolean) => {
    const lines = unreadable.current.get(quoteId) ?? new Set<string>();
    if (lines.has(lineId) === flag) return;
    if (flag) lines.add(lineId);
    else lines.delete(lineId);
    unreadable.current.set(quoteId, lines);
    setUnreadableShown((current) => new Map(current).set(quoteId, [...lines]));
  }, []);

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
    async (input: CreateQuoteInput, supplierName: string): Promise<QuoteCreationResult> => {
      try {
        const item = await queueWrite(() => createMaterialRequestQuote(projectId, requestId, input));
        upsert(item);
        return { ok: true, quoteId: item.id };
      } catch (error) {
        if (isStale(error)) reload();
        // Said in words, not in the server's code: the consultation in progress is read again and shown.
        if (isEstimateApiError(error) && error.code === MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN) {
          return { ok: false, message: supplierAlreadyConsulted(supplierName) };
        }
        return { ok: false, message: materialRequestErrorMessage(error, "La consultation n’a pas pu être enregistrée.") };
      }
    },
    [projectId, queueWrite, reload, requestId, upsert],
  );

  const savePrice = useCallback(
    async (quoteId: string, lineId: string, cents: number | null, per: MaterialRequestPricePer): Promise<SaveResult> => {
      const byLine = pending.current.get(quoteId) ?? new Map<string, PriceWrites>();
      pending.current.set(quoteId, byLine);
      const writes = byLine.get(lineId) ?? { pending: 0, value: null, per: 1 };
      byLine.set(lineId, writes);
      writes.pending += 1;
      writes.value = cents;
      writes.per = per;
      publish();
      // Shown at once: the retain gate counts the price typed, and the server's answer has the last word.
      setItems((current) =>
        current.map((quote) =>
          quote.id === quoteId
            ? {
                ...quote,
                lines: quote.lines.map((line) =>
                  line.line_id === lineId ? { ...line, unit_price_ht_cents: cents, price_per: per } : line,
                ),
              }
            : quote,
        ),
      );
      try {
        const item = await queueWrite(async () => {
          try {
            const saved = await updateMaterialRequestQuote(projectId, requestId, quoteId, {
              lines: [{ line_id: lineId, unit_price_ht_cents: cents, price_per: per }],
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
    async (quoteId: string, lineIds: readonly string[]): Promise<SaveResult> => {
      // A refused or unreadable price, or a draft line, is on screen now; a price or a validation on its way is
      // answered before the retain's turn.
      if (holdsUnreadablePrice(quoteId)) return { ok: false, message: QUOTE_PRICE_UNREADABLE };
      if ((failed.current.get(quoteId)?.size ?? 0) > 0) return { ok: false, message: QUOTE_PRICE_HELD };
      const drafts = unvalidatedPositions(lineIds);
      if (drafts.length > 0) return { ok: false, message: linesNotValidated(drafts) };
      try {
        // Read again at its turn: every price saved and every line validated or reopened before the gesture has
        // answered by now.
        const outcome = await queueWrite(async (): Promise<RetainTurn> => {
          if (holdsUnreadablePrice(quoteId)) return { held: QUOTE_PRICE_UNREADABLE };
          if (holdsUnsavedPrice(quoteId)) return { held: QUOTE_PRICE_HELD };
          const draftsNow = unvalidatedPositions(lineIds);
          if (draftsNow.length > 0) return { held: linesNotValidated(draftsNow) };
          return { retained: await retainMaterialRequestQuote(projectId, requestId, quoteId) };
        });
        if ("held" in outcome) return { ok: false, message: outcome.held };
        const { retained } = outcome;
        mergeServerLines(retained.lines);
        const closed = new Set(retained.closed_quote_ids);
        setItems((current) =>
          current.map((quote) => {
            if (quote.id === retained.item.id) return retained.item;
            if (!closed.has(quote.id)) return quote;
            return { ...quote, status: "closed", closed_at: quote.closed_at ?? retained.item.retained_at };
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
    [holdsUnreadablePrice, holdsUnsavedPrice, mergeServerLines, projectId, queueWrite, reload, requestId, unvalidatedPositions],
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
  const unreadablePrices = useCallback(
    (quoteId: string): readonly string[] => unreadableShown.get(quoteId) ?? [],
    [unreadableShown],
  );

  return useMemo(
    () => ({
      status,
      items,
      retry,
      createQuote,
      savePrice,
      forgetPriceFailure,
      refusedPrices,
      setPriceUnreadable,
      unreadablePrices,
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
      setPriceUnreadable,
      unreadablePrices,
    ],
  );
}
