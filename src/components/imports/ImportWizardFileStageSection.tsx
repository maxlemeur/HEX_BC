"use client";

import type { RefObject } from "react";

import { TabularPdfReviewPanel } from "@/components/imports/TabularPdfReviewPanel";
import { IMPORT_WIZARD_ACCEPTED_FILE_TYPES } from "@/components/imports/importWizardFileScan";
import type { ApprovedPdfTable, TabularPdfReviewPayload } from "@/hooks/useImportFlow";
import type { FileStage } from "@/components/imports/useImportWizardFileStage";

type ImportWizardFileStageSectionProps = {
  approvedPdfTables: ApprovedPdfTable[];
  clearSelectedFile: () => void;
  detectedHeaderRow: number | null;
  detectedHeaders: string[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  fileStage: FileStage;
  formatError: string | null;
  handleDragLeave: () => void;
  handleDragOver: (event: React.DragEvent) => void;
  handleDrop: (event: React.DragEvent) => void;
  handleFileSelection: (file: File | null) => void;
  handleFormSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  handleHeaderRowInputChange: (value: string) => void;
  handlePdfReviewSubmit: () => Promise<void>;
  handleTogglePdfTable: (table: ApprovedPdfTable) => void;
  headerRowError: string | null;
  headerRowInput: string;
  isDragOver: boolean;
  isSubmitting: boolean;
  lastMode: "worker" | "server" | "unknown" | null;
  modeMessage: string | null;
  pdfReview: TabularPdfReviewPayload | null;
  pdfReviewError: string | null;
  selectedFile: File | null;
  submitError: string | null;
  workerError: string | null;
};

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} Ko`;

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}

export function ImportWizardFileStageSection({
  approvedPdfTables,
  clearSelectedFile,
  detectedHeaderRow,
  detectedHeaders,
  fileInputRef,
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
  isSubmitting,
  lastMode,
  modeMessage,
  pdfReview,
  pdfReviewError,
  selectedFile,
  submitError,
  workerError,
}: ImportWizardFileStageSectionProps) {
  return (
    <section className="dashboard-card p-6">
      <form onSubmit={(event) => void handleFormSubmit(event)} className="space-y-4">
        {fileStage === "idle" && (
          <>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`
                relative rounded-xl border-2 border-dashed p-8 text-center transition-colors
                ${isDragOver
                  ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
                  : "border-[var(--slate-300)] bg-[var(--slate-50)] hover:border-[var(--slate-400)]"
                }
              `}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--slate-100)]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--slate-400)" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="m17 8-5-5-5 5" />
                    <path d="M12 3v12" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--slate-700)]">
                    Glissez-déposez votre fichier ici
                  </p>
                  <p className="mt-1 text-xs text-[var(--slate-500)]">
                    ou cliquez pour parcourir
                  </p>
                </div>
              </div>
              <input
                id="import-file-input"
                ref={fileInputRef}
                type="file"
                accept={IMPORT_WIZARD_ACCEPTED_FILE_TYPES}
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => {
                  handleFileSelection(event.target.files?.[0] ?? null);
                }}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[var(--slate-500)]">
                Taille maximale : 50 Mo.
              </p>
              <p className="text-xs text-[var(--slate-500)]">
                Besoin d&apos;aide ?{" "}
                <a
                  href="/exemple-dpgf.xlsx"
                  download
                  className="font-medium text-[var(--brand-blue)] underline hover:text-[var(--brand-blue-dark)]"
                >
                  Télécharger un fichier exemple
                </a>
              </p>
            </div>
          </>
        )}

        {fileStage === "validating" && selectedFile && (
          <div className="animate-fade-in rounded-xl border-2 border-[var(--slate-300)] bg-[var(--slate-50)] p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--slate-100)]">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--slate-300)] border-t-[var(--brand-blue)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--slate-800)]">
                  {selectedFile.name}
                </p>
                <p className="mt-0.5 text-xs text-[var(--brand-blue)]">
                  Validation du format...
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearSelectedFile}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {fileStage === "scanning" && selectedFile && (
          <div className="animate-fade-in rounded-xl border-2 border-[var(--brand-blue)] bg-[var(--brand-blue)]/5 p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--success)]/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--slate-800)]">
                  {selectedFile.name}
                  <span className="ml-2 text-xs font-normal text-[var(--success)]">Format valide</span>
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-[var(--brand-blue)]">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)]" />
                  Analyse de la structure du fichier...
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearSelectedFile}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {fileStage === "reviewing_pdf" && selectedFile && (
          <div className="animate-fade-in rounded-xl border-2 border-[var(--brand-blue)] bg-[var(--brand-blue)]/5 p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-blue)]/10">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--slate-800)]">
                  {selectedFile.name}
                </p>
                <p className="mt-0.5 text-xs text-[var(--brand-blue)]">
                  Detection des tableaux puis validation explicite...
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearSelectedFile}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {fileStage === "invalid" && selectedFile && (
          <div className="animate-fade-in rounded-xl border-2 border-[var(--error)] bg-[var(--error)]/5 p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--error)]/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="m15 9-6 6" />
                  <path d="m9 9 6 6" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--slate-800)]">
                  {selectedFile.name}
                </p>
                <p className="mt-0.5 text-xs text-[var(--error)]">
                  {pdfReviewError ?? formatError}
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearSelectedFile}>
                Choisir un autre fichier
              </button>
            </div>
          </div>
        )}

        {fileStage === "pdf_review" && selectedFile && pdfReview && (
          <TabularPdfReviewPanel
            fileName={selectedFile.name}
            fileSizeLabel={formatSize(selectedFile.size)}
            pdfReview={pdfReview}
            approvedTables={approvedPdfTables}
            onToggleTable={handleTogglePdfTable}
            onClearFile={clearSelectedFile}
            onSubmit={() => void handlePdfReviewSubmit()}
            isSubmitting={isSubmitting}
          />
        )}

        {fileStage === "ready" && selectedFile && (
          <div className="animate-fade-in rounded-xl border-2 border-[var(--success)] bg-[var(--success)]/5 p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--success)]/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--slate-800)]">
                  {selectedFile.name}
                  <span className="ml-2 text-xs font-normal text-[var(--slate-500)]">
                    {formatSize(selectedFile.size)}
                  </span>
                </p>
                {detectedHeaders.length > 0 ? (
                  <p className="mt-0.5 text-xs text-[var(--success)]">
                    En-tête détectée
                    {detectedHeaderRow && detectedHeaderRow > 1
                      ? ` (ligne ${detectedHeaderRow})`
                      : ""}
                    {" "}— {detectedHeaders.length} colonnes trouvées
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-[var(--success)]">
                    Fichier prêt pour l&apos;import
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" className="btn btn-secondary btn-sm" disabled={isSubmitting} onClick={clearSelectedFile}>
                  Retirer
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Import en cours...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Lancer l&apos;import
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </span>
                  )}
                </button>
              </div>
            </div>

            {detectedHeaders.length > 0 ? (
              <div className="mt-3 border-t border-[var(--success)]/15 pt-3">
                <p className="mb-2 text-xs font-medium text-[var(--slate-600)]">
                  Colonnes détectées :
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {detectedHeaders.slice(0, 12).map((header) => (
                    <span
                      key={header}
                      className="inline-block rounded-md bg-[var(--slate-100)] px-2 py-0.5 text-xs text-[var(--slate-700)]"
                    >
                      {header}
                    </span>
                  ))}
                  {detectedHeaders.length > 12 ? (
                    <span className="inline-block rounded-md bg-[var(--slate-100)] px-2 py-0.5 text-xs text-[var(--slate-500)]">
                      +{detectedHeaders.length - 12} autres
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {fileStage === "header_needed" && selectedFile && (
          <div className="animate-fade-in rounded-xl border-2 border-[var(--warning)] bg-[var(--warning)]/5 p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--warning)]/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  <line x1="12" x2="12" y1="9" y2="13" />
                  <line x1="12" x2="12.01" y1="17" y2="17" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--slate-800)]">
                  {selectedFile.name}
                  <span className="ml-2 text-xs font-normal text-[var(--slate-500)]">
                    {formatSize(selectedFile.size)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-[var(--warning-dark,var(--warning))]">
                  En-tête non détectée automatiquement
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearSelectedFile}>
                Retirer
              </button>
            </div>

            <div className="mt-3 border-t border-[var(--warning)]/15 pt-3">
              <p className="mb-2 text-xs text-[var(--slate-600)]">
                Indiquez le numéro de la ligne contenant les noms de colonnes, ou laissez vide pour laisser le serveur détecter.
              </p>
              <div className="flex items-end gap-3">
                <div className="max-w-[120px]">
                  <label htmlFor="header-row-input" className="mb-1 block text-xs font-medium text-[var(--slate-700)]">
                    Ligne d&apos;en-tête
                  </label>
                  <input
                    id="header-row-input"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={headerRowInput}
                    onChange={(event) => {
                      handleHeaderRowInputChange(event.target.value);
                    }}
                    placeholder="Ex: 3"
                    disabled={isSubmitting}
                    className="form-input form-input--sm"
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Import en cours...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Lancer l&apos;import
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </form>

      {isSubmitting ? (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--slate-200)]">
            <div className="h-full rounded-full bg-[var(--brand-blue)] transition-all duration-1000" style={{ width: "100%", animation: "indeterminate 1.5s ease-in-out infinite" }} />
          </div>
          <p className="mt-2 text-xs text-[var(--slate-500)]">Envoi et traitement en cours...</p>
          <style>{`@keyframes indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
        </div>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {modeMessage ?? ""}
      </div>

      {modeMessage ? (
        <div className={`alert mt-4 ${lastMode === "worker" ? "alert-success" : "alert-info"}`}>
          {modeMessage}
        </div>
      ) : null}

      {workerError ? (
        <div className="alert alert-info mt-3">
          Échec du traitement navigateur : {workerError}
        </div>
      ) : null}

      {submitError ? (
        <div className="alert alert-error mt-3">{submitError}</div>
      ) : null}

      {pdfReviewError ? (
        <div className="alert alert-error mt-3">{pdfReviewError}</div>
      ) : null}

      {headerRowError ? (
        <div className="alert alert-error mt-3">{headerRowError}</div>
      ) : null}
    </section>
  );
}
