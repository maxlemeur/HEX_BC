"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import { ColumnMapper } from "@/components/mappings/ColumnMapper";
import { useFileParser, type ParsedImportRow } from "@/hooks/useFileParser";
import {
  detectPriceBookProfile,
  extractPriceBookSourceColumns,
  hasMinimumPriceBookMapping,
  suggestPriceBookColumnMappingForProfile,
  validatePriceBookRows,
  type PriceBookColumnMapping,
  type PriceBookLookups,
  type PriceBookProfile,
  type PriceBookValidationProgress,
  type PriceBookValidationResult,
} from "@/lib/catalogue/csv-import";

type BulkCreatePricesResponse = {
  created_count: number;
  mode: string;
};

type ResolveSuggestion = {
  type: "supplier" | "product";
  input: string;
  matches: Array<{
    confidence: number;
    id: string;
    value: string;
  }>;
};

type ResolveImportResponse = {
  suggestions: ResolveSuggestion[];
};

type CreateMissingResponse = {
  createdSuppliers: Array<{ id: string; name: string }>;
  createdProducts: Array<{ id: string; reference: string; designation: string }>;
};

type ImportSummary = {
  imported: number;
  ignored: number;
  toFix: number;
  duplicatesSkipped: number;
};

const ACCEPTED_FILE_TYPES = ".csv,text/csv,application/csv,text/plain";
const ATOMIC_BULK_BATCH_SIZE = 5000;

const TARGET_FIELDS = [
  { value: "supplier_name", label: "Fournisseur", required: true },
  { value: "product_reference", label: "Reference produit" },
  { value: "product_designation", label: "Designation produit" },
  { value: "unit_price", label: "Prix unitaire", required: true },
  { value: "currency", label: "Devise" },
];

const GUIDE_STEPS = ["Charger", "Detection", "Associer", "Resoudre", "Importer"];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function getProgressLabel(progress: PriceBookValidationProgress | null): string {
  if (!progress) return "0%";
  return `${progress.percentage}% (${formatNumber(progress.processed)} / ${formatNumber(progress.total)})`;
}

function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".csv");
}

function getProfileLabel(profile: PriceBookProfile | null): string | null {
  if (!profile) return null;
  if (profile === "mm_bdc") return "Format BDC detecte";
  return "Format CSV standard";
}

