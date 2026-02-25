"use client";

import { useCallback, useId, useRef, useState } from "react";

import {
  isTakeoffApiError,
  registerPlanFile,
  uploadFileToSignedUrl,
} from "@/lib/takeoff/client";

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
};

type PlanFileUploadZoneProps = {
  setId: string;
  onUploadsComplete: () => void;
};

function validatePdfFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return `"${file.name}" n'est pas un PDF.`;
  }
  const mime = file.type.trim().toLowerCase();
  if (mime && mime !== "application/pdf") {
    return `"${file.name}" n'est pas un PDF (type: ${file.type}).`;
  }
  if (file.size <= 0) {
    return `"${file.name}" est vide.`;
  }
  if (file.size > PLAN_PDF_MAX_SIZE_BYTES) {
    return `"${file.name}" depasse ${PLAN_PDF_MAX_SIZE_LABEL}.`;
  }
  return null;
}

function generateEntryId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PlanFileUploadZone({
  setId,
  onUploadsComplete,
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

      async function uploadOne(entry: UploadFileEntry) {
        // Step 1: register metadata
        updateEntry(entry.id, { status: "registering", progress: 0 });
        try {
          const response = await registerPlanFile(setId, {
            file_name: entry.file.name,
            file_type: entry.file.type || "application/pdf",
            file_size_bytes: entry.file.size,
          });

          // Step 2: upload binary to signed URL
          updateEntry(entry.id, { status: "uploading" });
          await uploadFileToSignedUrl(
            entry.file,
            response.signed_upload.url,
            (percent) => updateEntry(entry.id, { progress: percent })
          );

          updateEntry(entry.id, { status: "done", progress: 100 });
          setAnnouncement(`"${entry.file.name}" uploade.`);
        } catch (err) {
          const msg = isTakeoffApiError(err)
            ? err.message
            : "Echec de l'upload.";
          updateEntry(entry.id, { status: "error", error: msg });
          setAnnouncement(`Erreur upload "${entry.file.name}": ${msg}`);
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
      onUploadsComplete();
    },
    [setId, updateEntry, onUploadsComplete]
  );

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const newEntries: UploadFileEntry[] = [];
      for (const file of files) {
        const validationError = validatePdfFile(file);
        if (validationError) {
          newEntries.push({
            id: generateEntryId(),
            file,
            status: "error",
            progress: 0,
            error: validationError,
          });
        } else {
          newEntries.push({
            id: generateEntryId(),
            file,
            status: "pending",
            progress: 0,
            error: null,
          });
        }
      }

      setEntries((prev) => [...prev, ...newEntries]);

      const valid = newEntries.filter((e) => e.status === "pending");
      if (valid.length > 0) {
        setAnnouncement(
          `${valid.length} ${valid.length === 1 ? "fichier ajoute" : "fichiers ajoutes"}.`
        );
        processQueue(valid);
      }
    },
    [processQueue]
  );

  const hasActiveUploads = entries.some(
    (e) => e.status === "pending" || e.status === "registering" || e.status === "uploading"
  );

  return (
    <div>
      {/* Hidden file input */}
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={PLAN_PDF_ACCEPT}
        multiple
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
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
        aria-label="Zone de depot PDF. Glissez des fichiers ou appuyez pour selectionner."
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
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
      >
        <p className="text-sm font-medium text-[var(--slate-700)]">
          {dragActive
            ? "Deposez les fichiers ici"
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
              className="flex items-center gap-3 rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate text-[var(--slate-700)]">
                {entry.file.name}
              </span>

              {entry.status === "registering" && (
                <span className="shrink-0 text-xs text-[var(--slate-500)]">
                  Enregistrement...
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
                      className="h-full rounded-full bg-[var(--brand-blue)] transition-all duration-200"
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
                  className="h-4 w-4 shrink-0 text-green-600"
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
                <span className="shrink-0 text-xs font-medium text-red-600">
                  {entry.error}
                </span>
              )}

              {entry.status === "pending" && (
                <span className="shrink-0 text-xs text-[var(--slate-400)]">
                  En attente...
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
