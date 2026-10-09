"use client";

import { useMemo } from "react";
import { CheckIcon, XIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReviewProgressBarProps = {
  acceptedCount: number;
  rejectedCount: number;
  markedForReviewCount?: number;
  totalCount: number;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReviewProgressBar({
  acceptedCount,
  rejectedCount,
  markedForReviewCount = 0,
  totalCount,
}: ReviewProgressBarProps) {
  const { reviewedCount, pendingCount, acceptedPct, rejectedPct, markedPct } =
    useMemo(() => {
      const reviewed = acceptedCount + rejectedCount + markedForReviewCount;
      const pending = totalCount - reviewed;
      const aPct = totalCount > 0 ? (acceptedCount / totalCount) * 100 : 0;
      const rPct = totalCount > 0 ? (rejectedCount / totalCount) * 100 : 0;
      const mPct = totalCount > 0 ? (markedForReviewCount / totalCount) * 100 : 0;
      return {
        reviewedCount: reviewed,
        pendingCount: pending,
        acceptedPct: aPct,
        rejectedPct: rPct,
        markedPct: mPct,
      };
    }, [acceptedCount, rejectedCount, markedForReviewCount, totalCount]);

  const allReviewed = reviewedCount === totalCount && totalCount > 0;

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-surface px-4 py-3">
      {/* Progress label */}
      <p className="mb-2 text-sm font-medium text-foreground-secondary">
        Progression : {reviewedCount}/{totalCount} items revus
      </p>

      {/* Segmented bar */}
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={reviewedCount}
        aria-valuemin={0}
        aria-valuemax={totalCount}
        aria-label={`${reviewedCount} items revus sur ${totalCount}`}
      >
        {acceptedPct > 0 && (
          <div
            className="h-full bg-success transition-all duration-500"
            style={{ width: `${acceptedPct}%` }}
          />
        )}
        {markedPct > 0 && (
          <div
            className="h-full bg-warning transition-all duration-500"
            style={{ width: `${markedPct}%` }}
          />
        )}
        {rejectedPct > 0 && (
          <div
            className="h-full bg-danger transition-all duration-500"
            style={{ width: `${rejectedPct}%` }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <CheckIcon className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          <span className="font-medium text-foreground-secondary">
            {acceptedCount}
          </span>{" "}
          <span className="text-muted-foreground">acceptes</span>
        </span>

        {markedForReviewCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-warning" />
            <span className="font-medium text-foreground-secondary">
              {markedForReviewCount}
            </span>{" "}
            <span className="text-muted-foreground">à revoir</span>
          </span>
        )}

        <span className="flex items-center gap-1.5">
          <XIcon className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
          <span className="font-medium text-foreground-secondary">
            {rejectedCount}
          </span>{" "}
          <span className="text-muted-foreground">rejetes</span>
        </span>

        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="font-medium text-foreground-secondary">
            {pendingCount}
          </span>{" "}
          <span className="text-muted-foreground">en attente</span>
        </span>
      </div>

      {/* 100% message */}
      {allReviewed && (
        <p className="mt-2 text-sm font-medium text-success">
          Tous les items ont été revus !
        </p>
      )}
    </div>
  );
}
