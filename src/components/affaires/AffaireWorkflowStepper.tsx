import { useMemo } from "react";

import type { AffaireHubDpgfSourceResult, AffaireHubSummaryResult } from "@/lib/affaires/server";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import { buildAffaireWorkflowSteps, type WorkflowStep } from "./affaire-workflow";

const STEPPER_ANCHOR_MAP: Record<string, string> = {
  dossier: "intake",
  brief: "brief",
  dpgf: "dpgf",
  devis: "financial",
  validation: "approval",
  envoi: "approval",
};

type AffaireWorkflowStepperProps = {
  summary?: AffaireHubSummaryResult;
  dpgfSource?: AffaireHubDpgfSourceResult;
  intakeWorkspace?: AffaireIntakeWorkspace | null;
  approvalSummary?: EstimateApprovalSummary | null;
  lineCount?: number;
  ghost?: boolean;
};

export function AffaireWorkflowStepper({
  summary,
  dpgfSource,
  intakeWorkspace,
  approvalSummary,
  lineCount = 0,
  ghost = false,
}: AffaireWorkflowStepperProps) {
  const steps: WorkflowStep[] = useMemo(() => {
    if (ghost) {
      return buildAffaireWorkflowSteps({
        hasDocs: false,
        briefConfirmed: false,
        hasDpgf: false,
        hasLines: false,
        approvalStatus: null,
        isSent: false,
      });
    }

    const hasDocs = (intakeWorkspace?.documents?.length ?? 0) > 0;
    const briefConfirmed = intakeWorkspace?.briefDraft?.status === "confirme";
    const hasDpgf = dpgfSource !== null && dpgfSource !== undefined;
    const hasLines = lineCount > 0;
    const versionStatus = summary?.currentVersion?.status ?? "draft";
    const isSent = versionStatus === "sent" || versionStatus === "accepted";

    return buildAffaireWorkflowSteps({
      hasDocs,
      briefConfirmed,
      hasDpgf,
      hasLines,
      approvalStatus: approvalSummary?.approvalStatus,
      isSent,
    });
  }, [ghost, summary, dpgfSource, intakeWorkspace, approvalSummary, lineCount]);

  const unresolvedStepIndex = steps.findIndex(
    (step) => step.status === "current"
  );
  const currentStepIndex =
    unresolvedStepIndex >= 0 ? unresolvedStepIndex : Math.max(steps.length - 1, 0);
  const currentStep = steps[currentStepIndex] ?? steps[0];

  const getStepStatusLabel = (status: WorkflowStep["status"]) => {
    if (status === "done") return "terminée";
    if (status === "current") return "en cours";
    return "à venir";
  };

  return (
    <nav aria-label="Avancement de l'affaire" className="animate-fade-in">
      {currentStep ? (
        <div className="mb-2 flex items-center justify-between gap-3 sm:hidden">
          <span className="text-xs font-semibold text-[var(--slate-500)]">
            Étape {currentStepIndex + 1} sur {steps.length}
          </span>
          <span className="truncate text-sm font-semibold text-[var(--brand-blue)]">
            {currentStep.label}
          </span>
        </div>
      ) : null}

      <ol className="grid w-full grid-cols-6 gap-1 sm:flex sm:items-center sm:justify-between sm:gap-0">
        {steps.map((step, i) => (
          <li key={step.key} className="flex min-w-0 items-center justify-center sm:justify-start">
            {i > 0 && (
              <div
                aria-hidden="true"
                className={`hidden h-px min-w-6 flex-1 sm:block ${
                  step.status === "done"
                    ? "bg-[var(--success)]"
                    : "bg-[var(--slate-200)]"
                }`}
              />
            )}
            {ghost ? (
              <span
                className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 sm:min-h-0 sm:min-w-0"
                aria-label={`Étape ${i + 1} sur ${steps.length} : ${step.label}, ${getStepStatusLabel(step.status)}`}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:h-6 sm:w-6 border border-[var(--slate-200)] bg-[var(--slate-50)] text-[var(--slate-400)]"
                >
                  {i + 1}
                </span>
                <span className="hidden text-xs font-medium text-[var(--slate-400)] sm:inline">
                  {step.label}
                </span>
              </span>
            ) : (
              <a
                href={`#${STEPPER_ANCHOR_MAP[step.key] ?? step.key}`}
                aria-label={`Étape ${i + 1} sur ${steps.length} : ${step.label}, ${getStepStatusLabel(step.status)}`}
                className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2 sm:min-h-0 sm:min-w-0 sm:justify-start"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:h-6 sm:w-6 ${
                    step.status === "done"
                      ? "bg-[var(--success)] text-white"
                      : step.status === "current"
                        ? "border-2 border-[var(--brand-blue)] bg-white text-[var(--brand-blue)]"
                        : "border border-[var(--slate-200)] bg-[var(--slate-50)] text-[var(--slate-400)]"
                  }`}
                >
                  {step.status === "done" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={`hidden text-xs font-medium sm:inline ${
                    step.status === "done"
                      ? "text-[var(--success)]"
                      : step.status === "current"
                        ? "text-[var(--brand-blue)]"
                        : "text-[var(--slate-400)]"
                  }`}
                >
                  {step.label}
                </span>
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
