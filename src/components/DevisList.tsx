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
import { FileTextIcon, GripVerticalIcon, LockIcon, LucideDownload, LucideEye, LucidePencil, PlusIcon, Trash2Icon } from "lucide-react";

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
    <FileTextIcon aria-hidden="true" className={className} strokeWidth="1.5" />
  );
}

function GripIcon({ className }: { className?: string }) {
  return (
    <GripVerticalIcon aria-hidden="true" className={className} />
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <LucideEye aria-hidden="true" className={className} />
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <LucideDownload aria-hidden="true" className={className} />
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <Trash2Icon aria-hidden="true" className={className} />
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <LucidePencil aria-hidden="true" className={className} />
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-border-subtle bg-surface p-5">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-xl bg-muted" />
        <div className="flex-1 space-y-3">
          <div className="h-4 w-3/4 rounded-lg bg-muted" />
          <div className="h-3 w-1/2 rounded-lg bg-surface-subtle" />
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
      className={`group relative rounded-xl border bg-surface transition-all duration-200 ${
        isDragging
          ? "border-brand-orange shadow-xl shadow-[var(--brand-orange)]/10"
          : "border-border-subtle hover:border-border hover:shadow-md"
      }`}
    >
      {/* Main content area */}
      <div className="flex items-start gap-5 p-5">
        {/* Drag handle - subtle on the left */}
        {canManage && !isEditing && (
          <button
            type="button"
            className="mt-1 flex-shrink-0 cursor-grab rounded-lg p-1.5 text-slate-300 opacity-0 transition-all duration-200 hover:bg-surface-subtle hover:text-muted-foreground group-hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary"
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
                  className={`truncate text-base font-semibold text-slate-800 ${
                    canManage ? "cursor-pointer hover:text-primary" : ""
                  }`}
                  title={canManage ? "Double-cliquez pour renommer" : item.name}
                  onDoubleClick={canManage ? onStartEditing : undefined}
                >
                  {item.name}
                </h4>
                <span className="flex-shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {fileTypeLabel}
                </span>
              </div>

              {/* Meta info row */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="truncate font-mono text-xs" title={item.originalFilename}>
                  {item.originalFilename}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  {formatFileSize(item.fileSizeBytes)}
                </span>
                {item.createdAt && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
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
        <div className="flex items-center justify-between border-t border-slate-50 bg-surface-subtle/50 px-5 py-3">
          {isConfirmingDelete ? (
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-medium text-danger">
                Confirmer la suppression ?
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-danger px-3 text-sm font-medium text-white transition-colors hover:bg-danger"
                  onClick={onConfirmDelete}
                  type="button"
                  disabled={isRemoving}
                  aria-label="Confirmer la suppression"
                >
                  {isRemoving ? "..." : "Supprimer"}
                </button>
                <button
                  className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-muted"
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
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-muted hover:text-slate-800 disabled:opacity-50"
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
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-brand-blue-light disabled:opacity-50"
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
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-muted hover:text-slate-600 disabled:opacity-50"
                    onClick={onStartEditing}
                    type="button"
                    disabled={isRemoving}
                    aria-label={`Renommer ${item.name}`}
                    title="Renommer"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-subtle-foreground transition-colors hover:bg-danger-light hover:text-danger disabled:opacity-50"
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
  const [optimisticItems, setOptimisticItems] = useState<DevisItem[] | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);

  const serverItems = useMemo(() => data?.items ?? [], [data?.items]);
  const items = optimisticItems ?? serverItems;
  const itemIds = useMemo(() => items.map((item) => item.id), [items]);

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

    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newItems = arrayMove(items, oldIndex, newIndex);
    setOptimisticItems(newItems);

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
        setOptimisticItems(null);
        return;
      }

      await mutate();
      setOptimisticItems(null);
    } catch {
      setActionError("Erreur lors du reordonnancement.");
      setOptimisticItems(null);
    }
  }

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-slate-100">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-semibold tracking-tight text-slate-800">
              Documents joints
            </h3>
            {items.length > 0 && (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-semibold text-primary">
                {items.length}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {items.length === 0
              ? "Aucun document attache a cette commande"
              : canManage && items.length > 1
                ? "Glissez les elements pour modifier l'ordre"
                : `${items.length} document${items.length > 1 ? "s" : ""} attache${items.length > 1 ? "s" : ""}`}
          </p>
        </div>
        {!canManage && items.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <LockIcon aria-hidden="true" className="h-3.5 w-3.5" />
            Lecture seule
          </span>
        )}
      </div>

      {/* Error states */}
      {error && (
        <div className="mb-6 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          {error.message}
        </div>
      )}

      {actionError && (
        <div className="mb-6 rounded-xl border border-danger/20 bg-danger-light px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {/* Loading state */}
      {isLoading && items.length === 0 ? (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}

      {/* Empty state */}
      {items.length === 0 && !isLoading ? (
        <div className="rounded-2xl border-2 border-dashed border-border bg-gradient-to-b from-slate-50 to-white px-8 py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <DocumentIcon className="h-8 w-8 text-subtle-foreground" />
          </div>
          <h4 className="mt-5 text-base font-semibold text-foreground-secondary">
            Aucun document
          </h4>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
            Ajoutez vos devis fournisseurs pour les conserver avec la commande
          </p>
          {canManage && onAddClick && (
            <button
              className="btn btn-primary mt-6"
              type="button"
              onClick={onAddClick}
            >
              <PlusIcon aria-hidden="true" className="h-4 w-4" />
              Ajouter un document
            </button>
          )}
        </div>
      ) : items.length > 0 ? (
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
              {items.map((item) => (
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
        key={previewItem?.id ?? "devis-preview-closed"}
        open={previewItem !== null}
        onClose={() => setPreviewItem(null)}
        devis={previewItem}
      />
    </div>
  );
}
