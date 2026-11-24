"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import type { AnalysisProgress } from "@/lib/affaires/analysis-progress-contract";

const AnalysisProgressPopover = dynamic(() => import("./AnalysisProgressPopover"), { ssr: false });
const PROGRESS_PATH = "/api/affaires/analysis-progress";
// Match the affaire's takeoff activity cadence, with a discovery read at the waiting cadence.
const READING_INTERVAL_MS = 5_000;
const WAITING_INTERVAL_MS = 30_000;

function readSeenAt(key: string) {
  try {
    const value = Date.parse(localStorage.getItem(key) ?? "");
    return Number.isFinite(value) ? new Date(value).toISOString() : null;
  } catch {
    return null;
  }
}

function storeSeenAt(key: string, time: string) {
  try {
    localStorage.setItem(key, time);
  } catch {
    // The dashboard can still mark the panel read for this session.
  }
}

export function AnalysisProgressIndicator({ tenantId, userId }: { tenantId: string; userId: string }) {
  const storageKey = `mergeone:analysis-progress:${tenantId}:${userId}`;
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const seenRef = useRef<string | null>(null);
  const viewedRef = useRef<string | null>(null);

  useEffect(() => {
    seenRef.current = readSeenAt(storageKey);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    let disposed = false;

    async function poll() {
      if (disposed || active || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      active = controller;
      let interval = WAITING_INTERVAL_MS;
      try {
        const since = seenRef.current ? `?since=${encodeURIComponent(seenRef.current)}` : "";
        const response = await fetch(PROGRESS_PATH + since, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Analysis progress unavailable");
        const { data } = await response.json() as { data: AnalysisProgress };
        if (data.viewer.tenantId !== tenantId || data.viewer.userId !== userId) throw new Error("Analysis progress scope changed");
        if (disposed) return;
        setProgress(data);
        if (data.affaires.some(({ lines }) => lines.some((line) => line.state === "reading"))) {
          interval = READING_INTERVAL_MS;
        }
      } catch {
        if (!disposed) setProgress(null);
      } finally {
        active = null;
        if (!disposed && document.visibilityState === "visible") timer = setTimeout(poll, interval);
      }
    }

    function onVisibilityChange() {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void poll();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      disposed = true;
      active?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [storageKey, tenantId, userId]);

  // While the panel is open, remember what was shown without changing its read window.
  useEffect(() => {
    if (!open || !progress || document.visibilityState !== "visible") return;
    const time = progress.observedAt;
    const stored = readSeenAt(storageKey);
    if (stored && stored > time) {
      viewedRef.current = stored;
    } else if (!viewedRef.current || time > viewedRef.current) {
      viewedRef.current = time;
      storeSeenAt(storageKey, time);
    }
  }, [open, progress, storageKey]);

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next && viewedRef.current) {
      seenRef.current = viewedRef.current;
      setSeenAt(viewedRef.current);
    }
  }

  const affaires = progress?.affaires.map(({ lines, ...affaire }) => ({
    ...affaire, lines: lines.filter((line) => line.state !== "finished" || !seenAt || line.updatedAt > seenAt),
  })).filter(({ lines }) => lines.length > 0) ?? [];
  if (affaires.length === 0 && !open) return null;

  return <AnalysisProgressPopover affaires={affaires} open={open} unavailable={!progress} onOpenChange={changeOpen} />;
}
