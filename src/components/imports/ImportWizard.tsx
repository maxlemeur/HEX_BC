"use client";

import { useRef, useState } from "react";

import { ImportHistoryFilters } from "@/components/imports/ImportHistoryFilters";
import { ImportHistoryTable } from "@/components/imports/ImportHistoryTable";
import { ImportWizardFileStageSection } from "@/components/imports/ImportWizardFileStageSection";
import { ImportSuccessCta } from "@/components/imports/ImportSuccessCta";
import {
  filterImports,
  type StatusFilter,
} from "@/components/imports/importWizardHistory";
import { useImportWizardFileStage } from "@/components/imports/useImportWizardFileStage";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useImportFlow } from "@/hooks/useImportFlow";
import { ChevronDownIcon, ClockIcon, RotateCwIcon } from "lucide-react";

export function ImportWizard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [copiedImportId, setCopiedImportId] = useState<string | null>(null);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const {
    imports,
    isLoadingImports,
    isRefreshing,
    isSubmitting,
    isPolling,
    loadError,
    submitError,
    workerError,
    modeMessage,
    lastMode,
    lastImportId,
    importFile,
    importReviewedPdfFile,
    reviewTabularPdfFile,
    refreshImports,
  } = useImportFlow();

  const {
    approvedPdfTables,
    clearSelectedFile,
    detectedHeaderRow,
    detectedHeaders,
    fileStage,
    formatError,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelection,
    handleFormSubmit,
    handleHeaderRowInputChange,
    handlePdfReviewSubmit,
    handleTogglePdfTable,
    headerRowError,
    headerRowInput,
    isDragOver,
    pdfReview,
    pdfReviewError,
    selectedFile,
  } = useImportWizardFileStage({
    fileInputRef,
    importFile,
    importReviewedPdfFile,
    isSubmitting,
    onImportStart: () => setDismissedSuccess(false),
    reviewTabularPdfFile,
  });

  async function handleCopyImportId(importId: string) {
    try {
      await navigator.clipboard.writeText(importId);
      setCopiedImportId(importId);
      window.setTimeout(() => {
        setCopiedImportId((current) => (current === importId ? null : current));
      }, 1500);
    } catch {
      // Ignore clipboard errors (permissions / unavailable API)
    }
  }

  const filteredImports = filterImports(imports, statusFilter, historySearch);
  const shouldShowHistory = showHistory || Boolean(loadError);
  const canAccessHistory = imports.length > 0 || Boolean(loadError);

  return (
    <div className="space-y-6">
      {lastImportId && !isSubmitting && !dismissedSuccess ? (
        <ImportSuccessCta
          importId={lastImportId}
          onDismiss={() => setDismissedSuccess(true)}
        />
      ) : (
        <ImportWizardFileStageSection
          approvedPdfTables={approvedPdfTables}
          clearSelectedFile={clearSelectedFile}
          detectedHeaderRow={detectedHeaderRow}
          detectedHeaders={detectedHeaders}
          fileInputRef={fileInputRef}
          fileStage={fileStage}
          formatError={formatError}
          handleDragLeave={handleDragLeave}
          handleDragOver={handleDragOver}
          handleDrop={handleDrop}
          handleFileSelection={handleFileSelection}
          handleFormSubmit={handleFormSubmit}
          handleHeaderRowInputChange={handleHeaderRowInputChange}
          handlePdfReviewSubmit={handlePdfReviewSubmit}
          handleTogglePdfTable={handleTogglePdfTable}
          headerRowError={headerRowError}
          headerRowInput={headerRowInput}
          isDragOver={isDragOver}
          isSubmitting={isSubmitting}
          lastMode={lastMode}
          modeMessage={modeMessage}
          pdfReview={pdfReview}
          pdfReviewError={pdfReviewError}
          selectedFile={selectedFile}
          submitError={submitError}
          workerError={workerError}
        />
      )}

      {canAccessHistory && !shouldShowHistory ? (
        <div className="text-center">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={false}
            aria-controls="import-history"
            onClick={() => setShowHistory(true)}
            leftIcon={<ClockIcon aria-hidden="true" strokeWidth={1.5} />}
            rightIcon={<ChevronDownIcon aria-hidden="true" />}
          >
            {imports.length > 0
              ? `Voir l’historique (${imports.length} import${imports.length > 1 ? "s" : ""})`
              : "Voir l’historique"}
          </Button>
        </div>
      ) : null}

      {shouldShowHistory ? (
        <section
          id="import-history"
          aria-labelledby="import-history-title"
          className="animate-fade-in min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <h2 id="import-history-title" className="text-sm font-semibold text-foreground">
                Historique
              </h2>
              {isPolling ? (
                <Badge variant="info" size="sm" dot>
                  <span className="sr-only">Actualisation </span>Auto
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="md"
                onClick={() => void refreshImports()}
                disabled={isLoadingImports || isRefreshing}
                leftIcon={
                  <RotateCwIcon
                    aria-hidden="true"
                    className={isRefreshing ? "animate-spin motion-reduce:animate-none" : undefined}
                  />
                }
              >
                Actualiser
              </Button>
              {showHistory ? (
                <Button
                  variant="ghost"
                  size="md"
                  aria-expanded
                  aria-controls="import-history"
                  onClick={() => setShowHistory(false)}
                >
                  Masquer
                </Button>
              ) : null}
            </div>
          </div>

          <ImportHistoryFilters
            historySearch={historySearch}
            onHistorySearchChange={setHistorySearch}
            onStatusFilterChange={setStatusFilter}
            statusFilter={statusFilter}
          />

          {loadError ? (
            <div className="px-4 pt-4 sm:px-6">
              <Alert variant="danger">{loadError}</Alert>
            </div>
          ) : null}

          <ImportHistoryTable
            copiedImportId={copiedImportId}
            isLoadingImports={isLoadingImports}
            items={filteredImports}
            onCopyImportId={handleCopyImportId}
          />
        </section>
      ) : null}
    </div>
  );
}
