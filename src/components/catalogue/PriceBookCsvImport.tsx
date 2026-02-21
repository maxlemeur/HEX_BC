"use client";

import { useRef, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import { ColumnMapper } from "@/components/mappings/ColumnMapper";
import { useFileParser, type ParsedImportRow } from "@/hooks/useFileParser";
import {
  extractPriceBookSourceColumns,
  hasMinimumPriceBookMapping,
  suggestPriceBookColumnMapping,
  validatePriceBookRows,
  type PriceBookColumnMapping,
  type PriceBookValidationProgress,
  type PriceBookValidationResult,
} from "@/lib/catalogue/csv-import";

type BulkCreatePricesResponse = {
  created_count: number;
  mode: string;
};

const ACCEPTED_FILE_TYPES = ".csv,text/csv,application/csv,text/plain";

const TARGET_FIELDS = [
  { value: "supplier_id", label: "Supplier ID", required: true },
  { value: "product_id", label: "Product ID" },
  { value: "catalogue_item_id", label: "Catalogue Item ID" },
  { value: "unit_price", label: "Prix unitaire", required: true },
  { value: "currency", label: "Devise" },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function getProgressLabel(
  progress: PriceBookValidationProgress | null
): string {
  if (!progress) return "0%";
  return `${progress.percentage}% (${formatNumber(progress.processed)} / ${formatNumber(progress.total)})`;
}

function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".csv");
}

