"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
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
  type PriceBookValidationResult,
} from "@/lib/catalogue/csv-import";

import type {
  BulkCreatePricesResponse,
  CreateMissingResponse,
  ImportSummary,
  PriceBookCsvImportProps,
  ResolveImportResponse,
  UsePriceBookCsvWorkflowResult,
} from "@/components/catalogue/price-book-csv-import/types";
import {
  ATOMIC_BULK_BATCH_SIZE,
  applyAutomaticResolutions,
  buildUniqueValues,
  createCanonicalPriceImport,
  downloadBlob,
  escapeCsvCell,
  isCsvFile,
  resolveCurrentStep,
} from "@/components/catalogue/price-book-csv-import/utils";

export function usePriceBookCsvWorkflow({
  onImported,
  onLookupsUpdated,
  lookups,
}: PriceBookCsvImportProps): UsePriceBookCsvWorkflowResult {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { parseFile } = useFileParser();

  const [selectedFile, setSelectedFileState] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [rowLineNumbers, setRowLineNumbers] = useState<number[]>([]);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [mapping, setMappingState] = useState<PriceBookColumnMapping>({});
  const [validation, setValidation] = useState<PriceBookValidationResult | null>(null);
  const [detectedProfile, setDetectedProfile] = useState<PriceBookProfile | null>(null);
  const [detectedEncoding, setDetectedEncoding] = useState<string | null>(null);
  const [sourceImportId, setSourceImportId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  const [isParsing, setIsParsing] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isCreatingMissing, setIsCreatingMissing] = useState(false);

  const [progress, setProgress] = useState<UsePriceBookCsvWorkflowResult["progress"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasRows = rows.length > 0;
  const canValidate = hasRows && hasMinimumPriceBookMapping(mapping);
  const canSubmit =
    !!validation &&
    validation.acceptedRows > 0 &&
    !!sourceImportId &&
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
  const autoMappedCount = Object.keys(mapping).length;

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

  const actionState = useMemo(
    () => ({
      isBusy: isParsing || isValidating || isSubmitting || isResolving || isCreatingMissing,
      isParsing,
      isValidating,
      isSubmitting,
      isResolving,
      isCreatingMissing,
    }),
    [isCreatingMissing, isParsing, isResolving, isSubmitting, isValidating]
  );

  const resetWorkflowState = useCallback(() => {
    setRows([]);
    setRowLineNumbers([]);
    setSourceColumns([]);
    setMappingState({});
    setValidation(null);
    setProgress(null);
    setSuccess(null);
    setDetectedProfile(null);
    setDetectedEncoding(null);
    setSourceImportId(null);
    setImportSummary(null);
  }, []);

  const clearNativeFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const setSelectedFile = useCallback(
    (file: File | null) => {
      setSelectedFileState(file);
      resetWorkflowState();
      setError(null);
    },
    [resetWorkflowState]
  );

  const clearSelection = useCallback(() => {
    setSelectedFileState(null);
    clearNativeFileInput();
    resetWorkflowState();
    setError(null);
  }, [clearNativeFileInput, resetWorkflowState]);

  const runValidation = useCallback(
    async (
      nextRows: ParsedImportRow[],
      nextMapping: PriceBookColumnMapping,
      nextProfile: PriceBookProfile,
      nextRowLineNumbers?: number[],
      nextLookups?: PriceBookLookups,
      nextSourceImportId?: string | null
    ) => {
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
          sourceImportId: nextSourceImportId ?? sourceImportId,
          onProgress: (nextProgress) => {
            setProgress(nextProgress);
          },
        });

        setValidation(result);
      } finally {
        setIsValidating(false);
      }
    },
    [lookups, sourceImportId]
  );

  const analyzeFile = useCallback(async () => {
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
        throw new Error("Le fichier CSV ne contient aucune ligne de données.");
      }

      const nextRowLineNumbers = parsed.rowLineNumbers;
      const nextSourceColumns = extractPriceBookSourceColumns(nextRows);
      if (nextSourceColumns.length === 0) {
        throw new Error("Aucune colonne exploitable n'a ete detectee.");
      }

      const importRecord = sourceImportId
        ? { id: sourceImportId, filename: selectedFile.name, project_id: null }
        : await createCanonicalPriceImport(selectedFile);

      const nextProfile = detectPriceBookProfile(nextSourceColumns);
      const nextMapping = suggestPriceBookColumnMappingForProfile(nextSourceColumns, nextProfile);

      setRows(nextRows);
      setRowLineNumbers(nextRowLineNumbers ?? []);
      setSourceColumns(nextSourceColumns);
      setDetectedProfile(nextProfile);
      setDetectedEncoding(parsed.detectedEncoding ?? null);
      setSourceImportId(importRecord.id);
      setMappingState(nextMapping);

      await runValidation(
        nextRows,
        nextMapping,
        nextProfile,
        nextRowLineNumbers,
        undefined,
        importRecord.id
      );
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Impossible d'analyser le fichier CSV."
      );
    } finally {
      setIsParsing(false);
    }
  }, [parseFile, runValidation, selectedFile, sourceImportId]);

  const refreshPreview = useCallback(async () => {
    if (!canValidate) {
      setError(
        "Le mapping minimal est incomplet : Fournisseur, Prix unitaire et Référence ou Désignation produit."
      );
      return;
    }

    if (!detectedProfile) {
      setError("Le profil du fichier n'a pas ete detecte.");
      return;
    }

    if (!sourceImportId) {
      setError("Le fichier source n'est pas encore rattache au pipeline canonique.");
      return;
    }

    setError(null);
    await runValidation(rows, mapping, detectedProfile, rowLineNumbers);
  }, [canValidate, detectedProfile, mapping, rowLineNumbers, rows, runValidation, sourceImportId]);

  const resolveAutomatically = useCallback(async () => {
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

      const nextRows = applyAutomaticResolutions({
        rows,
        detectedProfile,
        mapping,
        supplierReplacements,
        productReplacements,
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
  }, [
    detectedProfile,
    mapping,
    rowLineNumbers,
    rows,
    runValidation,
    unknownProducts,
    unknownSuppliers,
    validation,
  ]);

  const createMissing = useCallback(async () => {
    if (!validation || !detectedProfile) return;
    if (unknownSuppliers.length === 0 && unknownProducts.length === 0) {
      setError("Aucun élément manquant à créer.");
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
          : "Impossible de créer les éléments manquants."
      );
    } finally {
      setIsCreatingMissing(false);
    }
  }, [
    detectedProfile,
    mapping,
    onLookupsUpdated,
    rowLineNumbers,
    rows,
    runValidation,
    unknownProducts,
    unknownSuppliers,
    validation,
  ]);

  const submitImport = useCallback(async () => {
    if (!validation || validation.acceptedRows === 0) {
      setError("Aucune ligne valide a importer.");
      return;
    }

    if (!sourceImportId) {
      setError("Le fichier source n'est pas encore rattache au pipeline canonique.");
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
  }, [onImported, sourceImportId, validation]);

  const downloadCorrectionsCsv = useCallback(() => {
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

    downloadBlob(
      `${lines.join("\n")}\n`,
      "prix_import_corrections.csv",
      "text/csv;charset=utf-8"
    );
  }, [validation]);

  const downloadCsvTemplate = useCallback(() => {
    const lines = [
      "fournisseur;reference_produit;prix_unitaire;devise",
      "CEDEO;TUBE-INOX-28;12.50;EUR",
      "ARCUS;CABLE-3G1.5;8.00;EUR",
    ];

    downloadBlob(
      `${lines.join("\n")}\n`,
      "modèle_prix_fournisseurs.csv",
      "text/csv;charset=utf-8"
    );
  }, []);

  return {
    fileInputRef,
    selectedFile,
    rows,
    sourceColumns,
    mapping,
    validation,
    detectedProfile,
    detectedEncoding,
    sourceImportId,
    importSummary,
    progress,
    error,
    success,
    hasRows,
    canValidate,
    canSubmit,
    showProgress,
    canShowSummary,
    currentStep,
    autoMappedCount,
    unknownSuppliers,
    unknownProducts,
    actionState,
    setSelectedFile,
    setMapping: setMappingState,
    analyzeFile,
    refreshPreview,
    resolveAutomatically,
    createMissing,
    submitImport,
    clearSelection,
    downloadCorrectionsCsv,
    downloadCsvTemplate,
  };
}
