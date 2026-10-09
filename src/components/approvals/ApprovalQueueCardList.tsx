import type { ApprovalQueueItem } from "@/lib/approvals/server";

import { EmptyState } from "@/components/ui-legacy/EmptyState";
import { ApprovalQueueCard } from "./ApprovalQueueCard";
import { SquareCheckBigIcon } from "lucide-react";

type ApprovalQueueCardListProps = {
  items: ApprovalQueueItem[];
};

export function ApprovalQueueCardList({ items }: ApprovalQueueCardListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={
          <SquareCheckBigIcon aria-hidden="true" strokeWidth="1.5" size={28} />
        }
        title="Aucune affaire en attente de revue"
        description="Toutes les affaires soumises ont été traitees."
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