export function PriceBookCsvImport({
  onImported,
}: {
  onImported: () => Promise<void> | void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { parseFile } = useFileParser();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<PriceBookColumnMapping>({});
  const [validation, setValidation] = useState<PriceBookValidationResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState<PriceBookValidationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasRows = rows.length > 0;
  const canValidate = hasRows && hasMinimumPriceBookMapping(mapping);
  const canSubmit =
    !!validation &&
    validation.acceptedRows > 0 &&
    !isParsing &&
    !isValidating &&
    !isSubmitting;
  const showProgress = isParsing || isValidating;
  const canShowSummary = validation !== null && !isValidating;

  function clearFileSelection() {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function resetWorkflowState() {
    setRows([]);
    setSourceColumns([]);
    setMapping({});
    setValidation(null);
    setProgress(null);
    setSuccess(null);
  }

  async function runValidation(
    nextRows: ParsedImportRow[],
    nextMapping: PriceBookColumnMapping
  ) {
    if (nextRows.length === 0) {
      setValidation(null);
      return;
    }

    setIsValidating(true);
    setProgress(null);

    try {
      const result = await validatePriceBookRows(nextRows, nextMapping, {
        previewLimit: 10,
        chunkSize: 200,
        onProgress: (nextProgress) => {
          setProgress(nextProgress);
        },
      });

      setValidation(result);
    } finally {
      setIsValidating(false);
    }
  }

  async function onAnalyzeFile() {
    if (!selectedFile) {
      setError("Selectionnez un fichier CSV.");
      return;
    }

    if (!isCsvFile(selectedFile)) {
      setError("Seuls les fichiers CSV sont supportes pour cet import.");
      return;
    }

    setIsParsing(true);
    setError(null);
    setSuccess(null);
    setProgress(null);
    setValidation(null);

    try {
      const parsed = await parseFile(selectedFile);
      if (parsed.parser !== "csv") {
        throw new Error("Le format detecte n'est pas CSV.");
      }

      const nextRows = parsed.rows;
      if (nextRows.length === 0) {
        throw new Error("Le fichier CSV ne contient aucune ligne de donnees.");
      }

      const nextSourceColumns = extractPriceBookSourceColumns(nextRows);
      if (nextSourceColumns.length === 0) {
        throw new Error("Aucune colonne exploitable n'a ete detectee.");
      }

      const nextMapping = suggestPriceBookColumnMapping(nextSourceColumns);

      setRows(nextRows);
      setSourceColumns(nextSourceColumns);
      setMapping(nextMapping);

      await runValidation(nextRows, nextMapping);
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Impossible d'analyser le fichier CSV."
      );
    } finally {
      setIsParsing(false);
    }
  }

  async function onRefreshPreview() {
    if (!canValidate) {
      setError(
        "Le mapping minimal est incomplet: supplier_id, unit_price et product_id/catalogue_item_id."
      );
      return;
    }

    setError(null);
    await runValidation(rows, mapping);
  }

  async function onSubmitImport() {
    if (!validation || validation.acceptedRows === 0) {
      setError("Aucune ligne valide a importer.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await fetchApi<BulkCreatePricesResponse>("/api/prices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "bulk-create",
          items: validation.acceptedItems,
        }),
      });

      await onImported();

      setSuccess(
        `Import termine: ${result.created_count} ligne(s) creee(s) (${result.mode}).`
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Impossible d'importer les lignes valides."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const autoMappedCount = Object.keys(mapping).length;

  return (
    <section className="dashboard-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--slate-900)]">
            Import CSV price book
          </h2>
          <p className="text-sm text-[var(--slate-500)]">
            Workflow en 3 etapes: upload, mapping/validation, import des lignes valides.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
        <h3 className="text-sm font-semibold text-[var(--slate-800)]">Etape 1 - Charger le CSV</h3>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <div>
            <label className="form-label" htmlFor="price-book-csv-input">
              Fichier CSV
            </label>
            <input
              ref={fileInputRef}
              id="price-book-csv-input"
              className="form-input h-auto py-3"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                resetWorkflowState();
                setError(null);
              }}
              disabled={isParsing || isValidating || isSubmitting}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onAnalyzeFile()}
            disabled={!selectedFile || isParsing || isValidating || isSubmitting}
          >
            {isParsing ? "Parsing..." : "Analyser"}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              clearFileSelection();
              resetWorkflowState();
              setError(null);
            }}
            disabled={!selectedFile || isParsing || isValidating || isSubmitting}
          >
            Vider
          </button>
        </div>

        {selectedFile ? (
          <p className="mt-2 text-xs text-[var(--slate-500)]">
            {selectedFile.name}
          </p>
        ) : null}
      </div>

      {showProgress ? (
        <div className="mt-4 rounded-xl border border-[var(--slate-200)] bg-white p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-[var(--slate-800)]">
              {isParsing ? "Parsing CSV en cours..." : "Validation des lignes en cours..."}
            </span>
            <span className="text-[var(--slate-500)]">
              {isParsing ? "Progression en preparation..." : getProgressLabel(progress)}
            </span>
          </div>

          <div className="mt-3 h-2 w-full rounded-full bg-[var(--slate-200)]">
            <div
              className={`h-2 rounded-full bg-[var(--brand-blue)] ${isParsing ? "animate-pulse" : ""}`}
              style={{ width: isParsing ? "100%" : `${progress?.percentage ?? 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {hasRows ? (
        <div className="mt-4 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">
            Etape 2 - Mapping et validation
          </h3>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            {formatNumber(rows.length)} ligne(s) detectee(s), {autoMappedCount} colonne(s)
            mappee(s) automatiquement.
          </p>

          <div className="mt-4">
            <ColumnMapper
              sourceColumns={sourceColumns}
              mapping={mapping}
              targetFields={TARGET_FIELDS}
              disabled={isParsing || isValidating || isSubmitting}
              onChange={(nextMapping) => {
                setMapping(nextMapping as PriceBookColumnMapping);
              }}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void onRefreshPreview()}
              disabled={!canValidate || isParsing || isValidating || isSubmitting}
            >
              {isValidating ? "Validation..." : "Mettre a jour l'apercu"}
            </button>
            <span className="text-xs text-[var(--slate-500)]">
              Mapping requis: `supplier_id`, `unit_price` et `product_id` ou `catalogue_item_id`.
            </span>
          </div>
        </div>
      ) : null}

      {error ? <div className="alert alert-error mt-4">{error}</div> : null}
      {success ? <div className="alert alert-success mt-4">{success}</div> : null}

      {canShowSummary && validation ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
                Total lignes
              </p>
              <p className="mt-1 text-base font-semibold text-[var(--slate-900)]">
                {formatNumber(validation.totalRows)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
                Lignes valides
              </p>
              <p className="mt-1 text-base font-semibold text-[var(--success)]">
                {formatNumber(validation.acceptedRows)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
                Lignes rejetees
              </p>
              <p className="mt-1 text-base font-semibold text-[var(--danger)]">
                {formatNumber(validation.rejectedRowsCount)}
              </p>
            </div>
          </div>

          <section className="dashboard-card overflow-hidden">
            <div className="border-b border-[var(--slate-200)] px-6 py-4">
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                Apercu - 10 premieres lignes
              </h3>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ligne</th>
                    <th>Supplier ID</th>
                    <th>Product / Catalogue Item</th>
                    <th>Prix</th>
                    <th>Devise</th>
                    <th>Statut</th>
                    <th>Motif</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.previewRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-[var(--slate-500)]">
                        Aucun apercu disponible.
                      </td>
                    </tr>
                  ) : (
                    validation.previewRows.map((row) => (
                      <tr key={row.lineNumber}>
                        <td>{row.lineNumber}</td>
                        <td className="font-mono text-xs">{row.values.supplier_id || "-"}</td>
                        <td className="font-mono text-xs">
                          {row.values.product_id || row.values.catalogue_item_id || "-"}
                        </td>
                        <td>{row.values.unit_price || "-"}</td>
                        <td>{row.values.currency || "EUR"}</td>
                        <td>
                          <span
                            className={
                              row.status === "valid"
                                ? "status-badge status-confirmed"
                                : "status-badge status-canceled"
                            }
                          >
                            {row.status === "valid" ? "Valide" : "Invalide"}
                          </span>
                        </td>
                        <td className="text-sm text-[var(--slate-600)]">
                          {row.reason ?? "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {validation.rejectedRowsCount > 0 ? (
            <section className="dashboard-card overflow-hidden">
              <div className="border-b border-[var(--slate-200)] px-6 py-4">
                <h3 className="text-sm font-semibold text-[var(--slate-800)]">
                  Synthese des lignes rejetees
                </h3>
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  Ligne + motif de rejet.
                </p>
              </div>

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ligne</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.rejectedRows.slice(0, 200).map((row) => (
                      <tr key={`${row.lineNumber}-${row.reason}`}>
                        <td>{row.lineNumber}</td>
                        <td>{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {validation.rejectedRowsCount > 200 ? (
                <div className="border-t border-[var(--slate-200)] px-6 py-4 text-xs text-[var(--slate-500)]">
                  Liste tronquee aux 200 premieres lignes rejetees.
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
            <h3 className="text-sm font-semibold text-[var(--slate-800)]">
              Etape 3 - Import final
            </h3>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              Seules les lignes valides sont envoyees vers `POST /api/prices` action
              `bulk-create`.
            </p>

            <div className="mt-4">
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => void onSubmitImport()}
                disabled={!canSubmit}
              >
                {isSubmitting ? "Import..." : "Importer les lignes valides"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
