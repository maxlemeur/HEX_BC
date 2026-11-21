import { useEffect } from "react";

import { TAKEOFF_LIST_REFRESH_INTERVAL_MS } from "@/components/takeoff/takeoff-job-list-shared";
import {
  TAKEOFF_RESUME_ACTIONS,
  TAKEOFF_RESUME_REASONS,
  type TakeoffResumeDecision,
} from "@/lib/takeoff/operator-state";

export { TAKEOFF_RESUME_RELOAD_TEXT } from "@/lib/takeoff/operator-state";
import type { TakeoffActivityCenterJobRow, TakeoffActivityCenterResponse } from "@/lib/takeoff/types";
import { isRecord } from "@/lib/value-guards";

/** setTimeout keeps at most a signed 32-bit delay. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** A delay the server still announces once it is over, by the browser's clock, is read again after this. */
const LATE_DELAY_REREAD_MS = 2_000;
/** Past this, a clock difference is not a wait to follow. */
const LATE_DELAY_LIMIT_MS = 60_000;

/**
 * A start the server will make by itself: the analysis is queued or running, or its automatic retry is awaited. A badge
 * that announces one is shown only then, never beside a final decision.
 */
export function takeoffExpectsAutomaticStart(job: TakeoffActivityCenterJobRow) {
  return job.technicalStatusRaw === "pending" || job.technicalStatusRaw === "processing" || job.resume?.reason === "retry_scheduled";
}

/**
 * Whether a row shows the progress of the removed provider's batch (its state, its operator state): only while the
 * analysis is not stopped, never beside a final decision. « Reprise à vérifier » had a reconciliation that no longer
 * exists: it is never shown.
 */
export function takeoffShowsBatchProgress(job: TakeoffActivityCenterJobRow) {
  return job.technicalStatusRaw !== "failed" && job.technicalStatusRaw !== "canceled";
}

/**
 * How often the list is read again: while an analysis is queued or running, and while a stopped analysis waits for its
 * retry or for the end of its delay (until that happened). Otherwise not at all.
 */
export function takeoffListRefreshInterval(data?: TakeoffActivityCenterResponse) {
  if (!data) return 0;
  const jobs = data.jobs ?? [];
  const running = data.counters.technicalJobs > 0 || jobs.some((job) => job.statusRaw === "queued");
  const waiting = jobs.some((job) => job.resume?.action === "wait_retry");
  return running || waiting ? TAKEOFF_LIST_REFRESH_INTERVAL_MS : 0;
}

/**
 * Reads the list again once the first wait it announced is over: one timer for the whole list, whatever its number of
 * rows. The decision stays the server's, never the clock's. A delay still announced after its end (the browser's clock
 * ahead of the server's) is read again shortly; a scheduled retry is followed by the list's own polling.
 */
export function useTakeoffResumeRefresh(jobs: readonly TakeoffActivityCenterJobRow[], refresh: () => void) {
  useEffect(() => {
    const now = Date.now();
    let next = Number.POSITIVE_INFINITY;
    for (const job of jobs) {
      if (job.resume?.action !== "wait_retry") continue;
      const dueAt = Date.parse(job.resume.availableAt ?? "");
      if (!Number.isFinite(dueAt)) continue;
      if (dueAt > now) next = Math.min(next, dueAt + 1_000);
      else if (job.resume.reason === "retry_delay" && dueAt > now - LATE_DELAY_LIMIT_MS) next = Math.min(next, now + LATE_DELAY_REREAD_MS);
    }
    const delay = next - now;
    if (!Number.isFinite(delay) || delay > MAX_TIMER_MS) return;
    const timer = setTimeout(refresh, delay);
    return () => clearTimeout(timer);
  }, [jobs, refresh]);
}

const ACTIONS = new Set<string>(TAKEOFF_RESUME_ACTIONS);
const REASONS = new Set<string>(TAKEOFF_RESUME_REASONS);

/** The decision a refusal of the command carries (error.details.resume), or null when it carries none. */
export function readTakeoffResumeRefusal(details: unknown): TakeoffResumeDecision | null {
  const resume = isRecord(details) ? details.resume : null;
  if (!isRecord(resume) || typeof resume.action !== "string" || typeof resume.reason !== "string") return null;
  if (!ACTIONS.has(resume.action) || !REASONS.has(resume.reason)) return null;
  const availableAt = typeof resume.available_at === "string" ? resume.available_at : null;
  return { action: resume.action, reason: resume.reason, availableAt } as TakeoffResumeDecision;
}

/** The list with one row's decision replaced by the one a refusal carried. */
export function adoptTakeoffResume(
  data: TakeoffActivityCenterResponse,
  jobId: string,
  resume: TakeoffResumeDecision,
): TakeoffActivityCenterResponse {
  if (!data.jobs.some((job) => job.jobId === jobId)) return data;
  return {
    ...data,
    jobs: data.jobs.map((job) => job.jobId === jobId ? { ...job, resume, canResubmit: resume.action === "retry_now" } : job),
  };
}
