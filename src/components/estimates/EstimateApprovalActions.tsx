"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  decideEstimateApprovalAction,
  submitEstimateForReviewAction,
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

export type EstimateApprovalSubmissionOverview = {
  coveragePercent: number | null;
  exceptionCount: number | null;
  openQuestionsCount: number | null;
  marginPercent: number | null;
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
    badgeLabel: "Approuvée",
    badgeClassName: "bg-[var(--success)]/10 text-[var(--success)]",
    buttonLabel: "Approuver",
    requiresComment: false,
    successTitle: "Version approuvée",
  },
  approved_with_reservations: {
    badgeLabel: "Approuvée sous réserve",
    badgeClassName: "bg-[var(--warning-light)] text-[var(--warning)]",
    buttonLabel: "Approuver sous réserve",
    requiresComment: true,
    successTitle: "Version approuvée sous réserve",
  },
  changes_requested: {
    badgeLabel: "À corriger",
    badgeClassName: "bg-[var(--danger)]/10 text-[var(--danger)]",
    buttonLabel: "Renvoyer en correction",
    requiresComment: true,
    successTitle: "Retour correction envoyé",
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

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Indisponible";
  }

  return `${value.toFixed(1)}%`;
}

function formatCount(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Indisponible";
  }

  return new Intl.NumberFormat("fr-FR").format(value);
}

