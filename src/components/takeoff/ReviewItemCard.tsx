"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui-legacy/Badge";
import { Button } from "@/components/ui-legacy/Button";
import {
  detectAnomalies,
  ANOMALY_LABELS,
} from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReviewItemCardProps = {
  item: ReviewItem;
  isReviewed: boolean;
  isAccepted: boolean;
  isMarkedForReview?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onMarkForReview?: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfidenceBarColor(confidence: number | null): string {
  if (confidence === null) return "var(--slate-300)";
  const pct = confidence * 100;
  if (pct >= 80) return "var(--success)";
  if (pct >= 50) return "var(--warning)";
  return "var(--danger)";
}

function getConfidenceBadgeVariant(
  confidence: number | null
): "success" | "warning" | "error" | "neutral" {
  if (confidence === null) return "neutral";
  const pct = confidence * 100;
  if (pct >= 80) return "success";
  if (pct >= 50) return "warning";
  return "error";
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
      <path
        fillRule="evenodd"
        d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReviewItemCard({
  item,
  isReviewed,
  isAccepted,
  isMarkedForReview = false,
  onAccept,
  onReject,
  onMarkForReview,
}: ReviewItemCardProps) {
  const anomalies = useMemo(() => detectAnomalies(item), [item]);
  const isRejected = isReviewed && !isAccepted;

  const confidenceBarColor = getConfidenceBarColor(item.confidence);
  const confidencePct =
    item.confidence !== null ? Math.round(item.confidence * 100) : null;
  const badgeVariant = getConfidenceBadgeVariant(item.confidence);

  // Card style by state
  const cardClass = isMarkedForReview
    ? "border-l-4 border-l-[var(--warning)] bg-amber-50/50"
    : isAccepted
      ? "border-l-4 border-l-[var(--success)] bg-emerald-50/50"
      : isRejected
        ? "border-l-4 border-l-[var(--danger)] bg-rose-50/50 opacity-70"
        : "border border-[var(--border)] bg-white";

  // Source reference
  const sourceRef = item.source_file_name
    ? `${item.source_file_name.slice(0, 20)}${item.source_page !== null ? ` p.${item.source_page}` : ""}`
    : item.source_page !== null
      ? `p.${item.source_page}`
      : null;

  return (
    <div
      className={`relative overflow-hidden rounded-lg transition-colors duration-200 ${cardClass}`}
    >
      {/* Confidence bar at top */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: "var(--slate-100)" }}
      >
        <div
          className="h-full transition-all duration-300 ease-out"
          style={{
            width: confidencePct !== null ? `${confidencePct}%` : "0%",
            backgroundColor: confidenceBarColor,
            animation: "grow-width 0.3s ease forwards",
          }}
        />
      </div>

      {/* Content */}
      <div className="p-3 sm:p-4">
        {/* Header row: designation + confidence + anomaly */}
        <div className="mb-2 flex items-start gap-2">
          <p
            className={`min-w-0 flex-1 text-sm font-medium text-[var(--slate-800)] ${
              isRejected ? "line-through" : ""
            }`}
          >
            {item.designation || "(sans designation)"}
          </p>

          <div className="flex flex-shrink-0 items-center gap-1.5">
            {anomalies.length > 0 && (
              <span
                title={anomalies
                  .map((a) => ANOMALY_LABELS[a])
                  .join(", ")}
              >
                <WarningIcon className="h-4 w-4 text-[var(--warning)]" />
              </span>
            )}
            <Badge variant={badgeVariant} size="sm">
              {confidencePct !== null ? `${confidencePct}%` : "-"}
            </Badge>
          </div>
        </div>

        {/* Details row: quantity + unit + source */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--slate-600)]">
          <span>
            <span className="font-medium">{item.quantity}</span>{" "}
            {item.unit}
          </span>
          {sourceRef && (
            <span className="text-[var(--slate-400)]">{sourceRef}</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="primary"
            size="sm"
            onClick={onAccept}
            className="active:scale-[0.98] transition-transform duration-150"
            leftIcon={
              isAccepted ? (
                <CheckIcon className="h-4 w-4" />
              ) : undefined
            }
          >
            {isAccepted ? "Accepte" : "Accepter"}
          </Button>
          {onMarkForReview && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onMarkForReview}
              className="active:scale-[0.98] transition-transform duration-150"
              leftIcon={<EyeIcon className="h-4 w-4" />}
            >
              {isMarkedForReview ? "Marque" : "A revoir"}
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            onClick={onReject}
            className="active:scale-[0.98] transition-transform duration-150"
            leftIcon={
              isRejected ? (
                <XIcon className="h-4 w-4" />
              ) : undefined
            }
          >
            {isRejected ? "Rejete" : "Rejeter"}
          </Button>
        </div>
      </div>
    </div>
  );
}
