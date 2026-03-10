import type { EstimateVersionApprovalStatus } from "@/lib/estimates/rules-engine";

export type WorkflowStepStatus = "done" | "current" | "upcoming";

export type WorkflowStepKey =
  | "dossier"
  | "brief"
  | "dpgf"
  | "devis"
  | "validation"
  | "envoi";

export type WorkflowStep = {
  key: WorkflowStepKey;
  label: string;
  status: WorkflowStepStatus;
};

type BuildAffaireWorkflowStepsInput = {
  hasDocs: boolean;
  briefConfirmed: boolean;
  hasDpgf: boolean;
  hasLines: boolean;
  approvalStatus?: EstimateVersionApprovalStatus | null;
  isSent: boolean;
};

type ShouldRenderPlansSectionInput = {
  takeoffEnabled?: boolean;
  planSetCount?: number | null;
  plansErrorMessage?: string;
};

export function isAffaireValidationComplete(
  approvalStatus?: EstimateVersionApprovalStatus | null
) {
  return approvalStatus === "approved" || approvalStatus === "not_required";
}

export function buildAffaireWorkflowSteps({
  hasDocs,
  briefConfirmed,
  hasDpgf,
  hasLines,
  approvalStatus,
  isSent,
}: BuildAffaireWorkflowStepsInput): WorkflowStep[] {
  const raw: Array<Pick<WorkflowStep, "key" | "label"> & { done: boolean }> = [
    { key: "dossier", label: "Dossier", done: hasDocs },
    { key: "brief", label: "Brief", done: briefConfirmed },
    { key: "dpgf", label: "DPGF", done: hasDpgf },
    { key: "devis", label: "Devis", done: hasLines },
    {
      key: "validation",
      label: "Validation",
      done: isAffaireValidationComplete(approvalStatus),
    },
    { key: "envoi", label: "Envoi", done: isSent },
  ];

  let foundCurrent = false;
  return raw.map((step) => {
    if (foundCurrent) {
      return { key: step.key, label: step.label, status: "upcoming" as const };
    }
    if (step.done) {
      return { key: step.key, label: step.label, status: "done" as const };
    }
    foundCurrent = true;
    return { key: step.key, label: step.label, status: "current" as const };
  });
}

export function shouldRenderPlansSection({
  takeoffEnabled = false,
  planSetCount,
  plansErrorMessage,
}: ShouldRenderPlansSectionInput) {
  if (!takeoffEnabled) {
    return false;
  }

  return Boolean(plansErrorMessage) || (planSetCount ?? 0) > 0;
}
