"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { reconcileProjectPlanDossier } from "@/lib/takeoff/client";

export function PlanDossierSyncNotice({
  projectId, automatic = false, onSynchronized,
}: { projectId: string; automatic?: boolean; onSynchronized: (changed: boolean) => void }) {
  const [failure, setFailure] = useState<string | null>(automatic ? null : "La vérification des plans du dossier a échoué.");
  const [busy, setBusy] = useState(false);
  const callbackRef = useRef(onSynchronized);
  callbackRef.current = onSynchronized;

  const synchronize = useCallback(async () => {
    setBusy(true);
    try {
      const changed = await reconcileProjectPlanDossier(projectId);
      setFailure(null);
      callbackRef.current(changed);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "La vérification des plans du dossier a échoué.");
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (automatic) void synchronize();
  }, [automatic, synchronize]);

  if (!failure) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-warning-border bg-warning-subtle p-3 text-sm text-warning">
      {failure} Vérifiez les pièces manquantes avant de poursuivre.{" "}
      <button type="button" className="font-semibold underline" disabled={busy} onClick={() => void synchronize()}>
        {busy ? "Actualisation…" : "Réessayer"}
      </button>
    </div>
  );
}
