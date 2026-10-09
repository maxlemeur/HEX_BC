"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";

import {
  MAX_FILE_SIZE_LABEL,
  validateFileForUpload,
} from "@/lib/file-validation";
import { FileTypeIcon } from "./FileTypeIcon";
import { CircleCheckIcon, CloudUploadIcon, LoaderCircleIcon, LucideX } from "lucide-react";

function CheckIcon({ className }: { className?: string }) {
  return (
    <CircleCheckIcon className={className} aria-hidden="true" />
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <LucideX className={className} aria-hidden="true" />
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
            ? "border-brand-orange bg-brand-orange/5"
            : "border-border bg-surface hover:border-border-strong hover:bg-surface-subtle"
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
            dragActive ? "bg-brand-orange/10" : "bg-muted"
          }`}>
            <CloudUploadIcon aria-hidden="true" className={`h-7 w-7 transition-colors ${dragActive ? "text-brand-orange" : "text-subtle-foreground"}`} strokeWidth="1.5" />
          </div>
          <p className="text-sm font-medium text-foreground-secondary">
            {dragActive ? "Deposez vos fichiers" : "Glissez vos fichiers ici"}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            ou <span className="font-medium text-primary hover:underline">parcourez</span> votre ordinateur
          </p>
          <p className="mt-3 text-xs text-subtle-foreground">
            PDF, images, Excel, emails · Max {MAX_FILE_SIZE_LABEL} par fichier
          </p>
        </div>
      </div>

      {/* Upload queue */}
      {hasItems && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground-secondary">
              Fichiers selectionnes
              <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-slate-600">
                {uploadQueue.length}
              </span>
            </h4>
            {completedCount > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground-secondary"
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
                    ? "border-success/20 bg-success-light/50"
                    : item.status === "error"
                      ? "border-danger/20 bg-danger-light/50"
                      : "border-border-subtle bg-surface"
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
                    <div className="truncate text-sm font-medium text-slate-800">
                      {item.customName}
                    </div>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatFileSize(item.file.size)}</span>
                    {item.status === "uploading" && (
                      <span className="font-medium text-brand-orange">{item.progress}%</span>
                    )}
                    {item.status === "success" && (
                      <span className="flex items-center gap-1 font-medium text-success">
                        <CheckIcon className="h-3.5 w-3.5" />
                        Termine
                      </span>
                    )}
                    {item.status === "error" && (
                      <span className="font-medium text-danger">{item.error}</span>
                    )}
                  </div>

                  {item.status === "uploading" && (
                    <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-orange to-brand-orange-light transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center">
                  {item.status === "success" && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10">
                      <CheckIcon className="h-4 w-4 text-success" />
                    </div>
                  )}
                  {(item.status === "pending" || item.status === "error") && (
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-muted hover:text-slate-600"
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
                  <LoaderCircleIcon aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Envoi en cours...
                </>
              ) : (
                <>
                  <CloudUploadIcon aria-hidden="true" className="h-4 w-4" />
                  Envoyer {pendingCount} fichier{pendingCount > 1 ? "s" : ""}
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Success message */}
      {successCount > 0 && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-success/20 bg-success-light px-4 py-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-success/10">
            <CheckIcon className="h-4 w-4 text-success" />
          </div>
          <span className="text-sm font-medium text-success">
            {successCount} fichier{successCount > 1 ? "s" : ""} ajoute{successCount > 1 ? "s" : ""} avec succes
          </span>
        </div>
      )}

      {/* Error message */}
      {globalError && (
        <div className="mt-5 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger whitespace-pre-line">
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
