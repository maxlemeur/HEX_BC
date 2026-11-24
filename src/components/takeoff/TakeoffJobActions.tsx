import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { TAKEOFF_RESUME_RELOAD_TEXT } from "@/components/takeoff/takeoff-resume-view";
import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";
import { describeTakeoffResume, TAKEOFF_RETRY_MAX } from "@/lib/takeoff/operator-state";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";

export { useTakeoffResumeRefresh } from "@/components/takeoff/takeoff-resume-view";

export type ActionKind = "resubmit" | "cancel";

export function TakeoffJobActions({ job, projectId, pendingAction, onAction }: {
  job: TakeoffActivityCenterJobRow;
  projectId: string;
  pendingAction?: ActionKind;
  onAction: (jobId: string, action: ActionKind) => Promise<void>;
}) {
  if (job.statusRaw === "completed" || job.statusRaw === "review_required") {
    return (
      <Link
        href={takeoffReviewHref({ projectId, jobId: job.jobId, versionId: job.estimateVersionId })}
        className={buttonVariants({ variant: "outline", size: "sm", className: "max-md:min-h-11" })}
      >
        Vérifier le métré
      </Link>
    );
  }

  const retry = job.resume?.action === "retry_now";
  if (!retry && !(job.resume && job.canCancel)) return null;
  const action = retry ? "resubmit" : "cancel";

  return (
    <button
      type="button"
      className={buttonVariants({ variant: "outline", size: "sm", className: "max-md:min-h-11" })}
      onClick={() => void onAction(job.jobId, action)}
      disabled={Boolean(pendingAction)}
    >
      {retry
        ? pendingAction === "resubmit" ? "Relance…" : "Relancer"
        : pendingAction === "cancel" ? "Annulation…" : "Annuler"}
    </button>
  );
}

export function TakeoffJobResumeDetails({ job }: { job: TakeoffActivityCenterJobRow }) {
  const decision = job.resume ? describeTakeoffResume(job.resume) : TAKEOFF_RESUME_RELOAD_TEXT;
  return (
    <>
      {job.technicalStatusRaw === "failed" ? <p>Relances utilisées : {job.retryCount} sur {TAKEOFF_RETRY_MAX}</p> : null}
      {decision ? <p>{decision}</p> : null}
    </>
  );
}
