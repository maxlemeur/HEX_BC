import Link from "next/link";
import { useEffect } from "react";

import { buttonVariants } from "@/components/ui/button";
import type { TakeoffActivityCenterResponse } from "@/lib/takeoff/client";
import { describeTakeoffResume, TAKEOFF_RETRY_MAX } from "@/lib/takeoff/operator-state";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { describeTakeoffJobFailure } from "@/lib/takeoff/visible-status";

export type ActionKind = "resubmit" | "cancel";
type ActivityJob = TakeoffActivityCenterResponse["jobs"][number];

/** setTimeout keeps at most a signed 32-bit delay. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** A delay the server still announces once it is over, by the browser's clock, is read again after this. */
const LATE_DELAY_REREAD_MS = 2_000;
/** Past this, a clock difference is not a wait to follow. */
const LATE_DELAY_LIMIT_MS = 60_000;

/**
 * Reads the list again once the first wait it announced is over: one timer for the whole list, whatever its number of
 * rows. The decision stays the server's, never the clock's. A delay still announced after its end (the browser's clock
 * ahead of the server's) is read again shortly; an overdue scheduled retry waits for its worker and is not followed.
 */
export function useTakeoffResumeRefresh(jobs: readonly ActivityJob[], refresh: () => void) {
  useEffect(() => {
    const now = Date.now();
    let next = Number.POSITIVE_INFINITY;
    for (const job of jobs) {
      if (job.resume.action !== "wait_retry") continue;
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

/**
 * The row's actions. The list decided them with the resume policy of the server, for this member: the row shows that
 * decision and its reason in French, and asks for nothing more (no read of the job's detail).
 */
export function TakeoffJobActions({ job, projectId, pendingAction, onAction }: {
  job: ActivityJob;
  projectId: string;
  pendingAction?: ActionKind;
  onAction: (jobId: string, action: ActionKind) => Promise<void>;
}) {
  const failed = job.technicalStatusRaw === "failed";
  const stopped = job.resume.reason !== "not_stopped";
  const nextStep = describeTakeoffResume(job.resume);
  const reviewEnabled = job.statusRaw === "completed" || job.statusRaw === "review_required";

  return (
    <div className="space-y-2">
      {stopped && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {failed && <p>{describeTakeoffJobFailure(job.errorCode)}</p>}
          {failed && <p>Relances utilisées : {job.retryCount} sur {TAKEOFF_RETRY_MAX}</p>}
          {nextStep && <p>{nextStep}</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {reviewEnabled ? (
          <Link
            href={takeoffReviewHref({ projectId, jobId: job.jobId, versionId: job.estimateVersionId })}
            className={buttonVariants({ variant: "outline" })}
          >
            Revue
          </Link>
        ) : null}
        {job.resume.action === "retry_now" ? (
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => {
              void onAction(job.jobId, "resubmit");
            }}
            disabled={Boolean(pendingAction)}
          >
            {pendingAction === "resubmit"
              ? "Nouvelle soumission…"
              : "Soumettre à nouveau"}
          </button>
        ) : null}
        {job.canCancel ? (
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => {
              void onAction(job.jobId, "cancel");
            }}
            disabled={Boolean(pendingAction)}
          >
            {pendingAction === "cancel" ? "Annulation…" : "Annuler"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
