"use client";

import { useState } from "react";

import {
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
} from "@/lib/affaires/intake";

const ACCEPT = AFFAIRE_INTAKE_ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

type AffaireFileDropSurfaceProps = {
  inputId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFilesSelected: (files: FileList | File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  uploadingFileCount?: number | null;
  triggerId?: string;
};

export function AffaireFileDropSurface({
  inputId,
  inputRef,
  onFilesSelected,
  disabled = false,
  compact = false,
  uploadingFileCount = null,
  triggerId,
}: Readonly<AffaireFileDropSurfaceProps>) {
  const [dragActive, setDragActive] = useState(false);
  const isUploading = typeof uploadingFileCount === "number";

  return (
    <>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ACCEPT}
        multiple
        onChange={(event) => {
          if (event.target.files) {
            onFilesSelected(event.target.files);
          }
          event.target.value = "";
        }}
        disabled={disabled || isUploading}
      />

      <div
        data-intake-dropzone-trigger={triggerId}
        className={`rounded-xl border-2 border-dashed transition-colors ${
          dragActive
            ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
            : "border-[var(--slate-300)] bg-[var(--slate-50)] hover:border-[var(--slate-400)]"
        } ${compact ? "p-4" : "p-6"} ${
          disabled || isUploading ? "pointer-events-none opacity-60" : "cursor-pointer"
        }`}
        role="button"
        tabIndex={disabled || isUploading ? -1 : 0}
        aria-label="Zone de depot multi-documents. Glissez des fichiers ou appuyez pour selectionner."
        aria-disabled={disabled || isUploading}
        onClick={() => {
          if (!disabled && !isUploading) {
            inputRef.current?.click();
          }
        }}
        onKeyDown={(event) => {
          if (disabled || isUploading) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
          if (!disabled && !isUploading && event.dataTransfer.files) {
            onFilesSelected(event.dataTransfer.files);
          }
        }}
      >
        {isUploading ? (
          <div className="flex items-center justify-center gap-2">
            <svg
              className="h-5 w-5 animate-spin text-[var(--brand-blue)]"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray="31.4 31.4"
                strokeLinecap="round"
              />
            </svg>
            <span className="text-sm font-medium text-[var(--slate-700)]">
              Upload de {uploadingFileCount} fichier
              {uploadingFileCount && uploadingFileCount > 1 ? "s" : ""}...
            </span>
          </div>
        ) : (
          <div className="text-center">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mx-auto mb-2 text-[var(--slate-400)]"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" x2="12" y1="3" y2="15" />
            </svg>
            <p className="text-sm font-medium text-[var(--slate-700)]">
              {dragActive
                ? "Deposez les fichiers ici"
                : compact
                  ? "Deposer d'autres fichiers"
                  : "Déposez votre dossier d'appel d'offres ici"}
            </p>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              PDF, images, Excel, Word — {AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL} max par fichier
            </p>
            {!compact ? (
              <p className="mt-1.5 text-xs font-medium text-[var(--brand-blue)]">
                Chaque pièce sera classée et orientée automatiquement
              </p>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
