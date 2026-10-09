"use client";

import { useState } from "react";

import {
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
} from "@/lib/affaires/intake";
import { CircleIcon, UploadIcon } from "lucide-react";

const ACCEPT = AFFAIRE_INTAKE_ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

type AffaireFileDropSurfaceProps = {
  inputId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFilesSelected: (files: FileList | File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  uploadingFileCount?: number | null;
  triggerId?: string;
  hiddenSurface?: boolean;
};

export function AffaireFileDropSurface({
  inputId,
  inputRef,
  onFilesSelected,
  disabled = false,
  compact = false,
  uploadingFileCount = null,
  triggerId,
  hiddenSurface = false,
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
        className={`${hiddenSurface ? "sr-only" : `rounded-xl border-2 border-dashed transition-colors ${
          dragActive
            ? "border-primary bg-primary/5"
            : "border-border-strong bg-surface-subtle hover:border-slate-400"
        } ${compact ? "p-4" : "p-6"} ${
          disabled || isUploading ? "pointer-events-none opacity-60" : "cursor-pointer"
        }`}`}
        role={hiddenSurface ? undefined : "button"}
        tabIndex={hiddenSurface || disabled || isUploading ? -1 : 0}
        aria-label={
          hiddenSurface
            ? undefined
            : "Zone de dépôt multi-documents. Glissez des fichiers ou appuyez pour sélectionner."
        }
        aria-disabled={disabled || isUploading}
        aria-hidden={hiddenSurface}
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
            <CircleIcon className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            <span className="text-sm font-medium text-foreground-secondary">
              Upload de {uploadingFileCount} fichier
              {uploadingFileCount && uploadingFileCount > 1 ? "s" : ""}...
            </span>
          </div>
        ) : (
          <div className="text-center">
            <UploadIcon strokeWidth="1.5" className="mx-auto mb-2 text-subtle-foreground" aria-hidden="true" size={28} />
            <p className="text-sm font-medium text-foreground-secondary">
              {dragActive
                ? "Deposez les fichiers ici"
                : compact
                  ? "Deposer d'autres fichiers"
                  : "Déposez votre dossier d'appel d'offres ici"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF, images, Excel, Word — {AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL} max par fichier
            </p>
            {!compact ? (
              <p className="mt-1.5 text-xs font-medium text-primary">
                Chaque pièce sera classée et orientée automatiquement
              </p>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
