import Link from "next/link";
import useSWR from "swr";

import { useUserContext } from "@/components/UserContext";
import { buttonVariants } from "@/components/ui/button";
import { fetchTakeoffJob, type TakeoffActivityCenterResponse } from "@/lib/takeoff/client";
import { isTakeoffOperatorMutationRole, TAKEOFF_RETRY_MAX } from "@/lib/takeoff/operator-state";
import type { TakeoffJobSummary } from "@/lib/takeoff/types";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { getTakeoffFailureReasonLabel } from "@/lib/takeoff/visible-status";

export type ActionKind = "reconcile" | "resubmit" | "cancel";
type ActivityJob = TakeoffActivityCenterResponse["jobs"][number];

function nextStep(detail: TakeoffJobSummary, row: ActivityJob, role?: string | null) {
  if (detail.can_reconcile) return "Vérifiez la reprise pour récupérer le résultat de cette analyse.";
  if (detail.can_resubmit) return "Vous pouvez soumettre cette analyse à nouveau.";
  if (detail.retry_count >= TAKEOFF_RETRY_MAX) return "Le nombre maximal de relances est atteint. Préparez un nouveau métré.";
  if (!isTakeoffOperatorMutationRole(role)) return "Ce profil ne peut pas relancer l’analyse. Contactez un ingénieur ou un administrateur.";
  // The detail additionally checks whether this job's execution provider still accepts recovery.
  if (row.canResubmit || row.canReconcile) return "Ce fournisseur IA ne permet plus de relancer cette analyse. Préparez un nouveau métré.";
  return "Le traitement est en attente auprès du fournisseur IA. Actualisez le suivi pour vérifier la reprise.";
}

export function TakeoffJobActions({ job, projectId, pendingAction, onAction }: {
  job: ActivityJob;
  projectId: string;
  pendingAction?: ActionKind;
  onAction: (jobId: string, action: ActionKind) => Promise<void>;
}) {
  const { profile } = useUserContext();
  const failed = job.technicalStatusRaw === "failed";
  const { data: detail, error, mutate } = useSWR(
    failed ? ["takeoff-failure", job.jobId, profile?.id, profile?.tenant_role, job.retryCount,
      job.providerBatchUpdatedAt, job.providerReconcileLeaseExpiresAt] : null,
    async () => (await fetchTakeoffJob(job.jobId, { itemsLimit: 1 })).job,
    // The key changes with the job's own changes: a window focus reads nothing new.
    { revalidateOnFocus: false },
  );
  const canReconcile = failed ? detail?.can_reconcile : job.canReconcile;
  const canResubmit = failed ? detail?.can_resubmit : job.canResubmit;
  const reviewEnabled = job.statusRaw === "completed" || job.statusRaw === "review_required";

  return (
    <div className="space-y-2">
      {failed && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {detail ? (
            <p>{getTakeoffFailureReasonLabel({ errorCode: detail.error_code })
              ?? (detail.error_code ? `Analyse interrompue (code ${detail.error_code}).` : "Analyse interrompue sans code de diagnostic.")}</p>
          ) : error ? (
            <p>Motif de l’échec indisponible. <button type="button" className="underline" onClick={() => void mutate()}>Relire le diagnostic</button></p>
          ) : <p>Chargement du motif de l’échec…</p>}
          <p>Relances utilisées : {detail?.retry_count ?? job.retryCount} sur {TAKEOFF_RETRY_MAX}</p>
          {detail && <p>{nextStep(detail, job, profile?.tenant_role)}</p>}
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
        {canReconcile ? (
          <button
            type="button"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => {
              void onAction(job.jobId, "reconcile");
            }}
            disabled={Boolean(pendingAction)}
          >
            {pendingAction === "reconcile"
              ? "Vérification de la reprise…"
              : "Vérifier la reprise"}
          </button>
        ) : null}
        {canResubmit ? (
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
