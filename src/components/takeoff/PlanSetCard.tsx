"use client";

import Link from "next/link";
import { useCallback, useId, useState } from "react";
import useSWR from "swr";

import { PlanFileCard } from "@/components/takeoff/PlanFileCard";
import { PlanFileUploadZone } from "@/components/takeoff/PlanFileUploadZone";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/Button";
import {
  deletePlanFile as apiDeletePlanFile,
  deletePlanSet as apiDeletePlanSet,
  fetchPlanFiles,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import type { PlanFileListItem, PlanSetListItem } from "@/lib/takeoff/types";

type PlanSetCardProps = {
  planSet: PlanSetListItem;
  versionId: string;
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
      toApiErrorMessage(payload, "Impossible de mettre a jour le jeu de plans.")
    );
  }
}

function formatRelativeTime(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "A l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days}j`;
}

export function PlanSetCard({
  planSet,
  versionId,
  onDeleted,
  onFilesChanged,
  onUpdated,
}: PlanSetCardProps) {
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
      await apiDeletePlanSet(planSet.id);
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
  }, [planSet.id, planSet.name, onDeleted]);

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
      setAnnouncement(`Jeu "${normalizedName}" mis a jour.`);
      onUpdated();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible de mettre a jour le jeu de plans.";
      setEditError(message);
      setAnnouncement(message);
    } finally {
      setSavingSet(false);
    }
  }, [editDescription, editName, onUpdated, planSet.id]);

  return (
    <div className="dashboard-card overflow-hidden">
      {/* Header row */}
      <div className="flex w-full items-center gap-4 px-5 py-4">
        {/* Accordion trigger */}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-4 text-left transition hover:opacity-80"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={handleToggle}
        >
          {/* Chevron */}
          <svg
            className={`h-4 w-4 shrink-0 text-[var(--slate-400)] transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>

          {/* Set info */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-[var(--slate-800)]">
              {planSet.name}
            </h3>
            {planSet.description && (
              <p className="mt-0.5 truncate text-xs text-[var(--slate-500)]">
                {planSet.description}
              </p>
            )}
          </div>

          {/* Compact metadata */}
          <div className="flex shrink-0 items-center gap-4 text-xs text-[var(--slate-500)]">
            <span>
              {planSet.file_count}{" "}
              {planSet.file_count === 1 ? "plan" : "plans"}
            </span>
            <span className="hidden sm:inline">
              {formatRelativeTime(planSet.updated_at)}
            </span>
          </div>
        </button>

        {/* Edit set button */}
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--slate-400)] transition hover:bg-[var(--slate-100)] hover:text-[var(--slate-700)]"
          aria-label={`Modifier le jeu "${planSet.name}"`}
          onClick={handleStartEdit}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.862 4.487a2.1 2.1 0 112.97 2.97L7.5 19.789l-4.5.75.75-4.5L16.862 4.487z"
            />
          </svg>
        </button>

        {/* Delete set button */}
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--slate-400)] transition hover:bg-[var(--slate-100)] hover:text-red-600"
          aria-label={`Supprimer le jeu "${planSet.name}"`}
          onClick={() => setDeleteSetModalOpen(true)}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
            />
          </svg>
        </button>
      </div>

      {/* Body — expanded content */}
      <div
        id={regionId}
        role="region"
        aria-label={`Contenu du jeu "${planSet.name}"`}
        hidden={!expanded}
      >
        {expanded && (
          <div className="border-t border-[var(--slate-200)] px-5 pb-5 pt-4">
            {/* Set edit form */}
            {editingSet && (
              <div className="mb-4 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
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
              <p className="mt-4 text-center text-sm text-[var(--slate-500)]">
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
            {files && files.length > 0 && (
              <div className="mt-4 flex justify-end">
                <Link
                  href={`/dashboard/estimates/${versionId}/takeoff/new?plan_set_id=${planSet.id}`}
                  className="btn btn-primary btn-sm"
                >
                  Lancer l&apos;extraction
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
