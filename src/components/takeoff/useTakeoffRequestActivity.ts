"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { isTakeoffApiError } from "@/lib/takeoff/client-http";
import { takeoffRequestRefreshInterval, TAKEOFF_REQUEST_WAITING_REFRESH_MS } from "@/lib/takeoff/request-activity";
import { fetchTakeoffRequestActivity } from "@/lib/takeoff/request-activity-client";
import type {
  TakeoffRequestActivity,
  TakeoffRequestActivityResponse,
  TakeoffRequestActivityView,
} from "@/lib/takeoff/request-activity-contracts";

/**
 * The cache key of the affaire's request activity: the member and their tenant come first, so that a change of member
 * never serves another member's answer, then the affaire, the view, its target (a request or an analysis) and its page.
 */
export type TakeoffRequestActivityKey = readonly [
  scope: "takeoff-request-activity", viewerKey: string, projectId: string, view: TakeoffRequestActivityView, target: string, offset: number,
];

export const isTakeoffRequestActivityKey = (key: unknown) => Array.isArray(key) && key[0] === "takeoff-request-activity";

/** A refusal of access (no session, no right, no affaire): what was shown is withdrawn and nothing is read again. */
export function isTakeoffReadRefusal(error: unknown) {
  return isTakeoffApiError(error) && (error.status === 401 || error.status === 403 || error.status === 404);
}

type Memo = {
  dossierPosition: string | null; dossierChanged: TakeoffRequestActivity["dossierChanged"];
  actionKey: string | null; actionReadAt: string | null; action: TakeoffRequestActivity["action"];
};

/**
 * The affaire's request activity, read once and, when `poll`, read again only while something can change by itself: every
 * 5 s while a plan is read, every 30 s while the Mac, a retry, a closure or a dossier is awaited, never once all is final.
 * A read that failed (the network, the server, a timeout) is tried again 30 s later, the page showing the last known state
 * meanwhile (SWR suspends its interval while an error is cached); a refusal withdraws what was shown and stops. A hidden
 * tab or a lost connection pauses it; the focus and the reconnection read it at once. One poll per page: the other views
 * are read again when this one's signature moves. The dossier's difference and the gesture before an admission are not
 * computed again when they did not move (the page sends what it last read). `ownRequestOnly`: the review of a plan
 * follows its own request, not the rest of the affaire.
 */
export function useTakeoffRequestActivity(input: {
  viewerKey: string;
  projectId: string;
  view: TakeoffRequestActivityView;
  target?: string | null;
  offset?: number;
  poll: boolean;
  enabled?: boolean;
  ownRequestOnly?: boolean;
}) {
  // SWR reads a function interval once per key, on the empty cache: the interval is state set from each answer instead.
  const [refreshMs, setRefreshMs] = useState(0);
  const memos = useRef(new Map<string, Memo>());
  const fetchActivity = useCallback(async (key: TakeoffRequestActivityKey) => {
    const [, , projectId, view, target, offset] = key;
    const memoKey = key.join("|");
    const last = memos.current.get(memoKey);
    const answer: TakeoffRequestActivityResponse = await fetchTakeoffRequestActivity(projectId, {
      view, requestId: view === "request" ? target : null, jobId: view === "job" ? target : null, offset,
      dossierSeen: last?.dossierPosition ?? null, actionSeen: last?.actionKey ?? null, actionSeenAt: last?.actionReadAt ?? null,
    });
    const current = answer.current;
    // What the server did not compute again is the last answer's.
    const dossierChanged = answer.reused.dossier ? last?.dossierChanged ?? null : current?.dossierChanged ?? null;
    const action = answer.reused.action ? last?.action ?? null : current?.action ?? null;
    memos.current.set(memoKey, {
      dossierPosition: answer.reused.dossierPosition, dossierChanged,
      actionKey: answer.reused.actionKey, actionReadAt: answer.reused.action ? last?.actionReadAt ?? null : answer.observedAt, action,
    });
    return current ? { ...answer, current: { ...current, dossierChanged, action } } : answer;
  }, []);
  const key: TakeoffRequestActivityKey | null = input.enabled === false ? null
    : ["takeoff-request-activity", input.viewerKey, input.projectId, input.view, input.target ?? "", input.offset ?? 0];
  const result = useSWR(key, fetchActivity, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    refreshInterval: input.poll ? refreshMs : 0,
    // Only the history pages keep their previous answer while the next page loads; the page remounts for another member.
    keepPreviousData: input.view === "history",
    shouldRetryOnError: input.poll,
    onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
      if (isTakeoffReadRefusal(error)) return;
      const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
      // A hidden tab is read again when it is shown (revalidateOnFocus), also when it was hidden meanwhile.
      if (hidden()) return;
      setTimeout(() => { if (!hidden()) void revalidate({ retryCount }); }, TAKEOFF_REQUEST_WAITING_REFRESH_MS);
    },
  });
  const refused = isTakeoffReadRefusal(result.error);
  const data = refused ? undefined : result.data;
  const wantsMs = input.poll && !refused
    ? takeoffRequestRefreshInterval(data, Boolean(result.error), { ownRequestOnly: input.ownRequestOnly })
    : 0;
  useEffect(() => { setRefreshMs(wantsMs); }, [wantsMs]);
  return { ...result, data, refused, refreshMs: wantsMs };
}
