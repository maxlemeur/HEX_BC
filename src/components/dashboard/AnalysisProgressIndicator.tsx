"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AnalysisProgress } from "@/lib/affaires/analysis-progress-contract";

const AnalysisProgressPopover = dynamic(() => import("./AnalysisProgressPopover"), { ssr: false });
const PROGRESS_PATH = "/api/affaires/analysis-progress";
// Match the affaire's takeoff activity cadence, with a discovery read at the waiting cadence.
const READING_INTERVAL_MS = 5_000;
const WAITING_INTERVAL_MS = 30_000;
const HISTORY_WINDOW_MS = 24 * 60 * 60_000;

type Seen = Map<string, number>;
type Page = { cursor: string | null; data: AnalysisProgress };

function storedCompletions(key: string): Seen {
  if (typeof window === "undefined") return new Map();
  try {
    const values: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    const now = Date.now();
    return new Map(Array.isArray(values) ? values.filter(
      (entry): entry is [string, number] => Array.isArray(entry) && /^[a-f0-9]{64}$/.test(entry[0]) &&
        typeof entry[1] === "number" && entry[1] > now,
    ) : []);
  } catch {
    return new Map();
  }
}

function unreadAffaires(data: AnalysisProgress | undefined, seen: Seen) {
  return data?.affaires.map(({ lines, ...affaire }) => ({
    ...affaire, lines: lines.filter((line) => line.state !== "finished" ||
      line.completionKeys.some((key) => !seen.has(key))),
  })).filter(({ lines }) => lines.length > 0) ?? [];
}

export function AnalysisProgressIndicator({ tenantId, userId }: { tenantId: string; userId: string }) {
  const storageKey = `mergeone:analysis-progress:completions:${tenantId}:${userId}`;
  const [progress, setProgress] = useState<Page | null>(null);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ cursor: string | null }>({ cursor: null });
  const [seen, setSeen] = useState(() => storedCompletions(storageKey));
  const seenRef = useRef(seen);
  const openRef = useRef(false);

  useEffect(() => {
    let cursor = selection.cursor;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | null = null;
    let disposed = false;

    async function poll() {
      if (disposed || active || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      active = controller;
      let interval = WAITING_INTERVAL_MS;
      try {
        const search = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const response = await fetch(PROGRESS_PATH + search, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Analysis progress unavailable");
        const { data } = await response.json() as { data: AnalysisProgress };
        if (data.viewer.tenantId !== tenantId || data.viewer.userId !== userId) throw new Error("Analysis progress scope changed");
        if (disposed) return;
        setProgress({ cursor, data });
        if (data.affaires.some(({ lines }) => lines.some((line) => line.state === "reading"))) {
          interval = READING_INTERVAL_MS;
        }
        // An already-seen first page must not hide unseen work behind it.
        // Look at one more page on the next tick, only while the panel is closed.
        if (!openRef.current && unreadAffaires(data, seenRef.current).length === 0) {
          cursor = data.nextCursor;
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
  }, [selection, tenantId, userId]);

  const acknowledge = useCallback((keys: string[]) => {
    if (!openRef.current || document.visibilityState !== "visible" || keys.every((key) => seenRef.current.has(key))) return;
    const now = Date.now();
    const seen = storedCompletions(storageKey);
    for (const [key, expiresAt] of seenRef.current) if (expiresAt > now) seen.set(key, expiresAt);
    for (const key of keys) if (!seen.has(key)) seen.set(key, now + HISTORY_WINDOW_MS);
    seenRef.current = seen;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...seen]));
    } catch {
      // Keep exact acknowledgements in this tab if storage is unavailable.
    }
  }, [storageKey]);

  function changeOpen(next: boolean) {
    openRef.current = next;
    setOpen(next);
    if (!next) {
      setSeen(seenRef.current);
      if (progress?.cursor || selection.cursor) setSelection({ cursor: null });
    }
  }

  const affaires = unreadAffaires(progress?.data, seen);
  if (affaires.length === 0 && !open) return null;

  return <AnalysisProgressPopover
    affaires={affaires}
    open={open}
    unavailable={!progress}
    pageCursor={progress?.cursor ?? null}
    nextCursor={progress?.data.nextCursor ?? null}
    onPageChange={(cursor) => setSelection({ cursor })}
    onOpenChange={changeOpen}
    onSeen={acknowledge}
  />;
}
