import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { TAKEOFF_RESUME_RELOAD_TEXT } from "@/components/takeoff/takeoff-resume-view";
import type { TakeoffActivityCenterResponse } from "@/lib/takeoff/client";
import { describeTakeoffResume, TAKEOFF_RETRY_MAX } from "@/lib/takeoff/operator-state";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { describeTakeoffJobFailure } from "@/lib/takeoff/visible-status";

export { useTakeoffResumeRefresh } from "@/components/takeoff/takeoff-resume-view";

export type ActionKind = "resubmit" | "cancel";
type ActivityJob = TakeoffActivityCenterResponse["jobs"][number];

/**
 * The row's actions. The list decided them with the resume policy of the server, for this member: the row shows that
 * decision and its reason in French, and asks for nothing more (no read of the job's detail). An answer without a
 * decision (an older server) offers nothing and asks for a reload.
 */
export function TakeoffJobActions({ job, projectId, pendingAction, onAction }: {
  job: ActivityJob;
  projectId: string;
  pendingAction?: ActionKind;
  onAction: (jobId: string, action: ActionKind) => Promise<void>;
}) {
  const failed = job.technicalStatusRaw === "failed";
  const decided = Boolean(job.resume);
  const stopped = !job.resume || job.resume.reason !== "not_stopped";
  const nextStep = job.resume ? describeTakeoffResume(job.resume) : TAKEOFF_RESUME_RELOAD_TEXT;
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
        {job.resume?.action === "retry_now" ? (
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
        {decided && job.canCancel ? (
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
