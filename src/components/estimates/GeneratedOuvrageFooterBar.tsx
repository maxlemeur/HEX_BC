"use client";

import { cn } from "@/lib/utils";

type GeneratedOuvrageFooterBarProps = {
  selectedCount: number;
  selectedReviewedCount: number;
  selectedMissingParentCount: number;
  selectedMissingReviewCount: number;
  canInsertSelected: boolean;
  draftStatus: string;
  isInserting: boolean;
  onNewGeneration: () => void;
  onClose: () => void;
  onInsertSelected: () => void;
};

export function GeneratedOuvrageFooterBar({
  selectedCount,
  selectedReviewedCount,
  selectedMissingParentCount,
  selectedMissingReviewCount,
  canInsertSelected,
  draftStatus,
  isInserting,
  onNewGeneration,
  onClose,
  onInsertSelected,
}: GeneratedOuvrageFooterBarProps) {
  const isDiscarded = draftStatus === "discarded";

  // Determine status copy and color variant
  let statusCopy: string;
  let statusVariant: "amber" | "green" | "slate";

  if (isDiscarded) {
    statusCopy = "Toutes les propositions ont ete ecartees.";
    statusVariant = "slate";
  } else if (selectedCount === 0) {
    statusCopy =
      "Selectionnez un ouvrage pret a inserer. Unite, quantite et sous-detail valide sont requis.";
    statusVariant = "slate";
  } else if (selectedMissingParentCount > 0) {
    statusCopy = `${selectedMissingParentCount} ouvrage(s) selectionne(s) incomplet(s). Completez-les avant insertion.`;
    statusVariant = "amber";
  } else if (selectedMissingReviewCount > 0) {
    statusCopy = `${selectedMissingReviewCount} ouvrage(s) selectionne(s) sans sous-detail valide. Validez-les avant insertion.`;
    statusVariant = "amber";
  } else {
    statusCopy = `${selectedReviewedCount} ouvrage(s) selectionne(s) pret(s) a inserer.`;
    statusVariant = "green";
  }

  // Determine insert button text
  let insertButtonText: string;
  if (isInserting) {
    insertButtonText = "Insertion...";
  } else if (selectedCount === 0) {
    insertButtonText = "Selectionnez des ouvrages";
  } else if (!canInsertSelected) {
    insertButtonText = "Insertion indisponible";
  } else {
    insertButtonText = `Inserer ${selectedReviewedCount} ouvrage(s)`;
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className={cn(
            "max-w-2xl rounded-lg border px-3 py-2 text-sm",
            statusVariant === "amber" &&
              "border-amber-200 bg-amber-50 text-amber-800",
            statusVariant === "green" &&
              "border-emerald-200 bg-emerald-50 text-emerald-800",
            statusVariant === "slate" &&
              "border-slate-200 bg-slate-50 text-slate-600"
          )}
        >
          {statusCopy}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onNewGeneration}
          >
            Nouvelle generation
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
          >
            Fermer
          </button>
          {!isDiscarded && (
            <button
              type="button"
              className="btn btn-primary btn-sm col-span-2 w-full sm:w-auto"
              onClick={onInsertSelected}
              disabled={!canInsertSelected || isInserting}
              data-testid="generated-ouvrage-insert-button"
            >
              {insertButtonText}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
