"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchTakeoffJobWithAllItems, TAKEOFF_WRITE_REQUEST_TIMEOUT_MS } from "@/lib/takeoff/client";
import type { TakeoffJobDetailResponse } from "@/lib/takeoff/types";

/** Job-level recovery, independent of quantity editing. Persisted stale lines continue to block application. */
export function TakeoffRulesRecovery({ jobId, pending, disabled, beginRevision, getRevision, onRefreshed }: {
  jobId: string;
  pending: boolean;
  disabled: boolean;
  beginRevision: () => number;
  getRevision: () => number;
  onRefreshed: (detail: TakeoffJobDetailResponse) => void;
}) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!pending && !busy && !error) return null;
  async function recover() {
    if (running.current) return;
    running.current = true;
    const revision = beginRevision();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/takeoff/jobs/${encodeURIComponent(jobId)}/rules/recompute`, {
        method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(TAKEOFF_WRITE_REQUEST_TIMEOUT_MS),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true || typeof body.data?.pending !== "boolean") throw new Error("Recalcul indisponible. Réessayez avec le bouton.");
      const detail = await fetchTakeoffJobWithAllItems(jobId);
      if (getRevision() !== revision) return;
      onRefreshed(detail);
      if (body.data.pending) setError("Des règles restent à recalculer. L’application reste bloquée.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de recalculer les règles.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return <span className="flex flex-wrap items-center gap-2 text-xs" role="status">
    <span>{error ?? (busy ? "Recalcul en cours…" : "Règles à recalculer")}</span>
    <Button size="sm" variant="secondary" disabled={disabled || busy} onClick={() => { void recover(); }}>
      Recalculer les règles
    </Button>
  </span>;
}
