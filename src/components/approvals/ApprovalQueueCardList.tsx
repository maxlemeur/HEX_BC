import type { ApprovalQueueItem } from "@/lib/approvals/server";

import { EmptyState } from "@/components/ui-legacy/EmptyState";
import { ApprovalQueueCard } from "./ApprovalQueueCard";

type ApprovalQueueCardListProps = {
  items: ApprovalQueueItem[];
};

export function ApprovalQueueCardList({ items }: ApprovalQueueCardListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
        }
        title="Aucune affaire en attente de revue"
        description="Toutes les affaires soumises ont ete traitees."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <ApprovalQueueCard key={item.cycleId} item={item} />
      ))}
    </div>
  );
}
