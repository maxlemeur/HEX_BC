"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  decideEstimateApprovalAction,
  requestEstimateApprovalAction,
} from "@/app/dashboard/_actions/estimate-approval";
import { useToast } from "@/components/ui/Toast";
import type {
  EstimateApprovalDecisionCommentInput,
  EstimateApprovalSummary,
  EstimateReviewCommentScope,
  EstimateReviewDecision,
} from "@/lib/estimates/rules-engine";

type DraftComment = EstimateApprovalDecisionCommentInput & {
  id: string;
  scopeLabel: string;
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const SCOPE_LABELS: Record<EstimateReviewCommentScope, string> = {
  project: "Affaire",
  lot: "Lot",
  line: "Ligne",
  approval_rule: "Exception",
};

const DECISION_META: Record<
  EstimateReviewDecision,
  {
    badgeLabel: string;
    badgeClassName: string;
    buttonLabel: string;
    requiresComment: boolean;
    successTitle: string;
  }
> = {
  approved: {
    badgeLabel: "Approuvee",
    badgeClassName: "bg-[var(--success)]/10 text-[var(--success)]",
    buttonLabel: "Approuver",
    requiresComment: false,
    successTitle: "Version approuvee",
  },
  approved_with_reservations: {
    badgeLabel: "Approuvee sous reserve",
    badgeClassName: "bg-[var(--warning-light)] text-[var(--warning)]",
    buttonLabel: "Approuver sous reserve",
    requiresComment: true,
    successTitle: "Version approuvee sous reserve",
  },
  changes_requested: {
    badgeLabel: "Retour correction",
    badgeClassName: "bg-[var(--danger)]/10 text-[var(--danger)]",
    buttonLabel: "Renvoyer en correction",
    requiresComment: true,
    successTitle: "Retour correction envoye",
  },
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return DATE_TIME_FORMATTER.format(date);
}

function getTargetOptions(
  summary: EstimateApprovalSummary,
  scopeType: EstimateReviewCommentScope
) {
  if (scopeType === "project") {
    return [summary.commentTargets.project];
  }

  if (scopeType === "lot") {
    return summary.commentTargets.lots;
  }

  if (scopeType === "line") {
    return summary.commentTargets.lines;
  }

  return summary.commentTargets.approvalRules;
}

function renderDecisionBadge(decision: EstimateReviewDecision) {
  const meta = DECISION_META[decision];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badgeClassName}`}
    >
      {meta.badgeLabel}
    </span>
  );
}

export function EstimateApprovalActions({
  versionId,
  projectId,
  summary,
}: Readonly<{
  versionId: string;
  projectId: string;
  summary: EstimateApprovalSummary;
}>) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [draftScopeType, setDraftScopeType] =
    useState<EstimateReviewCommentScope>("project");
  const [draftScopeId, setDraftScopeId] = useState<string | null>(null);
  const [draftComment, setDraftComment] = useState("");
  const [draftComments, setDraftComments] = useState<DraftComment[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const requestableReasons = summary.reasons.filter(
    (reason) => reason.approvalStatus === "missing" || reason.approvalStatus === "rejected"
  );
  const activeCycle = summary.activeCycle;
  const latestReview = summary.reviewHistory[0] ?? null;
  const olderReviews = summary.reviewHistory.slice(1);
  const scopeOptions = getTargetOptions(summary, draftScopeType);
  const selectedTarget =
    draftScopeType === "project"
      ? summary.commentTargets.project
      : scopeOptions.find((option) => option.scopeId === draftScopeId) ?? null;

  function resetDraftForm() {
    setDraftScopeType("project");
    setDraftScopeId(null);
    setDraftComment("");
    setFormError(null);
  }

  function handleAddComment() {
    const trimmedComment = draftComment.trim();
    if (trimmedComment.length === 0) {
      setFormError("Le commentaire est obligatoire.");
      return;
    }

    if (draftScopeType !== "project" && !selectedTarget?.scopeId) {
      setFormError("Choisissez une cible avant d'ajouter le commentaire.");
      return;
    }

    const scopeLabel = selectedTarget?.label ?? summary.commentTargets.project.label;
    setDraftComments((current) => [
      ...current,
      {
        id: `${draftScopeType}-${selectedTarget?.scopeId ?? "project"}-${current.length + 1}`,
        scopeType: draftScopeType,
        scopeId: draftScopeType === "project" ? null : selectedTarget?.scopeId ?? null,
        comment: trimmedComment,
        scopeLabel,
      },
    ]);
    resetDraftForm();
  }

  function runRequestAction() {
    if (requestableReasons.length === 0) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          await requestEstimateApprovalAction({
            versionId,
            projectId,
            ruleIds: requestableReasons.map((reason) => reason.ruleId),
          });

          toast.success({
            title: "Demande envoyee",
            description:
              requestableReasons.length === 1
                ? `Approbation demandee pour : ${requestableReasons[0].label}.`
                : `${requestableReasons.length} approbations demandees : ${requestableReasons.map((reason) => reason.label).join(", ")}.`,
          });
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Action impossible",
            description:
              error instanceof Error
                ? error.message
                : "Impossible de demander l'approbation.",
          });
        }
      })();
    });
  }

  function runDecision(decision: EstimateReviewDecision) {
    setFormError(null);

    if (DECISION_META[decision].requiresComment && draftComments.length === 0) {
      setFormError(
        decision === "approved_with_reservations"
          ? "Ajoutez au moins une reserve avant de valider."
          : "Ajoutez au moins un commentaire avant de renvoyer en correction."
      );
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          await decideEstimateApprovalAction({
            versionId,
            projectId,
            decision,
            comments: draftComments.map(({ scopeType, scopeId, comment }) => ({
              scopeType,
              scopeId,
              comment,
            })),
          });

          toast.success({
            title: DECISION_META[decision].successTitle,
            description:
              draftComments.length === 0
                ? "La decision a ete historisee."
                : `${draftComments.length} commentaire${draftComments.length > 1 ? "s" : ""} historise${draftComments.length > 1 ? "s" : ""}.`,
          });
          setDraftComments([]);
          resetDraftForm();
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Decision impossible",
            description:
              error instanceof Error
                ? error.message
                : "Impossible d'enregistrer cette decision.",
          });
        }
      })();
    });
  }

  const showPanel =
    summary.permissions.canRequest ||
    summary.permissions.canDecide ||
    summary.reviewHistory.length > 0 ||
    summary.activeCycle !== null;

  if (!showPanel) {
    return null;
  }

  return (
    <div className="space-y-4">
      {summary.activeCycle ? (
        <section className="rounded-xl border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--slate-800)]">
                Cycle {summary.activeCycle.cycleNumber} en revue
              </p>
              <p className="mt-1 text-xs text-[var(--slate-600)]">
                Demande ouverte le {formatDateTime(summary.activeCycle.requestedAt)}
                {summary.activeCycle.requesterName
                  ? ` par ${summary.activeCycle.requesterName}`
                  : ""}
                . {summary.activeCycle.pendingApprovalCount} regle
                {summary.activeCycle.pendingApprovalCount > 1 ? "s" : ""} en attente.
              </p>
            </div>
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-[var(--brand-blue)]">
              En revue
            </span>
          </div>
        </section>
      ) : null}

      {summary.permissions.canRequest ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isPending}
            onClick={runRequestAction}
          >
            {isPending
              ? "En cours..."
              : requestableReasons.length > 1
                ? `Demander approbation (${requestableReasons.length})`
                : "Demander approbation"}
          </button>
        </div>
      ) : null}

      {summary.permissions.canDecide ? (
        <section className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                Commentaires de validation
              </h3>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                Ciblez l'affaire, un lot, une ligne ou une exception sans ouvrir
                l'editeur complet.
              </p>
            </div>
            {activeCycle ? (
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--slate-600)]">
                Cycle {activeCycle.cycleNumber}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
            <label className="flex flex-col gap-1 text-sm text-[var(--slate-700)]">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                Portee
              </span>
              <select
                className="input"
                value={draftScopeType}
                onChange={(event) => {
                  const nextScope = event.target.value as EstimateReviewCommentScope;
                  setDraftScopeType(nextScope);
                  setDraftScopeId(null);
                  setFormError(null);
                }}
              >
                <option value="project">Affaire</option>
                <option value="lot">Lot</option>
                <option value="line">Ligne</option>
                <option value="approval_rule">Exception</option>
              </select>
            </label>

            {draftScopeType === "project" ? (
              <div className="rounded-xl border border-dashed border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-600)]">
                Commentaire global sur {summary.commentTargets.project.label}.
              </div>
            ) : (
              <label className="flex flex-col gap-1 text-sm text-[var(--slate-700)]">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                  Cible
                </span>
                <select
                  className="input"
                  value={draftScopeId ?? ""}
                  onChange={(event) => {
                    setDraftScopeId(event.target.value || null);
                    setFormError(null);
                  }}
                >
                  <option value="">Choisir...</option>
                  {scopeOptions.map((option) => (
                    <option key={`${option.scopeType}-${option.scopeId ?? "project"}`} value={option.scopeId ?? ""}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="mt-3 flex flex-col gap-1 text-sm text-[var(--slate-700)]">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
              Commentaire
            </span>
            <textarea
              className="input min-h-[100px] resize-y py-3"
              value={draftComment}
              onChange={(event) => {
                setDraftComment(event.target.value);
                setFormError(null);
              }}
              placeholder="Expliquez ce qui est valide, ce qui reste reserve, ou ce qui doit etre corrige."
            />
          </label>

          {formError ? (
            <p className="mt-2 text-sm text-[var(--danger)]">{formError}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isPending}
              onClick={handleAddComment}
            >
              Ajouter le commentaire
            </button>
            {draftComments.length > 0 ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={isPending}
                onClick={() => {
                  setDraftComments([]);
                  resetDraftForm();
                }}
              >
                Vider la liste
              </button>
            ) : null}
          </div>

          {draftComments.length > 0 ? (
            <div className="mt-4 space-y-2">
              {draftComments.map((comment) => (
                <article
                  key={comment.id}
                  className="rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                        {SCOPE_LABELS[comment.scopeType]}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[var(--slate-800)]">
                        {comment.scopeLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-[var(--slate-400)] hover:text-[var(--slate-600)]"
                      onClick={() =>
                        setDraftComments((current) =>
                          current.filter((entry) => entry.id !== comment.id)
                        )
                      }
                    >
                      Retirer
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-[var(--slate-700)]">{comment.comment}</p>
                </article>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--slate-200)] pt-4">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={isPending}
              onClick={() => runDecision("approved")}
            >
              {isPending ? "En cours..." : DECISION_META.approved.buttonLabel}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isPending}
              onClick={() => runDecision("approved_with_reservations")}
            >
              {isPending
                ? "En cours..."
                : DECISION_META.approved_with_reservations.buttonLabel}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isPending}
              onClick={() => runDecision("changes_requested")}
            >
              {isPending
                ? "En cours..."
                : DECISION_META.changes_requested.buttonLabel}
            </button>
          </div>
        </section>
      ) : null}

      {latestReview ? (
        <section className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                Derniere decision
              </h3>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                Cycle {latestReview.cycleNumber} decide le {formatDateTime(latestReview.decidedAt)}
                {latestReview.deciderName ? ` par ${latestReview.deciderName}` : ""}.
              </p>
            </div>
            {renderDecisionBadge(latestReview.decision)}
          </div>

          {latestReview.comments.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--slate-600)]">
              Aucun commentaire cible n'a ete enregistre sur ce cycle.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {latestReview.comments.map((comment) => (
                <article
                  key={comment.id}
                  className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                        {SCOPE_LABELS[comment.scopeType]}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[var(--slate-800)]">
                        {comment.scopeLabel}
                      </p>
                    </div>
                    <span className="text-xs text-[var(--slate-500)]">
                      {formatDateTime(comment.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--slate-700)]">{comment.comment}</p>
                  {comment.authorName ? (
                    <p className="mt-2 text-xs text-[var(--slate-500)]">
                      Par {comment.authorName}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          )}

          {olderReviews.length > 0 ? (
            <details className="mt-4 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-3">
              <summary className="cursor-pointer text-sm font-medium text-[var(--slate-700)]">
                Voir les cycles precedents ({olderReviews.length})
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
                          Demande du {formatDateTime(cycle.requestedAt)} • Decision du{" "}
                          {formatDateTime(cycle.decidedAt)}
                        </p>
                      </div>
                      {renderDecisionBadge(cycle.decision)}
                    </div>
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
                        Aucun commentaire sur ce cycle.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
