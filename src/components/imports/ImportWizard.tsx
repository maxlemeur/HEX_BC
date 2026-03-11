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
import { useImportFlow } from "@/hooks/useImportFlow";

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
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--slate-500)] hover:text-[var(--brand-blue)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {imports.length > 0
              ? `Voir l&apos;historique (${imports.length} import${imports.length > 1 ? "s" : ""})`
              : "Voir l&apos;historique"}
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      ) : null}

      {shouldShowHistory ? (
        <section className="animate-fade-in dashboard-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-[var(--slate-800)]">
                Historique
              </h2>
              {isPolling ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--info-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--info)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--info)]"></span>
                  Auto
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void refreshImports()}
                disabled={isLoadingImports || isRefreshing}
              >
                {isRefreshing ? "..." : "Actualiser"}
              </button>
              {showHistory ? (
                <button
                  type="button"
                  className="text-xs text-[var(--slate-400)] hover:text-[var(--slate-600)]"
                  onClick={() => setShowHistory(false)}
                >
                  Masquer
                </button>
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
            <div className="alert alert-error m-4">{loadError}</div>
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
