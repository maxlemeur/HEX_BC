"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
} from "@/lib/affaires/intake";
import {
  COCKPIT_OPEN_SURFACE_EVENT,
  type CockpitOpenSurfaceEventDetail,
} from "@/lib/cockpit/events";
import { AffaireFileDropSurface } from "./AffaireFileDropSurface";

type FileResult = {
  documentId: string;
  fileName: string;
  status: "uploaded" | "rejected";
  rejectionReason: string | null;
};

type DropzoneState =
  | { phase: "idle" }
  | { phase: "uploading"; fileCount: number }
  | { phase: "done"; results: FileResult[] }
  | { phase: "error"; message: string };

type IntakeDropzoneProps = {
  projectId: string;
  onUploadComplete: (uploadId: string) => void;
  compact?: boolean;
  hideSurface?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeFileResult(value: unknown): FileResult | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.documentId !== "string" ||
    typeof value.fileName !== "string" ||
    (value.status !== "uploaded" && value.status !== "rejected")
  ) {
    return null;
  }

  return {
    documentId: value.documentId,
    fileName: value.fileName,
    status: value.status,
    rejectionReason:
      typeof value.rejectionReason === "string" ? value.rejectionReason : null,
  };
}

function extractUploadResponseData(payload: unknown): {
  uploadId: string;
  files: FileResult[];
} | null {
  const candidate =
    isRecord(payload) && payload.ok === true && isRecord(payload.data)
      ? payload.data
      : payload;

  if (!isRecord(candidate) || typeof candidate.uploadId !== "string") {
    return null;
  }

  if (!Array.isArray(candidate.files)) {
    return null;
  }

  const files = candidate.files
    .map(normalizeFileResult)
    .filter((file): file is FileResult => file !== null);

  if (files.length !== candidate.files.length) {
    return null;
  }

  return {
    uploadId: candidate.uploadId,
    files,
  };
}

function extractUploadErrorMessage(payload: unknown, status: number) {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") {
      return payload.error;
    }

    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  }

  return `Erreur serveur (${status})`;
}

function validateFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!AFFAIRE_INTAKE_ALLOWED_EXTENSIONS.includes(ext as (typeof AFFAIRE_INTAKE_ALLOWED_EXTENSIONS)[number])) {
    return `"${file.name}" : extension .${ext} non supportee.`;
  }
  if (file.size <= 0) {
    return `"${file.name}" est vide.`;
  }
  if (file.size > AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES) {
    return `"${file.name}" depasse ${AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL}.`;
  }
  return null;
}

export function IntakeDropzone({
  projectId,
  onUploadComplete,
  compact = false,
  hideSurface = false,
}: IntakeDropzoneProps) {
  const inputId = `intake-dropzone-input-${projectId}`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<DropzoneState>({ phase: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const [clientErrors, setClientErrors] = useState<string[]>([]);

  const isUploading = state.phase === "uploading";

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const errors: string[] = [];
      const validFiles: File[] = [];

      for (const file of files) {
        const error = validateFile(file);
        if (error) {
          errors.push(error);
        } else {
          validFiles.push(file);
        }
      }

      setClientErrors(errors);

      if (validFiles.length === 0) {
        setAnnouncement(`${errors.length} fichier${errors.length > 1 ? "s" : ""} rejete${errors.length > 1 ? "s" : ""} localement.`);
        return;
      }

      setState({ phase: "uploading", fileCount: validFiles.length });
      setAnnouncement(`Upload de ${validFiles.length} fichier${validFiles.length > 1 ? "s" : ""} en cours...`);

      const formData = new FormData();
      for (const file of validFiles) {
        formData.append("files", file);
      }

      try {
        const response = await fetch(`/api/affaires/${projectId}/intake/files`, {
          method: "POST",
          body: formData,
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const message = extractUploadErrorMessage(payload, response.status);
          setState({ phase: "error", message });
          setAnnouncement(`Erreur: ${message}`);
          return;
        }

        const data = extractUploadResponseData(payload);
        if (!data) {
          const message = "Reponse upload invalide.";
          setState({ phase: "error", message });
          setAnnouncement(`Erreur: ${message}`);
          return;
        }

        const uploaded = data.files.filter((f) => f.status === "uploaded").length;
        const rejected = data.files.filter((f) => f.status === "rejected").length;

        setState({ phase: "done", results: data.files });

        const parts: string[] = [];
        if (uploaded > 0) parts.push(`${uploaded} televerse${uploaded > 1 ? "s" : ""}`);
        if (rejected > 0) parts.push(`${rejected} rejete${rejected > 1 ? "s" : ""}`);
        setAnnouncement(parts.join(", ") + ".");

        onUploadComplete(data.uploadId);
      } catch {
        setState({ phase: "error", message: "Erreur réseau. Vérifiez votre connexion." });
        setAnnouncement("Erreur reseau.");
      }
    },
    [projectId, onUploadComplete],
  );

  useEffect(() => {
    const handleOpenSurface = (event: Event) => {
      const detail = (event as CustomEvent<CockpitOpenSurfaceEventDetail>).detail;
      if (
        !detail ||
        detail.projectId !== projectId ||
        detail.surfaceId !== "intake-upload" ||
        !detail.files?.length
      ) {
        return;
      }

      void handleFiles(detail.files);
    };

    document.addEventListener(COCKPIT_OPEN_SURFACE_EVENT, handleOpenSurface);
    return () =>
      document.removeEventListener(COCKPIT_OPEN_SURFACE_EVENT, handleOpenSurface);
  }, [handleFiles, projectId]);

  const reset = useCallback(() => {
    setState({ phase: "idle" });
    setClientErrors([]);
    setAnnouncement("");
  }, []);

  return (
    <div>
      <AffaireFileDropSurface
        inputId={inputId}
        inputRef={inputRef}
        onFilesSelected={(files: FileList | File[]) => {
          void handleFiles(files);
        }}
        disabled={isUploading}
        compact={compact}
        uploadingFileCount={state.phase === "uploading" ? state.fileCount : null}
        triggerId={projectId}
        hiddenSurface={hideSurface}
      />

      {/* Client-side validation errors */}
      {clientErrors.length > 0 && (
        <ul className="mt-2 space-y-1" role="alert">
          {clientErrors.map((err, i) => (
            <li key={i} className="text-xs font-medium text-danger">
              {err}
            </li>
          ))}
        </ul>
      )}

      {/* Server results */}
      {state.phase === "done" && state.results.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {state.results.map((file) => (
            <div
              key={file.documentId}
              className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-surface px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-[var(--slate-700)]">
                {file.fileName}
              </span>
              {file.status === "uploaded" ? (
                <svg className="h-4 w-4 shrink-0 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : (
                <span className="shrink-0 text-xs font-medium text-danger">
                  {file.rejectionReason ?? "Rejete"}
                </span>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={reset}
            className="mt-1 text-xs font-medium text-[var(--brand-blue)] hover:underline"
          >
            Fermer le resume
          </button>
        </div>
      )}

      {/* Server error */}
      {state.phase === "error" && (
        <div className="mt-2 rounded-lg border border-danger/20 bg-error-light px-3 py-2 text-sm text-danger" role="alert">
          {state.message}
          <button
            type="button"
            onClick={reset}
            className="ml-2 text-xs font-medium underline"
          >
            Reessayer
          </button>
        </div>
      )}

      {/* Live announcements for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
