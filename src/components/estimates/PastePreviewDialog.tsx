"use client";

import { useMemo } from "react";

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
): { label: "BDC" | "OPTIMA" | "generic"; className: string } {
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
    label: "generic",
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
      <div
        className="dashboard-card w-full max-w-7xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-preview-dialog-title"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id="paste-preview-dialog-title"
              className="text-lg font-semibold text-[var(--slate-800)]"
            >
              Apercu du collage
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={formatBadge.className}>{formatBadge.label}</span>
              <span className="text-xs text-[var(--slate-500)]">
                {includedRowsCount}/{rows.length} ligne(s) incluse(s)
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
          >
            Fermer
          </button>
        </div>

        {hasErrors ? (
          <div className="mb-4 space-y-2">
            {errors.map((error, index) => (
              <div key={`${error}-${index}`} className="alert alert-error">
                {error}
              </div>
            ))}
          </div>
        ) : null}

        {hasDuplicateMapping ? (
          <div className="alert alert-error mb-4">
            Plusieurs colonnes pointent vers le meme champ cible. Corrigez le mapping avant de confirmer.
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <section className="overflow-hidden rounded-xl border border-[var(--slate-200)]">
            <div className="border-b border-[var(--slate-200)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                Mapping des colonnes
              </h3>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                Associez chaque colonne source a un champ cible.
              </p>
            </div>

            {mapping.length === 0 ? (
              <div className="px-4 py-6 text-sm text-[var(--slate-500)]">
                Aucun mapping a afficher.
              </div>
            ) : (
              <div className="table-scroll max-h-[430px]">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Cible</th>
                      <th>Etat</th>
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
                            <span className="font-medium text-[var(--slate-800)]">
                              {entry.sourceColumn}
                            </span>
                          </td>
                          <td>
                            <select
                              className="form-input form-select form-input--sm"
                              value={currentTarget}
                              onChange={(event) =>
                                onMappingChange(
                                  entry.sourceColumn,
                                  event.target.value || null
                                )
                              }
                            >
                              <option value="">Ignorer</option>
                              {entry.targetOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                  {option.required ? " (requis)" : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {currentTarget.trim().length === 0 ? (
                              <span className="status-badge status-draft">Ignore</span>
                            ) : hasDuplicate ? (
                              <span className="status-badge status-canceled">Doublon</span>
                            ) : (
                              <span className="status-badge status-confirmed">Mappe</span>
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

          <section className="overflow-hidden rounded-xl border border-[var(--slate-200)]">
            <div className="border-b border-[var(--slate-200)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                Apercu des lignes
              </h3>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                Incluez ou excluez les lignes avant import.
              </p>
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-[var(--slate-500)]">
                Aucune ligne detectee.
              </div>
            ) : (
              <div className="table-scroll max-h-[430px]">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="w-16">Inclure</th>
                      <th className="w-16">#</th>
                      {sourceColumns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                      <th>Etat</th>
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
                        <tr key={row.id} className={row.include ? "" : "opacity-60"}>
                          <td>
                            <input
                              type="checkbox"
                              checked={row.include}
                              onChange={(event) =>
                                onToggleRow(row.id, event.target.checked)
                              }
                              aria-label={`Inclure la ligne ${row.rowNumber}`}
                            />
                          </td>
                          <td>{row.rowNumber}</td>
                          {sourceColumns.map((column) => (
                            <td key={`${row.id}:${column}`}>
                              {normalizeCellValue(row.values[column])}
                            </td>
                          ))}
                          <td>
                            {!row.include ? (
                              <span className="status-badge status-draft">Exclue</span>
                            ) : isInvalid ? (
                              <span className="status-badge status-canceled">Invalide</span>
                            ) : (
                              <span className="status-badge status-confirmed">Valide</span>
                            )}
                          </td>
                          <td>
                            {invalidReasons.length === 0 ? (
                              <span className="text-xs text-[var(--slate-500)]">-</span>
                            ) : (
                              <div className="space-y-1">
                                {invalidReasons.map((reason, reasonIndex) => (
                                  <p
                                    key={`${row.id}:invalid:${reasonIndex}`}
                                    className="text-xs text-rose-600"
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

            <div className="border-t border-[var(--slate-200)] px-4 py-3 text-xs text-[var(--slate-500)]">
              {allRowsErrors.size === 0
                ? "Aucune erreur de validation detectee sur les lignes affichees."
                : `${allRowsErrors.size} type(s) erreur detecte(s) dans cet apercu.`}
            </div>
          </section>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--slate-500)]">
            {includedInvalidRowsCount > 0
              ? `${includedInvalidRowsCount} ligne(s) invalide(s) sont encore incluses.`
              : "Toutes les lignes incluses sont valides."}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Annuler
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConfirm}
              disabled={!canConfirm}
            >
              Confirmer import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
