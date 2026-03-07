"use client";

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
  const statusCopy = isDiscarded
    ? "Toutes les propositions ont ete ecartees"
    : selectedCount === 0
      ? "Selectionnez un ouvrage pret a inserer. Unite, quantite et sous-detail valide sont requis."
      : selectedMissingParentCount > 0
        ? `${selectedMissingParentCount}/${selectedCount} ouvrage(s) selectionne(s) doivent encore completer unite ou quantite.`
        : selectedMissingReviewCount > 0
          ? `${selectedReviewedCount}/${selectedCount} ouvrage(s) selectionne(s) ont un sous-detail valide.`
          : `${selectedReviewedCount}/${selectedCount} ouvrage(s) selectionne(s) pret(s) a inserer.`;

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl text-sm text-slate-600">
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
              {isInserting
                ? "Insertion..."
                : "Inserer les ouvrages selectionnes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
