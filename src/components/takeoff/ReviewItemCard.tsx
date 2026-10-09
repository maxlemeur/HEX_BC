"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui-legacy/Badge";
import { Button } from "@/components/ui-legacy/Button";
import {
  detectAnomalies,
  ANOMALY_LABELS,
} from "@/components/takeoff/TakeoffReviewTable";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import { LucideCheck, LucideEye, LucideX, TriangleAlertIcon } from "lucide-react";

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
    <LucideCheck className={className} aria-hidden="true" />
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <LucideX className={className} aria-hidden="true" />
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <TriangleAlertIcon className={className} aria-hidden="true" />
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <LucideEye className={className} aria-hidden="true" />
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
  const isRejected = isReviewed && !isAccepted && !isMarkedForReview;

  const confidenceBarColor = getConfidenceBarColor(item.confidence);
  const confidencePct =
    item.confidence !== null ? Math.round(item.confidence * 100) : null;
  const badgeVariant = getConfidenceBadgeVariant(item.confidence);

  // Card style by state
  const cardClass = isMarkedForReview
    ? "border-l-4 border-l-warning bg-amber-50/50"
    : isAccepted
      ? "border-l-4 border-l-success bg-emerald-50/50"
      : isRejected
        ? "border-l-4 border-l-danger bg-rose-50/50 opacity-70"
        : "border border-border bg-surface";

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
            className={`min-w-0 flex-1 text-sm font-medium text-slate-800 ${
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
                <WarningIcon className="h-4 w-4 text-warning" />
              </span>
            )}
            <Badge variant={badgeVariant} size="sm">
              {confidencePct !== null ? `${confidencePct}%` : "-"}
            </Badge>
          </div>
        </div>

        {/* Details row: quantity + unit + source */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>
            <span className="font-medium">{item.quantity}</span>{" "}
            {item.unit}
          </span>
          {sourceRef && (
            <span className="text-subtle-foreground">{sourceRef}</span>
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
