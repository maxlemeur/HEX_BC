import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";

import { DecisionBadge, formatDateTime, REVIEW_SCOPE_ORDER, SCOPE_LABELS } from "./shared";

type ReviewCycle = EstimateApprovalSummary["reviewHistory"][number];

export function EstimateApprovalReviewHistorySection({
  latestReview,
  olderReviews,
}: Readonly<{
  latestReview: ReviewCycle | null;
  olderReviews: ReviewCycle[];
}>) {
  if (!latestReview) {
    return null;
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            Dernière décision
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cycle {latestReview.cycleNumber} décidé le {formatDateTime(latestReview.decidedAt)}
            {latestReview.deciderName ? ` par ${latestReview.deciderName}` : ""}.
          </p>
        </div>
        <DecisionBadge decision={latestReview.decision} />
      </div>

      {latestReview.assignedReviewer ? (
        <p className="mt-4 break-words text-sm text-foreground-secondary">
          Validateur assigné :{" "}
          <span className="font-medium text-foreground">
            {latestReview.assignedReviewer.fullName}
          </span>
          {latestReview.assignedReviewer.workEmail
            ? ` (${latestReview.assignedReviewer.workEmail})`
            : ""}
        </p>
      ) : null}
      {latestReview.submissionMessage ? (
        <div className="mt-4 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Message de contexte
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground-secondary">
            {latestReview.submissionMessage}
          </p>
        </div>
      ) : null}

      {latestReview.comments.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Aucun commentaire ciblé n&apos;a été enregistré sur ce cycle.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {REVIEW_SCOPE_ORDER.map((scopeType) => ({
            scopeType,
            comments: latestReview.comments.filter(
              (comment) => comment.scopeType === scopeType
            ),
          }))
            .filter((group) => group.comments.length > 0)
            .map((group) => (
              <div key={group.scopeType}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {SCOPE_LABELS[group.scopeType]}
                  {group.comments.length > 1 ? ` (${group.comments.length})` : ""}
                </p>
                <ul className="space-y-2">
                  {group.comments.map((comment) => (
                    <li
                      key={comment.id}
                      className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 break-words text-sm font-semibold text-foreground">
                          {comment.scopeLabel}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(comment.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 break-words text-sm text-foreground-secondary">
                        {comment.comment}
                      </p>
                      {comment.authorName ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Par {comment.authorName}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

      {olderReviews.length > 0 ? (
        <details className="mt-4 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3">
          <summary className="cursor-pointer rounded-sm text-sm font-medium text-foreground-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Voir les cycles précédents ({olderReviews.length})
          </summary>
          <div className="mt-3 space-y-3">
            {olderReviews.map((cycle) => (
              <div
                key={cycle.id}
                className="rounded-lg border border-border bg-surface px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      Cycle {cycle.cycleNumber}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Demandé le {formatDateTime(cycle.requestedAt)} · Décidé le{" "}
                      {formatDateTime(cycle.decidedAt)}
                    </p>
                  </div>
                  <DecisionBadge decision={cycle.decision} />
                </div>
                {cycle.assignedReviewer ? (
                  <p className="mt-3 break-words text-sm text-foreground-secondary">
                    Validateur assigné : {cycle.assignedReviewer.fullName}
                  </p>
                ) : null}
                {cycle.submissionMessage ? (
                  <p className="mt-2 whitespace-pre-line break-words text-sm text-foreground-secondary">
                    {cycle.submissionMessage}
                  </p>
                ) : null}
                {cycle.comments.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {cycle.comments.map((comment) => (
                      <li key={comment.id} className="break-words text-sm text-foreground-secondary">
                        <span className="font-medium text-foreground">
                          {comment.scopeLabel}
                        </span>
                        {" : "}
                        {comment.comment}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Aucun commentaire ciblé sur ce cycle.
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
