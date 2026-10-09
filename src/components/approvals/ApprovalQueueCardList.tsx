import { SquareCheckBigIcon } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import type { ApprovalQueueItem } from "@/lib/approvals/server";

import { ApprovalQueueCard } from "./ApprovalQueueCard";

type ApprovalQueueCardListProps = {
  items: ApprovalQueueItem[];
  onlyExceptions?: boolean;
};

export function ApprovalQueueCardList({ items, onlyExceptions = false }: ApprovalQueueCardListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<SquareCheckBigIcon aria-hidden="true" />}
        headingLevel={2}
        title={onlyExceptions ? "Aucune affaire avec exception" : "Aucune affaire en attente de revue"}
        description={
          onlyExceptions
            ? "Décochez « Exceptions seulement » pour voir toutes les affaires soumises."
            : "Toutes les affaires soumises ont été traitées."
        }
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
