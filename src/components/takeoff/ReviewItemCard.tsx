"use client";

import { useMemo } from "react";
import { CheckIcon, EyeIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function getConfidenceBarClass(confidence: number | null): string {
  if (confidence === null) return "bg-border-strong";
  const pct = confidence * 100;
  if (pct >= 80) return "bg-success";
  if (pct >= 50) return "bg-warning";
  return "bg-danger";
}

function getConfidenceBadgeVariant(
  confidence: number | null
): "success" | "warning" | "danger" | "neutral" {
  if (confidence === null) return "neutral";
  const pct = confidence * 100;
  if (pct >= 80) return "success";
  if (pct >= 50) return "warning";
  return "danger";
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

  const confidencePct =
    item.confidence !== null ? Math.round(item.confidence * 100) : null;
  const badgeVariant = getConfidenceBadgeVariant(item.confidence);

  // Card style by state
  const cardClass = isMarkedForReview
    ? "border-l-4 border-l-warning bg-warning-subtle"
    : isAccepted
      ? "border-l-4 border-l-success bg-success-subtle"
      : isRejected
        ? "border-l-4 border-l-danger bg-danger-subtle"
        : "border border-border bg-surface";

  return (
    <article
      aria-label={item.designation || "Item sans désignation"}
      className={`relative overflow-hidden rounded-lg transition-colors duration-200 ${cardClass}`}
    >
      {/* Confidence bar at top */}
      <div className="h-1 w-full bg-muted" aria-hidden="true">
        <div
          className={`h-full transition-all duration-300 ease-out ${getConfidenceBarClass(item.confidence)}`}
          style={{ width: confidencePct !== null ? `${confidencePct}%` : "0%" }}
        />
      </div>

      {/* Content */}
      <div className="p-3 sm:p-4">
        {/* Header row: designation + confidence */}
        <div className="mb-2 flex items-start gap-2">
          <p
            className={`min-w-0 flex-1 break-words text-sm font-medium text-foreground ${
              isRejected ? "line-through" : ""
            }`}
          >
            {item.designation || "(sans désignation)"}
          </p>

          <Badge variant={badgeVariant} size="sm" className="shrink-0">
            {confidencePct !== null ? `${confidencePct} %` : "—"}
            <span className="sr-only"> de confiance</span>
          </Badge>
        </div>

        {/* Details row: quantity + unit + source */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground-secondary">{item.quantity}</span>{" "}
            {item.unit}
          </span>
          {item.source_file_name || item.source_page !== null ? (
            <span className="flex min-w-0 items-baseline gap-1">
              {item.source_file_name ? (
                <span className="block max-w-[12rem] truncate" title={item.source_file_name}>
                  {item.source_file_name}
                </span>
              ) : null}
              {item.source_page !== null ? <span>p. {item.source_page}</span> : null}
            </span>
          ) : null}
        </div>

        {/* Anomalies, visible (no hover-only tooltip) */}
        {anomalies.length > 0 ? (
          <ul
            aria-label="Anomalies détectées"
            className="mb-3 space-y-0.5 text-xs text-warning"
          >
            {anomalies.map((anomaly) => (
              <li key={anomaly} className="flex items-center gap-1.5">
                <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
                {ANOMALY_LABELS[anomaly]}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Action buttons */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            variant="primary"
            size="sm"
            onClick={onAccept}
            leftIcon={isAccepted ? <CheckIcon aria-hidden="true" /> : undefined}
          >
            {isAccepted ? "Accepté" : "Accepter"}
          </Button>
          {onMarkForReview && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onMarkForReview}
              leftIcon={<EyeIcon aria-hidden="true" />}
            >
              {isMarkedForReview ? "Marqué à revoir" : "À revoir"}
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            onClick={onReject}
            leftIcon={isRejected ? <XIcon aria-hidden="true" /> : undefined}
          >
            {isRejected ? "Rejeté" : "Rejeter"}
          </Button>
        </div>
      </div>
    </article>
  );
}
