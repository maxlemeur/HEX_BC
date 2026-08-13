"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  deletePlanFile,
  isTakeoffApiError,
  registerPlanFile,
  uploadFileToSignedUrl,
} from "@/lib/takeoff/client";
import {
  inspectTakeoffPdfBytes,
  resolveTakeoffPdfMimeType,
  validateTakeoffPdfUploadMetadata,
} from "@/lib/takeoff/pdf-validation";

const PLAN_PDF_ACCEPT = ".pdf,application/pdf";
const PLAN_PDF_MAX_SIZE_BYTES = 50 * 1024 * 1024;
const PLAN_PDF_MAX_SIZE_LABEL = "50 Mo";
const MAX_CONCURRENT_UPLOADS = 3;

type UploadFileStatus = "pending" | "registering" | "uploading" | "done" | "error";

type UploadFileEntry = {
  id: string;
  file: File;
  status: UploadFileStatus;
  progress: number;
  error: string | null;
  normalizedMimeType: string | null;
};

export type PlanFileUploadSummary = {
  uploadedCount: number;
  uploadedSizeBytes: number;
};

type PlanFileUploadZoneProps = {
  setId: string;
  onUploadsComplete: (summary: PlanFileUploadSummary) => void;
  onUploadActivityChange?: (isActive: boolean) => void;
};

async function validatePdfFile(file: File): Promise<{
  error: string | null;
  normalizedMimeType: string | null;
}> {
  const metadataValidation = validateTakeoffPdfUploadMetadata({
    fileName: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
    maxFileSizeBytes: PLAN_PDF_MAX_SIZE_BYTES,
    maxFileSizeLabel: PLAN_PDF_MAX_SIZE_LABEL,
  });

  if (!metadataValidation.valid) {
    return {
      error: `"${file.name}" ${metadataValidation.message.toLowerCase()}`,
      normalizedMimeType: null,
    };
  }

  const pdfInspection = await inspectTakeoffPdfBytes(await file.arrayBuffer());
  if (!pdfInspection.valid) {
    return {
      error: `"${file.name}" ${pdfInspection.message.toLowerCase()}`,
      normalizedMimeType: null,
    };
  }

  return {
    error: null,
    normalizedMimeType:
      resolveTakeoffPdfMimeType({
        fileName: file.name,
        mimeType: file.type,
      }) ?? "application/pdf",
  };
}

