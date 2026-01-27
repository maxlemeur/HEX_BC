"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { FileTypeIcon, getFileTypeLabel } from "./FileTypeIcon";
import { DevisPreviewModal, isPreviewableType } from "./DevisPreviewModal";

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
  onAddClick?: () => void;
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

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M28 4H12a4 4 0 0 0-4 4v32a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4V16l-12-12z" />
      <polyline points="28 4 28 16 40 16" />
      <line x1="16" y1="24" x2="32" y2="24" />
      <line x1="16" y1="32" x2="32" y2="32" />
    </svg>
  );
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <circle cx="5" cy="4" r="1.2" />
      <circle cx="11" cy="4" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="11" cy="12" r="1.2" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
      <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
      <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
      <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
    </svg>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-[var(--slate-100)] bg-white p-5">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl bg-[var(--slate-100)]" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-3/4 rounded-lg bg-[var(--slate-100)]" />
          <div className="h-3 w-1/2 rounded-lg bg-[var(--slate-50)]" />
        </div>
      </div>
    </div>
  );
}

type SortableRowProps = {
  item: DevisItem;
  canManage: boolean;
  isEditing: boolean;
  isSaving: boolean;
  isRemoving: boolean;
  isConfirmingDelete: boolean;
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onEditingNameChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onRename: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onPreview: () => void;
};

