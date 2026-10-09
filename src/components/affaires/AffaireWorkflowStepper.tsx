import { useMemo } from "react";

import type { AffaireHubDpgfSourceResult, AffaireHubSummaryResult } from "@/lib/affaires/server";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import { buildAffaireWorkflowSteps, type WorkflowStep } from "./affaire-workflow";
import { CheckIcon } from "lucide-react";

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
          <span className="text-xs font-semibold text-muted-foreground">
            Étape {currentStepIndex + 1} sur {steps.length}
          </span>
          <span className="truncate text-sm font-semibold text-primary">
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
                    ? "bg-success"
                    : "bg-border"
                }`}
              />
            )}
            {ghost ? (
              <span
                className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 sm:min-h-0 sm:min-w-0"
                aria-label={`Étape ${i + 1} sur ${steps.length} : ${step.label}, ${getStepStatusLabel(step.status)}`}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:h-6 sm:w-6 border border-border bg-surface-subtle text-subtle-foreground"
                >
                  {i + 1}
                </span>
                <span className="hidden text-xs font-medium text-subtle-foreground sm:inline">
                  {step.label}
                </span>
              </span>
            ) : (
              <a
                href={`#${STEPPER_ANCHOR_MAP[step.key] ?? step.key}`}
                aria-label={`Étape ${i + 1} sur ${steps.length} : ${step.label}, ${getStepStatusLabel(step.status)}`}
                className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:min-h-0 sm:min-w-0 sm:justify-start"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:h-6 sm:w-6 ${
                    step.status === "done"
                      ? "bg-success text-white"
                      : step.status === "current"
                        ? "border-2 border-primary bg-surface text-primary"
                        : "border border-border bg-surface-subtle text-subtle-foreground"
                  }`}
                >
                  {step.status === "done" ? (
                    <CheckIcon aria-hidden="true" strokeWidth="3" size={12} />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={`hidden text-xs font-medium sm:inline ${
                    step.status === "done"
                      ? "text-success"
                      : step.status === "current"
                        ? "text-primary"
                        : "text-subtle-foreground"
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
