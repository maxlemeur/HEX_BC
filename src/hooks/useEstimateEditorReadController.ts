"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  fetchEstimateEditorData,
  fetchEstimateSuggestionLearnings,
  isEstimateApiError,
  type SuggestionLearningState,
} from "@/lib/estimates/client";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import { isOlderEstimateVersionToken } from "@/lib/estimates/version-token";

type ReadScope = { versionId: string; actorId: string | null; tenantId: string | null };
type ReadVersion = { id: string; tenant_id: string; updated_at: string };
type PreparedRead = ReturnType<typeof prepareEstimateEditorRead>;
type ReadState =
  | { status: "loading" | "refreshing" | "ready"; error: null }
  | { status: "failed"; error: string };

function sameScope(left: ReadScope | null, right: ReadScope) {
  return left?.versionId === right.versionId && left.actorId === right.actorId &&
    left.tenantId === right.tenantId;
}

/** Read status must exist before synchronization derives whether writes are allowed. */
export function useEstimateEditorReadState() {
  const [state, setState] = useState<ReadState>({ status: "loading", error: null });
  return { state, setState, isLoading: state.status === "loading", loadError: state.error };
}

/** Owns read requests and their lifecycle; confirmed data and local edits stay with the document owner. */
export function useEstimateEditorReadController(input: ReadScope & {
  readState: ReturnType<typeof useEstimateEditorReadState>;
  reloadToken: number;
  isLaborSplitEnabled: boolean;
  autoOpenVersionZero: boolean;
  handlers: {
    getCurrentVersion: () => ReadVersion | null;
    isRecoveryRequired: boolean;
    clearSuggestions: () => void;
    apply: (read: PreparedRead, learning: SuggestionLearningState | null, preserveLocalDraft: boolean) => void;
    finish: (succeeded: boolean) => void;
    reportRefreshError: (message: string) => void;
    resolveErrorMessage: (message: string) => string;
  };
}) {
  const { versionId, actorId, tenantId, reloadToken, isLaborSplitEnabled, autoOpenVersionZero } = input;
  const { setState } = input.readState;
  const loadedScope = useRef<ReadScope | null>(null);
  const currentScope = useRef<ReadScope>({ versionId, actorId, tenantId });
  const handlers = useRef(input.handlers);

  useLayoutEffect(() => {
    currentScope.current = { versionId, actorId, tenantId };
    handlers.current = input.handlers;
  }, [versionId, actorId, tenantId, input.handlers]);

  useEffect(() => {
    if (!versionId) {
      let active = true;
      queueMicrotask(() => { if (active) handlers.current.clearSuggestions(); });
      return () => { active = false; };
    }
    const scope = { versionId, actorId, tenantId };
    const current = handlers.current.getCurrentVersion();
    const hasLoadedVersion = sameScope(loadedScope.current, scope) && current?.id === versionId;
    // A failed mutation read is recovered explicitly by its existing recovery owner.
    if (hasLoadedVersion && handlers.current.isRecoveryRequired) return;
    let active = true;
    let hasReadData = false;
    const learningController = new AbortController();
    const isCurrent = () => active && sameScope(currentScope.current, scope);

    async function load() {
      setState({ status: hasLoadedVersion ? "refreshing" : "loading", error: null });
      if (!hasLoadedVersion) handlers.current.clearSuggestions();
      try {
        const [data, learning] = await Promise.all([
          fetchEstimateEditorData(versionId),
          fetchEstimateSuggestionLearnings(versionId, { signal: learningController.signal }).catch((error) => {
            // Report one task later: unloading a document must not report an aborted read.
            window.setTimeout(() => {
              if (isCurrent()) console.error("Impossible de charger les apprentissages de suggestions.", error);
            }, 0);
            return null;
          }),
        ]);
        if (!isCurrent()) return;
        hasReadData = true;
        if (data.version.id !== versionId || (tenantId && data.version.tenant_id !== tenantId)) {
          throw new Error("Les données reçues appartiennent à un autre devis ou une autre organisation.");
        }
        const latest = handlers.current.getCurrentVersion();
        if (latest?.id === versionId && isOlderEstimateVersionToken(data.version.updated_at, latest.updated_at)) {
          handlers.current.finish(false);
          setState({ status: "ready", error: null });
          return;
        }
        const prepared = prepareEstimateEditorRead(data, isLaborSplitEnabled);
        handlers.current.apply(prepared, learning, hasLoadedVersion);
        loadedScope.current = actorId && tenantId ? scope : null;
        handlers.current.finish(true);
        setState({ status: "ready", error: null });
      } catch (error) {
        if (!isCurrent()) return;
        const transient = !hasReadData && (
          error instanceof TypeError || (error instanceof Error && error.name === "AbortError") ||
          (isEstimateApiError(error) && error.status >= 500 && error.status < 600)
        );
        if (hasLoadedVersion && transient) {
          handlers.current.reportRefreshError(handlers.current.isRecoveryRequired
            ? "La lecture du devis reste interrompue. Vérifiez le résultat ; vos saisies sont conservées."
            : "Impossible de relire le chiffrage. Vos saisies sont conservées.");
          setState({ status: "ready", error: null });
        } else {
          setState({ status: "failed", error: error instanceof Error
            ? handlers.current.resolveErrorMessage(error.message)
            : "Impossible de charger le chiffrage." });
        }
        handlers.current.finish(false);
      }
    }
    void load();
    return () => {
      active = false;
      learningController.abort();
    };
  }, [actorId, tenantId, versionId, reloadToken, isLaborSplitEnabled, autoOpenVersionZero, setState]);

  return input.readState;
}
