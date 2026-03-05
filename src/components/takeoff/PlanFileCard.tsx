"use client";

import type { PlanFileListItem } from "@/lib/takeoff/types";

type PlanFileCardProps = {
  file: PlanFileListItem;
  onDelete: (fileId: string) => void;
  deleting?: boolean;
};

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} o`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} Ko`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} Mo`;
}

function formatRelativeTime(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "A l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

export function PlanFileCard({ file, onDelete, deleting }: PlanFileCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--slate-200)] bg-surface px-4 py-3 text-sm transition hover:border-[var(--slate-300)]">
      {/* PDF icon */}
      <svg
        className="h-5 w-5 shrink-0 text-red-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
        />
      </svg>

      {/* File info */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-[var(--slate-800)]">
          {file.file_name}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--slate-500)]">
          <span>{formatFileSize(file.file_size_bytes)}</span>
          {file.page_count != null && (
            <span>
              {file.page_count} {file.page_count === 1 ? "page" : "pages"}
            </span>
          )}
          <span>{formatRelativeTime(file.created_at)}</span>
        </p>
      </div>

      {/* Delete button */}
      <button
        type="button"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--slate-400)] transition hover:bg-[var(--slate-100)] hover:text-danger disabled:opacity-50"
        aria-label={`Supprimer ${file.file_name}`}
        onClick={() => onDelete(file.id)}
        disabled={deleting}
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
          />
        </svg>
      </button>
    </div>
  );
}
