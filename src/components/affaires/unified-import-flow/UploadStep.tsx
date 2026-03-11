"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TabularPdfReviewPanel } from "@/components/imports/TabularPdfReviewPanel";
import { useImportFlow, type TabularPdfReviewPayload } from "@/hooks/useImportFlow";

import {
  ACCEPTED_FILE_TYPES,
  TERMINAL_IMPORT_STATUSES,
  VALID_EXTENSIONS,
} from "./types";

type UploadStepProps = {
  projectId: string;
  onImportReady: (importId: string) => void;
};

function getFileExtension(name: string): string | null {
  const ext = name.split(".").pop()?.trim().toLowerCase();
  return ext && ext.length > 0 ? ext : null;
}

export function UploadStep({ projectId, onImportReady }: UploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isReviewingPdf, setIsReviewingPdf] = useState(false);
  const [pdfReview, setPdfReview] = useState<TabularPdfReviewPayload | null>(null);
  const [approvedPdfTables, setApprovedPdfTables] = useState<
    Array<{ sourcePage: number; tableIndex: number }>
  >([]);
  const pdfReviewRequestIdRef = useRef(0);

  const invalidatePendingPdfReview = useCallback(() => {
    pdfReviewRequestIdRef.current += 1;
    setIsReviewingPdf(false);
  }, []);

  const {
    imports,
    isSubmitting,
    uploadProgress,
    isPolling,
    submitError,
    lastImportId,
    importFile,
    importReviewedPdfFile,
    reviewTabularPdfFile,
  } = useImportFlow({ projectId });

  useEffect(() => {
    if (!lastImportId) {
      return;
    }

    const match = imports.find((item) => item.id === lastImportId);
    if (match && TERMINAL_IMPORT_STATUSES.has(match.status)) {
      onImportReady(lastImportId);
    }
  }, [imports, lastImportId, onImportReady]);

  const handleFileSelect = useCallback((file: File) => {
    invalidatePendingPdfReview();
    setFileError(null);
    setPdfReview(null);
    setApprovedPdfTables([]);

    const ext = getFileExtension(file.name);
    if (!ext || !VALID_EXTENSIONS.has(ext)) {
      setFileError(
        `Le format .${ext ?? "inconnu"} n'est pas supporte. Utilisez CSV, XLSX, XLS ou PDF.`,
      );
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    if (ext !== "pdf") {
      return;
    }

    const requestId = pdfReviewRequestIdRef.current;
    setIsReviewingPdf(true);
    void reviewTabularPdfFile(file)
      .then((review) => {
        if (pdfReviewRequestIdRef.current !== requestId) {
          return;
        }

        setPdfReview(review);
        setApprovedPdfTables(review.review.suggested_approved_tables);
      })
      .catch((error) => {
        if (pdfReviewRequestIdRef.current !== requestId) {
          return;
        }

        setFileError(
          error instanceof Error
            ? error.message
            : "Analyse du PDF tabulaire impossible.",
        );
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      })
      .finally(() => {
        if (pdfReviewRequestIdRef.current === requestId) {
          setIsReviewingPdf(false);
        }
      });
  }, [invalidatePendingPdfReview, reviewTabularPdfFile]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleSubmit = useCallback(async () => {
    if (!selectedFile || isSubmitting) {
      return;
    }

    const extension = getFileExtension(selectedFile.name);
    let success = false;

    if (extension === "pdf") {
      if (!pdfReview) {
        setFileError("Analyse PDF indisponible. Rechargez le fichier avant de continuer.");
        return;
      }
      if (approvedPdfTables.length === 0) {
        setFileError("Retenez au moins un tableau avant de rejoindre le mapping standard.");
        return;
      }

      success = await importReviewedPdfFile({
        file: selectedFile,
        pdfReview,
        approvedTables: approvedPdfTables,
      });
    } else {
      success = await importFile(selectedFile);
    }

    if (success) {
      setSelectedFile(null);
      setPdfReview(null);
      setApprovedPdfTables([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [
    approvedPdfTables,
    importFile,
    importReviewedPdfFile,
    isSubmitting,
    pdfReview,
    selectedFile,
  ]);

  const waitingForParse = Boolean(lastImportId) && !isSubmitting && isPolling;

  return (
    <div className="space-y-4">
      {waitingForParse ? (
        <div className="dashboard-card p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-blue)]/10">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--slate-800)]">
                Traitement en cours…
              </p>
              <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                Le serveur analyse votre fichier. Cela peut prendre quelques secondes.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="dashboard-card p-6">
          <div
            onDrop={handleDrop}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragOver
                ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
                : "border-[var(--slate-300)] bg-[var(--slate-50)] hover:border-[var(--slate-400)]"
            }`}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--slate-100)]">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--slate-400)"
                  strokeWidth="1.5"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m17 8-5-5-5 5" />
                  <path d="M12 3v12" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--slate-700)]">
                  Glissez-deposez votre fichier DPGF ici
                </p>
                <p className="mt-1 text-xs text-[var(--slate-500)]">
                  CSV, XLSX, XLS ou PDF tabulaire — ou cliquez pour parcourir
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  handleFileSelect(file);
                }
              }}
              disabled={isSubmitting}
            />
          </div>

          {selectedFile && !fileError && getFileExtension(selectedFile.name) !== "pdf" && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--slate-200)] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--slate-800)]">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-[var(--slate-500)]">
                  {(selectedFile.size / 1024).toFixed(1)} Ko
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    invalidatePendingPdfReview();
                    setSelectedFile(null);
                    setFileError(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  disabled={isSubmitting}
                >
                  Retirer
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleSubmit()}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Import…
                    </span>
                  ) : (
                    "Lancer l'import"
                  )}
                </button>
              </div>
            </div>
          )}

          {selectedFile && getFileExtension(selectedFile.name) === "pdf" && !fileError ? (
            isReviewingPdf ? (
              <div className="mt-4 rounded-lg border border-[var(--brand-blue)] bg-[var(--brand-blue)]/5 px-4 py-4">
                <div className="flex items-center gap-3 text-sm text-[var(--slate-700)]">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--brand-blue)]/30 border-t-[var(--brand-blue)]" />
                  Detection des tableaux puis validation explicite...
                </div>
              </div>
            ) : pdfReview ? (
              <div className="mt-4">
                <TabularPdfReviewPanel
                  fileName={selectedFile.name}
                  fileSizeLabel={`${(selectedFile.size / 1024).toFixed(1)} Ko`}
                  pdfReview={pdfReview}
                  approvedTables={approvedPdfTables}
                  onToggleTable={(table) => {
                    setFileError(null);
                    setApprovedPdfTables((current) => {
                      const alreadySelected = current.some(
                        (entry) =>
                          entry.sourcePage === table.sourcePage &&
                          entry.tableIndex === table.tableIndex,
                      );
                      if (alreadySelected) {
                        return current.filter(
                          (entry) =>
                            !(
                              entry.sourcePage === table.sourcePage &&
                              entry.tableIndex === table.tableIndex
                            ),
                        );
                      }

                      return [...current, table];
                    });
                  }}
                  onClearFile={() => {
                    invalidatePendingPdfReview();
                    setSelectedFile(null);
                    setPdfReview(null);
                    setApprovedPdfTables([]);
                    setFileError(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  onSubmit={() => void handleSubmit()}
                  isSubmitting={isSubmitting}
                />
              </div>
            ) : null
          ) : null}
        </div>
      )}

      {fileError && <div className="alert alert-error">{fileError}</div>}
      {submitError && <div className="alert alert-error">{submitError}</div>}

      {isSubmitting && (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--slate-200)]">
            {uploadProgress !== null ? (
              <div
                className="h-full rounded-full bg-[var(--brand-blue)] transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            ) : (
              <div
                className="h-full rounded-full bg-[var(--brand-blue)]"
                style={{
                  width: "100%",
                  animation: "uif-indeterminate 1.5s ease-in-out infinite",
                }}
              />
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--slate-500)]">
            {uploadProgress !== null
              ? `Envoi en cours… ${uploadProgress}%`
              : "Envoi et traitement en cours…"}
          </p>
          {uploadProgress === null && (
            <style>{`@keyframes uif-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
          )}
        </div>
      )}
    </div>
  );
}
