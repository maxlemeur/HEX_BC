"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { ReviewItemCard } from "@/components/takeoff/ReviewItemCard";
import { ReviewProgressBar } from "@/components/takeoff/ReviewProgressBar";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AssistedReviewPanelProps = {
  items: ReviewItem[];
  onExcludeItems: (itemIds: string[]) => void;
  onIncludeItems: (itemIds: string[]) => void;
  onApplyClick: () => void;
  isApplyReady: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssistedReviewPanel({
  items,
  onExcludeItems,
  onIncludeItems,
  onApplyClick,
  isApplyReady,
}: AssistedReviewPanelProps) {
  const toast = useToast();
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const previousExcludedStateRef = useRef<Map<string, boolean> | null>(null);

  useEffect(() => {
    setReviewedIds((previousReviewedIds) => {
      const validItemIds = new Set(items.map((item) => item.id));
      const nextReviewedIds = new Set(
        Array.from(previousReviewedIds).filter((itemId) => validItemIds.has(itemId))
      );
      let changed = nextReviewedIds.size !== previousReviewedIds.size;

      if (previousExcludedStateRef.current !== null) {
        for (const item of items) {
          if (!previousExcludedStateRef.current.get(item.id) && item.is_excluded) {
            if (!nextReviewedIds.has(item.id)) {
              nextReviewedIds.add(item.id);
              changed = true;
            }
          }
        }
      }

      previousExcludedStateRef.current = new Map(
        items.map((item) => [item.id, item.is_excluded] as const)
      );

      return changed ? nextReviewedIds : previousReviewedIds;
    });
  }, [items]);

  const { acceptedCount, rejectedCount, pendingCount } = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    for (const item of items) {
      if (reviewedIds.has(item.id)) {
        if (item.is_excluded) {
          rejected++;
        } else {
          accepted++;
        }
      }
    }
    return {
      acceptedCount: accepted,
      rejectedCount: rejected,
      pendingCount: items.length - reviewedIds.size,
    };
  }, [items, reviewedIds]);

  const handleAccept = useCallback(
    (itemId: string) => {
      onIncludeItems([itemId]);
      setReviewedIds((prev) => new Set(prev).add(itemId));
    },
    [onIncludeItems]
  );

  const handleReject = useCallback(
    (itemId: string) => {
      onExcludeItems([itemId]);
    },
    [onExcludeItems]
  );

  const handleAcceptAll = useCallback(() => {
    startTransition(() => {
      const idsToAccept = items
        .filter((item) => item.is_excluded)
        .map((item) => item.id);
      if (idsToAccept.length > 0) {
        onIncludeItems(idsToAccept);
      }
      setReviewedIds(new Set(items.map((i) => i.id)));
      toast.success({
        title: `${items.length} items acceptes`,
        description: "Tous les items ont ete marques comme revus.",
      });
    });
  }, [items, onIncludeItems, toast]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-7 w-7"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
        }
        title="Aucun item a revoir"
        description="Le releve ne contient aucun item a valider."
      />
    );
  }

  return (
    <div className="flex flex-col">
      <ReviewProgressBar
        acceptedCount={acceptedCount}
        rejectedCount={rejectedCount}
        totalCount={items.length}
      />

      {/* Business-language summary */}
      <div className="border-b border-[var(--border)] bg-[var(--slate-50)] px-4 py-2">
        <p className="text-sm text-[var(--slate-600)]">
          Parcourez chaque item et decidez de le conserver ou de l&apos;ecarter.
          L&apos;IA a detecte {items.length} element{items.length > 1 ? "s" : ""} dans les plans.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {acceptedCount > 0 && (
            <Badge variant="success" size="sm">{acceptedCount} conserve{acceptedCount > 1 ? "s" : ""}</Badge>
          )}
          {rejectedCount > 0 && (
            <Badge variant="error" size="sm">{rejectedCount} ecarte{rejectedCount > 1 ? "s" : ""}</Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="neutral" size="sm">{pendingCount} a examiner</Badge>
          )}
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="px-4 py-3">
          <Button
            variant="primary"
            size="sm"
            onClick={handleAcceptAll}
            loading={isPending}
          >
            Tout accepter ({pendingCount} item{pendingCount > 1 ? "s" : ""})
          </Button>
        </div>
      )}

      <div
        className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-live="polite"
      >
        {items.map((item) => {
          const isReviewed = reviewedIds.has(item.id);
          const isAccepted = isReviewed && !item.is_excluded;

          return (
            <ReviewItemCard
              key={item.id}
              item={item}
              isReviewed={isReviewed}
              isAccepted={isAccepted}
              onAccept={() => handleAccept(item.id)}
              onReject={() => handleReject(item.id)}
            />
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 flex items-center justify-between border-t border-[var(--border)] bg-white px-4 py-3">
        <p className="text-sm text-[var(--slate-600)]">
          {acceptedCount} item{acceptedCount !== 1 ? "s" : ""} pret{acceptedCount !== 1 ? "s" : ""} a appliquer
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={onApplyClick}
          disabled={acceptedCount === 0 || !isApplyReady}
        >
          Appliquer au chiffrage
        </Button>
      </div>
    </div>
  );
}
