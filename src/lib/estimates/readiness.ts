export const ESTIMATE_READINESS_CATEGORIES = [
  "documents",
  "register",
  "estimate_quality",
  "pdf",
  "approvals",
] as const;

export type EstimateReadinessCategory =
  (typeof ESTIMATE_READINESS_CATEGORIES)[number];

export const ESTIMATE_READINESS_CATEGORY_LABELS: Record<
  EstimateReadinessCategory,
  string
> = {
  documents: "Documents",
  register: "Registre",
  estimate_quality: "Qualite devis",
  pdf: "PDF",
  approvals: "Approbations",
};

export const ESTIMATE_READINESS_CATEGORY_ORDER =
  ESTIMATE_READINESS_CATEGORIES;

export function resolveEstimateReadinessCategoryFromGatingFlagKey(
  key: string,
): EstimateReadinessCategory {
  switch (key) {
    case "critical_missing_pieces":
    case "client_missing_documents_required":
    case "missing_pieces_pending":
      return "documents";
    case "critical_open_questions":
    case "client_clarification_required":
    case "open_questions_pending":
      return "register";
    case "no_pdf_generated":
      return "pdf";
    case "rule_violation":
      return "approvals";
    default:
      return "estimate_quality";
  }
}

export function resolveEstimateReadinessCategoryFromRegisterEntryKind(
  kind: string | null | undefined,
): EstimateReadinessCategory {
  if (kind === "missing_piece") {
    return "documents";
  }

  return "register";
}

export function resolveEstimateReadinessCategoryFromSubmissionSignal(input: {
  id: string;
  category?: EstimateReadinessCategory | null;
}): EstimateReadinessCategory {
  if (input.category) {
    return input.category;
  }

  if (input.id.startsWith("register:")) {
    return "register";
  }

  if (input.id.startsWith("rule:") || input.id.startsWith("signal:")) {
    return "approvals";
  }

  return "estimate_quality";
}
