"use client";

import Link from "next/link";
import { useId } from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
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
type SubmissionSignal = EstimateApprovalSummary["submissionReadiness"]["blockers"][number];
type ReasonApprovalStatus = EstimateApprovalSummary["reasons"][number]["approvalStatus"];

const INLINE_LINK_CLASS =
  "rounded-sm font-medium text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const EMPTY_ESTIMATE_MESSAGE = "Le devis doit contenir au moins une ligne pour être soumis.";

function resolveReasonStatus(status: ReasonApprovalStatus): {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
} {
  switch (status) {
    case "approved":
      return { label: "Approuvée", variant: "success" };
    case "pending":
      return { label: "En revue", variant: "info" };
    case "rejected":
      return { label: "À reprendre", variant: "danger" };
    default:
      return { label: "À soumettre", variant: "outline" };
  }
}

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

function SubmissionSignalList({
  projectId,
  groups,
  tone,
}: Readonly<{
  projectId: string;
  groups: ReturnType<typeof groupSubmissionSignals>;
  tone: "danger" | "warning";
}>) {
  return (
    <div className="mt-3 space-y-3">
      {groups.map((group) => (
        <div key={group.category} className="space-y-2">
          <p
            className={`text-xs font-semibold uppercase tracking-wider ${
              tone === "danger" ? "text-danger" : "text-warning"
            }`}
          >
            {group.label}
          </p>
          <ul className="space-y-2">
            {group.items.map((entry: SubmissionSignal) => {
              const action = resolveSubmissionSignalAction({
                projectId,
                signal: entry,
              });

              return (
                <li
                  key={entry.id}
                  className={`rounded-lg border bg-surface px-3 py-3 ${
                    tone === "danger" ? "border-danger-border" : "border-warning-border"
                  }`}
                >
                  <p className="break-words text-sm font-semibold text-foreground">
                    {entry.label}
                  </p>
                  <p className="mt-1 break-words text-sm text-foreground-secondary">
                    {entry.message}
                  </p>
                  {action ? (
                    <Link href={action.href} className={`mt-3 inline-flex text-xs ${INLINE_LINK_CLASS}`}>
                      {action.label}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
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
  const fieldId = useId();
  const emptyHintId = `${fieldId}-empty-hint`;
  const reviewerId = `${fieldId}-reviewer`;
  const messageId = `${fieldId}-message`;
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
    <section className="@container rounded-lg border border-border bg-surface-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="text-sm font-semibold text-foreground">
            Soumission à validation
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Vérifiez les points bloquants, les alertes restantes et le contexte avant d&apos;envoyer le dossier.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending || isEmpty || summary.activeCycle !== null}
          aria-expanded={showSubmitPanel}
          aria-controls={submitPanelId}
          aria-describedby={isEmpty ? emptyHintId : undefined}
          onClick={onTogglePanel}
        >
          {showSubmitPanel
            ? "Fermer"
            : isResubmission
              ? "Resoumettre"
              : "Soumettre à validation"}
        </Button>
      </div>

      {isEmpty ? (
        <p id={emptyHintId} className="mt-2 text-xs font-medium text-warning">
          {EMPTY_ESTIMATE_MESSAGE}
        </p>
      ) : null}

      {showSubmitPanel ? (
        <div
          id={submitPanelId}
          className="mt-4 space-y-4 border-t border-border pt-4"
        >
          <div className="grid gap-3 @sm:grid-cols-2">
            <article className="rounded-lg border border-border bg-surface px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Couverture
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {formatPercent(submissionOverview.coveragePercent)}
              </p>
              {submissionOverview.coveragePercent === null ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Analyse métrés indisponible.{" "}
                  <Link
                    href={`/dashboard/affaires/${projectId}/takeoff`}
                    className={INLINE_LINK_CLASS}
                  >
                    Ouvrir Plans & métrés
                  </Link>
                  .
                </p>
              ) : null}
            </article>
            <article className="rounded-lg border border-border bg-surface px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Exceptions
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {formatCount(submissionOverview.exceptionCount)}
              </p>
              {submissionOverview.exceptionCount === null ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Revue des écarts indisponible.{" "}
                  <Link
                    href={`/dashboard/affaires/${projectId}/takeoff`}
                    className={INLINE_LINK_CLASS}
                  >
                    Ouvrir Plans & métrés
                  </Link>
                  .
                </p>
              ) : null}
            </article>
            <article className="rounded-lg border border-border bg-surface px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Hypothèses ouvertes
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {formatCount(submissionOverview.openAssumptionCount)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {submissionOverview.openMissingPieceCount === null ||
                submissionOverview.clarifyWithClientCount === null ? (
                  <>
                    Registre affaire indisponible.{" "}
                    <Link
                      href={`/dashboard/affaires/${projectId}?registerStatus=open`}
                      className={INLINE_LINK_CLASS}
                    >
                      Ouvrir le registre
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    Pièces manquantes :{" "}
                    {formatCount(submissionOverview.openMissingPieceCount)}. Clarifications
                    client : {formatCount(submissionOverview.clarifyWithClientCount)}.
                  </>
                )}
              </p>
            </article>
            <article className="rounded-lg border border-border bg-surface px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Marge
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {formatPercent(submissionOverview.marginPercent)}
              </p>
              {submissionOverview.marginPercent === null ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Marge indisponible.{" "}
                  <Link
                    href={`/dashboard/estimates/${versionId}/edit`}
                    className={INLINE_LINK_CLASS}
                  >
                    Ouvrir le devis
                  </Link>
                  .
                </p>
              ) : null}
            </article>
          </div>

          <div className="grid gap-4">
            <section className="rounded-lg border border-danger-border bg-danger-subtle p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-danger">
                    Points bloquants
                  </h4>
                  <p className="mt-1 text-xs text-foreground-secondary">
                    Ces points empêchent la soumission tant qu&apos;ils restent ouverts.
                  </p>
                </div>
                <Badge variant="danger" size="sm">
                  {summary.submissionReadiness.blockers.length}
                </Badge>
              </div>
              {summary.submissionReadiness.blockers.length > 0 ? (
                <SubmissionSignalList projectId={projectId} groups={blockerGroups} tone="danger" />
              ) : (
                <p className="mt-3 text-sm text-foreground-secondary">
                  Aucun point bloquant détecté.
                </p>
              )}
            </section>

            <section className="rounded-lg border border-warning-border bg-warning-subtle p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-warning">
                    Alertes
                  </h4>
                  <p className="mt-1 text-xs text-foreground-secondary">
                    Visibles pour la validation interne. Certaines alertes devront être traitées avant l&apos;envoi client.
                  </p>
                </div>
                <Badge variant="warning" size="sm">
                  {summary.submissionReadiness.alerts.length}
                </Badge>
              </div>
              {summary.submissionReadiness.alerts.length > 0 ? (
                <SubmissionSignalList projectId={projectId} groups={alertGroups} tone="warning" />
              ) : (
                <p className="mt-3 text-sm text-foreground-secondary">
                  Aucune alerte complémentaire.
                </p>
              )}
            </section>
          </div>

          <section className="rounded-lg border border-border bg-surface p-4">
            <h4 className="text-sm font-semibold text-foreground">
              Règles déclenchées
            </h4>
            {summary.reasons.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {summary.reasons.map((reason) => {
                  const status = resolveReasonStatus(reason.approvalStatus);
                  return (
                    <li
                      key={`${reason.ruleId}-${reason.approvalId ?? "pending"}`}
                      className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 break-words text-sm font-semibold text-foreground">
                          {reason.label}
                        </p>
                        <Badge variant={status.variant} size="sm">
                          {status.label}
                        </Badge>
                      </div>
                      <p className="mt-1 break-words text-sm text-foreground-secondary">
                        {reason.message}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Aucune règle d&apos;approbation active sur cette version.
              </p>
            )}
          </section>

          <div className="grid gap-3">
            {summary.availableReviewers.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-2">
                <FieldLabel htmlFor={reviewerId}>Validateur</FieldLabel>
                <NativeSelect
                  id={reviewerId}
                  size="sm"
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
                      {reviewer.workEmail ? ` — ${reviewer.workEmail}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-sm text-foreground-secondary">
                Aucun validateur (administrateur ou direction) n&apos;est disponible pour cette organisation.
              </p>
            )}

            <div className="flex min-w-0 flex-col gap-2">
              <FieldLabel htmlFor={messageId}>Message de contexte</FieldLabel>
              <Textarea
                id={messageId}
                className="min-h-[112px] resize-y text-sm"
                name="submissionMessage"
                autoComplete="off"
                value={submissionMessage}
                onChange={(event) => onSubmissionMessageChange(event.target.value)}
                placeholder="Ex. Prioriser les exceptions CFO, les arbitrages déjà faits et ce qui reste à confirmer…"
              />
            </div>
          </div>

          <div
            className="flex flex-wrap items-center gap-2 border-t border-border pt-4"
            aria-live="polite"
          >
            <Button
              variant="primary"
              size="sm"
              disabled={confirmDisabled}
              onClick={onSubmit}
            >
              {isPending
                ? "En cours…"
                : isResubmission
                  ? "Confirmer la resoumission"
                  : "Confirmer la soumission"}
            </Button>
            {isEmpty ? (
              <p className="text-xs font-medium text-warning">
                {EMPTY_ESTIMATE_MESSAGE}
              </p>
            ) : null}
            {!isResubmission && requestableReasonsCount === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucune règle de validation n&apos;est actuellement déclenchée sur cette version.
              </p>
            ) : null}
            {isResubmission && correctionChecklist && !correctionChecklist.allTreated ? (
              <p className="text-xs text-danger">
                Traitez tous les items de correction avant de resoumettre.
              </p>
            ) : null}
            {summary.submissionReadiness.blockers.length > 0 ? (
              <p className="text-xs text-danger">
                Corrigez les points bloquants avant d&apos;envoyer à la validation.
              </p>
            ) : null}
            {summary.activeCycle !== null ? (
              <p className="text-xs text-primary">
                Cette version est déjà en revue.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
