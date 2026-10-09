"use client";

import type { RefObject } from "react";

import { ColumnMapper } from "@/components/mappings/ColumnMapper";
import type { PriceBookColumnMapping, PriceBookProfile } from "@/lib/catalogue/csv-import";
import type { PriceBookValidationProgress } from "@/lib/catalogue/csv-import";

import {
  ACCEPTED_FILE_TYPES,
  getProfileLabel,
  getProgressLabel,
  GUIDE_STEPS,
  TARGET_FIELDS,
  formatNumber,
} from "@/components/catalogue/price-book-csv-import/utils";

type PriceBookUploadStepProps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  selectedFile: File | null;
  sourceImportId: string | null;
  detectedEncoding: string | null;
  detectedProfile: PriceBookProfile | null;
  currentStep: number;
  showProgress: boolean;
  progress: PriceBookValidationProgress | null;
  hasRows: boolean;
  rowsCount: number;
  autoMappedCount: number;
  sourceColumns: string[];
  mapping: PriceBookColumnMapping;
  canValidate: boolean;
  isBusy: boolean;
  isParsing: boolean;
  isValidating: boolean;
  onFileChange: (file: File | null) => void;
  onAnalyzeFile: () => Promise<void>;
  onClearSelection: () => void;
  onMappingChange: (nextMapping: PriceBookColumnMapping) => void;
  onRefreshPreview: () => Promise<void>;
  onDownloadCsvTemplate: () => void;
};

export function PriceBookUploadStep({
  fileInputRef,
  selectedFile,
  sourceImportId,
  detectedEncoding,
  detectedProfile,
  currentStep,
  showProgress,
  progress,
  hasRows,
  rowsCount,
  autoMappedCount,
  sourceColumns,
  mapping,
  canValidate,
  isBusy,
  isParsing,
  isValidating,
  onFileChange,
  onAnalyzeFile,
  onClearSelection,
  onMappingChange,
  onRefreshPreview,
  onDownloadCsvTemplate,
}: Readonly<PriceBookUploadStepProps>) {
  return (
    <>
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
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
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-surface-subtle text-muted-foreground"
                }`}
              >
                <span>{stepNumber}</span>
                <span>{step}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface-subtle p-4">
        <h3 className="text-sm font-semibold text-slate-800">Étape 1 - Charger le CSV</h3>
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
                onFileChange(event.target.files?.[0] ?? null);
              }}
              disabled={isBusy}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onAnalyzeFile()}
            disabled={!selectedFile || isBusy}
          >
            {isParsing ? "Analyse..." : "Analyser"}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClearSelection}
            disabled={!selectedFile || isBusy}
          >
            Vider
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {selectedFile ? <p>{selectedFile.name}</p> : null}
          {sourceImportId ? (
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700">
              Trace canonique liée
            </span>
          ) : null}
          {detectedEncoding ? <p>Encodage: {detectedEncoding}</p> : null}
          {detectedProfile ? (
            <span className="rounded-full border border-primary bg-primary/10 px-2 py-0.5 text-primary">
              {getProfileLabel(detectedProfile)}
            </span>
          ) : null}
          <button
            type="button"
            className="text-xs text-primary underline hover:no-underline"
            onClick={onDownloadCsvTemplate}
          >
            Télécharger un modèle CSV
          </button>
        </div>
      </div>

      {showProgress ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-slate-800">
              {isParsing ? "Analyse du fichier en cours..." : "Validation des lignes en cours..."}
            </span>
            <span className="text-muted-foreground">
              {isParsing ? "Preparation..." : getProgressLabel(progress)}
            </span>
          </div>

          <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
            <div
              className={`h-2 rounded-full bg-primary ${isParsing ? "animate-pulse" : ""}`}
              style={{ width: isParsing ? "100%" : `${progress?.percentage ?? 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {hasRows ? (
        <div className="rounded-xl border border-border bg-surface-subtle p-4">
          <h3 className="text-sm font-semibold text-slate-800">Étape 2 - Associer les colonnes</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatNumber(rowsCount)} ligne(s) détectée(s), {autoMappedCount} colonne(s) associée(s)
            automatiquement.
          </p>

          <div className="mt-4">
            <ColumnMapper
              sourceColumns={sourceColumns}
              mapping={mapping}
              targetFields={TARGET_FIELDS}
              disabled={isBusy}
              onChange={(nextMapping) => {
                onMappingChange(nextMapping as PriceBookColumnMapping);
              }}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void onRefreshPreview()}
              disabled={!canValidate || isBusy}
            >
              {isValidating ? "Validation..." : "Mettre à jour l'aperçu"}
            </button>
            <span className="text-xs text-muted-foreground">
              Champs requis : Fournisseur, Prix unitaire, et Référence ou Designation produit.
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
