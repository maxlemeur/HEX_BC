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
import {
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  GripVerticalIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";

import { useConfirm } from "@/components/feedback/confirm-provider";
import { EmptyState } from "@/components/layout/empty-state";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex items-start gap-4">
        <Skeleton className="size-12 rounded-lg" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
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
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onEditingNameChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onRename: () => void;
  onDelete: () => void;
  onPreview: () => void;
};

function SortableDevisRow({
  item,
  canManage,
  isEditing,
  isSaving,
  isRemoving,
  editingName,
  editInputRef,
  onEditingNameChange,
  onKeyDown,
  onStartEditing,
  onCancelEditing,
  onRename,
  onDelete,
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
      className={cn(
        "relative rounded-lg border bg-surface transition-[border-color,box-shadow] duration-200",
        isDragging ? "border-brand-orange shadow-lg" : "border-border-subtle hover:border-border hover:shadow-sm"
      )}
    >
      <div className="flex items-start gap-3 p-4 sm:gap-4">
        {canManage && !isEditing ? (
          <button
            type="button"
            className="mt-2 inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label={`Déplacer ${item.name}`}
          >
            <GripVerticalIcon aria-hidden="true" className="size-4" />
          </button>
        ) : null}

        <FileTypeIcon mimeType={item.mimeType} filename={item.originalFilename} className="!h-12 !w-12 !rounded-lg" />

        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                ref={editInputRef}
                size="sm"
                className="min-w-40 flex-1"
                value={editingName}
                onChange={(event) => onEditingNameChange(event.target.value)}
                onKeyDown={onKeyDown}
                disabled={isSaving}
                aria-label="Nouveau nom du devis"
                placeholder="Nom du document…"
              />
              <Button variant="primary" size="md" onClick={onRename} loading={isSaving}>
                Enregistrer
              </Button>
              <Button variant="ghost" size="md" onClick={onCancelEditing} disabled={isSaving}>
                Annuler
              </Button>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <p
                  className={cn(
                    "truncate text-base font-semibold text-foreground",
                    canManage && "cursor-text hover:text-primary"
                  )}
                  onDoubleClick={canManage ? onStartEditing : undefined}
                >
                  {item.name}
                </p>
                <Badge variant="neutral" size="sm">
                  {fileTypeLabel}
                </Badge>
              </div>

              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="max-w-full truncate font-mono text-xs">{item.originalFilename}</span>
                <span>{formatFileSize(item.fileSizeBytes)}</span>
                {item.createdAt ? <span>{formatDate(item.createdAt)}</span> : null}
              </p>
            </>
          )}
        </div>
      </div>

      {!isEditing ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle bg-surface-subtle px-4 py-2.5">
          <div className="flex items-center gap-2">
            {isPreviewableType(item.mimeType, item.originalFilename) ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<EyeIcon aria-hidden="true" />}
                onClick={onPreview}
                disabled={!item.downloadUrl}
                aria-label={`Aperçu de ${item.name}`}
              >
                Aperçu
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              leftIcon={<DownloadIcon aria-hidden="true" />}
              onClick={() => {
                if (item.downloadUrl) {
                  window.open(item.downloadUrl, "_blank", "noopener,noreferrer");
                }
              }}
              disabled={!item.downloadUrl}
              aria-label={`Télécharger ${item.name}`}
            >
              Télécharger
            </Button>
          </div>

          {canManage ? (
            <div className="flex items-center gap-1">
              <IconButton
                label={`Renommer ${item.name}`}
                icon={<PencilIcon aria-hidden="true" />}
                onClick={onStartEditing}
                disabled={isRemoving}
              />
              <IconButton
                label={`Supprimer ${item.name}`}
                icon={<Trash2Icon aria-hidden="true" />}
                className="hover:bg-danger-subtle hover:text-danger"
                onClick={onDelete}
                loading={isRemoving}
              />
            </div>
          ) : null}
        </div>
      ) : null}
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
  const confirm = useConfirm();
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
      void handleRename(item);
    }
  }

  async function handleDelete(item: DevisItem) {
    setEditingId(null);
    setActionError(null);

    const confirmed = await confirm({
      title: "Supprimer ce document ?",
      description: `« ${item.name} » sera retiré du bon de commande.`,
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

    setRemovingId(item.id);

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
        setActionError(payload?.error ?? "Erreur lors du réordonnancement.");
        setOptimisticItems(null);
        return;
      }

      await mutate();
      setOptimisticItems(null);
    } catch {
      setActionError("Erreur lors du réordonnancement.");
      setOptimisticItems(null);
    }
  }

  const description =
    items.length === 0
      ? "Aucun document joint à ce bon de commande."
      : canManage && items.length > 1
        ? "Glissez les documents pour modifier leur ordre."
        : `${items.length} document${items.length > 1 ? "s" : ""} joint${items.length > 1 ? "s" : ""}`;

  return (
    <Card>
      <CardHeader className="items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">Documents joints</CardTitle>
            {items.length > 0 ? (
              <Badge variant="brand" size="sm">
                {items.length}
              </Badge>
            ) : null}
          </div>
          <CardDescription className="text-sm">{description}</CardDescription>
        </div>
        {!canManage && items.length > 0 ? (
          <Badge variant="neutral">
            <LockIcon aria-hidden="true" />
            Lecture seule
          </Badge>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? <Alert variant="danger">{error.message}</Alert> : null}
        {actionError ? <Alert variant="danger">{actionError}</Alert> : null}

        {isLoading && items.length === 0 ? (
          <div className="space-y-3" role="status" aria-label="Chargement des documents…">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : null}

        {items.length === 0 && !isLoading ? (
          <EmptyState
            icon={<FileTextIcon aria-hidden="true" />}
            title="Aucun document"
            description="Ajoutez vos devis fournisseurs pour les conserver avec le bon de commande."
            action={
              canManage && onAddClick ? (
                <Button variant="primary" size="lg" leftIcon={<PlusIcon aria-hidden="true" />} onClick={onAddClick}>
                  Ajouter un document
                </Button>
              ) : null
            }
          />
        ) : items.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              <ul aria-label="Documents joints" className="space-y-3">
                {items.map((item) => (
                  <SortableDevisRow
                    key={item.id}
                    item={item}
                    canManage={canManage}
                    isEditing={editingId === item.id}
                    isSaving={savingId === item.id}
                    isRemoving={removingId === item.id}
                    editingName={editingName}
                    editInputRef={editInputRef}
                    onEditingNameChange={setEditingName}
                    onKeyDown={(e) => handleKeyDown(e, item)}
                    onStartEditing={() => startEditing(item)}
                    onCancelEditing={cancelEditing}
                    onRename={() => void handleRename(item)}
                    onDelete={() => void handleDelete(item)}
                    onPreview={() => setPreviewItem(item)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : null}
      </CardContent>

      <DevisPreviewModal
        key={previewItem?.id ?? "devis-preview-closed"}
        open={previewItem !== null}
        onClose={() => setPreviewItem(null)}
        devis={previewItem}
      />
    </Card>
  );
}
