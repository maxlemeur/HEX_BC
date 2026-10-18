"use client";

import { PriceBookImportStep } from "@/components/catalogue/price-book-csv-import/PriceBookImportStep";
import { PriceBookPreviewTable } from "@/components/catalogue/price-book-csv-import/PriceBookPreviewTable";
import { PriceBookRejectedRowsTable } from "@/components/catalogue/price-book-csv-import/PriceBookRejectedRowsTable";
import { PriceBookSummaryCards } from "@/components/catalogue/price-book-csv-import/PriceBookSummaryCards";
import { PriceBookUploadStep } from "@/components/catalogue/price-book-csv-import/PriceBookUploadStep";
import type { PriceBookCsvImportProps } from "@/components/catalogue/price-book-csv-import/types";
import { UnknownResolutionPanel } from "@/components/catalogue/price-book-csv-import/UnknownResolutionPanel";
import { usePriceBookCsvWorkflow } from "@/components/catalogue/price-book-csv-import/usePriceBookCsvWorkflow";
import { Alert } from "@/components/ui/alert";

export function PriceBookCsvImport(props: Readonly<PriceBookCsvImportProps>) {
  const workflow = usePriceBookCsvWorkflow(props);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PriceBookUploadStep
        fileInputRef={workflow.fileInputRef}
        selectedFile={workflow.selectedFile}
        sourceImportId={workflow.sourceImportId}
        detectedEncoding={workflow.detectedEncoding}
        detectedProfile={workflow.detectedProfile}
        currentStep={workflow.currentStep}
        showProgress={workflow.showProgress}
        progress={workflow.progress}
        hasRows={workflow.hasRows}
        rowsCount={workflow.rows.length}
        autoMappedCount={workflow.autoMappedCount}
        sourceColumns={workflow.sourceColumns}
        mapping={workflow.mapping}
        canValidate={workflow.canValidate}
        isBusy={workflow.actionState.isBusy}
        isParsing={workflow.actionState.isParsing}
        isValidating={workflow.actionState.isValidating}
        lookupsStatus={workflow.actionState.lookupsStatus}
        onRetryLookups={props.onRetryLookups}
        onFileChange={workflow.setSelectedFile}
        onAnalyzeFile={workflow.analyzeFile}
        onClearSelection={workflow.clearSelection}
        onMappingChange={workflow.setMapping}
        onRefreshPreview={workflow.refreshPreview}
        onDownloadCsvTemplate={workflow.downloadCsvTemplate}
      />

      {workflow.error ? <Alert variant="danger">{workflow.error}</Alert> : null}
      {workflow.success ? <Alert variant="success">{workflow.success}</Alert> : null}

      {workflow.canShowSummary && workflow.validation ? (
        <div className="space-y-4">
          <PriceBookSummaryCards validation={workflow.validation} />
          <UnknownResolutionPanel
            unknownSuppliersCount={workflow.unknownSuppliers.length}
            unknownProductsCount={workflow.unknownProducts.length}
            rejectedRowsCount={workflow.validation.rejectedRowsCount}
            isResolving={workflow.actionState.isResolving}
            isCreatingMissing={workflow.actionState.isCreatingMissing}
            isSubmitting={workflow.actionState.isSubmitting}
            areLookupsReady={workflow.actionState.lookupsStatus === "ready"}
            onResolveAutomatically={workflow.resolveAutomatically}
            onCreateMissing={workflow.createMissing}
            onDownloadCorrectionsCsv={workflow.downloadCorrectionsCsv}
          />
          <PriceBookPreviewTable validation={workflow.validation} />
          <PriceBookRejectedRowsTable validation={workflow.validation} />
          <PriceBookImportStep
            canSubmit={workflow.canSubmit}
            isSubmitting={workflow.actionState.isSubmitting}
            isResolving={workflow.actionState.isResolving}
            isCreatingMissing={workflow.actionState.isCreatingMissing}
            importSummary={workflow.importSummary}
            onSubmitImport={workflow.submitImport}
          />
        </div>
      ) : null}
    </div>
  );
}