function generateEntryId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PlanFileUploadZone({
  setId,
  onUploadsComplete,
  onUploadActivityChange,
}: PlanFileUploadZoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [entries, setEntries] = useState<UploadFileEntry[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const uploadingRef = useRef(false);

  const updateEntry = useCallback(
    (id: string, patch: Partial<UploadFileEntry>) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
      );
    },
    []
  );

  const processQueue = useCallback(
    async (queue: UploadFileEntry[]) => {
      if (uploadingRef.current) return;
      uploadingRef.current = true;

      const pending = [...queue];
      const active: Promise<void>[] = [];
      const completedUploads: File[] = [];

      async function uploadOne(entry: UploadFileEntry) {
        let registeredFileId: string | null = null;

        // Step 1: register metadata
        updateEntry(entry.id, { status: "registering", progress: 0 });
        try {
          const response = await registerPlanFile(setId, {
            file_name: entry.file.name,
            file_type: entry.normalizedMimeType || "application/pdf",
            file_size_bytes: entry.file.size,
          });
          registeredFileId = response.plan_file.id;

          // Step 2: upload binary to signed URL
          updateEntry(entry.id, { status: "uploading" });
          await uploadFileToSignedUrl(
            entry.file,
            response.signed_upload.url,
            (percent) => updateEntry(entry.id, { progress: percent })
          );

          updateEntry(entry.id, { status: "done", progress: 100 });
          completedUploads.push(entry.file);
          setAnnouncement(`"${entry.file.name}" envoyé.`);
        } catch (err) {
          let cleanupFailed = false;
          if (registeredFileId) {
            try {
              await deletePlanFile(setId, registeredFileId);
            } catch {
              cleanupFailed = true;
            }
          }

          const baseMessage = isTakeoffApiError(err)
            ? err.message
            : err instanceof Error
              ? err.message
              : "Échec de l’envoi.";
          const msg = cleanupFailed
            ? `${baseMessage} Le fichier incomplet n’a pas pu être nettoyé : actualisez le jeu puis supprimez-le avant de réessayer.`
            : baseMessage;
          updateEntry(entry.id, { status: "error", error: msg });
          setAnnouncement(`Erreur d’envoi pour "${entry.file.name}" : ${msg}`);
        }
      }

      while (pending.length > 0 || active.length > 0) {
        while (active.length < MAX_CONCURRENT_UPLOADS && pending.length > 0) {
          const next = pending.shift()!;
          const promise = uploadOne(next).then(() => {
            const idx = active.indexOf(promise);
            if (idx >= 0) active.splice(idx, 1);
          });
          active.push(promise);
        }
        if (active.length > 0) {
          await Promise.race(active);
        }
      }

      uploadingRef.current = false;
      onUploadsComplete({
        uploadedCount: completedUploads.length,
        uploadedSizeBytes: completedUploads.reduce((total, file) => total + file.size, 0),
      });
    },
    [setId, updateEntry, onUploadsComplete]
  );

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const newEntries: UploadFileEntry[] = [];
      for (const file of files) {
        const validation = await validatePdfFile(file);
        if (validation.error) {
          newEntries.push({
            id: generateEntryId(),
            file,
            status: "error",
            progress: 0,
            error: validation.error,
            normalizedMimeType: null,
          });
        } else {
          newEntries.push({
            id: generateEntryId(),
            file,
            status: "pending",
            progress: 0,
            error: null,
            normalizedMimeType: validation.normalizedMimeType,
          });
        }
      }

      setEntries((prev) => [...prev, ...newEntries]);

      const valid = newEntries.filter((e) => e.status === "pending");
      if (valid.length > 0) {
        setAnnouncement(
          `${valid.length} ${valid.length === 1 ? "fichier ajouté" : "fichiers ajoutés"}.`
        );
        processQueue(valid);
      }
    },
    [processQueue]
  );

  const handleRetry = useCallback(
    (entry: UploadFileEntry) => {
      if (uploadingRef.current || !entry.normalizedMimeType) return;

      const retryEntry: UploadFileEntry = {
        ...entry,
        status: "pending",
        progress: 0,
        error: null,
      };
      updateEntry(entry.id, retryEntry);
      void processQueue([retryEntry]);
    },
    [processQueue, updateEntry],
  );

  const hasActiveUploads = entries.some(
    (e) => e.status === "pending" || e.status === "registering" || e.status === "uploading"
  );

  useEffect(() => {
    onUploadActivityChange?.(hasActiveUploads);
  }, [hasActiveUploads, onUploadActivityChange]);

  return (
    <div>
      {/* Hidden file input */}
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        name="plan-files"
        className="sr-only"
        accept={PLAN_PDF_ACCEPT}
        autoComplete="off"
        multiple
        onChange={(e) => {
          if (e.target.files) {
            void handleFiles(e.target.files);
          }
          e.target.value = "";
        }}
        disabled={hasActiveUploads}
      />

      {/* Drop zone */}
      <div
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragActive
            ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
            : "border-[var(--slate-300)] bg-[var(--slate-50)] hover:border-[var(--slate-400)]"
        }`}
        role="button"
        tabIndex={hasActiveUploads ? -1 : 0}
        aria-label="Zone de dépôt PDF. Glissez des fichiers ou appuyez pour sélectionner."
        aria-disabled={hasActiveUploads}
        onClick={() => !hasActiveUploads && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (hasActiveUploads) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
          if (hasActiveUploads) return;
          if (e.dataTransfer.files) {
            void handleFiles(e.dataTransfer.files);
          }
        }}
      >
        <p className="text-sm font-medium text-[var(--slate-700)]">
          {dragActive
            ? "Déposez les fichiers ici"
            : "Glissez des PDF ici ou cliquez pour parcourir"}
        </p>
        <p className="mt-1 text-xs text-[var(--slate-500)]">
          PDF uniquement — {PLAN_PDF_MAX_SIZE_LABEL} max par fichier
        </p>
      </div>

      {/* Upload entries */}
      {entries.length > 0 && (
        <div className="mt-3 space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-[var(--slate-200)] bg-surface px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-[var(--slate-700)]">
                {entry.file.name}
              </span>

              {entry.status === "registering" && (
                <span className="shrink-0 text-xs text-[var(--slate-500)]">
                  Enregistrement…
                </span>
              )}

              {entry.status === "uploading" && (
                <div className="flex shrink-0 items-center gap-2">
                  <div
                    className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--slate-200)]"
                    role="progressbar"
                    aria-valuenow={entry.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Upload ${entry.file.name} ${entry.progress}%`}
                  >
                    <div
                      className="h-full rounded-full bg-[var(--brand-blue)] transition-[width] duration-200"
                      style={{ width: `${entry.progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--slate-500)]">
                    {entry.progress}%
                  </span>
                </div>
              )}

              {entry.status === "done" && (
                <svg
                  className="h-4 w-4 shrink-0 text-success"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}

              {entry.status === "error" && (
                <div className="flex min-w-0 shrink items-center gap-2">
                  <span className="min-w-0 break-words text-xs font-medium text-danger">
                    {entry.error}
                  </span>
                  {entry.normalizedMimeType ? (
                    <button
                      type="button"
                      className="shrink-0 text-xs font-semibold underline"
                      onClick={() => handleRetry(entry)}
                      disabled={hasActiveUploads}
                    >
                      Réessayer
                    </button>
                  ) : null}
                </div>
              )}

              {entry.status === "pending" && (
                <span className="shrink-0 text-xs text-[var(--slate-400)]">
                  En attente…
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Live announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
