"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type GeneratedOuvrageFooterBarProps = {
  selectedCount: number;
  selectedReviewedCount: number;
  selectedMissingParentCount: number;
  selectedMissingReviewCount: number;
  canInsertSelected: boolean;
  draftStatus: string;
  isInserting: boolean;
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  onNewGeneration: () => void;
  onClose: () => void;
  onInsertSelected: () => void;
};

type StatusTone = "warning" | "success" | "neutral";

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  warning: "border-warning-border bg-warning-subtle text-warning",
  success: "border-success-border bg-success-subtle text-success",
  neutral: "border-border bg-surface-subtle text-muted-foreground",
};

export function GeneratedOuvrageFooterBar({
  selectedCount,
  selectedReviewedCount,
  selectedMissingParentCount,
  selectedMissingReviewCount,
  canInsertSelected,
  draftStatus,
  isInserting,
  isMutationBlocked,
  mutationBlockedMessage,
  onNewGeneration,
  onClose,
  onInsertSelected,
}: GeneratedOuvrageFooterBarProps) {
  const isDiscarded = draftStatus === "discarded";

  // Determine status copy and tone
  let statusCopy: string;
  let statusTone: StatusTone;

  if (isMutationBlocked) {
    statusCopy = mutationBlockedMessage;
    statusTone = "warning";
  } else if (isDiscarded) {
    statusCopy = "Toutes les propositions ont été écartées.";
    statusTone = "neutral";
  } else if (selectedCount === 0) {
    statusCopy =
      "Sélectionnez un ouvrage prêt à insérer. Unité, quantité et sous-détail validé sont requis.";
    statusTone = "neutral";
  } else if (selectedMissingParentCount > 0) {
    statusCopy = `${selectedMissingParentCount} ouvrage(s) sélectionné(s) incomplet(s). Complétez-les avant insertion.`;
    statusTone = "warning";
  } else if (selectedMissingReviewCount > 0) {
    statusCopy = `${selectedMissingReviewCount} ouvrage(s) sélectionné(s) sans sous-détail validé. Validez-les avant insertion.`;
    statusTone = "warning";
  } else {
    statusCopy = `${selectedReviewedCount} ouvrage(s) sélectionné(s) prêt(s) à insérer.`;
    statusTone = "success";
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={cn(
            "max-w-2xl rounded-lg border px-3 py-2 text-sm",
            STATUS_TONE_CLASSES[statusTone]
          )}
        >
          {statusCopy}
        </p>
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onNewGeneration}
            disabled={isInserting}
          >
            Nouvelle génération
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={isInserting}
          >
            Fermer
          </Button>
          {!isDiscarded && (
            <Button
              type="button"
              variant="primary"
              size="md"
              className="w-full min-[420px]:col-span-2 sm:w-auto"
              onClick={onInsertSelected}
              disabled={!canInsertSelected || isInserting || isMutationBlocked}
              data-testid="generated-ouvrage-insert-button"
            >
              Insérer les ouvrages sélectionnés
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
