"use client";

import Link from "next/link";
import { useCallback, useId, useState } from "react";
import useSWR from "swr";

import { PlanFileCard, formatFileSize } from "@/components/takeoff/PlanFileCard";
import { PlanFileUploadZone } from "@/components/takeoff/PlanFileUploadZone";
import { ConfirmModal } from "@/components/ui-legacy/ConfirmModal";
import { Button } from "@/components/ui-legacy/Button";
import {
  deletePlanFile as apiDeletePlanFile,
  deletePlanSet as apiDeletePlanSet,
  fetchPlanFiles,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import { resolvePlanSetFlowDescriptor } from "@/lib/takeoff/flow-hierarchy";
import type { PlanFileListItem, PlanSetListItem } from "@/lib/takeoff/types";
import { ChevronRightIcon, PencilIcon, Trash2Icon } from "lucide-react";

type PlanSetCardProps = {
  planSet: PlanSetListItem;
  versionId?: string | null;
  launchHref?: string | null;
  launchLabel?: string;
  deletePlanSetHandler?: (setId: string) => Promise<unknown>;
  onDeleted: () => void;
  onFilesChanged: () => void;
  onUpdated: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toApiErrorMessage(payload: unknown, fallback: string) {
  if (isRecord(payload)) {
    const nestedError = payload.error;
    if (isRecord(nestedError) && typeof nestedError.message === "string") {
      return nestedError.message;
    }

    if (typeof payload.message === "string") {
      return payload.message;
    }
  }

  return fallback;
}

async function updatePlanSetRequest(input: {
  setId: string;
  name: string;
  description: string | null;
}) {
  const response = await fetch(
    `/api/takeoff/plan-sets/${encodeURIComponent(input.setId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        name: input.name,
        description: input.description,
      }),
    }
  );
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      toApiErrorMessage(payload, "Impossible de mettre à jour le jeu de plans.")
    );
  }
}

const absoluteDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatAbsoluteDate(isoDate: string) {
  return absoluteDateFormatter.format(new Date(isoDate));
}

function formatRelativeTime(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

export function PlanSetCard({
  planSet,
  versionId,
  launchHref,
  launchLabel,
  deletePlanSetHandler,
  onDeleted,
  onFilesChanged,
  onUpdated,
}: PlanSetCardProps) {
  const flowDescriptor = resolvePlanSetFlowDescriptor(planSet);
  const resolvedLaunchHref =
    launchHref ??
    (versionId
      ? `/dashboard/estimates/${versionId}/takeoff/new?plan_set_id=${planSet.id}`
      : null);
  const resolvedLaunchLabel = launchLabel ?? "Lancer l'extraction";
  const regionId = useId();
  const [expanded, setExpanded] = useState(false);
  const [deleteSetModalOpen, setDeleteSetModalOpen] = useState(false);
  const [deletingSet, setDeletingSet] = useState(false);
  const [deleteFileTarget, setDeleteFileTarget] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const [editingSet, setEditingSet] = useState(false);
  const [editName, setEditName] = useState(planSet.name);
  const [editDescription, setEditDescription] = useState(planSet.description ?? "");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingSet, setSavingSet] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const filesSWRKey = expanded ? `plan-files:${planSet.id}` : null;
  const {
    data: files,
    error: filesError,
    mutate: mutateFiles,
  } = useSWR<PlanFileListItem[]>(filesSWRKey, () => fetchPlanFiles(planSet.id), {
    revalidateOnFocus: false,
  });

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleDeleteSet = useCallback(async () => {
    setDeletingSet(true);
    try {
      const deleteSet = deletePlanSetHandler ?? apiDeletePlanSet;
      await deleteSet(planSet.id);
      setDeleteSetModalOpen(false);
      setAnnouncement(`Jeu "${planSet.name}" supprime.`);
      onDeleted();
    } catch (err) {
      const msg = isTakeoffApiError(err)
        ? err.message
        : "Impossible de supprimer le jeu de plans.";
      setAnnouncement(msg);
    } finally {
      setDeletingSet(false);
    }
  }, [deletePlanSetHandler, planSet.id, planSet.name, onDeleted]);

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      setDeleteFileTarget(fileId);
    },
    []
  );

  const confirmDeleteFile = useCallback(async () => {
    if (!deleteFileTarget) return;
    setDeletingFile(true);
    try {
      await apiDeletePlanFile(planSet.id, deleteFileTarget);
      setAnnouncement("Fichier supprime.");
      await mutateFiles();
      onFilesChanged();
    } catch (err) {
      const msg = isTakeoffApiError(err)
        ? err.message
        : "Impossible de supprimer le fichier.";
      setAnnouncement(msg);
    } finally {
      setDeletingFile(false);
      setDeleteFileTarget(null);
    }
  }, [deleteFileTarget, planSet.id, mutateFiles, onFilesChanged]);

  const handleUploadsComplete = useCallback(() => {
    mutateFiles();
    onFilesChanged();
  }, [mutateFiles, onFilesChanged]);

  const handleStartEdit = useCallback(() => {
    setEditName(planSet.name);
    setEditDescription(planSet.description ?? "");
    setEditError(null);
    setEditingSet(true);
    setExpanded(true);
  }, [planSet.name, planSet.description]);

  const handleCancelEdit = useCallback(() => {
    if (savingSet) return;
    setEditingSet(false);
    setEditError(null);
    setEditName(planSet.name);
    setEditDescription(planSet.description ?? "");
  }, [planSet.name, planSet.description, savingSet]);

  const handleSaveEdit = useCallback(async () => {
    const normalizedName = editName.trim();
    if (!normalizedName) {
      setEditError("Le nom du jeu est obligatoire.");
      return;
    }

    setSavingSet(true);
    setEditError(null);
    try {
      await updatePlanSetRequest({
        setId: planSet.id,
        name: normalizedName,
        description: editDescription.trim() || null,
      });
      setEditingSet(false);
      setAnnouncement(`Jeu "${normalizedName}" mis à jour.`);
      onUpdated();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible de mettre à jour le jeu de plans.";
      setEditError(message);
      setAnnouncement(message);
    } finally {
      setSavingSet(false);
    }
  }, [editDescription, editName, onUpdated, planSet.id]);

  return (
    <div className="dashboard-card overflow-hidden">
      {/* Header row */}
      <div className="flex w-full flex-wrap items-center gap-2 px-4 py-4 sm:flex-nowrap sm:gap-4 sm:px-5">
        {/* Accordion trigger */}
        <button
          type="button"
          className="flex min-w-0 basis-full items-center gap-3 text-left transition hover:opacity-80 sm:basis-auto sm:flex-1 sm:gap-4"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={handleToggle}
        >
          {/* Chevron */}
          <ChevronRightIcon className={`h-4 w-4 shrink-0 text-subtle-foreground transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />

          {/* Set info */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="line-clamp-2 text-sm font-semibold text-slate-800 sm:truncate">
                {planSet.name}
              </h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${flowDescriptor.badgeClassName}`}
              >
                {flowDescriptor.label}
              </span>
              <span className="text-[11px] text-muted-foreground sm:hidden">
                {planSet.file_count} {planSet.file_count === 1 ? "plan" : "plans"}
              </span>
            </div>
            {planSet.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:truncate">
                {planSet.description}
              </p>
            )}
          </div>

          {/* Compact metadata */}
          <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground sm:flex">
            <span>
              {planSet.file_count}{" "}
              {planSet.file_count === 1 ? "plan" : "plans"}
            </span>
            {planSet.total_size_bytes > 0 ? (
              <span className="hidden sm:inline">
                {formatFileSize(planSet.total_size_bytes)}
              </span>
            ) : null}
            <span className="hidden md:inline" title={formatRelativeTime(planSet.created_at)}>
              {formatAbsoluteDate(planSet.created_at)}
            </span>
            <span className="hidden sm:inline">
              {formatRelativeTime(planSet.updated_at)}
            </span>
          </div>
        </button>

        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          {/* Edit set button */}
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition hover:bg-muted hover:text-foreground-secondary sm:h-8 sm:w-8"
            aria-label={`Modifier le jeu "${planSet.name}"`}
            onClick={handleStartEdit}
          >
            <PencilIcon className="h-4 w-4" aria-hidden="true" />
          </button>

          {/* Delete set button */}
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-subtle-foreground transition hover:bg-muted hover:text-danger sm:h-8 sm:w-8"
            aria-label={`Supprimer le jeu "${planSet.name}"`}
            onClick={() => setDeleteSetModalOpen(true)}
          >
            <Trash2Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body — expanded content */}
      <div
        id={regionId}
        role="region"
        aria-label={`Contenu du jeu "${planSet.name}"`}
        hidden={!expanded}
      >
        {expanded && (
          <div className="border-t border-border px-5 pb-5 pt-4">
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
                flowDescriptor.kind === "legacy"
                  ? "border-warning/20 bg-warning/5 text-foreground-secondary"
                  : "border-success/15 bg-success/5 text-foreground-secondary"
              }`}
            >
              {flowDescriptor.summary}
            </div>

            {/* Set edit form */}
            {editingSet && (
              <div className="mb-4 rounded-lg border border-border bg-surface-subtle p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor={`plan-set-name-${planSet.id}`}
                      className="form-label"
                    >
                      Nom du jeu
                    </label>
                    <input
                      id={`plan-set-name-${planSet.id}`}
                      type="text"
                      className="form-input"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      maxLength={255}
                      disabled={savingSet}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label
                      htmlFor={`plan-set-description-${planSet.id}`}
                      className="form-label"
                    >
                      Description (optionnel)
                    </label>
                    <textarea
                      id={`plan-set-description-${planSet.id}`}
                      className="form-input min-h-[80px] resize-y"
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      maxLength={2000}
                      disabled={savingSet}
                    />
                  </div>
                </div>

                {editError && (
                  <div className="mt-3 alert alert-error" role="alert">
                    {editError}
                  </div>
                )}

                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelEdit}
                    disabled={savingSet}
                  >
                    Annuler
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveEdit}
                    loading={savingSet}
                    disabled={!editName.trim()}
                  >
                    Enregistrer
                  </Button>
                </div>
              </div>
            )}

            {/* Upload zone */}
            <PlanFileUploadZone
              setId={planSet.id}
              onUploadsComplete={handleUploadsComplete}
            />

            {/* Files list */}
            {filesError && (
              <div className="mt-4 alert alert-error" role="alert">
                {isTakeoffApiError(filesError)
                  ? filesError.message
                  : "Impossible de charger les fichiers."}
              </div>
            )}

            {files && files.length === 0 && !filesError && (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Aucun fichier dans ce jeu. Glissez des PDF ci-dessus.
              </p>
            )}

            {files && files.length > 0 && (
              <div className="mt-4 space-y-2">
                {files.map((file) => (
                  <PlanFileCard
                    key={file.id}
                    file={file}
                    onDelete={handleDeleteFile}
                    deleting={deletingFile && deleteFileTarget === file.id}
                  />
                ))}
              </div>
            )}

            {/* Extraction link */}
            {files && files.length > 0 && resolvedLaunchHref && (
              <div className="mt-4 flex justify-end">
                <Link
                  href={resolvedLaunchHref}
                  className="btn btn-primary btn-sm"
                >
                  {resolvedLaunchLabel}
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete set confirm modal */}
      <ConfirmModal
        open={deleteSetModalOpen}
        title="Supprimer le jeu de plans"
        message={`Etes-vous sur de vouloir supprimer "${planSet.name}" et tous ses fichiers ? Cette action est irreversible.`}
        confirmLabel="Supprimer"
        variant="danger"
        onConfirm={handleDeleteSet}
        onCancel={() => !deletingSet && setDeleteSetModalOpen(false)}
      />

      {/* Delete file confirm modal */}
      <ConfirmModal
        open={deleteFileTarget !== null}
        title="Supprimer le fichier"
        message="Etes-vous sur de vouloir supprimer ce fichier ? Cette action est irreversible."
        confirmLabel="Supprimer"
        variant="danger"
        onConfirm={confirmDeleteFile}
        onCancel={() => !deletingFile && setDeleteFileTarget(null)}
      />

      {/* Live announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
