"use client";

type GeneratedOuvrageFooterBarProps = {
  selectedCount: number;
  selectedReviewedCount: number;
  draftStatus: string;
  isInserting: boolean;
  onNewGeneration: () => void;
  onClose: () => void;
  onInsertSelected: () => void;
};

export function GeneratedOuvrageFooterBar({
  selectedCount,
  selectedReviewedCount,
  draftStatus,
  isInserting,
  onNewGeneration,
  onClose,
  onInsertSelected,
}: GeneratedOuvrageFooterBarProps) {
  const isDiscarded = draftStatus === "discarded";

  return (
    <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-4 mt-4">
      <div className="text-sm text-slate-600">
        {isDiscarded
          ? "Toutes les propositions ont ete ecartees"
          : `${selectedReviewedCount}/${selectedCount} ouvrage(s) selectionne(s) avec sous-detail valide`}
      </div>
      <div className="flex gap-2">
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
            className="btn btn-primary btn-sm"
            onClick={onInsertSelected}
            disabled={selectedCount === 0 || selectedReviewedCount !== selectedCount || isInserting}
            data-testid="generated-ouvrage-insert-button"
          >
            {isInserting
              ? "Insertion..."
              : "Inserer les ouvrages selectionnes"}
          </button>
        )}
      </div>
    </div>
  );
}
