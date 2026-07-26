import Link from "next/link";

import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import {
  ESTIMATE_READINESS_CATEGORY_LABELS,
  ESTIMATE_READINESS_CATEGORY_ORDER,
  resolveEstimateReadinessCategoryFromSubmissionSignal,
  type EstimateReadinessCategory,
} from "@/lib/estimates/readiness";

import type { EstimateApprovalSubmissionOverview } from "./shared";
import {
  formatCount,
  formatPercent,
  resolveSubmissionSignalAction,
} from "./shared";

type CorrectionChecklist = NonNullable<EstimateApprovalSummary["correctionChecklist"]>;

function groupSubmissionSignals(
  signals: EstimateApprovalSummary["submissionReadiness"]["blockers"],
) {
  const groups = new Map<
    EstimateReadinessCategory,
    EstimateApprovalSummary["submissionReadiness"]["blockers"]
  >();

  signals.forEach((signal) => {
    const category = resolveEstimateReadinessCategoryFromSubmissionSignal({
      id: signal.id,
      category: signal.category ?? null,
    });
    const current = groups.get(category) ?? [];
    current.push(signal);
    groups.set(category, current);
  });

  return ESTIMATE_READINESS_CATEGORY_ORDER
    .map((category) => ({
      category,
      label: ESTIMATE_READINESS_CATEGORY_LABELS[category],
      items: groups.get(category) ?? [],
    }))
    .filter((group) => group.items.length > 0);
}

