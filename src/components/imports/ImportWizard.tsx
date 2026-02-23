"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { useImportFlow, type ImportListItem } from "@/hooks/useImportFlow";

const ACCEPTED_FILE_TYPES = ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

function formatModeThreshold(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} Mo`;
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

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...`;
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

export function ImportWizard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    maxClientParseSizeBytes,
    importFile,
    refreshImports,
  } = useImportFlow();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || isSubmitting) return;

    const success = await importFile(selectedFile);
    if (!success) return;

    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function clearSelectedFile() {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard not available
    }
  }

  const filteredImports = filterImports(imports, statusFilter, historySearch);

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "Tous" },
    { key: "active", label: "En cours" },
    { key: "completed", label: "Termines" },
    { key: "failed", label: "Echecs" },
  ];

  return (
    <div className="space-y-6">
      {/* M-02: Success banner with CTA after import */}
      {lastImportId && !isSubmitting ? (
        <div className="rounded-xl border border-[var(--success)] bg-[var(--success-light)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-[var(--success)]">
                Import termine avec succes
              </p>
              <p className="mt-1 text-sm text-[var(--slate-600)]">
                Passez a l&apos;etape suivante pour mapper les colonnes de votre fichier.
              </p>
            </div>
            <Link
              href={`/dashboard/mappings?import_id=${lastImportId}`}
              className="btn btn-primary"
            >
              Mapper les colonnes
            </Link>
          </div>
        </div>
      ) : null}

      <section className="dashboard-card p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            Importer un fichier
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Formats supportes : CSV, XLSX, XLS.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* M-04: Drag-and-drop zone */}
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
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--slate-400)"
                  strokeWidth="1.5"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M12 15V3" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--slate-700)]">
                  Glissez-deposez votre fichier ici
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
                setSelectedFile(nextFile);
              }}
              disabled={isSubmitting}
              required
            />
          </div>

          {/* M-03: Clear french help text */}
          <p className="text-xs text-[var(--slate-500)]">
            Les fichiers de moins de {formatModeThreshold(maxClientParseSizeBytes)} sont traites dans votre navigateur. Au-dela, traitement serveur.
          </p>

          {/* M-05: Example file link */}
          <p className="text-xs text-[var(--slate-500)]">
            Besoin d&apos;aide ?{" "}
            <a
              href="/exemple-dpgf.xlsx"
              download
              className="font-medium text-[var(--brand-blue)] underline hover:text-[var(--brand-blue-dark)]"
            >
              Telecharger un fichier exemple
            </a>
          </p>

          {selectedFile ? (
            <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
              <p className="text-sm font-medium text-[var(--slate-800)]">
                {selectedFile.name}
              </p>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                {formatSize(selectedFile.size)}
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selectedFile || isSubmitting}
            >
              {isSubmitting ? "Import en cours..." : "Importer"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isSubmitting || !selectedFile}
              onClick={clearSelectedFile}
            >
              Vider
            </button>
          </div>
        </form>

        {/* M-06: Progress bar during parsing */}
        {isSubmitting ? (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--slate-200)]">
              <div className="h-full animate-pulse rounded-full bg-[var(--brand-blue)]" style={{ width: "60%" }} />
            </div>
            <p className="mt-2 text-xs text-[var(--slate-500)]">Traitement en cours...</p>
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
            Echec du traitement navigateur : {workerError}
          </div>
        ) : null}

        {submitError ? (
          <div className="alert alert-error mt-3">{submitError}</div>
        ) : null}
      </section>

      <section className="dashboard-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Historique des imports
            </h2>
            <p className="text-xs text-[var(--slate-500)]">
              Suivi en direct des statuts.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isPolling ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-[var(--info-light)] px-3 py-1 text-xs font-medium text-[var(--info)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--info)]"></span>
                Polling actif
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void refreshImports()}
              disabled={isLoadingImports || isRefreshing}
            >
              {isRefreshing ? "Actualisation..." : "Actualiser"}
            </button>
          </div>
        </div>

        {/* T-02: Filters and search */}
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
                {/* T-03: ID column */}
                <th>ID</th>
                <th>Nom</th>
                <th>Statut</th>
                <th>Lignes</th>
                <th>Date</th>
                {/* M-07: MODE column hidden by default */}
              </tr>
            </thead>
            <tbody>
              {isLoadingImports ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                      <span className="text-[var(--slate-500)]">Chargement...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredImports.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--slate-400)"
                          strokeWidth="1.5"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <path d="m7 10 5 5 5-5" />
                          <path d="M12 15V3" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium text-[var(--slate-700)]">
                          Aucun import
                        </p>
                        <p className="mt-1 text-sm text-[var(--slate-500)]">
                          Lancez un premier import pour alimenter la liste.
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredImports.map((item) => (
                  <tr key={item.id}>
                    {/* T-03: Truncated ID with copy button */}
                    <td>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-mono text-xs text-[var(--slate-500)] hover:text-[var(--brand-blue)]"
                        title={item.id}
                        onClick={() => void copyId(item.id)}
                      >
                        {truncateId(item.id)}
                        {copiedId === item.id ? (
                          <span className="text-[var(--success)]">✓</span>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    </td>
                    <td className="max-w-[280px]">
                      <span className="block truncate font-medium text-[var(--slate-800)]">
                        {item.fileName}
                      </span>
                    </td>
                    <td>
                      {/* M-08: Uniform status labels */}
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