function SortableDevisRow({
  item,
  canManage,
  isEditing,
  isSaving,
  isRemoving,
  isConfirmingDelete,
  editingName,
  editInputRef,
  onEditingNameChange,
  onKeyDown,
  onStartEditing,
  onCancelEditing,
  onRename,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onPreview,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !canManage || isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const fileTypeLabel = getFileTypeLabel(item.mimeType, item.originalFilename);

  return (
    <li
      ref={setNodeRef}
      style={style}
      role="listitem"
      aria-label={`Devis: ${item.name}`}
      className={`group relative rounded-xl border bg-white transition-all duration-200 ${
        isDragging
          ? "border-[var(--brand-orange)] shadow-xl shadow-[var(--brand-orange)]/10"
          : "border-[var(--slate-100)] hover:border-[var(--slate-200)] hover:shadow-md"
      }`}
    >
      {/* Main content area */}
      <div className="flex items-start gap-5 p-5">
        {/* Drag handle - subtle on the left */}
        {canManage && !isEditing && (
          <button
            type="button"
            className="mt-1 flex-shrink-0 cursor-grab rounded-lg p-1.5 text-[var(--slate-300)] opacity-0 transition-all duration-200 hover:bg-[var(--slate-50)] hover:text-[var(--slate-500)] group-hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)]"
            {...attributes}
            {...listeners}
            aria-label="Glisser pour reordonner"
          >
            <GripIcon className="h-4 w-4" />
          </button>
        )}

        {/* File icon - larger and more prominent */}
        <div className="flex-shrink-0">
          <FileTypeIcon mimeType={item.mimeType} filename={item.originalFilename} className="!h-12 !w-12 !rounded-xl" />
        </div>

        {/* File info */}
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex items-center gap-3">
              <input
                ref={editInputRef}
                className="form-input h-10 flex-1"
                value={editingName}
                onChange={(event) => onEditingNameChange(event.target.value)}
                onKeyDown={onKeyDown}
                disabled={isSaving}
                aria-label="Nouveau nom du devis"
                placeholder="Nom du document..."
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={onRename}
                type="button"
                disabled={isSaving}
              >
                {isSaving ? "..." : "Enregistrer"}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={onCancelEditing}
                type="button"
                disabled={isSaving}
              >
                Annuler
              </button>
            </div>
          ) : (
            <>
              {/* Title row */}
              <div className="flex items-center gap-3">
                <h4
                  className={`truncate text-base font-semibold text-[var(--slate-800)] ${
                    canManage ? "cursor-pointer hover:text-[var(--brand-blue)]" : ""
                  }`}
                  title={canManage ? "Double-cliquez pour renommer" : item.name}
                  onDoubleClick={canManage ? onStartEditing : undefined}
                >
                  {item.name}
                </h4>
                <span className="flex-shrink-0 rounded-md bg-[var(--slate-100)] px-2 py-0.5 text-xs font-medium text-[var(--slate-500)]">
                  {fileTypeLabel}
                </span>
              </div>

              {/* Meta info row */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--slate-500)]">
                <span className="truncate font-mono text-xs" title={item.originalFilename}>
                  {item.originalFilename}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-[var(--slate-300)]" />
                  {formatFileSize(item.fileSizeBytes)}
                </span>
                {item.createdAt && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-[var(--slate-300)]" />
                    {formatDate(item.createdAt)}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Actions bar - separate section at bottom */}
      {!isEditing && (
        <div className="flex items-center justify-between border-t border-[var(--slate-50)] bg-[var(--slate-50)]/50 px-5 py-3">
          {isConfirmingDelete ? (
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-medium text-[var(--error)]">
                Confirmer la suppression ?
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--error)] px-3 text-sm font-medium text-white transition-colors hover:bg-red-600"
                  onClick={onConfirmDelete}
                  type="button"
                  disabled={isRemoving}
                  aria-label="Confirmer la suppression"
                >
                  {isRemoving ? "..." : "Supprimer"}
                </button>
                <button
                  className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-100)]"
                  onClick={onCancelDelete}
                  type="button"
                  disabled={isRemoving}
                  aria-label="Annuler la suppression"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Primary actions - left side */}
              <div className="flex items-center gap-2">
                {isPreviewableType(item.mimeType, item.originalFilename) && (
                  <button
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-800)] disabled:opacity-50"
                    onClick={onPreview}
                    type="button"
                    disabled={!item.downloadUrl}
                    aria-label={`Apercu ${item.name}`}
                  >
                    <EyeIcon className="h-4 w-4" />
                    <span>Apercu</span>
                  </button>
                )}
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--brand-blue)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-blue-light)] disabled:opacity-50"
                  onClick={() => {
                    if (item.downloadUrl) {
                      window.open(item.downloadUrl, "_blank", "noopener,noreferrer");
                    }
                  }}
                  type="button"
                  disabled={!item.downloadUrl}
                  aria-label={`Telecharger ${item.name}`}
                >
                  <DownloadIcon className="h-4 w-4" />
                  <span>Telecharger</span>
                </button>
              </div>

              {/* Secondary actions - right side, only if can manage */}
              {canManage && (
                <div className="flex items-center gap-1">
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--slate-400)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-600)] disabled:opacity-50"
                    onClick={onStartEditing}
                    type="button"
                    disabled={isRemoving}
                    aria-label={`Renommer ${item.name}`}
                    title="Renommer"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--slate-400)] transition-colors hover:bg-[var(--error-light)] hover:text-[var(--error)] disabled:opacity-50"
                    onClick={onRequestDelete}
                    type="button"
                    disabled={isRemoving}
                    aria-label={`Supprimer ${item.name}`}
                    title="Supprimer"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function DevisList({
  orderId,
  initialItems,
  canManage,
  onAddClick,
}: DevisListProps) {
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
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<DevisItem | null>(null);
  const [localItems, setLocalItems] = useState<DevisItem[]>(initialItems);

  const editInputRef = useRef<HTMLInputElement>(null);

  const serverItems = useMemo(() => data?.items ?? [], [data?.items]);

  useEffect(() => {
    setLocalItems(serverItems);
  }, [serverItems]);

  const itemIds = useMemo(() => localItems.map((item) => item.id), [localItems]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  function startEditing(item: DevisItem) {
    if (!canManage) return;
    setEditingId(item.id);
    setEditingName(item.name);
    setActionError(null);
    setConfirmingDeleteId(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingName("");
  }

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

  function handleKeyDown(event: React.KeyboardEvent, item: DevisItem) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    } else if (event.key === "Enter") {
      event.preventDefault();
      handleRename(item);
    }
  }

  function requestDelete(item: DevisItem) {
    setConfirmingDeleteId(item.id);
    setEditingId(null);
    setActionError(null);
  }

  function cancelDelete() {
    setConfirmingDeleteId(null);
  }

  async function confirmDelete(item: DevisItem) {
    setRemovingId(item.id);
    setActionError(null);

    const response = await fetch(`${apiUrl}/${item.id}`, {
      method: "DELETE",
    });

    setRemovingId(null);
    setConfirmingDeleteId(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setActionError(payload?.error ?? "Erreur lors de la suppression.");
      return;
    }

    await mutate();
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = localItems.findIndex((item) => item.id === active.id);
    const newIndex = localItems.findIndex((item) => item.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newItems = arrayMove(localItems, oldIndex, newIndex);
    setLocalItems(newItems);

    const orderedIds = newItems.map((item) => item.id);

    try {
      const response = await fetch(`${apiUrl}/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setActionError(payload?.error ?? "Erreur lors du reordonnancement.");
        setLocalItems(serverItems);
        return;
      }

      await mutate();
    } catch {
      setActionError("Erreur lors du reordonnancement.");
      setLocalItems(serverItems);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-[var(--slate-100)]">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-semibold tracking-tight text-[var(--slate-800)]">
              Documents joints
            </h3>
            {localItems.length > 0 && (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--brand-blue)]/10 px-2 text-xs font-semibold text-[var(--brand-blue)]">
                {localItems.length}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-[var(--slate-500)]">
            {localItems.length === 0
              ? "Aucun document attache a cette commande"
              : canManage && localItems.length > 1
                ? "Glissez les elements pour modifier l'ordre"
                : `${localItems.length} document${localItems.length > 1 ? "s" : ""} attache${localItems.length > 1 ? "s" : ""}`}
          </p>
        </div>
        {!canManage && localItems.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--slate-100)] px-3 py-1.5 text-xs font-medium text-[var(--slate-500)]">
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
            </svg>
            Lecture seule
          </span>
        )}
      </div>

      {/* Error states */}
      {error && (
        <div className="mb-6 rounded-xl border border-[var(--error)]/20 bg-[var(--error-light)] px-4 py-3 text-sm text-[var(--error)]">
          {error.message}
        </div>
      )}

      {actionError && (
        <div className="mb-6 rounded-xl border border-[var(--error)]/20 bg-[var(--error-light)] px-4 py-3 text-sm text-[var(--error)]">
          {actionError}
        </div>
      )}

      {/* Loading state */}
      {isLoading && localItems.length === 0 ? (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}

      {/* Empty state */}
      {localItems.length === 0 && !isLoading ? (
        <div className="rounded-2xl border-2 border-dashed border-[var(--slate-200)] bg-gradient-to-b from-[var(--slate-50)] to-white px-8 py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--slate-100)]">
            <DocumentIcon className="h-8 w-8 text-[var(--slate-400)]" />
          </div>
          <h4 className="mt-5 text-base font-semibold text-[var(--slate-700)]">
            Aucun document
          </h4>
          <p className="mx-auto mt-2 max-w-xs text-sm text-[var(--slate-500)]">
            Ajoutez vos devis fournisseurs pour les conserver avec la commande
          </p>
          {canManage && onAddClick && (
            <button
              className="btn btn-primary mt-6"
              type="button"
              onClick={onAddClick}
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              Ajouter un document
            </button>
          )}
        </div>
      ) : localItems.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <ul
              role="list"
              aria-label="Liste des devis attaches"
              className="space-y-4"
            >
              {localItems.map((item) => (
                <SortableDevisRow
                  key={item.id}
                  item={item}
                  canManage={canManage}
                  isEditing={editingId === item.id}
                  isSaving={savingId === item.id}
                  isRemoving={removingId === item.id}
                  isConfirmingDelete={confirmingDeleteId === item.id}
                  editingName={editingName}
                  editInputRef={editInputRef}
                  onEditingNameChange={setEditingName}
                  onKeyDown={(e) => handleKeyDown(e, item)}
                  onStartEditing={() => startEditing(item)}
                  onCancelEditing={cancelEditing}
                  onRename={() => handleRename(item)}
                  onRequestDelete={() => requestDelete(item)}
                  onCancelDelete={cancelDelete}
                  onConfirmDelete={() => confirmDelete(item)}
                  onPreview={() => setPreviewItem(item)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : null}

      <DevisPreviewModal
        open={previewItem !== null}
        onClose={() => setPreviewItem(null)}
        devis={previewItem}
      />
    </div>
  );
}
