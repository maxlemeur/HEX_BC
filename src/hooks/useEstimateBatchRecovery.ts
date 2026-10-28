"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { inspectEstimateBatchReceipt, resumeEstimateBatchOperation, type EstimateBatchResult } from "@/lib/estimates/client";
import {
  clearEstimateBatchIntention, isEstimateBatchSending, readEstimateBatchIntention,
  subscribeEstimateBatchIntention, type EstimateBatchIdentity, type EstimateBatchIntention,
} from "@/lib/estimates/batch-intentions";
import type { EstimateItemUpdatePayload } from "@/lib/estimates/editor-items";

type Input = {
  versionId: string;
  actorId: string | null;
  tenantId: string | null;
  updatePending: (update: (pending: Map<string, EstimateItemUpdatePayload>) => void) => void;
  onBufferedChanges: () => void;
  triggerReload: () => void;
  reportError: (message: string | null) => void;
  reportNotice: (message: string | null) => void;
};
type RecoveryState = { blocked: boolean; message: string | null; canResume: boolean; canAbandon?: boolean };
const EMPTY: RecoveryState = { blocked: false, message: null, canResume: false };

export function useEstimateBatchRecovery(input: Input) {
  const latest = useRef(input);
  useLayoutEffect(() => { latest.current = input; });
  const [state, setState] = useState<RecoveryState>(EMPTY);
  const [isBusy, setIsBusy] = useState(false);
  const generation = useRef(0);
  const resolved = useRef<{ intention: EstimateBatchIntention; committed: boolean; abandoned?: boolean } | null>(null);
  const identity = useCallback((): EstimateBatchIdentity | null => {
    const { versionId, actorId, tenantId } = latest.current;
    return actorId && tenantId ? {
      versionId: versionId.toLowerCase(), actorId: actorId.toLowerCase(), tenantId: tenantId.toLowerCase(),
    } : null;
  }, []);
  const refresh = useCallback(() => {
    const scope = identity();
    if (!scope) { setState(EMPTY); return; }
    try {
      const pending = readEstimateBatchIntention(scope);
      const sending = isEstimateBatchSending(scope);
      setState(pending ? {
        blocked: !sending,
        message: sending ? null : "Le résultat d'une opération reste à vérifier. Vos modifications locales sont conservées.",
        canResume: !sending,
        canAbandon: !sending && pending.workflow === "generated-ouvrage",
      } : EMPTY);
    } catch (error) {
      setState({ blocked: true, message: error instanceof Error ? error.message : "Impossible de lire la demande en attente.", canResume: false });
    }
  }, [identity]);
  useLayoutEffect(() => {
    generation.current += 1;
    resolved.current = null;
    let active = true;
    const stop = subscribeEstimateBatchIntention(refresh);
    queueMicrotask(() => { if (active) { setIsBusy(false); refresh(); } });
    return () => { active = false; generation.current += 1; stop(); };
  }, [input.actorId, input.tenantId, input.versionId, refresh]);

  const settle = useCallback(async (pending: EstimateBatchIntention, result: EstimateBatchResult, epoch: number) => {
    const { reconcileEstimateBatchBuffer } = await import("@/lib/estimates/reconcile-batch-buffer");
    if (epoch !== generation.current) return;
    if (result.committed) {
      latest.current.updatePending((buffer) => reconcileEstimateBatchBuffer(pending, result, buffer));
      latest.current.reportNotice("L'opération est enregistrée. Les données actuelles du devis sont en cours de rechargement.");
    } else {
      const failed = result.results.find((entry) => entry.status === "error");
      latest.current.reportError(failed?.message ?? "L'opération a été refusée sans modification. Vos saisies locales sont conservées.");
    }
    resolved.current = { intention: pending, committed: result.committed };
    latest.current.onBufferedChanges();
    latest.current.triggerReload();
  }, []);

  const check = useCallback(async (mode: "verify" | "resume" | "abandon") => {
    if (isBusy) return;
    const scope = identity();
    if (!scope) return;
    const epoch = generation.current;
    setIsBusy(true);
    try {
      const pending = readEstimateBatchIntention(scope);
      if (!pending) { refresh(); return; }
      if (pending.workflow === "generated-ouvrage") {
        const { inspectGeneratedOuvrageReceipt, resumeGeneratedOuvrageApplication, abandonPendingGeneratedOuvrageApplication } =
          await import("@/lib/estimates/generated-ouvrage-client");
        if (epoch !== generation.current) return;
        const result = mode === "abandon" ? await abandonPendingGeneratedOuvrageApplication(scope)
          : mode === "resume" ? await resumeGeneratedOuvrageApplication(scope) : await inspectGeneratedOuvrageReceipt(scope);
        if (epoch !== generation.current) return;
        if (result) {
          const abandoned = "outcome" in result;
          resolved.current = { intention: pending, committed: !abandoned, abandoned };
          latest.current.onBufferedChanges();
          latest.current.reportNotice(abandoned
            ? "Cette demande est clôturée sans application. Le devis actuel est en cours de rechargement."
            : "Les ouvrages sont enregistrés et conservés. Le devis actuel est en cours de rechargement.");
          latest.current.triggerReload();
        } else {
          setState({ blocked: true, canResume: true, canAbandon: true,
            message: "Aucun résultat n'est encore disponible. Vous pouvez reprendre exactement la même application des ouvrages." });
        }
        return;
      }
      if (mode === "abandon") return;
      const result = mode === "resume" ? await resumeEstimateBatchOperation(scope) : await inspectEstimateBatchReceipt(scope);
      if (epoch !== generation.current) return;
      if (result) await settle(pending, result, epoch);
      else setState({ blocked: true, canResume: true,
        message: "Aucun résultat n'est encore disponible. Vous pouvez reprendre exactement la même opération ; aucune nouvelle demande n'a été créée." });
    } catch (error) {
      if (epoch !== generation.current) return;
      latest.current.reportError(error instanceof Error ? error.message : "La vérification a échoué. La demande reste conservée.");
      refresh();
    } finally {
      if (epoch === generation.current) setIsBusy(false);
    }
  }, [identity, isBusy, refresh, settle]);
  const finishReload = useCallback((succeeded: boolean) => {
    const resolution = resolved.current;
    if (!resolution || !succeeded) return;
    const pending = resolution.intention;
    const scope = identity();
    if (!scope || scope.actorId !== pending.actorId || scope.tenantId !== pending.tenantId || scope.versionId !== pending.versionId) return;
    try {
      clearEstimateBatchIntention(scope, pending.operationKey);
      resolved.current = null;
      if (resolution.committed || resolution.abandoned) latest.current.reportError(null);
      latest.current.reportNotice(resolution.committed
        ? "Le résultat de l'opération est vérifié. Le devis affiche ses données actuelles."
        : resolution.abandoned
          ? "La demande est abandonnée sans application. Le devis est rechargé ; vous pouvez reprendre la revue."
          : "L'opération a été refusée sans modification. Le devis est rechargé ; vos saisies restent disponibles.");
    } catch (error) {
      latest.current.reportError(error instanceof Error ? error.message : "Impossible de clôturer la demande locale.");
    }
    refresh();
  }, [identity, refresh]);
  return { ...state, isBusy, verify: () => check("verify"), resume: () => check("resume"), abandon: () => check("abandon"), finishReload };
}
