"use client";

import Link from "next/link";

import { formatEUR } from "@/lib/money";
import type { ApprovalQueueItem, ExceptionGroupKey, ReviewerState } from "@/lib/approvals/server";

import { Badge } from "@/components/ui/Badge";
import { ApprovalQueueStateActions } from "./ApprovalQueueStateActions";

// ---------------------------------------------------------------------------
// Exception pill colors
// ---------------------------------------------------------------------------

const EXCEPTION_GROUP_COLORS: Record<ExceptionGroupKey, string> = {
  price: "bg-amber-100 text-amber-800",
  quantities: "bg-red-100 text-red-800",
  missing_proofs: "bg-blue-100 text-blue-800",
  vat_conformity: "bg-purple-100 text-purple-800",
  missing_documents: "bg-slate-100 text-slate-700",
};

// ---------------------------------------------------------------------------
// Reviewer state badges
// ---------------------------------------------------------------------------

const REVIEWER_STATE_BADGE: Record<ReviewerState, { label: string; variant: "neutral" | "warning" | "error" | "success" }> = {
  seen: { label: "Vu", variant: "neutral" },
  review_laurent: { label: "A revoir", variant: "warning" },
  blocking: { label: "Bloquant", variant: "error" },
  acceptable: { label: "Acceptable", variant: "success" },
};

// ---------------------------------------------------------------------------
// Risk score badge
// ---------------------------------------------------------------------------

function riskScoreSeverity(score: number): { variant: "error" | "warning" | "info"; label: string } {
  if (score >= 70) return { variant: "error", label: "Critique" };
  if (score >= 40) return { variant: "warning", label: "Attention" };
  return { variant: "info", label: "Info" };
}

// ---------------------------------------------------------------------------
// Visual state border
// ---------------------------------------------------------------------------

const VISUAL_STATE_BORDER: Record<string, string> = {
  new: "border-l-[var(--brand-blue)] border-l-4",
  commented: "border-l-[var(--success)] border-l-4",
  seen: "",
  resolved: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function resolveExceptionReviewJobId(item: ApprovalQueueItem): string | null {
  if (item.latestJobId) {
    return item.latestJobId;
  }

  for (const alert of item.syntheticAlerts) {
    const reviewJobId = alert.latestJobId ?? alert.jobId;
    if (reviewJobId) {
      return reviewJobId;
    }
  }

  return null;
}

function buildCardHref(item: ApprovalQueueItem): string {
  const reviewJobId = resolveExceptionReviewJobId(item);

  if (reviewJobId) {
    return `/dashboard/affaires/${item.projectId}/takeoff/${reviewJobId}/review?versionId=${item.versionId}&from=approval&reviewMode=validation&view=dpgf&dpgfView=exceptions_only`;
  }

  return `/dashboard/affaires/${item.projectId}`;
}

export function ApprovalQueueCard({ item }: { item: ApprovalQueueItem }) {
  const href = buildCardHref(item);
  const riskInfo = riskScoreSeverity(item.riskScore);
  const borderClass = VISUAL_STATE_BORDER[item.visualState] ?? "";
  const marginPercent = item.marginBp !== null ? (item.marginBp / 100).toFixed(1) : null;

  return (
    <article
      className={`dashboard-card p-5 ${borderClass}`}
    >
      <Link
        href={href}
        className="group block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-blue)] focus-visible:outline-offset-4"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3
              className={`line-clamp-2 break-words text-sm leading-snug ${item.visualState === "new" ? "font-bold" : "font-semibold"} text-[var(--slate-800)]`}
              title={item.projectName}
            >
              {item.projectName}
            </h3>
          </div>
          {item.riskScore > 0 && (
            <Badge
              variant={riskInfo.variant}
              size="sm"
              title={`Score de risque : ${item.riskScore}/100 (${riskInfo.label})`}
              className="shrink-0"
            >
              {item.riskScore}
            </Badge>
          )}
        </div>

        {/* Subtitle */}
        <p className="mt-1 line-clamp-2 break-words text-xs text-[var(--slate-500)]">
          {item.clientName && <span>{item.clientName} &middot; </span>}
          {item.versionLabel}
        </p>

        {/* Metrics */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--slate-600)]">
          <span title="Montant HT">{formatEUR(item.amountHtCents)}</span>
          {marginPercent !== null && (
            <span title="Marge">Marge {marginPercent}%</span>
          )}
          {item.exceptionCount > 0 && (
            <span title="Nombre d'exceptions" className="font-medium text-[var(--danger)]">
              {item.exceptionCount} exception{item.exceptionCount > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Exception pills */}
        {item.exceptionGroups.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.exceptionGroups.map((group) => (
              <span
                key={group.key}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${EXCEPTION_GROUP_COLORS[group.key]}`}
              >
                {group.label} ({group.count})
              </span>
            ))}
          </div>
        )}

        {item.syntheticAlerts.length > 0 && (
          <div className="mt-3 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  item.syntheticAlerts[0]?.level === "critical"
                    ? "error"
                    : item.syntheticAlerts[0]?.level === "warning"
                      ? "warning"
                      : "info"
                }
                size="sm"
              >
                Alerte synthese
              </Badge>
              <Badge
                variant={
                  item.syntheticAlerts[0]?.status === "to_process"
                    ? "warning"
                    : item.syntheticAlerts[0]?.status === "assumed"
                      ? "success"
                      : "neutral"
                }
                size="sm"
              >
                {item.syntheticAlerts[0]?.status === "to_process"
                  ? "A traiter"
                  : item.syntheticAlerts[0]?.status === "assumed"
                    ? "Assumee"
                    : "Fausse alerte"}
              </Badge>
            </div>
            <p className="mt-2 break-words text-xs font-semibold text-[var(--slate-800)]">
              {item.syntheticAlerts[0]?.label}
            </p>
            <p className="mt-1 break-words text-xs text-[var(--slate-500)]">
              {item.syntheticAlerts[0]?.reasons[0] ??
                "Ouvrez la revue pour arbitrer les signaux restants."}
            </p>
          </div>
        )}

        {/* Submission message excerpt */}
        {item.submissionMessage && (
          <p className="mt-2 line-clamp-2 break-words text-[11px] italic text-[var(--slate-400)]">
            {item.submissionMessage}
          </p>
        )}

        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-blue)] group-hover:underline">
          Ouvrir le dossier
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
      </Link>

      {/* Footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--slate-100)] pt-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[11px] text-[var(--slate-400)]">{item.requestAgeLabel}</span>
          {item.reviewerState && (
            <Badge variant={REVIEWER_STATE_BADGE[item.reviewerState].variant} size="sm">
              {REVIEWER_STATE_BADGE[item.reviewerState].label}
            </Badge>
          )}
        </div>
        <ApprovalQueueStateActions
          cycleId={item.cycleId}
          currentState={item.reviewerState}
        />
      </div>
    </article>
  );
}
