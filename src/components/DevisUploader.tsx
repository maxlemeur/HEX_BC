"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { CircleCheckIcon, CloudUploadIcon, XIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  MAX_FILE_SIZE_LABEL,
  validateFileForUpload,
} from "@/lib/file-validation";
import { cn } from "@/lib/utils";

import { FileTypeIcon } from "./FileTypeIcon";

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
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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
            i.id === item.id ? { ...i, status: "error", error: "Erreur réseau" } : i
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
    setAnnouncement(`Envoi de ${pendingItems.length} fichier(s) en cours…`);

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
      setAnnouncement(`${successfulUploads} fichier(s) envoyé(s) avec succès.`);
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
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleInputChange}
      />

      {/* Drop zone */}
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border-2 border-dashed transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          dragActive
            ? "border-brand-orange bg-brand-orange/5"
            : "border-border bg-surface hover:border-border-strong hover:bg-surface-subtle",
          canManage ? "cursor-pointer" : "cursor-not-allowed opacity-60"
        )}
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
        aria-label="Zone de dépôt. Glissez des fichiers ou cliquez pour sélectionner"
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
          <div
            className={cn(
              "mb-4 flex size-14 items-center justify-center rounded-lg transition-colors",
              dragActive ? "bg-brand-orange/10 text-brand-orange-dark" : "bg-muted text-muted-foreground"
            )}
          >
            <CloudUploadIcon aria-hidden="true" className="size-7" strokeWidth="1.5" />
          </div>
          <p className="text-sm font-medium text-foreground-secondary">
            {dragActive ? "Déposez vos fichiers" : "Glissez vos fichiers ici"}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            ou <span className="font-medium text-primary">parcourez</span> votre ordinateur
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            PDF, images, Excel, emails · Max {MAX_FILE_SIZE_LABEL} par fichier
          </p>
        </div>
      </div>

      {/* Upload queue */}
      {hasItems ? (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground-secondary">
              Fichiers sélectionnés
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-foreground-secondary">
                {uploadQueue.length}
              </span>
            </h4>
            {completedCount > 0 ? (
              <Button variant="ghost" size="xs" onClick={clearCompleted}>
                Retirer les fichiers envoyés
              </Button>
            ) : null}
          </div>

          <ul className="space-y-3">
            {uploadQueue.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 transition-colors sm:gap-4 sm:p-4",
                  item.status === "success"
                    ? "border-success-border bg-success-subtle"
                    : item.status === "error"
                      ? "border-danger-border bg-danger-subtle"
                      : "border-border-subtle bg-surface"
                )}
              >
                <FileTypeIcon mimeType={item.file.type} filename={item.file.name} className="!h-11 !w-11 !rounded-lg" />

                <div className="min-w-0 flex-1">
                  {item.status === "pending" ? (
                    <Input
                      type="text"
                      size="sm"
                      value={item.customName}
                      onChange={(e) => updateItemName(item.id, e.target.value)}
                      disabled={isUploading}
                      placeholder="Nom du document…"
                      aria-label={`Nom du document pour ${item.file.name}`}
                    />
                  ) : (
                    <p className="truncate text-sm font-medium text-foreground">{item.customName}</p>
                  )}

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatFileSize(item.file.size)}</span>
                    {item.status === "uploading" ? (
                      <span className="font-medium text-brand-orange-dark">{item.progress} %</span>
                    ) : null}
                    {item.status === "success" ? (
                      <span className="flex items-center gap-1 font-medium text-success">
                        <CircleCheckIcon aria-hidden="true" className="size-3.5" />
                        Envoyé
                      </span>
                    ) : null}
                    {item.status === "error" ? (
                      <span className="font-medium text-danger">{item.error}</span>
                    ) : null}
                  </div>

                  {item.status === "uploading" ? (
                    <div
                      className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={`Envoi de ${item.customName}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={item.progress}
                    >
                      <div
                        className="h-full rounded-full bg-brand-orange transition-[width] duration-300 motion-reduce:transition-none"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center">
                  {item.status === "success" ? (
                    <CircleCheckIcon aria-hidden="true" className="size-5 text-success" />
                  ) : null}
                  {item.status === "pending" || item.status === "error" ? (
                    <IconButton
                      label={`Retirer ${item.customName}`}
                      icon={<XIcon aria-hidden="true" />}
                      onClick={() => removeItem(item.id)}
                      disabled={isUploading}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {pendingCount > 0 ? (
            <Button
              variant="accent"
              size="lg"
              className="w-full"
              onClick={handleUploadAll}
              disabled={!canManage}
              loading={isUploading}
              leftIcon={<CloudUploadIcon aria-hidden="true" />}
            >
              Envoyer {pendingCount} fichier{pendingCount > 1 ? "s" : ""}
            </Button>
          ) : null}
        </div>
      ) : null}

      {successCount > 0 ? (
        <Alert variant="success" className="mt-5">
          {successCount} fichier{successCount > 1 ? "s" : ""} ajouté{successCount > 1 ? "s" : ""} avec succès
        </Alert>
      ) : null}

      {globalError ? (
        <Alert variant="danger" className="mt-5 whitespace-pre-line">
          {globalError}
        </Alert>
      ) : null}

      {/* Screen reader announcement */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
