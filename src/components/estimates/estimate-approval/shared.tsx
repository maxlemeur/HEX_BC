import { buildAffaireRegisterSearchHref } from "@/lib/affaires/register";
import type {
  EstimateApprovalDecisionCommentInput,
  EstimateApprovalSubmissionSignal,
  EstimateApprovalSummary,
  EstimateReviewCommentScope,
  EstimateReviewCorrectionStatus,
  EstimateReviewDecision,
} from "@/lib/estimates/rules-engine";

export type DraftComment = EstimateApprovalDecisionCommentInput & {
  id: string;
  scopeLabel: string;
};

export type EstimateApprovalSubmissionOverview = {
  coveragePercent: number | null;
  exceptionCount: number | null;
  openQuestionsCount: number | null;
  openAssumptionCount: number | null;
  openMissingPieceCount: number | null;
  clarifyWithClientCount: number | null;
  marginPercent: number | null;
};

export const SUBMIT_PANEL_QUERY_PARAM = "approvalSubmit";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const SCOPE_LABELS: Record<EstimateReviewCommentScope, string> = {
  project: "Affaire",
  lot: "Lot",
  line: "Ligne",
  exception: "Exception",
  hypothesis: "Hypothèse",
  approval_rule: "Exception",
};

export const CORRECTION_STATUS_META: Record<
  EstimateReviewCorrectionStatus,
  {
    label: string;
    className: string;
  }
> = {
  pending: {
    label: "À traiter",
    className: "bg-[var(--warning-light)] text-[var(--warning)]",
  },
  corrected: {
    label: "Corrigé",
    className: "bg-[var(--success)]/10 text-[var(--success)]",
  },
  to_discuss: {
    label: "À discuter",
    className: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  },
};

export const DECISION_META: Record<
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

export const REVIEW_SCOPE_ORDER = [
  "exception",
  "hypothesis",
  "lot",
  "line",
  "project",
  "approval_rule",
] as const satisfies readonly EstimateReviewCommentScope[];

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return DATE_TIME_FORMATTER.format(date);
}

export function getTargetOptions(
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

  if (scopeType === "exception") {
    return summary.commentTargets.exceptions;
  }

  if (scopeType === "hypothesis") {
    return summary.commentTargets.hypotheses;
  }

  return summary.commentTargets.approvalRules;
}

export function DecisionBadge({
  decision,
}: Readonly<{
  decision: EstimateReviewDecision;
}>) {
  const meta = DECISION_META[decision];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badgeClassName}`}
    >
      {meta.badgeLabel}
    </span>
  );
}

export function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Indisponible";
  }

  return `${value.toFixed(1)}%`;
}

export function formatCount(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Indisponible";
  }

  return new Intl.NumberFormat("fr-FR").format(value);
}

export function formatCurrencyDelta(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Indisponible";
  }

  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    signDisplay: "always",
  }).format(value / 100);
}

export function setSubmitPanelUrlState(nextOpen: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  const nextUrl = new URL(window.location.href);
  if (nextOpen) {
    nextUrl.searchParams.set(SUBMIT_PANEL_QUERY_PARAM, "open");
  } else {
    nextUrl.searchParams.delete(SUBMIT_PANEL_QUERY_PARAM);
  }

  window.history.replaceState(window.history.state, "", nextUrl);
}

function buildRegisterHref(projectId: string, signalId: string) {
  if (!signalId.startsWith("register:")) {
    return null;
  }

  if (signalId === "register:critical_open_questions") {
    return buildAffaireRegisterSearchHref({
      pathname: `/dashboard/affaires/${projectId}`,
      searchParams: new URLSearchParams(),
      status: "open",
      severity: "critical",
      kind: null,
      cursor: null,
    });
  }

  if (signalId === "register:client_clarification_required") {
    return buildAffaireRegisterSearchHref({
      pathname: `/dashboard/affaires/${projectId}`,
      searchParams: new URLSearchParams(),
      status: "clarify_with_client",
      severity: null,
      kind: null,
      cursor: null,
    });
  }

  if (signalId === "register:open_questions_pending") {
    return buildAffaireRegisterSearchHref({
      pathname: `/dashboard/affaires/${projectId}`,
      searchParams: new URLSearchParams(),
      status: "open",
      severity: null,
      kind: null,
      cursor: null,
    });
  }

  return `/dashboard/affaires/${projectId}`;
}

export function resolveSubmissionSignalAction(input: {
  projectId: string;
  signal: EstimateApprovalSubmissionSignal;
}) {
  if (input.signal.actionHref) {
    return {
      href: input.signal.actionHref,
      label: input.signal.actionLabel?.trim() || "Ouvrir le registre",
    };
  }

  switch (input.signal.id) {
    case "register:critical_open_questions":
      return {
        href:
          buildRegisterHref(input.projectId, input.signal.id) ??
          `/dashboard/affaires/${input.projectId}`,
        label: "Ouvrir les points critiques",
      };
    case "register:open_questions_pending":
      return {
        href:
          buildRegisterHref(input.projectId, input.signal.id) ??
          `/dashboard/affaires/${input.projectId}`,
        label: "Ouvrir les points ouverts",
      };
    case "register:client_clarification_required":
      return {
        href:
          buildRegisterHref(input.projectId, input.signal.id) ??
          `/dashboard/affaires/${input.projectId}`,
        label: "Ouvrir les clarifications client",
      };
    default:
      return null;
  }
}
