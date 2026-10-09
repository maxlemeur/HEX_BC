"use client";

import { useMemo } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

  const resolvedProgress = progress ?? {
    processed: 0,
    total: rows.length,
    percentage: 0,
  };

  return (
    <Dialog
      open={isOpen}
      disablePointerDismissal={isApplying}
      onOpenChange={(open) => {
        if (!open && !isApplying) onClose();
      }}
    >
      <DialogContent size="full" className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Application en masse des suggestions</DialogTitle>
          <DialogDescription>
            Sélectionnez les lignes à mettre à jour ({selectedCount}/{rows.length}).
          </DialogDescription>
        </DialogHeader>

        {error ? <Alert variant="danger">{error}</Alert> : null}

        {rows.length === 0 ? (
          <Alert variant="info">Aucune suggestion éligible.</Alert>
        ) : (
          <div
            className="table-scroll max-h-[420px] rounded-lg border border-border"
            role="region"
            aria-label="Suggestions à appliquer"
            tabIndex={0}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-12">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={allSelected}
                      onChange={(event) => onToggleAll(event.target.checked)}
                      disabled={isApplying}
                      aria-label="Sélectionner toutes les suggestions"
                    />
                  </th>
                  <th>Ligne</th>
                  <th>Actuel</th>
                  <th>Proposé</th>
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
                          className="size-4 accent-primary"
                          checked={isSelected}
                          onChange={(event) =>
                            onToggleItem(row.itemId, event.target.checked)
                          }
                          disabled={isApplying}
                          aria-label={`Sélectionner la ligne ${row.itemTitle}`}
                        />
                      </td>
                      <td>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">
                            {row.itemTitle}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {row.ruleName} (score {row.score.toFixed(2)})
                          </p>
                        </div>
                      </td>
                      <td>
                        <div className="space-y-1 text-xs text-foreground-secondary">
                          {row.changes.map((change) => (
                            <p key={`${row.itemId}:${change.field}:current`}>
                              <span className="font-semibold text-foreground">
                                {change.label} :
                              </span>{" "}
                              {change.currentDisplay}
                            </p>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="space-y-1 text-xs text-foreground-secondary">
                          {row.changes.map((change) => (
                            <p key={`${row.itemId}:${change.field}:proposed`}>
                              <span className="font-semibold text-foreground">
                                {change.label} :
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
          <div className="rounded-lg border border-border bg-surface-subtle p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span id="bulk-suggest-progress-label" className="font-medium text-foreground">
                Application des suggestions en cours…
              </span>
              <span className="tabular-nums text-muted-foreground">
                {resolvedProgress.percentage} % ({resolvedProgress.processed} / {resolvedProgress.total})
              </span>
            </div>
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-labelledby="bulk-suggest-progress-label"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={resolvedProgress.percentage}
            >
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${resolvedProgress.percentage}%` }}
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            size="lg"
            onClick={onClose}
            disabled={isApplying}
          >
            Annuler
          </Button>
          <Button
            size="lg"
            onClick={onConfirm}
            disabled={selectedCount === 0}
            loading={isApplying}
          >
            Appliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
