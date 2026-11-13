"use client";

import { TakeoffActionError, unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  confirmTakeoffPreparationAction,
  loadTakeoffPreparationPanelAction,
  saveTakeoffPreparationAction,
} from "@/app/dashboard/affaires/_actions/takeoff-preparation";
import type { TakeoffPreparation, TakeoffPreparationProfile } from "@/lib/takeoff/preparation";

type PanelLoad = Awaited<ReturnType<typeof loadTakeoffPreparationPanelAction>>;
type PreparationRecord = Extract<PanelLoad["preparation"], { ok: true }>["data"];
export type TakeoffPageTriageAvailability = Extract<PanelLoad["pageTriage"], { ok: true }>["data"];

/**
 * What the steps show besides the draft, read with it when the panel opens: a step sends no request when it
 * appears, so nothing waits in front of the person's save (TI-720). `pageTriage` is null when it could not be checked.
 */
export type TakeoffPreparationSupport = {
  profiles: TakeoffPreparationProfile[];
  profilesError: string | null;
  pageTriage: TakeoffPageTriageAvailability | null;
  chatGpt: PanelLoad["chatGpt"];
};

function toSupport(loaded: PanelLoad): TakeoffPreparationSupport {
  return {
    profiles: loaded.profiles.ok ? loaded.profiles.data : [],
    profilesError: loaded.profiles.ok ? null : loaded.profiles.error.message,
    pageTriage: loaded.pageTriage.ok ? loaded.pageTriage.data : null,
    chatGpt: loaded.chatGpt,
  };
}

export function useTakeoffPreparation(projectId: string) {
  const [record, setRecord] = useState<PreparationRecord | null>(null);
  const [support, setSupport] = useState<TakeoffPreparationSupport | null>(null);
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
      const loaded = await loadTakeoffPreparationPanelAction(projectId);
      if (!mounted.current || sequence !== loadSequence.current) return;
      setSupport(toSupport(loaded));
      const result = unwrapTakeoffActionResult(loaded.preparation);
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

  /**
   * A function is applied to the latest draft, which may hold an edit made since the last render: an effect
   * that completes the draft must not rebuild it from its render's copy. Returning that draft changes nothing.
   * The function is called once, synchronously, and not before a draft is loaded: it may update refs.
   */
  const updateDraft = useCallback((update: TakeoffPreparation | ((latest: TakeoffPreparation) => TakeoffPreparation)) => {
    let next: TakeoffPreparation;
    if (typeof update === "function") {
      const latest = currentDraft.current;
      if (!latest) return;
      next = update(latest);
      if (next === latest) return;
    } else {
      next = update;
    }
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

  /** Adopts a state returned by a server mutation (page triage) as the saved draft. */
  const adopt = useCallback((state: PreparationRecord) => {
    revision.current = state.revision;
    savedJson.current = JSON.stringify(state.draft);
    currentDraft.current = state.draft;
    setDraft(state.draft);
    setRecord((previous) => previous ? { ...previous, ...state } : state);
    setSaveState("saved");
    setError(null);
  }, []);

  /** Lists a profile saved from the panel, which the steps read from here rather than reloading the list. */
  const addProfile = useCallback((profile: TakeoffPreparationProfile) => {
    setSupport((previous) => previous ? { ...previous, profiles: [...previous.profiles, profile] } : previous);
  }, []);

  return { record, support, draft, updateDraft, saveState, error, save, renew, reload, confirm, adopt, addProfile };
}
