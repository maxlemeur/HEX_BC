"use client";

import { useState } from "react";
import useSWR from "swr";

export type DevisItem = {
  id: string;
  name: string;
  originalFilename: string;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
  position: number;
  downloadUrl: string | null;
};

type DevisApiResponse = {
  items: DevisItem[];
};

type DevisListProps = {
  orderId: string;
  initialItems: DevisItem[];
  canManage: boolean;
};

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? "Impossible de charger les devis.");
  }
  return (await response.json()) as DevisApiResponse;
};

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} o`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} Ko`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} Mo`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function DevisList({ orderId, initialItems, canManage }: DevisListProps) {
  const apiUrl = `/api/purchase-orders/${orderId}/devis`;
  const { data, error, isLoading, mutate } = useSWR<DevisApiResponse>(
    apiUrl,
    fetcher,
    {
      fallbackData: { items: initialItems },
    }
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = data?.items ?? [];

  async function handleRename(item: DevisItem) {
    const trimmedName = editingName.trim();
    if (!trimmedName) {
      setActionError("Le nom du devis est obligatoire.");
      return;
    }

    setSavingId(item.id);
    setActionError(null);

    const response = await fetch(`${apiUrl}/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmedName }),
    });

    setSavingId(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setActionError(payload?.error ?? "Erreur lors du renommage.");
      return;
    }

    setEditingId(null);
    setEditingName("");
    await mutate();
  }

  async function handleDelete(item: DevisItem) {
    if (!window.confirm(`Supprimer le devis "${item.name}" ?`)) {
      return;
    }

    setRemovingId(item.id);
    setActionError(null);

    const response = await fetch(`${apiUrl}/${item.id}`, {
      method: "DELETE",
    });

    setRemovingId(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setActionError(payload?.error ?? "Erreur lors de la suppression.");
      return;
    }

    await mutate();
  }

  return (
    <div className="dashboard-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[var(--slate-800)]">
            Devis attaches
          </h3>
          <p className="text-sm text-[var(--slate-500)]">
            {items.length} fichier{items.length > 1 ? "s" : ""}
          </p>
        </div>
        {!canManage && (
          <span className="rounded-full bg-[var(--slate-100)] px-3 py-1 text-xs font-medium text-[var(--slate-500)]">
            Lecture seule
          </span>
        )}
      </div>

      {error ? (
        <div className="alert alert-error mt-4">{error.message}</div>
      ) : null}

      {actionError ? (
        <div className="alert alert-error mt-4">{actionError}</div>
      ) : null}

      {isLoading && items.length === 0 ? (
        <div className="mt-4 text-sm text-[var(--slate-500)]">
          Chargement des devis...
        </div>
      ) : null}

      {items.length === 0 && !isLoading ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-6 text-center text-sm text-[var(--slate-500)]">
          Aucun devis attache pour le moment.
        </div>
      ) : (
        <div className="mt-4 divide-y divide-[var(--slate-100)]">
          {items.map((item) => {
            const isEditing = editingId === item.id;
            const isSaving = savingId === item.id;
            const isRemoving = removingId === item.id;

            return (
              <div
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-4 py-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-[var(--slate-800)]">
                      {item.name}
                    </span>
                    <span className="rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-xs text-[var(--slate-500)]">
                      {item.mimeType || "Fichier"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--slate-500)]">
                    {item.originalFilename} · {formatFileSize(item.fileSizeBytes)}
                    {item.createdAt ? ` · Ajoute le ${formatDate(item.createdAt)}` : ""}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isEditing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="form-input h-10 min-w-[200px]"
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        disabled={isSaving}
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleRename(item)}
                        type="button"
                        disabled={isSaving}
                      >
                        {isSaving ? "Enregistrement..." : "Enregistrer"}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setEditingId(null);
                          setEditingName("");
                        }}
                        type="button"
                        disabled={isSaving}
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          if (item.downloadUrl) {
                            window.open(item.downloadUrl, "_blank", "noopener,noreferrer");
                          }
                        }}
                        type="button"
                        disabled={!item.downloadUrl}
                      >
                        Telecharger
                      </button>
                      {canManage && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setEditingId(item.id);
                            setEditingName(item.name);
                            setActionError(null);
                          }}
                          type="button"
                          disabled={isRemoving}
                        >
                          Renommer
                        </button>
                      )}
                      {canManage && (
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(item)}
                          type="button"
                          disabled={isRemoving}
                        >
                          {isRemoving ? "Suppression..." : "Supprimer"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
