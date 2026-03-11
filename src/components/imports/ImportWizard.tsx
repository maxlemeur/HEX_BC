"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { TabularPdfReviewPanel } from "@/components/imports/TabularPdfReviewPanel";
import {
  useImportFlow,
  type ImportListItem,
  type TabularPdfReviewPayload,
} from "@/hooks/useImportFlow";

const ACCEPTED_FILE_TYPES = ".csv,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const VALID_EXTENSIONS = new Set(["csv", "xlsx", "xls", "pdf"]);

type FileStage =
  | "idle"
  | "validating"
  | "scanning"
  | "reviewing_pdf"
  | "pdf_review"
  | "invalid"
  | "ready"
  | "header_needed";

function formatDate(value: string | null): string {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatRowsCount(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} Ko`;

  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "En attente";
    case "parsing":
    case "processing":
      return "En cours";
    case "parsed":
    case "imported":
    case "completed":
      return "Termine";
    case "failed":
      return "Echec";
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "pending":
      return "status-badge status-draft";
    case "parsing":
    case "processing":
      return "status-badge status-sent";
    case "parsed":
    case "imported":
    case "completed":
      return "status-badge status-confirmed";
    case "failed":
      return "status-badge status-canceled";
    default:
      return "status-badge status-archived";
  }
}

function isTerminalStatus(status: string): boolean {
  return ["parsed", "imported", "completed", "failed"].includes(status);
}

// T-02: Status filter tabs
type StatusFilter = "all" | "active" | "completed" | "failed";

function filterImports(items: ImportListItem[], filter: StatusFilter, search: string): ImportListItem[] {
  let filtered = items;

  if (filter === "active") {
    filtered = filtered.filter((item) => !isTerminalStatus(item.status));
  } else if (filter === "completed") {
    filtered = filtered.filter((item) =>
      ["parsed", "imported", "completed"].includes(item.status)
    );
  } else if (filter === "failed") {
    filtered = filtered.filter((item) => item.status === "failed");
  }

  if (search.trim()) {
    const lowerSearch = search.toLowerCase();
    filtered = filtered.filter((item) =>
      item.fileName.toLowerCase().includes(lowerSearch)
    );
  }

  return filtered;
}

function getFileExtension(name: string): string | null {
  const ext = name.split(".").pop()?.trim().toLowerCase();
  return ext && ext.length > 0 ? ext : null;
}

async function scanFileHeaders(
  file: File,
  ext: string
): Promise<{ headers: string[]; headerRow: number }> {
  const buffer = await file.arrayBuffer();

  if (ext === "csv") {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(buffer.slice(0, 8192));
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], headerRow: 1 };

    const firstLine = lines[0];
    const semicolons = (firstLine.match(/;/g) ?? []).length;
    const commas = (firstLine.match(/,/g) ?? []).length;
    const delimiter = semicolons > commas ? ";" : ",";
    const headers = firstLine
      .split(delimiter)
      .map((h) => h.trim().replace(/^"|"$/g, ""))
      .filter((h) => h.length > 0);
    return { headers, headerRow: 1 };
  }

  // XLSX / XLS
  const XLSX = (await import("xlsx")).default;
  const wb = XLSX.read(buffer, { sheetRows: 10 });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  if (!firstSheet) return { headers: [], headerRow: 1 };

  const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(
    firstSheet,
    { header: 1 }
  );

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const cells = row
      .map((cell) => String(cell ?? "").trim())
      .filter((c) => c.length > 0);
    // A header row should have at least 3 non-empty text cells
    const textCells = cells.filter((c) => Number.isNaN(Number(c)));
    if (textCells.length >= 3) {
      return {
        headers: row.map((cell) => String(cell ?? "").trim()).filter((c) => c.length > 0),
        headerRow: i + 1,
      };
    }
  }

  return { headers: [], headerRow: 1 };
}

export function ImportWizard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [headerRowInput, setHeaderRowInput] = useState("");
  const [headerRowError, setHeaderRowError] = useState<string | null>(null);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);
  const [copiedImportId, setCopiedImportId] = useState<string | null>(null);

  // Storytelling states
  const [fileStage, setFileStage] = useState<FileStage>("idle");
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [detectedHeaderRow, setDetectedHeaderRow] = useState<number | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [pdfReviewError, setPdfReviewError] = useState<string | null>(null);
  const [pdfReview, setPdfReview] = useState<TabularPdfReviewPayload | null>(null);
  const [approvedPdfTables, setApprovedPdfTables] = useState<
    Array<{ sourcePage: number; tableIndex: number }>
  >([]);
  const scanAbortRef = useRef(0);

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

  function resetFileSelectionState() {
    setSelectedFile(null);
    setFileStage("idle");
    setDetectedHeaders([]);
    setDetectedHeaderRow(null);
    setFormatError(null);
    setPdfReviewError(null);
    setPdfReview(null);
    setApprovedPdfTables([]);
    setHeaderRowInput("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // File validation + header scanning effect
  useEffect(() => {
    if (!selectedFile) {
      scanAbortRef.current += 1;
      return;
    }

    const scanId = ++scanAbortRef.current;

    const run = async () => {
      // Step 1: Validate format (show briefly)
      setFileStage("validating");
      setFormatError(null);
      setPdfReviewError(null);
      setDetectedHeaders([]);
      setDetectedHeaderRow(null);
      setPdfReview(null);
      setApprovedPdfTables([]);
      setHeaderRowInput("");

      const ext = getFileExtension(selectedFile.name);
      if (!ext || !VALID_EXTENSIONS.has(ext)) {
        // Small delay so the user sees the validation step
        await new Promise((r) => setTimeout(r, 300));
        if (scanAbortRef.current !== scanId) return;
        setFileStage("invalid");
        setFormatError(
          `Le format .${ext ?? "inconnu"} n'est pas supporté. Utilisez un fichier CSV, XLSX, XLS ou PDF.`
        );
        return;
      }

      // Brief pause to show "validation" step
      await new Promise((r) => setTimeout(r, 400));
      if (scanAbortRef.current !== scanId) return;

      if (ext === "pdf") {
        setFileStage("reviewing_pdf");

        try {
          const review = await reviewTabularPdfFile(selectedFile);
          if (scanAbortRef.current !== scanId) return;

          setPdfReview(review);
          setApprovedPdfTables(review.review.suggested_approved_tables);
          setFileStage("pdf_review");
        } catch (error) {
          if (scanAbortRef.current !== scanId) return;
          setFileStage("invalid");
          setPdfReviewError(
            error instanceof Error
              ? error.message
              : "Analyse du PDF tabulaire impossible."
          );
        }
        return;
      }

      // Step 2: Scan for headers
      setFileStage("scanning");

      try {
        const result = await scanFileHeaders(selectedFile, ext);
        if (scanAbortRef.current !== scanId) return;

        if (result.headers.length >= 2) {
          setDetectedHeaders(result.headers);
          setDetectedHeaderRow(result.headerRow);
          setFileStage("ready");
        } else {
          setDetectedHeaders([]);
          setDetectedHeaderRow(null);
          setFileStage("header_needed");
        }
      } catch {
        if (scanAbortRef.current !== scanId) return;
        // Scan failed — still allow import, server will handle detection
        setDetectedHeaders([]);
        setFileStage("ready");
      }
    };

    void run();
  }, [reviewTabularPdfFile, selectedFile]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedFile || isSubmitting) return;

      setDismissedSuccess(false);
      const trimmedHeaderRow = headerRowInput.trim();
      let headerRowNumber: number | null = null;

      if (trimmedHeaderRow.length > 0) {
        const parsed = Number(trimmedHeaderRow);
        if (!Number.isInteger(parsed) || parsed < 1) {
          setHeaderRowError("La ligne d'en-tête doit être un entier >= 1.");
          return;
        }
        headerRowNumber = parsed;
      }

      setHeaderRowError(null);
      const success = await importFile(selectedFile, { headerRowNumber });
      if (!success) return;

      resetFileSelectionState();
    },
    [
      headerRowInput,
      importFile,
      isSubmitting,
      selectedFile,
    ]
  );

  const handlePdfReviewSubmit = useCallback(async () => {
    if (!selectedFile || isSubmitting) return;
    setDismissedSuccess(false);

    if (!pdfReview) {
      setPdfReviewError("Analyse PDF indisponible. Recommencez avec un autre fichier.");
      return;
    }

    if (approvedPdfTables.length === 0) {
      setPdfReviewError("Retenez au moins un tableau avant de rejoindre le mapping standard.");
      return;
    }

    const success = await importReviewedPdfFile({
      file: selectedFile,
      pdfReview,
      approvedTables: approvedPdfTables,
    });
    if (!success) return;

    resetFileSelectionState();
  }, [
    approvedPdfTables,
    importReviewedPdfFile,
    isSubmitting,
    pdfReview,
    selectedFile,
  ]);

  function clearSelectedFile() {
    resetFileSelectionState();
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  async function handleCopyImportId(importId: string) {
    try {
      await navigator.clipboard.writeText(importId);
      setCopiedImportId(importId);
      window.setTimeout(() => {
        setCopiedImportId((prev) => (prev === importId ? null : prev));
      }, 1500);
    } catch {
      // Ignore clipboard errors (permissions / unavailable API)
    }
  }

  const filteredImports = filterImports(imports, statusFilter, historySearch);
  const shouldShowHistory = showHistory || Boolean(loadError);
  const canAccessHistory = imports.length > 0 || Boolean(loadError);

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "Tous" },
    { key: "active", label: "En cours" },
    { key: "completed", label: "Termines" },
    { key: "failed", label: "Echecs" },
  ];

  return (
    <div className="space-y-6">
      {/* After successful import: single clear CTA, no dropzone */}
      {lastImportId && !isSubmitting && !dismissedSuccess ? (
        <section className="dashboard-card p-8 text-center">
          <div className="mx-auto flex max-w-md flex-col items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--success)]/10">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-[var(--slate-800)]">
                Fichier importé avec succès
              </p>
              <p className="mt-1 text-sm text-[var(--slate-500)]">
                Passez à l&apos;étape suivante pour associer les colonnes de votre DPGF.
              </p>
            </div>
            <Link
              href={`/dashboard/mappings?import_id=${lastImportId}`}
              className="btn btn-primary"
            >
              <span className="flex items-center gap-2">
                Mapper les colonnes
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </span>
            </Link>
            <button
              type="button"
              className="text-xs text-[var(--slate-400)] hover:text-[var(--brand-blue)]"
              onClick={() => setDismissedSuccess(true)}
            >
              Importer un autre fichier
            </button>
          </div>
        </section>
      ) : (

      <section className="dashboard-card p-6">

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── Stage: IDLE — Full dropzone ── */}
          {fileStage === "idle" && (
            <>
              <div
                ref={dropZoneRef}
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
                  accept={ACCEPTED_FILE_TYPES}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    if (nextFile) {
                      setSelectedFile(nextFile);
                    } else {
                      resetFileSelectionState();
                    }
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

          {/* ── Stage: VALIDATING — Checking format ── */}
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

          {/* ── Stage: SCANNING — Analyzing headers ── */}
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

          {/* ── Stage: INVALID — Bad format ── */}
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
              onToggleTable={(table) => {
                setPdfReviewError(null);
                setApprovedPdfTables((current) => {
                  const alreadySelected = current.some(
                    (entry) =>
                      entry.sourcePage === table.sourcePage &&
                      entry.tableIndex === table.tableIndex
                  );
                  if (alreadySelected) {
                    return current.filter(
                      (entry) =>
                        !(
                          entry.sourcePage === table.sourcePage &&
                          entry.tableIndex === table.tableIndex
                        )
                    );
                  }
                  return [...current, table];
                });
              }}
              onClearFile={clearSelectedFile}
              onSubmit={() => void handlePdfReviewSubmit()}
              isSubmitting={isSubmitting}
            />
          )}

          {/* ── Stage: READY — Headers detected, ready to import ── */}
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
                      En-tête détectée{detectedHeaderRow && detectedHeaderRow > 1 ? ` (ligne ${detectedHeaderRow})` : ""} — {detectedHeaders.length} colonnes trouvées
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

              {/* Detected headers preview */}
              {detectedHeaders.length > 0 && (
                <div className="mt-3 border-t border-[var(--success)]/15 pt-3">
                  <p className="mb-2 text-xs font-medium text-[var(--slate-600)]">Colonnes détectées :</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedHeaders.slice(0, 12).map((header) => (
                      <span
                        key={header}
                        className="inline-block rounded-md bg-[var(--slate-100)] px-2 py-0.5 text-xs text-[var(--slate-700)]"
                      >
                        {header}
                      </span>
                    ))}
                    {detectedHeaders.length > 12 && (
                      <span className="inline-block rounded-md bg-[var(--slate-100)] px-2 py-0.5 text-xs text-[var(--slate-500)]">
                        +{detectedHeaders.length - 12} autres
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Stage: HEADER_NEEDED — Headers not found, ask user ── */}
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
                        setHeaderRowInput(event.target.value);
                        if (headerRowError) setHeaderRowError(null);
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

        {/* Progress + feedback messages */}
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
      )}

      {/* History: collapsed by default, toggle link */}
      {canAccessHistory && !shouldShowHistory && (
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
      )}

      {shouldShowHistory && (
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

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--slate-200)] px-6 py-3">
            <div className="flex gap-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setStatusFilter(tab.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === tab.key
                      ? "bg-[var(--brand-blue)] text-white"
                      : "bg-[var(--slate-100)] text-[var(--slate-600)] hover:bg-[var(--slate-200)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <input
              className="form-input form-input--sm max-w-[200px]"
              placeholder="Rechercher par nom..."
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
            />
          </div>

          {loadError ? (
            <div className="alert alert-error m-4">{loadError}</div>
          ) : null}

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nom</th>
                  <th>Statut</th>
                  <th>Lignes</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {isLoadingImports ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                        <span className="text-sm text-[var(--slate-500)]">Chargement...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredImports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-[var(--slate-500)]">
                      Aucun import trouvé.
                    </td>
                  </tr>
                ) : (
                  filteredImports.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <code className="text-xs text-[var(--slate-600)]">
                            {item.id.slice(0, 8)}
                          </code>
                          <button
                            type="button"
                            className="text-xs font-medium text-[var(--brand-blue)] hover:underline"
                            onClick={() => void handleCopyImportId(item.id)}
                          >
                            {copiedImportId === item.id ? "Copie" : "Copier"}
                          </button>
                        </div>
                      </td>
                      <td className="max-w-[280px]">
                        <span className="block truncate font-medium text-[var(--slate-800)]">
                          {item.fileName}
                        </span>
                      </td>
                      <td>
                        <span className={statusClass(item.status)}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td className="font-mono text-[var(--slate-700)]">
                        {formatRowsCount(item.rowsCount)}
                      </td>
                      <td className="text-sm text-[var(--slate-500)]">
                        {formatDate(item.createdAt)}
                      </td>
                      <td>
                        {["parsed", "imported", "completed"].includes(item.status) ? (
                          <Link
                            href={`/dashboard/mappings?import_id=${item.id}`}
                            className="text-xs font-medium text-[var(--brand-blue)] hover:underline"
                          >
                            Continuer
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
