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
    <section className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">
            Dernière décision
          </h3>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Cycle {latestReview.cycleNumber} décidé le {formatDateTime(latestReview.decidedAt)}
            {latestReview.deciderName ? ` par ${latestReview.deciderName}` : ""}.
          </p>
        </div>
        <DecisionBadge decision={latestReview.decision} />
      </div>

      {latestReview.assignedReviewer ? (
        <p className="mt-4 text-sm text-[var(--slate-700)]">
          Validateur assigne:{" "}
          <span className="font-medium text-[var(--slate-800)]">
            {latestReview.assignedReviewer.fullName}
          </span>
          {latestReview.assignedReviewer.workEmail
            ? ` (${latestReview.assignedReviewer.workEmail})`
            : ""}
        </p>
      ) : null}
      {latestReview.submissionMessage ? (
        <div className="mt-4 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
            Message de contexte
          </p>
          <p className="mt-1 text-sm text-[var(--slate-700)]">
            {latestReview.submissionMessage}
          </p>
        </div>
      ) : null}

      {latestReview.comments.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--slate-600)]">
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
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                  {SCOPE_LABELS[group.scopeType]}
                  {group.comments.length > 1 ? ` (${group.comments.length})` : ""}
                </p>
                <div className="space-y-2">
                  {group.comments.map((comment) => (
                    <article
                      key={comment.id}
                      className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-[var(--slate-800)]">
                          {comment.scopeLabel}
                        </p>
                        <span className="text-xs text-[var(--slate-500)]">
                          {formatDateTime(comment.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--slate-700)]">
                        {comment.comment}
                      </p>
                      {comment.authorName ? (
                        <p className="mt-2 text-xs text-[var(--slate-500)]">
                          Par {comment.authorName}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {olderReviews.length > 0 ? (
        <details className="mt-4 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--slate-700)]">
            Voir les cycles précédents ({olderReviews.length})
          </summary>
          <div className="mt-3 space-y-3">
            {olderReviews.map((cycle) => (
              <div
                key={cycle.id}
                className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--slate-800)]">
                      Cycle {cycle.cycleNumber}
                    </p>
                    <p className="mt-1 text-xs text-[var(--slate-500)]">
                      Demandé le {formatDateTime(cycle.requestedAt)} · Décidé le{" "}
                      {formatDateTime(cycle.decidedAt)}
                    </p>
                  </div>
                  <DecisionBadge decision={cycle.decision} />
                </div>
                {cycle.assignedReviewer ? (
                  <p className="mt-3 text-sm text-[var(--slate-700)]">
                    Validateur assigne: {cycle.assignedReviewer.fullName}
                  </p>
                ) : null}
                {cycle.submissionMessage ? (
                  <p className="mt-2 text-sm text-[var(--slate-600)]">
                    {cycle.submissionMessage}
                  </p>
                ) : null}
                {cycle.comments.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {cycle.comments.map((comment) => (
                      <li key={comment.id} className="text-sm text-[var(--slate-700)]">
                        <span className="font-medium text-[var(--slate-800)]">
                          {comment.scopeLabel}
                        </span>
                        : {comment.comment}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-[var(--slate-500)]">
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
