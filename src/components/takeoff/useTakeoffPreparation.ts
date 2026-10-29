"use client";

import { TakeoffActionError, unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  confirmTakeoffPreparationAction,
  loadTakeoffPreparationAction,
  saveTakeoffPreparationAction,
} from "@/app/dashboard/affaires/_actions/takeoff-preparation";
import type { TakeoffPreparation } from "@/lib/takeoff/preparation";

type PreparationRecord = Extract<Awaited<ReturnType<typeof loadTakeoffPreparationAction>>, { ok: true }>["data"];

export function useTakeoffPreparation(projectId: string) {
  const [record, setRecord] = useState<PreparationRecord | null>(null);
  const [draft, setDraft] = useState<TakeoffPreparation | null>(null);
  const [saveState, setSaveState] = useState<"loading" | "saved" | "pending" | "saving" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const currentDraft = useRef<TakeoffPreparation | null>(null);
  const savedJson = useRef("");
  const revision = useRef<number | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const loadSequence = useRef(0);

  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const draftAtStart = currentDraft.current;
    setSaveState("loading");
    setError(null);
    try {
      const result = unwrapTakeoffActionResult(await loadTakeoffPreparationAction(projectId));
      if (!mounted.current || sequence !== loadSequence.current) return;
      if (currentDraft.current !== draftAtStart) {
        setError("La préparation a été modifiée pendant le chargement. Vos réponses sont conservées ; reprenez la dernière version si nécessaire.");
        setSaveState("error");
        return;
      }
      revision.current = result.revision;
      savedJson.current = JSON.stringify(result.draft);
      currentDraft.current = result.draft;
      setRecord(result);
      setDraft(result.draft);
      setSaveState("saved");
    } catch (cause) {
      if (!mounted.current || sequence !== loadSequence.current) return;
      setError(cause instanceof TakeoffActionError ? cause.message : "Impossible de retrouver la préparation.");
      setSaveState("error");
    }
  }, [projectId]);

  useEffect(() => {
    const sequence = loadSequence;
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; sequence.current++; };
  }, [reload]);

  const updateDraft = useCallback((next: TakeoffPreparation) => {
    currentDraft.current = next;
    setDraft(next);
    setSaveState("pending");
    setError(null);
  }, []);

  const persist = useCallback(async (force: boolean) => {
    const operation = queue.current.catch(() => undefined).then(async () => {
      const snapshot = currentDraft.current;
      if (!snapshot) throw new Error("La préparation n'est pas encore chargée.");
      if (!force && JSON.stringify(snapshot) === savedJson.current && revision.current !== null) return revision.current;
      if (mounted.current) setSaveState("saving");
      try {
        const result = unwrapTakeoffActionResult(await saveTakeoffPreparationAction({
          projectId,
          draft: snapshot,
          expectedRevision: revision.current,
        }));
        revision.current = result.revision;
        const unchangedSinceRequest = JSON.stringify(currentDraft.current) === JSON.stringify(snapshot);
        savedJson.current = JSON.stringify(result.draft);
        if (unchangedSinceRequest) currentDraft.current = result.draft;
        if (mounted.current) {
          if (unchangedSinceRequest) setDraft(result.draft);
          setRecord((previous) => previous ? { ...previous, ...result } : result);
          setSaveState(JSON.stringify(currentDraft.current) === savedJson.current ? "saved" : "pending");
        }
        return result.revision;
      } catch (cause) {
        if (mounted.current) {
          setSaveState("error");
          setError(cause instanceof TakeoffActionError ? cause.message : "L'enregistrement a échoué. Vos réponses restent affichées.");
        }
        throw cause;
      }
    });
    queue.current = operation;
    return operation;
  }, [projectId]);

  const save = useCallback(() => persist(false), [persist]);
  const renew = useCallback(() => persist(true), [persist]);

  useEffect(() => {
    if (!draft || saveState !== "pending") return;
    const timer = window.setTimeout(() => { void save().catch(() => undefined); }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, save, saveState]);

  useEffect(() => () => {
    if (currentDraft.current && JSON.stringify(currentDraft.current) !== savedJson.current) {
      void save().catch(() => undefined);
    }
  }, [save]);

  const confirm = useCallback(async () => {
    const savedRevision = await save();
    if (savedRevision === null) throw new Error("Enregistrez la préparation avant de confirmer.");
    const confirmed = unwrapTakeoffActionResult(await confirmTakeoffPreparationAction({ projectId, expectedRevision: savedRevision }));
    revision.current = confirmed.revision;
    savedJson.current = JSON.stringify(confirmed.draft);
    currentDraft.current = confirmed.draft;
    setDraft(confirmed.draft);
    setRecord((previous) => previous ? { ...previous, ...confirmed } : confirmed);
    return confirmed.revision;
  }, [projectId, save]);

  return { record, draft, updateDraft, saveState, error, save, renew, reload, confirm };
}