export function EstimateApprovalActions({
  versionId,
  projectId,
  summary,
  submissionOverview,
}: Readonly<{
  versionId: string;
  projectId: string;
  summary: EstimateApprovalSummary;
  submissionOverview: EstimateApprovalSubmissionOverview;
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
  const [pendingConfirm, setPendingConfirm] = useState<EstimateReviewDecision | null>(null);
  const [showSubmitPanel, setShowSubmitPanel] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState("");
  const [assignedReviewerUserId, setAssignedReviewerUserId] = useState<string | null>(
    summary.availableReviewers[0]?.userId ?? null
  );

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
    setPendingConfirm(null);
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

  function runSubmitAction() {
    if (requestableReasons.length === 0) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const selectedReviewer =
            summary.availableReviewers.find(
              (reviewer) => reviewer.userId === assignedReviewerUserId
            ) ?? summary.availableReviewers[0] ?? null;

          await submitEstimateForReviewAction({
            versionId,
            projectId,
            ruleIds: requestableReasons.map((reason) => reason.ruleId),
            submissionMessage: submissionMessage.trim() || undefined,
            assignedReviewerUserId: selectedReviewer?.userId ?? null,
          });

          toast.success({
            title: "Version soumise a validation",
            description:
              selectedReviewer
                ? `Dossier transmis a ${selectedReviewer.fullName}.`
                : "Dossier transmis a la validation.",
          });
          setShowSubmitPanel(false);
          setSubmissionMessage("");
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Action impossible",
            description:
              error instanceof Error
                ? error.message
                : "Impossible de soumettre la version a validation.",
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
          ? "Ajoutez au moins une réserve avant de valider."
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
                ? "La décision a été historisée."
                : `${draftComments.length} commentaire${draftComments.length > 1 ? "s" : ""} historisé${draftComments.length > 1 ? "s" : ""}.`,
          });
          setDraftComments([]);
          resetDraftForm();
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Décision impossible",
            description:
              error instanceof Error
                ? error.message
                : "Impossible d'enregistrer cette décision.",
          });
        }
      })();
    });
  }

  const showPanel =
    summary.permissions.canPrepareRequest ||
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
                . {summary.activeCycle.pendingApprovalCount} règle
                {summary.activeCycle.pendingApprovalCount > 1 ? "s" : ""} en attente.
              </p>
            </div>
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-[var(--brand-blue)]">
              En revue
            </span>
          </div>
          {summary.activeCycle.assignedReviewer ? (
            <p className="mt-3 text-sm text-[var(--slate-700)]">
              Validateur assigne:{" "}
              <span className="font-medium text-[var(--slate-800)]">
                {summary.activeCycle.assignedReviewer.fullName}
              </span>
              {summary.activeCycle.assignedReviewer.workEmail
                ? ` (${summary.activeCycle.assignedReviewer.workEmail})`
                : ""}
            </p>
          ) : null}
          {summary.activeCycle.submissionMessage ? (
            <div className="mt-3 rounded-xl border border-white/70 bg-white/80 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                Message de contexte
              </p>
              <p className="mt-1 text-sm text-[var(--slate-700)]">
                {summary.activeCycle.submissionMessage}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {summary.permissions.canPrepareRequest ? (
        <section className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                Soumission a validation
              </h3>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                Verifiez les blocants, les alertes restantes et le contexte avant d&apos;envoyer le dossier.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isPending || summary.activeCycle !== null}
              onClick={() => {
                setFormError(null);
                setShowSubmitPanel((current) => !current);
              }}
            >
              {showSubmitPanel ? "Fermer" : "Soumettre a validation"}
            </button>
          </div>

          {showSubmitPanel ? (
            <div className="mt-4 space-y-4 border-t border-[var(--slate-200)] pt-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <article className="rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                    Couverture
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[var(--slate-900)]">
                    {formatPercent(submissionOverview.coveragePercent)}
                  </p>
                </article>
                <article className="rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                    Exceptions
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[var(--slate-900)]">
                    {formatCount(submissionOverview.exceptionCount)}
                  </p>
                </article>
                <article className="rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                    Hypotheses ouvertes
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[var(--slate-900)]">
                    {formatCount(submissionOverview.openQuestionsCount)}
                  </p>
                </article>
                <article className="rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                    Marge
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[var(--slate-900)]">
                    {formatPercent(submissionOverview.marginPercent)}
                  </p>
                </article>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <section className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/5 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--danger)]">
                        Blocants
                      </p>
                      <p className="mt-1 text-xs text-[var(--slate-600)]">
                        Ces points empechent la soumission tant qu&apos;ils restent ouverts.
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--danger)]">
                      {summary.submissionReadiness.blockers.length}
                    </span>
                  </div>
                  {summary.submissionReadiness.blockers.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {summary.submissionReadiness.blockers.map((entry) => (
                        <article
                          key={entry.id}
                          className="rounded-xl border border-[var(--danger)]/15 bg-white/90 px-3 py-3"
                        >
                          <p className="text-sm font-semibold text-[var(--slate-800)]">
                            {entry.label}
                          </p>
                          <p className="mt-1 text-sm text-[var(--slate-700)]">
                            {entry.message}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-[var(--slate-600)]">
                      Aucun blocant dur detecte.
                    </p>
                  )}
                </section>

                <section className="rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--warning)]">
                        Alertes
                      </p>
                      <p className="mt-1 text-xs text-[var(--slate-600)]">
                        Visibles pour la validation, mais non bloquantes pour l&apos;envoi.
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--warning)]">
                      {summary.submissionReadiness.alerts.length}
                    </span>
                  </div>
                  {summary.submissionReadiness.alerts.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {summary.submissionReadiness.alerts.map((entry) => (
                        <article
                          key={entry.id}
                          className="rounded-xl border border-[var(--warning)]/15 bg-white/90 px-3 py-3"
                        >
                          <p className="text-sm font-semibold text-[var(--slate-800)]">
                            {entry.label}
                          </p>
                          <p className="mt-1 text-sm text-[var(--slate-700)]">
                            {entry.message}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-[var(--slate-600)]">
                      Aucune alerte complementaire.
                    </p>
                  )}
                </section>
              </div>

              <section className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-4">
                <p className="text-sm font-semibold text-[var(--slate-800)]">
                  Regles declenchees
                </p>
                {summary.reasons.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {summary.reasons.map((reason) => (
                      <article
                        key={`${reason.ruleId}-${reason.approvalId ?? "pending"}`}
                        className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-[var(--slate-800)]">
                            {reason.label}
                          </p>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--slate-600)]">
                            {reason.approvalStatus === "approved"
                              ? "Approuvee"
                              : reason.approvalStatus === "pending"
                                ? "En revue"
                                : reason.approvalStatus === "rejected"
                                  ? "A reprendre"
                                  : "A soumettre"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[var(--slate-700)]">
                          {reason.message}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[var(--slate-600)]">
                    Aucune regle d&apos;approbation active sur cette version.
                  </p>
                )}
              </section>

              <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
                {summary.availableReviewers.length > 0 ? (
                  <label className="flex flex-col gap-1 text-sm text-[var(--slate-700)]">
                    <span className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                      Validateur
                    </span>
                    <select
                      className="input"
                      value={assignedReviewerUserId ?? ""}
                      onChange={(event) =>
                        setAssignedReviewerUserId(event.target.value || null)
                      }
                    >
                      {summary.availableReviewers.map((reviewer) => (
                        <option key={reviewer.userId} value={reviewer.userId}>
                          {reviewer.fullName}
                          {reviewer.workEmail ? ` - ${reviewer.workEmail}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--slate-200)] bg-white px-3 py-3 text-sm text-[var(--slate-600)]">
                    Aucun validateur admin ou director n&apos;est disponible pour ce tenant.
                  </div>
                )}

                <label className="flex flex-col gap-1 text-sm text-[var(--slate-700)]">
                  <span className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                    Message de contexte
                  </span>
                  <textarea
                    className="input min-h-[112px] resize-y py-3"
                    value={submissionMessage}
                    onChange={(event) => setSubmissionMessage(event.target.value)}
                    placeholder="Precisez les points a surveiller, les arbitrages deja faits et ce qui reste a confirmer."
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--slate-200)] pt-4">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={
                    isPending ||
                    requestableReasons.length === 0 ||
                    summary.submissionReadiness.blockers.length > 0 ||
                    summary.availableReviewers.length === 0
                  }
                  onClick={runSubmitAction}
                >
                  {isPending ? "En cours..." : "Confirmer la soumission"}
                </button>
                {requestableReasons.length === 0 ? (
                  <p className="text-xs text-[var(--slate-500)]">
                    Aucune regle de validation n&apos;est actuellement declenchee sur cette version.
                  </p>
                ) : null}
                {summary.submissionReadiness.blockers.length > 0 ? (
                  <p className="text-xs text-[var(--danger)]">
                    Corrigez les blocants avant d&apos;envoyer a la validation.
                  </p>
                ) : null}
                {summary.activeCycle !== null ? (
                  <p className="text-xs text-[var(--brand-blue)]">
                    Cette version est deja en revue.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {summary.permissions.canDecide ? (
        <section className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                Commentaires de validation
              </h3>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                Ciblez l&apos;affaire, un lot, une ligne ou une exception sans
                ouvrir l&apos;éditeur complet.
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
                Portée
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
                  <option value="">Choisir…</option>
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
              placeholder="Expliquez ce qui est validé, ce qui reste réservé, ou ce qui doit être corrigé."
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

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--slate-200)] pt-4">
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
              className="btn btn-sm border-[var(--warning)] bg-[var(--warning)]/10 text-[var(--warning)] hover:bg-[var(--warning)]/20"
              disabled={isPending}
              onClick={() => runDecision("approved_with_reservations")}
            >
              {isPending
                ? "En cours..."
                : DECISION_META.approved_with_reservations.buttonLabel}
            </button>

            <div className="ml-auto" />

            {pendingConfirm === "changes_requested" ? (
              <span className="flex items-center gap-2">
                <span className="text-xs text-[var(--danger)]">
                  Confirmer le renvoi ?
                </span>
                <button
                  type="button"
                  className="btn btn-sm border-[var(--danger)] bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90"
                  disabled={isPending}
                  onClick={() => {
                    setPendingConfirm(null);
                    runDecision("changes_requested");
                  }}
                >
                  {isPending ? "En cours..." : "Oui, renvoyer"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={isPending}
                  onClick={() => setPendingConfirm(null)}
                >
                  Annuler
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-sm border-[var(--danger)]/30 bg-[var(--danger)]/5 text-[var(--danger)] hover:bg-[var(--danger)]/10"
                disabled={isPending}
                onClick={() => {
                  setFormError(null);
                  if (draftComments.length === 0) {
                    setFormError("Ajoutez au moins un commentaire avant de renvoyer en correction.");
                    return;
                  }
                  setPendingConfirm("changes_requested");
                }}
              >
                {DECISION_META.changes_requested.buttonLabel}
              </button>
            )}
          </div>
        </section>
      ) : null}

      {latestReview ? (
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
            {renderDecisionBadge(latestReview.decision)}
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
              {(["approval_rule", "lot", "line", "project"] as const)
                .map((scopeType) => ({
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
                      {group.comments.length > 1
                        ? ` (${group.comments.length})`
                        : ""}
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
                      {renderDecisionBadge(cycle.decision)}
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
      ) : null}
    </div>
  );
}
