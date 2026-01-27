"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";

import {
  MAX_FILE_SIZE_LABEL,
  validateFileForUpload,
} from "@/lib/file-validation";
import { FileTypeIcon } from "./FileTypeIcon";

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

type UploadItem = {
  id: string;
  file: File;
  customName: string;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
};

export type DevisUploaderProps = {
  orderId: string;
  canManage: boolean;
  onUploadComplete?: () => void;
};

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} Ko`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}

export function DevisUploader({ orderId, canManage, onUploadComplete }: DevisUploaderProps) {
  const apiUrl = `/api/purchase-orders/${orderId}/devis`;
  const { mutate } = useSWRConfig();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const clearSuccess = useCallback(() => {
    setSuccessCount(0);
  }, []);

  useEffect(() => {
    if (successCount > 0) {
      const timer = setTimeout(clearSuccess, 3000);
      return () => clearTimeout(timer);
    }
  }, [successCount, clearSuccess]);

  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  function handleFiles(files: FileList | File[]) {
    const newItems: UploadItem[] = [];
    const errors: string[] = [];

    Array.from(files).forEach((file) => {
      const validation = validateFileForUpload(file);
      if (!validation.valid) {
        errors.push(`${file.name}: ${validation.error}`);
        return;
      }

      newItems.push({
        id: generateId(),
        file,
        customName: file.name,
        status: "pending",
        progress: 0,
      });
    });

    if (errors.length > 0) {
      setGlobalError(errors.join("\n"));
    } else {
      setGlobalError(null);
    }

    if (newItems.length > 0) {
      setUploadQueue((prev) => [...prev, ...newItems]);
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  }

  function updateItemName(id: string, name: string) {
    setUploadQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, customName: name } : item
      )
    );
  }

  function removeItem(id: string) {
    setUploadQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function clearCompleted() {
    setUploadQueue((prev) => prev.filter((item) => item.status !== "success"));
  }

  async function uploadSingleFile(item: UploadItem): Promise<boolean> {
    return new Promise((resolve) => {
      const formData = new FormData();
      formData.append("file", item.file);

      const trimmedName = item.customName.trim();
      if (trimmedName) {
        formData.append("name", trimmedName);
      }

      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setUploadQueue((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, progress: percent } : i
            )
          );
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadQueue((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: "success", progress: 100 } : i
            )
          );
          resolve(true);
        } else {
          let errorMsg = "Erreur lors de l'envoi";
          try {
            const payload = JSON.parse(xhr.responseText) as { error?: string };
            errorMsg = payload?.error ?? errorMsg;
          } catch {
            // ignore parse error
          }
          setUploadQueue((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, status: "error", error: errorMsg } : i
            )
          );
          resolve(false);
        }
      };

      xhr.onerror = () => {
        setUploadQueue((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, status: "error", error: "Erreur reseau" } : i
          )
        );
        resolve(false);
      };

      setUploadQueue((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: "uploading", progress: 0 } : i
        )
      );

      xhr.open("POST", apiUrl);
      xhr.send(formData);
    });
  }

  async function handleUploadAll() {
    const pendingItems = uploadQueue.filter((item) => item.status === "pending");
    if (pendingItems.length === 0) return;

    setIsUploading(true);
    setGlobalError(null);
    setAnnouncement(`Envoi de ${pendingItems.length} fichier(s) en cours...`);

    let successfulUploads = 0;

    for (const item of pendingItems) {
      const success = await uploadSingleFile(item);
      if (success) {
        successfulUploads++;
      }
    }

    setIsUploading(false);

    if (successfulUploads > 0) {
      setSuccessCount(successfulUploads);
      setAnnouncement(`${successfulUploads} fichier(s) envoye(s) avec succes.`);
      await mutate(apiUrl);
      onUploadComplete?.();
    }
  }

  const pendingCount = uploadQueue.filter((item) => item.status === "pending").length;
  const completedCount = uploadQueue.filter((item) => item.status === "success").length;
  const hasItems = uploadQueue.length > 0;

  return (
    <div>
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        onChange={handleInputChange}
      />

      {/* Drop zone */}
      <div
        className={`relative overflow-hidden rounded-xl border-2 border-dashed transition-all duration-200 ${
          dragActive
            ? "border-[var(--brand-orange)] bg-[var(--brand-orange)]/5"
            : "border-[var(--slate-200)] bg-white hover:border-[var(--slate-300)] hover:bg-[var(--slate-50)]"
        } ${!canManage ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (canManage) setDragActive(true);
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
        onDrop={canManage ? handleDrop : undefined}
        onClick={() => {
          if (canManage && !isUploading) {
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={canManage ? 0 : -1}
        aria-label="Zone de depot. Glissez des fichiers ou cliquez pour selectionner"
        aria-disabled={!canManage}
        onKeyDown={(event) => {
          if (!canManage || isUploading) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl transition-colors ${
            dragActive ? "bg-[var(--brand-orange)]/10" : "bg-[var(--slate-100)]"
          }`}>
            <svg
              className={`h-7 w-7 transition-colors ${dragActive ? "text-[var(--brand-orange)]" : "text-[var(--slate-400)]"}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-[var(--slate-700)]">
            {dragActive ? "Deposez vos fichiers" : "Glissez vos fichiers ici"}
          </p>
          <p className="mt-1.5 text-sm text-[var(--slate-500)]">
            ou <span className="font-medium text-[var(--brand-blue)] hover:underline">parcourez</span> votre ordinateur
          </p>
          <p className="mt-3 text-xs text-[var(--slate-400)]">
            PDF, images, Excel, emails · Max {MAX_FILE_SIZE_LABEL} par fichier
          </p>
        </div>
      </div>

      {/* Upload queue */}
      {hasItems && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[var(--slate-700)]">
              Fichiers selectionnes
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--slate-100)] px-1.5 text-xs font-medium text-[var(--slate-600)]">
                {uploadQueue.length}
              </span>
            </h4>
            {completedCount > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-[var(--slate-500)] transition-colors hover:text-[var(--slate-700)]"
                onClick={clearCompleted}
              >
                Effacer termines
              </button>
            )}
          </div>

          <div className="space-y-3">
            {uploadQueue.map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-4 rounded-xl border p-4 transition-all ${
                  item.status === "success"
                    ? "border-[var(--success)]/20 bg-[var(--success-light)]/50"
                    : item.status === "error"
                      ? "border-[var(--error)]/20 bg-[var(--error-light)]/50"
                      : "border-[var(--slate-100)] bg-white"
                }`}
              >
                <FileTypeIcon mimeType={item.file.type} filename={item.file.name} className="!h-11 !w-11 !rounded-xl" />

                <div className="min-w-0 flex-1">
                  {item.status === "pending" ? (
                    <input
                      type="text"
                      className="form-input h-9 w-full text-sm"
                      value={item.customName}
                      onChange={(e) => updateItemName(item.id, e.target.value)}
                      disabled={isUploading}
                      placeholder="Nom du document..."
                    />
                  ) : (
                    <div className="truncate text-sm font-medium text-[var(--slate-800)]">
                      {item.customName}
                    </div>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--slate-500)]">
                    <span>{formatFileSize(item.file.size)}</span>
                    {item.status === "uploading" && (
                      <span className="font-medium text-[var(--brand-orange)]">{item.progress}%</span>
                    )}
                    {item.status === "success" && (
                      <span className="flex items-center gap-1 font-medium text-[var(--success)]">
                        <CheckIcon className="h-3.5 w-3.5" />
                        Termine
                      </span>
                    )}
                    {item.status === "error" && (
                      <span className="font-medium text-[var(--error)]">{item.error}</span>
                    )}
                  </div>

                  {item.status === "uploading" && (
                    <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--slate-200)]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--brand-orange)] to-[var(--brand-orange-light)] transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center">
                  {item.status === "success" && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--success)]/10">
                      <CheckIcon className="h-4 w-4 text-[var(--success)]" />
                    </div>
                  )}
                  {(item.status === "pending" || item.status === "error") && (
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--slate-400)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-600)]"
                      onClick={() => removeItem(item.id)}
                      disabled={isUploading}
                      aria-label={`Retirer ${item.customName}`}
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {pendingCount > 0 && (
            <button
              className="btn btn-accent w-full"
              type="button"
              onClick={handleUploadAll}
              disabled={!canManage || isUploading}
            >
              {isUploading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Envoi en cours...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.5 17a4.5 4.5 0 01-1.44-8.765 4.5 4.5 0 018.302-3.046 3.5 3.5 0 014.504 4.272A4 4 0 0115 17H5.5zm3.75-2.75a.75.75 0 001.5 0V9.66l1.95 2.1a.75.75 0 101.1-1.02l-3.25-3.5a.75.75 0 00-1.1 0l-3.25 3.5a.75.75 0 101.1 1.02l1.95-2.1v4.59z" clipRule="evenodd" />
                  </svg>
                  Envoyer {pendingCount} fichier{pendingCount > 1 ? "s" : ""}
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Success message */}
      {successCount > 0 && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-[var(--success)]/20 bg-[var(--success-light)] px-4 py-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--success)]/10">
            <CheckIcon className="h-4 w-4 text-[var(--success)]" />
          </div>
          <span className="text-sm font-medium text-[var(--success)]">
            {successCount} fichier{successCount > 1 ? "s" : ""} ajoute{successCount > 1 ? "s" : ""} avec succes
          </span>
        </div>
      )}

      {/* Error message */}
      {globalError && (
        <div className="mt-5 rounded-xl border border-[var(--error)]/20 bg-[var(--error-light)] px-4 py-3 text-sm text-[var(--error)] whitespace-pre-line">
          {globalError}
        </div>
      )}

      {/* Screen reader announcement */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
