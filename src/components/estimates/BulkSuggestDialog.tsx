"use client";

import { useMemo } from "react";

import type {
  BulkSuggestPreviewItem,
} from "@/lib/estimates/bulk-suggest";

type BulkSuggestProgress = {
  processed: number;
  total: number;
  percentage: number;
};

type BulkSuggestDialogProps = {
  isOpen: boolean;
  rows: BulkSuggestPreviewItem[];
  selectedItemIds: string[];
  isApplying: boolean;
  progress: BulkSuggestProgress | null;
  showProgress: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onToggleItem: (itemId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
};

export function BulkSuggestDialog({
  isOpen,
  rows,
  selectedItemIds,
  isApplying,
  progress,
  showProgress,
  error,
  onClose,
  onConfirm,
  onToggleItem,
  onToggleAll,
}: BulkSuggestDialogProps) {
  const selectedIds = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);

  const selectedCount = selectedItemIds.length;
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.itemId));

  if (!isOpen) return null;

  const resolvedProgress = progress ?? {
    processed: 0,
    total: rows.length,
    percentage: 0,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
      <div
        className="dashboard-card w-full max-w-6xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-suggest-dialog-title"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id="bulk-suggest-dialog-title"
              className="text-lg font-semibold text-[var(--slate-800)]"
            >
              Application en masse des suggestions
            </h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Selectionnez les lignes a mettre a jour ({selectedCount}/{rows.length}).
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isApplying}
          >
            Fermer
          </button>
        </div>

        {error ? <div className="alert alert-error">{error}</div> : null}

        {rows.length === 0 ? (
          <div className="alert alert-info">Aucune suggestion eligible.</div>
        ) : (
          <div className="table-scroll mt-4 max-h-[420px]">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-12">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => onToggleAll(event.target.checked)}
                      disabled={isApplying}
                      aria-label="Selectionner toutes les suggestions"
                    />
                  </th>
                  <th>Ligne</th>
                  <th>Actuel</th>
                  <th>Propose</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelected = selectedIds.has(row.itemId);
                  return (
                    <tr key={row.itemId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) =>
                            onToggleItem(row.itemId, event.target.checked)
                          }
                          disabled={isApplying}
                          aria-label={`Selectionner la ligne ${row.itemTitle}`}
                        />
                      </td>
                      <td>
                        <div className="space-y-1">
                          <p className="font-medium text-[var(--slate-800)]">
                            {row.itemTitle}
                          </p>
                          <p className="text-xs text-[var(--slate-500)]">
                            {row.ruleName} (score {row.score.toFixed(2)})
                          </p>
                        </div>
                      </td>
                      <td>
                        <div className="space-y-1 text-xs text-[var(--slate-600)]">
                          {row.changes.map((change) => (
                            <p key={`${row.itemId}:${change.field}:current`}>
                              <span className="font-semibold text-[var(--slate-700)]">
                                {change.label}:
                              </span>{" "}
                              {change.currentDisplay}
                            </p>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="space-y-1 text-xs text-[var(--slate-600)]">
                          {row.changes.map((change) => (
                            <p key={`${row.itemId}:${change.field}:proposed`}>
                              <span className="font-semibold text-[var(--slate-700)]">
                                {change.label}:
                              </span>{" "}
                              {change.proposedDisplay}
                            </p>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {showProgress && isApplying ? (
          <div className="mt-4 rounded-xl border border-[var(--slate-200)] bg-white p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-[var(--slate-800)]">
                Application des suggestions en cours...
              </span>
              <span className="text-[var(--slate-500)]">
                {resolvedProgress.percentage}% ({resolvedProgress.processed} / {resolvedProgress.total})
              </span>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-[var(--slate-200)]">
              <div
                className="h-2 rounded-full bg-[var(--brand-blue)]"
                style={{ width: `${resolvedProgress.percentage}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isApplying}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={isApplying || selectedCount === 0}
          >
            {isApplying ? "Application..." : "Appliquer"}
          </button>
        </div>
      </div>
    </div>
  );
}
