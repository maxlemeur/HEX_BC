"use client";

import Link from "next/link";

import { formatEUR } from "@/lib/money";
import type { ApprovalQueueItem, ExceptionGroupKey, ReviewerState } from "@/lib/approvals/server";

import { ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { ApprovalQueueStateActions } from "./ApprovalQueueStateActions";

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

// ---------------------------------------------------------------------------
// Exception pill tones
// ---------------------------------------------------------------------------

const EXCEPTION_GROUP_TONES: Record<ExceptionGroupKey, BadgeTone> = {
  price: "warning",
  quantities: "danger",
  missing_proofs: "info",
  vat_conformity: "brand",
  missing_documents: "neutral",
};

// ---------------------------------------------------------------------------
// Reviewer state badges
// ---------------------------------------------------------------------------

const REVIEWER_STATE_BADGE: Record<ReviewerState, { label: string; variant: BadgeTone }> = {
  seen: { label: "Vu", variant: "neutral" },
  review_laurent: { label: "À revoir", variant: "warning" },
  blocking: { label: "Bloquant", variant: "danger" },
  acceptable: { label: "Acceptable", variant: "success" },
};

// ---------------------------------------------------------------------------
// Risk score badge
// ---------------------------------------------------------------------------

function riskScoreSeverity(score: number): { variant: "danger" | "warning" | "info"; label: string } {
  if (score >= 70) return { variant: "danger", label: "Critique" };
  if (score >= 40) return { variant: "warning", label: "Attention" };
  return { variant: "info", label: "Info" };
}

// ---------------------------------------------------------------------------
// Visual state border
// ---------------------------------------------------------------------------

const VISUAL_STATE_BORDER: Record<string, string> = {
  new: "border-l-primary border-l-4",
  commented: "border-l-success border-l-4",
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
      className={cn(
        "flex min-w-0 flex-col rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5",
        borderClass
      )}
    >
      <Link
        href={href}
        className="group block flex-1 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2
              className={cn(
                "line-clamp-2 break-words text-sm leading-snug text-foreground",
                item.visualState === "new" ? "font-bold" : "font-semibold"
              )}
            >
              {item.projectName}
            </h2>
          </div>
          {item.riskScore > 0 && (
            <Badge variant={riskInfo.variant} size="sm" className="shrink-0">
              <span className="sr-only">Score de risque :</span>
              {item.riskScore}
              <span className="sr-only">/100 ({riskInfo.label})</span>
            </Badge>
          )}
        </div>

        {/* Subtitle */}
        <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
          {item.clientName && <span>{item.clientName} &middot; </span>}
          {item.versionLabel}
        </p>

        {/* Metrics */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-secondary">
          <span className="tabular-nums">{formatEUR(item.amountHtCents)} HT</span>
          {marginPercent !== null && (
            <span className="tabular-nums">Marge {marginPercent} %</span>
          )}
          {item.exceptionCount > 0 && (
            <span className="font-medium text-danger">
              {item.exceptionCount} exception{item.exceptionCount > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Exception pills */}
        {item.exceptionGroups.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.exceptionGroups.map((group) => (
              <Badge key={group.key} variant={EXCEPTION_GROUP_TONES[group.key]} size="sm">
                {group.label} ({group.count})
              </Badge>
            ))}
          </div>
        )}

        {item.syntheticAlerts.length > 0 && (
          <div className="mt-3 rounded-control border border-border bg-surface-subtle p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  item.syntheticAlerts[0]?.level === "critical"
                    ? "danger"
                    : item.syntheticAlerts[0]?.level === "warning"
                      ? "warning"
                      : "info"
                }
                size="sm"
              >
                Alerte de synthèse
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
                  ? "À traiter"
                  : item.syntheticAlerts[0]?.status === "assumed"
                    ? "Assumée"
                    : "Fausse alerte"}
              </Badge>
            </div>
            <p className="mt-2 break-words text-xs font-semibold text-foreground">
              {item.syntheticAlerts[0]?.label}
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {item.syntheticAlerts[0]?.reasons[0] ??
                "Ouvrez la revue pour arbitrer les signaux restants."}
            </p>
          </div>
        )}

        {/* Submission message excerpt */}
        {item.submissionMessage && (
          <p className="mt-2 line-clamp-2 break-words text-micro italic text-muted-foreground">
            {item.submissionMessage}
          </p>
        )}

        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:underline">
          Ouvrir le dossier
          <ChevronRightIcon aria-hidden="true" size={14} />
        </span>
      </Link>

      {/* Footer */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-micro text-muted-foreground">{item.requestAgeLabel}</span>
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
