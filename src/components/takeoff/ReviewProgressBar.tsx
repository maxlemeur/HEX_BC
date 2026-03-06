"use client";

import { useMemo } from "react";

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
    <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-white px-4 py-3">
      {/* Progress label */}
      <p className="mb-2 text-sm font-medium text-[var(--slate-700)]">
        Progression : {reviewedCount}/{totalCount} items revus
      </p>

      {/* Segmented bar */}
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--slate-100)]"
        role="progressbar"
        aria-valuenow={reviewedCount}
        aria-valuemin={0}
        aria-valuemax={totalCount}
        aria-label={`${reviewedCount} items revus sur ${totalCount}`}
      >
        {acceptedPct > 0 && (
          <div
            className="h-full bg-[var(--success)] transition-all duration-500"
            style={{ width: `${acceptedPct}%` }}
          />
        )}
        {markedPct > 0 && (
          <div
            className="h-full bg-[var(--warning)] transition-all duration-500"
            style={{ width: `${markedPct}%` }}
          />
        )}
        {rejectedPct > 0 && (
          <div
            className="h-full bg-[var(--danger)] transition-all duration-500"
            style={{ width: `${rejectedPct}%` }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5 text-[var(--success)]"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
              clipRule="evenodd"
            />
          </svg>
          <span className="font-medium text-[var(--slate-700)]">
            {acceptedCount}
          </span>{" "}
          <span className="text-[var(--slate-500)]">acceptes</span>
        </span>

        {markedForReviewCount > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--warning)]" />
            <span className="font-medium text-[var(--slate-700)]">
              {markedForReviewCount}
            </span>{" "}
            <span className="text-[var(--slate-500)]">a revoir</span>
          </span>
        )}

        <span className="flex items-center gap-1.5">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-3.5 w-3.5 text-[var(--danger)]"
            aria-hidden="true"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
          <span className="font-medium text-[var(--slate-700)]">
            {rejectedCount}
          </span>{" "}
          <span className="text-[var(--slate-500)]">rejetes</span>
        </span>

        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--slate-300)]" />
          <span className="font-medium text-[var(--slate-700)]">
            {pendingCount}
          </span>{" "}
          <span className="text-[var(--slate-500)]">en attente</span>
        </span>
      </div>

      {/* 100% message */}
      {allReviewed && (
        <p className="mt-2 text-sm font-medium text-[var(--success)]">
          Tous les items ont ete revus !
        </p>
      )}
    </div>
  );
}
