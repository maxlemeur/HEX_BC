"use client";

import { useMemo } from "react";
import { XIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";

export type PastePreviewDetectedFormat = "bdc" | "optima" | "generic" | null;

export type PastePreviewCellValue = string | number | boolean | null;

export type PastePreviewTargetFieldOption = {
  value: string;
  label: string;
  required?: boolean;
};

export type PastePreviewMappingEntry = {
  sourceColumn: string;
  targetField: string | null;
  targetOptions: PastePreviewTargetFieldOption[];
};

export type PastePreviewRow = {
  id: string;
  rowNumber: number;
  include: boolean;
  values: Record<string, PastePreviewCellValue>;
  invalidReasons: string[];
};

export type PastePreviewDialogProps = {
  isOpen: boolean;
  detectedFormat: PastePreviewDetectedFormat;
  mapping: PastePreviewMappingEntry[];
  rows: PastePreviewRow[];
  errors: string[];
  onMappingChange: (sourceColumn: string, targetField: string | null) => void;
  onToggleRow: (rowId: string, include: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
};

function getDetectedFormatBadge(
  detectedFormat: PastePreviewDetectedFormat
): { label: "BDC" | "OPTIMA" | "Générique"; className: string } {
  if (detectedFormat === "bdc") {
    return {
      label: "BDC",
      className: "status-badge status-confirmed",
    };
  }

  if (detectedFormat === "optima") {
    return {
      label: "OPTIMA",
      className: "status-badge status-sent",
    };
  }

  return {
    label: "Générique",
    className: "status-badge status-draft",
  };
}

function normalizeCellValue(value: PastePreviewCellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function uniqueRowsErrors(rows: PastePreviewRow[]) {
  const unique = new Set<string>();

  rows.forEach((row) => {
    row.invalidReasons.forEach((reason) => {
      const trimmed = reason.trim();
      if (trimmed.length > 0) {
        unique.add(trimmed);
      }
    });
  });

  return unique;
}

export function PastePreviewDialog({
  isOpen,
  detectedFormat,
  mapping,
  rows,
  errors,
  onMappingChange,
  onToggleRow,
  onConfirm,
  onClose,
}: Readonly<PastePreviewDialogProps>) {
  const formatBadge = useMemo(
    () => getDetectedFormatBadge(detectedFormat),
    [detectedFormat]
  );

  const sourceColumns = useMemo(() => {
    if (mapping.length > 0) {
      return mapping.map((entry) => entry.sourceColumn);
    }

    const firstRow = rows[0];
    if (!firstRow) return [];
    return Object.keys(firstRow.values);
  }, [mapping, rows]);

  const targetUsage = useMemo(() => {
    const usage = new Map<string, number>();

    mapping.forEach((entry) => {
      const target = entry.targetField?.trim();
      if (!target) return;
      const count = usage.get(target) ?? 0;
      usage.set(target, count + 1);
    });

    return usage;
  }, [mapping]);

  const duplicateTargets = useMemo(
    () => new Set(Array.from(targetUsage.entries())
      .filter(([, count]) => count > 1)
      .map(([target]) => target)),
    [targetUsage]
  );

  const includedRowsCount = useMemo(
    () => rows.filter((row) => row.include).length,
    [rows]
  );

  const includedInvalidRowsCount = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.include &&
          row.invalidReasons.some((reason) => reason.trim().length > 0)
      ).length,
    [rows]
  );

  const hasErrors = errors.length > 0;
  const hasDuplicateMapping = duplicateTargets.size > 0;
  const canConfirm =
    includedRowsCount > 0 && includedInvalidRowsCount === 0 && !hasErrors && !hasDuplicateMapping;

  const allRowsErrors = useMemo(() => uniqueRowsErrors(rows), [rows]);

  return (
    <Dialog
      disablePointerDismissal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="full"
        className="sm:max-w-7xl"
        showCloseButton={false}
        data-testid="paste-preview-dialog"
      >
        <DialogHeader>
          <DialogTitle>Aperçu du collage</DialogTitle>
          <div className="flex flex-wrap items-center gap-2">
            <span className={formatBadge.className}>{formatBadge.label}</span>
            <DialogDescription className="text-xs">
              {includedRowsCount}/{rows.length} ligne(s) incluse(s)
            </DialogDescription>
          </div>
        </DialogHeader>
        <IconButton
          label="Fermer"
          icon={<XIcon aria-hidden="true" />}
          className="absolute top-3 right-3 sm:top-4 sm:right-4"
          tooltipSide="left"
          onClick={onClose}
          data-testid="paste-preview-dialog-close-button"
        />

        {hasErrors ? (
          <div className="space-y-2" data-testid="paste-preview-dialog-errors">
            {errors.map((error, index) => (
              <Alert key={`${error}-${index}`} variant="danger">
                {error}
              </Alert>
            ))}
          </div>
        ) : null}

        {hasDuplicateMapping ? (
          <Alert variant="danger" data-testid="paste-preview-dialog-duplicate-mapping-error">
            Plusieurs colonnes pointent vers le même champ cible. Corrigez le mapping avant de confirmer.
          </Alert>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <section
            className="min-w-0 overflow-hidden rounded-lg border border-border"
            data-testid="paste-preview-mapping-section"
            aria-labelledby="paste-preview-mapping-title"
          >
            <div className="border-b border-border px-4 py-3">
              <h3 id="paste-preview-mapping-title" className="text-sm font-semibold text-foreground">
                Mapping des colonnes
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Associez chaque colonne source à un champ cible.
              </p>
            </div>

            {mapping.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground" data-testid="paste-preview-mapping-empty">
                Aucun mapping à afficher.
              </div>
            ) : (
              <div
                className="table-scroll max-h-[430px]"
                data-testid="paste-preview-mapping-table"
                role="region"
                aria-labelledby="paste-preview-mapping-title"
                tabIndex={0}
              >
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Cible</th>
                      <th>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.map((entry) => {
                      const currentTarget = entry.targetField ?? "";
                      const hasDuplicate =
                        currentTarget.trim().length > 0 &&
                        duplicateTargets.has(currentTarget.trim());

                      return (
                        <tr key={entry.sourceColumn}>
                          <td>
                            <span className="font-medium text-foreground">
                              {entry.sourceColumn}
                            </span>
                          </td>
                          <td>
                            <NativeSelect
                              size="sm"
                              value={currentTarget}
                              onChange={(event) =>
                                onMappingChange(
                                  entry.sourceColumn,
                                  event.target.value || null
                                )
                              }
                              aria-label={`Champ cible de la colonne ${entry.sourceColumn}`}
                              data-testid="paste-preview-mapping-select"
                            >
                              <option value="">Ignorer</option>
                              {entry.targetOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                  {option.required ? " (requis)" : ""}
                                </option>
                              ))}
                            </NativeSelect>
                          </td>
                          <td>
                            {currentTarget.trim().length === 0 ? (
                              <Badge variant="neutral" size="sm" dot>Ignorée</Badge>
                            ) : hasDuplicate ? (
                              <Badge variant="danger" size="sm" dot>Doublon</Badge>
                            ) : (
                              <Badge variant="success" size="sm" dot>Associée</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section
            className="min-w-0 overflow-hidden rounded-lg border border-border"
            data-testid="paste-preview-rows-section"
            aria-labelledby="paste-preview-rows-title"
          >
            <div className="border-b border-border px-4 py-3">
              <h3 id="paste-preview-rows-title" className="text-sm font-semibold text-foreground">
                Aperçu des lignes
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Incluez ou excluez les lignes avant import.
              </p>
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground" data-testid="paste-preview-rows-empty">
                Aucune ligne détectée.
              </div>
            ) : (
              <div
                className="table-scroll max-h-[430px]"
                data-testid="paste-preview-rows-table"
                role="region"
                aria-labelledby="paste-preview-rows-title"
                tabIndex={0}
              >
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-16">Inclure</th>
                      <th className="w-16">#</th>
                      {sourceColumns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                      <th>État</th>
                      <th>Raisons invalides</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const invalidReasons = row.invalidReasons.filter(
                        (reason) => reason.trim().length > 0
                      );
                      const isInvalid = invalidReasons.length > 0;

                      return (
                        <tr key={row.id} className={row.include ? undefined : "opacity-75"}>
                          <td>
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              checked={row.include}
                              onChange={(event) =>
                                onToggleRow(row.id, event.target.checked)
                              }
                              aria-label={`Inclure la ligne ${row.rowNumber}`}
                              data-testid="paste-preview-row-include-checkbox"
                            />
                          </td>
                          <td className="tabular-nums">{row.rowNumber}</td>
                          {sourceColumns.map((column) => (
                            <td key={`${row.id}:${column}`}>
                              {normalizeCellValue(row.values[column])}
                            </td>
                          ))}
                          <td>
                            {!row.include ? (
                              <Badge variant="neutral" size="sm" dot>Exclue</Badge>
                            ) : isInvalid ? (
                              <Badge variant="danger" size="sm" dot>Invalide</Badge>
                            ) : (
                              <Badge variant="success" size="sm" dot>Valide</Badge>
                            )}
                          </td>
                          <td>
                            {invalidReasons.length === 0 ? (
                              <span className="text-xs text-muted-foreground">-</span>
                            ) : (
                              <div className="space-y-1">
                                {invalidReasons.map((reason, reasonIndex) => (
                                  <p
                                    key={`${row.id}:invalid:${reasonIndex}`}
                                    className="text-xs text-danger"
                                    data-testid="paste-preview-row-invalid-reason"
                                  >
                                    {reason}
                                  </p>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              {allRowsErrors.size === 0
                ? "Aucune erreur de validation détectée sur les lignes affichées."
                : `${allRowsErrors.size} type(s) d'erreur détecté(s) dans cet aperçu.`}
            </div>
          </section>
        </div>

        <DialogFooter className="sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {includedInvalidRowsCount > 0
              ? `${includedInvalidRowsCount} ligne(s) invalide(s) sont encore incluses.`
              : "Toutes les lignes incluses sont valides."}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              size="lg"
              onClick={onClose}
              data-testid="paste-preview-dialog-cancel-button"
            >
              Annuler
            </Button>
            <Button
              size="lg"
              onClick={onConfirm}
              disabled={!canConfirm}
              data-testid="paste-preview-dialog-confirm-button"
            >
              Confirmer l&apos;import
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
