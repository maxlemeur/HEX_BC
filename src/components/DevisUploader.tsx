"use client";

import { useRef, useState } from "react";
import { useSWRConfig } from "swr";

import {
  MAX_FILE_SIZE_LABEL,
  validateFileForUpload,
} from "@/lib/file-validation";

export type DevisUploaderProps = {
  orderId: string;
  canManage: boolean;
};

export function DevisUploader({ orderId, canManage }: DevisUploaderProps) {
  const apiUrl = `/api/purchase-orders/${orderId}/devis`;
  const { mutate } = useSWRConfig();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File) {
    const validation = validateFileForUpload(file);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setSelectedFile(file);
    setError(null);

    if (!customName.trim()) {
      setCustomName(file.name);
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  }

  async function handleUpload() {
    if (!selectedFile) {
      setError("Aucun fichier selectionne.");
      return;
    }

    const validation = validateFileForUpload(selectedFile);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    const trimmedName = customName.trim();
    if (trimmedName) {
      formData.append("name", trimmedName);
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      body: formData,
    });

    setUploading(false);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Erreur lors de l'envoi du devis.");
      return;
    }

    setSelectedFile(null);
    setCustomName("");
    await mutate(apiUrl);
  }

  return (
    <div className="dashboard-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[var(--slate-800)]">
            Ajouter un devis
          </h3>
          <p className="text-sm text-[var(--slate-500)]">
            Glissez un fichier ou choisissez-le manuellement. Taille max {MAX_FILE_SIZE_LABEL}.
          </p>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canManage || uploading}
        >
          Parcourir
        </button>
      </div>

      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        onChange={handleInputChange}
      />

      <div
        className={`mt-4 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
          dragActive
            ? "border-[var(--brand-orange)] bg-[var(--brand-orange)]/5"
            : "border-[var(--slate-200)] bg-[var(--slate-50)]"
        } ${!canManage ? "opacity-60" : ""}`}
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
          if (canManage) {
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (!canManage) return;
          if (event.key === "Enter" || event.key === " ") {
            fileInputRef.current?.click();
          }
        }}
      >
        <div className="text-sm font-medium text-[var(--slate-600)]">
          {selectedFile ? selectedFile.name : "Deposez votre devis ici"}
        </div>
        <div className="mt-1 text-xs text-[var(--slate-500)]">
          {selectedFile ? "Fichier pret a etre envoye" : "ou cliquez pour selectionner"}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label className="form-label" htmlFor="devis-name">
            Nom du devis
          </label>
          <input
            id="devis-name"
            className="form-input"
            placeholder="Nom personnalise"
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            disabled={!canManage || uploading}
          />
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={handleUpload}
          disabled={!canManage || uploading || !selectedFile}
        >
          {uploading ? "Envoi..." : "Uploader"}
        </button>
      </div>

      {!canManage ? (
        <p className="mt-3 text-xs text-[var(--slate-500)]">
          Les devis peuvent etre modifies uniquement pour les commandes en brouillon.
        </p>
      ) : null}

      {error ? (
        <div className="alert alert-error mt-4">{error}</div>
      ) : null}
    </div>
  );
}