export function EstimateApprovalSubmissionPanel({
  versionId,
  projectId,
  summary,
  submissionOverview,
  submitPanelId,
  showSubmitPanel,
  isPending,
  isEmpty,
  isResubmission,
  correctionChecklist,
  requestableReasonsCount,
  assignedReviewerUserId,
  submissionMessage,
  onAssignedReviewerUserIdChange,
  onSubmissionMessageChange,
  onTogglePanel,
  onSubmit,
}: Readonly<{
  versionId: string;
  projectId: string;
  summary: EstimateApprovalSummary;
  submissionOverview: EstimateApprovalSubmissionOverview;
  submitPanelId: string;
  showSubmitPanel: boolean;
  isPending: boolean;
  isEmpty: boolean;
  isResubmission: boolean;
  correctionChecklist: CorrectionChecklist | null;
  requestableReasonsCount: number;
  assignedReviewerUserId: string | null;
  submissionMessage: string;
  onAssignedReviewerUserIdChange: (value: string | null) => void;
  onSubmissionMessageChange: (value: string) => void;
  onTogglePanel: () => void;
  onSubmit: () => void;
}>) {
  const confirmDisabled =
    isPending ||
    isEmpty ||
    (isResubmission
      ? !Boolean(correctionChecklist?.canResubmit)
      : requestableReasonsCount === 0 ||
        summary.submissionReadiness.blockers.length > 0 ||
        summary.availableReviewers.length === 0);
  const blockerGroups = groupSubmissionSignals(summary.submissionReadiness.blockers);
  const alertGroups = groupSubmissionSignals(summary.submissionReadiness.alerts);

  return (
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
          disabled={isPending || isEmpty || summary.activeCycle !== null}
          aria-expanded={showSubmitPanel}
          aria-controls={submitPanelId}
          title={isEmpty ? "Le devis doit contenir au moins une ligne pour être soumis." : undefined}
          onClick={onTogglePanel}
        >
          {showSubmitPanel
            ? "Fermer"
            : isResubmission
              ? "Resoumettre"
              : "Soumettre a validation"}
        </button>
      </div>

      {isEmpty ? (
        <p className="mt-2 text-xs text-[var(--warning)]">
          Le devis doit contenir au moins une ligne pour être soumis.
        </p>
      ) : null}

      {showSubmitPanel ? (
        <div
          id={submitPanelId}
          className="mt-4 space-y-4 border-t border-[var(--slate-200)] pt-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                Couverture
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--slate-900)]">
                {formatPercent(submissionOverview.coveragePercent)}
              </p>
              {submissionOverview.coveragePercent === null ? (
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  Analyse metres indisponible.{" "}
                  <Link
                    href={`/dashboard/affaires/${projectId}/takeoff`}
                    className="font-medium text-[var(--brand-blue)] underline underline-offset-2"
                  >
                    Ouvrir Plans & metres
                  </Link>
                  .
                </p>
              ) : null}
            </article>
            <article className="rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                Exceptions
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--slate-900)]">
                {formatCount(submissionOverview.exceptionCount)}
              </p>
              {submissionOverview.exceptionCount === null ? (
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  Revue des ecarts indisponible.{" "}
                  <Link
                    href={`/dashboard/affaires/${projectId}/takeoff`}
                    className="font-medium text-[var(--brand-blue)] underline underline-offset-2"
                  >
                    Ouvrir Plans & metres
                  </Link>
                  .
                </p>
              ) : null}
            </article>
            <article className="rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                Hypotheses ouvertes
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--slate-900)]">
                {formatCount(submissionOverview.openAssumptionCount)}
              </p>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                {submissionOverview.openMissingPieceCount === null ||
                submissionOverview.clarifyWithClientCount === null ? (
                  <>
                    Registre affaire indisponible.{" "}
                    <Link
                      href={`/dashboard/affaires/${projectId}?registerStatus=open`}
                      className="font-medium text-[var(--brand-blue)] underline underline-offset-2"
                    >
                      Ouvrir le registre
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    Pieces manquantes:{" "}
                    {formatCount(submissionOverview.openMissingPieceCount)}. Clarifications
                    client: {formatCount(submissionOverview.clarifyWithClientCount)}.
                  </>
                )}
              </p>
            </article>
            <article className="rounded-xl border border-[var(--slate-200)] bg-white px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
                Marge
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--slate-900)]">
                {formatPercent(submissionOverview.marginPercent)}
              </p>
              {submissionOverview.marginPercent === null ? (
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  Marge indisponible.{" "}
                  <Link
                    href={`/dashboard/estimates/${versionId}/edit`}
                    className="font-medium text-[var(--brand-blue)] underline underline-offset-2"
                  >
                    Ouvrir le devis
                  </Link>
                  .
                </p>
              ) : null}
            </article>
          </div>

          <div className="grid gap-4">
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
                  {blockerGroups.map((group) => (
                    <div key={group.category} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--danger)]">
                        {group.label}
                      </p>
                      {group.items.map((entry) => {
                        const action = resolveSubmissionSignalAction({
                          projectId,
                          signal: entry,
                        });

                        return (
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
                            {action ? (
                              <Link
                                href={action.href}
                                className="mt-3 inline-flex text-xs font-medium text-[var(--brand-blue)] underline underline-offset-2"
                              >
                                {action.label}
                              </Link>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
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
                    Visibles pour la validation interne. Certaines alertes devront etre traitees avant l&apos;envoi client.
                  </p>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--warning)]">
                  {summary.submissionReadiness.alerts.length}
                </span>
              </div>
              {summary.submissionReadiness.alerts.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {alertGroups.map((group) => (
                    <div key={group.category} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--warning)]">
                        {group.label}
                      </p>
                      {group.items.map((entry) => {
                        const action = resolveSubmissionSignalAction({
                          projectId,
                          signal: entry,
                        });

                        return (
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
                            {action ? (
                              <Link
                                href={action.href}
                                className="mt-3 inline-flex text-xs font-medium text-[var(--brand-blue)] underline underline-offset-2"
                              >
                                {action.label}
                              </Link>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
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

          <div className="grid gap-3">
            {summary.availableReviewers.length > 0 ? (
              <label className="flex flex-col gap-1 text-sm text-[var(--slate-700)]">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                  Validateur
                </span>
                <select
                  className="input"
                  name="assignedReviewerUserId"
                  autoComplete="off"
                  value={assignedReviewerUserId ?? ""}
                  onChange={(event) =>
                    onAssignedReviewerUserIdChange(event.target.value || null)
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
                name="submissionMessage"
                autoComplete="off"
                value={submissionMessage}
                onChange={(event) => onSubmissionMessageChange(event.target.value)}
                placeholder="Ex. Prioriser les exceptions CFO, les arbitrages déjà faits et ce qui reste à confirmer…"
              />
            </label>
          </div>

          <div
            className="flex flex-wrap items-center gap-2 border-t border-[var(--slate-200)] pt-4"
            aria-live="polite"
          >
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={confirmDisabled}
              onClick={onSubmit}
            >
              {isPending
                ? "En cours..."
                : isResubmission
                  ? "Confirmer la resoumission"
                  : "Confirmer la soumission"}
            </button>
            {isEmpty ? (
              <p className="text-xs text-[var(--warning)]">
                Le devis doit contenir au moins une ligne pour être soumis.
              </p>
            ) : null}
            {!isResubmission && requestableReasonsCount === 0 ? (
              <p className="text-xs text-[var(--slate-500)]">
                Aucune regle de validation n&apos;est actuellement declenchee sur cette version.
              </p>
            ) : null}
            {isResubmission && correctionChecklist && !correctionChecklist.allTreated ? (
              <p className="text-xs text-[var(--danger)]">
                Traitez tous les items de correction avant de resoumettre.
              </p>
            ) : null}
            {summary.submissionReadiness.blockers.length > 0 ? (
              <p className="text-xs text-[var(--danger)]">
                Corrigez les blocants avant d&apos;envoyer à la validation.
              </p>
            ) : null}
            {summary.activeCycle !== null ? (
              <p className="text-xs text-[var(--brand-blue)]">
                Cette version est déjà en revue.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
