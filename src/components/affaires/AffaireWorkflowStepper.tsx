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

const STEPPER_SHORT_LABELS: Record<string, string> = {
  dossier: "Dos.",
  brief: "Bri.",
  dpgf: "DPG",
  devis: "Dev.",
  validation: "Val.",
  envoi: "Env.",
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

  return (
    <nav aria-label="Avancement de l'affaire" className="mb-4 animate-fade-in">
      <ol className="flex w-full items-center justify-between">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center">
            {i > 0 && (
              <div
                aria-hidden="true"
                className={`h-px min-w-4 flex-1 sm:min-w-6 ${
                  step.status === "done"
                    ? "bg-[var(--success)]"
                    : "bg-[var(--slate-200)]"
                }`}
              />
            )}
            {ghost ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:h-6 sm:w-6 border border-[var(--slate-200)] bg-[var(--slate-50)] text-[var(--slate-400)]"
                >
                  {i + 1}
                </span>
                <span className="text-xs font-medium text-[var(--slate-400)]">
                  <span className="sm:hidden">{STEPPER_SHORT_LABELS[step.key] ?? step.label}</span>
                  <span className="hidden sm:inline">{step.label}</span>
                </span>
              </span>
            ) : (
              <a
                href={`#${STEPPER_ANCHOR_MAP[step.key] ?? step.key}`}
                className="flex items-center gap-1.5"
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
                  className={`text-xs font-medium ${
                    step.status === "done"
                      ? "text-[var(--success)]"
                      : step.status === "current"
                        ? "text-[var(--brand-blue)]"
                        : "text-[var(--slate-400)]"
                  }`}
                >
                  <span className="sm:hidden">{STEPPER_SHORT_LABELS[step.key] ?? step.label}</span>
                  <span className="hidden sm:inline">{step.label}</span>
                </span>
              </a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
