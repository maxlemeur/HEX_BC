"use client";

import type { RefObject } from "react";

import { LoadingState } from "@/components/layout/loading-state";
import { ColumnMapper } from "@/components/mappings/ColumnMapper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { controlSurface } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
  isLookupsLoading: boolean;
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
  isLookupsLoading,
  onFileChange,
  onAnalyzeFile,
  onClearSelection,
  onMappingChange,
  onRefreshPreview,
  onDownloadCsvTemplate,
}: Readonly<PriceBookUploadStepProps>) {
  return (
    <>
      <ol
        aria-label="Étapes de l’import"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3"
      >
        {GUIDE_STEPS.map((step, index) => {
          const stepNumber = index + 1;
          const isActive = stepNumber === currentStep;
          const isDone = stepNumber < currentStep;

          return (
            <li
              key={step}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
                isDone
                  ? "border-success-border bg-success-subtle text-success"
                  : isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface-subtle text-muted-foreground"
              )}
            >
              <span aria-hidden="true">{stepNumber}</span>
              <span>{step}</span>
              {isDone ? <span className="sr-only"> (terminée)</span> : null}
            </li>
          );
        })}
      </ol>

      <div className="rounded-lg border border-border bg-surface-subtle p-4">
        <h3 className="text-sm font-semibold text-foreground">Étape 1 — Charger le CSV</h3>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="price-book-csv-input">Fichier CSV</FieldLabel>
            <input
              ref={fileInputRef}
              id="price-book-csv-input"
              className={cn(
                controlSurface,
                "w-full px-3 py-2.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
              )}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              onChange={(event) => {
                onFileChange(event.target.files?.[0] ?? null);
              }}
              disabled={isBusy}
            />
          </div>

          <Button
            size="lg"
            onClick={() => void onAnalyzeFile()}
            disabled={!selectedFile || isBusy || isLookupsLoading}
            loading={isParsing}
          >
            Analyser
          </Button>

          <Button
            variant="outline"
            size="lg"
            onClick={onClearSelection}
            disabled={!selectedFile || isBusy}
          >
            Vider
          </Button>
        </div>

        {isLookupsLoading ? (
          <LoadingState
            label="Chargement des référentiels pour l’import…"
            className="mt-2 justify-start py-0 text-xs"
          />
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {selectedFile ? <p className="min-w-0 break-all">{selectedFile.name}</p> : null}
          {sourceImportId ? (
            <Badge variant="success" size="sm">
              Trace canonique liée
            </Badge>
          ) : null}
          {detectedEncoding ? <p>Encodage : {detectedEncoding}</p> : null}
          {detectedProfile ? (
            <Badge variant="brand" size="sm">
              {getProfileLabel(detectedProfile)}
            </Badge>
          ) : null}
          <Button variant="link" size="xs" className="text-xs underline" onClick={onDownloadCsvTemplate}>
            Télécharger un modèle CSV
          </Button>
        </div>
      </div>

      {showProgress ? (
        <div className="rounded-lg border border-border bg-surface p-4" role="status">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="font-medium text-foreground">
              {isParsing ? "Analyse du fichier en cours…" : "Validation des lignes en cours…"}
            </span>
            <span className="text-muted-foreground">
              {isParsing ? "Préparation…" : getProgressLabel(progress)}
            </span>
          </div>

          <div className="mt-3 h-2 w-full rounded-full bg-muted">
            <div
              className={cn(
                "h-2 rounded-full bg-primary",
                isParsing && "animate-pulse motion-reduce:animate-none"
              )}
              style={{ width: isParsing ? "100%" : `${progress?.percentage ?? 0}%` }}
            />
          </div>
        </div>
      ) : null}

      {hasRows ? (
        <div className="rounded-lg border border-border bg-surface-subtle p-4">
          <h3 className="text-sm font-semibold text-foreground">Étape 2 — Associer les colonnes</h3>
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
            <Button
              variant="outline"
              size="lg"
              onClick={() => void onRefreshPreview()}
              disabled={!canValidate || isBusy || isLookupsLoading}
              loading={isValidating}
            >
              Mettre à jour l’aperçu
            </Button>
            <span className="text-xs text-muted-foreground">
              Champs requis : Fournisseur, Prix unitaire, et Référence ou Désignation produit.
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
