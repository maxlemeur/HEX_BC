"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";

// What the affaire page waits for on its own (the documents of the dossier while they are added and
// analysed, the plans they become) is read through the application's API and shown from that read.
// It used to come from router.refresh(): Next hands a refresh's data to the router as it streams,
// and the router shows its updates in order, so what a save brought to the screen (its saved state,
// the end of a « Enregistrement… » transition) waited behind every refresh in flight (TI-722).
export type AffaireDossierRead = {
  workspace: AffaireIntakeWorkspace;
  // Absent when the read did not ask for the plans, or could not read them.
  plansSummary?: AffaireHubPlansSummaryData | null;
};

export type AffaireDossier = {
  workspace: AffaireIntakeWorkspace | null | undefined;
  plansSummary: AffaireHubPlansSummaryData | null;
  // A read is on screen, over the server's render: what the server computed from the dossier may be behind.
  fromRead: boolean;
  // The plans on screen come from a read.
  plansFromRead: boolean;
  // Reads the dossier again. One read at a time: a reload asked during a read sends one more read
  // after it, since the read in flight may predate what the caller waits for. Never rejects: a
  // failed read keeps the documents on screen, and the next poll asks again.
  reload: () => Promise<void>;
};

class RefusedRead extends Error {}

async function readDossier(projectId: string, plans: boolean): Promise<AffaireDossierRead> {
  const response = await fetch(`/api/affaires/${encodeURIComponent(projectId)}/intake${plans ? "?plans=1" : ""}`, {
    cache: "no-store", headers: { accept: "application/json" },
  });
  if ([401, 403, 404].includes(response.status)) throw new RefusedRead(String(response.status));
  const payload = await response.json() as { ok?: boolean; data?: AffaireDossierRead };
  if (!response.ok || !payload.ok || !payload.data) throw new Error("Lecture du dossier impossible.");
  return payload.data;
}

// A fingerprint of the dossier each affaire last showed from a read, kept across mounts: Back and
// Forward bring back the router's cached render, and a save's response renders from data it read
// before a later read had answered. A server render that differs from it may be older, and is read
// once more.
const lastShown = new Map<string, string>();

function fingerprint(value: unknown) {
  const text = JSON.stringify(value) ?? "null";
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return `${(second >>> 0).toString(36)}-${(first >>> 0).toString(36)}`;
}

export function useAffaireDossier(
  projectId: string,
  server: { workspace: AffaireIntakeWorkspace | null | undefined; plansSummary?: AffaireHubPlansSummaryData | null },
  // `live: false` reads nothing: for a page that shows made-up data (the hub's development scenarios).
  options: { plans?: boolean; live?: boolean } = {},
): AffaireDossier {
  // A read is shown only over the server render it was sent under. The server renders the page
  // again after a save, a navigation or a refresh asked by the person: that render replaces it.
  const [read, setRead] = useState<{ base: AffaireIntakeWorkspace | null | undefined; data: AffaireDossierRead; key: string } | null>(null);
  const current = read !== null && read.base === server.workspace ? read.data : null;
  const serverWorkspace = useRef(server.workspace);
  serverWorkspace.current = server.workspace;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const inFlight = useRef<Promise<void> | null>(null);
  const next = useRef<Promise<void> | null>(null);
  const refused = useRef(false);
  const plans = options.plans === true;
  const live = options.live !== false;

  const start = useCallback(() => {
    const base = serverWorkspace.current;
    const pending = readDossier(projectId, plans).then((data) => {
      if (!mounted.current || serverWorkspace.current !== base) return;
      const shown = fingerprint(data.workspace);
      lastShown.set(projectId, shown);
      setRead((prior) => {
        const kept = prior !== null && prior.base === base ? prior : null;
        // A read that could not read the plans keeps those the previous read showed.
        const plansSummary = data.plansSummary !== undefined ? data.plansSummary : kept?.data.plansSummary;
        // A read that brings nothing new renders nothing again.
        const key = `${shown}:${plansSummary === undefined ? "" : fingerprint(plansSummary)}`;
        if (kept !== null && kept.key === key) return kept;
        return { base, key, data: plansSummary === undefined ? { workspace: data.workspace } : { workspace: data.workspace, plansSummary } };
      });
    }, (error: unknown) => {
      // An expired session or a withdrawn access: the page's own request redirects or refuses.
      if (error instanceof RefusedRead && mounted.current && !refused.current) {
        refused.current = true;
        window.location.reload();
      }
    }).finally(() => { inFlight.current = null; });
    inFlight.current = pending;
    return pending;
  }, [plans, projectId]);

  const reload = useCallback(() => {
    if (!live || refused.current) return Promise.resolve();
    if (inFlight.current === null) return start();
    next.current ??= inFlight.current.then(() => {
      next.current = null;
      return refused.current ? undefined : start();
    });
    return next.current;
  }, [live, start]);

  const rendered = useMemo(() => fingerprint(server.workspace ?? null), [server.workspace]);
  useEffect(() => {
    const shown = lastShown.get(projectId);
    if (shown !== undefined && shown !== rendered) void reload();
  }, [projectId, reload, rendered]);

  return {
    workspace: current?.workspace ?? server.workspace,
    plansSummary: current?.plansSummary !== undefined ? current.plansSummary : server.plansSummary ?? null,
    fromRead: current !== null,
    plansFromRead: current?.plansSummary !== undefined,
    reload,
  };
}

// Asks for the dossier while `active`: an interval after the previous answer, so a server slower
// than the interval never has two reads in flight. Stops when `active` ends, or once `maxMs` has
// passed since it began, which `expired` reports until `active` ends.
export function useDossierPoll(active: boolean, reload: () => Promise<unknown>, { intervalMs, maxMs }: { intervalMs: number; maxMs?: number }) {
  const [expired, setExpired] = useState(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!active) {
      setExpired(false);
      return;
    }
    const started = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = () => {
      timer = setTimeout(() => {
        if (maxMs !== undefined && Date.now() - started >= maxMs) {
          setExpired(true);
          return;
        }
        void reloadRef.current().catch(() => undefined).finally(() => { if (!cancelled) wait(); });
      }, intervalMs);
    };
    wait();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, intervalMs, maxMs]);
  return { expired };
}
