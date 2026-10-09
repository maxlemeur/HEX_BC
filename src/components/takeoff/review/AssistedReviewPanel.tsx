"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo, useTransition } from "react";

import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui-legacy/Toast";
import { ReviewItemCard } from "@/components/takeoff/ReviewItemCard";
import { ReviewProgressBar } from "@/components/takeoff/ReviewProgressBar";
import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import { FileTextIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AssistedReviewPanelProps = {
  items: ReviewItem[];
  reviewedIds: Set<string>;
  markedForReviewIds: Set<string>;
  onReviewedIdsChange: Dispatch<SetStateAction<Set<string>>>;
  onMarkedForReviewIdsChange: Dispatch<SetStateAction<Set<string>>>;
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
  reviewedIds,
  markedForReviewIds,
  onReviewedIdsChange,
  onMarkedForReviewIdsChange,
  onExcludeItems,
  onIncludeItems,
  onApplyClick,
  isApplyReady,
}: AssistedReviewPanelProps) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const { acceptedCount, rejectedCount, markedForReviewCount, pendingCount } = useMemo(() => {
    let accepted = 0;
    let rejected = 0;
    let markedForReview = 0;
    for (const item of items) {
      if (markedForReviewIds.has(item.id)) {
        markedForReview++;
      } else if (reviewedIds.has(item.id)) {
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
      markedForReviewCount: markedForReview,
      pendingCount: items.length - reviewedIds.size,
    };
  }, [items, reviewedIds, markedForReviewIds]);

  const handleAccept = useCallback(
    (itemId: string) => {
      onIncludeItems([itemId]);
      onReviewedIdsChange((prev) => new Set(prev).add(itemId));
      onMarkedForReviewIdsChange((prev) => {
        if (!prev.has(itemId)) return prev;
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    },
    [onIncludeItems, onMarkedForReviewIdsChange, onReviewedIdsChange]
  );

  const handleReject = useCallback(
    (itemId: string) => {
      onExcludeItems([itemId]);
      onMarkedForReviewIdsChange((prev) => {
        if (!prev.has(itemId)) return prev;
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    },
    [onExcludeItems, onMarkedForReviewIdsChange]
  );

  const handleMarkForReview = useCallback(
    (itemId: string) => {
      onMarkedForReviewIdsChange((prev) => new Set(prev).add(itemId));
      onReviewedIdsChange((prev) => new Set(prev).add(itemId));
    },
    [onMarkedForReviewIdsChange, onReviewedIdsChange]
  );

  const handleAcceptAll = useCallback(() => {
    startTransition(() => {
      const idsToAccept = items
        .filter((item) => item.is_excluded && !markedForReviewIds.has(item.id))
        .map((item) => item.id);
      if (idsToAccept.length > 0) {
        onIncludeItems(idsToAccept);
      }
      const allIds = new Set(items.map((i) => i.id));
      onReviewedIdsChange(allIds);
      const skipped = markedForReviewIds.size;
      toast.success({
        title: `${items.length - skipped} items acceptés`,
        description: skipped > 0
          ? `${skipped} item(s) "à revoir" non affecté(s).`
          : "Tous les items ont été marqués comme revus.",
      });
    });
  }, [items, markedForReviewIds, onIncludeItems, onReviewedIdsChange, toast]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon aria-hidden="true" />}
        title="Aucun item à revoir"
        description="Le relevé ne contient aucun item à valider."
        headingLevel={2}
      />
    );
  }

  return (
    <div className="flex flex-col">
      <ReviewProgressBar
        acceptedCount={acceptedCount}
        rejectedCount={rejectedCount}
        markedForReviewCount={markedForReviewCount}
        totalCount={items.length}
      />

      {/* Business-language summary */}
      <div className="border-b border-border bg-surface-subtle px-4 py-2">
        <p className="text-sm text-muted-foreground">
          Parcourez chaque item et décidez de le conserver ou de l&apos;écarter.
          L&apos;IA a détecté {items.length} élément{items.length > 1 ? "s" : ""} dans les plans.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {acceptedCount > 0 && (
            <Badge variant="success" size="sm">{acceptedCount} conservé{acceptedCount > 1 ? "s" : ""}</Badge>
          )}
          {rejectedCount > 0 && (
            <Badge variant="danger" size="sm">{rejectedCount} écarté{rejectedCount > 1 ? "s" : ""}</Badge>
          )}
          {markedForReviewCount > 0 && (
            <Badge variant="warning" size="sm">{markedForReviewCount} à revoir</Badge>
          )}
          {pendingCount > 0 && (
            <Badge variant="neutral" size="sm">{pendingCount} à examiner</Badge>
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
          const isMarkedForReview = markedForReviewIds.has(item.id);
          const isAccepted = isReviewed && !item.is_excluded && !isMarkedForReview;

          return (
            <ReviewItemCard
              key={item.id}
              item={item}
              isReviewed={isReviewed}
              isAccepted={isAccepted}
              isMarkedForReview={isMarkedForReview}
              onAccept={() => handleAccept(item.id)}
              onReject={() => handleReject(item.id)}
              onMarkForReview={() => handleMarkForReview(item.id)}
            />
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {acceptedCount} item{acceptedCount !== 1 ? "s" : ""} prêt{acceptedCount !== 1 ? "s" : ""} à appliquer
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
