"use client";

import { useRef, useState } from "react";

import { useImportFlow } from "@/hooks/useImportFlow";

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
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "En attente";
    case "parsing":
    case "processing":
      return "Parsing";
    case "parsed":
      return "Parse";
    case "imported":
      return "Importe";
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

function modeLabel(mode: "worker" | "server" | "unknown"): string {
  if (mode === "worker") return "Worker";
  if (mode === "server") return "Serveur";
  return "-";
}

export function ImportWizard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

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

  return (
    <div className="space-y-6">
      <section className="dashboard-card p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            Importer un fichier
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Format supporte: CSV, XLSX.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="form-label" htmlFor="import-file-input">
              Fichier a importer
            </label>
            <input
              id="import-file-input"
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              className="form-input h-auto py-3"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setSelectedFile(nextFile);
              }}
              disabled={isSubmitting}
              required
            />
            <p className="mt-2 text-xs text-[var(--slate-500)]">
              Parsing worker jusqu&apos;a {formatModeThreshold(maxClientParseSizeBytes)}.
              Au-dela, fallback serveur en multipart.
            </p>
          </div>

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
            Echec worker: {workerError}
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

        {loadError ? (
          <div className="alert alert-error m-4">{loadError}</div>
        ) : null}

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Statut</th>
                <th>Lignes</th>
                <th>Date</th>
                <th>Mode</th>
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
              ) : imports.length === 0 ? (
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
                imports.map((item) => (
                  <tr key={item.id}>
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
                    <td>{modeLabel(item.mode)}</td>
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
