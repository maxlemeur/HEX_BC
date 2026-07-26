"use client";

import Link from "next/link";

import type { ImportListItem } from "@/hooks/useImportFlow";

type ImportHistoryTableProps = {
  copiedImportId: string | null;
  isLoadingImports: boolean;
  items: ImportListItem[];
  onCopyImportId: (importId: string) => void | Promise<void>;
};

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
      return "Terminé";
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

export function ImportHistoryTable({
  copiedImportId,
  isLoadingImports,
  items,
  onCopyImportId,
}: ImportHistoryTableProps) {
  return (
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
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-sm text-[var(--slate-500)]">
                Aucun import trouvé.
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-[var(--slate-600)]">
                      {item.id.slice(0, 8)}
                    </code>
                    <button
                      type="button"
                      className="text-xs font-medium text-[var(--brand-blue)] hover:underline"
                      onClick={() => void onCopyImportId(item.id)}
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
  );
}
