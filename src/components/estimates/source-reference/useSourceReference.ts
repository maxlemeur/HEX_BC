"use client";

import { useEffect, useRef, useState } from "react";

import {
  sourceReferenceConfirmationInputSchema,
  sourceReferenceConfirmationResultSchema,
  sourceReferencePreparationResultSchema,
  sourceReferenceReviewSchema,
  type SourceReferenceConfirmationResult,
  type SourceReferenceCopy,
  type SourceReferenceReview,
} from "@/lib/estimates/source-reference-contracts";

import { readSourceReferencePdf, sourceReferenceJson, SourceReferenceRequestError } from "./source-reference-client";
import { emptySourceReferenceIntent, readSourceReferenceIntent, saveSourceReferenceIntent, type SourceReferenceIntent, type SourceReferenceScope } from "./source-reference-state";

type Busy = "read" | "prepare" | "confirm" | "pdf" | "history" | null;
type Viewer = { url: string; copyId: string; fileName: string };
type Failure = { message: string; code: string | null; kind: Busy };

export function useSourceReference(scope: SourceReferenceScope, initialReview: SourceReferenceReview) {
  const [review, setReview] = useState(initialReview);
  const [history, setHistory] = useState(initialReview.history);
  const [nextCursor, setNextCursor] = useState(initialReview.nextBeforeRevision);
  const [intent, setIntent] = useState(() => emptySourceReferenceIntent(scope));
  const [prepared, setPrepared] = useState<SourceReferenceCopy | null>(null);
  const [busy, setBusy] = useState<Busy>("read");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [consultedCopyId, setConsultedCopyId] = useState<string | null>(null);
  const [humanReviewed, setHumanReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState<SourceReferenceConfirmationResult | null>(null);
  const intentRef = useRef(intent);
  const reviewRef = useRef(review);
  const operation = useRef<{ id: number; controller: AbortController } | null>(null);
  const sequence = useRef(0);
  const objectUrl = useRef<string | null>(null);
  const requestedPdf = useRef<string | null>(null);
  const endpoint = `/api/estimates/${scope.versionId}/source-review`;

  function closeViewer() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setViewer(null);
  }

  function persist(next: SourceReferenceIntent) {
    try {
      saveSourceReferenceIntent(scope, next);
      intentRef.current = next;
      setIntent(next);
      setStorageError(null);
      return true;
    } catch {
      setStorageError("La reprise après rechargement est indisponible dans cet onglet. Réactivez le stockage de session puis réessayez ; aucune nouvelle demande ne sera envoyée tant que son intention ne peut pas être conservée.");
      return false;
    }
  }

  function acceptReview(next: SourceReferenceReview, mode: "reset" | "keep" | "append" = "reset") {
    if (next.versionId !== scope.versionId) throw new Error("La réponse concerne un autre chiffrage.");
    const changed = next.revision !== reviewRef.current.revision;
    if (changed) { setHumanReviewed(false); setConsultedCopyId(null); }
    reviewRef.current = next;
    setReview(next);
    if (mode === "append" && !changed) {
      setHistory((previous) => [...previous, ...next.history.filter((entry) => !previous.some((old) => old.id === entry.id))]);
      setNextCursor(next.nextBeforeRevision);
    } else if (mode !== "keep" || changed) {
      setHistory(next.history);
      setNextCursor(next.nextBeforeRevision);
    }
  }

  async function run(kind: Exclude<Busy, null>, work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (operation.current) return;
    const op = { id: ++sequence.current, controller: new AbortController() };
    operation.current = op;
    setBusy(kind);
    setFailure(null);
    const current = () => operation.current?.id === op.id && !op.controller.signal.aborted;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; op.controller.abort(); }, 75_000);
    try { await work(op.controller.signal, current); }
    catch (error) {
      if (current()) setFailure({ kind, code: error instanceof SourceReferenceRequestError ? error.code : null,
        message: error instanceof SourceReferenceRequestError ? error.message : kind === "pdf" ? "Source indisponible. La copie conservée n’a pas pu être vérifiée. Réessayez." : "La demande n’a pas pu être vérifiée. Réessayez avec la même intention." });
    } finally {
      clearTimeout(deadline);
      if (operation.current?.id === op.id) {
        if (timedOut) setFailure({ kind, code: null, message: "Le serveur n’a pas répondu à temps. Votre intention est conservée ; reprenez la même demande pour vérifier son résultat." });
        operation.current = null;
        setBusy(null);
      }
    }
  }

  async function loadReview(signal: AbortSignal, saved: SourceReferenceIntent, current: () => boolean) {
    const query = new URLSearchParams({ limit: "20" });
    if (saved.copyId) query.set("copyId", saved.copyId);
    if (saved.confirmation) query.set("confirmationKey", saved.confirmation.idempotencyKey);
    const next = await sourceReferenceJson(`${endpoint}?${query}`, sourceReferenceReviewSchema, signal);
    if (!current()) return;
    acceptReview(next);
    if (saved.copyId) {
      if (next.selectedCopy?.copyId !== saved.copyId) throw new Error("La copie demandée est absente.");
      setPrepared(next.selectedCopy);
    }
  }

  useEffect(() => {
    // Read the tab's storage only after hydration. A replay always needs a click.
    let disposed = false;
    void Promise.resolve().then(async () => {
      if (disposed) return;
      let saved: SourceReferenceIntent;
      try { saved = readSourceReferenceIntent(scope); }
      catch {
        setStorageError("La reprise conservée est illisible ou le stockage de session est indisponible. Aucune demande n’a été envoyée.");
        setBusy(null);
        return;
      }
      intentRef.current = saved;
      setIntent(saved);
      if (saved.copyId || saved.confirmation) await run("read", (signal, current) => loadReview(signal, saved, current));
      else setBusy(null);
    });
    return () => {
      disposed = true;
      operation.current?.controller.abort();
      operation.current = null;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    };
    // The server keys this island by actor, tenant and version; a new scope remounts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refresh() {
    return run("read", async (signal, current) => {
      const saved = readSourceReferenceIntent(scope);
      intentRef.current = saved;
      setIntent(saved);
      setStorageError(null);
      await loadReview(signal, saved, current);
    });
  }

  function prepare(documentId?: string) {
    return run("prepare", async (signal, current) => {
      const previous = intentRef.current;
      if (previous.confirmation) return;
      if (documentId && previous.preparation && !previous.copyId) {
        setFailure({ kind: "prepare", code: null, message: "Une préparation attend son résultat. Reprenez-la ou abandonnez explicitement cette intention avant de choisir un autre document." });
        return;
      }
      const request = documentId ? { documentId, expectedRevision: reviewRef.current.revision, preparationKey: crypto.randomUUID() } : previous.preparation;
      if (!request) return;
      const nextIntent = { ...previous, preparation: request, copyId: documentId ? null : previous.copyId };
      if (!persist(nextIntent)) return;
      if (documentId) { closeViewer(); setPrepared(null); setHumanReviewed(false); setConsultedCopyId(null); setConfirmation(null); }
      const result = await sourceReferenceJson(`${endpoint}/copies`, sourceReferencePreparationResultSchema, signal, request);
      if (!current()) return;
      if (result.versionId !== scope.versionId || result.reviewRevision < request.expectedRevision) throw new Error("Préparation incohérente.");
      const saved = { ...nextIntent, copyId: result.copy.copyId };
      persist(saved);
      setPrepared(result.copy);
      await loadReview(signal, saved, current);
    });
  }

  function consult(copyId: string) {
    return run("pdf", async (signal, current) => {
      requestedPdf.current = copyId;
      closeViewer();
      setHumanReviewed(false);
      setConsultedCopyId(null);
      const next = await sourceReferenceJson(`${endpoint}?copyId=${encodeURIComponent(copyId)}&limit=20`, sourceReferenceReviewSchema, signal);
      if (!current()) return;
      if (next.selectedCopy?.copyId !== copyId || next.selectedCopy.state !== "verified") throw new Error("Cette copie n’est pas vérifiée.");
      acceptReview(next, "keep");
      const blob = await readSourceReferencePdf(scope.versionId, next.selectedCopy, signal);
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      setViewer({ url, copyId, fileName: next.selectedCopy.fileName });
      setConsultedCopyId(copyId);
    });
  }

  function confirm(reason?: string) {
    return run("confirm", async (signal, current) => {
      const previous = intentRef.current;
      let request = previous.confirmation;
      if (!request) {
        if (!prepared || prepared.state !== "verified" || consultedCopyId !== prepared.copyId || !humanReviewed || reason === undefined) return;
        request = sourceReferenceConfirmationInputSchema.parse({ copyId: prepared.copyId, expectedRevision: reviewRef.current.revision,
          idempotencyKey: crypto.randomUUID(), reviewedSha256: prepared.sha256, reason });
      }
      const nextIntent = { ...previous, copyId: request.copyId, confirmation: request };
      if (!persist(nextIntent)) return;
      const result = await sourceReferenceJson(`${endpoint}/reference`, sourceReferenceConfirmationResultSchema, signal, request);
      if (!current()) return;
      if (result.activation.copyId !== request.copyId || result.activation.revision !== request.expectedRevision + 1 || result.currentRevision < result.activation.revision) throw new Error("Confirmation incohérente.");
      setConfirmation(result);
      // An acknowledged response clears the pending replay, never a speculative GET.
      const saved = { ...nextIntent, confirmation: null };
      persist(saved);
      setHumanReviewed(false);
      await loadReview(signal, saved, current);
    });
  }

  function newDecision() {
    return run("read", async (signal, current) => {
      const next = await sourceReferenceJson(`${endpoint}?limit=20`, sourceReferenceReviewSchema, signal);
      if (!current()) return;
      // Explicit human action, after a fresh read; no old request is rewritten.
      if (!persist({ ...intentRef.current, confirmation: null, preparation: null })) return;
      acceptReview(next);
      setHumanReviewed(false);
      setConsultedCopyId(null);
      setConfirmation(null);
      closeViewer();
    });
  }

  function discardStoredIntent() {
    return run("read", async (signal, current) => {
      const next = await sourceReferenceJson(`${endpoint}?limit=20`, sourceReferenceReviewSchema, signal);
      if (!current() || !persist(emptySourceReferenceIntent(scope))) return;
      acceptReview(next);
      setPrepared(null);
      setHumanReviewed(false);
      setConsultedCopyId(null);
      setConfirmation(null);
      closeViewer();
    });
  }

  function moreHistory() {
    if (!nextCursor) return;
    return run("history", async (signal, current) => {
      const next = await sourceReferenceJson(`${endpoint}?cursor=${nextCursor}&limit=20`, sourceReferenceReviewSchema, signal);
      if (!current()) return;
      if (next.revision !== reviewRef.current.revision) {
        await loadReview(signal, intentRef.current, current);
        return;
      }
      acceptReview(next, "append");
    });
  }

  return { review, history, nextCursor, intent, prepared, busy, failure, storageError, viewer, consultedCopyId,
    humanReviewed, confirmation, setHumanReviewed, prepare, confirm, consult, closeViewer, refresh, newDecision, discardStoredIntent, moreHistory,
    retry: () => failure?.kind === "pdf" && requestedPdf.current ? consult(requestedPdf.current) : refresh() };
}
