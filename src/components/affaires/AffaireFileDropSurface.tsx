"use client";

import { useState } from "react";

import {
  AFFAIRE_INTAKE_ACCEPTED_FORMATS_LABEL,
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
} from "@/lib/affaires/intake";
import { LoaderCircleIcon, UploadIcon } from "lucide-react";

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
  const isSurfaceHidden = hiddenSurface && !isUploading;

  return (
    <>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-label="Ajouter des pièces à l'affaire"
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
        className={`${isSurfaceHidden ? "sr-only" : `rounded-xl border-2 border-dashed transition-colors ${
          isUploading
            ? "border-primary/40 bg-primary/5"
            : dragActive
            ? "border-primary bg-primary/5"
            : "border-border-strong bg-surface-subtle hover:border-border-strong"
        } ${compact ? "p-4" : "p-6"} ${
          isUploading ? "pointer-events-none cursor-wait" : disabled ? "pointer-events-none opacity-60" : "cursor-pointer"
        }`}`}
        role={hiddenSurface ? undefined : "button"}
        tabIndex={hiddenSurface || disabled || isUploading ? -1 : 0}
        aria-label={
          hiddenSurface
            ? undefined
            : "Zone de dépôt multi-documents. Glissez des fichiers ou appuyez pour sélectionner."
        }
        aria-disabled={disabled || isUploading}
        aria-hidden={isSurfaceHidden}
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
            <LoaderCircleIcon className="h-5 w-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
            <span className="text-sm font-medium text-foreground-secondary">
              Chargement de {uploadingFileCount} fichier
              {uploadingFileCount && uploadingFileCount > 1 ? "s" : ""}…
            </span>
          </div>
        ) : (
          <div className="text-center">
            <UploadIcon strokeWidth="1.5" className="mx-auto mb-2 text-subtle-foreground" aria-hidden="true" size={28} />
            <p className="text-sm font-medium text-foreground-secondary">
              {dragActive
                ? "Déposez les fichiers ici"
                : compact
                  ? "Déposer d'autres fichiers"
                  : "Déposez votre dossier d'appel d'offres ici"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {AFFAIRE_INTAKE_ACCEPTED_FORMATS_LABEL} — {AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL} max par fichier
            </p>
            {!compact ? (
              <p className="mt-1.5 text-xs font-medium text-primary">
                Les originaux DWG/DXF/RVT/IFC/FCStd sont conservés ; ajoutez un PDF ou un quantitatif pour leur exploitation.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
