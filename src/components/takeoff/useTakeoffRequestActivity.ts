"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";

import { takeoffRequestRefreshInterval } from "@/lib/takeoff/request-activity";
import { fetchTakeoffRequestActivity } from "@/lib/takeoff/request-activity-client";
import type { TakeoffRequestActivityView } from "@/lib/takeoff/request-activity-contracts";

/**
 * The cache key of the affaire's request activity: the member and their tenant come first, so that a change of member
 * never serves another member's answer, then the affaire, the view, its target (a request or an analysis) and its page.
 */
export type TakeoffRequestActivityKey = readonly [
  scope: "takeoff-request-activity", viewerKey: string, projectId: string, view: TakeoffRequestActivityView, target: string, offset: number,
];

export const isTakeoffRequestActivityKey = (key: unknown) => Array.isArray(key) && key[0] === "takeoff-request-activity";

function fetchActivity([, , projectId, view, target, offset]: TakeoffRequestActivityKey) {
  return fetchTakeoffRequestActivity(projectId, {
    view,
    requestId: view === "request" ? target : null,
    jobId: view === "job" ? target : null,
    offset,
  });
}

/**
 * The affaire's request activity, read once and, when `poll`, read again only while something can change by itself: every
 * 5 s while a plan is read, every 30 s while the Mac is awaited or after a failed read, never once all is final. A hidden
 * tab or a lost connection pauses it; the focus and the reconnection read it at once. One poll per page: the other views
 * are read again when this one's signature moves.
 */
export function useTakeoffRequestActivity(input: {
  viewerKey: string;
  projectId: string;
  view: TakeoffRequestActivityView;
  target?: string | null;
  offset?: number;
  poll: boolean;
  enabled?: boolean;
}) {
  // SWR reads a function interval once per key, on the empty cache: the interval is state set from each answer instead.
  const [refreshMs, setRefreshMs] = useState(0);
  const key: TakeoffRequestActivityKey | null = input.enabled === false ? null
    : ["takeoff-request-activity", input.viewerKey, input.projectId, input.view, input.target ?? "", input.offset ?? 0];
  const result = useSWR(key, fetchActivity, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    refreshInterval: input.poll ? refreshMs : 0,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });
  const wantsMs = input.poll ? takeoffRequestRefreshInterval(result.data, Boolean(result.error)) : 0;
  useEffect(() => { setRefreshMs(wantsMs); }, [wantsMs]);
  return { ...result, refreshMs: wantsMs };
}