function escapeCsvCell(value: string): string {
  if (!value.includes(";") && !value.includes("\n") && !value.includes('"')) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function resolveCurrentStep(input: {
  hasRows: boolean;
  hasValidation: boolean;
  canSubmit: boolean;
}): number {
  if (!input.hasRows) return 1;
  if (!input.hasValidation) return 3;
  if (!input.canSubmit) return 4;
  return 5;
}

function buildUniqueValues(values: string[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (set.has(trimmed)) continue;
    set.add(trimmed);
  }
  return Array.from(set);
}

function buildTargetSources(mapping: PriceBookColumnMapping) {
  const targetToSource = new Map<string, string>();
  Object.entries(mapping).forEach(([source, target]) => {
    if (!targetToSource.has(target)) {
      targetToSource.set(target, source);
    }
  });
  return targetToSource;
}

export function PriceBookCsvImport({
  onImported,
  onLookupsUpdated,
  lookups,
}: {
  onImported: () => Promise<void> | void;
  onLookupsUpdated?: () => Promise<PriceBookLookups | void> | PriceBookLookups | void;
  lookups: PriceBookLookups;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { parseFile } = useFileParser();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [rowLineNumbers, setRowLineNumbers] = useState<number[]>([]);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<PriceBookColumnMapping>({});
  const [validation, setValidation] = useState<PriceBookValidationResult | null>(null);
  const [detectedProfile, setDetectedProfile] = useState<PriceBookProfile | null>(null);
  const [detectedEncoding, setDetectedEncoding] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  const [isParsing, setIsParsing] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isCreatingMissing, setIsCreatingMissing] = useState(false);

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

  const currentStep = resolveCurrentStep({
    hasRows,
    hasValidation: validation !== null,
    canSubmit,
  });

  const unknownSuppliers = useMemo(() => {
    if (!validation) return [];
    return buildUniqueValues(
      validation.rejectedRows
        .filter((row) => row.errorCode === "SUPPLIER_UNKNOWN")
        .map((row) => row.rawSupplier)
    );
  }, [validation]);

  const unknownProducts = useMemo(() => {
    if (!validation) return [];
    return buildUniqueValues(
      validation.rejectedRows
        .filter(
          (row) =>
            row.errorCode === "PRODUCT_UNKNOWN" ||
            row.issues.some((issue) => issue.code === "PRODUCT_UNKNOWN")
        )
        .map((row) => row.rawProduct)
    );
  }, [validation]);

  function clearFileSelection() {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function resetWorkflowState() {
    setRows([]);
    setRowLineNumbers([]);
    setSourceColumns([]);
    setMapping({});
    setValidation(null);
    setProgress(null);
    setSuccess(null);
    setDetectedProfile(null);
    setDetectedEncoding(null);
    setImportSummary(null);
  }

  async function runValidation(
    nextRows: ParsedImportRow[],
    nextMapping: PriceBookColumnMapping,
    nextProfile: PriceBookProfile,
    nextRowLineNumbers?: number[],
    nextLookups?: PriceBookLookups
  ) {
    if (nextRows.length === 0) {
      setValidation(null);
      return;
    }

    setIsValidating(true);
    setProgress(null);

    try {
      const result = await validatePriceBookRows(nextRows, nextMapping, {
        profile: nextProfile,
        includeSupplierAlternatives: true,
        autoFillSingleSupplier: true,
        previewLimit: 10,
        chunkSize: 200,
        rowLineNumbers: nextRowLineNumbers,
        lookups: nextLookups ?? lookups,
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
    setImportSummary(null);

    try {
      const parsed = await parseFile(selectedFile);
      if (parsed.parser !== "csv") {
        throw new Error("Le format detecte n'est pas CSV.");
      }

      const nextRows = parsed.rows;
      if (nextRows.length === 0) {
        throw new Error("Le fichier CSV ne contient aucune ligne de donnees.");
      }
      const nextRowLineNumbers = parsed.rowLineNumbers;

      const nextSourceColumns = extractPriceBookSourceColumns(nextRows);
      if (nextSourceColumns.length === 0) {
        throw new Error("Aucune colonne exploitable n'a ete detectee.");
      }

      const nextProfile = detectPriceBookProfile(nextSourceColumns);
      const nextMapping = suggestPriceBookColumnMappingForProfile(nextSourceColumns, nextProfile);

      setRows(nextRows);
      setRowLineNumbers(nextRowLineNumbers ?? []);
      setSourceColumns(nextSourceColumns);
      setDetectedProfile(nextProfile);
      setDetectedEncoding(parsed.detectedEncoding ?? null);
      setMapping(nextMapping);

      await runValidation(nextRows, nextMapping, nextProfile, nextRowLineNumbers);
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
        "Le mapping minimal est incomplet : Fournisseur, Prix unitaire et Reference ou Designation produit."
      );
      return;
    }

    if (!detectedProfile) {
      setError("Le profil du fichier n'a pas ete detecte.");
      return;
    }

    setError(null);
    await runValidation(rows, mapping, detectedProfile, rowLineNumbers);
  }

  async function onResolveAutomatically() {
    if (!validation || !detectedProfile) return;
    if (unknownSuppliers.length === 0 && unknownProducts.length === 0) {
      setError("Aucun fournisseur/produit inconnu a resoudre.");
      return;
    }

    setIsResolving(true);
    setError(null);

    try {
      const result = await fetchApi<ResolveImportResponse>("/api/prices/import/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          unknownSuppliers,
          unknownProducts,
        }),
      });

      const supplierReplacements = new Map<string, string>();
      const productReplacements = new Map<string, string>();

      result.suggestions.forEach((suggestion) => {
        const bestMatch = suggestion.matches[0];
        if (!bestMatch || bestMatch.confidence < 0.75) return;

        if (suggestion.type === "supplier") {
          supplierReplacements.set(suggestion.input, bestMatch.value);
        } else {
          productReplacements.set(suggestion.input, bestMatch.value);
        }
      });

      if (supplierReplacements.size === 0 && productReplacements.size === 0) {
        setError("Aucune resolution automatique fiable n'a ete trouvee.");
        return;
      }

      const targetSources = buildTargetSources(mapping);
      const supplierSource = targetSources.get("supplier_name") ?? null;
      const productRefSource = targetSources.get("product_reference") ?? null;
      const productDesignationSource = targetSources.get("product_designation") ?? null;

      const nextRows = rows.map((row) => {
        const nextRow = { ...row };

        if (detectedProfile === "mm_bdc") {
          ["F1_nom", "F2_nom", "F3_nom"].forEach((column) => {
            const current = String(nextRow[column] ?? "").trim();
            const replacement = supplierReplacements.get(current);
            if (replacement) {
              nextRow[column] = replacement;
            }
          });

          const currentProduct = String(nextRow.ID ?? "").trim();
          const replacementProduct = productReplacements.get(currentProduct);
          if (replacementProduct) {
            nextRow.ID = replacementProduct;
          }

          return nextRow;
        }

        if (supplierSource) {
          const currentSupplier = String(nextRow[supplierSource] ?? "").trim();
          const replacementSupplier = supplierReplacements.get(currentSupplier);
          if (replacementSupplier) {
            nextRow[supplierSource] = replacementSupplier;
          }
        }

        if (productRefSource) {
          const currentProductRef = String(nextRow[productRefSource] ?? "").trim();
          const replacementRef = productReplacements.get(currentProductRef);
          if (replacementRef) {
            nextRow[productRefSource] = replacementRef;
          }
        }

        if (productDesignationSource) {
          const currentProductDesignation = String(nextRow[productDesignationSource] ?? "").trim();
          const replacementDesignation = productReplacements.get(currentProductDesignation);
          if (replacementDesignation) {
            nextRow[productDesignationSource] = replacementDesignation;
          }
        }

        return nextRow;
      });

      setRows(nextRows);
      await runValidation(nextRows, mapping, detectedProfile, rowLineNumbers);
      setSuccess("Resolution automatique appliquee.");
    } catch (resolveError) {
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : "Impossible de resoudre automatiquement les inconnus."
      );
    } finally {
      setIsResolving(false);
    }
  }

  async function onCreateMissing() {
    if (!validation || !detectedProfile) return;
    if (unknownSuppliers.length === 0 && unknownProducts.length === 0) {
      setError("Aucun element manquant a creer.");
      return;
    }

    const suppliersCount = unknownSuppliers.length;
    const productsCount = unknownProducts.length;
    const confirmMessage = `Creer ${suppliersCount} fournisseur(s) et ${productsCount} produit(s) ?`;

    let shouldCreate = true;
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      try {
        shouldCreate = window.confirm(confirmMessage);
      } catch {
        shouldCreate = true;
      }
    }

    if (!shouldCreate) {
      return;
    }

    setIsCreatingMissing(true);
    setError(null);

    try {
      const result = await fetchApi<CreateMissingResponse>("/api/prices/import/create-missing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          suppliersToCreate: unknownSuppliers,
          productsToCreate: unknownProducts,
        }),
      });

      const refreshedLookups = await onLookupsUpdated?.();
      await runValidation(
        rows,
        mapping,
        detectedProfile,
        rowLineNumbers,
        refreshedLookups ?? undefined
      );

      setSuccess(
        `Creation assistee terminee: ${result.createdSuppliers.length} fournisseur(s), ${result.createdProducts.length} produit(s).`
      );
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Impossible de creer les elements manquants."
      );
    } finally {
      setIsCreatingMissing(false);
    }
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
          action: "bulk-create-atomic",
          items: validation.acceptedItems,
          batch_size: ATOMIC_BULK_BATCH_SIZE,
        }),
      });

      const duplicatesSkipped = Math.max(validation.acceptedRows - result.created_count, 0);

      setImportSummary({
        imported: result.created_count,
        ignored: validation.ignoredRowsCount,
        toFix: validation.rejectedRowsCount,
        duplicatesSkipped,
      });

      await onImported();

      setSuccess(
        `Import termine: ${result.created_count} ligne(s) importee(s), ${validation.ignoredRowsCount} ignoree(s), ${validation.rejectedRowsCount} a corriger, ${duplicatesSkipped} deja existante(s).`
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

  const onDownloadCorrectionsCsv = useCallback(() => {
    if (!validation || validation.rejectedRows.length === 0) {
      return;
    }

    const lines = [
      "line_number;error_code;error_message;raw_supplier;raw_product;raw_price;suggested_fix",
      ...validation.rejectedRows.map((row) =>
        [
          String(row.lineNumber),
          row.errorCode,
          row.reason,
          row.rawSupplier,
          row.rawProduct,
          row.rawPrice,
          row.suggestedFix ?? "",
        ]
          .map((value) => escapeCsvCell(value))
          .join(";")
      ),
    ];

    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "prix_import_corrections.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }, [validation]);

  const downloadCsvTemplate = useCallback(() => {
    const lines = [
      "fournisseur;reference_produit;prix_unitaire;devise",
      "CEDEO;TUBE-INOX-28;12.50;EUR",
      "ARCUS;CABLE-3G1.5;8.00;EUR",
    ];
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "modèle_prix_fournisseurs.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const autoMappedCount = Object.keys(mapping).length;

  return (
    <div className="p-6 space-y-4">
      <div className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {GUIDE_STEPS.map((step, index) => {
            const stepNumber = index + 1;
            const isActive = stepNumber === currentStep;
            const isDone = stepNumber < currentStep;

            return (
              <span
                key={step}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                  isDone
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : isActive
                      ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                      : "border-[var(--slate-200)] bg-[var(--slate-50)] text-[var(--slate-500)]"
                }`}
              >
                <span>{stepNumber}</span>
                <span>{step}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
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
              disabled={isParsing || isValidating || isSubmitting || isResolving || isCreatingMissing}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onAnalyzeFile()}
            disabled={!selectedFile || isParsing || isValidating || isSubmitting || isResolving || isCreatingMissing}
          >
            {isParsing ? "Analyse..." : "Analyser"}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              clearFileSelection();
              resetWorkflowState();
              setError(null);
            }}
            disabled={!selectedFile || isParsing || isValidating || isSubmitting || isResolving || isCreatingMissing}
          >
            Vider
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--slate-500)]">
          {selectedFile ? <p>{selectedFile.name}</p> : null}
          {detectedEncoding ? <p>Encodage: {detectedEncoding}</p> : null}
          {detectedProfile ? (
            <span className="rounded-full border border-[var(--brand-blue)] bg-[var(--brand-blue)]/10 px-2 py-0.5 text-[var(--brand-blue)]">
              {getProfileLabel(detectedProfile)}
            </span>
          ) : null}
          <button
            type="button"
            className="text-xs text-[var(--brand-blue)] underline hover:no-underline"
            onClick={downloadCsvTemplate}
          >
            Télécharger un modèle CSV
          </button>
        </div>
      </div>

      {showProgress ? (
        <div className="rounded-xl border border-[var(--slate-200)] bg-white p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-[var(--slate-800)]">
              {isParsing ? "Analyse du fichier en cours..." : "Validation des lignes en cours..."}
            </span>
            <span className="text-[var(--slate-500)]">
              {isParsing ? "Preparation..." : getProgressLabel(progress)}
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
        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">Etape 2 - Associer les colonnes</h3>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            {formatNumber(rows.length)} ligne(s) detectee(s), {autoMappedCount} colonne(s) associee(s)
            automatiquement.
          </p>

          <div className="mt-4">
            <ColumnMapper
              sourceColumns={sourceColumns}
              mapping={mapping}
              targetFields={TARGET_FIELDS}
              disabled={isParsing || isValidating || isSubmitting || isResolving || isCreatingMissing}
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
              disabled={!canValidate || isParsing || isValidating || isSubmitting || isResolving || isCreatingMissing}
            >
              {isValidating ? "Validation..." : "Mettre a jour l'apercu"}
            </button>
            <span className="text-xs text-[var(--slate-500)]">
              Champs requis : Fournisseur, Prix unitaire, et Reference ou Designation produit.
            </span>
          </div>
        </div>
      ) : null}

      {error ? <div className="alert alert-error">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      {canShowSummary && validation ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Total detecte</p>
              <p className="mt-1 text-base font-semibold text-[var(--slate-900)]">
                {formatNumber(validation.totalRows)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Importables</p>
              <p className="mt-1 text-base font-semibold text-[var(--success)]">
                {formatNumber(validation.acceptedRows)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
                Ignorees (hors perimetre)
              </p>
              <p className="mt-1 text-base font-semibold text-[var(--slate-700)]">
                {formatNumber(validation.ignoredRowsCount)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">A corriger</p>
              <p className="mt-1 text-base font-semibold text-[var(--danger)]">
                {formatNumber(validation.rejectedRowsCount)}
              </p>
            </div>
          </div>

          <section className="dashboard-card overflow-hidden">
            <div className="border-b border-[var(--slate-200)] px-6 py-4">
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">Etape 3 - Resoudre les inconnus</h3>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                Fournisseurs inconnus: {unknownSuppliers.length} | Produits inconnus: {unknownProducts.length}
              </p>
            </div>
            <div className="px-6 py-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void onResolveAutomatically()}
                disabled={isResolving || isCreatingMissing || isSubmitting || (!unknownSuppliers.length && !unknownProducts.length)}
              >
                {isResolving ? "Resolution..." : "Resoudre automatiquement"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void onCreateMissing()}
                disabled={isCreatingMissing || isResolving || isSubmitting || (!unknownSuppliers.length && !unknownProducts.length)}
              >
                {isCreatingMissing ? "Creation..." : "Creer les inconnus"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onDownloadCorrectionsCsv}
                disabled={validation.rejectedRowsCount === 0}
              >
                Exporter les corrections CSV
              </button>
            </div>
          </section>

          <section className="dashboard-card overflow-hidden">
            <div className="border-b border-[var(--slate-200)] px-6 py-4">
              <h3 className="text-sm font-semibold text-[var(--slate-800)]">Apercu - 10 premieres lignes</h3>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ligne</th>
                    <th>Fournisseur</th>
                    <th>Produit</th>
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
                    validation.previewRows.map((row) => {
                      const supplierCsv = row.values.supplier_name;
                      const productCsv = row.values.product_reference || row.values.product_designation;
                      const supplierResolved = row.resolved?.supplier_name;
                      const productResolved = row.resolved?.product_name;

                      const badgeClass =
                        row.status === "valid"
                          ? "status-badge status-confirmed"
                          : row.status === "ignored"
                            ? "status-badge"
                            : "status-badge status-canceled";

                      const badgeLabel =
                        row.status === "valid"
                          ? "Valide"
                          : row.status === "ignored"
                            ? "Ignoree (hors perimetre)"
                            : "A corriger";

                      return (
                        <tr key={`${row.lineNumber}-${row.values.unit_price}-${row.values.supplier_name}`}>
                          <td>{row.lineNumber}</td>
                          <td className="text-sm">
                            {supplierResolved ? (
                              <span className="text-[var(--slate-800)]">
                                {supplierResolved}
                                <span className="ml-1 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OK</span>
                                {row.metadata?.autofilledSupplier ? (
                                  <span className="ml-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Auto</span>
                                ) : null}
                              </span>
                            ) : supplierCsv ? (
                              <span className="text-[var(--danger)]">{supplierCsv}</span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="text-sm">
                            {productResolved ? (
                              <span className="text-[var(--slate-800)]">
                                {productResolved}
                                <span className="ml-1 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">OK</span>
                              </span>
                            ) : productCsv ? (
                              <span className="text-[var(--danger)]">{productCsv}</span>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td>{row.values.unit_price || "-"}</td>
                          <td>{row.values.currency || "EUR"}</td>
                          <td>
                            <span className={badgeClass}>{badgeLabel}</span>
                          </td>
                          <td className="text-sm text-[var(--slate-600)]">{row.reason ?? "-"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {validation.rejectedRowsCount > 0 ? (
            <section className="dashboard-card overflow-hidden">
              <div className="border-b border-[var(--slate-200)] px-6 py-4">
                <h3 className="text-sm font-semibold text-[var(--slate-800)]">Synthese des lignes a corriger</h3>
                <p className="mt-1 text-xs text-[var(--slate-500)]">Ligne + motif de correction.</p>
              </div>

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ligne</th>
                      <th>Code</th>
                      <th>Motif</th>
                      <th>Suggestion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.rejectedRows.slice(0, 200).map((row) => (
                      <tr key={`${row.lineNumber}-${row.errorCode}-${row.reason}`}>
                        <td>{row.lineNumber}</td>
                        <td>{row.errorCode}</td>
                        <td>{row.reason}</td>
                        <td>{row.suggestedFix ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {validation.rejectedRowsCount > 200 ? (
                <div className="border-t border-[var(--slate-200)] px-6 py-4 text-xs text-[var(--slate-500)]">
                  Liste tronquee aux 200 premieres lignes a corriger.
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
            <h3 className="text-sm font-semibold text-[var(--slate-800)]">Etape 4 - Importer</h3>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              Vous pouvez importer les lignes pretes maintenant, meme si des corrections restent a faire.
            </p>

            <div className="mt-4">
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => void onSubmitImport()}
                disabled={!canSubmit || isResolving || isCreatingMissing}
              >
                {isSubmitting ? "Import..." : "Importer les lignes pretes"}
              </button>
            </div>

            {importSummary ? (
              <div className="mt-3 text-xs text-[var(--slate-600)]">
                Importees: {formatNumber(importSummary.imported)} | Ignorees (hors perimetre): {formatNumber(importSummary.ignored)} | A corriger: {formatNumber(importSummary.toFix)} | Deja existantes: {formatNumber(importSummary.duplicatesSkipped)}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
