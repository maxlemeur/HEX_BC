"use client";

import type { PlanFileListItem } from "@/lib/takeoff/types";
import { FileIcon, Trash2Icon } from "lucide-react";

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
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

export function PlanFileCard({ file, onDelete, deleting }: PlanFileCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm transition hover:border-border-strong">
      {/* PDF icon */}
      <FileIcon className="h-5 w-5 shrink-0 text-red-500" strokeWidth={1.5} aria-hidden="true" />

      {/* File info */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-800">
          {file.file_name}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
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
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition hover:bg-muted hover:text-danger disabled:opacity-50"
        aria-label={`Supprimer ${file.file_name}`}
        onClick={() => onDelete(file.id)}
        disabled={deleting}
      >
        <Trash2Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
